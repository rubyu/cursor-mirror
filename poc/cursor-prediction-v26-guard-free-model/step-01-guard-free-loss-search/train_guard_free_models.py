import argparse
import importlib.util
import json
import math
import time
from pathlib import Path

import numpy as np


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
    parser.add_argument("--rows-per-package", type=int, default=1600)
    parser.add_argument("--epochs", type=int, default=36)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--seed", type=int, default=2601)
    parser.add_argument("--horizon-mode", choices=("product-offset", "absolute"), default="product-offset")
    return parser.parse_args()


def percentile(values, p):
    if len(values) == 0:
        return 0.0
    return float(np.percentile(values, p, method="higher"))


def cv2_prediction(x):
    return x[:, [1, 2]] * 8.0


def cv_window_prediction(x, window):
    if window == 3:
        return x[:, [4, 5]] * 8.0
    if window == 5:
        return x[:, [7, 8]] * 8.0
    if window == 8:
        return x[:, [10, 11]] * 8.0
    if window == 12:
        return x[:, [13, 14]] * 8.0
    raise ValueError(f"Unsupported CV window: {window}")


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


def directions_for(y, x):
    dirs = np.zeros_like(y)
    mag = np.linalg.norm(y, axis=1)
    valid = mag > 1.0e-9
    dirs[valid] = y[valid] / mag[valid, None]
    dirs[~valid, 0] = x[~valid, 23]
    dirs[~valid, 1] = x[~valid, 24]
    return dirs


def masks_for(x, y, meta):
    target_mag = np.linalg.norm(y, axis=1)
    cv_mag = np.linalg.norm(cv2_prediction(x), axis=1)
    slow_or_stop = np.asarray([bool(item.get("slowOrStop", False)) for item in meta], dtype=bool)
    static = np.asarray([bool(item.get("static", False)) for item in meta], dtype=bool)
    central = np.asarray([abs(float(item.get("displayOffset", item.get("bucket", 0.0)))) <= 8.0 for item in meta], dtype=bool)
    accepted = np.asarray([bool(item.get("accepted", True)) for item in meta], dtype=bool)
    # Braking rows are the rows where naive CV wants to keep moving farther than
    # the available future target. This is the region that produces visible
    # overshoot on sudden deceleration and stop.
    braking = (cv_mag > target_mag + 0.75) | ((target_mag <= 1.25) & (cv_mag > 1.25))
    return {
        "targetMag": target_mag,
        "cvMag": cv_mag,
        "slowOrStop": slow_or_stop,
        "static": static,
        "central": central,
        "accepted": accepted,
        "braking": braking,
    }


def training_weights(policy, x, y, meta):
    masks = masks_for(x, y, meta)
    weights = np.ones(len(y), dtype=np.float64)
    if policy.get("centralWeight", 1.0) != 1.0:
        weights[masks["central"]] *= float(policy["centralWeight"])
    if policy.get("stopWeight", 1.0) != 1.0:
        weights[masks["slowOrStop"]] *= float(policy["stopWeight"])
    if policy.get("staticWeight", 1.0) != 1.0:
        weights[masks["static"]] *= float(policy["staticWeight"])
    if policy.get("brakeWeight", 1.0) != 1.0:
        weights[masks["braking"]] *= float(policy["brakeWeight"])
    return weights


