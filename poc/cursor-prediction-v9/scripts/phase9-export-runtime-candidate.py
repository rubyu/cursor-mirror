#!/usr/bin/env python3
"""Phase 9 fixed runtime candidate export and C# evaluator prototype.

Exports the Phase 8 product-shaped candidate as fixed runtime weights:

  teacher: mlp_seq32_h256_128_64
  gate: tiny MLP, margin 5px, p >= 0.90
  apply condition: speed < 1000 px/s
  residual clamp: 4px

All training data remains in memory. The final model weights JSON and C#
prototype source are written under poc/cursor-prediction-v9/runtime-prototype.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import random
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn


SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR.parent
RUNTIME_DIR = OUT_DIR / "runtime-prototype"


def load_local_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


p3 = load_local_module("phase3_ml_teachers_for_phase9", SCRIPT_DIR / "phase3-ml-teachers.py")
p4 = load_local_module("phase4_guarded_mlp_for_phase9", SCRIPT_DIR / "phase4-guarded-mlp.py")
p5 = load_local_module("phase5_expanded_teachers_for_phase9", SCRIPT_DIR / "phase5-expanded-teachers.py")
p6 = load_local_module("phase6_confidence_gate_for_phase9", SCRIPT_DIR / "phase6-confidence-gate.py")
p7 = load_local_module("phase7_max_safe_gate_for_phase9", SCRIPT_DIR / "phase7-max-safe-gate.py")


TEACHER_ID = "mlp_seq32_h256_128_64"
GATE_KIND = "tiny-mlp"
GATE_MARGIN_PX = 5.0
GATE_PROBABILITY_THRESHOLD = 0.90
APPLY_SPEED_MAX_PX_PER_SEC = 1000.0
RESIDUAL_CLAMP_PX = 4.0
SAMPLE_COUNT = 128


class GateTinyMLP(nn.Module):
    def __init__(self, input_dim: int = 7, hidden: int = 8):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(input_dim, hidden), nn.ReLU(), nn.Linear(hidden, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


def parse_args() -> argparse.Namespace:
    root = SCRIPT_DIR.parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-json", type=Path, default=OUT_DIR / "phase-9-runtime-candidate.json")
    parser.add_argument("--out-md", type=Path, default=OUT_DIR / "phase-9-runtime-candidate.md")
    parser.add_argument("--seed", type=int, default=20260509)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--max-epochs", type=int, default=20)
    parser.add_argument("--patience", type=int, default=3)
    return parser.parse_args()


def train_teacher(
    spec: dict[str, Any],
    train: Any,
    validation: Any,
    evaluation: Any,
    seed: int,
    max_epochs: int,
    patience: int,
    batch_size: int,
    device: torch.device,
) -> dict[str, Any]:
    torch.manual_seed(seed)
    np.random.seed(seed)
    random.seed(seed)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(seed)
    train_tab, validation_tab, evaluation_tab, norm = standardize_three_export(train.tab, validation.tab, evaluation.tab)
    seq_train = torch.from_numpy(train.seq).to(device)
    ctx_train = torch.from_numpy(train.ctx).to(device)
    tab_train = torch.from_numpy(train_tab).to(device)
    y_train = torch.from_numpy(train.residual).to(device)
    seq_val = torch.from_numpy(validation.seq).to(device)
    ctx_val = torch.from_numpy(validation.ctx).to(device)
    tab_val = torch.from_numpy(validation_tab).to(device)
    y_val = torch.from_numpy(validation.residual).to(device)
    seq_eval = torch.from_numpy(evaluation.seq).to(device)
    ctx_eval = torch.from_numpy(evaluation.ctx).to(device)
    tab_eval = torch.from_numpy(evaluation_tab).to(device)
    model = p5.make_model(spec, train).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_fn = nn.SmoothL1Loss(beta=0.2)
    best_loss = float("inf")
    best_epoch = 0
    best_state: dict[str, torch.Tensor] | None = None
    wait = 0
    losses: list[dict[str, float]] = []
    started = time.perf_counter()
    for epoch in range(1, max_epochs + 1):
        model.train()
        order = torch.randperm(seq_train.shape[0], device=device)
        running = 0.0
        steps = 0
        for start in range(0, seq_train.shape[0], batch_size):
            idx = order[start:start + batch_size]
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(seq_train[idx], ctx_train[idx], tab_train[idx]), y_train[idx])
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
        losses.append({"epoch": epoch, "trainLoss": train_loss, "validationLoss": val_loss_mean})
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
    validation_pred, validation_inference_sec = p5.predict_torch(model, seq_val, ctx_val, tab_val, batch_size, True)
    evaluation_pred, evaluation_inference_sec = p5.predict_torch(model, seq_eval, ctx_eval, tab_eval, batch_size, True)
    state = {key: value.detach().cpu().numpy().astype(np.float32) for key, value in model.state_dict().items()}
    param_count = p3.count_params(model)
    del optimizer, seq_train, ctx_train, tab_train, y_train, seq_val, ctx_val, tab_val, y_val, seq_eval, ctx_eval, tab_eval, model
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return {
        "state": state,
        "normalization": norm,
        "validationPred": validation_pred,
        "evaluationPred": evaluation_pred,
        "meta": {
            "trainSec": train_sec,
            "validationInferenceSec": validation_inference_sec,
            "evaluationInferenceSec": evaluation_inference_sec,
            "evaluationRowsPerSecGpu": float(evaluation.target.shape[0] / evaluation_inference_sec) if evaluation_inference_sec > 0 else None,
            "paramCount": int(param_count),
            "epochsRun": len(losses),
            "bestEpoch": best_epoch,
            "bestValidationLoss": best_loss,
            "losses": losses,
        },
    }


def standardize_three_export(train: np.ndarray, validation: np.ndarray, evaluation: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    mean = train.mean(axis=0, keepdims=True).astype(np.float32)
    std = train.std(axis=0, keepdims=True).astype(np.float32)
    std[std < 1e-6] = 1.0
    return (
        ((train - mean) / std).astype(np.float32),
        ((validation - mean) / std).astype(np.float32),
        ((evaluation - mean) / std).astype(np.float32),
        {
            "mean": mean.reshape(-1).tolist(),
            "std": std.reshape(-1).tolist(),
            "meanShape": list(mean.shape),
            "stdMin": float(std.min()),
            "stdMax": float(std.max()),
        },
    )


def train_gate(features: np.ndarray, target: np.ndarray, seed: int) -> dict[str, Any]:
    torch.manual_seed(seed)
    np.random.seed(seed)
    x = torch.from_numpy(features.astype(np.float32))
    y = torch.from_numpy(target.astype(np.float32))
    model = GateTinyMLP(features.shape[1], 8)
    positives = float(target.sum())
    negatives = float(target.shape[0] - positives)
    pos_weight_value = min(20.0, max(1.0, negatives / max(1.0, positives)))
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(pos_weight_value, dtype=torch.float32))
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.015, weight_decay=1e-4)
    started = time.perf_counter()
    losses = []
    for _ in range(120):
        optimizer.zero_grad(set_to_none=True)
        loss = loss_fn(model(x), y)
        loss.backward()
        optimizer.step()
        losses.append(float(loss.detach()))
    train_sec = time.perf_counter() - started
    with torch.no_grad():
        probs = torch.sigmoid(model(x)).numpy().astype(np.float32)
    state = {key: value.detach().numpy().astype(np.float32) for key, value in model.state_dict().items()}
    return {
        "state": state,
        "trainProb": probs,
        "meta": {
            "trainSec": train_sec,
            "positiveRate": float(target.mean()),
            "posWeight": pos_weight_value,
            "lossStart": losses[0],
            "lossEnd": losses[-1],
            "paramCount": int(sum(param.numel() for param in model.parameters())),
            "estimatedOpsPerSample": 86,
        },
    }


def evaluate_candidate(dataset: Any, residual_px: np.ndarray, probabilities: np.ndarray) -> tuple[dict[str, Any], np.ndarray, np.ndarray]:
    speed = dataset.ctx[:, 3].astype(np.float32) * 5000.0
    mask = (probabilities >= GATE_PROBABILITY_THRESHOLD) & (speed < APPLY_SPEED_MAX_PX_PER_SEC)
    applied = p7.clamp_residual(np.where(mask[:, None], residual_px, 0.0), RESIDUAL_CLAMP_PX)
    return p7.evaluate(dataset, applied), applied, mask


def flatten_state_array(state: dict[str, np.ndarray], key: str) -> list[float]:
    return state[key].reshape(-1).astype(np.float32).tolist()


def as_float_list(values: np.ndarray | list[float]) -> list[float]:
    return np.asarray(values, dtype=np.float32).reshape(-1).tolist()


def export_model_json(path: Path, teacher_result: dict[str, Any], gate_result: dict[str, Any], gate_norm: dict[str, Any]) -> dict[str, Any]:
    teacher_state = teacher_result["state"]
    gate_state = gate_result["state"]
    model = {
        "schemaVersion": "cursor-prediction-v9-runtime-candidate/1",
        "candidate": {
            "teacher": TEACHER_ID,
            "teacherInput": "seq32 flattened tab features: 32*8 sequence + 9 context values",
            "gate": GATE_KIND,
            "gateFeatures": p6.FEATURE_NAMES,
            "gateMarginPx": GATE_MARGIN_PX,
            "gateProbabilityThreshold": GATE_PROBABILITY_THRESHOLD,
            "applySpeedMaxPxPerSec": APPLY_SPEED_MAX_PX_PER_SEC,
            "residualClampPx": RESIDUAL_CLAMP_PX,
        },
        "teacher": {
            "normalization": {
                "mean": as_float_list(teacher_result["normalization"]["mean"]),
                "std": as_float_list(teacher_result["normalization"]["std"]),
            },
            "layers": [
                {"in": 265, "out": 256, "weight": flatten_state_array(teacher_state, "net.0.weight"), "bias": flatten_state_array(teacher_state, "net.0.bias"), "activation": "relu"},
                {"in": 256, "out": 128, "weight": flatten_state_array(teacher_state, "net.2.weight"), "bias": flatten_state_array(teacher_state, "net.2.bias"), "activation": "relu"},
                {"in": 128, "out": 64, "weight": flatten_state_array(teacher_state, "net.4.weight"), "bias": flatten_state_array(teacher_state, "net.4.bias"), "activation": "relu"},
                {"in": 64, "out": 2, "weight": flatten_state_array(teacher_state, "net.6.weight"), "bias": flatten_state_array(teacher_state, "net.6.bias"), "activation": "linear", "outputScalePx": 50.0},
            ],
        },
        "gate": {
            "normalization": {
                "featureNames": p6.FEATURE_NAMES,
                "mean": as_float_list(gate_norm["mean"]),
                "std": as_float_list(gate_norm["std"]),
            },
            "layers": [
                {"in": 7, "out": 8, "weight": flatten_state_array(gate_state, "net.0.weight"), "bias": flatten_state_array(gate_state, "net.0.bias"), "activation": "relu"},
                {"in": 8, "out": 1, "weight": flatten_state_array(gate_state, "net.2.weight"), "bias": flatten_state_array(gate_state, "net.2.bias"), "activation": "sigmoid"},
            ],
        },
    }
    path.write_text(json.dumps(model, separators=(",", ":")) + "\n", encoding="utf-8")
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "teacherWeightCount": sum(len(layer["weight"]) + len(layer["bias"]) for layer in model["teacher"]["layers"]),
        "gateWeightCount": sum(len(layer["weight"]) + len(layer["bias"]) for layer in model["gate"]["layers"]),
    }


def csharp_float(value: float) -> str:
    if math.isnan(value):
        return "float.NaN"
    if math.isinf(value):
        return "float.PositiveInfinity" if value > 0 else "float.NegativeInfinity"
    return f"{np.float32(value).item():.9g}f"


def csharp_array(name: str, values: list[float], indent: str = "        ") -> str:
    chunks = []
    for start in range(0, len(values), 12):
        chunk = ", ".join(csharp_float(float(v)) for v in values[start:start + 12])
        chunks.append(indent + chunk)
    body = ",\n".join(chunks)
    return f"    public static readonly float[] {name} = new float[] {{\n{body}\n    }};\n"


def write_csharp_files(
    runtime_dir: Path,
    model_json: dict[str, Any],
    samples: dict[str, Any],
) -> dict[str, str]:
    runtime_dir.mkdir(parents=True, exist_ok=True)
    evaluator_path = runtime_dir / "RuntimeCandidateEvaluator.cs"
    weights_path = runtime_dir / "RuntimeCandidateWeights.g.cs"
    samples_path = runtime_dir / "RuntimeCandidateSamples.g.cs"
    runner_path = runtime_dir / "run-evaluator.ps1"
    result_path = runtime_dir / "csharp-verification-result.json"

    evaluator_path.write_text(r'''using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;

namespace CursorPredictionV9RuntimePrototype
{
    public struct Evaluation
    {
        public float TeacherX;
        public float TeacherY;
        public float GateProbability;
        public bool Apply;
        public float FinalX;
        public float FinalY;
    }

    public static class RuntimeCandidateEvaluator
    {
        public static Evaluation Evaluate(float[] tab, float[] gateFeatures)
        {
            float[] h1 = new float[256];
            float[] h2 = new float[128];
            float[] h3 = new float[64];
            float[] normalizedTab = new float[Phase9RuntimeWeights.TeacherMean.Length];
            for (int i = 0; i < normalizedTab.Length; i++)
            {
                normalizedTab[i] = (tab[i] - Phase9RuntimeWeights.TeacherMean[i]) / Phase9RuntimeWeights.TeacherStd[i];
            }
            LinearRelu(normalizedTab, Phase9RuntimeWeights.TeacherW0, Phase9RuntimeWeights.TeacherB0, h1, 265, 256);
            LinearRelu(h1, Phase9RuntimeWeights.TeacherW1, Phase9RuntimeWeights.TeacherB1, h2, 256, 128);
            LinearRelu(h2, Phase9RuntimeWeights.TeacherW2, Phase9RuntimeWeights.TeacherB2, h3, 128, 64);
            float teacherXNorm = LinearOne(h3, Phase9RuntimeWeights.TeacherW3, Phase9RuntimeWeights.TeacherB3[0], 64, 0);
            float teacherYNorm = LinearOne(h3, Phase9RuntimeWeights.TeacherW3, Phase9RuntimeWeights.TeacherB3[1], 64, 1);
            float teacherX = teacherXNorm * 50.0f;
            float teacherY = teacherYNorm * 50.0f;

            float[] gateInput = new float[7];
            for (int i = 0; i < gateInput.Length; i++)
            {
                gateInput[i] = (gateFeatures[i] - Phase9RuntimeWeights.GateMean[i]) / Phase9RuntimeWeights.GateStd[i];
            }
            float[] gateHidden = new float[8];
            LinearRelu(gateInput, Phase9RuntimeWeights.GateW0, Phase9RuntimeWeights.GateB0, gateHidden, 7, 8);
            float logit = LinearOne(gateHidden, Phase9RuntimeWeights.GateW1, Phase9RuntimeWeights.GateB1[0], 8, 0);
            float probability = Sigmoid(logit);
            bool apply = probability >= 0.90f && gateFeatures[5] * 5000.0f < 1000.0f;
            float finalX = 0.0f;
            float finalY = 0.0f;
            if (apply)
            {
                finalX = teacherX;
                finalY = teacherY;
                Clamp(ref finalX, ref finalY, 4.0f);
            }
            return new Evaluation
            {
                TeacherX = teacherX,
                TeacherY = teacherY,
                GateProbability = probability,
                Apply = apply,
                FinalX = finalX,
                FinalY = finalY,
            };
        }

        private static void LinearRelu(float[] input, float[] weights, float[] bias, float[] output, int inputSize, int outputSize)
        {
            for (int o = 0; o < outputSize; o++)
            {
                float sum = bias[o];
                int offset = o * inputSize;
                for (int i = 0; i < inputSize; i++)
                {
                    sum += weights[offset + i] * input[i];
                }
                output[o] = sum > 0.0f ? sum : 0.0f;
            }
        }

        private static float LinearOne(float[] input, float[] weights, float bias, int inputSize, int outputIndex)
        {
            float sum = bias;
            int offset = outputIndex * inputSize;
            for (int i = 0; i < inputSize; i++)
            {
                sum += weights[offset + i] * input[i];
            }
            return sum;
        }

        private static float Sigmoid(float x)
        {
            if (x >= 0)
            {
                float z = (float)Math.Exp(-x);
                return 1.0f / (1.0f + z);
            }
            else
            {
                float z = (float)Math.Exp(x);
                return z / (1.0f + z);
            }
        }

        private static void Clamp(ref float x, ref float y, float cap)
        {
            float mag = (float)Math.Sqrt(x * x + y * y);
            if (mag > cap && mag > 1e-6f)
            {
                float scale = cap / mag;
                x *= scale;
                y *= scale;
            }
        }
    }

    public static class PrototypeRunner
    {
        public static void Run(string outputPath)
        {
            int count = Phase9RuntimeSamples.SampleCount;
            double maxTeacherDiff = 0.0;
            double maxGateDiff = 0.0;
            double maxFinalDiff = 0.0;
            int applyMismatches = 0;
            for (int s = 0; s < count; s++)
            {
                Evaluation e = RuntimeCandidateEvaluator.Evaluate(Phase9RuntimeSamples.GetTab(s), Phase9RuntimeSamples.GetGateFeatures(s));
                double teacherDiff = Math.Max(Math.Abs(e.TeacherX - Phase9RuntimeSamples.ExpectedTeacher[2 * s]), Math.Abs(e.TeacherY - Phase9RuntimeSamples.ExpectedTeacher[2 * s + 1]));
                double gateDiff = Math.Abs(e.GateProbability - Phase9RuntimeSamples.ExpectedGateProbability[s]);
                double finalDiff = Math.Max(Math.Abs(e.FinalX - Phase9RuntimeSamples.ExpectedFinal[2 * s]), Math.Abs(e.FinalY - Phase9RuntimeSamples.ExpectedFinal[2 * s + 1]));
                if (e.Apply != Phase9RuntimeSamples.ExpectedApply[s]) applyMismatches++;
                if (teacherDiff > maxTeacherDiff) maxTeacherDiff = teacherDiff;
                if (gateDiff > maxGateDiff) maxGateDiff = gateDiff;
                if (finalDiff > maxFinalDiff) maxFinalDiff = finalDiff;
            }

            int repeats = 1;
            long evaluations = 0;
            double elapsed = 0.0;
            Evaluation sink = default(Evaluation);
            do
            {
                Stopwatch sw = Stopwatch.StartNew();
                for (int r = 0; r < repeats; r++)
                {
                    for (int s = 0; s < count; s++)
                    {
                        sink = RuntimeCandidateEvaluator.Evaluate(Phase9RuntimeSamples.GetTab(s), Phase9RuntimeSamples.GetGateFeatures(s));
                    }
                }
                sw.Stop();
                evaluations = (long)repeats * count;
                elapsed = sw.Elapsed.TotalSeconds;
                repeats *= 2;
            }
            while (elapsed < 0.35 && evaluations < 8192);

            double rowsPerSec = evaluations / elapsed;
            string json = "{" +
                "\"sampleCount\":" + count.ToString(CultureInfo.InvariantCulture) + "," +
                "\"maxTeacherAbsDiff\":" + maxTeacherDiff.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"maxGateProbabilityAbsDiff\":" + maxGateDiff.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"maxFinalAbsDiff\":" + maxFinalDiff.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"applyMismatches\":" + applyMismatches.ToString(CultureInfo.InvariantCulture) + "," +
                "\"throughputEvaluations\":" + evaluations.ToString(CultureInfo.InvariantCulture) + "," +
                "\"throughputSeconds\":" + elapsed.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"rowsPerSecond\":" + rowsPerSec.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"vectorHardwareAccelerated\":false," +
                "\"sink\":" + sink.FinalX.ToString("R", CultureInfo.InvariantCulture) +
                "}";
            File.WriteAllText(outputPath, json);
        }
    }
}
''', encoding="utf-8")

    teacher = model_json["teacher"]
    gate = model_json["gate"]
    weights_parts = [
        "using System;\n\nnamespace CursorPredictionV9RuntimePrototype\n{\npublic static class Phase9RuntimeWeights\n{\n",
        csharp_array("TeacherMean", teacher["normalization"]["mean"]),
        csharp_array("TeacherStd", teacher["normalization"]["std"]),
        csharp_array("TeacherW0", teacher["layers"][0]["weight"]),
        csharp_array("TeacherB0", teacher["layers"][0]["bias"]),
        csharp_array("TeacherW1", teacher["layers"][1]["weight"]),
        csharp_array("TeacherB1", teacher["layers"][1]["bias"]),
        csharp_array("TeacherW2", teacher["layers"][2]["weight"]),
        csharp_array("TeacherB2", teacher["layers"][2]["bias"]),
        csharp_array("TeacherW3", teacher["layers"][3]["weight"]),
        csharp_array("TeacherB3", teacher["layers"][3]["bias"]),
        csharp_array("GateMean", gate["normalization"]["mean"]),
        csharp_array("GateStd", gate["normalization"]["std"]),
        csharp_array("GateW0", gate["layers"][0]["weight"]),
        csharp_array("GateB0", gate["layers"][0]["bias"]),
        csharp_array("GateW1", gate["layers"][1]["weight"]),
        csharp_array("GateB1", gate["layers"][1]["bias"]),
        "}\n}\n",
    ]
    weights_path.write_text("".join(weights_parts), encoding="utf-8")

    sample_parts = [
        "using System;\n\nnamespace CursorPredictionV9RuntimePrototype\n{\npublic static class Phase9RuntimeSamples\n{\n",
        f"    public const int SampleCount = {samples['sampleCount']};\n",
        f"    public const int TabSize = {samples['tabSize']};\n",
        f"    public const int GateFeatureSize = {samples['gateFeatureSize']};\n",
        csharp_array("Tabs", samples["tabs"]),
        csharp_array("GateFeatures", samples["gateFeatures"]),
        csharp_array("ExpectedTeacher", samples["expectedTeacher"]),
        csharp_array("ExpectedGateProbability", samples["expectedGateProbability"]),
        csharp_array("ExpectedFinal", samples["expectedFinal"]),
        "    public static readonly bool[] ExpectedApply = new bool[] {\n        " + ", ".join("true" if v else "false" for v in samples["expectedApply"]) + "\n    };\n",
        "    public static float[] GetTab(int sample)\n    {\n        float[] output = new float[TabSize];\n        Array.Copy(Tabs, sample * TabSize, output, 0, TabSize);\n        return output;\n    }\n",
        "    public static float[] GetGateFeatures(int sample)\n    {\n        float[] output = new float[GateFeatureSize];\n        Array.Copy(GateFeatures, sample * GateFeatureSize, output, 0, GateFeatureSize);\n        return output;\n    }\n",
        "}\n}\n",
    ]
    samples_path.write_text("".join(sample_parts), encoding="utf-8")

    runner_path.write_text(f"""$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sources = @(
  (Join-Path $root 'RuntimeCandidateEvaluator.cs'),
  (Join-Path $root 'RuntimeCandidateWeights.g.cs'),
  (Join-Path $root 'RuntimeCandidateSamples.g.cs')
)
Add-Type -Path $sources -ReferencedAssemblies 'System.Numerics.dll'
[CursorPredictionV9RuntimePrototype.PrototypeRunner]::Run((Join-Path $root 'csharp-verification-result.json'))
Get-Content (Join-Path $root 'csharp-verification-result.json')
""", encoding="utf-8")
    return {
        "evaluator": str(evaluator_path),
        "weightsSource": str(weights_path),
        "samplesSource": str(samples_path),
        "runner": str(runner_path),
        "result": str(result_path),
    }


def python_evaluate_exported(tab: np.ndarray, gate_features: np.ndarray, model_json: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    teacher = model_json["teacher"]
    gate = model_json["gate"]
    x = (tab - np.asarray(teacher["normalization"]["mean"], dtype=np.float32)) / np.asarray(teacher["normalization"]["std"], dtype=np.float32)
    for layer in teacher["layers"][:-1]:
        w = np.asarray(layer["weight"], dtype=np.float32).reshape(layer["out"], layer["in"])
        b = np.asarray(layer["bias"], dtype=np.float32)
        x = np.maximum(x @ w.T + b, 0.0)
    last = teacher["layers"][-1]
    w = np.asarray(last["weight"], dtype=np.float32).reshape(last["out"], last["in"])
    b = np.asarray(last["bias"], dtype=np.float32)
    teacher_px = (x @ w.T + b) * 50.0
    g = (gate_features - np.asarray(gate["normalization"]["mean"], dtype=np.float32)) / np.asarray(gate["normalization"]["std"], dtype=np.float32)
    gw0 = np.asarray(gate["layers"][0]["weight"], dtype=np.float32).reshape(8, 7)
    gb0 = np.asarray(gate["layers"][0]["bias"], dtype=np.float32)
    gh = np.maximum(g @ gw0.T + gb0, 0.0)
    gw1 = np.asarray(gate["layers"][1]["weight"], dtype=np.float32).reshape(1, 8)
    gb1 = np.asarray(gate["layers"][1]["bias"], dtype=np.float32)
    logits = (gh @ gw1.T + gb1).reshape(-1)
    probs = 1.0 / (1.0 + np.exp(-logits))
    apply = (probs >= GATE_PROBABILITY_THRESHOLD) & (gate_features[:, 5] * 5000.0 < APPLY_SPEED_MAX_PX_PER_SEC)
    final = p7.clamp_residual(np.where(apply[:, None], teacher_px, 0.0), RESIDUAL_CLAMP_PX)
    return teacher_px.astype(np.float32), probs.astype(np.float32), apply, final.astype(np.float32)


def make_samples(dataset: Any, gate_features: np.ndarray, model_json: dict[str, Any], seed: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    rng = np.random.default_rng(seed)
    count = min(SAMPLE_COUNT, dataset.target.shape[0])
    indices = rng.choice(dataset.target.shape[0], size=count, replace=False)
    indices.sort()
    tabs = dataset.tab[indices].astype(np.float32)
    features = gate_features[indices].astype(np.float32)
    teacher_px, probs, apply, final = python_evaluate_exported(tabs, features, model_json)
    samples = {
        "sampleCount": int(count),
        "tabSize": int(tabs.shape[1]),
        "gateFeatureSize": int(features.shape[1]),
        "indices": indices.astype(int).tolist(),
        "tabs": tabs.reshape(-1).tolist(),
        "gateFeatures": features.reshape(-1).tolist(),
        "expectedTeacher": teacher_px.reshape(-1).tolist(),
        "expectedGateProbability": probs.reshape(-1).tolist(),
        "expectedApply": [bool(v) for v in apply.tolist()],
        "expectedFinal": final.reshape(-1).tolist(),
    }
    inspect_samples = []
    for i in range(min(16, count)):
        inspect_samples.append({
            "index": int(indices[i]),
            "gateFeatures": features[i].tolist(),
            "teacherResidualPx": teacher_px[i].tolist(),
            "gateProbability": float(probs[i]),
            "apply": bool(apply[i]),
            "finalResidualPx": final[i].tolist(),
        })
    return samples, inspect_samples


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


def metric_row(role: str, entry: dict[str, Any]) -> list[str]:
    metrics = entry["metrics"]
    reg = entry["regressionsVsBaseline"]
    return [
        role,
        fmt(metrics["mean"]),
        fmt(metrics["rmse"]),
        fmt(metrics["p95"]),
        fmt(metrics["p99"]),
        fmt(metrics["max"]),
        str(reg["worseOver1px"]),
        str(reg["worseOver3px"]),
        str(reg["worseOver5px"]),
        str(reg["worseOver10px"]),
        str(reg["worseOver20px"]),
        str(reg["worseOver50px"]),
        str(reg["improvedOver1px"]),
    ]


def render_markdown(result: dict[str, Any]) -> str:
    runtime = result["runtimePrototype"]
    verification = result["csharpVerification"]
    rows = [
        metric_row("validation baseline", result["metrics"]["finalValidationBaseline"]),
        metric_row("validation candidate", result["metrics"]["finalValidation"]),
        metric_row("all rows baseline", result["metrics"]["allRowsBaseline"]),
        metric_row("all rows teacher", result["metrics"]["allRowsTeacherAlone"]),
        metric_row("all rows candidate", result["metrics"]["allRowsReplay"]),
    ]
    return f"""# Cursor Prediction v9 Phase 9 Runtime Candidate

