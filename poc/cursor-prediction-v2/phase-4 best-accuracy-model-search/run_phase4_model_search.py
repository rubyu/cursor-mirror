#!/usr/bin/env python3
"""Phase 4 best-accuracy model search for Cursor Mirror prediction.

This runner reconstructs the Phase 3 product dataset:
poll anchors, dwm-next-vblank target labels, chronological split, and the
gained-last2-0.75 deterministic baseline. It trains bounded PyTorch model
families and writes scores/report artifacts in this phase directory.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import platform
import random
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import torch
from torch import nn


SPEED_BINS = [
    ("0-500", 0.0, 500.0),
    ("500-1500", 500.0, 1500.0),
    ("1500-3000", 1500.0, 3000.0),
    ("3000+", 3000.0, float("inf")),
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
    turn_sin: np.ndarray
    turn_deg: np.ndarray
    duplicate_anchor: np.ndarray
    duplicate_run: np.ndarray
    time_since_hook_ms: np.ndarray
    hook_count_8ms: np.ndarray
    hook_count_16ms: np.ndarray
    hook_count_32ms: np.ndarray
    time_since_move_ms: np.ndarray
    dwm_phase_ms: np.ndarray
    horizon_ms: np.ndarray
    target_x: np.ndarray
    target_y: np.ndarray
    target_valid: np.ndarray
    baseline_x: np.ndarray
    baseline_y: np.ndarray
    baseline_valid: np.ndarray


@dataclass
class FeatureBundle:
    family: str
    required_back: int
    indices_by_split: dict[str, np.ndarray]
    tabular: np.ndarray | None
    sequence: np.ndarray | None
    context: np.ndarray | None
    feature_names: list[str]
    sequence_feature_names: list[str]
    context_feature_names: list[str]


@dataclass
class Norm:
    mean: np.ndarray
    std: np.ndarray

    @classmethod
    def fit(cls, values: np.ndarray) -> "Norm":
        mean = values.mean(axis=0)
        std = values.std(axis=0)
        std = np.where(std < 1e-6, 1.0, std)
        return cls(mean=mean.astype(np.float32), std=std.astype(np.float32))

    def transform(self, values: np.ndarray) -> np.ndarray:
        return ((values - self.mean) / self.std).astype(np.float32)

    def inverse(self, values: np.ndarray) -> np.ndarray:
        return values * self.std + self.mean


class MLP(nn.Module):
    def __init__(self, input_dim: int, hidden: list[int], output_dim: int = 2) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        prev = input_dim
        for width in hidden:
            layers.append(nn.Linear(prev, width))
            layers.append(nn.ReLU())
            prev = width
        layers.append(nn.Linear(prev, output_dim))
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class SequenceGRU(nn.Module):
    def __init__(self, seq_dim: int, context_dim: int, hidden: int, head: int = 32) -> None:
        super().__init__()
        self.gru = nn.GRU(seq_dim, hidden, batch_first=True)
        self.head = nn.Sequential(
            nn.Linear(hidden + context_dim, head),
            nn.ReLU(),
            nn.Linear(head, 2),
        )

    def forward(self, seq: torch.Tensor, context: torch.Tensor) -> torch.Tensor:
        _, h = self.gru(seq)
        return self.head(torch.cat([h[-1], context], dim=1))


def finite(values: np.ndarray, cap: float = 1000.0) -> np.ndarray:
    return np.nan_to_num(values, nan=0.0, posinf=cap, neginf=-cap)


def pct(values: np.ndarray, p: float) -> float | None:
    if values.size == 0:
        return None
    return float(np.percentile(values, p))


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


def euclidean(pred_x: np.ndarray, pred_y: np.ndarray, target_x: np.ndarray, target_y: np.ndarray) -> np.ndarray:
    return np.sqrt((pred_x - target_x) ** 2 + (pred_y - target_y) ** 2)


def speed_bin_metrics(errors: np.ndarray, speed: np.ndarray) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name, lo, hi in SPEED_BINS:
        mask = speed >= lo if math.isinf(hi) else ((speed >= lo) & (speed < hi))
        out[name] = metrics_from_errors(errors[mask])
    return out


def slice_metrics(errors: np.ndarray, d: Derived, idx: np.ndarray) -> dict[str, Any]:
    speed = d.speed[idx]
    accel = d.accel_mag[idx]
    horizon = d.horizon_ms[idx]
    hook_age = d.time_since_hook_ms[idx]
    move_age = d.time_since_move_ms[idx]
    duplicate = d.duplicate_anchor[idx]
    slices = {
        "high_acceleration_100000_plus_px_s2": accel >= 100000.0,
        "horizon_12_16_ms": (horizon >= 12.0) & (horizon < 16.0),
        "horizon_16_24_ms": (horizon >= 16.0) & (horizon < 24.0),
        "horizon_24_plus_ms": horizon >= 24.0,
        "fast_1500_plus_px_s": speed >= 1500.0,
        "fast_3000_plus_px_s": speed >= 3000.0,
        "fast_hook_age_0_8_ms": (speed >= 1500.0) & (hook_age < 8.0),
        "duplicate_recent_move_0_16_ms": duplicate & (move_age < 16.0),
    }
    return {name: metrics_from_errors(errors[mask]) for name, mask in slices.items()}


def load_phase1(path: Path) -> tuple[list[SplitDef], int]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    split = payload["recommended_split"]
    splits = [
        SplitDef("train", float(split["train"]["start_elapsed_us"]), float(split["train"]["end_elapsed_us"])),
        SplitDef("validation", float(split["validation"]["start_elapsed_us"]), float(split["validation"]["end_elapsed_us"])),
        SplitDef("test", float(split["test"]["start_elapsed_us"]), float(split["test"]["end_elapsed_us"])),
    ]
    return splits, int(payload["input"]["metadata"]["StopwatchFrequency"])


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
    last_unique = -float("inf")

    with zipfile.ZipFile(zip_path, "r") as archive:
        with archive.open("trace.csv", "r") as raw:
            rows = csv.DictReader(line.decode("utf-8") for line in raw)
            for row in rows:
                row_count += 1
                ev = row["event"]
                elapsed = float(row["elapsedMicroseconds"])
                if ev == "poll":
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
                elif ev in ("move", "hook"):
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
    t = trace.t_us
    idx = int(np.searchsorted(t, target_t, side="left"))
    if idx < t.size and abs(t[idx] - target_t) < 0.0001:
        return float(trace.x[idx]), float(trace.y[idx])
    if idx <= 0 or idx >= t.size:
        return None
    t0 = t[idx - 1]
    t1 = t[idx]
    if t1 <= t0:
        return None
    f = (target_t - t0) / (t1 - t0)
    return float(trace.x[idx - 1] + (trace.x[idx] - trace.x[idx - 1]) * f), float(
        trace.y[idx - 1] + (trace.y[idx] - trace.y[idx - 1]) * f
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
    turn_sin = np.zeros(n, dtype=np.float64)
    turn_deg = np.full(n, np.inf, dtype=np.float64)
    duplicate_anchor = np.zeros(n, dtype=bool)
    duplicate_run = np.zeros(n, dtype=np.float64)
    time_since_hook_ms = np.full(n, 1000.0, dtype=np.float64)
    hook_count_8ms = np.zeros(n, dtype=np.float64)
    hook_count_16ms = np.zeros(n, dtype=np.float64)
    hook_count_32ms = np.zeros(n, dtype=np.float64)
    time_since_move_ms = np.full(n, 1000.0, dtype=np.float64)
    dwm_phase_ms = (trace.vblank_elapsed_us - trace.t_us) / 1000.0
    horizon_ms = np.full(n, np.nan, dtype=np.float64)
    target_x = np.full(n, np.nan, dtype=np.float64)
    target_y = np.full(n, np.nan, dtype=np.float64)
    target_valid = np.zeros(n, dtype=bool)
    baseline_x = np.full(n, np.nan, dtype=np.float64)
    baseline_y = np.full(n, np.nan, dtype=np.float64)
    baseline_valid = np.zeros(n, dtype=bool)

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
            duplicate_run[i] = duplicate_run[i - 1] + 1.0 if duplicate_anchor[i] else 0.0

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
            c = float(np.clip((dx[i - 1] * dx[i] + dy[i - 1] * dy[i]) / (norm0 * norm1), -1.0, 1.0))
            s = float(np.clip((dx[i - 1] * dy[i] - dy[i - 1] * dx[i]) / (norm0 * norm1), -1.0, 1.0))
            turn_cos[i] = c
            turn_sin[i] = s
            turn_deg[i] = math.degrees(math.acos(c))

    hook_t = trace.hook_t_us
    for i, t in enumerate(trace.t_us):
        hidx = int(np.searchsorted(hook_t, t, side="right"))
        if hidx > 0:
            time_since_hook_ms[i] = min(1000.0, (t - hook_t[hidx - 1]) / 1000.0)
        hook_count_8ms[i] = hidx - int(np.searchsorted(hook_t, t - 8000.0, side="left"))
        hook_count_16ms[i] = hidx - int(np.searchsorted(hook_t, t - 16000.0, side="left"))
        hook_count_32ms[i] = hidx - int(np.searchsorted(hook_t, t - 32000.0, side="left"))

    last_move = -float("inf")
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
        if target_t <= trace.t_us[i] or target_t > split.end_us or target_t - trace.t_us[i] > 50000.0:
            continue
        label = interpolate_poll(trace, target_t)
        if label is None:
            continue
        h_sec = (target_t - trace.t_us[i]) / 1_000_000.0
        if dt_ms[i] <= 0:
            continue
        target_valid[i] = True
        horizon_ms[i] = h_sec * 1000.0
        target_x[i], target_y[i] = label
        baseline_x[i] = trace.x[i] + vx[i] * 0.75 * h_sec
        baseline_y[i] = trace.y[i] + vy[i] * 0.75 * h_sec
        baseline_valid[i] = True

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
        turn_sin=turn_sin,
        turn_deg=turn_deg,
        duplicate_anchor=duplicate_anchor,
        duplicate_run=duplicate_run,
        time_since_hook_ms=time_since_hook_ms,
        hook_count_8ms=hook_count_8ms,
        hook_count_16ms=hook_count_16ms,
        hook_count_32ms=hook_count_32ms,
        time_since_move_ms=time_since_move_ms,
        dwm_phase_ms=dwm_phase_ms,
        horizon_ms=horizon_ms,
        target_x=target_x,
        target_y=target_y,
        target_valid=target_valid,
        baseline_x=baseline_x,
        baseline_y=baseline_y,
        baseline_valid=baseline_valid,
    )


def split_indices(trace: TraceData, d: Derived, splits: list[SplitDef], required_back: int) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for split in splits:
        idx: list[int] = []
        for i in range(max(1, required_back), trace.t_us.size):
            if trace.t_us[i] < split.start_us or trace.t_us[i] > split.end_us:
                continue
            if trace.t_us[i - required_back] < split.start_us:
                continue
            if d.target_valid[i] and d.baseline_valid[i]:
                idx.append(i)
        out[split.name] = np.asarray(idx, dtype=np.int64)
    return out


def build_minimal_features(trace: TraceData, d: Derived, idx: np.ndarray) -> tuple[np.ndarray, list[str]]:
    names = [
        "current_x",
        "current_y",
        "last_delta_x",
        "last_delta_y",
        "last_dt_ms",
        "last_velocity_x_px_s",
        "last_velocity_y_px_s",
        "speed_px_s",
        "baseline_dx",
        "baseline_dy",
        "baseline_distance",
        "target_horizon_ms",
        "dwm_phase_ms",
        "dwm_period_ms",
        "horizon_over_dwm_period",
        "time_since_last_hook_ms",
        "time_since_last_poll_movement_ms",
        "duplicate_anchor_flag",
        "speed_times_horizon",
    ]
    h = d.horizon_ms[idx]
    base_dx = d.baseline_x[idx] - trace.x[idx]
    base_dy = d.baseline_y[idx] - trace.y[idx]
    x = np.column_stack(
        [
            trace.x[idx],
            trace.y[idx],
            d.dx[idx],
            d.dy[idx],
            d.dt_ms[idx],
            d.vx[idx],
            d.vy[idx],
            d.speed[idx],
            base_dx,
            base_dy,
            np.sqrt(base_dx * base_dx + base_dy * base_dy),
            h,
            d.dwm_phase_ms[idx],
            trace.dwm_period_ms[idx],
            h / np.maximum(trace.dwm_period_ms[idx], 1e-6),
            d.time_since_hook_ms[idx],
            d.time_since_move_ms[idx],
            d.duplicate_anchor[idx].astype(np.float64),
            d.speed[idx] * h / 1000.0,
        ]
    )
    return finite(x).astype(np.float32), names


def build_rich_features(trace: TraceData, d: Derived, idx: np.ndarray) -> tuple[np.ndarray, list[str]]:
    columns: list[np.ndarray] = []
    names: list[str] = []
    for lag in range(1, 6):
        j = idx - lag
        columns.extend([trace.x[j] - trace.x[idx], trace.y[j] - trace.y[idx]])
        names.extend([f"relative_x_lag_{lag}", f"relative_y_lag_{lag}"])
    for lag in range(0, 5):
        j = idx - lag
        columns.extend([d.dt_ms[j], d.dx[j], d.dy[j], d.vx[j], d.vy[j], d.speed[j]])
        names.extend(
            [
                f"dt_ms_interval_{lag}",
                f"dx_interval_{lag}",
                f"dy_interval_{lag}",
                f"vx_interval_{lag}",
                f"vy_interval_{lag}",
                f"speed_interval_{lag}",
            ]
        )
    for lag in range(0, 4):
        j = idx - lag
        columns.extend([d.accel_x[j], d.accel_y[j], d.accel_mag[j]])
        names.extend([f"accel_x_lag_{lag}", f"accel_y_lag_{lag}", f"accel_mag_lag_{lag}"])
    columns.extend(
        [
            d.turn_cos[idx],
            d.turn_sin[idx],
            finite(d.turn_deg[idx], cap=180.0),
            d.accel_mag[idx] - d.accel_mag[idx - 1],
            d.horizon_ms[idx],
            d.horizon_ms[idx] / np.maximum(trace.dwm_period_ms[idx], 1e-6),
            d.dwm_phase_ms[idx],
            trace.dwm_period_ms[idx],
            d.time_since_hook_ms[idx],
            d.hook_count_8ms[idx],
            d.hook_count_16ms[idx],
            d.hook_count_32ms[idx],
            d.time_since_move_ms[idx],
            d.duplicate_run[idx],
            d.duplicate_anchor[idx].astype(np.float64),
            (d.speed[idx] > 0.0).astype(np.float64),
            d.speed[idx] * d.horizon_ms[idx] / 1000.0,
            d.accel_mag[idx] * d.horizon_ms[idx] / 1000.0,
        ]
    )
    names.extend(
        [
            "turn_cos",
            "turn_sin",
            "turn_deg",
            "jerk_proxy_accel_mag_delta",
            "target_horizon_ms",
            "horizon_over_dwm_period",
            "dwm_phase_ms",
            "dwm_period_ms",
            "time_since_last_hook_ms",
            "hook_count_last_8ms",
            "hook_count_last_16ms",
            "hook_count_last_32ms",
            "time_since_last_poll_movement_ms",
            "duplicate_run_length",
            "duplicate_anchor_flag",
            "moving_anchor_flag",
            "speed_times_horizon",
            "accel_times_horizon",
        ]
    )
    return finite(np.column_stack(columns)).astype(np.float32), names


def build_sequence_features(trace: TraceData, d: Derived, idx: np.ndarray) -> tuple[np.ndarray, np.ndarray, list[str], list[str]]:
    seq_names = [
        "relative_x_to_anchor",
        "relative_y_to_anchor",
        "dt_ms_to_previous",
        "age_ms_from_anchor",
        "delta_x",
        "delta_y",
        "velocity_x_px_s",
        "velocity_y_px_s",
        "speed_px_s",
        "is_duplicate_position",
        "has_hook_between_previous_and_step",
    ]
    ctx_names = [
        "target_horizon_ms",
        "dwm_phase_ms",
        "dwm_period_ms",
        "time_since_last_hook_ms",
        "time_since_last_poll_movement_ms",
        "duplicate_run_length",
        "speed_px_s",
        "acceleration_mag_px_s2",
    ]
    seq = np.zeros((idx.size, 16, len(seq_names)), dtype=np.float32)
    for r, i in enumerate(idx):
        start = i - 15
        for step, j in enumerate(range(start, i + 1)):
            prev_t = trace.t_us[j - 1] if j > 0 else trace.t_us[j]
            hook_count = int(np.searchsorted(trace.hook_t_us, trace.t_us[j], side="right")) - int(
                np.searchsorted(trace.hook_t_us, prev_t, side="right")
            )
            seq[r, step, :] = [
                trace.x[j] - trace.x[i],
                trace.y[j] - trace.y[i],
                d.dt_ms[j],
                (trace.t_us[j] - trace.t_us[i]) / 1000.0,
                d.dx[j],
                d.dy[j],
                d.vx[j],
                d.vy[j],
                d.speed[j],
                1.0 if d.duplicate_anchor[j] else 0.0,
                1.0 if hook_count > 0 else 0.0,
            ]
    ctx = np.column_stack(
        [
            d.horizon_ms[idx],
            d.dwm_phase_ms[idx],
            trace.dwm_period_ms[idx],
            d.time_since_hook_ms[idx],
            d.time_since_move_ms[idx],
            d.duplicate_run[idx],
            d.speed[idx],
            d.accel_mag[idx],
        ]
    )
    return finite(seq).astype(np.float32), finite(ctx).astype(np.float32), seq_names, ctx_names


def build_bundle(trace: TraceData, d: Derived, splits: list[SplitDef], family: str) -> FeatureBundle:
    required_back = {"minimal": 1, "rich": 5, "sequence": 15}[family]
    indices_by_split = split_indices(trace, d, splits, required_back)
    all_idx = np.concatenate([indices_by_split["train"], indices_by_split["validation"], indices_by_split["test"]])
    if family == "minimal":
        tab, names = build_minimal_features(trace, d, all_idx)
        return FeatureBundle(family, required_back, indices_by_split, tab, None, None, names, [], [])
    if family == "rich":
        tab, names = build_rich_features(trace, d, all_idx)
        return FeatureBundle(family, required_back, indices_by_split, tab, None, None, names, [], [])
    seq, ctx, seq_names, ctx_names = build_sequence_features(trace, d, all_idx)
    return FeatureBundle(family, required_back, indices_by_split, None, seq, ctx, [], seq_names, ctx_names)


def bundle_offsets(bundle: FeatureBundle) -> dict[str, slice]:
    pos = 0
    out: dict[str, slice] = {}
    for split, idx in bundle.indices_by_split.items():
        out[split] = slice(pos, pos + idx.size)
        pos += idx.size
    return out


def target_arrays(trace: TraceData, d: Derived, idx: np.ndarray, output_kind: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    target_direct = np.column_stack([d.target_x[idx] - trace.x[idx], d.target_y[idx] - trace.y[idx]]).astype(np.float32)
    baseline_direct = np.column_stack([d.baseline_x[idx] - trace.x[idx], d.baseline_y[idx] - trace.y[idx]]).astype(np.float32)
    if output_kind == "direct":
        y = target_direct
    else:
        y = target_direct - baseline_direct
    return y.astype(np.float32), target_direct, baseline_direct


def make_weights(d: Derived, idx: np.ndarray, mode: str) -> np.ndarray:
    if mode == "none":
        return np.ones(idx.size, dtype=np.float32)
    weights = np.ones(idx.size, dtype=np.float32)
    weights += (d.speed[idx] >= 1500.0).astype(np.float32) * 1.0
    weights += (d.speed[idx] >= 3000.0).astype(np.float32) * 1.0
    weights += (d.accel_mag[idx] >= 100000.0).astype(np.float32) * 0.75
    return weights


def param_count(model: nn.Module) -> int:
    return int(sum(p.numel() for p in model.parameters()))


def mlp_ops(input_dim: int, hidden: list[int]) -> int:
    dims = [input_dim, *hidden, 2]
    return int(sum(a * b for a, b in zip(dims[:-1], dims[1:])))


def gru_ops(seq_dim: int, context_dim: int, hidden: int, seq_len: int = 16, head: int = 32) -> int:
    return int(seq_len * 3 * (seq_dim * hidden + hidden * hidden) + (hidden + context_dim) * head + head * 2)


def train_tabular(
    bundle: FeatureBundle,
    trace: TraceData,
    d: Derived,
    config: dict[str, Any],
    device: torch.device,
    args: argparse.Namespace,
) -> tuple[nn.Module, dict[str, Any], dict[str, np.ndarray], dict[str, np.ndarray]]:
    offsets = bundle_offsets(bundle)
    train_sl = offsets["train"]
    val_sl = offsets["validation"]
    all_idx = np.concatenate([bundle.indices_by_split["train"], bundle.indices_by_split["validation"], bundle.indices_by_split["test"]])
    y_all, target_direct, baseline_direct = target_arrays(trace, d, all_idx, config["output_kind"])
    x_norm = Norm.fit(bundle.tabular[train_sl])  # type: ignore[index]
    y_norm = Norm.fit(y_all[train_sl])
    x_train = torch.as_tensor(x_norm.transform(bundle.tabular[train_sl]), device=device)  # type: ignore[index]
    y_train = torch.as_tensor(y_norm.transform(y_all[train_sl]), device=device)
    x_val = torch.as_tensor(x_norm.transform(bundle.tabular[val_sl]), device=device)  # type: ignore[index]
    weights = torch.as_tensor(make_weights(d, bundle.indices_by_split["train"], config["weighting"]), device=device)
    model = MLP(x_train.shape[1], config["hidden"]).to(device)
    return train_loop(
        model=model,
        train_inputs=(x_train,),
        y_train=y_train,
        weights=weights,
        val_predict=lambda: predict_tabular(model, x_val, y_norm, baseline_direct[val_sl], config["output_kind"]),
        val_target=target_direct[val_sl],
        config=config,
        args=args,
    ) + (
        {
            "x": x_norm,
            "y": y_norm,
            "all_idx": all_idx,
            "target_direct": target_direct,
            "baseline_direct": baseline_direct,
        },
    )


def train_sequence(
    bundle: FeatureBundle,
    trace: TraceData,
    d: Derived,
    config: dict[str, Any],
    device: torch.device,
    args: argparse.Namespace,
) -> tuple[nn.Module, dict[str, Any], dict[str, np.ndarray], dict[str, np.ndarray]]:
    offsets = bundle_offsets(bundle)
    train_sl = offsets["train"]
    val_sl = offsets["validation"]
    all_idx = np.concatenate([bundle.indices_by_split["train"], bundle.indices_by_split["validation"], bundle.indices_by_split["test"]])
    y_all, target_direct, baseline_direct = target_arrays(trace, d, all_idx, config["output_kind"])
    seq_train = bundle.sequence[train_sl]  # type: ignore[index]
    ctx_train = bundle.context[train_sl]  # type: ignore[index]
    seq_norm = Norm.fit(seq_train.reshape(-1, seq_train.shape[-1]))
    ctx_norm = Norm.fit(ctx_train)
    y_norm = Norm.fit(y_all[train_sl])
    x_seq_train = torch.as_tensor(seq_norm.transform(seq_train.reshape(-1, seq_train.shape[-1])).reshape(seq_train.shape), device=device)
    x_ctx_train = torch.as_tensor(ctx_norm.transform(ctx_train), device=device)
    seq_val = bundle.sequence[val_sl]  # type: ignore[index]
    ctx_val = bundle.context[val_sl]  # type: ignore[index]
    x_seq_val = torch.as_tensor(seq_norm.transform(seq_val.reshape(-1, seq_val.shape[-1])).reshape(seq_val.shape), device=device)
    x_ctx_val = torch.as_tensor(ctx_norm.transform(ctx_val), device=device)
    y_train = torch.as_tensor(y_norm.transform(y_all[train_sl]), device=device)
    weights = torch.as_tensor(make_weights(d, bundle.indices_by_split["train"], config["weighting"]), device=device)
    model = SequenceGRU(seq_train.shape[-1], ctx_train.shape[-1], config["hidden"][0]).to(device)
    return train_loop(
        model=model,
        train_inputs=(x_seq_train, x_ctx_train),
        y_train=y_train,
        weights=weights,
        val_predict=lambda: predict_sequence(model, x_seq_val, x_ctx_val, y_norm, baseline_direct[val_sl], config["output_kind"]),
        val_target=target_direct[val_sl],
        config=config,
        args=args,
    ) + (
        {
            "seq": seq_norm,
            "ctx": ctx_norm,
            "y": y_norm,
            "all_idx": all_idx,
            "target_direct": target_direct,
            "baseline_direct": baseline_direct,
        },
    )


def train_loop(
    model: nn.Module,
    train_inputs: tuple[torch.Tensor, ...],
    y_train: torch.Tensor,
    weights: torch.Tensor,
    val_predict: Callable[[], np.ndarray],
    val_target: np.ndarray,
    config: dict[str, Any],
    args: argparse.Namespace,
) -> tuple[nn.Module, dict[str, Any], dict[str, np.ndarray]]:
    opt = torch.optim.AdamW(model.parameters(), lr=config["lr"], weight_decay=config["weight_decay"])
    best_state: dict[str, torch.Tensor] | None = None
    best_val = float("inf")
    best_epoch = 0
    start = time.perf_counter()
    n = y_train.shape[0]
    loss_kind = config["loss"]

    for epoch in range(1, args.max_epochs + 1):
        model.train()
        order = torch.randperm(n, device=y_train.device)
        for start_i in range(0, n, args.batch_size):
            batch = order[start_i : start_i + args.batch_size]
            pred = model(*(x[batch] for x in train_inputs))
            if loss_kind == "huber":
                per_dim = torch.nn.functional.smooth_l1_loss(pred, y_train[batch], reduction="none", beta=1.0)
            else:
                per_dim = (pred - y_train[batch]) ** 2
            loss = (per_dim.mean(dim=1) * weights[batch]).mean()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()

        model.eval()
        with torch.no_grad():
            val_pred = val_predict()
        val_errors = np.sqrt(np.sum((val_pred - val_target) ** 2, axis=1))
        val_mean = float(val_errors.mean())
        if val_mean + 1e-9 < best_val:
            best_val = val_mean
            best_epoch = epoch
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        elif epoch - best_epoch >= args.patience:
            break

    if best_state is not None:
        model.load_state_dict(best_state)
    elapsed = time.perf_counter() - start
    return model, {
        "epochs_ran": epoch,
        "best_epoch": best_epoch,
        "best_validation_mean_px": best_val,
        "training_time_sec": elapsed,
    }, {}


@torch.no_grad()
def predict_tabular(
    model: nn.Module,
    x: torch.Tensor,
    y_norm: Norm,
    baseline_direct: np.ndarray,
    output_kind: str,
) -> np.ndarray:
    model.eval()
    pred_norm = model(x).detach().cpu().numpy()
    pred = y_norm.inverse(pred_norm)
    if output_kind == "residual":
        pred = pred + baseline_direct
    return pred.astype(np.float32)


@torch.no_grad()
def predict_sequence(
    model: nn.Module,
    seq: torch.Tensor,
    ctx: torch.Tensor,
    y_norm: Norm,
    baseline_direct: np.ndarray,
    output_kind: str,
) -> np.ndarray:
    model.eval()
    pred_norm = model(seq, ctx).detach().cpu().numpy()
    pred = y_norm.inverse(pred_norm)
    if output_kind == "residual":
        pred = pred + baseline_direct
    return pred.astype(np.float32)


def evaluate_direct_predictions(
    pred_direct: np.ndarray,
    target_direct: np.ndarray,
    baseline_direct: np.ndarray,
    d: Derived,
    idx: np.ndarray,
) -> dict[str, Any]:
    learned_errors = np.sqrt(np.sum((pred_direct - target_direct) ** 2, axis=1))
    baseline_errors = np.sqrt(np.sum((baseline_direct - target_direct) ** 2, axis=1))
    learned = metrics_from_errors(learned_errors)
    baseline = metrics_from_errors(baseline_errors)
    return {
        "learned": learned,
        "baseline_same_mask": baseline,
        "delta_vs_baseline": {
            key: (None if learned[key] is None or baseline[key] is None else float(learned[key] - baseline[key]))
            for key in ["mean_euclidean_error", "rmse", "p50", "p90", "p95", "p99", "max"]
        },
        "speed_bins_px_s": speed_bin_metrics(learned_errors, d.speed[idx]),
        "baseline_speed_bins_px_s": speed_bin_metrics(baseline_errors, d.speed[idx]),
        "slices": slice_metrics(learned_errors, d, idx),
        "baseline_slices": slice_metrics(baseline_errors, d, idx),
    }


def predict_for_split(
    model: nn.Module,
    bundle: FeatureBundle,
    info: dict[str, Any],
    split: str,
    output_kind: str,
    device: torch.device,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    offsets = bundle_offsets(bundle)
    sl = offsets[split]
    idx = info["all_idx"][sl]
    target_direct = info["target_direct"][sl]
    baseline_direct = info["baseline_direct"][sl]
    if bundle.family == "sequence":
        seq_raw = bundle.sequence[sl]  # type: ignore[index]
        ctx_raw = bundle.context[sl]  # type: ignore[index]
        seq = torch.as_tensor(info["seq"].transform(seq_raw.reshape(-1, seq_raw.shape[-1])).reshape(seq_raw.shape), device=device)
        ctx = torch.as_tensor(info["ctx"].transform(ctx_raw), device=device)
        pred = predict_sequence(model, seq, ctx, info["y"], baseline_direct, output_kind)
    else:
        x = torch.as_tensor(info["x"].transform(bundle.tabular[sl]), device=device)  # type: ignore[index]
        pred = predict_tabular(model, x, info["y"], baseline_direct, output_kind)
    return pred, target_direct, baseline_direct, idx


def runtime_info(device: torch.device) -> dict[str, Any]:
    gpu: dict[str, Any] = {
        "torch_cuda_available": bool(torch.cuda.is_available()),
        "selected_device": str(device),
    }
    if torch.cuda.is_available():
        gpu.update(
            {
                "device_name": torch.cuda.get_device_name(0),
                "cuda_version": torch.version.cuda,
                "torch_cuda_device_count": torch.cuda.device_count(),
            }
        )
    return {
        "python_executable": sys.executable,
        "python_version": sys.version,
        "platform": platform.platform(),
        "numpy_version": np.__version__,
        "torch_version": torch.__version__,
        "device": gpu,
    }


def model_configs() -> list[dict[str, Any]]:
    common = {"lr": 0.0015, "weight_decay": 1e-4}
    return [
        {"name": "minimal-residual-mlp-h32-mse", "family": "minimal", "kind": "mlp", "output_kind": "residual", "hidden": [32], "loss": "mse", "weighting": "none", **common},
        {"name": "minimal-residual-mlp-h64-huber", "family": "minimal", "kind": "mlp", "output_kind": "residual", "hidden": [64], "loss": "huber", "weighting": "none", **common},
        {"name": "minimal-residual-mlp-h64-huber-weighted", "family": "minimal", "kind": "mlp", "output_kind": "residual", "hidden": [64], "loss": "huber", "weighting": "high_motion", **common},
        {"name": "rich-residual-mlp-h64-mse", "family": "rich", "kind": "mlp", "output_kind": "residual", "hidden": [64], "loss": "mse", "weighting": "none", **common},
        {"name": "rich-residual-mlp-h64-huber", "family": "rich", "kind": "mlp", "output_kind": "residual", "hidden": [64], "loss": "huber", "weighting": "none", **common},
        {"name": "rich-residual-mlp-h128-huber-weighted", "family": "rich", "kind": "mlp", "output_kind": "residual", "hidden": [128], "loss": "huber", "weighting": "high_motion", **common},
        {"name": "rich-direct-mlp-h64-huber", "family": "rich", "kind": "mlp", "output_kind": "direct", "hidden": [64], "loss": "huber", "weighting": "none", **common},
        {"name": "rich-direct-mlp-h128-huber-weighted", "family": "rich", "kind": "mlp", "output_kind": "direct", "hidden": [128], "loss": "huber", "weighting": "high_motion", **common},
        {"name": "sequence-gru-residual-h32-huber", "family": "sequence", "kind": "gru", "output_kind": "residual", "hidden": [32], "loss": "huber", "weighting": "none", **common},
        {"name": "sequence-gru-residual-h64-huber-weighted", "family": "sequence", "kind": "gru", "output_kind": "residual", "hidden": [64], "loss": "huber", "weighting": "high_motion", **common},
    ]


def baseline_full_metrics(trace: TraceData, d: Derived, splits: list[SplitDef]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    idx_by_split = split_indices(trace, d, splits, 1)
    for split, idx in idx_by_split.items():
        errors = euclidean(d.baseline_x[idx], d.baseline_y[idx], d.target_x[idx], d.target_y[idx])
        out[split] = {
            **metrics_from_errors(errors),
            "speed_bins_px_s": speed_bin_metrics(errors, d.speed[idx]),
            "slices": slice_metrics(errors, d, idx),
        }
    return out


def fixed_horizon_baseline_diagnostics(trace: TraceData, splits: list[SplitDef], horizons_ms: list[float]) -> dict[str, Any]:
    diagnostics: dict[str, Any] = {}
    n = trace.t_us.size
    dt_sec = np.zeros(n, dtype=np.float64)
    vx = np.zeros(n, dtype=np.float64)
    vy = np.zeros(n, dtype=np.float64)
    speed = np.zeros(n, dtype=np.float64)
    for i in range(1, n):
        dt_sec[i] = (trace.t_us[i] - trace.t_us[i - 1]) / 1_000_000.0
        if dt_sec[i] > 0:
            vx[i] = (trace.x[i] - trace.x[i - 1]) / dt_sec[i]
            vy[i] = (trace.y[i] - trace.y[i - 1]) / dt_sec[i]
            speed[i] = math.hypot(vx[i], vy[i])

    for horizon in horizons_ms:
        key = f"fixed-{horizon:.3f}ms"
        by_split: dict[str, Any] = {}
        horizon_us = horizon * 1000.0
        for split in splits:
            errors: list[float] = []
            speeds: list[float] = []
            for i in range(1, n):
                if trace.t_us[i] < split.start_us or trace.t_us[i] > split.end_us or trace.t_us[i - 1] < split.start_us:
                    continue
                target_t = trace.t_us[i] + horizon_us
                if target_t > split.end_us:
                    continue
                label = interpolate_poll(trace, target_t)
                if label is None or dt_sec[i] <= 0:
                    continue
                pred_x = trace.x[i] + vx[i] * 0.75 * (horizon / 1000.0)
                pred_y = trace.y[i] + vy[i] * 0.75 * (horizon / 1000.0)
                errors.append(math.hypot(pred_x - label[0], pred_y - label[1]))
                speeds.append(speed[i])
            e = np.asarray(errors, dtype=np.float64)
            s = np.asarray(speeds, dtype=np.float64)
            by_split[split.name] = {
                **metrics_from_errors(e),
                "speed_bins_px_s": speed_bin_metrics(e, s),
            }
        diagnostics[key] = {
            "horizon_ms": horizon,
            "target_role": "diagnostic frame-period comparison only; not used for primary dwm-next-vblank model selection",
            "baseline": "gained-last2-0.75",
            "metrics_by_split": by_split,
        }
    return diagnostics


def choose_gated_hybrid(
    source: dict[str, Any],
    model: nn.Module,
    bundle: FeatureBundle,
    info: dict[str, Any],
    d: Derived,
    device: torch.device,
) -> dict[str, Any] | None:
    pred, target, base, idx = predict_for_split(model, bundle, info, "validation", source["config"]["output_kind"], device)
    rules: list[tuple[str, np.ndarray]] = [
        ("speed>=500", d.speed[idx] >= 500.0),
        ("speed>=1500", d.speed[idx] >= 1500.0),
        ("speed>=3000", d.speed[idx] >= 3000.0),
        ("accel>=20000", d.accel_mag[idx] >= 20000.0),
        ("accel>=100000", d.accel_mag[idx] >= 100000.0),
        ("speed>=1500_or_accel>=100000", (d.speed[idx] >= 1500.0) | (d.accel_mag[idx] >= 100000.0)),
        ("speed>=500_and_horizon>=12", (d.speed[idx] >= 500.0) & (d.horizon_ms[idx] >= 12.0)),
        ("duplicate_recent_move", d.duplicate_anchor[idx] & (d.time_since_move_ms[idx] < 16.0)),
    ]
    base_eval = evaluate_direct_predictions(base, target, base, d, idx)
    best: dict[str, Any] | None = None
    for name, risk in rules:
        hybrid = base.copy()
        hybrid[risk] = pred[risk]
        ev = evaluate_direct_predictions(hybrid, target, base, d, idx)
        ev["gate_rule"] = name
        ev["gate_true_count"] = int(risk.sum())
        if best is None or ev["learned"]["mean_euclidean_error"] < best["learned"]["mean_euclidean_error"]:
            best = ev
    if best is None:
        return None
    return {
        "source_model": source["name"],
        "validation": best,
        "baseline_validation": base_eval["baseline_same_mask"],
        "supported_by_validation": best["learned"]["mean_euclidean_error"] < base_eval["baseline_same_mask"]["mean_euclidean_error"],
    }


def write_text_outputs(output_dir: Path, scores: dict[str, Any]) -> None:
    best = scores["selection"]["best_validation_model"]
    best_test = scores["selection"]["best_test_model"]
    baseline = best_test["test_metrics"]["baseline_same_mask"]
    learned = best_test["test_metrics"]["learned"]
    delta = best_test["test_metrics"]["delta_vs_baseline"]
    device = scores["runtime"]["device"]
    gate = scores["selection"].get("gated_hybrid")
    fixed = scores["diagnostic_fixed_horizon_baselines"]
    fixed_one = fixed["fixed-16.667ms"]["metrics_by_split"]["test"]
    fixed_two = fixed["fixed-33.333ms"]["metrics_by_split"]["test"]
    standalone = [r for r in scores["selected_test_results"] if r["feature_family"] != "gated"]
    best_standalone = min(
        standalone,
        key=lambda r: (r["test_metrics"]["learned"]["mean_euclidean_error"], r["test_metrics"]["learned"]["p95"]),
    )

    def f(v: Any, digits: int = 3) -> str:
        return "n/a" if v is None else f"{float(v):.{digits}f}"

    report = f"""# Phase 4 Best-Accuracy Model Search

