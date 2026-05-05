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
  count: 10000,
  seed: 20020,
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
  node run-v10-phase2.js [--count 10000] [--seed 20020]
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

const PHASE2_DISTRIBUTION_SCHEMA = "cursor-prediction-v10-phase2-distribution/1";
const PHASE2_ANATOMY_SCHEMA = "cursor-prediction-v10-phase2-regression-anatomy/1";
const PHASE2_GATES_SCHEMA = "cursor-prediction-v10-phase2-safe-gates/1";
const HISTOGRAM_BIN_PX = 0.05;
const HISTOGRAM_MAX_PX = 256;

const PHASE2_TAGS = [
  "near_stop",
  "acute_acceleration",
  "edge_proximity",
  "missing_history",
  "jitter",
  "loop_or_reversal",
  "high_speed",
  "endpoint_stress",
  "smooth_reference",
];

function conditionPlan(index, rng) {
  const tags = [];
  if (index % 2 === 0 || rng() < 0.48) tags.push("high_speed");
  if (index % 3 === 0 || rng() < 0.42) tags.push("acute_acceleration");
  if (index % 4 === 0 || rng() < 0.38) tags.push("edge_proximity");
  if (index % 5 === 0 || rng() < 0.36) tags.push("near_stop");
  if (index % 6 === 0 || rng() < 0.34) tags.push("missing_history");
  if (index % 7 === 0 || rng() < 0.32) tags.push("jitter");
  if (index % 9 === 0 || rng() < 0.22) tags.push("loop_or_reversal");
  if (index % 11 === 0 || rng() < 0.18) tags.push("endpoint_stress");
  if (tags.length === 0) tags.push("smooth_reference");
  return Array.from(new Set(tags));
}

function generateSpeedProfile(rng, tags, maxPoints) {
  const points = [];
  const add = (progress, multiplier, easing, width) => {
    points.push({
      progress: round(clamp(progress, 0, 1), 5),
      multiplier: round(clamp(multiplier, 0.02, 14), 4),
      easing,
      width: round(clamp(width, 0.012, 0.45), 4),
    });
  };

  if (maxPoints === 0) return [];
  if (tags.includes("high_speed")) {
    const p = 0.12 + rng() * 0.76;
    add(p, 4.5 + rng() * 7.5, pick(rng, ["sharp", "smoothstep"]), 0.045 + rng() * 0.16);
    if (rng() < 0.66) add(clamp(p + (rng() * 0.26 - 0.13), 0, 1), 3.0 + rng() * 5.0, "smoothstep", 0.05 + rng() * 0.20);
  }
  if (tags.includes("near_stop")) {
    const p = 0.10 + rng() * 0.8;
    add(p, 0.02 + rng() * 0.06, "smoothstep", 0.06 + rng() * 0.18);
  }
  if (tags.includes("acute_acceleration")) {
    const p = 0.08 + rng() * 0.84;
    add(p, 3.4 + rng() * 6.8, "sharp", 0.018 + rng() * 0.055);
    add(clamp(p + 0.035 + rng() * 0.16, 0, 1), 0.10 + rng() * 0.45, "sharp", 0.025 + rng() * 0.08);
  }
  if (tags.includes("endpoint_stress")) {
    add(rng() < 0.5 ? 0.03 + rng() * 0.08 : 0.89 + rng() * 0.08, 3.0 + rng() * 5.5, "sharp", 0.02 + rng() * 0.07);
  }

  while (points.length < maxPoints && rng() < 0.78) {
    add(rng(), 0.12 + rng() * 4.2, pick(rng, ["linear", "smoothstep", "sharp"]), 0.025 + rng() * 0.26);
  }

  points.sort((a, b) => a.progress - b.progress);
  return points.slice(0, maxPoints);
}

