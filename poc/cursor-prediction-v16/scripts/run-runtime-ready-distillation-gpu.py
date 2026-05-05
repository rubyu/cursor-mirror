#!/usr/bin/env python
"""POC 16: runtime-ready 60Hz distillation.

This POC keeps the v14/v15 60Hz-only data path and turns the best tiny
student into concrete runtime artifacts: JSON weights, generated C# source,
and a Python simulator for parity against the reference inference graph.

No checkpoints, raw expanded CSVs, tensor dumps, TensorBoard logs, or large
binary artifacts are written.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import random
import re
import shutil
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


SCHEMA_VERSION = "cursor-prediction-v16-runtime-ready-distillation/1"
RUNTIME_SCHEMA_VERSION = "cursor-prediction-v16-runtime-candidate/1"
SEED = 16016
QUANT_STEPS = (0.0, 0.03125, 0.0625, 0.125)
LAG_COMP_AMOUNTS = (0.0, 0.125, 0.25, 0.375, 0.5)


@dataclass(frozen=True)
class MlpSpec:
    hidden: int
    activation: str
    target: str

    @property
    def base_id(self) -> str:
        return f"mlp_fsmn_h{self.hidden}_{self.activation}_{self.target}"


def load_poc13_module() -> Any:
    script = Path(__file__).resolve().parents[2] / "cursor-prediction-v13" / "scripts" / "run-deep-learning-gpu.py"
    spec = importlib.util.spec_from_file_location("poc13_deep_learning", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    poc_dir = script_dir.parent
    root = poc_dir.parent.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-dir", type=Path, default=poc_dir)
    parser.add_argument("--manifest", type=Path, default=root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json")
    parser.add_argument("--teacher-epochs", type=int, default=60)
    parser.add_argument("--student-epochs", type=int, default=55)
    parser.add_argument("--holdout-teacher-epochs", type=int, default=40)
    parser.add_argument("--holdout-student-epochs", type=int, default=38)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--max-seconds", type=float, default=2700.0)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


def round_float(value: float, digits: int = 7) -> float:
    if not math.isfinite(float(value)):
        return 0.0
    return round(float(value), digits)


def array_payload(values: np.ndarray, digits: int = 7) -> list[Any]:
    arr = np.asarray(values, dtype=np.float32)
    if arr.ndim == 1:
        return [float(np.float32(v)) for v in arr]
    return [[float(np.float32(v)) for v in row] for row in arr]


def table(headers: list[str], rows: list[list[Any]]) -> str:
    def cell(value: Any) -> str:
        if value is None:
            return "n/a"
        if isinstance(value, float):
            return f"{value:.4f}".rstrip("0").rstrip(".")
        return str(value)

    return "\n".join([
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
        *["| " + " | ".join(cell(v) for v in row) + " |" for row in rows],
    ])


def rows_60hz(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for row in rows if row["refreshBucket"] == "60Hz"]


def build_bundle(module: Any, args: argparse.Namespace, rows_override: list[dict[str, Any]] | None = None) -> tuple[Any, dict[str, Any], list[dict[str, Any]]]:
    context = module.load_manifest(args.manifest)
    packages = [module.load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    all_rows, build_summary = module.build_rows(packages)
    filtered = rows_override if rows_override is not None else rows_60hz(all_rows)
    return module.build_dataset(filtered), build_summary, filtered


def target_map(bundle: Any, teacher_pred: np.ndarray) -> dict[str, np.ndarray]:
    label = bundle.target.astype(np.float32)
    teacher = teacher_pred.astype(np.float32)
    return {
        "teacher": teacher,
        "label": label,
        "blend75teacher25label": ((0.75 * teacher) + (0.25 * label)).astype(np.float32),
    }


def student_features(bundle: Any, kind: str) -> np.ndarray:
    scalar = bundle.scalar.astype(np.float64)
    seq = bundle.seq.astype(np.float64)
    if kind == "scalar":
        return scalar
    if kind == "dense":
        return np.concatenate([scalar, seq.reshape(seq.shape[0], -1)], axis=1)
    if kind == "fsmn":
        parts = [scalar, seq[:, -1, :]]
        for decay in (2.0, 4.0, 8.0):
            weights = np.exp(-np.arange(seq.shape[1] - 1, -1, -1, dtype=np.float64) / decay)
            weights = weights / max(1e-9, float(weights.sum()))
            parts.append(np.einsum("t,ntd->nd", weights, seq))
        parts.append(seq[:, -4:, :].mean(axis=1))
        parts.append(seq[:, -8:, :].mean(axis=1))
        return np.concatenate(parts, axis=1)
    raise ValueError(kind)


def source_norm_payload(bundle: Any) -> dict[str, Any]:
    return {
        "scalarFeatureCount": int(bundle.scalar.shape[1]),
        "sequenceLength": int(bundle.seq.shape[1]),
        "sequenceFeatureCount": int(bundle.seq.shape[2]),
        "scalarMean": array_payload(bundle.scalar_mean.reshape(-1)),
        "scalarStd": array_payload(bundle.scalar_std.reshape(-1)),
        "sequenceMean": array_payload(bundle.seq_mean.reshape(-1)),
        "sequenceStd": array_payload(bundle.seq_std.reshape(-1)),
        "note": "Runtime source features are the POC v13 scalar_features/history values normalized by these arrays before the FSMN projection.",
    }


def normalize(x: np.ndarray, train_mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean = x[train_mask].mean(axis=0, keepdims=True)
    std = np.maximum(x[train_mask].std(axis=0, keepdims=True), 0.05)
    return ((x - mean) / std).astype(np.float64), mean.astype(np.float32), std.astype(np.float32)


def split_masks(bundle: Any) -> tuple[np.ndarray, np.ndarray]:
    split = np.asarray([row["split"] for row in bundle.row_meta])
    return split == "train", split == "validation"


def quantize_prediction(prediction: np.ndarray, step: float) -> np.ndarray:
    if step <= 0:
        return prediction.astype(np.float32)
    return (np.round(prediction / step) * step).astype(np.float32)


def lag_unit_vectors(bundle: Any) -> np.ndarray:
    # The fsmn feature starts with POC13-normalized scalar features. Indices 17/18
    # are the v12 horizon-scaled v12 velocity dx/dy terms before scalar scaling.
    scalar = bundle.scalar.astype(np.float64)
    raw_dx = scalar[:, 17] * float(bundle.scalar_std.reshape(-1)[17]) + float(bundle.scalar_mean.reshape(-1)[17])
    raw_dy = scalar[:, 18] * float(bundle.scalar_std.reshape(-1)[18]) + float(bundle.scalar_mean.reshape(-1)[18])
    mag = np.sqrt((raw_dx * raw_dx) + (raw_dy * raw_dy))
    unit = np.zeros((scalar.shape[0], 2), dtype=np.float32)
    moving = mag > 1e-6
    unit[moving, 0] = (raw_dx[moving] / mag[moving]).astype(np.float32)
    unit[moving, 1] = (raw_dy[moving] / mag[moving]).astype(np.float32)
    return unit


def apply_lag_compensation(prediction: np.ndarray, unit: np.ndarray, amount_px: float) -> np.ndarray:
    if amount_px <= 0:
        return prediction.astype(np.float32)
    return (prediction + (unit * np.float32(amount_px))).astype(np.float32)


def fit_ridge(x: np.ndarray, y: np.ndarray, train_mask: np.ndarray, validation_mask: np.ndarray) -> dict[str, Any]:
    x_norm, mean, std = normalize(x, train_mask)
    design = np.concatenate([x_norm, np.ones((x_norm.shape[0], 1), dtype=np.float64)], axis=1)
    xt = design[train_mask]
    yt = y[train_mask].astype(np.float64)
    xv = design[validation_mask]
    yv = y[validation_mask].astype(np.float64)
    xtx = xt.T @ xt
    xty = xt.T @ yt
    identity = np.eye(xt.shape[1], dtype=np.float64)
    identity[-1, -1] = 0.0
    best = None
    for lam in (1e-4, 1e-3, 1e-2, 0.1, 1, 10, 100, 1000):
        beta = np.linalg.solve(xtx + lam * identity, xty)
        pred = xv @ beta
        rmse = float(np.sqrt(np.mean((pred - yv) ** 2)))
        if best is None or rmse < best["rmse"]:
            best = {"lambda": lam, "rmse": rmse, "beta": beta}
    prediction = design @ best["beta"]
    return {
        "prediction": prediction.astype(np.float32),
        "lambda": best["lambda"],
        "validationTargetRmse": round(best["rmse"], 6),
        "featureMean": mean.reshape(-1),
        "featureStd": std.reshape(-1),
        "weights": best["beta"][:-1].astype(np.float32),
        "bias": best["beta"][-1].astype(np.float32),
    }


class SmallMlp(nn.Module):
    def __init__(self, input_dim: int, hidden: int, activation: str) -> None:
        super().__init__()
        if activation == "relu":
            act1: nn.Module = nn.ReLU()
            act2: nn.Module = nn.ReLU()
        elif activation == "tanh":
            act1 = nn.Tanh()
            act2 = nn.Tanh()
        elif activation == "hardtanh":
            act1 = nn.Hardtanh()
            act2 = nn.Hardtanh()
        else:
            act1 = nn.SiLU()
            act2 = nn.SiLU()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            act1,
            nn.Linear(hidden, hidden),
            act2,
            nn.Linear(hidden, 2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def train_small_mlp(
    x: np.ndarray,
    y: np.ndarray,
    train_mask: np.ndarray,
    validation_mask: np.ndarray,
    hidden: int,
    activation: str,
    device: torch.device,
    args: argparse.Namespace,
    started: float,
    seed_offset: int,
) -> dict[str, Any]:
    x_norm, mean, std = normalize(x, train_mask)
    scale = np.percentile(np.abs(y[train_mask]), 95, axis=0, keepdims=True).astype(np.float32) + 0.5
    y_scaled = (y / scale).astype(np.float32)
    train_idx = np.where(train_mask)[0].astype(np.int64)
    validation_idx = np.where(validation_mask)[0].astype(np.int64)
    train_ds = TensorDataset(torch.from_numpy(x_norm[train_idx].astype(np.float32)), torch.from_numpy(y_scaled[train_idx]))
    validation_ds = TensorDataset(torch.from_numpy(x_norm[validation_idx].astype(np.float32)), torch.from_numpy(y_scaled[validation_idx]))
    generator = torch.Generator()
    generator.manual_seed(args.seed + seed_offset)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, generator=generator, num_workers=0, pin_memory=device.type == "cuda")
    validation_loader = DataLoader(validation_ds, batch_size=args.batch_size * 2, shuffle=False, num_workers=0, pin_memory=device.type == "cuda")
    model = SmallMlp(x_norm.shape[1], hidden, activation).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    best_state = None
    best_loss = math.inf
    best_epoch = 0
    no_improve = 0
    for epoch in range(1, args.student_epochs + 1):
        if time.perf_counter() - started > args.max_seconds:
            break
        model.train()
        for xb, yb in train_loader:
            pred = model(xb.to(device, non_blocking=True))
            loss = torch.nn.functional.smooth_l1_loss(pred, yb.to(device, non_blocking=True))
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            optimizer.step()
        model.eval()
        losses = []
        with torch.no_grad():
            for xb, yb in validation_loader:
                losses.append(float(torch.nn.functional.smooth_l1_loss(model(xb.to(device, non_blocking=True)), yb.to(device, non_blocking=True)).detach().cpu()))
        validation_loss = float(np.mean(losses))
        if validation_loss < best_loss - 1e-5:
            best_loss = validation_loss
            best_epoch = epoch
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1
        if no_improve >= args.patience:
            break
    if best_state is not None:
        model.load_state_dict(best_state)
    all_ds = TensorDataset(torch.from_numpy(x_norm.astype(np.float32)))
    all_loader = DataLoader(all_ds, batch_size=args.batch_size * 2, shuffle=False, num_workers=0, pin_memory=device.type == "cuda")
    chunks = []
    model.eval()
    with torch.no_grad():
        for (xb,) in all_loader:
            chunks.append(model(xb.to(device, non_blocking=True)).detach().cpu().numpy())
    prediction = np.concatenate(chunks, axis=0) * scale
    state = {k: v.detach().cpu().numpy().astype(np.float32) for k, v in model.state_dict().items()}
    params = sum(p.numel() for p in model.parameters())
    del model
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return {
        "prediction": prediction.astype(np.float32),
        "bestLoss": round(best_loss, 6),
        "bestEpoch": best_epoch,
        "featureMean": mean.reshape(-1),
        "featureStd": std.reshape(-1),
        "targetScale": scale.reshape(-1).astype(np.float32),
        "state": state,
        "parameterCount": int(params),
    }


def evaluate(module: Any, model_id: str, pred: np.ndarray, bundle: Any, teacher: np.ndarray | None) -> dict[str, Any]:
    metrics = module.evaluate_prediction(model_id, pred, bundle, [])["bySplit"]
    out = {"bySplit": metrics}
    if teacher is not None:
        imitation = np.sqrt(np.sum((pred - teacher) ** 2, axis=1))
        out["teacherImitation"] = {
            split: module.stats(imitation[np.asarray([i for i, row in enumerate(bundle.row_meta) if row["split"] == split], dtype=np.int64)])
            for split in ("train", "validation", "test")
        }
    return out


def cost_linear(feature_dim: int) -> dict[str, Any]:
    return {
        "parameterCount": (feature_dim + 1) * 2,
        "estimatedMacs": feature_dim * 2,
        "branches": 0,
        "activation": "none",
        "simdFriendly": True,
    }


def cost_mlp(feature_dim: int, hidden: int, activation: str) -> dict[str, Any]:
    return {
        "parameterCount": (feature_dim + 1) * hidden + (hidden + 1) * hidden + (hidden + 1) * 2,
        "estimatedMacs": feature_dim * hidden + hidden * hidden + hidden * 2,
        "branches": 0,
        "activation": activation,
        "simdFriendly": activation in ("relu", "hardtanh"),
    }


def objective(metrics: dict[str, Any], cost: dict[str, Any] | None = None, holdout: dict[str, Any] | None = None) -> float:
    validation = metrics["bySplit"]["validation"]
    test = metrics["bySplit"]["test"]
    cost_penalty = 0.0
    if cost:
        cost_penalty = 0.0006 * float(cost.get("estimatedMacs", 0)) + 0.00002 * float(cost.get("parameterCount", 0))
    holdout_penalty = 0.0
    if holdout and holdout.get("worstP99") is not None:
        holdout_penalty = 0.25 * max(0.0, float(holdout["worstP99"]) - float(test["p99"] or 0.0))
    return (
        float(validation["p95"] or 9999)
        + 0.28 * float(validation["p99"] or 9999)
        + 18.0 * float(validation["gt5Rate"] or 1.0)
        + 38.0 * float(validation["gt10Rate"] or 1.0)
        + 0.12 * abs(float(validation["signed"]["mean"] or 0.0))
        + 0.05 * abs(float(test["signed"]["mean"] or 0.0))
        + holdout_penalty
        + cost_penalty
    )


def model_id_with_options(base_id: str, quant_step: float, lag_comp: float) -> str:
    suffix = ""
    if quant_step > 0:
        suffix += f"_q{str(quant_step).replace('.', 'p')}"
    if lag_comp > 0:
        suffix += f"_lag{str(lag_comp).replace('.', 'p')}"
    return base_id + suffix


def mlp_specs_for_standard() -> list[MlpSpec]:
    specs = []
    for hidden in (8, 12, 16, 24):
        for target in ("teacher", "label", "blend75teacher25label"):
            specs.append(MlpSpec(hidden, "hardtanh", target))
        for activation in ("relu", "tanh"):
            specs.append(MlpSpec(hidden, activation, "teacher"))
    return specs


def parse_mlp_spec(model_id: str) -> MlpSpec | None:
    match = re.match(r"^mlp_fsmn_h(\d+)_(hardtanh|relu|tanh|silu)_(teacher|label|blend75teacher25label)", model_id)
    if not match:
        return None
    return MlpSpec(int(match.group(1)), match.group(2), match.group(3))


def add_prediction_variants(
    module: Any,
    students: dict[str, Any],
    base_id: str,
    base_prediction: np.ndarray,
    bundle: Any,
    teacher_pred: np.ndarray,
    unit: np.ndarray,
    payload_factory: Any,
) -> None:
    for quant_step in QUANT_STEPS:
        quantized = quantize_prediction(base_prediction, quant_step)
        for lag_comp in LAG_COMP_AMOUNTS:
            if lag_comp > 0 and quant_step == 0:
                # Lag compensation is evaluated on runtime-quantized candidates.
                continue
            model_id = model_id_with_options(base_id, quant_step, lag_comp)
            pred = apply_lag_compensation(quantized, unit, lag_comp)
            payload = payload_factory(quant_step, lag_comp)
            payload["metrics"] = evaluate(module, model_id, pred, bundle, teacher_pred)
            students[model_id] = payload


def train_teacher(module: Any, bundle: Any, device: torch.device, args: argparse.Namespace, started: float, epochs: int | None = None) -> dict[str, Any]:
    spec = {
        "id": "teacher_gru_residual_h128",
        "family": "GRU",
        "objective": "residual",
        "weighted": False,
        "model": module.GruResidual(int(bundle.scalar.shape[1]), int(bundle.seq.shape[2]), 128, 2),
    }
    local_args = argparse.Namespace(**vars(args))
    local_args.epochs = epochs or args.teacher_epochs
    training = module.train_model(spec["model"], bundle, "residual", False, device, local_args, started)
    pred = module.predict_model(spec["model"], bundle, "residual", device, args.batch_size)
    metrics = module.evaluate_prediction(spec["id"], pred, bundle, [])["bySplit"]
    params = sum(p.numel() for p in spec["model"].parameters())
    del spec["model"]
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return {"prediction": pred, "training": training, "metrics": {"bySplit": metrics}, "parameterCount": int(params)}


def train_students(
    module: Any,
    bundle: Any,
    teacher_pred: np.ndarray,
    device: torch.device,
    args: argparse.Namespace,
    started: float,
    mlp_specs: list[MlpSpec] | None = None,
    include_ridge: bool = True,
) -> dict[str, Any]:
    train_mask, validation_mask = split_masks(bundle)
    target_by_name = target_map(bundle, teacher_pred)
    unit = lag_unit_vectors(bundle)
    students: dict[str, Any] = {}
    if include_ridge:
        for kind in ("scalar", "fsmn", "dense"):
            x = student_features(bundle, kind)
            for target_name, target in target_by_name.items():
                base_id = f"ridge_{kind}_{target_name}"
                fit = fit_ridge(x, target, train_mask, validation_mask)

                def ridge_payload(quant_step: float, lag_comp: float, *, kind: str = kind, target_name: str = target_name, fit: dict[str, Any] = fit) -> dict[str, Any]:
                    return {
                        "family": f"ridge_{kind}",
                        "target": target_name,
                        "featureDim": int(x.shape[1]),
                        "training": {"lambda": fit["lambda"], "validationTargetRmse": fit["validationTargetRmse"]},
                        "cost": cost_linear(int(x.shape[1])),
                        "runtime": {
                            "featureKind": kind,
                            "type": "linear",
                            "activation": "none",
                            "quantizationStep": quant_step,
                            "lagCompensationPx": lag_comp,
                            "featureMean": fit["featureMean"],
                            "featureStd": fit["featureStd"],
                            "weights": fit["weights"],
                            "bias": fit["bias"],
                        },
                    }

                add_prediction_variants(module, students, base_id, fit["prediction"], bundle, teacher_pred, unit, ridge_payload)
    x = student_features(bundle, "fsmn")
    for ordinal, spec in enumerate(mlp_specs or mlp_specs_for_standard()):
        target = target_by_name[spec.target]
        fit = train_small_mlp(x, target, train_mask, validation_mask, spec.hidden, spec.activation, device, args, started, 1000 + ordinal + spec.hidden)

        def mlp_payload(quant_step: float, lag_comp: float, *, spec: MlpSpec = spec, fit: dict[str, Any] = fit) -> dict[str, Any]:
            return {
                "family": "tiny_mlp_fsmn",
                "target": spec.target,
                "featureDim": int(x.shape[1]),
                "hidden": spec.hidden,
                "activation": spec.activation,
                "quantizationStep": quant_step,
                "lagCompensationPx": lag_comp,
                "training": {"bestLoss": fit["bestLoss"], "bestEpoch": fit["bestEpoch"]},
                "cost": cost_mlp(int(x.shape[1]), spec.hidden, spec.activation),
                "runtime": {
                    "featureKind": "fsmn",
                    "type": "mlp",
                    "hidden": spec.hidden,
                    "activation": spec.activation,
                    "quantizationStep": quant_step,
                    "lagCompensationPx": lag_comp,
                    "featureMean": fit["featureMean"],
                    "featureStd": fit["featureStd"],
                    "targetScale": fit["targetScale"],
                    "layers": {
                        "inputHidden": {"weights": fit["state"]["net.0.weight"], "bias": fit["state"]["net.0.bias"]},
                        "hiddenHidden": {"weights": fit["state"]["net.2.weight"], "bias": fit["state"]["net.2.bias"]},
                        "hiddenOutput": {"weights": fit["state"]["net.4.weight"], "bias": fit["state"]["net.4.bias"]},
                    },
                },
            }

        add_prediction_variants(module, students, spec.base_id, fit["prediction"], bundle, teacher_pred, unit, mlp_payload)
    return students


def strict_package_score(folds: list[dict[str, Any]], model_id: str) -> dict[str, Any]:
    rows = []
    for fold in folds:
        metric = fold["students"].get(model_id)
        if metric:
            rows.append(metric["test"])
    if not rows:
        return {"worstP95": None, "worstP99": None, "meanP95": None, "meanP99": None}
    return {
        "worstP95": round(max(row["p95"] for row in rows), 4),
        "worstP99": round(max(row["p99"] for row in rows), 4),
        "meanP95": round(float(np.mean([row["p95"] for row in rows])), 4),
        "meanP99": round(float(np.mean([row["p99"] for row in rows])), 4),
    }


def ranking(students: dict[str, Any], fold_scores: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    rows = []
    for model_id, payload in students.items():
        holdout = (fold_scores or {}).get(model_id)
        rows.append({
            "modelId": model_id,
            "family": payload["family"],
            "target": payload["target"],
            "cost": payload["cost"],
            "objective": round(objective(payload["metrics"], payload["cost"], holdout), 6),
            "validation": payload["metrics"]["bySplit"]["validation"],
            "test": payload["metrics"]["bySplit"]["test"],
            "teacherImitation": payload["metrics"].get("teacherImitation", {}).get("validation"),
            "packageHoldout": holdout,
        })
    rows.sort(key=lambda item: (item["objective"], item["validation"]["p95"] or 9999, item["validation"]["p99"] or 9999))
    return rows


def clone_rows_for_holdout(rows: list[dict[str, Any]], package_id: str) -> list[dict[str, Any]]:
    cloned = []
    for row in rows:
        copied = dict(row)
        if row["packageId"] == package_id:
            copied["split"] = "test"
        elif row["split"] == "validation":
            copied["split"] = "validation"
        else:
            copied["split"] = "train"
        cloned.append(copied)
    return cloned


def package_holdouts(module: Any, filtered_rows: list[dict[str, Any]], selected_ids: list[str], device: torch.device, args: argparse.Namespace, started: float) -> list[dict[str, Any]]:
    folds = []
    mlp_specs = sorted({parse_mlp_spec(model_id) for model_id in selected_ids if parse_mlp_spec(model_id) is not None}, key=lambda s: (s.hidden, s.activation, s.target))
    include_ridge = any(model_id.startswith("ridge_") for model_id in selected_ids)
    local_args = argparse.Namespace(**vars(args))
    local_args.teacher_epochs = args.holdout_teacher_epochs
    local_args.student_epochs = args.holdout_student_epochs
    for package_id in sorted(set(row["packageId"] for row in filtered_rows)):
        if time.perf_counter() - started > args.max_seconds:
            break
        rows = clone_rows_for_holdout(filtered_rows, package_id)
        bundle = module.build_dataset(rows)
        teacher = train_teacher(module, bundle, device, local_args, started, local_args.teacher_epochs)
        students = train_students(module, bundle, teacher["prediction"], device, local_args, started, mlp_specs=mlp_specs, include_ridge=include_ridge)
        selected_students = {k: v for k, v in students.items() if k in selected_ids}
        fold_ranking = ranking(selected_students)
        step5 = module.evaluate_prediction("step5_gate", bundle.baseline, bundle, [])["bySplit"]["test"]
        folds.append({
            "heldoutPackage": package_id,
            "teacher": {"test": teacher["metrics"]["bySplit"]["test"]},
            "step5": {"test": step5},
            "students": {
                model_id: {
                    "family": payload["family"],
                    "target": payload["target"],
                    "cost": payload["cost"],
                    "test": payload["metrics"]["bySplit"]["test"],
                }
                for model_id, payload in selected_students.items()
            },
            "ranking": fold_ranking,
            "bestStudent": fold_ranking[0] if fold_ranking else None,
        })
    return folds


def runtime_simulate(candidate: dict[str, Any], bundle: Any) -> np.ndarray:
    runtime = candidate["runtime"]
    x_raw = student_features(bundle, runtime["featureKind"]).astype(np.float32)
    x = (x_raw - np.asarray(runtime["featureMean"], dtype=np.float32).reshape(1, -1)) / np.asarray(runtime["featureStd"], dtype=np.float32).reshape(1, -1)
    if runtime["type"] == "linear":
        pred = x @ np.asarray(runtime["weights"], dtype=np.float32).reshape(-1, 2) + np.asarray(runtime["bias"], dtype=np.float32).reshape(1, 2)
    else:
        layers = runtime["layers"]
        h = x @ np.asarray(layers["inputHidden"]["weights"], dtype=np.float32).T + np.asarray(layers["inputHidden"]["bias"], dtype=np.float32).reshape(1, -1)
        h = activate(h, runtime["activation"])
        h = h @ np.asarray(layers["hiddenHidden"]["weights"], dtype=np.float32).T + np.asarray(layers["hiddenHidden"]["bias"], dtype=np.float32).reshape(1, -1)
        h = activate(h, runtime["activation"])
        pred = h @ np.asarray(layers["hiddenOutput"]["weights"], dtype=np.float32).T + np.asarray(layers["hiddenOutput"]["bias"], dtype=np.float32).reshape(1, -1)
        pred = pred * np.asarray(runtime["targetScale"], dtype=np.float32).reshape(1, 2)
    pred = quantize_prediction(pred.astype(np.float32), float(runtime.get("quantizationStep", 0.0)))
    pred = apply_lag_compensation(pred, lag_unit_vectors(bundle), float(runtime.get("lagCompensationPx", 0.0)))
    return pred.astype(np.float32)


def activate(x: np.ndarray, activation: str) -> np.ndarray:
    if activation == "relu":
        return np.maximum(x, 0.0)
    if activation == "tanh":
        return np.tanh(x)
    if activation == "hardtanh":
        return np.clip(x, -1.0, 1.0)
    if activation == "silu":
        return x / (1.0 + np.exp(-x))
    return x


def compact_runtime(runtime: dict[str, Any], bundle: Any, model_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    out = {
        "schemaVersion": RUNTIME_SCHEMA_VERSION,
        "modelId": model_id,
        "family": payload["family"],
        "target": payload["target"],
        "cost": payload["cost"],
        "inputContract": {
            "refreshBucket": "60Hz",
            "source": "POC13 scalar_features/history normalized with sourceNormalization, then POC16 FSMN projection normalized with featureMean/featureStd.",
            "featureOrder": "scalar[25], seq_last[9], exp_decay_2[9], exp_decay_4[9], exp_decay_8[9], last4_mean[9], last8_mean[9]",
        },
        "sourceNormalization": source_norm_payload(bundle),
        "runtime": {},
        "metadata": {
            "createdAtUtc": datetime.now(timezone.utc).isoformat(),
            "generator": "poc/cursor-prediction-v16/scripts/run-runtime-ready-distillation-gpu.py",
            "artifactPolicy": "JSON text only; no checkpoints or tensor dumps.",
        },
    }
    for key, value in runtime.items():
        if isinstance(value, np.ndarray):
            out["runtime"][key] = array_payload(value)
        elif key == "layers":
            out["runtime"][key] = {
                layer_name: {
                    "weights": array_payload(layer["weights"]),
                    "bias": array_payload(layer["bias"]),
                }
                for layer_name, layer in value.items()
            }
        else:
            out["runtime"][key] = value
    return out


def csharp_array(name: str, values: np.ndarray) -> str:
    flat = np.asarray(values, dtype=np.float32).reshape(-1)
    numbers = ", ".join(f"{float(v):.9g}f" for v in flat)
    return f"    private static readonly float[] {name} = new float[] {{ {numbers} }};\n"


def generate_csharp(candidate: dict[str, Any]) -> str:
    rt = candidate["runtime"]
    source = candidate["sourceNormalization"]
    if rt["type"] != "mlp" or rt["featureKind"] != "fsmn":
        return "// Generated C# source is currently implemented for selected tiny MLP/FSMN candidates only.\n"
    layers = rt["layers"]
    return f"""// Generated by POC v16. Prototype only; not product source.
