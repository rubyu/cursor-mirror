import argparse
import importlib.util
import json
import math
import time
from pathlib import Path

import numpy as np


CENTRAL_BUCKETS = {-8.0, -4.0, 0.0, 4.0, 8.0}


def repo_root_from_script():
    return Path(__file__).resolve().parents[3]


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=None)
    parser.add_argument("--rows-per-package", type=int, default=2400)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--seed", type=int, default=2507)
    return parser.parse_args()


def apply_static_guard(pred, meta):
    out = pred.copy()
    static = np.asarray([item["static"] for item in meta], dtype=bool)
    out[static] = 0.0
    return out


def softmax(logits):
    z = logits - logits.max(axis=1, keepdims=True)
    exp = np.exp(z)
    return exp / exp.sum(axis=1, keepdims=True)


class GateModel:
    def __init__(self, input_count, hidden, class_count, rng):
        self.hidden = hidden
        if hidden <= 0:
            self.w0 = rng.normal(0.0, math.sqrt(2.0 / (input_count + class_count)), size=(input_count, class_count))
            self.b0 = np.zeros(class_count, dtype=np.float64)
            self.params_list = [self.w0, self.b0]
        else:
            self.w0 = rng.normal(0.0, math.sqrt(2.0 / (input_count + hidden)), size=(input_count, hidden))
            self.b0 = np.zeros(hidden, dtype=np.float64)
            self.w1 = rng.normal(0.0, math.sqrt(2.0 / (hidden + class_count)), size=(hidden, class_count))
            self.b1 = np.zeros(class_count, dtype=np.float64)
            self.params_list = [self.w0, self.b0, self.w1, self.b1]
        self.m = [np.zeros_like(p) for p in self.params_list]
        self.v = [np.zeros_like(p) for p in self.params_list]

    @property
    def estimated_macs(self):
        if self.hidden <= 0:
            return int(self.w0.size)
        return int(self.w0.size + self.w1.size)

    @property
    def parameter_count(self):
        return int(sum(p.size for p in self.params_list))

    def forward(self, x):
        if self.hidden <= 0:
            return x @ self.w0 + self.b0, None
        hidden = np.tanh(x @ self.w0 + self.b0)
        return hidden @ self.w1 + self.b1, hidden

    def predict_class(self, x):
        logits, _ = self.forward(x)
        return np.argmax(logits, axis=1)

    def train(self, x, y_class, weights, epochs, batch_size, lr, seed):
        rng = np.random.default_rng(seed)
        n = x.shape[0]
        class_count = int(y_class.max()) + 1
        one_hot = np.eye(class_count, dtype=np.float64)[y_class]
        weights = weights.astype(np.float64)
        weights = weights / max(1.0e-9, weights.mean())
        trace = []
        step = 0
        beta1 = 0.9
        beta2 = 0.999
        eps = 1.0e-8
        for epoch in range(1, epochs + 1):
            order = rng.permutation(n)
            loss_sum = 0.0
            for start in range(0, n, batch_size):
                idx = order[start:start + batch_size]
                xb = x[idx]
                yb = one_hot[idx]
                wb = weights[idx]
                logits, hidden = self.forward(xb)
                probs = softmax(logits)
                loss_sum += float((-np.log(np.maximum(1.0e-9, probs)) * yb * wb[:, None]).sum())
                grad_logits = (probs - yb) * (wb / max(1, len(idx)))[:, None]
                if self.hidden <= 0:
                    grads = [xb.T @ grad_logits, grad_logits.sum(axis=0)]
                else:
                    grad_w1 = hidden.T @ grad_logits
                    grad_b1 = grad_logits.sum(axis=0)
                    grad_hidden = grad_logits @ self.w1.T
                    grad_z = grad_hidden * (1.0 - hidden * hidden)
                    grads = [xb.T @ grad_z, grad_z.sum(axis=0), grad_w1, grad_b1]
                step += 1
                for i, (param, grad) in enumerate(zip(self.params_list, grads)):
                    self.m[i] = beta1 * self.m[i] + (1.0 - beta1) * grad
                    self.v[i] = beta2 * self.v[i] + (1.0 - beta2) * (grad * grad)
                    m_hat = self.m[i] / (1.0 - beta1 ** step)
                    v_hat = self.v[i] / (1.0 - beta2 ** step)
                    param -= lr * m_hat / (np.sqrt(v_hat) + eps)
            if epoch == 1 or epoch % 20 == 0 or epoch == epochs:
                trace.append({"epoch": epoch, "loss": loss_sum / max(1, n)})
        return trace


