#!/usr/bin/env python
"""Step 05 product-shape validation for cursor-prediction-v17.

CPU-only fixed-inference validation. The v16 selected DistilledMLP weights stay
unchanged; this step approximates the current product predictor's outer runtime
shape: 60Hz gate, history warmup, stationary fallback, prediction gain,
quantization from the generated model, and final magnitude clamp.
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


SCHEMA_VERSION = "cursor-prediction-v17-step-05-product-shape-validation/1"

PRODUCT_FILES = {
    "predictor": "src/CursorMirror.Core/DwmAwareCursorPositionPredictor.cs",
    "generatedModel": "src/CursorMirror.Core/DistilledMlpPredictionModel.g.cs",
    "settings": "src/CursorMirror.Core/CursorMirrorSettings.cs",
    "tests": "tests/CursorMirror.Tests/ControllerTests.cs",
}

PRODUCT_CONSTANTS = {
    "modelId": "mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5",
    "sequenceLength": 16,
    "sequenceFeatureCount": 9,
    "scalarFeatureCount": 25,
    "hidden": 8,
    "quantizationStepPx": 0.125,
    "generatedLagCompensationPx": 0.5,
    "minimumRefreshMs": 14.0,
    "maximumRefreshMs": 19.5,
    "maximumPredictionPx": 48.0,
    "defaultPredictionGain": 1.0,
    "stepBaselineHorizonOffsetMs": -2.0,
    "stepBaselineMaximumPredictionPx": 12.0,
    "stepBaselineMinimumEfficiency": 0.35,
    "stepBaselineMinimumSpeedPxPerSecond": 25.0,
    "stationaryMaximumSpeedPxPerSecond": 25.0,
    "stationaryMaximumNetPx": 0.75,
    "stationaryMaximumPathPx": 1.5,
    "defaultDwmPredictionTargetOffsetMs": 2,
    "defaultDwmPredictionHorizonCapMs": 10,
}


def load_step03(root: Path) -> Any:
    script = root / "poc" / "cursor-prediction-v17" / "scripts" / "run-step-03-lag-and-deceleration-ablation.py"
    spec = importlib.util.spec_from_file_location("v17_step03_ablation_for_step05", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-dir", type=Path, default=root / "poc" / "cursor-prediction-v17" / "step-05-product-shape-validation")
    parser.add_argument("--manifest", type=Path, default=root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json")
    parser.add_argument("--runtime", type=Path, default=root / "poc" / "cursor-prediction-v16" / "runtime" / "selected-candidate.json")
    return parser.parse_args()


def descriptor_with_lag(descriptor: dict[str, Any], lag_px: float) -> dict[str, Any]:
    cloned = copy.deepcopy(descriptor)
    cloned["runtime"]["lagCompensationPx"] = lag_px
    return cloned


def clamp_vector(pred: np.ndarray, max_px: float) -> np.ndarray:
    mag = np.sqrt(np.sum(pred * pred, axis=1))
    out = pred.astype(np.float32).copy()
    mask = mag > np.float32(max_px)
    if np.any(mask):
        out[mask] *= (np.float32(max_px) / mag[mask])[:, None]
    return out.astype(np.float32)


def product_stationary_mask(rowv: dict[str, np.ndarray]) -> np.ndarray:
    return (
        (rowv["v2Speed"] <= PRODUCT_CONSTANTS["stationaryMaximumSpeedPxPerSecond"])
        & (rowv["v5Speed"] <= PRODUCT_CONSTANTS["stationaryMaximumSpeedPxPerSecond"])
        & (rowv["v12Speed"] <= PRODUCT_CONSTANTS["stationaryMaximumSpeedPxPerSecond"])
        & (rowv["pathNet"] <= PRODUCT_CONSTANTS["stationaryMaximumNetPx"])
        & (rowv["pathLength"] <= PRODUCT_CONSTANTS["stationaryMaximumPathPx"])
    )


def product_like(
    pred: np.ndarray,
    rowv: dict[str, np.ndarray],
    *,
    gain: float = 1.0,
    stationary_guard: bool = True,
    max_px: float = 48.0,
) -> tuple[np.ndarray, dict[str, Any]]:
    out = pred.astype(np.float32) * np.float32(gain)
    out = clamp_vector(out, max_px)
    stationary = product_stationary_mask(rowv)
    if stationary_guard:
        out[stationary] = 0.0
    return out.astype(np.float32), {
        "stationaryRows": int(np.sum(stationary)),
        "stationaryRate": round(float(np.mean(stationary)), 6),
        "gain": gain,
        "maxPredictionPx": max_px,
        "stationaryGuardApplied": stationary_guard,
    }


def row_stop_snap_mask(rowv: dict[str, np.ndarray]) -> np.ndarray:
    return (
        (rowv["v2Speed"] <= 35.0)
        & (rowv["v5Speed"] <= 50.0)
        & (rowv["v12Speed"] <= 75.0)
        & (rowv["pathNet"] <= 1.25)
        & (rowv["pathLength"] <= 2.5)
    )


def product_like_stop_snap(pred: np.ndarray, rowv: dict[str, np.ndarray]) -> tuple[np.ndarray, dict[str, Any]]:
    out, notes = product_like(pred, rowv)
    snap = row_stop_snap_mask(rowv)
    out[snap] = 0.0
    notes.update({
        "stopSnapRows": int(np.sum(snap)),
        "stopSnapRate": round(float(np.mean(snap)), 6),
        "stopSnapFormula": "v2<=35 && v5<=50 && v12<=75 && pathNet<=1.25 && path<=2.5",
    })
    return out.astype(np.float32), notes


def direction_from_v12(rowv: dict[str, np.ndarray]) -> np.ndarray:
    vec = rowv["v12"].astype(np.float32)
    mag = np.sqrt(np.sum(vec * vec, axis=1))
    out = np.zeros_like(vec)
    mask = mag > 1e-6
    out[mask] = vec[mask] / mag[mask, None]
    return out


def mild_decel_lag_mask(rowv: dict[str, np.ndarray], pred: np.ndarray) -> np.ndarray:
    direction = direction_from_v12(rowv)
    along = np.sum(pred * direction, axis=1)
    cap16 = (rowv["v2Speed"] * np.minimum(rowv["horizonMs"], np.float32(16.0)) / 1000.0) + np.float32(0.75)
    sharp_drop = (
        ((rowv["v12Speed"] >= 500.0) & (rowv["v2Speed"] <= rowv["v12Speed"] * 0.62))
        | ((rowv["v5Speed"] >= 500.0) & (rowv["v2Speed"] <= rowv["v5Speed"] * 0.70))
    )
    path_tight = (rowv["pathEfficiency"] <= 0.60) | ((rowv["pathNet"] <= 3.0) & (rowv["v12Speed"] >= 500.0))
    capacity_exceeded = along > cap16
    return sharp_drop & path_tight & capacity_exceeded


def remove_lag_on_decel(
    core: np.ndarray,
    lag_units: np.ndarray,
    rowv: dict[str, np.ndarray],
    lag_px: float,
) -> tuple[np.ndarray, dict[str, Any]]:
    lagged = core + lag_units * np.float32(lag_px)
    mask = mild_decel_lag_mask(rowv, lagged)
    out = lagged.astype(np.float32).copy()
    out[mask] = core[mask]
    out, notes = product_like(out, rowv)
    notes.update({
        "decelLagRemovedRows": int(np.sum(mask)),
        "decelLagRemovedRate": round(float(np.mean(mask)), 6),
        "decelFormula": "sharp v2 drop vs v5/v12 && tight path && along prediction exceeds 16ms recent capacity +0.75",
    })
    return out.astype(np.float32), notes


def summarize(metric: dict[str, Any]) -> dict[str, Any]:
    all_m = metric["bySlice"]["all"]
    stop = metric["bySlice"]["stopApproach"]
    hard = metric["bySlice"]["hardStopApproach"]
    post = metric["bySlice"]["postStopHold"]
    flip = metric["bySlice"]["directionFlip"]
    return {
        "allMean": all_m["errorPx"]["mean"],
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
        "hardStopSignedMean": hard["signedAlongMotionError"]["mean"],
        "hardStopOvershootP95": hard["overshootPx"]["p95"],
        "hardStopOvershootP99": hard["overshootPx"]["p99"],
        "hardStopOvershootGt1": hard["overshootRateGt1"],
        "hardStopOvershootGt2": hard["overshootRateGt2"],
        "postStopJitterP95": post["postStopJitter"]["p95"],
        "postStopJitterP99": post["postStopJitter"]["p99"],
        "directionFlipPenaltyP95": flip["directionFlipPenalty"]["p95"],
        "directionFlipPenaltyP99": flip["directionFlipPenalty"]["p99"],
        "directionFlipRows": flip["rows"],
    }


def package_breakdown(metric: dict[str, Any]) -> dict[str, Any]:
    return {
        package: {
            "stopP95": payload["errorPx"]["p95"],
            "stopP99": payload["errorPx"]["p99"],
            "stopSignedMean": payload["signedAlongMotionError"]["mean"],
            "stopOvershootP95": payload["overshootPx"]["p95"],
            "stopOvershootP99": payload["overshootPx"]["p99"],
            "stopOvershootGt1": payload["overshootRateGt1"],
            "stopOvershootGt2": payload["overshootRateGt2"],
        }
        for package, payload in metric["byPackageStopApproach"].items()
    }


def runtime_notes(kind: str, formula: str, branches: int, state: str = "stateless") -> dict[str, Any]:
    return {
        "kind": kind,
        "formula": formula,
        "productSafe": True,
        "state": state,
        "allocationRisk": "none; fixed generated arrays already exist, added logic is scalar/branch only",
        "extraBranchesEstimate": branches,
    }


def objectives(item: dict[str, Any], current: dict[str, Any], lag0: dict[str, Any]) -> dict[str, float]:
    s = item["summary"]
    c = current["summary"]
    l0 = lag0["summary"]
    all_reg = max(0.0, float(s["allP95"]) - float(c["allP95"]) - 0.10)
    all_p99_reg = max(0.0, float(s["allP99"]) - float(c["allP99"]) - 0.35)
    stop_reg_vs_lag0 = max(0.0, float(s["stopP95"]) - float(l0["stopP95"]) - 0.20)
    stop_p99_reg_vs_lag0 = max(0.0, float(s["stopP99"]) - float(l0["stopP99"]) - 0.35)
    lag_too_negative = max(0.0, -2.0 - float(s["stopSignedMean"]))
    high_speed_reg = max(0.0, float(s["highSpeedP95"]) - float(c["highSpeedP95"]) - 0.20)
    balanced = (
        float(s["stopOvershootP95"])
        + 0.22 * float(s["stopOvershootP99"])
        + 1.0 * float(s["stopOvershootGt1"])
        + 1.4 * float(s["stopOvershootGt2"])
        + 0.55 * float(s["postStopJitterP95"])
        + 3.5 * all_reg
        + 1.0 * all_p99_reg
        + 1.8 * stop_reg_vs_lag0
        + 0.8 * stop_p99_reg_vs_lag0
        + 0.6 * lag_too_negative
        + 0.8 * high_speed_reg
    )
    visual = (
        float(s["postStopJitterP95"])
        + 0.35 * float(s["postStopJitterP99"])
        + 0.55 * float(s["stopOvershootP95"])
        + 0.30 * float(s["hardStopOvershootP95"])
        + 0.6 * lag_too_negative
        + 2.0 * all_reg
    )
    overshoot = (
        float(s["stopOvershootP95"])
        + 0.35 * float(s["stopOvershootP99"])
        + 1.8 * float(s["stopOvershootGt1"])
        + 2.4 * float(s["stopOvershootGt2"])
        + 0.65 * float(s["hardStopOvershootP95"])
        + 1.2 * stop_reg_vs_lag0
        + 0.5 * lag_too_negative
    )
    return {
        "balanced": round(balanced, 6),
        "visualRiskFocused": round(visual, 6),
        "overshootFocused": round(overshoot, 6),
    }


def add_high_speed_summary(item: dict[str, Any], metric: dict[str, Any], vectors: dict[str, np.ndarray], pred: np.ndarray, bundle: Any) -> None:
    target = bundle.target.astype(np.float32)
    err = pred - target
    euclid = np.sqrt(np.sum(err * err, axis=1))
    mask = vectors["recentSpeed"] >= 1800.0
    item["summary"]["highSpeedRows"] = int(np.sum(mask))
    item["summary"]["highSpeedP95"] = None if not np.sum(mask) else round(float(np.percentile(euclid[mask], 95)), 4)
    item["summary"]["highSpeedP99"] = None if not np.sum(mask) else round(float(np.percentile(euclid[mask], 99)), 4)


def compact_candidate(
    model_id: str,
    metric: dict[str, Any],
    pred: np.ndarray,
    bundle: Any,
    vectors: dict[str, np.ndarray],
    notes: dict[str, Any],
    runtime_note: dict[str, Any],
) -> dict[str, Any]:
    item = {
        "modelId": model_id,
        "summary": summarize(metric),
        "runtimeNotes": runtime_note,
        "productShape": notes,
        "bySplit": metric["bySplit"],
        "byPackageStopApproach": package_breakdown(metric),
        "rawMetrics": metric["bySlice"],
        "worstStopApproachExamples": metric["worstStopApproachExamples"],
    }
    add_high_speed_summary(item, metric, vectors, pred, bundle)
    return item


def write_outputs(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    rows = []
    for item in scores["ranking"]["balanced"]:
        s = item["summary"]
        rows.append(
            f"| {item['modelId']} | {item['runtimeNotes']['kind']} | {s['allMean']} | {s['allP95']} | {s['allP99']} | "
            f"{s['stopP95']} | {s['stopP99']} | {s['stopSignedMean']} | {s['stopOvershootP95']} | {s['stopOvershootP99']} | "
            f"{s['stopOvershootGt1']} | {s['stopOvershootGt2']} | {s['hardStopOvershootP95']} | {s['postStopJitterP95']} | "
            f"{s['directionFlipPenaltyP95']} | {s['highSpeedP95']} | {item['objectives']['balanced']} |"
        )
    package_rows = []
    for model_id in scores["reportModels"]:
        item = scores["candidates"][model_id]
        for package, p in item["byPackageStopApproach"].items():
            package_rows.append(
                f"| {model_id} | {package} | {p['stopP95']} | {p['stopP99']} | {p['stopSignedMean']} | "
                f"{p['stopOvershootP95']} | {p['stopOvershootP99']} | {p['stopOvershootGt1']} | {p['stopOvershootGt2']} |"
            )

    selected = scores["selectedRecommendation"]
    optional = scores["optionalBestVariant"]
    report = f"""# Step 05 - Product-Shape Validation

