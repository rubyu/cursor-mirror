#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCHEMA = "cursor-mirror-motion-script/1";
const DATASET_SCHEMA = "cursor-prediction-v10-phase0-dataset/1";
const BASELINE_SCHEMA = "cursor-prediction-v10-phase1-baselines/1";
const SCORE_SCHEMA = "cursor-prediction-v10-scores/1";

const BOUNDS = [
  { width: 640, height: 480 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

const HORIZONS_MS = [8.33, 16.67, 25, 33.33];
const MISSING_SCENARIOS = [
  { id: "clean", dropRate: 0 },
  { id: "missing_10pct", dropRate: 0.10 },
  { id: "missing_25pct", dropRate: 0.25 },
];

const SPEED_BINS = [
  { id: "0-25", min: 0, max: 25 },
  { id: "25-100", min: 25, max: 100 },
  { id: "100-250", min: 100, max: 250 },
  { id: "250-500", min: 250, max: 500 },
  { id: "500-1000", min: 500, max: 1000 },
  { id: "1000-2000", min: 1000, max: 2000 },
  { id: ">=2000", min: 2000, max: Infinity },
];

const DEFAULT_ARGS = {
  count: 2000,
  seed: 10010,
  anchorsPerScript: 32,
  sampleIntervalMs: 8.33,
  historyMs: 200,
};

function parseArgs(argv) {
  const scriptDir = __dirname;
  const outDir = path.resolve(scriptDir, "..");
  const args = {
    ...DEFAULT_ARGS,
    outDir,
    runsDir: path.join(outDir, "runs"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--count") args.count = intArg(argv[++i], "count");
    else if (arg === "--seed") args.seed = intArg(argv[++i], "seed");
    else if (arg === "--anchors-per-script") args.anchorsPerScript = intArg(argv[++i], "anchors-per-script");
    else if (arg === "--sample-interval-ms") args.sampleIntervalMs = numberArg(argv[++i], "sample-interval-ms");
    else if (arg === "--history-ms") args.historyMs = numberArg(argv[++i], "history-ms");
    else if (arg === "--out-dir") {
      args.outDir = path.resolve(argv[++i]);
      args.runsDir = path.join(args.outDir, "runs");
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node run-v10-pilot.js [--count 2000] [--seed 10010]
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.count <= 0) throw new Error("--count must be positive");
  if (args.anchorsPerScript <= 0) throw new Error("--anchors-per-script must be positive");
  if (args.sampleIntervalMs <= 0) throw new Error("--sample-interval-ms must be positive");
  return args;
}

function intArg(text, name) {
  const value = Number(text);
  if (!Number.isInteger(value)) throw new Error(`--${name} expects an integer`);
  return value;
}

function numberArg(text, name) {
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`--${name} expects a number`);
  return value;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(...values) {
  let h = 2166136261 >>> 0;
  for (const value of values) {
    let x = value >>> 0;
    h ^= x & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 16) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 24) & 0xff;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unitHash(...values) {
  return hash32(...values) / 4294967296;
}

function pick(rng, items) {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function point(x, y) {
  return { x: round(x), y: round(y) };
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function choosePoint(rng, bounds, nearEdge) {
  if (!nearEdge) {
    return point(rng() * bounds.width, rng() * bounds.height);
  }
  const marginX = bounds.width * 0.06;
  const marginY = bounds.height * 0.06;
  const side = Math.floor(rng() * 4);
  if (side === 0) return point(rng() * marginX, rng() * bounds.height);
  if (side === 1) return point(bounds.width - rng() * marginX, rng() * bounds.height);
  if (side === 2) return point(rng() * bounds.width, rng() * marginY);
  return point(rng() * bounds.width, bounds.height - rng() * marginY);
}

function conditionPlan(index, rng) {
  const tags = [];
  if (index % 5 === 0 || rng() < 0.20) tags.push("near_stop");
  if (index % 7 === 0 || rng() < 0.18) tags.push("acute_acceleration");
  if (index % 6 === 0 || rng() < 0.20) tags.push("edge_proximity");
  if (index % 8 === 0 || rng() < 0.16) tags.push("missing_history");
  if (index % 9 === 0 || rng() < 0.18) tags.push("jitter");
  if (index % 11 === 0 || rng() < 0.12) tags.push("loop_or_reversal");
  if (tags.length === 0) tags.push("smooth_reference");
  return Array.from(new Set(tags));
}

function generateSpeedProfile(rng, tags, maxPoints) {
  const points = [];
  const add = (progress, multiplier, easing, width) => {
    points.push({
      progress: round(clamp(progress, 0, 1), 5),
      multiplier: round(clamp(multiplier, 0.03, 6), 4),
      easing,
      width: round(clamp(width, 0.015, 0.35), 4),
    });
  };

  if (maxPoints === 0) return [];
  if (tags.includes("near_stop")) {
    const p = 0.15 + rng() * 0.7;
    add(p, 0.03 + rng() * 0.07, "smoothstep", 0.05 + rng() * 0.10);
  }
  if (tags.includes("acute_acceleration")) {
    const p = 0.10 + rng() * 0.8;
    add(p, 2.5 + rng() * 3.2, "sharp", 0.025 + rng() * 0.06);
    add(clamp(p + 0.05 + rng() * 0.20, 0, 1), 0.25 + rng() * 0.5, "smoothstep", 0.04 + rng() * 0.10);
  }

  while (points.length < maxPoints && rng() < 0.62) {
    add(rng(), 0.25 + rng() * 2.5, pick(rng, ["linear", "smoothstep", "sharp"]), 0.03 + rng() * 0.22);
  }

  points.sort((a, b) => a.progress - b.progress);
  return points.slice(0, maxPoints);
}

function generateScript(rootSeed, index) {
  const scriptSeed = hash32(rootSeed, index + 1, 0x9e3779b9);
  const rng = mulberry32(scriptSeed);
  const bounds = pick(rng, BOUNDS);
  const tags = conditionPlan(index, rng);
  const durationMs = round(2000 + rng() * 10000, 3);
  const pointCount = 2 + Math.floor(rng() * 15);
  const speedPointCount = Math.floor(rng() * 33);
  const nearEdge = tags.includes("edge_proximity");
  const start = choosePoint(rng, bounds, nearEdge);
  const end = choosePoint(rng, bounds, nearEdge && rng() < 0.75);
  const controlPoints = [start];
  const wander = tags.includes("loop_or_reversal") ? 0.95 : 0.42;

  for (let i = 1; i < pointCount - 1; i += 1) {
    const t = i / (pointCount - 1);
    const baseX = start.x + (end.x - start.x) * t;
    const baseY = start.y + (end.y - start.y) * t;
    const ampX = bounds.width * wander * (0.25 + rng() * 0.75);
    const ampY = bounds.height * wander * (0.25 + rng() * 0.75);
    const curveBias = Math.sin((t + rng() * 0.5) * Math.PI * (tags.includes("loop_or_reversal") ? 3 : 1));
    const x = clamp(baseX + (rng() * 2 - 1) * ampX + curveBias * ampX * 0.18, 0, bounds.width);
    const y = clamp(baseY + (rng() * 2 - 1) * ampY - curveBias * ampY * 0.18, 0, bounds.height);
    controlPoints.push(point(x, y));
  }
  if (pointCount > 1) controlPoints.push(end);

  const speedProfile = generateSpeedProfile(rng, tags, speedPointCount);
  const jitter = tags.includes("jitter")
    ? {
        amplitudePx: round(0.4 + rng() * 3.5, 3),
        frequencyHz: round(18 + rng() * 62, 3),
        phaseX: round(rng() * Math.PI * 2, 5),
        phaseY: round(rng() * Math.PI * 2, 5),
      }
    : null;

  return {
    schemaVersion: SCHEMA,
    id: `synthetic-${String(index + 1).padStart(5, "0")}`,
    seed: scriptSeed,
    generator: {
      name: "cursor-prediction-v10-pilot",
      rootSeed,
      scriptIndex: index,
    },
    bounds,
    durationMs,
    sampleRate: {
      nominalHz: 120,
      optionalExportOnly: true,
    },
    startPoint: start,
    endPoint: end,
    controlPoints,
    speedProfile,
    conditions: {
      tags,
      missingHistoryStress: tags.includes("missing_history")
        ? { suggestedDropRate: round(0.08 + rng() * 0.22, 3) }
        : null,
      jitter,
    },
  };
}

function smoothstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function profileInfluence(mode, distanceNorm) {
  const d = Math.abs(distanceNorm);
  if (d >= 1) return 0;
  if (mode === "sharp") return (1 - d) * (1 - d);
  if (mode === "smoothstep") return 1 - smoothstep(d);
  return 1 - d;
}

function speedMultiplier(script, progress) {
  let speed = 1;
  for (const pointSpec of script.speedProfile) {
    const influence = profileInfluence(pointSpec.easing, (progress - pointSpec.progress) / pointSpec.width);
    if (influence > 0) {
      speed *= 1 + (pointSpec.multiplier - 1) * influence;
    }
  }
  return clamp(speed, 0.03, 6);
}

function buildProgressLut(script) {
  const steps = 160;
  const cumulative = [{ p: 0, time: 0 }];
  let total = 0;
  let lastCost = 1 / speedMultiplier(script, 0);
  for (let i = 1; i <= steps; i += 1) {
    const p = i / steps;
    const cost = 1 / speedMultiplier(script, p);
    total += (lastCost + cost) * 0.5 / steps;
    cumulative.push({ p, time: total });
    lastCost = cost;
  }
  for (const item of cumulative) item.fraction = total > 0 ? item.time / total : item.p;
  return cumulative;
}

function progressAtElapsed(script, elapsedMs) {
  if (!script._progressLut) script._progressLut = buildProgressLut(script);
  const f = clamp(elapsedMs / script.durationMs, 0, 1);
  const lut = script._progressLut;
  let lo = 0;
  let hi = lut.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lut[mid].fraction < f) lo = mid + 1;
    else hi = mid;
  }
  if (lo <= 0) return 0;
  const a = lut[lo - 1];
  const b = lut[lo];
  const span = b.fraction - a.fraction;
  const local = span > 0 ? (f - a.fraction) / span : 0;
  return a.p + (b.p - a.p) * clamp(local, 0, 1);
}

function bezier(controlPoints, t) {
  const work = controlPoints.map((p) => ({ x: p.x, y: p.y }));
  for (let r = 1; r < work.length; r += 1) {
    for (let i = 0; i < work.length - r; i += 1) {
      work[i].x = work[i].x * (1 - t) + work[i + 1].x * t;
      work[i].y = work[i].y * (1 - t) + work[i + 1].y * t;
    }
  }
  return work[0];
}

function sampleScript(script, elapsedMs) {
  const progress = progressAtElapsed(script, elapsedMs);
  const p = bezier(script.controlPoints, progress);
  const jitter = script.conditions.jitter;
  if (jitter) {
    const seconds = elapsedMs / 1000;
    p.x += Math.sin(seconds * jitter.frequencyHz * Math.PI * 2 + jitter.phaseX) * jitter.amplitudePx;
    p.y += Math.cos(seconds * jitter.frequencyHz * Math.PI * 2 + jitter.phaseY) * jitter.amplitudePx;
  }
  return {
    x: clamp(p.x, 0, script.bounds.width),
    y: clamp(p.y, 0, script.bounds.height),
  };
}

function speedAt(script, elapsedMs) {
  const dt = 4.167;
  const a = sampleScript(script, Math.max(0, elapsedMs - dt));
  const b = sampleScript(script, Math.min(script.durationMs, elapsedMs + dt));
  const seconds = (Math.min(script.durationMs, elapsedMs + dt) - Math.max(0, elapsedMs - dt)) / 1000;
  if (seconds <= 0) return 0;
  return dist(a.x, a.y, b.x, b.y) / seconds;
}

function speedBin(speed) {
  for (const bin of SPEED_BINS) {
    if (speed >= bin.min && speed < bin.max) return bin.id;
  }
  return "unknown";
}

function buildSamples(script, intervalMs) {
  const samples = [];
  const count = Math.floor(script.durationMs / intervalMs);
  for (let i = 0; i <= count; i += 1) {
    const t = Math.min(script.durationMs, i * intervalMs);
    const p = sampleScript(script, t);
    samples.push({ t, x: p.x, y: p.y });
  }
  if (samples[samples.length - 1].t < script.durationMs) {
    const p = sampleScript(script, script.durationMs);
    samples.push({ t: script.durationMs, x: p.x, y: p.y });
  }
  return samples;
}

function anchorTimes(script, count) {
  const margin = Math.max(260, Math.max(...HORIZONS_MS) + 40);
  if (script.durationMs <= margin * 2) return [script.durationMs / 2];
  const times = [];
  const usableStart = margin;
  const usableEnd = script.durationMs - margin;
  for (let i = 0; i < count; i += 1) {
    const f = (i + 0.5) / count;
    times.push(usableStart + (usableEnd - usableStart) * f);
  }
  return times;
}

function historyFor(samples, script, anchorTime, scenario, historyMs) {
  const minTime = anchorTime - historyMs;
  const history = [];
  let newest = null;
  for (const sample of samples) {
    if (sample.t > anchorTime + 1e-6) break;
    if (sample.t >= minTime) newest = sample;
  }
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (sample.t > anchorTime + 1e-6) break;
    if (sample.t < minTime) continue;
    if (newest && sample.t === newest.t) {
      history.push(sample);
      continue;
    }
    const scriptExtra = script.conditions.missingHistoryStress?.suggestedDropRate ?? 0;
    const dropRate = clamp(scenario.dropRate + scriptExtra * (scenario.dropRate > 0 ? 0.5 : 0), 0, 0.75);
    if (unitHash(script.seed, Math.round(anchorTime * 100), i, Math.round(dropRate * 1000)) >= dropRate) {
      history.push(sample);
    }
  }
  if (history.length === 0 && newest) history.push(newest);
  return history;
}

function interpolateSamples(samples, targetTime) {
  if (targetTime <= samples[0].t) return samples[0];
  for (let i = 1; i < samples.length; i += 1) {
    const right = samples[i];
    if (right.t >= targetTime) {
      const left = samples[i - 1];
      const span = right.t - left.t;
      const f = span > 0 ? (targetTime - left.t) / span : 0;
      return {
        t: targetTime,
        x: left.x + (right.x - left.x) * f,
        y: left.y + (right.y - left.y) * f,
      };
    }
  }
  return samples[samples.length - 1];
}

function clampDisplacement(current, x, y, capPx) {
  if (!Number.isFinite(capPx)) return { x, y };
  const dx = x - current.x;
  const dy = y - current.y;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag <= capPx || mag === 0) return { x, y };
  const scale = capPx / mag;
  return { x: current.x + dx * scale, y: current.y + dy * scale };
}

function predictHoldLast(row) {
  const current = row.history[row.history.length - 1];
  return { x: current.x, y: current.y };
}

function predictConstantVelocity(row, params) {
  const h = row.history;
  const current = h[h.length - 1];
  if (h.length < 2) return { x: current.x, y: current.y };
  const prev = h[h.length - 2];
  const dtSec = (current.t - prev.t) / 1000;
  if (dtSec <= 0 || dtSec > 0.12) return { x: current.x, y: current.y };
  const vx = (current.x - prev.x) / dtSec;
  const vy = (current.y - prev.y) / dtSec;
  const horizonSec = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity) / 1000;
  const predicted = {
    x: current.x + vx * horizonSec * (params.gain ?? 1),
    y: current.y + vy * horizonSec * (params.gain ?? 1),
  };
  return clampDisplacement(current, predicted.x, predicted.y, params.displacementCapPx ?? Infinity);
}

function predictLeastSquares(row, params) {
  const current = row.history[row.history.length - 1];
  const minTime = current.t - params.windowMs;
  const points = row.history.filter((p) => p.t >= minTime);
  if (points.length < 3) return predictConstantVelocity(row, { horizonCapMs: params.horizonCapMs, displacementCapPx: params.displacementCapPx });
  let st = 0;
  let stt = 0;
  let sx = 0;
  let sy = 0;
  let stx = 0;
  let sty = 0;
  for (const p of points) {
    const t = p.t - current.t;
    st += t;
    stt += t * t;
    sx += p.x;
    sy += p.y;
    stx += t * p.x;
    sty += t * p.y;
  }
  const n = points.length;
  const denom = n * stt - st * st;
  if (Math.abs(denom) < 1e-9) return { x: current.x, y: current.y };
  const vxMs = (n * stx - st * sx) / denom;
  const vyMs = (n * sty - st * sy) / denom;
  const x0 = (sx - vxMs * st) / n;
  const y0 = (sy - vyMs * st) / n;
  const horizonMs = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity);
  return clampDisplacement(current, x0 + vxMs * horizonMs, y0 + vyMs * horizonMs, params.displacementCapPx ?? Infinity);
}

