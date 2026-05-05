import argparse
import csv
import json
import math
import time
import zipfile
from bisect import bisect_right
from pathlib import Path

import numpy as np


ABSOLUTE_HORIZON_MS = np.array([-24.0, -16.0, -8.0, 0.0, 4.0, 8.0, 12.0, 16.0, 24.0, 32.0, 40.0], dtype=np.float64)
DISPLAY_OFFSET_MS = np.array([-32.0, -24.0, -16.0, -8.0, 0.0, 8.0, 16.0, 24.0, 32.0], dtype=np.float64)
DISPLAY_OFFSET_ORIGIN_MS = 8.0
DEFAULT_HORIZON_CAP_MS = 10.0
FEATURE_COUNT = 25
WARMUP_MS = 1500.0


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=None)
    parser.add_argument("--rows-per-package", type=int, default=1200)
    parser.add_argument("--epochs", type=int, default=36)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--seed", type=int, default=2405)
    parser.add_argument("--horizon-mode", choices=("product-offset", "absolute"), default="product-offset")
    return parser.parse_args()


def repo_root_from_script():
    return Path(__file__).resolve().parents[3]


def to_float(value, fallback=0.0):
    try:
        if value == "":
            return fallback
        return float(value)
    except ValueError:
        return fallback


def to_int(value, fallback=0):
    try:
        if value == "":
            return fallback
        return int(value)
    except ValueError:
        return fallback


def point_distance(ax, ay, bx, by):
    return math.hypot(bx - ax, by - ay)


def interpolate(refs_elapsed, refs_xy, elapsed_us):
    if len(refs_elapsed) < 2 or elapsed_us < refs_elapsed[0] or elapsed_us > refs_elapsed[-1]:
        return None
    hi = bisect_right(refs_elapsed, elapsed_us)
    if hi <= 0:
        return None
    if hi >= len(refs_elapsed):
        hi = len(refs_elapsed) - 1
    lo = hi - 1
    a_t = refs_elapsed[lo]
    b_t = refs_elapsed[hi]
    span = max(1.0, b_t - a_t)
    t = min(1.0, max(0.0, (elapsed_us - a_t) / span))
    ax, ay = refs_xy[lo]
    bx, by = refs_xy[hi]
    return ax + (bx - ax) * t, ay + (by - ay) * t


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
            maximum = max(maximum, point_distance(a["x"], a["y"], b["x"], b["y"]) / dt)
    return maximum


def build_path(call, history, sample_count):
    points = history[-max(0, sample_count - 1):] + [call]
    if len(points) < 2:
        return 0.0, 0.0, 0.0
    path = 0.0
    for a, b in zip(points, points[1:]):
        path += point_distance(a["x"], a["y"], b["x"], b["y"])
    net = point_distance(points[0]["x"], points[0]["y"], call["x"], call["y"])
    efficiency = net / path if path > 1.0e-9 else 0.0
    return net, path, efficiency


def build_features(call, history, horizon_ms):
    v2 = velocity_window(call, history, 2, horizon_ms)
    v3 = velocity_window(call, history, 3, horizon_ms)
    v5 = velocity_window(call, history, 5, horizon_ms)
    v8 = velocity_window(call, history, 8, horizon_ms)
    v12 = velocity_window(call, history, 12, horizon_ms)
    latest_delta = 0.0 if not history else point_distance(history[-1]["x"], history[-1]["y"], call["x"], call["y"])
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


