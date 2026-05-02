#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { performance } = require("node:perf_hooks");

const BASELINE_GAIN = 0.75;
const IDLE_GAP_MS = 100;
const SPEED_BINS = ["0-25 px/s", "25-100 px/s", "100-250 px/s", "250-500 px/s", "500-1000 px/s", "1000-2000 px/s", ">=2000 px/s"];
const HORIZON_BINS = ["0-2 ms", "2-4 ms", "4-8 ms", "8-12 ms", "12-16.7 ms", ">=16.7 ms"];
const LEAD_BINS = ["<0 us late", "0-500 us", "500-1000 us", "1000-1500 us", "1500-2000 us", ">=2000 us"];
const RIDGE_LAMBDAS = [0.01, 0.1, 1, 10, 100, 1000];
const CORRECTION_CAPS_PX = [0.125, 0.25, 0.5, 0.75, 1];
const TABLE_SHRINKAGE = [10, 50, 200];
const TABLE_MIN_N = [8, 20, 50];
const THRESHOLD_MIN_BENEFIT = [0.025, 0.05, 0.1, 0.2];
const THRESHOLD_MAX_VALIDATION_DELTA = [0.25, 0.5, 1];
const REGRESSION_THRESHOLDS = [1, 3, 5];

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
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--dataset") args.dataset = path.resolve(argv[++i]);
    else if (arg === "--out") args.out = path.resolve(argv[++i]);
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
  return { h, dtMs, prevDtMs, hasPrev, hasPrevPrev, prevDeltaX, prevDeltaY, prevPrevDeltaX, prevPrevDeltaY, prevVelocityX, prevVelocityY, accelX, accelY };
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
    for (const row of raw) variance += (row[j] - mean) ** 2;
    means.push(mean);
    stds.push(Math.sqrt(variance / raw.length) || 1);
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

function summarizeDelta(stats, baselineStats) {
  const out = {};
  for (const key of ["mean_px", "rmse_px", "p50_px", "p90_px", "p95_px", "p99_px", "max_px"]) {
    out[key] = stats[key] === null || baselineStats[key] === null ? null : stats[key] - baselineStats[key];
  }
  return out;
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

function clipVector(dx, dy, cap) {
  if (!Number.isFinite(cap) || cap <= 0) return [dx, dy];
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag <= cap || mag === 0) return [dx, dy];
  const scale = cap / mag;
  return [dx * scale, dy * scale];
}

function residualTarget(row) {
  const base = predictCurrent(row);
  return [row.labelX - base.x, row.labelY - base.y];
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
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];
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

function trainRidge(rows, featureBuilder, lambda) {
  const dim = featureBuilder.featureNames.length + 1;
  const xtx = Array.from({ length: dim }, () => Array(dim).fill(0));
  const xty = Array.from({ length: dim }, () => [0, 0]);
  for (const row of rows) {
    const x = [1, ...featureBuilder.vector(row)];
    const y = residualTarget(row);
    for (let i = 0; i < dim; i += 1) {
      xty[i][0] += x[i] * y[0];
      xty[i][1] += x[i] * y[1];
      for (let j = 0; j < dim; j += 1) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < dim; i += 1) xtx[i][i] += lambda;
  const weights = solveLinearSystem(xtx, xty);
  return {
    family: "ridge",
    weights,
    featureBuilder,
    correction(row, capPx) {
      const x = [1, ...featureBuilder.vector(row)];
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < dim; i += 1) {
        dx += x[i] * weights[i][0];
        dy += x[i] * weights[i][1];
      }
      return clipVector(dx, dy, capPx);
    },
    spec(capPx, mode = "ridge_residual_guarded") {
      return {
        type: "ridge_residual_guarded",
        mode,
        capPx,
        featureNames: featureBuilder.featureNames,
        means: featureBuilder.means,
        stds: featureBuilder.stds,
        weights,
      };
    },
  };
}

function speedIndex(label) {
  const idx = SPEED_BINS.indexOf(label);
  return idx >= 0 ? idx : SPEED_BINS.length;
}

