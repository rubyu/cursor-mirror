#!/usr/bin/env python
"""Step 02 overshoot metrics for cursor-prediction-v17.

Loads the existing 60Hz MotionLab rows, compares Step5 with the v16 selected
runtime descriptor, and writes compact stop/overshoot metrics. This script does
not train models and does not copy raw data.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import numpy as np


SCHEMA_VERSION = "cursor-prediction-v17-step-02-overshoot-metrics/1"


def load_poc13_module(root: Path) -> Any:
    script = root / "poc" / "cursor-prediction-v13" / "scripts" / "run-deep-learning-gpu.py"
    spec = importlib.util.spec_from_file_location("poc13_deep_learning_for_v17", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-dir", type=Path, default=root / "poc" / "cursor-prediction-v17" / "step-02-overshoot-metrics")
    parser.add_argument("--manifest", type=Path, default=root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json")
    parser.add_argument("--runtime", type=Path, default=root / "poc" / "cursor-prediction-v16" / "runtime" / "selected-candidate.json")
    return parser.parse_args()


def percentile(values: np.ndarray, p: float) -> float | None:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return None
    return round(float(np.percentile(finite, p)), 4)


def stats(values: np.ndarray) -> dict[str, Any]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return {"count": 0, "mean": None, "median": None, "p95": None, "p99": None, "max": None}
    return {
        "count": int(finite.size),
        "mean": round(float(np.mean(finite)), 4),
        "median": percentile(finite, 50),
        "p95": percentile(finite, 95),
        "p99": percentile(finite, 99),
        "max": round(float(np.max(finite)), 4),
    }


def signed_stats(values: np.ndarray) -> dict[str, Any]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return {"count": 0, "mean": None, "p95": None, "p99": None, "leadRate": None, "lagRate": None}
    return {
        "count": int(finite.size),
        "mean": round(float(np.mean(finite)), 4),
        "p95": percentile(finite, 95),
        "p99": percentile(finite, 99),
        "leadRate": round(float(np.mean(finite > 0.0)), 6),
        "lagRate": round(float(np.mean(finite < 0.0)), 6),
    }


def student_features(bundle: Any, kind: str) -> np.ndarray:
    scalar = bundle.scalar.astype(np.float32)
    seq = bundle.seq.astype(np.float32)
    if kind == "scalar":
        return scalar
    if kind == "dense":
        return np.concatenate([scalar, seq.reshape(seq.shape[0], -1)], axis=1)
    if kind == "fsmn":
        parts = [scalar, seq[:, -1, :]]
        for decay in (2.0, 4.0, 8.0):
            weights = np.exp(-np.arange(seq.shape[1] - 1, -1, -1, dtype=np.float32) / np.float32(decay))
            weights = weights / np.maximum(np.float32(1e-9), weights.sum())
            parts.append(np.einsum("t,ntd->nd", weights, seq))
        parts.append(seq[:, -4:, :].mean(axis=1))
        parts.append(seq[:, -8:, :].mean(axis=1))
        return np.concatenate(parts, axis=1)
    raise ValueError(kind)


def activate(x: np.ndarray, activation: str) -> np.ndarray:
    if activation == "relu":
        return np.maximum(x, 0.0)
    if activation == "hardtanh":
        return np.clip(x, -1.0, 1.0)
    if activation == "tanh":
        return np.tanh(x)
    if activation == "silu":
        return x / (1.0 + np.exp(-x))
    return x


def quantize(pred: np.ndarray, step: float) -> np.ndarray:
    if step <= 0:
        return pred.astype(np.float32)
    return (np.round(pred / np.float32(step)) * np.float32(step)).astype(np.float32)


def lag_units_from_source(bundle: Any, descriptor: dict[str, Any]) -> np.ndarray:
    scalar = bundle.scalar.astype(np.float32)
    source = descriptor.get("sourceNormalization", {})
    mean = np.asarray(source.get("scalarMean", []), dtype=np.float32)
    std = np.asarray(source.get("scalarStd", []), dtype=np.float32)
    if mean.size <= 18 or std.size <= 18:
        return np.zeros((scalar.shape[0], 2), dtype=np.float32)
    raw_dx = scalar[:, 17] * std[17] + mean[17]
    raw_dy = scalar[:, 18] * std[18] + mean[18]
    mag = np.sqrt((raw_dx * raw_dx) + (raw_dy * raw_dy))
    unit = np.zeros((scalar.shape[0], 2), dtype=np.float32)
    moving = mag > 1e-6
    unit[moving, 0] = raw_dx[moving] / mag[moving]
    unit[moving, 1] = raw_dy[moving] / mag[moving]
    return unit


def runtime_predict(bundle: Any, descriptor: dict[str, Any]) -> np.ndarray:
    runtime = descriptor["runtime"]
    x = student_features(bundle, runtime["featureKind"])
    x = (x - np.asarray(runtime["featureMean"], dtype=np.float32).reshape(1, -1)) / np.asarray(runtime["featureStd"], dtype=np.float32).reshape(1, -1)
    if runtime["type"] == "linear":
        pred = x @ np.asarray(runtime["weights"], dtype=np.float32).reshape(-1, 2) + np.asarray(runtime["bias"], dtype=np.float32).reshape(1, 2)
    else:
        layers = runtime["layers"]
        h = x @ np.asarray(layers["inputHidden"]["weights"], dtype=np.float32).T + np.asarray(layers["inputHidden"]["bias"], dtype=np.float32).reshape(1, -1)
        h = activate(h, runtime["activation"])
        h = h @ np.asarray(layers["hiddenHidden"]["weights"], dtype=np.float32).T + np.asarray(layers["hiddenHidden"]["bias"], dtype=np.float32).reshape(1, -1)
        h = activate(h, runtime["activation"])
        pred = h @ np.asarray(layers["hiddenOutput"]["weights"], dtype=np.float32).T + np.asarray(layers["hiddenOutput"]["bias"], dtype=np.float32).reshape(1, -1)
        pred = pred * np.asarray(runtime["targetScale"], dtype=np.float32).reshape(1, 2)
    pred = quantize(pred.astype(np.float32), float(runtime.get("quantizationStep", 0.0)))
    lag = float(runtime.get("lagCompensationPx", 0.0))
    if lag > 0:
        pred = pred + lag_units_from_source(bundle, descriptor) * np.float32(lag)
    return pred.astype(np.float32)


def vector_arrays(bundle: Any) -> dict[str, np.ndarray]:
    recent_v = np.zeros((len(bundle.row_meta), 2), dtype=np.float32)
    label_v = np.zeros((len(bundle.row_meta), 2), dtype=np.float32)
    phase = []
    package = []
    split = []
    for i, row in enumerate(bundle.row_meta):
        v12 = row["velocities"][12]
        recent_v[i, 0] = float(v12["vx"])
        recent_v[i, 1] = float(v12["vy"])
        label_v[i, 0] = float(row["labelVx"])
        label_v[i, 1] = float(row["labelVy"])
        phase.append(row["phase"])
        package.append(row["packageId"])
        split.append(row["split"])
    recent_speed = np.sqrt(np.sum(recent_v * recent_v, axis=1))
    label_speed = np.sqrt(np.sum(label_v * label_v, axis=1))
    target_mag = np.sqrt(np.sum(bundle.target.astype(np.float32) ** 2, axis=1))
    return {
        "recentV": recent_v,
        "labelV": label_v,
        "recentSpeed": recent_speed,
        "labelSpeed": label_speed,
        "targetMag": target_mag,
        "phase": np.asarray(phase),
        "package": np.asarray(package),
        "split": np.asarray(split),
    }


def masks_for(bundle: Any, vectors: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    recent = vectors["recentSpeed"]
    label = vectors["labelSpeed"]
    target_mag = vectors["targetMag"]
    phase = vectors["phase"]
    recent_v = vectors["recentV"]
    label_v = vectors["labelV"]
    dot = np.sum(recent_v * label_v, axis=1)
    return {
        "all": np.ones(len(bundle.row_meta), dtype=bool),
        "stopApproach": (recent >= 500.0) & ((label <= 150.0) | ((recent - label >= 500.0) & (label <= recent * 0.45))),
        "hardStopApproach": (recent >= 1000.0) & (label <= 100.0),
        "postStopHold": (recent <= 100.0) & (label <= 25.0) & (target_mag <= 1.0) & ((phase == "hold") | (phase == "unknown")),
        "directionFlip": (recent >= 250.0) & (label >= 100.0) & (dot < (-0.15 * recent * label)),
    }


def direction_units(vectors: dict[str, np.ndarray]) -> np.ndarray:
    recent = vectors["recentV"].astype(np.float32)
    label = vectors["labelV"].astype(np.float32)
    recent_mag = np.sqrt(np.sum(recent * recent, axis=1))
    label_mag = np.sqrt(np.sum(label * label, axis=1))
    direction = np.zeros_like(recent)
    use_recent = recent_mag > 1e-6
    direction[use_recent] = recent[use_recent] / recent_mag[use_recent, None]
    use_label = (~use_recent) & (label_mag > 1e-6)
    direction[use_label] = label[use_label] / label_mag[use_label, None]
    return direction


def model_metrics(name: str, pred: np.ndarray, bundle: Any, vectors: dict[str, np.ndarray], masks: dict[str, np.ndarray]) -> dict[str, Any]:
    target = bundle.target.astype(np.float32)
    err = pred - target
    euclid = np.sqrt(np.sum(err * err, axis=1))
    direction = direction_units(vectors)
    signed = np.sum(err * direction, axis=1)
    direction_mag = np.sqrt(np.sum(direction * direction, axis=1))
    signed[direction_mag <= 0] = np.nan
    overshoot = np.maximum(signed, 0.0)
    old_dir = direction
    pred_old = np.sum(pred * old_dir, axis=1)
    target_old = np.sum(target * old_dir, axis=1)
    direction_flip_penalty = np.maximum(pred_old - target_old, 0.0)
    pred_mag = np.sqrt(np.sum(pred * pred, axis=1))

    def slice_metrics(mask: np.ndarray) -> dict[str, Any]:
        return {
            "rows": int(np.sum(mask)),
            "errorPx": stats(euclid[mask]),
            "signedAlongMotionError": signed_stats(signed[mask]),
            "overshootPx": stats(overshoot[mask]),
            "overshootRateGt0p5": round(float(np.mean(overshoot[mask] > 0.5)), 6) if np.sum(mask) else None,
            "overshootRateGt1": round(float(np.mean(overshoot[mask] > 1.0)), 6) if np.sum(mask) else None,
            "overshootRateGt2": round(float(np.mean(overshoot[mask] > 2.0)), 6) if np.sum(mask) else None,
            "predictionMagnitude": stats(pred_mag[mask]),
        }

    by_slice = {key: slice_metrics(mask) for key, mask in masks.items()}
    by_split = {split: slice_metrics(vectors["split"] == split) for split in sorted(set(vectors["split"]))}
    by_package_stop = {
        package: slice_metrics(masks["stopApproach"] & (vectors["package"] == package))
        for package in sorted(set(vectors["package"]))
    }
    by_slice["postStopHold"]["postStopJitter"] = stats(pred_mag[masks["postStopHold"]])
    by_slice["directionFlip"]["directionFlipPenalty"] = stats(direction_flip_penalty[masks["directionFlip"]])
    examples = []
    stop_indices = np.where(masks["stopApproach"] & np.isfinite(overshoot))[0]
    if stop_indices.size:
        worst = stop_indices[np.argsort(overshoot[stop_indices])[-10:]][::-1]
        for idx in worst:
            row = bundle.row_meta[int(idx)]
            examples.append({
                "packageId": row["packageId"],
                "split": row["split"],
                "phase": row["phase"],
                "speedBin": row["speedBin"],
                "recentSpeed": round(float(vectors["recentSpeed"][idx]), 4),
                "labelSpeed": round(float(vectors["labelSpeed"][idx]), 4),
                "targetDx": round(float(target[idx, 0]), 4),
                "targetDy": round(float(target[idx, 1]), 4),
                "predDx": round(float(pred[idx, 0]), 4),
                "predDy": round(float(pred[idx, 1]), 4),
                "signedAlongMotionError": round(float(signed[idx]), 4),
                "overshootPx": round(float(overshoot[idx]), 4),
            })
    return {
        "modelId": name,
        "bySlice": by_slice,
        "bySplit": by_split,
        "byPackageStopApproach": by_package_stop,
        "worstStopApproachExamples": examples,
    }


def write_outputs(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    rows = []
    for model_id, metric in scores["models"].items():
        stop = metric["bySlice"]["stopApproach"]
        post = metric["bySlice"]["postStopHold"]
        flip = metric["bySlice"]["directionFlip"]
        rows.append(
            f"| {model_id} | {stop['rows']} | {stop['errorPx']['p95']} | {stop['errorPx']['p99']} | "
            f"{stop['signedAlongMotionError']['mean']} | {stop['overshootPx']['p95']} | "
            f"{stop['overshootRateGt1']} | {post['postStopJitter']['p95']} | "
            f"{flip['directionFlipPenalty']['p95']} |"
        )
    report = f"""# Step 02 - Overshoot Metrics