Generated: {result['generatedAt']}

Candidate: `mlp_seq32_h256_128_64 + tiny-MLP gate m5 p>=0.90 speed<1000 clamp4`

No Calibrator run, checkpoint, cache, TensorBoard, or expanded dataset artifact
was written. The runtime model weights JSON and C# prototype source are under
`runtime-prototype/`.

GPU was used only for offline training/export. Product inference must use the
fixed weights on CPU; this phase gates integration on C# CPU throughput.

## Metrics

{md_table(["split", "mean", "rmse", "p95", "p99", "max", ">1", ">3", ">5", ">10", ">20", ">50", "improved"], rows)}

## Export

Model JSON bytes: `{runtime['modelJsonBytes']}`  
Teacher weights: `{runtime['teacherWeightCount']}` floats  
Gate weights: `{runtime['gateWeightCount']}` floats  
C# source files: `{len(runtime['csharpFiles'])}`

## C# Verification

Samples: `{verification.get('sampleCount')}`  
Max teacher abs diff: `{fmt(verification.get('maxTeacherAbsDiff'), 8)}`  
Max gate probability abs diff: `{fmt(verification.get('maxGateProbabilityAbsDiff'), 8)}`  
Max final abs diff: `{fmt(verification.get('maxFinalAbsDiff'), 8)}`  
Apply mismatches: `{verification.get('applyMismatches')}`  
C# scalar throughput: `{fmt(verification.get('rowsPerSecond'), 1)}` rows/sec  
Vector hardware accelerated: `{verification.get('vectorHardwareAccelerated')}`