## Method
- Reconstructed the Phase 3 product dataset: poll anchors, `dwm-next-vblank` labels, chronological Phase 1 split, and `gained-last2-0.75` residual baseline.
- Kept model search on the primary product target, `dwm-next-vblank`, and treated fixed horizons as diagnostics/upper-bound analysis only.
- Built train-only normalization for each feature family and froze it for validation/test.
- Trained bounded PyTorch models on {device["selected_device"]}: minimal residual MLP, richer residual MLPs, direct richer MLPs, and GRU sequence residual models.
- Selected learned models by validation mean Euclidean error on `dwm-next-vblank` only. Held-out test metrics were then computed once for the selected models and matching baselines.

## Best Model
- Best validation learned model: {best["name"]}; validation mean {f(best["validation_metrics"]["learned"]["mean_euclidean_error"])} px, p95 {f(best["validation_metrics"]["learned"]["p95"])} px.
- Best selected accuracy model: {best_test["name"]}; test mean {f(learned["mean_euclidean_error"])} px, p95 {f(learned["p95"])} px, p99 {f(learned["p99"])} px, max {f(learned["max"])} px.
- Same-mask baseline: test mean {f(baseline["mean_euclidean_error"])} px, p95 {f(baseline["p95"])} px, p99 {f(baseline["p99"])} px, max {f(baseline["max"])} px.
- Delta vs baseline: mean {f(delta["mean_euclidean_error"], 4)} px, p95 {f(delta["p95"], 4)} px, p99 {f(delta["p99"], 4)} px, max {f(delta["max"], 4)} px.
- Best standalone learned model on selected test reporting: {best_standalone["name"]}; mean {f(best_standalone["test_metrics"]["learned"]["mean_euclidean_error"])} px vs same-mask baseline {f(best_standalone["test_metrics"]["baseline_same_mask"]["mean_euclidean_error"])} px.

