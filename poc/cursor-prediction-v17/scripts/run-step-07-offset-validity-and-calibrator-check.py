#!/usr/bin/env python
"""Step 07 fixed-slice offset validity and calibrator check.

CPU-only validation. This keeps the offset-0 row set and slice masks fixed, then
rebuilds candidate features/targets for lag and target-offset grids. The goal is
to separate genuine timing improvement from moving-goal slice changes.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import os
import sys
import time
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import numpy as np


SCHEMA_VERSION = "cursor-prediction-v17-step-07-offset-validity-and-calibrator-check/1"
OFFSETS_MS = (-4.0, -2.0, 0.0, 2.0, 4.0)
LAGS_PX = (0.0, 0.0625, 0.125, 0.25, 0.5)
PRODUCT_MAX_PX = 48.0
PRODUCT_GAIN = 1.0


def load_step06(root: Path) -> Any:
    script = root / "poc" / "cursor-prediction-v17" / "scripts" / "run-step-06-timing-replay-validation.py"
    spec = importlib.util.spec_from_file_location("v17_step06_timing_for_step07", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-dir", type=Path, default=root / "poc" / "cursor-prediction-v17" / "step-07-offset-validity-and-calibrator-check")
    parser.add_argument("--manifest", type=Path, default=root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json")
    parser.add_argument("--runtime", type=Path, default=root / "poc" / "cursor-prediction-v16" / "runtime" / "selected-candidate.json")
    return parser.parse_args()


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


def stats(values: np.ndarray) -> dict[str, Any]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return {"count": 0, "mean": None, "median": None, "p95": None, "p99": None, "max": None}
    return {
        "count": int(finite.size),
        "mean": round(float(np.mean(finite)), 4),
        "median": round(float(np.percentile(finite, 50)), 4),
        "p95": round(float(np.percentile(finite, 95)), 4),
        "p99": round(float(np.percentile(finite, 99)), 4),
        "max": round(float(np.max(finite)), 4),
    }


def signed_stats(values: np.ndarray) -> dict[str, Any]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return {"count": 0, "mean": None, "p95": None, "p99": None, "leadRate": None, "lagRate": None}
    return {
        "count": int(finite.size),
        "mean": round(float(np.mean(finite)), 4),
        "p95": round(float(np.percentile(finite, 95)), 4),
        "p99": round(float(np.percentile(finite, 99)), 4),
        "leadRate": round(float(np.mean(finite > 0.0)), 6),
        "lagRate": round(float(np.mean(finite < 0.0)), 6),
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


def metric_with_fixed_masks(
    name: str,
    pred: np.ndarray,
    target: np.ndarray,
    vectors0: dict[str, np.ndarray],
    masks0: dict[str, np.ndarray],
) -> dict[str, Any]:
    err = pred.astype(np.float32) - target.astype(np.float32)
    euclid = np.sqrt(np.sum(err * err, axis=1))
    direction = direction_units(vectors0)
    signed = np.sum(err * direction, axis=1)
    direction_mag = np.sqrt(np.sum(direction * direction, axis=1))
    signed[direction_mag <= 0] = np.nan
    overshoot = np.maximum(signed, 0.0)
    pred_old = np.sum(pred * direction, axis=1)
    target_old = np.sum(target * direction, axis=1)
    direction_flip_penalty = np.maximum(pred_old - target_old, 0.0)
    pred_mag = np.sqrt(np.sum(pred * pred, axis=1))

    def slice_metrics(mask: np.ndarray) -> dict[str, Any]:
        rows = int(np.sum(mask))
        return {
            "rows": rows,
            "errorPx": stats(euclid[mask]),
            "signedAlongMotionError": signed_stats(signed[mask]),
            "overshootPx": stats(overshoot[mask]),
            "overshootRateGt0p5": round(float(np.mean(overshoot[mask] > 0.5)), 6) if rows else None,
            "overshootRateGt1": round(float(np.mean(overshoot[mask] > 1.0)), 6) if rows else None,
            "overshootRateGt2": round(float(np.mean(overshoot[mask] > 2.0)), 6) if rows else None,
            "predictionMagnitude": stats(pred_mag[mask]),
        }

    by_slice = {key: slice_metrics(mask) for key, mask in masks0.items()}
    by_split = {split: slice_metrics(vectors0["split"] == split) for split in sorted(set(vectors0["split"]))}
    by_package_stop = {
        package: slice_metrics(masks0["stopApproach"] & (vectors0["package"] == package))
        for package in sorted(set(vectors0["package"]))
    }
    by_slice["postStopHold"]["postStopJitter"] = stats(pred_mag[masks0["postStopHold"]])
    by_slice["directionFlip"]["directionFlipPenalty"] = stats(direction_flip_penalty[masks0["directionFlip"]])
    return {
        "modelId": name,
        "bySlice": by_slice,
        "bySplit": by_split,
        "byPackageStopApproach": by_package_stop,
    }


def high_speed_stats(pred: np.ndarray, target: np.ndarray, vectors0: dict[str, np.ndarray]) -> dict[str, Any]:
    err = pred - target.astype(np.float32)
    euclid = np.sqrt(np.sum(err * err, axis=1))
    mask = vectors0["recentSpeed"] >= 1800.0
    return {
        "rows": int(np.sum(mask)),
        "p95": None if not np.sum(mask) else round(float(np.percentile(euclid[mask], 95)), 4),
        "p99": None if not np.sum(mask) else round(float(np.percentile(euclid[mask], 99)), 4),
    }


def summary(metric: dict[str, Any], high: dict[str, Any]) -> dict[str, Any]:
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
        "highSpeedRows": high["rows"],
        "highSpeedP95": high["p95"],
        "highSpeedP99": high["p99"],
    }


def split_focus(metric: dict[str, Any], vectors0: dict[str, np.ndarray], target: np.ndarray, pred: np.ndarray, masks0: dict[str, np.ndarray]) -> dict[str, Any]:
    out = {}
    for split in ("validation", "test"):
        split_mask = vectors0["split"] == split
        tmp_masks = {
            "all": split_mask,
            "stopApproach": masks0["stopApproach"] & split_mask,
            "hardStopApproach": masks0["hardStopApproach"] & split_mask,
            "postStopHold": masks0["postStopHold"] & split_mask,
            "directionFlip": masks0["directionFlip"] & split_mask,
        }
        tmp_metric = metric_with_fixed_masks(f"{metric['modelId']}_{split}", pred, target, vectors0, tmp_masks)
        tmp_high = high_speed_stats(pred[tmp_masks["all"]], target[tmp_masks["all"]], {
            **vectors0,
            "recentSpeed": vectors0["recentSpeed"][tmp_masks["all"]],
        }) if False else None
        out[split] = {
            "rows": int(np.sum(split_mask)),
            "allP95": tmp_metric["bySlice"]["all"]["errorPx"]["p95"],
            "allP99": tmp_metric["bySlice"]["all"]["errorPx"]["p99"],
            "stopRows": tmp_metric["bySlice"]["stopApproach"]["rows"],
            "stopP95": tmp_metric["bySlice"]["stopApproach"]["errorPx"]["p95"],
            "stopP99": tmp_metric["bySlice"]["stopApproach"]["errorPx"]["p99"],
            "stopSignedMean": tmp_metric["bySlice"]["stopApproach"]["signedAlongMotionError"]["mean"],
            "stopOvershootP95": tmp_metric["bySlice"]["stopApproach"]["overshootPx"]["p95"],
            "postStopJitterP95": tmp_metric["bySlice"]["postStopHold"]["postStopJitter"]["p95"],
        }
    return out


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
    val = item["validationTestBreakdown"]["validation"]
    test = item["validationTestBreakdown"]["test"]
    c = current["summary"]
    val_stop = float(val["stopP95"] or s["stopP95"])
    test_stop = float(test["stopP95"] or s["stopP95"])
    validation_test_stop = 0.55 * val_stop + 0.45 * test_stop
    validation_test_overshoot = 0.55 * float(val["stopOvershootP95"] or s["stopOvershootP95"]) + 0.45 * float(test["stopOvershootP95"] or s["stopOvershootP95"])
    all_reg = max(0.0, float(s["allP95"]) - float(c["allP95"]) - 0.15)
    high_reg = max(0.0, float(s["highSpeedP95"] or 0.0) - float(c["highSpeedP95"] or 0.0) - 0.5)
    lag_bias = abs(float(s["stopSignedMean"]))
    return round(
        0.40 * validation_test_stop
        + 0.75 * validation_test_overshoot
        + 0.90 * float(s["stopOvershootGt1"])
        + 0.50 * float(s["postStopJitterP95"])
        + 0.35 * lag_bias
        + 2.0 * all_reg
        + 0.8 * high_reg,
        6,
    )


def calibrator_summary(root: Path) -> dict[str, Any]:
    zips = sorted(root.glob("*calibration*.zip"))
    entries = []
    for zip_path in zips:
        metrics: dict[str, Any] = {}
        frames_stats: dict[str, Any] = {}
        with zipfile.ZipFile(zip_path) as zf:
            if "metrics.json" in zf.namelist():
                metrics = json.loads(zf.read("metrics.json").decode("utf-8-sig"))
            if "frames.csv" in zf.namelist():
                rows = list(csv.DictReader((line.decode("utf-8-sig") for line in zf.open("frames.csv"))))
                sep = np.asarray([float(row.get("estimatedSeparationPixels") or 0.0) for row in rows], dtype=np.float32)
                frames_stats = stats(sep)
                frames_stats["rows"] = len(rows)
                frames_stats["columns"] = list(rows[0].keys()) if rows else []
        entries.append({
            "zip": zip_path.name,
            "metrics": metrics,
            "frames": frames_stats,
        })
    usable = False
    missing = [
        "no candidate prediction id or runtime setting per frame",
        "no mapping from calibration frame timestamp to POC row/ref history",
        "no true cursor and mirror cursor positions as separate coordinates, only estimated separation/bounds",
    ]
    return {
        "found": len(entries),
        "entries": entries,
        "candidateProxyAvailable": usable,
        "candidateProxyScores": {},
        "reason": "Calibration ZIPs contain aggregate frame separation metrics, but not enough metadata to score lag/offset candidates.",
        "missingForNextCapture": missing,
    }


def row_key(row: dict[str, Any]) -> tuple[int, int]:
    return (int(row["_packageIndex"]), int(row["_anchorIndex"]))


def offset_sensitivity(items: dict[str, dict[str, Any]], lag_px: float) -> list[dict[str, Any]]:
    rows = []
    ordered = [items[f"lag{str(lag_px).replace('.', 'p')}_offset{str(o).replace('-', 'm').replace('+', '').replace('.', 'p')}ms"] for o in OFFSETS_MS]
    for left, right in zip(ordered, ordered[1:]):
        delta_ms = right["targetOffsetMs"] - left["targetOffsetMs"]
        rows.append({
            "lagPx": lag_px,
            "fromOffsetMs": left["targetOffsetMs"],
            "toOffsetMs": right["targetOffsetMs"],
            "perMsAllP95": round((right["summary"]["allP95"] - left["summary"]["allP95"]) / delta_ms, 6),
            "perMsStopP95": round((right["summary"]["stopP95"] - left["summary"]["stopP95"]) / delta_ms, 6),
            "perMsStopOvershootP95": round((right["summary"]["stopOvershootP95"] - left["summary"]["stopOvershootP95"]) / delta_ms, 6),
            "perMsPostStopJitterP95": round((right["summary"]["postStopJitterP95"] - left["summary"]["postStopJitterP95"]) / delta_ms, 6),
        })
    return rows


def write_outputs(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    rows = []
    for item in scores["ranking"][:18]:
        s = item["summary"]
        val = item["validationTestBreakdown"]["validation"]
        test = item["validationTestBreakdown"]["test"]
        rows.append(
            f"| {item['modelId']} | {item['lagPx']} | {item['targetOffsetMs']} | {s['allP95']} | {s['stopP95']} | {s['stopSignedMean']} | "
            f"{s['stopOvershootP95']} | {s['postStopJitterP95']} | {s['highSpeedP95']} | {val['stopP95']} | {test['stopP95']} | {item['objective']} |"
        )
    package_rows = []
    for model_id in scores["reportModels"]:
        for package, p in scores["candidates"][model_id]["byPackageStopApproach"].items():
            package_rows.append(
                f"| {model_id} | {package} | {p['stopP95']} | {p['stopP99']} | {p['stopSignedMean']} | {p['stopOvershootP95']} | {p['stopOvershootGt1']} |"
            )
    sens_rows = [
        f"| {r['lagPx']} | {r['fromOffsetMs']} -> {r['toOffsetMs']} | {r['perMsAllP95']} | {r['perMsStopP95']} | {r['perMsStopOvershootP95']} | {r['perMsPostStopJitterP95']} |"
        for r in scores["offsetSensitivity"]
    ]
    selected = scores["selectedRecommendation"]
    report = f"""# Step 07 - Offset Validity And Calibrator Check

