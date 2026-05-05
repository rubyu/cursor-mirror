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
    return parser.parse_args()


def percentile(values, p):
    if len(values) == 0:
        return 0.0
    return float(np.percentile(values, p, method="higher"))


def apply_static_guard(pred, meta):
    out = pred.copy()
    static = np.asarray([item["static"] for item in meta], dtype=bool)
    out[static] = 0.0
    return out


def metrics_for(pred, y, x, meta):
    err = pred - y
    visual = np.linalg.norm(err, axis=1)
    dirs = np.zeros_like(y)
    mag = np.linalg.norm(y, axis=1)
    valid = mag > 1.0e-9
    dirs[valid] = y[valid] / mag[valid, None]
    dirs[~valid, 0] = x[~valid, 23]
    dirs[~valid, 1] = x[~valid, 24]
    signed = np.sum(err * dirs, axis=1)
    lead = np.maximum(0.0, signed)
    lag = np.maximum(0.0, -signed)
    return {
        "rows": int(len(y)),
        "visualMean": float(visual.mean()) if len(visual) else 0.0,
        "visualP95": percentile(visual, 95),
        "visualP99": percentile(visual, 99),
        "leadP95": percentile(lead, 95),
        "leadP99": percentile(lead, 99),
        "lagP95": percentile(lag, 95),
        "lagP99": percentile(lag, 99),
        "labelDistanceP95": percentile(np.linalg.norm(y, axis=1), 95),
        "labelDistanceP99": percentile(np.linalg.norm(y, axis=1), 99),
        "horizonP50": percentile(np.asarray([item["horizon"] for item in meta], dtype=np.float64), 50),
        "horizonP95": percentile(np.asarray([item["horizon"] for item in meta], dtype=np.float64), 95),
        "speed2P50": percentile(x[:, 3] * 2000.0, 50),
        "speed2P95": percentile(x[:, 3] * 2000.0, 95),
        "recentHighP95": percentile(x[:, 16] * 3000.0, 95),
    }


def grouped_metrics(pred, y, x, meta):
    result = {}
    buckets = sorted({item.get("bucket", item["horizon"]) for item in meta})
    for bucket in buckets:
        mask = np.asarray([item.get("bucket", item["horizon"]) == bucket for item in meta], dtype=bool)
        result[str(bucket)] = metrics_for(pred[mask], y[mask], x[mask], [item for item, keep in zip(meta, mask) if keep])
    return result


def oracle_best(predictions, y):
    stacked = np.stack(predictions, axis=0)
    err = np.linalg.norm(stacked - y[None, :, :], axis=2)
    best = np.argmin(err, axis=0)
    return stacked[best, np.arange(y.shape[0])]


def write_report(path, scores):
    lines = [
        "# Step 05 Report - Central Residual Analysis",
        "",
        "## Summary",
        "",
        "This step asks what remains in the hard central target-correction buckets after the best simple predictor (`cv2`) is used.",
        "",
        "## Candidate Metrics",
        "",
        "| candidate | central visual p95 | central visual p99 | central lead p99 | central lag p99 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for name, item in scores["centralCandidates"].items():
        lines.append(
            f"| {name} | {item['visualP95']:.6f} | {item['visualP99']:.6f} | {item['leadP99']:.6f} | {item['lagP99']:.6f} |"
        )
    lines += [
        "",
        "## CV2 By Bucket",
        "",
        "| bucket | rows | visual p95 | visual p99 | lead p99 | lag p99 | label p95 | speed2 p95 |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for bucket, item in scores["cv2ByBucket"].items():
        if float(bucket) in CENTRAL_BUCKETS:
            lines.append(
                f"| {bucket} | {item['rows']} | {item['visualP95']:.6f} | {item['visualP99']:.6f} | "
                f"{item['leadP99']:.6f} | {item['lagP99']:.6f} | {item['labelDistanceP95']:.6f} | {item['speed2P95']:.1f} |"
            )
    lines += [
        "",
        "## Interpretation",
        "",
        "If the oracle combination is much better than CV2, a deterministic gate may still help. If the oracle is not much better, the remaining error is likely tied to sample timing, label timing, or information that is not present in the short history features.",
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
    test_idx = split.get("test", np.array([], dtype=np.int64))
    if len(test_idx) == 0:
        raise RuntimeError("test split is required")
    x = x[test_idx]
    y = y[test_idx]
    meta = step01.select_meta(meta, test_idx)
    cv2 = apply_static_guard(preds["feature_cv2"][test_idx], meta)
    cv12 = apply_static_guard(x[:, [13, 14]] * 8.0, meta)
    smooth_model = step01.load_current_smooth_predictor(repo_root)
    smooth = apply_static_guard(smooth_model["predict"](x), meta)
    hold = np.zeros_like(y)
    oracle = oracle_best([hold, cv2, cv12, smooth], y)
    central_mask = np.asarray([item.get("bucket", item["horizon"]) in CENTRAL_BUCKETS for item in meta], dtype=bool)
    central_meta = [item for item, keep in zip(meta, central_mask) if keep]
    candidates = {
        "hold": hold,
        "cv2": cv2,
        "cv12": cv12,
        "current_smooth_predictor": smooth,
        "oracle_best_hold_cv2_cv12_smooth": oracle,
    }
    central_candidates = {
        name: metrics_for(pred[central_mask], y[central_mask], x[central_mask], central_meta)
        for name, pred in candidates.items()
    }
    scores = {
        "schemaVersion": "cursor-prediction-v25-step-05-central-residual-analysis/1",
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "rowsPerPackage": args.rows_per_package,
            "centralBuckets": sorted(CENTRAL_BUCKETS),
            "runtime": "bundled Python + NumPy, CPU-only"
        },
        "dataset": {
            "testRows": int(len(y)),
            "centralRows": int(central_mask.sum()),
            "packageCounts": package_counts
        },
        "centralCandidates": central_candidates,
        "cv2ByBucket": grouped_metrics(cv2, y, x, meta),
        "elapsedSeconds": time.perf_counter() - start
    }
    output_dir = Path(__file__).resolve().parent
    (output_dir / "scores.json").write_text(json.dumps(scores, indent=2), encoding="ascii")
    write_report(output_dir / "report.md", scores)
    print(json.dumps({"centralRows": int(central_mask.sum()), "cv2CentralP95": central_candidates["cv2"]["visualP95"], "oracleCentralP95": central_candidates["oracle_best_hold_cv2_cv12_smooth"]["visualP95"], "elapsedSeconds": scores["elapsedSeconds"]}, indent=2))


if __name__ == "__main__":
    main()

