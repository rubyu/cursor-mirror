#!/usr/bin/env python
"""Step 03 lag and deceleration ablation for cursor-prediction-v17.

Uses the v16 selected DistilledMLP weights unchanged and evaluates only
runtime-style post-processing variants. This is CPU fixed inference only:
no GPU training, checkpoints, expanded CSVs, or raw data copies.
"""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
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


SCHEMA_VERSION = "cursor-prediction-v17-step-03-lag-and-deceleration-ablation/1"


def load_step02(root: Path) -> Any:
    script = root / "poc" / "cursor-prediction-v17" / "scripts" / "run-step-02-overshoot-metrics.py"
    spec = importlib.util.spec_from_file_location("v17_step02_metrics", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-dir", type=Path, default=root / "poc" / "cursor-prediction-v17" / "step-03-lag-and-deceleration-ablation")
    parser.add_argument("--manifest", type=Path, default=root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json")
    parser.add_argument("--runtime", type=Path, default=root / "poc" / "cursor-prediction-v16" / "runtime" / "selected-candidate.json")
    return parser.parse_args()


def descriptor_with_lag(descriptor: dict[str, Any], lag_px: float) -> dict[str, Any]:
    cloned = copy.deepcopy(descriptor)
    cloned["runtime"]["lagCompensationPx"] = lag_px
    return cloned


def row_vectors(bundle: Any) -> dict[str, np.ndarray]:
    n = len(bundle.row_meta)
    out = {
        "v2": np.zeros((n, 2), dtype=np.float32),
        "v5": np.zeros((n, 2), dtype=np.float32),
        "v12": np.zeros((n, 2), dtype=np.float32),
        "v2Speed": np.zeros(n, dtype=np.float32),
        "v5Speed": np.zeros(n, dtype=np.float32),
        "v12Speed": np.zeros(n, dtype=np.float32),
        "labelSpeed": np.zeros(n, dtype=np.float32),
        "horizonMs": np.zeros(n, dtype=np.float32),
        "pathNet": np.zeros(n, dtype=np.float32),
        "pathLength": np.zeros(n, dtype=np.float32),
        "pathEfficiency": np.zeros(n, dtype=np.float32),
    }
    for i, row in enumerate(bundle.row_meta):
        for key in (2, 5, 12):
            v = row["velocities"][key]
            out[f"v{key}"][i, 0] = float(v["vx"])
            out[f"v{key}"][i, 1] = float(v["vy"])
            out[f"v{key}Speed"][i] = float(v["speed"])
        out["labelSpeed"][i] = float(row["labelSpeed"])
        out["horizonMs"][i] = float(row["horizonMs"])
        out["pathNet"][i] = float(row["path"]["net"])
        out["pathLength"][i] = float(row["path"]["path"])
        out["pathEfficiency"][i] = float(row["path"]["efficiency"])
    return out


def unit(vec: np.ndarray) -> np.ndarray:
    mag = np.sqrt(np.sum(vec * vec, axis=1))
    result = np.zeros_like(vec, dtype=np.float32)
    mask = mag > 1e-6
    result[mask] = vec[mask] / mag[mask, None]
    return result


def scalar_capacity(rowv: dict[str, np.ndarray], mode: str) -> np.ndarray:
    if mode == "short_cv_8ms":
        return (rowv["v2Speed"] * np.minimum(rowv["horizonMs"], 8.0) / 1000.0) + 0.25
    if mode == "short_cv_4ms":
        return (rowv["v2Speed"] * np.minimum(rowv["horizonMs"], 4.0) / 1000.0) + 0.25
    return (rowv["v2Speed"] * rowv["horizonMs"] / 1000.0) + 0.25


def guard_masks(bundle: Any, vectors: dict[str, np.ndarray], rowv: dict[str, np.ndarray], selected_pred: np.ndarray) -> dict[str, np.ndarray]:
    v2 = rowv["v2Speed"]
    v5 = rowv["v5Speed"]
    v12 = rowv["v12Speed"]
    label = rowv["labelSpeed"]
    path_eff = rowv["pathEfficiency"]
    path_net = rowv["pathNet"]
    direction = unit(rowv["v12"])
    pred_along = np.sum(selected_pred * direction, axis=1)
    cap8 = scalar_capacity(rowv, "short_cv_8ms")
    sharp_drop = ((v12 >= 500.0) & (v2 <= v12 * 0.55)) | ((v5 >= 500.0) & (v2 <= v5 * 0.65))
    shrinking_path = (path_eff <= 0.55) | ((path_net <= 3.0) & (v12 >= 500.0))
    low_now = v2 <= 180.0
    runtime_decel = (sharp_drop & (shrinking_path | low_now)) | ((v12 >= 800.0) & (v2 <= 220.0) & (path_eff <= 0.7))
    pred_exceeds_recent_capacity = pred_along > cap8
    runtime_decel_capacity = runtime_decel & pred_exceeds_recent_capacity
    oracle_future_stop = (v12 >= 500.0) & ((label <= 150.0) | ((v12 - label >= 500.0) & (label <= v12 * 0.45)))
    oracle_hard_stop = (v12 >= 1000.0) & (label <= 100.0)
    near_stop_hold = (v12 <= 100.0) & (label <= 25.0) & (vectors["targetMag"] <= 1.0)
    return {
        "runtimeSharpDrop": sharp_drop,
        "runtimeShrinkingPath": shrinking_path,
        "runtimeDecel": runtime_decel,
        "runtimeDecelCapacity": runtime_decel_capacity,
        "oracleFutureStopDiagnostic": oracle_future_stop,
        "oracleHardStopDiagnostic": oracle_hard_stop,
        "nearStopHoldRuntime": near_stop_hold,
    }


def with_lag(core_pred: np.ndarray, lag_units: np.ndarray, lag_px: float) -> np.ndarray:
    if lag_px <= 0:
        return core_pred.astype(np.float32)
    return (core_pred + lag_units * np.float32(lag_px)).astype(np.float32)


def zero_on_mask(pred: np.ndarray, mask: np.ndarray) -> np.ndarray:
    out = pred.copy()
    out[mask] = 0.0
    return out


def remove_lag_on_mask(core_pred: np.ndarray, lag_units: np.ndarray, lag_px: float, mask: np.ndarray) -> np.ndarray:
    out = with_lag(core_pred, lag_units, lag_px)
    out[mask] = core_pred[mask]
    return out


def short_cv(rowv: dict[str, np.ndarray], mode: str) -> np.ndarray:
    horizon_ms = rowv["horizonMs"] if mode == "horizon" else np.minimum(rowv["horizonMs"], 8.0 if mode == "8ms" else 4.0)
    return (rowv["v2"] * (horizon_ms / 1000.0)[:, None]).astype(np.float32)


def replace_with_short_cv_on_mask(pred: np.ndarray, rowv: dict[str, np.ndarray], mask: np.ndarray, mode: str) -> np.ndarray:
    out = pred.copy()
    out[mask] = short_cv(rowv, mode)[mask]
    return out


def clamp_along_motion(pred: np.ndarray, rowv: dict[str, np.ndarray], mask: np.ndarray, capacity_mode: str) -> np.ndarray:
    direction = unit(rowv["v12"])
    along = np.sum(pred * direction, axis=1)
    perp = pred - (along[:, None] * direction)
    cap = scalar_capacity(rowv, capacity_mode)
    clamped_along = np.minimum(along, cap)
    out = pred.copy()
    out[mask] = (perp + clamped_along[:, None] * direction)[mask]
    return out.astype(np.float32)


def objective(metric: dict[str, Any], selected_metric: dict[str, Any]) -> float:
    all_m = metric["bySlice"]["all"]["errorPx"]
    stop = metric["bySlice"]["stopApproach"]
    hard = metric["bySlice"]["hardStopApproach"]
    post = metric["bySlice"]["postStopHold"]["postStopJitter"]
    signed_mean = stop["signedAlongMotionError"]["mean"] or 0.0
    selected_all = selected_metric["bySlice"]["all"]["errorPx"]
    selected_stop = selected_metric["bySlice"]["stopApproach"]
    all_regression = max(0.0, float(all_m["p95"] or 9999) - float(selected_all["p95"] or 0.0)) * 4.0
    all_p99_regression = max(0.0, float(all_m["p99"] or 9999) - float(selected_all["p99"] or 0.0)) * 1.2
    stop_regression = max(0.0, float(stop["errorPx"]["p95"] or 9999) - float(selected_stop["errorPx"]["p95"] or 0.0) - 0.5) * 3.0
    stop_p99_regression = max(0.0, float(stop["errorPx"]["p99"] or 9999) - float(selected_stop["errorPx"]["p99"] or 0.0) - 0.75) * 1.2
    lag_penalty = max(0.0, -2.0 - float(signed_mean)) * 0.5
    return round(
        float(stop["overshootPx"]["p95"] or 9999)
        + 0.25 * float(stop["overshootPx"]["p99"] or 9999)
        + 1.5 * float(stop["overshootRateGt1"] or 1.0)
        + 2.0 * float(stop["overshootRateGt2"] or 1.0)
        + 0.35 * float(hard["overshootPx"]["p95"] or 9999)
        + 0.6 * float(post["p95"] or 9999)
        + all_regression
        + all_p99_regression
        + stop_regression
        + stop_p99_regression
        + lag_penalty,
        6,
    )


def compact_summary(metric: dict[str, Any]) -> dict[str, Any]:
    all_m = metric["bySlice"]["all"]
    stop = metric["bySlice"]["stopApproach"]
    hard = metric["bySlice"]["hardStopApproach"]
    post = metric["bySlice"]["postStopHold"]
    flip = metric["bySlice"]["directionFlip"]
    return {
        "allP95": all_m["errorPx"]["p95"],
        "allP99": all_m["errorPx"]["p99"],
        "stopP95": stop["errorPx"]["p95"],
        "stopP99": stop["errorPx"]["p99"],
        "stopSignedMean": stop["signedAlongMotionError"]["mean"],
        "stopOvershootP95": stop["overshootPx"]["p95"],
        "stopOvershootP99": stop["overshootPx"]["p99"],
        "stopOvershootGt1": stop["overshootRateGt1"],
        "stopOvershootGt2": stop["overshootRateGt2"],
        "hardStopP95": hard["errorPx"]["p95"],
        "hardStopP99": hard["errorPx"]["p99"],
        "hardStopOvershootP95": hard["overshootPx"]["p95"],
        "hardStopOvershootP99": hard["overshootPx"]["p99"],
        "hardStopOvershootGt1": hard["overshootRateGt1"],
        "hardStopOvershootGt2": hard["overshootRateGt2"],
        "postStopJitterP95": post["postStopJitter"]["p95"],
        "postStopJitterP99": post["postStopJitter"]["p99"],
        "directionFlipPenaltyP95": flip["directionFlipPenalty"]["p95"],
        "directionFlipRows": flip["rows"],
    }


def package_breakdown(metric: dict[str, Any]) -> dict[str, Any]:
    return {
        package: {
            "stopP95": payload["errorPx"]["p95"],
            "stopP99": payload["errorPx"]["p99"],
            "stopOvershootP95": payload["overshootPx"]["p95"],
            "stopOvershootP99": payload["overshootPx"]["p99"],
            "stopOvershootGt1": payload["overshootRateGt1"],
            "stopOvershootGt2": payload["overshootRateGt2"],
        }
        for package, payload in metric["byPackageStopApproach"].items()
    }


def runtime_notes(kind: str, product_safe: bool, branches: int, state: str = "stateless") -> dict[str, Any]:
    return {
        "kind": kind,
        "productSafe": product_safe,
        "extraBranchesEstimate": branches,
        "state": state,
        "allocationRisk": "none; vector math can be stack/local scalar operations",
    }


def write_outputs(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    rows = []
    for item in scores["ranking"][:16]:
        s = item["summary"]
        rows.append(
            f"| {item['modelId']} | {item['runtimeNotes']['kind']} | {item['runtimeNotes']['productSafe']} | "
            f"{s['allP95']} | {s['allP99']} | {s['stopP95']} | {s['stopP99']} | "
            f"{s['stopSignedMean']} | {s['stopOvershootP95']} | {s['stopOvershootP99']} | "
            f"{s['stopOvershootGt1']} | {s['stopOvershootGt2']} | {s['hardStopOvershootP95']} | "
            f"{s['postStopJitterP95']} | {s['directionFlipPenaltyP95']} | {item['objective']} |"
        )
    guardrail_ids = ["step5_gate", "v16_selected_lag0p5_q0p125", scores["selectedBest"]["modelId"]]
    guardrail_items = []
    seen = set()
    for model_id in guardrail_ids:
        if model_id in seen:
            continue
        seen.add(model_id)
        match = next(item for item in scores["ranking"] if item["modelId"] == model_id)
        guardrail_items.append(match)
    split_rows = []
    for item in guardrail_items:
        for split, payload in item["bySplit"].items():
            split_rows.append(
                f"| {item['modelId']} | {split} | {payload['rows']} | {payload['errorPx']['p95']} | "
                f"{payload['errorPx']['p99']} | {payload['overshootPx']['p95']} | {payload['overshootRateGt1']} |"
            )
    package_rows = []
    for item in guardrail_items:
        for package, payload in item["byPackageStopApproach"].items():
            package_rows.append(
                f"| {item['modelId']} | {package} | {payload['stopP95']} | {payload['stopP99']} | "
                f"{payload['stopOvershootP95']} | {payload['stopOvershootP99']} | {payload['stopOvershootGt1']} | {payload['stopOvershootGt2']} |"
            )
    best = scores["selectedBest"]
    report = f"""# Step 03 - Lag And Deceleration Ablation

## Scope

This step keeps the v16 DistilledMLP weights fixed and evaluates lag-compensation and runtime-safe deceleration guards with CPU inference only. No GPU learning was run.

## Inputs

- Dataset rows: {scores['dataset']['rows']}
- Runtime descriptor: `{scores['inputs']['runtimeDescriptor']}`
- Base model: `{scores['baseModelId']}`
- Slice counts: `{scores['sliceCounts']}`
- Guard trigger counts: `{scores['guardCounts']}`

## Ranking

| candidate | guard kind | product safe | all p95 | all p99 | stop p95 | stop p99 | stop signed | stop over p95 | stop over p99 | over >1 | over >2 | hard over p95 | post jitter p95 | flip penalty p95 | objective |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

## Best Candidate

Selected for Step 4 consideration: `{best['modelId']}`.

- Runtime note: `{best['runtimeNotes']}`
- Summary: `{best['summary']}`

## Split Guardrails

| candidate | split | rows | all p95 | all p99 | overshoot p95 | overshoot >1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(split_rows)}

## Package Stop-Approach Breakdown

| candidate | package | stop p95 | stop p99 | overshoot p95 | overshoot p99 | overshoot >1 | overshoot >2 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(package_rows)}

## Interpretation

{scores['interpretation']}

## Caveats

- Label/future-speed diagnostic variants are included only to bound possible improvement; they are marked non-product-safe.
- Direction-flip slice is small, so it is a guardrail rather than the primary objective.
- This does not retrain the MLP; it only changes post-processing.
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    notes = """# Step 03 Notes

- CPU fixed inference only.
- v16 selected MLP weights are unchanged.
- Product-safe variants use current/recent velocity, path efficiency, and prediction/capacity checks.
- Oracle diagnostic variants use future label speed and are not product implementation candidates.
- Step 4 should focus on product-safe variants that reduce stopApproach overshoot and postStopJitter without large all-split regression.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    step02 = load_step02(args.root)
    module = step02.load_poc13_module(args.root)
    context = module.load_manifest(args.manifest)
    packages = [module.load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    rows, build_summary = module.build_rows(packages)
    rows = [row for row in rows if row["refreshBucket"] == "60Hz"]
    bundle = module.build_dataset(rows)
    descriptor = json.loads(args.runtime.read_text(encoding="utf-8"))
    vectors = step02.vector_arrays(bundle)
    rowv = row_vectors(bundle)
    masks = step02.masks_for(bundle, vectors)
    lag_units = step02.lag_units_from_source(bundle, descriptor)
    core = step02.runtime_predict(bundle, descriptor_with_lag(descriptor, 0.0))
    selected = step02.runtime_predict(bundle, descriptor_with_lag(descriptor, 0.5))
    guard = guard_masks(bundle, vectors, rowv, selected)

    candidates: dict[str, dict[str, Any]] = {
        "step5_gate": {
            "prediction": bundle.baseline.astype(np.float32),
            "runtimeNotes": runtime_notes("baseline", True, 0),
        },
    }
    for lag in (0.0, 0.125, 0.25, 0.5):
        model_id = f"mlp_lag{str(lag).replace('.', 'p')}_q0p125"
        if lag == 0.5:
            model_id = "v16_selected_lag0p5_q0p125"
        candidates[model_id] = {
            "prediction": with_lag(core, lag_units, lag),
            "runtimeNotes": runtime_notes("lag_ablation", True, 0),
        }

    candidates["remove_lag_on_runtime_decel"] = {
        "prediction": remove_lag_on_mask(core, lag_units, 0.5, guard["runtimeDecel"]),
        "runtimeNotes": runtime_notes("remove_lag_when_decelerating", True, 2),
    }
    candidates["remove_lag_on_runtime_decel_capacity"] = {
        "prediction": remove_lag_on_mask(core, lag_units, 0.5, guard["runtimeDecelCapacity"]),
        "runtimeNotes": runtime_notes("remove_lag_when_prediction_exceeds_recent_capacity", True, 3),
    }
    candidates["zero_on_runtime_decel"] = {
        "prediction": zero_on_mask(selected, guard["runtimeDecel"]),
        "runtimeNotes": runtime_notes("zero_hold_when_runtime_decelerating", True, 2),
    }
    candidates["zero_on_runtime_decel_capacity"] = {
        "prediction": zero_on_mask(selected, guard["runtimeDecelCapacity"]),
        "runtimeNotes": runtime_notes("zero_hold_when_prediction_exceeds_recent_capacity", True, 3),
    }
    candidates["short_cv8_on_runtime_decel"] = {
        "prediction": replace_with_short_cv_on_mask(selected, rowv, guard["runtimeDecel"], "8ms"),
        "runtimeNotes": runtime_notes("short_constant_velocity_8ms_when_decelerating", True, 3),
    }
    candidates["short_cv4_on_runtime_decel"] = {
        "prediction": replace_with_short_cv_on_mask(selected, rowv, guard["runtimeDecel"], "4ms"),
        "runtimeNotes": runtime_notes("short_constant_velocity_4ms_when_decelerating", True, 3),
    }
    candidates["along_clamp8_on_runtime_decel"] = {
        "prediction": clamp_along_motion(selected, rowv, guard["runtimeDecel"], "short_cv_8ms"),
        "runtimeNotes": runtime_notes("along_motion_clamp_8ms_capacity", True, 4),
    }
    candidates["along_clamp8_on_runtime_decel_capacity"] = {
        "prediction": clamp_along_motion(selected, rowv, guard["runtimeDecelCapacity"], "short_cv_8ms"),
        "runtimeNotes": runtime_notes("along_motion_clamp_when_prediction_exceeds_capacity", True, 4),
    }
    candidates["oracle_remove_lag_on_future_stop"] = {
        "prediction": remove_lag_on_mask(core, lag_units, 0.5, guard["oracleFutureStopDiagnostic"]),
        "runtimeNotes": runtime_notes("diagnostic_remove_lag_when_future_label_stop", False, 0),
    }
    candidates["oracle_zero_on_future_stop"] = {
        "prediction": zero_on_mask(selected, guard["oracleFutureStopDiagnostic"]),
        "runtimeNotes": runtime_notes("diagnostic_zero_when_future_label_stop", False, 0),
    }

    models = {
        model_id: step02.model_metrics(model_id, payload["prediction"], bundle, vectors, masks)
        for model_id, payload in candidates.items()
    }
    selected_metric = models["v16_selected_lag0p5_q0p125"]
    ranking = []
    for model_id, metric in models.items():
        ranking.append({
            "modelId": model_id,
            "objective": objective(metric, selected_metric),
            "summary": compact_summary(metric),
            "runtimeNotes": candidates[model_id]["runtimeNotes"],
            "bySplit": metric["bySplit"],
            "byPackageStopApproach": package_breakdown(metric),
        })
    ranking.sort(key=lambda item: (item["objective"], item["summary"]["allP95"], item["summary"]["stopOvershootP95"]))
    product_safe = [item for item in ranking if item["runtimeNotes"]["productSafe"] and item["modelId"] not in ("step5_gate",)]
    eligible = []
    base_summary = next(item for item in ranking if item["modelId"] == "v16_selected_lag0p5_q0p125")["summary"]
    for item in product_safe:
        summary = item["summary"]
        if summary["stopOvershootP95"] is None or summary["postStopJitterP95"] is None:
            continue
        if summary["stopOvershootP95"] >= base_summary["stopOvershootP95"]:
            continue
        if summary["postStopJitterP95"] > base_summary["postStopJitterP95"] + 0.05:
            continue
        if summary["allP95"] > base_summary["allP95"] + 0.10 or summary["allP99"] > base_summary["allP99"] + 0.30:
            continue
        if summary["stopP95"] > base_summary["stopP95"] + 0.75 or summary["stopP99"] > base_summary["stopP99"] + 0.75:
            continue
        if summary["stopSignedMean"] is not None and summary["stopSignedMean"] < -2.0:
            continue
        eligible.append(item)
    best = eligible[0] if eligible else (product_safe[0] if product_safe else ranking[0])
    base = next(item for item in ranking if item["modelId"] == "v16_selected_lag0p5_q0p125")
    best_delta_overshoot = round(float(best["summary"]["stopOvershootP95"]) - float(base["summary"]["stopOvershootP95"]), 4)
    best_delta_jitter = round(float(best["summary"]["postStopJitterP95"]) - float(base["summary"]["postStopJitterP95"]), 4)
    best_delta_all = round(float(best["summary"]["allP95"]) - float(base["summary"]["allP95"]), 4)
    interpretation = (
        f"Best product-safe Step 3 candidate is {best['modelId']}. "
        f"Versus v16 selected, stop overshoot p95 delta is {best_delta_overshoot}px, "
        f"post-stop jitter p95 delta is {best_delta_jitter}px, and all p95 delta is {best_delta_all}px. "
    )
    if best_delta_overshoot < 0 and best_delta_jitter <= 0.05 and best_delta_all <= 0.1:
        interpretation += "This is a plausible Step 4 runtime guard candidate."
    elif best_delta_overshoot < 0:
        interpretation += "It reduces overshoot, but Step 4 must tune the guard to reduce jitter/all-regression tradeoffs."
    else:
        interpretation += "The tested product-safe guards did not clearly beat the v16 selected tradeoff; Step 4 should try softer blending thresholds."

    scores = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "constraints": {
            "rawDataCopied": False,
            "expandedCsvWritten": False,
            "checkpointWritten": False,
            "tensorDumpWritten": False,
            "gpuTrainingRun": False,
            "analysis": "CPU-only fixed inference and post-processing ablation",
        },
        "inputs": {
            "manifest": str(args.manifest.relative_to(args.root)),
            "runtimeDescriptor": str(args.runtime.relative_to(args.root)),
            "loader": "poc/cursor-prediction-v13/scripts/run-deep-learning-gpu.py",
        },
        "baseModelId": descriptor["modelId"],
        "dataset": bundle.summary,
        "buildSummary": build_summary,
        "sliceCounts": {name: int(np.sum(mask)) for name, mask in masks.items()},
        "guardCounts": {name: int(np.sum(mask)) for name, mask in guard.items()},
        "guardPackageCounts": {name: dict(Counter(vectors["package"][mask])) for name, mask in guard.items()},
        "models": models,
        "ranking": ranking,
        "eligibleProductSafeRanking": eligible,
        "selectedBest": best,
        "baselineSelected": base,
        "interpretation": interpretation,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    write_outputs(args.out_dir, scores)
    print(json.dumps({
        "step": "03",
        "rows": bundle.summary["rows"],
        "candidateCount": len(candidates),
        "bestProductSafe": best["modelId"],
        "bestSummary": best["summary"],
        "elapsedSeconds": scores["elapsedSeconds"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