## Scope

Step 07 rechecks the Step 6 target-offset result using fixed offset-0 rows and fixed offset-0 slice masks. This prevents `stopApproach`, `hardStop`, `postStop`, `highSpeed`, and `directionFlip` row counts from moving with the candidate offset. CPU-only fixed inference; no model training.

## Fixed Slice Setup

- Rows: {scores['dataset']['rows']}
- Fixed slice counts: `{scores['fixedSliceCounts']}`
- Lag grid: `{scores['lagsPx']}`
- Offset grid: `{scores['offsetsMs']}`
- Ranking objective prioritizes validation/test stop metrics over train/all metrics.

## Ranking

| candidate | lag | offset ms | all p95 | stop p95 | stop signed | stop over p95 | jitter p95 | high speed p95 | val stop p95 | test stop p95 | objective |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

## Package Breakdown

| candidate | package | stop p95 | stop p99 | signed mean | overshoot p95 | overshoot >1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(package_rows)}

## Offset Sensitivity

Per-ms deltas from neighboring 2 ms steps. Negative `perMsStopP95` means moving later improves stop p95; positive means it worsens.

| lag | offset step | all p95 / ms | stop p95 / ms | stop overshoot p95 / ms | jitter p95 / ms |
| ---: | --- | ---: | ---: | ---: | ---: |
{chr(10).join(sens_rows)}

