#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const BASELINE_GAIN = 0.75;
const IDLE_GAP_MS = 100;
const REGRESSION_THRESHOLDS = [1, 3, 5];
const SPEED_BINS = ["0-25 px/s", "25-100 px/s", "100-250 px/s", "250-500 px/s", "500-1000 px/s", "1000-2000 px/s", ">=2000 px/s"];
const HORIZON_BINS = ["0-2 ms", "2-4 ms", "4-8 ms", "8-12 ms", "12-16.7 ms", ">=16.7 ms"];
const LEAD_BINS = ["<0 us late", "0-500 us", "500-1000 us", "1000-1500 us", "1500-2000 us", ">=2000 us"];
const RIDGE_LAMBDAS = [0.001, 0.01, 0.1, 1, 10, 100];
const GUARD_CAPS_PX = [0.125, 0.25, 0.5, 1, 2, 3, 4.5];
const PHASE = "phase-7 deep-teacher";
const PHASE_TITLE = "Phase 7 - Deep Teacher";
const DEFAULT_MLP_EPOCHS = 70;
const DEFAULT_TCN_EPOCHS = 55;
const DEFAULT_BATCH_SIZE = 256;
const DEFAULT_SEQUENCE_LENGTH = 8;
const HISTORY_DROPOUT_RATE = 0.25;
const HISTORY_DROPOUT_MAX_STEPS = 3;
const MIN_TRAINING_EPOCHS = 12;

const NUMERIC_FEATURES = [
  "targetHorizonMs",
  "horizonSec",
  "dtMs_filled",
  "prevDtMs_filled",
  "validVelocityMask",
  "hasPrevMask",
  "hasPrevPrevMask",
  "anchorX",
  "anchorY",
  "prevDeltaX",
  "prevDeltaY",
  "prevPrevDeltaX",
  "prevPrevDeltaY",
  "velocityX",
  "velocityY",
  "velocityOffsetX",
  "velocityOffsetY",
  "currentBaselineOffsetX",
  "currentBaselineOffsetY",
  "prevVelocityX",
  "prevVelocityY",
  "accelOffsetX",
  "accelOffsetY",
  "speedPxS",
  "speedHorizonPx",
  "accelerationPxS2",
  "accelerationHorizonPx",
  "schedulerLeadUs",
  "dwmTimingAvailableMask",
];

function parseArgs(argv) {
  const args = {
    root: path.resolve(__dirname, ".."),
    dataset: null,
    out: __dirname,
    mlpEpochs: DEFAULT_MLP_EPOCHS,
    tcnEpochs: DEFAULT_TCN_EPOCHS,
    mlpHidden1: 64,
    mlpHidden2: 32,
    tcnChannels: 16,
    tcnDenseHidden: 32,
    sequenceLength: DEFAULT_SEQUENCE_LENGTH,
    batchSize: DEFAULT_BATCH_SIZE,
    maxSeconds: 180,
    gpuNote: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--dataset") args.dataset = path.resolve(argv[++i]);
    else if (arg === "--out") args.out = path.resolve(argv[++i]);
    else if (arg === "--mlp-epochs") args.mlpEpochs = Number(argv[++i]);
    else if (arg === "--tcn-epochs") args.tcnEpochs = Number(argv[++i]);
    else if (arg === "--epochs") {
      args.mlpEpochs = Number(argv[++i]);
      args.tcnEpochs = Math.max(MIN_TRAINING_EPOCHS, Math.round(args.mlpEpochs * 0.8));
    } else if (arg === "--mlp-hidden1") args.mlpHidden1 = Number(argv[++i]);
    else if (arg === "--mlp-hidden2") args.mlpHidden2 = Number(argv[++i]);
    else if (arg === "--hidden") args.mlpHidden1 = Number(argv[++i]);
    else if (arg === "--tcn-channels") args.tcnChannels = Number(argv[++i]);
    else if (arg === "--tcn-dense-hidden") args.tcnDenseHidden = Number(argv[++i]);
    else if (arg === "--sequence-length") args.sequenceLength = Number(argv[++i]);
    else if (arg === "--batch-size") args.batchSize = Number(argv[++i]);
    else if (arg === "--max-seconds") args.maxSeconds = Number(argv[++i]);
    else if (arg === "--gpu-note") args.gpuNote = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.dataset) args.dataset = path.join(args.root, "phase-2 dataset-builder", "dataset.jsonl");
  return args;
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, text) {
  fs.writeFileSync(file, text.replace(/\n/g, "\r\n"), "utf8");
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function distance(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
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

function metricStats(values) {
  const data = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (data.length === 0) return { n: 0, mean_px: null, rmse_px: null, p50_px: null, p90_px: null, p95_px: null, p99_px: null, max_px: null };
  let sum = 0;
  let sumSquares = 0;
  for (const value of data) {
    sum += value;
    sumSquares += value * value;
  }
  return {
    n: data.length,
    mean_px: sum / data.length,
    rmse_px: Math.sqrt(sumSquares / data.length),
    p50_px: percentile(data, 0.5),
    p90_px: percentile(data, 0.9),
    p95_px: percentile(data, 0.95),
    p99_px: percentile(data, 0.99),
    max_px: data[data.length - 1],
  };
}

function scalarStats(values) {
  const data = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (data.length === 0) return { count: 0, min: null, mean: null, p50: null, p90: null, p95: null, p99: null, max: null };
  let sum = 0;
  for (const value of data) sum += value;
  return {
    count: data.length,
    min: data[0],
    mean: sum / data.length,
    p50: percentile(data, 0.5),
    p90: percentile(data, 0.9),
    p95: percentile(data, 0.95),
    p99: percentile(data, 0.99),
    max: data[data.length - 1],
  };
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtInt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Math.round(value).toLocaleString("en-US");
}

function table(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function summarizeCategorical(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row) || "missing";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function predictCurrent(row) {
  if (!row.validVelocity || !Number.isFinite(row.dtMs) || row.dtMs <= 0 || row.targetHorizonMs <= 0) {
    return { x: row.anchorX, y: row.anchorY, mode: "hold" };
  }
  const h = row.targetHorizonMs / 1000;
  return {
    x: row.anchorX + row.velocityX * h * BASELINE_GAIN,
    y: row.anchorY + row.velocityY * h * BASELINE_GAIN,
    mode: "current_last2",
  };
}

function historyTerms(row) {
  const h = Math.max(0, finite(row.targetHorizonMs) / 1000);
  const dtMs = finite(row.dtMs, 16.6667);
  const prevDtMs = finite(row.prevDtMs, dtMs);
  const hasPrev = row.prevAnchorX !== null && row.prevAnchorY !== null;
  const hasPrevPrev = row.prevPrevAnchorX !== null && row.prevPrevAnchorY !== null && hasPrev;
  const prevDeltaX = hasPrev ? row.anchorX - row.prevAnchorX : 0;
  const prevDeltaY = hasPrev ? row.anchorY - row.prevAnchorY : 0;
  const prevPrevDeltaX = hasPrevPrev ? row.prevAnchorX - row.prevPrevAnchorX : 0;
  const prevPrevDeltaY = hasPrevPrev ? row.prevAnchorY - row.prevPrevAnchorY : 0;
  const prevVelocityX = hasPrevPrev && prevDtMs > 0 ? prevPrevDeltaX / (prevDtMs / 1000) : 0;
  const prevVelocityY = hasPrevPrev && prevDtMs > 0 ? prevPrevDeltaY / (prevDtMs / 1000) : 0;
  let accelX = 0;
  let accelY = 0;
  if (row.validVelocity && hasPrevPrev && dtMs > 0 && prevDtMs > 0 && dtMs <= IDLE_GAP_MS && prevDtMs <= IDLE_GAP_MS) {
    const avgDtSec = ((dtMs + prevDtMs) / 2) / 1000;
    accelX = (row.velocityX - prevVelocityX) / avgDtSec;
    accelY = (row.velocityY - prevVelocityY) / avgDtSec;
  }
  return {
    h,
    dtMs,
    prevDtMs,
    hasPrev,
    hasPrevPrev,
    prevDeltaX,
    prevDeltaY,
    prevPrevDeltaX,
    prevPrevDeltaY,
    prevVelocityX,
    prevVelocityY,
    accelX,
    accelY,
  };
}

function rawNumericFeature(row) {
  const hist = historyTerms(row);
  const velocityOffsetX = finite(row.velocityX) * hist.h;
  const velocityOffsetY = finite(row.velocityY) * hist.h;
  const accelOffsetX = 0.5 * hist.accelX * hist.h * hist.h;
  const accelOffsetY = 0.5 * hist.accelY * hist.h * hist.h;
  return [
    finite(row.targetHorizonMs),
    hist.h,
    hist.dtMs,
    hist.prevDtMs,
    row.validVelocity ? 1 : 0,
    hist.hasPrev ? 1 : 0,
    hist.hasPrevPrev ? 1 : 0,
    finite(row.anchorX),
    finite(row.anchorY),
    hist.prevDeltaX,
    hist.prevDeltaY,
    hist.prevPrevDeltaX,
    hist.prevPrevDeltaY,
    finite(row.velocityX),
    finite(row.velocityY),
    velocityOffsetX,
    velocityOffsetY,
    velocityOffsetX * BASELINE_GAIN,
    velocityOffsetY * BASELINE_GAIN,
    hist.prevVelocityX,
    hist.prevVelocityY,
    accelOffsetX,
    accelOffsetY,
    finite(row.speedPxS),
    finite(row.speedPxS) * hist.h,
    finite(row.accelerationPxS2),
    finite(row.accelerationPxS2) * hist.h * hist.h,
    finite(row.schedulerLeadUs),
    row.dwmTimingAvailable ? 1 : 0,
  ];
}

function makeFeatureBuilder(trainRows) {
  const raw = trainRows.map(rawNumericFeature);
  const means = [];
  const stds = [];
  for (let j = 0; j < NUMERIC_FEATURES.length; j += 1) {
    let sum = 0;
    for (const row of raw) sum += row[j];
    const mean = sum / raw.length;
    let variance = 0;
    for (const row of raw) {
      const d = row[j] - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / raw.length) || 1;
    means.push(mean);
    stds.push(std);
  }
  const featureNames = [
    ...NUMERIC_FEATURES,
    ...SPEED_BINS.map((label) => `speedBin:${label}`),
    ...HORIZON_BINS.map((label) => `horizonBin:${label}`),
    ...LEAD_BINS.map((label) => `schedulerLeadBin:${label}`),
  ];
  return {
    featureNames,
    means,
    stds,
    vector(row) {
      const numeric = rawNumericFeature(row).map((value, index) => (value - means[index]) / stds[index]);
      for (const label of SPEED_BINS) numeric.push(row.speedBin === label ? 1 : 0);
      for (const label of HORIZON_BINS) numeric.push(row.horizonBin === label ? 1 : 0);
      for (const label of LEAD_BINS) numeric.push(row.schedulerLeadBin === label ? 1 : 0);
      return numeric;
    },
  };
}

function baselineErrors(rows) {
  return rows.map((row) => {
    const pred = predictCurrent(row);
    return distance(pred.x, pred.y, row.labelX, row.labelY);
  });
}

function regressionCounts(records) {
  const counts = {
    worse_over_1px: 0,
    worse_over_3px: 0,
    worse_over_5px: 0,
    better_over_1px: 0,
    better_over_3px: 0,
    better_over_5px: 0,
  };
  for (const record of records) {
    if (record.delta_px > 1) counts.worse_over_1px += 1;
    if (record.delta_px > 3) counts.worse_over_3px += 1;
    if (record.delta_px > 5) counts.worse_over_5px += 1;
    if (record.delta_px < -1) counts.better_over_1px += 1;
    if (record.delta_px < -3) counts.better_over_3px += 1;
    if (record.delta_px < -5) counts.better_over_5px += 1;
  }
  return counts;
}

function summarizeBuckets(records, field) {
  const groups = {};
  for (const record of records) {
    const key = record[field] || "missing";
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  }
  return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => [
    key,
    {
      stats: metricStats(group.map((record) => record.error_px)),
      regressions_vs_current: regressionCounts(group),
    },
  ]));
}

function evaluateRows(rows, predictor, label, baseline = null) {
  const base = baseline || baselineErrors(rows);
  const errors = [];
  const records = [];
  const modeCounts = {};
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const pred = predictor(row);
    const error = distance(pred.x, pred.y, row.labelX, row.labelY);
    const delta = error - base[i];
    errors.push(error);
    modeCounts[pred.mode || label] = (modeCounts[pred.mode || label] || 0) + 1;
    records.push({
      error_px: error,
      baseline_error_px: base[i],
      delta_px: delta,
      speed_bin: row.speedBin,
      horizon_bin: row.horizonBin,
      scheduler_lead_bin: row.schedulerLeadBin,
      chronological_block: row.chronologicalBlock,
    });
  }
  const overall = metricStats(errors);
  return {
    overall,
    regressions_vs_current: regressionCounts(records),
    delta_vs_current: summarizeDelta(overall, metricStats(base)),
    breakdowns: {
      speed_bins: summarizeBuckets(records, "speed_bin"),
      horizon_bins: summarizeBuckets(records, "horizon_bin"),
      scheduler_lead_bins: summarizeBuckets(records, "scheduler_lead_bin"),
      chronological_blocks: summarizeBuckets(records, "chronological_block"),
    },
    application: {
      mode_counts: Object.fromEntries(Object.entries(modeCounts).sort(([a], [b]) => a.localeCompare(b))),
    },
  };
}