function accelBin(row) {
  const hist = historyTerms(row);
  const accelHorizon = finite(row.accelerationPxS2) * hist.h * hist.h;
  if (accelHorizon < 0.025) return "accel:tiny";
  if (accelHorizon < 0.1) return "accel:low";
  if (accelHorizon < 0.35) return "accel:mid";
  return "accel:high";
}

function turnBin(row) {
  const hist = historyTerms(row);
  if (!hist.hasPrevPrev) return "turn:nohist";
  const aMag = Math.sqrt(hist.prevDeltaX ** 2 + hist.prevDeltaY ** 2);
  const bMag = Math.sqrt(hist.prevPrevDeltaX ** 2 + hist.prevPrevDeltaY ** 2);
  if (aMag < 0.01 || bMag < 0.01) return "turn:idle";
  const cos = (hist.prevDeltaX * hist.prevPrevDeltaX + hist.prevDeltaY * hist.prevPrevDeltaY) / (aMag * bMag);
  if (cos > 0.85) return "turn:straight";
  if (cos < 0.2) return "turn:sharp";
  return "turn:bend";
}

function leadBin(row) {
  if (!row.dwmTimingAvailable) return "lead:nodwm";
  if (row.schedulerLeadUs < 0) return "lead:late";
  if (row.schedulerLeadUs < 1500) return "lead:short";
  if (row.schedulerLeadUs >= 2000) return "lead:max";
  return "lead:nominal";
}

function tableKey(row, shape) {
  if (shape === "speed_accel_lead") return [row.speedBin, accelBin(row), leadBin(row)].join("|");
  if (shape === "speed_turn_lead") return [row.speedBin, turnBin(row), leadBin(row)].join("|");
  return [row.speedBin, accelBin(row), turnBin(row), leadBin(row)].join("|");
}

function trainPiecewiseTable(rows, options) {
  const cells = new Map();
  for (const row of rows) {
    const key = tableKey(row, options.shape);
    if (!cells.has(key)) cells.set(key, { n: 0, sx: 0, sy: 0 });
    const cell = cells.get(key);
    const target = residualTarget(row);
    cell.n += 1;
    cell.sx += target[0];
    cell.sy += target[1];
  }
  const tableCells = {};
  for (const [key, cell] of cells) {
    const shrink = cell.n / (cell.n + options.shrinkage);
    let dx = (cell.sx / cell.n) * shrink;
    let dy = (cell.sy / cell.n) * shrink;
    [dx, dy] = clipVector(dx, dy, options.capPx);
    tableCells[key] = { n: cell.n, dx, dy };
  }
  return {
    tableCells,
    options,
    correction(row) {
      const cell = tableCells[tableKey(row, options.shape)];
      if (!cell || cell.n < options.minN) return [0, 0];
      return [cell.dx, cell.dy];
    },
    spec(mode = "piecewise_residual_table") {
      return { type: "piecewise_residual_table", mode, options, cells: tableCells };
    },
  };
}

function makeResidualPredictor(model, mode) {
  return (row) => {
    const base = predictCurrent(row);
    const [dx, dy] = model.correction(row);
    const applied = dx !== 0 || dy !== 0;
    return { x: base.x + dx, y: base.y + dy, mode: applied ? mode : "current_passthrough" };
  };
}

function makeRidgePredictor(model, capPx, mode) {
  return (row) => {
    const base = predictCurrent(row);
    const [dx, dy] = model.correction(row, capPx);
    const applied = dx !== 0 || dy !== 0;
    return { x: base.x + dx, y: base.y + dy, mode: applied ? mode : "current_passthrough" };
  };
}