def load_trace(archive):
    with archive.open("trace.csv") as raw:
        reader = csv.DictReader((line.decode("utf-8-sig") for line in raw))
        trace = {}
        refs_elapsed = []
        refs_xy = []
        for row in reader:
            sequence = to_int(row.get("sequence", ""), -1)
            if sequence < 0:
                continue
            x = to_float(row.get("cursorX", ""), float("nan"))
            y = to_float(row.get("cursorY", ""), float("nan"))
            if math.isnan(x) or math.isnan(y):
                x = to_float(row.get("x", ""), float("nan"))
                y = to_float(row.get("y", ""), float("nan"))
            if math.isnan(x) or math.isnan(y):
                continue
            elapsed_us = to_float(row.get("elapsedMicroseconds", ""))
            event = row.get("event", "")
            sample_ticks = to_int(row.get("runtimeSchedulerSampleRecordedTicks", ""), 0)
            if sample_ticks <= 0:
                sample_ticks = to_int(row.get("stopwatchTicks", ""), 0)
            target_ticks = to_int(row.get("predictionTargetTicks", ""), 0)
            if target_ticks <= 0:
                target_ticks = to_int(row.get("presentReferenceTicks", ""), 0)
            refresh_ticks = to_int(row.get("dwmQpcRefreshPeriod", ""), 0)
            frequency = to_int(row.get("stopwatchFrequency", ""), 10_000_000)
            sample_to_target_us = to_float(row.get("runtimeSchedulerSampleToTargetMicroseconds", ""), float("nan"))
            if math.isnan(sample_to_target_us):
                sample_to_target_us = to_float(row.get("sampleRecordedToPredictionTargetMicroseconds", ""), float("nan"))
            if math.isnan(sample_to_target_us) and sample_ticks > 0 and target_ticks > 0 and frequency > 0:
                sample_to_target_us = (target_ticks - sample_ticks) * 1_000_000.0 / frequency
            refresh_ms = refresh_ticks * 1000.0 / frequency if refresh_ticks > 0 and frequency > 0 else 16.6667
            trace[sequence] = {
                "elapsed_us": elapsed_us,
                "elapsed_ms": elapsed_us / 1000.0,
                "x": x,
                "y": y,
                "event": event,
                "sample_ticks": sample_ticks,
                "target_ticks": target_ticks,
                "refresh_ticks": refresh_ticks,
                "frequency": frequency,
                "sample_to_target_ms": sample_to_target_us / 1000.0 if not math.isnan(sample_to_target_us) else 0.0,
                "refresh_ms": refresh_ms,
            }
            if event in {"referencePoll", "cursorPoll", "rawInput"}:
                refs_elapsed.append(elapsed_us)
                refs_xy.append((x, y))
    order = np.argsort(refs_elapsed)
    refs_elapsed = [refs_elapsed[i] for i in order]
    refs_xy = [refs_xy[i] for i in order]
    return trace, refs_elapsed, refs_xy


def iter_horizon_specs(call, horizon_mode):
    if horizon_mode == "absolute":
        for horizon_ms in ABSOLUTE_HORIZON_MS:
            yield {
                "bucket": float(horizon_ms),
                "display_offset": None,
                "requested_horizon_ms": float(horizon_ms),
                "used_horizon_ms": float(horizon_ms),
                "accepted": True,
                "reject_reason": "",
            }
        return

    for display_offset in DISPLAY_OFFSET_MS:
        internal_offset = DISPLAY_OFFSET_ORIGIN_MS + float(display_offset)
        requested_horizon = call["sample_to_target_ms"] + internal_offset
        excessive_limit = call["refresh_ms"] * 1.25
        if requested_horizon <= 0.0:
            yield {
                "bucket": float(display_offset),
                "display_offset": float(display_offset),
                "requested_horizon_ms": requested_horizon,
                "used_horizon_ms": 0.0,
                "accepted": False,
                "reject_reason": "expired",
            }
        elif requested_horizon > excessive_limit:
            yield {
                "bucket": float(display_offset),
                "display_offset": float(display_offset),
                "requested_horizon_ms": requested_horizon,
                "used_horizon_ms": 0.0,
                "accepted": False,
                "reject_reason": "excessive",
            }
        else:
            yield {
                "bucket": float(display_offset),
                "display_offset": float(display_offset),
                "requested_horizon_ms": requested_horizon,
                "used_horizon_ms": min(requested_horizon, DEFAULT_HORIZON_CAP_MS),
                "accepted": True,
                "reject_reason": "",
            }


