#!/usr/bin/env python3
"""Phase 5 expanded teacher and fixed common gate evaluation.

The script keeps traces, datasets, model weights, and predictions in memory. It
writes only compact JSON/Markdown summaries and does not write checkpoints,
TensorBoard logs, dataset caches, or extracted ZIP contents.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import random
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


SCRIPT_DIR = Path(__file__).resolve().parent


def load_local_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


p3 = load_local_module("phase3_ml_teachers_for_phase5", SCRIPT_DIR / "phase3-ml-teachers.py")
p4 = load_local_module("phase4_guarded_mlp_for_phase5", SCRIPT_DIR / "phase4-guarded-mlp.py")


TEACHERS: list[dict[str, Any]] = [
    {"id": "mlp_seq16_h128_64_32", "family": "mlp", "seqLen": 16, "hidden": [128, 64, 32]},
    {"id": "mlp_seq16_h256_128_64", "family": "mlp", "seqLen": 16, "hidden": [256, 128, 64]},
    {"id": "mlp_seq32_h128_64_32", "family": "mlp", "seqLen": 32, "hidden": [128, 64, 32]},
    {"id": "mlp_seq32_h256_128_64", "family": "mlp", "seqLen": 32, "hidden": [256, 128, 64]},
    {"id": "cnn_seq32_c64", "family": "cnn", "seqLen": 32, "channels": 64},
    {"id": "tcn_seq32_c64", "family": "tcn", "seqLen": 32, "channels": 64},
    {"id": "fsmn_seq32_c64", "family": "fsmn", "seqLen": 32, "channels": 64},
    {"id": "gru_seq32_h80", "family": "gru", "seqLen": 32, "hiddenSize": 80},
    {"id": "transformer_seq32_d64_h4_l1", "family": "transformer", "seqLen": 32, "dModel": 64, "heads": 4, "layers": 1},
    {"id": "rfn_seq32_rff768_ridge01", "family": "rfn", "seqLen": 32, "randomFeatures": 768, "ridge": 1e-2},
]


RESIDUAL_THRESHOLDS = [8.0, 12.0, 16.0, 20.0, 24.0]
COS_THRESHOLDS = [0.25, 0.5, 0.75]
BASELINE_DISP_LIMITS = [4.0, 8.0]


def parse_args() -> argparse.Namespace:
    root = SCRIPT_DIR.parents[2]
    out_dir = SCRIPT_DIR.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-json", type=Path, default=out_dir / "phase-5-expanded-teachers.json")
    parser.add_argument("--out-md", type=Path, default=out_dir / "phase-5-expanded-teachers.md")
    parser.add_argument("--seed", type=int, default=20260505)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--max-epochs", type=int, default=20)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--cpu-sample-rows", type=int, default=8192)
    return parser.parse_args()


class FlexibleMLP(nn.Module):
    def __init__(self, input_dim: int, hidden: list[int]):
        super().__init__()
        layers: list[nn.Module] = []
        last = input_dim
        for width in hidden:
            layers.extend([nn.Linear(last, width), nn.ReLU()])
            last = width
        layers.append(nn.Linear(last, 2))
        self.net = nn.Sequential(*layers)

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        return self.net(tab)


class ExpandedCNN(nn.Module):
    def __init__(self, seq_dim: int, ctx_dim: int, channels: int):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(seq_dim, channels, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv1d(channels, channels, kernel_size=5, padding=2),
            nn.ReLU(),
            nn.Conv1d(channels, channels, kernel_size=3, padding=1),
            nn.ReLU(),
        )
        self.head = nn.Sequential(nn.Linear(channels + ctx_dim, 96), nn.ReLU(), nn.Linear(96, 2))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        h = self.conv(seq.transpose(1, 2)).mean(dim=2)
        return self.head(torch.cat([h, ctx], dim=1))


class CausalConv1d(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, kernel_size: int, dilation: int):
        super().__init__()
        self.pad = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(in_ch, out_ch, kernel_size=kernel_size, dilation=dilation)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv(F.pad(x, (self.pad, 0)))


class ExpandedTCN(nn.Module):
    def __init__(self, seq_dim: int, ctx_dim: int, channels: int):
        super().__init__()
        self.inp = nn.Conv1d(seq_dim, channels, kernel_size=1)
        self.blocks = nn.ModuleList([
            CausalConv1d(channels, channels, 3, 1),
            CausalConv1d(channels, channels, 3, 2),
            CausalConv1d(channels, channels, 3, 4),
            CausalConv1d(channels, channels, 3, 8),
        ])
        self.head = nn.Sequential(nn.Linear(channels + ctx_dim, 96), nn.ReLU(), nn.Linear(96, 2))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        h = self.inp(seq.transpose(1, 2))
        for block in self.blocks:
            h = F.relu(block(h) + h)
        return self.head(torch.cat([h[:, :, -1], ctx], dim=1))


class ExpandedFSMN(nn.Module):
    def __init__(self, seq_dim: int, ctx_dim: int, channels: int):
        super().__init__()
        self.proj = nn.Linear(seq_dim, channels)
        self.memory1 = nn.Conv1d(channels, channels, kernel_size=7, groups=channels)
        self.memory2 = nn.Conv1d(channels, channels, kernel_size=5, groups=channels)
        self.mix = nn.Linear(channels, channels)
        self.head = nn.Sequential(nn.Linear(channels + ctx_dim, 96), nn.ReLU(), nn.Linear(96, 2))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        h = F.relu(self.proj(seq)).transpose(1, 2)
        h = self.memory1(F.pad(h, (6, 0)))
        h = self.memory2(F.pad(h, (4, 0)))
        h = F.relu(self.mix(h.transpose(1, 2)))
        return self.head(torch.cat([h[:, -1, :], ctx], dim=1))


class ExpandedGRU(nn.Module):
    def __init__(self, seq_dim: int, ctx_dim: int, hidden_size: int):
        super().__init__()
        self.rnn = nn.GRU(seq_dim, hidden_size, num_layers=1, batch_first=True)
        self.head = nn.Sequential(nn.Linear(hidden_size + ctx_dim, 96), nn.ReLU(), nn.Linear(96, 2))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        _, state = self.rnn(seq)
        return self.head(torch.cat([state[-1], ctx], dim=1))


class TinyTransformer(nn.Module):
    def __init__(self, seq_len: int, seq_dim: int, ctx_dim: int, d_model: int, heads: int, layers: int):
        super().__init__()
        self.proj = nn.Linear(seq_dim, d_model)
        self.pos = nn.Parameter(torch.zeros(1, seq_len, d_model))
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=heads,
            dim_feedforward=d_model * 2,
            dropout=0.0,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=layers)
        self.head = nn.Sequential(nn.Linear(d_model + ctx_dim, 96), nn.ReLU(), nn.Linear(96, 2))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor, tab: torch.Tensor) -> torch.Tensor:
        h = self.encoder(self.proj(seq) + self.pos[:, :seq.shape[1], :])
        return self.head(torch.cat([h[:, -1, :], ctx], dim=1))


def make_model(spec: dict[str, Any], dataset: Any) -> nn.Module:
    seq_dim = dataset.seq.shape[2]
    ctx_dim = dataset.ctx.shape[1]
    tab_dim = dataset.tab.shape[1]
    family = spec["family"]
    if family == "mlp":
        return FlexibleMLP(tab_dim, spec["hidden"])
    if family == "cnn":
        return ExpandedCNN(seq_dim, ctx_dim, spec["channels"])
    if family == "tcn":
        return ExpandedTCN(seq_dim, ctx_dim, spec["channels"])
    if family == "fsmn":
        return ExpandedFSMN(seq_dim, ctx_dim, spec["channels"])
    if family == "gru":
        return ExpandedGRU(seq_dim, ctx_dim, spec["hiddenSize"])
    if family == "transformer":
        return TinyTransformer(spec["seqLen"], seq_dim, ctx_dim, spec["dModel"], spec["heads"], spec["layers"])
    raise ValueError(f"Unsupported torch family: {family}")


def split_dataset(dataset: Any, train_fraction: float = 0.70) -> tuple[Any, Any]:
    return p4.split_dataset(dataset, train_fraction)


def concat_datasets(first: Any, second: Any, session_id: str) -> Any:
    return p4.concat_datasets(first, second, session_id)


def metric_errors(dataset: Any, residual_px: np.ndarray) -> np.ndarray:
    pred = dataset.baseline + residual_px.astype(np.float32)
    return p3.distance(pred[:, 0], pred[:, 1], dataset.target[:, 0], dataset.target[:, 1])


def compact_eval(dataset: Any, residual_px: np.ndarray) -> dict[str, Any]:
    errors = metric_errors(dataset, residual_px)
    return {
        "metrics": p3.metric_stats(errors),
        "regressionsVsBaseline": p3.regression_counts(errors, dataset.baseline_error),
        "speedBins": p3.speed_breakdown(errors, dataset.speed_bins),
        "horizons": p4.horizon_breakdown(errors, dataset.horizons),
        "_errors": errors,
    }


def without_errors(entry: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in entry.items() if k != "_errors"}


def aggregate_error_sets(parts: list[dict[str, Any]], baseline_errors: list[np.ndarray]) -> dict[str, Any]:
    errors = np.concatenate([part["_errors"] for part in parts])
    baseline = np.concatenate(baseline_errors)
    return {
        "metrics": p3.metric_stats(errors),
        "regressionsVsBaseline": p3.regression_counts(errors, baseline),
    }


def objective(summary: dict[str, Any], baseline: dict[str, Any], mode: str) -> float:
    metrics = summary["metrics"]
    reg = summary["regressionsVsBaseline"]
    count = max(1, reg["count"])
    worse1_rate = reg["worseOver1px"] / count
    worse5_rate = reg["worseOver5px"] / count
    improved_rate = reg["improvedOver1px"] / count
    p95 = metrics["p95"] or float("inf")
    p99 = metrics["p99"] or float("inf")
    mean = metrics["mean"] or float("inf")
    base_p95 = baseline["metrics"]["p95"] or p95
    p95_gain = max(0.0, base_p95 - p95)
    if mode == "strict":
        return p95 + 0.4 * p99 + 2800.0 * worse5_rate + 600.0 * worse1_rate - 0.75 * p95_gain - 8.0 * improved_rate
    return p95 + 0.45 * p99 + 0.05 * mean + 850.0 * worse5_rate + 120.0 * worse1_rate - 45.0 * improved_rate


def standardize_three(train: np.ndarray, val: np.ndarray, eval_data: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    mean = train.mean(axis=0, keepdims=True)
    std = train.std(axis=0, keepdims=True)
    std[std < 1e-6] = 1.0
    return (
        ((train - mean) / std).astype(np.float32),
        ((val - mean) / std).astype(np.float32),
        ((eval_data - mean) / std).astype(np.float32),
        {"meanShape": list(mean.shape), "stdMin": float(std.min()), "stdMax": float(std.max())},
    )


def predict_torch(
    model: nn.Module,
    seq: torch.Tensor,
    ctx: torch.Tensor,
    tab: torch.Tensor,
    batch_size: int,
    sync_cuda: bool,
) -> tuple[np.ndarray, float]:
    model.eval()
    outputs: list[torch.Tensor] = []
    if sync_cuda and seq.device.type == "cuda":
        torch.cuda.synchronize()
    started = time.perf_counter()
    with torch.no_grad():
        for start in range(0, seq.shape[0], batch_size):
            end = min(start + batch_size, seq.shape[0])
            outputs.append(model(seq[start:end], ctx[start:end], tab[start:end]).detach().cpu())
    if sync_cuda and seq.device.type == "cuda":
        torch.cuda.synchronize()
    elapsed = time.perf_counter() - started
    return torch.cat(outputs, dim=0).numpy().astype(np.float32) * 50.0, elapsed


def estimate_macs(spec: dict[str, Any], dataset: Any) -> int:
    seq_len = dataset.seq.shape[1]
    seq_dim = dataset.seq.shape[2]
    ctx_dim = dataset.ctx.shape[1]
    tab_dim = dataset.tab.shape[1]
    family = spec["family"]
    if family == "mlp":
        dims = [tab_dim, *spec["hidden"], 2]
        return int(sum(dims[i] * dims[i + 1] for i in range(len(dims) - 1)))
    if family == "cnn":
        ch = spec["channels"]
        return int(seq_len * (seq_dim * ch * 3 + ch * ch * 5 + ch * ch * 3) + (ch + ctx_dim) * 96 + 96 * 2)
    if family == "tcn":
        ch = spec["channels"]
        return int(seq_len * (seq_dim * ch + 4 * ch * ch * 3) + (ch + ctx_dim) * 96 + 96 * 2)
    if family == "fsmn":
        ch = spec["channels"]
        return int(seq_len * (seq_dim * ch + ch * 7 + ch * 5 + ch * ch) + (ch + ctx_dim) * 96 + 96 * 2)
    if family == "gru":
        h = spec["hiddenSize"]
        return int(seq_len * 3 * (seq_dim * h + h * h + h) + (h + ctx_dim) * 96 + 96 * 2)
    if family == "transformer":
        d = spec["dModel"]
        layers = spec["layers"]
        return int(seq_len * seq_dim * d + layers * (seq_len * (4 * d * d + 2 * d * d) + seq_len * seq_len * d) + (d + ctx_dim) * 96 + 96 * 2)
    if family == "rfn":
        return int(dataset.tab.shape[1] * spec["randomFeatures"] + spec["randomFeatures"] * 2)
    return 0


def simd_estimate(spec: dict[str, Any], cpu_rows_per_sec: float | None, macs_per_sample: int) -> dict[str, Any]:
    if cpu_rows_per_sec is None:
        return {"macsPerSample": macs_per_sample, "pyTorchCpuRowsPerSec": None, "estimatedCSharpSimdRowsPerSecLow": None, "estimatedCSharpSimdRowsPerSecHigh": None}
    family = spec["family"]
    if family in {"mlp", "cnn", "tcn", "fsmn", "rfn"}:
        low, high = 1.6, 3.5
    elif family == "gru":
        low, high = 1.2, 2.0
    else:
        low, high = 1.1, 1.8
    ops_limited = 90_000_000_000.0 / max(1, macs_per_sample)
    high_rows = min(cpu_rows_per_sec * high, ops_limited)
    low_rows = min(cpu_rows_per_sec * low, high_rows)
    return {
        "macsPerSample": macs_per_sample,
        "pyTorchCpuRowsPerSec": cpu_rows_per_sec,
        "estimatedCSharpSimdRowsPerSecLow": low_rows,
        "estimatedCSharpSimdRowsPerSecHigh": high_rows,
        "basis": "sampled PyTorch CPU inference scaled by model family and capped by a rough 90 GFLOP/s scalar+SIMD budget",
    }


def train_torch_teacher(
    spec: dict[str, Any],
    train: Any,
    val: Any,
    eval_ds: Any,
    seed: int,
    max_epochs: int,
    patience: int,
    batch_size: int,
    device: torch.device,
    cpu_sample_rows: int,
) -> dict[str, Any]:
    torch.manual_seed(seed)
    np.random.seed(seed)
    random.seed(seed)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(seed)
    train_tab, val_tab, eval_tab, norm = standardize_three(train.tab, val.tab, eval_ds.tab)
    seq_train = torch.from_numpy(train.seq).to(device)
    ctx_train = torch.from_numpy(train.ctx).to(device)
    tab_train = torch.from_numpy(train_tab).to(device)
    y_train = torch.from_numpy(train.residual).to(device)
    seq_val = torch.from_numpy(val.seq).to(device)
    ctx_val = torch.from_numpy(val.ctx).to(device)
    tab_val = torch.from_numpy(val_tab).to(device)
    y_val = torch.from_numpy(val.residual).to(device)
    seq_eval = torch.from_numpy(eval_ds.seq).to(device)
    ctx_eval = torch.from_numpy(eval_ds.ctx).to(device)
    tab_eval = torch.from_numpy(eval_tab).to(device)
    model = make_model(spec, train).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_fn = nn.SmoothL1Loss(beta=0.2)
    best_loss = float("inf")
    best_epoch = 0
    best_state: dict[str, torch.Tensor] | None = None
    wait = 0
    history: list[dict[str, float]] = []
    started = time.perf_counter()
    n = seq_train.shape[0]
    for epoch in range(1, max_epochs + 1):
        model.train()
        order = torch.randperm(n, device=device)
        running = 0.0
        steps = 0
        for start in range(0, n, batch_size):
            idx = order[start:start + batch_size]
            optimizer.zero_grad(set_to_none=True)
            pred = model(seq_train[idx], ctx_train[idx], tab_train[idx])
            loss = loss_fn(pred, y_train[idx])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            running += float(loss.detach().cpu())
            steps += 1
        model.eval()
        val_running = 0.0
        val_steps = 0
        with torch.no_grad():
            for start in range(0, seq_val.shape[0], batch_size):
                end = min(start + batch_size, seq_val.shape[0])
                val_loss = loss_fn(model(seq_val[start:end], ctx_val[start:end], tab_val[start:end]), y_val[start:end])
                val_running += float(val_loss.detach().cpu())
                val_steps += 1
        train_loss = running / max(1, steps)
        val_loss_mean = val_running / max(1, val_steps)
        history.append({"epoch": epoch, "trainLoss": train_loss, "validationLoss": val_loss_mean})
        if val_loss_mean < best_loss - 1e-4:
            best_loss = val_loss_mean
            best_epoch = epoch
            wait = 0
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
        else:
            wait += 1
            if wait >= patience:
                break
    if best_state is not None:
        model.load_state_dict({key: value.to(device) for key, value in best_state.items()})
    if device.type == "cuda":
        torch.cuda.synchronize()
    train_sec = time.perf_counter() - started
    val_pred, val_inf_sec = predict_torch(model, seq_val, ctx_val, tab_val, batch_size, True)
    eval_pred, eval_inf_sec = predict_torch(model, seq_eval, ctx_eval, tab_eval, batch_size, True)
    cpu_rows = min(cpu_sample_rows, eval_ds.target.shape[0])
    cpu_model = make_model(spec, train)
    cpu_model.load_state_dict({key: value.cpu() for key, value in model.state_dict().items()})
    cpu_model.eval()
    cpu_seq = torch.from_numpy(eval_ds.seq[:cpu_rows])
    cpu_ctx = torch.from_numpy(eval_ds.ctx[:cpu_rows])
    cpu_tab = torch.from_numpy(eval_tab[:cpu_rows])
    _, cpu_sec = predict_torch(cpu_model, cpu_seq, cpu_ctx, cpu_tab, min(batch_size, cpu_rows), False)
    cpu_rows_per_sec = float(cpu_rows / cpu_sec) if cpu_sec > 0 else None
    param_count = p3.count_params(model)
    macs = estimate_macs(spec, train)
    meta = {
        "trainSec": train_sec,
        "validationInferenceSec": val_inf_sec,
        "evalInferenceSec": eval_inf_sec,
        "gpuEvalRowsPerSec": float(eval_ds.target.shape[0] / eval_inf_sec) if eval_inf_sec > 0 else None,
        "latencyUsPerSampleGpu": float(1_000_000.0 / (eval_ds.target.shape[0] / eval_inf_sec)) if eval_inf_sec > 0 else None,
        "cpuSampleRows": int(cpu_rows),
        "cpuSampleSec": cpu_sec,
        "paramCount": param_count,
        "epochsRun": len(history),
        "bestEpoch": best_epoch,
        "bestValidationLoss": best_loss,
        "lossHistory": history,
        "normalization": norm,
        "simdEstimate": simd_estimate(spec, cpu_rows_per_sec, macs),
    }
    del model, cpu_model, optimizer, seq_train, ctx_train, tab_train, y_train, seq_val, ctx_val, tab_val, y_val, seq_eval, ctx_eval, tab_eval
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return {"valPred": val_pred, "evalPred": eval_pred, "meta": meta}


def rfn_train_predict(
    spec: dict[str, Any],
    train: Any,
    val: Any,
    eval_ds: Any,
    seed: int,
    cpu_sample_rows: int,
) -> dict[str, Any]:
    started = time.perf_counter()
    train_tab, val_tab, eval_tab, norm = standardize_three(train.tab, val.tab, eval_ds.tab)
    rng = np.random.default_rng(seed)
    features = int(spec["randomFeatures"])
    ridge = float(spec["ridge"])
    w = rng.normal(0.0, 1.0 / math.sqrt(train_tab.shape[1]), size=(train_tab.shape[1], features)).astype(np.float32)
    b = rng.uniform(0.0, 2.0 * math.pi, size=(features,)).astype(np.float32)

    def transform(x: np.ndarray) -> np.ndarray:
        return (math.sqrt(2.0 / features) * np.cos(x @ w + b)).astype(np.float32)

    z_train = transform(train_tab)
    lhs = z_train.T @ z_train + ridge * np.eye(features, dtype=np.float32)
    rhs = z_train.T @ train.residual.astype(np.float32)
    coef = np.linalg.solve(lhs, rhs).astype(np.float32)
    train_sec = time.perf_counter() - started
    inf_started = time.perf_counter()
    val_pred = (transform(val_tab) @ coef).astype(np.float32) * 50.0
    val_inf_sec = time.perf_counter() - inf_started
    inf_started = time.perf_counter()
    eval_pred = (transform(eval_tab) @ coef).astype(np.float32) * 50.0
    eval_inf_sec = time.perf_counter() - inf_started
    cpu_rows = min(cpu_sample_rows, eval_ds.target.shape[0])
    cpu_started = time.perf_counter()
    _ = (transform(eval_tab[:cpu_rows]) @ coef).astype(np.float32)
    cpu_sec = time.perf_counter() - cpu_started
    cpu_rows_per_sec = float(cpu_rows / cpu_sec) if cpu_sec > 0 else None
    macs = estimate_macs(spec, train)
    return {
        "valPred": val_pred,
        "evalPred": eval_pred,
        "meta": {
            "trainSec": train_sec,
            "validationInferenceSec": val_inf_sec,
            "evalInferenceSec": eval_inf_sec,
            "gpuEvalRowsPerSec": None,
            "latencyUsPerSampleGpu": None,
            "cpuSampleRows": int(cpu_rows),
            "cpuSampleSec": cpu_sec,
            "paramCount": int(w.size + b.size + coef.size),
            "epochsRun": 0,
            "bestEpoch": None,
            "bestValidationLoss": None,
            "lossHistory": [],
            "normalization": norm,
            "randomFeatures": features,
            "ridge": ridge,
            "simdEstimate": simd_estimate(spec, cpu_rows_per_sec, macs),
        },
    }


def alpha_beta_correction(dataset: Any) -> np.ndarray:
    return p4.alpha_beta_correction(dataset)


def fixed_gate_specs() -> list[dict[str, Any]]:
    specs = []
    for residual in RESIDUAL_THRESHOLDS:
        for cosine in COS_THRESHOLDS:
            for baseline_limit in BASELINE_DISP_LIMITS:
                specs.append({
                    "id": f"common-r{int(residual)}-cos{str(cosine).replace('.', '')}-base{int(baseline_limit)}-or-eff09",
                    "kind": "common-agreement-baseline-or-efficiency",
                    "residualMaxPx": residual,
                    "cosineMin": cosine,
                    "baselineDispMaxPx": baseline_limit,
                    "efficiencyMin": 0.9,
                })
    return specs


def apply_fixed_gate(dataset: Any, residual_px: np.ndarray, ab_corr: np.ndarray, spec: dict[str, Any]) -> np.ndarray:
    mag = np.linalg.norm(residual_px, axis=1)
    ab_mag = np.linalg.norm(ab_corr, axis=1)
    dot = np.sum(residual_px * ab_corr, axis=1)
    cos = dot / np.maximum(mag * ab_mag, 1e-6)
    baseline_disp = dataset.ctx[:, 8].astype(np.float32) * 24.0
    efficiency = dataset.ctx[:, 4].astype(np.float32)
    mask = (
        (mag <= spec["residualMaxPx"])
        & (ab_mag >= 0.5)
        & (cos >= spec["cosineMin"])
        & ((baseline_disp <= spec["baselineDispMaxPx"]) | (efficiency >= spec["efficiencyMin"]))
    )
    return np.where(mask[:, None], residual_px, 0.0).astype(np.float32)


def run_teacher_fold(
    spec: dict[str, Any],
    train_full: Any,
    eval_ds: Any,
    fold_name: str,
    seed: int,
    args: argparse.Namespace,
    device: torch.device,
) -> dict[str, Any]:
    train70, val30 = split_dataset(train_full)
    if spec["family"] == "rfn":
        result = rfn_train_predict(spec, train70, val30, eval_ds, seed, args.cpu_sample_rows)
    else:
        result = train_torch_teacher(spec, train70, val30, eval_ds, seed, args.max_epochs, args.patience, args.batch_size, device, args.cpu_sample_rows)
    val_eval = compact_eval(val30, result["valPred"])
    eval_eval = compact_eval(eval_ds, result["evalPred"])
    baseline_val = compact_eval(val30, np.zeros_like(val30.baseline, dtype=np.float32))
    baseline_eval = compact_eval(eval_ds, np.zeros_like(eval_ds.baseline, dtype=np.float32))
    return {
        "fold": fold_name,
        "teacher": spec["id"],
        "spec": spec,
        "trainRows": int(train70.target.shape[0]),
        "validationRows": int(val30.target.shape[0]),
        "evalRows": int(eval_ds.target.shape[0]),
        "meta": result["meta"],
        "valDataset": val30,
        "evalDataset": eval_ds,
        "valPred": result["valPred"],
        "evalPred": result["evalPred"],
        "abVal": alpha_beta_correction(val30),
        "abEval": alpha_beta_correction(eval_ds),
        "baselineValidation": baseline_val,
        "baselineEvaluation": baseline_eval,
        "unguardedValidation": val_eval,
        "unguardedEvaluation": eval_eval,
    }


def aggregate_baseline(fold_results: list[dict[str, Any]], split_name: str) -> dict[str, Any]:
    key = "baselineValidation" if split_name == "validation" else "baselineEvaluation"
    ds_key = "valDataset" if split_name == "validation" else "evalDataset"
    return aggregate_error_sets([result[key] for result in fold_results], [result[ds_key].baseline_error for result in fold_results])


def aggregate_teacher_gate(
    fold_results: list[dict[str, Any]],
    gate: dict[str, Any] | None,
    split_name: str,
) -> dict[str, Any]:
    parts = []
    baselines = []
    for result in fold_results:
        if split_name == "validation":
            dataset = result["valDataset"]
            residual = result["valPred"]
            ab = result["abVal"]
        else:
            dataset = result["evalDataset"]
            residual = result["evalPred"]
            ab = result["abEval"]
        if gate is not None:
            residual = apply_fixed_gate(dataset, residual, ab, gate)
        parts.append(compact_eval(dataset, residual))
        baselines.append(dataset.baseline_error)
    aggregate = aggregate_error_sets(parts, baselines)
    aggregate["perFold"] = [without_errors(part) for part in parts]
    return aggregate


def choose_best(entries: list[dict[str, Any]], mode: str, baseline_validation: dict[str, Any]) -> dict[str, Any]:
    return min(entries, key=lambda entry: objective(entry["validationAggregate"], baseline_validation, mode))


def summarize_phase(teacher_fold_results: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    first_teacher = next(iter(teacher_fold_results.values()))
    baseline_validation = aggregate_baseline(first_teacher, "validation")
    baseline_evaluation = aggregate_baseline(first_teacher, "evaluation")
    gates = fixed_gate_specs()
    teacher_summaries = []
    gate_summaries = []
    for teacher_id, fold_results in teacher_fold_results.items():
        spec = fold_results[0]["spec"]
        validation = aggregate_teacher_gate(fold_results, None, "validation")
        evaluation = aggregate_teacher_gate(fold_results, None, "evaluation")
        teacher_summaries.append({
            "id": teacher_id,
            "spec": spec,
            "role": "unguarded_teacher",
            "validationAggregate": validation,
            "evaluationAggregate": evaluation,
            "metaByFold": [
                {
                    "fold": result["fold"],
                    "trainRows": result["trainRows"],
                    "validationRows": result["validationRows"],
                    "evalRows": result["evalRows"],
                    "meta": result["meta"],
                }
                for result in fold_results
            ],
        })
        for gate in gates:
            validation_gate = aggregate_teacher_gate(fold_results, gate, "validation")
            evaluation_gate = aggregate_teacher_gate(fold_results, gate, "evaluation")
            gate_summaries.append({
                "id": f"{teacher_id}__{gate['id']}",
                "teacher": teacher_id,
                "gate": gate,
                "role": "fixed_common_gate",
                "validationAggregate": validation_gate,
                "evaluationAggregate": evaluation_gate,
                "metaByFold": [
                    {
                        "fold": result["fold"],
                        "trainRows": result["trainRows"],
                        "validationRows": result["validationRows"],
                        "evalRows": result["evalRows"],
                        "meta": result["meta"],
                    }
                    for result in fold_results
                ],
            })
    best_validation_teacher = choose_best(teacher_summaries, "balanced", baseline_validation)
    best_evaluation_teacher = min(teacher_summaries, key=lambda entry: (
        entry["evaluationAggregate"]["metrics"]["p95"] or float("inf"),
        entry["evaluationAggregate"]["metrics"]["p99"] or float("inf"),
        entry["evaluationAggregate"]["metrics"]["mean"] or float("inf"),
    ))
    best_gate_strict = choose_best(gate_summaries, "strict", baseline_validation)
    best_gate_balanced = choose_best(gate_summaries, "balanced", baseline_validation)
    product_feasible_gates = [entry for entry in gate_summaries if entry["teacher"] != "rfn_seq32_rff768_ridge01"]
    best_product_feasible_gate_balanced = choose_best(product_feasible_gates, "balanced", baseline_validation)
    teacher_summaries.sort(key=lambda entry: (
        entry["evaluationAggregate"]["metrics"]["p95"] or float("inf"),
        entry["evaluationAggregate"]["metrics"]["p99"] or float("inf"),
        entry["evaluationAggregate"]["regressionsVsBaseline"]["worseOver5px"],
    ))
    gate_summaries.sort(key=lambda entry: (
        objective(entry["validationAggregate"], baseline_validation, "balanced"),
        entry["evaluationAggregate"]["metrics"]["p95"] or float("inf"),
    ))
    return {
        "baselineValidationAggregate": baseline_validation,
        "baselineEvaluationAggregate": baseline_evaluation,
        "bestTeacher": best_evaluation_teacher,
        "bestValidationObjectiveTeacher": best_validation_teacher,
        "bestFixedCommonGateStrict": best_gate_strict,
        "bestFixedCommonGateBalanced": best_gate_balanced,
        "bestProductFeasibleFixedCommonGateBalanced": best_product_feasible_gate_balanced,
        "teacherSummaries": teacher_summaries,
        "fixedGateTopBalanced": gate_summaries[:20],
        "fixedGateCandidateCount": len(gate_summaries),
    }


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items() if not str(k).startswith("_")}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        value = float(value)
    if isinstance(value, float):
        if math.isnan(value):
            return None
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        return value
    return value


def fmt(value: Any, digits: int = 3) -> str:
    if value is None:
        return ""
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return str(value)


def md_table(headers: list[str], rows: list[list[str]]) -> str:
    return "\n".join([
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
        *["| " + " | ".join(row) + " |" for row in rows],
    ])


def metric_row(label: str, entry: dict[str, Any], aggregate_key: str = "evaluationAggregate") -> list[str]:
    agg = entry[aggregate_key]
    metrics = agg["metrics"]
    reg = agg["regressionsVsBaseline"]
    return [
        label,
        entry["id"],
        fmt(metrics["mean"]),
        fmt(metrics["rmse"]),
        fmt(metrics["p95"]),
        fmt(metrics["p99"]),
        fmt(metrics["max"]),
        str(reg["worseOver1px"]),
        str(reg["worseOver5px"]),
        str(reg["improvedOver1px"]),
    ]


def meta_summary(entry: dict[str, Any]) -> dict[str, Any]:
    metas = [item["meta"] for item in entry["metaByFold"]]
    eval_rows = [item["evalRows"] for item in entry["metaByFold"]]
    total_eval_rows = sum(eval_rows)
    total_train_sec = sum(meta["trainSec"] for meta in metas)
    total_eval_sec = sum(meta["evalInferenceSec"] for meta in metas)
    gpu_rows = total_eval_rows / total_eval_sec if total_eval_sec > 0 else None
    cpu_rows_values = [meta["simdEstimate"]["pyTorchCpuRowsPerSec"] for meta in metas if meta["simdEstimate"]["pyTorchCpuRowsPerSec"]]
    cpu_rows = float(np.mean(cpu_rows_values)) if cpu_rows_values else None
    low_values = [meta["simdEstimate"]["estimatedCSharpSimdRowsPerSecLow"] for meta in metas if meta["simdEstimate"]["estimatedCSharpSimdRowsPerSecLow"]]
    high_values = [meta["simdEstimate"]["estimatedCSharpSimdRowsPerSecHigh"] for meta in metas if meta["simdEstimate"]["estimatedCSharpSimdRowsPerSecHigh"]]
    return {
        "params": int(np.mean([meta["paramCount"] for meta in metas])),
        "trainSecTotal": total_train_sec,
        "gpuEvalRowsPerSec": gpu_rows,
        "cpuPyTorchRowsPerSecMean": cpu_rows,
        "csharpSimdRowsPerSecLowMean": float(np.mean(low_values)) if low_values else None,
        "csharpSimdRowsPerSecHighMean": float(np.mean(high_values)) if high_values else None,
        "epochsRun": [meta["epochsRun"] for meta in metas],
        "bestEpoch": [meta["bestEpoch"] for meta in metas],
    }


def render_markdown(result: dict[str, Any]) -> str:
    phase = result["phase"]
    baseline = {"id": "product-baseline", "evaluationAggregate": phase["baselineEvaluationAggregate"]}
    best_teacher = phase["bestTeacher"]
    best_validation_teacher = phase["bestValidationObjectiveTeacher"]
    best_strict = phase["bestFixedCommonGateStrict"]
    best_balanced = phase["bestFixedCommonGateBalanced"]
    best_product_gate = phase["bestProductFeasibleFixedCommonGateBalanced"]
    headline_rows = [
        metric_row("baseline", baseline),
        metric_row("best eval teacher", best_teacher),
        metric_row("validation objective teacher", best_validation_teacher),
        metric_row("strict common gate", best_strict),
        metric_row("balanced common gate", best_balanced),
        metric_row("balanced non-RFN gate", best_product_gate),
    ]
    teacher_rows = []
    for entry in phase["teacherSummaries"][:10]:
        metrics = entry["evaluationAggregate"]["metrics"]
        reg = entry["evaluationAggregate"]["regressionsVsBaseline"]
        meta = meta_summary(entry)
        teacher_rows.append([
            entry["id"],
            entry["spec"]["family"],
            str(entry["spec"]["seqLen"]),
            fmt(metrics["p95"]),
            fmt(metrics["p99"]),
            fmt(metrics["mean"]),
            str(reg["worseOver5px"]),
            str(meta["params"]),
            fmt(meta["trainSecTotal"]),
            fmt(meta["gpuEvalRowsPerSec"], 1),
            fmt(meta["cpuPyTorchRowsPerSecMean"], 1),
        ])
    gate_rows = []
    for entry in phase["fixedGateTopBalanced"][:12]:
        metrics = entry["evaluationAggregate"]["metrics"]
        reg = entry["evaluationAggregate"]["regressionsVsBaseline"]
        meta = meta_summary(entry)
        gate_rows.append([
            entry["teacher"],
            entry["gate"]["id"],
            fmt(metrics["p95"]),
            fmt(metrics["p99"]),
            fmt(metrics["mean"]),
            str(reg["worseOver1px"]),
            str(reg["worseOver5px"]),
            str(reg["improvedOver1px"]),
            fmt(meta["gpuEvalRowsPerSec"], 1),
        ])
    best_meta = meta_summary(best_teacher)
    gate_meta = meta_summary(best_balanced)
    return f"""# Cursor Prediction v9 Phase 5 Expanded Teachers