## Scope

Step 05 validates whether the Step 4 `fixed_lag0p0` recommendation still holds when approximating the current product runtime shape. This run is CPU-only fixed inference and lightweight aggregation; no GPU training or model search was run.

## Product Runtime Read

Files read:

- `{PRODUCT_FILES['predictor']}`: DistilledMLP is evaluated only when refresh is 14.0-19.5 ms, horizon is positive, history has 15 prior samples, stationary guard does not fire, then `_gain` and a 48 px clamp are applied.
- `{PRODUCT_FILES['generatedModel']}`: generated model id `{PRODUCT_CONSTANTS['modelId']}`, q0.125 output quantization, hardtanh h8 FSMN/MLP, generated lag compensation 0.5 px.
- `{PRODUCT_FILES['settings']}`: default gain is 100%, default DistilledMLP target offset setting is 2 ms, prediction model default remains ConstantVelocity unless selected.
- `{PRODUCT_FILES['tests']}`: controller tests exercise DistilledMLP moving output and stationary fallback.

Constants mirrored in this POC:

```json
{json.dumps(PRODUCT_CONSTANTS, indent=2)}
```

POC approximation caveat: the evaluation rows are already the v12/v14-v16 60Hz dataset rows, so history warmup and feature construction are inherited from the POC loader. The Step 5 post-processing mirrors the product-side guard/scale/clamp around those rows instead of replaying the full C# predictor state machine sample by sample.

