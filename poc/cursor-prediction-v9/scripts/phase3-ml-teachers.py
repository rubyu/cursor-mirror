#!/usr/bin/env python3
"""Phase 3 ML teacher search for Cursor Prediction v9.

This script keeps all datasets and models in memory. It writes only compact
JSON/Markdown summaries and does not write checkpoints, tensorboard logs, or
dataset caches.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import io
import json
import math
import random
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


TRACE_FILES = [
    "cursor-mirror-trace-20260502-175951.zip",
    "cursor-mirror-trace-20260502-184947.zip",
]
HORIZONS_MS = [4.0, 8.0, 12.0, 16.67]
SPEED_BINS = [
    ("0-25", 0.0, 25.0),
    ("25-100", 25.0, 100.0),
    ("100-250", 100.0, 250.0),
    ("250-500", 250.0, 500.0),
    ("500-1000", 500.0, 1000.0),
    ("1000-2000", 1000.0, 2000.0),
    (">=2000", 2000.0, float("inf")),
]


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    root = script_dir.parents[2]
    out_dir = script_dir.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-json", type=Path, default=out_dir / "phase-3-ml-teachers.json")
    parser.add_argument("--out-md", type=Path, default=out_dir / "phase-3-ml-teachers.md")
    parser.add_argument("--seed", type=int, default=20260503)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--epochs", type=int, default=3)
    return parser.parse_args()


def number_or_none(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except ValueError:
        return None
    return result if math.isfinite(result) else None


def bool_value(value: str | None) -> bool:
    return value in {"true", "True", "1", True}


def speed_bin(value: float) -> str:
    for label, lo, hi in SPEED_BINS:
        if lo <= value < hi:
            return label
    return "missing"


def distance(ax: np.ndarray, ay: np.ndarray, bx: np.ndarray, by: np.ndarray) -> np.ndarray:
    return np.sqrt((ax - bx) ** 2 + (ay - by) ** 2)


def percentile(sorted_values: np.ndarray, p: float) -> float | None:
    if sorted_values.size == 0:
        return None
    return float(np.percentile(sorted_values, p * 100.0, method="linear"))


def metric_stats(values: np.ndarray) -> dict[str, Any]:
    data = np.asarray(values, dtype=np.float64)
    data = data[np.isfinite(data)]
    if data.size == 0:
        return {"count": 0, "mean": None, "rmse": None, "p50": None, "p90": None, "p95": None, "p99": None, "max": None}
    return {
        "count": int(data.size),
        "mean": float(data.mean()),
        "rmse": float(np.sqrt(np.mean(data * data))),
        "p50": float(np.percentile(data, 50, method="linear")),
        "p90": float(np.percentile(data, 90, method="linear")),
        "p95": float(np.percentile(data, 95, method="linear")),
        "p99": float(np.percentile(data, 99, method="linear")),
        "max": float(data.max()),
    }


def clamp_displacement(dx: float, dy: float, cap: float) -> tuple[float, float]:
    mag = math.hypot(dx, dy)
    if not math.isfinite(cap) or cap <= 0 or mag <= cap or mag == 0:
        return dx, dy
    scale = cap / mag
    return dx * scale, dy * scale


@dataclass
class Trace:
    session_id: str
    source_zip: str
    metadata: dict[str, Any]
    event_counts: dict[str, int]
    ref_t: np.ndarray
    ref_x: np.ndarray
    ref_y: np.ndarray
    anchors_us: np.ndarray


@dataclass
class Dataset:
    session_id: str
    source_zip: str
    seq: np.ndarray
    ctx: np.ndarray
    tab: np.ndarray
    residual: np.ndarray
    target: np.ndarray
    baseline: np.ndarray
    baseline_error: np.ndarray
    speed_bins: np.ndarray
    horizons: np.ndarray
    summary: dict[str, Any]


def load_trace(root: Path, file_name: str, session_id: str) -> Trace:
    zip_path = root / file_name
    with zipfile.ZipFile(zip_path) as zf:
        metadata = json.loads(zf.read("metadata.json").decode("utf-8-sig"))
        text_stream = io.TextIOWrapper(zf.open("trace.csv"), encoding="utf-8-sig", newline="")
        reader = csv.DictReader(text_stream)
        event_counts: dict[str, int] = {}
        ref_t: list[float] = []
        ref_x: list[float] = []
        ref_y: list[float] = []
        anchors_us: list[float] = []
        for row in reader:
            event = row.get("event", "")
            event_counts[event] = event_counts.get(event, 0) + 1
            elapsed = number_or_none(row.get("elapsedMicroseconds"))
            if elapsed is None:
                continue
            x = number_or_none(row.get("cursorX")) or number_or_none(row.get("x"))
            y = number_or_none(row.get("cursorY")) or number_or_none(row.get("y"))
            if x is None or y is None:
                continue
            if event == "referencePoll":
                ref_t.append(elapsed)
                ref_x.append(x)
                ref_y.append(y)
            elif event == "runtimeSelfSchedulerPoll" and bool_value(row.get("dwmTimingAvailable")):
                anchors_us.append(elapsed)
    return Trace(
        session_id=session_id,
        source_zip=file_name,
        metadata=metadata,
        event_counts=event_counts,
        ref_t=np.asarray(ref_t, dtype=np.float64),
        ref_x=np.asarray(ref_x, dtype=np.float32),
        ref_y=np.asarray(ref_y, dtype=np.float32),
        anchors_us=np.asarray(anchors_us, dtype=np.float64),
    )


def interpolate_ref(trace: Trace, target_us: float) -> tuple[float, float] | None:
    right = bisect.bisect_left(trace.ref_t, target_us)
    if right <= 0 or right >= trace.ref_t.size:
        return None
    left = right - 1
    t0 = trace.ref_t[left]
    t1 = trace.ref_t[right]
    if t1 <= t0:
        return None
    frac = (target_us - t0) / (t1 - t0)
    x = float(trace.ref_x[left] + (trace.ref_x[right] - trace.ref_x[left]) * frac)
    y = float(trace.ref_y[left] + (trace.ref_y[right] - trace.ref_y[left]) * frac)
    return x, y


def recent_kinematics(trace: Trace, ref_index: int) -> tuple[float, float, float, float]:
    if ref_index <= 0:
        return 0.0, 0.0, 0.0, 0.0
    dt = (trace.ref_t[ref_index] - trace.ref_t[ref_index - 1]) / 1_000_000.0
    if dt <= 0:
        return 0.0, 0.0, 0.0, 0.0
    vx = float((trace.ref_x[ref_index] - trace.ref_x[ref_index - 1]) / dt)
    vy = float((trace.ref_y[ref_index] - trace.ref_y[ref_index - 1]) / dt)
    return vx, vy, math.hypot(vx, vy), dt * 1000.0


def path_features(trace: Trace, ref_index: int, window_ms: float = 72.0) -> tuple[float, int]:
    start_time = trace.ref_t[ref_index] - window_ms * 1000.0
    start = max(0, bisect.bisect_left(trace.ref_t, start_time))
    if ref_index - start < 1:
        return 0.0, 0
    net = math.hypot(float(trace.ref_x[ref_index] - trace.ref_x[start]), float(trace.ref_y[ref_index] - trace.ref_y[start]))
    path = 0.0
    reversals = 0
    last_sx = 0
    last_sy = 0
    for i in range(start + 1, ref_index + 1):
        dx = float(trace.ref_x[i] - trace.ref_x[i - 1])
        dy = float(trace.ref_y[i] - trace.ref_y[i - 1])
        path += math.hypot(dx, dy)
        sx = 1 if dx > 0 else -1 if dx < 0 else 0
        sy = 1 if dy > 0 else -1 if dy < 0 else 0
        if sx and last_sx and sx != last_sx:
            reversals += 1
        if sy and last_sy and sy != last_sy:
            reversals += 1
        if sx:
            last_sx = sx
        if sy:
            last_sy = sy
    return (net / path if path > 0 else 0.0), reversals


def build_sequence(trace: Trace, ref_index: int, seq_len: int, current_x: float, current_y: float) -> np.ndarray:
    features = np.zeros((seq_len, 8), dtype=np.float32)
    start = max(0, ref_index - seq_len + 1)
    offset = seq_len - (ref_index - start + 1)
    prev_x = float(trace.ref_x[start])
    prev_y = float(trace.ref_y[start])
    prev_t = float(trace.ref_t[start])
    anchor_t = float(trace.ref_t[ref_index])
    for out_i, i in enumerate(range(start, ref_index + 1), start=offset):
        x = float(trace.ref_x[i])
        y = float(trace.ref_y[i])
        t = float(trace.ref_t[i])
        dt_ms = max(0.0, (t - prev_t) / 1000.0)
        dx = x - prev_x
        dy = y - prev_y
        vx = dx / (dt_ms / 1000.0) if dt_ms > 0 else 0.0
        vy = dy / (dt_ms / 1000.0) if dt_ms > 0 else 0.0
        age_ms = (anchor_t - t) / 1000.0
        features[out_i] = np.asarray([
            (x - current_x) / 500.0,
            (y - current_y) / 500.0,
            age_ms / 100.0,
            dx / 100.0,
            dy / 100.0,
            vx / 5000.0,
            vy / 5000.0,
            1.0,
        ], dtype=np.float32)
        prev_x, prev_y, prev_t = x, y, t
    return features


def product_baseline(current_x: float, current_y: float, vx: float, vy: float, speed: float, horizon_ms: float, efficiency: float, reversals: int) -> tuple[float, float]:
    h = min(horizon_ms, 10.0) / 1000.0
    dx = vx * h
    dy = vy * h
    cap = 24.0 if speed >= 2000.0 and efficiency >= 0.85 and reversals == 0 else 12.0
    dx, dy = clamp_displacement(dx, dy, cap)
    return current_x + dx, current_y + dy


def build_dataset(trace: Trace, seq_len: int = 16) -> Dataset:
    seq_rows: list[np.ndarray] = []
    ctx_rows: list[list[float]] = []
    tab_rows: list[np.ndarray] = []
    residual_rows: list[list[float]] = []
    target_rows: list[list[float]] = []
    baseline_rows: list[list[float]] = []
    speed_bins: list[str] = []
    horizons: list[float] = []
    labels_missing = 0
    insufficient_history = 0
    rows_by_horizon = {str(h): 0 for h in HORIZONS_MS}
    rows_by_speed_bin: dict[str, int] = {}

    for anchor_us in trace.anchors_us:
        ref_index = bisect.bisect_right(trace.ref_t, anchor_us) - 1
        if ref_index < 4:
            insufficient_history += 1
            continue
        current_x = float(trace.ref_x[ref_index])
        current_y = float(trace.ref_y[ref_index])
        vx, vy, speed, _ = recent_kinematics(trace, ref_index)
        efficiency, reversals = path_features(trace, ref_index)
        seq = build_sequence(trace, ref_index, seq_len, current_x, current_y)
        bin_label = speed_bin(speed)
        for horizon_ms in HORIZONS_MS:
            target = interpolate_ref(trace, anchor_us + horizon_ms * 1000.0)
            if target is None:
                labels_missing += 1
                continue
            base_x, base_y = product_baseline(current_x, current_y, vx, vy, speed, horizon_ms, efficiency, reversals)
            baseline_dx = base_x - current_x
            baseline_dy = base_y - current_y
            baseline_disp = math.hypot(baseline_dx, baseline_dy)
            ctx = [
                horizon_ms / 16.67,
                vx / 5000.0,
                vy / 5000.0,
                speed / 5000.0,
                efficiency,
                min(reversals, 5) / 5.0,
                baseline_dx / 24.0,
                baseline_dy / 24.0,
                baseline_disp / 24.0,
            ]
            seq_rows.append(seq)
            ctx_rows.append(ctx)
            tab_rows.append(np.concatenate([seq.reshape(-1), np.asarray(ctx, dtype=np.float32)]))
            residual_rows.append([(target[0] - base_x) / 50.0, (target[1] - base_y) / 50.0])
            target_rows.append([target[0], target[1]])
            baseline_rows.append([base_x, base_y])
            speed_bins.append(bin_label)
            horizons.append(horizon_ms)
            rows_by_horizon[str(horizon_ms)] += 1
            rows_by_speed_bin[bin_label] = rows_by_speed_bin.get(bin_label, 0) + 1

    target = np.asarray(target_rows, dtype=np.float32)
    baseline = np.asarray(baseline_rows, dtype=np.float32)
    baseline_error = distance(baseline[:, 0], baseline[:, 1], target[:, 0], target[:, 1]).astype(np.float32)
    return Dataset(
        session_id=trace.session_id,
        source_zip=trace.source_zip,
        seq=np.asarray(seq_rows, dtype=np.float32),
        ctx=np.asarray(ctx_rows, dtype=np.float32),
        tab=np.asarray(tab_rows, dtype=np.float32),
        residual=np.asarray(residual_rows, dtype=np.float32),
        target=target,
        baseline=baseline,
        baseline_error=baseline_error,
        speed_bins=np.asarray(speed_bins, dtype=object),
        horizons=np.asarray(horizons, dtype=np.float32),
        summary={
            "sourceZip": trace.source_zip,
            "referencePollCount": int(trace.ref_t.size),
            "anchorCount": int(trace.anchors_us.size),
            "rowsBuilt": len(target_rows),
            "labelsMissing": labels_missing,
            "insufficientHistory": insufficient_history,
            "rowsByHorizon": rows_by_horizon,
            "rowsBySpeedBin": rows_by_speed_bin,
            "qualityWarnings": trace.metadata.get("QualityWarnings", []),
        },
    )


def standardize(train: np.ndarray, other: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    mean = train.mean(axis=0, keepdims=True)
    std = train.std(axis=0, keepdims=True)
    std[std < 1e-6] = 1.0
    return (train - mean) / std, (other - mean) / std, {"meanShape": list(mean.shape), "stdMin": float(std.min()), "stdMax": float(std.max())}


def regression_counts(errors: np.ndarray, baseline_errors: np.ndarray) -> dict[str, Any]:
    delta = errors - baseline_errors
    return {
        "count": int(errors.size),
        "worseOver1px": int(np.sum(delta > 1.0)),
        "worseOver3px": int(np.sum(delta > 3.0)),
        "worseOver5px": int(np.sum(delta > 5.0)),
        "improvedOver1px": int(np.sum(delta < -1.0)),
        "meanDeltaPx": float(delta.mean()),
    }


def speed_breakdown(errors: np.ndarray, bins: np.ndarray) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for label, _, _ in SPEED_BINS:
        mask = bins == label
        if np.any(mask):
            result[label] = metric_stats(errors[mask])
    return result


def evaluate_prediction(dataset: Dataset, residual_px: np.ndarray, model_id: str, family: str, params: dict[str, Any], role: str, train_sec: float, inference_sec: float, param_count: int, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    pred = dataset.baseline + residual_px.astype(np.float32)
    errors = distance(pred[:, 0], pred[:, 1], dataset.target[:, 0], dataset.target[:, 1])
    throughput = float(errors.size / inference_sec) if inference_sec > 0 else None
    return {
        "id": model_id,
        "family": family,
        "role": role,
        "params": params,
        "paramCount": int(param_count),
        "trainSec": float(train_sec),
        "inferenceSec": float(inference_sec),
        "inferenceRowsPerSec": throughput,
        "latencyUsPerSample": float(1_000_000.0 / throughput) if throughput else None,
        "metrics": metric_stats(errors),
        "regressionsVsBaseline": regression_counts(errors, dataset.baseline_error),
        "speedBins": speed_breakdown(errors, dataset.speed_bins),
        "extra": extra or {},
        "_errors": errors,
    }


def tune_guard(train_residual_px: np.ndarray, train: Dataset) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    thresholds = [0.0, 2.0, 4.0, 8.0, 12.0, 16.0, 24.0, 36.0, float("inf")]
    mag = np.linalg.norm(train_residual_px, axis=1)
    for threshold in thresholds:
        gated = np.where((mag <= threshold)[:, None], train_residual_px, 0.0)
        pred = train.baseline + gated.astype(np.float32)
        errors = distance(pred[:, 0], pred[:, 1], train.target[:, 0], train.target[:, 1])
        regress = regression_counts(errors, train.baseline_error)
        stats = metric_stats(errors)
        score = stats["p95"] + 0.25 * stats["p99"] + 0.05 * stats["mean"] + 0.002 * regress["worseOver5px"]
        if best is None or score < best["score"]:
            best = {"thresholdPx": threshold, "score": score, "trainMetrics": stats, "trainRegressions": regress}
    assert best is not None
    return best


def apply_guard(residual_px: np.ndarray, threshold: float) -> np.ndarray:
    if threshold == float("inf"):
        return residual_px
    mag = np.linalg.norm(residual_px, axis=1)
    return np.where((mag <= threshold)[:, None], residual_px, 0.0)


def rfn_train_predict(train: Dataset, eval_ds: Dataset, seed: int) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    started = time.perf_counter()
    x_train, x_eval, norm = standardize(train.tab, eval_ds.tab)
    rng = np.random.default_rng(seed)
    random_features = 384
    w = rng.normal(0.0, 1.0 / math.sqrt(x_train.shape[1]), size=(x_train.shape[1], random_features)).astype(np.float32)
    b = rng.uniform(0.0, 2.0 * math.pi, size=(random_features,)).astype(np.float32)

    def transform(x: np.ndarray) -> np.ndarray:
        return math.sqrt(2.0 / random_features) * np.cos(x @ w + b)

    z_train = transform(x_train).astype(np.float32)
    y = train.residual.astype(np.float32)
    ridge = 1e-2
    lhs = z_train.T @ z_train + ridge * np.eye(random_features, dtype=np.float32)
    rhs = z_train.T @ y
    coef = np.linalg.solve(lhs, rhs).astype(np.float32)
    train_pred = (z_train @ coef) * 50.0
    train_sec = time.perf_counter() - started
    inf_started = time.perf_counter()
    eval_pred = (transform(x_eval).astype(np.float32) @ coef) * 50.0
    inference_sec = time.perf_counter() - inf_started
    meta = {
        "trainSec": train_sec,
        "inferenceSec": inference_sec,
        "paramCount": int(w.size + b.size + coef.size),
        "normalization": norm,
        "randomFeatures": random_features,
        "ridge": ridge,
    }
    return train_pred.astype(np.float32), eval_pred.astype(np.float32), meta


class MLPTeacher(nn.Module):
    def __init__(self, input_dim: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 2),
        )

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        return self.net(tab)


class CNNTeacher(nn.Module):
    def __init__(self, seq_dim: int, ctx_dim: int):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(seq_dim, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv1d(32, 48, kernel_size=3, padding=1),
            nn.ReLU(),
        )
        self.head = nn.Sequential(nn.Linear(48 + ctx_dim, 64), nn.ReLU(), nn.Linear(64, 2))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        x = seq.transpose(1, 2)
        h = self.conv(x).mean(dim=2)
        return self.head(torch.cat([h, ctx], dim=1))


class FSMNTeacher(nn.Module):
    def __init__(self, seq_dim: int, ctx_dim: int):
        super().__init__()
        self.proj = nn.Linear(seq_dim, 48)
        self.memory = nn.Conv1d(48, 48, kernel_size=5, groups=48)
        self.mix = nn.Linear(48, 48)
        self.head = nn.Sequential(nn.Linear(48 + ctx_dim, 64), nn.ReLU(), nn.Linear(64, 2))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        h = F.relu(self.proj(seq)).transpose(1, 2)
        mem = self.memory(F.pad(h, (4, 0)))
        h = F.relu(self.mix(mem.transpose(1, 2)))
        pooled = h[:, -1, :]
        return self.head(torch.cat([pooled, ctx], dim=1))


class CausalConv1d(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, kernel_size: int, dilation: int):
        super().__init__()
        self.pad = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(in_ch, out_ch, kernel_size=kernel_size, dilation=dilation)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv(F.pad(x, (self.pad, 0)))


class TCNTeacher(nn.Module):
    def __init__(self, seq_dim: int, ctx_dim: int):
        super().__init__()
        self.inp = nn.Conv1d(seq_dim, 48, kernel_size=1)
        self.blocks = nn.ModuleList([
            CausalConv1d(48, 48, 3, 1),
            CausalConv1d(48, 48, 3, 2),
            CausalConv1d(48, 48, 3, 4),
        ])
        self.head = nn.Sequential(nn.Linear(48 + ctx_dim, 64), nn.ReLU(), nn.Linear(64, 2))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        h = self.inp(seq.transpose(1, 2))
        for block in self.blocks:
            h = F.relu(block(h) + h)
        pooled = h[:, :, -1]
        return self.head(torch.cat([pooled, ctx], dim=1))


class RNNTeacher(nn.Module):
    def __init__(self, seq_dim: int, ctx_dim: int, kind: str):
        super().__init__()
        cls = nn.GRU if kind == "gru" else nn.LSTM
        self.rnn = cls(seq_dim, 64, num_layers=1, batch_first=True)
        self.head = nn.Sequential(nn.Linear(64 + ctx_dim, 64), nn.ReLU(), nn.Linear(64, 2))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        out, state = self.rnn(seq)
        if isinstance(state, tuple):
            h = state[0][-1]
        else:
            h = state[-1]
        return self.head(torch.cat([h, ctx], dim=1))


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def torch_predict(model: nn.Module, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor, batch_size: int, device: torch.device) -> tuple[np.ndarray, float]:
    model.eval()
    outputs: list[torch.Tensor] = []
    if device.type == "cuda":
        torch.cuda.synchronize()
    started = time.perf_counter()
    with torch.no_grad():
        for start in range(0, seq.shape[0], batch_size):
            end = min(start + batch_size, seq.shape[0])
            outputs.append(model(seq[start:end], ctx[start:end], tab[start:end]).detach().cpu())
    if device.type == "cuda":
        torch.cuda.synchronize()
    elapsed = time.perf_counter() - started
    return (torch.cat(outputs, dim=0).numpy().astype(np.float32) * 50.0), elapsed


def torch_train_predict(train: Dataset, eval_ds: Dataset, family: str, seed: int, epochs: int, batch_size: int, device: torch.device) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    torch.manual_seed(seed)
    np.random.seed(seed)
    train_tab, eval_tab, norm = standardize(train.tab, eval_ds.tab)
    seq_train = torch.from_numpy(train.seq).to(device)
    ctx_train = torch.from_numpy(train.ctx).to(device)
    tab_train = torch.from_numpy(train_tab.astype(np.float32)).to(device)
    y_train = torch.from_numpy(train.residual).to(device)
    seq_eval = torch.from_numpy(eval_ds.seq).to(device)
    ctx_eval = torch.from_numpy(eval_ds.ctx).to(device)
    tab_eval = torch.from_numpy(eval_tab.astype(np.float32)).to(device)

    if family == "mlp":
        model: nn.Module = MLPTeacher(tab_train.shape[1])
    elif family == "cnn1d":
        model = CNNTeacher(seq_train.shape[2], ctx_train.shape[1])
    elif family == "fsmn":
        model = FSMNTeacher(seq_train.shape[2], ctx_train.shape[1])
    elif family == "tcn":
        model = TCNTeacher(seq_train.shape[2], ctx_train.shape[1])
    elif family == "gru":
        model = RNNTeacher(seq_train.shape[2], ctx_train.shape[1], "gru")
    elif family == "lstm":
        model = RNNTeacher(seq_train.shape[2], ctx_train.shape[1], "lstm")
    else:
        raise ValueError(f"unknown torch family: {family}")
    model.to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_fn = nn.SmoothL1Loss(beta=0.2)
    losses: list[float] = []
    started = time.perf_counter()
    n = seq_train.shape[0]
    for _ in range(epochs):
        model.train()
        order = torch.randperm(n, device=device)
        running = 0.0
        steps = 0
        for start in range(0, n, batch_size):
            idx = order[start:start + batch_size]
            opt.zero_grad(set_to_none=True)
            pred = model(seq_train[idx], ctx_train[idx], tab_train[idx])
            loss = loss_fn(pred, y_train[idx])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            running += float(loss.detach().cpu())
            steps += 1
        losses.append(running / max(1, steps))
    if device.type == "cuda":
        torch.cuda.synchronize()
    train_sec = time.perf_counter() - started
    train_pred, _ = torch_predict(model, seq_train, ctx_train, tab_train, batch_size, device)
    eval_pred, inference_sec = torch_predict(model, seq_eval, ctx_eval, tab_eval, batch_size, device)
    meta = {
        "trainSec": train_sec,
        "inferenceSec": inference_sec,
        "paramCount": count_params(model),
        "losses": losses,
        "normalization": norm,
        "epochs": epochs,
        "device": str(device),
    }
    # Release GPU tensors promptly before the next model.
    del model, opt, seq_train, ctx_train, tab_train, y_train, seq_eval, ctx_eval, tab_eval
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return train_pred, eval_pred, meta


def evaluate_family(train: Dataset, eval_ds: Dataset, family: str, fold_seed: int, epochs: int, batch_size: int, device: torch.device) -> list[dict[str, Any]]:
    if family == "rfn":
        train_pred, eval_pred, meta = rfn_train_predict(train, eval_ds, fold_seed)
        base_id = "rfn_rff384_ridge_residual"
    else:
        train_pred, eval_pred, meta = torch_train_predict(train, eval_ds, family, fold_seed, epochs, batch_size, device)
        base_id = f"{family}_seq16_residual"
    train_sec = meta["trainSec"]
    inf_sec = meta["inferenceSec"]
    param_count = meta["paramCount"]
    unguarded = evaluate_prediction(eval_ds, eval_pred, base_id, family, meta, "unguarded_residual", train_sec, inf_sec, param_count)
    guard = tune_guard(train_pred, train)
    threshold = guard["thresholdPx"]
    guarded_pred = apply_guard(eval_pred, threshold)
    guarded_id = f"{base_id}_guarded_t{threshold if math.isfinite(threshold) else 'inf'}"
    guarded = evaluate_prediction(
        eval_ds,
        guarded_pred,
        guarded_id,
        family,
        {**meta, "guardThresholdPx": threshold},
        "guarded_residual",
        train_sec,
        inf_sec,
        param_count,
        {"guard": guard},
    )
    return [unguarded, guarded]


def baseline_evaluation(dataset: Dataset) -> dict[str, Any]:
    zero = np.zeros_like(dataset.baseline, dtype=np.float32)
    return evaluate_prediction(dataset, zero, "product_constant_velocity_v8_shape", "baseline", {}, "baseline", 0.0, 0.0, 0)


def compact(entry: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in entry.items() if k != "_errors"}


def run_fold(name: str, train: Dataset, eval_ds: Dataset, seed: int, epochs: int, batch_size: int, device: torch.device) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = [baseline_evaluation(eval_ds)]
    failures: list[dict[str, Any]] = []
    for offset, family in enumerate(["rfn", "mlp", "cnn1d", "fsmn", "tcn", "gru", "lstm"]):
        try:
            candidates.extend(evaluate_family(train, eval_ds, family, seed + offset * 101, epochs, batch_size, device))
        except Exception as exc:  # Record failures instead of losing the whole phase.
            failures.append({"family": family, "error": repr(exc)})
    candidates.sort(key=lambda item: (
        item["metrics"]["p95"] if item["metrics"]["p95"] is not None else float("inf"),
        item["metrics"]["p99"] if item["metrics"]["p99"] is not None else float("inf"),
        item["regressionsVsBaseline"]["worseOver5px"] if item["regressionsVsBaseline"] else 0,
    ))
    return {
        "name": name,
        "trainSession": train.session_id,
        "evalSession": eval_ds.session_id,
        "trainRows": int(train.target.shape[0]),
        "evalRows": int(eval_ds.target.shape[0]),
        "device": str(device),
        "failures": failures,
        "candidates": [compact(item) for item in candidates],
        "best": compact(candidates[0]),
    }


def md_table(headers: list[str], rows: list[list[str]]) -> str:
    return "\n".join([
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
        *["| " + " | ".join(row) + " |" for row in rows],
    ])


def fmt(value: Any, digits: int = 3) -> str:
    if value is None:
        return ""
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return str(value)


def render_markdown(result: dict[str, Any]) -> str:
    best_rows = []
    for fold in result["folds"]:
        best = fold["best"]
        best_rows.append([
            fold["name"],
            best["id"],
            best["family"],
            best["role"],
            fmt(best["metrics"]["mean"]),
            fmt(best["metrics"]["p95"]),
            fmt(best["metrics"]["p99"]),
            fmt(best["metrics"]["max"]),
            str(best["regressionsVsBaseline"]["worseOver1px"] if best["regressionsVsBaseline"] else 0),
            str(best["regressionsVsBaseline"]["worseOver5px"] if best["regressionsVsBaseline"] else 0),
        ])
    sections = []
    for fold in result["folds"]:
        rows = []
        for candidate in fold["candidates"][:10]:
            rows.append([
                candidate["id"],
                candidate["family"],
                candidate["role"],
                fmt(candidate["metrics"]["mean"]),
                fmt(candidate["metrics"]["rmse"]),
                fmt(candidate["metrics"]["p95"]),
                fmt(candidate["metrics"]["p99"]),
                fmt(candidate["metrics"]["max"]),
                str(candidate["regressionsVsBaseline"]["worseOver1px"] if candidate["regressionsVsBaseline"] else 0),
                str(candidate["regressionsVsBaseline"]["worseOver5px"] if candidate["regressionsVsBaseline"] else 0),
                fmt(candidate["trainSec"]),
                fmt(candidate["inferenceRowsPerSec"], 1),
            ])
        fail_text = "none" if not fold["failures"] else "; ".join(f"{f['family']}: {f['error']}" for f in fold["failures"])
        sections.append(f"""## {fold['name']}