function predictAlphaBeta(row, params) {
  const current = row.history[row.history.length - 1];
  const minTime = current.t - params.windowMs;
  const points = row.history.filter((p) => p.t >= minTime);
  if (points.length < 2) return { x: current.x, y: current.y };
  let x = points[0].x;
  let y = points[0].y;
  let vx = 0;
  let vy = 0;
  let lastT = points[0].t;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    const dt = (p.t - lastT) / 1000;
    if (dt <= 0 || dt > 0.15) {
      x = p.x;
      y = p.y;
      vx = 0;
      vy = 0;
      lastT = p.t;
      continue;
    }
    const px = x + vx * dt;
    const py = y + vy * dt;
    const rx = p.x - px;
    const ry = p.y - py;
    x = px + params.alpha * rx;
    y = py + params.alpha * ry;
    vx += params.beta * rx / dt;
    vy += params.beta * ry / dt;
    lastT = p.t;
  }
  const horizonSec = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity) / 1000;
  return clampDisplacement(current, x + vx * horizonSec, y + vy * horizonSec, params.displacementCapPx ?? Infinity);
}

function modelList() {
  return [
    { id: "hold_last", family: "hold_last", params: {} },
    { id: "constant_velocity_last2_cap24", family: "constant_velocity_last2", params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 }, currentBaselineEquivalent: true },
    { id: "constant_velocity_last2_cap48", family: "constant_velocity_last2", params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 48 } },
    { id: "least_squares_w50_cap24", family: "least_squares_window", params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 24 } },
    { id: "least_squares_w100_cap24", family: "least_squares_window", params: { windowMs: 100, horizonCapMs: 33.33, displacementCapPx: 24 } },
    { id: "least_squares_w160_cap24", family: "least_squares_window", params: { windowMs: 160, horizonCapMs: 33.33, displacementCapPx: 24 } },
    { id: "alpha_beta_a0p60_b0p12_cap24", family: "alpha_beta", params: { alpha: 0.60, beta: 0.12, windowMs: 160, horizonCapMs: 33.33, displacementCapPx: 24 } },
    { id: "alpha_beta_a0p80_b0p25_cap24", family: "alpha_beta", params: { alpha: 0.80, beta: 0.25, windowMs: 160, horizonCapMs: 33.33, displacementCapPx: 24 } },
  ];
}

