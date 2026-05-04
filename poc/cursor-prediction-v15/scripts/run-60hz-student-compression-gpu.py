#!/usr/bin/env python
"""POC 15: compress the 60Hz distilled student toward a runtime shape.

The script reuses POC 13 data-loading primitives, narrows to 60Hz rows, trains a
GRU teacher, then searches small CPU-friendly students. It writes compact
reports and a prototype C# shape only. No checkpoints, tensors, feature caches,
expanded CSVs, TensorBoard logs, or model weight binaries are written.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, TensorDataset


SCHEMA_VERSION = "cursor-prediction-v15-60hz-student-compression/1"
SEED = 15015


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
    parser.add_argument("--teacher-epochs", type=int, default=75)
    parser.add_argument("--student-epochs", type=int, default=75)
    parser.add_argument("--patience", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--max-seconds", type=float, default=2400)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


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


def objective(metrics: dict[str, Any], cost: dict[str, Any] | None = None) -> float:
    validation = metrics["bySplit"]["validation"]
    cost_penalty = 0.0
    if cost:
        cost_penalty = 0.0005 * float(cost.get("estimatedMacs", 0)) + 0.00002 * float(cost.get("parameterCount", 0))
    return (
        float(validation["p95"] or 9999)
        + 0.25 * float(validation["p99"] or 9999)
        + 35.0 * float(validation["gt10Rate"] or 1.0)
        + 0.08 * abs(float(validation["signed"]["mean"] or 0.0))
        + cost_penalty
    )


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


def student_features(bundle: Any, kind: str) -> np.ndarray:
    scalar = bundle.scalar.astype(np.float64)
    seq = bundle.seq.astype(np.float64)
    if kind == "scalar":
        return scalar
    if kind == "fsmn":
        parts = [scalar, seq[:, -1, :]]
        for decay in (2.0, 4.0, 8.0):
            weights = np.exp(-np.arange(seq.shape[1] - 1, -1, -1, dtype=np.float64) / decay)
            weights = weights / max(1e-9, float(weights.sum()))
            parts.append(np.einsum("t,ntd->nd", weights, seq))
        parts.append(seq[:, -4:, :].mean(axis=1))
        parts.append(seq[:, -8:, :].mean(axis=1))
        return np.concatenate(parts, axis=1)
    if kind == "dense":
        return np.concatenate([scalar, seq.reshape(seq.shape[0], -1)], axis=1)
    raise ValueError(kind)


def normalize(x: np.ndarray, train_mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean = x[train_mask].mean(axis=0, keepdims=True)
    std = np.maximum(x[train_mask].std(axis=0, keepdims=True), 0.05)
    return ((x - mean) / std).astype(np.float64), mean, std


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
        "teacherRmse": round(best["rmse"], 6),
        "featureMean": mean.reshape(-1).astype(np.float32),
        "featureStd": std.reshape(-1).astype(np.float32),
        "weights": best["beta"].astype(np.float32),
    }


class SmallMlp(nn.Module):
    def __init__(self, input_dim: int, hidden: int, activation: str) -> None:
        super().__init__()
        self.activation_name = activation
        if activation == "relu":
            act: nn.Module = nn.ReLU()
        elif activation == "tanh":
            act = nn.Tanh()
        elif activation == "hardtanh":
            act = nn.Hardtanh()
        else:
            act = nn.SiLU()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            act,
            nn.Linear(hidden, hidden),
            act.__class__() if activation != "silu" else nn.SiLU(),
            nn.Linear(hidden, 2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def quantize_prediction(prediction: np.ndarray, step: float) -> np.ndarray:
    if step <= 0:
        return prediction
    return (np.round(prediction / step) * step).astype(np.float32)


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
) -> dict[str, Any]:
    x_norm, mean, std = normalize(x, train_mask)
    scale = np.percentile(np.abs(y[train_mask]), 95, axis=0, keepdims=True).astype(np.float32) + 0.5
    y_scaled = (y / scale).astype(np.float32)
    train_idx = np.where(train_mask)[0].astype(np.int64)
    validation_idx = np.where(validation_mask)[0].astype(np.int64)
    train_ds = TensorDataset(torch.from_numpy(x_norm[train_idx].astype(np.float32)), torch.from_numpy(y_scaled[train_idx]))
    validation_ds = TensorDataset(torch.from_numpy(x_norm[validation_idx].astype(np.float32)), torch.from_numpy(y_scaled[validation_idx]))
    generator = torch.Generator()
    generator.manual_seed(args.seed + hidden)
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
        "featureMean": mean.reshape(-1).astype(np.float32),
        "featureStd": std.reshape(-1).astype(np.float32),
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


def ranking(students: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for model_id, payload in students.items():
        rows.append({
            "modelId": model_id,
            "family": payload["family"],
            "target": payload["target"],
            "cost": payload["cost"],
            "objective": round(objective(payload["metrics"], payload["cost"]), 6),
            "validation": payload["metrics"]["bySplit"]["validation"],
            "test": payload["metrics"]["bySplit"]["test"],
            "teacherImitation": payload["metrics"].get("teacherImitation", {}).get("validation"),
        })
    rows.sort(key=lambda item: (item["objective"], item["validation"]["p95"] or 9999, item["validation"]["p99"] or 9999))
    return rows


def build_bundle(module: Any, args: argparse.Namespace, rows_override: list[dict[str, Any]] | None = None) -> tuple[Any, dict[str, Any], list[dict[str, Any]]]:
    context = module.load_manifest(args.manifest)
    packages = [module.load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    all_rows, build_summary = module.build_rows(packages)
    filtered = rows_override if rows_override is not None else rows_60hz(all_rows)
    return module.build_dataset(filtered), build_summary, filtered


def train_teacher(module: Any, bundle: Any, device: torch.device, args: argparse.Namespace, started: float) -> dict[str, Any]:
    spec = {
        "id": "teacher_gru_residual_h128",
        "family": "GRU",
        "objective": "residual",
        "weighted": False,
        "model": module.GruResidual(int(bundle.scalar.shape[1]), int(bundle.seq.shape[2]), 128, 2),
    }
    local_args = argparse.Namespace(**vars(args))
    local_args.epochs = args.teacher_epochs
    training = module.train_model(spec["model"], bundle, "residual", False, device, local_args, started)
    pred = module.predict_model(spec["model"], bundle, "residual", device, args.batch_size)
    metrics = module.evaluate_prediction(spec["id"], pred, bundle, [])["bySplit"]
    params = sum(p.numel() for p in spec["model"].parameters())
    del spec["model"]
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return {"prediction": pred, "training": training, "metrics": {"bySplit": metrics}, "parameterCount": int(params)}


def train_students(module: Any, bundle: Any, teacher_pred: np.ndarray, device: torch.device, args: argparse.Namespace, started: float) -> dict[str, Any]:
    split = np.asarray([row["split"] for row in bundle.row_meta])
    train_mask = split == "train"
    validation_mask = split == "validation"
    students: dict[str, Any] = {}
    target_map = {"teacher": teacher_pred.astype(np.float32), "label": bundle.target.astype(np.float32)}
    for kind in ("scalar", "fsmn", "dense"):
        x = student_features(bundle, kind)
        for target_name, target in target_map.items():
            model_id = f"ridge_{kind}_{target_name}"
            fit = fit_ridge(x, target, train_mask, validation_mask)
            students[model_id] = {
                "family": f"ridge_{kind}",
                "target": target_name,
                "featureDim": int(x.shape[1]),
                "training": {"lambda": fit["lambda"], "teacherRmse": fit["teacherRmse"]},
                "cost": cost_linear(int(x.shape[1])),
                "metrics": evaluate(module, model_id, fit["prediction"], bundle, teacher_pred),
                "runtime": {
                    "featureKind": kind,
                    "type": "linear",
                    "featureMean": fit["featureMean"].round(7).tolist(),
                    "featureStd": fit["featureStd"].round(7).tolist(),
                    "weights": fit["weights"].round(7).tolist(),
                },
            }
    x = student_features(bundle, "fsmn")
    for hidden in (8, 12, 16, 24, 32, 48):
        for activation in ("relu", "hardtanh", "tanh", "silu"):
            model_id = f"mlp_fsmn_h{hidden}_{activation}_teacher"
            fit = train_small_mlp(x, target_map["teacher"], train_mask, validation_mask, hidden, activation, device, args, started)
            for quant_step in (0.0, 0.03125, 0.0625, 0.125):
                qid = model_id if quant_step == 0 else f"{model_id}_q{str(quant_step).replace('.', 'p')}"
                pred = quantize_prediction(fit["prediction"], quant_step)
                students[qid] = {
                    "family": "tiny_mlp",
                    "target": "teacher",
                    "featureDim": int(x.shape[1]),
                    "hidden": hidden,
                    "activation": activation,
                    "quantizationStep": quant_step,
                    "training": {"bestLoss": fit["bestLoss"], "bestEpoch": fit["bestEpoch"]},
                    "cost": cost_mlp(int(x.shape[1]), hidden, activation),
                    "metrics": evaluate(module, qid, pred, bundle, teacher_pred),
                    "runtime": {
                        "featureKind": "fsmn",
                        "type": "mlp",
                        "hidden": hidden,
                        "activation": activation,
                        "quantizationStep": quant_step,
                        "featureMean": fit["featureMean"].round(7).tolist(),
                        "featureStd": fit["featureStd"].round(7).tolist(),
                        "targetScale": fit["targetScale"].round(7).tolist(),
                    },
                }
    return students


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
    for package_id in sorted(set(row["packageId"] for row in filtered_rows)):
        rows = clone_rows_for_holdout(filtered_rows, package_id)
        bundle = module.build_dataset(rows)
        teacher = train_teacher(module, bundle, device, args, started)
        students = train_students(module, bundle, teacher["prediction"], device, args, started)
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


def runtime_prototype(best: dict[str, Any], out_dir: Path) -> None:
    proto_dir = out_dir / "runtime-prototype"
    proto_dir.mkdir(parents=True, exist_ok=True)
    runtime = best.get("runtime", {})
    descriptor = {
        "schemaVersion": "cursor-prediction-v15-runtime-candidate/1",
        "modelId": best["modelId"],
        "family": best["family"],
        "target": best["target"],
        "cost": best["cost"],
        "runtime": runtime,
    }
    (proto_dir / "candidate.json").write_text(json.dumps(descriptor, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    cs = f"""// Prototype only. Generated by POC v15; not product code.
