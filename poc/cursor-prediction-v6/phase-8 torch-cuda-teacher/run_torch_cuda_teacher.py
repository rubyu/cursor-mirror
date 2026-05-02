#!/usr/bin/env python
"""Phase 8 CUDA teacher experiments for Cursor Mirror POC v6.

The script intentionally writes only final compact artifacts:
scores.json, report.md, and experiment-log.md. Model weights and tensors stay
in memory; no checkpoints, feature caches, TensorBoard logs, or generated
datasets are written.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F


BASELINE_GAIN = 0.75
IDLE_GAP_MS = 100.0
REGRESSION_THRESHOLDS = (1.0, 3.0, 5.0)
SPEED_BINS = (
    "0-25 px/s",
    "25-100 px/s",
    "100-250 px/s",
    "250-500 px/s",
    "500-1000 px/s",
    "1000-2000 px/s",
    ">=2000 px/s",
)
HORIZON_BINS = (
    "0-2 ms",
    "2-4 ms",
    "4-8 ms",
    "8-12 ms",
    "12-16.7 ms",
    ">=16.7 ms",
)
LEAD_BINS = (
    "<0 us late",
    "0-500 us",
    "500-1000 us",
    "1000-1500 us",
    "1500-2000 us",
    ">=2000 us",
)
GUARD_CAPS_PX = (0.125, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.5)
SEQUENCE_LENGTH = 8
HISTORY_DROPOUT_RATE = 0.30
HISTORY_DROPOUT_MAX_STEPS = 3

NUMERIC_FEATURES = (
    "targetHorizonMs",
    "horizonSec",
    "dtMs_filled",
    "prevDtMs_filled",
    "validVelocityMask",
    "hasPrevMask",
    "hasPrevPrevMask",
    "anchorX",
    "anchorY",
    "prevDeltaX",
    "prevDeltaY",
    "prevPrevDeltaX",
    "prevPrevDeltaY",
    "velocityX",
    "velocityY",
    "velocityOffsetX",
    "velocityOffsetY",
    "currentBaselineOffsetX",
    "currentBaselineOffsetY",
    "prevVelocityX",
    "prevVelocityY",
    "accelOffsetX",
    "accelOffsetY",
    "speedPxS",
    "speedHorizonPx",
    "accelerationPxS2",
    "accelerationHorizonPx",
    "schedulerLeadUs",
    "dwmTimingAvailableMask",
)

SEQUENCE_FEATURES = (
    "mask",
    "ageMs",
    "dtMs",
    "relX",
    "relY",
    "stepDeltaX",
    "stepDeltaY",
    "stepVelocityX",
    "stepVelocityY",
    "stepSpeedPxS",
)


def parse_args() -> argparse.Namespace:
    phase_dir = Path(__file__).resolve().parent
    root = phase_dir.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--dataset", type=Path, default=root / "phase-2 dataset-builder" / "dataset.jsonl")
    parser.add_argument("--out", type=Path, default=phase_dir)
    parser.add_argument("--max-seconds", type=float, default=240.0)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--epochs", type=int, default=72)
    parser.add_argument("--seed", type=int, default=8600)
    return parser.parse_args()


def finite(value: Any, fallback: float = 0.0) -> float:
    if value is None:
        return fallback
    try:
        out = float(value)
    except (TypeError, ValueError):
        return fallback
    return out if math.isfinite(out) else fallback


def distance(ax: float, ay: float, bx: float, by: float) -> float:
    dx = ax - bx
    dy = ay - by
    return math.sqrt(dx * dx + dy * dy)


def percentile(sorted_values: list[float], p: float) -> float | None:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    rank = (len(sorted_values) - 1) * p
    lo = int(math.floor(rank))
    hi = int(math.ceil(rank))
    if lo == hi:
        return float(sorted_values[lo])
    return float(sorted_values[lo] * (hi - rank) + sorted_values[hi] * (rank - lo))


def metric_stats(values: np.ndarray | list[float]) -> dict[str, Any]:
    data = [float(v) for v in values if math.isfinite(float(v))]
    data.sort()
    if not data:
        return {
            "n": 0,
            "mean_px": None,
            "rmse_px": None,
            "p50_px": None,
            "p90_px": None,
            "p95_px": None,
            "p99_px": None,
            "max_px": None,
        }
    arr = np.asarray(data, dtype=np.float64)
    return {
        "n": int(arr.size),
        "mean_px": float(arr.mean()),
        "rmse_px": float(math.sqrt(float(np.mean(arr * arr)))),
        "p50_px": percentile(data, 0.50),
        "p90_px": percentile(data, 0.90),
        "p95_px": percentile(data, 0.95),
        "p99_px": percentile(data, 0.99),
        "max_px": float(data[-1]),
    }


def scalar_stats(values: list[float]) -> dict[str, Any]:
    data = [float(v) for v in values if math.isfinite(float(v))]
    data.sort()
    if not data:
        return {"count": 0, "min": None, "mean": None, "p50": None, "p90": None, "p95": None, "p99": None, "max": None}
    arr = np.asarray(data, dtype=np.float64)
    return {
        "count": int(arr.size),
        "min": float(data[0]),
        "mean": float(arr.mean()),
        "p50": percentile(data, 0.50),
        "p90": percentile(data, 0.90),
        "p95": percentile(data, 0.95),
        "p99": percentile(data, 0.99),
        "max": float(data[-1]),
    }


def summarize_delta(stats: dict[str, Any], baseline_stats: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("mean_px", "rmse_px", "p50_px", "p90_px", "p95_px", "p99_px", "max_px"):
        out[key] = None if stats[key] is None or baseline_stats[key] is None else float(stats[key] - baseline_stats[key])
    return out


def regression_counts(delta: np.ndarray) -> dict[str, int]:
    return {
        "worse_over_1px": int(np.sum(delta > 1.0)),
        "worse_over_3px": int(np.sum(delta > 3.0)),
        "worse_over_5px": int(np.sum(delta > 5.0)),
        "better_over_1px": int(np.sum(delta < -1.0)),
        "better_over_3px": int(np.sum(delta < -3.0)),
        "better_over_5px": int(np.sum(delta < -5.0)),
    }


def compact_eval(result: dict[str, Any], include_breakdowns: bool) -> dict[str, Any]:
    out = {
        "overall": result["overall"],
        "delta_vs_current": result["delta_vs_current"],
        "regressions_vs_current": result["regressions_vs_current"],
    }
    if include_breakdowns:
        out["breakdowns"] = result["breakdowns"]
    return out


def evaluate_predictions(
    rows: list[dict[str, Any]],
    pred_xy: np.ndarray,
    baseline_errors: np.ndarray,
    include_breakdowns: bool = False,
) -> dict[str, Any]:
    labels = label_xy(rows)
    errors = np.sqrt(np.sum((pred_xy - labels) ** 2, axis=1))
    delta = errors - baseline_errors
    overall = metric_stats(errors)
    baseline_stats = metric_stats(baseline_errors)
    result = {
        "overall": overall,
        "delta_vs_current": summarize_delta(overall, baseline_stats),
        "regressions_vs_current": regression_counts(delta),
    }
    if include_breakdowns:
        speed_breakdowns: dict[str, Any] = {}
        speed_labels = np.asarray([row.get("speedBin") or "missing" for row in rows])
        for label in SPEED_BINS:
            mask = speed_labels == label
            group_errors = errors[mask]
            group_delta = delta[mask]
            speed_breakdowns[label] = {
                "stats": metric_stats(group_errors),
                "regressions_vs_current": regression_counts(group_delta),
            }
        result["breakdowns"] = {"speed_bins": speed_breakdowns}
    return result


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_json(path: Path, value: Any) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")


def write_text(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text.rstrip() + "\n")


def predict_current_row(row: dict[str, Any]) -> tuple[float, float]:
    target_horizon_ms = finite(row.get("targetHorizonMs"))
    valid_velocity = bool(row.get("validVelocity"))
    dt_ms = finite(row.get("dtMs"), 0.0)
    if not valid_velocity or dt_ms <= 0.0 or target_horizon_ms <= 0.0:
        return finite(row.get("anchorX")), finite(row.get("anchorY"))
    h = target_horizon_ms / 1000.0
    return (
        finite(row.get("anchorX")) + finite(row.get("velocityX")) * h * BASELINE_GAIN,
        finite(row.get("anchorY")) + finite(row.get("velocityY")) * h * BASELINE_GAIN,
    )


def baseline_xy(rows: list[dict[str, Any]]) -> np.ndarray:
    return np.asarray([predict_current_row(row) for row in rows], dtype=np.float32)


def label_xy(rows: list[dict[str, Any]]) -> np.ndarray:
    return np.asarray([(finite(row.get("labelX")), finite(row.get("labelY"))) for row in rows], dtype=np.float32)


def baseline_errors(rows: list[dict[str, Any]]) -> np.ndarray:
    pred = baseline_xy(rows)
    labels = label_xy(rows)
    return np.sqrt(np.sum((pred - labels) ** 2, axis=1))


def history_terms(row: dict[str, Any]) -> dict[str, Any]:
    h = max(0.0, finite(row.get("targetHorizonMs")) / 1000.0)
    dt_ms = finite(row.get("dtMs"), 16.6667)
    prev_dt_ms = finite(row.get("prevDtMs"), dt_ms)
    has_prev = row.get("prevAnchorX") is not None and row.get("prevAnchorY") is not None
    has_prev_prev = has_prev and row.get("prevPrevAnchorX") is not None and row.get("prevPrevAnchorY") is not None
    prev_delta_x = finite(row.get("anchorX")) - finite(row.get("prevAnchorX")) if has_prev else 0.0
    prev_delta_y = finite(row.get("anchorY")) - finite(row.get("prevAnchorY")) if has_prev else 0.0
    prev_prev_delta_x = finite(row.get("prevAnchorX")) - finite(row.get("prevPrevAnchorX")) if has_prev_prev else 0.0
    prev_prev_delta_y = finite(row.get("prevAnchorY")) - finite(row.get("prevPrevAnchorY")) if has_prev_prev else 0.0
    prev_velocity_x = prev_prev_delta_x / (prev_dt_ms / 1000.0) if has_prev_prev and prev_dt_ms > 0.0 else 0.0
    prev_velocity_y = prev_prev_delta_y / (prev_dt_ms / 1000.0) if has_prev_prev and prev_dt_ms > 0.0 else 0.0
    accel_x = 0.0
    accel_y = 0.0
    if (
        bool(row.get("validVelocity"))
        and has_prev_prev
        and dt_ms > 0.0
        and prev_dt_ms > 0.0
        and dt_ms <= IDLE_GAP_MS
        and prev_dt_ms <= IDLE_GAP_MS
    ):
        avg_dt_sec = ((dt_ms + prev_dt_ms) / 2.0) / 1000.0
        accel_x = (finite(row.get("velocityX")) - prev_velocity_x) / avg_dt_sec
        accel_y = (finite(row.get("velocityY")) - prev_velocity_y) / avg_dt_sec
    return {
        "h": h,
        "dt_ms": dt_ms,
        "prev_dt_ms": prev_dt_ms,
        "has_prev": has_prev,
        "has_prev_prev": has_prev_prev,
        "prev_delta_x": prev_delta_x,
        "prev_delta_y": prev_delta_y,
        "prev_prev_delta_x": prev_prev_delta_x,
        "prev_prev_delta_y": prev_prev_delta_y,
        "prev_velocity_x": prev_velocity_x,
        "prev_velocity_y": prev_velocity_y,
        "accel_x": accel_x,
        "accel_y": accel_y,
    }


def raw_numeric_feature(row: dict[str, Any]) -> list[float]:
    hist = history_terms(row)
    velocity_offset_x = finite(row.get("velocityX")) * hist["h"]
    velocity_offset_y = finite(row.get("velocityY")) * hist["h"]
    accel_offset_x = 0.5 * hist["accel_x"] * hist["h"] * hist["h"]
    accel_offset_y = 0.5 * hist["accel_y"] * hist["h"] * hist["h"]
    return [
        finite(row.get("targetHorizonMs")),
        hist["h"],
        hist["dt_ms"],
        hist["prev_dt_ms"],
        1.0 if row.get("validVelocity") else 0.0,
        1.0 if hist["has_prev"] else 0.0,
        1.0 if hist["has_prev_prev"] else 0.0,
        finite(row.get("anchorX")),
        finite(row.get("anchorY")),
        hist["prev_delta_x"],
        hist["prev_delta_y"],
        hist["prev_prev_delta_x"],
        hist["prev_prev_delta_y"],
        finite(row.get("velocityX")),
        finite(row.get("velocityY")),
        velocity_offset_x,
        velocity_offset_y,
        velocity_offset_x * BASELINE_GAIN,
        velocity_offset_y * BASELINE_GAIN,
        hist["prev_velocity_x"],
        hist["prev_velocity_y"],
        accel_offset_x,
        accel_offset_y,
        finite(row.get("speedPxS")),
        finite(row.get("speedPxS")) * hist["h"],
        finite(row.get("accelerationPxS2")),
        finite(row.get("accelerationPxS2")) * hist["h"] * hist["h"],
        finite(row.get("schedulerLeadUs")),
        1.0 if row.get("dwmTimingAvailable") else 0.0,
    ]


class FeatureBuilder:
    def __init__(self, train_rows: list[dict[str, Any]]):
        raw = np.asarray([raw_numeric_feature(row) for row in train_rows], dtype=np.float64)
        self.means = raw.mean(axis=0)
        self.stds = raw.std(axis=0)
        self.stds[self.stds < 1e-9] = 1.0
        self.feature_names = (
            list(NUMERIC_FEATURES)
            + [f"speedBin:{label}" for label in SPEED_BINS]
            + [f"horizonBin:{label}" for label in HORIZON_BINS]
            + [f"schedulerLeadBin:{label}" for label in LEAD_BINS]
        )

    def vector(self, row: dict[str, Any]) -> np.ndarray:
        numeric = (np.asarray(raw_numeric_feature(row), dtype=np.float64) - self.means) / self.stds
        one_hot: list[float] = []
        one_hot.extend(1.0 if row.get("speedBin") == label else 0.0 for label in SPEED_BINS)
        one_hot.extend(1.0 if row.get("horizonBin") == label else 0.0 for label in HORIZON_BINS)
        one_hot.extend(1.0 if row.get("schedulerLeadBin") == label else 0.0 for label in LEAD_BINS)
        return np.asarray([*numeric.tolist(), *one_hot], dtype=np.float32)


def annotate_session_history(rows: list[dict[str, Any]]) -> None:
    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_session[str(row["sessionId"])].append(row)
    for session_rows in by_session.values():
        session_rows.sort(key=lambda row: int(row["ordinal"]))
        for index, row in enumerate(session_rows):
            row["_sessionRows"] = session_rows
            row["_sessionIndex"] = index


def raw_sequence(row: dict[str, Any], sequence_length: int) -> list[list[float]]:
    out: list[list[float]] = []
    session_rows = row.get("_sessionRows") or [row]
    current_index = int(row.get("_sessionIndex", 0))
    for t in range(sequence_length):
        offset = sequence_length - 1 - t
        index = current_index - offset
        if index < 0:
            out.append([0.0] * len(SEQUENCE_FEATURES))
            continue
        hist = session_rows[index]
        prev = session_rows[index - 1] if index > 0 else None
        if prev is None:
            dt_ms = finite(hist.get("dtMs"), 16.6667)
            step_delta_x = 0.0
            step_delta_y = 0.0
        else:
            dt_ms = max(0.001, (finite(hist.get("anchorElapsedUs")) - finite(prev.get("anchorElapsedUs"))) / 1000.0)
            step_delta_x = finite(hist.get("anchorX")) - finite(prev.get("anchorX"))
            step_delta_y = finite(hist.get("anchorY")) - finite(prev.get("anchorY"))
        step_velocity_x = step_delta_x / (dt_ms / 1000.0) if dt_ms > 0.0 else 0.0
        step_velocity_y = step_delta_y / (dt_ms / 1000.0) if dt_ms > 0.0 else 0.0
        age_ms = max(0.0, (finite(row.get("anchorElapsedUs")) - finite(hist.get("anchorElapsedUs"))) / 1000.0)
        out.append(
            [
                1.0,
                age_ms,
                dt_ms,
                finite(hist.get("anchorX")) - finite(row.get("anchorX")),
                finite(hist.get("anchorY")) - finite(row.get("anchorY")),
                step_delta_x,
                step_delta_y,
                step_velocity_x,
                step_velocity_y,
                math.sqrt(step_velocity_x * step_velocity_x + step_velocity_y * step_velocity_y),
            ]
        )
    return out


class SequenceBuilder:
    def __init__(self, train_rows: list[dict[str, Any]], sequence_length: int):
        self.sequence_length = sequence_length
        self.feature_names = list(SEQUENCE_FEATURES)
        seqs = np.asarray([raw_sequence(row, sequence_length) for row in train_rows], dtype=np.float64)
        valid = seqs[:, :, 0] == 1.0
        self.means = np.zeros((len(SEQUENCE_FEATURES),), dtype=np.float64)
        self.stds = np.ones((len(SEQUENCE_FEATURES),), dtype=np.float64)
        for feature_index in range(1, len(SEQUENCE_FEATURES)):
            values = seqs[:, :, feature_index][valid]
            if values.size > 0:
                self.means[feature_index] = float(values.mean())
                std = float(values.std())
                self.stds[feature_index] = std if std > 1e-9 else 1.0

    def tensor(self, row: dict[str, Any]) -> np.ndarray:
        seq = raw_sequence(row, self.sequence_length)
        out = np.zeros((self.sequence_length, len(SEQUENCE_FEATURES)), dtype=np.float32)
        for t, step in enumerate(seq):
            if step[0] != 1.0:
                continue
            out[t, 0] = 1.0
            for feature_index in range(1, len(SEQUENCE_FEATURES)):
                out[t, feature_index] = float((step[feature_index] - self.means[feature_index]) / self.stds[feature_index])
        return out


def make_design(
    rows: list[dict[str, Any]],
    feature_builder: FeatureBuilder,
    sequence_builder: SequenceBuilder,
) -> dict[str, Any]:
    scalar = np.asarray([feature_builder.vector(row) for row in rows], dtype=np.float32)
    seq = np.asarray([sequence_builder.tensor(row) for row in rows], dtype=np.float32)
    base = baseline_xy(rows)
    labels = label_xy(rows)
    return {
        "rows": rows,
        "scalar": scalar,
        "seq": seq,
        "base_xy": base,
        "labels": labels,
        "target": labels - base,
        "baseline_errors": np.sqrt(np.sum((base - labels) ** 2, axis=1)),
    }


class ResidualMLP(nn.Module):
    def __init__(self, scalar_dim: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(scalar_dim, 128),
            nn.LayerNorm(128),
            nn.GELU(),
            nn.Dropout(0.05),
            nn.Linear(128, 64),
            nn.GELU(),
            nn.Dropout(0.05),
            nn.Linear(64, 32),
            nn.GELU(),
            nn.Linear(32, 2),
        )

    def forward(self, scalar: torch.Tensor, seq: torch.Tensor | None = None) -> torch.Tensor:
        return self.net(scalar)


class SequenceGRU(nn.Module):
    def __init__(self, scalar_dim: int, seq_dim: int):
        super().__init__()
        self.gru = nn.GRU(input_size=seq_dim, hidden_size=64, num_layers=1, batch_first=True)
        self.scalar = nn.Sequential(nn.Linear(scalar_dim, 64), nn.LayerNorm(64), nn.GELU())
        self.head = nn.Sequential(
            nn.Linear(128, 64),
            nn.GELU(),
            nn.Dropout(0.05),
            nn.Linear(64, 32),
            nn.GELU(),
            nn.Linear(32, 2),
        )

    def forward(self, scalar: torch.Tensor, seq: torch.Tensor | None = None) -> torch.Tensor:
        assert seq is not None
        _, hidden = self.gru(seq)
        merged = torch.cat([hidden[-1], self.scalar(scalar)], dim=1)
        return self.head(merged)


class CausalConv1d(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int, dilation: int):
        super().__init__()
        self.pad = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(in_channels, out_channels, kernel_size=kernel_size, dilation=dilation)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv(F.pad(x, (self.pad, 0)))


class CausalBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, dilation: int):
        super().__init__()
        self.conv1 = CausalConv1d(in_channels, out_channels, kernel_size=3, dilation=dilation)
        self.norm1 = nn.GroupNorm(1, out_channels)
        self.conv2 = CausalConv1d(out_channels, out_channels, kernel_size=3, dilation=dilation)
        self.norm2 = nn.GroupNorm(1, out_channels)
        self.skip = nn.Conv1d(in_channels, out_channels, kernel_size=1) if in_channels != out_channels else nn.Identity()
        self.drop = nn.Dropout(0.05)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = self.drop(F.gelu(self.norm1(self.conv1(x))))
        y = self.norm2(self.conv2(y))
        return F.gelu(y + self.skip(x))


class SequenceTCN(nn.Module):
    def __init__(self, scalar_dim: int, seq_dim: int):
        super().__init__()
        self.blocks = nn.Sequential(
            CausalBlock(seq_dim, 32, dilation=1),
            CausalBlock(32, 32, dilation=2),
            CausalBlock(32, 32, dilation=4),
        )
        self.scalar = nn.Sequential(nn.Linear(scalar_dim, 64), nn.LayerNorm(64), nn.GELU())
        self.head = nn.Sequential(
            nn.Linear(96, 64),
            nn.GELU(),
            nn.Dropout(0.05),
            nn.Linear(64, 32),
            nn.GELU(),
            nn.Linear(32, 2),
        )

    def forward(self, scalar: torch.Tensor, seq: torch.Tensor | None = None) -> torch.Tensor:
        assert seq is not None
        y = self.blocks(seq.transpose(1, 2))
        last = y[:, :, -1]
        return self.head(torch.cat([last, self.scalar(scalar)], dim=1))


def parameter_count(model: nn.Module) -> int:
    return int(sum(param.numel() for param in model.parameters()))


def apply_history_dropout(seq: torch.Tensor, rate: float, max_steps: int) -> torch.Tensor:
    if rate <= 0.0 or max_steps <= 0:
        return seq
    batch, steps, _ = seq.shape
    limit = min(max_steps, steps - 1)
    if limit <= 0:
        return seq
    selected = torch.rand(batch, device=seq.device) < rate
    if not bool(selected.any()):
        return seq
    drop_counts = torch.randint(1, limit + 1, (batch,), device=seq.device)
    out = seq.clone()
    for step_index in range(limit):
        rows = selected & (drop_counts > step_index)
        if bool(rows.any()):
            out[rows, step_index, :] = 0.0
    return out


def set_seeds(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed % (2**32 - 1))
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def train_model(
    model: nn.Module,
    fit: dict[str, Any],
    validation: dict[str, Any],
    device: torch.device,
    *,
    seed: int,
    batch_size: int,
    epochs: int,
    lr: float,
    weight_decay: float,
    min_epochs: int,
    patience: int,
    history_dropout_rate: float,
    history_dropout_max_steps: int,
    deadline: float,
) -> dict[str, Any]:
    set_seeds(seed)
    model.to(device)
    target_mean = fit["target"].mean(axis=0).astype(np.float32)
    target_std = fit["target"].std(axis=0).astype(np.float32)
    target_std[target_std < 1e-6] = 1.0

    x_fit = torch.as_tensor(fit["scalar"], dtype=torch.float32, device=device)
    seq_fit = torch.as_tensor(fit["seq"], dtype=torch.float32, device=device)
    y_fit = torch.as_tensor((fit["target"] - target_mean) / target_std, dtype=torch.float32, device=device)
    x_val = torch.as_tensor(validation["scalar"], dtype=torch.float32, device=device)
    seq_val = torch.as_tensor(validation["seq"], dtype=torch.float32, device=device)
    y_val = torch.as_tensor((validation["target"] - target_mean) / target_std, dtype=torch.float32, device=device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    criterion = nn.SmoothL1Loss(beta=0.6)
    best_state = copy.deepcopy(model.state_dict())
    best_val = float("inf")
    best_epoch = 0
    stale_epochs = 0
    final_train_loss = float("inf")
    stopped_early = False
    stopped_reason = None
    start = time.perf_counter()
    actual_epochs = 0
    n = x_fit.shape[0]

    for epoch in range(1, epochs + 1):
        model.train()
        order = torch.randperm(n, device=device)
        running_loss = 0.0
        seen = 0
        for start_index in range(0, n, batch_size):
            idx = order[start_index : start_index + batch_size]
            batch_scalar = x_fit[idx]
            batch_seq = apply_history_dropout(seq_fit[idx], history_dropout_rate, history_dropout_max_steps)
            batch_y = y_fit[idx]
            optimizer.zero_grad(set_to_none=True)
            pred = model(batch_scalar, batch_seq)
            loss = criterion(pred, batch_y)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=4.0)
            optimizer.step()
            running_loss += float(loss.detach().item()) * int(idx.numel())
            seen += int(idx.numel())
        final_train_loss = running_loss / max(1, seen)
        actual_epochs = epoch

        model.eval()
        with torch.no_grad():
            val_loss = float(criterion(model(x_val, seq_val), y_val).detach().item())
        if val_loss + 1e-5 < best_val:
            best_val = val_loss
            best_epoch = epoch
            best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
            stale_epochs = 0
        else:
            stale_epochs += 1

        if epoch >= min_epochs and stale_epochs >= patience:
            stopped_early = True
            stopped_reason = f"Validation loss did not improve for {patience} epochs."
            break
        if epoch >= min_epochs and time.perf_counter() > deadline:
            stopped_early = True
            stopped_reason = "Reached per-model wall-clock budget."
            break

    model.load_state_dict(best_state)
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    elapsed = time.perf_counter() - start
    return {
        "model": model,
        "target_mean": target_mean,
        "target_std": target_std,
        "training": {
            "actual_epochs": int(actual_epochs),
            "requested_epochs": int(epochs),
            "best_epoch": int(best_epoch),
            "stopped_early": bool(stopped_early),
            "stopped_early_reason": stopped_reason,
            "elapsed_sec": float(elapsed),
            "final_train_loss": float(final_train_loss),
            "best_validation_loss": float(best_val),
            "parameter_count": parameter_count(model),
            "base_samples": int(n),
            "history_dropout_rate": float(history_dropout_rate),
            "history_dropout_max_steps": int(history_dropout_max_steps),
        },
    }


def predict_model(
    trained: dict[str, Any],
    data: dict[str, Any],
    device: torch.device,
    cap_px: float | None,
    batch_size: int,
) -> np.ndarray:
    model: nn.Module = trained["model"]
    model.eval()
    x = torch.as_tensor(data["scalar"], dtype=torch.float32, device=device)
    seq = torch.as_tensor(data["seq"], dtype=torch.float32, device=device)
    outputs: list[np.ndarray] = []
    with torch.no_grad():
        for start_index in range(0, x.shape[0], batch_size):
            pred = model(x[start_index : start_index + batch_size], seq[start_index : start_index + batch_size])
            outputs.append(pred.detach().cpu().numpy())
    normed = np.concatenate(outputs, axis=0)
    correction = normed * trained["target_std"] + trained["target_mean"]
    if cap_px is not None:
        mag = np.sqrt(np.sum(correction * correction, axis=1))
        scale = np.ones_like(mag, dtype=np.float32)
        nonzero = mag > 1e-9
        scale[nonzero] = np.minimum(1.0, cap_px / mag[nonzero])
        correction = correction * scale[:, None]
    return data["base_xy"] + correction.astype(np.float32)


def select_guarded_variant(
    trained: dict[str, Any],
    validation: dict[str, Any],
    device: torch.device,
    batch_size: int,
) -> dict[str, Any]:
    candidates = []
    for cap_px in GUARD_CAPS_PX:
        pred = predict_model(trained, validation, device, cap_px, batch_size)
        evaluation = evaluate_predictions(validation["rows"], pred, validation["baseline_errors"], include_breakdowns=False)
        candidates.append({"capPx": cap_px, "validation": evaluation})
    candidates.sort(
        key=lambda item: (
            item["validation"]["regressions_vs_current"]["worse_over_5px"],
            item["validation"]["overall"]["p99_px"] if item["validation"]["overall"]["p99_px"] is not None else float("inf"),
            item["validation"]["overall"]["mean_px"] if item["validation"]["overall"]["mean_px"] is not None else float("inf"),
        )
    )
    return candidates[0]


def split_session(rows: list[dict[str, Any]], session_id: str) -> list[dict[str, Any]]:
    return sorted([row for row in rows if str(row["sessionId"]) == session_id], key=lambda row: int(row["ordinal"]))


def split_fit_validation(train_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    fit = [row for row in train_rows if row.get("chronologicalBlock") == "train_block_first_70pct"]
    validation = [row for row in train_rows if row.get("chronologicalBlock") == "validation_block_last_30pct"]
    if fit and validation:
        return fit, validation
    cut = int(len(train_rows) * 0.70)
    return train_rows[:cut], train_rows[cut:]


def add_model_evaluation(
    *,
    id_: str,
    family: str,
    description: str,
    trained: dict[str, Any] | None,
    train: dict[str, Any],
    validation: dict[str, Any],
    heldout: dict[str, Any],
    device: torch.device,
    batch_size: int,
    cap_px: float | None,
    selected_parameters: dict[str, Any],
) -> dict[str, Any]:
    if trained is None:
        train_pred = train["base_xy"]
        val_pred = validation["base_xy"]
        heldout_pred = heldout["base_xy"]
        training_summary = None
    else:
        train_pred = predict_model(trained, train, device, cap_px, batch_size)
        val_pred = predict_model(trained, validation, device, cap_px, batch_size)
        heldout_pred = predict_model(trained, heldout, device, cap_px, batch_size)
        training_summary = trained["training"]

    heldout_eval = evaluate_predictions(heldout["rows"], heldout_pred, heldout["baseline_errors"], include_breakdowns=True)
    train_eval = evaluate_predictions(train["rows"], train_pred, train["baseline_errors"], include_breakdowns=False)
    val_eval = evaluate_predictions(validation["rows"], val_pred, validation["baseline_errors"], include_breakdowns=False)
    visible = heldout_eval["regressions_vs_current"]["worse_over_5px"] > 0
    broad_small = (
        heldout_eval["regressions_vs_current"]["worse_over_3px"] > 0
        or heldout_eval["regressions_vs_current"]["worse_over_1px"] > 500
    )
    if visible:
        relevance = "teacher-only / not directly shippable because held-out >5px regressions occur"
    elif broad_small:
        relevance = "teacher-only unless distilled/gated; zero >5px but broad small regressions remain"
    else:
        relevance = "passes required zero >5px and small-regression screen in this two-session test"
    return {
        "id": id_,
        "family": family,
        "description": description,
        "selected_parameters": selected_parameters,
        "training_summary": training_summary,
        "direct_product_relevance": relevance,
        "train_block": compact_eval(train_eval, include_breakdowns=False),
        "validation_block": compact_eval(val_eval, include_breakdowns=False),
        "heldout": compact_eval(heldout_eval, include_breakdowns=True),
    }


def make_fold(
    rows: list[dict[str, Any]],
    train_session: str,
    eval_session: str,
    args: argparse.Namespace,
    device: torch.device,
    fold_index: int,
    total_trainings: int,
    run_start: float,
) -> dict[str, Any]:
    train_rows = split_session(rows, train_session)
    eval_rows = split_session(rows, eval_session)
    fit_rows, validation_rows = split_fit_validation(train_rows)
    feature_builder = FeatureBuilder(fit_rows)
    sequence_builder = SequenceBuilder(fit_rows, SEQUENCE_LENGTH)
    fit = make_design(fit_rows, feature_builder, sequence_builder)
    validation = make_design(validation_rows, feature_builder, sequence_builder)
    heldout = make_design(eval_rows, feature_builder, sequence_builder)

    models: list[dict[str, Any]] = []
    models.append(
        add_model_evaluation(
            id_="current_dwm_aware_last2_gain_0_75",
            family="current_baseline",
            description="Current DWM-aware last-two-sample predictor with gain 0.75.",
            trained=None,
            train=fit,
            validation=validation,
            heldout=heldout,
            device=device,
            batch_size=args.batch_size,
            cap_px=None,
            selected_parameters={"gain": BASELINE_GAIN},
        )
    )

    scalar_dim = fit["scalar"].shape[1]
    seq_dim = fit["seq"].shape[2]
    specs = [
        {
            "stem": "cuda_mlp_residual_h128_h64_h32",
            "family": "residual_mlp",
            "guard_family": "residual_mlp_guarded",
            "description": "CUDA residual MLP over causal scalar last2/timing/bin features.",
            "factory": lambda: ResidualMLP(scalar_dim),
            "lr": 1.3e-3,
            "drop_rate": 0.0,
            "drop_steps": 0,
        },
        {
            "stem": "cuda_gru_residual_seq8_h64",
            "family": "gru",
            "guard_family": "gru_guarded",
            "description": "CUDA GRU over 8-step masked causal history plus scalar timing features.",
            "factory": lambda: SequenceGRU(scalar_dim, seq_dim),
            "lr": 1.0e-3,
            "drop_rate": HISTORY_DROPOUT_RATE,
            "drop_steps": HISTORY_DROPOUT_MAX_STEPS,
        },
        {
            "stem": "cuda_tcn_residual_seq8_c32",
            "family": "tcn",
            "guard_family": "tcn_guarded",
            "description": "CUDA causal Conv1D/TCN over 8-step masked history plus scalar timing features.",
            "factory": lambda: SequenceTCN(scalar_dim, seq_dim),
            "lr": 1.0e-3,
            "drop_rate": HISTORY_DROPOUT_RATE,
            "drop_steps": HISTORY_DROPOUT_MAX_STEPS,
        },
    ]

    per_model_budget = max(20.0, args.max_seconds / max(1, total_trainings))
    for model_index, spec in enumerate(specs):
        seed = args.seed + fold_index * 100 + model_index
        deadline = min(run_start + args.max_seconds, time.perf_counter() + per_model_budget)
        trained = train_model(
            spec["factory"](),
            fit,
            validation,
            device,
            seed=seed,
            batch_size=args.batch_size,
            epochs=args.epochs,
            lr=spec["lr"],
            weight_decay=2.0e-5,
            min_epochs=min(16, args.epochs),
            patience=12,
            history_dropout_rate=spec["drop_rate"],
            history_dropout_max_steps=spec["drop_steps"],
            deadline=deadline,
        )
        raw_params = {
            "mode": "residual",
            "capPx": None,
            "epochs": trained["training"]["actual_epochs"],
            "requested_epochs": args.epochs,
            "batch_size": args.batch_size,
            "lr": spec["lr"],
            "seed": seed,
            "uses_cuda": device.type == "cuda",
            "history_dropout_rate": spec["drop_rate"],
            "history_dropout_max_steps": spec["drop_steps"],
        }
        models.append(
            add_model_evaluation(
                id_=spec["stem"],
                family=spec["family"],
                description=spec["description"],
                trained=trained,
                train=fit,
                validation=validation,
                heldout=heldout,
                device=device,
                batch_size=args.batch_size,
                cap_px=None,
                selected_parameters=raw_params,
            )
        )
        guarded = select_guarded_variant(trained, validation, device, args.batch_size)
        guarded_params = dict(raw_params)
        guarded_params["capPx"] = guarded["capPx"]
        models.append(
            add_model_evaluation(
                id_=f"{spec['stem']}_guarded",
                family=spec["guard_family"],
                description=spec["description"] + " Validation-selected correction cap.",
                trained=trained,
                train=fit,
                validation=validation,
                heldout=heldout,
                device=device,
                batch_size=args.batch_size,
                cap_px=guarded["capPx"],
                selected_parameters=guarded_params,
            )
        )

    return {
        "foldId": f"train_{train_session}_eval_{eval_session}",
        "train_session": train_session,
        "eval_session": eval_session,
        "split_counts": {
            "train_session_total": len(train_rows),
            "fit_first_70pct": len(fit_rows),
            "validation_last_30pct": len(validation_rows),
            "heldout_session": len(eval_rows),
        },
        "feature_count": len(feature_builder.feature_names),
        "feature_names": feature_builder.feature_names,
        "sequence_length": sequence_builder.sequence_length,
        "sequence_feature_count": len(sequence_builder.feature_names),
        "sequence_feature_names": sequence_builder.feature_names,
        "models": models,
    }


def aggregate_results(folds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = sorted({model["id"] for fold in folds for model in fold["models"]})
    aggregate: list[dict[str, Any]] = []
    for id_ in ids:
        per_fold = [next(model for model in fold["models"] if model["id"] == id_) for fold in folds]
        first = per_fold[0]
        entry = {
            "id": id_,
            "fold_count": len(per_fold),
            "family": first["family"],
            "mean_delta_mean_px": float(np.mean([model["heldout"]["delta_vs_current"]["mean_px"] for model in per_fold])),
            "mean_delta_rmse_px": float(np.mean([model["heldout"]["delta_vs_current"]["rmse_px"] for model in per_fold])),
            "mean_delta_p95_px": float(np.mean([model["heldout"]["delta_vs_current"]["p95_px"] for model in per_fold])),
            "mean_delta_p99_px": float(np.mean([model["heldout"]["delta_vs_current"]["p99_px"] for model in per_fold])),
            "mean_heldout_p99_px": float(np.mean([model["heldout"]["overall"]["p99_px"] for model in per_fold])),
            "total_worse_over_1px": int(sum(model["heldout"]["regressions_vs_current"]["worse_over_1px"] for model in per_fold)),
            "total_worse_over_3px": int(sum(model["heldout"]["regressions_vs_current"]["worse_over_3px"] for model in per_fold)),
            "total_worse_over_5px": int(sum(model["heldout"]["regressions_vs_current"]["worse_over_5px"] for model in per_fold)),
            "total_better_over_1px": int(sum(model["heldout"]["regressions_vs_current"]["better_over_1px"] for model in per_fold)),
            "total_better_over_3px": int(sum(model["heldout"]["regressions_vs_current"]["better_over_3px"] for model in per_fold)),
            "total_better_over_5px": int(sum(model["heldout"]["regressions_vs_current"]["better_over_5px"] for model in per_fold)),
            "parameter_count": first["training_summary"]["parameter_count"] if first.get("training_summary") else 1,
            "training_elapsed_sec": float(
                sum(model["training_summary"]["elapsed_sec"] for model in per_fold if model.get("training_summary"))
            ),
            "direct_product_relevance": first["direct_product_relevance"],
            "fold_deltas": [
                {
                    "delta_mean_px": model["heldout"]["delta_vs_current"]["mean_px"],
                    "delta_rmse_px": model["heldout"]["delta_vs_current"]["rmse_px"],
                    "delta_p95_px": model["heldout"]["delta_vs_current"]["p95_px"],
                    "delta_p99_px": model["heldout"]["delta_vs_current"]["p99_px"],
                    "worse_over_1px": model["heldout"]["regressions_vs_current"]["worse_over_1px"],
                    "worse_over_3px": model["heldout"]["regressions_vs_current"]["worse_over_3px"],
                    "worse_over_5px": model["heldout"]["regressions_vs_current"]["worse_over_5px"],
                }
                for model in per_fold
            ],
        }
        if entry["total_worse_over_5px"] > 0:
            entry["direct_product_relevance"] = "teacher-only / not directly shippable because held-out >5px regressions occur"
        elif entry["total_worse_over_3px"] > 0 or entry["total_worse_over_1px"] > 500:
            entry["direct_product_relevance"] = "teacher-only unless distilled/gated; zero >5px but broad small regressions remain"
        else:
            entry["direct_product_relevance"] = "passes required zero >5px and small-regression screen in this two-session test"
        aggregate.append(entry)
    aggregate.sort(key=lambda entry: (entry["total_worse_over_5px"], entry["mean_heldout_p99_px"]))
    return aggregate


def load_phase7_best(root: Path) -> dict[str, Any] | None:
    path = root / "phase-7 deep-teacher" / "scores.json"
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as handle:
        scores = json.load(handle)
    selected = scores.get("recommendation", {}).get("selected")
    return selected or scores.get("recommendation", {}).get("best_zero_visible_regression_deep_teacher")


def select_recommendation(aggregate: list[dict[str, Any]], phase7_best: dict[str, Any] | None) -> dict[str, Any]:
    learned = [entry for entry in aggregate if entry["id"] != "current_dwm_aware_last2_gain_0_75"]
    current = next(entry for entry in aggregate if entry["id"] == "current_dwm_aware_last2_gain_0_75")
    best_raw = min(learned, key=lambda entry: entry["mean_heldout_p99_px"]) if learned else None
    zero_visible = [entry for entry in learned if entry["total_worse_over_5px"] == 0 and entry["mean_delta_p99_px"] < 0.0]
    best_zero_visible = min(zero_visible, key=lambda entry: entry["mean_heldout_p99_px"]) if zero_visible else None
    strict = [
        entry
        for entry in zero_visible
        if entry["total_worse_over_3px"] == 0
        and entry["total_worse_over_1px"] == 0
        and entry["mean_delta_p95_px"] <= 0.05
    ]
    best_strict = min(strict, key=lambda entry: entry["mean_heldout_p99_px"]) if strict else None
    phase7_delta = phase7_best.get("mean_delta_p99_px") if phase7_best else None
    material_vs_phase7 = (
        best_zero_visible is not None
        and phase7_delta is not None
        and best_zero_visible["mean_delta_p99_px"] <= float(phase7_delta) - 0.25
    )
    if best_strict is not None:
        category = "product-worthy predictor"
        selected = best_strict
        summary = f"{best_strict['id']} is the only class of result that clears zero >1/>3/>5 regressions while improving p99."
    elif best_zero_visible is not None and material_vs_phase7:
        category = "teacher worth distilling"
        selected = best_zero_visible
        summary = f"{best_zero_visible['id']} improves p99 materially beyond Phase 7 but remains teacher-only due to small regressions."
    elif best_zero_visible is not None:
        category = "no material change"
        selected = best_zero_visible
        summary = f"{best_zero_visible['id']} has a p99 teacher signal, but it does not materially beat the Phase 7 guarded TCN conclusion."
    else:
        category = "no material change"
        selected = current
        summary = "No CUDA model cleared the zero >5px plus p99-improvement screen."
    return {
        "rule": "Product relevance requires zero >5px regressions; zero >1/>3 plus p95/p99 improvement is the strict direct-shipping screen. Material GPU change requires the best zero-visible CUDA teacher to beat Phase 7 p99 by at least 0.25px.",
        "category": category,
        "summary": summary,
        "current": current,
        "phase7_best": phase7_best,
        "best_raw_learned_by_mean_p99": best_raw,
        "best_zero_visible_cuda_teacher": best_zero_visible,
        "best_strict_product_candidate": best_strict,
        "selected": selected,
        "material_change_vs_phase7": bool(material_vs_phase7),
    }


def fmt(value: Any, digits: int = 3) -> str:
    if value is None:
        return ""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    return f"{number:,.{digits}f}"


def fmt_int(value: Any) -> str:
    if value is None:
        return ""
    return f"{int(round(float(value))):,}"


def table(headers: list[str], rows: list[list[str]]) -> str:
    return "\n".join(
        [
            "| " + " | ".join(headers) + " |",
            "| " + " | ".join("---" for _ in headers) + " |",
            *["| " + " | ".join(row) + " |" for row in rows],
        ]
    )


def generate_report(scores: dict[str, Any]) -> str:
    env = scores["environment"]
    dataset = scores["dataset"]
    heldout_rows = []
    for fold in scores["cross_validation"]:
        for model in fold["models"]:
            held = model["heldout"]
            delta = held["delta_vs_current"]
            reg = held["regressions_vs_current"]
            params = model["training_summary"]["parameter_count"] if model.get("training_summary") else 1
            sec = model["training_summary"]["elapsed_sec"] if model.get("training_summary") else 0.0
            heldout_rows.append(
                [
                    fold["foldId"],
                    model["id"],
                    f"{fmt(held['overall']['mean_px'])} / {fmt(held['overall']['rmse_px'])} / {fmt(held['overall']['p95_px'])} / {fmt(held['overall']['p99_px'])}",
                    f"{fmt(delta['mean_px'])} / {fmt(delta['rmse_px'])} / {fmt(delta['p95_px'])} / {fmt(delta['p99_px'])}",
                    fmt_int(reg["worse_over_1px"]),
                    fmt_int(reg["worse_over_3px"]),
                    fmt_int(reg["worse_over_5px"]),
                    fmt_int(params),
                    fmt(sec, 2),
                ]
            )

    agg_rows = [
        [
            entry["id"],
            fmt(entry["mean_delta_mean_px"]),
            fmt(entry["mean_delta_rmse_px"]),
            fmt(entry["mean_delta_p95_px"]),
            fmt(entry["mean_delta_p99_px"]),
            fmt_int(entry["total_worse_over_1px"]),
            fmt_int(entry["total_worse_over_3px"]),
            fmt_int(entry["total_worse_over_5px"]),
            entry["direct_product_relevance"],
        ]
        for entry in scores["aggregate"]
    ]

    phase7 = scores["prior_phase_context"]["phase7_best"]
    compare_rows = []
    if phase7:
        compare_rows.append(
            [
                "Phase 7 best",
                phase7["id"],
                fmt(phase7["mean_delta_p99_px"]),
                fmt_int(phase7["total_worse_over_1px"]),
                fmt_int(phase7["total_worse_over_3px"]),
                fmt_int(phase7["total_worse_over_5px"]),
            ]
        )
    selected = scores["recommendation"]["selected"]
    if selected:
        compare_rows.append(
            [
                "Phase 8 selected",
                selected["id"],
                fmt(selected["mean_delta_p99_px"]),
                fmt_int(selected["total_worse_over_1px"]),
                fmt_int(selected["total_worse_over_3px"]),
                fmt_int(selected["total_worse_over_5px"]),
            ]
        )

    best = scores["recommendation"]["best_zero_visible_cuda_teacher"] or scores["recommendation"]["best_raw_learned_by_mean_p99"]
    speed_rows = []
    if best:
        best_id = best["id"]
        for fold in scores["cross_validation"]:
            model = next((item for item in fold["models"] if item["id"] == best_id), None)
            if not model:
                continue
            for speed_bin, bucket in model["heldout"]["breakdowns"]["speed_bins"].items():
                stats = bucket["stats"]
                reg = bucket["regressions_vs_current"]
                speed_rows.append(
                    [
                        fold["foldId"],
                        speed_bin,
                        fmt_int(stats["n"]),
                        fmt(stats["mean_px"]),
                        fmt(stats["p95_px"]),
                        fmt(stats["p99_px"]),
                        fmt_int(reg["worse_over_1px"]),
                        fmt_int(reg["worse_over_3px"]),
                        fmt_int(reg["worse_over_5px"]),
                    ]
                )

    training_rows = []
    for fold in scores["cross_validation"]:
        for model in fold["models"]:
            training = model.get("training_summary")
            if not training:
                continue
            training_rows.append(
                [
                    fold["foldId"],
                    model["id"],
                    fmt_int(training["parameter_count"]),
                    f"{training['actual_epochs']} / {training['requested_epochs']}",
                    fmt(training["elapsed_sec"], 2),
                    "yes" if training["stopped_early"] else "",
                    training["stopped_early_reason"] or "",
                ]
            )

    cap_rows = []
    for fold in scores["cross_validation"]:
        for model in fold["models"]:
            if not model["id"].endswith("_guarded"):
                continue
            validation = model["validation_block"]
            delta = validation["delta_vs_current"]
            reg = validation["regressions_vs_current"]
            cap_rows.append(
                [
                    fold["foldId"],
                    model["id"],
                    fmt(model["selected_parameters"].get("capPx")),
                    f"{fmt(delta['mean_px'])} / {fmt(delta['p95_px'])} / {fmt(delta['p99_px'])}",
                    fmt_int(reg["worse_over_1px"]),
                    fmt_int(reg["worse_over_3px"]),
                    fmt_int(reg["worse_over_5px"]),
                ]
            )

    return f"""# Phase 8 - Torch CUDA Teacher