function predict(row, model) {
  if (model.family === "hold_last") return predictHoldLast(row);
  if (model.family === "constant_velocity_last2") return predictConstantVelocity(row, model.params);
  if (model.family === "least_squares_window") return predictLeastSquares(row, model.params);
  if (model.family === "alpha_beta") return predictAlphaBeta(row, model.params);
  throw new Error(`Unknown model family: ${model.family}`);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - rank) + sorted[hi] * (rank - lo);
}

function stats(values) {
  const data = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (data.length === 0) {
    return { count: 0, mean: null, rmse: null, p50: null, p90: null, p95: null, p99: null, max: null };
  }
  let sum = 0;
  let sumSq = 0;
  for (const value of data) {
    sum += value;
    sumSq += value * value;
  }
  return {
    count: data.length,
    mean: sum / data.length,
    rmse: Math.sqrt(sumSq / data.length),
    p50: percentile(data, 0.50),
    p90: percentile(data, 0.90),
    p95: percentile(data, 0.95),
    p99: percentile(data, 0.99),
    max: data[data.length - 1],
  };
}

function makeAccumulator(model) {
  return {
    id: model.id,
    family: model.family,
    params: model.params,
    currentBaselineEquivalent: Boolean(model.currentBaselineEquivalent),
    errors: [],
    bySpeed: Object.fromEntries(SPEED_BINS.map((bin) => [bin.id, []])),
    byHorizon: Object.fromEntries(HORIZONS_MS.map((h) => [String(h), []])),
    byMissingScenario: Object.fromEntries(MISSING_SCENARIOS.map((s) => [s.id, []])),
    regressionsVsBaseline: {
      count: 0,
      worseOver1px: 0,
      worseOver3px: 0,
      worseOver5px: 0,
      worseOver10px: 0,
      improvedOver1px: 0,
      improvedOver3px: 0,
      sumDeltaPx: 0,
      meanDeltaPx: null,
    },
  };
}