function summarizeDelta(stats, baselineStats) {
  const out = {};
  for (const key of ["mean_px", "rmse_px", "p50_px", "p90_px", "p95_px", "p99_px", "max_px"]) {
    out[key] = stats[key] === null || baselineStats[key] === null ? null : stats[key] - baselineStats[key];
  }
  return out;
}

function targetFor(row, mode) {
  if (mode === "direct") return [row.labelX - row.anchorX, row.labelY - row.anchorY];
  const base = predictCurrent(row);
  return [row.labelX - base.x, row.labelY - base.y];
}

function baseFor(row, mode) {
  if (mode === "direct") return { x: row.anchorX, y: row.anchorY };
  return predictCurrent(row);
}

function clipVector(dx, dy, cap) {
  if (!Number.isFinite(cap) || cap <= 0) return [dx, dy];
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag <= cap || mag === 0) return [dx, dy];
  const scale = cap / mag;
  return [dx * scale, dy * scale];
}

function solveLinearSystem(matrix, rhs) {
  const n = matrix.length;
  const m = rhs[0].length;
  const a = matrix.map((row, i) => [...row, ...rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r += 1) {
      const value = Math.abs(a[r][col]);
      if (value > best) {
        best = value;
        pivot = r;
      }
    }
    if (best < 1e-12) throw new Error("Singular linear system in ridge solve");
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    const denom = a[col][col];
    for (let c = col; c < n + m; c += 1) a[col][c] /= denom;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let c = col; c < n + m; c += 1) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => row.slice(n));
}

function trainRidge(rows, featureBuilder, mode, lambda) {
  const dim = featureBuilder.featureNames.length + 1;
  const xtx = Array.from({ length: dim }, () => Array(dim).fill(0));
  const xty = Array.from({ length: dim }, () => [0, 0]);
  for (const row of rows) {
    const x = [1, ...featureBuilder.vector(row)];
    const y = targetFor(row, mode);
    for (let i = 0; i < dim; i += 1) {
      xty[i][0] += x[i] * y[0];
      xty[i][1] += x[i] * y[1];
      for (let j = 0; j < dim; j += 1) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < dim; i += 1) xtx[i][i] += lambda;
  const weights = solveLinearSystem(xtx, xty);
  return {
    predict(row, options = {}) {
      const x = [1, ...featureBuilder.vector(row)];
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < dim; i += 1) {
        dx += x[i] * weights[i][0];
        dy += x[i] * weights[i][1];
      }
      if (options.capPx) [dx, dy] = clipVector(dx, dy, options.capPx);
      const base = baseFor(row, mode);
      return { x: base.x + dx, y: base.y + dy, mode: options.capPx ? "ridge_guarded" : "ridge" };
    },
    weights,
  };
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0x100000000);
  };
}

function targetNormalizer(rows, mode) {
  const targets = rows.map((row) => targetFor(row, mode));
  const means = [0, 0];
  const stds = [1, 1];
  for (const target of targets) {
    means[0] += target[0];
    means[1] += target[1];
  }
  means[0] /= targets.length;
  means[1] /= targets.length;
  let vx = 0;
  let vy = 0;
  for (const target of targets) {
    vx += (target[0] - means[0]) ** 2;
    vy += (target[1] - means[1]) ** 2;
  }
  stds[0] = Math.sqrt(vx / targets.length) || 1;
  stds[1] = Math.sqrt(vy / targets.length) || 1;
  return { means, stds };
}