function buildThresholdedTable(tableModel, validationRows, validationBaseline, options) {
  const perCell = new Map();
  for (let i = 0; i < validationRows.length; i += 1) {
    const row = validationRows[i];
    const key = tableKey(row, tableModel.options.shape);
    const [dx, dy] = tableModel.correction(row);
    const base = predictCurrent(row);
    const error = distance(base.x + dx, base.y + dy, row.labelX, row.labelY);
    const delta = error - validationBaseline[i];
    if (!perCell.has(key)) perCell.set(key, []);
    perCell.get(key).push(delta);
  }
  const active = {};
  for (const [key, deltas] of perCell) {
    const sorted = deltas.slice().sort((a, b) => a - b);
    const stats = {
      n: sorted.length,
      mean_delta_px: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      p95_delta_px: percentile(sorted, 0.95),
      max_delta_px: sorted[sorted.length - 1],
    };
    if (
      stats.n >= options.minValidationN &&
      stats.mean_delta_px <= -options.minMeanBenefitPx &&
      stats.p95_delta_px <= options.maxP95DeltaPx &&
      stats.max_delta_px <= options.maxDeltaPx
    ) {
      active[key] = stats;
    }
  }
  return {
    options,
    baseTable: tableModel,
    active,
    correction(row) {
      const key = tableKey(row, tableModel.options.shape);
      if (!active[key]) return [0, 0];
      return tableModel.correction(row);
    },
    spec(mode = "thresholded_piecewise_table") {
      return { type: "thresholded_piecewise_table", mode, options, tableOptions: tableModel.options, cells: tableModel.tableCells, active };
    },
  };
}

function makeConfidenceRidge(ridgeModel, validationRows, validationBaseline, capPx, options) {
  const attempted = [];
  for (let i = 0; i < validationRows.length; i += 1) {
    const row = validationRows[i];
    if (speedIndex(row.speedBin) < options.minSpeedIndex) continue;
    const [dx, dy] = ridgeModel.correction(row, capPx);
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag < options.minCorrectionPx) continue;
    const base = predictCurrent(row);
    const error = distance(base.x + dx, base.y + dy, row.labelX, row.labelY);
    attempted.push(error - validationBaseline[i]);
  }
  const sorted = attempted.slice().sort((a, b) => a - b);
  const stats = sorted.length
    ? { n: sorted.length, mean_delta_px: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, p95_delta_px: percentile(sorted, 0.95), max_delta_px: sorted[sorted.length - 1] }
    : { n: 0, mean_delta_px: null, p95_delta_px: null, max_delta_px: null };
  const enabled = stats.n >= options.minValidationN && stats.mean_delta_px <= -options.minMeanBenefitPx && stats.p95_delta_px <= options.maxP95DeltaPx && stats.max_delta_px <= options.maxDeltaPx;
  return {
    options,
    validationGateStats: stats,
    enabled,
    correction(row) {
      if (!enabled || speedIndex(row.speedBin) < options.minSpeedIndex) return [0, 0];
      const [dx, dy] = ridgeModel.correction(row, capPx);
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag < options.minCorrectionPx) return [0, 0];
      return [dx, dy];
    },
    spec(mode = "confidence_gated_ridge") {
      return { ...ridgeModel.spec(capPx, mode), type: "confidence_gated_ridge", gate: options, validationGateStats: stats, enabled };
    },
  };
}

function chooseByValidation(evaluations) {
  const p95Tolerance = 0.05;
  const eligible = evaluations.filter((entry) => (
    entry.validation.regressions_vs_current.worse_over_5px === 0 &&
    entry.validation.regressions_vs_current.worse_over_3px === 0 &&
    entry.validation.delta_vs_current.p95_px <= p95Tolerance
  ));
  const pool = eligible.length ? eligible : evaluations;
  return pool.slice().sort((a, b) => (
    a.validation.regressions_vs_current.worse_over_5px - b.validation.regressions_vs_current.worse_over_5px ||
    a.validation.regressions_vs_current.worse_over_3px - b.validation.regressions_vs_current.worse_over_3px ||
    Math.max(0, a.validation.delta_vs_current.p95_px) - Math.max(0, b.validation.delta_vs_current.p95_px) ||
    (a.validation.delta_vs_current.p99_px ?? Infinity) - (b.validation.delta_vs_current.p99_px ?? Infinity) ||
    (a.validation.delta_vs_current.mean_px ?? Infinity) - (b.validation.delta_vs_current.mean_px ?? Infinity)
  ))[0];
}

