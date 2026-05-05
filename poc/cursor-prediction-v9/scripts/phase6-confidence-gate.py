#!/usr/bin/env python3
"""Phase 6 learned confidence gates for Cursor Prediction v9.

Teacher models are trained on each train session's first 70%; confidence gates
are trained and selected on the trailing 30%; selected gates are evaluated on
the other session. All datasets, predictions, and gate weights stay in memory.
Only compact JSON/Markdown summaries are written.
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
import torch.nn as nn


SCRIPT_DIR = Path(__file__).resolve().parent


def load_local_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


p3 = load_local_module("phase3_ml_teachers_for_phase6", SCRIPT_DIR / "phase3-ml-teachers.py")
p4 = load_local_module("phase4_guarded_mlp_for_phase6", SCRIPT_DIR / "phase4-guarded-mlp.py")
p5 = load_local_module("phase5_expanded_teachers_for_phase6", SCRIPT_DIR / "phase5-expanded-teachers.py")


TEACHER_IDS = ["mlp_seq32_h256_128_64", "fsmn_seq32_c64", "tcn_seq32_c64"]
MARGINS = [0.0, 1.0, 3.0, 5.0]
PROB_THRESHOLDS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70, 0.80, 0.90]
RESIDUAL_THRESHOLDS = [4.0, 8.0, 12.0, 16.0, 20.0, 24.0, 32.0]
COS_THRESHOLDS = [-0.25, 0.0, 0.25, 0.50, 0.75]
BASELINE_DISP_LIMITS = [4.0, 8.0, 12.0, float("inf")]
EFFICIENCY_FLOORS = [0.0, 0.75, 0.90]
FEATURE_NAMES = [
    "residualMagnitudePx",
    "alphaBetaAgreementCosine",
    "alphaBetaCorrectionMagnitudePx",
    "baselineDisplacementMagnitudePx",
    "pathEfficiency",
    "normalizedSpeed",
    "horizonMs",
]


def parse_args() -> argparse.Namespace:
    root = SCRIPT_DIR.parents[2]
    out_dir = SCRIPT_DIR.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-json", type=Path, default=out_dir / "phase-6-confidence-gate.json")
    parser.add_argument("--out-md", type=Path, default=out_dir / "phase-6-confidence-gate.md")
    parser.add_argument("--seed", type=int, default=20260506)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--max-epochs", type=int, default=20)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--cpu-sample-rows", type=int, default=8192)
    return parser.parse_args()


class LogisticGate(nn.Module):
    def __init__(self, input_dim: int):
        super().__init__()
        self.net = nn.Linear(input_dim, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


class TinyGateMLP(nn.Module):
    def __init__(self, input_dim: int, hidden: int = 8):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(input_dim, hidden), nn.ReLU(), nn.Linear(hidden, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


def teacher_specs() -> list[dict[str, Any]]:
    by_id = {spec["id"]: spec for spec in p5.TEACHERS}
    return [by_id[teacher_id] for teacher_id in TEACHER_IDS]


def split_dataset(dataset: Any) -> tuple[Any, Any]:
    return p4.split_dataset(dataset, 0.70)


def evaluate(dataset: Any, residual_px: np.ndarray) -> dict[str, Any]:
    errors = p5.metric_errors(dataset, residual_px)
    return {
        "metrics": p3.metric_stats(errors),
        "regressionsVsBaseline": p3.regression_counts(errors, dataset.baseline_error),
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
        "regressionsVsBaseline": p3.regression_counts(errors, baseline),
    }


def gate_features(dataset: Any, residual_px: np.ndarray, ab_corr: np.ndarray) -> np.ndarray:
    residual_mag = np.linalg.norm(residual_px, axis=1)
    ab_mag = np.linalg.norm(ab_corr, axis=1)
    dot = np.sum(residual_px * ab_corr, axis=1)
    cosine = dot / np.maximum(residual_mag * ab_mag, 1e-6)
    cosine = np.clip(cosine, -1.0, 1.0)
    cosine[(residual_mag < 1e-4) | (ab_mag < 0.5)] = -1.0
    baseline_disp = dataset.ctx[:, 8].astype(np.float32) * 24.0
    efficiency = np.clip(dataset.ctx[:, 4].astype(np.float32), 0.0, 1.0)
    speed_norm = dataset.ctx[:, 3].astype(np.float32)
    horizon_ms = dataset.horizons.astype(np.float32)
    return np.stack([
        residual_mag,
        cosine,
        ab_mag,
        baseline_disp,
        efficiency,
        speed_norm,
        horizon_ms,
    ], axis=1).astype(np.float32)


def normalize_features(train: np.ndarray, other: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    mean = train.mean(axis=0, keepdims=True)
    std = train.std(axis=0, keepdims=True)
    std[std < 1e-6] = 1.0
    return (train - mean).astype(np.float32) / std.astype(np.float32), (other - mean).astype(np.float32) / std.astype(np.float32), {
        "featureNames": FEATURE_NAMES,
        "mean": mean.reshape(-1).astype(float).tolist(),
        "std": std.reshape(-1).astype(float).tolist(),
    }


def gate_target(dataset: Any, residual_px: np.ndarray, margin: float) -> tuple[np.ndarray, np.ndarray]:
    errors = p5.metric_errors(dataset, residual_px)
    target = errors < (dataset.baseline_error - margin)
    return target.astype(np.float32), errors


def objective(summary: dict[str, Any], baseline: dict[str, Any], mode: str) -> float:
    metrics = summary["metrics"]
    reg = summary["regressionsVsBaseline"]
    count = max(1, reg["count"])
    worse1_rate = reg["worseOver1px"] / count
    worse5_rate = reg["worseOver5px"] / count
    improved_rate = reg["improvedOver1px"] / count
    p95 = metrics["p95"] or float("inf")
    p99 = metrics["p99"] or float("inf")
    mean = metrics["mean"] or float("inf")
    base_p95 = baseline["metrics"]["p95"] or p95
    p95_gain = max(0.0, base_p95 - p95)
    if mode == "strict":
        return p95 + 0.4 * p99 + 3400.0 * worse5_rate + 850.0 * worse1_rate - 0.5 * p95_gain - 8.0 * improved_rate
    return p95 + 0.45 * p99 + 0.05 * mean + 1050.0 * worse5_rate + 140.0 * worse1_rate - 48.0 * improved_rate


def apply_mask(residual_px: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return np.where(mask[:, None], residual_px, 0.0).astype(np.float32)


def train_binary_gate(kind: str, x_train: np.ndarray, y_train: np.ndarray, x_eval: np.ndarray, seed: int) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    torch.manual_seed(seed)
    np.random.seed(seed)
    input_dim = x_train.shape[1]
    model: nn.Module = LogisticGate(input_dim) if kind == "logistic" else TinyGateMLP(input_dim)
    x_t = torch.from_numpy(x_train.astype(np.float32))
    y_t = torch.from_numpy(y_train.astype(np.float32))
    positives = float(y_train.sum())
    negatives = float(y_train.shape[0] - positives)
    pos_weight_value = min(20.0, max(1.0, negatives / max(1.0, positives)))
    pos_weight = torch.tensor(pos_weight_value, dtype=torch.float32)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    opt = torch.optim.AdamW(model.parameters(), lr=0.03 if kind == "logistic" else 0.015, weight_decay=1e-4)
    started = time.perf_counter()
    losses: list[float] = []
    for _ in range(80 if kind == "logistic" else 120):
        opt.zero_grad(set_to_none=True)
        logits = model(x_t)
        loss = loss_fn(logits, y_t)
        loss.backward()
        opt.step()
        losses.append(float(loss.detach()))
    train_sec = time.perf_counter() - started
    with torch.no_grad():
        val_prob = torch.sigmoid(model(x_t)).numpy().astype(np.float32)
        eval_prob = torch.sigmoid(model(torch.from_numpy(x_eval.astype(np.float32)))).numpy().astype(np.float32)
    params = sum(param.numel() for param in model.parameters())
    ops = input_dim + 4 if kind == "logistic" else input_dim * 8 + 8 + 8 + 4
    return val_prob, eval_prob, {
        "kind": kind,
        "params": int(params),
        "estimatedOpsPerSample": int(ops),
        "trainSec": train_sec,
        "positiveRate": float(y_train.mean()),
        "posWeight": pos_weight_value,
        "lossStart": losses[0],
        "lossEnd": losses[-1],
    }


def fixed_gate_mask(dataset: Any, residual_px: np.ndarray, ab_corr: np.ndarray, spec: dict[str, Any]) -> np.ndarray:
    gated = p5.apply_fixed_gate(dataset, residual_px, ab_corr, spec)
    return np.linalg.norm(gated, axis=1) > 0.0


def threshold_tree_masks(features: np.ndarray) -> list[tuple[str, np.ndarray, dict[str, Any]]]:
    residual = features[:, 0]
    cosine = features[:, 1]
    baseline_disp = features[:, 3]
    efficiency = features[:, 4]
    result = []
    for residual_max in RESIDUAL_THRESHOLDS:
        for cosine_min in COS_THRESHOLDS:
            for baseline_limit in BASELINE_DISP_LIMITS:
                for efficiency_min in EFFICIENCY_FLOORS:
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
                    label_base = "inf" if math.isinf(baseline_limit) else str(int(baseline_limit))
                    gate_id = f"tree-r{int(residual_max)}-cos{str(cosine_min).replace('.', '')}-base{label_base}-or-eff{str(efficiency_min).replace('.', '')}"
                    result.append((gate_id, mask, params))
    return result


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
    extra: dict[str, Any],
) -> dict[str, Any]:
    val_eval = evaluate(val_dataset, apply_mask(val_residual, val_mask))
    eval_eval = evaluate(eval_dataset, apply_mask(eval_residual, eval_mask))
    return {
        "id": candidate_id,
        "gateKind": gate_kind,
        "validation": val_eval,
        "evaluation": eval_eval,
        "validationScoreStrict": objective(val_eval, baseline_val, "strict"),
        "validationScoreBalanced": objective(val_eval, baseline_val, "balanced"),
        "applyRateValidation": float(val_mask.mean()),
        "applyRateEvaluation": float(eval_mask.mean()),
        "extra": extra,
    }


def select(candidates: list[dict[str, Any]], mode: str) -> dict[str, Any]:
    key = "validationScoreStrict" if mode == "strict" else "validationScoreBalanced"
    return min(candidates, key=lambda candidate: candidate[key])


def gate_cpu_estimate(gate: dict[str, Any]) -> dict[str, Any]:
    kind = gate["gateKind"]
    if kind == "logistic":
        ops = gate["extra"]["model"]["estimatedOpsPerSample"]
        return {"estimatedOpsPerSample": ops, "estimatedCSharpRowsPerSecLow": 8_000_000.0, "estimatedCSharpRowsPerSecHigh": 25_000_000.0}
    if kind == "tiny-mlp":
        ops = gate["extra"]["model"]["estimatedOpsPerSample"]
        return {"estimatedOpsPerSample": ops, "estimatedCSharpRowsPerSecLow": 3_000_000.0, "estimatedCSharpRowsPerSecHigh": 12_000_000.0}
    return {"estimatedOpsPerSample": 20, "estimatedCSharpRowsPerSecLow": 20_000_000.0, "estimatedCSharpRowsPerSecHigh": 80_000_000.0}


def build_gate_candidates(
    teacher_id: str,
    val_dataset: Any,
    eval_dataset: Any,
    val_residual: np.ndarray,
    eval_residual: np.ndarray,
    seed: int,
) -> dict[str, Any]:
    ab_val = p4.alpha_beta_correction(val_dataset)
    ab_eval = p4.alpha_beta_correction(eval_dataset)
    x_val_raw = gate_features(val_dataset, val_residual, ab_val)
    x_eval_raw = gate_features(eval_dataset, eval_residual, ab_eval)
    x_val, x_eval, norm = normalize_features(x_val_raw, x_eval_raw)
    baseline_val = evaluate(val_dataset, np.zeros_like(val_dataset.baseline, dtype=np.float32))
    candidates: list[dict[str, Any]] = []
    for spec in p5.fixed_gate_specs():
        val_mask = fixed_gate_mask(val_dataset, val_residual, ab_val, spec)
        eval_mask = fixed_gate_mask(eval_dataset, eval_residual, ab_eval, spec)
        candidates.append(candidate_summary(
            f"{teacher_id}__fixed__{spec['id']}",
            "fixed-common",
            val_dataset,
            eval_dataset,
            val_residual,
            eval_residual,
            val_mask,
            eval_mask,
            baseline_val,
            {"spec": spec, "ops": {"estimatedOpsPerSample": 20}},
        ))
    eval_tree_masks = {gate_id: mask for gate_id, mask, _ in threshold_tree_masks(x_eval_raw)}
    for gate_id, val_mask, params in threshold_tree_masks(x_val_raw):
        candidates.append(candidate_summary(
            f"{teacher_id}__tree__{gate_id}",
            "threshold-tree",
            val_dataset,
            eval_dataset,
            val_residual,
            eval_residual,
            val_mask,
            eval_tree_masks[gate_id],
            baseline_val,
            {"params": params, "ops": {"estimatedOpsPerSample": 20}},
        ))
    for margin in MARGINS:
        y_val, _ = gate_target(val_dataset, val_residual, margin)
        for kind in ["logistic", "tiny-mlp"]:
            probs_val, probs_eval, model_meta = train_binary_gate(kind, x_val, y_val, x_eval, seed + int(margin * 100) + (0 if kind == "logistic" else 17))
            gate_kind = "logistic" if kind == "logistic" else "tiny-mlp"
            for threshold in PROB_THRESHOLDS:
                val_mask = probs_val >= threshold
                eval_mask = probs_eval >= threshold
                candidates.append(candidate_summary(
                    f"{teacher_id}__{gate_kind}__m{int(margin)}__p{str(threshold).replace('.', '')}",
                    gate_kind,
                    val_dataset,
                    eval_dataset,
                    val_residual,
                    eval_residual,
                    val_mask,
                    eval_mask,
                    baseline_val,
                    {
                        "marginPx": margin,
                        "probabilityThreshold": threshold,
                        "model": model_meta,
                        "featureNormalization": norm,
                        "cpuEstimate": gate_cpu_estimate({"gateKind": gate_kind, "extra": {"model": model_meta}}),
                    },
                ))
    strict = select(candidates, "strict")
    balanced = select(candidates, "balanced")
    fixed_candidates = [candidate for candidate in candidates if candidate["gateKind"] == "fixed-common"]
    fixed_balanced = select(fixed_candidates, "balanced")
    return {
        "strict": strict,
        "balanced": balanced,
        "fixedBalanced": fixed_balanced,
        "topStrict": sorted(candidates, key=lambda candidate: candidate["validationScoreStrict"])[:10],
        "topBalanced": sorted(candidates, key=lambda candidate: candidate["validationScoreBalanced"])[:10],
        "candidateCount": len(candidates),
        "featureNames": FEATURE_NAMES,
    }


def train_teacher_fold(spec: dict[str, Any], train_full: Any, eval_dataset: Any, fold_name: str, seed: int, args: argparse.Namespace, device: torch.device) -> dict[str, Any]:
    train70, val30 = split_dataset(train_full)
    result = p5.train_torch_teacher(spec, train70, val30, eval_dataset, seed, args.max_epochs, args.patience, args.batch_size, device, args.cpu_sample_rows)
    baseline_val = evaluate(val30, np.zeros_like(val30.baseline, dtype=np.float32))
    baseline_eval = evaluate(eval_dataset, np.zeros_like(eval_dataset.baseline, dtype=np.float32))
    teacher_val = evaluate(val30, result["valPred"])
    teacher_eval = evaluate(eval_dataset, result["evalPred"])
    gates = build_gate_candidates(spec["id"], val30, eval_dataset, result["valPred"], result["evalPred"], seed + 101)
    return {
        "fold": fold_name,
        "teacher": spec["id"],
        "spec": spec,
        "trainRows": int(train70.target.shape[0]),
        "validationRows": int(val30.target.shape[0]),
        "evalRows": int(eval_dataset.target.shape[0]),
        "meta": result["meta"],
        "baselineValidation": compact_eval(baseline_val),
        "baselineEvaluation": compact_eval(baseline_eval),
        "teacherValidation": compact_eval(teacher_val),
        "teacherEvaluation": compact_eval(teacher_eval),
        "selectedGates": {
            "strict": gates["strict"],
            "balanced": gates["balanced"],
            "fixedBalanced": gates["fixedBalanced"],
        },
        "topValidationCandidates": {
            "strict": gates["topStrict"],
            "balanced": gates["topBalanced"],
        },
        "candidateCount": gates["candidateCount"],
        "_baselineValidationErrors": baseline_val["_errors"],
        "_baselineEvaluationErrors": baseline_eval["_errors"],
        "_teacherValidationErrors": teacher_val["_errors"],
        "_teacherEvaluationErrors": teacher_eval["_errors"],
    }


def aggregate_role(folds: list[dict[str, Any]], source: str, gate_role: str | None = None, split: str = "evaluation") -> dict[str, Any]:
    parts = []
    baselines = []
    for fold in folds:
        baselines.append(fold[f"_baseline{split.capitalize()}Errors"])
        if source == "baseline":
            parts.append({
                "_errors": fold[f"_baseline{split.capitalize()}Errors"],
                **fold[f"baseline{split.capitalize()}"],
            })
        elif source == "teacher":
            parts.append({
                "_errors": fold[f"_teacher{split.capitalize()}Errors"],
                **fold[f"teacher{split.capitalize()}"],
            })
        else:
            gate = fold["selectedGates"][gate_role]
            parts.append(gate[split])
    if source in {"baseline", "teacher"}:
        return aggregate(parts, baselines)
    return aggregate(parts, baselines)


def weighted_metric_aggregate(entries: list[dict[str, Any]]) -> dict[str, Any]:
    total = sum(entry["metrics"]["count"] for entry in entries)
    total = max(1, total)
    mean = sum(entry["metrics"]["mean"] * entry["metrics"]["count"] for entry in entries) / total
    rmse = math.sqrt(sum((entry["metrics"]["rmse"] ** 2) * entry["metrics"]["count"] for entry in entries) / total)
    regress_keys = ["count", "worseOver1px", "worseOver3px", "worseOver5px", "improvedOver1px"]
    regress = {key: int(sum(entry["regressionsVsBaseline"][key] for entry in entries)) for key in regress_keys}
    regress["meanDeltaPx"] = sum(entry["regressionsVsBaseline"]["meanDeltaPx"] * entry["metrics"]["count"] for entry in entries) / total
    # Exact global percentiles are not retained for selected compact gate entries;
    # weighted fold-average percentiles are reported and labelled as aggregate.
    metrics = {
        "count": int(total),
        "mean": mean,
        "rmse": rmse,
        "p50": sum(entry["metrics"]["p50"] * entry["metrics"]["count"] for entry in entries) / total,
        "p90": sum(entry["metrics"]["p90"] * entry["metrics"]["count"] for entry in entries) / total,
        "p95": sum(entry["metrics"]["p95"] * entry["metrics"]["count"] for entry in entries) / total,
        "p99": sum(entry["metrics"]["p99"] * entry["metrics"]["count"] for entry in entries) / total,
        "max": max(entry["metrics"]["max"] for entry in entries),
        "percentileAggregation": "weighted fold average",
    }
    return {"metrics": metrics, "regressionsVsBaseline": regress}


def choose_best_aggregate(entries: list[dict[str, Any]], role: str, mode: str) -> dict[str, Any]:
    return min(entries, key=lambda entry: objective(entry[role]["validationAggregate"], entry["baselineValidationAggregate"], mode))


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


def summarize_teacher(folds: list[dict[str, Any]]) -> dict[str, Any]:
    baseline_validation = aggregate_role(folds, "baseline", split="validation")
    baseline_evaluation = aggregate_role(folds, "baseline", split="evaluation")
    summary = {
        "id": folds[0]["teacher"],
        "spec": folds[0]["spec"],
        "meta": meta_summary(folds),
        "baselineValidationAggregate": baseline_validation,
        "baselineEvaluationAggregate": baseline_evaluation,
        "teacherAlone": {
            "validationAggregate": aggregate_role(folds, "teacher", split="validation"),
            "evaluationAggregate": aggregate_role(folds, "teacher", split="evaluation"),
        },
        "fixedBalancedGate": {
            "validationAggregate": aggregate_role(folds, "gate", "fixedBalanced", "validation"),
            "evaluationAggregate": aggregate_role(folds, "gate", "fixedBalanced", "evaluation"),
            "selectedByFold": [fold["selectedGates"]["fixedBalanced"]["id"] for fold in folds],
        },
        "learnedStrictGate": {
            "validationAggregate": aggregate_role(folds, "gate", "strict", "validation"),
            "evaluationAggregate": aggregate_role(folds, "gate", "strict", "evaluation"),
            "selectedByFold": [fold["selectedGates"]["strict"]["id"] for fold in folds],
            "gateCpuEstimateByFold": [gate_cpu_estimate(fold["selectedGates"]["strict"]) for fold in folds],
        },
        "learnedBalancedGate": {
            "validationAggregate": aggregate_role(folds, "gate", "balanced", "validation"),
            "evaluationAggregate": aggregate_role(folds, "gate", "balanced", "evaluation"),
            "selectedByFold": [fold["selectedGates"]["balanced"]["id"] for fold in folds],
            "gateCpuEstimateByFold": [gate_cpu_estimate(fold["selectedGates"]["balanced"]) for fold in folds],
        },
        "folds": [
            {
                "fold": fold["fold"],
                "teacher": fold["teacher"],
                "trainRows": fold["trainRows"],
                "validationRows": fold["validationRows"],
                "evalRows": fold["evalRows"],
                "meta": fold["meta"],
                "baselineEvaluation": fold["baselineEvaluation"],
                "teacherEvaluation": fold["teacherEvaluation"],
                "selectedGates": fold["selectedGates"],
                "candidateCount": fold["candidateCount"],
            }
            for fold in folds
        ],
    }
    return summary


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
        role,
        candidate_id,
        fmt(metrics["mean"]),
        fmt(metrics["rmse"]),
        fmt(metrics["p95"]),
        fmt(metrics["p99"]),
        fmt(metrics["max"]),
        str(reg["worseOver1px"]),
        str(reg["worseOver3px"]),
        str(reg["worseOver5px"]),
        str(reg["improvedOver1px"]),
    ]


def render_markdown(result: dict[str, Any]) -> str:
    phase = result["phase"]
    best_teacher = phase["bestTeacherAlone"]
    best_fixed = phase["bestFixedBalancedGate"]
    best_strict = phase["bestLearnedStrictGate"]
    best_balanced = phase["bestLearnedBalancedGate"]
    baseline = best_teacher["baselineEvaluationAggregate"]
    rows = [
        metric_row("baseline", "product-baseline", baseline),
        metric_row("best teacher alone", best_teacher["id"], best_teacher["teacherAlone"]["evaluationAggregate"]),
        metric_row("best fixed gate", best_fixed["id"], best_fixed["fixedBalancedGate"]["evaluationAggregate"]),
        metric_row("learned strict", best_strict["id"], best_strict["learnedStrictGate"]["evaluationAggregate"]),
        metric_row("learned balanced", best_balanced["id"], best_balanced["learnedBalancedGate"]["evaluationAggregate"]),
    ]
    teacher_rows = []
    for entry in phase["teacherSummaries"]:
        meta = entry["meta"]
        teacher = entry["teacherAlone"]["evaluationAggregate"]
        strict = entry["learnedStrictGate"]["evaluationAggregate"]
        balanced = entry["learnedBalancedGate"]["evaluationAggregate"]
        teacher_rows.append([
            entry["id"],
            fmt(teacher["metrics"]["p95"]),
            fmt(teacher["metrics"]["p99"]),
            str(teacher["regressionsVsBaseline"]["worseOver5px"]),
            fmt(strict["metrics"]["p95"]),
            str(strict["regressionsVsBaseline"]["worseOver5px"]),
            fmt(balanced["metrics"]["p95"]),
            str(balanced["regressionsVsBaseline"]["worseOver5px"]),
            str(meta["params"]),
            fmt(meta["gpuEvalRowsPerSec"], 1),
            fmt(meta["cpuPyTorchRowsPerSecMean"], 1),
        ])
    gate_rows = []
    for role_name, entry, key in [
        ("strict", best_strict, "learnedStrictGate"),
        ("balanced", best_balanced, "learnedBalancedGate"),
        ("fixed", best_fixed, "fixedBalancedGate"),
    ]:
        gate_rows.append([
            role_name,
            entry["id"],
            " / ".join(entry[key]["selectedByFold"]),
            fmt(entry[key]["evaluationAggregate"]["metrics"]["p95"]),
            str(entry[key]["evaluationAggregate"]["regressionsVsBaseline"]["worseOver5px"]),
        ])
    best_meta = best_balanced["meta"]
    strict_gate_ops = best_strict["learnedStrictGate"].get("gateCpuEstimateByFold", [])
    balanced_gate_ops = best_balanced["learnedBalancedGate"].get("gateCpuEstimateByFold", [])
    return f"""# Cursor Prediction v9 Phase 6 Confidence Gate