function trainMlp(rows, featureBuilder, mode, options) {
  const rng = makeRng(options.seed);
  const inputDim = featureBuilder.featureNames.length;
  const hidden = options.hidden;
  const targetNorm = targetNormalizer(rows, mode);
  const samples = rows.map((row) => ({
    x: featureBuilder.vector(row),
    y: targetFor(row, mode).map((value, index) => (value - targetNorm.means[index]) / targetNorm.stds[index]),
  }));
  const w1 = Array.from({ length: hidden }, () => Array.from({ length: inputDim }, () => (rng() * 2 - 1) * Math.sqrt(2 / inputDim)));
  const b1 = Array(hidden).fill(0);
  const w2 = Array.from({ length: 2 }, () => Array.from({ length: hidden }, () => (rng() * 2 - 1) * Math.sqrt(2 / hidden)));
  const b2 = Array(2).fill(0);
  const params = [w1.flat(), b1, w2.flat(), b2];
  const moments = params.map((p) => ({ m: Array(p.length).fill(0), v: Array(p.length).fill(0) }));
  const index = Array.from({ length: samples.length }, (_, i) => i);
  let step = 0;

  function zeroGrads() {
    return params.map((p) => Array(p.length).fill(0));
  }

  function forward(x) {
    const z1 = Array(hidden).fill(0);
    const h1 = Array(hidden).fill(0);
    for (let j = 0; j < hidden; j += 1) {
      let sum = b1[j];
      const base = j * inputDim;
      for (let k = 0; k < inputDim; k += 1) sum += w1[j][k] * x[k];
      z1[j] = sum;
      h1[j] = sum > 0 ? sum : 0.01 * sum;
    }
    const out = [b2[0], b2[1]];
    for (let o = 0; o < 2; o += 1) {
      for (let j = 0; j < hidden; j += 1) out[o] += w2[o][j] * h1[j];
    }
    return { z1, h1, out };
  }

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    for (let i = index.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = index[i];
      index[i] = index[j];
      index[j] = tmp;
    }
    for (let start = 0; start < index.length; start += options.batchSize) {
      const grads = zeroGrads();
      const end = Math.min(index.length, start + options.batchSize);
      const batchScale = 1 / (end - start);
      for (let p = start; p < end; p += 1) {
        const sample = samples[index[p]];
        const f = forward(sample.x);
        const dOut = [(f.out[0] - sample.y[0]) * batchScale, (f.out[1] - sample.y[1]) * batchScale];
        for (let o = 0; o < 2; o += 1) {
          grads[3][o] += dOut[o];
          const base = o * hidden;
          for (let j = 0; j < hidden; j += 1) grads[2][base + j] += dOut[o] * f.h1[j];
        }
        const dHidden = Array(hidden).fill(0);
        for (let j = 0; j < hidden; j += 1) {
          dHidden[j] = dOut[0] * w2[0][j] + dOut[1] * w2[1][j];
          dHidden[j] *= f.z1[j] > 0 ? 1 : 0.01;
        }
        for (let j = 0; j < hidden; j += 1) {
          grads[1][j] += dHidden[j];
          const base = j * inputDim;
          for (let k = 0; k < inputDim; k += 1) grads[0][base + k] += dHidden[j] * sample.x[k];
        }
      }
      step += 1;
      for (let group = 0; group < params.length; group += 1) {
        const param = params[group];
        const grad = grads[group];
        const moment = moments[group];
        for (let i = 0; i < param.length; i += 1) {
          const l2 = group === 1 || group === 3 ? 0 : options.weightDecay * param[i];
          const g = grad[i] + l2;
          moment.m[i] = options.beta1 * moment.m[i] + (1 - options.beta1) * g;
          moment.v[i] = options.beta2 * moment.v[i] + (1 - options.beta2) * g * g;
          const mHat = moment.m[i] / (1 - options.beta1 ** step);
          const vHat = moment.v[i] / (1 - options.beta2 ** step);
          param[i] -= options.lr * mHat / (Math.sqrt(vHat) + options.epsilon);
        }
      }
      for (let j = 0; j < hidden; j += 1) {
        for (let k = 0; k < inputDim; k += 1) w1[j][k] = params[0][j * inputDim + k];
        b1[j] = params[1][j];
      }
      for (let o = 0; o < 2; o += 1) {
        for (let j = 0; j < hidden; j += 1) w2[o][j] = params[2][o * hidden + j];
        b2[o] = params[3][o];
      }
    }
  }

  return {
    predict(row, options = {}) {
      const f = forward(featureBuilder.vector(row));
      let dx = f.out[0] * targetNorm.stds[0] + targetNorm.means[0];
      let dy = f.out[1] * targetNorm.stds[1] + targetNorm.means[1];
      if (options.capPx) [dx, dy] = clipVector(dx, dy, options.capPx);
      const base = baseFor(row, mode);
      return { x: base.x + dx, y: base.y + dy, mode: options.capPx ? "mlp_guarded" : "mlp" };
    },
    targetNorm,
  };
}

function leaky(value) {
  return value > 0 ? value : 0.01 * value;
}

function leakyGrad(value) {
  return value > 0 ? 1 : 0.01;
}

function makeFlatWeights(count, scale, rng) {
  return Array.from({ length: count }, () => (rng() * 2 - 1) * scale);
}

function zeroLike(params) {
  return params.map((param) => Array(param.length).fill(0));
}

function makeMoments(params) {
  return params.map((param) => ({ m: Array(param.length).fill(0), v: Array(param.length).fill(0) }));
}

function adamUpdate(params, grads, moments, options, step) {
  for (let group = 0; group < params.length; group += 1) {
    const param = params[group];
    const grad = grads[group];
    const moment = moments[group];
    const isBias = options.biasGroups.has(group);
    for (let i = 0; i < param.length; i += 1) {
      const l2 = isBias ? 0 : options.weightDecay * param[i];
      const g = grad[i] + l2;
      moment.m[i] = options.beta1 * moment.m[i] + (1 - options.beta1) * g;
      moment.v[i] = options.beta2 * moment.v[i] + (1 - options.beta2) * g * g;
      const mHat = moment.m[i] / (1 - options.beta1 ** step);
      const vHat = moment.v[i] / (1 - options.beta2 ** step);
      param[i] -= options.lr * mHat / (Math.sqrt(vHat) + options.epsilon);
    }
  }
}

function trainDeepMlp(rows, featureBuilder, mode, options) {
  const rng = makeRng(options.seed);
  const inputDim = featureBuilder.featureNames.length;
  const h1Dim = options.hidden1;
  const h2Dim = options.hidden2;
  const targetNorm = targetNormalizer(rows, mode);
  const samples = rows.map((row) => ({
    x: featureBuilder.vector(row),
    y: targetFor(row, mode).map((value, index) => (value - targetNorm.means[index]) / targetNorm.stds[index]),
  }));

  const w1 = makeFlatWeights(h1Dim * inputDim, Math.sqrt(2 / inputDim), rng);
  const b1 = Array(h1Dim).fill(0);
  const w2 = makeFlatWeights(h2Dim * h1Dim, Math.sqrt(2 / h1Dim), rng);
  const b2 = Array(h2Dim).fill(0);
  const w3 = makeFlatWeights(2 * h2Dim, Math.sqrt(2 / h2Dim), rng);
  const b3 = Array(2).fill(0);
  const params = [w1, b1, w2, b2, w3, b3];
  const moments = makeMoments(params);
  const index = Array.from({ length: samples.length }, (_, i) => i);
  const started = performance.now();
  let step = 0;
  let actualEpochs = 0;
  let stoppedEarly = false;

  function forward(x) {
    const z1 = Array(h1Dim).fill(0);
    const h1 = Array(h1Dim).fill(0);
    for (let j = 0; j < h1Dim; j += 1) {
      let sum = b1[j];
      const base = j * inputDim;
      for (let k = 0; k < inputDim; k += 1) sum += w1[base + k] * x[k];
      z1[j] = sum;
      h1[j] = leaky(sum);
    }
    const z2 = Array(h2Dim).fill(0);
    const h2 = Array(h2Dim).fill(0);
    for (let j = 0; j < h2Dim; j += 1) {
      let sum = b2[j];
      const base = j * h1Dim;
      for (let k = 0; k < h1Dim; k += 1) sum += w2[base + k] * h1[k];
      z2[j] = sum;
      h2[j] = leaky(sum);
    }
    const out = [b3[0], b3[1]];
    for (let o = 0; o < 2; o += 1) {
      const base = o * h2Dim;
      for (let j = 0; j < h2Dim; j += 1) out[o] += w3[base + j] * h2[j];
    }
    return { z1, h1, z2, h2, out };
  }

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    actualEpochs = epoch + 1;
    for (let i = index.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = index[i];
      index[i] = index[j];
      index[j] = tmp;
    }
    for (let start = 0; start < index.length; start += options.batchSize) {
      const grads = zeroLike(params);
      const end = Math.min(index.length, start + options.batchSize);
      const batchScale = 1 / (end - start);
      for (let p = start; p < end; p += 1) {
        const sample = samples[index[p]];
        const f = forward(sample.x);
        const dOut = [(f.out[0] - sample.y[0]) * batchScale, (f.out[1] - sample.y[1]) * batchScale];
        for (let o = 0; o < 2; o += 1) {
          grads[5][o] += dOut[o];
          const base = o * h2Dim;
          for (let j = 0; j < h2Dim; j += 1) grads[4][base + j] += dOut[o] * f.h2[j];
        }
        const dH2 = Array(h2Dim).fill(0);
        for (let j = 0; j < h2Dim; j += 1) {
          dH2[j] = dOut[0] * w3[j] + dOut[1] * w3[h2Dim + j];
          dH2[j] *= leakyGrad(f.z2[j]);
        }
        for (let j = 0; j < h2Dim; j += 1) {
          grads[3][j] += dH2[j];
          const base = j * h1Dim;
          for (let k = 0; k < h1Dim; k += 1) grads[2][base + k] += dH2[j] * f.h1[k];
        }
        const dH1 = Array(h1Dim).fill(0);
        for (let k = 0; k < h1Dim; k += 1) {
          let sum = 0;
          for (let j = 0; j < h2Dim; j += 1) sum += dH2[j] * w2[j * h1Dim + k];
          dH1[k] = sum * leakyGrad(f.z1[k]);
        }
        for (let j = 0; j < h1Dim; j += 1) {
          grads[1][j] += dH1[j];
          const base = j * inputDim;
          for (let k = 0; k < inputDim; k += 1) grads[0][base + k] += dH1[j] * sample.x[k];
        }
      }
      step += 1;
      adamUpdate(params, grads, moments, options, step);
    }
    if (epoch + 1 >= options.minEpochs && performance.now() > options.deadlineMs) {
      stoppedEarly = true;
      break;
    }
  }

  return {
    predict(row, predictOptions = {}) {
      const f = forward(featureBuilder.vector(row));
      let dx = f.out[0] * targetNorm.stds[0] + targetNorm.means[0];
      let dy = f.out[1] * targetNorm.stds[1] + targetNorm.means[1];
      if (predictOptions.capPx) [dx, dy] = clipVector(dx, dy, predictOptions.capPx);
      const base = baseFor(row, mode);
      return { x: base.x + dx, y: base.y + dy, mode: predictOptions.capPx ? "deep_mlp_guarded" : "deep_mlp" };
    },
    targetNorm,
    training: {
      actual_epochs: actualEpochs,
      requested_epochs: options.epochs,
      stopped_early: stoppedEarly,
      stopped_early_reason: stoppedEarly ? `Reached per-model budget after ${actualEpochs} epochs.` : null,
      elapsed_sec: (performance.now() - started) / 1000,
      parameter_count: w1.length + b1.length + w2.length + b2.length + w3.length + b3.length,
    },
  };
}

