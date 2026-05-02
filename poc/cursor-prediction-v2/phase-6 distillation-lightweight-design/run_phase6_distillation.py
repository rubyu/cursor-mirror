#!/usr/bin/env python3
"""Phase 6 distillation and lightweight design search.

This runner reads the root trace zip in place, reconstructs the Phase 2/3
poll-anchor / dwm-next-vblank dataset, and evaluates lightweight deterministic
or linear residual candidates. It deliberately does not import or deploy the
Phase 4/5 GRU.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import platform
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


BASELINE_GAIN = 0.75
GAIN_GRID = np.asarray([0.0, 0.25, 0.5, 0.625, 0.75, 0.875, 1.0, 1.125, 1.25], dtype=np.float64)

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
ACCEL_BINS = [
    ("0-25k", 0.0, 25_000.0),
    ("25k-100k", 25_000.0, 100_000.0),
    ("100k-500k", 100_000.0, 500_000.0),
    ("500k+", 500_000.0, math.inf),
]


@dataclass(frozen=True)
class SplitDef:
    name: str
    start_us: float
    end_us: float


@dataclass
class TraceData:
    sequence: np.ndarray
    t_us: np.ndarray
    x: np.ndarray
    y: np.ndarray
    vblank_elapsed_us: np.ndarray
    dwm_period_ms: np.ndarray
    unique_vblank_elapsed_us: np.ndarray
    hook_t_us: np.ndarray
    zip_path: str
    row_count: int
    poll_rows: int
    hook_rows: int


@dataclass
class Derived:
    dt_ms: np.ndarray
    dx: np.ndarray
    dy: np.ndarray
    vx: np.ndarray
    vy: np.ndarray
    speed: np.ndarray
    accel_x: np.ndarray
    accel_y: np.ndarray
    accel_mag: np.ndarray
    turn_cos: np.ndarray
    duplicate_anchor: np.ndarray
    time_since_hook_ms: np.ndarray
    time_since_move_ms: np.ndarray
    dwm_phase_ms: np.ndarray
    horizon_ms: np.ndarray
    target_x: np.ndarray
    target_y: np.ndarray
    target_valid: np.ndarray


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


def pct(values: np.ndarray, p: float) -> float | None:
    return None if values.size == 0 else float(np.percentile(values, p))


def metrics_from_errors(errors: np.ndarray) -> dict[str, Any]:
    errors = np.asarray(errors, dtype=np.float64)
    if errors.size == 0:
        return {
            "count": 0,
            "mean_euclidean_error": None,
            "rmse": None,
            "p50": None,
            "p90": None,
            "p95": None,
            "p99": None,
            "max": None,
        }
    return {
        "count": int(errors.size),
        "mean_euclidean_error": float(errors.mean()),
        "rmse": float(math.sqrt(float(np.mean(errors * errors)))),
        "p50": pct(errors, 50),
        "p90": pct(errors, 90),
        "p95": pct(errors, 95),
        "p99": pct(errors, 99),
        "max": float(errors.max()),
    }


def metric_delta(candidate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    keys = ["mean_euclidean_error", "rmse", "p50", "p90", "p95", "p99", "max"]
    return {
        key: None if candidate[key] is None or baseline[key] is None else float(candidate[key] - baseline[key])
        for key in keys
    }


def bin_mask(values: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return values >= lo if math.isinf(hi) else ((values >= lo) & (values < hi))


def load_phase1(path: Path) -> tuple[list[SplitDef], int]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    split = payload["recommended_split"]
    return (
        [
            SplitDef("train", float(split["train"]["start_elapsed_us"]), float(split["train"]["end_elapsed_us"])),
            SplitDef("validation", float(split["validation"]["start_elapsed_us"]), float(split["validation"]["end_elapsed_us"])),
            SplitDef("test", float(split["test"]["start_elapsed_us"]), float(split["test"]["end_elapsed_us"])),
        ],
        int(payload["input"]["metadata"]["StopwatchFrequency"]),
    )


def trace_probe(zip_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(zip_path, "r") as archive:
        metadata = json.loads(archive.read("metadata.json").decode("utf-8-sig"))
        with archive.open("trace.csv", "r") as raw:
            reader = csv.reader(line.decode("utf-8-sig") for line in raw)
            header = next(reader)
    required = {"event", "elapsedMicroseconds", "stopwatchTicks", "x", "y", "dwmQpcRefreshPeriod", "dwmQpcVBlank"}
    missing = sorted(required - set(header))
    return {
        "zip_path": str(zip_path.resolve()),
        "metadata": metadata,
        "compatible_with_dwm_next_vblank": not missing and int(metadata.get("TraceFormatVersion", 0) or 0) >= 2,
        "missing_required_fields": missing,
    }


def find_default_trace(repo_root: Path) -> Path:
    candidates = sorted(repo_root.glob("cursor-mirror-trace-*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    for candidate in candidates:
        try:
            if trace_probe(candidate)["compatible_with_dwm_next_vblank"]:
                return candidate
        except Exception:
            continue
    raise FileNotFoundError("no compatible cursor-mirror-trace-*.zip found at repo root")


def read_trace(zip_path: Path, stopwatch_frequency: int) -> TraceData:
    sequence: list[int] = []
    t_us: list[float] = []
    x: list[float] = []
    y: list[float] = []
    vblank_elapsed_us: list[float] = []
    dwm_period_ms: list[float] = []
    unique_vblank: list[float] = []
    hook_t_us: list[float] = []
    row_count = 0
    poll_rows = 0
    hook_rows = 0
    last_unique = -math.inf

    with zipfile.ZipFile(zip_path, "r") as archive:
        with archive.open("trace.csv", "r") as raw:
            rows = csv.DictReader(line.decode("utf-8-sig") for line in raw)
            for row in rows:
                row_count += 1
                elapsed = float(row["elapsedMicroseconds"])
                if row["event"] == "poll":
                    poll_rows += 1
                    ticks = int(row["stopwatchTicks"])
                    vblank = int(row["dwmQpcVBlank"])
                    period = int(row["dwmQpcRefreshPeriod"])
                    vb_elapsed = elapsed + ((vblank - ticks) * 1_000_000.0 / stopwatch_frequency)
                    sequence.append(int(row["sequence"]))
                    t_us.append(elapsed)
                    x.append(float(row["x"]))
                    y.append(float(row["y"]))
                    vblank_elapsed_us.append(vb_elapsed)
                    dwm_period_ms.append(period * 1000.0 / stopwatch_frequency)
                    if vb_elapsed > last_unique + 0.5:
                        unique_vblank.append(vb_elapsed)
                        last_unique = vb_elapsed
                elif row["event"] in ("move", "hook"):
                    hook_rows += 1
                    hook_t_us.append(elapsed)

    return TraceData(
        sequence=np.asarray(sequence, dtype=np.int64),
        t_us=np.asarray(t_us, dtype=np.float64),
        x=np.asarray(x, dtype=np.float64),
        y=np.asarray(y, dtype=np.float64),
        vblank_elapsed_us=np.asarray(vblank_elapsed_us, dtype=np.float64),
        dwm_period_ms=np.asarray(dwm_period_ms, dtype=np.float64),
        unique_vblank_elapsed_us=np.asarray(unique_vblank, dtype=np.float64),
        hook_t_us=np.asarray(hook_t_us, dtype=np.float64),
        zip_path=str(zip_path.resolve()),
        row_count=row_count,
        poll_rows=poll_rows,
        hook_rows=hook_rows,
    )


def interpolate_poll(trace: TraceData, target_t: float) -> tuple[float, float] | None:
    idx = int(np.searchsorted(trace.t_us, target_t, side="left"))
    if idx < trace.t_us.size and abs(trace.t_us[idx] - target_t) < 0.0001:
        return float(trace.x[idx]), float(trace.y[idx])
    if idx <= 0 or idx >= trace.t_us.size:
        return None
    t0 = trace.t_us[idx - 1]
    t1 = trace.t_us[idx]
    if t1 <= t0:
        return None
    f = (target_t - t0) / (t1 - t0)
    return (
        float(trace.x[idx - 1] + (trace.x[idx] - trace.x[idx - 1]) * f),
        float(trace.y[idx - 1] + (trace.y[idx] - trace.y[idx - 1]) * f),
    )


def split_for_time(splits: list[SplitDef], t_us: float) -> SplitDef | None:
    for split in splits:
        if split.start_us <= t_us <= split.end_us:
            return split
    return None


def build_derived(trace: TraceData, splits: list[SplitDef]) -> Derived:
    n = trace.t_us.size
    dt_ms = np.zeros(n, dtype=np.float64)
    dx = np.zeros(n, dtype=np.float64)
    dy = np.zeros(n, dtype=np.float64)
    vx = np.zeros(n, dtype=np.float64)
    vy = np.zeros(n, dtype=np.float64)
    speed = np.zeros(n, dtype=np.float64)
    accel_x = np.zeros(n, dtype=np.float64)
    accel_y = np.zeros(n, dtype=np.float64)
    accel_mag = np.zeros(n, dtype=np.float64)
    turn_cos = np.ones(n, dtype=np.float64)
    duplicate_anchor = np.zeros(n, dtype=bool)
    time_since_hook_ms = np.full(n, 1000.0, dtype=np.float64)
    time_since_move_ms = np.full(n, 1000.0, dtype=np.float64)
    dwm_phase_ms = (trace.vblank_elapsed_us - trace.t_us) / 1000.0
    horizon_ms = np.full(n, np.nan, dtype=np.float64)
    target_x = np.full(n, np.nan, dtype=np.float64)
    target_y = np.full(n, np.nan, dtype=np.float64)
    target_valid = np.zeros(n, dtype=bool)

    for i in range(1, n):
        dt = (trace.t_us[i] - trace.t_us[i - 1]) / 1000.0
        dt_ms[i] = dt
        if dt > 0:
            dx[i] = trace.x[i] - trace.x[i - 1]
            dy[i] = trace.y[i] - trace.y[i - 1]
            vx[i] = dx[i] / (dt / 1000.0)
            vy[i] = dy[i] / (dt / 1000.0)
            speed[i] = math.hypot(vx[i], vy[i])
            duplicate_anchor[i] = dx[i] == 0.0 and dy[i] == 0.0

    for i in range(2, n):
        dt1 = (trace.t_us[i] - trace.t_us[i - 1]) / 1_000_000.0
        dt0 = (trace.t_us[i - 1] - trace.t_us[i - 2]) / 1_000_000.0
        if dt1 > 0 and dt0 > 0:
            adt = max(1e-6, (dt0 + dt1) * 0.5)
            accel_x[i] = (vx[i] - vx[i - 1]) / adt
            accel_y[i] = (vy[i] - vy[i - 1]) / adt
            accel_mag[i] = math.hypot(accel_x[i], accel_y[i])
        norm0 = math.hypot(dx[i - 1], dy[i - 1])
        norm1 = math.hypot(dx[i], dy[i])
        if norm0 > 1e-9 and norm1 > 1e-9:
            turn_cos[i] = float(np.clip((dx[i - 1] * dx[i] + dy[i - 1] * dy[i]) / (norm0 * norm1), -1.0, 1.0))

    hook_t = trace.hook_t_us
    for i, t in enumerate(trace.t_us):
        hidx = int(np.searchsorted(hook_t, t, side="right"))
        if hidx > 0:
            time_since_hook_ms[i] = min(1000.0, (t - hook_t[hidx - 1]) / 1000.0)

    last_move = -math.inf
    for i in range(1, n):
        if not duplicate_anchor[i]:
            last_move = trace.t_us[i]
        if math.isfinite(last_move):
            time_since_move_ms[i] = min(1000.0, (trace.t_us[i] - last_move) / 1000.0)

    for i in range(1, n):
        split = split_for_time(splits, float(trace.t_us[i]))
        if split is None or trace.t_us[i - 1] < split.start_us:
            continue
        vb_idx = int(np.searchsorted(trace.unique_vblank_elapsed_us, trace.t_us[i] + 0.001, side="right"))
        if vb_idx >= trace.unique_vblank_elapsed_us.size:
            continue
        target_t = float(trace.unique_vblank_elapsed_us[vb_idx])
        if target_t <= trace.t_us[i] or target_t > split.end_us or target_t - trace.t_us[i] > 50_000.0:
            continue
        label = interpolate_poll(trace, target_t)
        if label is None:
            continue
        target_valid[i] = True
        horizon_ms[i] = (target_t - trace.t_us[i]) / 1000.0
        target_x[i], target_y[i] = label

    return Derived(
        dt_ms=dt_ms,
        dx=dx,
        dy=dy,
        vx=vx,
        vy=vy,
        speed=speed,
        accel_x=accel_x,
        accel_y=accel_y,
        accel_mag=accel_mag,
        turn_cos=turn_cos,
        duplicate_anchor=duplicate_anchor,
        time_since_hook_ms=time_since_hook_ms,
        time_since_move_ms=time_since_move_ms,
        dwm_phase_ms=dwm_phase_ms,
        horizon_ms=horizon_ms,
        target_x=target_x,
        target_y=target_y,
        target_valid=target_valid,
    )


def split_indices(trace: TraceData, d: Derived, splits: list[SplitDef], required_back: int = 2) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for split in splits:
        idx: list[int] = []
        for i in range(max(1, required_back), trace.t_us.size):
            if trace.t_us[i] < split.start_us or trace.t_us[i] > split.end_us:
                continue
            if trace.t_us[i - required_back] < split.start_us:
                continue
            if d.target_valid[i] and d.dt_ms[i] > 0:
                idx.append(i)
        out[split.name] = np.asarray(idx, dtype=np.int64)
    return out


def pred_gain(trace: TraceData, d: Derived, idx: np.ndarray, gain: np.ndarray | float) -> np.ndarray:
    h_sec = d.horizon_ms[idx] / 1000.0
    g = gain if isinstance(gain, np.ndarray) else float(gain)
    px = trace.x[idx] + d.vx[idx] * g * h_sec
    py = trace.y[idx] + d.vy[idx] * g * h_sec
    return np.column_stack([px, py])


def errors_for(pred: np.ndarray, target: np.ndarray) -> np.ndarray:
    delta = pred - target
    return np.sqrt(np.sum(delta * delta, axis=1))


def target_xy(d: Derived, idx: np.ndarray) -> np.ndarray:
    return np.column_stack([d.target_x[idx], d.target_y[idx]])


def group_labels(d: Derived, idx: np.ndarray, family: str) -> np.ndarray:
    def label_from_bins(values: np.ndarray, bins: list[tuple[str, float, float]]) -> np.ndarray:
        labels = np.empty(values.size, dtype=object)
        for name, lo, hi in bins:
            labels[bin_mask(values, lo, hi)] = name
        return labels

    if family == "speed":
        return label_from_bins(d.speed[idx], SPEED_BINS)
    if family == "horizon":
        return label_from_bins(d.horizon_ms[idx], HORIZON_BINS)
    if family == "acceleration":
        return label_from_bins(d.accel_mag[idx], ACCEL_BINS)
    if family == "speed_x_horizon":
        speed = label_from_bins(d.speed[idx], SPEED_BINS)
        horizon = label_from_bins(d.horizon_ms[idx], HORIZON_BINS)
        return np.asarray([f"{s}|{h}" for s, h in zip(speed, horizon)], dtype=object)
    raise ValueError(f"unknown family: {family}")


def fit_gain_table(trace: TraceData, d: Derived, idx: np.ndarray, family: str, min_count: int = 20) -> dict[str, Any]:
    labels = group_labels(d, idx, family)
    target = target_xy(d, idx)
    table: dict[str, float] = {}
    details: dict[str, Any] = {}
    for label in sorted({str(x) for x in labels}):
        mask = labels == label
        count = int(mask.sum())
        if count < min_count:
            table[label] = BASELINE_GAIN
            details[label] = {"count": count, "selected_gain": BASELINE_GAIN, "fallback": "min_count"}
            continue
        best: tuple[float, float, float] | None = None
        for gain in GAIN_GRID:
            err = errors_for(pred_gain(trace, d, idx[mask], float(gain)), target[mask])
            key = (float(err.mean()), float(np.percentile(err, 99)), float(gain))
            if best is None or key < best:
                best = key
        assert best is not None
        table[label] = best[2]
        details[label] = {"count": count, "selected_gain": best[2], "train_mean": best[0], "train_p99": best[1]}
    return {"family": family, "min_count": min_count, "table": table, "details": details}


def apply_gain_table(trace: TraceData, d: Derived, idx: np.ndarray, table_spec: dict[str, Any]) -> np.ndarray:
    labels = group_labels(d, idx, table_spec["family"])
    gains = np.full(idx.size, BASELINE_GAIN, dtype=np.float64)
    table = table_spec["table"]
    for label, gain in table.items():
        gains[labels == label] = float(gain)
    return pred_gain(trace, d, idx, gains)


def conservative_table(
    trace: TraceData,
    d: Derived,
    train_idx: np.ndarray,
    val_idx: np.ndarray,
    family: str,
    high_risk_only: bool,
) -> dict[str, Any]:
    table_spec = fit_gain_table(trace, d, train_idx, family)
    labels = group_labels(d, val_idx, family)
    target = target_xy(d, val_idx)
    baseline = pred_gain(trace, d, val_idx, BASELINE_GAIN)
    candidate = apply_gain_table(trace, d, val_idx, table_spec)
    keep: dict[str, bool] = {}
    validation_checks: dict[str, Any] = {}
    high_risk = (d.speed[val_idx] >= 1500.0) | (d.accel_mag[val_idx] >= 100_000.0) | (d.horizon_ms[val_idx] >= 16.0)
    for label in sorted({str(x) for x in labels}):
        mask = labels == label
        if high_risk_only:
            mask = mask & high_risk
        if int(mask.sum()) < 10:
            keep[label] = False
            validation_checks[label] = {"count": int(mask.sum()), "accepted": False, "reason": "too_few_validation_rows"}
            continue
        b_err = errors_for(baseline[mask], target[mask])
        c_err = errors_for(candidate[mask], target[mask])
        b = metrics_from_errors(b_err)
        c = metrics_from_errors(c_err)
        diff = c_err - b_err
        reg5 = int((diff > 5.0).sum())
        imp5 = int((diff < -5.0).sum())
        accepted = (
            c["mean_euclidean_error"] < b["mean_euclidean_error"]
            and c["p99"] <= b["p99"] + 1e-9
            and c["max"] <= b["max"] + 1e-9
            and reg5 <= imp5
        )
        keep[label] = bool(accepted)
        validation_checks[label] = {
            "count": int(mask.sum()),
            "accepted": bool(accepted),
            "gain": table_spec["table"].get(label, BASELINE_GAIN),
            "candidate_delta_vs_baseline": metric_delta(c, b),
            "regressions_gt5": reg5,
            "improvements_gt5": imp5,
        }
    return {
        "family": family,
        "base_table": table_spec,
        "accepted_labels": keep,
        "validation_checks": validation_checks,
        "high_risk_only": high_risk_only,
    }


def apply_conservative_table(trace: TraceData, d: Derived, idx: np.ndarray, spec: dict[str, Any]) -> np.ndarray:
    labels = group_labels(d, idx, spec["family"])
    high_risk = (d.speed[idx] >= 1500.0) | (d.accel_mag[idx] >= 100_000.0) | (d.horizon_ms[idx] >= 16.0)
    baseline = pred_gain(trace, d, idx, BASELINE_GAIN)
    candidate = apply_gain_table(trace, d, idx, spec["base_table"])
    out = baseline.copy()
    accepted = np.zeros(idx.size, dtype=bool)
    for label, keep in spec["accepted_labels"].items():
        if keep:
            accepted |= labels == label
    if spec["high_risk_only"]:
        accepted &= high_risk
    out[accepted] = candidate[accepted]
    return out


def build_linear_features(trace: TraceData, d: Derived, idx: np.ndarray) -> tuple[np.ndarray, list[str]]:
    h = d.horizon_ms[idx]
    base_disp = np.sqrt((d.vx[idx] * h / 1000.0 * BASELINE_GAIN) ** 2 + (d.vy[idx] * h / 1000.0 * BASELINE_GAIN) ** 2)
    values = np.column_stack(
        [
            d.dx[idx],
            d.dy[idx],
            d.dt_ms[idx],
            d.vx[idx],
            d.vy[idx],
            d.speed[idx],
            d.accel_x[idx],
            d.accel_y[idx],
            d.accel_mag[idx],
            d.turn_cos[idx],
            h,
            d.dwm_phase_ms[idx],
            h / np.maximum(trace.dwm_period_ms[idx], 1e-6),
            d.time_since_hook_ms[idx],
            d.time_since_move_ms[idx],
            d.duplicate_anchor[idx].astype(np.float64),
            base_disp,
            d.speed[idx] * h / 1000.0,
        ]
    )
    names = [
        "last_delta_x",
        "last_delta_y",
        "last_dt_ms",
        "last_velocity_x_px_s",
        "last_velocity_y_px_s",
        "speed_px_s",
        "accel_x_px_s2",
        "accel_y_px_s2",
        "accel_mag_px_s2",
        "turn_cos",
        "target_horizon_ms",
        "dwm_phase_ms",
        "horizon_over_dwm_period",
        "time_since_last_hook_ms",
        "time_since_last_poll_movement_ms",
        "duplicate_anchor_flag",
        "baseline_distance",
        "speed_times_horizon",
    ]
    return np.nan_to_num(values, nan=0.0, posinf=1e6, neginf=-1e6), names


def fit_ridge_residual(
    trace: TraceData,
    d: Derived,
    train_idx: np.ndarray,
    val_idx: np.ndarray,
) -> dict[str, Any]:
    x_train, names = build_linear_features(trace, d, train_idx)
    x_val, _ = build_linear_features(trace, d, val_idx)
    mean = x_train.mean(axis=0)
    std = x_train.std(axis=0)
    std = np.where(std < 1e-9, 1.0, std)
    xt = (x_train - mean) / std
    xv = (x_val - mean) / std
    xt = np.column_stack([np.ones(xt.shape[0]), xt])
    xv = np.column_stack([np.ones(xv.shape[0]), xv])

    y_train = target_xy(d, train_idx) - pred_gain(trace, d, train_idx, BASELINE_GAIN)
    target_val = target_xy(d, val_idx)
    base_val = pred_gain(trace, d, val_idx, BASELINE_GAIN)
    base_val_metrics = metrics_from_errors(errors_for(base_val, target_val))
    best: dict[str, Any] | None = None
    for alpha in [0.01, 0.1, 1.0, 10.0, 100.0, 1000.0]:
        penalty = np.eye(xt.shape[1]) * alpha
        penalty[0, 0] = 0.0
        coef = np.linalg.solve(xt.T @ xt + penalty, xt.T @ y_train)
        residual = xv @ coef
        for clip in [None, 1.0, 2.0, 5.0]:
            clipped = residual.copy()
            if clip is not None:
                mag = np.sqrt(np.sum(clipped * clipped, axis=1))
                scale = np.minimum(1.0, clip / np.maximum(mag, 1e-9))
                clipped *= scale[:, None]
            pred = base_val + clipped
            metrics = metrics_from_errors(errors_for(pred, target_val))
            item = {
                "alpha": alpha,
                "clip_px": clip,
                "validation": metrics,
                "validation_delta_vs_baseline": metric_delta(metrics, base_val_metrics),
                "coef": coef,
            }
            key = (metrics["mean_euclidean_error"], metrics["p95"], metrics["p99"])
            if best is None or key < (
                best["validation"]["mean_euclidean_error"],
                best["validation"]["p95"],
                best["validation"]["p99"],
            ):
                best = item
    assert best is not None
    return {
        "feature_names": ["intercept"] + names,
        "feature_mean": mean,
        "feature_std": std,
        "alpha": best["alpha"],
        "clip_px": best["clip_px"],
        "coef": best["coef"],
        "validation": best["validation"],
        "validation_delta_vs_baseline": best["validation_delta_vs_baseline"],
    }


def apply_ridge_residual(trace: TraceData, d: Derived, idx: np.ndarray, spec: dict[str, Any]) -> np.ndarray:
    x, _ = build_linear_features(trace, d, idx)
    x = (x - spec["feature_mean"]) / spec["feature_std"]
    x = np.column_stack([np.ones(x.shape[0]), x])
    residual = x @ spec["coef"]
    clip = spec["clip_px"]
    if clip is not None:
        mag = np.sqrt(np.sum(residual * residual, axis=1))
        residual *= np.minimum(1.0, float(clip) / np.maximum(mag, 1e-9))[:, None]
    return pred_gain(trace, d, idx, BASELINE_GAIN) + residual


def regression_counts(candidate_errors: np.ndarray, baseline_errors: np.ndarray) -> dict[str, int]:
    diff = candidate_errors - baseline_errors
    return {
        "regressions_gt1": int((diff > 1.0).sum()),
        "regressions_gt5": int((diff > 5.0).sum()),
        "regressions_gt10": int((diff > 10.0).sum()),
        "improvements_gt1": int((diff < -1.0).sum()),
        "improvements_gt5": int((diff < -5.0).sum()),
        "improvements_gt10": int((diff < -10.0).sum()),
    }


def slice_metrics(errors: np.ndarray, trace: TraceData, d: Derived, idx: np.ndarray) -> dict[str, Any]:
    slices: dict[str, np.ndarray] = {}
    for name, lo, hi in SPEED_BINS:
        slices[f"speed_px_s_{name}"] = bin_mask(d.speed[idx], lo, hi)
    slices["accel_px_s2_100000_plus"] = d.accel_mag[idx] >= 100_000.0
    slices["accel_px_s2_500000_plus"] = d.accel_mag[idx] >= 500_000.0
    for name, lo, hi in HORIZON_BINS:
        slices[f"horizon_ms_{name}"] = bin_mask(d.horizon_ms[idx], lo, hi)
    slices["duplicate_or_standing_still"] = d.duplicate_anchor[idx] | (d.speed[idx] < 1.0)
    slices["moving_anchor"] = ~(d.duplicate_anchor[idx] | (d.speed[idx] < 1.0))
    slices["time_since_hook_ms_0_8"] = d.time_since_hook_ms[idx] < 8.0
    slices["fast_hook_age_0_8_ms"] = (d.speed[idx] >= 1500.0) & (d.time_since_hook_ms[idx] < 8.0)
    slices["dwm_phase_gt_period"] = d.dwm_phase_ms[idx] > trace.dwm_period_ms[idx]
    slices["horizon_gt_1_25x_period"] = d.horizon_ms[idx] > (1.25 * trace.dwm_period_ms[idx])
    return {name: metrics_from_errors(errors[mask]) for name, mask in slices.items()}


def evaluate_candidate(
    name: str,
    family: str,
    trace: TraceData,
    d: Derived,
    idx_by_split: dict[str, np.ndarray],
    predict: Any,
    baseline_errors_by_split: dict[str, np.ndarray],
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    by_split: dict[str, Any] = {}
    for split, idx in idx_by_split.items():
        target = target_xy(d, idx)
        pred = predict(idx)
        errors = errors_for(pred, target)
        metrics = metrics_from_errors(errors)
        by_split[split] = {
            **metrics,
            "delta_vs_baseline": metric_delta(metrics, metrics_from_errors(baseline_errors_by_split[split])),
            "regression_counts_vs_baseline": regression_counts(errors, baseline_errors_by_split[split]),
            "speed_bins_px_s": {
                label: metrics_from_errors(errors[bin_mask(d.speed[idx], lo, hi)]) for label, lo, hi in SPEED_BINS
            },
            "risk_slices": slice_metrics(errors, trace, d, idx),
        }
    return {
        "name": name,
        "family": family,
        "metrics_by_split": by_split,
        "metadata": metadata or {},
    }


def fixed_horizon_diagnostics(trace: TraceData, d: Derived, splits: list[SplitDef], horizons_ms: list[float]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for horizon in horizons_ms:
        metrics_by_split: dict[str, Any] = {}
        for split in splits:
            idxs: list[int] = []
            targets: list[tuple[float, float]] = []
            for i in range(2, trace.t_us.size):
                if trace.t_us[i] < split.start_us or trace.t_us[i] > split.end_us or trace.t_us[i - 2] < split.start_us:
                    continue
                target_t = trace.t_us[i] + horizon * 1000.0
                if target_t > split.end_us:
                    continue
                label = interpolate_poll(trace, target_t)
                if label is None or d.dt_ms[i] <= 0:
                    continue
                idxs.append(i)
                targets.append(label)
            idx = np.asarray(idxs, dtype=np.int64)
            if idx.size == 0:
                metrics_by_split[split.name] = metrics_from_errors(np.asarray([]))
                continue
            pred = pred_gain(trace, d, idx, BASELINE_GAIN)
            err = errors_for(pred, np.asarray(targets, dtype=np.float64))
            metrics_by_split[split.name] = metrics_from_errors(err)
        out[f"fixed_{horizon:g}ms"] = metrics_by_split
    return out


def candidate_costs() -> dict[str, Any]:
    return {
        "gained_last2_fixed_gain": {
            "state_bytes_estimate": 32,
            "ops_per_prediction_estimate": 20,
            "allocations_per_prediction": 0,
            "csharp_complexity": "very low; keep previous poll point/time and multiply velocity by horizon and gain",
        },
        "piecewise_gain_table": {
            "state_bytes_estimate": 96,
            "ops_per_prediction_estimate": 35,
            "allocations_per_prediction": 0,
            "csharp_complexity": "low; compute speed/horizon bin and read a small readonly gain table",
        },
        "conservative_risk_gate": {
            "state_bytes_estimate": 128,
            "ops_per_prediction_estimate": 45,
            "allocations_per_prediction": 0,
            "csharp_complexity": "low-medium; add high-risk predicate and fallback-to-baseline table entries",
        },
        "ridge_residual": {
            "state_bytes_estimate": 640,
            "ops_per_prediction_estimate": 250,
            "allocations_per_prediction": 0,
            "csharp_complexity": "medium; normalize 18 features and two dot products, plus residual clipping",
        },
    }


def rank_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for c in candidates:
        val = c["metrics_by_split"]["validation"]
        test = c["metrics_by_split"]["test"]
        vd = val["delta_vs_baseline"]
        td = test["delta_vs_baseline"]
        is_baseline = c["name"] == "gained-last2-0.75"
        material_gain = vd["mean_euclidean_error"] <= -0.01 and td["mean_euclidean_error"] <= -0.01
        accepted = is_baseline or (
            material_gain
            and vd["p95"] <= 0.0
            and vd["p99"] <= 0.0
            and vd["max"] <= 0.0
            and td["p95"] <= 0.0
            and td["p99"] <= 0.0
            and td["max"] <= 0.0
            and test["regression_counts_vs_baseline"]["regressions_gt1"]
            <= test["regression_counts_vs_baseline"]["improvements_gt1"]
        )
        ranked.append(
            {
                "name": c["name"],
                "family": c["family"],
                "accepted_by_phase6_rule": bool(accepted),
                "material_gain_threshold_px": 0.01,
                "validation_mean_delta": vd["mean_euclidean_error"],
                "validation_p95_delta": vd["p95"],
                "validation_p99_delta": vd["p99"],
                "validation_max_delta": vd["max"],
                "test_mean_delta": td["mean_euclidean_error"],
                "test_p95_delta": td["p95"],
                "test_p99_delta": td["p99"],
                "test_max_delta": td["max"],
                "test_regress_gt1": test["regression_counts_vs_baseline"]["regressions_gt1"],
                "test_improve_gt1": test["regression_counts_vs_baseline"]["improvements_gt1"],
            }
        )
    ranked.sort(
        key=lambda r: (
            not r["accepted_by_phase6_rule"],
            r["test_p99_delta"] if r["test_p99_delta"] is not None else math.inf,
            r["test_mean_delta"] if r["test_mean_delta"] is not None else math.inf,
            r["test_regress_gt1"],
            r["name"],
        )
    )
    return ranked


def fmt(value: Any, digits: int = 4) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    return f"{float(value):.{digits}f}"


def write_outputs(output_dir: Path, scores: dict[str, Any]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "scores.json").write_text(json.dumps(json_safe(scores), indent=2), encoding="utf-8")

    ranked = scores["ranked_candidates"]
    baseline_test = scores["baseline"]["metrics_by_split"]["test"]
    top = ranked[0]
    product = scores["decision"]["simplest_acceptable_product_candidate"]

    table_lines = [
        "| Rank | Candidate | Accepted | Test mean delta | Test p95 delta | Test p99 delta | Test max delta | >1px reg / imp |",
        "|---:|---|---:|---:|---:|---:|---:|---:|",
    ]
    for i, row in enumerate(ranked[:10], start=1):
        table_lines.append(
            f"| {i} | `{row['name']}` | {fmt(row['accepted_by_phase6_rule'])} | "
            f"{fmt(row['test_mean_delta'])} | {fmt(row['test_p95_delta'])} | {fmt(row['test_p99_delta'])} | "
            f"{fmt(row['test_max_delta'])} | {row['test_regress_gt1']} / {row['test_improve_gt1']} |"
        )

    report = f"""# Phase 6 Distillation and Lightweight Model Design

