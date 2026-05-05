#!/usr/bin/env python
"""POC 14: 60Hz teacher distillation.

The experiment intentionally narrows scope to the latest v9 Motion Lab data at
60Hz. It trains a high-capacity GPU teacher, then tries to approximate that
teacher with CPU-friendly models. It writes compact reports only: no raw ZIP
copies, expanded CSVs, feature caches, TensorBoard logs, checkpoints, or model
weight files.
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
from collections import Counter
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


SCHEMA_VERSION = "cursor-prediction-v14-60hz-teacher-distillation/1"
SEED = 14014


def load_poc13_module() -> Any:
    script = Path(__file__).resolve().parents[1] / "cursor-prediction-v13" / "scripts" / "run-deep-learning-gpu.py"
    if not script.exists():
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
    parser.add_argument("--teacher-epochs", type=int, default=80)
    parser.add_argument("--student-epochs", type=int, default=70)
    parser.add_argument("--holdout-epochs", type=int, default=55)
    parser.add_argument("--patience", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--max-seconds", type=float, default=2400.0)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


def cell(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.4f}".rstrip("0").rstrip(".")
    return str(value)


def table(headers: list[str], rows: list[list[Any]]) -> str:
    return "\n".join([
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
        *["| " + " | ".join(cell(value) for value in row) + " |" for row in rows],
    ])


def objective(metrics: dict[str, Any]) -> float:
    validation = metrics["bySplit"]["validation"]
    return (
        float(validation["p95"] or 9999)
        + (0.25 * float(validation["p99"] or 9999))
        + (35.0 * float(validation["gt10Rate"] or 1.0))
        + (0.1 * abs(float(validation["signed"]["mean"] or 0.0)))
    )


def strict_objective(test_metrics: dict[str, Any]) -> float:
    return (
        float(test_metrics["p95"] or 9999)
        + (0.25 * float(test_metrics["p99"] or 9999))
        + (35.0 * float(test_metrics["gt10Rate"] or 1.0))
        + (0.1 * abs(float(test_metrics["signed"]["mean"] or 0.0)))
    )


def round_value(value: float | None, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(float(value), digits)


def rows_60hz(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for row in rows if row["refreshBucket"] == "60Hz"]


def clone_rows_for_package_holdout(rows: list[dict[str, Any]], heldout_package: str) -> list[dict[str, Any]]:
    cloned = []
    for row in rows:
        copied = dict(row)
        if row["packageId"] == heldout_package:
            copied["split"] = "test"
        elif row["split"] == "validation":
            copied["split"] = "validation"
        else:
            copied["split"] = "train"
        cloned.append(copied)
    return cloned


def build_teacher_specs(module: Any, bundle: Any) -> list[dict[str, Any]]:
    scalar_dim = int(bundle.scalar.shape[1])
    seq_dim = int(bundle.seq.shape[2])
    return [
        {
            "id": "teacher_transformer_residual_d96",
            "family": "Transformer",
            "objective": "residual",
            "weighted": False,
            "model": module.TransformerResidual(scalar_dim, seq_dim, 96, 4, 2),
        },
        {
            "id": "teacher_gru_residual_h128",
            "family": "GRU",
            "objective": "residual",
            "weighted": False,
            "model": module.GruResidual(scalar_dim, seq_dim, 128, 2),
        },
        {
            "id": "teacher_tcn_residual_c96",
            "family": "TCN",
            "objective": "residual",
            "weighted": False,
            "model": module.TcnResidual(scalar_dim, seq_dim, 96),
        },
    ]


def student_feature_matrix(bundle: Any, kind: str) -> np.ndarray:
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
            weights = weights / np.maximum(1e-9, weights.sum())
            parts.append(np.einsum("t,ntd->nd", weights, seq))
        parts.append(seq[:, -4:, :].mean(axis=1))
        parts.append(seq[:, -8:, :].mean(axis=1))
        return np.concatenate(parts, axis=1)
    raise ValueError(f"unknown feature kind: {kind}")


def normalize_train_validation_test(x: np.ndarray, train_mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean = x[train_mask].mean(axis=0, keepdims=True)
    std = np.maximum(x[train_mask].std(axis=0, keepdims=True), 0.05)
    return ((x - mean) / std).astype(np.float64), mean, std


def fit_ridge(x: np.ndarray, y: np.ndarray, train_mask: np.ndarray, validation_mask: np.ndarray, lambdas: list[float]) -> dict[str, Any]:
    x_norm, mean, std = normalize_train_validation_test(x, train_mask)
    design = np.concatenate([x_norm, np.ones((x_norm.shape[0], 1), dtype=np.float64)], axis=1)
    xt = design[train_mask]
    yt = y[train_mask].astype(np.float64)
    xv = design[validation_mask]
    yv = y[validation_mask].astype(np.float64)
    best = None
    identity = np.eye(xt.shape[1], dtype=np.float64)
    identity[-1, -1] = 0.0
    xtx = xt.T @ xt
    xty = xt.T @ yt
    for lam in lambdas:
        beta = np.linalg.solve(xtx + (lam * identity), xty)
        pred = xv @ beta
        rmse = float(np.sqrt(np.mean((pred - yv) ** 2)))
        if best is None or rmse < best["rmse"]:
            best = {"lambda": lam, "rmse": rmse, "beta": beta}
    pred_all = design @ best["beta"]
    return {
        "lambda": best["lambda"],
        "validationTeacherRmse": round(best["rmse"], 6),
        "prediction": pred_all.astype(np.float32),
        "featureDim": int(x.shape[1]),
        "parameterCount": int(best["beta"].size),
    }


class TinyStudent(nn.Module):
    def __init__(self, input_dim: int, hidden: int = 48) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            nn.SiLU(),
            nn.Linear(hidden, hidden),
            nn.SiLU(),
            nn.Linear(hidden, 2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def train_tiny_student(
    x: np.ndarray,
    target: np.ndarray,
    train_mask: np.ndarray,
    validation_mask: np.ndarray,
    device: torch.device,
    args: argparse.Namespace,
    started: float,
) -> dict[str, Any]:
    x_norm, _mean, _std = normalize_train_validation_test(x, train_mask)
    scale = np.percentile(np.abs(target[train_mask]), 95, axis=0, keepdims=True).astype(np.float32) + 0.5
    y_scaled = (target / scale).astype(np.float32)
    train_indices = np.where(train_mask)[0].astype(np.int64)
    validation_indices = np.where(validation_mask)[0].astype(np.int64)
    train_ds = TensorDataset(torch.from_numpy(x_norm[train_indices]).float(), torch.from_numpy(y_scaled[train_indices]).float())
    validation_ds = TensorDataset(torch.from_numpy(x_norm[validation_indices]).float(), torch.from_numpy(y_scaled[validation_indices]).float())
    generator = torch.Generator()
    generator.manual_seed(args.seed + 41)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, generator=generator, num_workers=0, pin_memory=device.type == "cuda")
    validation_loader = DataLoader(validation_ds, batch_size=args.batch_size * 2, shuffle=False, num_workers=0, pin_memory=device.type == "cuda")
    model = TinyStudent(x_norm.shape[1], 48).to(device)
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
            xb = xb.to(device, non_blocking=True)
            yb = yb.to(device, non_blocking=True)
            loss = F.smooth_l1_loss(model(xb), yb)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            optimizer.step()
        model.eval()
        losses = []
        with torch.no_grad():
            for xb, yb in validation_loader:
                loss = F.smooth_l1_loss(model(xb.to(device, non_blocking=True)), yb.to(device, non_blocking=True))
                losses.append(float(loss.detach().cpu()))
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
    model.to(device)
    all_ds = TensorDataset(torch.from_numpy(x_norm.astype(np.float32)).float())
    all_loader = DataLoader(all_ds, batch_size=args.batch_size * 2, shuffle=False, num_workers=0, pin_memory=device.type == "cuda")
    chunks = []
    model.eval()
    with torch.no_grad():
        for (xb,) in all_loader:
            chunks.append(model(xb.to(device, non_blocking=True)).detach().cpu().numpy())
    prediction = np.concatenate(chunks, axis=0) * scale
    params = sum(p.numel() for p in model.parameters())
    del model
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return {
        "prediction": prediction.astype(np.float32),
        "bestValidationLoss": round(best_loss, 6),
        "bestEpoch": best_epoch,
        "parameterCount": int(params),
        "featureDim": int(x.shape[1]),
    }


def evaluate_prediction(module: Any, model_id: str, pred: np.ndarray, bundle: Any, teacher: np.ndarray | None = None) -> dict[str, Any]:
    metrics = module.evaluate_prediction(model_id, pred, bundle, [])["bySplit"]
    out = {"bySplit": metrics}
    if teacher is not None:
        imitation = np.sqrt(np.sum((pred - teacher) ** 2, axis=1))
        out["teacherImitation"] = {
            split: module.stats(imitation[np.asarray([i for i, row in enumerate(bundle.row_meta) if row["split"] == split], dtype=np.int64)])
            for split in ("train", "validation", "test")
        }
    return out


def make_student_results(module: Any, bundle: Any, teacher_pred: np.ndarray, device: torch.device, args: argparse.Namespace, started: float) -> dict[str, Any]:
    split = np.asarray([row["split"] for row in bundle.row_meta])
    train_mask = split == "train"
    validation_mask = split == "validation"
    target_teacher = teacher_pred.astype(np.float32)
    target_label = bundle.target.astype(np.float32)
    results: dict[str, Any] = {}
    lambdas = [1e-4, 1e-3, 1e-2, 0.1, 1.0, 10.0, 100.0, 1000.0]
    for kind in ("scalar", "fsmn", "dense"):
        x = student_feature_matrix(bundle, kind)
        for target_name, target in (("teacher", target_teacher), ("label", target_label)):
            model_id = f"ridge_{kind}_{target_name}"
            fit = fit_ridge(x, target, train_mask, validation_mask, lambdas)
            results[model_id] = {
                "family": f"ridge_{kind}",
                "target": target_name,
                "lambda": fit["lambda"],
                "featureDim": fit["featureDim"],
                "parameterCount": fit["parameterCount"],
                "training": {"validationTeacherRmse": fit["validationTeacherRmse"]},
                "metrics": evaluate_prediction(module, model_id, fit["prediction"], bundle, teacher_pred),
            }
    x_tiny = student_feature_matrix(bundle, "fsmn")
    tiny = train_tiny_student(x_tiny, target_teacher, train_mask, validation_mask, device, args, started)
    results["tiny_mlp_fsmn_teacher"] = {
        "family": "tiny_mlp",
        "target": "teacher",
        "featureDim": tiny["featureDim"],
        "parameterCount": tiny["parameterCount"],
        "training": {"bestValidationLoss": tiny["bestValidationLoss"], "bestEpoch": tiny["bestEpoch"]},
        "metrics": evaluate_prediction(module, "tiny_mlp_fsmn_teacher", tiny["prediction"], bundle, teacher_pred),
    }
    return results


def ranking_for_models(models: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for model_id, payload in models.items():
        validation = payload["metrics"]["bySplit"]["validation"]
        rows.append({
            "modelId": model_id,
            "family": payload["family"],
            "target": payload.get("target", "label"),
            "objective": round(objective({"bySplit": {"validation": validation}}), 6),
            "validation": validation,
            "test": payload["metrics"]["bySplit"]["test"],
        })
    rows.sort(key=lambda item: (item["objective"], item["validation"]["p95"] or 9999, item["validation"]["p99"] or 9999))
    return rows


def train_teacher(module: Any, bundle: Any, spec: dict[str, Any], device: torch.device, args: argparse.Namespace, started: float, epochs: int) -> dict[str, Any]:
    local_args = argparse.Namespace(**vars(args))
    local_args.epochs = epochs
    training = module.train_model(spec["model"], bundle, spec["objective"], spec["weighted"], device, local_args, started)
    pred = module.predict_model(spec["model"], bundle, spec["objective"], device, args.batch_size)
    metrics = module.evaluate_prediction(spec["id"], pred, bundle, [])["bySplit"]
    params = sum(p.numel() for p in spec["model"].parameters())
    result = {
        "family": spec["family"],
        "target": "label",
        "objective": spec["objective"],
        "parameterCount": int(params),
        "training": training,
        "prediction": pred,
        "metrics": {"bySplit": metrics},
    }
    del spec["model"]
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return result


def package_holdout(module: Any, base_rows: list[dict[str, Any]], heldout_package: str, device: torch.device, args: argparse.Namespace, started: float) -> dict[str, Any]:
    rows = clone_rows_for_package_holdout(base_rows, heldout_package)
    bundle = module.build_dataset(rows)
    spec = {
        "id": "teacher_transformer_residual_d96",
        "family": "Transformer",
        "objective": "residual",
        "weighted": False,
        "model": module.TransformerResidual(int(bundle.scalar.shape[1]), int(bundle.seq.shape[2]), 96, 4, 2),
    }
    teacher = train_teacher(module, bundle, spec, device, args, started, args.holdout_epochs)
    students = make_student_results(module, bundle, teacher["prediction"], device, args, started)
    student_ranking = ranking_for_models(students)
    teacher_test = teacher["metrics"]["bySplit"]["test"]
    step5 = module.evaluate_prediction("step5_gate", bundle.baseline, bundle, [])["bySplit"]["test"]
    return {
        "heldoutPackage": heldout_package,
        "rows": bundle.summary["bySplit"],
        "teacher": {
            "test": teacher_test,
            "training": teacher["training"],
        },
        "step5": {"test": step5},
        "bestStudent": {
            "modelId": student_ranking[0]["modelId"],
            "family": student_ranking[0]["family"],
            "target": student_ranking[0]["target"],
            "validation": student_ranking[0]["validation"],
            "test": student_ranking[0]["test"],
        },
        "studentRanking": student_ranking[:8],
    }


def write_reports(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    teacher_rows = []
    for item in scores["teacherRanking"]:
        teacher_rows.append([
            item["modelId"],
            item["family"],
            item["validation"]["mean"],
            item["validation"]["p95"],
            item["validation"]["p99"],
            item["test"]["p95"],
            item["test"]["p99"],
        ])
    student_rows = []
    for item in scores["studentRanking"][:12]:
        imitation = scores["students"][item["modelId"]]["metrics"].get("teacherImitation", {}).get("validation", {})
        student_rows.append([
            item["modelId"],
            item["family"],
            item["target"],
            item["validation"]["mean"],
            item["validation"]["p95"],
            item["validation"]["p99"],
            item["test"]["p95"],
            item["test"]["p99"],
            imitation.get("mean"),
            imitation.get("p95"),
        ])
    holdout_rows = []
    for fold in scores["packageHoldouts"]:
        holdout_rows.append([
            fold["heldoutPackage"],
            fold["teacher"]["test"]["p95"],
            fold["teacher"]["test"]["p99"],
            fold["bestStudent"]["modelId"],
            fold["bestStudent"]["test"]["p95"],
            fold["bestStudent"]["test"]["p99"],
            fold["step5"]["test"]["p95"],
            fold["step5"]["test"]["p99"],
        ])
    report = f"""# Cursor Prediction v14 - 60Hz Teacher Distillation