## Decision

{result['decision']}
"""


def strip_private(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): strip_private(v) for k, v in value.items() if not str(k).startswith("_")}
    if isinstance(value, list):
        return [strip_private(v) for v in value]
    if isinstance(value, tuple):
        return [strip_private(v) for v in value]
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


def main() -> None:
    args = parse_args()
    started = time.perf_counter()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    traces = [p3.load_trace(args.root, name, f"session-{i + 1}") for i, name in enumerate(p3.TRACE_FILES)]
    datasets = [p3.build_dataset(trace, seq_len=32) for trace in traces]
    splits = [p4.split_dataset(dataset, 0.70) for dataset in datasets]
    train = p4.concat_datasets(splits[0][0], splits[1][0], "combined-train70")
    validation = p4.concat_datasets(splits[0][1], splits[1][1], "combined-validation30")
    all_rows = p4.concat_datasets(datasets[0], datasets[1], "combined-all-format9")
    spec = {item["id"]: item for item in p6.teacher_specs()}[TEACHER_ID]
    teacher = train_teacher(spec, train, validation, all_rows, args.seed + 1, args.max_epochs, args.patience, args.batch_size, device)
    validation_ab = p4.alpha_beta_correction(validation)
    all_ab = p4.alpha_beta_correction(all_rows)
    validation_features_raw = p6.gate_features(validation, teacher["validationPred"], validation_ab)
    all_features_raw = p6.gate_features(all_rows, teacher["evaluationPred"], all_ab)
    validation_features, all_features, gate_norm = p6.normalize_features(validation_features_raw, all_features_raw)
    gate_target, _ = p6.gate_target(validation, teacher["validationPred"], GATE_MARGIN_PX)
    gate = train_gate(validation_features, gate_target, args.seed + 2)
    with torch.no_grad():
        gate_model = GateTinyMLP(7, 8)
        gate_model.load_state_dict({key: torch.from_numpy(value) for key, value in gate["state"].items()})
        all_probs = torch.sigmoid(gate_model(torch.from_numpy(all_features.astype(np.float32)))).numpy().astype(np.float32)
        validation_probs = gate["trainProb"]
    validation_eval, validation_applied, validation_mask = evaluate_candidate(validation, teacher["validationPred"], validation_probs)
    all_eval, all_applied, all_mask = evaluate_candidate(all_rows, teacher["evaluationPred"], all_probs)
    validation_baseline_eval = p7.evaluate(validation, np.zeros_like(validation.baseline, dtype=np.float32))
    all_baseline_eval = p7.evaluate(all_rows, np.zeros_like(all_rows.baseline, dtype=np.float32))
    validation_teacher_eval = p7.evaluate(validation, teacher["validationPred"])
    all_teacher_eval = p7.evaluate(all_rows, teacher["evaluationPred"])
    model_json_path = RUNTIME_DIR / "model-runtime-candidate.json"
    model_info = export_model_json(model_json_path, teacher, gate, gate_norm)
    model_json = json.loads(model_json_path.read_text(encoding="utf-8"))
    samples, inspect_samples = make_samples(all_rows, all_features_raw, model_json, args.seed + 3)
    sample_json_path = RUNTIME_DIR / "verification-samples.json"
    sample_json_path.write_text(json.dumps({"samples": inspect_samples}, indent=2) + "\n", encoding="utf-8")
    csharp_files = write_csharp_files(RUNTIME_DIR, model_json, samples)
    csharp_started = time.perf_counter()
    csharp_run = subprocess.run(
        ["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", str(RUNTIME_DIR / "run-evaluator.ps1")],
        cwd=str(args.root),
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=180,
    )
    csharp_sec = time.perf_counter() - csharp_started
    if csharp_run.returncode != 0:
        csharp_result = {
            "status": "failed",
            "returnCode": csharp_run.returncode,
            "stdout": (csharp_run.stdout or "")[-4000:],
            "stderr": (csharp_run.stderr or "")[-4000:],
            "elapsedSec": csharp_sec,
        }
    else:
        csharp_result = json.loads((RUNTIME_DIR / "csharp-verification-result.json").read_text(encoding="utf-8"))
        csharp_result["status"] = "ok"
        csharp_result["elapsedSec"] = csharp_sec
        csharp_result["stdoutTail"] = csharp_run.stdout[-1000:]
    all_baseline_metrics = all_baseline_eval["metrics"]
    all_candidate_metrics = all_eval["metrics"]
    all_candidate_regressions = all_eval["regressionsVsBaseline"]
    cpu_ok = csharp_result.get("rowsPerSecond", 0.0) > 20_000.0
    parity_ok = (
        csharp_result.get("status") == "ok"
        and csharp_result.get("applyMismatches") == 0
        and csharp_result.get("maxFinalAbsDiff", 1.0) < 1e-3
    )
    metrics_ok = (
        all_candidate_metrics["p95"] < all_baseline_metrics["p95"]
        and all_candidate_metrics["p99"] <= all_baseline_metrics["p99"]
        and all_candidate_metrics["max"] <= all_baseline_metrics["max"]
        and all_candidate_regressions["worseOver5px"] == 0
        and all_candidate_regressions["worseOver20px"] == 0
        and all_candidate_regressions["worseOver50px"] == 0
    )
    decision = (
        "Proceed to src integration behind a feature flag and then run Calibrator. GPU is only for offline training; this candidate is fixed-weight "
        "CPU inference, the C# scalar prototype matches Python samples, measured CPU throughput is above the expected poll-rate budget, "
        "and replay metrics improve p95/p99 without >5px regressions."
        if parity_ok and cpu_ok and metrics_ok
        else "Do not integrate yet; fixed-weight C# CPU parity or throughput is insufficient. GPU inference is not allowed in product."
    )
    result = {
        "schemaVersion": "cursor-prediction-v9-phase9-runtime-candidate/1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runtimeSec": time.perf_counter() - started,
        "status": "ok",
        "policy": {
            "inputTraces": p3.TRACE_FILES,
            "sequenceLength": 32,
            "largeArtifactsWritten": False,
            "calibratorRun": False,
            "srcTouched": False,
            "testsTouched": False,
        },
        "environment": {
            "python": ".".join(map(str, tuple(sys.version_info[:3]))),
            "torchVersion": torch.__version__,
            "cudaAvailable": torch.cuda.is_available(),
            "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
            "dotnetCliAvailable": False,
            "csharpExecution": "PowerShell Add-Type",
        },
        "candidate": {
            "teacher": TEACHER_ID,
            "gate": GATE_KIND,
            "marginPx": GATE_MARGIN_PX,
            "probabilityThreshold": GATE_PROBABILITY_THRESHOLD,
            "applySpeedMaxPxPerSec": APPLY_SPEED_MAX_PX_PER_SEC,
            "residualClampPx": RESIDUAL_CLAMP_PX,
        },
        "training": {
            "trainRows": int(train.target.shape[0]),
            "validationRows": int(validation.target.shape[0]),
            "allRows": int(all_rows.target.shape[0]),
            "teacher": teacher["meta"],
            "gate": gate["meta"],
        },
        "metrics": {
            "finalValidationBaseline": strip_private(validation_baseline_eval),
            "finalValidation": strip_private(validation_eval),
            "finalValidationTeacherAlone": strip_private(validation_teacher_eval),
            "allRowsBaseline": strip_private(all_baseline_eval),
            "allRowsTeacherAlone": strip_private(all_teacher_eval),
            "allRowsReplay": strip_private(all_eval),
            "applyRates": {
                "validation": float(validation_mask.mean()),
                "allRows": float(all_mask.mean()),
            },
        },
        "runtimePrototype": {
            "directory": str(RUNTIME_DIR),
            "modelJson": str(model_json_path),
            "modelJsonBytes": model_info["bytes"],
            "teacherWeightCount": model_info["teacherWeightCount"],
            "gateWeightCount": model_info["gateWeightCount"],
            "verificationSamples": str(sample_json_path),
            "csharpFiles": csharp_files,
        },
        "csharpVerification": csharp_result,
        "decision": decision,
    }
    args.out_json.write_text(json.dumps(strip_private(result), indent=2) + "\n", encoding="utf-8")
    args.out_md.write_text(render_markdown(result), encoding="utf-8")
    print(f"Wrote {args.out_json}")
    print(f"Wrote {args.out_md}")
    print(f"Wrote {model_json_path}")
    print(f"C# verification status: {csharp_result.get('status')}")
    print(f"Runtime seconds: {result['runtimeSec']:.3f}")


if __name__ == "__main__":
    main()