Generated: {result['generatedAt']}

Device: `{result['environment']['device']}`  
Torch: `{result['environment']['torchVersion']}`  
CUDA available: `{result['environment']['cudaAvailable']}`

Teachers were trained on first 70% of the train session. Logistic, tiny-MLP,
and shallow threshold-tree gates were trained or selected on the trailing 30%
validation split and evaluated on the other session. No Calibrator run,
checkpoint, cache, TensorBoard, or large dataset artifact was written.

## Headline Evaluation

{md_table(["role", "candidate", "mean", "rmse", "p95", "p99", "max", ">1px reg", ">3px reg", ">5px reg", ">1px improved"], rows)}

## Teacher/Gate Summary

{md_table(["teacher", "alone p95", "alone p99", "alone >5", "strict p95", "strict >5", "balanced p95", "balanced >5", "params", "GPU rows/sec", "CPU rows/sec"], teacher_rows)}

## Selected Gates

{md_table(["role", "teacher", "selected gates by fold", "p95", ">5px reg"], gate_rows)}

Best learned balanced teacher runtime: `{best_balanced['id']}` params `{best_meta['params']}`,
GPU `{fmt(best_meta['gpuEvalRowsPerSec'], 1)}` rows/sec, PyTorch CPU
`{fmt(best_meta['cpuPyTorchRowsPerSecMean'], 1)}` rows/sec, C# SIMD teacher
estimate `{fmt(best_meta['csharpSimdRowsPerSecLowMean'], 1)}` to
`{fmt(best_meta['csharpSimdRowsPerSecHighMean'], 1)}` rows/sec.

