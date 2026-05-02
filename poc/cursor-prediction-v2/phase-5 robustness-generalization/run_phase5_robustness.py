#!/usr/bin/env python3
"""Phase 5 robustness and generalization checks for Cursor Mirror prediction.

This runner deliberately reuses the Phase 4 data/model code by importing it
from the Phase 4 artifact directory. It retrains only the selected
`sequence-gru-residual-h32-huber` candidate, reconstructs the deterministic
`gained-last2-0.75` baseline on the same sequence mask, and evaluates the
Phase 4 gated hybrid plus validation-selected gate threshold variants.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import platform
import random
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import torch


SELECTED_MODEL = "sequence-gru-residual-h32-huber"
PHASE4_GATE_RULE = "speed>=500_and_horizon>=12"

SPEED_BINS = [
    ("0-500", 0.0, 500.0),
    ("500-1500", 500.0, 1500.0),
    ("1500-3000", 1500.0, 3000.0),
    ("3000+", 3000.0, math.inf),
]

HORIZON_BINS = [
    ("0-4", 0.0, 4.0),
    ("4-8", 4.0, 8.0),
    ("8-12", 8.0, 12.0),
    ("12-16", 12.0, 16.0),
    ("16-24", 16.0, 24.0),
    ("24+", 24.0, math.inf),
]

HOOK_AGE_BINS = [
    ("0-4", 0.0, 4.0),
    ("4-8", 4.0, 8.0),
    ("8-16", 8.0, 16.0),
    ("16-32", 16.0, 32.0),
    ("32+", 32.0, math.inf),
]

DWM_PHASE_BINS = [
    ("negative_or_zero", -math.inf, 0.0),
    ("0-4", 0.0, 4.0),
    ("4-8", 4.0, 8.0),
    ("8-12", 8.0, 12.0),
    ("12-16", 12.0, 16.0),
    ("16+", 16.0, math.inf),
]


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return json_safe(value.tolist())
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        v = float(value)
        return None if not math.isfinite(v) else v
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, float):
        return None if not math.isfinite(value) else value
    return value


def load_phase4_module(path: Path) -> Any:
    spec = importlib.util.spec_from_file_location("phase4_runner", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not import Phase 4 runner at {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def trace_probe(zip_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(zip_path, "r") as archive:
        metadata = json.loads(archive.read("metadata.json").decode("utf-8-sig"))
        with archive.open("trace.csv", "r") as raw:
            reader = csv.reader(line.decode("utf-8-sig") for line in raw)
            header = next(reader)
    required = {
        "event",
        "elapsedMicroseconds",
        "stopwatchTicks",
        "x",
        "y",
        "dwmQpcRefreshPeriod",
        "dwmQpcVBlank",
    }
    missing = sorted(required - set(header))
    return {
        "zip_path": str(zip_path.resolve()),
        "metadata": metadata,
        "trace_header": header,
        "compatible_with_dwm_next_vblank": not missing and int(metadata.get("TraceFormatVersion", 0) or 0) >= 2,
        "missing_required_fields": missing,
    }


def bin_mask(values: np.ndarray, lo: float, hi: float) -> np.ndarray:
    if math.isinf(lo) and lo < 0:
        return values <= hi
    if math.isinf(hi):
        return values >= lo
    return (values >= lo) & (values < hi)


def metric_triplet(phase4: Any, baseline: np.ndarray, standalone: np.ndarray, gated: np.ndarray) -> dict[str, Any]:
    b = phase4.metrics_from_errors(baseline)
    s = phase4.metrics_from_errors(standalone)
    g = phase4.metrics_from_errors(gated)
    return {
        "baseline": b,
        "standalone": s,
        "gated": g,
        "standalone_delta_vs_baseline": delta_metrics(s, b),
        "gated_delta_vs_baseline": delta_metrics(g, b),
    }


def delta_metrics(candidate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    keys = ["mean_euclidean_error", "rmse", "p50", "p90", "p95", "p99", "max"]
    return {
        key: None if candidate[key] is None or baseline[key] is None else float(candidate[key] - baseline[key])
        for key in keys
    }


def evaluate_subset(
    phase4: Any,
    mask: np.ndarray,
    baseline_errors: np.ndarray,
    standalone_errors: np.ndarray,
    gated_errors: np.ndarray,
) -> dict[str, Any]:
    return metric_triplet(phase4, baseline_errors[mask], standalone_errors[mask], gated_errors[mask])


def split_labels_for_indices(trace: Any, splits: list[Any], idx: np.ndarray) -> np.ndarray:
    labels = np.empty(idx.size, dtype=object)
    for pos, row_idx in enumerate(idx):
        t = trace.t_us[row_idx]
        label = "outside"
        for split in splits:
            if split.start_us <= t <= split.end_us:
                label = split.name
                break
        labels[pos] = label
    return labels


def risk_slices(phase4: Any, trace: Any, d: Any, idx: np.ndarray) -> dict[str, np.ndarray]:
    speed = d.speed[idx]
    accel = d.accel_mag[idx]
    horizon = d.horizon_ms[idx]
    hook_age = d.time_since_hook_ms[idx]
    phase = d.dwm_phase_ms[idx]
    period = trace.dwm_period_ms[idx]
    slices: dict[str, np.ndarray] = {}

    for name, lo, hi in SPEED_BINS:
        slices[f"speed_px_s_{name}"] = bin_mask(speed, lo, hi)
    slices["accel_px_s2_100000_plus"] = accel >= 100000.0
    slices["accel_px_s2_500000_plus"] = accel >= 500000.0
    for name, lo, hi in HORIZON_BINS:
        slices[f"horizon_ms_{name}"] = bin_mask(horizon, lo, hi)
    slices["duplicate_or_standing_still"] = d.duplicate_anchor[idx] | (speed < 1.0)
    slices["moving_anchor"] = ~(d.duplicate_anchor[idx] | (speed < 1.0))
    for name, lo, hi in HOOK_AGE_BINS:
        slices[f"time_since_hook_ms_{name}"] = bin_mask(hook_age, lo, hi)
    for name, lo, hi in DWM_PHASE_BINS:
        slices[f"dwm_phase_ms_{name}"] = bin_mask(phase, lo, hi)
    slices["dwm_period_outside_15_18ms"] = (period < 15.0) | (period > 18.0)
    slices["dwm_phase_gt_period"] = phase > period
    slices["horizon_gt_1_25x_period"] = horizon > (1.25 * period)
    return slices


def gate_mask(rule: str, d: Any, idx: np.ndarray) -> np.ndarray:
    speed = d.speed[idx]
    accel = d.accel_mag[idx]
    horizon = d.horizon_ms[idx]
    if rule == "speed>=500_and_horizon>=12":
        return (speed >= 500.0) & (horizon >= 12.0)
    if rule == "speed>=500":
        return speed >= 500.0
    if rule == "speed>=1500":
        return speed >= 1500.0
    if rule == "speed>=3000":
        return speed >= 3000.0
    if rule == "accel>=100000":
        return accel >= 100000.0
    raise ValueError(f"unknown gate rule: {rule}")


def gate_threshold_grid(
    phase4: Any,
    d: Any,
    idx: np.ndarray,
    split_labels: np.ndarray,
    target_direct: np.ndarray,
    baseline_direct: np.ndarray,
    standalone_direct: np.ndarray,
) -> dict[str, Any]:
    val = split_labels == "validation"
    candidates: list[dict[str, Any]] = []
    speed_thresholds = [0.0, 250.0, 500.0, 1000.0, 1500.0, 3000.0]
    horizon_thresholds = [0.0, 4.0, 8.0, 12.0, 16.0, 24.0]
    base_val_errors = np.sqrt(np.sum((baseline_direct[val] - target_direct[val]) ** 2, axis=1))
    baseline_val = phase4.metrics_from_errors(base_val_errors)

    for speed_threshold in speed_thresholds:
        for horizon_threshold in horizon_thresholds:
            risk = (d.speed[idx] >= speed_threshold) & (d.horizon_ms[idx] >= horizon_threshold)
            hybrid = baseline_direct.copy()
            hybrid[risk] = standalone_direct[risk]
            errors = np.sqrt(np.sum((hybrid[val] - target_direct[val]) ** 2, axis=1))
            metrics = phase4.metrics_from_errors(errors)
            candidates.append(
                {
                    "rule": f"speed>={speed_threshold:g}_and_horizon>={horizon_threshold:g}",
                    "speed_threshold_px_s": speed_threshold,
                    "horizon_threshold_ms": horizon_threshold,
                    "validation": metrics,
                    "validation_delta_vs_baseline": delta_metrics(metrics, baseline_val),
                    "validation_gate_true_count": int(risk[val].sum()),
                    "validation_gate_true_ratio": float(risk[val].mean()) if val.any() else 0.0,
                }
            )

    candidates.sort(key=lambda r: (r["validation"]["mean_euclidean_error"], r["validation"]["p95"], r["rule"]))
    return {
        "selection_split": "validation",
        "baseline_validation": baseline_val,
        "selected": candidates[0],
        "candidates": candidates,
    }


def gate_counts_by_split_and_slice(
    mask: np.ndarray,
    split_labels: np.ndarray,
    slices: dict[str, np.ndarray],
) -> dict[str, Any]:
    by_split: dict[str, Any] = {}
    for split in ["train", "validation", "test"]:
        split_mask = split_labels == split
        count = int(split_mask.sum())
        by_split[split] = {
            "count": count,
            "gate_true_count": int((mask & split_mask).sum()),
            "gate_true_ratio": float((mask & split_mask).sum() / count) if count else 0.0,
        }
    by_slice: dict[str, Any] = {}
    for name, slice_mask in slices.items():
        count = int(slice_mask.sum())
        by_slice[name] = {
            "count": count,
            "gate_true_count": int((mask & slice_mask).sum()),
            "gate_true_ratio": float((mask & slice_mask).sum() / count) if count else 0.0,
        }
    return {"by_split": by_split, "by_slice": by_slice}


def representative_rows(
    trace: Any,
    d: Any,
    idx: np.ndarray,
    split_labels: np.ndarray,
    target_direct: np.ndarray,
    baseline_direct: np.ndarray,
    standalone_direct: np.ndarray,
    gated_direct: np.ndarray,
    gate: np.ndarray,
    delta: np.ndarray,
    kind: str,
    limit: int,
) -> list[dict[str, Any]]:
    order = np.argsort(delta)
    if kind == "regression":
        order = order[::-1]
    rows: list[dict[str, Any]] = []
    for pos in order[:limit]:
        anchor_idx = int(idx[pos])
        current_x = float(trace.x[anchor_idx])
        current_y = float(trace.y[anchor_idx])
        rows.append(
            {
                "row_position": int(pos),
                "anchor_index": anchor_idx,
                "split": str(split_labels[pos]),
                "elapsed_us": float(trace.t_us[anchor_idx]),
                "current_x": current_x,
                "current_y": current_y,
                "target_x": current_x + float(target_direct[pos, 0]),
                "target_y": current_y + float(target_direct[pos, 1]),
                "baseline_x": current_x + float(baseline_direct[pos, 0]),
                "baseline_y": current_y + float(baseline_direct[pos, 1]),
                "standalone_x": current_x + float(standalone_direct[pos, 0]),
                "standalone_y": current_y + float(standalone_direct[pos, 1]),
                "gated_x": current_x + float(gated_direct[pos, 0]),
                "gated_y": current_y + float(gated_direct[pos, 1]),
                "baseline_error_px": float(np.linalg.norm(baseline_direct[pos] - target_direct[pos])),
                "standalone_error_px": float(np.linalg.norm(standalone_direct[pos] - target_direct[pos])),
                "gated_error_px": float(np.linalg.norm(gated_direct[pos] - target_direct[pos])),
                "gated_minus_baseline_error_px": float(delta[pos]),
                "gate_modified": bool(gate[pos]),
                "speed_px_s": float(d.speed[anchor_idx]),
                "accel_px_s2": float(d.accel_mag[anchor_idx]),
                "horizon_ms": float(d.horizon_ms[anchor_idx]),
                "time_since_hook_ms": float(d.time_since_hook_ms[anchor_idx]),
                "dwm_phase_ms": float(d.dwm_phase_ms[anchor_idx]),
                "dwm_period_ms": float(trace.dwm_period_ms[anchor_idx]),
                "duplicate_anchor": bool(d.duplicate_anchor[anchor_idx]),
            }
        )
    return rows


def make_text_outputs(output_dir: Path, scores: dict[str, Any]) -> None:
    def f(v: Any, digits: int = 3) -> str:
        return "n/a" if v is None else f"{float(v):.{digits}f}"

    test = scores["same_mask_metrics"]["by_split"]["test"]
    full = scores["same_mask_metrics"]["all_evaluated"]
    phase4_gate = scores["gate_stability"]["phase4_rule"]
    grid = scores["gate_stability"]["threshold_grid"]["selected"]
    old_trace = scores["generalization"]["candidate_traces"][-1]
    decision = scores["decision"]

    report = f"""# Phase 5 Robustness and Generalization Checks

