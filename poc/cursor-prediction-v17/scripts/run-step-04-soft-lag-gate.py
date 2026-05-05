#!/usr/bin/env python
"""Step 04 soft lag gate search for cursor-prediction-v17.

CPU-only fixed-inference exploration. The v16 selected MLP weights stay
unchanged; only runtime-safe lag scaling and a few mild along-motion clamps are
evaluated.
"""

from __future__ import annotations

import argparse
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


SCHEMA_VERSION = "cursor-prediction-v17-step-04-soft-lag-gate/1"


def load_step03(root: Path) -> Any:
    script = root / "poc" / "cursor-prediction-v17" / "scripts" / "run-step-03-lag-and-deceleration-ablation.py"
    spec = importlib.util.spec_from_file_location("v17_step03_ablation", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-dir", type=Path, default=root / "poc" / "cursor-prediction-v17" / "step-04-soft-lag-gate")
    parser.add_argument("--manifest", type=Path, default=root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json")
    parser.add_argument("--runtime", type=Path, default=root / "poc" / "cursor-prediction-v16" / "runtime" / "selected-candidate.json")
    return parser.parse_args()


def clip01(values: np.ndarray) -> np.ndarray:
    return np.clip(values.astype(np.float32), 0.0, 1.0)


def safe_ratio(num: np.ndarray, den: np.ndarray) -> np.ndarray:
    return num / np.maximum(den, np.float32(1e-6))


def capacity(rowv: dict[str, np.ndarray], ms: float, margin: float) -> np.ndarray:
    return (rowv["v2Speed"] * np.minimum(rowv["horizonMs"], np.float32(ms)) / 1000.0) + np.float32(margin)


def direction_from_v12(step03: Any, rowv: dict[str, np.ndarray]) -> np.ndarray:
    return step03.unit(rowv["v12"])


def lagged(core: np.ndarray, lag_units: np.ndarray, factor: np.ndarray) -> np.ndarray:
    return (core + lag_units * (0.5 * factor.astype(np.float32))[:, None]).astype(np.float32)


def clamp_along(pred: np.ndarray, step03: Any, rowv: dict[str, np.ndarray], factor_mask: np.ndarray, ms: float, margin: float) -> np.ndarray:
    direction = direction_from_v12(step03, rowv)
    along = np.sum(pred * direction, axis=1)
    perp = pred - along[:, None] * direction
    cap = capacity(rowv, ms, margin)
    clamped = np.minimum(along, cap)
    out = pred.copy()
    out[factor_mask] = (perp + clamped[:, None] * direction)[factor_mask]
    return out.astype(np.float32)


def runtime_signals(rowv: dict[str, np.ndarray], vectors: dict[str, np.ndarray], selected_pred: np.ndarray, step03: Any) -> dict[str, np.ndarray]:
    v2 = rowv["v2Speed"]
    v5 = rowv["v5Speed"]
    v12 = rowv["v12Speed"]
    path_eff = rowv["pathEfficiency"]
    path_net = rowv["pathNet"]
    direction = direction_from_v12(step03, rowv)
    pred_along = np.sum(selected_pred * direction, axis=1)
    cap12 = capacity(rowv, 12.0, 0.35)
    cap16 = capacity(rowv, 16.0, 0.5)
    drop12 = clip01((0.78 - safe_ratio(v2, v12)) / 0.60) * clip01((v12 - 250.0) / 750.0)
    drop5 = clip01((0.72 - safe_ratio(v2, v5)) / 0.55) * clip01((v5 - 200.0) / 650.0)
    path_shrink = clip01((0.78 - path_eff) / 0.55)
    path_tight = clip01((4.0 - path_net) / 4.0) * clip01((v12 - 350.0) / 850.0)
    capacity_exceed12 = clip01((pred_along - cap12) / 3.0)
    capacity_exceed16 = clip01((pred_along - cap16) / 3.5)
    near_stop_current = clip01((140.0 - v2) / 140.0) * clip01((180.0 - v5) / 180.0) * clip01((2.5 - path_net) / 2.5)
    hold_like = clip01((90.0 - v2) / 90.0) * clip01((120.0 - v12) / 120.0) * clip01((1.25 - path_net) / 1.25)
    moving_confident = clip01((path_eff - 0.62) / 0.25) * clip01((v2 - 250.0) / 750.0)
    decel_base = clip01(0.55 * np.maximum(drop12, drop5) + 0.25 * path_shrink + 0.20 * path_tight)
    decel_capacity = clip01(0.50 * decel_base + 0.35 * capacity_exceed12 + 0.15 * near_stop_current)
    decel_hold = clip01(0.45 * decel_base + 0.35 * near_stop_current + 0.20 * hold_like)
    return {
        "drop12": drop12,
        "drop5": drop5,
        "pathShrink": path_shrink,
        "pathTight": path_tight,
        "capacityExceed12": capacity_exceed12,
        "capacityExceed16": capacity_exceed16,
        "nearStopCurrent": near_stop_current,
        "holdLike": hold_like,
        "movingConfident": moving_confident,
        "decelBase": decel_base,
        "decelCapacity": decel_capacity,
        "decelHold": decel_hold,
    }


def factor_from(signals: dict[str, np.ndarray], name: str) -> tuple[np.ndarray, dict[str, Any]]:
    ones = np.ones_like(signals["decelBase"], dtype=np.float32)
    if name == "soft_base_min0":
        factor = 1.0 - signals["decelBase"]
        formula = "factor = 1 - decelBase"
    elif name == "soft_base_min0125":
        factor = np.maximum(0.125, 1.0 - signals["decelBase"])
        formula = "factor = max(0.125, 1 - decelBase)"
    elif name == "soft_capacity_min0":
        factor = 1.0 - signals["decelCapacity"]
        formula = "factor = 1 - decelCapacity"
    elif name == "soft_capacity_min0125":
        factor = np.maximum(0.125, 1.0 - signals["decelCapacity"])
        formula = "factor = max(0.125, 1 - decelCapacity)"
    elif name == "soft_hold_min0":
        factor = 1.0 - signals["decelHold"]
        formula = "factor = 1 - decelHold"
    elif name == "soft_hold_min00625":
        factor = np.maximum(0.0625, 1.0 - signals["decelHold"])
        formula = "factor = max(0.0625, 1 - decelHold)"
    elif name == "movement_keep_hold_drop":
        factor = np.where(signals["movingConfident"] > 0.6, ones, 1.0 - signals["decelHold"])
        formula = "factor = 1 when movingConfident > 0.6 else 1 - decelHold"
    elif name == "near_stop_zero_else_capacity":
        factor = np.minimum(1.0 - signals["decelCapacity"], np.where(signals["nearStopCurrent"] > 0.65, 0.0, 1.0))
        formula = "factor = min(1 - decelCapacity, 0 when nearStopCurrent > 0.65 else 1)"
    elif name == "gentle_capacity_50pct":
        factor = 1.0 - (0.5 * signals["decelCapacity"])
        formula = "factor = 1 - 0.5 * decelCapacity"
    elif name == "gentle_hold_50pct":
        factor = 1.0 - (0.5 * signals["decelHold"])
        formula = "factor = 1 - 0.5 * decelHold"
    else:
        raise ValueError(name)
    factor = clip01(factor)
    return factor.astype(np.float32), {
        "formula": formula,
        "factorMean": round(float(np.mean(factor)), 6),
        "factorP05": round(float(np.percentile(factor, 5)), 6),
        "factorP50": round(float(np.percentile(factor, 50)), 6),
        "factorP95": round(float(np.percentile(factor, 95)), 6),
        "nearZeroRate": round(float(np.mean(factor <= 0.0625)), 6),
        "fullLagRate": round(float(np.mean(factor >= 0.9375)), 6),
    }


def fixed_factor(n: int, lag: float) -> np.ndarray:
    return np.full(n, np.float32(lag / 0.5 if lag > 0 else 0.0), dtype=np.float32)


def runtime_notes(kind: str, formula: str, branches: int, clamp: str | None = None) -> dict[str, Any]:
    return {
        "kind": kind,
        "formula": formula,
        "clamp": clamp,
        "productSafe": True,
        "state": "stateless",
        "allocationRisk": "none; scalar arithmetic and fixed arrays only",
        "extraBranchesEstimate": branches,
    }


def summary(metric: dict[str, Any]) -> dict[str, Any]:
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
            "stopSignedMean": payload["signedAlongMotionError"]["mean"],
        }
        for package, payload in metric["byPackageStopApproach"].items()
    }


