#!/usr/bin/env python3
"""Step 5 cursor prediction neural-model experiment.

This script intentionally uses only Python's standard library plus NumPy.
It streams trace.csv from the root trace zip, builds causal history features,
trains tiny MLP regressors, and writes scores.json in this step directory.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import platform
import shutil
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


DEFAULT_HORIZONS_MS = [4, 8, 12, 16, 24]
DEFAULT_IDLE_GAP_MS = 100.0
DEFAULT_HISTORY_INTERVALS = 5
SPEED_BINS = [
    ("0-500", 0.0, 500.0),
    ("500-1500", 500.0, 1500.0),
    ("1500-3000", 1500.0, 3000.0),
    ("3000+", 3000.0, float("inf")),
]


@dataclass
class TraceData:
    sequence: np.ndarray
    times_ms: np.ndarray
    x: np.ndarray
    y: np.ndarray
    event: list[str]
    zip_path: str


@dataclass
class FeatureSet:
    x: np.ndarray
    valid: np.ndarray
    names: list[str]
    anchor_speed_px_s: np.ndarray
    segment_age_ms: np.ndarray
    last2_disp_by_horizon: dict[int, np.ndarray]


@dataclass
class Standardizer:
    mean: np.ndarray
    std: np.ndarray

    @classmethod
    def fit(cls, values: np.ndarray) -> "Standardizer":
        mean = values.mean(axis=0)
        std = values.std(axis=0)
        std = np.where(std < 1e-8, 1.0, std)
        return cls(mean=mean, std=std)

    def transform(self, values: np.ndarray) -> np.ndarray:
        return (values - self.mean) / self.std

    def inverse_transform(self, values: np.ndarray) -> np.ndarray:
        return values * self.std + self.mean


def percentile(sorted_values: np.ndarray, p: float) -> float | None:
    if sorted_values.size == 0:
        return None
    return float(np.percentile(sorted_values, p * 100.0))


def error_stats(errors: np.ndarray) -> dict[str, Any]:
    if errors.size == 0:
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
    return {
        "n": int(errors.size),
        "mean_px": float(errors.mean()),
        "rmse_px": float(math.sqrt(float(np.mean(errors * errors)))),
        "p50_px": percentile(errors, 0.50),
        "p90_px": percentile(errors, 0.90),
        "p95_px": percentile(errors, 0.95),
        "p99_px": percentile(errors, 0.99),
        "max_px": float(errors.max()),
    }


def read_trace_from_zip(zip_path: Path) -> TraceData:
    resolved = zip_path.resolve()
    with zipfile.ZipFile(resolved, "r") as archive:
        with archive.open("trace.csv", "r") as raw:
            rows = csv.DictReader((line.decode("utf-8") for line in raw))
            sequence: list[int] = []
            times_ms: list[float] = []
            xs: list[float] = []
            ys: list[float] = []
            events: list[str] = []
            for row in rows:
                sequence.append(int(row["sequence"]))
                elapsed_us = int(row["elapsedMicroseconds"])
                times_ms.append(elapsed_us / 1000.0)
                xs.append(float(row["x"]))
                ys.append(float(row["y"]))
                events.append(row["event"])
    if len(sequence) < 2:
        raise ValueError("trace.csv needs at least two samples")
    return TraceData(
        sequence=np.asarray(sequence, dtype=np.int64),
        times_ms=np.asarray(times_ms, dtype=np.float64),
        x=np.asarray(xs, dtype=np.float64),
        y=np.asarray(ys, dtype=np.float64),
        event=events,
        zip_path=str(resolved),
    )


def get_segments(times_ms: np.ndarray, idle_gap_ms: float) -> tuple[np.ndarray, np.ndarray]:
    n = times_ms.size
    segment_id = np.zeros(n, dtype=np.int32)
    segment_start = np.zeros(n, dtype=np.int32)
    current_segment = 0
    current_start = 0
    for i in range(1, n):
        gap = times_ms[i] - times_ms[i - 1]
        if gap > idle_gap_ms or gap <= 0.0:
            current_segment += 1
            current_start = i
        segment_id[i] = current_segment
        segment_start[i] = current_start
    return segment_id, segment_start


def build_targets(
    data: TraceData,
    segment_id: np.ndarray,
    idle_gap_ms: float,
    horizons_ms: list[int],
) -> dict[int, dict[str, np.ndarray]]:
    n = data.times_ms.size
    targets: dict[int, dict[str, np.ndarray]] = {}
    last_time = data.times_ms[-1]

    for horizon in horizons_ms:
        valid = np.zeros(n, dtype=bool)
        tx = np.zeros(n, dtype=np.float64)
        ty = np.zeros(n, dtype=np.float64)
        j = 0
        for i in range(n):
            target_time = data.times_ms[i] + float(horizon)
            if target_time > last_time:
                continue
            if j < i:
                j = i
            while j + 1 < n and data.times_ms[j + 1] <= target_time:
                j += 1
            if j == n - 1:
                if target_time == data.times_ms[-1] and segment_id[j] == segment_id[i]:
                    valid[i] = True
                    tx[i] = data.x[j]
                    ty[i] = data.y[j]
                continue
            if segment_id[j] != segment_id[i] or segment_id[j + 1] != segment_id[i]:
                continue
            gap = data.times_ms[j + 1] - data.times_ms[j]
            if gap > idle_gap_ms or gap <= 0.0:
                continue
            ratio = (target_time - data.times_ms[j]) / gap
            valid[i] = True
            tx[i] = data.x[j] + (data.x[j + 1] - data.x[j]) * ratio
            ty[i] = data.y[j] + (data.y[j + 1] - data.y[j]) * ratio
        targets[horizon] = {"valid": valid, "x": tx, "y": ty}
    return targets


def build_features(
    data: TraceData,
    segment_start: np.ndarray,
    idle_gap_ms: float,
    history_intervals: int,
    horizons_ms: list[int],
) -> FeatureSet:
    n = data.times_ms.size
    feature_names: list[str] = []
    for lag in range(history_intervals, 0, -1):
        feature_names.extend(
            [
                f"dt_ms_lag_{lag}",
                f"dx_px_lag_{lag}",
                f"dy_px_lag_{lag}",
                f"vx_px_per_ms_lag_{lag}",
                f"vy_px_per_ms_lag_{lag}",
            ]
        )
    feature_names.extend(
        [
            "current_speed_px_s",
            "previous_speed_px_s",
            "accel_x_px_per_ms2",
            "accel_y_px_per_ms2",
            "turn_cos",
            "turn_sin",
            "segment_age_ms",
            "segment_age_samples",
            "history_total_dx_px",
            "history_total_dy_px",
            "history_avg_vx_px_per_ms",
            "history_avg_vy_px_per_ms",
        ]
    )

    values = np.zeros((n, len(feature_names)), dtype=np.float64)
    valid = np.zeros(n, dtype=bool)
    anchor_speed_px_s = np.zeros(n, dtype=np.float64)
    segment_age_ms = np.zeros(n, dtype=np.float64)
    last2_disp_by_horizon = {
        horizon: np.zeros((n, 2), dtype=np.float64) for horizon in horizons_ms
    }

    for i in range(1, n):
        if i - 1 < segment_start[i]:
            continue
        dt = data.times_ms[i] - data.times_ms[i - 1]
        if dt <= 0.0 or dt > idle_gap_ms:
            continue
        vx = (data.x[i] - data.x[i - 1]) / dt
        vy = (data.y[i] - data.y[i - 1]) / dt
        for horizon in horizons_ms:
            last2_disp_by_horizon[horizon][i, 0] = vx * horizon
            last2_disp_by_horizon[horizon][i, 1] = vy * horizon

    for i in range(history_intervals, n):
        if i - history_intervals < segment_start[i]:
            continue
        row: list[float] = []
        dts: list[float] = []
        dxs: list[float] = []
        dys: list[float] = []
        vxs: list[float] = []
        vys: list[float] = []
        ok = True
        for k in range(i - history_intervals + 1, i + 1):
            dt = data.times_ms[k] - data.times_ms[k - 1]
            if dt <= 0.0 or dt > idle_gap_ms:
                ok = False
                break
            dx = data.x[k] - data.x[k - 1]
            dy = data.y[k] - data.y[k - 1]
            vx = dx / dt
            vy = dy / dt
            dts.append(dt)
            dxs.append(dx)
            dys.append(dy)
            vxs.append(vx)
            vys.append(vy)
            row.extend([dt, dx, dy, vx, vy])
        if not ok:
            continue

        current_speed = math.hypot(vxs[-1], vys[-1]) * 1000.0
        previous_speed = math.hypot(vxs[-2], vys[-2]) * 1000.0 if len(vxs) >= 2 else 0.0
        accel_x = (vxs[-1] - vxs[-2]) / max(dts[-1], 1e-8)
        accel_y = (vys[-1] - vys[-2]) / max(dts[-1], 1e-8)
        norm_current = math.hypot(vxs[-1], vys[-1])
        norm_prev = math.hypot(vxs[-2], vys[-2]) if len(vxs) >= 2 else 0.0
        if norm_current > 1e-8 and norm_prev > 1e-8:
            turn_cos = (vxs[-1] * vxs[-2] + vys[-1] * vys[-2]) / (norm_current * norm_prev)
            turn_sin = (vxs[-2] * vys[-1] - vys[-2] * vxs[-1]) / (norm_current * norm_prev)
        else:
            turn_cos = 1.0
            turn_sin = 0.0
        age_ms = data.times_ms[i] - data.times_ms[segment_start[i]]
        age_samples = i - segment_start[i]
        row.extend(
            [
                current_speed,
                previous_speed,
                accel_x,
                accel_y,
                float(np.clip(turn_cos, -1.0, 1.0)),
                float(np.clip(turn_sin, -1.0, 1.0)),
                age_ms,
                float(age_samples),
                float(np.sum(dxs)),
                float(np.sum(dys)),
                float(np.mean(vxs)),
                float(np.mean(vys)),
            ]
        )
        values[i, :] = row
        valid[i] = True
        anchor_speed_px_s[i] = current_speed
        segment_age_ms[i] = age_ms

    return FeatureSet(
        x=values,
        valid=valid,
        names=feature_names,
        anchor_speed_px_s=anchor_speed_px_s,
        segment_age_ms=segment_age_ms,
        last2_disp_by_horizon=last2_disp_by_horizon,
    )


def split_masks(n: int, valid: np.ndarray) -> dict[str, np.ndarray]:
    test_start = int(math.floor(n * 0.70))
    all_mask = valid.copy()
    train_mask = valid.copy()
    train_mask[test_start:] = False
    test_mask = valid.copy()
    test_mask[:test_start] = False
    return {
        "all": all_mask,
        "train_first_70pct": train_mask,
        "test_latter_30pct": test_mask,
    }


def evaluate_predictions(
    data: TraceData,
    targets: dict[int, dict[str, np.ndarray]],
    horizon: int,
    mask: np.ndarray,
    pred_disp: np.ndarray,
) -> np.ndarray:
    target = targets[horizon]
    idx = np.flatnonzero(mask)
    pred_x = data.x[idx] + pred_disp[idx, 0]
    pred_y = data.y[idx] + pred_disp[idx, 1]
    err_x = pred_x - target["x"][idx]
    err_y = pred_y - target["y"][idx]
    return np.sqrt(err_x * err_x + err_y * err_y)


class TinyMLP:
    def __init__(
        self,
        input_dim: int,
        hidden_sizes: list[int],
        output_dim: int,
        rng: np.random.Generator,
    ) -> None:
        dims = [input_dim, *hidden_sizes, output_dim]
        self.weights: list[np.ndarray] = []
        self.biases: list[np.ndarray] = []
        for fan_in, fan_out in zip(dims[:-1], dims[1:]):
            limit = math.sqrt(6.0 / (fan_in + fan_out))
            self.weights.append(rng.uniform(-limit, limit, size=(fan_in, fan_out)).astype(np.float64))
            self.biases.append(np.zeros(fan_out, dtype=np.float64))

    def copy_params(self) -> tuple[list[np.ndarray], list[np.ndarray]]:
        return ([w.copy() for w in self.weights], [b.copy() for b in self.biases])

    def load_params(self, params: tuple[list[np.ndarray], list[np.ndarray]]) -> None:
        self.weights = [w.copy() for w in params[0]]
        self.biases = [b.copy() for b in params[1]]

    def forward(self, x: np.ndarray) -> tuple[np.ndarray, list[np.ndarray], list[np.ndarray]]:
        activations = [x]
        preacts: list[np.ndarray] = []
        a = x
        for layer_index, (w, b) in enumerate(zip(self.weights, self.biases)):
            z = a @ w + b
            preacts.append(z)
            if layer_index == len(self.weights) - 1:
                a = z
            else:
                a = np.maximum(z, 0.0)
            activations.append(a)
        return a, activations, preacts

    def predict(self, x: np.ndarray) -> np.ndarray:
        return self.forward(x)[0]

    @property
    def parameter_count(self) -> int:
        return int(sum(w.size + b.size for w, b in zip(self.weights, self.biases)))

    @property
    def multiply_add_count(self) -> int:
        return int(sum(w.shape[0] * w.shape[1] for w in self.weights))


def train_mlp(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    hidden_sizes: list[int],
    seed: int,
    max_epochs: int,
    patience: int,
    learning_rate: float,
    l2: float,
) -> tuple[TinyMLP, dict[str, Any]]:
    rng = np.random.default_rng(seed)
    model = TinyMLP(x_train.shape[1], hidden_sizes, y_train.shape[1], rng)
    mw = [np.zeros_like(w) for w in model.weights]
    vw = [np.zeros_like(w) for w in model.weights]
    mb = [np.zeros_like(b) for b in model.biases]
    vb = [np.zeros_like(b) for b in model.biases]
    beta1 = 0.9
    beta2 = 0.999
    eps = 1e-8
    best_val = float("inf")
    best_epoch = 0
    best_params = model.copy_params()
    train_start = time.perf_counter()

    for epoch in range(1, max_epochs + 1):
        pred, activations, preacts = model.forward(x_train)
        diff = pred - y_train
        loss_grad = (2.0 / x_train.shape[0]) * diff
        grad_w: list[np.ndarray] = []
        grad_b: list[np.ndarray] = []
        grad = loss_grad
        for layer_index in range(len(model.weights) - 1, -1, -1):
            grad_w_layer = activations[layer_index].T @ grad + l2 * model.weights[layer_index]
            grad_b_layer = grad.sum(axis=0)
            grad_w.insert(0, grad_w_layer)
            grad_b.insert(0, grad_b_layer)
            if layer_index > 0:
                grad = (grad @ model.weights[layer_index].T) * (preacts[layer_index - 1] > 0.0)

        for layer_index in range(len(model.weights)):
            mw[layer_index] = beta1 * mw[layer_index] + (1.0 - beta1) * grad_w[layer_index]
            vw[layer_index] = beta2 * vw[layer_index] + (1.0 - beta2) * (grad_w[layer_index] * grad_w[layer_index])
            mb[layer_index] = beta1 * mb[layer_index] + (1.0 - beta1) * grad_b[layer_index]
            vb[layer_index] = beta2 * vb[layer_index] + (1.0 - beta2) * (grad_b[layer_index] * grad_b[layer_index])

            mw_hat = mw[layer_index] / (1.0 - beta1**epoch)
            vw_hat = vw[layer_index] / (1.0 - beta2**epoch)
            mb_hat = mb[layer_index] / (1.0 - beta1**epoch)
            vb_hat = vb[layer_index] / (1.0 - beta2**epoch)
            model.weights[layer_index] -= learning_rate * mw_hat / (np.sqrt(vw_hat) + eps)
            model.biases[layer_index] -= learning_rate * mb_hat / (np.sqrt(vb_hat) + eps)

        val_pred = model.predict(x_val)
        val_loss = float(np.mean((val_pred - y_val) ** 2))
        if val_loss + 1e-9 < best_val:
            best_val = val_loss
            best_epoch = epoch
            best_params = model.copy_params()
        elif epoch - best_epoch >= patience:
            break

    elapsed = time.perf_counter() - train_start
    model.load_params(best_params)
    final_train_loss = float(np.mean((model.predict(x_train) - y_train) ** 2))
    final_val_loss = float(np.mean((model.predict(x_val) - y_val) ** 2))
    return model, {
        "epochs_ran": epoch,
        "best_epoch": best_epoch,
        "best_validation_mse_standardized": best_val,
        "final_train_mse_standardized": final_train_loss,
        "final_validation_mse_standardized": final_val_loss,
        "training_elapsed_sec": elapsed,
    }


def speed_bin_metrics(
    errors: np.ndarray,
    speeds: np.ndarray,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for label, lo, hi in SPEED_BINS:
        if math.isinf(hi):
            mask = speeds >= lo
        else:
            mask = (speeds >= lo) & (speeds < hi)
        stats = error_stats(errors[mask])
        rows.append({"speed_bin_px_s": label, **stats})
    return rows


def runtime_stack() -> dict[str, Any]:
    packages = {}
    for module in ["numpy", "sklearn", "torch", "tensorflow", "onnxruntime"]:
        try:
            __import__(module)
            packages[module] = True
        except Exception:
            packages[module] = False

    nvidia_smi = shutil.which("nvidia-smi")
    gpu: dict[str, Any] = {"nvidia_smi_found": bool(nvidia_smi), "available_for_numpy_training": False}
    if nvidia_smi:
        try:
            query = subprocess.run(
                [nvidia_smi, "--query-gpu=name,driver_version", "--format=csv,noheader"],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            full = subprocess.run(
                [nvidia_smi],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            gpu["query"] = query.stdout.strip()
            cuda_version = None
            marker = "CUDA Version:"
            if marker in full.stdout:
                cuda_version = full.stdout.split(marker, 1)[1].split("|", 1)[0].strip()
            gpu["cuda_version_from_nvidia_smi"] = cuda_version
        except Exception as exc:
            gpu["query_error"] = str(exc)

    return {
        "python_executable": sys.executable,
        "python_version": sys.version,
        "platform": platform.platform(),
        "numpy_version": np.__version__,
        "packages_available": packages,
        "gpu": gpu,
        "conclusion": "GPU hardware is visible, but no GPU-backed ML runtime is installed; this experiment uses CPU NumPy only.",
    }


def estimate_inference_cost(model: TinyMLP, x_test: np.ndarray) -> dict[str, Any]:
    if x_test.size == 0:
        return {
            "parameter_count": model.parameter_count,
            "multiply_add_count_per_prediction": model.multiply_add_count,
            "measured_predictions": 0,
            "measured_sec_per_prediction": None,
        }
    repeat = max(1, int(math.ceil(20000 / x_test.shape[0])))
    start = time.perf_counter()
    count = 0
    for _ in range(repeat):
        model.predict(x_test)
        count += x_test.shape[0]
    elapsed = time.perf_counter() - start
    return {
        "parameter_count": model.parameter_count,
        "multiply_add_count_per_prediction": model.multiply_add_count,
        "measured_predictions": int(count),
        "measured_elapsed_sec": elapsed,
        "measured_sec_per_prediction": elapsed / count if count else None,
        "measured_predictions_per_sec": count / elapsed if elapsed > 0.0 else None,
        "note": "Vectorized NumPy batch timing; useful for relative cost, not per-event UI latency.",
    }


def add_score_row(
    scores: list[dict[str, Any]],
    model_name: str,
    family: str,
    parameter: str,
    cost: str,
    horizon: int,
    split: str,
    errors: np.ndarray,
) -> None:
    scores.append(
        {
            "model": model_name,
            "family": family,
            "parameter": parameter,
            "model_cost_estimate": cost,
            "horizon_ms": horizon,
            "split": split,
            **error_stats(errors),
        }
    )


def summarize_best(scores: list[dict[str, Any]], horizons_ms: list[int]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for horizon in horizons_ms:
        candidates = [
            row
            for row in scores
            if row["split"] == "test_latter_30pct" and row["horizon_ms"] == horizon and row["n"] > 0
        ]
        candidates.sort(key=lambda row: (row["mean_px"], row["p95_px"], row["p99_px"], row["model"]))
        if candidates:
            rows.append(candidates[0])
    return rows


def run_experiment(args: argparse.Namespace) -> dict[str, Any]:
    total_start = time.perf_counter()
    np.random.seed(args.seed)
    data = read_trace_from_zip(Path(args.zip_path))
    segment_id, segment_start = get_segments(data.times_ms, args.idle_gap_ms)
    targets = build_targets(data, segment_id, args.idle_gap_ms, args.horizons_ms)
    features = build_features(
        data,
        segment_start,
        args.idle_gap_ms,
        args.history_intervals,
        args.horizons_ms,
    )
    n = data.times_ms.size
    test_start = int(math.floor(n * 0.70))
    scores: list[dict[str, Any]] = []
    speed_bins: list[dict[str, Any]] = []
    model_runs: list[dict[str, Any]] = []
    model_configs = [
        {
            "name": "mlp-direct-h32x16",
            "family": "mlp-direct",
            "target_kind": "direct_displacement",
            "hidden_sizes": [32, 16],
        },
        {
            "name": "mlp-residual-last2-h32x16",
            "family": "mlp-residual-last2",
            "target_kind": "residual_to_last2",
            "hidden_sizes": [32, 16],
        },
    ]

    for horizon in args.horizons_ms:
        target = targets[horizon]
        common_valid = features.valid & target["valid"]
        masks = split_masks(n, common_valid)
        target_disp = np.column_stack((target["x"] - data.x, target["y"] - data.y))
        last2_disp = features.last2_disp_by_horizon[horizon]

        baseline_disps = {
            "hold-current": np.zeros((n, 2), dtype=np.float64),
            "constant-velocity-last2": last2_disp,
        }
        for model_name, disp in baseline_disps.items():
            family = "hold" if model_name == "hold-current" else "baseline-last2"
            parameter = "" if model_name == "hold-current" else "gain=1; cap=none; common-feature-anchor-mask"
            cost = "O(1): current position only" if model_name == "hold-current" else "O(1): one interval velocity"
            for split, mask in masks.items():
                errors = evaluate_predictions(data, targets, horizon, mask, disp)
                add_score_row(scores, model_name, family, parameter, cost, horizon, split, errors)
                if split == "test_latter_30pct":
                    idx = np.flatnonzero(mask)
                    for row in speed_bin_metrics(errors, features.anchor_speed_px_s[idx]):
                        speed_bins.append(
                            {
                                "model": model_name,
                                "family": family,
                                "horizon_ms": horizon,
                                "split": split,
                                **row,
                            }
                        )

        train_idx_all = np.flatnonzero(masks["train_first_70pct"])
        if train_idx_all.size < 50:
            continue
        val_count = max(1, int(math.floor(train_idx_all.size * args.validation_fraction)))
        train_fit_idx = train_idx_all[:-val_count]
        val_idx = train_idx_all[-val_count:]
        test_idx = np.flatnonzero(masks["test_latter_30pct"])
        x_scaler = Standardizer.fit(features.x[train_fit_idx])
        x_train = x_scaler.transform(features.x[train_fit_idx])
        x_val = x_scaler.transform(features.x[val_idx])
        x_test_scaled = x_scaler.transform(features.x[test_idx]) if test_idx.size else np.empty((0, features.x.shape[1]))

        for config_index, config in enumerate(model_configs):
            if config["target_kind"] == "direct_displacement":
                y_raw = target_disp
                base_disp = np.zeros((n, 2), dtype=np.float64)
            else:
                y_raw = target_disp - last2_disp
                base_disp = last2_disp
            y_scaler = Standardizer.fit(y_raw[train_fit_idx])
            y_train = y_scaler.transform(y_raw[train_fit_idx])
            y_val = y_scaler.transform(y_raw[val_idx])
            model_seed = args.seed + horizon * 100 + config_index
            model, train_info = train_mlp(
                x_train=x_train,
                y_train=y_train,
                x_val=x_val,
                y_val=y_val,
                hidden_sizes=config["hidden_sizes"],
                seed=model_seed,
                max_epochs=args.max_epochs,
                patience=args.patience,
                learning_rate=args.learning_rate,
                l2=args.l2,
            )
            pred_standard = model.predict(x_scaler.transform(features.x[common_valid]))
            pred_raw = np.zeros((n, 2), dtype=np.float64)
            pred_raw[common_valid] = base_disp[common_valid] + y_scaler.inverse_transform(pred_standard)
            for split, mask in masks.items():
                errors = evaluate_predictions(data, targets, horizon, mask, pred_raw)
                add_score_row(
                    scores,
                    config["name"],
                    config["family"],
                    f"hidden={config['hidden_sizes']}; standardized_features_targets=train_only; common-feature-anchor-mask",
                    f"MLP params={model.parameter_count}; multiply-adds={model.multiply_add_count}",
                    horizon,
                    split,
                    errors,
                )
                if split == "test_latter_30pct":
                    idx = np.flatnonzero(mask)
                    for row in speed_bin_metrics(errors, features.anchor_speed_px_s[idx]):
                        speed_bins.append(
                            {
                                "model": config["name"],
                                "family": config["family"],
                                "horizon_ms": horizon,
                                "split": split,
                                **row,
                            }
                        )

            model_runs.append(
                {
                    "model": config["name"],
                    "horizon_ms": horizon,
                    "target_kind": config["target_kind"],
                    "hidden_sizes": config["hidden_sizes"],
                    "seed": model_seed,
                    "train_fit_count": int(train_fit_idx.size),
                    "validation_count": int(val_idx.size),
                    "test_count": int(test_idx.size),
                    "feature_count": int(features.x.shape[1]),
                    "target_standardization": {
                        "mean": y_scaler.mean.tolist(),
                        "std": y_scaler.std.tolist(),
                    },
                    "training": train_info,
                    "inference_cost": estimate_inference_cost(model, x_test_scaled),
                }
            )

    total_elapsed = time.perf_counter() - total_start
    data_audit = {
        "samples": int(n),
        "first_sequence": int(data.sequence[0]),
        "last_sequence": int(data.sequence[-1]),
        "first_elapsed_ms": float(data.times_ms[0]),
        "last_elapsed_ms": float(data.times_ms[-1]),
        "duration_sec": float((data.times_ms[-1] - data.times_ms[0]) / 1000.0),
        "segments_after_gap_split": int(segment_id.max() + 1),
        "idle_gap_count": int(np.sum(np.diff(data.times_ms) > args.idle_gap_ms)),
        "feature_valid_anchor_count": int(features.valid.sum()),
    }

    prior_step1_best = [
        {"horizon_ms": 4, "model": "constant-velocity-last2", "split": "test_latter_30pct", "cap_px": "none", "mean_px": 1.698281974110184, "p95_px": 6.472145871542837, "p99_px": 12.892078497766965, "max_px": 48.51798802341477},
        {"horizon_ms": 8, "model": "constant-velocity-last2", "split": "test_latter_30pct", "cap_px": "none", "mean_px": 3.366685239822474, "p95_px": 12.60176367266762, "p99_px": 25.549158150373934, "max_px": 97.03597604682957},
        {"horizon_ms": 12, "model": "constant-velocity-last2", "split": "test_latter_30pct", "cap_px": "none", "mean_px": 5.480803209810633, "p95_px": 22.41022104836119, "p99_px": 43.65526381524004, "max_px": 152.80239587223957},
        {"horizon_ms": 16, "model": "constant-velocity-last2", "split": "test_latter_30pct", "cap_px": "none", "mean_px": 7.809426354876187, "p95_px": 31.851341513476537, "p99_px": 62.940409247141844, "max_px": 208.77155449277288},
        {"horizon_ms": 24, "model": "constant-velocity-last2", "split": "test_latter_30pct", "cap_px": "none", "mean_px": 14.038393745721125, "p95_px": 58.578323970058634, "p99_px": 111.83699951708977, "max_px": 319.5918769947875},
        {"horizon_ms": 32, "model": "constant-velocity-last2", "split": "test_latter_30pct", "cap_px": "none", "mean_px": 21.6984701703731, "p95_px": 91.2116642967315, "p99_px": 175.09635105776042, "max_px": 445.73770835318277},
        {"horizon_ms": 48, "model": "constant-velocity-last2", "split": "test_latter_30pct", "cap_px": "none", "mean_px": 40.78924408067184, "p95_px": 173.6753405121625, "p99_px": 334.80738575607376, "max_px": 720.6284937578891},
    ]

    return {
        "experiment": {
            "name": "step-5 neural-models",
            "source_zip": str(Path(args.zip_path).resolve()),
            "trace_entry": "trace.csv",
            "generated_by": "run_neural_models.py",
            "random_seed": args.seed,
            "idle_gap_policy": {
                "threshold_ms": args.idle_gap_ms,
                "rule": "Targets are skipped if t+horizon requires interpolation across a gap above threshold; history features also reset at the same threshold.",
            },
            "horizons_ms": args.horizons_ms,
            "history_intervals": args.history_intervals,
            "split_policy": {
                "train_first_70pct": "first 70% of sample indices; last validation_fraction slice of this training region is used for early stopping",
                "test_latter_30pct": "last 30% of sample indices; primary comparison",
                "validation_fraction_within_train": args.validation_fraction,
                "common_anchor_note": "All Step 5 rows use anchors that have neural feature history and a valid future target, so baseline numbers are apples-to-apples with MLP rows and may differ slightly from Step 1 all-valid-history baselines.",
            },
            "future_leak_policy": "Features at anchor i use only samples <= i. Targets use interpolated position at i+horizon for supervised labels.",
            "speed_bins_px_s": [{"label": label, "min": lo, "max": hi} for label, lo, hi in SPEED_BINS],
        },
        "runtime_stack": runtime_stack(),
        "data_audit": data_audit,
        "feature_schema": features.names,
        "model_configurations": model_configs,
        "prior_step1_best_last2_test_cap_none": prior_step1_best,
        "model_runs": model_runs,
        "scores": scores,
        "speed_bin_scores": speed_bins,
        "top_models": {
            "test_best_by_horizon": summarize_best(scores, args.horizons_ms),
        },
        "performance": {
            "total_script_elapsed_sec": total_elapsed,
            "test_start_index": test_start,
            "test_start_sequence": int(data.sequence[test_start]),
            "test_start_elapsed_ms": float(data.times_ms[test_start]),
            "note": "Timing is one local CPU NumPy run and includes zip reading, feature building, training, evaluation, and JSON writing.",
        },
        "recommendation": {
            "decision": "Do not replace the Step 4 default with an MLP on this single trace.",
            "rationale": [
                "Neural models improve aggregate common-anchor mean, p95, and p99 at tested horizons, with the strongest gains in the 3000+ px/s speed bin.",
                "The same models regress low-speed bins where last2 is already very accurate, and some horizon/model combinations worsen max error.",
                "The MLP requires feature standardization, per-horizon trained weights, validation policy, and more implementation/test surface than constant-velocity-last2.",
                "A future speed-gated hybrid is worth testing on more traces, but the default should remain constant-velocity-last2 until the tail behavior is proven across devices and users.",
            ],
            "guardrail": "Prefer a neural or hybrid model only if it beats last2 on the target deployment traces without low-speed regressions or p99/max regressions.",
        },
        "notes": [
            "No external network or additional dependencies were used.",
            "trace.csv was streamed from the zip and was not extracted or copied into this step directory.",
            "Standardization statistics are fit on train_fit only, not validation or test.",
            "Baselines and MLPs are evaluated on the same common feature-valid anchors per horizon.",
        ],
    }


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip-path", default=str(repo_root / "cursor-mirror-trace-20260501-000443.zip"))
    parser.add_argument("--output", default=str(script_dir / "scores.json"))
    parser.add_argument("--idle-gap-ms", type=float, default=DEFAULT_IDLE_GAP_MS)
    parser.add_argument("--horizons-ms", type=int, nargs="+", default=DEFAULT_HORIZONS_MS)
    parser.add_argument("--history-intervals", type=int, default=DEFAULT_HISTORY_INTERVALS)
    parser.add_argument("--seed", type=int, default=20260501)
    parser.add_argument("--validation-fraction", type=float, default=0.20)
    parser.add_argument("--max-epochs", type=int, default=250)
    parser.add_argument("--patience", type=int, default=25)
    parser.add_argument("--learning-rate", type=float, default=0.003)
    parser.add_argument("--l2", type=float, default=1e-4)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path = Path(args.output).resolve()
    payload = run_experiment(args)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    best = payload["top_models"]["test_best_by_horizon"]
    print(f"wrote {output_path}")
    print(f"samples={payload['data_audit']['samples']} feature_valid={payload['data_audit']['feature_valid_anchor_count']}")
    for row in best:
        print(
            "best_test horizon={horizon_ms}ms model={model} mean={mean_px:.4f}px p95={p95_px:.4f}px p99={p99_px:.4f}px".format(
                **row
            )
        )
    print(f"elapsed_sec={payload['performance']['total_script_elapsed_sec']:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
