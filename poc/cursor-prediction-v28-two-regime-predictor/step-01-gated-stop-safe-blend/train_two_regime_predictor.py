import argparse
import importlib.util
import json
import math
import time
from pathlib import Path

import numpy as np


def repo_root_from_script():
    return Path(__file__).resolve().parents[3]


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=None)
    parser.add_argument("--train-sequences", type=int, default=260)
    parser.add_argument("--validation-sequences", type=int, default=80)
    parser.add_argument("--test-sequences", type=int, default=100)
    parser.add_argument("--epochs", type=int, default=36)
    parser.add_argument("--gate-epochs", type=int, default=160)
    parser.add_argument("--batch-size", type=int, default=768)
    parser.add_argument("--seed", type=int, default=2701)
    parser.add_argument("--export-normal-model-cs", default=None)
    return parser.parse_args()


def normalize(train_x, arrays):
    mean = train_x.mean(axis=0)
    std = train_x.std(axis=0)
    std[std < 0.05] = 0.05
    return [(array - mean) / std for array in arrays], mean, std


def meta_subset(meta, indices):
    return [meta[int(i)] for i in indices]


def rows_subset(rows_by_sequence, index_map, meta_subset_items):
    allowed = {item["sequenceId"] for item in meta_subset_items}
    mapped = {}
    for seq_id, rows in rows_by_sequence.items():
        if seq_id not in allowed:
            continue
        mapped_rows = [index_map[row] for row in rows if row in index_map]
        if mapped_rows:
            mapped[seq_id] = mapped_rows
    return mapped


def cv2_prediction(x):
    return x[:, [1, 2]] * 8.0


def cv3_prediction(x):
    return x[:, [4, 5]] * 8.0


def cv12_prediction(x):
    return x[:, [13, 14]] * 8.0


def soft_brake_prediction(x, gamma, floor_ratio, min_gain):
    cv = cv3_prediction(x)
    speed3 = x[:, 6] * 2000.0
    speed8 = x[:, 12] * 2000.0
    speed12 = x[:, 15] * 2000.0
    reference = np.maximum.reduce([speed8, speed12, np.full_like(speed3, 1.0)])
    ratio = speed3 / reference
    normalized = np.clip((ratio - floor_ratio) / max(1.0e-6, 1.0 - floor_ratio), 0.0, 1.0)
    gain = min_gain + (1.0 - min_gain) * np.power(normalized, gamma)
    return cv * gain[:, None]


def gate_features(x):
    speed2 = x[:, 3] * 2000.0
    speed3 = x[:, 6] * 2000.0
    speed5 = x[:, 9] * 2000.0
    speed8 = x[:, 12] * 2000.0
    speed12 = x[:, 15] * 2000.0
    recent_high = x[:, 16] * 3000.0
    latest_delta = x[:, 17] * 8.0
    path_efficiency = x[:, 20]
    horizon = x[:, 0]
    eps = 1.0
    decel_3_8 = (speed8 - speed3) / np.maximum(speed8, eps)
    decel_2_12 = (speed12 - speed2) / np.maximum(speed12, eps)
    high_to_now = recent_high / np.maximum(speed3, eps)
    target_distance = np.linalg.norm(cv3_prediction(x), axis=1)
    features = np.column_stack(
        [
            horizon,
            speed2 / 2200.0,
            speed3 / 2200.0,
            speed5 / 2200.0,
            speed8 / 2200.0,
            speed12 / 2200.0,
            recent_high / 3000.0,
            latest_delta / 10.0,
            path_efficiency,
            decel_3_8,
            decel_2_12,
            high_to_now / 8.0,
            target_distance / 30.0,
            np.maximum(0.0, decel_3_8) * (speed8 / 2200.0),
            np.maximum(0.0, 1.0 - path_efficiency),
        ]
    )
    return features.astype(np.float64)


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -40.0, 40.0)))


