#!/usr/bin/env python3
"""Phase 8 single common production-shaped confidence gate.

Teacher weights and gate weights are trained per cross-session fold, but the
selected production-shaped gate specification is common across both folds:
teacher family, gate type, target margin, probability threshold, apply
condition, and residual clamp are fixed. All data stays in memory; only compact
JSON/Markdown summaries are written.
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


p3 = load_local_module("phase3_ml_teachers_for_phase8", SCRIPT_DIR / "phase3-ml-teachers.py")
p4 = load_local_module("phase4_guarded_mlp_for_phase8", SCRIPT_DIR / "phase4-guarded-mlp.py")
p5 = load_local_module("phase5_expanded_teachers_for_phase8", SCRIPT_DIR / "phase5-expanded-teachers.py")
p6 = load_local_module("phase6_confidence_gate_for_phase8", SCRIPT_DIR / "phase6-confidence-gate.py")
p7 = load_local_module("phase7_max_safe_gate_for_phase8", SCRIPT_DIR / "phase7-max-safe-gate.py")


APPLY_CONDITIONS = [
    {"id": "all", "speedMaxPxPerSec": math.inf, "efficiencyMin": 0.0},
    {"id": "speed-lt-1000", "speedMaxPxPerSec": 1000.0, "efficiencyMin": 0.0},
    {"id": "speed-lt-2000", "speedMaxPxPerSec": 2000.0, "efficiencyMin": 0.0},
    {"id": "eff-ge-075", "speedMaxPxPerSec": math.inf, "efficiencyMin": 0.75},
]
CLAMPS = [4.0, 8.0, 12.0]


def parse_args() -> argparse.Namespace:
    root = SCRIPT_DIR.parents[2]
    out_dir = SCRIPT_DIR.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-json", type=Path, default=out_dir / "phase-8-common-product-gate.json")
    parser.add_argument("--out-md", type=Path, default=out_dir / "phase-8-common-product-gate.md")
    parser.add_argument("--seed", type=int, default=20260508)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--max-epochs", type=int, default=20)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--cpu-sample-rows", type=int, default=8192)
    return parser.parse_args()


def common_specs() -> list[dict[str, Any]]:
    specs = []
    for teacher in ["tcn_seq32_c64"]:
        for clamp in CLAMPS:
            for apply in APPLY_CONDITIONS:
                specs.append({
                    "id": f"{teacher}__tiny-mlp__m5__p095__{apply['id']}__clamp{int(clamp)}",
                    "teacher": teacher,
                    "gateKind": "tiny-mlp",
                    "marginPx": 5.0,
                    "probabilityThreshold": 0.95,
                    "apply": apply,
                    "clampPx": clamp,
                })
    for teacher in ["fsmn_seq32_c64", "mlp_seq32_h256_128_64"]:
        for gate_kind in ["logistic", "tiny-mlp"]:
            for margin in [1.0, 3.0, 5.0]:
                for threshold in [0.90, 0.95]:
                    for clamp in CLAMPS:
                        for apply in APPLY_CONDITIONS:
                            specs.append({
                                "id": f"{teacher}__{gate_kind}__m{int(margin)}__p{str(threshold).replace('.', '')}__{apply['id']}__clamp{int(clamp)}",
                                "teacher": teacher,
                                "gateKind": gate_kind,
                                "marginPx": margin,
                                "probabilityThreshold": threshold,
                                "apply": apply,
                                "clampPx": clamp,
                            })
    return specs


def clamp_residual(residual_px: np.ndarray, clamp_px: float) -> np.ndarray:
    mag = np.linalg.norm(residual_px, axis=1)
    scale = np.minimum(1.0, clamp_px / np.maximum(mag, 1e-6))
    return (residual_px * scale[:, None]).astype(np.float32)


def apply_condition_mask(dataset: Any, apply: dict[str, Any]) -> np.ndarray:
    speed = dataset.ctx[:, 3].astype(np.float32) * 5000.0
    efficiency = dataset.ctx[:, 4].astype(np.float32)
    return (speed < apply["speedMaxPxPerSec"]) & (efficiency >= apply["efficiencyMin"])


def evaluate(dataset: Any, residual_px: np.ndarray) -> dict[str, Any]:
    errors = p5.metric_errors(dataset, residual_px)
    return {
        "metrics": p3.metric_stats(errors),
        "regressionsVsBaseline": p7.regression_counts_extended(errors, dataset.baseline_error),
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
        "regressionsVsBaseline": p7.regression_counts_extended(errors, baseline),
    }


def objective(summary: dict[str, Any], baseline: dict[str, Any], mode: str) -> float:
    metrics = summary["metrics"]
    reg = summary["regressionsVsBaseline"]
    count = max(1, reg["count"])
    rates = {key: reg[key] / count for key in ["worseOver1px", "worseOver3px", "worseOver5px", "worseOver10px", "worseOver20px", "worseOver50px"]}
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
    if mode == "max-safe":
        return (
            p95 + 0.40 * p99 + 0.14 * max_error
            + 250.0 * rates["worseOver1px"] + 900.0 * rates["worseOver3px"]
            + 2600.0 * rates["worseOver5px"] + 10000.0 * rates["worseOver10px"]
            + 24000.0 * rates["worseOver20px"] + 70000.0 * rates["worseOver50px"]
            + 10.0 * max_overshoot - 0.9 * p95_gain - 0.45 * p99_gain - 14.0 * improved
        )
    return (
        p95 + 0.45 * p99 + 0.04 * mean
        + 150.0 * rates["worseOver1px"] + 500.0 * rates["worseOver3px"]
        + 1400.0 * rates["worseOver5px"] + 5000.0 * rates["worseOver10px"]
        + 12000.0 * rates["worseOver20px"] + 40000.0 * rates["worseOver50px"]
        + 6.0 * max_overshoot - 1.1 * p95_gain - 0.55 * p99_gain - 42.0 * improved
    )


def gate_cpu_cost(gate_kind: str) -> dict[str, Any]:
    if gate_kind == "logistic":
        return {"estimatedOpsPerSample": 11 + 10, "estimatedCSharpRowsPerSecLow": 8_000_000.0, "estimatedCSharpRowsPerSecHigh": 25_000_000.0}
    return {"estimatedOpsPerSample": 76 + 10, "estimatedCSharpRowsPerSecLow": 3_000_000.0, "estimatedCSharpRowsPerSecHigh": 12_000_000.0}


def teacher_specs_by_id() -> dict[str, dict[str, Any]]:
    return {spec["id"]: spec for spec in p6.teacher_specs()}


def train_fold(teacher_spec: dict[str, Any], train_full: Any, eval_dataset: Any, fold_name: str, seed: int, args: argparse.Namespace, device: torch.device) -> dict[str, Any]:
    train70, val30 = p4.split_dataset(train_full, 0.70)
    result = p5.train_torch_teacher(teacher_spec, train70, val30, eval_dataset, seed, args.max_epochs, args.patience, args.batch_size, device, args.cpu_sample_rows)
    ab_val = p4.alpha_beta_correction(val30)
    ab_eval = p4.alpha_beta_correction(eval_dataset)
    x_val_raw = p6.gate_features(val30, result["valPred"], ab_val)
    x_eval_raw = p6.gate_features(eval_dataset, result["evalPred"], ab_eval)
    x_val, x_eval, norm = p6.normalize_features(x_val_raw, x_eval_raw)
    gate_probs: dict[str, dict[str, Any]] = {}
    gate_keys = set()
    for spec in common_specs():
        if spec["teacher"] == teacher_spec["id"]:
            gate_keys.add((spec["gateKind"], spec["marginPx"]))
    for index, (gate_kind, margin) in enumerate(sorted(gate_keys)):
        y_val, _ = p6.gate_target(val30, result["valPred"], margin)
        probs_val, probs_eval, model_meta = p6.train_binary_gate(
            gate_kind,
            x_val,
            y_val,
            x_eval,
            seed + index * 101 + int(margin * 10),
        )
        gate_probs[f"{gate_kind}|{margin}"] = {
            "validationProb": probs_val,
            "evaluationProb": probs_eval,
            "model": model_meta,
            "featureNormalization": norm,
        }
    baseline_val = evaluate(val30, np.zeros_like(val30.baseline, dtype=np.float32))
    baseline_eval = evaluate(eval_dataset, np.zeros_like(eval_dataset.baseline, dtype=np.float32))
    teacher_val = evaluate(val30, result["valPred"])
    teacher_eval = evaluate(eval_dataset, result["evalPred"])
    return {
        "fold": fold_name,
        "teacher": teacher_spec["id"],
        "trainRows": int(train70.target.shape[0]),
        "validationRows": int(val30.target.shape[0]),
        "evalRows": int(eval_dataset.target.shape[0]),
        "validationDataset": val30,
        "evaluationDataset": eval_dataset,
        "validationResidual": result["valPred"],
        "evaluationResidual": result["evalPred"],
        "gateProbs": gate_probs,
        "meta": result["meta"],
        "baselineValidation": baseline_val,
        "baselineEvaluation": baseline_eval,
        "teacherValidation": teacher_val,
        "teacherEvaluation": teacher_eval,
    }


def apply_common_spec(fold: dict[str, Any], spec: dict[str, Any], split: str) -> tuple[dict[str, Any], float]:
    dataset = fold["validationDataset"] if split == "validation" else fold["evaluationDataset"]
    residual = fold["validationResidual"] if split == "validation" else fold["evaluationResidual"]
    probs = fold["gateProbs"][f"{spec['gateKind']}|{spec['marginPx']}"]["validationProb" if split == "validation" else "evaluationProb"]
    mask = (probs >= spec["probabilityThreshold"]) & apply_condition_mask(dataset, spec["apply"])
    applied = clamp_residual(np.where(mask[:, None], residual, 0.0), spec["clampPx"])
    return evaluate(dataset, applied), float(mask.mean())


def aggregate_spec(folds: list[dict[str, Any]], spec: dict[str, Any], split: str) -> dict[str, Any]:
    parts = []
    baseline_errors = []
    apply_rates = []
    for fold in folds:
        part, apply_rate = apply_common_spec(fold, spec, split)
        parts.append(part)
        baseline_errors.append(fold["baselineValidation" if split == "validation" else "baselineEvaluation"]["_errors"])
        apply_rates.append(apply_rate)
    result = aggregate(parts, baseline_errors)
    result["perFold"] = [compact_eval(part) for part in parts]
    result["applyRateMean"] = float(np.mean(apply_rates))
    result["applyRateByFold"] = apply_rates
    return result


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


def summarize_teacher(teacher_id: str, folds: list[dict[str, Any]], specs: list[dict[str, Any]]) -> dict[str, Any]:
    baseline_validation = aggregate([fold["baselineValidation"] for fold in folds], [fold["baselineValidation"]["_errors"] for fold in folds])
    baseline_evaluation = aggregate([fold["baselineEvaluation"] for fold in folds], [fold["baselineEvaluation"]["_errors"] for fold in folds])
    teacher_validation = aggregate([fold["teacherValidation"] for fold in folds], [fold["baselineValidation"]["_errors"] for fold in folds])
    teacher_evaluation = aggregate([fold["teacherEvaluation"] for fold in folds], [fold["baselineEvaluation"]["_errors"] for fold in folds])
    candidates = []
    for spec in specs:
        if spec["teacher"] != teacher_id:
            continue
        validation = aggregate_spec(folds, spec, "validation")
        evaluation = aggregate_spec(folds, spec, "evaluation")
        candidates.append({
            "id": spec["id"],
            "spec": spec,
            "validationAggregate": validation,
            "evaluationAggregate": evaluation,
            "scores": {
                "balanced": objective(validation, baseline_validation, "balanced"),
                "maxSafe": objective(validation, baseline_validation, "max-safe"),
            },
            "gateCpuCost": gate_cpu_cost(spec["gateKind"]),
        })
    balanced_pool = [
        candidate for candidate in candidates
        if candidate["validationAggregate"]["metrics"]["max"] <= baseline_validation["metrics"]["max"]
    ] or candidates
    max_safe_pool = [
        candidate for candidate in candidates
        if candidate["validationAggregate"]["regressionsVsBaseline"]["worseOver20px"] == 0
        and candidate["validationAggregate"]["regressionsVsBaseline"]["worseOver50px"] == 0
    ] or candidates
    best_balanced = min(balanced_pool, key=lambda item: item["scores"]["balanced"])
    best_maxsafe = min(max_safe_pool, key=lambda item: item["scores"]["maxSafe"])
    candidates.sort(key=lambda item: item["scores"]["balanced"])
    return {
        "id": teacher_id,
        "meta": meta_summary(folds),
        "baselineValidationAggregate": baseline_validation,
        "baselineEvaluationAggregate": baseline_evaluation,
        "teacherAlone": {
            "validationAggregate": teacher_validation,
            "evaluationAggregate": teacher_evaluation,
        },
        "bestBalancedCommonGate": best_balanced,
        "bestMaxSafeCommonGate": best_maxsafe,
        "topBalancedCommonGates": candidates[:12],
        "candidateCount": len(candidates),
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
            }
            for fold in folds
        ],
    }


def read_phase7_comparison(out_dir: Path) -> dict[str, Any] | None:
    path = out_dir / "phase-7-max-safe-gate.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("status") != "ok":
        return None
    best = data["phase"]["bestMaxSafeGate"]
    return {
        "source": str(path.name),
        "id": best["id"],
        "evaluationAggregate": best["maxSafeGate"]["evaluationAggregate"],
        "selectedByFold": best["maxSafeGate"]["selectedByFold"],
        "meta": best["meta"],
    }


def product_candidate(teacher_summaries: list[dict[str, Any]], baseline: dict[str, Any]) -> dict[str, Any] | None:
    eligible = []
    for summary in teacher_summaries:
        for role in ["bestMaxSafeCommonGate", "bestBalancedCommonGate"]:
            candidate = summary[role]
            metrics = candidate["evaluationAggregate"]["metrics"]
            reg = candidate["evaluationAggregate"]["regressionsVsBaseline"]
            meta = summary["meta"]
            if (
                metrics["p95"] < baseline["metrics"]["p95"]
                and metrics["p99"] <= baseline["metrics"]["p99"]
                and metrics["max"] <= baseline["metrics"]["max"]
                and reg["worseOver20px"] == 0
                and reg["worseOver50px"] == 0
                and meta["csharpSimdRowsPerSecLowMean"] is not None
                and meta["csharpSimdRowsPerSecLowMean"] >= 40_000.0
            ):
                eligible.append({"teacher": summary["id"], "role": role, "candidate": candidate, "meta": meta})
    if not eligible:
        return None
    return min(eligible, key=lambda item: (
        item["candidate"]["evaluationAggregate"]["metrics"]["p95"],
        item["candidate"]["evaluationAggregate"]["regressionsVsBaseline"]["worseOver5px"],
    ))


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
        str(reg["worseOver10px"]),
        str(reg["worseOver20px"]),
        str(reg["worseOver50px"]),
        str(reg["improvedOver1px"]),
    ]


def render_markdown(result: dict[str, Any]) -> str:
    phase = result["phase"]
    best_teacher = phase["bestTeacherAlone"]
    best_maxsafe = phase["bestCommonMaxSafeGate"]
    best_balanced = phase["bestCommonBalancedGate"]
    phase7 = phase.get("phase7FoldSpecificComparison")
    product = phase.get("productCandidate")
    baseline = phase["baselineEvaluationAggregate"]
    rows = [
        metric_row("baseline", "product-baseline", baseline),
        metric_row("teacher-alone", best_teacher["id"], best_teacher["teacherAlone"]["evaluationAggregate"]),
    ]
    if phase7:
        rows.append(metric_row("phase7 fold-specific", phase7["id"], phase7["evaluationAggregate"]))
    rows.extend([
        metric_row("common max-safe", best_maxsafe["id"], best_maxsafe["evaluationAggregate"]),
        metric_row("common balanced", best_balanced["id"], best_balanced["evaluationAggregate"]),
    ])
    if product:
        rows.append(metric_row("product-candidate", product["candidate"]["id"], product["candidate"]["evaluationAggregate"]))
    teacher_rows = []
    for summary in phase["teacherSummaries"]:
        meta = summary["meta"]
        maxsafe = summary["bestMaxSafeCommonGate"]["evaluationAggregate"]
        balanced = summary["bestBalancedCommonGate"]["evaluationAggregate"]
        teacher_rows.append([
            summary["id"],
            fmt(summary["teacherAlone"]["evaluationAggregate"]["metrics"]["p95"]),
            fmt(summary["teacherAlone"]["evaluationAggregate"]["metrics"]["p99"]),
            str(summary["teacherAlone"]["evaluationAggregate"]["regressionsVsBaseline"]["worseOver20px"]),
            fmt(maxsafe["metrics"]["p95"]),
            str(maxsafe["regressionsVsBaseline"]["worseOver20px"]),
            fmt(balanced["metrics"]["p95"]),
            str(balanced["regressionsVsBaseline"]["worseOver20px"]),
            str(meta["params"]),
            fmt(meta["gpuEvalRowsPerSec"], 1),
            fmt(meta["cpuPyTorchRowsPerSecMean"], 1),
            fmt(meta["csharpSimdRowsPerSecLowMean"], 1),
        ])
    decision = result["decision"]
    return f"""# Cursor Prediction v9 Phase 8 Common Product Gate