def load_package(repo_root, package, rows_per_package, horizon_mode):
    zip_path = repo_root / package["path"].replace("/", "\\")
    features = []
    labels = []
    meta = []
    selected_rows = 0
    runtime_rows = 0
    valid_labels = 0
    with zipfile.ZipFile(zip_path, "r") as archive:
        trace, refs_elapsed, refs_xy = load_trace(archive)
        histories = {}
        with archive.open("motion-trace-alignment.csv") as raw:
            reader = csv.DictReader((line.decode("utf-8-sig") for line in raw))
            for row in reader:
                if row.get("traceEvent") != "runtimeSchedulerPoll":
                    continue
                runtime_rows += 1
                scenario_elapsed = to_float(row.get("scenarioElapsedMilliseconds", ""))
                if scenario_elapsed < WARMUP_MS:
                    continue
                sequence = to_int(row.get("traceSequence", ""), -1)
                call = trace.get(sequence)
                if call is None:
                    continue
                scenario_index = to_int(row.get("scenarioIndex", ""), 0)
                scenario_key = f"{package['packageId']}#{scenario_index}"
                history = histories.setdefault(scenario_key, [])
                if selected_rows < rows_per_package:
                    for spec in iter_horizon_specs(call, horizon_mode):
                        horizon_ms = spec["used_horizon_ms"]
                        target = interpolate(refs_elapsed, refs_xy, call["elapsed_us"] + horizon_ms * 1000.0)
                        if target is None:
                            continue
                        x_target, y_target = target
                        features.append(build_features(call, history, horizon_ms))
                        labels.append([x_target - call["x"], y_target - call["y"]])
                        phase = row.get("movementPhase", "")
                        generated_velocity = to_float(row.get("velocityPixelsPerSecond", ""))
                        label_distance = point_distance(call["x"], call["y"], x_target, y_target)
                        meta.append(
                            {
                                "split": package["split"],
                                "quality": package["qualityBucket"],
                                "duration": package["durationBucket"],
                                "package": package["packageId"],
                                "scenario": scenario_key,
                                "horizon": horizon_ms,
                                "bucket": spec["bucket"],
                                "displayOffset": spec["display_offset"],
                                "requestedHorizon": spec["requested_horizon_ms"],
                                "accepted": spec["accepted"],
                                "rejectReason": spec["reject_reason"],
                                "phase": phase,
                                "generatedVelocity": generated_velocity,
                                "static": (not spec["accepted"]) or ((phase == "hold" or generated_velocity < 1.0) and label_distance <= 0.75),
                            }
                        )
                        valid_labels += 1
                    selected_rows += 1
                history.append(call)
                if len(history) > 12:
                    del history[0]
                if selected_rows >= rows_per_package:
                    # Keep this prototype bounded. The full builder should stream all rows.
                    break
    return features, labels, meta, {"runtimeRowsVisited": runtime_rows, "selectedRows": selected_rows, "validLabels": valid_labels}


def load_dataset(repo_root, rows_per_package, horizon_mode):
    manifest_path = repo_root / "poc/cursor-prediction-v21/step-02-balanced-evaluation/split-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    all_features = []
    all_labels = []
    all_meta = []
    package_counts = {}
    for package in manifest["packages"]:
        features, labels, meta, counts = load_package(repo_root, package, rows_per_package, horizon_mode)
        all_features.extend(features)
        all_labels.extend(labels)
        all_meta.extend(meta)
        package_counts[package["packageId"]] = counts
    return np.vstack(all_features), np.asarray(all_labels, dtype=np.float64), all_meta, package_counts


def split_arrays(x, y, meta):
    split_indices = {}
    for i, item in enumerate(meta):
        split_indices.setdefault(item["split"], []).append(i)
    return {key: np.asarray(value, dtype=np.int64) for key, value in split_indices.items()}


