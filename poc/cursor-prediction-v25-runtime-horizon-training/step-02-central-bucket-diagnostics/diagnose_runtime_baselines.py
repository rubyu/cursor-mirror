import argparse
import importlib.util
import json
import math
import time
from pathlib import Path

import numpy as np


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
    return parser.parse_args()


def clamp_vectors(pred, limit):
    out = pred.copy()
    mag = np.linalg.norm(out, axis=1)
    mask = mag > limit
    if mask.any():
        out[mask] *= (limit / mag[mask])[:, None]
    return out


def apply_static_guard(pred, meta):
    out = pred.copy()
    mask = np.asarray([item["static"] for item in meta], dtype=bool)
    out[mask] = 0.0
    return out


def add_result(module, results, name, pred, y, x, meta, estimated_macs=0, parameters=0, static_guard=False):
    result = module.evaluate_predictions(
        name,
        pred,
        y,
        x,
        meta,
        estimated_macs=estimated_macs,
        parameters=parameters,
        static_guard=static_guard,
    )
    central_mask = np.asarray([item.get("bucket", item["horizon"]) in {-8.0, -4.0, 0.0, 4.0, 8.0} for item in meta], dtype=bool)
    if central_mask.any():
        central = module.evaluate_predictions(
            name + "_central",
            pred[central_mask],
            y[central_mask],
            x[central_mask],
            [meta[i] for i, keep in enumerate(central_mask) if keep],
            estimated_macs=estimated_macs,
            parameters=parameters,
            static_guard=static_guard,
        )
        result["central"] = central["overall"]
    else:
        result["central"] = {}
    results.append(result)


