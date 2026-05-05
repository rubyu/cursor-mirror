#!/usr/bin/env python3
"""Phase 4 guarded MLP residual search for Cursor Prediction v9.

This script reuses the Phase 3 in-memory Format 9 dataset builder and MLP
teacher. It writes only compact JSON/Markdown summaries: no checkpoints,
TensorBoard logs, dataset caches, or extracted ZIP contents.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import random
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch


SCRIPT_DIR = Path(__file__).resolve().parent
PHASE3_PATH = SCRIPT_DIR / "phase3-ml-teachers.py"
spec = importlib.util.spec_from_file_location("phase3_ml_teachers", PHASE3_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load {PHASE3_PATH}")
p3 = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = p3
spec.loader.exec_module(p3)


THRESHOLDS = [0.0, 2.0, 4.0, 6.0, 8.0, 12.0, 16.0, 24.0, 32.0, 48.0, float("inf")]
REQUESTED_THRESHOLDS = [2.0, 4.0, 6.0, 8.0, 12.0, 16.0, 24.0, 32.0, 48.0]
COS_THRESHOLDS = [0.0, 0.25, 0.5]
BASELINE_DISP_LIMITS = [4.0, 8.0, 12.0, 18.0, 24.0, float("inf")]
EFFICIENCY_FLOORS = [0.0, 0.5, 0.75, 0.9]


def parse_args() -> argparse.Namespace:
    root = SCRIPT_DIR.parents[2]
    out_dir = SCRIPT_DIR.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-json", type=Path, default=out_dir / "phase-4-guarded-mlp.json")
    parser.add_argument("--out-md", type=Path, default=out_dir / "phase-4-guarded-mlp.md")
    parser.add_argument("--seed", type=int, default=20260504)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--epochs", type=int, default=3)
    return parser.parse_args()


def split_dataset(dataset: Any, train_fraction: float = 0.70) -> tuple[Any, Any]:
    split = int(dataset.target.shape[0] * train_fraction)
    split -= split % len(p3.HORIZONS_MS)
    split = max(len(p3.HORIZONS_MS), min(split, dataset.target.shape[0] - len(p3.HORIZONS_MS)))
    return subset_dataset(dataset, 0, split, f"{dataset.session_id}-train70"), subset_dataset(
        dataset, split, dataset.target.shape[0], f"{dataset.session_id}-val30"
    )


def subset_dataset(dataset: Any, start: int, end: int, session_id: str) -> Any:
    summary = dict(dataset.summary)
    summary.update({
        "sourceZip": dataset.source_zip,
        "rowsBuilt": int(end - start),
        "sliceStart": int(start),
        "sliceEnd": int(end),
        "rowsByHorizon": counts_by_value(dataset.horizons[start:end]),
        "rowsBySpeedBin": counts_by_value(dataset.speed_bins[start:end]),
    })
    return p3.Dataset(
        session_id=session_id,
        source_zip=dataset.source_zip,
        seq=dataset.seq[start:end],
        ctx=dataset.ctx[start:end],
        tab=dataset.tab[start:end],
        residual=dataset.residual[start:end],
        target=dataset.target[start:end],
        baseline=dataset.baseline[start:end],
        baseline_error=dataset.baseline_error[start:end],
        speed_bins=dataset.speed_bins[start:end],
        horizons=dataset.horizons[start:end],
        summary=summary,
    )


def concat_datasets(first: Any, second: Any, session_id: str) -> Any:
    return p3.Dataset(
        session_id=session_id,
        source_zip=f"{first.source_zip}+{second.source_zip}",
        seq=np.concatenate([first.seq, second.seq], axis=0),
        ctx=np.concatenate([first.ctx, second.ctx], axis=0),
        tab=np.concatenate([first.tab, second.tab], axis=0),
        residual=np.concatenate([first.residual, second.residual], axis=0),
        target=np.concatenate([first.target, second.target], axis=0),
        baseline=np.concatenate([first.baseline, second.baseline], axis=0),
        baseline_error=np.concatenate([first.baseline_error, second.baseline_error], axis=0),
        speed_bins=np.concatenate([first.speed_bins, second.speed_bins], axis=0),
        horizons=np.concatenate([first.horizons, second.horizons], axis=0),
        summary={
            "sourceZip": f"{first.source_zip}+{second.source_zip}",
            "rowsBuilt": int(first.target.shape[0] + second.target.shape[0]),
            "parts": [first.summary, second.summary],
        },
    )


def counts_by_value(values: np.ndarray) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in values:
        key = str(float(value)) if isinstance(value, np.floating) else str(value)
        result[key] = result.get(key, 0) + 1
    return result


def threshold_label(value: float) -> str:
    return "inf" if math.isinf(value) else str(int(value) if float(value).is_integer() else value)


def metric_errors(dataset: Any, residual_px: np.ndarray) -> np.ndarray:
    pred = dataset.baseline + residual_px.astype(np.float32)
    return p3.distance(pred[:, 0], pred[:, 1], dataset.target[:, 0], dataset.target[:, 1])


def horizon_breakdown(errors: np.ndarray, horizons: np.ndarray) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for horizon in p3.HORIZONS_MS:
        mask = np.isclose(horizons, horizon)
        if np.any(mask):
            result[str(horizon)] = p3.metric_stats(errors[mask])
    return result


def evaluate_residual(dataset: Any, residual_px: np.ndarray) -> dict[str, Any]:
    errors = metric_errors(dataset, residual_px)
    return {
        "metrics": p3.metric_stats(errors),
        "regressionsVsBaseline": p3.regression_counts(errors, dataset.baseline_error),
        "speedBins": p3.speed_breakdown(errors, dataset.speed_bins),
        "horizons": horizon_breakdown(errors, dataset.horizons),
    }


def baseline_summary(dataset: Any) -> dict[str, Any]:
    return evaluate_residual(dataset, np.zeros_like(dataset.baseline, dtype=np.float32))


def objective_score(summary: dict[str, Any], baseline: dict[str, Any], objective: str) -> float:
    metrics = summary["metrics"]
    reg = summary["regressionsVsBaseline"]
    count = max(1, reg["count"])
    worse1_rate = reg["worseOver1px"] / count
    worse5_rate = reg["worseOver5px"] / count
    improved_rate = reg["improvedOver1px"] / count
    p95 = metrics["p95"] if metrics["p95"] is not None else float("inf")
    p99 = metrics["p99"] if metrics["p99"] is not None else float("inf")
    mean = metrics["mean"] if metrics["mean"] is not None else float("inf")
    base_p95 = baseline["metrics"]["p95"] or p95
    base_p99 = baseline["metrics"]["p99"] or p99
    p95_gain = max(0.0, base_p95 - p95)
    p99_overshoot = max(0.0, p99 - base_p99)
    if objective == "strict":
        return (
            2200.0 * worse5_rate
            + 360.0 * worse1_rate
            + p95
            + 0.35 * p99
            + 2.0 * p99_overshoot
            - 1.5 * p95_gain
            - 10.0 * improved_rate
        )
    return (
        p95
        + 0.45 * p99
        + 0.05 * mean
        + 520.0 * worse5_rate
        + 90.0 * worse1_rate
        - 35.0 * improved_rate
    )


def alpha_beta_correction(dataset: Any) -> np.ndarray:
    current = dataset.baseline - dataset.ctx[:, 6:8].astype(np.float32) * 24.0
    horizon_s = (dataset.horizons.astype(np.float32) / 1000.0)[:, None]
    recent_v = dataset.ctx[:, 1:3].astype(np.float32) * 5000.0
    valid = dataset.seq[:, :, 7] > 0.5
    oldest_idx = np.argmax(valid, axis=1)
    oldest_rel = dataset.seq[np.arange(dataset.seq.shape[0]), oldest_idx, 0:2].astype(np.float32) * 500.0
    oldest_age_ms = dataset.seq[np.arange(dataset.seq.shape[0]), oldest_idx, 2].astype(np.float32) * 100.0
    age_s = np.maximum(oldest_age_ms / 1000.0, 0.001)[:, None]
    average_v = -oldest_rel / age_s
    blended_v = 0.65 * recent_v + 0.35 * average_v
    raw_disp = blended_v * horizon_s
    mag = np.linalg.norm(raw_disp, axis=1)
    cap = np.where(dataset.ctx[:, 3] >= 0.4, 32.0, 16.0).astype(np.float32)
    scale = np.minimum(1.0, cap / np.maximum(mag, 1e-6))
    ab_pred = current + raw_disp * scale[:, None]
    return (ab_pred - dataset.baseline).astype(np.float32)


def base_masks(dataset: Any, residual_px: np.ndarray, ab_corr: np.ndarray) -> dict[str, np.ndarray]:
    mag = np.linalg.norm(residual_px, axis=1)
    ab_mag = np.linalg.norm(ab_corr, axis=1)
    dot = np.sum(residual_px * ab_corr, axis=1)
    cos = dot / np.maximum(mag * ab_mag, 1e-6)
    return {
        "all": np.ones(residual_px.shape[0], dtype=bool),
        "fast": dataset.speed_bins == ">=2000",
        "not-fast": dataset.speed_bins != ">=2000",
        "moving": dataset.speed_bins != "0-25",
        "low-speed": dataset.speed_bins == "0-25",
        "agreement00": (ab_mag >= 0.5) & (dot > 0.0),
        "agreement025": (ab_mag >= 0.5) & (cos >= 0.25),
        "agreement05": (ab_mag >= 0.5) & (cos >= 0.5),
    }


def apply_spec(dataset: Any, residual_px: np.ndarray, spec: dict[str, Any], ab_corr: np.ndarray) -> np.ndarray:
    mag = np.linalg.norm(residual_px, axis=1)
    mask = np.zeros(residual_px.shape[0], dtype=bool)
    kind = spec["kind"]
    if kind == "baseline":
        return np.zeros_like(residual_px, dtype=np.float32)
    if kind == "unguarded":
        return residual_px.astype(np.float32)
    masks = base_masks(dataset, residual_px, ab_corr)
    if kind == "global-threshold":
        mask = mag <= spec["thresholdPx"]
    elif kind == "horizon-thresholds":
        threshold_by_row = np.zeros(residual_px.shape[0], dtype=np.float32)
        for horizon, threshold in spec["thresholdsPx"].items():
            threshold_by_row[np.isclose(dataset.horizons, float(horizon))] = float(threshold)
        mask = mag <= threshold_by_row
    elif kind == "speed-thresholds":
        threshold_by_row = np.zeros(residual_px.shape[0], dtype=np.float32)
        for label, threshold in spec["thresholdsPx"].items():
            threshold_by_row[dataset.speed_bins == label] = float(threshold)
        mask = mag <= threshold_by_row
    elif kind == "apply-set-threshold":
        mask = masks[spec["applySet"]] & (mag <= spec["thresholdPx"])
    elif kind == "agreement-threshold":
        key = f"agreement{str(spec['cosineFloor']).replace('.', '')}"
        mask = masks[key] & (mag <= spec["thresholdPx"])
    elif kind == "baseline-path-threshold":
        baseline_disp = dataset.ctx[:, 8].astype(np.float32) * 24.0
        efficiency = dataset.ctx[:, 4].astype(np.float32)
        mask = (
            (mag <= spec["thresholdPx"])
            & (baseline_disp <= spec["baselineDispMaxPx"])
            & (efficiency >= spec["efficiencyMin"])
        )
    else:
        raise ValueError(f"Unknown gate kind: {kind}")
    return np.where(mask[:, None], residual_px, 0.0).astype(np.float32)


def compact_summary(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "metrics": summary["metrics"],
        "regressionsVsBaseline": summary["regressionsVsBaseline"],
        "speedBins": summary["speedBins"],
        "horizons": summary["horizons"],
    }


def candidate_from_spec(val: Any, val_pred: np.ndarray, spec: dict[str, Any], ab_val: np.ndarray, baseline_val: dict[str, Any]) -> dict[str, Any]:
    residual = apply_spec(val, val_pred, spec, ab_val)
    summary = evaluate_residual(val, residual)
    return {
        "id": spec["id"],
        "spec": spec,
        "validation": compact_summary(summary),
        "scores": {
            "strict": objective_score(summary, baseline_val, "strict"),
            "balanced": objective_score(summary, baseline_val, "balanced"),
        },
    }


def choose_group_thresholds(
    val: Any,
    val_pred: np.ndarray,
    group_masks: dict[str, np.ndarray],
    objective: str,
    baseline_val: dict[str, Any],
) -> dict[str, float]:
    result: dict[str, float] = {}
    mag = np.linalg.norm(val_pred, axis=1)
    for label, group_mask in group_masks.items():
        if not np.any(group_mask):
            result[label] = 0.0
            continue
        best_threshold = 0.0
        best_score = float("inf")
        group_dataset = subset_dataset(val, 0, val.target.shape[0], f"{val.session_id}-{label}")
        group_baseline = {
            "metrics": p3.metric_stats(val.baseline_error[group_mask]),
            "regressionsVsBaseline": p3.regression_counts(val.baseline_error[group_mask], val.baseline_error[group_mask]),
        }
        for threshold in THRESHOLDS:
            gated = np.where((group_mask & (mag <= threshold))[:, None], val_pred, 0.0)
            errors = metric_errors(val, gated)[group_mask]
            summary = {
                "metrics": p3.metric_stats(errors),
                "regressionsVsBaseline": p3.regression_counts(errors, val.baseline_error[group_mask]),
            }
            score = objective_score(summary, group_baseline, objective)
            if score < best_score:
                best_score = score
                best_threshold = threshold
        result[label] = best_threshold
        del group_dataset
    return result


def make_specs(val: Any, val_pred: np.ndarray, baseline_val: dict[str, Any]) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = [
        {"id": "product-baseline", "kind": "baseline"},
        {"id": "mlp-unguarded", "kind": "unguarded"},
    ]
    for threshold in REQUESTED_THRESHOLDS:
        specs.append({
            "id": f"global-residual-le-{threshold_label(threshold)}px",
            "kind": "global-threshold",
            "thresholdPx": threshold,
        })
    for apply_set in ["fast", "not-fast", "moving", "low-speed"]:
        for threshold in [4.0, 8.0, 12.0, 16.0, 24.0, 32.0, 48.0]:
            specs.append({
                "id": f"{apply_set}-residual-le-{threshold_label(threshold)}px",
                "kind": "apply-set-threshold",
                "applySet": apply_set,
                "thresholdPx": threshold,
            })
    for threshold in [4.0, 8.0, 12.0, 16.0, 24.0, 32.0, 48.0]:
        for cosine_floor in COS_THRESHOLDS:
            specs.append({
                "id": f"agreement-cos{str(cosine_floor).replace('.', '')}-residual-le-{threshold_label(threshold)}px",
                "kind": "agreement-threshold",
                "cosineFloor": cosine_floor,
                "thresholdPx": threshold,
            })
    for threshold in [4.0, 8.0, 12.0, 16.0, 24.0, 32.0]:
        for baseline_disp_max in BASELINE_DISP_LIMITS:
            for efficiency_min in EFFICIENCY_FLOORS:
                specs.append({
                    "id": (
                        f"path-residual-le-{threshold_label(threshold)}px-"
                        f"base-le-{threshold_label(baseline_disp_max)}px-eff-ge-{efficiency_min}"
                    ),
                    "kind": "baseline-path-threshold",
                    "thresholdPx": threshold,
                    "baselineDispMaxPx": baseline_disp_max,
                    "efficiencyMin": efficiency_min,
                })

    horizon_masks = {str(h): np.isclose(val.horizons, h) for h in p3.HORIZONS_MS}
    speed_masks = {label: val.speed_bins == label for label, _, _ in p3.SPEED_BINS}
    for objective in ["strict", "balanced"]:
        horizon_thresholds = choose_group_thresholds(val, val_pred, horizon_masks, objective, baseline_val)
        specs.append({
            "id": f"horizon-thresholds-{objective}",
            "kind": "horizon-thresholds",
            "objective": objective,
            "thresholdsPx": horizon_thresholds,
        })
        speed_thresholds = choose_group_thresholds(val, val_pred, speed_masks, objective, baseline_val)
        specs.append({
            "id": f"speed-thresholds-{objective}",
            "kind": "speed-thresholds",
            "objective": objective,
            "thresholdsPx": speed_thresholds,
        })
    return specs


def select_candidate(candidates: list[dict[str, Any]], objective: str) -> dict[str, Any]:
    if objective == "balanced":
        return select_balanced_candidate(candidates)
    return min(candidates, key=lambda candidate: candidate["scores"][objective])


def select_balanced_candidate(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    baseline = next(candidate for candidate in candidates if candidate["id"] == "product-baseline")
    unguarded = next(candidate for candidate in candidates if candidate["id"] == "mlp-unguarded")
    baseline_p95 = baseline["validation"]["metrics"]["p95"] or float("inf")
    unguarded_reg = unguarded["validation"]["regressionsVsBaseline"]
    max_worse5 = max(25, int(unguarded_reg["worseOver5px"] * 0.35))
    max_worse1 = max(100, int(unguarded_reg["worseOver1px"] * 0.75))
    eligible = []
    for candidate in candidates:
        metrics = candidate["validation"]["metrics"]
        reg = candidate["validation"]["regressionsVsBaseline"]
        if reg["worseOver5px"] <= max_worse5 and reg["worseOver1px"] <= max_worse1:
            if (metrics["p95"] or float("inf")) <= baseline_p95 * 1.02:
                eligible.append(candidate)
    if not eligible:
        eligible = candidates
    return min(eligible, key=lambda candidate: (
        candidate["validation"]["metrics"]["p95"] or float("inf"),
        0.35 * (candidate["validation"]["metrics"]["p99"] or float("inf")),
        candidate["validation"]["regressionsVsBaseline"]["worseOver5px"],
        candidate["validation"]["regressionsVsBaseline"]["worseOver1px"],
    ))


def evaluate_selected(eval_ds: Any, eval_pred: np.ndarray, spec: dict[str, Any], ab_eval: np.ndarray, baseline_eval: dict[str, Any]) -> dict[str, Any]:
    residual = apply_spec(eval_ds, eval_pred, spec, ab_eval)
    summary = evaluate_residual(eval_ds, residual)
    return {
        "id": spec["id"],
        "spec": spec,
        "evaluation": compact_summary(summary),
        "scores": {
            "strict": objective_score(summary, baseline_eval, "strict"),
            "balanced": objective_score(summary, baseline_eval, "balanced"),
        },
    }


def run_fold(name: str, train_full: Any, eval_ds: Any, seed: int, epochs: int, batch_size: int, device: torch.device) -> dict[str, Any]:
    train70, val30 = split_dataset(train_full)
    combined = concat_datasets(val30, eval_ds, f"{val30.session_id}+{eval_ds.session_id}")
    torch.manual_seed(seed)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(seed)
    train_pred, combined_pred, meta = p3.torch_train_predict(train70, combined, "mlp", seed, epochs, batch_size, device)
    val_rows = val30.target.shape[0]
    val_pred = combined_pred[:val_rows]
    eval_pred = combined_pred[val_rows:]
    ab_val = alpha_beta_correction(val30)
    ab_eval = alpha_beta_correction(eval_ds)
    baseline_val = baseline_summary(val30)
    baseline_eval = baseline_summary(eval_ds)
    specs = make_specs(val30, val_pred, baseline_val)
    candidates = [candidate_from_spec(val30, val_pred, spec, ab_val, baseline_val) for spec in specs]
    strict = select_candidate(candidates, "strict")
    balanced = select_candidate(candidates, "balanced")
    baseline_candidate = next(candidate for candidate in candidates if candidate["id"] == "product-baseline")
    unguarded_candidate = next(candidate for candidate in candidates if candidate["id"] == "mlp-unguarded")
    selected_specs = {strict["id"]: strict["spec"], balanced["id"]: balanced["spec"], "mlp-unguarded": {"id": "mlp-unguarded", "kind": "unguarded"}}
    selected_specs["product-baseline"] = {"id": "product-baseline", "kind": "baseline"}
    evaluation = {
        key: evaluate_selected(eval_ds, eval_pred, spec, ab_eval, baseline_eval)
        for key, spec in selected_specs.items()
    }
    top_strict = sorted(candidates, key=lambda item: item["scores"]["strict"])[:12]
    top_balanced = sorted(candidates, key=lambda item: item["scores"]["balanced"])[:12]
    eval_inference_sec = meta["inferenceSec"] * eval_ds.target.shape[0] / max(1, combined.target.shape[0])
    return {
        "name": name,
        "trainSession": train_full.session_id,
        "trainRows": int(train_full.target.shape[0]),
        "train70Rows": int(train70.target.shape[0]),
        "validationRows": int(val30.target.shape[0]),
        "evalSession": eval_ds.session_id,
        "evalRows": int(eval_ds.target.shape[0]),
        "model": {
            "id": "mlp_seq16_residual",
            "trainSec": meta["trainSec"],
            "combinedInferenceSec": meta["inferenceSec"],
            "estimatedEvalInferenceSec": eval_inference_sec,
            "inferenceRowsPerSec": float(eval_ds.target.shape[0] / eval_inference_sec) if eval_inference_sec > 0 else None,
            "latencyUsPerSample": float(1_000_000.0 / (eval_ds.target.shape[0] / eval_inference_sec)) if eval_inference_sec > 0 else None,
            "paramCount": meta["paramCount"],
            "losses": meta["losses"],
            "epochs": meta["epochs"],
            "device": meta["device"],
        },
        "baselineValidation": compact_summary(baseline_val),
        "baselineEvaluation": compact_summary(baseline_eval),
        "selected": {
            "strict": {
                "validation": strict,
                "evaluation": evaluation[strict["id"]],
            },
            "balanced": {
                "validation": balanced,
                "evaluation": evaluation[balanced["id"]],
            },
            "unguarded": {
                "validation": unguarded_candidate,
                "evaluation": evaluation["mlp-unguarded"],
            },
            "baseline": {
                "validation": baseline_candidate,
                "evaluation": evaluation["product-baseline"],
            },
        },
        "topValidationCandidates": {
            "strict": top_strict,
            "balanced": top_balanced,
        },
        "candidateCount": len(candidates),
        "trainPredictionRows": int(train_pred.shape[0]),
    }


def fmt(value: Any, digits: int = 3) -> str:
    if value is None:
        return ""
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return str(value)


def md_table(headers: list[str], rows: list[list[str]]) -> str:
    return "\n".join([
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
        *["| " + " | ".join(row) + " |" for row in rows],
    ])


def selected_row(label: str, entry: dict[str, Any]) -> list[str]:
    evaluation = entry["evaluation"]["evaluation"]
    metrics = evaluation["metrics"]
    reg = evaluation["regressionsVsBaseline"]
    return [
        label,
        entry["evaluation"]["id"],
        fmt(metrics["mean"]),
        fmt(metrics["rmse"]),
        fmt(metrics["p95"]),
        fmt(metrics["p99"]),
        fmt(metrics["max"]),
        str(reg["worseOver1px"]),
        str(reg["worseOver5px"]),
        str(reg["improvedOver1px"]),
    ]


def render_markdown(result: dict[str, Any]) -> str:
    sections = []
    for fold in result["folds"]:
        selected_rows = [
            selected_row("baseline", fold["selected"]["baseline"]),
            selected_row("unguarded", fold["selected"]["unguarded"]),
            selected_row("strict", fold["selected"]["strict"]),
            selected_row("balanced", fold["selected"]["balanced"]),
        ]
        val_rows = []
        for objective in ["strict", "balanced"]:
            chosen = fold["selected"][objective]["validation"]
            metrics = chosen["validation"]["metrics"]
            reg = chosen["validation"]["regressionsVsBaseline"]
            val_rows.append([
                objective,
                chosen["id"],
                fmt(metrics["p95"]),
                fmt(metrics["p99"]),
                str(reg["worseOver1px"]),
                str(reg["worseOver5px"]),
                str(reg["improvedOver1px"]),
                fmt(chosen["scores"][objective], 2),
            ])
        sections.append(f"""## {fold['name']}