const SEQUENCE_FEATURES = [
  "mask",
  "ageMs",
  "dtMs",
  "relX",
  "relY",
  "stepDeltaX",
  "stepDeltaY",
  "stepVelocityX",
  "stepVelocityY",
  "stepSpeedPxS",
];

function annotateSessionHistory(rows) {
  const bySession = {};
  for (const row of rows) {
    if (!bySession[row.sessionId]) bySession[row.sessionId] = [];
    bySession[row.sessionId].push(row);
  }
  for (const sessionRows of Object.values(bySession)) {
    sessionRows.sort((a, b) => a.ordinal - b.ordinal);
    for (let i = 0; i < sessionRows.length; i += 1) {
      sessionRows[i]._sessionRows = sessionRows;
      sessionRows[i]._sessionIndex = i;
    }
  }
}

function rawSequence(row, sequenceLength) {
  const out = [];
  const sessionRows = row._sessionRows || [row];
  const currentIndex = row._sessionIndex ?? 0;
  for (let t = 0; t < sequenceLength; t += 1) {
    const offset = sequenceLength - 1 - t;
    const index = currentIndex - offset;
    if (index < 0) {
      out.push(Array(SEQUENCE_FEATURES.length).fill(0));
      continue;
    }
    const hist = sessionRows[index];
    const prev = index > 0 ? sessionRows[index - 1] : null;
    const dtMs = prev
      ? Math.max(0.001, (hist.anchorElapsedUs - prev.anchorElapsedUs) / 1000)
      : finite(hist.dtMs, 16.6667);
    const stepDeltaX = prev ? finite(hist.anchorX) - finite(prev.anchorX) : 0;
    const stepDeltaY = prev ? finite(hist.anchorY) - finite(prev.anchorY) : 0;
    const stepVelocityX = dtMs > 0 ? stepDeltaX / (dtMs / 1000) : 0;
    const stepVelocityY = dtMs > 0 ? stepDeltaY / (dtMs / 1000) : 0;
    const ageMs = Math.max(0, (finite(row.anchorElapsedUs) - finite(hist.anchorElapsedUs)) / 1000);
    out.push([
      1,
      ageMs,
      dtMs,
      finite(hist.anchorX) - finite(row.anchorX),
      finite(hist.anchorY) - finite(row.anchorY),
      stepDeltaX,
      stepDeltaY,
      stepVelocityX,
      stepVelocityY,
      Math.sqrt(stepVelocityX * stepVelocityX + stepVelocityY * stepVelocityY),
    ]);
  }
  return out;
}

function makeSequenceBuilder(trainRows, sequenceLength) {
  const sums = Array(SEQUENCE_FEATURES.length).fill(0);
  const counts = Array(SEQUENCE_FEATURES.length).fill(0);
  const seqs = trainRows.map((row) => rawSequence(row, sequenceLength));
  for (const seq of seqs) {
    for (const step of seq) {
      if (step[0] !== 1) continue;
      for (let f = 1; f < SEQUENCE_FEATURES.length; f += 1) {
        sums[f] += step[f];
        counts[f] += 1;
      }
    }
  }
  const means = sums.map((sum, index) => (index === 0 || counts[index] === 0 ? 0 : sum / counts[index]));
  const variances = Array(SEQUENCE_FEATURES.length).fill(0);
  for (const seq of seqs) {
    for (const step of seq) {
      if (step[0] !== 1) continue;
      for (let f = 1; f < SEQUENCE_FEATURES.length; f += 1) {
        const d = step[f] - means[f];
        variances[f] += d * d;
      }
    }
  }
  const stds = variances.map((variance, index) => (index === 0 || counts[index] === 0 ? 1 : Math.sqrt(variance / counts[index]) || 1));
  return {
    featureNames: SEQUENCE_FEATURES,
    sequenceLength,
    means,
    stds,
    vector(row, dropOldestSteps = 0) {
      const seq = rawSequence(row, sequenceLength);
      const flat = [];
      for (let t = 0; t < sequenceLength; t += 1) {
        const missingByAugmentation = t < Math.min(dropOldestSteps, sequenceLength - 1);
        const step = missingByAugmentation ? Array(SEQUENCE_FEATURES.length).fill(0) : seq[t];
        if (step[0] !== 1) {
          for (let f = 0; f < SEQUENCE_FEATURES.length; f += 1) flat.push(0);
          continue;
        }
        flat.push(1);
        for (let f = 1; f < SEQUENCE_FEATURES.length; f += 1) flat.push((step[f] - means[f]) / stds[f]);
      }
      return flat;
    },
  };
}

