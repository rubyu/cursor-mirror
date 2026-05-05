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


def load_step01_module(repo_root):
    path = repo_root / "poc/cursor-prediction-v25-runtime-horizon-training/step-01-runtime-horizon-model-search/train_runtime_horizon_models.py"
    spec = importlib.util.spec_from_file_location("v25_step01", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=None)
    parser.add_argument("--rows-per-package", type=int, default=2400)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--seed", type=int, default=2506)
    return parser.parse_args()


class WeightedMLP:
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
        return h @ self.w1 + self.b1, h

    def predict(self, x):
        return self.forward(x)[0]

    def train(self, x, y, directions, weights, epochs, batch_size, lr, seed, loss_kind):
        rng = np.random.default_rng(seed)
        n = x.shape[0]
        trace = []
        step = 0
        beta1 = 0.9
        beta2 = 0.999
        eps = 1.0e-8
        weights = weights.astype(np.float64)
        weights = weights / max(1.0e-9, weights.mean())
        for epoch in range(1, epochs + 1):
            order = rng.permutation(n)
            epoch_loss = 0.0
            for start in range(0, n, batch_size):
                idx = order[start:start + batch_size]
                xb = x[idx]
                yb = y[idx]
                db = directions[idx]
                wb = weights[idx]
                pred, hidden = self.forward(xb)
                err = pred - yb
                grad_pred = (2.0 * wb / max(1, len(idx)))[:, None] * err
                row_loss = wb * np.sum(err * err, axis=1)
                if loss_kind.startswith("asym"):
                    lead_weight = float(loss_kind.replace("asym", ""))
                    projection = np.sum(err * db, axis=1)
                    lead_mask = projection > 0.0
                    row_loss += wb * np.where(lead_mask, lead_weight, 1.0) * projection * projection
                    grad_pred += (
                        2.0 * wb * np.where(lead_mask, lead_weight, 1.0) * projection / max(1, len(idx))
                    )[:, None] * db
                epoch_loss += float(row_loss.sum())
                grad_w1 = hidden.T @ grad_pred
                grad_b1 = grad_pred.sum(axis=0)
                grad_hidden = grad_pred @ self.w1.T
                grad_z = grad_hidden * (1.0 - hidden * hidden)
                grad_w0 = xb.T @ grad_z
                grad_b0 = grad_z.sum(axis=0)
                step += 1
                for i, (param, grad) in enumerate(zip(self.params(), [grad_w0, grad_b0, grad_w1, grad_b1])):
                    self.m[i] = beta1 * self.m[i] + (1.0 - beta1) * grad
                    self.v[i] = beta2 * self.v[i] + (1.0 - beta2) * (grad * grad)
                    m_hat = self.m[i] / (1.0 - beta1 ** step)
                    v_hat = self.v[i] / (1.0 - beta2 ** step)
                    param -= lr * m_hat / (np.sqrt(v_hat) + eps)
            if epoch == 1 or epoch % 20 == 0 or epoch == epochs:
                trace.append({"epoch": epoch, "loss": epoch_loss / max(1, n)})
        return trace


def central_overall(module, name, pred, y, x, meta, estimated_macs=0, parameters=0, trace=None, static_guard=True):
    result = module.evaluate_predictions(
        name,
        pred,
        y,
        x,
        meta,
        estimated_macs=estimated_macs,
        parameters=parameters,
        training_trace=trace or [],
        static_guard=static_guard,
    )
    central_mask = np.asarray([item.get("bucket", item["horizon"]) in CENTRAL_BUCKETS for item in meta], dtype=bool)
    if central_mask.any():
        central = module.evaluate_predictions(
            name + "_central",
            pred[central_mask],
            y[central_mask],
            x[central_mask],
            [meta[i] for i, keep in enumerate(central_mask) if keep],
            estimated_macs=estimated_macs,
            parameters=parameters,
            training_trace=[],
            static_guard=static_guard,
        )
        result["central"] = central["overall"]
    else:
        result["central"] = {}
    return result


def meta_masks(meta):
    central = np.asarray([item.get("bucket", item["horizon"]) in CENTRAL_BUCKETS for item in meta], dtype=bool)
    accepted = np.asarray([item["accepted"] for item in meta], dtype=bool)
    static = np.asarray([item["static"] for item in meta], dtype=bool)
    slow = np.asarray([item["slowOrStop"] for item in meta], dtype=bool)
    return central, accepted, static, slow