class LogisticGate:
    def __init__(self, input_count):
        self.w = np.zeros(input_count, dtype=np.float64)
        self.b = 0.0
        self.mw = np.zeros_like(self.w)
        self.vw = np.zeros_like(self.w)
        self.mb = 0.0
        self.vb = 0.0

    def predict_proba(self, x):
        return sigmoid(x @ self.w + self.b)

    def train(self, x, target, sample_weight, epochs, lr, seed):
        rng = np.random.default_rng(seed)
        n = x.shape[0]
        trace = []
        beta1 = 0.9
        beta2 = 0.999
        eps = 1.0e-8
        step = 0
        for epoch in range(1, epochs + 1):
            order = rng.permutation(n)
            total_loss = 0.0
            for start in range(0, n, 1024):
                idx = order[start:start + 1024]
                xb = x[idx]
                yb = target[idx]
                wb = sample_weight[idx]
                p = self.predict_proba(xb)
                total_loss += float((-wb * (yb * np.log(p + eps) + (1.0 - yb) * np.log(1.0 - p + eps))).sum())
                grad_z = wb * (p - yb) / max(1, len(idx))
                grad_w = xb.T @ grad_z
                grad_b = float(grad_z.sum())
                step += 1
                self.mw = beta1 * self.mw + (1.0 - beta1) * grad_w
                self.vw = beta2 * self.vw + (1.0 - beta2) * (grad_w * grad_w)
                self.mb = beta1 * self.mb + (1.0 - beta1) * grad_b
                self.vb = beta2 * self.vb + (1.0 - beta2) * (grad_b * grad_b)
                mw_hat = self.mw / (1.0 - beta1 ** step)
                vw_hat = self.vw / (1.0 - beta2 ** step)
                mb_hat = self.mb / (1.0 - beta1 ** step)
                vb_hat = self.vb / (1.0 - beta2 ** step)
                self.w -= lr * mw_hat / (np.sqrt(vw_hat) + eps)
                self.b -= lr * mb_hat / (math.sqrt(vb_hat) + eps)
            if epoch == 1 or epoch % 40 == 0 or epoch == epochs:
                pred = self.predict_proba(x)
                accuracy = float(((pred >= 0.5) == (target >= 0.5)).mean())
                trace.append({"epoch": int(epoch), "loss": total_loss / max(1, n), "accuracy": accuracy})
        return trace


def row_loss(pred, y, x, meta, lead_weight):
    err = pred - y
    visual_sq = np.sum(err * err, axis=1)
    dirs = np.zeros_like(y)
    mag = np.linalg.norm(y, axis=1)
    valid = mag > 1.0e-9
    dirs[valid] = y[valid] / mag[valid, None]
    dirs[~valid, 0] = x[~valid, 23]
    dirs[~valid, 1] = x[~valid, 24]
    projection = np.sum(err * dirs, axis=1)
    lead = np.maximum(0.0, projection)
    weights = np.ones(len(meta), dtype=np.float64)
    for index, item in enumerate(meta):
        if item["phase"] == "braking":
            weights[index] *= 6.0
        elif item["phase"] == "hold":
            weights[index] *= 8.0
        elif item["phase"] == "restart":
            weights[index] *= 2.0
    return weights * (visual_sq + lead_weight * lead * lead)


def oracle_gate_target(normal_pred, safe_pred, y, x, meta):
    normal_loss = row_loss(normal_pred, y, x, meta, 4.0)
    safe_loss = row_loss(safe_pred, y, x, meta, 4.0)
    target = (safe_loss + 0.03 < normal_loss).astype(np.float64)
    sample_weight = np.ones(len(meta), dtype=np.float64)
    for index, item in enumerate(meta):
        if item["phase"] == "braking":
            sample_weight[index] *= 7.0
        elif item["phase"] == "hold":
            sample_weight[index] *= 5.0
        elif item["phase"] == "normal":
            sample_weight[index] *= 1.5
    positive = max(1.0, target.sum())
    negative = max(1.0, len(target) - target.sum())
    sample_weight[target > 0.5] *= negative / positive
    return target, sample_weight