Generated: {result['generatedAt']}

Device: `{result['environment']['device']}`  
Torch: `{result['environment']['torchVersion']}`  
CUDA available: `{result['environment']['cudaAvailable']}`

The selected gate specification is common across both folds. Teacher and gate
weights are still trained per fold, but family, gate type, margin, probability
threshold, apply condition, and clamp are fixed. No Calibrator run, checkpoint,
cache, TensorBoard, or large dataset artifact was written.

## Headline Evaluation

{md_table(["role", "candidate", "mean", "rmse", "p95", "p99", "max", ">1", ">3", ">5", ">10", ">20", ">50", "improved"], rows)}

## Teacher Summary

{md_table(["teacher", "alone p95", "alone p99", "alone >20", "maxsafe p95", "maxsafe >20", "balanced p95", "balanced >20", "params", "GPU rows/s", "CPU rows/s", "C# SIMD low"], teacher_rows)}

## Decision

{decision}
"""


def failure_result(started: float, error: Exception) -> dict[str, Any]:
    return {
        "schemaVersion": "cursor-prediction-v9-phase8-common-product-gate/1",
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
        specs_by_id = teacher_specs_by_id()
        all_specs = common_specs()
        teacher_summaries = []
        failures: list[dict[str, Any]] = []
        for teacher_index, teacher_id in enumerate(["mlp_seq32_h256_128_64", "fsmn_seq32_c64", "tcn_seq32_c64"]):
            teacher_spec = specs_by_id[teacher_id]
            folds = []
            fold_defs = [
                ("train-session-1-eval-session-2", datasets[0], datasets[1], args.seed + teacher_index * 1000 + 1),
                ("train-session-2-eval-session-1", datasets[1], datasets[0], args.seed + teacher_index * 1000 + 501),
            ]
            for fold_name, train_dataset, eval_dataset, seed in fold_defs:
                try:
                    folds.append(train_fold(teacher_spec, train_dataset, eval_dataset, fold_name, seed, args, device))
                except Exception as exc:
                    failures.append({"teacher": teacher_id, "fold": fold_name, "error": repr(exc)})
            if len(folds) == 2:
                teacher_summaries.append(summarize_teacher(teacher_id, folds, all_specs))
        if not teacher_summaries:
            raise RuntimeError("No teacher completed both folds")
        baseline_eval = teacher_summaries[0]["baselineEvaluationAggregate"]
        best_teacher = min(teacher_summaries, key=lambda item: (
            item["teacherAlone"]["evaluationAggregate"]["metrics"]["p95"] or float("inf"),
            item["teacherAlone"]["evaluationAggregate"]["metrics"]["p99"] or float("inf"),
        ))
        best_maxsafe_summary = min(teacher_summaries, key=lambda item: objective(item["bestMaxSafeCommonGate"]["validationAggregate"], item["baselineValidationAggregate"], "max-safe"))
        best_balanced_summary = min(teacher_summaries, key=lambda item: objective(item["bestBalancedCommonGate"]["validationAggregate"], item["baselineValidationAggregate"], "balanced"))
        product = product_candidate(teacher_summaries, baseline_eval)
        phase7 = read_phase7_comparison(args.out_json.parent)
        if product:
            decision = (
                f"Product-shaped candidate exists: `{product['candidate']['id']}` on `{product['teacher']}`. "
                "It satisfies p95/p99 improvement, max <= baseline, >20/>50 regression = 0, and C# SIMD low estimate >= 40k rows/sec."
            )
        else:
            decision = (
                "No common production-shaped candidate meets the product gate: require p95 improvement, p99 non-regression, "
                "max <= baseline, >20/>50 regression = 0, and feasible C# SIMD cost. ML should remain offline for now."
            )
        if device.type == "cuda":
            torch.cuda.synchronize()
        result = {
            "schemaVersion": "cursor-prediction-v9-phase8-common-product-gate/1",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "runtimeSec": time.perf_counter() - started,
            "status": "ok",
            "policy": {
                "inputTraces": p3.TRACE_FILES,
                "horizonsMs": p3.HORIZONS_MS,
                "sequenceLength": 32,
                "sameGateSpecAcrossFolds": True,
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
            "commonGateSpecs": all_specs,
            "failures": failures,
            "phase": {
                "baselineEvaluationAggregate": baseline_eval,
                "teacherSummaries": teacher_summaries,
                "bestTeacherAlone": best_teacher,
                "bestCommonMaxSafeGate": best_maxsafe_summary["bestMaxSafeCommonGate"],
                "bestCommonMaxSafeTeacher": best_maxsafe_summary["id"],
                "bestCommonBalancedGate": best_balanced_summary["bestBalancedCommonGate"],
                "bestCommonBalancedTeacher": best_balanced_summary["id"],
                "phase7FoldSpecificComparison": phase7,
                "productCandidate": product,
            },
            "decision": decision,
        }
    except Exception as exc:
        result = failure_result(started, exc)
    args.out_json.write_text(json.dumps(strip_private(result), indent=2) + "\n", encoding="utf-8")
    args.out_md.write_text(
        render_markdown(result) if result.get("status") == "ok" else f"# Cursor Prediction v9 Phase 8 Common Product Gate\n\nFailed: `{result['error']}`\n",
        encoding="utf-8",
    )
    print(f"Wrote {args.out_json}")
    print(f"Wrote {args.out_md}")
    print(f"Runtime seconds: {result['runtimeSec']:.3f}")
    if result.get("status") != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