def write_report(path, scores):
    ranked = sorted(
        scores["results"],
        key=lambda item: (
            item.get("central", {}).get("visualP95", math.inf),
            item.get("central", {}).get("stopLeadP99", math.inf),
            item["overall"]["visualP95"],
        ),
    )
    lines = [
        "# Step 03 Report - Central-Weighted MLP",
        "",
        "## Summary",
        "",
        "Step 03 tests whether the MLP failed because the training distribution was dominated by outer hold-like target-correction buckets. It trains residual CV2 models with central/accepted/moving weighting.",
        "",
        "| candidate | central visual p95 | central visual p99 | central stop lead p99 | overall visual p95 | jitter p95 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in ranked:
        c = item.get("central", {})
        o = item["overall"]
        lines.append(
            f"| {item['candidate']} | {c.get('visualP95', 0.0):.6f} | {c.get('visualP99', 0.0):.6f} | "
            f"{c.get('stopLeadP99', 0.0):.6f} | {o['visualP95']:.6f} | {o['stationaryJitterP95']:.6f} |"
        )
    lines += [
        "",
        "## Decision",
        "",
        "If a central-weighted learned residual cannot beat `cv2_static_guard` on central visual p95, the next direction should be product-faithful timing/least-squares replay or sequence-level labels, not a larger feed-forward MLP alone.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="ascii")


def main():
    args = parse_args()
    repo_root = Path(args.repo_root).resolve() if args.repo_root else repo_root_from_script()
    module = load_step01_module(repo_root)
    start = time.perf_counter()
    x, y, meta, package_counts = module.load_dataset(repo_root, args.rows_per_package, "product-offset")
    split = module.split_arrays(x, y, meta)
    train_idx = split.get("train", np.array([], dtype=np.int64))
    test_idx = split.get("test", np.array([], dtype=np.int64))
    if len(train_idx) == 0 or len(test_idx) == 0:
        raise RuntimeError("train and test splits are required")

    train_meta = module.select_meta(meta, train_idx)
    test_meta = module.select_meta(meta, test_idx)
    (train_xn, test_xn), mean, std = module.normalize(x[train_idx], x[train_idx], x[test_idx])
    train_y = y[train_idx]
    test_y = y[test_idx]
    train_x_raw = x[train_idx]
    test_x_raw = x[test_idx]
    cv2_train = train_x_raw[:, [1, 2]] * 8.0
    cv2_test = test_x_raw[:, [1, 2]] * 8.0
    residual_y = train_y - cv2_train
    directions = module.directions_for(train_y, train_x_raw)
    central_train, accepted_train, static_train, slow_train = meta_masks(train_meta)

    results = [
        central_overall(module, "cv2_static_guard", cv2_test, test_y, test_x_raw, test_meta, estimated_macs=2, static_guard=True)
    ]
    rng = np.random.default_rng(args.seed)
    policies = {
        "accepted_moving": np.where(accepted_train & ~static_train, 1.0, 0.0),
        "central_accepted_moving": np.where(central_train & accepted_train & ~static_train, 1.0, 0.0),
        "central_weight4_accepted_moving": np.where(accepted_train & ~static_train, np.where(central_train, 4.0, 1.0), 0.0),
        "central_weight8_stop_weight4": np.where(
            accepted_train & ~static_train,
            np.where(central_train, 8.0, 1.0) * np.where(slow_train, 4.0, 1.0),
            0.0,
        ),
    }
    for policy_name, weights in policies.items():
        usable = weights > 0.0
        if usable.sum() < 1000:
            continue
        for hidden, loss in [(16, "mse"), (32, "mse"), (32, "asym4"), (64, "mse"), (64, "asym4")]:
            model = WeightedMLP(module.FEATURE_COUNT, hidden, rng)
            trace = model.train(
                train_xn[usable],
                residual_y[usable],
                directions[usable],
                weights[usable],
                args.epochs,
                args.batch_size,
                0.003,
                args.seed + hidden + len(results),
                loss,
            )
            pred = cv2_test + model.predict(test_xn)
            results.append(
                central_overall(
                    module,
                    f"residual_cv2_{policy_name}_h{hidden}_{loss}_static_guard",
                    pred,
                    test_y,
                    test_x_raw,
                    test_meta,
                    estimated_macs=model.estimated_macs + 2,
                    parameters=model.parameter_count,
                    trace=trace,
                    static_guard=True,
                )
            )

    scores = {
        "schemaVersion": "cursor-prediction-v25-step-03-central-weighted-mlp/1",
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "rowsPerPackage": args.rows_per_package,
            "epochs": args.epochs,
            "batchSize": args.batch_size,
            "seed": args.seed,
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
    print(json.dumps({"rows": int(len(y)), "bestCentral": best["candidate"], "centralVisualP95": best["central"]["visualP95"], "elapsedSeconds": scores["elapsedSeconds"]}, indent=2))


if __name__ == "__main__":
    main()