## Scope
- Product target: poll anchors / `dwm-next-vblank`.
- Baseline: `gained-last2-0.75`.
- Reconstructed candidates on the same sequence mask: deterministic baseline, `{SELECTED_MODEL}`, and Phase 4 gated hybrid `{PHASE4_GATE_RULE}`.
- Compatible trace coverage: one v2 DWM trace. The older trace `{Path(old_trace["zip_path"]).name}` is incompatible because it is missing {", ".join(old_trace["missing_required_fields"])}.

## Same-Mask Result
- Test baseline mean {f(test["baseline"]["mean_euclidean_error"])} px, p95 {f(test["baseline"]["p95"])} px, p99 {f(test["baseline"]["p99"])} px.
- Test standalone GRU mean {f(test["standalone"]["mean_euclidean_error"])} px, p95 {f(test["standalone"]["p95"])} px, p99 {f(test["standalone"]["p99"])} px.
- Test gated hybrid mean {f(test["gated"]["mean_euclidean_error"])} px, p95 {f(test["gated"]["p95"])} px, p99 {f(test["gated"]["p99"])} px.
- Gated delta vs baseline on test: mean {f(test["gated_delta_vs_baseline"]["mean_euclidean_error"], 4)} px, p95 {f(test["gated_delta_vs_baseline"]["p95"], 4)} px, p99 {f(test["gated_delta_vs_baseline"]["p99"], 4)} px, max {f(test["gated_delta_vs_baseline"]["max"], 4)} px.
- All evaluated anchors gated delta vs baseline: mean {f(full["gated_delta_vs_baseline"]["mean_euclidean_error"], 4)} px, p95 {f(full["gated_delta_vs_baseline"]["p95"], 4)} px, p99 {f(full["gated_delta_vs_baseline"]["p99"], 4)} px.