## Scope

This step defines and computes stop/overshoot diagnostics for Step5 and the v16 selected DistilledMLP runtime candidate. It reads 60Hz MotionLab rows in place and performs CPU inference only.

## Metric Definitions

- `signedAlongMotionError`: dot product of prediction error `(prediction - target)` with the recent motion direction. Positive means lead/overshoot; negative means lag.
- `overshootPx`: `max(0, signedAlongMotionError)`.
- `overshootRateGt0p5/Gt1/Gt2`: fraction of rows whose overshoot exceeds 0.5, 1.0, or 2.0 px.
- `stopApproach`: recent v12 speed >= 500 px/s and future label speed is low or sharply lower.
- `hardStopApproach`: recent v12 speed >= 1000 px/s and label speed <= 100 px/s.
- `postStopJitter`: prediction magnitude during low-speed hold rows.
- `directionFlipPenalty`: residual prediction component in the old motion direction on direction-flip rows.

## Dataset

- Rows: {scores['dataset']['rows']}
- Splits: `{scores['dataset']['bySplit']}`
- Packages: `{scores['dataset']['byPackage']}`
- Slice counts: `{scores['sliceCounts']}`

## Stop-Approach Summary

| model | stop rows | stop p95 | stop p99 | signed mean | overshoot p95 | overshoot >1px | post-stop jitter p95 | flip penalty p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