Gate CPU estimates are lightweight. Strict: `{strip_private(strict_gate_ops)}`.
Balanced: `{strip_private(balanced_gate_ops)}`.
"""


def failure_result(args: argparse.Namespace, started: float, error: Exception) -> dict[str, Any]:
    return {
        "schemaVersion": "cursor-prediction-v9-phase6-confidence-gate/1",
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
        for teacher_index, spec in enumerate(teacher_specs()):
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
        best_fixed = min(summaries, key=lambda entry: objective(entry["fixedBalancedGate"]["validationAggregate"], entry["baselineValidationAggregate"], "balanced"))
        best_strict = min(summaries, key=lambda entry: objective(entry["learnedStrictGate"]["validationAggregate"], entry["baselineValidationAggregate"], "strict"))
        best_balanced = min(summaries, key=lambda entry: objective(entry["learnedBalancedGate"]["validationAggregate"], entry["baselineValidationAggregate"], "balanced"))
        if device.type == "cuda":
            torch.cuda.synchronize()
        result = {
            "schemaVersion": "cursor-prediction-v9-phase6-confidence-gate/1",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "runtimeSec": time.perf_counter() - started,
            "status": "ok",
            "policy": {
                "inputTraces": p3.TRACE_FILES,
                "horizonsMs": p3.HORIZONS_MS,
                "sequenceLength": 32,
                "trainValidationSplit": "first 70% train, trailing 30% gate train/select",
                "target": "referencePoll position at anchor time + horizon",
                "gateTarget": "teacher_error < baseline_error - margin",
                "gateMarginsPx": MARGINS,
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
            "teacherSpecs": teacher_specs(),
            "gateFeatureNames": FEATURE_NAMES,
            "failures": failures,
            "phase": {
                "teacherSummaries": summaries,
                "bestTeacherAlone": best_teacher,
                "bestFixedBalancedGate": best_fixed,
                "bestLearnedStrictGate": best_strict,
                "bestLearnedBalancedGate": best_balanced,
            },
        }
    except Exception as exc:
        result = failure_result(args, started, exc)
    args.out_json.write_text(json.dumps(strip_private(result), indent=2) + "\n", encoding="utf-8")
    args.out_md.write_text(
        render_markdown(result) if result.get("status") == "ok" else f"# Cursor Prediction v9 Phase 6 Confidence Gate\n\nFailed: `{result['error']}`\n",
        encoding="utf-8",
    )
    print(f"Wrote {args.out_json}")
    print(f"Wrote {args.out_md}")
    print(f"Runtime seconds: {result['runtimeSec']:.3f}")
    if result.get("status") != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