function generateScript(rootSeed, index) {
  const scriptSeed = hash32(rootSeed, index + 1, 0x2f6e2b1);
  const rng = mulberry32(scriptSeed);
  const tags = conditionPlan(index, rng);
  const bounds = tags.includes("high_speed") && rng() < 0.72 ? pick(rng, BOUNDS.slice(1)) : pick(rng, BOUNDS);
  const highSpeed = tags.includes("high_speed");
  const durationMs = round(highSpeed ? 650 + rng() * 2900 : 1600 + rng() * 9800, 3);
  const pointCount = highSpeed ? 2 + Math.floor(rng() * 8) : 2 + Math.floor(rng() * 16);
  const speedPointCount = Math.floor(rng() * (highSpeed ? 40 : 34));
  const nearEdge = tags.includes("edge_proximity");
  let start = choosePoint(rng, bounds, nearEdge);
  let end = choosePoint(rng, bounds, nearEdge || highSpeed || rng() < 0.35);
  if (highSpeed && dist(start.x, start.y, end.x, end.y) < Math.min(bounds.width, bounds.height) * 0.85) {
    start = point(bounds.width * (rng() < 0.5 ? 0.02 : 0.98), bounds.height * rng());
    end = point(bounds.width * (start.x < bounds.width / 2 ? 0.98 : 0.02), bounds.height * rng());
  }

  const controlPoints = [start];
  const wander = tags.includes("loop_or_reversal") ? 1.15 : highSpeed ? 0.22 : 0.48;
  for (let i = 1; i < pointCount - 1; i += 1) {
    const t = i / (pointCount - 1);
    const baseX = start.x + (end.x - start.x) * t;
    const baseY = start.y + (end.y - start.y) * t;
    const ampX = bounds.width * wander * (0.20 + rng() * 0.80);
    const ampY = bounds.height * wander * (0.20 + rng() * 0.80);
    const curveBias = Math.sin((t + rng() * 0.5) * Math.PI * (tags.includes("loop_or_reversal") ? 3 : 1));
    const x = clamp(baseX + (rng() * 2 - 1) * ampX + curveBias * ampX * 0.18, 0, bounds.width);
    const y = clamp(baseY + (rng() * 2 - 1) * ampY - curveBias * ampY * 0.18, 0, bounds.height);
    controlPoints.push(point(x, y));
  }
  controlPoints.push(end);

  const jitter = tags.includes("jitter")
    ? {
      amplitudePx: round((highSpeed ? 2.2 : 1.2) + rng() * (highSpeed ? 8.5 : 5.8), 3),
      frequencyHz: round(7 + rng() * 38, 3),
      phaseX: round(rng() * Math.PI * 2, 5),
      phaseY: round(rng() * Math.PI * 2, 5),
    }
    : null;

  return {
    schemaVersion: SCHEMA,
    id: `synthetic-phase2-${String(index).padStart(6, "0")}`,
    seed: scriptSeed,
    bounds,
    durationMs,
    controlPoints,
    speedProfile: generateSpeedProfile(rng, tags, speedPointCount),
    conditions: {
      tags,
      jitter,
      missingHistoryStress: tags.includes("missing_history")
        ? { suggestedDropRate: round(0.20 + rng() * 0.45, 3), burstiness: round(0.35 + rng() * 0.55, 3) }
        : null,
    },
  };
}

function metricAccumulator() {
  return {
    count: 0,
    sum: 0,
    sumSq: 0,
    max: 0,
    hist: new Uint32Array(Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 2),
  };
}

function addMetric(acc, value) {
  if (!Number.isFinite(value)) return;
  acc.count += 1;
  acc.sum += value;
  acc.sumSq += value * value;
  if (value > acc.max) acc.max = value;
  const idx = Math.min(acc.hist.length - 1, Math.max(0, Math.floor(value / HISTOGRAM_BIN_PX)));
  acc.hist[idx] += 1;
}

function percentileFromHist(acc, p) {
  if (acc.count === 0) return null;
  const target = Math.max(1, Math.ceil(acc.count * p));
  let seen = 0;
  for (let i = 0; i < acc.hist.length; i += 1) {
    seen += acc.hist[i];
    if (seen >= target) return Math.min(acc.max, (i + 0.5) * HISTOGRAM_BIN_PX);
  }
  return acc.max;
}

function finalizeMetric(acc) {
  if (acc.count === 0) return { count: 0, mean: null, rmse: null, p50: null, p90: null, p95: null, p99: null, max: null };
  return {
    count: acc.count,
    mean: acc.sum / acc.count,
    rmse: Math.sqrt(acc.sumSq / acc.count),
    p50: percentileFromHist(acc, 0.50),
    p90: percentileFromHist(acc, 0.90),
    p95: percentileFromHist(acc, 0.95),
    p99: percentileFromHist(acc, 0.99),
    max: acc.max,
  };
}

function makeBucketAccumulator(keys) {
  return Object.fromEntries(keys.map((key) => [key, metricAccumulator()]));
}

function makeCandidateAccumulator(model) {
  return {
    id: model.id,
    family: model.family,
    params: model.params,
    currentBaselineEquivalent: Boolean(model.currentBaselineEquivalent),
    metric: metricAccumulator(),
    bySpeed: makeBucketAccumulator(SPEED_BINS.map((b) => b.id)),
    byHorizon: makeBucketAccumulator(HORIZONS_MS.map(String)),
    byMissingScenario: makeBucketAccumulator(MISSING_SCENARIOS.map((s) => s.id)),
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
    anatomy: makeAnatomyAccumulator(),
    gateUses: { advanced: 0, fallback: 0 },
  };
}

function makeAnatomyAccumulator() {
  return {
    overall: anatomyBucket(),
    speed: Object.fromEntries(SPEED_BINS.map((b) => [b.id, anatomyBucket()])),
    horizon: Object.fromEntries(HORIZONS_MS.map((h) => [String(h), anatomyBucket()])),
    missingScenario: Object.fromEntries(MISSING_SCENARIOS.map((s) => [s.id, anatomyBucket()])),
    tag: Object.fromEntries(PHASE2_TAGS.map((tag) => [tag, anatomyBucket()])),
    edgeDistance: Object.fromEntries(["0-8", "8-24", "24-64", ">=64"].map((b) => [b, anatomyBucket()])),
    curvature: Object.fromEntries(["0-10", "10-30", "30-60", ">=60"].map((b) => [b, anatomyBucket()])),
    acceleration: Object.fromEntries(["0-2000", "2000-8000", "8000-20000", ">=20000"].map((b) => [b, anatomyBucket()])),
    historyCount: Object.fromEntries(["1-2", "3-5", "6-12", ">=13"].map((b) => [b, anatomyBucket()])),
  };
}