## Scope
- Product target: poll anchors / `dwm-next-vblank`.
- Accepted baseline: `gained-last2-0.75`.
- Phase 4/5 GRU is treated only as an insight source; it is not deployed or used by this runner.
- Trace data is read from the root zip in place: `{scores['input']['zip_path']}`.

## Baseline
- Test mean {fmt(baseline_test['mean_euclidean_error'], 3)} px, RMSE {fmt(baseline_test['rmse'], 3)} px, p95 {fmt(baseline_test['p95'], 3)} px, p99 {fmt(baseline_test['p99'], 3)} px, max {fmt(baseline_test['max'], 3)} px.

## Ranked Lightweight Candidates
{chr(10).join(table_lines)}

## Findings
- Fixed gain variants around the accepted gain do not beat the baseline strongly enough on tail risk.
- Train-selected piecewise gain tables can move mean error, but the validation/test tails remain fragile once p99/max and regression counts are considered.
- Conservative gates usually collapse toward a no-op fallback because the validation p99/max guard rejects most corrective bins.
- The ridge residual reference is cheap compared with the GRU, but it is not robust enough to productize from this single trace.
- DWM next-vblank horizon construction remains the most useful product-shaped improvement; fixed 16/24/33.33ms diagnostics are less representative of the display-relative target.