function addEvaluation(id, family, description, selected, fold) {
  return {
    id,
    family,
    description,
    selected_parameters: selected.parameters,
    runtime_spec: selected.spec,
    runtime_spec_summary: summarizeSpec(selected.spec),
    train_block: evaluateRows(fold.fitRows, selected.predictor, id, fold.fitBaseline),
    validation_block: evaluateRows(fold.validationRows, selected.predictor, id, fold.validationBaseline),
    heldout: evaluateRows(fold.evalRows, selected.predictor, id, fold.evalBaseline),
  };
}

function summarizeSpec(spec) {
  if (spec.type === "ridge_residual_guarded" || spec.type === "confidence_gated_ridge") {
    return {
      type: spec.type,
      parameter_count: spec.weights.length * 2 + spec.means.length + spec.stds.length,
      feature_count: spec.featureNames.length,
      capPx: spec.capPx,
      implementation_complexity: spec.type === "confidence_gated_ridge" ? "moderate: feature normalization plus simple gate" : "moderate: feature normalization and dot products",
    };
  }
  const cells = Object.keys(spec.cells || {}).length;
  const active = Object.keys(spec.active || spec.cells || {}).length;
  return {
    type: spec.type,
    parameter_count: active * 2,
    cell_count: cells,
    active_cell_count: active,
    capPx: spec.options?.capPx ?? spec.tableOptions?.capPx,
    implementation_complexity: spec.type === "thresholded_piecewise_table" ? "low: small keyed table with active-cell guard" : "low: small keyed table",
  };
}

function selectRidge(fold) {
  const evaluations = [];
  for (const lambda of RIDGE_LAMBDAS) {
    const model = trainRidge(fold.fitRows, fold.featureBuilder, lambda);
    for (const capPx of CORRECTION_CAPS_PX) {
      const predictor = makeRidgePredictor(model, capPx, "safe_ridge_residual_guarded");
      const spec = model.spec(capPx, "safe_ridge_residual_guarded");
      evaluations.push({
        parameters: { lambda, capPx },
        predictor,
        spec,
        validation: evaluateRows(fold.validationRows, predictor, "safe_ridge_residual_guarded", fold.validationBaseline),
      });
    }
  }
  return chooseByValidation(evaluations);
}

function selectPiecewise(fold) {
  const evaluations = [];
  for (const shape of ["speed_accel_lead", "speed_turn_lead", "speed_accel_turn_lead"]) {
    for (const capPx of CORRECTION_CAPS_PX) {
      for (const shrinkage of TABLE_SHRINKAGE) {
        for (const minN of TABLE_MIN_N) {
          const model = trainPiecewiseTable(fold.fitRows, { shape, capPx, shrinkage, minN });
          const predictor = makeResidualPredictor(model, "piecewise_residual_table");
          evaluations.push({
            parameters: { shape, capPx, shrinkage, minN },
            predictor,
            spec: model.spec("piecewise_residual_table"),
            validation: evaluateRows(fold.validationRows, predictor, "piecewise_residual_table", fold.validationBaseline),
          });
        }
      }
    }
  }
  return chooseByValidation(evaluations);
}

function selectThresholdedTable(fold) {
  const evaluations = [];
  for (const shape of ["speed_accel_lead", "speed_turn_lead", "speed_accel_turn_lead"]) {
    for (const capPx of CORRECTION_CAPS_PX) {
      for (const shrinkage of TABLE_SHRINKAGE) {
        const baseTable = trainPiecewiseTable(fold.fitRows, { shape, capPx, shrinkage, minN: 8 });
        for (const minValidationN of TABLE_MIN_N) {
          for (const minMeanBenefitPx of THRESHOLD_MIN_BENEFIT) {
            for (const maxDeltaPx of THRESHOLD_MAX_VALIDATION_DELTA) {
              const model = buildThresholdedTable(baseTable, fold.validationRows, fold.validationBaseline, {
                minValidationN,
                minMeanBenefitPx,
                maxP95DeltaPx: 0.05,
                maxDeltaPx,
              });
              const predictor = makeResidualPredictor(model, "thresholded_piecewise_table");
              evaluations.push({
                parameters: { shape, capPx, shrinkage, minValidationN, minMeanBenefitPx, maxP95DeltaPx: 0.05, maxDeltaPx, activeCells: Object.keys(model.active).length },
                predictor,
                spec: model.spec("thresholded_piecewise_table"),
                validation: evaluateRows(fold.validationRows, predictor, "thresholded_piecewise_table", fold.validationBaseline),
              });
            }
          }
        }
      }
    }
  }
  return chooseByValidation(evaluations);
}

