import argparse
import csv
import importlib.util
import json
import math
import time
import zipfile
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
    return parser.parse_args()


def clamp(dx, dy, limit):
    mag = math.hypot(dx, dy)
    if mag > limit > 0.0:
        scale = limit / mag
        return dx * scale, dy * scale
    return dx, dy


def path_analysis(points, current, window_ms):
    cutoff = current["elapsed_ms"] - window_ms
    selected = [p for p in points if p["elapsed_ms"] >= cutoff] + [current]
    if len(selected) < 2:
        return {"count": len(selected), "path": 0.0, "net": 0.0, "efficiency": 0.0, "reversals": 0}
    path = 0.0
    reversals = 0
    last_dx = 0.0
    last_dy = 0.0
    for a, b in zip(selected, selected[1:]):
        dx = b["x"] - a["x"]
        dy = b["y"] - a["y"]
        path += math.hypot(dx, dy)
        if last_dx != 0.0 or last_dy != 0.0:
            if dx * last_dx + dy * last_dy < 0.0:
                reversals += 1
        last_dx = dx
        last_dy = dy
    net = math.hypot(selected[-1]["x"] - selected[0]["x"], selected[-1]["y"] - selected[0]["y"])
    efficiency = (net / path * 100.0) if path > 1.0e-9 else 0.0
    return {"count": len(selected), "path": path, "net": net, "efficiency": efficiency, "reversals": reversals}


def fit_velocity(points, current, window_ms):
    cutoff = current["elapsed_ms"] - window_ms
    selected = [p for p in points if p["elapsed_ms"] >= cutoff] + [current]
    if len(selected) < 4:
        return None
    t = np.asarray([(p["elapsed_ms"] - current["elapsed_ms"]) / 1000.0 for p in selected], dtype=np.float64)
    x = np.asarray([p["x"] for p in selected], dtype=np.float64)
    y = np.asarray([p["y"] for p in selected], dtype=np.float64)
    mt = t.mean()
    denom = float(np.sum((t - mt) * (t - mt)))
    if denom <= 1.0e-12:
        return None
    vx = float(np.sum((t - mt) * (x - x.mean())) / denom)
    vy = float(np.sum((t - mt) * (y - y.mean())) / denom)
    return vx, vy


def predict_cv(history, current, horizon_ms, cap_limit=None):
    if not history or horizon_ms <= 0.0:
        return 0.0, 0.0
    last = history[-1]
    delta_ms = current["elapsed_ms"] - last["elapsed_ms"]
    if delta_ms <= 0.0:
        return 0.0, 0.0
    scale = horizon_ms / delta_ms
    dx = (current["x"] - last["x"]) * scale
    dy = (current["y"] - last["y"]) * scale
    if cap_limit is not None:
        dx, dy = clamp(dx, dy, cap_limit)
    return dx, dy


def predict_least_squares(history, current, horizon_ms):
    if horizon_ms <= 0.0:
        return 0.0, 0.0, False
    fit_path = path_analysis(history, current, 72.0)
    if fit_path["count"] < 4 or fit_path["efficiency"] < 75.0:
        return 0.0, 0.0, False
    jitter_path = path_analysis(history, current, 300.0)
    if jitter_path["reversals"] >= 2 and jitter_path["path"] <= 380.0 and jitter_path["efficiency"] <= 55.0:
        return 0.0, 0.0, False
    velocity = fit_velocity(history, current, 72.0)
    if velocity is None:
        return 0.0, 0.0, False
    vx, vy = velocity
    speed = math.hypot(vx, vy)
    effective_horizon_ms = horizon_ms
    if speed < 450.0 or fit_path["net"] < 32.0:
        effective_horizon_ms = min(effective_horizon_ms, 2.0)
    dx = vx * effective_horizon_ms / 1000.0
    dy = vy * effective_horizon_ms / 1000.0
    max_prediction = min(48.0, fit_path["net"] * 0.8)
    if max_prediction <= 0.0:
        return 0.0, 0.0, False
    dx, dy = clamp(dx, dy, max_prediction)
    return dx, dy, True


def add_static_guard(pred, meta):
    out = pred.copy()
    static = np.asarray([item["static"] for item in meta], dtype=bool)
    out[static] = 0.0
    return out