def normalize(train_x, *arrays):
    mean = train_x.mean(axis=0)
    std = train_x.std(axis=0)
    std[std < 0.05] = 0.05
    return [(array - mean) / std for array in arrays], mean, std


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
        z = x @ self.w0 + self.b0
        h = np.tanh(z)
        out = h @ self.w1 + self.b1
        return out, h

    def predict(self, x):
        return self.forward(x)[0]

    def train(self, x, y, directions, epochs, batch_size, lr, seed, loss_kind):
        rng = np.random.default_rng(seed)
        n = x.shape[0]
        trace = []
        step = 0
        beta1 = 0.9
        beta2 = 0.999
        eps = 1.0e-8
        for epoch in range(1, epochs + 1):
            order = rng.permutation(n)
            epoch_loss = 0.0
            for start in range(0, n, batch_size):
                idx = order[start:start + batch_size]
                xb = x[idx]
                yb = y[idx]
                db = directions[idx]
                pred, hidden = self.forward(xb)
                err = pred - yb
                grad_pred = 2.0 * err / max(1, len(idx))
                row_loss = np.sum(err * err, axis=1)
                if loss_kind == "asym_lead4":
                    projection = np.sum(err * db, axis=1)
                    weights = np.where(projection > 0.0, 4.0, 1.0)
                    row_loss += weights * projection * projection
                    grad_pred += (2.0 * weights * projection / max(1, len(idx)))[:, None] * db
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
            if epoch == 1 or epoch % 12 == 0 or epoch == epochs:
                trace.append({"epoch": epoch, "loss": epoch_loss / max(1, n)})
        return trace


def directions_for(y, x):
    dirs = np.zeros_like(y)
    mag = np.linalg.norm(y, axis=1)
    valid = mag > 1.0e-9
    dirs[valid] = y[valid] / mag[valid, None]
    dirs[~valid, 0] = x[~valid, 23]
    dirs[~valid, 1] = x[~valid, 24]
    return dirs


def percentile(values, p):
    if len(values) == 0:
        return 0.0
    return float(np.percentile(values, p, method="higher"))


def apply_static_guard(pred, meta):
    guarded = pred.copy()
    static_mask = np.asarray([item["static"] for item in meta], dtype=bool)
    guarded[static_mask] = 0.0
    return guarded


def evaluate_predictions(name, pred, y, x, meta, estimated_macs=0, parameters=0, training_trace=None, static_guard=False):
    if static_guard:
        pred = apply_static_guard(pred, meta)
    err = pred - y
    visual = np.linalg.norm(err, axis=1)
    dirs = directions_for(y, x)
    signed = np.sum(err * dirs, axis=1)
    lead = np.maximum(0.0, signed)
    lag = np.maximum(0.0, -signed)
    static_mask = np.asarray([item["static"] for item in meta], dtype=bool)
    result = {
        "candidate": name,
        "rows": int(len(y)),
        "estimatedMacs": int(estimated_macs),
        "parameters": int(parameters),
        "staticGuard": bool(static_guard),
        "trainingTrace": training_trace or [],
        "overall": {
            "visualMean": float(visual.mean()) if len(visual) else 0.0,
            "visualP95": percentile(visual, 95),
            "visualP99": percentile(visual, 99),
            "leadP99": percentile(lead, 99),
            "lagP95": percentile(lag, 95),
            "lagP99": percentile(lag, 99),
            "stationaryJitterP95": percentile(np.linalg.norm(pred[static_mask], axis=1), 95) if static_mask.any() else 0.0,
        },
        "byHorizon": {},
    }
    buckets = sorted({item.get("bucket", item["horizon"]) for item in meta})
    for bucket in buckets:
        mask = np.asarray([item.get("bucket", item["horizon"]) == bucket for item in meta], dtype=bool)
        result["byHorizon"][str(bucket)] = {
            "rows": int(mask.sum()),
            "visualP95": percentile(visual[mask], 95),
            "visualP99": percentile(visual[mask], 99),
            "leadP99": percentile(lead[mask], 99),
            "lagP95": percentile(lag[mask], 95),
        }
    return result