## Dataset

- Rows: {scores['dataset']['rows']}
- Slice counts: `{scores['sliceCounts']}`
- Stationary rows caught by product guard: {scores['productShapeSummary']['stationaryRows']} ({scores['productShapeSummary']['stationaryRate']})

## Ranking

| candidate | kind | all mean | all p95 | all p99 | stop p95 | stop p99 | stop signed | stop over p95 | stop over p99 | over >1 | over >2 | hard over p95 | post jitter p95 | flip penalty p95 | high speed p95 | balanced |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

## Package Breakdown

| candidate | package | stop p95 | stop p99 | signed mean | overshoot p95 | overshoot p99 | overshoot >1 | overshoot >2 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(package_rows)}

## Recommendation

Recommended product-shape candidate: `{selected['modelId']}`.

- Runtime formula: `{selected['runtimeNotes']['formula']}`
- Runtime notes: `{selected['runtimeNotes']}`
- Summary: `{selected['summary']}`

Optional visual-risk variant: `{optional['modelId']}`. It is useful if post-stop jitter is prioritized above absolute simplicity, but it adds a small near-stop branch and did not improve stop-approach overshoot versus `product_lag0`.

## Visual Interpretation

{scores['visualInterpretation']}

## Adoption Decision

{scores['adoptionDecision']}