function anatomyBucket() {
  return {
    rows: 0,
    worseOver1px: 0,
    worseOver3px: 0,
    worseOver5px: 0,
    worseOver10px: 0,
    improvedOver1px: 0,
    improvedOver3px: 0,
    sumDeltaPx: 0,
    meanDeltaPx: null,
  };
}

function addAnatomy(bucket, delta) {
  bucket.rows += 1;
  bucket.sumDeltaPx += delta;
  if (delta > 1) bucket.worseOver1px += 1;
  if (delta > 3) bucket.worseOver3px += 1;
  if (delta > 5) bucket.worseOver5px += 1;
  if (delta > 10) bucket.worseOver10px += 1;
  if (delta < -1) bucket.improvedOver1px += 1;
  if (delta < -3) bucket.improvedOver3px += 1;
}

function finalizeAnatomy(value) {
  if (value && typeof value.rows === "number") {
    if (value.rows > 0) value.meanDeltaPx = value.sumDeltaPx / value.rows;
    delete value.sumDeltaPx;
    return value;
  }
  for (const item of Object.values(value)) finalizeAnatomy(item);
  return value;
}

function addCandidateError(acc, row, error, baselineError) {
  addMetric(acc.metric, error);
  addMetric(acc.bySpeed[row.features.speedBin], error);
  addMetric(acc.byHorizon[String(row.horizonMs)], error);
  addMetric(acc.byMissingScenario[row.missingScenario], error);
  if (Number.isFinite(baselineError)) {
    const delta = error - baselineError;
    const reg = acc.regressionsVsBaseline;
    reg.count += 1;
    reg.sumDeltaPx += delta;
    if (delta > 1) reg.worseOver1px += 1;
    if (delta > 3) reg.worseOver3px += 1;
    if (delta > 5) reg.worseOver5px += 1;
    if (delta > 10) reg.worseOver10px += 1;
    if (delta < -1) reg.improvedOver1px += 1;
    if (delta < -3) reg.improvedOver3px += 1;
    addAnatomy(acc.anatomy.overall, delta);
    addAnatomy(acc.anatomy.speed[row.features.speedBin], delta);
    addAnatomy(acc.anatomy.horizon[String(row.horizonMs)], delta);
    addAnatomy(acc.anatomy.missingScenario[row.missingScenario], delta);
    for (const tag of row.features.tags) addAnatomy(acc.anatomy.tag[tag] || acc.anatomy.tag.smooth_reference, delta);
    addAnatomy(acc.anatomy.edgeDistance[row.features.edgeDistanceBin], delta);
    addAnatomy(acc.anatomy.curvature[row.features.curvatureBin], delta);
    addAnatomy(acc.anatomy.acceleration[row.features.accelerationBin], delta);
    addAnatomy(acc.anatomy.historyCount[row.features.historyCountBin], delta);
  }
}

function finalizeCandidateAccumulator(acc) {
  const speedBins = {};
  for (const [key, value] of Object.entries(acc.bySpeed)) speedBins[key] = finalizeMetric(value);
  const horizons = {};
  for (const [key, value] of Object.entries(acc.byHorizon)) horizons[key] = finalizeMetric(value);
  const missingHistory = {};
  for (const [key, value] of Object.entries(acc.byMissingScenario)) missingHistory[key] = finalizeMetric(value);
  const regressions = acc.regressionsVsBaseline;
  if (regressions.count > 0) regressions.meanDeltaPx = regressions.sumDeltaPx / regressions.count;
  delete regressions.sumDeltaPx;
  return {
    id: acc.id,
    family: acc.family,
    params: acc.params,
    currentBaselineEquivalent: acc.currentBaselineEquivalent,
    metrics: finalizeMetric(acc.metric),
    speedBins,
    horizons,
    missingHistory,
    regressionsVsBaseline: regressions,
    gateUses: acc.gateUses,
    anatomy: finalizeAnatomy(acc.anatomy),
  };
}