function trainTinyTcn(rows, featureBuilder, sequenceBuilder, mode, options) {
  const rng = makeRng(options.seed);
  const seqLen = sequenceBuilder.sequenceLength;
  const seqFeatDim = sequenceBuilder.featureNames.length;
  const scalarDim = featureBuilder.featureNames.length;
  const channels = options.channels;
  const kernel = 3;
  const pooledDim = channels * 2 + scalarDim;
  const denseHidden = options.denseHidden;
  const targetNorm = targetNormalizer(rows, mode);
  const samples = [];
  let augmentedSamples = 0;
  for (const row of rows) {
    samples.push({
      seq: sequenceBuilder.vector(row, 0),
      scalar: featureBuilder.vector(row),
      y: targetFor(row, mode).map((value, index) => (value - targetNorm.means[index]) / targetNorm.stds[index]),
    });
    if (rng() < options.historyDropoutRate) {
      const dropOldestSteps = 1 + Math.floor(rng() * options.historyDropoutMaxSteps);
      samples.push({
        seq: sequenceBuilder.vector(row, dropOldestSteps),
        scalar: featureBuilder.vector(row),
        y: targetFor(row, mode).map((value, index) => (value - targetNorm.means[index]) / targetNorm.stds[index]),
      });
      augmentedSamples += 1;
    }
  }

  const wConv = makeFlatWeights(channels * kernel * seqFeatDim, Math.sqrt(2 / (kernel * seqFeatDim)), rng);
  const bConv = Array(channels).fill(0);
  const wDense = makeFlatWeights(denseHidden * pooledDim, Math.sqrt(2 / pooledDim), rng);
  const bDense = Array(denseHidden).fill(0);
  const wOut = makeFlatWeights(2 * denseHidden, Math.sqrt(2 / denseHidden), rng);
  const bOut = Array(2).fill(0);
  const params = [wConv, bConv, wDense, bDense, wOut, bOut];
  const moments = makeMoments(params);
  const index = Array.from({ length: samples.length }, (_, i) => i);
  const started = performance.now();
  let step = 0;
  let actualEpochs = 0;
  let stoppedEarly = false;

  function convWeightIndex(c, k, f) {
    return ((c * kernel + k) * seqFeatDim) + f;
  }

  function forward(seq, scalar) {
    const zConv = Array(seqLen * channels).fill(0);
    const hConv = Array(seqLen * channels).fill(0);
    for (let t = 0; t < seqLen; t += 1) {
      for (let c = 0; c < channels; c += 1) {
        let sum = bConv[c];
        for (let k = 0; k < kernel; k += 1) {
          const srcT = t - k;
          if (srcT < 0) continue;
          const seqBase = srcT * seqFeatDim;
          for (let f = 0; f < seqFeatDim; f += 1) sum += wConv[convWeightIndex(c, k, f)] * seq[seqBase + f];
        }
        const idx = t * channels + c;
        zConv[idx] = sum;
        hConv[idx] = leaky(sum);
      }
    }
    const pooled = Array(pooledDim).fill(0);
    const lastBase = (seqLen - 1) * channels;
    for (let c = 0; c < channels; c += 1) {
      pooled[c] = hConv[lastBase + c];
      let sum = 0;
      for (let t = 0; t < seqLen; t += 1) sum += hConv[t * channels + c];
      pooled[channels + c] = sum / seqLen;
    }
    for (let i = 0; i < scalarDim; i += 1) pooled[channels * 2 + i] = scalar[i];
    const zDense = Array(denseHidden).fill(0);
    const hDense = Array(denseHidden).fill(0);
    for (let j = 0; j < denseHidden; j += 1) {
      let sum = bDense[j];
      const base = j * pooledDim;
      for (let i = 0; i < pooledDim; i += 1) sum += wDense[base + i] * pooled[i];
      zDense[j] = sum;
      hDense[j] = leaky(sum);
    }
    const out = [bOut[0], bOut[1]];
    for (let o = 0; o < 2; o += 1) {
      const base = o * denseHidden;
      for (let j = 0; j < denseHidden; j += 1) out[o] += wOut[base + j] * hDense[j];
    }
    return { zConv, hConv, pooled, zDense, hDense, out };
  }

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    actualEpochs = epoch + 1;
    for (let i = index.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = index[i];
      index[i] = index[j];
      index[j] = tmp;
    }
    for (let start = 0; start < index.length; start += options.batchSize) {
      const grads = zeroLike(params);
      const end = Math.min(index.length, start + options.batchSize);
      const batchScale = 1 / (end - start);
      for (let p = start; p < end; p += 1) {
        const sample = samples[index[p]];
        const fwd = forward(sample.seq, sample.scalar);
        const dOut = [(fwd.out[0] - sample.y[0]) * batchScale, (fwd.out[1] - sample.y[1]) * batchScale];
        for (let o = 0; o < 2; o += 1) {
          grads[5][o] += dOut[o];
          const base = o * denseHidden;
          for (let j = 0; j < denseHidden; j += 1) grads[4][base + j] += dOut[o] * fwd.hDense[j];
        }
        const dDense = Array(denseHidden).fill(0);
        for (let j = 0; j < denseHidden; j += 1) {
          dDense[j] = dOut[0] * wOut[j] + dOut[1] * wOut[denseHidden + j];
          dDense[j] *= leakyGrad(fwd.zDense[j]);
        }
        const dPooled = Array(pooledDim).fill(0);
        for (let j = 0; j < denseHidden; j += 1) {
          grads[3][j] += dDense[j];
          const base = j * pooledDim;
          for (let i = 0; i < pooledDim; i += 1) {
            grads[2][base + i] += dDense[j] * fwd.pooled[i];
            dPooled[i] += dDense[j] * wDense[base + i];
          }
        }
        const dConvH = Array(seqLen * channels).fill(0);
        const lastBase = (seqLen - 1) * channels;
        for (let c = 0; c < channels; c += 1) {
          dConvH[lastBase + c] += dPooled[c];
          const avgGrad = dPooled[channels + c] / seqLen;
          for (let t = 0; t < seqLen; t += 1) dConvH[t * channels + c] += avgGrad;
        }
        for (let t = 0; t < seqLen; t += 1) {
          for (let c = 0; c < channels; c += 1) {
            const convIdx = t * channels + c;
            const dz = dConvH[convIdx] * leakyGrad(fwd.zConv[convIdx]);
            grads[1][c] += dz;
            for (let k = 0; k < kernel; k += 1) {
              const srcT = t - k;
              if (srcT < 0) continue;
              const seqBase = srcT * seqFeatDim;
              for (let sf = 0; sf < seqFeatDim; sf += 1) {
                grads[0][convWeightIndex(c, k, sf)] += dz * sample.seq[seqBase + sf];
              }
            }
          }
        }
      }
      step += 1;
      adamUpdate(params, grads, moments, options, step);
    }
    if (epoch + 1 >= options.minEpochs && performance.now() > options.deadlineMs) {
      stoppedEarly = true;
      break;
    }
  }

  return {
    predict(row, predictOptions = {}) {
      const f = forward(sequenceBuilder.vector(row, 0), featureBuilder.vector(row));
      let dx = f.out[0] * targetNorm.stds[0] + targetNorm.means[0];
      let dy = f.out[1] * targetNorm.stds[1] + targetNorm.means[1];
      if (predictOptions.capPx) [dx, dy] = clipVector(dx, dy, predictOptions.capPx);
      const base = baseFor(row, mode);
      return { x: base.x + dx, y: base.y + dy, mode: predictOptions.capPx ? "tcn_guarded" : "tcn" };
    },
    targetNorm,
    training: {
      actual_epochs: actualEpochs,
      requested_epochs: options.epochs,
      stopped_early: stoppedEarly,
      stopped_early_reason: stoppedEarly ? `Reached per-model budget after ${actualEpochs} epochs.` : null,
      elapsed_sec: (performance.now() - started) / 1000,
      base_samples: rows.length,
      augmented_samples: augmentedSamples,
      parameter_count: wConv.length + bConv.length + wDense.length + bDense.length + wOut.length + bOut.length,
    },
  };
}

function chooseBest(evaluations) {
  const sorted = evaluations.slice().sort((a, b) => (
    a.validation.regressions_vs_current.worse_over_5px - b.validation.regressions_vs_current.worse_over_5px ||
    (a.validation.overall.p99_px ?? Infinity) - (b.validation.overall.p99_px ?? Infinity) ||
    (a.validation.overall.mean_px ?? Infinity) - (b.validation.overall.mean_px ?? Infinity)
  ));
  return sorted[0];
}

function perModelDeadline(args) {
  const perModelMs = Math.max(20, args.maxSeconds / 4) * 1000;
  return performance.now() + perModelMs;
}

function trainDeepMlpBase(fold, args, seed) {
  return trainDeepMlp(fold.fitRows, fold.featureBuilder, "residual", {
    seed,
    hidden1: args.mlpHidden1,
    hidden2: args.mlpHidden2,
    epochs: args.mlpEpochs,
    minEpochs: Math.min(MIN_TRAINING_EPOCHS, args.mlpEpochs),
    batchSize: args.batchSize,
    lr: 0.0014,
    weightDecay: 2e-5,
    beta1: 0.9,
    beta2: 0.999,
    epsilon: 1e-8,
    biasGroups: new Set([1, 3, 5]),
    deadlineMs: perModelDeadline(args),
  });
}

function selectDeepMlpFamily(fold, model, guarded, args, seed) {
  const evaluations = [];
  const caps = guarded ? GUARD_CAPS_PX : [null];
  for (const capPx of caps) {
    const predictor = (row) => model.predict(row, { capPx });
    evaluations.push({
      parameters: {
        mode: "residual",
        hidden: [args.mlpHidden1, args.mlpHidden2],
        epochs: model.training.actual_epochs,
        requested_epochs: args.mlpEpochs,
        capPx,
        lr: 0.0014,
        batchSize: args.batchSize,
        seed,
      },
      model,
      predictor,
      validation: evaluateRows(fold.validationRows, predictor, "deep_mlp", fold.validationBaseline),
    });
  }
  return chooseBest(evaluations);
}

function trainTcnBase(fold, args, seed) {
  return trainTinyTcn(fold.fitRows, fold.featureBuilder, fold.sequenceBuilder, "residual", {
    seed,
    channels: args.tcnChannels,
    denseHidden: args.tcnDenseHidden,
    epochs: args.tcnEpochs,
    minEpochs: Math.min(MIN_TRAINING_EPOCHS, args.tcnEpochs),
    batchSize: args.batchSize,
    lr: 0.0012,
    weightDecay: 2e-5,
    beta1: 0.9,
    beta2: 0.999,
    epsilon: 1e-8,
    biasGroups: new Set([1, 3, 5]),
    deadlineMs: perModelDeadline(args),
    historyDropoutRate: HISTORY_DROPOUT_RATE,
    historyDropoutMaxSteps: Math.min(HISTORY_DROPOUT_MAX_STEPS, args.sequenceLength - 1),
  });
}

function selectTcnFamily(fold, model, guarded, args, seed) {
  const evaluations = [];
  const caps = guarded ? GUARD_CAPS_PX : [null];
  for (const capPx of caps) {
    const predictor = (row) => model.predict(row, { capPx });
    evaluations.push({
      parameters: {
        mode: "residual",
        sequence_length: args.sequenceLength,
        sequence_features: fold.sequenceBuilder.featureNames,
        channels: args.tcnChannels,
        dense_hidden: args.tcnDenseHidden,
        epochs: model.training.actual_epochs,
        requested_epochs: args.tcnEpochs,
        capPx,
        lr: 0.0012,
        batchSize: args.batchSize,
        seed,
        history_dropout_rate: HISTORY_DROPOUT_RATE,
        history_dropout_max_steps: Math.min(HISTORY_DROPOUT_MAX_STEPS, args.sequenceLength - 1),
      },
      model,
      predictor,
      validation: evaluateRows(fold.validationRows, predictor, "tcn", fold.validationBaseline),
    });
  }
  return chooseBest(evaluations);
}