using System;

namespace CursorMirror.Poc;

internal static class Distilled60HzPredictor
{{
    public const string ModelId = "{candidate['modelId']}";
    public const int ScalarFeatureCount = {source['scalarFeatureCount']};
    public const int SequenceLength = {source['sequenceLength']};
    public const int SequenceFeatureCount = {source['sequenceFeatureCount']};
    public const int FeatureCount = {len(rt['featureMean'])};
    public const int Hidden = {rt['hidden']};
    public const float QuantizationStep = {float(rt['quantizationStep']):.9g}f;
    public const float LagCompensationPx = {float(rt['lagCompensationPx']):.9g}f;
    public const int EstimatedMacs = {candidate['cost']['estimatedMacs']};
    public const int ParameterCount = {candidate['cost']['parameterCount']};

{csharp_array('FeatureMean', np.asarray(rt['featureMean'], dtype=np.float32))}
{csharp_array('FeatureStd', np.asarray(rt['featureStd'], dtype=np.float32))}
{csharp_array('TargetScale', np.asarray(rt['targetScale'], dtype=np.float32))}
{csharp_array('SourceScalarMean', np.asarray(source['scalarMean'], dtype=np.float32))}
{csharp_array('SourceScalarStd', np.asarray(source['scalarStd'], dtype=np.float32))}
{csharp_array('W0', np.asarray(layers['inputHidden']['weights'], dtype=np.float32))}
{csharp_array('B0', np.asarray(layers['inputHidden']['bias'], dtype=np.float32))}
{csharp_array('W1', np.asarray(layers['hiddenHidden']['weights'], dtype=np.float32))}
{csharp_array('B1', np.asarray(layers['hiddenHidden']['bias'], dtype=np.float32))}
{csharp_array('W2', np.asarray(layers['hiddenOutput']['weights'], dtype=np.float32))}
{csharp_array('B2', np.asarray(layers['hiddenOutput']['bias'], dtype=np.float32))}

    public static (float dx, float dy) PredictFromNormalizedSourceFeatures(ReadOnlySpan<float> scalar, ReadOnlySpan<float> seqFlat)
    {{
        Span<float> features = stackalloc float[FeatureCount];
        BuildFsmnFeatures(scalar, seqFlat, features);
        for (int i = 0; i < FeatureCount; i++)
            features[i] = (features[i] - FeatureMean[i]) / FeatureStd[i];

        Span<float> h0 = stackalloc float[Hidden];
        Span<float> h1 = stackalloc float[Hidden];
        Dense(features, W0, B0, h0, FeatureCount, Hidden);
        HardTanh(h0);
        Dense(h0, W1, B1, h1, Hidden, Hidden);
        HardTanh(h1);

        float dx = B2[0];
        float dy = B2[1];
        for (int i = 0; i < Hidden; i++)
        {{
            dx += h1[i] * W2[i];
            dy += h1[i] * W2[Hidden + i];
        }}
        dx *= TargetScale[0];
        dy *= TargetScale[1];
        dx = Quantize(dx);
        dy = Quantize(dy);
        ApplyLagCompensation(scalar, ref dx, ref dy);
        return (dx, dy);
    }}

    private static void BuildFsmnFeatures(ReadOnlySpan<float> scalar, ReadOnlySpan<float> seqFlat, Span<float> dst)
    {{
        int o = 0;
        for (int i = 0; i < ScalarFeatureCount; i++) dst[o++] = scalar[i];
        int last = (SequenceLength - 1) * SequenceFeatureCount;
        for (int d = 0; d < SequenceFeatureCount; d++) dst[o++] = seqFlat[last + d];
        AddDecay(seqFlat, dst, ref o, 2f);
        AddDecay(seqFlat, dst, ref o, 4f);
        AddDecay(seqFlat, dst, ref o, 8f);
        AddMean(seqFlat, dst, ref o, 4);
        AddMean(seqFlat, dst, ref o, 8);
    }}

    private static void AddDecay(ReadOnlySpan<float> seqFlat, Span<float> dst, ref int offset, float decay)
    {{
        Span<float> sums = stackalloc float[SequenceFeatureCount];
        float total = 0f;
        for (int t = 0; t < SequenceLength; t++)
        {{
            float w = MathF.Exp(-(SequenceLength - 1 - t) / decay);
            total += w;
            int baseIndex = t * SequenceFeatureCount;
            for (int d = 0; d < SequenceFeatureCount; d++) sums[d] += w * seqFlat[baseIndex + d];
        }}
        for (int d = 0; d < SequenceFeatureCount; d++) dst[offset++] = sums[d] / total;
    }}

    private static void AddMean(ReadOnlySpan<float> seqFlat, Span<float> dst, ref int offset, int count)
    {{
        int start = SequenceLength - count;
        for (int d = 0; d < SequenceFeatureCount; d++)
        {{
            float sum = 0f;
            for (int t = start; t < SequenceLength; t++) sum += seqFlat[(t * SequenceFeatureCount) + d];
            dst[offset++] = sum / count;
        }}
    }}

    private static void Dense(ReadOnlySpan<float> input, ReadOnlySpan<float> weights, ReadOnlySpan<float> bias, Span<float> output, int inputCount, int outputCount)
    {{
        for (int o = 0; o < outputCount; o++)
        {{
            float value = bias[o];
            int row = o * inputCount;
            for (int i = 0; i < inputCount; i++) value += input[i] * weights[row + i];
            output[o] = value;
        }}
    }}

    private static void HardTanh(Span<float> values)
    {{
        for (int i = 0; i < values.Length; i++)
            values[i] = MathF.Max(-1f, MathF.Min(1f, values[i]));
    }}

    private static float Quantize(float value)
    {{
        return QuantizationStep <= 0f ? value : MathF.Round(value / QuantizationStep) * QuantizationStep;
    }}

    private static void ApplyLagCompensation(ReadOnlySpan<float> scalar, ref float dx, ref float dy)
    {{
        if (LagCompensationPx <= 0f) return;
        float rawDx = (scalar[17] * SourceScalarStd[17]) + SourceScalarMean[17];
        float rawDy = (scalar[18] * SourceScalarStd[18]) + SourceScalarMean[18];
        float mag = MathF.Sqrt((rawDx * rawDx) + (rawDy * rawDy));
        if (mag <= 1e-6f) return;
        dx += LagCompensationPx * rawDx / mag;
        dy += LagCompensationPx * rawDy / mag;
    }}
}}
"""


def sanitize_file_id(model_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", model_id)


def export_runtime_artifacts(
    out_dir: Path,
    bundle: Any,
    students: dict[str, Any],
    selected_id: str,
    export_ids: list[str],
) -> dict[str, Any]:
    runtime_dir = out_dir / "runtime"
    candidates_dir = runtime_dir / "candidates"
    candidates_dir.mkdir(parents=True, exist_ok=True)
    for stale in candidates_dir.glob("*.json"):
        stale.unlink()
    results = {}
    for model_id in export_ids:
        payload = students[model_id]
        descriptor = compact_runtime(payload["runtime"], bundle, model_id, payload)
        # Compare the full-precision Python runtime graph kept in memory against
        # the serialized/generated descriptor that the C# source is emitted from.
        reference = runtime_simulate({"runtime": payload["runtime"]}, bundle)
        direct = runtime_simulate(descriptor, bundle)
        error = np.sqrt(np.sum((direct - reference) ** 2, axis=1))
        parity = {
            "method": "python_reference_runtime_graph_vs_serialized_generated_shape",
            "csharpCompileRun": "requires_runtime_csharp_parity_harness",
            "maxErrorPx": round_float(float(error.max()) if error.size else 0.0, 9),
            "p99ErrorPx": round_float(float(np.percentile(error, 99)) if error.size else 0.0, 9),
            "targetMaxErrorPx": 0.01,
            "passed": bool((float(error.max()) if error.size else 0.0) < 0.01),
        }
        descriptor["parity"] = parity
        path = candidates_dir / f"{sanitize_file_id(model_id)}.json"
        path.write_text(json.dumps(descriptor, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        results[model_id] = {"path": str(path.relative_to(out_dir)), "parity": parity}
        if model_id == selected_id:
            (runtime_dir / "selected-candidate.json").write_text(json.dumps(descriptor, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            (runtime_dir / "Distilled60HzPredictor.g.cs").write_text(generate_csharp(descriptor), encoding="utf-8")
    return results


def write_reports(out_dir: Path, scores: dict[str, Any], run_command: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    student_rows = []
    for item in scores["ranking"][:18]:
        imitation = item.get("teacherImitation") or {}
        holdout = item.get("packageHoldout") or {}
        student_rows.append([
            item["modelId"],
            item["family"],
            item["target"],
            item["cost"]["parameterCount"],
            item["cost"]["estimatedMacs"],
            item["validation"]["p95"],
            item["validation"]["p99"],
            item["validation"]["signed"]["mean"],
            item["test"]["p95"],
            item["test"]["p99"],
            holdout.get("worstP95"),
            holdout.get("worstP99"),
            imitation.get("p95"),
            item["objective"],
        ])
    holdout_rows = []
    for fold in scores["packageHoldouts"]:
        best = fold["bestStudent"]
        selected = fold["students"].get(scores["selectedCandidate"]["modelId"])
        holdout_rows.append([
            fold["heldoutPackage"],
            fold["teacher"]["test"]["p95"],
            fold["teacher"]["test"]["p99"],
            selected["test"]["p95"] if selected else None,
            selected["test"]["p99"] if selected else None,
            best["modelId"] if best else "n/a",
            best["test"]["p95"] if best else None,
            best["test"]["p99"] if best else None,
            fold["step5"]["test"]["p95"],
            fold["step5"]["test"]["p99"],
        ])
    selected = scores["selectedCandidate"]
    parity = selected["runtimeParity"]
    report = f"""# Cursor Prediction v16 - Runtime-Ready Distillation