function candidateModelList() {
  const models = [
    { id: "constant_velocity_last2_cap24", family: "constant_velocity_last2", params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 }, currentBaselineEquivalent: true },
  ];
  for (const windowMs of [25, 40, 50, 70, 100, 160]) {
    const caps = windowMs === 50 || windowMs === 70 ? [12, 18, 24, 36] : [18, 24, 36];
    for (const cap of caps) {
      models.push({ id: `least_squares_w${windowMs}_cap${cap}`, family: "least_squares_window", params: { windowMs, horizonCapMs: 33.33, displacementCapPx: cap } });
    }
  }
  for (const [alpha, beta] of [[0.45, 0.08], [0.60, 0.12], [0.70, 0.18], [0.80, 0.25], [0.90, 0.30]]) {
    for (const cap of [18, 24]) {
      models.push({ id: `alpha_beta_a${idNum(alpha)}_b${idNum(beta)}_cap${cap}`, family: "alpha_beta", params: { alpha, beta, windowMs: 160, horizonCapMs: 33.33, displacementCapPx: cap } });
    }
  }
  for (const windowMs of [40, 50, 70, 100]) {
    for (const weight of [0.25, 0.5, 0.75]) {
      models.push({
        id: `blend_cv_ls_w${windowMs}_cap24_ls${idNum(weight)}`,
        family: "blend",
        params: {
          weightB: weight,
          a: { family: "constant_velocity_last2", params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 } },
          b: { family: "least_squares_window", params: { windowMs, horizonCapMs: 33.33, displacementCapPx: 24 } },
        },
      });
    }
  }
  const baseForGates = [
    models.find((m) => m.id === "least_squares_w50_cap24"),
    models.find((m) => m.id === "least_squares_w70_cap24"),
    models.find((m) => m.id === "least_squares_w100_cap24"),
    models.find((m) => m.id === "alpha_beta_a0p60_b0p12_cap24"),
    models.find((m) => m.id === "blend_cv_ls_w50_cap24_ls0p5"),
  ].filter(Boolean);
  const gateGrid = [
    { minHistoryCount: 6, maxAcceleration: 20000, minEdgeDistance: 0, maxCurvature: 180, excludeMissing25: false, maxObservedSpeed: 4200 },
    { minHistoryCount: 6, maxAcceleration: 12000, minEdgeDistance: 8, maxCurvature: 90, excludeMissing25: false, maxObservedSpeed: 3600 },
    { minHistoryCount: 8, maxAcceleration: 8000, minEdgeDistance: 12, maxCurvature: 60, excludeMissing25: true, maxObservedSpeed: 3000 },
    { minHistoryCount: 10, maxAcceleration: 6000, minEdgeDistance: 24, maxCurvature: 45, excludeMissing25: true, maxObservedSpeed: 2400 },
    { minHistoryCount: 6, maxAcceleration: 10000, minEdgeDistance: 0, maxCurvature: 45, excludeMissing25: true, maxObservedSpeed: 2800 },
  ];
  for (const base of baseForGates) {
    for (let i = 0; i < gateGrid.length; i += 1) {
      models.push({
        id: `safe_gate_${base.id}_g${i + 1}`,
        family: "safe_gate",
        params: {
          base: { family: base.family, params: base.params },
          fallback: { family: "constant_velocity_last2", params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 } },
          conditions: gateGrid[i],
        },
      });
    }
  }
  return models;
}

function idNum(value) {
  return String(value).replace(".", "p");
}

function predict(row, model) {
  if (model.family === "hold_last") return predictHoldLast(row);
  if (model.family === "constant_velocity_last2") return predictConstantVelocity(row, model.params);
  if (model.family === "least_squares_window") return predictLeastSquares(row, model.params);
  if (model.family === "alpha_beta") return predictAlphaBeta(row, model.params);
  if (model.family === "blend") {
    const a = predict(row, model.params.a);
    const b = predict(row, model.params.b);
    const w = model.params.weightB;
    return { x: a.x * (1 - w) + b.x * w, y: a.y * (1 - w) + b.y * w };
  }
  if (model.family === "safe_gate") return passesSafeGate(row, model.params.conditions) ? predict(row, model.params.base) : predict(row, model.params.fallback);
  throw new Error(`Unknown model family: ${model.family}`);
}

function passesSafeGate(row, conditions) {
  const f = row.features;
  if (f.historyCount < conditions.minHistoryCount) return false;
  if (conditions.excludeMissing25 && row.missingScenario === "missing_25pct") return false;
  if (f.edgeDistancePx < conditions.minEdgeDistance) return false;
  if (f.accelerationPxPerSec2 > conditions.maxAcceleration) return false;
  if (f.curvatureDeg > conditions.maxCurvature) return false;
  if (f.observedSpeedPxPerSec > conditions.maxObservedSpeed) return false;
  return true;
}

function rowFeatures(script, history, anchorTime, trueSpeed) {
  const current = history[history.length - 1];
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const prev2 = history.length >= 3 ? history[history.length - 3] : null;
  const edgeDistancePx = Math.min(current.x, current.y, script.bounds.width - current.x, script.bounds.height - current.y);
  const observedSpeedPxPerSec = prev ? velocityBetween(prev, current).speed : 0;
  let accelerationPxPerSec2 = 0;
  let curvatureDeg = 0;
  if (prev && prev2) {
    const v0 = velocityBetween(prev2, prev);
    const v1 = velocityBetween(prev, current);
    const dt = Math.max(0.001, (current.t - prev.t) / 1000);
    accelerationPxPerSec2 = dist(v0.vx, v0.vy, v1.vx, v1.vy) / dt;
    curvatureDeg = angleBetweenDeg(v0.vx, v0.vy, v1.vx, v1.vy);
  }
  return {
    anchorTime,
    tags: script.conditions.tags,
    trueSpeedPxPerSec: trueSpeed,
    observedSpeedPxPerSec,
    accelerationPxPerSec2,
    curvatureDeg,
    historyCount: history.length,
    edgeDistancePx,
    speedBin: speedBin(trueSpeed),
    edgeDistanceBin: edgeDistanceBin(edgeDistancePx),
    curvatureBin: curvatureBin(curvatureDeg),
    accelerationBin: accelerationBin(accelerationPxPerSec2),
    historyCountBin: historyCountBin(history.length),
  };
}

function velocityBetween(a, b) {
  const dt = Math.max(0.001, (b.t - a.t) / 1000);
  const vx = (b.x - a.x) / dt;
  const vy = (b.y - a.y) / dt;
  return { vx, vy, speed: Math.sqrt(vx * vx + vy * vy) };
}

