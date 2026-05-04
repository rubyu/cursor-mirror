#!/usr/bin/env python
"""POC 13 GPU deep-learning capacity probe for Cursor Mirror.

This script reads the source Motion Lab ZIP files directly, applies the POC 12
clean split manifest, builds an in-memory runtimeSchedulerPoll/v9-target
dataset, trains several high-capacity sequence models on CUDA, and writes only
compact Markdown/JSON summaries. It intentionally does not write checkpoints,
feature caches, expanded CSVs, TensorBoard logs, or torch.save artifacts.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import sys
import time
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, TensorDataset


SCHEMA_VERSION = "cursor-prediction-v13-deep-learning-gpu/1"
MOTION_LAB_EXTRA_INFO = 1129139532
TARGET_EVENT = "runtimeSchedulerPoll"
MAX_LABEL_BRACKET_GAP_US = 60_000
HISTORY = 16
DEVICE_MINIBATCH = 4096
DEFAULT_EPOCHS = 90
DEFAULT_PATIENCE = 14
SEED = 13013

SPEED_BINS = (
    ("0-25", 0, 25),
    ("25-100", 25, 100),
    ("100-250", 100, 250),
    ("250-500", 250, 500),
    ("500-1000", 500, 1000),
    ("1000-2000", 1000, 2000),
    (">=2000", 2000, math.inf),
)


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    poc_dir = script_dir.parent
    root = poc_dir.parent.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=root)
    parser.add_argument("--out-dir", type=Path, default=poc_dir)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json",
    )
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--patience", type=int, default=DEFAULT_PATIENCE)
    parser.add_argument("--batch-size", type=int, default=DEVICE_MINIBATCH)
    parser.add_argument("--max-seconds", type=float, default=1800.0)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


def finite_float(value: Any, fallback: float | None = None) -> float | None:
    if value is None or value == "":
        return fallback
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def finite_int(value: Any, fallback: int | None = None) -> int | None:
    result = finite_float(value, None)
    return int(result) if result is not None else fallback


def bool_value(value: Any) -> bool:
    return value is True or value == "true" or value == "True"


def magnitude(x: float, y: float) -> float:
    return math.sqrt(x * x + y * y)


def percentile(sorted_values: list[float], p: float) -> float | None:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    rank = (len(sorted_values) - 1) * p
    lo = math.floor(rank)
    hi = math.ceil(rank)
    if lo == hi:
        return float(sorted_values[lo])
    return float(sorted_values[lo] * (hi - rank) + sorted_values[hi] * (rank - lo))


def stats(values: np.ndarray | list[float]) -> dict[str, Any]:
    data = [float(v) for v in values if math.isfinite(float(v))]
    data.sort()
    if not data:
        return {
            "count": 0,
            "mean": None,
            "rmse": None,
            "median": None,
            "p95": None,
            "p99": None,
            "max": None,
            "gt5Rate": None,
            "gt10Rate": None,
        }
    arr = np.asarray(data, dtype=np.float64)
    return {
        "count": int(arr.size),
        "mean": round(float(arr.mean()), 4),
        "rmse": round(float(math.sqrt(float(np.mean(arr * arr)))), 4),
        "median": round(percentile(data, 0.50), 4),
        "p95": round(percentile(data, 0.95), 4),
        "p99": round(percentile(data, 0.99), 4),
        "max": round(float(data[-1]), 4),
        "gt5Rate": round(float(np.mean(arr > 5.0)), 6),
        "gt10Rate": round(float(np.mean(arr > 10.0)), 6),
    }


def signed_stats(values: np.ndarray | list[float]) -> dict[str, Any]:
    data = [float(v) for v in values if math.isfinite(float(v))]
    if not data:
        return {"count": 0, "mean": None, "lagRate": None, "leadRate": None}
    arr = np.asarray(data, dtype=np.float64)
    return {
        "count": int(arr.size),
        "mean": round(float(arr.mean()), 4),
        "lagRate": round(float(np.mean(arr < 0)), 6),
        "leadRate": round(float(np.mean(arr > 0)), 6),
    }


def scenario_from_elapsed_ms(elapsed_ms: float, scenario_duration_ms: float, scenario_count: int) -> int | None:
    if not math.isfinite(elapsed_ms):
        return None
    raw = math.floor(elapsed_ms / max(1.0, scenario_duration_ms))
    return max(0, min(max(0, scenario_count - 1), raw))


def in_intervals(elapsed_ms: float, intervals: list[dict[str, Any]]) -> bool:
    if not math.isfinite(elapsed_ms):
        return False
    for interval in intervals or []:
        if elapsed_ms >= float(interval["startMs"]) and elapsed_ms <= float(interval["endMs"]):
            return True
    return False


def lower_bound(values: list[float], target: float) -> int:
    lo = 0
    hi = len(values)
    while lo < hi:
        mid = (lo + hi) >> 1
        if values[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lo


def split_name(split_map: dict[int, str], scenario_index: int | None) -> str:
    if scenario_index is None:
        return "unassigned"
    return split_map.get(scenario_index, "unassigned")


def clean_time(pkg: dict[str, Any], elapsed_ms: float, scenario_index: int | None) -> bool:
    if scenario_index is None or not math.isfinite(elapsed_ms):
        return False
    if elapsed_ms <= pkg["warmupMs"]:
        return False
    rule = pkg["rule"]
    if scenario_index in set(rule.get("dropScenarios", [])):
        return False
    if in_intervals(elapsed_ms, rule.get("contaminationWindows", [])):
        return False
    return True


def advance_to_future_vblank(base_ticks: float | None, period_ticks: float | None, sample_ticks: float | None) -> float | None:
    if base_ticks is None or period_ticks is None or sample_ticks is None:
        return None
    if period_ticks <= 0:
        return None
    target = base_ticks
    if target <= sample_ticks:
        target += (math.floor((sample_ticks - target) / period_ticks) + 1) * period_ticks
    return target


def resolve_target(anchor: dict[str, Any]) -> dict[str, float] | None:
    target = anchor.get("predictionTargetTicks")
    if target is None:
        target = anchor.get("presentReferenceTicks")
    if target is None:
        target = anchor.get("dwmVBlankTicks")
    ticks = advance_to_future_vblank(target, anchor.get("dwmRefreshPeriodTicks"), anchor.get("stopwatchTicks"))
    if ticks is None:
        return None
    horizon_us = (ticks - anchor["stopwatchTicks"]) / anchor["stopwatchFrequency"] * 1_000_000.0
    if not math.isfinite(horizon_us) or horizon_us <= 0:
        return None
    return {"ticks": ticks, "horizonUs": horizon_us, "horizonMs": horizon_us / 1000.0, "labelUs": anchor["elapsedUs"] + horizon_us}


def package_clean_at_us(pkg: dict[str, Any], elapsed_us: float) -> bool:
    elapsed_ms = elapsed_us / 1000.0
    scenario_index = scenario_from_elapsed_ms(elapsed_ms, pkg["scenarioDurationMs"], pkg["scenarioCount"])
    return clean_time(pkg, elapsed_ms, scenario_index)


def interpolate_reference(pkg: dict[str, Any], target_us: float) -> dict[str, float] | None:
    if not package_clean_at_us(pkg, target_us):
        return None
    times = pkg["refTimesUs"]
    index = lower_bound(times, target_us)
    if index <= 0 or index >= len(times):
        return None
    left_time = times[index - 1]
    right_time = times[index]
    if right_time - left_time > MAX_LABEL_BRACKET_GAP_US:
        return None
    alpha = (target_us - left_time) / max(1.0, right_time - left_time)
    left_x = pkg["refX"][index - 1]
    right_x = pkg["refX"][index]
    left_y = pkg["refY"][index - 1]
    right_y = pkg["refY"][index]
    x = left_x + (right_x - left_x) * alpha
    y = left_y + (right_y - left_y) * alpha
    dt = (right_time - left_time) / 1_000_000.0
    vx = (right_x - left_x) / dt if dt > 0 else 0.0
    vy = (right_y - left_y) / dt if dt > 0 else 0.0
    return {"x": x, "y": y, "vx": vx, "vy": vy, "speed": magnitude(vx, vy)}


def nearest_motion(pkg: dict[str, Any], elapsed_ms: float) -> dict[str, Any]:
    times = pkg["motionTimesMs"]
    index = lower_bound(times, elapsed_ms)
    candidates = []
    if index > 0:
        candidates.append(index - 1)
    if index < len(times):
        candidates.append(index)
    best = None
    for candidate in candidates:
        distance = abs(times[candidate] - elapsed_ms)
        if best is None or distance < best["distance"]:
            best = {"index": candidate, "distance": distance}
    if best is None or best["distance"] > 20:
        return {"phase": "unknown", "speed": math.nan}
    return {"phase": pkg["motionPhase"][best["index"]], "speed": pkg["motionSpeed"][best["index"]]}


def speed_bin(speed: float) -> str:
    if not math.isfinite(speed):
        return "missing"
    for name, low, high in SPEED_BINS:
        if speed >= low and speed < high:
            return name
    return "missing"


def velocity_n(pkg: dict[str, Any], idx: int, n: int) -> dict[str, float | bool]:
    if n == 2:
        dt = (pkg["refTimesUs"][idx] - pkg["refTimesUs"][idx - 1]) / 1_000_000.0
        if dt <= 0:
            return {"vx": 0.0, "vy": 0.0, "speed": 0.0, "valid": False}
        vx = (pkg["refX"][idx] - pkg["refX"][idx - 1]) / dt
        vy = (pkg["refY"][idx] - pkg["refY"][idx - 1]) / dt
        return {"vx": vx, "vy": vy, "speed": magnitude(vx, vy), "valid": True}
    if idx + 1 < n:
        return {"vx": 0.0, "vy": 0.0, "speed": 0.0, "valid": False}
    first = idx - n + 1
    base_us = pkg["refTimesUs"][idx]
    ts = [((pkg["refTimesUs"][i] - base_us) / 1_000_000.0) for i in range(first, idx + 1)]
    xs = [pkg["refX"][i] for i in range(first, idx + 1)]
    ys = [pkg["refY"][i] for i in range(first, idx + 1)]
    mean_t = sum(ts) / n
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    denom = 0.0
    num_x = 0.0
    num_y = 0.0
    for t, x, y in zip(ts, xs, ys):
        centered_t = t - mean_t
        denom += centered_t * centered_t
        num_x += centered_t * (x - mean_x)
        num_y += centered_t * (y - mean_y)
    if denom <= 0:
        return {"vx": 0.0, "vy": 0.0, "speed": 0.0, "valid": False}
    vx = num_x / denom
    vy = num_y / denom
    return {"vx": vx, "vy": vy, "speed": magnitude(vx, vy), "valid": True}


def analyze_path(pkg: dict[str, Any], idx: int, n: int) -> dict[str, float]:
    first = max(0, idx - n + 1)
    path = 0.0
    reversals = 0
    previous_sign_x = 0
    previous_sign_y = 0
    for i in range(first + 1, idx + 1):
        dx = pkg["refX"][i] - pkg["refX"][i - 1]
        dy = pkg["refY"][i] - pkg["refY"][i - 1]
        path += magnitude(dx, dy)
        sx = 1 if dx > 0.5 else -1 if dx < -0.5 else 0
        sy = 1 if dy > 0.5 else -1 if dy < -0.5 else 0
        if sx != 0 and previous_sign_x != 0 and sx != previous_sign_x:
            reversals += 1
        if sy != 0 and previous_sign_y != 0 and sy != previous_sign_y:
            reversals += 1
        if sx != 0:
            previous_sign_x = sx
        if sy != 0:
            previous_sign_y = sy
    net = magnitude(pkg["refX"][idx] - pkg["refX"][first], pkg["refY"][idx] - pkg["refY"][first])
    return {"path": path, "net": net, "efficiency": net / path if path > 0 else 0.0, "reversals": float(reversals)}


def clamp_vector(dx: float, dy: float, cap_px: float | None) -> tuple[float, float]:
    if cap_px is None or cap_px <= 0:
        return dx, dy
    mag = magnitude(dx, dy)
    if mag <= cap_px or mag <= 0:
        return dx, dy
    scale = cap_px / mag
    return dx * scale, dy * scale


def predict_ls(row: dict[str, Any], n: int, gain: float, cap_px: float | None, offset_ms: float) -> tuple[float, float]:
    velocity = row["velocities"].get(n) or row["velocities"][2]
    if not velocity["valid"]:
        return 0.0, 0.0
    horizon_ms = row["horizonMs"] + offset_ms
    if horizon_ms <= 0:
        return 0.0, 0.0
    dx = float(velocity["vx"]) * (horizon_ms / 1000.0) * gain
    dy = float(velocity["vy"]) * (horizon_ms / 1000.0) * gain
    return clamp_vector(dx, dy, cap_px)


def predict_step5_gate(row: dict[str, Any]) -> tuple[float, float]:
    speed = float(row["velocities"][12]["speed"])
    path = row["path"]
    if speed <= 25 or path["net"] <= 0 or path["efficiency"] < 0.35 or row["historyGapMs"] > 40:
        return 0.0, 0.0
    return predict_ls(row, 12, 1.0, 12.0, -2.0)


@dataclass
class DatasetBundle:
    scalar: np.ndarray
    seq: np.ndarray
    target: np.ndarray
    baseline: np.ndarray
    correction: np.ndarray
    row_meta: list[dict[str, Any]]
    scalar_mean: np.ndarray
    scalar_std: np.ndarray
    seq_mean: np.ndarray
    seq_std: np.ndarray
    target_scale: np.ndarray
    correction_scale: np.ndarray
    summary: dict[str, Any]


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    split_map: dict[int, str] = {}
    for name in ("train", "validation", "test"):
        for index in manifest["baseScenarioSplit"][name]:
            split_map[int(index)] = name
    holdouts = []
    for item in manifest.get("holdouts", {}).get("machineHoldouts", []):
        holdouts.append({**item, "kind": "machine", "testPackageIdSet": set(item["testPackageIds"])})
    for item in manifest.get("holdouts", {}).get("refreshHoldouts", []):
        holdouts.append({**item, "kind": "refresh", "testPackageIdSet": set(item["testPackageIds"])})
    return {"manifest": manifest, "splitMap": split_map, "holdouts": holdouts}


def load_package(root: Path, assignment: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    zip_path = root / assignment["sourceZip"]
    with zipfile.ZipFile(zip_path) as zf:
        metadata = json.loads(zf.read("metadata.json").decode("utf-8-sig"))
        motion_metadata = json.loads(zf.read("motion-metadata.json").decode("utf-8-sig"))
        pkg = {
            "id": assignment["packageId"],
            "sourceZip": assignment["sourceZip"],
            "machineKey": assignment["machineKey"],
            "refreshBucket": assignment["refreshBucket"],
            "stopwatchFrequency": float(metadata.get("StopwatchFrequency") or 10_000_000),
            "scenarioCount": int(motion_metadata.get("ScenarioCount") or 64),
            "scenarioDurationMs": float(motion_metadata.get("ScenarioDurationMilliseconds") or 12_000),
            "warmupMs": float(metadata.get("WarmupDurationMilliseconds") or 500),
            "rule": context["manifest"]["cleaningPolicy"]["perPackageRules"][assignment["packageId"]],
            "refTimesUs": [],
            "refTicks": [],
            "refX": [],
            "refY": [],
            "motionTimesMs": [],
            "motionPhase": [],
            "motionSpeed": [],
            "anchors": [],
        }

        motion_reader = csv.DictReader((line.decode("utf-8-sig") for line in zf.open("motion-samples.csv")))
        for row in motion_reader:
            elapsed_ms = finite_float(row.get("elapsedMilliseconds"))
            if elapsed_ms is None:
                continue
            scenario_index = finite_int(row.get("scenarioIndex"))
            if scenario_index is None:
                scenario_index = scenario_from_elapsed_ms(elapsed_ms, pkg["scenarioDurationMs"], pkg["scenarioCount"])
            if not clean_time(pkg, elapsed_ms, scenario_index):
                continue
            pkg["motionTimesMs"].append(elapsed_ms)
            pkg["motionPhase"].append(row.get("movementPhase") or "unknown")
            pkg["motionSpeed"].append(finite_float(row.get("velocityPixelsPerSecond"), 0.0))

        trace_reader = csv.DictReader((line.decode("utf-8-sig") for line in zf.open("trace.csv")))
        for row in trace_reader:
            event = row.get("event") or ""
            elapsed_us = finite_float(row.get("elapsedMicroseconds"))
            stopwatch_ticks = finite_float(row.get("stopwatchTicks"))
            if elapsed_us is None or stopwatch_ticks is None:
                continue
            elapsed_ms = elapsed_us / 1000.0
            scenario_index = scenario_from_elapsed_ms(elapsed_ms, pkg["scenarioDurationMs"], pkg["scenarioCount"])
            if bool_value(row.get("warmupSample")) or not clean_time(pkg, elapsed_ms, scenario_index):
                continue
            split = split_name(context["splitMap"], scenario_index)
            x = finite_float(row.get("cursorX"), None)
            y = finite_float(row.get("cursorY"), None)
            if x is None:
                x = finite_float(row.get("x"), None)
            if y is None:
                y = finite_float(row.get("y"), None)
            if event == "referencePoll" and x is not None and y is not None:
                pkg["refTimesUs"].append(elapsed_us)
                pkg["refTicks"].append(stopwatch_ticks)
                pkg["refX"].append(x)
                pkg["refY"].append(y)
                continue
            if event != TARGET_EVENT:
                continue
            pkg["anchors"].append({
                "packageId": pkg["id"],
                "machineKey": pkg["machineKey"],
                "refreshBucket": pkg["refreshBucket"],
                "split": split,
                "scenarioIndex": scenario_index,
                "elapsedUs": elapsed_us,
                "elapsedMs": elapsed_ms,
                "stopwatchTicks": stopwatch_ticks,
                "stopwatchFrequency": pkg["stopwatchFrequency"],
                "predictionTargetTicks": finite_float(row.get("predictionTargetTicks"), None),
                "presentReferenceTicks": finite_float(row.get("presentReferenceTicks"), None),
                "dwmVBlankTicks": finite_float(row.get("dwmQpcVBlank"), None),
                "dwmRefreshPeriodTicks": finite_float(row.get("dwmQpcRefreshPeriod"), None),
                "schedulerProvenance": row.get("schedulerProvenance") or "",
            })
    return pkg


def build_rows(packages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    skipped = Counter()
    for pkg in packages:
        for anchor in pkg["anchors"]:
            target = resolve_target(anchor)
            if not target:
                skipped["missing_target"] += 1
                continue
            label = interpolate_reference(pkg, target["labelUs"])
            if not label:
                skipped["missing_label"] += 1
                continue
            idx = lower_bound(pkg["refTimesUs"], anchor["elapsedUs"] + 0.000001) - 1
            if idx < HISTORY:
                skipped["insufficient_history"] += 1
                continue
            latest_age_us = anchor["elapsedUs"] - pkg["refTimesUs"][idx]
            if latest_age_us > 100_000:
                skipped["stale_history"] += 1
                continue
            velocities = {n: velocity_n(pkg, idx, n) for n in (2, 3, 5, 8, 12)}
            path = analyze_path(pkg, idx, 12)
            motion = nearest_motion(pkg, target["labelUs"] / 1000.0)
            latest_x = pkg["refX"][idx]
            latest_y = pkg["refY"][idx]
            step5_dx, step5_dy = 0.0, 0.0
            row = {
                "packageId": pkg["id"],
                "machineKey": pkg["machineKey"],
                "refreshBucket": pkg["refreshBucket"],
                "split": anchor["split"],
                "scenarioIndex": anchor["scenarioIndex"],
                "schedulerProvenance": anchor["schedulerProvenance"] or "(blank)",
                "horizonMs": target["horizonMs"],
                "latestX": latest_x,
                "latestY": latest_y,
                "labelX": label["x"],
                "labelY": label["y"],
                "targetDx": label["x"] - latest_x,
                "targetDy": label["y"] - latest_y,
                "labelVx": label["vx"],
                "labelVy": label["vy"],
                "labelSpeed": label["speed"],
                "speedBin": speed_bin(label["speed"]),
                "phase": motion["phase"],
                "motionSpeed": motion["speed"],
                "historyGapMs": latest_age_us / 1000.0,
                "refresh60": 1.0 if pkg["refreshBucket"] == "60Hz" else 0.0,
                "refresh30": 1.0 if pkg["refreshBucket"] == "30Hz" else 0.0,
                "provenanceDwm": 1.0 if anchor["schedulerProvenance"] == "dwm" else 0.0,
                "velocities": velocities,
                "path": path,
                "history": [],
            }
            step5_dx, step5_dy = predict_step5_gate(row)
            row["baselineDx"] = step5_dx
            row["baselineDy"] = step5_dy
            for k in range(HISTORY):
                i = idx - (HISTORY - 1 - k)
                if i <= 0:
                    row["history"].append([0.0] * 9)
                    continue
                age_ms = (anchor["elapsedUs"] - pkg["refTimesUs"][i]) / 1000.0
                dt_ms = (pkg["refTimesUs"][i] - pkg["refTimesUs"][i - 1]) / 1000.0
                dx = pkg["refX"][i] - pkg["refX"][i - 1]
                dy = pkg["refY"][i] - pkg["refY"][i - 1]
                vx = dx / (dt_ms / 1000.0) if dt_ms > 0 else 0.0
                vy = dy / (dt_ms / 1000.0) if dt_ms > 0 else 0.0
                row["history"].append([
                    1.0,
                    age_ms / 64.0,
                    (pkg["refX"][i] - latest_x) / 128.0,
                    (pkg["refY"][i] - latest_y) / 128.0,
                    dx / 32.0,
                    dy / 32.0,
                    vx * row["horizonMs"] / 1000.0 / 32.0,
                    vy * row["horizonMs"] / 1000.0 / 32.0,
                    dt_ms / 16.0,
                ])
            rows.append(row)
    return rows, {"skipped": dict(skipped)}


def scalar_features(row: dict[str, Any]) -> list[float]:
    v2 = row["velocities"][2]
    v3 = row["velocities"][3]
    v5 = row["velocities"][5]
    v8 = row["velocities"][8]
    v12 = row["velocities"][12]
    path = row["path"]
    return [
        row["horizonMs"] / 16.67,
        row["refresh60"],
        row["refresh30"],
        row["provenanceDwm"],
        row["historyGapMs"] / 10.0,
        min(8.0, float(v2["speed"]) / 1000.0),
        min(8.0, float(v5["speed"]) / 1000.0),
        min(8.0, float(v8["speed"]) / 1000.0),
        min(8.0, float(v12["speed"]) / 1000.0),
        float(v2["vx"]) * row["horizonMs"] / 1000.0 / 32.0,
        float(v2["vy"]) * row["horizonMs"] / 1000.0 / 32.0,
        float(v3["vx"]) * row["horizonMs"] / 1000.0 / 32.0,
        float(v3["vy"]) * row["horizonMs"] / 1000.0 / 32.0,
        float(v5["vx"]) * row["horizonMs"] / 1000.0 / 32.0,
        float(v5["vy"]) * row["horizonMs"] / 1000.0 / 32.0,
        float(v8["vx"]) * row["horizonMs"] / 1000.0 / 32.0,
        float(v8["vy"]) * row["horizonMs"] / 1000.0 / 32.0,
        float(v12["vx"]) * row["horizonMs"] / 1000.0 / 32.0,
        float(v12["vy"]) * row["horizonMs"] / 1000.0 / 32.0,
        path["net"] / 128.0,
        path["path"] / 256.0,
        path["efficiency"],
        path["reversals"] / 8.0,
        row["baselineDx"] / 32.0,
        row["baselineDy"] / 32.0,
    ]


def build_dataset(rows: list[dict[str, Any]]) -> DatasetBundle:
    scalar = np.asarray([scalar_features(row) for row in rows], dtype=np.float32)
    seq = np.asarray([row["history"] for row in rows], dtype=np.float32)
    target = np.asarray([[row["targetDx"], row["targetDy"]] for row in rows], dtype=np.float32)
    baseline = np.asarray([[row["baselineDx"], row["baselineDy"]] for row in rows], dtype=np.float32)
    correction = target - baseline

    train_mask = np.asarray([row["split"] == "train" for row in rows], dtype=bool)
    scalar_mean = scalar[train_mask].mean(axis=0, keepdims=True)
    scalar_std = scalar[train_mask].std(axis=0, keepdims=True) + 1e-6
    seq_mean = seq[train_mask].reshape(-1, seq.shape[-1]).mean(axis=0, keepdims=True).reshape(1, 1, -1)
    seq_std = seq[train_mask].reshape(-1, seq.shape[-1]).std(axis=0, keepdims=True).reshape(1, 1, -1) + 1e-6

    scalar = (scalar - scalar_mean) / scalar_std
    seq = (seq - seq_mean) / seq_std

    target_scale = np.percentile(np.abs(target[train_mask]), 95, axis=0, keepdims=True).astype(np.float32) + 1.0
    correction_scale = np.percentile(np.abs(correction[train_mask]), 95, axis=0, keepdims=True).astype(np.float32) + 0.5

    summary = {
        "rows": len(rows),
        "bySplit": dict(Counter(row["split"] for row in rows)),
        "byPackage": dict(Counter(row["packageId"] for row in rows)),
        "byRefresh": dict(Counter(row["refreshBucket"] for row in rows)),
        "byPhase": dict(Counter(row["phase"] for row in rows)),
        "bySpeedBin": dict(Counter(row["speedBin"] for row in rows)),
        "scalarDim": int(scalar.shape[1]),
        "sequenceShape": [int(seq.shape[1]), int(seq.shape[2])],
        "targetScale": target_scale.reshape(-1).round(4).tolist(),
        "correctionScale": correction_scale.reshape(-1).round(4).tolist(),
    }
    return DatasetBundle(
        scalar=scalar,
        seq=seq,
        target=target,
        baseline=baseline,
        correction=correction,
        row_meta=rows,
        scalar_mean=scalar_mean,
        scalar_std=scalar_std,
        seq_mean=seq_mean,
        seq_std=seq_std,
        target_scale=target_scale,
        correction_scale=correction_scale,
        summary=summary,
    )


class MlpResidual(nn.Module):
    def __init__(self, scalar_dim: int, seq_len: int, seq_dim: int, hidden: tuple[int, ...] = (256, 256, 128, 64)) -> None:
        super().__init__()
        in_dim = scalar_dim + seq_len * seq_dim
        layers: list[nn.Module] = []
        current = in_dim
        for width in hidden:
            layers.extend([nn.Linear(current, width), nn.SiLU(), nn.Dropout(0.04)])
            current = width
        layers.append(nn.Linear(current, 2))
        self.net = nn.Sequential(*layers)

    def forward(self, scalar: torch.Tensor, seq: torch.Tensor) -> torch.Tensor:
        return self.net(torch.cat([scalar, seq.flatten(1)], dim=1))


class TcnResidual(nn.Module):
    def __init__(self, scalar_dim: int, seq_dim: int, channels: int = 96) -> None:
        super().__init__()
        self.proj = nn.Linear(seq_dim, channels)
        self.conv1 = nn.Conv1d(channels, channels, 3, padding=2, dilation=2)
        self.conv2 = nn.Conv1d(channels, channels, 3, padding=4, dilation=4)
        self.conv3 = nn.Conv1d(channels, channels, 3, padding=8, dilation=8)
        self.head = nn.Sequential(
            nn.Linear(scalar_dim + channels, 192),
            nn.SiLU(),
            nn.Dropout(0.04),
            nn.Linear(192, 96),
            nn.SiLU(),
            nn.Linear(96, 2),
        )

    def forward(self, scalar: torch.Tensor, seq: torch.Tensor) -> torch.Tensor:
        x = self.proj(seq).transpose(1, 2)
        for conv in (self.conv1, self.conv2, self.conv3):
            y = conv(x)
            y = y[..., -x.shape[-1]:]
            x = F.silu(y + x)
        pooled = x[..., -1]
        return self.head(torch.cat([scalar, pooled], dim=1))


class GruResidual(nn.Module):
    def __init__(self, scalar_dim: int, seq_dim: int, hidden: int = 128, layers: int = 2) -> None:
        super().__init__()
        self.rnn = nn.GRU(seq_dim, hidden, num_layers=layers, batch_first=True, dropout=0.05)
        self.head = nn.Sequential(
            nn.Linear(scalar_dim + hidden, 192),
            nn.SiLU(),
            nn.Dropout(0.04),
            nn.Linear(192, 96),
            nn.SiLU(),
            nn.Linear(96, 2),
        )

    def forward(self, scalar: torch.Tensor, seq: torch.Tensor) -> torch.Tensor:
        out, _ = self.rnn(seq)
        return self.head(torch.cat([scalar, out[:, -1]], dim=1))


class LstmResidual(nn.Module):
    def __init__(self, scalar_dim: int, seq_dim: int, hidden: int = 128, layers: int = 2) -> None:
        super().__init__()
        self.rnn = nn.LSTM(seq_dim, hidden, num_layers=layers, batch_first=True, dropout=0.05)
        self.head = nn.Sequential(
            nn.Linear(scalar_dim + hidden, 192),
            nn.SiLU(),
            nn.Dropout(0.04),
            nn.Linear(192, 96),
            nn.SiLU(),
            nn.Linear(96, 2),
        )

    def forward(self, scalar: torch.Tensor, seq: torch.Tensor) -> torch.Tensor:
        out, _ = self.rnn(seq)
        return self.head(torch.cat([scalar, out[:, -1]], dim=1))


class TransformerResidual(nn.Module):
    def __init__(self, scalar_dim: int, seq_dim: int, d_model: int = 96, heads: int = 4, layers: int = 2) -> None:
        super().__init__()
        self.proj = nn.Linear(seq_dim, d_model)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=heads,
            dim_feedforward=256,
            dropout=0.05,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=layers)
        self.head = nn.Sequential(
            nn.Linear(scalar_dim + d_model, 192),
            nn.GELU(),
            nn.Linear(192, 96),
            nn.GELU(),
            nn.Linear(96, 2),
        )

    def forward(self, scalar: torch.Tensor, seq: torch.Tensor) -> torch.Tensor:
        encoded = self.encoder(self.proj(seq))
        return self.head(torch.cat([scalar, encoded[:, -1]], dim=1))


class DirectMlp(nn.Module):
    def __init__(self, scalar_dim: int, seq_len: int, seq_dim: int) -> None:
        super().__init__()
        in_dim = scalar_dim + seq_len * seq_dim
        self.net = nn.Sequential(
            nn.Linear(in_dim, 320),
            nn.SiLU(),
            nn.Dropout(0.04),
            nn.Linear(320, 256),
            nn.SiLU(),
            nn.Dropout(0.04),
            nn.Linear(256, 128),
            nn.SiLU(),
            nn.Linear(128, 2),
        )

    def forward(self, scalar: torch.Tensor, seq: torch.Tensor) -> torch.Tensor:
        return self.net(torch.cat([scalar, seq.flatten(1)], dim=1))


def split_indices(rows: list[dict[str, Any]], split: str) -> np.ndarray:
    return np.asarray([i for i, row in enumerate(rows) if row["split"] == split], dtype=np.int64)


def tensor_dataset(bundle: DatasetBundle, indices: np.ndarray, objective: str) -> TensorDataset:
    target = bundle.target if objective == "direct" else bundle.correction
    scale = bundle.target_scale if objective == "direct" else bundle.correction_scale
    return TensorDataset(
        torch.from_numpy(bundle.scalar[indices]).float(),
        torch.from_numpy(bundle.seq[indices]).float(),
        torch.from_numpy((target[indices] / scale).astype(np.float32)).float(),
        torch.from_numpy(indices).long(),
    )


def weighted_smooth_l1(pred: torch.Tensor, target: torch.Tensor, row_indices: torch.Tensor, speed_weights: torch.Tensor) -> torch.Tensor:
    base = F.smooth_l1_loss(pred, target, reduction="none").sum(dim=1)
    weights = speed_weights[row_indices]
    return (base * weights).mean()


def train_model(
    model: nn.Module,
    bundle: DatasetBundle,
    objective: str,
    weighted: bool,
    device: torch.device,
    args: argparse.Namespace,
    started: float,
) -> dict[str, Any]:
    train_idx = split_indices(bundle.row_meta, "train")
    val_idx = split_indices(bundle.row_meta, "validation")
    train_ds = tensor_dataset(bundle, train_idx, objective)
    val_ds = tensor_dataset(bundle, val_idx, objective)
    generator = torch.Generator()
    generator.manual_seed(args.seed)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, generator=generator, num_workers=0, pin_memory=device.type == "cuda")
    val_loader = DataLoader(val_ds, batch_size=args.batch_size * 2, shuffle=False, num_workers=0, pin_memory=device.type == "cuda")

    row_speed_weights = np.ones(len(bundle.row_meta), dtype=np.float32)
    if weighted:
        for i, row in enumerate(bundle.row_meta):
            speed = float(row["labelSpeed"])
            if speed >= 2000:
                row_speed_weights[i] = 6.0
            elif speed >= 1000:
                row_speed_weights[i] = 3.0
            elif row["phase"] == "resume":
                row_speed_weights[i] = 2.5
            elif speed >= 500:
                row_speed_weights[i] = 1.8
    speed_weights = torch.from_numpy(row_speed_weights).to(device)

    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2.5e-3, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(8, args.epochs))
    best_state = None
    best_val = math.inf
    best_epoch = 0
    no_improve = 0
    train_seconds = 0.0
    history = []
    for epoch in range(1, args.epochs + 1):
        if (time.perf_counter() - started) > args.max_seconds:
            break
        epoch_start = time.perf_counter()
        model.train()
        train_losses = []
        for scalar, seq, target, row_indices in train_loader:
            scalar = scalar.to(device, non_blocking=True)
            seq = seq.to(device, non_blocking=True)
            target = target.to(device, non_blocking=True)
            row_indices = row_indices.to(device, non_blocking=True)
            pred = model(scalar, seq)
            loss = weighted_smooth_l1(pred, target, row_indices, speed_weights) if weighted else F.smooth_l1_loss(pred, target)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            optimizer.step()
            train_losses.append(float(loss.detach().cpu()))
        scheduler.step()
        train_seconds += time.perf_counter() - epoch_start
        model.eval()
        val_losses = []
        with torch.no_grad():
            for scalar, seq, target, row_indices in val_loader:
                scalar = scalar.to(device, non_blocking=True)
                seq = seq.to(device, non_blocking=True)
                target = target.to(device, non_blocking=True)
                row_indices = row_indices.to(device, non_blocking=True)
                pred = model(scalar, seq)
                loss = weighted_smooth_l1(pred, target, row_indices, speed_weights) if weighted else F.smooth_l1_loss(pred, target)
                val_losses.append(float(loss.detach().cpu()))
        val_loss = float(np.mean(val_losses))
        train_loss = float(np.mean(train_losses))
        history.append({"epoch": epoch, "trainLoss": round(train_loss, 6), "validationLoss": round(val_loss, 6)})
        if val_loss < best_val - 1e-5:
            best_val = val_loss
            best_epoch = epoch
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1
        if no_improve >= args.patience:
            break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.to(device)
    return {
        "bestValidationLoss": round(best_val, 6),
        "bestEpoch": best_epoch,
        "epochsRun": len(history),
        "trainSeconds": round(train_seconds, 3),
        "historyTail": history[-8:],
    }


def predict_model(model: nn.Module, bundle: DatasetBundle, objective: str, device: torch.device, batch_size: int) -> np.ndarray:
    model.eval()
    all_idx = np.arange(len(bundle.row_meta), dtype=np.int64)
    ds = TensorDataset(torch.from_numpy(bundle.scalar).float(), torch.from_numpy(bundle.seq).float(), torch.from_numpy(all_idx).long())
    loader = DataLoader(ds, batch_size=batch_size * 2, shuffle=False, num_workers=0, pin_memory=device.type == "cuda")
    chunks: list[np.ndarray] = []
    with torch.no_grad():
        for scalar, seq, _idx in loader:
            pred = model(scalar.to(device, non_blocking=True), seq.to(device, non_blocking=True)).detach().cpu().numpy()
            chunks.append(pred.astype(np.float32))
    scaled = np.concatenate(chunks, axis=0)
    if objective == "direct":
        return scaled * bundle.target_scale
    return bundle.baseline + (scaled * bundle.correction_scale)


def baseline_predictions(bundle: DatasetBundle) -> dict[str, np.ndarray]:
    constant = np.zeros_like(bundle.target)
    return {
        "constant_position": constant,
        "step5_gate": bundle.baseline.copy(),
    }


def signed_errors(pred: np.ndarray, bundle: DatasetBundle, indices: np.ndarray) -> np.ndarray:
    values = []
    for i in indices:
        row = bundle.row_meta[int(i)]
        speed = magnitude(float(row["labelVx"]), float(row["labelVy"]))
        if speed < 1:
            values.append(math.nan)
            continue
        ex = float(pred[i, 0] - bundle.target[i, 0])
        ey = float(pred[i, 1] - bundle.target[i, 1])
        values.append((ex * float(row["labelVx"]) + ey * float(row["labelVy"])) / speed)
    return np.asarray(values, dtype=np.float64)


def evaluate_prediction(model_id: str, pred: np.ndarray, bundle: DatasetBundle, holdouts: list[dict[str, Any]]) -> dict[str, Any]:
    errors = np.sqrt(np.sum((pred - bundle.target) ** 2, axis=1))
    result: dict[str, Any] = {
        "modelId": model_id,
        "bySplit": {},
        "byRefresh": {},
        "byPhase": {},
        "bySpeedBin": {},
        "byHoldout": {},
    }
    for split in ("train", "validation", "test"):
        idx = np.asarray([i for i, row in enumerate(bundle.row_meta) if row["split"] == split], dtype=np.int64)
        result["bySplit"][split] = {**stats(errors[idx]), "signed": signed_stats(signed_errors(pred, bundle, idx))}
    for refresh in sorted(set(row["refreshBucket"] for row in bundle.row_meta)):
        idx = np.asarray([i for i, row in enumerate(bundle.row_meta) if row["refreshBucket"] == refresh], dtype=np.int64)
        result["byRefresh"][refresh] = {**stats(errors[idx]), "signed": signed_stats(signed_errors(pred, bundle, idx))}
    for phase in sorted(set(row["phase"] for row in bundle.row_meta)):
        idx = np.asarray([i for i, row in enumerate(bundle.row_meta) if row["phase"] == phase], dtype=np.int64)
        result["byPhase"][phase] = {**stats(errors[idx]), "signed": signed_stats(signed_errors(pred, bundle, idx))}
    for name, _low, _high in SPEED_BINS:
        idx = np.asarray([i for i, row in enumerate(bundle.row_meta) if row["speedBin"] == name], dtype=np.int64)
        result["bySpeedBin"][name] = {**stats(errors[idx]), "signed": signed_stats(signed_errors(pred, bundle, idx))}
    for holdout in holdouts:
        raw_holdout_id = str(holdout["id"])
        holdout_id = raw_holdout_id if raw_holdout_id.startswith(f"{holdout['kind']}:") else f"{holdout['kind']}:{raw_holdout_id}"
        entry = {}
        for role in ("train", "test"):
            if role == "test":
                idx = np.asarray([i for i, row in enumerate(bundle.row_meta) if row["packageId"] in holdout["testPackageIdSet"]], dtype=np.int64)
            else:
                idx = np.asarray([i for i, row in enumerate(bundle.row_meta) if row["packageId"] not in holdout["testPackageIdSet"]], dtype=np.int64)
            entry[role] = stats(errors[idx])
        entry["deltaP95TestMinusTrain"] = (
            None if entry["train"]["p95"] is None or entry["test"]["p95"] is None else round(entry["test"]["p95"] - entry["train"]["p95"], 4)
        )
        entry["deltaP99TestMinusTrain"] = (
            None if entry["train"]["p99"] is None or entry["test"]["p99"] is None else round(entry["test"]["p99"] - entry["train"]["p99"], 4)
        )
        result["byHoldout"][holdout_id] = entry
    return result


def model_objective(metrics: dict[str, Any]) -> float:
    val = metrics["bySplit"]["validation"]
    holdout30 = metrics["byHoldout"].get("refresh:30Hz", {})
    return (
        float(val["p95"] or 9999)
        + 0.25 * float(val["p99"] or 9999)
        + 35.0 * float(val["gt10Rate"] or 1.0)
        + 0.1 * abs(float(val["signed"]["mean"] or 0.0))
        + 0.25 * max(0.0, float(holdout30.get("deltaP99TestMinusTrain") or 0.0))
    )


def table(headers: list[str], rows: list[list[Any]]) -> str:
    def cell(value: Any) -> str:
        if value is None:
            return "n/a"
        if isinstance(value, float):
            return f"{value:.4f}".rstrip("0").rstrip(".")
        return str(value)

    out = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    for row in rows:
        out.append("| " + " | ".join(cell(value) for value in row) + " |")
    return "\n".join(out)


def write_reports(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False), encoding="utf-8")

    ranking = scores["ranking"]
    ranking_rows = []
    for item in ranking[:12]:
        metric = scores["models"][item["modelId"]]["metrics"]["bySplit"]["validation"]
        test = scores["models"][item["modelId"]]["metrics"]["bySplit"]["test"]
        high = scores["models"][item["modelId"]]["metrics"]["bySpeedBin"].get(">=2000", {})
        holdout30 = scores["models"][item["modelId"]]["metrics"]["byHoldout"].get("refresh:30Hz", {})
        ranking_rows.append([
            item["modelId"],
            item["family"],
            item["objective"],
            metric["mean"],
            metric["p95"],
            metric["p99"],
            test["p95"],
            test["p99"],
            high.get("p99"),
            holdout30.get("deltaP99TestMinusTrain"),
        ])

    selected = scores["selectedModel"]
    selected_metrics = scores["models"][selected]["metrics"]
    report = f"""# Cursor Prediction v13 - GPU Deep Learning Capacity Probe

