#!/usr/bin/env python3
"""Phase 7 max-safe confidence gates for Cursor Prediction v9.

This phase keeps the Phase 6 teacher/gate setup, adds residual clamps and
high-risk fallback variants, and selects gates with objectives that penalize
max outliers and large regressions. No checkpoints, caches, TensorBoard logs,
or expanded datasets are written.
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


def load_local_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


p3 = load_local_module("phase3_ml_teachers_for_phase7", SCRIPT_DIR / "phase3-ml-teachers.py")
p4 = load_local_module("phase4_guarded_mlp_for_phase7", SCRIPT_DIR / "phase4-guarded-mlp.py")
p5 = load_local_module("phase5_expanded_teachers_for_phase7", SCRIPT_DIR / "phase5-expanded-teachers.py")
p6 = load_local_module("phase6_confidence_gate_for_phase7", SCRIPT_DIR / "phase6-confidence-gate.py")


CLAMPS: list[float | None] = [None, 4.0, 8.0, 12.0, 16.0, 24.0]
TREE_RESIDUAL_THRESHOLDS = [4.0, 8.0, 12.0, 16.0, 24.0]
TREE_COS_THRESHOLDS = [0.25, 0.50, 0.75]
TREE_BASELINE_LIMITS = [4.0, 8.0]
TREE_EFFICIENCY_FLOORS = [0.0, 0.75, 0.90]
PROB_THRESHOLDS = [0.30, 0.50, 0.70, 0.80, 0.90, 0.95]
MARGINS = [0.0, 1.0, 3.0, 5.0]
FALLBACKS = [
    {"id": "all", "speedMaxPxPerSec": math.inf, "efficiencyMin": 0.0},
    {"id": "speed-lt-2000", "speedMaxPxPerSec": 2000.0, "efficiencyMin": 0.0},
    {"id": "speed-lt-1000", "speedMaxPxPerSec": 1000.0, "efficiencyMin": 0.0},
    {"id": "eff-ge-075", "speedMaxPxPerSec": math.inf, "efficiencyMin": 0.75},
    {"id": "speed-lt-2000-eff-ge-075", "speedMaxPxPerSec": 2000.0, "efficiencyMin": 0.75},
    {"id": "speed-lt-2000-eff-ge-09", "speedMaxPxPerSec": 2000.0, "efficiencyMin": 0.90},
]


def parse_args() -> argparse.Namespace:
    root = SCRIPT_DIR.parents[2]
    out_dir = SCRIPT_DIR.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-json", type=Path, default=out_dir / "phase-7-max-safe-gate.json")
    parser.add_argument("--out-md", type=Path, default=out_dir / "phase-7-max-safe-gate.md")
    parser.add_argument("--seed", type=int, default=20260507)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--max-epochs", type=int, default=20)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--cpu-sample-rows", type=int, default=8192)
    return parser.parse_args()


def clamp_residual(residual_px: np.ndarray, clamp_px: float | None) -> np.ndarray:
    if clamp_px is None:
        return residual_px.astype(np.float32)
    mag = np.linalg.norm(residual_px, axis=1)
    scale = np.minimum(1.0, clamp_px / np.maximum(mag, 1e-6))
    return (residual_px * scale[:, None]).astype(np.float32)


def fallback_mask(dataset: Any, spec: dict[str, Any]) -> np.ndarray:
    speed = dataset.ctx[:, 3].astype(np.float32) * 5000.0
    efficiency = dataset.ctx[:, 4].astype(np.float32)
    return (speed < spec["speedMaxPxPerSec"]) & (efficiency >= spec["efficiencyMin"])


def regression_counts_extended(errors: np.ndarray, baseline_errors: np.ndarray) -> dict[str, Any]:
    base = p3.regression_counts(errors, baseline_errors)
    delta = errors - baseline_errors
    base.update({
        "worseOver10px": int(np.sum(delta > 10.0)),
        "worseOver20px": int(np.sum(delta > 20.0)),
        "worseOver50px": int(np.sum(delta > 50.0)),
        "maxDeltaPx": float(delta.max()) if delta.size else None,
        "p99DeltaPx": float(np.percentile(delta, 99, method="linear")) if delta.size else None,
    })
    return base


def evaluate(dataset: Any, residual_px: np.ndarray) -> dict[str, Any]:
    errors = p5.metric_errors(dataset, residual_px)
    return {
        "metrics": p3.metric_stats(errors),
        "regressionsVsBaseline": regression_counts_extended(errors, dataset.baseline_error),
        "speedBins": p3.speed_breakdown(errors, dataset.speed_bins),
        "horizons": p4.horizon_breakdown(errors, dataset.horizons),
        "_errors": errors,
    }


def compact_eval(entry: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in entry.items() if key != "_errors"}


def aggregate(parts: list[dict[str, Any]], baseline_errors: list[np.ndarray]) -> dict[str, Any]:
    errors = np.concatenate([part["_errors"] for part in parts])
    baseline = np.concatenate(baseline_errors)
    return {
        "metrics": p3.metric_stats(errors),
        "regressionsVsBaseline": regression_counts_extended(errors, baseline),
    }


def objective(summary: dict[str, Any], baseline: dict[str, Any], mode: str) -> float:
    metrics = summary["metrics"]
    reg = summary["regressionsVsBaseline"]
    count = max(1, reg["count"])
    worse1 = reg["worseOver1px"] / count
    worse3 = reg["worseOver3px"] / count
    worse5 = reg["worseOver5px"] / count
    worse10 = reg["worseOver10px"] / count
    worse20 = reg["worseOver20px"] / count
    worse50 = reg["worseOver50px"] / count
    improved = reg["improvedOver1px"] / count
    p95 = metrics["p95"] or float("inf")
    p99 = metrics["p99"] or float("inf")
    mean = metrics["mean"] or float("inf")
    max_error = metrics["max"] or float("inf")
    base_p95 = baseline["metrics"]["p95"] or p95
    base_p99 = baseline["metrics"]["p99"] or p99
    base_max = baseline["metrics"]["max"] or max_error
    p95_gain = max(0.0, base_p95 - p95)
    p99_gain = max(0.0, base_p99 - p99)
    max_overshoot = max(0.0, max_error - base_max)
    if mode == "strict":
        return (
            p95 + 0.45 * p99 + 0.04 * max_error
            + 950.0 * worse1 + 1800.0 * worse3 + 3800.0 * worse5
            + 9000.0 * worse10 + 18000.0 * worse20 + 45000.0 * worse50
            + 4.0 * max_overshoot - 0.5 * p95_gain - 0.25 * p99_gain - 6.0 * improved
        )
    if mode == "max-safe":
        return (
            p95 + 0.40 * p99 + 0.16 * max_error
            + 260.0 * worse1 + 900.0 * worse3 + 2600.0 * worse5
            + 9000.0 * worse10 + 22000.0 * worse20 + 65000.0 * worse50
            + 8.0 * max_overshoot - 0.9 * p95_gain - 0.45 * p99_gain - 14.0 * improved
        )
    return (
        p95 + 0.45 * p99 + 0.04 * mean + 0.025 * max_error
        + 150.0 * worse1 + 460.0 * worse3 + 1250.0 * worse5
        + 4000.0 * worse10 + 9000.0 * worse20 + 26000.0 * worse50
        + 2.0 * max_overshoot - 1.0 * p95_gain - 0.5 * p99_gain - 42.0 * improved
    )


def apply_candidate(dataset: Any, residual_px: np.ndarray, base_mask: np.ndarray, fallback: dict[str, Any], clamp_px: float | None) -> tuple[np.ndarray, np.ndarray]:
    mask = base_mask & fallback_mask(dataset, fallback)
    return clamp_residual(np.where(mask[:, None], residual_px, 0.0), clamp_px), mask


def candidate_summary(
    candidate_id: str,
    gate_kind: str,
    val_dataset: Any,
    eval_dataset: Any,
    val_residual: np.ndarray,
    eval_residual: np.ndarray,
    val_mask: np.ndarray,
    eval_mask: np.ndarray,
    baseline_val: dict[str, Any],
    fallback: dict[str, Any],
    clamp_px: float | None,
    extra: dict[str, Any],
) -> dict[str, Any]:
    val_applied, val_final_mask = apply_candidate(val_dataset, val_residual, val_mask, fallback, clamp_px)
    eval_applied, eval_final_mask = apply_candidate(eval_dataset, eval_residual, eval_mask, fallback, clamp_px)
    val_eval = evaluate(val_dataset, val_applied)
    eval_eval = evaluate(eval_dataset, eval_applied)
    return {
        "id": candidate_id,
        "gateKind": gate_kind,
        "validation": val_eval,
        "evaluation": eval_eval,
        "scores": {
            "phase6Balanced": p6.objective(val_eval, baseline_val, "balanced"),
            "strict": objective(val_eval, baseline_val, "strict"),
            "balanced": objective(val_eval, baseline_val, "balanced"),
            "maxSafe": objective(val_eval, baseline_val, "max-safe"),
        },
        "applyRateValidation": float(val_final_mask.mean()),
        "applyRateEvaluation": float(eval_final_mask.mean()),
        "fallback": fallback,
        "clampPx": clamp_px,
        "extra": extra,
    }


def tree_masks(features: np.ndarray) -> list[tuple[str, np.ndarray, dict[str, Any]]]:
    residual = features[:, 0]
    cosine = features[:, 1]
    baseline_disp = features[:, 3]
    efficiency = features[:, 4]
    result = []
    for residual_max in TREE_RESIDUAL_THRESHOLDS:
        for cosine_min in TREE_COS_THRESHOLDS:
            for baseline_limit in TREE_BASELINE_LIMITS:
                for efficiency_min in TREE_EFFICIENCY_FLOORS:
                    mask = (
                        (residual <= residual_max)
                        & (cosine >= cosine_min)
                        & ((baseline_disp <= baseline_limit) | (efficiency >= efficiency_min))
                    )
                    params = {
                        "residualMaxPx": residual_max,
                        "cosineMin": cosine_min,
                        "baselineDispMaxPx": baseline_limit,
                        "efficiencyMin": efficiency_min,
                    }
                    gate_id = f"tree-r{int(residual_max)}-cos{str(cosine_min).replace('.', '')}-base{int(baseline_limit)}-or-eff{str(efficiency_min).replace('.', '')}"
                    result.append((gate_id, mask, params))
    return result


def add_candidate_variants(
    candidates: list[dict[str, Any]],
    teacher_id: str,
    base_id: str,
    gate_kind: str,
    val_dataset: Any,
    eval_dataset: Any,
    val_residual: np.ndarray,
    eval_residual: np.ndarray,
    val_mask: np.ndarray,
    eval_mask: np.ndarray,
    baseline_val: dict[str, Any],
    extra: dict[str, Any],
    phase6_equivalent: bool,
) -> None:
    fallbacks = [FALLBACKS[0]] if phase6_equivalent else FALLBACKS
    clamps = [None] if phase6_equivalent else CLAMPS
    for fallback in fallbacks:
        for clamp_px in clamps:
            suffix = "noclamp" if clamp_px is None else f"clamp{int(clamp_px)}"
            candidate_id = f"{teacher_id}__{gate_kind}__{base_id}__{fallback['id']}__{suffix}"
            candidates.append(candidate_summary(
                candidate_id,
                gate_kind,
                val_dataset,
                eval_dataset,
                val_residual,
                eval_residual,
                val_mask,
                eval_mask,
                baseline_val,
                fallback,
                clamp_px,
                {**extra, "phase6EquivalentEligible": phase6_equivalent},
            ))


def build_candidates(
    teacher_id: str,
    val_dataset: Any,
    eval_dataset: Any,
    val_residual: np.ndarray,
    eval_residual: np.ndarray,
    seed: int,
) -> dict[str, Any]:
    ab_val = p4.alpha_beta_correction(val_dataset)
    ab_eval = p4.alpha_beta_correction(eval_dataset)
    x_val_raw = p6.gate_features(val_dataset, val_residual, ab_val)
    x_eval_raw = p6.gate_features(eval_dataset, eval_residual, ab_eval)
    x_val, x_eval, norm = p6.normalize_features(x_val_raw, x_eval_raw)
    baseline_val = evaluate(val_dataset, np.zeros_like(val_dataset.baseline, dtype=np.float32))
    candidates: list[dict[str, Any]] = []

    for spec in p5.fixed_gate_specs():
        val_mask = p6.fixed_gate_mask(val_dataset, val_residual, ab_val, spec)
        eval_mask = p6.fixed_gate_mask(eval_dataset, eval_residual, ab_eval, spec)
        add_candidate_variants(
            candidates, teacher_id, f"fixed-{spec['id']}", "fixed-common",
            val_dataset, eval_dataset, val_residual, eval_residual, val_mask, eval_mask, baseline_val,
            {"spec": spec, "ops": {"estimatedOpsPerSample": 20}}, phase6_equivalent=True,
        )

    eval_trees = {gate_id: (mask, params) for gate_id, mask, params in tree_masks(x_eval_raw)}
    for gate_id, val_mask, params in tree_masks(x_val_raw):
        eval_mask, _ = eval_trees[gate_id]
        add_candidate_variants(
            candidates, teacher_id, gate_id, "threshold-tree",
            val_dataset, eval_dataset, val_residual, eval_residual, val_mask, eval_mask, baseline_val,
            {"params": params, "ops": {"estimatedOpsPerSample": 20}}, phase6_equivalent=True,
        )
        if params["residualMaxPx"] in {4.0, 8.0, 12.0, 16.0, 24.0} and params["cosineMin"] >= 0.5:
            add_candidate_variants(
                candidates, teacher_id, f"{gate_id}-maxsafe", "threshold-tree",
                val_dataset, eval_dataset, val_residual, eval_residual, val_mask, eval_mask, baseline_val,
                {"params": params, "ops": {"estimatedOpsPerSample": 20}}, phase6_equivalent=False,
            )

    for margin in MARGINS:
        y_val, _ = p6.gate_target(val_dataset, val_residual, margin)
        for kind in ["logistic", "tiny-mlp"]:
            probs_val, probs_eval, model_meta = p6.train_binary_gate(kind, x_val, y_val, x_eval, seed + int(margin * 100) + (0 if kind == "logistic" else 17))
            gate_kind = "logistic" if kind == "logistic" else "tiny-mlp"
            for threshold in PROB_THRESHOLDS:
                val_mask = probs_val >= threshold
                eval_mask = probs_eval >= threshold
                base_id = f"{gate_kind}-m{int(margin)}-p{str(threshold).replace('.', '')}"
                extra = {
                    "marginPx": margin,
                    "probabilityThreshold": threshold,
                    "model": model_meta,
                    "featureNormalization": norm,
                    "cpuEstimate": p6.gate_cpu_estimate({"gateKind": gate_kind, "extra": {"model": model_meta}}),
                }
                add_candidate_variants(
                    candidates, teacher_id, base_id, gate_kind,
                    val_dataset, eval_dataset, val_residual, eval_residual, val_mask, eval_mask, baseline_val,
                    extra, phase6_equivalent=True,
                )
                if threshold >= 0.70:
                    add_candidate_variants(
                        candidates, teacher_id, f"{base_id}-maxsafe", gate_kind,
                        val_dataset, eval_dataset, val_residual, eval_residual, val_mask, eval_mask, baseline_val,
                        extra, phase6_equivalent=False,
                    )

    phase6_candidates = [candidate for candidate in candidates if candidate["extra"].get("phase6EquivalentEligible")]
    return {
        "phase6Balanced": min(phase6_candidates, key=lambda item: item["scores"]["phase6Balanced"]),
        "strict": min(candidates, key=lambda item: item["scores"]["strict"]),
        "balanced": min(candidates, key=lambda item: item["scores"]["balanced"]),
        "maxSafe": min(candidates, key=lambda item: item["scores"]["maxSafe"]),
        "topMaxSafe": sorted(candidates, key=lambda item: item["scores"]["maxSafe"])[:10],
        "topBalanced": sorted(candidates, key=lambda item: item["scores"]["balanced"])[:10],
        "candidateCount": len(candidates),
    }


def train_teacher_fold(spec: dict[str, Any], train_full: Any, eval_dataset: Any, fold_name: str, seed: int, args: argparse.Namespace, device: torch.device) -> dict[str, Any]:
    train70, val30 = p4.split_dataset(train_full, 0.70)
    result = p5.train_torch_teacher(spec, train70, val30, eval_dataset, seed, args.max_epochs, args.patience, args.batch_size, device, args.cpu_sample_rows)
    baseline_val = evaluate(val30, np.zeros_like(val30.baseline, dtype=np.float32))
    baseline_eval = evaluate(eval_dataset, np.zeros_like(eval_dataset.baseline, dtype=np.float32))
    teacher_val = evaluate(val30, result["valPred"])
    teacher_eval = evaluate(eval_dataset, result["evalPred"])
    gates = build_candidates(spec["id"], val30, eval_dataset, result["valPred"], result["evalPred"], seed + 101)
    return {
        "fold": fold_name,
        "teacher": spec["id"],
        "spec": spec,
        "trainRows": int(train70.target.shape[0]),
        "validationRows": int(val30.target.shape[0]),
        "evalRows": int(eval_dataset.target.shape[0]),
        "meta": result["meta"],
        "baselineValidation": baseline_val,
        "baselineEvaluation": baseline_eval,
        "teacherValidation": teacher_val,
        "teacherEvaluation": teacher_eval,
        "selectedGates": {
            "phase6Balanced": gates["phase6Balanced"],
            "strict": gates["strict"],
            "balanced": gates["balanced"],
            "maxSafe": gates["maxSafe"],
        },
        "topValidationCandidates": {
            "balanced": gates["topBalanced"],
            "maxSafe": gates["topMaxSafe"],
        },
        "candidateCount": gates["candidateCount"],
    }


def aggregate_role(folds: list[dict[str, Any]], source: str, gate_role: str | None = None, split: str = "evaluation") -> dict[str, Any]:
    parts = []
    baselines = []
    for fold in folds:
        baseline_entry = fold[f"baseline{split.capitalize()}"]
        baselines.append(baseline_entry["_errors"])
        if source == "baseline":
            parts.append(baseline_entry)
        elif source == "teacher":
            parts.append(fold[f"teacher{split.capitalize()}"])
        else:
            parts.append(fold["selectedGates"][gate_role][split])
    return aggregate(parts, baselines)


def meta_summary(folds: list[dict[str, Any]]) -> dict[str, Any]:
    metas = [fold["meta"] for fold in folds]
    eval_rows = sum(fold["evalRows"] for fold in folds)
    eval_sec = sum(meta["evalInferenceSec"] for meta in metas)
    cpu_rows = [meta["simdEstimate"]["pyTorchCpuRowsPerSec"] for meta in metas if meta["simdEstimate"]["pyTorchCpuRowsPerSec"]]
    simd_low = [meta["simdEstimate"]["estimatedCSharpSimdRowsPerSecLow"] for meta in metas if meta["simdEstimate"]["estimatedCSharpSimdRowsPerSecLow"]]
    simd_high = [meta["simdEstimate"]["estimatedCSharpSimdRowsPerSecHigh"] for meta in metas if meta["simdEstimate"]["estimatedCSharpSimdRowsPerSecHigh"]]
    return {
        "params": int(np.mean([meta["paramCount"] for meta in metas])),
        "trainSecTotal": float(sum(meta["trainSec"] for meta in metas)),
        "gpuEvalRowsPerSec": float(eval_rows / eval_sec) if eval_sec > 0 else None,
        "cpuPyTorchRowsPerSecMean": float(np.mean(cpu_rows)) if cpu_rows else None,
        "csharpSimdRowsPerSecLowMean": float(np.mean(simd_low)) if simd_low else None,
        "csharpSimdRowsPerSecHighMean": float(np.mean(simd_high)) if simd_high else None,
        "epochsRun": [meta["epochsRun"] for meta in metas],
        "bestEpoch": [meta["bestEpoch"] for meta in metas],
    }


def compact_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    result = {
        key: value for key, value in candidate.items()
        if key not in {"validation", "evaluation"}
    }
    result["validation"] = compact_eval(candidate["validation"])
    result["evaluation"] = compact_eval(candidate["evaluation"])
    return result


def summarize_teacher(folds: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": folds[0]["teacher"],
        "spec": folds[0]["spec"],
        "meta": meta_summary(folds),
        "baselineValidationAggregate": aggregate_role(folds, "baseline", split="validation"),
        "baselineEvaluationAggregate": aggregate_role(folds, "baseline", split="evaluation"),
        "teacherAlone": {
            "validationAggregate": aggregate_role(folds, "teacher", split="validation"),
            "evaluationAggregate": aggregate_role(folds, "teacher", split="evaluation"),
        },
        "phase6EquivalentBalancedGate": {
            "validationAggregate": aggregate_role(folds, "gate", "phase6Balanced", "validation"),
            "evaluationAggregate": aggregate_role(folds, "gate", "phase6Balanced", "evaluation"),
            "selectedByFold": [fold["selectedGates"]["phase6Balanced"]["id"] for fold in folds],
        },
        "learnedStrictGate": {
            "validationAggregate": aggregate_role(folds, "gate", "strict", "validation"),
            "evaluationAggregate": aggregate_role(folds, "gate", "strict", "evaluation"),
            "selectedByFold": [fold["selectedGates"]["strict"]["id"] for fold in folds],
        },
        "learnedBalancedGate": {
            "validationAggregate": aggregate_role(folds, "gate", "balanced", "validation"),
            "evaluationAggregate": aggregate_role(folds, "gate", "balanced", "evaluation"),
            "selectedByFold": [fold["selectedGates"]["balanced"]["id"] for fold in folds],
        },
        "maxSafeGate": {
            "validationAggregate": aggregate_role(folds, "gate", "maxSafe", "validation"),
            "evaluationAggregate": aggregate_role(folds, "gate", "maxSafe", "evaluation"),
            "selectedByFold": [fold["selectedGates"]["maxSafe"]["id"] for fold in folds],
        },
        "folds": [
            {
                "fold": fold["fold"],
                "teacher": fold["teacher"],
                "trainRows": fold["trainRows"],
                "validationRows": fold["validationRows"],
                "evalRows": fold["evalRows"],
                "meta": fold["meta"],
                "baselineEvaluation": compact_eval(fold["baselineEvaluation"]),
                "teacherEvaluation": compact_eval(fold["teacherEvaluation"]),
                "selectedGates": {
                    role: compact_candidate(candidate)
                    for role, candidate in fold["selectedGates"].items()
                },
                "topValidationCandidates": {
                    key: [compact_candidate(candidate) for candidate in candidates]
                    for key, candidates in fold["topValidationCandidates"].items()
                },
                "candidateCount": fold["candidateCount"],
            }
            for fold in folds
        ],
    }


def strip_private(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): strip_private(v) for k, v in value.items() if not str(k).startswith("_")}
    if isinstance(value, list):
        return [strip_private(v) for v in value]
    if isinstance(value, tuple):
        return [strip_private(v) for v in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        value = float(value)
    if isinstance(value, float):
        if math.isnan(value):
            return None
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        return value
    return value


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


def metric_row(role: str, candidate_id: str, aggregate_entry: dict[str, Any]) -> list[str]:
    metrics = aggregate_entry["metrics"]
    reg = aggregate_entry["regressionsVsBaseline"]
    return [
        role, candidate_id, fmt(metrics["mean"]), fmt(metrics["rmse"]), fmt(metrics["p95"]),
        fmt(metrics["p99"]), fmt(metrics["max"]), str(reg["worseOver1px"]),
        str(reg["worseOver3px"]), str(reg["worseOver5px"]), str(reg["worseOver10px"]),
        str(reg["worseOver20px"]), str(reg["worseOver50px"]), str(reg["improvedOver1px"]),
    ]


def render_markdown(result: dict[str, Any]) -> str:
    phase = result["phase"]
    best_teacher = phase["bestTeacherAlone"]
    best_phase6 = phase["bestPhase6EquivalentBalancedGate"]
    best_strict = phase["bestLearnedStrictGate"]
    best_balanced = phase["bestLearnedBalancedGate"]
    best_maxsafe = phase["bestMaxSafeGate"]
    baseline = best_teacher["baselineEvaluationAggregate"]
    headline_rows = [
        metric_row("baseline", "product-baseline", baseline),
        metric_row("teacher alone", best_teacher["id"], best_teacher["teacherAlone"]["evaluationAggregate"]),
        metric_row("phase6-equivalent", best_phase6["id"], best_phase6["phase6EquivalentBalancedGate"]["evaluationAggregate"]),
        metric_row("strict", best_strict["id"], best_strict["learnedStrictGate"]["evaluationAggregate"]),
        metric_row("balanced", best_balanced["id"], best_balanced["learnedBalancedGate"]["evaluationAggregate"]),
        metric_row("max-safe", best_maxsafe["id"], best_maxsafe["maxSafeGate"]["evaluationAggregate"]),
    ]
    teacher_rows = []
    for entry in phase["teacherSummaries"]:
        meta = entry["meta"]
        teacher_rows.append([
            entry["id"],
            fmt(entry["teacherAlone"]["evaluationAggregate"]["metrics"]["p95"]),
            str(entry["teacherAlone"]["evaluationAggregate"]["regressionsVsBaseline"]["worseOver20px"]),
            fmt(entry["phase6EquivalentBalancedGate"]["evaluationAggregate"]["p95"] if False else entry["phase6EquivalentBalancedGate"]["evaluationAggregate"]["metrics"]["p95"]),
            str(entry["phase6EquivalentBalancedGate"]["evaluationAggregate"]["regressionsVsBaseline"]["worseOver20px"]),
            fmt(entry["learnedBalancedGate"]["evaluationAggregate"]["metrics"]["p95"]),
            str(entry["learnedBalancedGate"]["evaluationAggregate"]["regressionsVsBaseline"]["worseOver20px"]),
            fmt(entry["maxSafeGate"]["evaluationAggregate"]["metrics"]["p95"]),
            str(entry["maxSafeGate"]["evaluationAggregate"]["regressionsVsBaseline"]["worseOver20px"]),
            str(meta["params"]),
            fmt(meta["gpuEvalRowsPerSec"], 1),
            fmt(meta["cpuPyTorchRowsPerSecMean"], 1),
        ])
    gate_rows = []
    for role, entry, key in [
        ("phase6", best_phase6, "phase6EquivalentBalancedGate"),
        ("strict", best_strict, "learnedStrictGate"),
        ("balanced", best_balanced, "learnedBalancedGate"),
        ("max-safe", best_maxsafe, "maxSafeGate"),
    ]:
        gate_rows.append([
            role,
            entry["id"],
            " / ".join(entry[key]["selectedByFold"]),
            fmt(entry[key]["evaluationAggregate"]["metrics"]["p95"]),
            fmt(entry[key]["evaluationAggregate"]["metrics"]["max"]),
            str(entry[key]["evaluationAggregate"]["regressionsVsBaseline"]["worseOver20px"]),
            str(entry[key]["evaluationAggregate"]["regressionsVsBaseline"]["worseOver50px"]),
        ])
    best_meta = best_maxsafe["meta"]
    return f"""# Cursor Prediction v9 Phase 7 Max-Safe Gate