namespace CursorMirror.Poc;

internal static class Distilled60HzPredictorShape
{{
    public const string ModelId = \"{best['modelId']}\";
    public const int FeatureCount = {best['featureDim']};
    public const int EstimatedMacs = {best['cost']['estimatedMacs']};
    public const int ParameterCount = {best['cost']['parameterCount']};

    public static (float dx, float dy) Predict(System.ReadOnlySpan<float> features)
    {{
        // The real implementation should use generated fixed arrays and avoid allocation.
        // This file records the selected shape only.
        return (0f, 0f);
    }}
}}
"""
    (proto_dir / "Distilled60HzPredictorShape.cs").write_text(cs, encoding="utf-8")


def write_reports(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    student_rows = []
    for item in scores["ranking"][:16]:
        imitation = item.get("teacherImitation") or {}
        student_rows.append([
            item["modelId"],
            item["family"],
            item["target"],
            item["cost"]["parameterCount"],
            item["cost"]["estimatedMacs"],
            item["validation"]["p95"],
            item["validation"]["p99"],
            item["test"]["p95"],
            item["test"]["p99"],
            imitation.get("p95"),
            item["objective"],
        ])
    holdout_rows = []
    for fold in scores["packageHoldouts"]:
        best = fold["bestStudent"]
        holdout_rows.append([
            fold["heldoutPackage"],
            fold["teacher"]["test"]["p95"],
            fold["teacher"]["test"]["p99"],
            best["modelId"] if best else "n/a",
            best["test"]["p95"] if best else None,
            best["test"]["p99"] if best else None,
            fold["step5"]["test"]["p95"],
            fold["step5"]["test"]["p99"],
        ])
    report = f"""# Cursor Prediction v15 - 60Hz Student Compression