## Intent

This POC tests the user's concern that the v9 dataset might still be learnable by deeper models. The purpose is precision discovery, not immediate product integration. The runtime constraint remains causal: inputs use only runtimeSchedulerPoll/v9 target timing and causal referencePoll history.

## Environment

- Device: `{scores['environment']['device']}`
- Torch: `{scores['environment']['torchVersion']}`
- CUDA: `{scores['environment']['cudaVersion']}`
- GPU: `{scores['environment']['gpuName']}`
- GPU used: `{scores['environment']['gpuUsed']}`

No checkpoints, expanded CSVs, feature caches, TensorBoard logs, or model weight files were written.

## Dataset

- Rows: {scores['dataset']['rows']}
- Scalar dim: {scores['dataset']['scalarDim']}
- Sequence: {scores['dataset']['sequenceShape']}
- Splits: `{scores['dataset']['bySplit']}`
- Refresh: `{scores['dataset']['byRefresh']}`
- Phase: `{scores['dataset']['byPhase']}`

Cleaning and split policy are inherited from POC 12. Contaminated user-input windows and `m070055` scenario 0 are excluded.

## Validation Ranking

{table(['model', 'family', 'objective', 'val mean', 'val p95', 'val p99', 'test p95', 'test p99', '>=2000 p99', '30Hz holdout p99 d'], ranking_rows)}

