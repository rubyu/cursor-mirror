#!/usr/bin/env python
"""Strict holdout probe for POC 13.

This reuses the POC 13 dataset builder but retrains the selected Transformer
with each machine/refresh holdout removed from training. It writes compact
aggregate JSON/Markdown only.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import random
import sys
import time
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import numpy as np
import torch


def load_poc13_module() -> Any:
    script = Path(__file__).resolve().parent / "run-deep-learning-gpu.py"
    spec = importlib.util.spec_from_file_location("poc13_deep_learning", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    poc_dir = script_dir.parent
    root = poc_dir.parent.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-dir", type=Path, default=poc_dir)
    parser.add_argument("--manifest", type=Path, default=root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json")
    parser.add_argument("--epochs", type=int, default=70)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--max-seconds", type=float, default=1800.0)
    parser.add_argument("--seed", type=int, default=13113)
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


def clone_rows_for_holdout(rows: list[dict[str, Any]], test_package_ids: set[str]) -> list[dict[str, Any]]:
    cloned = []
    for row in rows:
        copied = dict(row)
        if copied["packageId"] in test_package_ids:
            copied["split"] = "test"
        elif copied["split"] not in ("train", "validation"):
            copied["split"] = "unused"
        cloned.append(copied)
    return cloned


def renormalize_bundle(module: Any, source: Any, row_meta: list[dict[str, Any]]) -> Any:
    raw_scalar = (source.scalar * source.scalar_std) + source.scalar_mean
    raw_seq = (source.seq * source.seq_std) + source.seq_mean
    train_mask = np.asarray([row["split"] == "train" for row in row_meta], dtype=bool)
    if not np.any(train_mask):
        raise RuntimeError("fold has no training rows")
    scalar_mean = raw_scalar[train_mask].mean(axis=0, keepdims=True)
    scalar_std = np.maximum(raw_scalar[train_mask].std(axis=0, keepdims=True), 0.05)
    flat_seq = raw_seq[train_mask].reshape(-1, raw_seq.shape[-1])
    seq_mean = flat_seq.mean(axis=0, keepdims=True).reshape(1, 1, -1)
    seq_std = np.maximum(flat_seq.std(axis=0, keepdims=True).reshape(1, 1, -1), 0.05)
    scalar = (raw_scalar - scalar_mean) / scalar_std
    seq = (raw_seq - seq_mean) / seq_std
    correction = source.target - source.baseline
    target_scale = np.percentile(np.abs(source.target[train_mask]), 95, axis=0, keepdims=True).astype(np.float32) + 1.0
    correction_scale = np.percentile(np.abs(correction[train_mask]), 95, axis=0, keepdims=True).astype(np.float32) + 0.5
    summary = {
        **source.summary,
        "bySplit": dict(__import__("collections").Counter(row["split"] for row in row_meta)),
        "normalization": "fold-specific",
    }
    return module.DatasetBundle(
        scalar=scalar.astype(np.float32),
        seq=seq.astype(np.float32),
        target=source.target,
        baseline=source.baseline,
        correction=correction,
        row_meta=row_meta,
        scalar_mean=scalar_mean,
        scalar_std=scalar_std,
        seq_mean=seq_mean,
        seq_std=seq_std,
        target_scale=target_scale,
        correction_scale=correction_scale,
        summary=summary,
    )


def cell(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.4f}".rstrip("0").rstrip(".")
    return str(value)


def table(headers: list[str], rows: list[list[Any]]) -> str:
    return "\n".join([
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
        *["| " + " | ".join(cell(value) for value in row) + " |" for row in rows],
    ])


def main() -> int:
    args = parse_args()
    module = load_poc13_module()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = torch.device("cpu" if args.cpu or not torch.cuda.is_available() else "cuda")
    started = time.perf_counter()

    context = module.load_manifest(args.manifest)
    packages = [module.load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    rows, build_summary = module.build_rows(packages)
    source_bundle = module.build_dataset(rows)

    folds = []
    for item in context["holdouts"]:
        kind = item["kind"]
        raw_id = str(item["id"])
        normalized_id = raw_id if raw_id.startswith(f"{kind}:") else f"{kind}:{raw_id}"
        folds.append({
            "id": normalized_id,
            "kind": kind,
            "testPackageIds": sorted(item["testPackageIdSet"]),
        })

    results = []
    for fold in folds:
        if time.perf_counter() - started > args.max_seconds:
            break
        test_package_ids = set(fold["testPackageIds"])
        row_meta = clone_rows_for_holdout(source_bundle.row_meta, test_package_ids)
        fold_bundle = renormalize_bundle(module, source_bundle, row_meta)
        scalar_dim = int(fold_bundle.scalar.shape[1])
        seq_dim = int(fold_bundle.seq.shape[2])
        model = module.TransformerResidual(scalar_dim, seq_dim, 96, 4, 2)
        training = module.train_model(model, fold_bundle, "residual", False, device, args, started)
        pred = module.predict_model(model, fold_bundle, "residual", device, args.batch_size)
        deep_metrics = module.evaluate_prediction("transformer_residual_d96_strict", pred, fold_bundle, [])
        step5_metrics = module.evaluate_prediction("step5_gate", fold_bundle.baseline, fold_bundle, [])
        results.append({
            **fold,
            "rows": fold_bundle.summary["bySplit"],
            "training": training,
            "deep": deep_metrics["bySplit"],
            "step5": step5_metrics["bySplit"],
            "deltaTestVsStep5": {
                "mean": round((deep_metrics["bySplit"]["test"]["mean"] or math.nan) - (step5_metrics["bySplit"]["test"]["mean"] or math.nan), 4),
                "p95": round((deep_metrics["bySplit"]["test"]["p95"] or math.nan) - (step5_metrics["bySplit"]["test"]["p95"] or math.nan), 4),
                "p99": round((deep_metrics["bySplit"]["test"]["p99"] or math.nan) - (step5_metrics["bySplit"]["test"]["p99"] or math.nan), 4),
                "gt10Rate": round((deep_metrics["bySplit"]["test"]["gt10Rate"] or math.nan) - (step5_metrics["bySplit"]["test"]["gt10Rate"] or math.nan), 6),
            },
        })
        del model
        if device.type == "cuda":
            torch.cuda.empty_cache()

    scores = {
        "schemaVersion": "cursor-prediction-v13-strict-holdout/1",
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "device": str(device),
            "gpuUsed": device.type == "cuda",
            "torchVersion": torch.__version__,
            "cudaVersion": torch.version.cuda,
            "gpuName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        },
        "constraints": {
            "rawZipCopied": False,
            "expandedCsvWritten": False,
            "checkpointWritten": False,
            "featureCacheWritten": False,
        },
        "buildSummary": build_summary,
        "folds": results,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }

    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    (out / "strict-holdout-scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    rows_for_table = []
    for result in results:
        rows_for_table.append([
            result["id"],
            ",".join(result["testPackageIds"]),
            result["deep"]["test"]["mean"],
            result["deep"]["test"]["p95"],
            result["deep"]["test"]["p99"],
            result["step5"]["test"]["p95"],
            result["step5"]["test"]["p99"],
            result["deltaTestVsStep5"]["p95"],
            result["deltaTestVsStep5"]["p99"],
        ])
    report = f"""# Cursor Prediction v13 - Strict Holdout

## Intent

This follow-up retrains `transformer_residual_d96` with each machine/refresh holdout completely removed from training. It checks whether the POC 13 deep result survives a stricter cross-machine and cross-refresh split.

## Environment

- Device: `{scores['environment']['device']}`
- GPU: `{scores['environment']['gpuName']}`
- Torch: `{scores['environment']['torchVersion']}`

No checkpoints, expanded CSVs, feature caches, or model weights were written.

## Fold Results

{table(['holdout', 'test packages', 'deep mean', 'deep p95', 'deep p99', 'step5 p95', 'step5 p99', 'delta p95', 'delta p99'], rows_for_table)}

## Interpretation

Negative deltas mean the strict deep model beat the Step 5 gate on the held-out package group. Positive deltas are regressions and should block product promotion until explained.
"""
    (out / "strict-holdout-report.md").write_text(report, encoding="utf-8")
    print(json.dumps({"folds": len(results), "gpuUsed": device.type == "cuda", "elapsedSeconds": scores["elapsedSeconds"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