function addEvaluation(id, family, description, selected, fold) {
  const train = evaluateRows(fold.fitRows, selected.predictor, id, fold.fitBaseline);
  const validation = evaluateRows(fold.validationRows, selected.predictor, id, fold.validationBaseline);
  const heldout = evaluateRows(fold.evalRows, selected.predictor, id, fold.evalBaseline);
  const hasVisibleRegressions = heldout.regressions_vs_current.worse_over_5px > 0;
  const hasBroadSmallRegressions = heldout.regressions_vs_current.worse_over_3px > 0 || heldout.regressions_vs_current.worse_over_1px > 500;
  return {
    id,
    family,
    description,
    selected_parameters: selected.parameters,
    training_summary: selected.model.training || null,
    teacher_only: hasVisibleRegressions || hasBroadSmallRegressions,
    product_relevance_note: hasVisibleRegressions
      ? "Not directly shippable: held-out >5px regressions occur."
      : hasBroadSmallRegressions
        ? "Teacher-only unless distilled/gated: zero >5px, but broad >1/>3px regressions remain."
        : "Passes zero >5px and small-regression screen in this two-session evaluation.",
    selection_validation: selected.validation,
    train_block: train,
    validation_block: validation,
    heldout,
  };
}

function evaluateCurrent(id, rows, baseline) {
  return evaluateRows(rows, predictCurrent, id, baseline);
}

function makeFold(trainRows, evalRows, foldId, args) {
  const fitRows = trainRows.filter((row) => row.chronologicalBlock === "train_block_first_70pct");
  const validationRows = trainRows.filter((row) => row.chronologicalBlock === "validation_block_last_30pct");
  return {
    foldId,
    trainRows,
    fitRows,
    validationRows,
    evalRows,
    featureBuilder: makeFeatureBuilder(fitRows),
    sequenceBuilder: makeSequenceBuilder(fitRows, args.sequenceLength),
    fitBaseline: baselineErrors(fitRows),
    validationBaseline: baselineErrors(validationRows),
    evalBaseline: baselineErrors(evalRows),
    args,
  };
}

function evaluateFold(trainRows, evalRows, foldId, args, foldIndex) {
  const fold = makeFold(trainRows, evalRows, foldId, args);
  const models = [];
  models.push({
    id: "current_dwm_aware_last2_gain_0_75",
    family: "current_baseline",
    description: "Current DWM-aware last-two-sample predictor with gain 0.75.",
    selected_parameters: { gain: BASELINE_GAIN },
    train_block: evaluateCurrent("current", fold.fitRows, fold.fitBaseline),
    validation_block: evaluateCurrent("current", fold.validationRows, fold.validationBaseline),
    heldout: evaluateCurrent("current", fold.evalRows, fold.evalBaseline),
  });

  const deepMlpSeed = 7000 + foldIndex;
  const deepMlpModel = trainDeepMlpBase(fold, args, deepMlpSeed);
  const deepMlpResidual = selectDeepMlpFamily(fold, deepMlpModel, false, args, deepMlpSeed);
  models.push(addEvaluation(
    "deep_mlp_residual_h64_h32",
    "deep_mlp",
    "Two-hidden-layer residual MLP using the Phase 4 causal scalar features.",
    deepMlpResidual,
    fold,
  ));

  const deepMlpResidualGuarded = selectDeepMlpFamily(fold, deepMlpModel, true, args, deepMlpSeed);
  models.push(addEvaluation(
    "deep_mlp_residual_guarded_h64_h32",
    "deep_mlp_guarded",
    "Two-hidden-layer residual MLP with validation-selected correction cap.",
    deepMlpResidualGuarded,
    fold,
  ));

  const tcnSeed = 8000 + foldIndex;
  const tcnModel = trainTcnBase(fold, args, tcnSeed);
  const tcnResidual = selectTcnFamily(fold, tcnModel, false, args, tcnSeed);
  models.push(addEvaluation(
    "tiny_tcn_residual_seq8",
    "tcn",
    "Small causal TCN over masked past cursor history plus current timing features.",
    tcnResidual,
    fold,
  ));

  const tcnResidualGuarded = selectTcnFamily(fold, tcnModel, true, args, tcnSeed);
  models.push(addEvaluation(
    "tiny_tcn_residual_guarded_seq8",
    "tcn_guarded",
    "Small causal TCN over masked history with validation-selected correction cap.",
    tcnResidualGuarded,
    fold,
  ));

  return {
    foldId,
    train_session: trainRows[0]?.sessionId,
    eval_session: evalRows[0]?.sessionId,
    split_counts: {
      train_session_total: trainRows.length,
      fit_first_70pct: fold.fitRows.length,
      validation_last_30pct: fold.validationRows.length,
      heldout_session: fold.evalRows.length,
    },
    feature_count: fold.featureBuilder.featureNames.length,
    feature_names: fold.featureBuilder.featureNames,
    sequence_feature_count: fold.sequenceBuilder.featureNames.length,
    sequence_length: fold.sequenceBuilder.sequenceLength,
    sequence_feature_names: fold.sequenceBuilder.featureNames,
    models,
  };
}

function aggregateResults(folds) {
  const ids = new Set(folds.flatMap((fold) => fold.models.map((model) => model.id)));
  const aggregate = [];
  for (const id of ids) {
    const perFold = folds.map((fold) => fold.models.find((model) => model.id === id)).filter(Boolean);
    aggregate.push({
      id,
      fold_count: perFold.length,
      family: perFold[0].family,
      mean_delta_mean_px: perFold.reduce((sum, model) => sum + model.heldout.delta_vs_current.mean_px, 0) / perFold.length,
      mean_delta_rmse_px: perFold.reduce((sum, model) => sum + model.heldout.delta_vs_current.rmse_px, 0) / perFold.length,
      mean_delta_p95_px: perFold.reduce((sum, model) => sum + model.heldout.delta_vs_current.p95_px, 0) / perFold.length,
      mean_delta_p99_px: perFold.reduce((sum, model) => sum + model.heldout.delta_vs_current.p99_px, 0) / perFold.length,
      mean_heldout_p99_px: perFold.reduce((sum, model) => sum + model.heldout.overall.p99_px, 0) / perFold.length,
      total_worse_over_1px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.worse_over_1px, 0),
      total_worse_over_3px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.worse_over_3px, 0),
      total_worse_over_5px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.worse_over_5px, 0),
      total_better_over_1px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.better_over_1px, 0),
      total_better_over_3px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.better_over_3px, 0),
      total_better_over_5px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.better_over_5px, 0),
      parameter_count: perFold[0].training_summary?.parameter_count || 1,
      direct_product_relevance: perFold.some((model) => model.heldout.regressions_vs_current.worse_over_5px > 0)
        ? "teacher-only / not directly shippable because held-out >5px regressions occur"
        : perFold.some((model) => model.heldout.regressions_vs_current.worse_over_3px > 0 || model.heldout.regressions_vs_current.worse_over_1px > 500)
          ? "teacher-only unless distilled/gated; zero >5px but broad small regressions remain"
          : "passes required zero >5px and small-regression screen in this two-session test",
      fold_deltas: perFold.map((model) => ({
        delta_mean_px: model.heldout.delta_vs_current.mean_px,
        delta_rmse_px: model.heldout.delta_vs_current.rmse_px,
        delta_p95_px: model.heldout.delta_vs_current.p95_px,
        delta_p99_px: model.heldout.delta_vs_current.p99_px,
        worse_over_1px: model.heldout.regressions_vs_current.worse_over_1px,
        worse_over_3px: model.heldout.regressions_vs_current.worse_over_3px,
        worse_over_5px: model.heldout.regressions_vs_current.worse_over_5px,
      })),
    });
  }
  aggregate.sort((a, b) => (
    a.total_worse_over_5px - b.total_worse_over_5px ||
    a.mean_heldout_p99_px - b.mean_heldout_p99_px
  ));
  return aggregate;
}

function selectRecommendation(aggregate) {
  const learned = aggregate.filter((entry) => entry.id !== "current_dwm_aware_last2_gain_0_75");
  const bestRaw = learned.slice().sort((a, b) => a.mean_heldout_p99_px - b.mean_heldout_p99_px)[0] || null;
  const bestZeroVisible = learned
    .filter((entry) => entry.total_worse_over_5px === 0 && entry.mean_delta_p99_px < 0)
    .sort((a, b) => a.mean_heldout_p99_px - b.mean_heldout_p99_px)[0] || null;
  const bestStrictProduct = learned
    .filter((entry) => (
      entry.total_worse_over_5px === 0 &&
      entry.total_worse_over_3px === 0 &&
      entry.mean_delta_p95_px <= 0.05 &&
      entry.mean_delta_p99_px < 0
    ))
    .sort((a, b) => a.mean_heldout_p99_px - b.mean_heldout_p99_px)[0] || null;
  const current = aggregate.find((entry) => entry.id === "current_dwm_aware_last2_gain_0_75");
  const materialTeacher = bestZeroVisible && bestZeroVisible.mean_delta_p99_px <= -0.25;
  return {
    rule: "A deep teacher must improve average held-out cross-session p99 and have zero total >5 px regressions to be product-relevant; broad >1/>3 px regressions decide whether it is only a teacher.",
    current,
    best_raw_learned_by_mean_p99: bestRaw,
    best_zero_visible_regression_deep_teacher: bestZeroVisible,
    best_strict_product_candidate: bestStrictProduct,
    selected: bestStrictProduct || bestZeroVisible || current,
    material_teacher_signal: Boolean(materialTeacher),
    has_distillation_promise: Boolean(bestZeroVisible),
  };
}