def select_meta(meta, indices):
    return [meta[int(i)] for i in indices]


def write_report(path, scores):
    lines = [
        "# Step 03 Report - Initial Multi-Horizon MLP Search",
        "",
        "## Summary",
        "",
        "This is the first bounded CPU-only model run for v24. It streams existing MotionLab ZIP files, builds a small multi-horizon sample, and compares simple baselines with small horizon-aware MLPs.",
        "",
        "It is not a final SOTA run. It exists to validate the data shape and check whether target-horizon-aware learning is worth expanding.",
        "",
        "## Dataset",
        "",
        f"- rows per package cap: {scores['config']['rowsPerPackage']}",
        f"- horizon mode: {scores['config']['horizonMode']}",
        f"- labels per selected row: {len(scores['config']['targetBuckets'])}",
        f"- feature rows: {scores['dataset']['rows']}",
        f"- train rows: {scores['dataset']['splitRows'].get('train', 0)}",
        f"- validation rows: {scores['dataset']['splitRows'].get('validation', 0)}",
        f"- test rows: {scores['dataset']['splitRows'].get('test', 0)}",
        "",
        "## Test Results",
        "",
        "| candidate | visual p95 | visual p99 | lead p99 | lag p95 | stationary jitter p95 | MACs | params |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in scores["testResults"]:
        overall = item["overall"]
        lines.append(
            f"| {item['candidate']} | {overall['visualP95']:.6f} | {overall['visualP99']:.6f} | "
            f"{overall['leadP99']:.6f} | {overall['lagP95']:.6f} | {overall['stationaryJitterP95']:.6f} | "
            f"{item['estimatedMacs']} | {item['parameters']} |"
        )
    lines += [
        "",
        "## Decision",
        "",
        "The next run should keep the same streaming builder but increase data coverage, add event/stop-aware losses, and report normal/test/robustness gates. If the larger MLP only improves aggregate visual error while increasing lead or jitter, it should not be promoted.",
        "",
        "## Command",
        "",
        "```powershell",
        "& 'C:\\Users\\seigl\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe' poc\\cursor-prediction-v24-multi-horizon-mlp\\step-03-teacher-model-search\\train_sample_models.py",
        "```",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="ascii")


def main():
    args = parse_args()
    repo_root = Path(args.repo_root).resolve() if args.repo_root else repo_root_from_script()
    output_dir = Path(__file__).resolve().parent
    start = time.perf_counter()
    x, y, meta, package_counts = load_dataset(repo_root, args.rows_per_package, args.horizon_mode)
    split = split_arrays(x, y, meta)
    train_idx = split.get("train", np.array([], dtype=np.int64))
    validation_idx = split.get("validation", np.array([], dtype=np.int64))
    test_idx = split.get("test", np.array([], dtype=np.int64))
    if len(train_idx) == 0 or len(test_idx) == 0:
        raise RuntimeError("train and test splits are required")

    (train_xn, validation_xn, test_xn), mean, std = normalize(x[train_idx], x[train_idx], x[validation_idx], x[test_idx])
    train_y = y[train_idx]
    test_y = y[test_idx]
    train_dirs = directions_for(train_y, x[train_idx])

    candidates = []
    cv_train_pred = x[train_idx][:, [1, 2]] * 8.0
    cv_test_pred = x[test_idx][:, [1, 2]] * 8.0
    candidates.append(evaluate_predictions("cv_v2_feature_baseline", cv_test_pred, test_y, x[test_idx], select_meta(meta, test_idx), estimated_macs=2, parameters=0))
    candidates.append(evaluate_predictions("cv_v2_feature_baseline_static_guard", cv_test_pred, test_y, x[test_idx], select_meta(meta, test_idx), estimated_macs=2, parameters=0, static_guard=True))

    rng = np.random.default_rng(args.seed)
    for hidden, loss_kind in [(32, "mse"), (64, "mse"), (64, "asym_lead4"), (128, "mse")]:
        model = MLP(FEATURE_COUNT, hidden, rng)
        trace = model.train(
            train_xn,
            train_y,
            train_dirs,
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=0.003,
            seed=args.seed + hidden + len(candidates),
            loss_kind=loss_kind,
        )
        test_pred = model.predict(test_xn)
        candidates.append(
            evaluate_predictions(
                f"mlp_h{hidden}_{loss_kind}",
                test_pred,
                test_y,
                x[test_idx],
                select_meta(meta, test_idx),
                estimated_macs=model.estimated_macs,
                parameters=model.parameter_count,
                training_trace=trace,
            )
        )

    residual_train_y = train_y - cv_train_pred
    for hidden, loss_kind in [(32, "mse"), (64, "mse"), (64, "asym_lead4"), (128, "mse")]:
        model = MLP(FEATURE_COUNT, hidden, rng)
        trace = model.train(
            train_xn,
            residual_train_y,
            train_dirs,
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=0.003,
            seed=args.seed + 1000 + hidden + len(candidates),
            loss_kind=loss_kind,
        )
        test_pred = cv_test_pred + model.predict(test_xn)
        candidates.append(
            evaluate_predictions(
                f"residual_cv_mlp_h{hidden}_{loss_kind}",
                test_pred,
                test_y,
                x[test_idx],
                select_meta(meta, test_idx),
                estimated_macs=model.estimated_macs + 2,
                parameters=model.parameter_count,
                training_trace=trace,
            )
        )
        candidates.append(
            evaluate_predictions(
                f"residual_cv_mlp_h{hidden}_{loss_kind}_static_guard",
                test_pred,
                test_y,
                x[test_idx],
                select_meta(meta, test_idx),
                estimated_macs=model.estimated_macs + 2,
                parameters=model.parameter_count,
                training_trace=trace,
                static_guard=True,
            )
        )

    split_rows = {key: int(len(value)) for key, value in split.items()}
    scores = {
        "schemaVersion": "cursor-prediction-v24-step-03-initial-model-search/1",
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "rowsPerPackage": args.rows_per_package,
            "epochs": args.epochs,
            "batchSize": args.batch_size,
            "seed": args.seed,
            "horizonMode": args.horizon_mode,
            "targetBuckets": [float(x) for x in (DISPLAY_OFFSET_MS if args.horizon_mode == "product-offset" else ABSOLUTE_HORIZON_MS)],
            "displayOffsetOriginMilliseconds": DISPLAY_OFFSET_ORIGIN_MS if args.horizon_mode == "product-offset" else None,
            "horizonCapMilliseconds": DEFAULT_HORIZON_CAP_MS if args.horizon_mode == "product-offset" else None,
            "runtime": "bundled Python + NumPy, CPU-only",
        },
        "dataset": {
            "rows": int(len(y)),
            "featureCount": FEATURE_COUNT,
            "splitRows": split_rows,
            "packageCounts": package_counts,
        },
        "normalizer": {
            "featureMean0Horizon": float(mean[0]),
            "featureStd0Horizon": float(std[0]),
        },
        "testResults": candidates,
        "elapsedSeconds": time.perf_counter() - start,
        "limitations": [
            "This run uses a capped sample and only reports the test split.",
            "The MLP loss is row-level MSE or a simple asymmetric lead penalty; event sequence loss is deferred.",
            "No Calibrator closed-loop measurement was run.",
            "No model weights are exported from this exploratory run.",
        ],
    }
    (output_dir / "scores.json").write_text(json.dumps(scores, indent=2), encoding="ascii")
    write_report(output_dir / "report.md", scores)
    print(json.dumps({"rows": int(len(y)), "candidates": [c["candidate"] for c in candidates], "elapsedSeconds": scores["elapsedSeconds"]}, indent=2))


if __name__ == "__main__":
    main()