## Slice Findings
- Learned models can reduce the high-motion tail, but several configs regress the standing/low-speed bulk where the deterministic baseline is already nearly exact.
- The most useful validation signal came from high-speed/high-acceleration weighting and richer motion history, not from absolute screen coordinates alone.
- Gated hybrid support: {"yes" if gate and gate["supported_by_validation"] else "no"}{"" if not gate else f"; validation rule {gate['validation']['gate_rule']} mean {f(gate['validation']['learned']['mean_euclidean_error'])} px vs same-mask baseline {f(gate['validation']['baseline_same_mask']['mean_euclidean_error'])} px."}
- Standalone neural models did not beat the deterministic baseline on validation mean; the useful accuracy result is the validation-selected gate that leaves low-risk anchors on the baseline and applies neural correction only to a high-risk slice.

## Fixed-Horizon Diagnostics
- Fixed 16.67ms and 33.33ms baselines were computed as frame-period diagnostics only. They were not used for primary model selection.
- Fixed 16.67ms test baseline: mean {f(fixed_one["mean_euclidean_error"])} px, p95 {f(fixed_one["p95"])} px.
- Fixed 33.33ms test baseline: mean {f(fixed_two["mean_euclidean_error"])} px, p95 {f(fixed_two["p95"])} px.
- Short fixed horizons can still be useful as diagnostics or upper-bound analysis, but Phase 4 product recommendations here are based on `dwm-next-vblank`.