function selectConfidenceRidge(fold) {
  const evaluations = [];
  for (const lambda of RIDGE_LAMBDAS) {
    const ridge = trainRidge(fold.fitRows, fold.featureBuilder, lambda);
    for (const capPx of CORRECTION_CAPS_PX) {
      for (const minSpeedIndex of [3, 4, 5, 6]) {
        for (const minCorrectionPx of [0.05, 0.1, 0.2, 0.4]) {
          for (const minMeanBenefitPx of THRESHOLD_MIN_BENEFIT) {
            const model = makeConfidenceRidge(ridge, fold.validationRows, fold.validationBaseline, capPx, {
              minSpeedIndex,
              minCorrectionPx,
              minValidationN: 20,
              minMeanBenefitPx,
              maxP95DeltaPx: 0.05,
              maxDeltaPx: 1,
            });
            const predictor = makeResidualPredictor(model, "confidence_gated_ridge");
            evaluations.push({
              parameters: { lambda, capPx, minSpeedBin: SPEED_BINS[minSpeedIndex] || "missing", minCorrectionPx, minMeanBenefitPx, enabled: model.enabled },
              predictor,
              spec: model.spec("confidence_gated_ridge"),
              validation: evaluateRows(fold.validationRows, predictor, "confidence_gated_ridge", fold.validationBaseline),
            });
          }
        }
      }
    }
  }
  return chooseByValidation(evaluations);
}

function makeFold(trainRows, evalRows, foldId) {
  const fitRows = trainRows.filter((row) => row.chronologicalBlock === "train_block_first_70pct");
  const validationRows = trainRows.filter((row) => row.chronologicalBlock === "validation_block_last_30pct");
  return {
    foldId,
    trainRows,
    fitRows,
    validationRows,
    evalRows,
    featureBuilder: makeFeatureBuilder(fitRows),
    fitBaseline: baselineErrors(fitRows),
    validationBaseline: baselineErrors(validationRows),
    evalBaseline: baselineErrors(evalRows),
  };
}