def blend(normal_pred, safe_pred, gate):
    return normal_pred * (1.0 - gate[:, None]) + safe_pred * gate[:, None]


def hard_blend(normal_pred, safe_pred, gate, threshold):
    use_safe = gate >= threshold
    result = normal_pred.copy()
    result[use_safe] = safe_pred[use_safe]
    return result


def rule_gate(x, aggressive):
    speed3 = x[:, 6] * 2000.0
    speed8 = x[:, 12] * 2000.0
    speed12 = x[:, 15] * 2000.0
    recent_high = x[:, 16] * 3000.0
    path_efficiency = x[:, 20]
    decel = np.maximum(0.0, (np.maximum(speed8, speed12) - speed3) / np.maximum(np.maximum(speed8, speed12), 1.0))
    high_ratio = recent_high / np.maximum(speed3, 1.0)
    if aggressive:
        z = -2.2 + 5.5 * decel + 0.30 * high_ratio + 1.5 * np.maximum(0.0, 0.7 - path_efficiency)
    else:
        z = -3.2 + 4.8 * decel + 0.18 * high_ratio + 1.0 * np.maximum(0.0, 0.65 - path_efficiency)
    return sigmoid(z)


def train_mlp(v27, train_xn, train_x, train_y, train_meta, mode, hidden, epochs, batch_size, seed, lead_weight, lag_weight):
    rng = np.random.default_rng(seed)
    dirs = v27.direction_for(train_y, train_x)
    weights = v27.sequence_weight_vector(train_meta)
    base_train = np.zeros_like(train_y) if mode == "direct" else cv2_prediction(train_x)
    model = v27.MLP(v27.FEATURE_COUNT, hidden, rng)
    trace = model.train(
        train_xn,
        train_y,
        base_train,
        dirs,
        weights,
        np.ones_like(weights),
        epochs=epochs,
        batch_size=batch_size,
        lr=0.0025,
        seed=seed + hidden,
        lead_weight=lead_weight,
        lag_weight=lag_weight,
    )
    return model, trace


def split_payload(v27, x, y, meta, rows_by_sequence, split_idx):
    index_map = {int(row_index): local for local, row_index in enumerate(split_idx)}
    subset_meta = [meta[int(i)] for i in split_idx]
    return {
        "x": x[split_idx],
        "y": y[split_idx],
        "meta": subset_meta,
        "rowsBySequence": rows_subset(rows_by_sequence, index_map, subset_meta),
    }