function addError(acc, row, error, baselineError) {
  acc.errors.push(error);
  acc.bySpeed[row.speedBin].push(error);
  acc.byHorizon[String(row.horizonMs)].push(error);
  acc.byMissingScenario[row.missingScenario].push(error);
  if (Number.isFinite(baselineError)) {
    const delta = error - baselineError;
    acc.regressionsVsBaseline.count += 1;
    acc.regressionsVsBaseline.sumDeltaPx += delta;
    if (delta > 1) acc.regressionsVsBaseline.worseOver1px += 1;
    if (delta > 3) acc.regressionsVsBaseline.worseOver3px += 1;
    if (delta > 5) acc.regressionsVsBaseline.worseOver5px += 1;
    if (delta > 10) acc.regressionsVsBaseline.worseOver10px += 1;
    if (delta < -1) acc.regressionsVsBaseline.improvedOver1px += 1;
    if (delta < -3) acc.regressionsVsBaseline.improvedOver3px += 1;
  }
}

function finalizeAccumulator(acc) {
  const speedBins = {};
  for (const [key, values] of Object.entries(acc.bySpeed)) speedBins[key] = stats(values);
  const horizons = {};
  for (const [key, values] of Object.entries(acc.byHorizon)) horizons[key] = stats(values);
  const missingHistory = {};
  for (const [key, values] of Object.entries(acc.byMissingScenario)) missingHistory[key] = stats(values);
  const regressions = acc.regressionsVsBaseline;
  if (regressions.count > 0) regressions.meanDeltaPx = regressions.sumDeltaPx / regressions.count;
  delete regressions.sumDeltaPx;
  return {
    id: acc.id,
    family: acc.family,
    params: acc.params,
    currentBaselineEquivalent: acc.currentBaselineEquivalent,
    metrics: stats(acc.errors),
    speedBins,
    horizons,
    missingHistory,
    regressionsVsBaseline: regressions,
  };
}