## Calibrator / Measurement Check

{scores['calibratorMeasurement']['reason']}

Found calibration ZIPs: {scores['calibratorMeasurement']['found']}. Candidate-specific proxy available: `{scores['calibratorMeasurement']['candidateProxyAvailable']}`.

Missing for candidate scoring: `{scores['calibratorMeasurement']['missingForNextCapture']}`.

## Product Interpretation

{scores['productInterpretation']}

## Conclusion

{scores['abcConclusion']} - {scores['abcConclusionText']}

Selected recommendation for now: `{selected['modelId']}`.

- Summary: `{selected['summary']}`
- Validation/test: `{selected['validationTestBreakdown']}`

## Next Steps

{scores['nextStepsText']}
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    notes = f"""# Step 07 Notes

- Fixed offset-0 slice masks were used for every candidate.
- Calibrator ZIPs were read, but cannot score candidate offset/lag variants.
- Conclusion: {scores['abcConclusion']} - {scores['abcConclusionText']}
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")


def append_log(root: Path, scores: dict[str, Any]) -> None:
    selected = scores["selectedRecommendation"]
    s = selected["summary"]
    log_path = root / "poc" / "cursor-prediction-v17" / "experiment-log.md"
    existing = log_path.read_text(encoding="utf-8") if log_path.exists() else "# Experiment Log\n"
    entry = f"""