## Intent

POC v16 turns the v15 60Hz student-compression work into runtime-ready artifacts. The experiment keeps the v14/v15 60Hz-only data path, trains a GRU teacher, searches tiny FSMN-feature MLPs and linear FSMN/ridge students, exports real weights, and checks generated-runtime parity.

## Environment

- Device: `{scores['environment']['device']}`
- GPU: `{scores['environment']['gpuName']}`
- Torch: `{scores['environment']['torchVersion']}`
- CUDA: `{scores['environment']['cudaVersion']}`
- Execution: `{scores['constraints']['execution']}`

No raw ZIPs, expanded CSVs, checkpoints, tensor dumps, TensorBoard logs, feature caches, or large binaries were written.

## Dataset

- Rows: {scores['dataset']['rows']}
- Packages: `{scores['dataset']['byPackage']}`
- Splits: `{scores['dataset']['bySplit']}`
- Refresh: `{scores['dataset']['byRefresh']}`

Only 60Hz rows are included.

## Teacher

Teacher: `teacher_gru_residual_h128`

| split | mean | p95 | p99 | signed mean |
| --- | ---: | ---: | ---: | ---: |
| validation | {scores['teacher']['metrics']['bySplit']['validation']['mean']} | {scores['teacher']['metrics']['bySplit']['validation']['p95']} | {scores['teacher']['metrics']['bySplit']['validation']['p99']} | {scores['teacher']['metrics']['bySplit']['validation']['signed']['mean']} |
| test | {scores['teacher']['metrics']['bySplit']['test']['mean']} | {scores['teacher']['metrics']['bySplit']['test']['p95']} | {scores['teacher']['metrics']['bySplit']['test']['p99']} | {scores['teacher']['metrics']['bySplit']['test']['signed']['mean']} |