function evaluateScripts(scripts, args) {
  const models = modelList();
  const baselineIndex = models.findIndex((m) => m.currentBaselineEquivalent);
  const accumulators = models.map(makeAccumulator);
  const rowSummary = {
    evaluatedRows: 0,
    rowsByHorizon: Object.fromEntries(HORIZONS_MS.map((h) => [String(h), 0])),
    rowsByMissingScenario: Object.fromEntries(MISSING_SCENARIOS.map((s) => [s.id, 0])),
    rowsBySpeedBin: Object.fromEntries(SPEED_BINS.map((b) => [b.id, 0])),
  };

  for (const script of scripts) {
    const samples = buildSamples(script, args.sampleIntervalMs);
    const anchors = anchorTimes(script, args.anchorsPerScript);
    for (const anchorTime of anchors) {
      const trueSpeed = speedAt(script, anchorTime);
      const bin = speedBin(trueSpeed);
      for (const scenario of MISSING_SCENARIOS) {
        const history = historyFor(samples, script, anchorTime, scenario, args.historyMs);
        if (history.length === 0) continue;
        for (const horizonMs of HORIZONS_MS) {
          const target = sampleScript(script, anchorTime + horizonMs);
          const row = {
            history,
            target,
            horizonMs,
            speedBin: bin,
            missingScenario: scenario.id,
          };
          const predictions = models.map((model) => predict(row, model));
          const errors = predictions.map((p) => dist(p.x, p.y, target.x, target.y));
          const baselineError = errors[baselineIndex];
          for (let i = 0; i < accumulators.length; i += 1) {
            addError(accumulators[i], row, errors[i], baselineError);
          }
          rowSummary.evaluatedRows += 1;
          rowSummary.rowsByHorizon[String(horizonMs)] += 1;
          rowSummary.rowsByMissingScenario[scenario.id] += 1;
          rowSummary.rowsBySpeedBin[bin] += 1;
        }
      }
    }
  }

  const candidates = accumulators.map(finalizeAccumulator);
  candidates.sort((a, b) => selectionScore(a.metrics) - selectionScore(b.metrics));
  return { models, baselineId: models[baselineIndex].id, rowSummary, candidates };
}