Generated: {result['generatedAt']}

Device: `{result['environment']['device']}`  
Torch: `{result['environment']['torchVersion']}`  
CUDA available: `{result['environment']['cudaAvailable']}`

Training used each train session's first 70%, selected early-stopped weights on
the trailing 30%, and evaluated on the other session. Fixed common gates used
the same rule in both folds. No Calibrator run, checkpoint, cache, TensorBoard,
or large dataset artifact was written.

## Headline Evaluation

{md_table(["role", "candidate", "mean", "rmse", "p95", "p99", "max", ">1px reg", ">5px reg", ">1px improved"], headline_rows)}

## Best Teacher Runtime

Best teacher: `{best_teacher['id']}`  
Params: `{best_meta['params']}`  
Train sec total: `{fmt(best_meta['trainSecTotal'])}`  
GPU eval rows/sec: `{fmt(best_meta['gpuEvalRowsPerSec'], 1)}`  
PyTorch CPU rows/sec sample mean: `{fmt(best_meta['cpuPyTorchRowsPerSecMean'], 1)}`  
C# SIMD estimate rows/sec: `{fmt(best_meta['csharpSimdRowsPerSecLowMean'], 1)}` to `{fmt(best_meta['csharpSimdRowsPerSecHighMean'], 1)}`