## Setup

CUDA PyTorch was used from the local venv. `torch.cuda.is_available()` returned `{env['torch_cuda_available']}`.

Device: `{env['device']}`. Torch: `{env['torch_version']}`. CUDA runtime: `{env['torch_cuda_version']}`.

Dataset rows: {fmt_int(dataset['rows'])} across sessions {', '.join(f"{key}: {fmt_int(value)}" for key, value in dataset['sessions'].items())}.

The run kept tensors, features, and weights in memory only. It did not write checkpoints, torch.save outputs, cached feature matrices, TensorBoard logs, generated datasets, or compiler caches.

## Feature And Split Policy

Models used causal anchor-time inputs only: anchor position, last-two motion deltas/velocity/acceleration proxies, target horizon, DWM availability, scheduler lead, speed/horizon/lead bins, and an 8-step masked history ending at the current anchor for sequence models.

Excluded from model inputs: label coordinates except as training targets, future reference fields, target reference indices, reference nearest distance, source ZIP, and session ID. Session ID was used only to build the required cross-session split and causal same-session history.

Each direction fit on the first 70% chronological block of one session, selected caps on that session's last 30%, then evaluated the other full session.

## Held-Out Cross-Session Results

{table(['fold', 'model', 'mean/rmse/p95/p99', 'delta mean/rmse/p95/p99', '>1 worse', '>3 worse', '>5 worse', 'params', 'train sec'], heldout_rows)}