def report_lines(scores):
    visual = sorted(scores["testResults"], key=lambda item: (item["sequence"]["sequenceVisualP95"], item["sequence"]["overshootMaxP95"]))
    overshoot = sorted(scores["testResults"], key=lambda item: (item["sequence"]["overshootMaxP95"], item["sequence"]["sequenceVisualP95"]))
    lines = [
        "# Step 01 Report - Gated Stop-Safe Blend",
        "",
        "## Summary",
        "",
        "This step tests a two-regime predictor: a normal-tracking predictor is blended with a stop-safe predictor using either a rule gate or a learned oracle-approximation gate.",
        "",
        "## Dataset",
        "",
        f"- train sequences: {scores['dataset']['sequenceSplits']['train']}",
        f"- validation sequences: {scores['dataset']['sequenceSplits']['validation']}",
        f"- test sequences: {scores['dataset']['sequenceSplits']['test']}",
        f"- feature rows: {scores['dataset']['rows']}",
        "",
        "## Best Test Candidates By Sequence Visual Error",
        "",
        "| candidate | sequence visual p95 | overshoot max p95 | overshoot duration p95 ms | jitter p95 | safe ratio | row visual p95 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in visual[:12]:
        seq = item["sequence"]
        lines.append(
            f"| {item['candidate']} | {seq['sequenceVisualP95']:.6f} | {seq['overshootMaxP95']:.6f} | "
            f"{seq['overshootDurationP95Ms']:.6f} | {seq['stationaryJitterP95']:.6f} | "
            f"{item.get('safeRatio', 0.0):.6f} | {item['overall']['visualP95']:.6f} |"
        )
    lines += [
        "",
        "## Best Test Candidates By Overshoot",
        "",
        "| candidate | overshoot max p95 | sequence visual p95 | overshoot duration p95 ms | jitter p95 | safe ratio | row visual p95 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in overshoot[:12]:
        seq = item["sequence"]
        lines.append(
            f"| {item['candidate']} | {seq['overshootMaxP95']:.6f} | {seq['sequenceVisualP95']:.6f} | "
            f"{seq['overshootDurationP95Ms']:.6f} | {seq['stationaryJitterP95']:.6f} | "
            f"{item.get('safeRatio', 0.0):.6f} | {item['overall']['visualP95']:.6f} |"
        )
    lines += [
        "",
        "## Interpretation",
        "",
        "The important sign is whether a gated blend can reduce overshoot without moving all normal rows into the conservative stop-safe regime. A high safe ratio with poor visual p95 means the gate has collapsed into SmoothPredictor-like behavior.",
    ]
    return lines


def format_float(value):
    if not math.isfinite(float(value)):
        raise ValueError(f"Non-finite value: {value}")
    text = f"{float(value):.9g}"
    if "e" not in text.lower() and "." not in text:
        text += ".0"
    return text + "f"


def write_float_array(lines, name, values, indent="        ", per_line=8):
    flat = np.asarray(values, dtype=np.float64).reshape(-1)
    lines.append(f"{indent}private static readonly float[] {name} = new float[] {{")
    for start in range(0, len(flat), per_line):
        chunk = ", ".join(format_float(value) for value in flat[start:start + per_line])
        lines.append(f"{indent}    {chunk},")
    lines.append(f"{indent}}};")


def write_normal_model_cs(path, model, mean, std):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "// Generated from poc/cursor-prediction-v28-two-regime-predictor/step-01-gated-stop-safe-blend.",
        "// Candidate: normal_direct_sequence_stop_h64",
        "// Seed: 2701",
        "using System;",
        "",
        "namespace CursorMirror",
        "{",
        "    internal sealed class TwoRegimeNormalPredictorModel",
        "    {",
        '        public const string ModelId = "v28_normal_direct_sequence_stop_h64_seed2701";',
        "        public const int FeatureCount = 25;",
        "        public const int Hidden = 64;",
        f"        public const int EstimatedMacs = {model.estimated_macs};",
        f"        public const int ParameterCount = {model.parameter_count};",
    ]
    write_float_array(lines, "FeatureMean", mean)
    write_float_array(lines, "FeatureStd", std)
    write_float_array(lines, "W0", model.w0)
    write_float_array(lines, "B0", model.b0)
    write_float_array(lines, "W1", model.w1)
    write_float_array(lines, "B1", model.b1)
    lines += [
        "",
        "        private readonly float[] _hidden = new float[Hidden];",
        "",
        "        public bool TryEvaluate(float[] features, out float displacementX, out float displacementY)",
        "        {",
        "            displacementX = 0.0f;",
        "            displacementY = 0.0f;",
        "            if (features == null || features.Length != FeatureCount)",
        "            {",
        "                return false;",
        "            }",
        "",
        "            for (int hidden = 0; hidden < Hidden; hidden++)",
        "            {",
        "                double sum = B0[hidden];",
        "                for (int feature = 0; feature < FeatureCount; feature++)",
        "                {",
        "                    double featureStd = Math.Abs(FeatureStd[feature]) < 0.000001f ? 1.0 : FeatureStd[feature];",
        "                    double normalized = (features[feature] - FeatureMean[feature]) / featureStd;",
        "                    sum += normalized * W0[(feature * Hidden) + hidden];",
        "                }",
        "",
        "                _hidden[hidden] = (float)Math.Tanh(sum);",
        "            }",
        "",
        "            double dx = B1[0];",
        "            double dy = B1[1];",
        "            for (int hidden = 0; hidden < Hidden; hidden++)",
        "            {",
        "                dx += _hidden[hidden] * W1[(hidden * 2)];",
        "                dy += _hidden[hidden] * W1[(hidden * 2) + 1];",
        "            }",
        "",
        "            if (double.IsNaN(dx) || double.IsNaN(dy) || double.IsInfinity(dx) || double.IsInfinity(dy))",
        "            {",
        "                return false;",
        "            }",
        "",
        "            displacementX = (float)dx;",
        "            displacementY = (float)dy;",
        "            return true;",
        "        }",
        "    }",
        "}",
        "",
    ]
    output.write_text("\n".join(lines), encoding="ascii")


def main():
    args = parse_args()
    repo_root = Path(args.repo_root).resolve() if args.repo_root else repo_root_from_script()
    output_dir = Path(__file__).resolve().parent
    start = time.perf_counter()
    v27 = load_module(
        repo_root / "poc/cursor-prediction-v27-sequence-stop-loss/step-01-sequence-stop-loss/train_sequence_stop_models.py",
        "v27_sequence_stop",
    )
    v25 = load_module(
        repo_root / "poc/cursor-prediction-v25-runtime-horizon-training/step-01-runtime-horizon-model-search/train_runtime_horizon_models.py",
        "v25_runtime_horizon",
    )

    counts = {"train": args.train_sequences, "validation": args.validation_sequences, "test": args.test_sequences}
    sequences = v27.generate_sequences(counts, args.seed)
    sequence_map = {seq.sequence_id: seq for seq in sequences}
    x, y, meta, rows_by_sequence = v27.build_rows(sequences, args.seed + 1)
    indices_by_split = v27.split_indices(meta)
    train_idx = indices_by_split["train"]
    validation_idx = indices_by_split["validation"]
    test_idx = indices_by_split["test"]
    (train_xn, validation_xn, test_xn), mean, std = normalize(x[train_idx], [x[train_idx], x[validation_idx], x[test_idx]])
    gate_train_xn, gate_mean, gate_std = normalize(gate_features(x[train_idx]), [gate_features(x[train_idx])])
    gate_validation_xn = (gate_features(x[validation_idx]) - gate_mean) / gate_std
    gate_test_xn = (gate_features(x[test_idx]) - gate_mean) / gate_std

    train_meta = meta_subset(meta, train_idx)
    train_x = x[train_idx]
    train_y = y[train_idx]
    validation_payload = split_payload(v27, x, y, meta, rows_by_sequence, validation_idx)
    test_payload = split_payload(v27, x, y, meta, rows_by_sequence, test_idx)
    validation_payload["xn"] = validation_xn
    test_payload["xn"] = test_xn
    validation_payload["gateXn"] = gate_validation_xn
    test_payload["gateXn"] = gate_test_xn

    normal_model, normal_trace = train_mlp(v27, train_xn, train_x, train_y, train_meta, "direct", 64, args.epochs, args.batch_size, args.seed + 10, 2.8, 0.7)
    safe_model, safe_trace = train_mlp(v27, train_xn, train_x, train_y, train_meta, "direct", 64, args.epochs, args.batch_size, args.seed + 20, 9.0, 0.2)
    if args.export_normal_model_cs:
        write_normal_model_cs(args.export_normal_model_cs, normal_model, mean, std)
    smooth = v25.load_current_smooth_predictor(repo_root)

    normal_train = normal_model.predict(train_xn)
    safe_train = safe_model.predict(train_xn)
    smooth_train = smooth["predict"](train_x)
    gate_target_smooth, gate_weight_smooth = oracle_gate_target(normal_train, smooth_train, train_y, train_x, train_meta)
    gate_target_safe, gate_weight_safe = oracle_gate_target(normal_train, safe_train, train_y, train_x, train_meta)
    gate_smooth = LogisticGate(gate_train_xn[0].shape[1])
    gate_safe = LogisticGate(gate_train_xn[0].shape[1])
    gate_smooth_trace = gate_smooth.train(gate_train_xn[0], gate_target_smooth, gate_weight_smooth, args.gate_epochs, 0.01, args.seed + 30)
    gate_safe_trace = gate_safe.train(gate_train_xn[0], gate_target_safe, gate_weight_safe, args.gate_epochs, 0.01, args.seed + 40)

    def add_result(results, name, pred, payload, safe_ratio=0.0, estimated_macs=0, parameters=0, training_trace=None):
        item = v27.evaluate_candidate(
            name,
            pred,
            payload["y"],
            payload["x"],
            payload["meta"],
            payload["rowsBySequence"],
            sequence_map,
            estimated_macs,
            parameters,
            training_trace,
        )
        item["safeRatio"] = float(safe_ratio)
        results.append(item)

    results = {"validation": [], "test": []}
    for split_name, payload in [("validation", validation_payload), ("test", test_payload)]:
        normal_pred = normal_model.predict(payload["xn"])
        safe_pred = safe_model.predict(payload["xn"])
        smooth_pred = smooth["predict"](payload["x"])
        cv3 = cv3_prediction(payload["x"])
        cv12 = cv12_prediction(payload["x"])
        soft = soft_brake_prediction(payload["x"], 2.0, 0.12, 0.0)
        add_result(results[split_name], "normal_direct_sequence_stop_h64", normal_pred, payload, 0.0, normal_model.estimated_macs, normal_model.parameter_count, normal_trace)
        add_result(results[split_name], "safe_direct_sequence_stop_h64", safe_pred, payload, 1.0, safe_model.estimated_macs, safe_model.parameter_count, safe_trace)
        add_result(results[split_name], "constant_velocity_v3", cv3, payload, 0.0, 2, 0)
        add_result(results[split_name], "constant_velocity_v12", cv12, payload, 0.0, 2, 0)
        add_result(results[split_name], "soft_brake_cv3", soft, payload, 0.0, 14, 0)
        add_result(results[split_name], "current_smooth_predictor", smooth_pred, payload, 1.0, smooth["estimatedMacs"], smooth["parameters"])

        for aggressive in [False, True]:
            gate = rule_gate(payload["x"], aggressive)
            add_result(
                results[split_name],
                f"rule_gate_cv3_to_smooth_{'aggressive' if aggressive else 'conservative'}",
                blend(cv3, smooth_pred, gate),
                payload,
                float(gate.mean()),
                smooth["estimatedMacs"] + 18,
                smooth["parameters"],
            )
            add_result(
                results[split_name],
                f"rule_gate_normal_to_smooth_{'aggressive' if aggressive else 'conservative'}",
                blend(normal_pred, smooth_pred, gate),
                payload,
                float(gate.mean()),
                smooth["estimatedMacs"] + normal_model.estimated_macs + 18,
                smooth["parameters"] + normal_model.parameter_count,
            )

        gate_smooth_prob = gate_smooth.predict_proba(payload["gateXn"])
        gate_safe_prob = gate_safe.predict_proba(payload["gateXn"])
        for threshold in [0.35, 0.50, 0.65]:
            add_result(
                results[split_name],
                f"learned_gate_cv3_to_smooth_hard{threshold:g}",
                hard_blend(cv3, smooth_pred, gate_smooth_prob, threshold),
                payload,
                float((gate_smooth_prob >= threshold).mean()),
                smooth["estimatedMacs"] + 24,
                smooth["parameters"] + len(gate_smooth.w) + 1,
                gate_smooth_trace,
            )
            add_result(
                results[split_name],
                f"learned_gate_normal_to_smooth_hard{threshold:g}",
                hard_blend(normal_pred, smooth_pred, gate_smooth_prob, threshold),
                payload,
                float((gate_smooth_prob >= threshold).mean()),
                smooth["estimatedMacs"] + normal_model.estimated_macs + 24,
                smooth["parameters"] + normal_model.parameter_count + len(gate_smooth.w) + 1,
                gate_smooth_trace,
            )
            add_result(
                results[split_name],
                f"learned_gate_normal_to_safe_hard{threshold:g}",
                hard_blend(normal_pred, safe_pred, gate_safe_prob, threshold),
                payload,
                float((gate_safe_prob >= threshold).mean()),
                normal_model.estimated_macs + safe_model.estimated_macs + 24,
                normal_model.parameter_count + safe_model.parameter_count + len(gate_safe.w) + 1,
                gate_safe_trace,
            )
        add_result(
            results[split_name],
            "learned_gate_cv3_to_smooth_soft",
            blend(cv3, smooth_pred, gate_smooth_prob),
            payload,
            float(gate_smooth_prob.mean()),
            smooth["estimatedMacs"] + 24,
            smooth["parameters"] + len(gate_smooth.w) + 1,
            gate_smooth_trace,
        )
        add_result(
            results[split_name],
            "learned_gate_normal_to_smooth_soft",
            blend(normal_pred, smooth_pred, gate_smooth_prob),
            payload,
            float(gate_smooth_prob.mean()),
            smooth["estimatedMacs"] + normal_model.estimated_macs + 24,
            smooth["parameters"] + normal_model.parameter_count + len(gate_smooth.w) + 1,
            gate_smooth_trace,
        )
        add_result(
            results[split_name],
            "learned_gate_normal_to_safe_soft",
            blend(normal_pred, safe_pred, gate_safe_prob),
            payload,
            float(gate_safe_prob.mean()),
            normal_model.estimated_macs + safe_model.estimated_macs + 24,
            normal_model.parameter_count + safe_model.parameter_count + len(gate_safe.w) + 1,
            gate_safe_trace,
        )

    scores = {
        "schemaVersion": "cursor-prediction-v28-step-01-gated-stop-safe-blend/1",
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "seed": args.seed,
            "epochs": args.epochs,
            "gateEpochs": args.gate_epochs,
            "batchSize": args.batch_size,
            "runtime": "bundled Python + NumPy, CPU-only",
        },
        "dataset": {
            "rows": int(len(y)),
            "sequenceCount": int(len(sequences)),
            "sequenceSplits": counts,
            "splitRows": {name: int(len(value)) for name, value in indices_by_split.items()},
        },
        "gate": {
            "smoothPositiveRate": float(gate_target_smooth.mean()),
            "safePositiveRate": float(gate_target_safe.mean()),
            "smoothTrace": gate_smooth_trace,
            "safeTrace": gate_safe_trace,
        },
        "normalizer": {
            "featureMean0Horizon": float(mean[0]),
            "featureStd0Horizon": float(std[0]),
        },
        "validationResults": results["validation"],
        "testResults": results["test"],
        "elapsedSeconds": time.perf_counter() - start,
        "limitations": [
            "The safe-regime teacher is still approximate; no Calibrator closed-loop run is included.",
            "The learned gate is logistic, not a sequence model.",
            "No C# model is emitted from this step.",
        ],
    }
    (output_dir / "scores.json").write_text(json.dumps(scores, indent=2), encoding="ascii")
    (output_dir / "report.md").write_text("\n".join(report_lines(scores)) + "\n", encoding="ascii")
    best = sorted(scores["testResults"], key=lambda item: (item["sequence"]["sequenceVisualP95"], item["sequence"]["overshootMaxP95"]))[:6]
    print(
        json.dumps(
            {
                "rows": scores["dataset"]["rows"],
                "sequences": scores["dataset"]["sequenceCount"],
                "candidates": len(scores["testResults"]),
                "elapsedSeconds": scores["elapsedSeconds"],
                "gate": scores["gate"],
                "bestVisual": [
                    {
                        "candidate": item["candidate"],
                        "sequenceVisualP95": item["sequence"]["sequenceVisualP95"],
                        "overshootMaxP95": item["sequence"]["overshootMaxP95"],
                        "safeRatio": item["safeRatio"],
                    }
                    for item in best
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