function angleBetweenDeg(ax, ay, bx, by) {
  const am = Math.sqrt(ax * ax + ay * ay);
  const bm = Math.sqrt(bx * bx + by * by);
  if (am < 1e-6 || bm < 1e-6) return 0;
  const c = clamp((ax * bx + ay * by) / (am * bm), -1, 1);
  return Math.acos(c) * 180 / Math.PI;
}

function edgeDistanceBin(value) {
  if (value < 8) return "0-8";
  if (value < 24) return "8-24";
  if (value < 64) return "24-64";
  return ">=64";
}

function curvatureBin(value) {
  if (value < 10) return "0-10";
  if (value < 30) return "10-30";
  if (value < 60) return "30-60";
  return ">=60";
}

function accelerationBin(value) {
  if (value < 2000) return "0-2000";
  if (value < 8000) return "2000-8000";
  if (value < 20000) return "8000-20000";
  return ">=20000";
}

function historyCountBin(value) {
  if (value <= 2) return "1-2";
  if (value <= 5) return "3-5";
  if (value <= 12) return "6-12";
  return ">=13";
}

function evaluateScripts(scripts, args) {
  const models = candidateModelList();
  const baselineIndex = models.findIndex((m) => m.currentBaselineEquivalent);
  const accumulators = models.map(makeCandidateAccumulator);
  const rowSummary = {
    evaluatedRows: 0,
    rowsByHorizon: Object.fromEntries(HORIZONS_MS.map((h) => [String(h), 0])),
    rowsByMissingScenario: Object.fromEntries(MISSING_SCENARIOS.map((s) => [s.id, 0])),
    rowsBySpeedBin: Object.fromEntries(SPEED_BINS.map((b) => [b.id, 0])),
    rowsByTag: Object.fromEntries(PHASE2_TAGS.map((tag) => [tag, 0])),
    rowsByEdgeDistance: { "0-8": 0, "8-24": 0, "24-64": 0, ">=64": 0 },
    rowsByCurvature: { "0-10": 0, "10-30": 0, "30-60": 0, ">=60": 0 },
    rowsByAcceleration: { "0-2000": 0, "2000-8000": 0, "8000-20000": 0, ">=20000": 0 },
    rowsByHistoryCount: { "1-2": 0, "3-5": 0, "6-12": 0, ">=13": 0 },
  };

  for (const script of scripts) {
    const samples = buildSamples(script, args.sampleIntervalMs);
    const anchors = anchorTimes(script, args.anchorsPerScript);
    for (const anchorTime of anchors) {
      const trueSpeed = speedAt(script, anchorTime);
      for (const scenario of MISSING_SCENARIOS) {
        const history = historyFor(samples, script, anchorTime, scenario, args.historyMs);
        if (history.length === 0) continue;
        const features = rowFeatures(script, history, anchorTime, trueSpeed);
        for (const horizonMs of HORIZONS_MS) {
          const target = sampleScript(script, anchorTime + horizonMs);
          const row = { history, target, horizonMs, missingScenario: scenario.id, features };
          const predictions = models.map((model) => predict(row, model));
          const errors = predictions.map((p) => dist(p.x, p.y, target.x, target.y));
          const baselineError = errors[baselineIndex];
          for (let i = 0; i < accumulators.length; i += 1) {
            if (models[i].family === "safe_gate") {
              if (passesSafeGate(row, models[i].params.conditions)) accumulators[i].gateUses.advanced += 1;
              else accumulators[i].gateUses.fallback += 1;
            }
            addCandidateError(accumulators[i], row, errors[i], baselineError);
          }
          rowSummary.evaluatedRows += 1;
          rowSummary.rowsByHorizon[String(horizonMs)] += 1;
          rowSummary.rowsByMissingScenario[scenario.id] += 1;
          rowSummary.rowsBySpeedBin[features.speedBin] += 1;
          for (const tag of features.tags) rowSummary.rowsByTag[tag] = (rowSummary.rowsByTag[tag] || 0) + 1;
          rowSummary.rowsByEdgeDistance[features.edgeDistanceBin] += 1;
          rowSummary.rowsByCurvature[features.curvatureBin] += 1;
          rowSummary.rowsByAcceleration[features.accelerationBin] += 1;
          rowSummary.rowsByHistoryCount[features.historyCountBin] += 1;
        }
      }
    }
  }

  const candidates = accumulators.map(finalizeCandidateAccumulator);
  candidates.sort((a, b) => selectionScore(a.metrics) - selectionScore(b.metrics));
  return { models, baselineId: models[baselineIndex].id, rowSummary, candidates };
}

function rawCandidate(candidates) {
  return candidates.find((c) => !c.currentBaselineEquivalent && c.family !== "safe_gate");
}

function bestSafeGate(candidates) {
  return candidates
    .filter((c) => c.family === "safe_gate")
    .sort((a, b) => safeGateScore(a) - safeGateScore(b))[0];
}