## Selected Model

Selected model: `{selected}`.

| split | mean | p95 | p99 | >10 | signed mean | lag rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| train | {selected_metrics['bySplit']['train']['mean']} | {selected_metrics['bySplit']['train']['p95']} | {selected_metrics['bySplit']['train']['p99']} | {selected_metrics['bySplit']['train']['gt10Rate']} | {selected_metrics['bySplit']['train']['signed']['mean']} | {selected_metrics['bySplit']['train']['signed']['lagRate']} |
| validation | {selected_metrics['bySplit']['validation']['mean']} | {selected_metrics['bySplit']['validation']['p95']} | {selected_metrics['bySplit']['validation']['p99']} | {selected_metrics['bySplit']['validation']['gt10Rate']} | {selected_metrics['bySplit']['validation']['signed']['mean']} | {selected_metrics['bySplit']['validation']['signed']['lagRate']} |
| test | {selected_metrics['bySplit']['test']['mean']} | {selected_metrics['bySplit']['test']['p95']} | {selected_metrics['bySplit']['test']['p99']} | {selected_metrics['bySplit']['test']['gt10Rate']} | {selected_metrics['bySplit']['test']['signed']['mean']} | {selected_metrics['bySplit']['test']['signed']['lagRate']} |

## Comparison To POC 12