function inspectEnvironment(args) {
  const gpu = {
    nvidia_smi_available: false,
    used_for_training: false,
    reason: "Training script is dependency-free Node.js CPU code; no local CUDA ML runtime was used.",
  };
  if (args.gpuNote) {
    gpu.nvidia_smi_available = true;
    gpu.detected = [args.gpuNote];
    gpu.reason = "GPU was detected by shell precheck, but training stayed on CPU because this no-dependency Node.js experiment has no CUDA ML runtime.";
  } else {
    try {
    const text = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], { encoding: "utf8", timeout: 5000 });
    gpu.nvidia_smi_available = true;
    gpu.detected = text.trim().split(/\r?\n/).filter(Boolean);
    } catch (error) {
      gpu.reason = "nvidia-smi was not available; dependency-free Node.js CPU training was used.";
    }
  }

  const python = {
    status: "plain python was not found on PATH",
    uv_status: "uv was not checked by the script",
    pytorch_status: "PyTorch/CUDA was not checked because no local Python interpreter was available",
  };
  try {
    python.status = execFileSync("python", ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
  } catch (error) {
    python.status = "plain python was not found on PATH";
  }
  try {
    const uvCache = path.join(args.out, ".uv-cache");
    python.uv_status = execFileSync("uv", ["run", "--no-python-downloads", "python", "--version"], {
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, UV_CACHE_DIR: uvCache },
    }).trim();
  } catch (error) {
    const stderr = String(error.stderr || "").trim().split(/\r?\n/).slice(0, 2).join(" ");
    python.uv_status = stderr || "uv could not find a local interpreter with downloads disabled";
  }
  if (!python.status.startsWith("plain python was not found") || python.uv_status.startsWith("Python")) {
    try {
      const uvCache = path.join(args.out, ".uv-cache");
      python.pytorch_status = execFileSync("uv", ["run", "--no-python-downloads", "python", "-c", "import torch; print(torch.__version__, torch.cuda.is_available())"], {
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, UV_CACHE_DIR: uvCache },
      }).trim();
    } catch (error) {
      python.pytorch_status = "PyTorch was not importable from the local interpreter without installing dependencies.";
    }
  }

  return {
    node: process.version,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpus: os.cpus().length,
    gpu,
    python,
  };
}

function datasetInspection(rows) {
  const keys = Object.keys(rows[0] || {});
  const null_counts = {};
  for (const key of keys) null_counts[key] = rows.filter((row) => row[key] === null || row[key] === undefined).length;
  return {
    rows: rows.length,
    sessions: summarizeCategorical(rows, (row) => row.sessionId),
    keys,
    null_counts,
    speed_bins: summarizeCategorical(rows, (row) => row.speedBin),
    horizon_bins: summarizeCategorical(rows, (row) => row.horizonBin),
    scheduler_lead_bins: summarizeCategorical(rows, (row) => row.schedulerLeadBin),
    numeric_summaries: {
      targetHorizonMs: scalarStats(rows.map((row) => row.targetHorizonMs)),
      dtMs: scalarStats(rows.map((row) => row.dtMs)),
      prevDtMs: scalarStats(rows.map((row) => row.prevDtMs)),
      speedPxS: scalarStats(rows.map((row) => row.speedPxS)),
      accelerationPxS2: scalarStats(rows.map((row) => row.accelerationPxS2)),
      schedulerLeadUs: scalarStats(rows.map((row) => row.schedulerLeadUs)),
    },
  };
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return null;
  }
}

function loadPriorPhaseContext(root) {
  const phase3 = readJsonIfExists(path.join(root, "phase-3 deterministic-baselines", "scores.json"));
  const phase4 = readJsonIfExists(path.join(root, "phase-4 learned-teacher", "scores.json"));
  const phase5 = readJsonIfExists(path.join(root, "phase-5 distillation", "scores.json"));
  const phase6 = readJsonIfExists(path.join(root, "phase-6 runtime-cost", "scores.json"));
  const context = {
    phase3: {
      phase: "Phase 3",
      selected: phase3?.recommendation?.selected?.id || "current_dwm_aware_last2_gain_0_75",
      summary: "Deterministic variants did not materially beat the current baseline under the visible-regression guard.",
    },
  };
  if (phase4?.recommendation?.selected) {
    const selected = phase4.recommendation.selected;
    context.phase4 = {
      phase: "Phase 4",
      selected: selected.id,
      summary: `guarded learned teacher p99 delta ${fmt(selected.mean_delta_p99_px)} px; >1/>3/>5 worse ${fmtInt(selected.total_worse_over_1px)}/${fmtInt(selected.total_worse_over_3px)}/${fmtInt(selected.total_worse_over_5px)}.`,
    };
  }
  if (phase5?.recommendation?.selected) {
    const selected = phase5.recommendation.selected;
    context.phase5 = {
      phase: "Phase 5",
      selected: selected.id,
      summary: `strict distilled candidate p99 delta ${fmt(selected.mean_delta_p99_px)} px, mean delta ${fmt(selected.mean_delta_mean_px)} px, zero >1/>3/>5 regressions.`,
    };
  }
  if (phase6) {
    context.phase6 = {
      phase: "Phase 6",
      selected: phase6?.recommendation?.selected?.id || "runtime acceptable",
      summary: "Runtime proxy was acceptable; confidence/accuracy remained the blocker.",
    };
  }
  return context;
}

function speedBreakdownRows(scores) {
  const selectedId = scores.recommendation.best_zero_visible_regression_deep_teacher?.id || scores.recommendation.best_raw_learned_by_mean_p99?.id;
  if (!selectedId) return [];
  const rows = [];
  for (const fold of scores.cross_validation) {
    const model = fold.models.find((entry) => entry.id === selectedId);
    if (!model) continue;
    for (const [bin, data] of Object.entries(model.heldout.breakdowns.speed_bins)) {
      rows.push([
        fold.foldId,
        bin,
        fmtInt(data.stats.n),
        fmt(data.stats.mean_px),
        fmt(data.stats.p95_px),
        fmt(data.stats.p99_px),
        fmtInt(data.regressions_vs_current.worse_over_1px),
        fmtInt(data.regressions_vs_current.worse_over_3px),
        fmtInt(data.regressions_vs_current.worse_over_5px),
      ]);
    }
  }
  return rows;
}