## Intent

POC 14 narrows the target to the latest 60Hz v9 data only. The goal is to treat a GPU-trained deep teacher as the accuracy target, then see how closely CPU-friendly students can approximate it.

## Environment

- Device: `{scores['environment']['device']}`
- GPU: `{scores['environment']['gpuName']}`
- Torch: `{scores['environment']['torchVersion']}`
- CUDA: `{scores['environment']['cudaVersion']}`

No raw ZIPs, expanded CSVs, feature caches, checkpoints, TensorBoard logs, or model weight files were written.

## Dataset

- Rows: {scores['dataset']['rows']}
- Packages: `{scores['dataset']['byPackage']}`
- Splits: `{scores['dataset']['bySplit']}`
- Phase: `{scores['dataset']['byPhase']}`
- Speed bins: `{scores['dataset']['bySpeedBin']}`

Only 60Hz rows are used. 30Hz rows are intentionally excluded from this POC.

## Teacher Search

{table(['teacher', 'family', 'val mean', 'val p95', 'val p99', 'test p95', 'test p99'], teacher_rows)}

Selected teacher: `{scores['selectedTeacher']}`.

## Student Distillation

{table(['student', 'family', 'target', 'val mean', 'val p95', 'val p99', 'test p95', 'test p99', 'teacher mean', 'teacher p95'], student_rows)}