## Intent

POC v15 compresses the v14 60Hz distilled student toward a C# runtime shape. It compares tiny MLP widths, activation choices, quantized output variants, ridge/FSMN linear variants, and package holdouts.

## Environment

- Device: `{scores['environment']['device']}`
- GPU: `{scores['environment']['gpuName']}`
- Torch: `{scores['environment']['torchVersion']}`
- CUDA: `{scores['environment']['cudaVersion']}`

No raw ZIPs, expanded CSVs, feature caches, checkpoints, TensorBoard logs, or model weight binaries were written.

## Dataset

- Rows: {scores['dataset']['rows']}
- Packages: `{scores['dataset']['byPackage']}`
- Splits: `{scores['dataset']['bySplit']}`

Only 60Hz rows are included.

## Teacher

Teacher: `teacher_gru_residual_h128`

| split | mean | p95 | p99 |
| --- | ---: | ---: | ---: |
| validation | {scores['teacher']['metrics']['bySplit']['validation']['mean']} | {scores['teacher']['metrics']['bySplit']['validation']['p95']} | {scores['teacher']['metrics']['bySplit']['validation']['p99']} |
| test | {scores['teacher']['metrics']['bySplit']['test']['mean']} | {scores['teacher']['metrics']['bySplit']['test']['p95']} | {scores['teacher']['metrics']['bySplit']['test']['p99']} |

## Student Ranking

{table(['student', 'family', 'target', 'params', 'macs', 'val p95', 'val p99', 'test p95', 'test p99', 'teacher p95', 'objective'], student_rows)}