Best balanced fixed gate: `{best_balanced['id']}`  
Gate GPU rows/sec follows the same teacher inference cost plus a small scalar
mask; estimate: `{fmt(gate_meta['gpuEvalRowsPerSec'], 1)}` rows/sec before mask.

Best non-RFN balanced fixed gate: `{best_product_gate['id']}`.

## Teacher Ranking

{md_table(["teacher", "family", "seq", "p95", "p99", "mean", ">5px reg", "params", "train sec", "GPU rows/sec", "CPU rows/sec"], teacher_rows)}

## Fixed Common Gate Ranking

{md_table(["teacher", "gate", "p95", "p99", "mean", ">1px reg", ">5px reg", ">1px improved", "GPU rows/sec"], gate_rows)}
"""


def failure_result(args: argparse.Namespace, started: float, error: Exception) -> dict[str, Any]:
    return {
        "schemaVersion": "cursor-prediction-v9-phase5-expanded-teachers/1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runtimeSec": time.perf_counter() - started,
        "status": "failed",
        "error": repr(error),
        "policy": {
            "inputTraces": p3.TRACE_FILES,
            "largeArtifactsWritten": False,
            "calibratorRun": False,
        },
    }


def main() -> None:
    args = parse_args()
    started = time.perf_counter()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    try:
        traces = [p3.load_trace(args.root, name, f"session-{i + 1}") for i, name in enumerate(p3.TRACE_FILES)]
        datasets_by_len: dict[int, list[Any]] = {}
        for seq_len in sorted({spec["seqLen"] for spec in TEACHERS}):
            datasets_by_len[seq_len] = [p3.build_dataset(trace, seq_len=seq_len) for trace in traces]
        teacher_fold_results: dict[str, list[dict[str, Any]]] = {}
        failures: list[dict[str, Any]] = []
        for teacher_index, spec in enumerate(TEACHERS):
            fold_results = []
            datasets = datasets_by_len[spec["seqLen"]]
            folds = [
                ("train-session-1-eval-session-2", datasets[0], datasets[1], args.seed + teacher_index * 1000 + 1),
                ("train-session-2-eval-session-1", datasets[1], datasets[0], args.seed + teacher_index * 1000 + 501),
            ]
            for fold_name, train_ds, eval_ds, seed in folds:
                try:
                    fold_results.append(run_teacher_fold(spec, train_ds, eval_ds, fold_name, seed, args, device))
                except Exception as exc:
                    failures.append({"teacher": spec["id"], "fold": fold_name, "error": repr(exc)})
            if len(fold_results) == 2:
                teacher_fold_results[spec["id"]] = fold_results
        if not teacher_fold_results:
            raise RuntimeError("No teacher completed both folds")
        phase = summarize_phase(teacher_fold_results)
        if device.type == "cuda":
            torch.cuda.synchronize()
        result = {
            "schemaVersion": "cursor-prediction-v9-phase5-expanded-teachers/1",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "runtimeSec": time.perf_counter() - started,
            "status": "ok",
            "policy": {
                "inputTraces": p3.TRACE_FILES,
                "horizonsMs": p3.HORIZONS_MS,
                "sequenceLengths": sorted(datasets_by_len.keys()),
                "trainValidationSplit": "first 70% train, trailing 30% validation within train session",
                "target": "referencePoll position at anchor time + horizon",
                "predictionTarget": "residual over product_constant_velocity_v8_shape with fixed common gates",
                "maxEpochs": args.max_epochs,
                "earlyStoppingPatience": args.patience,
                "causalInputsOnly": True,
                "largeArtifactsWritten": False,
                "calibratorRun": False,
            },
            "environment": {
                "python": ".".join(map(str, tuple(sys.version_info[:3]))),
                "torchVersion": torch.__version__,
                "cudaAvailable": torch.cuda.is_available(),
                "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
                "torchCpuThreads": torch.get_num_threads(),
            },
            "datasets": {
                str(seq_len): [dataset.summary for dataset in datasets]
                for seq_len, datasets in datasets_by_len.items()
            },
            "teacherSpecs": TEACHERS,
            "fixedGateSpecs": fixed_gate_specs(),
            "failures": failures,
            "phase": phase,
        }
    except Exception as exc:
        result = failure_result(args, started, exc)
    args.out_json.write_text(json.dumps(json_safe(result), indent=2) + "\n", encoding="utf-8")
    args.out_md.write_text(
        render_markdown(result) if result.get("status") == "ok" else f"# Cursor Prediction v9 Phase 5 Expanded Teachers\n\nFailed: `{result['error']}`\n",
        encoding="utf-8",
    )
    print(f"Wrote {args.out_json}")
    print(f"Wrote {args.out_md}")
    print(f"Runtime seconds: {result['runtimeSec']:.3f}")
    if result.get("status") != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
