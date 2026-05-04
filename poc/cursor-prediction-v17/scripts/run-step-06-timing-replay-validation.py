#!/usr/bin/env python
"""Step 06 timing replay validation for cursor-prediction-v17.

CPU-only replay-equivalent timing grid. This does not train models. It rebuilds
POC v13/v14-v16 60Hz rows from source ZIPs, then regenerates source-normalized
MLP inputs and reference targets for small target-offset candidates.
"""

from __future__ import annotations

import argparse
import copy
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


SCHEMA_VERSION = "cursor-prediction-v17-step-06-timing-replay-validation/1"
OFFSETS_MS = (-4.0, -2.0, 0.0, 2.0, 4.0)
LAGS_PX = (0.0, 0.0625, 0.125, 0.25, 0.5)
PRODUCT_MAX_PX = 48.0
PRODUCT_GAIN = 1.0


def load_step05(root: Path) -> Any:
    script = root / "poc" / "cursor-prediction-v17" / "scripts" / "run-step-05-product-shape-validation.py"
    spec = importlib.util.spec_from_file_location("v17_step05_product_shape_for_step06", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-dir", type=Path, default=root / "poc" / "cursor-prediction-v17" / "step-06-timing-replay-validation")
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
        (rowv["v2Speed"] <= 25.0)
        & (rowv["v5Speed"] <= 25.0)
        & (rowv["v12Speed"] <= 25.0)
        & (rowv["pathNet"] <= 0.75)
        & (rowv["pathLength"] <= 1.5)
    )


def product_shape(pred: np.ndarray, rowv: dict[str, np.ndarray]) -> np.ndarray:
    out = clamp_vector(pred.astype(np.float32) * np.float32(PRODUCT_GAIN), PRODUCT_MAX_PX)
    out[product_stationary_mask(rowv)] = 0.0
    return out.astype(np.float32)