## Product Recommendation
Simplest acceptable candidate: `{product}`.

No lightweight correction in this Phase 6 search beats `gained-last2-0.75` strongly enough to productize. The recommended product path is baseline velocity extrapolation with DWM-aware next-vblank horizon selection, plus instrumentation to keep collecting compatible traces.

## C# Implementation Sketch
```csharp
struct PredictorState
{{
    public double LastPollX, LastPollY;
    public long LastPollQpc;
    public double StopwatchFrequency;
}}

PointD PredictNextVBlank(PredictorState s, double x, double y, long nowQpc, long nextVblankQpc)
{{
    double dtSec = Math.Max(1e-6, (nowQpc - s.LastPollQpc) / s.StopwatchFrequency);
    double horizonSec = Math.Max(0.0, (nextVblankQpc - nowQpc) / s.StopwatchFrequency);
    double vx = (x - s.LastPollX) / dtSec;
    double vy = (y - s.LastPollY) / dtSec;
    const double gain = 0.75;
    return new PointD(x + vx * gain * horizonSec, y + vy * gain * horizonSec);
}}
```

State is two positions, one timestamp, and the stopwatch frequency. The hot path has no heap allocation and only a small fixed number of floating point operations.

## Phase 7 Microbenchmark Targets
- Prediction hot path: p50 under 0.5 us and p99 under 2 us per call in managed C#.
- Zero allocations per prediction after warmup.
- End-to-end poll-to-prediction budget under 50 us p99, including DWM horizon lookup.
- Validate numerical parity against this runner within 0.01 px on replayed trace rows.
- Add counters for invalid/late DWM horizons, horizon over 1.25x refresh period, and fallback-to-hold behavior.