function evaluateFold(trainRows, evalRows, foldId) {
  const fold = makeFold(trainRows, evalRows, foldId);
  const models = [];
  models.push({
    id: "current_dwm_aware_last2_gain_0_75",
    family: "current_baseline",
    description: "Current DWM-aware last-two-sample predictor with gain 0.75.",
    selected_parameters: { gain: BASELINE_GAIN },
    runtime_spec: { type: "current", mode: "current_dwm_aware_last2_gain_0_75", gain: BASELINE_GAIN },
    runtime_spec_summary: { type: "current", parameter_count: 1, implementation_complexity: "already implemented" },
    train_block: evaluateRows(fold.fitRows, predictCurrent, "current", fold.fitBaseline),
    validation_block: evaluateRows(fold.validationRows, predictCurrent, "current", fold.validationBaseline),
    heldout: evaluateRows(fold.evalRows, predictCurrent, "current", fold.evalBaseline),
  });

  models.push(addEvaluation(
    "safe_ridge_residual_guarded",
    "ridge_guarded",
    "Capped ridge residual correction, retrained with stricter correction caps than Phase 4.",
    selectRidge(fold),
    fold,
  ));
  models.push(addEvaluation(
    "piecewise_residual_table",
    "piecewise_table",
    "Tiny residual correction table keyed by speed, acceleration/turn proxy, and scheduler lead flags.",
    selectPiecewise(fold),
    fold,
  ));
  models.push(addEvaluation(
    "thresholded_piecewise_table",
    "thresholded_table",
    "Piecewise correction table whose cells are enabled only when validation deltas show high-confidence benefit.",
    selectThresholdedTable(fold),
    fold,
  ));
  models.push(addEvaluation(
    "confidence_gated_ridge",
    "thresholded_ridge",
    "Capped ridge residual correction applied only for high-speed rows whose validation gate passed.",
    selectConfidenceRidge(fold),
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
      mean_delta_p50_px: perFold.reduce((sum, model) => sum + model.heldout.delta_vs_current.p50_px, 0) / perFold.length,
      mean_delta_p90_px: perFold.reduce((sum, model) => sum + model.heldout.delta_vs_current.p90_px, 0) / perFold.length,
      mean_delta_p95_px: perFold.reduce((sum, model) => sum + model.heldout.delta_vs_current.p95_px, 0) / perFold.length,
      mean_delta_p99_px: perFold.reduce((sum, model) => sum + model.heldout.delta_vs_current.p99_px, 0) / perFold.length,
      mean_heldout_p99_px: perFold.reduce((sum, model) => sum + model.heldout.overall.p99_px, 0) / perFold.length,
      total_worse_over_1px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.worse_over_1px, 0),
      total_worse_over_3px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.worse_over_3px, 0),
      total_worse_over_5px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.worse_over_5px, 0),
      total_better_over_1px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.better_over_1px, 0),
      total_better_over_3px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.better_over_3px, 0),
      total_better_over_5px: perFold.reduce((sum, model) => sum + model.heldout.regressions_vs_current.better_over_5px, 0),
      parameter_count: Math.max(...perFold.map((model) => model.runtime_spec_summary.parameter_count || 0)),
      implementation_complexity: perFold[0].runtime_spec_summary.implementation_complexity,
      fold_deltas: perFold.map((model) => ({
        delta_mean_px: model.heldout.delta_vs_current.mean_px,
        delta_p95_px: model.heldout.delta_vs_current.p95_px,
        delta_p99_px: model.heldout.delta_vs_current.p99_px,
        worse_over_3px: model.heldout.regressions_vs_current.worse_over_3px,
        worse_over_5px: model.heldout.regressions_vs_current.worse_over_5px,
      })),
    });
  }
  aggregate.sort((a, b) => (
    a.total_worse_over_5px - b.total_worse_over_5px ||
    a.total_worse_over_3px - b.total_worse_over_3px ||
    Math.max(0, a.mean_delta_p95_px) - Math.max(0, b.mean_delta_p95_px) ||
    a.mean_heldout_p99_px - b.mean_heldout_p99_px
  ));
  return aggregate;
}

function selectRecommendation(aggregate) {
  const current = aggregate.find((entry) => entry.id === "current_dwm_aware_last2_gain_0_75");
  const learned = aggregate.filter((entry) => entry.id !== current.id);
  const strict = learned.filter((entry) => (
    entry.total_worse_over_5px === 0 &&
    entry.total_worse_over_3px === 0 &&
    entry.mean_delta_p95_px <= 0.05 &&
    entry.mean_delta_p99_px < 0 &&
    entry.fold_deltas.every((fold) => fold.delta_p99_px <= 0.05)
  ));
  const bestStrict = strict.slice().sort((a, b) => (
    a.mean_delta_p99_px - b.mean_delta_p99_px ||
    a.mean_delta_mean_px - b.mean_delta_mean_px
  ))[0] || null;
  const bestP99 = learned.slice().sort((a, b) => a.mean_delta_p99_px - b.mean_delta_p99_px)[0] || null;
  return {
    rule: "Select a distilled model only if it has zero >5px regressions, preferably zero >3px regressions, p95 delta <= +0.05 px, negative average p99 delta, and no fold with material p99 worsening.",
    current,
    best_raw_learned_by_mean_p99: bestP99,
    best_strict_distilled: bestStrict,
    selected: bestStrict || current,
    implement_now: Boolean(bestStrict),
  };
}