## Initial Read

{scores['interpretation']}
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    notes = """# Step 02 Notes

- This is lightweight CPU analysis only.
- It compares Step5 against the v16 selected runtime descriptor.
- The metric definitions intentionally focus on lead/overshoot around deceleration, not just Euclidean p95/p99.
- Next steps should add candidate gates and ablations only after this baseline is reviewed.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    module = load_poc13_module(args.root)
    context = module.load_manifest(args.manifest)
    packages = [module.load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    rows, build_summary = module.build_rows(packages)
    rows = [row for row in rows if row["refreshBucket"] == "60Hz"]
    bundle = module.build_dataset(rows)
    descriptor = json.loads(args.runtime.read_text(encoding="utf-8"))
    vectors = vector_arrays(bundle)
    masks = masks_for(bundle, vectors)
    predictions = {
        "step5_gate": bundle.baseline.astype(np.float32),
        descriptor["modelId"]: runtime_predict(bundle, descriptor),
    }
    models = {name: model_metrics(name, pred, bundle, vectors, masks) for name, pred in predictions.items()}
    step5_stop = models["step5_gate"]["bySlice"]["stopApproach"]
    distilled_stop = models[descriptor["modelId"]]["bySlice"]["stopApproach"]
    if distilled_stop["overshootPx"]["p95"] is not None and step5_stop["overshootPx"]["p95"] is not None:
        delta = round(float(distilled_stop["overshootPx"]["p95"]) - float(step5_stop["overshootPx"]["p95"]), 4)
        if delta > 0.25:
            interpretation = f"DistilledMLP shows higher stop-approach overshoot p95 than Step5 by {delta}px; v17 should prioritize deceleration/lag-compensation gating."
        elif delta < -0.25:
            interpretation = f"DistilledMLP lowers stop-approach overshoot p95 versus Step5 by {-delta}px; remaining work should focus on worst examples and post-stop jitter."
        else:
            interpretation = f"DistilledMLP and Step5 have similar stop-approach overshoot p95 delta {delta}px; inspect p99, rates, and examples before changing runtime logic."
    else:
        interpretation = "Stop-approach slice was too small or invalid for a p95 comparison; review extraction thresholds before candidate work."
    scores = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "constraints": {
            "rawDataCopied": False,
            "expandedCsvWritten": False,
            "checkpointWritten": False,
            "tensorDumpWritten": False,
            "gpuTrainingRun": False,
            "analysis": "CPU-only data load and fixed runtime inference",
        },
        "inputs": {
            "manifest": str(args.manifest.relative_to(args.root)),
            "runtimeDescriptor": str(args.runtime.relative_to(args.root)),
            "loader": "poc/cursor-prediction-v13/scripts/run-deep-learning-gpu.py",
        },
        "dataset": bundle.summary,
        "buildSummary": build_summary,
        "sliceCounts": {name: int(np.sum(mask)) for name, mask in masks.items()},
        "slicePackageCounts": {
            name: dict(Counter(vectors["package"][mask]))
            for name, mask in masks.items()
        },
        "models": models,
        "interpretation": interpretation,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    write_outputs(args.out_dir, scores)
    print(json.dumps({
        "step": "02",
        "rows": bundle.summary["rows"],
        "sliceCounts": scores["sliceCounts"],
        "modelIds": list(models.keys()),
        "elapsedSeconds": scores["elapsedSeconds"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