def objectives(item: dict[str, Any], base: dict[str, Any], lag0: dict[str, Any]) -> dict[str, float]:
    s = item["summary"]
    b = base["summary"]
    l0 = lag0["summary"]
    all_reg = max(0.0, float(s["allP95"]) - float(b["allP95"]) - 0.08)
    all_p99_reg = max(0.0, float(s["allP99"]) - float(b["allP99"]) - 0.25)
    stop_reg_vs_lag0 = max(0.0, float(s["stopP95"]) - float(l0["stopP95"]) - 0.15)
    stop_p99_reg_vs_lag0 = max(0.0, float(s["stopP99"]) - float(l0["stopP99"]) - 0.25)
    lag_too_negative = max(0.0, -2.0 - float(s["stopSignedMean"]))
    balanced = (
        float(s["stopOvershootP95"])
        + 0.20 * float(s["stopOvershootP99"])
        + 0.90 * float(s["stopOvershootGt1"])
        + 1.20 * float(s["stopOvershootGt2"])
        + 0.45 * float(s["postStopJitterP95"])
        + 4.0 * all_reg
        + 1.2 * all_p99_reg
        + 2.0 * stop_reg_vs_lag0
        + 0.8 * stop_p99_reg_vs_lag0
        + 0.6 * lag_too_negative
    )
    overshoot_focused = (
        float(s["stopOvershootP95"])
        + 0.35 * float(s["stopOvershootP99"])
        + 1.6 * float(s["stopOvershootGt1"])
        + 2.2 * float(s["stopOvershootGt2"])
        + 0.60 * float(s["hardStopOvershootP95"])
        + 0.6 * lag_too_negative
        + 1.5 * stop_reg_vs_lag0
    )
    visual_risk = (
        float(s["postStopJitterP95"])
        + 0.35 * float(s["postStopJitterP99"])
        + 0.50 * float(s["stopOvershootP95"])
        + 0.30 * float(s["hardStopOvershootP95"])
        + 3.0 * all_reg
        + 1.0 * stop_reg_vs_lag0
    )
    return {
        "balanced": round(balanced, 6),
        "overshootFocused": round(overshoot_focused, 6),
        "visualRiskFocused": round(visual_risk, 6),
    }