def evaluate(module, name, pred, y, features, meta, estimated_macs=0):
    guarded = add_static_guard(pred, meta)
    result = module.evaluate_predictions(
        name,
        guarded,
        y,
        features,
        meta,
        estimated_macs=estimated_macs,
        parameters=0,
        static_guard=False,
    )
    central_mask = np.asarray([item.get("bucket", item["horizon"]) in CENTRAL_BUCKETS for item in meta], dtype=bool)
    if central_mask.any():
        central = module.evaluate_predictions(
            name + "_central",
            guarded[central_mask],
            y[central_mask],
            features[central_mask],
            [meta[i] for i, keep in enumerate(central_mask) if keep],
            estimated_macs=estimated_macs,
            parameters=0,
            static_guard=False,
        )
        result["central"] = central["overall"]
    else:
        result["central"] = {}
    return result


def load_package(module, repo_root, package, rows_per_package):
    zip_path = repo_root / package["path"].replace("/", "\\")
    labels = []
    features = []
    meta = []
    preds = {
        "feature_cv2": [],
        "product_cv_uncapped": [],
        "product_cv_cap12": [],
        "product_cv_cap24": [],
        "least_squares": [],
        "least_squares_or_cv2": [],
    }
    counts = {"runtimeRowsVisited": 0, "selectedRows": 0, "validLabels": 0, "leastSquaresValid": 0}
    with zipfile.ZipFile(zip_path, "r") as archive:
        trace, refs_elapsed, refs_xy = module.load_trace(archive)
        histories = {}
        with archive.open("motion-trace-alignment.csv") as raw:
            reader = csv.DictReader((line.decode("utf-8-sig") for line in raw))
            for row in reader:
                if row.get("traceEvent") != "runtimeSchedulerPoll":
                    continue
                counts["runtimeRowsVisited"] += 1
                scenario_elapsed = module.to_float(row.get("scenarioElapsedMilliseconds", ""))
                if scenario_elapsed < module.WARMUP_MS:
                    continue
                sequence = module.to_int(row.get("traceSequence", ""), -1)
                call = trace.get(sequence)
                if call is None:
                    continue
                scenario_index = module.to_int(row.get("scenarioIndex", ""), 0)
                scenario_key = f"{package['packageId']}#{scenario_index}"
                history = histories.setdefault(scenario_key, [])
                if counts["selectedRows"] < rows_per_package:
                    for spec in module.iter_horizon_specs(call, "product-offset"):
                        horizon_ms = spec["used_horizon_ms"]
                        target = module.interpolate(refs_elapsed, refs_xy, call["elapsed_us"] + horizon_ms * 1000.0)
                        if target is None:
                            continue
                        x_target, y_target = target
                        feature = module.build_features(call, history[-12:], horizon_ms)
                        label = [x_target - call["x"], y_target - call["y"]]
                        cv2 = np.asarray([feature[1] * 8.0, feature[2] * 8.0], dtype=np.float64)
                        cv_uncapped = np.asarray(predict_cv(history, call, horizon_ms, None), dtype=np.float64)
                        cv_cap12 = np.asarray(predict_cv(history, call, horizon_ms, 12.0), dtype=np.float64)
                        cv_cap24 = np.asarray(predict_cv(history, call, horizon_ms, 24.0), dtype=np.float64)
                        lsx, lsy, ls_valid = predict_least_squares(history, call, horizon_ms)
                        ls = np.asarray([lsx, lsy], dtype=np.float64)
                        if ls_valid:
                            counts["leastSquaresValid"] += 1
                        labels.append(label)
                        features.append(feature)
                        for name, pred in [
                            ("feature_cv2", cv2),
                            ("product_cv_uncapped", cv_uncapped),
                            ("product_cv_cap12", cv_cap12),
                            ("product_cv_cap24", cv_cap24),
                            ("least_squares", ls),
                            ("least_squares_or_cv2", ls if ls_valid else cv2),
                        ]:
                            preds[name].append(pred)
                        phase = row.get("movementPhase", "")
                        generated_velocity = module.to_float(row.get("velocityPixelsPerSecond", ""))
                        label_distance = module.point_distance(call["x"], call["y"], x_target, y_target)
                        slow_or_stop = phase == "hold" or generated_velocity < 150.0 or label_distance <= 0.75
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
                                "slowOrStop": slow_or_stop,
                                "static": (not spec["accepted"]) or ((phase == "hold" or generated_velocity < 1.0) and label_distance <= 0.75),
                                "leastSquaresValid": ls_valid,
                            }
                        )
                        counts["validLabels"] += 1
                    counts["selectedRows"] += 1
                history.append(call)
                if len(history) > 256:
                    del history[0]
                if counts["selectedRows"] >= rows_per_package:
                    break
    return features, labels, meta, preds, counts