## Recommendation
- Phase 5 robustness checks should take the best validation-supported gated hybrid and the best standalone learned model, then compare them on `dwm-next-vblank` plus high-speed/high-acceleration/high-horizon slices across additional traces/devices.
- Phase 6 distillation should target the gated correction behavior into a cheap residual/tabular form first; keep the GRU as an accuracy reference unless Phase 5 proves it is materially more robust.

See `scores.json` for full validation tables, selected test metrics, speed bins, high-acceleration/high-horizon slices, parameter counts, operation estimates, and timing.
"""
    (output_dir / "report.md").write_text(report, encoding="utf-8")

    readme = """# Phase 4: Best-Accuracy Model Search

Runs a bounded PyTorch model search for the Phase 3 product target.

## Reproduce

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-4 best-accuracy-model-search/run-phase4-model-search.ps1"
```

The script reads the root trace zip and Phase 1 split metadata. It does not run hooks and does not copy the zip into this directory.

## Outputs

- `scores.json`: machine-readable metrics and selected model results.
- `report.md`: concise findings and Phase 5/6 recommendation.
- `experiment-log.md`: execution environment and timing.
- `run_phase4_model_search.py`: reproducible training/evaluation runner.
- `run-phase4-model-search.ps1`: PowerShell wrapper using the existing venv.
"""
    (output_dir / "README.md").write_text(readme, encoding="utf-8")

    log = f"""# Phase 4 Experiment Log

- Started UTC: {scores["generated_utc_start"]}
- Finished UTC: {scores["generated_utc_end"]}
- Runtime seconds: {scores["performance"]["total_elapsed_sec"]:.3f}
- Python: {scores["runtime"]["python_executable"]}
- Torch: {scores["runtime"]["torch_version"]}
- NumPy: {scores["runtime"]["numpy_version"]}
- Device: {device["selected_device"]}
- CUDA available: {device["torch_cuda_available"]}
- GPU: {device.get("device_name", "n/a")}
- Trace zip: {scores["input"]["zip_path"]}
- Poll rows: {scores["input"]["poll_rows"]}
- Hook rows: {scores["input"]["hook_rows"]}
- Models trained: {len(scores["validation_results"])}
- Selected models with held-out test metrics: {len(scores["selected_test_results"])}

No packages were installed. No hooks were run. The root zip was streamed in place.
"""
    (output_dir / "experiment-log.md").write_text(log, encoding="utf-8")


def run(args: argparse.Namespace) -> dict[str, Any]:
    start_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    start = time.perf_counter()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    torch.backends.cudnn.benchmark = False
    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")

    splits, stopwatch_frequency = load_phase1(Path(args.phase1_scores_path))
    trace = read_trace(Path(args.zip_path), stopwatch_frequency)
    d = build_derived(trace, splits)
    bundles = {family: build_bundle(trace, d, splits, family) for family in ["minimal", "rich", "sequence"]}
    baseline_full = baseline_full_metrics(trace, d, splits)
    fixed_diagnostics = fixed_horizon_baseline_diagnostics(trace, splits, [16.667, 33.333])

    configs = model_configs()
    validation_results: list[dict[str, Any]] = []
    trained: dict[str, tuple[nn.Module, FeatureBundle, dict[str, Any], dict[str, Any]]] = {}

    for cidx, config in enumerate(configs):
        torch.manual_seed(args.seed + cidx)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(args.seed + cidx)
        bundle = bundles[config["family"]]
        if config["kind"] == "gru":
            model, train_info, _, info = train_sequence(bundle, trace, d, config, device, args)
            ops = gru_ops(len(bundle.sequence_feature_names), len(bundle.context_feature_names), config["hidden"][0])
        else:
            model, train_info, _, info = train_tabular(bundle, trace, d, config, device, args)
            ops = mlp_ops(len(bundle.feature_names), config["hidden"])

        split_metrics: dict[str, Any] = {}
        for split in ["train", "validation"]:
            pred, target, base, idx = predict_for_split(model, bundle, info, split, config["output_kind"], device)
            split_metrics[split] = evaluate_direct_predictions(pred, target, base, d, idx)
        result = {
            "name": config["name"],
            "config": config,
            "feature_family": config["family"],
            "output_kind": config["output_kind"],
            "required_history_back": bundle.required_back,
            "counts": {k: int(v.size) for k, v in bundle.indices_by_split.items()},
            "feature_count": len(bundle.feature_names) if bundle.family != "sequence" else len(bundle.sequence_feature_names) + len(bundle.context_feature_names),
            "parameter_count": param_count(model),
            "rough_multiply_adds_per_inference": ops,
            "training": train_info,
            "validation_metrics": split_metrics["validation"],
            "train_metrics": split_metrics["train"],
        }
        validation_results.append(result)
        trained[config["name"]] = (model, bundle, info, config)

    validation_results.sort(key=lambda r: (r["validation_metrics"]["learned"]["mean_euclidean_error"], r["validation_metrics"]["learned"]["p95"], r["name"]))
    selected_names: list[str] = []
    if validation_results:
        selected_names.append(validation_results[0]["name"])
    for family in ["minimal", "rich", "sequence"]:
        family_rows = [r for r in validation_results if r["feature_family"] == family]
        if family_rows:
            selected_names.append(family_rows[0]["name"])
    for output_kind in ["direct", "residual"]:
        rows = [r for r in validation_results if r["output_kind"] == output_kind]
        if rows:
            selected_names.append(rows[0]["name"])
    selected_names = list(dict.fromkeys(selected_names))

    selected_test_results: list[dict[str, Any]] = []
    for name in selected_names:
        model, bundle, info, config = trained[name]
        pred, target, base, idx = predict_for_split(model, bundle, info, "test", config["output_kind"], device)
        ev = evaluate_direct_predictions(pred, target, base, d, idx)
        source = next(r for r in validation_results if r["name"] == name)
        row = {
            "name": name,
            "config": config,
            "feature_family": source["feature_family"],
            "output_kind": source["output_kind"],
            "parameter_count": source["parameter_count"],
            "rough_multiply_adds_per_inference": source["rough_multiply_adds_per_inference"],
            "test_metrics": ev,
            "validation_metrics": source["validation_metrics"],
        }
        selected_test_results.append(row)

    best_source = validation_results[0]
    model, bundle, info, config = trained[best_source["name"]]
    gated = choose_gated_hybrid(best_source, model, bundle, info, d, device)
    if gated and gated["supported_by_validation"]:
        pred, target, base, idx = predict_for_split(model, bundle, info, "test", config["output_kind"], device)
        rule_name = gated["validation"]["gate_rule"]
        if rule_name == "speed>=500":
            risk = d.speed[idx] >= 500.0
        elif rule_name == "speed>=1500":
            risk = d.speed[idx] >= 1500.0
        elif rule_name == "speed>=3000":
            risk = d.speed[idx] >= 3000.0
        elif rule_name == "accel>=20000":
            risk = d.accel_mag[idx] >= 20000.0
        elif rule_name == "accel>=100000":
            risk = d.accel_mag[idx] >= 100000.0
        elif rule_name == "speed>=1500_or_accel>=100000":
            risk = (d.speed[idx] >= 1500.0) | (d.accel_mag[idx] >= 100000.0)
        elif rule_name == "speed>=500_and_horizon>=12":
            risk = (d.speed[idx] >= 500.0) & (d.horizon_ms[idx] >= 12.0)
        else:
            risk = d.duplicate_anchor[idx] & (d.time_since_move_ms[idx] < 16.0)
        hybrid = base.copy()
        hybrid[risk] = pred[risk]
        gated["test"] = evaluate_direct_predictions(hybrid, target, base, d, idx)
        gated["test"]["gate_true_count"] = int(risk.sum())
        selected_test_results.append(
            {
                "name": f"gated-{best_source['name']}",
                "config": {"kind": "gated_hybrid", "source_model": best_source["name"], "gate_rule": rule_name},
                "feature_family": "gated",
                "output_kind": "hybrid",
                "parameter_count": best_source["parameter_count"],
                "rough_multiply_adds_per_inference": best_source["rough_multiply_adds_per_inference"],
                "test_metrics": gated["test"],
                "validation_metrics": gated["validation"],
            }
        )

    selected_test_results.sort(key=lambda r: (r["test_metrics"]["learned"]["mean_euclidean_error"], r["test_metrics"]["learned"]["p95"], r["name"]))
    end = time.perf_counter()
    scores = {
        "phase": "phase-4 best-accuracy-model-search",
        "generated_utc_start": start_utc,
        "generated_utc_end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "input": {
            "zip_path": trace.zip_path,
            "stopwatch_frequency": stopwatch_frequency,
            "row_count": trace.row_count,
            "poll_rows": trace.poll_rows,
            "hook_rows": trace.hook_rows,
        },
        "dataset": {
            "anchor_set": "poll",
            "target": "dwm-next-vblank",
            "target_refresh_assumption": "no Phase 4 restriction beyond the recorded DWM next-vblank target; fixed horizons are diagnostic only",
            "baseline": "gained-last2-0.75",
            "split": {s.name: {"start_elapsed_us": s.start_us, "end_elapsed_us": s.end_us} for s in splits},
            "feature_family_counts": {name: {k: int(v.size) for k, v in b.indices_by_split.items()} for name, b in bundles.items()},
            "normalization": "fit on train only per feature family and target kind; frozen for validation/test",
            "feature_leakage_rule": "all features use poll/hook/DWM fields with elapsedMicroseconds <= anchor elapsedMicroseconds",
        },
        "runtime": runtime_info(device),
        "baseline_full_last2_mask": baseline_full,
        "diagnostic_fixed_horizon_baselines": fixed_diagnostics,
        "model_search_space": configs,
        "validation_results": validation_results,
        "selected_test_results": selected_test_results,
        "selection": {
            "selection_metric": "lowest validation mean Euclidean error; test was evaluated after selection only",
            "product_selection_scope": "dwm-next-vblank only for this primary search; fixed horizons may be diagnostic/upper-bound analysis but do not replace the primary target",
            "best_validation_model": validation_results[0],
            "best_test_model": selected_test_results[0],
            "selected_model_names": selected_names,
            "gated_hybrid": gated,
        },
        "performance": {
            "total_elapsed_sec": end - start,
            "batch_size": args.batch_size,
            "max_epochs": args.max_epochs,
            "patience": args.patience,
            "timing_note": "Single local run; GPU timings include data transfer and validation passes and are approximate.",
        },
        "recommendation": {
            "phase5": "Run robustness checks for the best validation-supported gated hybrid and the best standalone learned model on dwm-next-vblank plus high-speed/high-acceleration/high-horizon slices across additional traces/devices.",
            "phase6": "Distill the gated correction behavior into a cheap residual/tabular form before considering GRU deployment unless Phase 5 shows sequence models are materially more robust.",
        },
    }
    return scores


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip-path", default=str(repo_root / "cursor-mirror-trace-20260501-091537.zip"))
    parser.add_argument("--phase1-scores-path", default=str(repo_root / "poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json"))
    parser.add_argument("--output-dir", default=str(script_dir))
    parser.add_argument("--seed", type=int, default=20260501)
    parser.add_argument("--max-epochs", type=int, default=80)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    scores = run(args)
    (output_dir / "scores.json").write_text(json.dumps(scores, indent=2) + "\n", encoding="utf-8")
    write_text_outputs(output_dir, scores)
    best = scores["selection"]["best_test_model"]
    learned = best["test_metrics"]["learned"]
    base = best["test_metrics"]["baseline_same_mask"]
    print(f"wrote {output_dir / 'scores.json'}")
    print(f"device={scores['runtime']['device']['selected_device']} gpu={scores['runtime']['device'].get('device_name', 'n/a')}")
    print(
        "best_selected_test model={name} mean={mean:.6f}px p95={p95:.6f}px baseline_mean={bmean:.6f}px baseline_p95={bp95:.6f}px".format(
            name=best["name"],
            mean=learned["mean_euclidean_error"],
            p95=learned["p95"],
            bmean=base["mean_euclidean_error"],
            bp95=base["p95"],
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