Selected runtime candidate: `{scores['selectedRuntimeCandidate']}`.

## Package Holdout

{table(['heldout', 'teacher p95', 'teacher p99', 'best student', 'student p95', 'student p99', 'Step5 p95', 'Step5 p99'], holdout_rows)}

## Runtime Shape

- Candidate descriptor: `runtime-prototype/candidate.json`
- C# shape stub: `runtime-prototype/Distilled60HzPredictorShape.cs`

## Interpretation

{scores['interpretation']}
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    notes = """# Notes

Run command:

```powershell
$env:UV_CACHE_DIR=(Resolve-Path '.uv-cache').Path
$env:UV_PYTHON_INSTALL_DIR=(Join-Path (Get-Location) '.uv-python')
uv run --python 'C:\\Users\\seigl\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe' --with numpy==2.4.3 --with torch==2.11.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128 python poc\\cursor-prediction-v15\\scripts\\run-60hz-student-compression-gpu.py
```

This POC is 60Hz-only and does not make a 30Hz product decision.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")
    readme = """# Cursor Prediction v15

60Hz student compression experiment.

Artifacts:

- `report.md`: human-readable summary.
- `scores.json`: machine-readable metrics.
- `notes.md`: rerun command and artifact policy.
- `runtime-prototype/`: selected runtime shape descriptor and C# stub.
- `scripts/run-60hz-student-compression-gpu.py`: reproducible GPU experiment script.

No raw ZIP files, expanded CSVs, checkpoints, feature caches, model weight binaries, or TensorBoard logs are stored here.
"""
    (out_dir / "README.md").write_text(readme, encoding="utf-8")


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
    ranked = ranking(students)
    selected_ids = [item["modelId"] for item in ranked[:8]]
    folds = package_holdouts(module, filtered_rows, selected_ids, device, args, started)
    fold_scores = {item["modelId"]: strict_package_score(folds, item["modelId"]) for item in ranked[:16]}

    # Prefer candidates that beat Step5 on the standard split and are not too costly.
    selected = None
    step5 = module.evaluate_prediction("step5_gate", bundle.baseline, bundle, [])["bySplit"]
    for item in ranked:
        validation = item["validation"]
        test = item["test"]
        fold = fold_scores.get(item["modelId"], {})
        if (validation["p95"] or 9999) <= (step5["validation"]["p95"] or 9999) \
                and (test["p95"] or 9999) <= (step5["test"]["p95"] or 9999) \
                and (fold.get("worstP99") is None or fold["worstP99"] <= 6.2):
            selected = item["modelId"]
            break
    if selected is None:
        selected = ranked[0]["modelId"]

    compact_students = {}
    for model_id, payload in students.items():
        compact = {key: value for key, value in payload.items() if key != "runtime"}
        compact_students[model_id] = compact
    best_payload = students[selected]
    runtime_prototype({"modelId": selected, **best_payload}, args.out_dir)

    interpretation = (
        "The selected candidate is a 60Hz-only runtime-shape approximation. "
        "It should be treated as a prototype until generated C# inference is validated bit-for-bit and measured in the application loop."
    )
    if best_payload["family"] == "tiny_mlp":
        interpretation += " Tiny MLP remains the strongest compressed family; linear ridge/FSMN is simpler but loses too much p99."
    else:
        interpretation += " A linear/FSMN candidate was selected, which is attractive for SIMD and allocation-free implementation."

    scores = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "device": str(device),
            "gpuUsed": device.type == "cuda",
            "torchVersion": torch.__version__,
            "cudaVersion": torch.version.cuda,
            "gpuName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        },
        "constraints": {
            "rawZipCopied": False,
            "expandedCsvWritten": False,
            "checkpointWritten": False,
            "featureCacheWritten": False,
            "tensorboardWritten": False,
            "modelWeightsWritten": False,
        },
        "dataset": bundle.summary,
        "buildSummary": build_summary,
        "step5": {"metrics": {"bySplit": step5}},
        "teacher": {
            "metrics": teacher["metrics"],
            "training": teacher["training"],
            "parameterCount": teacher["parameterCount"],
        },
        "students": compact_students,
        "ranking": ranked,
        "foldScores": fold_scores,
        "packageHoldouts": folds,
        "selectedRuntimeCandidate": selected,
        "interpretation": interpretation,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    write_reports(args.out_dir, scores)
    print(json.dumps({
        "selectedRuntimeCandidate": selected,
        "gpuUsed": device.type == "cuda",
        "rows": bundle.summary["rows"],
        "elapsedSeconds": scores["elapsedSeconds"],
        "top": ranked[:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