def evaluate_predictions(name, pred, y, x, meta, estimated_macs=0, parameters=0, training_trace=None, notes=None):
    err = pred - y
    visual = np.linalg.norm(err, axis=1)
    dirs = directions_for(y, x)
    signed = np.sum(err * dirs, axis=1)
    lead = np.maximum(0.0, signed)
    lag = np.maximum(0.0, -signed)
    masks = masks_for(x, y, meta)

    def metric_block(mask):
        if not mask.any():
            return {
                "rows": 0,
                "visualP95": 0.0,
                "visualP99": 0.0,
                "leadP95": 0.0,
                "leadP99": 0.0,
                "lagP95": 0.0,
                "lagP99": 0.0,
            }
        return {
            "rows": int(mask.sum()),
            "visualP95": percentile(visual[mask], 95),
            "visualP99": percentile(visual[mask], 99),
            "leadP95": percentile(lead[mask], 95),
            "leadP99": percentile(lead[mask], 99),
            "lagP95": percentile(lag[mask], 95),
            "lagP99": percentile(lag[mask], 99),
        }

    return {
        "candidate": name,
        "rows": int(len(y)),
        "estimatedMacs": int(estimated_macs),
        "parameters": int(parameters),
        "trainingTrace": training_trace or [],
        "notes": notes or [],
        "overall": {
            "visualMean": float(visual.mean()) if len(visual) else 0.0,
            "visualP95": percentile(visual, 95),
            "visualP99": percentile(visual, 99),
            "leadP95": percentile(lead, 95),
            "leadP99": percentile(lead, 99),
            "lagP95": percentile(lag, 95),
            "lagP99": percentile(lag, 99),
            "stationaryJitterP95": percentile(np.linalg.norm(pred[masks["static"]], axis=1), 95) if masks["static"].any() else 0.0,
        },
        "central": metric_block(masks["central"]),
        "stop": metric_block(masks["slowOrStop"]),
        "braking": metric_block(masks["braking"]),
        "accepted": metric_block(masks["accepted"]),
        "rejected": metric_block(~masks["accepted"]),
    }


class WeightedMlp:
    def __init__(self, input_count, hidden, output_count, rng):
        scale0 = math.sqrt(2.0 / (input_count + hidden))
        scale1 = math.sqrt(2.0 / (hidden + output_count))
        self.w0 = rng.normal(0.0, scale0, size=(input_count, hidden))
        self.b0 = np.zeros(hidden, dtype=np.float64)
        self.w1 = rng.normal(0.0, scale1, size=(hidden, output_count))
        self.b1 = np.zeros(output_count, dtype=np.float64)
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

    def train(self, x, y, base, dirs, weights, epochs, batch_size, lr, seed, lead_weight):
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
                bb = base[idx]
                db = dirs[idx]
                wb = weights[idx]
                out, hidden = self.forward(xb)
                pred = bb + out
                err = pred - yb
                row_mse = np.sum(err * err, axis=1)
                projection = np.sum(err * db, axis=1)
                lead_extra = np.maximum(0.0, projection)
                row_loss = wb * (row_mse + lead_weight * lead_extra * lead_extra)
                scale = (2.0 * wb / max(1, len(idx)))[:, None]
                grad_pred = scale * err
                if lead_weight > 0.0:
                    lead_mask = projection > 0.0
                    grad_pred += ((2.0 * lead_weight * wb * projection * lead_mask) / max(1, len(idx)))[:, None] * db
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
                trace.append({"epoch": int(epoch), "loss": epoch_loss / max(1, n)})
        return trace


def split_meta(meta, indices):
    return [meta[int(i)] for i in indices]


def add_baselines(results, split_name, x, y, meta, smooth=None):
    candidates = []
    candidates.append(evaluate_predictions("constant_velocity_v2_guard_free", cv2_prediction(x), y, x, meta, estimated_macs=2))
    candidates.append(evaluate_predictions("constant_velocity_v3_guard_free", cv_window_prediction(x, 3), y, x, meta, estimated_macs=2))
    candidates.append(evaluate_predictions("constant_velocity_v12_guard_free", cv_window_prediction(x, 12), y, x, meta, estimated_macs=2))
    for gamma, floor_ratio, min_gain in [(1.0, 0.15, 0.0), (1.5, 0.10, 0.0), (2.0, 0.10, 0.0), (2.0, 0.20, 0.05)]:
        name = f"soft_brake_cv2_gamma{gamma:g}_floor{floor_ratio:g}_min{min_gain:g}"
        candidates.append(
            evaluate_predictions(
                name,
                soft_brake_prediction(x, gamma, floor_ratio, min_gain),
                y,
                x,
                meta,
                estimated_macs=14,
                notes=["continuous speed-ratio damping, no static guard"],
            )
        )
    if smooth is not None:
        candidates.append(
            evaluate_predictions(
                "current_smooth_predictor_guard_free",
                smooth["predict"](x),
                y,
                x,
                meta,
                estimated_macs=smooth["estimatedMacs"],
                parameters=smooth["parameters"],
            )
        )
    results[split_name].extend(candidates)