function datasetInspection(rows) {
  return {
    rows: rows.length,
    sessions: summarizeCategorical(rows, (row) => row.sessionId),
    speed_bins: summarizeCategorical(rows, (row) => row.speedBin),
    horizon_bins: summarizeCategorical(rows, (row) => row.horizonBin),
    scheduler_lead_bins: summarizeCategorical(rows, (row) => row.schedulerLeadBin),
    numeric_summaries: {
      targetHorizonMs: scalarStats(rows.map((row) => row.targetHorizonMs)),
      dtMs: scalarStats(rows.map((row) => row.dtMs)),
      speedPxS: scalarStats(rows.map((row) => row.speedPxS)),
      accelerationPxS2: scalarStats(rows.map((row) => row.accelerationPxS2)),
      schedulerLeadUs: scalarStats(rows.map((row) => row.schedulerLeadUs)),
    },
  };
}

function speedBreakdownRows(scores) {
  const selectedId = scores.recommendation.best_strict_distilled?.id || scores.recommendation.best_raw_learned_by_mean_p99?.id;
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
  const heldoutRows = [];
  for (const fold of scores.cross_validation) {
    for (const model of fold.models) {
      heldoutRows.push([
        fold.foldId,
        model.id,
        `${fmt(model.heldout.overall.mean_px)} / ${fmt(model.heldout.overall.rmse_px)} / ${fmt(model.heldout.overall.p95_px)} / ${fmt(model.heldout.overall.p99_px)} / ${fmt(model.heldout.overall.max_px)}`,
        `${fmt(model.heldout.delta_vs_current.mean_px)} / ${fmt(model.heldout.delta_vs_current.p95_px)} / ${fmt(model.heldout.delta_vs_current.p99_px)}`,
        fmtInt(model.heldout.regressions_vs_current.worse_over_1px),
        fmtInt(model.heldout.regressions_vs_current.worse_over_3px),
        fmtInt(model.heldout.regressions_vs_current.worse_over_5px),
        fmtInt(model.heldout.regressions_vs_current.better_over_1px),
      ]);
    }
  }
  const aggregateRows = scores.aggregate.map((entry) => [
    entry.id,
    fmt(entry.mean_delta_mean_px),
    fmt(entry.mean_delta_p95_px),
    fmt(entry.mean_delta_p99_px),
    fmtInt(entry.total_worse_over_1px),
    fmtInt(entry.total_worse_over_3px),
    fmtInt(entry.total_worse_over_5px),
    fmtInt(entry.total_better_over_1px),
    fmtInt(entry.parameter_count),
    entry.implementation_complexity,
  ]);
  const validationRows = [];
  for (const fold of scores.cross_validation) {
    for (const model of fold.models.filter((entry) => entry.id !== "current_dwm_aware_last2_gain_0_75")) {
      validationRows.push([
        fold.foldId,
        model.id,
        JSON.stringify(model.selected_parameters),
        `${fmt(model.validation_block.delta_vs_current.mean_px)} / ${fmt(model.validation_block.delta_vs_current.p95_px)} / ${fmt(model.validation_block.delta_vs_current.p99_px)}`,
        fmtInt(model.validation_block.regressions_vs_current.worse_over_3px),
        fmtInt(model.validation_block.regressions_vs_current.worse_over_5px),
      ]);
    }
  }
  const speedRows = speedBreakdownRows(scores);
  const selected = scores.recommendation.selected;
  const strict = scores.recommendation.best_strict_distilled;
  const bestRaw = scores.recommendation.best_raw_learned_by_mean_p99;
  const recommendationText = strict
    ? `\`${strict.id}\` passes the stricter Phase 5 rule and is the implementation candidate. The win is still small, so it should ship only behind a feature flag and with trace collection left on.`
    : `No distilled candidate passes the stricter Phase 5 rule. The best raw p99 candidate was \`${bestRaw?.id}\`, but it did not clear all safety criteria. Keep \`${scores.config.current_baseline}\` and collect more traces.`;

  return `# Phase 5 - Distillation

## Setup

Dependency-free Node.js CPU experiment on ${scores.environment.platform}, Node ${scores.environment.node}. Dataset rows: ${fmtInt(scores.dataset.rows)} across sessions ${Object.entries(scores.dataset.sessions).map(([k, v]) => `${k}: ${fmtInt(v)}`).join(", ")}.

Fold policy matches Phase 4: fit on the first 70% chronological block of one session, select on that session's last 30%, then evaluate on the other full session. No trace ZIPs or product source files were edited.

## Candidate Families

- \`safe_ridge_residual_guarded\`: retrained residual ridge with stricter caps up to 1 px.
- \`piecewise_residual_table\`: tiny C#-friendly residual table keyed by speed bin, acceleration or turning proxy, and scheduler lead state.
- \`thresholded_piecewise_table\`: same table, but cells are enabled only if validation deltas show high-confidence benefit.
- \`confidence_gated_ridge\`: ridge residual correction gated by speed, correction magnitude, and validation safety stats.

The optional shallow MLP was not advanced here: Phase 4's larger guarded MLP had broad small regressions, and these Phase 5 product-shaped candidates were designed to remove that failure mode before adding another neural hot path.

## Held-Out Cross-Session Metrics

${table(["fold", "model", "mean/rmse/p95/p99/max", "delta mean/p95/p99", ">1 worse", ">3 worse", ">5 worse", ">1 better"], heldoutRows)}

## Aggregate

${table(["model", "delta mean", "delta p95", "delta p99", "total >1 worse", "total >3 worse", "total >5 worse", "total >1 better", "params", "C# complexity"], aggregateRows)}

## Validation-Selected Parameters

${table(["fold", "model", "selected parameters", "validation delta mean/p95/p99", "validation >3 worse", "validation >5 worse"], validationRows)}

## Speed-Bin Breakdown For Best Distilled Candidate

${speedRows.length ? table(["fold", "speed bin", "n", "mean", "p95", "p99", ">1 worse", ">3 worse", ">5 worse"], speedRows) : "No learned candidate was available for speed-bin breakdown."}

## Recommendation

Selection rule: ${scores.recommendation.rule}

Selected: \`${selected.id}\`.

${recommendationText}
`;
}