Train split: `{fold['train70Rows']}` train rows, `{fold['validationRows']}` validation rows. Eval: `{fold['evalRows']}` rows.

Model train sec: `{fmt(fold['model']['trainSec'])}`, estimated eval rows/sec: `{fmt(fold['model']['inferenceRowsPerSec'], 1)}`.

### Selected Evaluation

{md_table(["role", "candidate", "mean", "rmse", "p95", "p99", "max", ">1px reg", ">5px reg", ">1px improved"], selected_rows)}

### Selected On Validation

{md_table(["objective", "candidate", "p95", "p99", ">1px reg", ">5px reg", ">1px improved", "score"], val_rows)}
""")
    return f"""# Cursor Prediction v9 Phase 4 Guarded MLP

Generated: {result['generatedAt']}

Device: `{result['environment']['device']}`  
Torch: `{result['environment']['torchVersion']}`  
CUDA available: `{result['environment']['cudaAvailable']}`

The MLP teacher was trained on the first 70% of each train session, the guard
was selected on the trailing 30%, and the selected guard was evaluated on the
other session. No Calibrator run, dataset cache, checkpoint, or TensorBoard
artifact was written.

{"".join(sections)}
"""


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        value = float(value)
    if isinstance(value, float):
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        if math.isnan(value):
            return None
        return value
    return value


def failure_result(args: argparse.Namespace, started: float, error: Exception) -> dict[str, Any]:
    return {
        "schemaVersion": "cursor-prediction-v9-phase4-guarded-mlp/1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runtimeSec": time.perf_counter() - started,
        "status": "failed",
        "error": repr(error),
        "policy": {
            "inputTraces": p3.TRACE_FILES,
            "largeArtifactsWritten": False,
            "calibratorRun": False,
        },
    }


def main() -> None:
    args = parse_args()
    started = time.perf_counter()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    try:
        traces = [p3.load_trace(args.root, name, f"session-{i + 1}") for i, name in enumerate(p3.TRACE_FILES)]
        datasets = [p3.build_dataset(trace) for trace in traces]
        folds = [
            run_fold("train-session-1-eval-session-2", datasets[0], datasets[1], args.seed + 1, args.epochs, args.batch_size, device),
            run_fold("train-session-2-eval-session-1", datasets[1], datasets[0], args.seed + 1001, args.epochs, args.batch_size, device),
        ]
        if device.type == "cuda":
            torch.cuda.synchronize()
        result = {
            "schemaVersion": "cursor-prediction-v9-phase4-guarded-mlp/1",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "runtimeSec": time.perf_counter() - started,
            "status": "ok",
            "policy": {
                "inputTraces": p3.TRACE_FILES,
                "horizonsMs": p3.HORIZONS_MS,
                "sequenceLength": 16,
                "trainValidationSplit": "first 70% train, trailing 30% validation within train session",
                "target": "referencePoll position at anchor time + horizon",
                "predictionTarget": "guarded residual over product_constant_velocity_v8_shape",
                "causalInputsOnly": True,
                "largeArtifactsWritten": False,
                "calibratorRun": False,
            },
            "environment": {
                "python": ".".join(map(str, tuple(sys.version_info[:3]))),
                "torchVersion": torch.__version__,
                "cudaAvailable": torch.cuda.is_available(),
                "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
            },
            "datasets": [dataset.summary for dataset in datasets],
            "folds": folds,
        }
    except Exception as exc:
        result = failure_result(args, started, exc)
    args.out_json.write_text(json.dumps(json_safe(result), indent=2) + "\n", encoding="utf-8")
    args.out_md.write_text(render_markdown(result) if result.get("status") == "ok" else f"# Cursor Prediction v9 Phase 4 Guarded MLP\n\nFailed: `{result['error']}`\n", encoding="utf-8")
    print(f"Wrote {args.out_json}")
    print(f"Wrote {args.out_md}")
    print(f"Runtime seconds: {result['runtimeSec']:.3f}")
    if result.get("status") != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