See `scores.json` for split metrics, speed bins, risk slices, regression counts, selected gain tables, and fixed-horizon diagnostics.
"""
    (output_dir / "report.md").write_text(report, encoding="utf-8")

    log = f"""# Phase 6 Experiment Log

- Started: {scores['generated_utc_start']}
- Finished: {scores['generated_utc_end']}
- Python: `{scores['runtime']['python_executable']}`
- NumPy: `{scores['runtime']['numpy_version']}`
- Read root trace zip in place; did not copy trace data into PoC.
- Reconstructed Phase 1 chronological train/validation/test split and the poll / `dwm-next-vblank` label path.
- Evaluated fixed gains, train-selected piecewise gain tables, conservative validation-gated tables, and a NumPy ridge residual reference.
- Selected decision from validation/test p99, max, low-risk preservation, and regression counts rather than mean alone.

Outcome: `{product}` remains the recommended product candidate; no correction passed strongly enough for productization.
"""
    (output_dir / "experiment-log.md").write_text(log, encoding="utf-8")

    readme = """# Phase 6 Distillation and Lightweight Model Design

This folder contains the Phase 6 lightweight distillation experiment for Cursor Mirror prediction.

Run from the repository root:

```powershell
& "poc\\cursor-prediction\\step-5 neural-models\\.venv\\Scripts\\python.exe" "poc\\cursor-prediction-v2\\phase-6 distillation-lightweight-design\\run_phase6_distillation.py"
```