def select_predictions(candidates, classes):
    stacked = np.stack(candidates, axis=0)
    return stacked[classes, np.arange(classes.shape[0])]


def best_classes(candidates, y):
    stacked = np.stack(candidates, axis=0)
    err = np.linalg.norm(stacked - y[None, :, :], axis=2)
    return np.argmin(err, axis=0)


def central_metrics(module, name, pred, y, x, meta, estimated_macs=0, parameters=0, trace=None):
    result = module.evaluate_predictions(
        name,
        pred,
        y,
        x,
        meta,
        estimated_macs=estimated_macs,
        parameters=parameters,
        training_trace=trace or [],
        static_guard=False,
    )
    central = np.asarray([item.get("bucket", item["horizon"]) in CENTRAL_BUCKETS for item in meta], dtype=bool)
    if central.any():
        central_result = module.evaluate_predictions(
            name + "_central",
            pred[central],
            y[central],
            x[central],
            [item for item, keep in zip(meta, central) if keep],
            estimated_macs=estimated_macs,
            parameters=parameters,
            static_guard=False,
        )
        result["central"] = central_result["overall"]
    else:
        result["central"] = {}
    return result


def write_report(path, scores):
    ranked = sorted(scores["results"], key=lambda item: (item.get("central", {}).get("visualP95", math.inf), item["overall"]["visualP95"]))
    lines = [
        "# Step 06 Report - Candidate Gate",
        "",
        "## Summary",
        "",
        "Step 06 trains a small classifier to choose among hold, CV2, CV12, and the current SmoothPredictor instead of directly regressing a new displacement.",
        "",
        "| candidate | central visual p95 | central visual p99 | central lead p99 | central lag p99 | overall visual p95 | MACs |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in ranked:
        c = item.get("central", {})
        o = item["overall"]
        lines.append(
            f"| {item['candidate']} | {c.get('visualP95', 0.0):.6f} | {c.get('visualP99', 0.0):.6f} | "
            f"{c.get('leadP99', 0.0):.6f} | {c.get('lagP99', 0.0):.6f} | {o['visualP95']:.6f} | {item['estimatedMacs']} |"
        )
    lines += [
        "",
        "## Decision",
        "",
        "The gate must beat CV2 on central visual p95 without worsening p99/tail metrics enough to be visible. If it cannot approach the oracle, the remaining gain is unlikely to come from a simple candidate selector.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="ascii")


def main():
    args = parse_args()
    repo_root = Path(args.repo_root).resolve() if args.repo_root else repo_root_from_script()
    step01 = load_module(
        repo_root / "poc/cursor-prediction-v25-runtime-horizon-training/step-01-runtime-horizon-model-search/train_runtime_horizon_models.py",
        "v25_step01",
    )
    step04 = load_module(
        repo_root / "poc/cursor-prediction-v25-runtime-horizon-training/step-04-product-replay-baselines/replay_product_baselines.py",
        "v25_step04",
    )
    start = time.perf_counter()
    x, y, meta, preds, package_counts = step04.load_replay_dataset(step01, repo_root, args.rows_per_package)
    split = step01.split_arrays(x, y, meta)
    train_idx = split.get("train", np.array([], dtype=np.int64))
    test_idx = split.get("test", np.array([], dtype=np.int64))
    if len(train_idx) == 0 or len(test_idx) == 0:
        raise RuntimeError("train and test splits are required")

    smooth_model = step01.load_current_smooth_predictor(repo_root)
    smooth_all = smooth_model["predict"](x)
    hold_all = np.zeros_like(y)
    cv2_all = preds["feature_cv2"]
    cv12_all = x[:, [13, 14]] * 8.0
    all_candidates = []
    for candidate in [hold_all, cv2_all, cv12_all, smooth_all]:
        all_candidates.append(apply_static_guard(candidate, meta))

    train_meta = step01.select_meta(meta, train_idx)
    test_meta = step01.select_meta(meta, test_idx)
    train_candidates = [candidate[train_idx] for candidate in all_candidates]
    test_candidates = [candidate[test_idx] for candidate in all_candidates]
    train_y = y[train_idx]
    test_y = y[test_idx]
    train_x_raw = x[train_idx]
    test_x_raw = x[test_idx]
    (train_xn, test_xn), mean, std = step01.normalize(train_x_raw, train_x_raw, test_x_raw)

    y_class = best_classes(train_candidates, train_y)
    central = np.asarray([item.get("bucket", item["horizon"]) in CENTRAL_BUCKETS for item in train_meta], dtype=bool)
    accepted = np.asarray([item["accepted"] for item in train_meta], dtype=bool)
    static = np.asarray([item["static"] for item in train_meta], dtype=bool)
    class_counts = np.bincount(y_class, minlength=4).astype(np.float64)
    inverse_class = 1.0 / np.maximum(1.0, class_counts)
    inverse_class *= class_counts.mean()

    results = []
    names = ["hold", "cv2", "cv12", "current_smooth_predictor"]
    for name, pred in zip(names, test_candidates):
        results.append(central_metrics(step01, name, pred, test_y, test_x_raw, test_meta, estimated_macs=2))
    oracle_test_class = best_classes(test_candidates, test_y)
    oracle_pred = select_predictions(test_candidates, oracle_test_class)
    results.append(central_metrics(step01, "oracle_best_hold_cv2_cv12_smooth", oracle_pred, test_y, test_x_raw, test_meta, estimated_macs=0))

    rng = np.random.default_rng(args.seed)
    policies = {
        "uniform": np.ones_like(y_class, dtype=np.float64),
        "central4": np.where(central, 4.0, 1.0),
        "central8_accepted2": np.where(central, 8.0, 1.0) * np.where(accepted, 2.0, 1.0),
        "class_balanced_central4": inverse_class[y_class] * np.where(central, 4.0, 1.0) * np.where(static, 0.5, 1.0),
    }
    for policy_name, weights in policies.items():
        for hidden in [0, 16, 32]:
            model = GateModel(step01.FEATURE_COUNT, hidden, 4, rng)
            trace = model.train(train_xn, y_class, weights, args.epochs, args.batch_size, 0.003, args.seed + hidden + len(results))
            cls = model.predict_class(test_xn)
            pred = select_predictions(test_candidates, cls)
            results.append(
                central_metrics(
                    step01,
                    f"gate_{policy_name}_h{hidden}",
                    pred,
                    test_y,
                    test_x_raw,
                    test_meta,
                    estimated_macs=model.estimated_macs,
                    parameters=model.parameter_count,
                    trace=trace,
                )
            )

    scores = {
        "schemaVersion": "cursor-prediction-v25-step-06-candidate-gate/1",
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "rowsPerPackage": args.rows_per_package,
            "epochs": args.epochs,
            "batchSize": args.batch_size,
            "seed": args.seed,
            "classes": names,
            "classCounts": {names[i]: int(class_counts[i]) for i in range(len(names))},
            "centralBuckets": sorted(CENTRAL_BUCKETS),
            "runtime": "bundled Python + NumPy, CPU-only"
        },
        "dataset": {
            "rows": int(len(y)),
            "trainRows": int(len(train_y)),
            "testRows": int(len(test_y)),
            "packageCounts": package_counts
        },
        "results": results,
        "elapsedSeconds": time.perf_counter() - start
    }
    output_dir = Path(__file__).resolve().parent
    (output_dir / "scores.json").write_text(json.dumps(scores, indent=2), encoding="ascii")
    write_report(output_dir / "report.md", scores)
    best = sorted(results, key=lambda item: item.get("central", {}).get("visualP95", math.inf))[0]
    print(json.dumps({"bestCentral": best["candidate"], "centralVisualP95": best["central"]["visualP95"], "elapsedSeconds": scores["elapsedSeconds"]}, indent=2))


if __name__ == "__main__":
    main()