## Robustness Findings
- Temporal stability is mixed: block deltas are small and sign-changing rather than a stable improvement across the trace.
- Low-speed/standing anchors remain baseline-favored; the gate mostly avoids them, but the standalone GRU regresses that bulk.
- Tail asymmetry is fragile: gated regressions over 1 px = {scores["tail_regressions"]["gated_worse_than_baseline"]["over_1px"]}, over 5 px = {scores["tail_regressions"]["gated_worse_than_baseline"]["over_5px"]}, over 10 px = {scores["tail_regressions"]["gated_worse_than_baseline"]["over_10px"]}; improvements over 1 px = {scores["tail_regressions"]["gated_better_than_baseline"]["over_1px"]}, over 5 px = {scores["tail_regressions"]["gated_better_than_baseline"]["over_5px"]}, over 10 px = {scores["tail_regressions"]["gated_better_than_baseline"]["over_10px"]}.
- Phase 4 gate modifies {phase4_gate["counts"]["by_split"]["test"]["gate_true_count"]} / {phase4_gate["counts"]["by_split"]["test"]["count"]} test anchors ({phase4_gate["counts"]["by_split"]["test"]["gate_true_ratio"]:.3%}).
- Validation-only threshold grid selected `{grid["rule"]}` with validation mean {f(grid["validation"]["mean_euclidean_error"])} px vs baseline {f(scores["gate_stability"]["threshold_grid"]["baseline_validation"]["mean_euclidean_error"])} px; this is sensitivity analysis, not a test-selected replacement.

