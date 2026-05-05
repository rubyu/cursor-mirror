import argparse
import importlib.util
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np


FEATURE_COUNT = 25
DEFAULT_HORIZON_MS = 10.0
FRAME_MS = 1000.0 / 60.0
TARGET_HORIZONS_MS = np.array([4.0, 8.0, 10.0, 12.0, 16.0], dtype=np.float64)


@dataclass
class Sequence:
    sequence_id: str
    split: str
    family: str
    times_ms: np.ndarray
    positions: np.ndarray
    stop_time_ms: float
    restart_time_ms: float
    is_stop_family: bool


def repo_root_from_script():
    return Path(__file__).resolve().parents[3]


def load_v25_module(repo_root):
    source = repo_root / "poc/cursor-prediction-v25-runtime-horizon-training/step-01-runtime-horizon-model-search/train_runtime_horizon_models.py"
    spec = importlib.util.spec_from_file_location("v25_runtime_horizon", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load v25 module from {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=None)
    parser.add_argument("--train-sequences", type=int, default=260)
    parser.add_argument("--validation-sequences", type=int, default=80)
    parser.add_argument("--test-sequences", type=int, default=100)
    parser.add_argument("--epochs", type=int, default=42)
    parser.add_argument("--batch-size", type=int, default=768)
    parser.add_argument("--seed", type=int, default=2701)
    return parser.parse_args()


def smoothstep(u):
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


def ease_out_cubic(u):
    u = np.clip(u, 0.0, 1.0)
    return 1.0 - np.power(1.0 - u, 3.0)


def ease_in_out_quint(u):
    u = np.clip(u, 0.0, 1.0)
    return np.where(u < 0.5, 16.0 * np.power(u, 5.0), 1.0 - np.power(-2.0 * u + 2.0, 5.0) / 2.0)


def normalize_vector(x, y):
    length = math.hypot(x, y)
    if length <= 1.0e-9:
        return 1.0, 0.0
    return x / length, y / length


def generate_path_positions(times_ms, rng, family, speed_px_s, angle, stop_time_ms, decel_ms, restart_delay_ms):
    direction = np.array([math.cos(angle), math.sin(angle)], dtype=np.float64)
    normal = np.array([-direction[1], direction[0]], dtype=np.float64)
    t = times_ms
    pos = np.zeros((len(t), 2), dtype=np.float64)
    speed_px_ms = speed_px_s / 1000.0
    decel_start = stop_time_ms - decel_ms
    restart_time = stop_time_ms + restart_delay_ms
    restart_speed = speed_px_ms * rng.uniform(0.25, 0.75)
    reverse = family in {"reverse_stop", "hook_stop"}
    curve_amplitude = rng.uniform(10.0, 70.0) if family in {"curve_stop", "hook_stop", "normal_curve"} else rng.uniform(0.0, 8.0)

    for i, now in enumerate(t):
        if family == "normal_curve":
            forward = speed_px_ms * now
            lateral = curve_amplitude * math.sin(now / rng.uniform(240.0, 520.0))
            pos[i] = direction * forward + normal * lateral
            continue

        if now < decel_start:
            forward = speed_px_ms * now
        elif now <= stop_time_ms:
            before = speed_px_ms * decel_start
            u = (now - decel_start) / max(1.0, decel_ms)
            if family == "abrupt_stop":
                eased = 1.0 if u > 0.10 else u / 0.10
            elif family == "ease_stop":
                eased = ease_out_cubic(u)
            else:
                eased = ease_in_out_quint(u)
            forward = before + speed_px_ms * decel_ms * 0.22 * eased
        elif now < restart_time:
            before = speed_px_ms * decel_start
            forward = before + speed_px_ms * decel_ms * 0.22
        else:
            before = speed_px_ms * decel_start + speed_px_ms * decel_ms * 0.22
            after = now - restart_time
            sign = -1.0 if reverse else 1.0
            forward = before + sign * restart_speed * after

        lateral_phase = np.clip((now - (decel_start - 180.0)) / max(1.0, decel_ms + 220.0), 0.0, 1.0)
        lateral = curve_amplitude * math.sin(lateral_phase * math.pi)
        if family == "hook_stop":
            lateral *= 1.0 + 0.8 * math.sin(lateral_phase * math.pi * 2.0)
        pos[i] = direction * forward + normal * lateral
    return pos, restart_time


def generate_sequences(counts_by_split, seed):
    rng = np.random.default_rng(seed)
    sequences = []
    families = ["abrupt_stop", "ease_stop", "curve_stop", "reverse_stop", "hook_stop", "micro_resume", "normal_curve"]
    stop_families = set(families) - {"normal_curve"}
    for split, count in counts_by_split.items():
        for index in range(count):
            family = families[index % len(families)]
            duration_ms = float(rng.uniform(1800.0, 3600.0))
            times_ms = np.arange(0.0, duration_ms + 1.0, 1.0, dtype=np.float64)
            stop_time_ms = float(rng.uniform(duration_ms * 0.42, duration_ms * 0.68))
            decel_ms = float(rng.choice([18.0, 32.0, 48.0, 80.0, 120.0, 180.0]))
            restart_delay_ms = float(rng.choice([220.0, 420.0, 720.0, 1100.0]))
            if family == "micro_resume":
                restart_delay_ms = float(rng.choice([80.0, 140.0, 220.0]))
            speed_px_s = float(rng.uniform(120.0, 2600.0))
            angle = float(rng.uniform(-math.pi, math.pi))
            positions, restart_time = generate_path_positions(times_ms, rng, family, speed_px_s, angle, stop_time_ms, decel_ms, restart_delay_ms)
            positions[:, 0] += rng.uniform(160.0, 900.0)
            positions[:, 1] += rng.uniform(120.0, 700.0)
            sequences.append(
                Sequence(
                    sequence_id=f"{split}-{index:04d}-{family}",
                    split=split,
                    family=family,
                    times_ms=times_ms,
                    positions=positions,
                    stop_time_ms=stop_time_ms,
                    restart_time_ms=restart_time,
                    is_stop_family=family in stop_families,
                )
            )
    return sequences


def interpolate_position(seq, elapsed_ms):
    if elapsed_ms <= seq.times_ms[0]:
        return seq.positions[0]
    if elapsed_ms >= seq.times_ms[-1]:
        return seq.positions[-1]
    lo = int(math.floor(elapsed_ms))
    hi = min(lo + 1, len(seq.times_ms) - 1)
    frac = elapsed_ms - lo
    return seq.positions[lo] + (seq.positions[hi] - seq.positions[lo]) * frac


def point_distance(a, b):
    return float(np.linalg.norm(a - b))


def make_call(seq, elapsed_ms):
    pos = interpolate_position(seq, elapsed_ms)
    return {"elapsed_ms": float(elapsed_ms), "x": float(pos[0]), "y": float(pos[1])}


def velocity_window(call, history, sample_count, horizon_ms):
    if not history:
        return 0.0, 0.0, 0.0
    back = min(sample_count - 1, len(history))
    oldest = history[-back]
    dt = (call["elapsed_ms"] - oldest["elapsed_ms"]) / 1000.0
    if dt <= 0.0:
        return 0.0, 0.0, 0.0
    vx = (call["x"] - oldest["x"]) / dt
    vy = (call["y"] - oldest["y"]) / dt
    horizon_sec = max(0.0, horizon_ms / 1000.0)
    return vx * horizon_sec, vy * horizon_sec, math.hypot(vx, vy)


def recent_segment_max(call, history, sample_count):
    points = history[-max(0, sample_count - 1):] + [call]
    maximum = 0.0
    for a, b in zip(points, points[1:]):
        dt = (b["elapsed_ms"] - a["elapsed_ms"]) / 1000.0
        if dt > 0.0:
            maximum = max(maximum, math.hypot(b["x"] - a["x"], b["y"] - a["y"]) / dt)
    return maximum


def build_path(call, history, sample_count):
    points = history[-max(0, sample_count - 1):] + [call]
    if len(points) < 2:
        return 0.0, 0.0, 0.0
    path = 0.0
    for a, b in zip(points, points[1:]):
        path += math.hypot(b["x"] - a["x"], b["y"] - a["y"])
    net = math.hypot(call["x"] - points[0]["x"], call["y"] - points[0]["y"])
    efficiency = net / path if path > 1.0e-9 else 0.0
    return net, path, efficiency


def build_features(call, history, horizon_ms):
    v2 = velocity_window(call, history, 2, horizon_ms)
    v3 = velocity_window(call, history, 3, horizon_ms)
    v5 = velocity_window(call, history, 5, horizon_ms)
    v8 = velocity_window(call, history, 8, horizon_ms)
    v12 = velocity_window(call, history, 12, horizon_ms)
    latest_delta = 0.0 if not history else math.hypot(call["x"] - history[-1]["x"], call["y"] - history[-1]["y"])
    recent_high = max(v5[2], v8[2], v12[2], recent_segment_max(call, history, 6))
    path_net, path_length, path_efficiency = build_path(call, history, 12)
    dir_x, dir_y = v12[0], v12[1]
    mag = math.hypot(dir_x, dir_y)
    if mag > 1.0e-9:
        dir_x /= mag
        dir_y /= mag
    else:
        dir_x, dir_y = 1.0, 0.0
    horizon_sec = max(0.0, horizon_ms / 1000.0)
    runtime_target = v2[2] * horizon_sec
    return np.array(
        [
            horizon_ms / 16.67,
            v2[0] / 8.0,
            v2[1] / 8.0,
            v2[2] / 2000.0,
            v3[0] / 8.0,
            v3[1] / 8.0,
            v3[2] / 2000.0,
            v5[0] / 8.0,
            v5[1] / 8.0,
            v5[2] / 2000.0,
            v8[0] / 8.0,
            v8[1] / 8.0,
            v8[2] / 2000.0,
            v12[0] / 8.0,
            v12[1] / 8.0,
            v12[2] / 2000.0,
            recent_high / 3000.0,
            latest_delta / 8.0,
            path_net / 80.0,
            path_length / 100.0,
            path_efficiency,
            runtime_target / 8.0,
            v2[2] / 3000.0,
            dir_x,
            dir_y,
        ],
        dtype=np.float64,
    )


def frame_times(seq, rng):
    start = 220.0
    times = []
    now = start
    while now + DEFAULT_HORIZON_MS < seq.times_ms[-1] - 5.0:
        jitter = rng.normal(0.0, 0.22)
        times.append(float(now + jitter))
        now += FRAME_MS
    return np.asarray(times, dtype=np.float64)


def build_rows(sequences, seed):
    rng = np.random.default_rng(seed)
    features = []
    labels = []
    meta = []
    rows_by_sequence = {}
    for seq in sequences:
        history = []
        rows_by_sequence[seq.sequence_id] = []
        for elapsed_ms in frame_times(seq, rng):
            call = make_call(seq, elapsed_ms)
            phase = "normal"
            if seq.is_stop_family:
                if elapsed_ms >= seq.stop_time_ms and elapsed_ms < seq.restart_time_ms:
                    phase = "hold"
                elif elapsed_ms >= seq.stop_time_ms - 200.0 and elapsed_ms < seq.stop_time_ms:
                    phase = "braking"
                elif elapsed_ms >= seq.restart_time_ms:
                    phase = "restart"
            for horizon_ms in TARGET_HORIZONS_MS:
                target = interpolate_position(seq, elapsed_ms + horizon_ms)
                feature = build_features(call, history, float(horizon_ms))
                label = target - np.array([call["x"], call["y"]], dtype=np.float64)
                cv = feature[[1, 2]] * 8.0
                target_mag = float(np.linalg.norm(label))
                cv_mag = float(np.linalg.norm(cv))
                static = phase == "hold" and target_mag <= 0.5
                braking = phase == "braking" or ((target_mag <= 1.25) and (cv_mag > 1.25)) or (cv_mag > target_mag + 0.75 and phase in {"hold", "braking"})
                row_index = len(labels)
                features.append(feature)
                labels.append(label)
                meta.append(
                    {
                        "sequenceId": seq.sequence_id,
                        "split": seq.split,
                        "family": seq.family,
                        "horizon": float(horizon_ms),
                        "elapsedMs": float(elapsed_ms),
                        "phase": phase,
                        "static": bool(static),
                        "braking": bool(braking),
                        "stopFamily": bool(seq.is_stop_family),
                        "callX": float(call["x"]),
                        "callY": float(call["y"]),
                        "targetX": float(target[0]),
                        "targetY": float(target[1]),
                    }
                )
                if abs(horizon_ms - DEFAULT_HORIZON_MS) < 0.01:
                    rows_by_sequence[seq.sequence_id].append(row_index)
            history.append(call)
            if len(history) > 12:
                del history[0]
    return np.vstack(features), np.asarray(labels, dtype=np.float64), meta, rows_by_sequence


def percentile(values, p):
    values = np.asarray(values, dtype=np.float64)
    if values.size == 0:
        return 0.0
    return float(np.percentile(values, p, method="higher"))


def cv2_prediction(x):
    return x[:, [1, 2]] * 8.0


def cv_prediction(x, window):
    if window == 3:
        return x[:, [4, 5]] * 8.0
    if window == 5:
        return x[:, [7, 8]] * 8.0
    if window == 12:
        return x[:, [13, 14]] * 8.0
    raise ValueError(window)


def accel_aware_prediction(x, strength):
    cv2 = cv2_prediction(x)
    cv5 = cv_prediction(x, 5)
    correction = cv2 - cv5
    return cv2 + strength * correction


def soft_brake_prediction(x, gamma, floor_ratio, min_gain):
    cv = cv2_prediction(x)
    speed2 = x[:, 3] * 2000.0
    speed5 = x[:, 9] * 2000.0
    speed8 = x[:, 12] * 2000.0
    reference = np.maximum.reduce([speed5, speed8, np.full_like(speed2, 1.0)])
    ratio = speed2 / reference
    normalized = np.clip((ratio - floor_ratio) / max(1.0e-6, 1.0 - floor_ratio), 0.0, 1.0)
    gain = min_gain + (1.0 - min_gain) * np.power(normalized, gamma)
    return cv * gain[:, None]


def direction_for(y, x):
    dirs = np.zeros_like(y)
    mag = np.linalg.norm(y, axis=1)
    valid = mag > 1.0e-9
    dirs[valid] = y[valid] / mag[valid, None]
    dirs[~valid, 0] = x[~valid, 23]
    dirs[~valid, 1] = x[~valid, 24]
    return dirs


def row_masks(x, y, meta):
    static = np.asarray([item["static"] for item in meta], dtype=bool)
    braking = np.asarray([item["braking"] for item in meta], dtype=bool)
    stop_family = np.asarray([item["stopFamily"] for item in meta], dtype=bool)
    return {
        "static": static,
        "braking": braking,
        "stopFamily": stop_family,
        "normal": ~stop_family,
    }


def evaluate_rows(name, pred, y, x, meta, estimated_macs=0, parameters=0, training_trace=None):
    err = pred - y
    visual = np.linalg.norm(err, axis=1)
    dirs = direction_for(y, x)
    signed = np.sum(err * dirs, axis=1)
    lead = np.maximum(0.0, signed)
    lag = np.maximum(0.0, -signed)
    masks = row_masks(x, y, meta)

    def block(mask):
        if not mask.any():
            return {"rows": 0, "visualP95": 0.0, "visualP99": 0.0, "leadP99": 0.0, "lagP99": 0.0}
        return {
            "rows": int(mask.sum()),
            "visualP95": percentile(visual[mask], 95),
            "visualP99": percentile(visual[mask], 99),
            "leadP99": percentile(lead[mask], 99),
            "lagP99": percentile(lag[mask], 99),
        }

    return {
        "candidate": name,
        "estimatedMacs": int(estimated_macs),
        "parameters": int(parameters),
        "trainingTrace": training_trace or [],
        "overall": {
            "visualP95": percentile(visual, 95),
            "visualP99": percentile(visual, 99),
            "leadP99": percentile(lead, 99),
            "lagP99": percentile(lag, 99),
            "stationaryJitterP95": percentile(np.linalg.norm(pred[masks["static"]], axis=1), 95) if masks["static"].any() else 0.0,
        },
        "braking": block(masks["braking"]),
        "stopFamily": block(masks["stopFamily"]),
        "normal": block(masks["normal"]),
    }


def sequence_metrics(name, pred, y, x, meta, rows_by_sequence, sequence_map):
    by_index = {i: pred[i] for i in range(len(pred))}
    visual_p95 = []
    normal_visual_p95 = []
    overshoot_max = []
    overshoot_duration = []
    overshoot_frames = []
    stop_recovery_ms = []
    jitter = []
    for seq_id, row_indices in rows_by_sequence.items():
        rows = [i for i in row_indices if i < len(meta)]
        if not rows:
            continue
        seq = sequence_map[seq_id]
        visuals = []
        normal_visuals = []
        lead_values = []
        lead_times = []
        static_magnitudes = []
        recovered_after = None
        for row_index in rows:
            item = meta[row_index]
            err = by_index[row_index] - y[row_index]
            visual = float(np.linalg.norm(err))
            visuals.append(visual)
            target = y[row_index]
            direction = direction_for(target[None, :], x[row_index:row_index + 1])[0]
            lead = max(0.0, float(np.dot(err, direction)))
            if seq.is_stop_family and item["phase"] in {"braking", "hold"}:
                lead_values.append(lead)
                if lead > 0.75:
                    lead_times.append(float(item["elapsedMs"]))
            if item["phase"] == "normal":
                normal_visuals.append(visual)
            if item["static"]:
                static_magnitudes.append(float(np.linalg.norm(by_index[row_index])))
                if recovered_after is None and float(item["elapsedMs"]) >= seq.stop_time_ms and visual <= 1.0:
                    recovered_after = float(item["elapsedMs"]) - seq.stop_time_ms
        visual_p95.append(percentile(visuals, 95))
        if normal_visuals:
            normal_visual_p95.append(percentile(normal_visuals, 95))
        if lead_values:
            overshoot_max.append(max(lead_values))
            overshoot_frames.append(sum(1 for value in lead_values if value > 0.75))
            if lead_times:
                overshoot_duration.append(max(lead_times) - min(lead_times) + FRAME_MS)
            else:
                overshoot_duration.append(0.0)
        if static_magnitudes:
            jitter.append(percentile(static_magnitudes, 95))
        if recovered_after is not None:
            stop_recovery_ms.append(recovered_after)
    return {
        "candidate": name,
        "sequenceCount": int(len(rows_by_sequence)),
        "sequenceVisualP95": percentile(visual_p95, 95),
        "normalSequenceVisualP95": percentile(normal_visual_p95, 95),
        "overshootMaxP95": percentile(overshoot_max, 95),
        "overshootDurationP95Ms": percentile(overshoot_duration, 95),
        "overshootFrameP95": percentile(overshoot_frames, 95),
        "stopRecoveryP95Ms": percentile(stop_recovery_ms, 95),
        "stationaryJitterP95": percentile(jitter, 95),
    }


class MLP:
    def __init__(self, input_count, hidden, rng):
        scale0 = math.sqrt(2.0 / (input_count + hidden))
        scale1 = math.sqrt(2.0 / (hidden + 2))
        self.w0 = rng.normal(0.0, scale0, size=(input_count, hidden))
        self.b0 = np.zeros(hidden, dtype=np.float64)
        self.w1 = rng.normal(0.0, scale1, size=(hidden, 2))
        self.b1 = np.zeros(2, dtype=np.float64)
        self.m = [np.zeros_like(p) for p in self.params()]
        self.v = [np.zeros_like(p) for p in self.params()]

    def params(self):
        return [self.w0, self.b0, self.w1, self.b1]

    @property
    def estimated_macs(self):
        return self.w0.size + self.w1.size

    @property
    def parameter_count(self):
        return self.w0.size + self.b0.size + self.w1.size + self.b1.size

    def forward(self, x):
        hidden = np.tanh(x @ self.w0 + self.b0)
        return hidden @ self.w1 + self.b1, hidden

    def predict(self, x):
        return self.forward(x)[0]

    def train(self, x, y, base, dirs, sample_weights, sequence_weights, epochs, batch_size, lr, seed, lead_weight, lag_weight):
        rng = np.random.default_rng(seed)
        n = x.shape[0]
        trace = []
        step = 0
        beta1 = 0.9
        beta2 = 0.999
        eps = 1.0e-8
        weights = sample_weights * sequence_weights
        for epoch in range(1, epochs + 1):
            order = rng.permutation(n)
            epoch_loss = 0.0
            for start in range(0, n, batch_size):
                idx = order[start:start + batch_size]
                xb = x[idx]
                yb = y[idx]
                bb = base[idx]
                db = dirs[idx]
                wb = weights[idx]
                out, hidden = self.forward(xb)
                pred = bb + out
                err = pred - yb
                projection = np.sum(err * db, axis=1)
                lead = np.maximum(0.0, projection)
                lag = np.maximum(0.0, -projection)
                row_loss = wb * (np.sum(err * err, axis=1) + lead_weight * lead * lead + lag_weight * lag * lag)
                grad_pred = (2.0 * wb / max(1, len(idx)))[:, None] * err
                if lead_weight > 0.0:
                    grad_pred += ((2.0 * lead_weight * wb * lead) / max(1, len(idx)))[:, None] * db
                if lag_weight > 0.0:
                    grad_pred -= ((2.0 * lag_weight * wb * lag) / max(1, len(idx)))[:, None] * db
                epoch_loss += float(row_loss.sum())
                grad_w1 = hidden.T @ grad_pred
                grad_b1 = grad_pred.sum(axis=0)
                grad_hidden = grad_pred @ self.w1.T
                grad_z = grad_hidden * (1.0 - hidden * hidden)
                grad_w0 = xb.T @ grad_z
                grad_b0 = grad_z.sum(axis=0)
                grads = [grad_w0, grad_b0, grad_w1, grad_b1]
                step += 1
                for i, (param, grad) in enumerate(zip(self.params(), grads)):
                    self.m[i] = beta1 * self.m[i] + (1.0 - beta1) * grad
                    self.v[i] = beta2 * self.v[i] + (1.0 - beta2) * (grad * grad)
                    m_hat = self.m[i] / (1.0 - beta1 ** step)
                    v_hat = self.v[i] / (1.0 - beta2 ** step)
                    param -= lr * m_hat / (np.sqrt(v_hat) + eps)
            if epoch == 1 or epoch % 14 == 0 or epoch == epochs:
                trace.append({"epoch": int(epoch), "loss": epoch_loss / max(1, n)})
        return trace


def normalize(train_x, arrays):
    mean = train_x.mean(axis=0)
    std = train_x.std(axis=0)
    std[std < 0.05] = 0.05
    return [(array - mean) / std for array in arrays], mean, std


def split_indices(meta):
    indices = {}
    for index, item in enumerate(meta):
        indices.setdefault(item["split"], []).append(index)
    return {key: np.asarray(value, dtype=np.int64) for key, value in indices.items()}


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


def sequence_weight_vector(meta):
    weights = np.ones(len(meta), dtype=np.float64)
    for index, item in enumerate(meta):
        if item["phase"] == "braking":
            weights[index] *= 7.0
        elif item["phase"] == "hold":
            weights[index] *= 9.0
        elif item["phase"] == "restart":
            weights[index] *= 3.0
        if item["static"]:
            weights[index] *= 2.0
        if item["horizon"] in {8.0, 10.0, 12.0}:
            weights[index] *= 1.5
    return weights


def basic_weight_vector(meta, braking_weight=1.0, static_weight=1.0):
    weights = np.ones(len(meta), dtype=np.float64)
    for index, item in enumerate(meta):
        if item["braking"]:
            weights[index] *= braking_weight
        if item["static"]:
            weights[index] *= static_weight
    return weights


def evaluate_candidate(name, pred, y, x, meta, rows_by_sequence, sequence_map, estimated_macs=0, parameters=0, training_trace=None):
    row = evaluate_rows(name, pred, y, x, meta, estimated_macs, parameters, training_trace)
    row["sequence"] = sequence_metrics(name, pred, y, x, meta, rows_by_sequence, sequence_map)
    return row


def report_lines(scores):
    items = sorted(scores["testResults"], key=lambda item: (item["sequence"]["overshootMaxP95"], item["sequence"]["sequenceVisualP95"]))
    visual_items = sorted(scores["testResults"], key=lambda item: (item["sequence"]["sequenceVisualP95"], item["sequence"]["overshootMaxP95"]))
    lines = [
        "# Step 01 Report - Sequence Stop Loss",
        "",
        "## Summary",
        "",
        "This step uses procedural sudden-stop scenarios and sequence-level metrics. The goal is to avoid selecting a model that only improves row-level error while still visibly passing the real cursor during abrupt deceleration.",
        "",
        "## Dataset",
        "",
        f"- train sequences: {scores['dataset']['sequenceSplits']['train']}",
        f"- validation sequences: {scores['dataset']['sequenceSplits']['validation']}",
        f"- test sequences: {scores['dataset']['sequenceSplits']['test']}",
        f"- feature rows: {scores['dataset']['rows']}",
        f"- horizons per runtime sample: {len(scores['config']['horizonsMs'])}",
        "",
        "## Best Test Candidates By Sequence Visual Error",
        "",
        "| candidate | sequence visual p95 | overshoot max p95 | overshoot duration p95 ms | jitter p95 | row visual p95 | MACs |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in visual_items[:10]:
        seq = item["sequence"]
        lines.append(
            f"| {item['candidate']} | {seq['sequenceVisualP95']:.6f} | {seq['overshootMaxP95']:.6f} | "
            f"{seq['overshootDurationP95Ms']:.6f} | {seq['stationaryJitterP95']:.6f} | "
            f"{item['overall']['visualP95']:.6f} | {item['estimatedMacs']} |"
        )
    lines += [
        "",
        "## Best Test Candidates By Overshoot",
        "",
        "| candidate | overshoot max p95 | sequence visual p95 | normal visual p95 | recovery p95 ms | row visual p95 | MACs |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in items[:10]:
        seq = item["sequence"]
        lines.append(
            f"| {item['candidate']} | {seq['overshootMaxP95']:.6f} | {seq['sequenceVisualP95']:.6f} | "
            f"{seq['normalSequenceVisualP95']:.6f} | {seq['stopRecoveryP95Ms']:.6f} | "
            f"{item['overall']['visualP95']:.6f} | {item['estimatedMacs']} |"
        )
    lines += [
        "",
        "## Interpretation",
        "",
        "A candidate is promising only if it stays near the best visual candidates while also materially reducing overshoot max and duration. A pure overshoot winner that makes sequence visual p95 much worse is the same failure mode as the conservative SmoothPredictor behavior.",
    ]
    return lines


def main():
    args = parse_args()
    repo_root = Path(args.repo_root).resolve() if args.repo_root else repo_root_from_script()
    output_dir = Path(__file__).resolve().parent
    start = time.perf_counter()
    v25 = load_v25_module(repo_root)
    counts = {"train": args.train_sequences, "validation": args.validation_sequences, "test": args.test_sequences}
    sequences = generate_sequences(counts, args.seed)
    sequence_map = {seq.sequence_id: seq for seq in sequences}
    x, y, meta, rows_by_sequence = build_rows(sequences, args.seed + 1)
    indices_by_split = split_indices(meta)
    train_idx = indices_by_split["train"]
    validation_idx = indices_by_split["validation"]
    test_idx = indices_by_split["test"]
    (train_xn, validation_xn, test_xn), mean, std = normalize(x[train_idx], [x[train_idx], x[validation_idx], x[test_idx]])

    split_payloads = {}
    for split_name, split_idx, normalized in [
        ("validation", validation_idx, validation_xn),
        ("test", test_idx, test_xn),
    ]:
        index_map = {int(row_index): local for local, row_index in enumerate(split_idx)}
        subset_meta = meta_subset(meta, split_idx)
        split_payloads[split_name] = {
            "x": x[split_idx],
            "xn": normalized,
            "y": y[split_idx],
            "meta": subset_meta,
            "rowsBySequence": rows_subset(rows_by_sequence, index_map, subset_meta),
        }

    results = {"validation": [], "test": []}
    smooth = v25.load_current_smooth_predictor(repo_root)
    baseline_factories = [
        ("constant_velocity_v2", lambda raw_x: cv2_prediction(raw_x), 2, 0),
        ("constant_velocity_v3", lambda raw_x: cv_prediction(raw_x, 3), 2, 0),
        ("constant_velocity_v12", lambda raw_x: cv_prediction(raw_x, 12), 2, 0),
        ("accel_aware_cv2_strength0.35", lambda raw_x: accel_aware_prediction(raw_x, 0.35), 6, 0),
        ("accel_aware_cv2_strength0.7", lambda raw_x: accel_aware_prediction(raw_x, 0.7), 6, 0),
        ("soft_brake_cv2_gamma1.4", lambda raw_x: soft_brake_prediction(raw_x, 1.4, 0.10, 0.0), 14, 0),
        ("soft_brake_cv2_gamma2.2", lambda raw_x: soft_brake_prediction(raw_x, 2.2, 0.12, 0.0), 14, 0),
        ("current_smooth_predictor", lambda raw_x: smooth["predict"](raw_x), smooth["estimatedMacs"], smooth["parameters"]),
    ]
    for split_name, payload in split_payloads.items():
        for name, predict, macs, params in baseline_factories:
            pred = predict(payload["x"])
            results[split_name].append(
                evaluate_candidate(name, pred, payload["y"], payload["x"], payload["meta"], payload["rowsBySequence"], sequence_map, macs, params)
            )

    train_meta = meta_subset(meta, train_idx)
    train_y = y[train_idx]
    train_x = x[train_idx]
    dirs = direction_for(train_y, train_x)
    rng = np.random.default_rng(args.seed)
    model_specs = [
        ("direct_row_mse_h32", 32, "direct", basic_weight_vector(train_meta), 0.0, 0.0),
        ("direct_sequence_stop_h32", 32, "direct", sequence_weight_vector(train_meta), 2.0, 0.6),
        ("direct_sequence_stop_h64", 64, "direct", sequence_weight_vector(train_meta), 3.0, 0.8),
        ("residual_cv2_row_mse_h32", 32, "residual", basic_weight_vector(train_meta), 0.0, 0.0),
        ("residual_cv2_sequence_stop_h32", 32, "residual", sequence_weight_vector(train_meta), 2.0, 0.6),
        ("residual_cv2_sequence_stop_h64", 64, "residual", sequence_weight_vector(train_meta), 3.0, 0.8),
    ]
    for name, hidden, mode, weights, lead_weight, lag_weight in model_specs:
        base_train = np.zeros_like(train_y) if mode == "direct" else cv2_prediction(train_x)
        model = MLP(FEATURE_COUNT, hidden, rng)
        trace = model.train(
            train_xn,
            train_y,
            base_train,
            dirs,
            weights,
            np.ones_like(weights),
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=0.0025,
            seed=args.seed + hidden + len(results["test"]),
            lead_weight=lead_weight,
            lag_weight=lag_weight,
        )
        for split_name, payload in split_payloads.items():
            base = np.zeros_like(payload["y"]) if mode == "direct" else cv2_prediction(payload["x"])
            pred = base + model.predict(payload["xn"])
            results[split_name].append(
                evaluate_candidate(
                    name,
                    pred,
                    payload["y"],
                    payload["x"],
                    payload["meta"],
                    payload["rowsBySequence"],
                    sequence_map,
                    model.estimated_macs + (2 if mode == "residual" else 0),
                    model.parameter_count,
                    trace,
                )
            )

    scores = {
        "schemaVersion": "cursor-prediction-v27-step-01-sequence-stop-loss/1",
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "seed": args.seed,
            "epochs": args.epochs,
            "batchSize": args.batch_size,
            "frameMilliseconds": FRAME_MS,
            "defaultHorizonMs": DEFAULT_HORIZON_MS,
            "horizonsMs": [float(value) for value in TARGET_HORIZONS_MS],
            "runtime": "bundled Python + NumPy, CPU-only",
        },
        "dataset": {
            "rows": int(len(y)),
            "sequenceCount": int(len(sequences)),
            "sequenceSplits": counts,
            "splitRows": {name: int(len(value)) for name, value in indices_by_split.items()},
            "families": sorted({seq.family for seq in sequences}),
        },
        "normalizer": {
            "featureMean0Horizon": float(mean[0]),
            "featureStd0Horizon": float(std[0]),
        },
        "validationResults": results["validation"],
        "testResults": results["test"],
        "elapsedSeconds": time.perf_counter() - start,
        "limitations": [
            "Procedural scenarios are not yet collected through Calibrator closed-loop capture.",
            "Sequence loss is approximated by phase-aware row weighting; a true sequence backpropagation objective is deferred.",
            "No C# model is emitted from this step.",
        ],
    }
    (output_dir / "scores.json").write_text(json.dumps(scores, indent=2), encoding="ascii")
    (output_dir / "report.md").write_text("\n".join(report_lines(scores)) + "\n", encoding="ascii")
    best_visual = sorted(
        scores["testResults"], key=lambda item: (item["sequence"]["sequenceVisualP95"], item["sequence"]["overshootMaxP95"])
    )[:5]
    print(
        json.dumps(
            {
                "rows": scores["dataset"]["rows"],
                "sequences": scores["dataset"]["sequenceCount"],
                "candidates": len(scores["testResults"]),
                "elapsedSeconds": scores["elapsedSeconds"],
                "bestVisual": [
                    {
                        "candidate": item["candidate"],
                        "sequenceVisualP95": item["sequence"]["sequenceVisualP95"],
                        "overshootMaxP95": item["sequence"]["overshootMaxP95"],
                        "overshootDurationP95Ms": item["sequence"]["overshootDurationP95Ms"],
                    }
                    for item in best_visual
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