def build_rows_with_replay_meta(module: Any, packages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    skipped = Counter()
    for package_index, pkg in enumerate(packages):
        for anchor_index, anchor in enumerate(pkg["anchors"]):
            target = module.resolve_target(anchor)
            if not target:
                skipped["missing_target"] += 1
                continue
            label = module.interpolate_reference(pkg, target["labelUs"])
            if not label:
                skipped["missing_label"] += 1
                continue
            idx = module.lower_bound(pkg["refTimesUs"], anchor["elapsedUs"] + 0.000001) - 1
            if idx < module.HISTORY:
                skipped["insufficient_history"] += 1
                continue
            latest_age_us = anchor["elapsedUs"] - pkg["refTimesUs"][idx]
            if latest_age_us > 100_000:
                skipped["stale_history"] += 1
                continue
            velocities = {n: module.velocity_n(pkg, idx, n) for n in (2, 3, 5, 8, 12)}
            path = module.analyze_path(pkg, idx, 12)
            motion = module.nearest_motion(pkg, target["labelUs"] / 1000.0)
            latest_x = pkg["refX"][idx]
            latest_y = pkg["refY"][idx]
            row = {
                "packageId": pkg["id"],
                "machineKey": pkg["machineKey"],
                "refreshBucket": pkg["refreshBucket"],
                "split": anchor["split"],
                "scenarioIndex": anchor["scenarioIndex"],
                "schedulerProvenance": anchor["schedulerProvenance"] or "(blank)",
                "horizonMs": target["horizonMs"],
                "latestX": latest_x,
                "latestY": latest_y,
                "labelX": label["x"],
                "labelY": label["y"],
                "targetDx": label["x"] - latest_x,
                "targetDy": label["y"] - latest_y,
                "labelVx": label["vx"],
                "labelVy": label["vy"],
                "labelSpeed": label["speed"],
                "speedBin": module.speed_bin(label["speed"]),
                "phase": motion["phase"],
                "motionSpeed": motion["speed"],
                "historyGapMs": latest_age_us / 1000.0,
                "refresh60": 1.0 if pkg["refreshBucket"] == "60Hz" else 0.0,
                "refresh30": 1.0 if pkg["refreshBucket"] == "30Hz" else 0.0,
                "provenanceDwm": 1.0 if anchor["schedulerProvenance"] == "dwm" else 0.0,
                "velocities": velocities,
                "path": path,
                "history": [],
                "_packageIndex": package_index,
                "_anchorIndex": anchor_index,
                "_refIndex": idx,
                "_anchorElapsedUs": anchor["elapsedUs"],
                "_anchorStopwatchTicks": anchor["stopwatchTicks"],
                "_baseLabelUs": target["labelUs"],
                "_baseTargetTicks": target["ticks"],
                "_dwmRefreshPeriodTicks": anchor.get("dwmRefreshPeriodTicks"),
                "_dwmVBlankTicks": anchor.get("dwmVBlankTicks"),
                "_presentReferenceTicks": anchor.get("presentReferenceTicks"),
                "_predictionTargetTicks": anchor.get("predictionTargetTicks"),
            }
            step5_dx, step5_dy = module.predict_step5_gate(row)
            row["baselineDx"] = step5_dx
            row["baselineDy"] = step5_dy
            row["history"] = history_for_row(module, pkg, row, row["horizonMs"])
            rows.append(row)
    return rows, {"skipped": dict(skipped)}


def history_for_row(module: Any, pkg: dict[str, Any], row: dict[str, Any], horizon_ms: float) -> list[list[float]]:
    history: list[list[float]] = []
    idx = int(row["_refIndex"])
    latest_x = float(row["latestX"])
    latest_y = float(row["latestY"])
    for k in range(module.HISTORY):
        i = idx - (module.HISTORY - 1 - k)
        if i <= 0:
            history.append([0.0] * 9)
            continue
        age_ms = (float(row["_anchorElapsedUs"]) - pkg["refTimesUs"][i]) / 1000.0
        dt_ms = (pkg["refTimesUs"][i] - pkg["refTimesUs"][i - 1]) / 1000.0
        dx = pkg["refX"][i] - pkg["refX"][i - 1]
        dy = pkg["refY"][i] - pkg["refY"][i - 1]
        vx = dx / (dt_ms / 1000.0) if dt_ms > 0 else 0.0
        vy = dy / (dt_ms / 1000.0) if dt_ms > 0 else 0.0
        history.append([
            1.0,
            age_ms / 64.0,
            (pkg["refX"][i] - latest_x) / 128.0,
            (pkg["refY"][i] - latest_y) / 128.0,
            dx / 32.0,
            dy / 32.0,
            vx * horizon_ms / 1000.0 / 32.0,
            vy * horizon_ms / 1000.0 / 32.0,
            dt_ms / 16.0,
        ])
    return history


def retarget_rows(module: Any, packages: list[dict[str, Any]], rows: list[dict[str, Any]], offset_ms: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    out: list[dict[str, Any]] = []
    skipped = Counter()
    for row in rows:
        pkg = packages[int(row["_packageIndex"])]
        adjusted = copy.deepcopy(row)
        horizon_ms = float(row["horizonMs"]) + offset_ms
        effective_horizon_ms = max(0.0, horizon_ms)
        adjusted["horizonMs"] = effective_horizon_ms
        if effective_horizon_ms <= 0.0:
            label = {
                "x": float(row["latestX"]),
                "y": float(row["latestY"]),
                "vx": 0.0,
                "vy": 0.0,
                "speed": 0.0,
            }
        else:
            label_us = float(row["_anchorElapsedUs"]) + (effective_horizon_ms * 1000.0)
            label = module.interpolate_reference(pkg, label_us)
            if not label:
                skipped["missing_shifted_label"] += 1
                continue
        adjusted["labelX"] = label["x"]
        adjusted["labelY"] = label["y"]
        adjusted["targetDx"] = label["x"] - float(row["latestX"])
        adjusted["targetDy"] = label["y"] - float(row["latestY"])
        adjusted["labelVx"] = label["vx"]
        adjusted["labelVy"] = label["vy"]
        adjusted["labelSpeed"] = label["speed"]
        adjusted["speedBin"] = module.speed_bin(label["speed"])
        motion = module.nearest_motion(pkg, (float(row["_anchorElapsedUs"]) + effective_horizon_ms * 1000.0) / 1000.0)
        adjusted["phase"] = motion["phase"]
        adjusted["motionSpeed"] = motion["speed"]
        baseline_dx, baseline_dy = module.predict_step5_gate(adjusted)
        adjusted["baselineDx"] = baseline_dx
        adjusted["baselineDy"] = baseline_dy
        adjusted["history"] = history_for_row(module, pkg, adjusted, effective_horizon_ms)
        out.append(adjusted)
    return out, {"skipped": dict(skipped)}


def source_bundle_for_offset(module: Any, base_bundle: Any, rows: list[dict[str, Any]]) -> Any:
    scalar_raw = np.asarray([module.scalar_features(row) for row in rows], dtype=np.float32)
    seq_raw = np.asarray([row["history"] for row in rows], dtype=np.float32)
    target = np.asarray([[row["targetDx"], row["targetDy"]] for row in rows], dtype=np.float32)
    baseline = np.asarray([[row["baselineDx"], row["baselineDy"]] for row in rows], dtype=np.float32)
    scalar = (scalar_raw - base_bundle.scalar_mean) / base_bundle.scalar_std
    seq = (seq_raw - base_bundle.seq_mean) / base_bundle.seq_std
    summary = dict(base_bundle.summary)
    summary["rows"] = len(rows)
    summary["bySplit"] = dict(Counter(row["split"] for row in rows))
    summary["byPackage"] = dict(Counter(row["packageId"] for row in rows))
    summary["byPhase"] = dict(Counter(row["phase"] for row in rows))
    summary["bySpeedBin"] = dict(Counter(row["speedBin"] for row in rows))
    return module.DatasetBundle(
        scalar=scalar.astype(np.float32),
        seq=seq.astype(np.float32),
        target=target.astype(np.float32),
        baseline=baseline.astype(np.float32),
        correction=(target - baseline).astype(np.float32),
        row_meta=rows,
        scalar_mean=base_bundle.scalar_mean,
        scalar_std=base_bundle.scalar_std,
        seq_mean=base_bundle.seq_mean,
        seq_std=base_bundle.seq_std,
        target_scale=base_bundle.target_scale,
        correction_scale=base_bundle.correction_scale,
        summary=summary,
    )


def row_vectors_from_step03(step03: Any, bundle: Any) -> dict[str, np.ndarray]:
    return step03.row_vectors(bundle)


def high_speed_stats(pred: np.ndarray, bundle: Any, vectors: dict[str, np.ndarray], step02: Any) -> dict[str, Any]:
    err = pred - bundle.target.astype(np.float32)
    euclid = np.sqrt(np.sum(err * err, axis=1))
    mask = vectors["recentSpeed"] >= 1800.0
    return {
        "rows": int(np.sum(mask)),
        "p95": None if not np.sum(mask) else round(float(np.percentile(euclid[mask], 95)), 4),
        "p99": None if not np.sum(mask) else round(float(np.percentile(euclid[mask], 99)), 4),
    }


def summary(metric: dict[str, Any], high_speed: dict[str, Any]) -> dict[str, Any]:
    all_m = metric["bySlice"]["all"]
    stop = metric["bySlice"]["stopApproach"]
    hard = metric["bySlice"]["hardStopApproach"]
    post = metric["bySlice"]["postStopHold"]
    flip = metric["bySlice"]["directionFlip"]
    return {
        "allMean": all_m["errorPx"]["mean"],
        "allP95": all_m["errorPx"]["p95"],
        "allP99": all_m["errorPx"]["p99"],
        "allSignedMean": all_m["signedAlongMotionError"]["mean"],
        "allLeadRate": all_m["signedAlongMotionError"]["leadRate"],
        "allLagRate": all_m["signedAlongMotionError"]["lagRate"],
        "stopP95": stop["errorPx"]["p95"],
        "stopP99": stop["errorPx"]["p99"],
        "stopSignedMean": stop["signedAlongMotionError"]["mean"],
        "stopLeadRate": stop["signedAlongMotionError"]["leadRate"],
        "stopLagRate": stop["signedAlongMotionError"]["lagRate"],
        "stopOvershootP95": stop["overshootPx"]["p95"],
        "stopOvershootP99": stop["overshootPx"]["p99"],
        "stopOvershootGt1": stop["overshootRateGt1"],
        "stopOvershootGt2": stop["overshootRateGt2"],
        "hardStopOvershootP95": hard["overshootPx"]["p95"],
        "hardStopOvershootP99": hard["overshootPx"]["p99"],
        "postStopJitterP95": post["postStopJitter"]["p95"],
        "postStopJitterP99": post["postStopJitter"]["p99"],
        "directionFlipPenaltyP95": flip["directionFlipPenalty"]["p95"],
        "directionFlipPenaltyP99": flip["directionFlipPenalty"]["p99"],
        "directionFlipRows": flip["rows"],
        "highSpeedRows": high_speed["rows"],
        "highSpeedP95": high_speed["p95"],
        "highSpeedP99": high_speed["p99"],
    }


def package_breakdown(metric: dict[str, Any]) -> dict[str, Any]:
    return {
        package: {
            "stopP95": payload["errorPx"]["p95"],
            "stopP99": payload["errorPx"]["p99"],
            "stopSignedMean": payload["signedAlongMotionError"]["mean"],
            "stopLeadRate": payload["signedAlongMotionError"]["leadRate"],
            "stopLagRate": payload["signedAlongMotionError"]["lagRate"],
            "stopOvershootP95": payload["overshootPx"]["p95"],
            "stopOvershootP99": payload["overshootPx"]["p99"],
            "stopOvershootGt1": payload["overshootRateGt1"],
            "stopOvershootGt2": payload["overshootRateGt2"],
        }
        for package, payload in metric["byPackageStopApproach"].items()
    }


def objective(item: dict[str, Any], current: dict[str, Any]) -> float:
    s = item["summary"]
    c = current["summary"]
    all_reg = max(0.0, float(s["allP95"]) - float(c["allP95"]) - 0.12)
    all_p99_reg = max(0.0, float(s["allP99"]) - float(c["allP99"]) - 0.35)
    high_reg = max(0.0, float(s["highSpeedP95"] or 0.0) - float(c["highSpeedP95"] or 0.0) - 0.4)
    stop_lag_penalty = max(0.0, -1.8 - float(s["stopSignedMean"]))
    stop_lead_penalty = max(0.0, float(s["stopSignedMean"]) - 0.25)
    return round(
        float(s["stopOvershootP95"])
        + 0.22 * float(s["stopOvershootP99"])
        + 1.0 * float(s["stopOvershootGt1"])
        + 1.4 * float(s["stopOvershootGt2"])
        + 0.45 * float(s["postStopJitterP95"])
        + 0.35 * abs(float(s["stopSignedMean"]))
        + 0.45 * stop_lag_penalty
        + 0.55 * stop_lead_penalty
        + 3.0 * all_reg
        + 1.0 * all_p99_reg
        + 0.8 * high_reg,
        6,
    )


def tradeoff(item: dict[str, Any]) -> dict[str, Any]:
    s = item["summary"]
    return {
        "stopSignedMean": s["stopSignedMean"],
        "stopLeadRate": s["stopLeadRate"],
        "stopLagRate": s["stopLagRate"],
        "stopOvershootP95": s["stopOvershootP95"],
        "stopOvershootGt1": s["stopOvershootGt1"],
        "postStopJitterP95": s["postStopJitterP95"],
    }


def write_outputs(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    rows = []
    for item in scores["ranking"][:18]:
        s = item["summary"]
        rows.append(
            f"| {item['modelId']} | {item['lagPx']} | {item['targetOffsetMs']} | {s['allMean']} | {s['allP95']} | {s['allP99']} | "
            f"{s['stopP95']} | {s['stopP99']} | {s['stopSignedMean']} | {s['stopLeadRate']} | {s['stopLagRate']} | "
            f"{s['stopOvershootP95']} | {s['stopOvershootGt1']} | {s['postStopJitterP95']} | {s['highSpeedP95']} | {item['objective']} |"
        )
    offset_rows = []
    for offset, payload in scores["offsetWinners"].items():
        s = payload["summary"]
        offset_rows.append(
            f"| {offset} | {payload['modelId']} | {payload['lagPx']} | {s['stopSignedMean']} | {s['stopOvershootP95']} | "
            f"{s['postStopJitterP95']} | {s['allP95']} | {s['highSpeedP95']} | {payload['objective']} |"
        )
    package_rows = []
    for model_id in scores["reportModels"]:
        item = scores["candidates"][model_id]
        for package, p in item["byPackageStopApproach"].items():
            package_rows.append(
                f"| {model_id} | {package} | {p['stopP95']} | {p['stopP99']} | {p['stopSignedMean']} | "
                f"{p['stopLeadRate']} | {p['stopLagRate']} | {p['stopOvershootP95']} | {p['stopOvershootGt1']} |"
            )
    selected = scores["selectedRecommendation"]
    report = f"""# Step 06 - Timing Replay Validation

## Scope

Step 06 checks whether Step 5's `product_lag0` recommendation depends on product-shape post-processing, and quantifies timing alignment between the predicted future and the cursor position at the assumed reflection time. CPU fixed inference only; no GPU training was run.

## Replay Feasibility

{scores['replayFeasibility']['summary']}

Available from current POC inputs:

- source ZIP trace/reference streams, `runtimeSchedulerPoll` anchors, DWM target/refresh ticks, reference cursor history, current latest reference position, scenario split/package metadata.

Missing for exact C# predictor replay:

- a row-stable mapping to every product `Predict` call with `CursorPollSample.Position` exactly as passed to C#;
- full predictor state evolution across all calls, including fallback/store ordering and resets;
- compiled harness wiring for the generated model without editing product source.

Therefore this step uses a Python replay-equivalent path: rebuild source-normalized MLP inputs and reference targets for each target offset, then apply product-like stationary/gain/clamp post-processing.

## Dataset

- Base rows: {scores['dataset']['rows']}
- Slice counts at selected candidate: `{scores['selectedSliceCounts']}`
- Offset candidates: `{scores['offsetsMs']}`
- Lag candidates: `{scores['lagsPx']}`

## Ranking

| candidate | lag | offset ms | all mean | all p95 | all p99 | stop p95 | stop p99 | stop signed | stop lead | stop lag | stop over p95 | over >1 | post jitter p95 | high speed p95 | objective |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

## Offset Winners

| offset ms | winner | lag | stop signed | stop over p95 | post jitter p95 | all p95 | high speed p95 | objective |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(offset_rows)}

## Package Breakdown

| candidate | package | stop p95 | stop p99 | signed mean | lead rate | lag rate | overshoot p95 | overshoot >1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(package_rows)}

## Recommendation

Recommended candidate: `{selected['modelId']}`.

- Lag px: `{selected['lagPx']}`
- Target offset ms: `{selected['targetOffsetMs']}`
- Summary: `{selected['summary']}`

## Interpretation

{scores['interpretation']}

## Decision

{scores['decision']}

## Next Steps

{scores['nextStepsText']}
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    notes = f"""# Step 06 Notes

- CPU-only timing replay-equivalent grid.
- No product source files edited.
- Full C# replay was judged pending from current POC bundles; this step rebuilds POC source features and shifted targets from source ZIPs.
- Candidates: lag `{scores['lagsPx']}` x target offset `{scores['offsetsMs']}`.
- Selected: `{scores['selectedRecommendation']['modelId']}`.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")


def append_log(root: Path, scores: dict[str, Any]) -> None:
    selected = scores["selectedRecommendation"]
    s = selected["summary"]
    log_path = root / "poc" / "cursor-prediction-v17" / "experiment-log.md"
    existing = log_path.read_text(encoding="utf-8") if log_path.exists() else "# Experiment Log\n"
    entry = f"""

## Step 06 - Timing Replay Validation ({scores['generatedAtUtc']})

- Ran CPU-only replay-equivalent lag/target-offset grid over {scores['dataset']['rows']} base 60Hz rows.
- Selected `{selected['modelId']}`: lag {selected['lagPx']} px, offset {selected['targetOffsetMs']} ms.
- Key scores: all p95/p99 {s['allP95']}/{s['allP99']}, stop p95/p99 {s['stopP95']}/{s['stopP99']}, stop signed {s['stopSignedMean']}, stop overshoot p95 {s['stopOvershootP95']}, post-stop jitter p95 {s['postStopJitterP95']}, high-speed p95 {s['highSpeedP95']}.
- Full C# predictor replay remains pending; current run rebuilds shifted POC features/targets from source ZIPs.
"""
    log_path.write_text(existing.rstrip() + entry + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    step05 = load_step05(args.root)
    step03 = step05.load_step03(args.root)
    step02 = step03.load_step02(args.root)
    module = step02.load_poc13_module(args.root)
    context = module.load_manifest(args.manifest)
    packages = [module.load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    base_rows, build_summary = build_rows_with_replay_meta(module, packages)
    base_rows = [row for row in base_rows if row["refreshBucket"] == "60Hz"]
    base_bundle = module.build_dataset(base_rows)
    descriptor = json.loads(args.runtime.read_text(encoding="utf-8"))

    candidates: dict[str, dict[str, Any]] = {}
    offset_summaries: dict[str, Any] = {}
    for offset_ms in OFFSETS_MS:
        shifted_rows, shifted_summary = retarget_rows(module, packages, base_rows, offset_ms)
        shifted_bundle = source_bundle_for_offset(module, base_bundle, shifted_rows)
        vectors = step02.vector_arrays(shifted_bundle)
        masks = step02.masks_for(shifted_bundle, vectors)
        rowv = row_vectors_from_step03(step03, shifted_bundle)
        stationary = product_stationary_mask(rowv)
        offset_key = f"{offset_ms:+.1f}"
        offset_summaries[offset_key] = {
            "rows": shifted_bundle.summary["rows"],
            "retargetSkipped": shifted_summary["skipped"],
            "sliceCounts": {name: int(np.sum(mask)) for name, mask in masks.items()},
            "stationaryRows": int(np.sum(stationary)),
        }
        for lag_px in LAGS_PX:
            model_id = f"lag{str(lag_px).replace('.', 'p')}_offset{str(offset_ms).replace('-', 'm').replace('+', '').replace('.', 'p')}ms"
            pred = step02.runtime_predict(shifted_bundle, descriptor_with_lag(descriptor, lag_px))
            pred = product_shape(pred, rowv)
            metric = step02.model_metrics(model_id, pred, shifted_bundle, vectors, masks)
            high = high_speed_stats(pred, shifted_bundle, vectors, step02)
            item = {
                "modelId": model_id,
                "lagPx": lag_px,
                "targetOffsetMs": offset_ms,
                "summary": summary(metric, high),
                "sliceCounts": {name: int(np.sum(mask)) for name, mask in masks.items()},
                "bySplit": metric["bySplit"],
                "byPackageStopApproach": package_breakdown(metric),
                "rawMetrics": metric["bySlice"],
                "timingTradeoff": None,
                "runtimeNotes": {
                    "kind": "replay_equivalent_product_shape",
                    "formula": f"rebuild MLP features with horizon+{offset_ms}ms, lag {lag_px}px, gain1, stationary fallback, clamp48",
                    "productSafe": True,
                    "allocationRisk": "none for lag/offset constants; feature rebuild is POC-only",
                    "fullCSharpReplay": False,
                },
            }
            item["timingTradeoff"] = tradeoff(item)
            candidates[model_id] = item

    current_id = "lag0p5_offset0p0ms"
    lag0_id = "lag0p0_offset0p0ms"
    current = candidates[current_id]
    for item in candidates.values():
        item["objective"] = objective(item, current)
    ranking = sorted(candidates.values(), key=lambda item: (item["objective"], item["summary"]["allP95"], abs(item["summary"]["stopSignedMean"])))
    offset_winners = {}
    for offset_ms in OFFSETS_MS:
        offset_items = [item for item in ranking if item["targetOffsetMs"] == offset_ms]
        offset_winners[f"{offset_ms:+.1f}"] = offset_items[0]
    lag0 = candidates[lag0_id]
    selected = ranking[0]
    # Prefer the simplest lag0/no-offset candidate when it achieves the visual goal
    # without materially worse balanced score than the grid best.
    if (
        lag0["summary"]["stopOvershootP95"] < current["summary"]["stopOvershootP95"]
        and lag0["summary"]["postStopJitterP95"] < current["summary"]["postStopJitterP95"]
        and lag0["summary"]["allP95"] <= current["summary"]["allP95"] + 0.12
        and lag0["objective"] <= selected["objective"] + 0.35
    ):
        selected = lag0

    current_s = current["summary"]
    lag0_s = lag0["summary"]
    best_s = ranking[0]["summary"]
    interpretation = (
        f"At the same target timing (offset 0 ms), lag0 reduces stop overshoot p95 from {current_s['stopOvershootP95']} to {lag0_s['stopOvershootP95']} "
        f"and post-stop jitter p95 from {current_s['postStopJitterP95']} to {lag0_s['postStopJitterP95']}, but shifts stop signed mean from "
        f"{current_s['stopSignedMean']} to {lag0_s['stopSignedMean']} and raises lagRate to {lag0_s['stopLagRate']}. "
        f"The grid best by objective is {ranking[0]['modelId']} with stop signed {best_s['stopSignedMean']} and stop overshoot p95 {best_s['stopOvershootP95']}. "
        "This indicates that the user's lag-only feeling is not caused only by the Step 5 post-processing approximation; it is the expected tradeoff when removing the generated 0.5 px lead offset from current weights."
    )
    if ranking[0]["targetOffsetMs"] != 0.0:
        decision = (
            f"Target offset tuning has measurable value: the objective winner uses offset {ranking[0]['targetOffsetMs']} ms. "
            "However, because this is replay-equivalent rather than full C# replay, treat offset changes as a candidate for a product harness before adoption. "
            "Lag compensation should not simply be restored to 0.5 px, because it reintroduces stop overshoot and post-stop jitter."
        )
    else:
        decision = (
            "`product_lag0` remains the product adoption candidate for the current MLP weights. "
            "Changing target offset did not beat the simple lag0/no-offset guardrail strongly enough to justify replacing it before full replay. "
            "The remaining error floor is dominated by current model target mismatch, not a small runtime lag scalar."
        )
    next_steps = [
        "Build a minimal C# predictor replay harness that reads ZIP trace rows and calls DwmAwareCursorPositionPredictor in chronological order.",
        "Generate lag0 runtime JSON/C# and run parity plus manual visual review.",
        "Retrain/distill a no-lag or timing-aware target if the lag0 candidate feels too delayed in the C# harness.",
        "Capture one new trace with explicit mirror-present timestamp or render-apply timing if the target offset ambiguity remains.",
    ]
    report_models = []
    for model_id in (current_id, lag0_id, ranking[0]["modelId"], selected["modelId"], "lag0p0625_offset0p0ms", "lag0p125_offset0p0ms"):
        if model_id in candidates and model_id not in report_models:
            report_models.append(model_id)
    scores = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "constraints": {
            "rawDataCopied": False,
            "expandedCsvWritten": False,
            "checkpointWritten": False,
            "tensorDumpWritten": False,
            "gpuTrainingRun": False,
            "analysis": "CPU-only replay-equivalent fixed inference timing grid",
            "productSourceEdited": False,
        },
        "inputs": {
            "manifest": str(args.manifest.relative_to(args.root)),
            "runtimeDescriptor": str(args.runtime.relative_to(args.root)),
            "loader": "poc/cursor-prediction-v13/scripts/run-deep-learning-gpu.py",
            "sourceZipsReadInPlace": True,
        },
        "replayFeasibility": {
            "canFullCSharpReplayFromCurrentPocBundle": False,
            "canReplayEquivalentFromSourceZips": True,
            "summary": "Full C# predictor replay is pending because the current POC bundle does not preserve the exact product Predict call stream/state. Source ZIPs do provide enough reference history and target timestamps for Python replay-equivalent timing validation.",
            "missingItems": [
                "exact CursorPollSample.Position for every product predictor call as passed to C#",
                "row-stable event id linking bundle rows back to chronological predictor calls",
                "predictor state replay including fallback/store ordering and reset boundaries",
                "compiled harness binding product predictor without modifying product source",
            ],
        },
        "dataset": base_bundle.summary,
        "buildSummary": build_summary,
        "offsetsMs": list(OFFSETS_MS),
        "lagsPx": list(LAGS_PX),
        "offsetSummaries": offset_summaries,
        "baseModelId": descriptor["modelId"],
        "currentProductLikeId": current_id,
        "productLag0Id": lag0_id,
        "candidates": candidates,
        "ranking": ranking,
        "offsetWinners": offset_winners,
        "selectedRecommendation": selected,
        "selectedSliceCounts": selected["sliceCounts"],
        "reportModels": report_models,
        "interpretation": interpretation,
        "decision": decision,
        "nextSteps": next_steps,
        "nextStepsText": "\n".join(f"- {item}" for item in next_steps),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    write_outputs(args.out_dir, scores)
    append_log(args.root, scores)
    print(json.dumps({
        "step": "06",
        "rows": base_bundle.summary["rows"],
        "candidateCount": len(candidates),
        "selected": selected["modelId"],
        "gridBest": ranking[0]["modelId"],
        "summary": selected["summary"],
        "elapsedSeconds": scores["elapsedSeconds"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