def load_replay_dataset(module, repo_root, rows_per_package):
    manifest_path = repo_root / "poc/cursor-prediction-v21/step-02-balanced-evaluation/split-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    features = []
    labels = []
    meta = []
    all_preds = {}
    package_counts = {}
    for package in manifest["packages"]:
        fx, yy, mm, pp, counts = load_package(module, repo_root, package, rows_per_package)
        features.extend(fx)
        labels.extend(yy)
        meta.extend(mm)
        for name, values in pp.items():
            all_preds.setdefault(name, []).extend(values)
        package_counts[package["packageId"]] = counts
    return (
        np.vstack(features),
        np.asarray(labels, dtype=np.float64),
        meta,
        {name: np.asarray(values, dtype=np.float64) for name, values in all_preds.items()},
        package_counts,
    )


def write_report(path, scores):
    ranked = sorted(scores["results"], key=lambda item: (item["overall"]["visualP95"], item["overall"]["visualP99"]))
    central_ranked = sorted(scores["results"], key=lambda item: (item.get("central", {}).get("visualP95", math.inf), item.get("central", {}).get("visualP99", math.inf)))
    lines = [
        "# Step 04 Report - Product Replay Baselines",
        "",
        "## Summary",
        "",
        "This step replays deterministic product-shaped baselines with more faithful runtime history. It compares feature-derived CV2 against product-style CV caps and a product-inspired LeastSquares replay.",
        "",
        "## Best Overall",
        "",
        "| candidate | visual p95 | visual p99 | stop lead p99 | central visual p95 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for item in ranked:
        o = item["overall"]
        c = item.get("central", {})
        lines.append(f"| {item['candidate']} | {o['visualP95']:.6f} | {o['visualP99']:.6f} | {o['stopLeadP99']:.6f} | {c.get('visualP95', 0.0):.6f} |")
    lines += [
        "",
        "## Best Central",
        "",
        "| candidate | central visual p95 | central visual p99 | central stop lead p99 | overall visual p95 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for item in central_ranked:
        o = item["overall"]
        c = item.get("central", {})
        lines.append(f"| {item['candidate']} | {c.get('visualP95', 0.0):.6f} | {c.get('visualP99', 0.0):.6f} | {c.get('stopLeadP99', 0.0):.6f} | {o['visualP95']:.6f} |")
    lines += [
        "",
        "## Decision",
        "",
        "If LeastSquares replay does not improve central buckets, the current evidence favors CV2-like short-window prediction plus scheduler/timing work over a larger MLP.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="ascii")


def main():
    args = parse_args()
    repo_root = Path(args.repo_root).resolve() if args.repo_root else repo_root_from_script()
    module = load_step01_module(repo_root)
    start = time.perf_counter()
    x, y, meta, preds, package_counts = load_replay_dataset(module, repo_root, args.rows_per_package)
    split = module.split_arrays(x, y, meta)
    test_idx = split.get("test", np.array([], dtype=np.int64))
    if len(test_idx) == 0:
        raise RuntimeError("test split is required")
    test_meta = module.select_meta(meta, test_idx)
    results = []
    for name, pred in preds.items():
        results.append(evaluate(module, name + "_static_guard", pred[test_idx], y[test_idx], x[test_idx], test_meta, estimated_macs=12))
    scores = {
        "schemaVersion": "cursor-prediction-v25-step-04-product-replay-baselines/1",
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "rowsPerPackage": args.rows_per_package,
            "centralBuckets": sorted(CENTRAL_BUCKETS),
            "runtime": "bundled Python + NumPy, CPU-only"
        },
        "dataset": {
            "rows": int(len(y)),
            "testRows": int(len(test_idx)),
            "packageCounts": package_counts,
            "leastSquaresValidRows": int(sum(1 for item in meta if item.get("leastSquaresValid")))
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