Generated: {result['generatedAt']}

Device: `{result['environment']['device']}`  
Torch: `{result['environment']['torchVersion']}`  
CUDA available: `{result['environment']['cudaAvailable']}`

This phase adds max-safe objectives, residual clamp variants, and high-speed /
low-efficiency fallback variants. No Calibrator run, checkpoint, cache,
TensorBoard, or large dataset artifact was written.

## Headline Evaluation

{md_table(["role", "candidate", "mean", "rmse", "p95", "p99", "max", ">1", ">3", ">5", ">10", ">20", ">50", "improved"], headline_rows)}

## Teacher Summary

{md_table(["teacher", "alone p95", "alone >20", "phase6 p95", "phase6 >20", "balanced p95", "balanced >20", "maxsafe p95", "maxsafe >20", "params", "GPU rows/s", "CPU rows/s"], teacher_rows)}

## Selected Gates

{md_table(["role", "teacher", "selected gates by fold", "p95", "max", ">20", ">50"], gate_rows)}

Best max-safe runtime candidate: `{best_maxsafe['id']}` params `{best_meta['params']}`,
GPU `{fmt(best_meta['gpuEvalRowsPerSec'], 1)}` rows/sec, PyTorch CPU
`{fmt(best_meta['cpuPyTorchRowsPerSecMean'], 1)}` rows/sec, C# SIMD teacher
estimate `{fmt(best_meta['csharpSimdRowsPerSecLowMean'], 1)}` to
`{fmt(best_meta['csharpSimdRowsPerSecHighMean'], 1)}` rows/sec. Gate overhead is
threshold-tree/logistic/tiny-MLP scale: roughly 20 to 76 scalar ops per sample
plus an optional residual clamp.
"""


def failure_result(started: float, error: Exception) -> dict[str, Any]:
    return {
        "schemaVersion": "cursor-prediction-v9-phase7-max-safe-gate/1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runtimeSec": time.perf_counter() - started,
        "status": "failed",
        "error": repr(error),
        "policy": {"inputTraces": p3.TRACE_FILES, "largeArtifactsWritten": False, "calibratorRun": False},
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
        datasets = [p3.build_dataset(trace, seq_len=32) for trace in traces]
        summaries = []
        failures: list[dict[str, Any]] = []
        for teacher_index, spec in enumerate(p6.teacher_specs()):
            folds = []
            fold_defs = [
                ("train-session-1-eval-session-2", datasets[0], datasets[1], args.seed + teacher_index * 1000 + 1),
                ("train-session-2-eval-session-1", datasets[1], datasets[0], args.seed + teacher_index * 1000 + 501),
            ]
            for fold_name, train_dataset, eval_dataset, seed in fold_defs:
                try:
                    folds.append(train_teacher_fold(spec, train_dataset, eval_dataset, fold_name, seed, args, device))
                except Exception as exc:
                    failures.append({"teacher": spec["id"], "fold": fold_name, "error": repr(exc)})
            if len(folds) == 2:
                summaries.append(summarize_teacher(folds))
        if not summaries:
            raise RuntimeError("No teacher completed both folds")
        best_teacher = min(summaries, key=lambda entry: (
            entry["teacherAlone"]["evaluationAggregate"]["metrics"]["p95"] or float("inf"),
            entry["teacherAlone"]["evaluationAggregate"]["metrics"]["p99"] or float("inf"),
        ))
        best_phase6 = min(summaries, key=lambda entry: objective(entry["phase6EquivalentBalancedGate"]["validationAggregate"], entry["baselineValidationAggregate"], "balanced"))
        best_strict = min(summaries, key=lambda entry: objective(entry["learnedStrictGate"]["validationAggregate"], entry["baselineValidationAggregate"], "strict"))
        best_balanced = min(summaries, key=lambda entry: objective(entry["learnedBalancedGate"]["validationAggregate"], entry["baselineValidationAggregate"], "balanced"))
        best_maxsafe = min(summaries, key=lambda entry: objective(entry["maxSafeGate"]["validationAggregate"], entry["baselineValidationAggregate"], "max-safe"))
        if device.type == "cuda":
            torch.cuda.synchronize()
        result = {
            "schemaVersion": "cursor-prediction-v9-phase7-max-safe-gate/1",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "runtimeSec": time.perf_counter() - started,
            "status": "ok",
            "policy": {
                "inputTraces": p3.TRACE_FILES,
                "horizonsMs": p3.HORIZONS_MS,
                "sequenceLength": 32,
                "trainValidationSplit": "first 70% train, trailing 30% gate train/select",
                "target": "referencePoll position at anchor time + horizon",
                "gateTargets": "teacher_error < baseline_error - margin plus max-safe objectives",
                "residualClampCandidatesPx": CLAMPS,
                "causalInputsOnly": True,
                "largeArtifactsWritten": False,
                "calibratorRun": False,
            },
            "environment": {
                "python": ".".join(map(str, tuple(sys.version_info[:3]))),
                "torchVersion": torch.__version__,
                "cudaAvailable": torch.cuda.is_available(),
                "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
                "torchCpuThreads": torch.get_num_threads(),
            },
            "datasets": [dataset.summary for dataset in datasets],
            "teacherSpecs": p6.teacher_specs(),
            "failures": failures,
            "phase": {
                "teacherSummaries": summaries,
                "bestTeacherAlone": best_teacher,
                "bestPhase6EquivalentBalancedGate": best_phase6,
                "bestLearnedStrictGate": best_strict,
                "bestLearnedBalancedGate": best_balanced,
                "bestMaxSafeGate": best_maxsafe,
            },
        }
    except Exception as exc:
        result = failure_result(started, exc)
    args.out_json.write_text(json.dumps(strip_private(result), indent=2) + "\n", encoding="utf-8")
    args.out_md.write_text(
        render_markdown(result) if result.get("status") == "ok" else f"# Cursor Prediction v9 Phase 7 Max-Safe Gate\n\nFailed: `{result['error']}`\n",
        encoding="utf-8",
    )
    print(f"Wrote {args.out_json}")
    print(f"Wrote {args.out_md}")
    print(f"Runtime seconds: {result['runtimeSec']:.3f}")
    if result.get("status") != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