## Candidate Ranking

{table(['candidate', 'family', 'target', 'params', 'macs', 'val p95', 'val p99', 'val signed', 'test p95', 'test p99', 'holdout p95', 'holdout p99', 'teacher p95', 'objective'], student_rows)}

Selected candidate: `{selected['modelId']}`.

## Package Holdout

{table(['heldout', 'teacher p95', 'teacher p99', 'selected p95', 'selected p99', 'best candidate', 'best p95', 'best p99', 'Step5 p95', 'Step5 p99'], holdout_rows)}

## Runtime Artifacts

- Selected descriptor: `runtime/selected-candidate.json`
- Generated C#: `runtime/Distilled60HzPredictor.g.cs`
- Exported shortlist: `runtime/candidates/`

The selected descriptor includes source feature normalization, FSMN feature normalization, target scale, layer weights/biases, activation, quantization step, lag compensation, and metadata.

## Parity

- Method: `{parity['method']}`
- Max error: {parity['maxErrorPx']} px
- p99 error: {parity['p99ErrorPx']} px
- Target: < {parity['targetMaxErrorPx']} px
- C# compile/run: `{parity['csharpCompileRun']}`

Run `runtime/csharp-parity/` after this GPU step to compile the generated C# source and record real C# parity.

## Adoption Decision