## Next Steps

{scores['nextStepsText']}
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    notes = f"""# Step 05 Notes

- CPU-only fixed inference and lightweight aggregation.
- No product source files were edited.
- Product code read:
  - `{PRODUCT_FILES['predictor']}`
  - `{PRODUCT_FILES['generatedModel']}`
  - `{PRODUCT_FILES['settings']}`
  - `{PRODUCT_FILES['tests']}`
- Product-like candidates include current lag0.5, lag0, lag0.0625, lag0.125, plus two light product-safe diagnostics.
- Full C# state-machine replay is still pending; this step uses the existing 60Hz POC row construction and mirrors product-side post-processing.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")


def append_experiment_log(root: Path, scores: dict[str, Any]) -> None:
    log_path = root / "poc" / "cursor-prediction-v17" / "experiment-log.md"
    selected = scores["selectedRecommendation"]
    s = selected["summary"]
    entry = f"""

## Step 05 - Product-Shape Validation ({scores['generatedAtUtc']})

- Ran CPU-only fixed inference with product-like stationary guard/gain/clamp around v16 DistilledMLP predictions.
- Recommendation: `{selected['modelId']}`.
- Key scores: all p95/p99 {s['allP95']}/{s['allP99']}, stop p95/p99 {s['stopP95']}/{s['stopP99']}, stop overshoot p95/p99 {s['stopOvershootP95']}/{s['stopOvershootP99']}, post-stop jitter p95/p99 {s['postStopJitterP95']}/{s['postStopJitterP99']}.
- Product caveat: full C# predictor replay was not compiled/run; POC mirrors product-side constants and branches on existing 60Hz rows.
"""
    existing = log_path.read_text(encoding="utf-8") if log_path.exists() else "# Experiment Log\n"
    log_path.write_text(existing.rstrip() + entry + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    step03 = load_step03(args.root)
    step02 = step03.load_step02(args.root)
    module = step02.load_poc13_module(args.root)
    context = module.load_manifest(args.manifest)
    packages = [module.load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    rows, build_summary = module.build_rows(packages)
    rows = [row for row in rows if row["refreshBucket"] == "60Hz"]
    bundle = module.build_dataset(rows)
    descriptor = json.loads(args.runtime.read_text(encoding="utf-8"))
    vectors = step02.vector_arrays(bundle)
    rowv = step03.row_vectors(bundle)
    masks = step02.masks_for(bundle, vectors)
    lag_units = step02.lag_units_from_source(bundle, descriptor)
    core = step02.runtime_predict(bundle, descriptor_with_lag(descriptor, 0.0))

    candidate_preds: dict[str, dict[str, Any]] = {}
    for model_id, lag in (
        ("current_product_like", 0.5),
        ("product_lag0", 0.0),
        ("product_lag0p0625", 0.0625),
        ("product_lag0p125", 0.125),
    ):
        pred = core + lag_units * np.float32(lag)
        shaped, shape_notes = product_like(pred, rowv)
        candidate_preds[model_id] = {
            "prediction": shaped,
            "shapeNotes": shape_notes,
            "runtimeNotes": runtime_notes(
                "product_like_fixed_lag",
                f"generated MLP q0.125 + lag {lag}px + gain1.0 + stationary fallback + clamp48",
                2,
            ),
        }

    snap_pred, snap_notes = product_like_stop_snap(core, rowv)
    candidate_preds["product_lag0_stop_snap_light"] = {
        "prediction": snap_pred,
        "shapeNotes": snap_notes,
        "runtimeNotes": runtime_notes(
            "product_like_lag0_plus_light_stop_snap",
            "lag0 plus extra near-stop snap guard using current v2/v5/v12/path only",
            4,
        ),
    }
    decel_pred, decel_notes = remove_lag_on_decel(core, lag_units, rowv, 0.5)
    candidate_preds["product_lag0p5_remove_lag_on_decel"] = {
        "prediction": decel_pred,
        "shapeNotes": decel_notes,
        "runtimeNotes": runtime_notes(
            "product_like_lag0p5_remove_lag_on_decel",
            "lag0.5 normally; remove lag only when runtime decel/capacity mask fires",
            5,
        ),
    }

    metrics = {
        model_id: step02.model_metrics(model_id, payload["prediction"], bundle, vectors, masks)
        for model_id, payload in candidate_preds.items()
    }
    candidates = {}
    for model_id, metric in metrics.items():
        candidates[model_id] = compact_candidate(
            model_id,
            metric,
            candidate_preds[model_id]["prediction"],
            bundle,
            vectors,
            candidate_preds[model_id]["shapeNotes"],
            candidate_preds[model_id]["runtimeNotes"],
        )

    current = candidates["current_product_like"]
    lag0 = candidates["product_lag0"]
    for item in candidates.values():
        item["objectives"] = objectives(item, current, lag0)

    ranking = {
        key: sorted(candidates.values(), key=lambda item: (item["objectives"][key], item["summary"]["allP95"], item["summary"]["stopP95"]))
        for key in ("balanced", "visualRiskFocused", "overshootFocused")
    }
    objective_best = ranking["balanced"][0]
    current_s = current["summary"]
    lag0_s = lag0["summary"]
    clear_lag0 = (
        lag0_s["stopOvershootP95"] < current_s["stopOvershootP95"]
        and lag0_s["postStopJitterP95"] < current_s["postStopJitterP95"]
        and lag0_s["allP95"] <= current_s["allP95"] + 0.10
        and lag0_s["allP99"] <= current_s["allP99"] + 0.35
    )
    selected = lag0 if clear_lag0 else objective_best

    visual_interpretation = (
        f"Stationary jitter: product_lag0 postStopJitter p95/p99 is {lag0_s['postStopJitterP95']}/{lag0_s['postStopJitterP99']} "
        f"versus current_product_like {current_s['postStopJitterP95']}/{current_s['postStopJitterP99']}; removing lag directly lowers visible post-stop motion. "
        f"Deceleration overshoot: product_lag0 stop overshoot p95/p99 is {lag0_s['stopOvershootP95']}/{lag0_s['stopOvershootP99']} "
        f"versus current {current_s['stopOvershootP95']}/{current_s['stopOvershootP99']}. "
        f"Always-lag risk: product_lag0 stop signed mean is {lag0_s['stopSignedMean']}, more negative than current {current_s['stopSignedMean']}, "
        "so it can look slightly behind during stop approach even as it avoids leading past the real cursor. "
        f"High-speed degradation: product_lag0 highSpeed p95/p99 is {lag0_s['highSpeedP95']}/{lag0_s['highSpeedP99']} "
        f"versus current {current_s['highSpeedP95']}/{current_s['highSpeedP99']}; this is the main guardrail for not making fast movement feel worse."
    )
    if clear_lag0:
        adoption = (
            "`product_lag0` is the product reflection candidate: it preserves product-like guard/gain/clamp behavior, removes only generated lag compensation, "
            "and improves the two visual-risk metrics targeted by v17 without a large all-slice regression."
        )
    else:
        adoption = (
            f"`{objective_best['modelId']}` ranks best in the product-shape objective. `product_lag0` remains the simplest lag-only candidate, "
            "but adoption should wait for guardrail deltas and full product replay to be reviewed."
        )

    next_steps = [
        "Generate a lag0 variant of the runtime JSON/C# and run parity against the Python descriptor.",
        "Replay a small C# predictor harness over the same 60Hz traces to verify target offset, horizon cap, and fallback ordering exactly.",
        "If lag0 still feels too delayed, train or distill a no-lag target instead of adding a post-hoc lag offset.",
        "Add a minimal deceleration-aware output head or runtime confidence only if lag0 fails visual review on fast movement.",
    ]
    next_steps_text = "\n".join(f"- {item}" for item in next_steps)

    report_models = []
    for model_id in ("current_product_like", "product_lag0", "product_lag0p0625", "product_lag0p125", selected["modelId"]):
        if model_id not in report_models:
            report_models.append(model_id)

    stationary = product_stationary_mask(rowv)
    scores = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "constraints": {
            "rawDataCopied": False,
            "expandedCsvWritten": False,
            "checkpointWritten": False,
            "tensorDumpWritten": False,
            "gpuTrainingRun": False,
            "analysis": "CPU-only fixed inference and product-shape post-processing validation",
            "productSourceEdited": False,
        },
        "inputs": {
            "manifest": str(args.manifest.relative_to(args.root)),
            "runtimeDescriptor": str(args.runtime.relative_to(args.root)),
            "loader": "poc/cursor-prediction-v13/scripts/run-deep-learning-gpu.py",
            "productFilesRead": PRODUCT_FILES,
        },
        "productConstants": PRODUCT_CONSTANTS,
        "baseModelId": descriptor["modelId"],
        "dataset": bundle.summary,
        "buildSummary": build_summary,
        "sliceCounts": {name: int(np.sum(mask)) for name, mask in masks.items()},
        "slicePackageCounts": {
            name: dict(Counter(vectors["package"][mask]))
            for name, mask in masks.items()
        },
        "productShapeSummary": {
            "stationaryRows": int(np.sum(stationary)),
            "stationaryRate": round(float(np.mean(stationary)), 6),
            "historyWarmup": "POC rows already require the v16/v13 sequence features; product requires 15 prior samples before DistilledMLP.",
            "refreshGate": "Only 60Hz rows are evaluated; product accepts 14.0-19.5 ms refresh period.",
            "fullCSharpReplay": "pending",
        },
        "candidates": candidates,
        "ranking": ranking,
        "selectedRecommendation": selected,
        "objectiveBestVariant": objective_best,
        "optionalBestVariant": objective_best if objective_best["modelId"] != selected["modelId"] else selected,
        "reportModels": report_models,
        "visualInterpretation": visual_interpretation,
        "adoptionDecision": adoption,
        "nextSteps": next_steps,
        "nextStepsText": next_steps_text,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    write_outputs(args.out_dir, scores)
    append_experiment_log(args.root, scores)
    print(json.dumps({
        "step": "05",
        "rows": bundle.summary["rows"],
        "candidateCount": len(candidate_preds),
        "recommendation": selected["modelId"],
        "summary": selected["summary"],
        "elapsedSeconds": scores["elapsedSeconds"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