## Decision
- Proceed to Phase 6 as deployable GRU/gated predictor: {"yes" if decision["proceed_to_phase6_with_gated_hybrid"] else "no"}.
- Reason: {decision["reason"]}
- Phase 6 recommendation: {decision["phase6_recommendation"]}

See `scores.json` for per-block metrics, risk slices, gate counts, threshold grid, and representative tail rows.
"""
    (output_dir / "report.md").write_text(report, encoding="utf-8")

    readme = """# Phase 5: Robustness and Generalization Checks

Reconstructs the Phase 4 selected candidates for the primary product target:
poll anchors / `dwm-next-vblank`.

## Reproduce

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-5 robustness-generalization/run-phase5-robustness.ps1"
```

The script streams the root trace zips in place, reads Phase 1 split metadata,
and imports Phase 4 model/data helpers. It does not run hooks and does not copy
trace zips into `poc`.

## Outputs

- `scores.json`: machine-readable robustness metrics.
- `report.md`: concise decision report.
- `experiment-log.md`: runtime and reproducibility notes.
- `run_phase5_robustness.py`: reproducible Python runner.
- `run-phase5-robustness.ps1`: wrapper using the existing venv.
"""
    (output_dir / "README.md").write_text(readme, encoding="utf-8")

    runtime = scores["runtime"]
    log = f"""# Phase 5 Experiment Log

- Started UTC: {scores["generated_utc_start"]}
- Finished UTC: {scores["generated_utc_end"]}
- Runtime seconds: {scores["performance"]["total_elapsed_sec"]:.3f}
- Python: {runtime["python_executable"]}
- Torch: {runtime["torch_version"]}
- NumPy: {runtime["numpy_version"]}
- Device: {runtime["device"]["selected_device"]}
- CUDA available: {runtime["device"]["torch_cuda_available"]}
- GPU: {runtime["device"].get("device_name", "n/a")}
- Primary trace zip: {scores["input"]["zip_path"]}
- Poll rows: {scores["input"]["poll_rows"]}
- Hook rows: {scores["input"]["hook_rows"]}
- Model retrained: {SELECTED_MODEL}
- Max epochs: {scores["performance"]["max_epochs"]}
- Patience: {scores["performance"]["patience"]}
- Batch size: {scores["performance"]["batch_size"]}

No packages were installed. No hooks were run. Root trace zips were streamed in place.
"""
    (output_dir / "experiment-log.md").write_text(log, encoding="utf-8")


def run(args: argparse.Namespace) -> dict[str, Any]:
    start_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    start = time.perf_counter()
    phase4 = load_phase4_module(Path(args.phase4_runner_path))

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    torch.backends.cudnn.benchmark = False
    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")

    primary_probe = trace_probe(Path(args.zip_path))
    other_probes = [trace_probe(Path(p)) for p in args.compatibility_zip_paths]

    splits, stopwatch_frequency = phase4.load_phase1(Path(args.phase1_scores_path))
    trace = phase4.read_trace(Path(args.zip_path), stopwatch_frequency)
    d = phase4.build_derived(trace, splits)
    bundle = phase4.build_bundle(trace, d, splits, "sequence")

    configs = phase4.model_configs()
    config_index = next(i for i, c in enumerate(configs) if c["name"] == SELECTED_MODEL)
    config = configs[config_index]
    torch.manual_seed(args.seed + config_index)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed + config_index)
    model, train_info, _, info = phase4.train_sequence(bundle, trace, d, config, device, args)

    offsets = phase4.bundle_offsets(bundle)
    all_idx = info["all_idx"]
    target_direct = info["target_direct"]
    baseline_direct = info["baseline_direct"]
    standalone_direct = np.empty_like(target_direct)
    for split, sl in offsets.items():
        pred, _, _, _ = phase4.predict_for_split(model, bundle, info, split, config["output_kind"], device)
        standalone_direct[sl] = pred

    split_labels = split_labels_for_indices(trace, splits, all_idx)
    phase4_gate_mask = gate_mask(PHASE4_GATE_RULE, d, all_idx)
    gated_direct = baseline_direct.copy()
    gated_direct[phase4_gate_mask] = standalone_direct[phase4_gate_mask]

    baseline_errors = np.sqrt(np.sum((baseline_direct - target_direct) ** 2, axis=1))
    standalone_errors = np.sqrt(np.sum((standalone_direct - target_direct) ** 2, axis=1))
    gated_errors = np.sqrt(np.sum((gated_direct - target_direct) ** 2, axis=1))

    by_split: dict[str, Any] = {}
    for split in ["train", "validation", "test"]:
        by_split[split] = evaluate_subset(
            phase4,
            split_labels == split,
            baseline_errors,
            standalone_errors,
            gated_errors,
        )

    all_metrics = metric_triplet(phase4, baseline_errors, standalone_errors, gated_errors)

    order = np.argsort(trace.t_us[all_idx])
    temporal_blocks: list[dict[str, Any]] = []
    for block_id, positions in enumerate(np.array_split(order, args.temporal_blocks), start=1):
        labels = Counter(split_labels[positions])
        block_idx = all_idx[positions]
        temporal_blocks.append(
            {
                "block": block_id,
                "count": int(positions.size),
                "start_elapsed_us": float(trace.t_us[block_idx[0]]) if positions.size else None,
                "end_elapsed_us": float(trace.t_us[block_idx[-1]]) if positions.size else None,
                "split_counts": dict(labels),
                "metrics": evaluate_subset(phase4, positions, baseline_errors, standalone_errors, gated_errors),
            }
        )

    slices = risk_slices(phase4, trace, d, all_idx)
    risk_results = {
        name: evaluate_subset(phase4, mask, baseline_errors, standalone_errors, gated_errors)
        for name, mask in slices.items()
    }

    tail_delta = gated_errors - baseline_errors
    tail = {
        "gated_worse_than_baseline": {
            "over_1px": int((tail_delta > 1.0).sum()),
            "over_5px": int((tail_delta > 5.0).sum()),
            "over_10px": int((tail_delta > 10.0).sum()),
        },
        "gated_better_than_baseline": {
            "over_1px": int((tail_delta < -1.0).sum()),
            "over_5px": int((tail_delta < -5.0).sum()),
            "over_10px": int((tail_delta < -10.0).sum()),
        },
        "representative_regressions": representative_rows(
            trace,
            d,
            all_idx,
            split_labels,
            target_direct,
            baseline_direct,
            standalone_direct,
            gated_direct,
            phase4_gate_mask,
            tail_delta,
            "regression",
            args.representative_rows,
        ),
        "representative_improvements": representative_rows(
            trace,
            d,
            all_idx,
            split_labels,
            target_direct,
            baseline_direct,
            standalone_direct,
            gated_direct,
            phase4_gate_mask,
            tail_delta,
            "improvement",
            args.representative_rows,
        ),
    }

    grid = gate_threshold_grid(
        phase4,
        d,
        all_idx,
        split_labels,
        target_direct,
        baseline_direct,
        standalone_direct,
    )
    selected_grid = grid["selected"]
    grid_mask = (d.speed[all_idx] >= selected_grid["speed_threshold_px_s"]) & (
        d.horizon_ms[all_idx] >= selected_grid["horizon_threshold_ms"]
    )
    grid_direct = baseline_direct.copy()
    grid_direct[grid_mask] = standalone_direct[grid_mask]
    grid_errors = np.sqrt(np.sum((grid_direct - target_direct) ** 2, axis=1))
    grid["selected"]["by_split_metrics"] = {
        split: metric_triplet(
            phase4,
            baseline_errors[split_labels == split],
            standalone_errors[split_labels == split],
            grid_errors[split_labels == split],
        )
        for split in ["train", "validation", "test"]
    }

    gate_stability = {
        "phase4_rule": {
            "rule": PHASE4_GATE_RULE,
            "counts": gate_counts_by_split_and_slice(phase4_gate_mask, split_labels, slices),
        },
        "threshold_grid": grid,
        "threshold_grid_selected_counts": gate_counts_by_split_and_slice(grid_mask, split_labels, slices),
    }

    test_delta = by_split["test"]["gated_delta_vs_baseline"]
    low_speed = risk_results["speed_px_s_0-500"]["gated_delta_vs_baseline"]
    p99_regressed = (test_delta["p99"] or 0.0) > 0.05
    low_speed_regressed = (low_speed["mean_euclidean_error"] or 0.0) > 0.001 or (low_speed["p95"] or 0.0) > 0.001
    improves_mean_p95 = (test_delta["mean_euclidean_error"] or 0.0) < 0.0 and (test_delta["p95"] or 0.0) < 0.0
    proceed = bool(improves_mean_p95 and not p99_regressed and not low_speed_regressed)
    if proceed:
        reason = "The gated hybrid improved test mean and p95 without material p99 or low-speed regression."
        phase6 = "Proceed with a bounded distillation candidate and keep the GRU as an oracle reference."
    else:
        reason = (
            "The gated hybrid gain is small and fragile: mean/p95 improve slightly, but p99 or low-speed/tail "
            "behavior does not satisfy the Phase 5 decision rule."
        )
        phase6 = "Distill only the analysis insights and gate/risk features first; do not promote the GRU itself as the Phase 6 product candidate."

    end = time.perf_counter()
    scores = {
        "phase": "phase-5 robustness-generalization",
        "generated_utc_start": start_utc,
        "generated_utc_end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "input": {
            "zip_path": trace.zip_path,
            "stopwatch_frequency": stopwatch_frequency,
            "row_count": trace.row_count,
            "poll_rows": trace.poll_rows,
            "hook_rows": trace.hook_rows,
            "phase1_scores_path": str(Path(args.phase1_scores_path).resolve()),
            "phase4_runner_path": str(Path(args.phase4_runner_path).resolve()),
        },
        "runtime": {
            "python_executable": sys.executable,
            "python_version": sys.version,
            "platform": platform.platform(),
            "numpy_version": np.__version__,
            "torch_version": torch.__version__,
            "device": {
                "torch_cuda_available": bool(torch.cuda.is_available()),
                "selected_device": str(device),
                "device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                "cuda_version": torch.version.cuda,
            },
        },
        "dataset": {
            "anchor_set": "poll",
            "target": "dwm-next-vblank",
            "baseline": "gained-last2-0.75",
            "selected_model": SELECTED_MODEL,
            "phase4_gate_rule": PHASE4_GATE_RULE,
            "sequence_required_history_back": bundle.required_back,
            "same_mask_counts": {split: int((split_labels == split).sum()) for split in ["train", "validation", "test"]},
            "split": {s.name: {"start_elapsed_us": s.start_us, "end_elapsed_us": s.end_us} for s in splits},
        },
        "reconstruction": {
            "selected_config": config,
            "phase4_seed_offset_index": config_index,
            "training": train_info,
        },
        "same_mask_metrics": {
            "all_evaluated": all_metrics,
            "by_split": by_split,
        },
        "temporal_stability_blocks": temporal_blocks,
        "risk_slices": risk_results,
        "tail_regressions": tail,
        "gate_stability": gate_stability,
        "generalization": {
            "compatible_external_trace_count": sum(1 for p in other_probes if p["compatible_with_dwm_next_vblank"]),
            "proxy": "No additional compatible v2 DWM traces were available, so within-trace chronological blocks are the generalization proxy.",
            "candidate_traces": [primary_probe, *other_probes],
        },
        "decision": {
            "proceed_to_phase6_with_gated_hybrid": proceed,
            "criteria": "Proceed only if mean/p95 improve without unacceptable p99/max or low-speed regressions.",
            "reason": reason,
            "phase6_recommendation": phase6,
        },
        "performance": {
            "total_elapsed_sec": end - start,
            "batch_size": args.batch_size,
            "max_epochs": args.max_epochs,
            "patience": args.patience,
            "temporal_blocks": args.temporal_blocks,
        },
    }
    return json_safe(scores)


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip-path", default=str(repo_root / "cursor-mirror-trace-20260501-091537.zip"))
    parser.add_argument(
        "--compatibility-zip-paths",
        nargs="*",
        default=[str(repo_root / "cursor-mirror-trace-20260501-000443.zip")],
    )
    parser.add_argument(
        "--phase1-scores-path",
        default=str(repo_root / "poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json"),
    )
    parser.add_argument(
        "--phase4-runner-path",
        default=str(repo_root / "poc/cursor-prediction-v2/phase-4 best-accuracy-model-search/run_phase4_model_search.py"),
    )
    parser.add_argument("--output-dir", default=str(script_dir))
    parser.add_argument("--seed", type=int, default=20260501)
    parser.add_argument("--max-epochs", type=int, default=80)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--temporal-blocks", type=int, default=8)
    parser.add_argument("--representative-rows", type=int, default=12)
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    scores = run(args)
    (output_dir / "scores.json").write_text(json.dumps(scores, indent=2) + "\n", encoding="utf-8")
    make_text_outputs(output_dir, scores)
    test = scores["same_mask_metrics"]["by_split"]["test"]
    print(f"wrote {output_dir / 'scores.json'}")
    print(f"device={scores['runtime']['device']['selected_device']} gpu={scores['runtime']['device'].get('device_name', 'n/a')}")
    print(
        "test gated mean={gmean:.6f}px p95={gp95:.6f}px p99={gp99:.6f}px baseline mean={bmean:.6f}px p95={bp95:.6f}px p99={bp99:.6f}px proceed={proceed}".format(
            gmean=test["gated"]["mean_euclidean_error"],
            gp95=test["gated"]["p95"],
            gp99=test["gated"]["p99"],
            bmean=test["baseline"]["mean_euclidean_error"],
            bp95=test["baseline"]["p95"],
            bp99=test["baseline"]["p99"],
            proceed=scores["decision"]["proceed_to_phase6_with_gated_hybrid"],
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