def summarize_table(items):
    order = sorted(items, key=lambda item: (item["overall"]["visualP95"], item["braking"]["leadP99"], item["overall"]["stationaryJitterP95"]))
    lines = [
        "| candidate | visual p95 | visual p99 | brake lead p99 | stop lead p99 | jitter p95 | MACs | params |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in order[:12]:
        lines.append(
            f"| {item['candidate']} | {item['overall']['visualP95']:.6f} | {item['overall']['visualP99']:.6f} | "
            f"{item['braking']['leadP99']:.6f} | {item['stop']['leadP99']:.6f} | {item['overall']['stationaryJitterP95']:.6f} | "
            f"{item['estimatedMacs']} | {item['parameters']} |"
        )
    return lines


def summarize_brake_table(items):
    order = sorted(items, key=lambda item: (item["braking"]["leadP99"], item["overall"]["visualP95"], item["overall"]["stationaryJitterP95"]))
    lines = [
        "| candidate | brake lead p99 | visual p95 | visual p99 | stop lead p99 | jitter p95 | MACs |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in order[:10]:
        lines.append(
            f"| {item['candidate']} | {item['braking']['leadP99']:.6f} | {item['overall']['visualP95']:.6f} | "
            f"{item['overall']['visualP99']:.6f} | {item['stop']['leadP99']:.6f} | "
            f"{item['overall']['stationaryJitterP95']:.6f} | {item['estimatedMacs']} |"
        )
    return lines


def find_candidate(items, name):
    for item in items:
        if item["candidate"] == name:
            return item
    return None


def write_report(path, scores):
    test_best = sorted(scores["testResults"], key=lambda item: (item["overall"]["visualP95"], item["braking"]["leadP99"], item["overall"]["stationaryJitterP95"]))[:3]
    best_visual = test_best[0]
    best_brake = sorted(scores["testResults"], key=lambda item: (item["braking"]["leadP99"], item["overall"]["visualP95"]))[0]
    smooth = find_candidate(scores["testResults"], "current_smooth_predictor_guard_free")
    lines = [
        "# Step 01 Report - Guard-Free Loss Search",
        "",
        "## Summary",
        "",
        "This POC tests whether stop and overshoot behavior can be learned directly, without product-side static guards. It keeps the v25 runtime-shaped horizon labels and changes the training objective so braking and stop rows are first-class loss terms.",
        "",
        "The important check is not just aggregate visual error. A candidate must also reduce braking-side lead and stationary jitter, because those are the visible failure modes reported for SmoothPredictor-like models.",
        "",
        "## Dataset",
        "",
        f"- rows per package cap: {scores['config']['rowsPerPackage']}",
        f"- labels: product-shaped horizon with target correction buckets",
        f"- total rows: {scores['dataset']['rows']}",
        f"- train rows: {scores['dataset']['splitRows'].get('train', 0)}",
        f"- validation rows: {scores['dataset']['splitRows'].get('validation', 0)}",
        f"- test rows: {scores['dataset']['splitRows'].get('test', 0)}",
        f"- robustness rows: {scores['dataset']['splitRows'].get('robustness', 0)}",
        "",
        "## Best Test Candidates",
        "",
    ]
    lines.extend(summarize_table(scores["testResults"]))
    lines += [
        "",
        "## Brake-Safe Test Candidates",
        "",
    ]
    lines.extend(summarize_brake_table(scores["testResults"]))
    lines += [
        "",
        "## Best By Test Ordering",
        "",
    ]
    for item in test_best:
        lines.append(
            f"- `{item['candidate']}`: visual p95 `{item['overall']['visualP95']:.6f}`, "
            f"brake lead p99 `{item['braking']['leadP99']:.6f}`, jitter p95 `{item['overall']['stationaryJitterP95']:.6f}`"
        )
    lines += [
        "",
        "## Interpretation",
        "",
        f"The best visual candidate is `{best_visual['candidate']}` with visual p95 `{best_visual['overall']['visualP95']:.6f}`, but its braking lead p99 is `{best_visual['braking']['leadP99']:.6f}`.",
        f"The best braking-lead candidate is `{best_brake['candidate']}` with braking lead p99 `{best_brake['braking']['leadP99']:.6f}`, but its visual p95 is `{best_brake['overall']['visualP95']:.6f}`.",
    ]
    if smooth is not None:
        lines.append(
            f"`current_smooth_predictor_guard_free` follows the same trade-off: braking lead p99 `{smooth['braking']['leadP99']:.6f}` but visual p95 `{smooth['overall']['visualP95']:.6f}`."
        )
    lines += [
        "",
        "This step is deliberately guard-free. The learned asymmetric/stop-weighted losses can suppress overshoot, but in this split they do so by becoming too conservative and losing visual accuracy. No learned candidate dominates the simple CV baselines yet.",
        "",
        "The next step should train/evaluate on explicit sudden-stop scenario families and score visible sequence error, because row-level labels alone are not separating safe braking from global lag.",
        "",
        "## Command",
        "",
        "```powershell",
        "& 'C:\\Users\\seigl\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe' poc\\cursor-prediction-v26-guard-free-model\\step-01-guard-free-loss-search\\train_guard_free_models.py",
        "```",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="ascii")


def main():
    args = parse_args()
    repo_root = Path(args.repo_root).resolve() if args.repo_root else repo_root_from_script()
    output_dir = Path(__file__).resolve().parent
    start = time.perf_counter()
    v25 = load_v25_module(repo_root)

    x, y, meta, package_counts = v25.load_dataset(repo_root, args.rows_per_package, args.horizon_mode)
    split = v25.split_arrays(x, y, meta)
    train_idx = split.get("train", np.array([], dtype=np.int64))
    validation_idx = split.get("validation", np.array([], dtype=np.int64))
    test_idx = split.get("test", np.array([], dtype=np.int64))
    robustness_idx = split.get("robustness", np.array([], dtype=np.int64))
    if len(train_idx) == 0 or len(test_idx) == 0:
        raise RuntimeError("train and test splits are required")

    (train_xn, validation_xn, test_xn, robustness_xn), mean, std = v25.normalize(
        x[train_idx], x[train_idx], x[validation_idx], x[test_idx], x[robustness_idx]
    )
    train_y = y[train_idx]
    train_x = x[train_idx]
    train_meta = split_meta(meta, train_idx)
    train_dirs = directions_for(train_y, train_x)
    smooth = v25.load_current_smooth_predictor(repo_root)

    split_payload = {
        "validation": (validation_xn, x[validation_idx], y[validation_idx], split_meta(meta, validation_idx)),
        "test": (test_xn, x[test_idx], y[test_idx], split_meta(meta, test_idx)),
        "robustness": (robustness_xn, x[robustness_idx], y[robustness_idx], split_meta(meta, robustness_idx)),
    }
    results = {"validation": [], "test": [], "robustness": []}
    for split_name, (_, raw_x, split_y, split_meta_items) in split_payload.items():
        add_baselines(results, split_name, raw_x, split_y, split_meta_items, smooth=smooth)

    rng = np.random.default_rng(args.seed)
    policies = [
        ("mse_h32", 32, {"centralWeight": 1.0}, 0.0),
        ("mild_stop_brake_h32", 32, {"centralWeight": 1.5, "stopWeight": 2.5, "staticWeight": 4.0, "brakeWeight": 2.5}, 0.0),
        ("mild_asym2_stop_brake_h32", 32, {"centralWeight": 1.5, "stopWeight": 2.5, "staticWeight": 4.0, "brakeWeight": 2.5}, 2.0),
        ("balanced_asym2_stop_brake_h64", 64, {"centralWeight": 2.0, "stopWeight": 4.0, "staticWeight": 6.0, "brakeWeight": 4.0}, 2.0),
        ("stop_brake_h32", 32, {"centralWeight": 2.0, "stopWeight": 8.0, "staticWeight": 12.0, "brakeWeight": 6.0}, 0.0),
        ("asym4_stop_brake_h32", 32, {"centralWeight": 2.0, "stopWeight": 8.0, "staticWeight": 12.0, "brakeWeight": 6.0}, 4.0),
        ("asym8_stop_brake_h64", 64, {"centralWeight": 2.0, "stopWeight": 10.0, "staticWeight": 16.0, "brakeWeight": 8.0}, 8.0),
        ("asym12_stop_brake_h96", 96, {"centralWeight": 2.5, "stopWeight": 12.0, "staticWeight": 20.0, "brakeWeight": 10.0}, 12.0),
    ]

    for name, hidden, policy, lead_weight in policies:
        weights = training_weights(policy, train_x, train_y, train_meta)
        for mode in ["direct", "residual_cv2"]:
            base_train = np.zeros_like(train_y) if mode == "direct" else cv2_prediction(train_x)
            model = WeightedMlp(v25.FEATURE_COUNT, hidden, 2, rng)
            trace = model.train(
                train_xn,
                train_y,
                base_train,
                train_dirs,
                weights,
                epochs=args.epochs,
                batch_size=args.batch_size,
                lr=0.0025,
                seed=args.seed + hidden + len(results["test"]),
                lead_weight=lead_weight,
            )
            for split_name, (split_xn, raw_x, split_y, split_meta_items) in split_payload.items():
                base = np.zeros_like(split_y) if mode == "direct" else cv2_prediction(raw_x)
                pred = base + model.predict(split_xn)
                results[split_name].append(
                    evaluate_predictions(
                        f"{mode}_{name}",
                        pred,
                        split_y,
                        raw_x,
                        split_meta_items,
                        estimated_macs=model.estimated_macs + (2 if mode == "residual_cv2" else 0),
                        parameters=model.parameter_count,
                        training_trace=trace,
                        notes=[f"policy={json.dumps(policy, sort_keys=True)}", f"leadWeight={lead_weight}", "guard-free"],
                    )
                )

    split_rows = {key: int(len(value)) for key, value in split.items()}
    scores = {
        "schemaVersion": "cursor-prediction-v26-step-01-guard-free-loss-search/1",
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "rowsPerPackage": args.rows_per_package,
            "epochs": args.epochs,
            "batchSize": args.batch_size,
            "seed": args.seed,
            "horizonMode": args.horizon_mode,
            "runtime": "bundled Python + NumPy, CPU-only",
            "guardPolicy": "No candidate uses product-side static/stop guard. Guarded CV is intentionally not scored as a candidate.",
        },
        "dataset": {
            "rows": int(len(y)),
            "featureCount": int(v25.FEATURE_COUNT),
            "splitRows": split_rows,
            "packageCounts": package_counts,
        },
        "normalizer": {
            "featureMean0Horizon": float(mean[0]),
            "featureStd0Horizon": float(std[0]),
        },
        "validationResults": results["validation"],
        "testResults": results["test"],
        "robustnessResults": results["robustness"],
        "elapsedSeconds": time.perf_counter() - start,
        "limitations": [
            "This uses existing v21 MotionLab traces rather than new Calibrator closed-loop captures.",
            "The loss is row-level and guard-free; it does not yet backpropagate through a full visible cursor sequence.",
            "No generated C# model is emitted from this step.",
            "No large intermediate row dumps or checkpoints are written.",
        ],
    }
    (output_dir / "scores.json").write_text(json.dumps(scores, indent=2), encoding="ascii")
    write_report(output_dir / "report.md", scores)
    print(
        json.dumps(
            {
                "rows": int(len(y)),
                "candidates": len(results["test"]),
                "elapsedSeconds": scores["elapsedSeconds"],
                "bestTest": sorted(
                    [
                        {
                            "candidate": item["candidate"],
                            "visualP95": item["overall"]["visualP95"],
                            "brakeLeadP99": item["braking"]["leadP99"],
                            "jitterP95": item["overall"]["stationaryJitterP95"],
                        }
                        for item in results["test"]
                    ],
                    key=lambda item: (item["visualP95"], item["brakeLeadP99"], item["jitterP95"]),
                )[:5],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