def eligible(item: dict[str, Any], base: dict[str, Any], lag0: dict[str, Any]) -> bool:
    s = item["summary"]
    b = base["summary"]
    l0 = lag0["summary"]
    return (
        s["stopOvershootP95"] < b["stopOvershootP95"]
        and s["postStopJitterP95"] < b["postStopJitterP95"]
        and s["allP95"] <= b["allP95"] + 0.10
        and s["allP99"] <= b["allP99"] + 0.30
        and s["stopP95"] <= l0["stopP95"] + 0.25
        and s["stopP99"] <= l0["stopP99"] + 0.35
        and s["stopSignedMean"] >= -2.0
    )


def write_outputs(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    rows = []
    for item in scores["ranking"]["balanced"][:18]:
        s = item["summary"]
        rows.append(
            f"| {item['modelId']} | {item['runtimeNotes']['kind']} | {s['allMean']} | {s['allP95']} | {s['allP99']} | "
            f"{s['stopP95']} | {s['stopP99']} | {s['stopSignedMean']} | {s['stopOvershootP95']} | {s['stopOvershootP99']} | "
            f"{s['stopOvershootGt1']} | {s['stopOvershootGt2']} | {s['hardStopOvershootP95']} | {s['postStopJitterP95']} | "
            f"{item['objectives']['balanced']} | {item['objectives']['overshootFocused']} | {item['objectives']['visualRiskFocused']} |"
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
    formula = selected["runtimeNotes"]["formula"]
    if selected["modelId"] == "fixed_lag0p0":
        implementation_sketch = """The selected candidate disables lag compensation:

```csharp
const float lagFactor = 0f;
// Keep the MLP output and q0.125 output quantization, but do not add the lag-direction offset.
// prediction += lagDirection * (0.5f * lagFactor);
```

This is allocation-free, stateless, and removes the v16 `lag0.5` branch entirely. If a nonzero fallback is desired for visual tuning, `fixed_lag0p0625` is the nearest low-risk alternative, but it had worse overshoot and jitter than `lag0` in this run."""
    else:
        implementation_sketch = f"""Use the selected soft lag factor before adding the lag vector:

```csharp
float drop12 = Clamp01((0.78f - (v2Speed / max(v12Speed, eps))) / 0.60f) * Clamp01((v12Speed - 250f) / 750f);
float drop5 = Clamp01((0.72f - (v2Speed / max(v5Speed, eps))) / 0.55f) * Clamp01((v5Speed - 200f) / 650f);
float pathShrink = Clamp01((0.78f - pathEfficiency) / 0.55f);
float pathTight = Clamp01((4f - pathNetPx) / 4f) * Clamp01((v12Speed - 350f) / 850f);
float decelBase = Clamp01(0.55f * Max(drop12, drop5) + 0.25f * pathShrink + 0.20f * pathTight);
float lagFactor = {formula};
prediction += lagDirection * (0.5f * lagFactor);
```
"""
    report = f"""# Step 04 - Soft Lag Gate

## Scope

Step 04 keeps the v16 selected MLP weights fixed and searches runtime-safe soft lag gates. The gate scales lag compensation as `lag = 0.5 * factor`, using only recent velocity/path/prediction-capacity signals available at runtime. CPU fixed inference only; no GPU learning was run.

## Inputs

- Dataset rows: {scores['dataset']['rows']}
- Runtime descriptor: `{scores['inputs']['runtimeDescriptor']}`
- Base model: `{scores['baseModelId']}`
- Slice counts: `{scores['sliceCounts']}`

## Candidate Ranking

| candidate | kind | all mean | all p95 | all p99 | stop p95 | stop p99 | stop signed | stop over p95 | stop over p99 | over >1 | over >2 | hard over p95 | post jitter p95 | balanced | overshoot | visual |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

## Package Stop-Approach Breakdown

| candidate | package | stop p95 | stop p99 | signed mean | overshoot p95 | overshoot p99 | overshoot >1 | overshoot >2 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(package_rows)}

## Recommendation

Recommended Step 4 candidate: `{selected['modelId']}`.

- Formula: `{formula}`
- Runtime notes: `{selected['runtimeNotes']}`
- Summary: `{selected['summary']}`

## Interpretation

{scores['interpretation']}

## Product Implementation Sketch

{implementation_sketch}
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    notes = """# Step 04 Notes

- CPU fixed inference only.
- No model retraining or GPU learning.
- Candidate formulas use runtime-safe recent velocity, path efficiency, path net distance, prediction capacity, and hold-like signals.
- Future label speed is not used in product-safe candidates.
- Mild along clamps were evaluated only as add-ons to soft lag gates.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")


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
    core = step02.runtime_predict(bundle, step03.descriptor_with_lag(descriptor, 0.0))
    selected = step02.runtime_predict(bundle, step03.descriptor_with_lag(descriptor, 0.5))
    signals = runtime_signals(rowv, vectors, selected, step03)

    n = len(bundle.row_meta)
    candidate_preds: dict[str, dict[str, Any]] = {}
    for lag in (0.0, 0.0625, 0.125, 0.25, 0.375, 0.5):
        factor = fixed_factor(n, lag)
        model_id = f"fixed_lag{str(lag).replace('.', 'p')}"
        if lag == 0.5:
            model_id = "v16_selected_fixed_lag0p5"
        if lag == 0.0:
            model_id = "fixed_lag0p0"
        candidate_preds[model_id] = {
            "prediction": lagged(core, lag_units, factor),
            "runtimeNotes": runtime_notes("fixed_lag", f"factor = {float(lag / 0.5 if lag else 0.0):.3f}", 0),
            "factorStats": {
                "factorMean": round(float(np.mean(factor)), 6),
                "factorP05": round(float(np.percentile(factor, 5)), 6),
                "factorP50": round(float(np.percentile(factor, 50)), 6),
                "factorP95": round(float(np.percentile(factor, 95)), 6),
                "nearZeroRate": round(float(np.mean(factor <= 0.0625)), 6),
                "fullLagRate": round(float(np.mean(factor >= 0.9375)), 6),
            },
        }

    soft_names = [
        "soft_base_min0",
        "soft_base_min0125",
        "soft_capacity_min0",
        "soft_capacity_min0125",
        "soft_hold_min0",
        "soft_hold_min00625",
        "movement_keep_hold_drop",
        "near_stop_zero_else_capacity",
        "gentle_capacity_50pct",
        "gentle_hold_50pct",
    ]
    factors: dict[str, np.ndarray] = {}
    for name in soft_names:
        factor, stats = factor_from(signals, name)
        factors[name] = factor
        candidate_preds[name] = {
            "prediction": lagged(core, lag_units, factor),
            "runtimeNotes": runtime_notes("soft_lag_gate", stats["formula"], 3),
            "factorStats": stats,
        }

    for base_name, ms, margin in (
        ("soft_base_min0125", 16.0, 0.75),
        ("soft_capacity_min0125", 16.0, 0.75),
        ("gentle_capacity_50pct", 16.0, 0.75),
        ("soft_capacity_min0125", 12.0, 0.5),
    ):
        pred = lagged(core, lag_units, factors[base_name])
        mask = signals["capacityExceed16" if ms >= 16.0 else "capacityExceed12"] > 0.5
        model_id = f"{base_name}_mild_clamp{int(ms)}ms"
        candidate_preds[model_id] = {
            "prediction": clamp_along(pred, step03, rowv, mask, ms, margin),
            "runtimeNotes": runtime_notes("soft_lag_plus_mild_along_clamp", f"{candidate_preds[base_name]['runtimeNotes']['formula']} + along cap {ms}ms margin {margin}", 5, clamp=f"{ms}ms"),
            "factorStats": candidate_preds[base_name]["factorStats"],
        }

    metrics = {
        model_id: step02.model_metrics(model_id, payload["prediction"], bundle, vectors, masks)
        for model_id, payload in candidate_preds.items()
    }
    raw_items = {}
    for model_id, metric in metrics.items():
        raw_items[model_id] = {
            "modelId": model_id,
            "summary": summary(metric),
            "runtimeNotes": candidate_preds[model_id]["runtimeNotes"],
            "factorStats": candidate_preds[model_id]["factorStats"],
            "bySplit": metric["bySplit"],
            "byPackageStopApproach": package_breakdown(metric),
        }
    base = raw_items["v16_selected_fixed_lag0p5"]
    lag0 = raw_items["fixed_lag0p0"]
    for item in raw_items.values():
        item["objectives"] = objectives(item, base, lag0)
        item["eligible"] = eligible(item, base, lag0)

    rankings = {
        key: sorted(raw_items.values(), key=lambda item: (item["objectives"][key], item["summary"]["allP95"], item["summary"]["stopP95"]))
        for key in ("balanced", "overshootFocused", "visualRiskFocused")
    }
    eligible_items = [item for item in rankings["balanced"] if item["eligible"]]
    recommendation = eligible_items[0] if eligible_items else rankings["balanced"][0]
    b = base["summary"]
    r = recommendation["summary"]
    l0 = lag0["summary"]
    interpretation = (
        f"{recommendation['modelId']} is recommended. Versus v16 fixed lag0.5, stop overshoot p95 changes "
        f"{round(float(r['stopOvershootP95']) - float(b['stopOvershootP95']), 4)}px and post-stop jitter p95 changes "
        f"{round(float(r['postStopJitterP95']) - float(b['postStopJitterP95']), 4)}px. Versus lag0, stop p95 changes "
        f"{round(float(r['stopP95']) - float(l0['stopP95']), 4)}px and stop p99 changes "
        f"{round(float(r['stopP99']) - float(l0['stopP99']), 4)}px."
    )

    report_models = []
    for model_id in ("v16_selected_fixed_lag0p5", "fixed_lag0p0", recommendation["modelId"]):
        if model_id not in report_models:
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
            "analysis": "CPU-only fixed inference and runtime-safe soft lag gate search",
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
        "signalStats": {
            name: {
                "mean": round(float(np.mean(value)), 6),
                "p95": round(float(np.percentile(value, 95)), 6),
                "activeGt0p5": round(float(np.mean(value > 0.5)), 6),
            }
            for name, value in signals.items()
        },
        "candidates": raw_items,
        "ranking": rankings,
        "eligibleProductSafeBalanced": eligible_items,
        "selectedRecommendation": recommendation,
        "reportModels": report_models,
        "interpretation": interpretation,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    write_outputs(args.out_dir, scores)
    print(json.dumps({
        "step": "04",
        "rows": bundle.summary["rows"],
        "candidateCount": len(candidate_preds),
        "recommendation": recommendation["modelId"],
        "summary": recommendation["summary"],
        "elapsedSeconds": scores["elapsedSeconds"],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