function safeGateScore(candidate) {
  const regRate = candidate.regressionsVsBaseline.worseOver5px / Math.max(1, candidate.regressionsVsBaseline.count);
  return selectionScore(candidate.metrics) + regRate * 90;
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
    schemaVersion: PHASE2_DISTRIBUTION_SCHEMA,
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
      canonicalData: "script JSONL only",
      canonicalDataset: "runs/scripts.synthetic.phase2.jsonl",
      scriptSchema: SCHEMA,
      rawZipWritten: false,
      perFrameCsvWritten: false,
      nodeModulesWritten: false,
      checkpointsWritten: false,
      cacheWritten: false,
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

function buildPhase2Scores(existingScores, dataset, evaluation, anatomy, gates, generatedAt) {
  const baseline = evaluation.candidates.find((c) => c.id === evaluation.baselineId);
  const bestRaw = rawCandidate(evaluation.candidates);
  const bestGate = bestSafeGate(evaluation.candidates);
  return {
    ...existingScores,
    schemaVersion: SCORE_SCHEMA,
    generatedAt,
    phase2: {
      scriptCount: dataset.scripts.count,
      evaluatedRows: evaluation.rowSummary.evaluatedRows,
      rootSeed: dataset.policy.rootSeed,
      gpuUsed: false,
      canonicalDataset: "runs/scripts.synthetic.phase2.jsonl",
      perFrameCsvWritten: false,
      rowsBySpeedBin: evaluation.rowSummary.rowsBySpeedBin,
      currentBaselineEquivalent: {
        id: baseline.id,
        metrics: baseline.metrics,
      },
      bestRawCandidate: {
        id: bestRaw.id,
        family: bestRaw.family,
        params: bestRaw.params,
        metrics: bestRaw.metrics,
        regressionsVsBaseline: bestRaw.regressionsVsBaseline,
      },
      bestSafeGate: {
        id: bestGate.id,
        family: bestGate.family,
        params: bestGate.params,
        metrics: bestGate.metrics,
        regressionsVsBaseline: bestGate.regressionsVsBaseline,
        gateUses: bestGate.gateUses,
      },
      anatomySummary: anatomy.summary,
      safeGateSummary: gates.summary,
    },
  };
}

function buildAnatomy(evaluation, generatedAt) {
  const bestRaw = rawCandidate(evaluation.candidates);
  return {
    schemaVersion: PHASE2_ANATOMY_SCHEMA,
    generatedAt,
    baselineId: evaluation.baselineId,
    rawCandidateId: bestRaw.id,
    rowSummary: evaluation.rowSummary,
    summary: summarizeAnatomy(bestRaw.anatomy),
    anatomy: bestRaw.anatomy,
  };
}

function summarizeAnatomy(anatomy) {
  return {
    worstSpeedBins: topRegressionBuckets(anatomy.speed),
    worstHorizons: topRegressionBuckets(anatomy.horizon),
    worstMissingScenarios: topRegressionBuckets(anatomy.missingScenario),
    worstTags: topRegressionBuckets(anatomy.tag),
    worstEdgeDistance: topRegressionBuckets(anatomy.edgeDistance),
    worstCurvature: topRegressionBuckets(anatomy.curvature),
    worstAcceleration: topRegressionBuckets(anatomy.acceleration),
    worstHistoryCount: topRegressionBuckets(anatomy.historyCount),
    bestImprovementTags: topImprovementBuckets(anatomy.tag),
  };
}

function topRegressionBuckets(group) {
  return Object.entries(group)
    .filter(([, b]) => b.rows > 0)
    .map(([bucket, b]) => ({
      bucket,
      rows: b.rows,
      worseOver5px: b.worseOver5px,
      worseOver5Rate: b.worseOver5px / b.rows,
      worseOver10px: b.worseOver10px,
      meanDeltaPx: b.meanDeltaPx,
    }))
    .sort((a, b) => b.worseOver5Rate - a.worseOver5Rate || b.worseOver5px - a.worseOver5px)
    .slice(0, 6);
}

function topImprovementBuckets(group) {
  return Object.entries(group)
    .filter(([, b]) => b.rows > 0)
    .map(([bucket, b]) => ({
      bucket,
      rows: b.rows,
      improvedOver3px: b.improvedOver3px,
      improvedOver3Rate: b.improvedOver3px / b.rows,
      meanDeltaPx: b.meanDeltaPx,
    }))
    .sort((a, b) => b.improvedOver3Rate - a.improvedOver3Rate || a.meanDeltaPx - b.meanDeltaPx)
    .slice(0, 6);
}

function buildSafeGates(evaluation, generatedAt) {
  const safeGates = evaluation.candidates.filter((c) => c.family === "safe_gate").sort((a, b) => safeGateScore(a) - safeGateScore(b));
  return {
    schemaVersion: PHASE2_GATES_SCHEMA,
    generatedAt,
    baselineId: evaluation.baselineId,
    selection: "mean + 0.50*p95 + 0.25*p99 + 90*worseOver5Rate",
    summary: {
      bestSafeGateId: safeGates[0].id,
      bestSafeGateScore: safeGateScore(safeGates[0]),
      testedSafeGates: safeGates.length,
    },
    safeGates: safeGates.map((gate) => ({
      id: gate.id,
      params: gate.params,
      metrics: gate.metrics,
      regressionsVsBaseline: gate.regressionsVsBaseline,
      gateUses: gate.gateUses,
      selectionScore: selectionScore(gate.metrics),
      safeGateScore: safeGateScore(gate),
    })),
  };
}

function renderDistributionMd(dataset, rowSummary, jsonlBytes) {
  const tagRows = Object.entries(dataset.scripts.tagCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)]);
  const speedRows = Object.entries(rowSummary.rowsBySpeedBin).map(([k, v]) => [k, String(v)]);
  return `# Cursor Prediction v10 Phase 2 Distribution

Generated: ${dataset.generatedAt}

Canonical data: \`runs/scripts.synthetic.phase2.jsonl\` (${formatBytes(jsonlBytes)}). No per-frame CSV, raw ZIP, dependency directory, checkpoint, or cache output was written.

## Policy

- Script count: ${dataset.scripts.count}
- Root seed: \`${dataset.policy.rootSeed}\`
- GPU used: no
- Evaluation rows: ${rowSummary.evaluatedRows}
- Anchors per script: ${dataset.policy.evaluation.anchorsPerScript}
- History window: ${dataset.policy.evaluation.historyMs} ms

## Script Tags

${renderTable(["tag", "scripts"], tagRows)}

## Evaluation Speed Mix

${renderTable(["speed bin", "rows"], speedRows)}

Phase 2 intentionally thickens high-speed, acute acceleration, near-stop, missing-history, jitter, and edge-proximity cases. The \`>=2000px/s\` bin now has ${rowSummary.rowsBySpeedBin[">=2000"]} evaluated rows, well above the phase 1 count of 132.
`;
}