function selectionScore(metric) {
  return metric.mean + 0.50 * metric.p95 + 0.25 * metric.p99;
}

function numericSummary(values) {
  return stats(values);
}

function summarizeDataset(scripts, args, generatedAt) {
  const tagCounts = {};
  const boundsCounts = {};
  const durationMs = [];
  const controlPointCounts = [];
  const speedPointCounts = [];
  for (const script of scripts) {
    durationMs.push(script.durationMs);
    controlPointCounts.push(script.controlPoints.length);
    speedPointCounts.push(script.speedProfile.length);
    const boundsKey = `${script.bounds.width}x${script.bounds.height}`;
    boundsCounts[boundsKey] = (boundsCounts[boundsKey] || 0) + 1;
    for (const tag of script.conditions.tags) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  return {
    schemaVersion: DATASET_SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      gpuUsed: false,
      dependencies: "node standard library only",
    },
    policy: {
      canonicalData: "scripts/seeds only",
      scriptSchema: SCHEMA,
      rawZipWritten: false,
      perFrameCsvWritten: false,
      nodeModulesWritten: false,
      checkpointsWritten: false,
      deterministic: true,
      rootSeed: args.seed,
      scriptCount: scripts.length,
      horizonsMs: HORIZONS_MS,
      missingHistoryScenarios: MISSING_SCENARIOS,
      evaluation: {
        onDemandSamplingOnly: true,
        anchorsPerScript: args.anchorsPerScript,
        sampleIntervalMs: args.sampleIntervalMs,
        historyMs: args.historyMs,
      },
    },
    scripts: {
      count: scripts.length,
      boundsCounts,
      tagCounts,
      durationMs: numericSummary(durationMs),
      controlPointCounts: numericSummary(controlPointCounts),
      speedPointCounts: numericSummary(speedPointCounts),
    },
  };
}