Train: `{fold['trainSession']}`, eval: `{fold['evalSession']}`

Failures: {fail_text}

{md_table(["candidate", "family", "role", "mean", "rmse", "p95", "p99", "max", ">1px reg", ">5px reg", "train sec", "rows/sec"], rows)}
""")
    return f"""# Cursor Prediction v9 Phase 3 ML Teachers

Generated: {result['generatedAt']}

Device: `{result['environment']['device']}`  
Torch: `{result['environment']['torchVersion']}`  
CUDA available: `{result['environment']['cudaAvailable']}`

The dataset was built in memory from the two Format 9 trace ZIPs. No dataset
cache, checkpoint, or TensorBoard artifact was written.

## Best By Fold

{md_table(["fold", "candidate", "family", "role", "mean", "p95", "p99", "max", ">1px regressions", ">5px regressions"], best_rows)}

{"".join(sections)}
"""


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    started = time.perf_counter()
    traces = [load_trace(args.root, name, f"session-{i + 1}") for i, name in enumerate(TRACE_FILES)]
    datasets = [build_dataset(trace) for trace in traces]
    folds = [
        run_fold("train-session-1-eval-session-2", datasets[0], datasets[1], args.seed + 1, args.epochs, args.batch_size, device),
        run_fold("train-session-2-eval-session-1", datasets[1], datasets[0], args.seed + 1001, args.epochs, args.batch_size, device),
    ]
    if device.type == "cuda":
        torch.cuda.synchronize()
    elapsed = time.perf_counter() - started
    result = {
        "schemaVersion": "cursor-prediction-v9-phase3-ml-teachers/1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runtimeSec": elapsed,
        "policy": {
            "inputTraces": TRACE_FILES,
            "horizonsMs": HORIZONS_MS,
            "sequenceLength": 16,
            "target": "referencePoll position at anchor time + horizon",
            "predictionTarget": "residual over product_constant_velocity_v8_shape",
            "causalInputsOnly": True,
            "largeArtifactsWritten": False,
        },
        "environment": {
            "python": ".".join(map(str, tuple(__import__("sys").version_info[:3]))),
            "torchVersion": torch.__version__,
            "cudaAvailable": torch.cuda.is_available(),
            "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        },
        "datasets": [dataset.summary for dataset in datasets],
        "folds": folds,
    }
    args.out_json.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    args.out_md.write_text(render_markdown(result), encoding="utf-8")
    print(f"Wrote {args.out_json}")
    print(f"Wrote {args.out_md}")
    print(f"Runtime seconds: {elapsed:.3f}")


if __name__ == "__main__":
    main()