## Step 07 - Offset Validity And Calibrator Check ({scores['generatedAtUtc']})

- Ran CPU-only fixed-slice lag/target-offset grid over {scores['dataset']['rows']} offset-0 rows.
- Selected `{selected['modelId']}`: lag {selected['lagPx']} px, offset {selected['targetOffsetMs']} ms.
- Key scores: all p95 {s['allP95']}, stop p95 {s['stopP95']}, stop signed {s['stopSignedMean']}, stop overshoot p95 {s['stopOvershootP95']}, jitter p95 {s['postStopJitterP95']}, high-speed p95 {s['highSpeedP95']}.
- A/B/C conclusion: {scores['abcConclusion']} - {scores['abcConclusionText']}.
"""
    log_path.write_text(existing.rstrip() + entry + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    step06 = load_step06(args.root)
    step05 = step06.load_step05(args.root)
    step03 = step05.load_step03(args.root)
    step02 = step03.load_step02(args.root)
    module = step02.load_poc13_module(args.root)
    context = module.load_manifest(args.manifest)
    packages = [module.load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    all_base_rows, build_summary = step06.build_rows_with_replay_meta(module, packages)
    all_base_rows = [row for row in all_base_rows if row["refreshBucket"] == "60Hz"]
    retargeted_all: dict[float, tuple[list[dict[str, Any]], dict[str, Any]]] = {}
    common_keys = {row_key(row) for row in all_base_rows}
    for offset_ms in OFFSETS_MS:
        shifted_rows, shifted_summary = step06.retarget_rows(module, packages, all_base_rows, offset_ms)
        retargeted_all[offset_ms] = (shifted_rows, shifted_summary)
        common_keys &= {row_key(row) for row in shifted_rows}
    base_rows = [row for row in all_base_rows if row_key(row) in common_keys]
    base_bundle = module.build_dataset(base_rows)
    descriptor = json.loads(args.runtime.read_text(encoding="utf-8"))
    vectors0 = step02.vector_arrays(base_bundle)
    masks0 = step02.masks_for(base_bundle, vectors0)
    fixed_slice_counts = {name: int(np.sum(mask)) for name, mask in masks0.items()}

    candidates: dict[str, dict[str, Any]] = {}
    for offset_ms in OFFSETS_MS:
        shifted_all, shifted_summary = retargeted_all[offset_ms]
        shifted_by_key = {row_key(row): row for row in shifted_all}
        shifted_rows = [shifted_by_key[row_key(row)] for row in base_rows]
        shifted_bundle = step06.source_bundle_for_offset(module, base_bundle, shifted_rows)
        rowv = step03.row_vectors(shifted_bundle)
        target = shifted_bundle.target.astype(np.float32)
        for lag_px in LAGS_PX:
            model_id = f"lag{str(lag_px).replace('.', 'p')}_offset{str(offset_ms).replace('-', 'm').replace('+', '').replace('.', 'p')}ms"
            pred = step02.runtime_predict(shifted_bundle, step06.descriptor_with_lag(descriptor, lag_px))
            pred = product_shape(pred, rowv)
            metric = metric_with_fixed_masks(model_id, pred, target, vectors0, masks0)
            high = high_speed_stats(pred, target, vectors0)
            item = {
                "modelId": model_id,
                "lagPx": lag_px,
                "targetOffsetMs": offset_ms,
                "summary": summary(metric, high),
                "fixedSliceCounts": fixed_slice_counts,
                "offsetRetargetSkipped": shifted_summary["skipped"],
                "validationTestBreakdown": split_focus(metric, vectors0, target, pred, masks0),
                "byPackageStopApproach": package_breakdown(metric),
                "rawMetrics": metric["bySlice"],
                "runtimeNotes": {
                    "kind": "fixed_slice_replay_equivalent",
                    "formula": f"fixed offset-0 masks; shifted horizon/target {offset_ms} ms; lag {lag_px} px; product-like stationary/gain/clamp",
                    "productSafe": True,
                    "fullCSharpReplay": False,
                },
            }
            candidates[model_id] = item
    current_id = "lag0p5_offset0p0ms"
    lag0_id = "lag0p0_offset0p0ms"
    current = candidates[current_id]
    for item in candidates.values():
        item["objective"] = objective(item, current)
    ranking = sorted(
        candidates.values(),
        key=lambda item: (
            item["objective"],
            item["validationTestBreakdown"]["validation"]["stopP95"] or 9999,
            item["validationTestBreakdown"]["test"]["stopP95"] or 9999,
        ),
    )
    selected = ranking[0]
    calibrator = calibrator_summary(args.root)
    sensitivity = []
    for lag in LAGS_PX:
        sensitivity.extend(offset_sensitivity(candidates, lag))

    lag0 = candidates[lag0_id]
    minus4 = candidates["lag0p5_offsetm4p0ms"]
    product_interpretation = (
        "A negative target offset shortens the predicted horizon: offset -4 ms evaluates/predicts a cursor position 4 ms earlier than the offset-0 target. "
        "This is directionally consistent with reducing overshoot, but it does not directly explain a pure lag feeling unless the product is currently predicting for a later time than the mirror is actually displayed. "
        "CursorMirrorSettings defaults DwmPredictionTargetOffsetMilliseconds to +2 ms, while DistilledMLP tests often use 0 ms; moving toward -4 ms would be a meaningful behavior change and should be confirmed in C# replay/present-timing data."
    )
    # Even fixed-slice validation strongly favors -4 ms, but calibrator data cannot
    # validate candidate-specific real screen error and full C# replay is pending.
    abc = "C"
    abc_text = "POC fixed-slice metrics strongly favor target-offset tuning, but product adoption should wait for C# replay or new timing-labelled measurement data."
    next_steps = [
        "Build C# chronological replay harness and evaluate offset -4/-2/0 with current lag0.5 and lag0.",
        "Capture measurement data that records product candidate id, true cursor coordinate, mirror coordinate, display/present timestamp, and source trace row id.",
        "If C# replay confirms -4 ms, test a product-side DwmPredictionTargetOffsetMilliseconds candidate before changing model weights.",
        "If replay rejects offset tuning, keep lag0 as runtime candidate and retrain a timing-aware no-lag model.",
    ]

    report_models = []
    for model_id in (current_id, lag0_id, "lag0p5_offsetm4p0ms", selected["modelId"], "lag0p0_offsetm4p0ms", "lag0p5_offsetm2p0ms"):
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
            "analysis": "CPU-only fixed-slice replay-equivalent timing grid and calibrator ZIP format check",
            "productSourceEdited": False,
        },
        "inputs": {
            "manifest": str(args.manifest.relative_to(args.root)),
            "runtimeDescriptor": str(args.runtime.relative_to(args.root)),
            "sourceZipsReadInPlace": True,
            "calibratorZipsPattern": "*calibration*.zip",
        },
        "dataset": base_bundle.summary,
        "buildSummary": build_summary,
        "fixedRowSet": {
            "originalRows": len(all_base_rows),
            "commonRows": len(base_rows),
            "excludedRows": len(all_base_rows) - len(base_rows),
            "reason": "Rows without shifted labels for every offset candidate are excluded to keep fixed slices identical.",
        },
        "offsetsMs": list(OFFSETS_MS),
        "lagsPx": list(LAGS_PX),
        "fixedSliceCounts": fixed_slice_counts,
        "candidates": candidates,
        "ranking": ranking,
        "selectedRecommendation": selected,
        "currentProductLike": current,
        "productLag0": lag0,
        "minus4Reference": minus4,
        "offsetSensitivity": sensitivity,
        "calibratorMeasurement": calibrator,
        "productInterpretation": product_interpretation,
        "abcConclusion": abc,
        "abcConclusionText": abc_text,
        "nextSteps": next_steps,
        "nextStepsText": "\n".join(f"- {item}" for item in next_steps),
        "reportModels": report_models,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    write_outputs(args.out_dir, scores)
    append_log(args.root, scores)
    print(json.dumps({
        "step": "07",
        "rows": base_bundle.summary["rows"],
        "candidateCount": len(candidates),
        "selected": selected["modelId"],
        "abcConclusion": abc,
        "summary": selected["summary"],
        "elapsedSeconds": scores["elapsedSeconds"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