The POC 12 product-safe gate remains the strongest conservative product candidate unless a deep model improves validation/test and holdouts without regression. This POC reports raw deep capacity and guarded residual variants separately so that overfit-looking improvements do not silently become product logic.

## Interpretation

{scores['interpretation']}
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")

    notes = f"""# Notes

Run command:

```powershell
$env:UV_CACHE_DIR=(Resolve-Path '.uv-cache').Path
$env:UV_PYTHON_INSTALL_DIR=(Join-Path (Get-Location) '.uv-python')
uv run --python 'C:\\Users\\seigl\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe' --with numpy==2.4.3 --with torch==2.11.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128 python poc\\cursor-prediction-v13\\scripts\\run-deep-learning-gpu.py
```

The script stores only final compact artifacts. Model states are kept in memory for early stopping and discarded before exit.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")

    readme = f"""# Cursor Prediction v13

GPU deep-learning capacity probe for the v9, input-blocked Motion Lab dataset.

Artifacts:

- `report.md`: human-readable experiment report.
- `scores.json`: machine-readable metrics.
- `notes.md`: rerun command and artifact policy.
- `scripts/run-deep-learning-gpu.py`: reproducible script.

The experiment uses POC 12's cleaning and split manifest. No raw ZIPs, expanded CSVs, model checkpoints, or feature caches are stored here.
"""
    (out_dir / "README.md").write_text(readme, encoding="utf-8")


def build_models(bundle: DatasetBundle) -> list[dict[str, Any]]:
    scalar_dim = int(bundle.scalar.shape[1])
    seq_len = int(bundle.seq.shape[1])
    seq_dim = int(bundle.seq.shape[2])
    return [
        {"id": "mlp_direct_h320", "family": "MLP", "objective": "direct", "weighted": False, "model": DirectMlp(scalar_dim, seq_len, seq_dim)},
        {"id": "mlp_residual_h256", "family": "MLP", "objective": "residual", "weighted": False, "model": MlpResidual(scalar_dim, seq_len, seq_dim)},
        {"id": "mlp_residual_weighted_h256", "family": "MLP", "objective": "residual", "weighted": True, "model": MlpResidual(scalar_dim, seq_len, seq_dim)},
        {"id": "tcn_residual_c96", "family": "TCN", "objective": "residual", "weighted": False, "model": TcnResidual(scalar_dim, seq_dim, 96)},
        {"id": "tcn_residual_weighted_c96", "family": "TCN", "objective": "residual", "weighted": True, "model": TcnResidual(scalar_dim, seq_dim, 96)},
        {"id": "gru_residual_h128", "family": "GRU", "objective": "residual", "weighted": False, "model": GruResidual(scalar_dim, seq_dim, 128, 2)},
        {"id": "gru_residual_weighted_h128", "family": "GRU", "objective": "residual", "weighted": True, "model": GruResidual(scalar_dim, seq_dim, 128, 2)},
        {"id": "lstm_residual_h128", "family": "LSTM", "objective": "residual", "weighted": False, "model": LstmResidual(scalar_dim, seq_dim, 128, 2)},
        {"id": "transformer_residual_d96", "family": "Transformer", "objective": "residual", "weighted": False, "model": TransformerResidual(scalar_dim, seq_dim, 96, 4, 2)},
        {"id": "transformer_residual_weighted_d96", "family": "Transformer", "objective": "residual", "weighted": True, "model": TransformerResidual(scalar_dim, seq_dim, 96, 4, 2)},
    ]


def main() -> int:
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = torch.device("cpu" if args.cpu or not torch.cuda.is_available() else "cuda")
    started = time.perf_counter()

    context = load_manifest(args.manifest)
    packages = [load_package(args.root, assignment, context) for assignment in context["manifest"]["packageScenarioAssignments"]]
    rows, build_summary = build_rows(packages)
    bundle = build_dataset(rows)

    models: dict[str, Any] = {}
    baseline_preds = baseline_predictions(bundle)
    for model_id, pred in baseline_preds.items():
        metrics = evaluate_prediction(model_id, pred, bundle, context["holdouts"])
        models[model_id] = {
            "family": "baseline",
            "objective": "none",
            "weighted": False,
            "params": {},
            "training": None,
            "metrics": metrics,
        }

    for spec in build_models(bundle):
        if (time.perf_counter() - started) > args.max_seconds:
            break
        model_id = spec["id"]
        training = train_model(spec["model"], bundle, spec["objective"], spec["weighted"], device, args, started)
        pred = predict_model(spec["model"], bundle, spec["objective"], device, args.batch_size)
        metrics = evaluate_prediction(model_id, pred, bundle, context["holdouts"])
        params = sum(p.numel() for p in spec["model"].parameters())
        models[model_id] = {
            "family": spec["family"],
            "objective": spec["objective"],
            "weighted": spec["weighted"],
            "params": int(params),
            "training": training,
            "metrics": metrics,
        }
        del spec["model"]
        if device.type == "cuda":
            torch.cuda.empty_cache()

    ranking = []
    for model_id, payload in models.items():
        objective = model_objective(payload["metrics"])
        ranking.append({
            "modelId": model_id,
            "family": payload["family"],
            "objective": round(objective, 6),
            "validation": payload["metrics"]["bySplit"]["validation"],
        })
    ranking.sort(key=lambda item: (item["objective"], item["validation"]["p95"] or 9999, item["validation"]["p99"] or 9999))
    selected = ranking[0]["modelId"]

    step5 = models["step5_gate"]["metrics"]["bySplit"]["validation"]
    selected_val = models[selected]["metrics"]["bySplit"]["validation"]
    if selected == "step5_gate":
        interpretation = (
            "No deep-learning model beat the POC 12 Step 5 gate under the strict validation objective. "
            "This weakens, but does not mathematically eliminate, the hypothesis that this dataset can train a better high-capacity predictor."
        )
    elif (selected_val["p95"] or 9999) <= (step5["p95"] or 9999) and (selected_val["p99"] or 9999) <= (step5["p99"] or 9999):
        interpretation = (
            "A deep model matched or improved the Step 5 validation p95/p99 under the strict objective. "
            "It must still be checked against holdouts and product CPU deployability before becoming product logic."
        )
    else:
        interpretation = (
            "Deep models learned useful structure but did not clearly dominate the product-safe gate. "
            "The data is learnable in the training/validation sense, but not yet enough to justify replacing the lightweight gate."
        )

    scores = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "device": str(device),
            "gpuUsed": device.type == "cuda",
            "torchVersion": torch.__version__,
            "cudaVersion": torch.version.cuda,
            "gpuName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "python": sys.version,
        },
        "constraints": {
            "rawZipCopied": False,
            "expandedCsvWritten": False,
            "checkpointWritten": False,
            "featureCacheWritten": False,
            "tensorboardWritten": False,
            "execution": "single-process sequential GPU training" if device.type == "cuda" else "single-process sequential CPU training",
        },
        "manifest": {
            "path": str(args.manifest.relative_to(args.root)) if args.manifest.is_relative_to(args.root) else str(args.manifest),
            "schemaVersion": context["manifest"].get("schemaVersion"),
        },
        "buildSummary": build_summary,
        "dataset": bundle.summary,
        "models": models,
        "ranking": ranking,
        "selectedModel": selected,
        "interpretation": interpretation,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    write_reports(args.out_dir, scores)
    print(json.dumps({
        "selectedModel": selected,
        "gpuUsed": device.type == "cuda",
        "rows": bundle.summary["rows"],
        "elapsedSeconds": scores["elapsedSeconds"],
        "ranking": ranking[:5],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