function roundObject(value) {
  if (Array.isArray(value)) return value.map(roundObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundObject(v)]));
  }
  if (typeof value === "number" && Number.isFinite(value)) return round(value, 6);
  return value;
}

function renderTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(digits);
}

function renderDatasetMd(dataset) {
  const tagRows = Object.entries(dataset.scripts.tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => [tag, String(count)]);
  const boundsRows = Object.entries(dataset.scripts.boundsCounts)
    .sort()
    .map(([bounds, count]) => [bounds, String(count)]);
  return `# Cursor Prediction v10 Phase 0 Dataset

Generated: ${dataset.generatedAt}

The canonical dataset is \`runs/scripts.synthetic.jsonl\`. No per-frame CSV,
raw ZIP, dependency directory, checkpoint, or cache output was written.

## Policy

- Script schema: \`${dataset.policy.scriptSchema}\`
- Root seed: \`${dataset.policy.rootSeed}\`
- Script count: ${dataset.policy.scriptCount}
- On-demand sampling only: ${dataset.policy.evaluation.onDemandSamplingOnly}
- Anchors per script: ${dataset.policy.evaluation.anchorsPerScript}
- History window: ${dataset.policy.evaluation.historyMs} ms
- Horizons: ${dataset.policy.horizonsMs.join(", ")} ms

## Bounds Mix

${renderTable(["bounds", "scripts"], boundsRows)}

## Condition Tags

${renderTable(["tag", "scripts"], tagRows)}

## Numeric Summary

${renderTable(
    ["field", "mean", "p50", "p95", "max"],
    [
      ["duration ms", fmt(dataset.scripts.durationMs.mean), fmt(dataset.scripts.durationMs.p50), fmt(dataset.scripts.durationMs.p95), fmt(dataset.scripts.durationMs.max)],
      ["control points", fmt(dataset.scripts.controlPointCounts.mean), fmt(dataset.scripts.controlPointCounts.p50), fmt(dataset.scripts.controlPointCounts.p95), fmt(dataset.scripts.controlPointCounts.max)],
      ["speed points", fmt(dataset.scripts.speedPointCounts.mean), fmt(dataset.scripts.speedPointCounts.p50), fmt(dataset.scripts.speedPointCounts.p95), fmt(dataset.scripts.speedPointCounts.max)],
    ],
  )}
`;
}