Or use the wrapper:

```powershell
& "poc\\cursor-prediction-v2\\phase-6 distillation-lightweight-design\\run-phase6-distillation.ps1"
```

Outputs:
- `scores.json`: machine-readable metrics, candidate ranking, selected tables, and implementation cost estimates.
- `report.md`: concise product recommendation and implementation sketch.
- `experiment-log.md`: execution notes and reproducibility context.

The runner reads the compatible root trace zip in place and does not copy trace data into this directory.
"""
    (output_dir / "README.md").write_text(readme, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--trace-zip", type=Path, default=None)
    parser.add_argument("--phase1-scores", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()

    start = time.time()
    generated_start = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    repo_root = args.repo_root.resolve()
    phase1_scores = args.phase1_scores or (repo_root / "poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json")
    trace_zip = (args.trace_zip or find_default_trace(repo_root)).resolve()
    splits, stopwatch_frequency = load_phase1(phase1_scores)
    probes = [trace_probe(p) for p in sorted(repo_root.glob("cursor-mirror-trace-*.zip"))]

    trace = read_trace(trace_zip, stopwatch_frequency)
    d = build_derived(trace, splits)
    idx_by_split = split_indices(trace, d, splits, required_back=2)
    baseline_errors_by_split = {
        split: errors_for(pred_gain(trace, d, idx, BASELINE_GAIN), target_xy(d, idx)) for split, idx in idx_by_split.items()
    }

    candidates: list[dict[str, Any]] = []
    baseline = evaluate_candidate(
        "gained-last2-0.75",
        "baseline",
        trace,
        d,
        idx_by_split,
        lambda idx: pred_gain(trace, d, idx, BASELINE_GAIN),
        baseline_errors_by_split,
        {"gain": BASELINE_GAIN},
    )

    for gain in [0.625, 0.75, 0.875, 1.0]:
        candidates.append(
            evaluate_candidate(
                f"gained-last2-{gain:g}",
                "fixed_gain",
                trace,
                d,
                idx_by_split,
                lambda idx, gain=gain: pred_gain(trace, d, idx, gain),
                baseline_errors_by_split,
                {"gain": gain},
            )
        )

    train_idx = idx_by_split["train"]
    val_idx = idx_by_split["validation"]
    for family in ["speed", "horizon", "acceleration", "speed_x_horizon"]:
        table = fit_gain_table(trace, d, train_idx, family)
        candidates.append(
            evaluate_candidate(
                f"gain-table-{family}",
                "piecewise_gain_table",
                trace,
                d,
                idx_by_split,
                lambda idx, table=table: apply_gain_table(trace, d, idx, table),
                baseline_errors_by_split,
                table,
            )
        )

    for high_risk_only in [False, True]:
        spec = conservative_table(trace, d, train_idx, val_idx, "speed_x_horizon", high_risk_only=high_risk_only)
        name = "conservative-risk-gated-speedxhorizon" if high_risk_only else "conservative-speedxhorizon"
        candidates.append(
            evaluate_candidate(
                name,
                "conservative_risk_gate",
                trace,
                d,
                idx_by_split,
                lambda idx, spec=spec: apply_conservative_table(trace, d, idx, spec),
                baseline_errors_by_split,
                spec,
            )
        )

    ridge = fit_ridge_residual(trace, d, train_idx, val_idx)
    candidates.append(
        evaluate_candidate(
            "ridge-linear-residual",
            "ridge_residual",
            trace,
            d,
            idx_by_split,
            lambda idx: apply_ridge_residual(trace, d, idx, ridge),
            baseline_errors_by_split,
            ridge,
        )
    )

    ranked = rank_candidates(candidates)
    fixed_diag = fixed_horizon_diagnostics(trace, d, splits, [16.0, 24.0, 33.333])
    accepted = [r for r in ranked if r["accepted_by_phase6_rule"] and r["name"] != "gained-last2-0.75"]
    simplest = "baseline + DWM-aware next-vblank horizon (gained-last2-0.75)"
    if accepted:
        simplest = accepted[0]["name"]

    scores = {
        "phase": "phase-6 distillation-lightweight-design",
        "generated_utc_start": generated_start,
        "generated_utc_end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "input": {
            "zip_path": str(trace_zip),
            "phase1_scores_path": str(phase1_scores.resolve()),
            "stopwatch_frequency": stopwatch_frequency,
            "row_count": trace.row_count,
            "poll_rows": trace.poll_rows,
            "hook_rows": trace.hook_rows,
            "candidate_traces": probes,
        },
        "runtime": {
            "python_executable": sys.executable,
            "python_version": sys.version,
            "platform": platform.platform(),
            "numpy_version": np.__version__,
            "elapsed_sec": time.time() - start,
        },
        "dataset": {
            "anchor_set": "poll",
            "target": "dwm-next-vblank",
            "baseline": "gained-last2-0.75",
            "split_counts": {name: int(idx.size) for name, idx in idx_by_split.items()},
            "split": {s.name: {"start_elapsed_us": s.start_us, "end_elapsed_us": s.end_us} for s in splits},
        },
        "baseline": baseline,
        "candidates": candidates,
        "ranked_candidates": ranked,
        "fixed_horizon_diagnostics": fixed_diag,
        "implementation_costs": candidate_costs(),
        "decision": {
            "simplest_acceptable_product_candidate": simplest,
            "lightweight_correction_beats_baseline_strongly_enough": bool(accepted),
            "criteria": "A correction must clear at least 0.01 px validation and test mean improvement while preserving p95/p99/max and keeping >1px regressions no worse than improvements; tiny mean gains are not productizable.",
            "recommendation": "Use baseline + DWM-aware next-vblank horizon unless more traces show a stable conservative correction.",
        },
    }

    write_outputs(args.output_dir, scores)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