function renderLog(scores) {
  return `# Experiment Log

- ${scores.generated_at_utc}: Created Phase 5 distillation experiment under \`phase-5 distillation/\`.
- Read \`${scores.dataset_path}\` with ${fmtInt(scores.dataset.rows)} rows.
- Reused Phase 4 fold policy: fit first 70% of one session, select last 30%, evaluate cross-session in both directions.
- Trained safe capped ridge residual candidates.
- Trained piecewise residual tables keyed by speed, acceleration/turning proxy, and scheduler lead flags.
- Trained thresholded table variants with validation-enabled cells only.
- Trained confidence-gated ridge variants.
- Applied stricter selection: zero >5px, prefer zero >3px, p95 delta <= +0.05 px, p99 improvement across held-out folds.
- Wrote \`scores.json\`, \`report.md\`, and this log.
`;
}

function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.out, { recursive: true });
  const started = performance.now();
  const rows = readJsonl(args.dataset);
  const bySession = {};
  for (const row of rows) {
    if (!bySession[row.sessionId]) bySession[row.sessionId] = [];
    bySession[row.sessionId].push(row);
  }
  const folds = [
    evaluateFold(bySession["175951"], bySession["184947"], "train_175951_eval_184947"),
    evaluateFold(bySession["184947"], bySession["175951"], "train_184947_eval_175951"),
  ];
  const aggregate = aggregateResults(folds);
  const scores = {
    generated_at_utc: new Date().toISOString(),
    phase: "phase-5 distillation",
    config: {
      current_baseline: "current_dwm_aware_last2_gain_0_75",
      baseline_gain: BASELINE_GAIN,
      regression_thresholds_px: REGRESSION_THRESHOLDS,
      ridge_lambdas: RIDGE_LAMBDAS,
      correction_caps_px: CORRECTION_CAPS_PX,
      table_shrinkage: TABLE_SHRINKAGE,
      table_min_n: TABLE_MIN_N,
      threshold_min_benefit_px: THRESHOLD_MIN_BENEFIT,
      threshold_max_validation_delta_px: THRESHOLD_MAX_VALIDATION_DELTA,
    },
    environment: {
      node: process.version,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      cpus: os.cpus().length,
    },
    dataset_path: path.relative(args.root, args.dataset).replace(/\\/g, "/"),
    dataset: datasetInspection(rows),
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