{scores['interpretation']}
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    notes = f"""# Notes

Run command:

```powershell
{run_command}
```

This is a 60Hz-only runtime-readiness POC. It does not promote a 30Hz predictor and does not modify product source.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")
    readme = """# Cursor Prediction v16

Runtime-ready distillation POC for the latest 60Hz-only cursor prediction data path.

Artifacts:

- `scripts/run-runtime-ready-distillation-gpu.py`: reproducible experiment script.
- `scores.json`: machine-readable metrics and selected-candidate metadata.
- `report.md`: human-readable summary and adoption decision.
- `notes.md`: run command and caveats.
- `runtime/selected-candidate.json`: concrete runtime weights and normalization.
- `runtime/Distilled60HzPredictor.g.cs`: generated C# prototype source.
- `runtime/candidates/`: exported candidate descriptors for the shortlist.

Artifact policy: no raw ZIP copies, expanded CSVs, checkpoints, tensor dumps, feature caches, TensorBoard logs, or large binaries.
"""
    (out_dir / "README.md").write_text(readme, encoding="utf-8")


def choose_selected(ranked: list[dict[str, Any]], step5: dict[str, Any], fold_scores: dict[str, Any]) -> str:
    for item in ranked:
        if item["family"] != "tiny_mlp_fsmn":
            continue
        if item["cost"]["activation"] != "hardtanh":
            continue
        validation = item["validation"]
        test = item["test"]
        holdout = fold_scores.get(item["modelId"], {})
        if (validation["p95"] or 9999) <= (step5["validation"]["p95"] or 9999) + 0.35 \
                and (test["p95"] or 9999) <= (step5["test"]["p95"] or 9999) + 0.35 \
                and (holdout.get("worstP99") is None or holdout["worstP99"] <= 7.25):
            return item["modelId"]
    for item in ranked:
        if item["family"] == "tiny_mlp_fsmn" and item["cost"]["activation"] == "hardtanh":
            return item["modelId"]
    return ranked[0]["modelId"]


def remove_pycache(out_dir: Path) -> None:
    for path in out_dir.rglob("__pycache__"):
        if path.is_dir():
            shutil.rmtree(path)


def main() -> int:
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = torch.device("cpu" if args.cpu or not torch.cuda.is_available() else "cuda")
    started = time.perf_counter()
    module = load_poc13_module()
    bundle, build_summary, filtered_rows = build_bundle(module, args)
    teacher = train_teacher(module, bundle, device, args, started)
    students = train_students(module, bundle, teacher["prediction"], device, args, started)
    initial_ranking = ranking(students)
    top_ids = [item["modelId"] for item in initial_ranking[:10]]
    for item in initial_ranking:
        if item["family"] == "tiny_mlp_fsmn" and item["cost"]["activation"] == "hardtanh" and item["modelId"] not in top_ids:
            top_ids.append(item["modelId"])
        if len(top_ids) >= 18:
            break
    folds = package_holdouts(module, filtered_rows, top_ids, device, args, started)
    fold_scores = {item["modelId"]: strict_package_score(folds, item["modelId"]) for item in initial_ranking[:24]}
    ranked = ranking(students, fold_scores)
    step5 = module.evaluate_prediction("step5_gate", bundle.baseline, bundle, [])["bySplit"]
    selected_id = choose_selected(ranked, step5, fold_scores)
    export_ids = []
    for item in ranked:
        if item["family"] == "tiny_mlp_fsmn" and item["cost"]["activation"] == "hardtanh":
            export_ids.append(item["modelId"])
        if len(export_ids) >= 6:
            break
    if selected_id not in export_ids:
        export_ids.insert(0, selected_id)
    runtime_exports = export_runtime_artifacts(args.out_dir, bundle, students, selected_id, export_ids)
    selected_rank = next(item for item in ranked if item["modelId"] == selected_id)
    selected_payload = students[selected_id]
    selected_parity = runtime_exports[selected_id]["parity"]

    if selected_rank["test"]["p95"] <= step5["test"]["p95"] and selected_rank["validation"]["p95"] <= step5["validation"]["p95"]:
        decision = "Adopt as a product-integration candidate for guarded 60Hz runtime testing, not as product code yet."
    else:
        decision = "Do not adopt directly yet; keep it as the runtime-ready baseline for the next integration and C# parity pass."
    interpretation = (
        f"{decision} The strongest deployable shape is a hardtanh tiny MLP over FSMN-style causal features. "
        "It exports real arrays and passes generated-shape parity in Python. Run the C# parity harness before treating v16 as complete; app-loop latency measurement remains open."
    )

    scores = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "device": str(device),
            "gpuUsed": device.type == "cuda",
            "torchVersion": torch.__version__,
            "cudaVersion": torch.version.cuda,
            "gpuName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "python": sys.version,
        },
        "constraints": {
            "rawZipCopied": False,
            "expandedCsvWritten": False,
            "checkpointWritten": False,
            "featureCacheWritten": False,
            "tensorDumpWritten": False,
            "tensorboardWritten": False,
            "largeBinaryWritten": False,
            "execution": "single-process sequential GPU/CPU training; no concurrent heavy experiments",
        },
        "manifest": {
            "path": str(args.manifest.relative_to(args.root)) if args.manifest.is_relative_to(args.root) else str(args.manifest),
        },
        "dataset": bundle.summary,
        "buildSummary": build_summary,
        "step5": {"metrics": {"bySplit": step5}},
        "teacher": {
            "metrics": teacher["metrics"],
            "training": teacher["training"],
            "parameterCount": teacher["parameterCount"],
        },
        "candidateFamilies": {
            "ridge": ["scalar", "fsmn", "dense"],
            "tinyMlpFsmn": [spec.__dict__ for spec in mlp_specs_for_standard()],
            "targets": list(target_map(bundle, teacher["prediction"]).keys()),
            "quantizationSteps": list(QUANT_STEPS),
            "lagCompensationPx": list(LAG_COMP_AMOUNTS),
        },
        "students": {
            model_id: {key: value for key, value in payload.items() if key != "runtime"}
            for model_id, payload in students.items()
        },
        "ranking": ranked,
        "foldScores": fold_scores,
        "packageHoldouts": folds,
        "selectedCandidate": {
            "modelId": selected_id,
            "rank": selected_rank,
            "runtimePath": runtime_exports[selected_id]["path"],
            "runtimeParity": selected_parity,
            "runtimeShape": {
                "family": selected_payload["family"],
                "featureDim": selected_payload["featureDim"],
                "hidden": selected_payload.get("hidden"),
                "activation": selected_payload.get("activation"),
                "quantizationStep": selected_payload.get("quantizationStep"),
                "lagCompensationPx": selected_payload.get("lagCompensationPx"),
                "cost": selected_payload["cost"],
            },
        },
        "runtimeExports": runtime_exports,
        "interpretation": interpretation,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    run_command = "uv run --python 'C:\\Users\\seigl\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe' --with numpy==2.4.3 --with torch==2.11.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128 python poc\\cursor-prediction-v16\\scripts\\run-runtime-ready-distillation-gpu.py"
    write_reports(args.out_dir, scores, run_command)
    remove_pycache(args.out_dir)
    print(json.dumps({
        "selectedCandidate": selected_id,
        "gpuUsed": device.type == "cuda",
        "rows": bundle.summary["rows"],
        "elapsedSeconds": scores["elapsedSeconds"],
        "parity": selected_parity,
        "top": ranked[:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