function renderAnatomyMd(data) {
  const s = data.summary;
  return `# Cursor Prediction v10 Phase 2 Regression Anatomy

Generated: ${data.generatedAt}

Raw candidate analyzed: \`${data.rawCandidateId}\` against \`${data.baselineId}\`.

## Where Regressions Concentrate

${renderTable(["dimension", "bucket", "rows", ">5px", ">5 rate", ">10px", "mean delta"], [
    ...summaryRows("speed", s.worstSpeedBins),
    ...summaryRows("horizon", s.worstHorizons),
    ...summaryRows("missing", s.worstMissingScenarios),
    ...summaryRows("tag", s.worstTags),
    ...summaryRows("edge", s.worstEdgeDistance),
    ...summaryRows("curvature", s.worstCurvature),
    ...summaryRows("accel", s.worstAcceleration),
    ...summaryRows("history", s.worstHistoryCount),
  ])}

## Better Regions

${renderTable(["tag", "rows", ">3px improvements", ">3 rate", "mean delta"], s.bestImprovementTags.map((r) => [r.bucket, String(r.rows), String(r.improvedOver3px), fmt(r.improvedOver3Rate, 4), fmt(r.meanDeltaPx)]))}

The raw model is strongest in smooth, high-speed spans where recent motion remains coherent. Regressions cluster when recent samples imply sharp acceleration or curvature, sparse/missing history, and edge-clamped motion. Those are exactly the conditions used by the safe gates to fall back to the current baseline.
`;
}

function renderSafeGatesMd(data) {
  const rows = data.safeGates.slice(0, 12).map((g) => [
    g.id,
    fmt(g.metrics.mean),
    fmt(g.metrics.p95),
    fmt(g.metrics.p99),
    fmt(g.metrics.max),
    String(g.regressionsVsBaseline.worseOver5px),
    String(g.regressionsVsBaseline.worseOver10px),
    `${g.gateUses.advanced}/${g.gateUses.fallback}`,
    fmt(g.safeGateScore),
  ]);
  const best = data.safeGates[0];
  return `# Cursor Prediction v10 Phase 2 Safe Gates

Generated: ${data.generatedAt}

Best safe gate: \`${best.id}\`.

Selection: ${data.selection}

## Top Gates

${renderTable(["gate", "mean", "p95", "p99", "max", ">5px reg", ">10px reg", "advanced/fallback", "safe score"], rows)}

The winning gate keeps the advanced predictor only when history is sufficiently dense and recent motion is not dominated by high acceleration, high curvature, very small edge distance, or the noisiest missing-history scenario. The fallback remains \`${data.baselineId}\`.
`;
}

function summaryRows(name, rows) {
  return rows.map((r) => [name, r.bucket, String(r.rows), String(r.worseOver5px), fmt(r.worseOver5Rate, 4), String(r.worseOver10px), fmt(r.meanDeltaPx)]);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 1)} KB`;
  return `${fmt(bytes / 1024 / 1024, 2)} MB`;
}

function readExistingScores(outDir) {
  const scoresPath = path.join(outDir, "scores.json");
  if (!fs.existsSync(scoresPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(scoresPath, "utf8"));
  } catch {
    return {};
  }
}

function appendExperimentLog(outDir, generatedAt, args, evaluation, dataset, jsonlBytes, bestRaw, bestGate, elapsedSec) {
  const text = `
## ${jstStamp(generatedAt)} - Phase 2 Distribution and Safe Gates

Environment:

- Node.js: \`${process.version}\`
- GPU used: no
- Dependency install: none

Command:

\`\`\`powershell
node poc\\cursor-prediction-v10\\scripts\\run-v10-phase2.js --count ${args.count} --seed ${args.seed}
\`\`\`

Result:

- generated ${dataset.scripts.count} scripts;
- evaluated ${evaluation.rowSummary.evaluatedRows} rows;
- canonical script JSONL: \`runs/scripts.synthetic.phase2.jsonl\` (${formatBytes(jsonlBytes)});
- \`>=2000px/s\` rows: ${evaluation.rowSummary.rowsBySpeedBin[">=2000"]};
- best raw candidate: \`${bestRaw.id}\`, p95/p99/max ${fmt(bestRaw.metrics.p95)} / ${fmt(bestRaw.metrics.p99)} / ${fmt(bestRaw.metrics.max)} px, >5px regressions ${bestRaw.regressionsVsBaseline.worseOver5px};
- best safe gate: \`${bestGate.id}\`, p95/p99/max ${fmt(bestGate.metrics.p95)} / ${fmt(bestGate.metrics.p99)} / ${fmt(bestGate.metrics.max)} px, >5px regressions ${bestGate.regressionsVsBaseline.worseOver5px}.

Judgment:

- Phase 2 keeps the script JSONL as canonical data and avoids per-frame CSV or large intermediate artifacts.
- Safe gates reduce exposure in sparse, high-curvature, high-acceleration, and edge-proximate rows while preserving most of the raw model's improvement in coherent motion.
- Runtime: ${fmt(elapsedSec, 2)} seconds on CPU.
`;
  fs.appendFileSync(path.join(outDir, "experiment-log.md"), text, "utf8");
}

function jstStamp(iso) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} JST`;
}

function main() {
  const args = parseArgs(process.argv);
  const started = Date.now();
  const generatedAt = new Date().toISOString();
  fs.mkdirSync(args.outDir, { recursive: true });
  fs.mkdirSync(args.runsDir, { recursive: true });

  const scripts = [];
  for (let i = 0; i < args.count; i += 1) {
    scripts.push(generateScript(args.seed, i));
  }

  const jsonlPath = path.join(args.runsDir, "scripts.synthetic.phase2.jsonl");
  fs.writeFileSync(jsonlPath, `${scripts.map((script) => JSON.stringify(script)).join("\n")}\n`, "utf8");
  const jsonlBytes = fs.statSync(jsonlPath).size;

  const dataset = summarizeDataset(scripts, args, generatedAt);
  const evaluation = evaluateScripts(scripts, args);
  const anatomy = buildAnatomy(evaluation, generatedAt);
  const gates = buildSafeGates(evaluation, generatedAt);
  const existingScores = readExistingScores(args.outDir);
  const scores = buildPhase2Scores(existingScores, dataset, evaluation, anatomy, gates, generatedAt);
  const bestRaw = rawCandidate(evaluation.candidates);
  const bestGate = bestSafeGate(evaluation.candidates);

  const phase2Candidates = {
    schemaVersion: "cursor-prediction-v10-phase2-candidates/1",
    generatedAt,
    command: process.argv.join(" "),
    policy: {
      causal: true,
      history: "samples at or before anchor time only",
      label: "script sample at anchor time + horizon",
      horizonsMs: HORIZONS_MS,
      missingHistoryScenarios: MISSING_SCENARIOS,
      baselineEquivalent: evaluation.baselineId,
    },
    rowSummary: evaluation.rowSummary,
    baselineId: evaluation.baselineId,
    candidates: evaluation.candidates.map(({ anatomy: _anatomy, ...candidate }) => candidate),
  };

  writeJson(path.join(args.outDir, "phase-2-distribution.json"), dataset);
  writeJson(path.join(args.outDir, "phase-2-regression-anatomy.json"), anatomy);
  writeJson(path.join(args.outDir, "phase-2-safe-gates.json"), gates);
  writeJson(path.join(args.outDir, "phase-2-candidates.json"), phase2Candidates);
  fs.writeFileSync(path.join(args.outDir, "phase-2-distribution.md"), renderDistributionMd(roundObject(dataset), roundObject(evaluation.rowSummary), jsonlBytes), "utf8");
  fs.writeFileSync(path.join(args.outDir, "phase-2-regression-anatomy.md"), renderAnatomyMd(roundObject(anatomy)), "utf8");
  fs.writeFileSync(path.join(args.outDir, "phase-2-safe-gates.md"), renderSafeGatesMd(roundObject(gates)), "utf8");
  writeJson(path.join(args.outDir, "scores.json"), scores);
  appendExperimentLog(args.outDir, generatedAt, args, evaluation, dataset, jsonlBytes, bestRaw, bestGate, (Date.now() - started) / 1000);

  process.stdout.write(`Generated ${scripts.length} scripts\n`);
  process.stdout.write(`Evaluated ${evaluation.rowSummary.evaluatedRows} rows\n`);
  process.stdout.write(`JSONL bytes: ${jsonlBytes}\n`);
  process.stdout.write(`>=2000px/s rows: ${evaluation.rowSummary.rowsBySpeedBin[">=2000"]}\n`);
  process.stdout.write(`Best raw candidate: ${bestRaw.id} mean=${fmt(bestRaw.metrics.mean)} p95=${fmt(bestRaw.metrics.p95)} p99=${fmt(bestRaw.metrics.p99)} >5pxReg=${bestRaw.regressionsVsBaseline.worseOver5px}\n`);
  process.stdout.write(`Best safe gate: ${bestGate.id} mean=${fmt(bestGate.metrics.mean)} p95=${fmt(bestGate.metrics.p95)} p99=${fmt(bestGate.metrics.p99)} >5pxReg=${bestGate.regressionsVsBaseline.worseOver5px}\n`);
}

main();