## Aggregate

{table(['model', 'delta mean', 'delta rmse', 'delta p95', 'delta p99', 'total >1 worse', 'total >3 worse', 'total >5 worse', 'product relevance'], agg_rows)}

## Validation-Selected Caps

{table(['fold', 'guarded model', 'cap px', 'validation delta mean/p95/p99', 'validation >1 worse', 'validation >3 worse', 'validation >5 worse'], cap_rows)}

## Phase 7 Comparison

{table(['source', 'model', 'mean delta p99', 'total >1 worse', 'total >3 worse', 'total >5 worse'], compare_rows)}

## Training Cost

{table(['fold', 'model', 'params', 'epochs', 'seconds', 'early stop', 'reason'], training_rows)}

## Speed-Bin Breakdown For Best CUDA Teacher

{table(['fold', 'speed bin', 'n', 'mean', 'p95', 'p99', '>1 worse', '>3 worse', '>5 worse'], speed_rows)}

## Recommendation

Category: `{scores['recommendation']['category']}`.

{scores['recommendation']['summary']}
"""


def generate_log(scores: dict[str, Any], args: argparse.Namespace) -> str:
    env = scores["environment"]
    return f"""# Phase 8 Experiment Log

- Created `run_torch_cuda_teacher.py` under `phase-8 torch-cuda-teacher/`.
- Launched with local venv Python: `{sys.executable}`.
- Confirmed CUDA: `{env['torch_cuda_available']}`, device `{env['device']}`, torch `{env['torch_version']}`, CUDA `{env['torch_cuda_version']}`.
- Used dataset `{args.dataset}` and prior Phase 7 score context.
- Trained residual MLP, GRU, and causal Conv1D/TCN variants on both cross-session directions.
- Used missing-history augmentation for sequence models at {HISTORY_DROPOUT_RATE:.2f} rate, masking up to {HISTORY_DROPOUT_MAX_STEPS} older history steps.
- Selected guarded caps only on validation blocks: {', '.join(str(cap) for cap in GUARD_CAPS_PX)} px.
- Wrote final compact artifacts only: `scores.json`, `report.md`, and `experiment-log.md`.
- Total elapsed seconds: {scores['performance']['elapsed_sec']:.2f}.
"""


def inspect_environment(device: torch.device) -> dict[str, Any]:
    info = {
        "python": sys.executable,
        "torch_version": torch.__version__,
        "torch_cuda_available": bool(torch.cuda.is_available()),
        "torch_cuda_version": torch.version.cuda,
        "device": str(device),
        "cuda_device_name": torch.cuda.get_device_name(device) if device.type == "cuda" else None,
    }
    if device.type == "cuda":
        props = torch.cuda.get_device_properties(device)
        info["cuda_device_total_memory_mib"] = int(props.total_memory // (1024 * 1024))
        info["cuda_capability"] = f"{props.major}.{props.minor}"
    return info


def dataset_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    sessions = Counter(str(row["sessionId"]) for row in rows)
    return {
        "rows": len(rows),
        "sessions": dict(sorted(sessions.items())),
        "speed_bins": dict(sorted(Counter(row.get("speedBin") or "missing" for row in rows).items())),
        "horizon_bins": dict(sorted(Counter(row.get("horizonBin") or "missing" for row in rows).items())),
        "scheduler_lead_bins": dict(sorted(Counter(row.get("schedulerLeadBin") or "missing" for row in rows).items())),
        "numeric_summaries": {
            "targetHorizonMs": scalar_stats([finite(row.get("targetHorizonMs")) for row in rows]),
            "dtMs": scalar_stats([finite(row.get("dtMs"), float("nan")) for row in rows]),
            "speedPxS": scalar_stats([finite(row.get("speedPxS")) for row in rows]),
            "accelerationPxS2": scalar_stats([finite(row.get("accelerationPxS2")) for row in rows]),
            "schedulerLeadUs": scalar_stats([finite(row.get("schedulerLeadUs")) for row in rows]),
        },
    }


def main() -> None:
    args = parse_args()
    started = time.perf_counter()
    args.out.mkdir(parents=True, exist_ok=True)
    if not torch.cuda.is_available():
        raise RuntimeError("torch.cuda.is_available() returned False; Phase 8 requires the CUDA venv.")
    device = torch.device("cuda")
    torch.set_float32_matmul_precision("high")
    set_seeds(args.seed)

    rows = read_jsonl(args.dataset)
    annotate_session_history(rows)
    sessions = sorted({str(row["sessionId"]) for row in rows})
    if len(sessions) != 2:
        raise RuntimeError(f"Expected exactly two sessions, found {sessions}")

    phase7_best = load_phase7_best(args.root)
    folds = [
        make_fold(rows, sessions[0], sessions[1], args, device, 0, 6, started),
        make_fold(rows, sessions[1], sessions[0], args, device, 1, 6, started),
    ]
    aggregate = aggregate_results(folds)
    scores = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "phase": "phase-8 torch-cuda-teacher",
        "config": {
            "current_baseline": "current_dwm_aware_last2_gain_0_75",
            "baseline_gain": BASELINE_GAIN,
            "regression_thresholds_px": list(REGRESSION_THRESHOLDS),
            "guarded_correction_caps_px": list(GUARD_CAPS_PX),
            "sequence_length": SEQUENCE_LENGTH,
            "history_dropout_rate": HISTORY_DROPOUT_RATE,
            "history_dropout_max_steps": HISTORY_DROPOUT_MAX_STEPS,
            "batch_size": args.batch_size,
            "epochs": args.epochs,
            "training_policy": "Fit on first 70% chronological block of train session, select guarded caps on last 30% validation block, evaluate full held-out session; run both directions.",
            "feature_policy": "Causal anchor-time features only; excludes labels as inputs, future reference fields, target reference indices, reference nearest distance, source ZIP, and session ID.",
            "no_disk_intermediates": True,
        },
        "environment": inspect_environment(device),
        "dataset_path": str(args.dataset.relative_to(args.root) if args.dataset.is_relative_to(args.root) else args.dataset),
        "dataset": dataset_summary(rows),
        "prior_phase_context": {"phase7_best": phase7_best},
        "cross_validation": folds,
        "aggregate": aggregate,
        "recommendation": select_recommendation(aggregate, phase7_best),
        "performance": {"elapsed_sec": float(time.perf_counter() - started)},
    }
    write_json(args.out / "scores.json", scores)
    write_text(args.out / "report.md", generate_report(scores))
    write_text(args.out / "experiment-log.md", generate_log(scores, args))


if __name__ == "__main__":
    main()