function renderBaselinesMd(data) {
  const rows = data.candidates.map((c) => [
    c.id,
    c.family,
    c.currentBaselineEquivalent ? "yes" : "",
    fmt(c.metrics.mean),
    fmt(c.metrics.rmse),
    fmt(c.metrics.p50),
    fmt(c.metrics.p90),
    fmt(c.metrics.p95),
    fmt(c.metrics.p99),
    fmt(c.metrics.max),
    String(c.regressionsVsBaseline.worseOver5px),
  ]);
  const missingRows = data.candidates.slice(0, 4).flatMap((c) =>
    Object.entries(c.missingHistory).map(([scenario, metric]) => [
      c.id,
      scenario,
      fmt(metric.mean),
      fmt(metric.p95),
      fmt(metric.p99),
      fmt(metric.max),
    ]),
  );
  return `# Cursor Prediction v10 Phase 1 Baselines

Generated: ${data.generatedAt}

Baseline equivalent: \`${data.baselineId}\`

Evaluated rows: ${data.rowSummary.evaluatedRows}

## Candidates

${renderTable(["candidate", "family", "baseline", "mean", "rmse", "p50", "p90", "p95", "p99", "max", ">5px regressions"], rows)}

## Missing-History Robustness

${renderTable(["candidate", "scenario", "mean", "p95", "p99", "max"], missingRows)}
`;
}

function buildScores(dataset, baselines, generatedAt) {
  const baseline = baselines.candidates.find((c) => c.id === baselines.baselineId);
  const best = baselines.candidates[0];
  return {
    schemaVersion: SCORE_SCHEMA,
    generatedAt,
    pilot: {
      scriptCount: dataset.scripts.count,
      evaluatedRows: baselines.rowSummary.evaluatedRows,
      rootSeed: dataset.policy.rootSeed,
      gpuUsed: false,
      canonicalDataset: "runs/scripts.synthetic.jsonl",
      perFrameCsvWritten: false,
    },
    currentBaselineEquivalent: {
      id: baseline.id,
      metrics: baseline.metrics,
    },
    bestCandidate: {
      id: best.id,
      family: best.family,
      params: best.params,
      metrics: best.metrics,
      regressionsVsBaseline: best.regressionsVsBaseline,
    },
    nextDistributionToIncrease: [
      "near_stop",
      "acute_acceleration",
      "missing_history",
      "edge_proximity",
      "jitter",
    ],
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(roundObject(value), null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const generatedAt = new Date().toISOString();
  fs.mkdirSync(args.outDir, { recursive: true });
  fs.mkdirSync(args.runsDir, { recursive: true });

  const scripts = [];
  for (let i = 0; i < args.count; i += 1) {
    scripts.push(generateScript(args.seed, i));
  }

  const jsonlPath = path.join(args.runsDir, "scripts.synthetic.jsonl");
  fs.writeFileSync(jsonlPath, `${scripts.map((script) => JSON.stringify(script)).join("\n")}\n`, "utf8");

  const dataset = summarizeDataset(scripts, args, generatedAt);
  const baselineEval = evaluateScripts(scripts, args);
  const baselines = {
    schemaVersion: BASELINE_SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    policy: {
      causal: true,
      history: "samples at or before anchor time only",
      label: "script sample at anchor time + horizon",
      horizonsMs: HORIZONS_MS,
      missingHistoryScenarios: MISSING_SCENARIOS,
      baselineEquivalent: baselineEval.baselineId,
    },
    rowSummary: baselineEval.rowSummary,
    baselineId: baselineEval.baselineId,
    candidates: baselineEval.candidates,
  };
  const scores = buildScores(dataset, baselines, generatedAt);

  writeJson(path.join(args.outDir, "phase-0-dataset.json"), dataset);
  fs.writeFileSync(path.join(args.outDir, "phase-0-dataset.md"), renderDatasetMd(roundObject(dataset)), "utf8");
  writeJson(path.join(args.outDir, "phase-1-baselines.json"), baselines);
  fs.writeFileSync(path.join(args.outDir, "phase-1-baselines.md"), renderBaselinesMd(roundObject(baselines)), "utf8");
  writeJson(path.join(args.outDir, "scores.json"), scores);

  process.stdout.write(`Generated ${scripts.length} scripts\n`);
  process.stdout.write(`Evaluated ${baselineEval.rowSummary.evaluatedRows} rows\n`);
  process.stdout.write(`Best candidate: ${scores.bestCandidate.id} mean=${fmt(scores.bestCandidate.metrics.mean)} p95=${fmt(scores.bestCandidate.metrics.p95)} p99=${fmt(scores.bestCandidate.metrics.p99)}\n`);
  process.stdout.write(`Baseline: ${scores.currentBaselineEquivalent.id} mean=${fmt(scores.currentBaselineEquivalent.metrics.mean)} p95=${fmt(scores.currentBaselineEquivalent.metrics.p95)} p99=${fmt(scores.currentBaselineEquivalent.metrics.p99)}\n`);
}

main();