function renderReport(scores) {
  const rows = [];
  for (const fold of scores.cross_validation) {
    for (const model of fold.models) {
      rows.push([
        fold.foldId,
        model.id,
        `${fmt(model.heldout.overall.mean_px)} / ${fmt(model.heldout.overall.rmse_px)} / ${fmt(model.heldout.overall.p95_px)} / ${fmt(model.heldout.overall.p99_px)}`,
        `${fmt(model.heldout.delta_vs_current.mean_px)} / ${fmt(model.heldout.delta_vs_current.rmse_px)} / ${fmt(model.heldout.delta_vs_current.p95_px)} / ${fmt(model.heldout.delta_vs_current.p99_px)}`,
        fmtInt(model.heldout.regressions_vs_current.worse_over_1px),
        fmtInt(model.heldout.regressions_vs_current.worse_over_3px),
        fmtInt(model.heldout.regressions_vs_current.worse_over_5px),
      ]);
    }
  }
  const aggRows = scores.aggregate.map((entry) => [
    entry.id,
    fmt(entry.mean_delta_mean_px),
    fmt(entry.mean_delta_rmse_px),
    fmt(entry.mean_delta_p95_px),
    fmt(entry.mean_delta_p99_px),
    fmtInt(entry.total_worse_over_1px),
    fmtInt(entry.total_worse_over_3px),
    fmtInt(entry.total_worse_over_5px),
    entry.direct_product_relevance,
  ]);
  const selected = scores.recommendation.selected;
  const learnedWinner = scores.recommendation.best_zero_visible_regression_deep_teacher;
  const speedRows = speedBreakdownRows(scores);
  const overfitRows = [];
  for (const fold of scores.cross_validation) {
    const bestModel = fold.models.find((model) => model.id === (learnedWinner?.id || scores.recommendation.best_raw_learned_by_mean_p99?.id));
    if (!bestModel) continue;
    overfitRows.push([
      fold.foldId,
      bestModel.id,
      `${fmt(bestModel.train_block.overall.mean_px)} / ${fmt(bestModel.train_block.overall.p99_px)}`,
      `${fmt(bestModel.validation_block.overall.mean_px)} / ${fmt(bestModel.validation_block.overall.p99_px)}`,
      `${fmt(bestModel.heldout.overall.mean_px)} / ${fmt(bestModel.heldout.overall.p99_px)}`,
      fmtInt(bestModel.heldout.regressions_vs_current.worse_over_5px),
    ]);
  }
  const trainingRows = [];
  for (const fold of scores.cross_validation) {
    for (const model of fold.models) {
      if (!model.training_summary) continue;
      trainingRows.push([
        fold.foldId,
        model.id,
        fmtInt(model.training_summary.parameter_count),
        `${fmtInt(model.training_summary.actual_epochs)} / ${fmtInt(model.training_summary.requested_epochs)}`,
        fmt(model.training_summary.elapsed_sec, 2),
        model.training_summary.stopped_early ? model.training_summary.stopped_early_reason : "",
      ]);
    }
  }
  const priorRows = Object.values(scores.prior_phase_context || {}).map((entry) => [
    entry.phase,
    entry.selected || "",
    entry.summary || "",
  ]);
  const gpuText = scores.environment.gpu.nvidia_smi_available
    ? `GPU detected (${scores.environment.gpu.detected.join("; ")}), but training used CPU-only dependency-free Node.js.`
    : "No GPU runtime was available to this script; training used CPU-only dependency-free Node.js.";
  const strict = scores.recommendation.best_strict_product_candidate;
  let recommendationText;
  if (strict && scores.recommendation.material_teacher_signal) {
    recommendationText = `\`${strict.id}\` is the best strict product-shaped deep candidate and shows a material p99 signal. Distillation is justified, but the result still needs broader traces before shipping.`;
  } else if (learnedWinner && scores.recommendation.material_teacher_signal) {
    recommendationText = `\`${learnedWinner.id}\` clears the required zero >5 px guard and shows a material p99 signal, but its >1/>3 px regressions make it teacher-only rather than directly shippable.`;
  } else if (learnedWinner) {
    recommendationText = `\`${learnedWinner.id}\` clears the required zero >5 px guard, but the p99 gain is not material enough to change the Phase 5 conclusion. Treat it as a teacher probe, not a product target.`;
  } else {
    recommendationText = `No deep model clears both p99 improvement and the required zero >5 px held-out regression guard. Keep \`${scores.config.current_baseline}\`; model capacity is not the current limiter in these traces.`;
  }

  return `# ${PHASE_TITLE}

## Setup

${gpuText}

Python/PyTorch check: ${scores.environment.python.status}. UV no-download probe: ${scores.environment.python.uv_status}. ${scores.environment.python.pytorch_status}

The script used only Node.js standard-library APIs. Models were trained on the first 70% chronological block of the train session, selected on the last 30% block of that same session, then evaluated on the other full session.

Runtime was kept to one Node process. Timings below are approximate CPU training timings on the shared workstation.

## Prior Phase Context

${priorRows.length ? table(["phase", "selected / finding", "summary"], priorRows) : "Prior phase score files were not available."}

## Dataset And Features

Dataset rows: ${fmtInt(scores.dataset.rows)} across sessions ${Object.entries(scores.dataset.sessions).map(([k, v]) => `${k}: ${fmtInt(v)}`).join(", ")}.

Included causal scalar features: anchor position, previous two anchor positions through deltas/masks, dt and previous dt, current velocity, previous velocity, derived acceleration offsets, target horizon, DWM availability, scheduler lead, speed/horizon/lead bins.

Included causal sequence features for the TCN: ${scores.config.sequence.length}-step masked history ending at the current anchor, with age, dt, relative position, step deltas, and step velocity/speed. Training included ${fmt(100 * scores.config.sequence.history_dropout_rate, 1)}% missing-history augmentation by masking older history steps.

Excluded from features: label coordinates, target reference indices, reference interval, reference nearest distance, source ZIP, session ID, and any future reference-poll fields.

## Held-Out Cross-Session Results

${table(["fold", "model", "held-out mean/rmse/p95/p99", "delta mean/rmse/p95/p99", ">1px worse", ">3px worse", ">5px worse"], rows)}

## Aggregate

${table(["model", "mean delta mean", "mean delta rmse", "mean delta p95", "mean delta p99", "total >1px worse", "total >3px worse", "total >5px worse", "product relevance"], aggRows)}

## Training Cost

${trainingRows.length ? table(["fold", "model", "params", "epochs", "seconds", "early stop"], trainingRows) : "Baseline has no training cost."}

## Overfitting Check

${table(["fold", "model checked", "fit mean/p99", "validation mean/p99", "held-out mean/p99", "held-out >5px worse"], overfitRows)}

## Speed-Bin Breakdown For Best Deep Teacher

${speedRows.length ? table(["fold", "speed bin", "n", "mean", "p95", "p99", ">1 worse", ">3 worse", ">5 worse"], speedRows) : "No deep model was available for speed-bin breakdown."}

## Recommendation

Selected by the Phase 7 rule: \`${selected.id}\`.

${recommendationText}

Deep learning ${scores.recommendation.material_teacher_signal ? "does reveal a p99 teacher signal worth distilling, but only if the small-regression profile is acceptable." : "does not reveal a materially better target than the current deterministic baseline plus the tiny Phase 5 distilled correction."}
`;
}

function renderLog(scores) {
  const started = scores.generated_at_utc;
  return `# Experiment Log

- ${started}: Created Phase 7 deep-teacher experiment under \`phase-7 deep-teacher/\`.
- Inspected local tooling. \`python\` was not on PATH; \`uv run --no-python-downloads python --version\` did not find an interpreter, so PyTorch/CUDA could not be used without downloading or installing dependencies. \`nvidia-smi\` did show a local NVIDIA GPU, but this run stayed CPU-only.
- Inspected \`phase-2 dataset-builder/dataset.jsonl\`: ${fmtInt(scores.dataset.rows)} rows, fields include causal anchor history, dt/previous dt, velocity, speed, acceleration summary, DWM and scheduler timing bins.
- Read Phase 3/4/5/6 reports and score files for context.
- Confirmed dataset has enough history for scalar last2 velocity/acceleration-style features and constructed an ${scores.config.sequence.length}-step causal history tensor for sequence experiments.
- Built causal feature vectors without label/reference future fields. Sequence history uses only anchors at or before the current row.
- Trained a stronger two-hidden-layer residual MLP and a small causal TCN residual teacher. Guarded variants selected correction caps on validation.
- Added missing-history augmentation to the TCN by masking older history steps for ${fmt(100 * scores.config.sequence.history_dropout_rate, 1)}% of fit rows.
- For each fold, fit on train-session first 70%, selected hyperparameters/correction cap on train-session last 30%, then evaluated the full held-out session.
- Wrote \`scores.json\`, \`report.md\`, and this log.
`;
}

function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.out, { recursive: true });
  const started = performance.now();
  const rows = readJsonl(args.dataset);
  annotateSessionHistory(rows);
  const bySession = {};
  for (const row of rows) {
    if (!bySession[row.sessionId]) bySession[row.sessionId] = [];
    bySession[row.sessionId].push(row);
  }
  const folds = [
    evaluateFold(bySession["175951"], bySession["184947"], "train_175951_eval_184947", args, 0),
    evaluateFold(bySession["184947"], bySession["175951"], "train_184947_eval_175951", args, 1),
  ];
  const aggregate = aggregateResults(folds);
  const scores = {
    generated_at_utc: new Date().toISOString(),
    phase: PHASE,
    config: {
      current_baseline: "current_dwm_aware_last2_gain_0_75",
      baseline_gain: BASELINE_GAIN,
      regression_thresholds_px: REGRESSION_THRESHOLDS,
      primary_evaluation: ["train 175951, eval 184947", "train 184947, eval 175951"],
      training_policy: "Fit on first 70% of train session, select on last 30% validation block, evaluate on full held-out session.",
      feature_policy: "Causal anchor-time features only; future reference fields are labels/quality diagnostics and are excluded from model inputs.",
      guarded_correction_caps_px: GUARD_CAPS_PX,
      mlp: {
        hidden: [args.mlpHidden1, args.mlpHidden2],
        epochs: args.mlpEpochs,
        batch_size: args.batchSize,
        activation: "leaky_relu",
      },
      sequence: {
        length: args.sequenceLength,
        features: SEQUENCE_FEATURES,
        tcn_channels: args.tcnChannels,
        tcn_dense_hidden: args.tcnDenseHidden,
        tcn_epochs: args.tcnEpochs,
        history_dropout_rate: HISTORY_DROPOUT_RATE,
        history_dropout_max_steps: Math.min(HISTORY_DROPOUT_MAX_STEPS, args.sequenceLength - 1),
      },
    },
    environment: inspectEnvironment(args),
    dataset_path: path.relative(args.root, args.dataset).replace(/\\/g, "/"),
    dataset: datasetInspection(rows),
    prior_phase_context: loadPriorPhaseContext(args.root),
    cross_validation: folds,
    aggregate,
    recommendation: selectRecommendation(aggregate),
    performance: {
      elapsed_sec: (performance.now() - started) / 1000,
    },
  };
  writeJson(path.join(args.out, "scores.json"), scores);
  writeText(path.join(args.out, "report.md"), renderReport(scores));
  writeText(path.join(args.out, "experiment-log.md"), renderLog(scores));
  console.log(`Wrote ${path.join(args.out, "scores.json")}`);
  console.log(`Selected: ${scores.recommendation.selected.id}`);
  console.log(`Elapsed: ${fmt(scores.performance.elapsed_sec, 2)} sec`);
}

main();