def write_report(path, scores):
    ranked = sorted(
        scores["results"],
        key=lambda item: (
            item["overall"]["visualP95"],
            item["overall"]["stopLeadP99"],
            item["overall"]["stationaryJitterP95"],
            item["overall"]["visualP99"],
        ),
    )
    central_ranked = sorted(
        scores["results"],
        key=lambda item: (
            item.get("central", {}).get("visualP95", math.inf),
            item.get("central", {}).get("stopLeadP99", math.inf),
            item.get("central", {}).get("visualP99", math.inf),
        ),
    )
    lines = [
        "# Step 02 Report - Central Bucket Diagnostics",
        "",
        "## Summary",
        "",
        "Step 01 showed that the hard region is the central target-correction bucket range around `-8..+8ms`. This diagnostic searches simple deployable combinations of the two constant-velocity windows before spending more time on larger learned models.",
        "",
        "## Best Overall",
        "",
        "| candidate | visual p95 | visual p99 | stop lead p99 | jitter p95 | central visual p95 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in ranked[:12]:
        o = item["overall"]
        c = item.get("central", {})
        lines.append(
            f"| {item['candidate']} | {o['visualP95']:.6f} | {o['visualP99']:.6f} | "
            f"{o['stopLeadP99']:.6f} | {o['stationaryJitterP95']:.6f} | {c.get('visualP95', 0.0):.6f} |"
        )
    lines += [
        "",
        "## Best Central Bucket",
        "",
        "| candidate | central visual p95 | central visual p99 | central stop lead p99 | overall visual p95 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for item in central_ranked[:12]:
        o = item["overall"]
        c = item.get("central", {})
        lines.append(
            f"| {item['candidate']} | {c.get('visualP95', 0.0):.6f} | {c.get('visualP99', 0.0):.6f} | "
            f"{c.get('stopLeadP99', 0.0):.6f} | {o['visualP95']:.6f} |"
        )
    lines += [
        "",
        "## Decision",
        "",
        "If simple CV-window composition improves the central buckets, the product path should favor an explicit deterministic predictor before adding a larger MLP. If it does not, the next learned-model run needs central-bucket weighting and a sequence-level stop/overshoot loss.",
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
    test_idx = split.get("test", np.array([], dtype=np.int64))
    if len(test_idx) == 0:
        raise RuntimeError("test split is required")

    test_x = x[test_idx]
    test_y = y[test_idx]
    test_meta = module.select_meta(meta, test_idx)
    cv2 = test_x[:, [1, 2]] * 8.0
    cv12 = test_x[:, [13, 14]] * 8.0
    speed2 = test_x[:, 3] * 2000.0
    speed12 = test_x[:, 15] * 2000.0
    recent_high = test_x[:, 16] * 3000.0
    horizon = test_x[:, 0] * 16.67

    results = []
    add_result(module, results, "cv2_static_guard", cv2, test_y, test_x, test_meta, estimated_macs=2, static_guard=True)
    add_result(module, results, "cv12_static_guard", cv12, test_y, test_x, test_meta, estimated_macs=2, static_guard=True)

    for alpha in np.linspace(0.0, 1.0, 21):
        pred = alpha * cv2 + (1.0 - alpha) * cv12
        add_result(module, results, f"blend_cv2_{alpha:.2f}_cv12_{1.0-alpha:.2f}_static_guard", pred, test_y, test_x, test_meta, estimated_macs=5, static_guard=True)

    cv2_mag = np.linalg.norm(cv2, axis=1)
    cv12_mag = np.linalg.norm(cv12, axis=1)
    min_norm = np.where((cv2_mag <= cv12_mag)[:, None], cv2, cv12)
    max_norm = np.where((cv2_mag > cv12_mag)[:, None], cv2, cv12)
    add_result(module, results, "choose_min_norm_static_guard", min_norm, test_y, test_x, test_meta, estimated_macs=8, static_guard=True)
    add_result(module, results, "choose_max_norm_static_guard", max_norm, test_y, test_x, test_meta, estimated_macs=8, static_guard=True)

    for limit in [4.0, 8.0, 12.0, 16.0, 24.0, 48.0]:
        add_result(module, results, f"cv2_cap{limit:g}_static_guard", clamp_vectors(cv2, limit), test_y, test_x, test_meta, estimated_macs=8, static_guard=True)
        add_result(module, results, f"cv12_cap{limit:g}_static_guard", clamp_vectors(cv12, limit), test_y, test_x, test_meta, estimated_macs=8, static_guard=True)

    for speed_threshold in [250.0, 500.0, 1000.0, 1500.0, 2000.0, 3000.0]:
        mask = (speed2 >= speed_threshold) | (recent_high >= speed_threshold)
        pred = np.where(mask[:, None], cv2, cv12)
        add_result(module, results, f"switch_highspeed_cv2_threshold{speed_threshold:g}_static_guard", pred, test_y, test_x, test_meta, estimated_macs=10, static_guard=True)

    for horizon_threshold in [4.0, 6.0, 8.0, 10.0]:
        mask = horizon >= horizon_threshold
        pred = np.where(mask[:, None], cv2, cv12)
        add_result(module, results, f"switch_horizon_ge{horizon_threshold:g}_cv2_static_guard", pred, test_y, test_x, test_meta, estimated_macs=10, static_guard=True)

    for speed_threshold in [250.0, 500.0, 1000.0, 1500.0]:
        for horizon_threshold in [6.0, 8.0, 10.0]:
            mask = ((speed12 >= speed_threshold) | (recent_high >= speed_threshold)) & (horizon >= horizon_threshold)
            pred = np.where(mask[:, None], cv2, cv12)
            add_result(
                module,
                results,
                f"switch_speed{speed_threshold:g}_horizon{horizon_threshold:g}_cv2_static_guard",
                pred,
                test_y,
                test_x,
                test_meta,
                estimated_macs=12,
                static_guard=True,
            )

    scores = {
        "schemaVersion": "cursor-prediction-v25-step-02-central-bucket-diagnostics/1",
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "rowsPerPackage": args.rows_per_package,
            "targetBuckets": [float(v) for v in module.DISPLAY_OFFSET_MS],
            "centralBuckets": [-8.0, -4.0, 0.0, 4.0, 8.0],
            "runtime": "bundled Python + NumPy, CPU-only"
        },
        "dataset": {
            "rows": int(len(y)),
            "testRows": int(len(test_y)),
            "packageCounts": package_counts
        },
        "results": results,
        "elapsedSeconds": time.perf_counter() - start
    }
    output_dir = Path(__file__).resolve().parent
    (output_dir / "scores.json").write_text(json.dumps(scores, indent=2), encoding="ascii")
    write_report(output_dir / "report.md", scores)
    best = sorted(results, key=lambda item: item["overall"]["visualP95"])[0]
    print(json.dumps({"rows": int(len(y)), "best": best["candidate"], "visualP95": best["overall"]["visualP95"], "elapsedSeconds": scores["elapsedSeconds"]}, indent=2))


if __name__ == "__main__":
    main()