Selected student: `{scores['selectedStudent']}`.

## 60Hz Package Holdout

{table(['heldout package', 'teacher p95', 'teacher p99', 'best student', 'student p95', 'student p99', 'Step5 p95', 'Step5 p99'], holdout_rows)}

## Interpretation

{scores['interpretation']}
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    notes = f"""# Notes

Run command:

```powershell
$env:UV_CACHE_DIR=(Resolve-Path '.uv-cache').Path
$env:UV_PYTHON_INSTALL_DIR=(Join-Path (Get-Location) '.uv-python')
uv run --python 'C:\\Users\\seigl\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe' --with numpy==2.4.3 --with torch==2.11.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128 python poc\\cursor-prediction-v14\\scripts\\run-60hz-distillation-gpu.py
```

The experiment is intentionally 60Hz-only. It is not a 30Hz product decision.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")
    readme = """# Cursor Prediction v14

60Hz-only teacher distillation experiment.

Artifacts:

- `report.md`: human-readable summary.
- `scores.json`: machine-readable metrics.
- `notes.md`: rerun command and artifact policy.
- `scripts/run-60hz-distillation-gpu.py`: reproducible GPU experiment script.

No raw ZIP files, expanded CSVs, checkpoints, feature caches, model weights, or TensorBoard logs are stored here.
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
    context = module.load_manifest(args.manifest)
    packages = [module.load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    all_rows, build_summary = module.build_rows(packages)
    filtered_rows = rows_60hz(all_rows)
    bundle = module.build_dataset(filtered_rows)

    step5_metrics = module.evaluate_prediction("step5_gate", bundle.baseline, bundle, [])["bySplit"]
    teachers: dict[str, Any] = {}
    for spec in build_teacher_specs(module, bundle):
        if time.perf_counter() - started > args.max_seconds:
            break
        teachers[spec["id"]] = train_teacher(module, bundle, spec, device, args, started, args.teacher_epochs)
    teacher_ranking = []
    for model_id, payload in teachers.items():
        validation = payload["metrics"]["bySplit"]["validation"]
        test = payload["metrics"]["bySplit"]["test"]
        teacher_ranking.append({
            "modelId": model_id,
            "family": payload["family"],
            "objective": round(objective({"bySplit": {"validation": validation}}), 6),
            "validation": validation,
            "test": test,
        })
    teacher_ranking.sort(key=lambda item: (item["objective"], item["validation"]["p95"] or 9999, item["validation"]["p99"] or 9999))
    selected_teacher = teacher_ranking[0]["modelId"]
    teacher_pred = teachers[selected_teacher]["prediction"]

    students = make_student_results(module, bundle, teacher_pred, device, args, started)
    student_ranking = ranking_for_models(students)
    selected_student = student_ranking[0]["modelId"]

    package_holdouts = []
    for package_id in sorted(set(row["packageId"] for row in filtered_rows)):
        if time.perf_counter() - started > args.max_seconds:
            break
        package_holdouts.append(package_holdout(module, filtered_rows, package_id, device, args, started))

    selected_student_validation = students[selected_student]["metrics"]["bySplit"]["validation"]
    teacher_validation = teachers[selected_teacher]["metrics"]["bySplit"]["validation"]
    step5_validation = step5_metrics["validation"]
    if (selected_student_validation["p95"] or 9999) < (step5_validation["p95"] or 9999) and (selected_student_validation["p99"] or 9999) < (step5_validation["p99"] or 9999):
        interpretation = (
            "The 60Hz-only deep teacher is learnable and at least one CPU-friendly student beats the Step 5 gate on the standard 60Hz split. "
            "Package holdout remains the promotion gate: regressions there should block direct product integration."
        )
    else:
        interpretation = (
            "The 60Hz-only teacher improves the target score, but the tested CPU-friendly students do not yet beat the Step 5 gate. "
            "This suggests keeping the teacher as a distillation target and trying richer CPU approximators."
        )
    if (teacher_validation["p95"] or 9999) < (step5_validation["p95"] or 9999):
        interpretation += " The teacher itself is a clear upper-bound improvement over Step 5 in the 60Hz standard split."

    compact_teachers = {
        model_id: {
            key: value for key, value in payload.items() if key != "prediction"
        }
        for model_id, payload in teachers.items()
    }
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
        "step5": {"metrics": {"bySplit": step5_metrics}},
        "teachers": compact_teachers,
        "teacherRanking": teacher_ranking,
        "selectedTeacher": selected_teacher,
        "students": students,
        "studentRanking": student_ranking,
        "selectedStudent": selected_student,
        "packageHoldouts": package_holdouts,
        "interpretation": interpretation,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    write_reports(args.out_dir, scores)
    print(json.dumps({
        "selectedTeacher": selected_teacher,
        "selectedStudent": selected_student,
        "gpuUsed": device.type == "cuda",
        "rows": bundle.summary["rows"],
        "elapsedSeconds": scores["elapsedSeconds"],
        "teacherTop": teacher_ranking[:3],
        "studentTop": student_ranking[:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
