#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const TRACE_FILES = [
  "cursor-mirror-trace-20260502-175951.zip",
  "cursor-mirror-trace-20260502-184947.zip",
];

const HORIZONS_MS = [4, 8, 12, 16.67];
const SPEED_BINS = [
  { label: "0-25", min: 0, max: 25 },
  { label: "25-100", min: 25, max: 100 },
  { label: "100-250", min: 100, max: 250 },
  { label: "250-500", min: 250, max: 500 },
  { label: "500-1000", min: 500, max: 1000 },
  { label: "1000-2000", min: 1000, max: 2000 },
  { label: ">=2000", min: 2000, max: Infinity },
];

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  const outDir = path.resolve(scriptDir, "..");
  const args = {
    root,
    datasetJson: path.join(outDir, "phase-1-dataset.json"),
    datasetMd: path.join(outDir, "phase-1-dataset.md"),
    baselinesJson: path.join(outDir, "phase-2-classical-baselines.json"),
    baselinesMd: path.join(outDir, "phase-2-classical-baselines.md"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--dataset-json") args.datasetJson = path.resolve(argv[++i]);
    else if (arg === "--dataset-md") args.datasetMd = path.resolve(argv[++i]);
    else if (arg === "--baselines-json") args.baselinesJson = path.resolve(argv[++i]);
    else if (arg === "--baselines-md") args.baselinesMd = path.resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node phase12-classical.js [--root <repo>]
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("ZIP end-of-central-directory was not found");
}

function openZip(zipPath) {
  const zip = fs.readFileSync(zipPath);
  const eocd = findEocd(zip);
  const centralDirSize = zip.readUInt32LE(eocd + 12);
  const centralDirOffset = zip.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralDirOffset;
  const end = centralDirOffset + centralDirSize;
  while (offset < end) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Invalid ZIP central directory at ${offset}`);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return { zip, entries };
}

function readZipEntry(opened, entryName) {
  const entry = opened.entries.get(entryName);
  if (!entry) throw new Error(`ZIP entry not found: ${entryName}`);
  const zip = opened.zip;
  const localHeaderOffset = entry.localHeaderOffset;
  if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error(`Invalid local file for ${entryName}`);
  const nameLen = zip.readUInt16LE(localHeaderOffset + 26);
  const extraLen = zip.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = zip.subarray(dataOffset, dataOffset + entry.compressedSize);
  const data = entry.method === 0
    ? Buffer.from(compressed)
    : entry.method === 8
      ? zlib.inflateRawSync(compressed)
      : null;
  if (!data) throw new Error(`Unsupported ZIP method ${entry.method}`);
  if (data.length !== entry.uncompressedSize) {
    throw new Error(`Unexpected ZIP size for ${entryName}: ${data.length} != ${entry.uncompressedSize}`);
  }
  return data;
}

function numberOrNull(text) {
  if (text === undefined || text === null || text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function boolOrFalse(text) {
  return text === true || text === "true" || text === "True";
}

function rel(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function distance(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function clampVector(dx, dy, cap) {
  if (!Number.isFinite(cap) || cap <= 0) return { dx, dy };
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag <= cap || mag === 0) return { dx, dy };
  const scale = cap / mag;
  return { dx: dx * scale, dy: dy * scale };
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
  const data = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (data.length === 0) {
    return { count: 0, mean: null, rmse: null, p50: null, p90: null, p95: null, p99: null, max: null };
  }
  let sum = 0;
  let sumSquares = 0;
  for (const value of data) {
    sum += value;
    sumSquares += value * value;
  }
  return {
    count: data.length,
    mean: sum / data.length,
    rmse: Math.sqrt(sumSquares / data.length),
    p50: percentile(data, 0.5),
    p90: percentile(data, 0.9),
    p95: percentile(data, 0.95),
    p99: percentile(data, 0.99),
    max: data[data.length - 1],
  };
}

function scalarStats(values) {
  const data = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (data.length === 0) return { count: 0, mean: null, p50: null, p95: null, max: null };
  let sum = 0;
  for (const value of data) sum += value;
  return {
    count: data.length,
    mean: sum / data.length,
    p50: percentile(data, 0.5),
    p95: percentile(data, 0.95),
    max: data[data.length - 1],
  };
}

function lowerBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function interpolateRef(trace, targetUs) {
  const times = trace.refTimesUs;
  const right = lowerBound(times, targetUs);
  if (right <= 0 || right >= times.length) return null;
  const left = right - 1;
  const t0 = times[left];
  const t1 = times[right];
  if (t1 <= t0) return null;
  const frac = (targetUs - t0) / (t1 - t0);
  return {
    x: trace.refX[left] + (trace.refX[right] - trace.refX[left]) * frac,
    y: trace.refY[left] + (trace.refY[right] - trace.refY[left]) * frac,
  };
}

function speedBin(speed) {
  for (const bin of SPEED_BINS) {
    if (speed >= bin.min && speed < bin.max) return bin.label;
  }
  return "missing";
}

function loadTrace(root, fileName, sessionId) {
  const zipPath = path.join(root, fileName);
  const opened = openZip(zipPath);
  const metadata = JSON.parse(readZipEntry(opened, "metadata.json").toString("utf8").replace(/^\uFEFF/, ""));
  const text = readZipEntry(opened, "trace.csv").toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",");
  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  const required = ["elapsedMicroseconds", "event", "x", "y", "cursorX", "cursorY"];
  for (const name of required) {
    if (!(name in column)) throw new Error(`${fileName} missing column ${name}`);
  }

  const eventCounts = {};
  const refTimesUs = [];
  const refX = [];
  const refY = [];
  const anchors = [];
  const eventIntervalsMs = {};
  const lastEventUs = {};
  let csvRows = 0;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    csvRows += 1;
    const parts = line.split(",");
    const event = parts[column.event];
    const elapsedUs = numberOrNull(parts[column.elapsedMicroseconds]);
    if (!Number.isFinite(elapsedUs)) continue;
    eventCounts[event] = (eventCounts[event] || 0) + 1;
    if (lastEventUs[event] !== undefined) {
      if (!eventIntervalsMs[event]) eventIntervalsMs[event] = [];
      eventIntervalsMs[event].push((elapsedUs - lastEventUs[event]) / 1000);
    }
    lastEventUs[event] = elapsedUs;

    const rawX = numberOrNull(parts[column.cursorX]) ?? numberOrNull(parts[column.x]);
    const rawY = numberOrNull(parts[column.cursorY]) ?? numberOrNull(parts[column.y]);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) continue;

    if (event === "referencePoll") {
      refTimesUs.push(elapsedUs);
      refX.push(rawX);
      refY.push(rawY);
    } else if (event === "runtimeSelfSchedulerPoll") {
      anchors.push({
        elapsedUs,
        rowX: rawX,
        rowY: rawY,
        dwmTimingAvailable: boolOrFalse(parts[column.dwmTimingAvailable]),
      });
    }
  }

  return {
    sessionId,
    sourceZip: fileName,
    metadata,
    csvRows,
    header,
    eventCounts,
    eventIntervalsMs,
    refTimesUs,
    refX,
    refY,
    anchors,
  };
}

function recentKinematics(trace, refIndex) {
  if (refIndex <= 0) return { vx: 0, vy: 0, speed: 0 };
  const t0 = trace.refTimesUs[refIndex - 1];
  const t1 = trace.refTimesUs[refIndex];
  const dtSec = (t1 - t0) / 1_000_000;
  if (dtSec <= 0) return { vx: 0, vy: 0, speed: 0 };
  const vx = (trace.refX[refIndex] - trace.refX[refIndex - 1]) / dtSec;
  const vy = (trace.refY[refIndex] - trace.refY[refIndex - 1]) / dtSec;
  return { vx, vy, speed: Math.sqrt(vx * vx + vy * vy), dtMs: dtSec * 1000 };
}

function historyStartIndex(trace, refIndex, windowMs) {
  const minUs = trace.refTimesUs[refIndex] - windowMs * 1000;
  return Math.max(0, lowerBound(trace.refTimesUs, minUs));
}

function pathFeatures(trace, refIndex, windowMs) {
  const start = historyStartIndex(trace, refIndex, windowMs);
  if (refIndex - start < 1) return { net: 0, path: 0, efficiency: 0, reversals: 0 };
  let pathLength = 0;
  let reversals = 0;
  let lastSignX = 0;
  let lastSignY = 0;
  for (let i = start + 1; i <= refIndex; i += 1) {
    const dx = trace.refX[i] - trace.refX[i - 1];
    const dy = trace.refY[i] - trace.refY[i - 1];
    pathLength += Math.sqrt(dx * dx + dy * dy);
    const signX = Math.sign(dx);
    const signY = Math.sign(dy);
    if (signX !== 0 && lastSignX !== 0 && signX !== lastSignX) reversals += 1;
    if (signY !== 0 && lastSignY !== 0 && signY !== lastSignY) reversals += 1;
    if (signX !== 0) lastSignX = signX;
    if (signY !== 0) lastSignY = signY;
  }
  const net = distance(trace.refX[start], trace.refY[start], trace.refX[refIndex], trace.refY[refIndex]);
  return { net, path: pathLength, efficiency: pathLength > 0 ? net / pathLength : 0, reversals };
}

function buildDatasetForTrace(trace) {
  const rows = [];
  const rowsByHorizon = Object.fromEntries(HORIZONS_MS.map((h) => [String(h), 0]));
  const rowsBySpeedBin = {};
  const diagnostics = {
    anchorsSeen: trace.anchors.length,
    anchorsWithInsufficientHistory: 0,
    labelsMissing: 0,
    rowsBuilt: 0,
  };

  for (const anchor of trace.anchors) {
    const right = lowerBound(trace.refTimesUs, anchor.elapsedUs);
    const refIndex = right > 0 && trace.refTimesUs[right] > anchor.elapsedUs ? right - 1 : Math.min(right, trace.refTimesUs.length - 1);
    if (refIndex < 3) {
      diagnostics.anchorsWithInsufficientHistory += 1;
      continue;
    }
    const currentX = trace.refX[refIndex];
    const currentY = trace.refY[refIndex];
    const kin = recentKinematics(trace, refIndex);
    const path72 = pathFeatures(trace, refIndex, 72);
    const bin = speedBin(kin.speed);

    for (const horizonMs of HORIZONS_MS) {
      const target = interpolateRef(trace, anchor.elapsedUs + horizonMs * 1000);
      if (!target) {
        diagnostics.labelsMissing += 1;
        continue;
      }
      rows.push({
        sessionId: trace.sessionId,
        trace,
        anchorElapsedUs: anchor.elapsedUs,
        refIndex,
        currentX,
        currentY,
        targetX: target.x,
        targetY: target.y,
        horizonMs,
        recentVx: kin.vx,
        recentVy: kin.vy,
        recentSpeed: kin.speed,
        speedBin: bin,
        pathEfficiency72: path72.efficiency,
        reversals72: path72.reversals,
      });
      rowsByHorizon[String(horizonMs)] += 1;
      rowsBySpeedBin[bin] = (rowsBySpeedBin[bin] || 0) + 1;
    }
  }
  diagnostics.rowsBuilt = rows.length;
  return { rows, summary: { rowsByHorizon, rowsBySpeedBin, diagnostics } };
}

function predictConstantVelocity(row, params) {
  const gain = params.gain ?? 1;
  const h = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity);
  let dx = row.recentVx * (h / 1000) * gain;
  let dy = row.recentVy * (h / 1000) * gain;
  let cap = params.displacementCapPx ?? Infinity;
  if (params.productAdaptiveCap) {
    cap = row.recentSpeed >= 2000 && row.pathEfficiency72 >= 0.85 && row.reversals72 === 0 ? 24 : 12;
  }
  ({ dx, dy } = clampVector(dx, dy, cap));
  return { x: row.currentX + dx, y: row.currentY + dy };
}

function fitLinear(trace, refIndex, windowMs) {
  const start = historyStartIndex(trace, refIndex, windowMs);
  const n = refIndex - start + 1;
  if (n < 3) return null;
  const anchorUs = trace.refTimesUs[refIndex];
  let st = 0;
  let stt = 0;
  let sx = 0;
  let sy = 0;
  let stx = 0;
  let sty = 0;
  for (let i = start; i <= refIndex; i += 1) {
    const t = (trace.refTimesUs[i] - anchorUs) / 1000;
    const x = trace.refX[i];
    const y = trace.refY[i];
    st += t;
    stt += t * t;
    sx += x;
    sy += y;
    stx += t * x;
    sty += t * y;
  }
  const denom = n * stt - st * st;
  if (Math.abs(denom) < 1e-9) return null;
  const vxMs = (n * stx - st * sx) / denom;
  const vyMs = (n * sty - st * sy) / denom;
  const x0 = (sx - vxMs * st) / n;
  const y0 = (sy - vyMs * st) / n;
  return { x0, y0, vxMs, vyMs };
}

function predictLeastSquares(row, params) {
  const fit = fitLinear(row.trace, row.refIndex, params.windowMs);
  if (!fit) return { x: row.currentX, y: row.currentY };
  const h = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity);
  const predictedX = fit.x0 + fit.vxMs * h;
  const predictedY = fit.y0 + fit.vyMs * h;
  let dx = predictedX - row.currentX;
  let dy = predictedY - row.currentY;
  ({ dx, dy } = clampVector(dx, dy, params.displacementCapPx ?? Infinity));
  return { x: row.currentX + dx, y: row.currentY + dy };
}

function predictAlphaBeta(row, params) {
  const trace = row.trace;
  const start = historyStartIndex(trace, row.refIndex, params.windowMs ?? 120);
  if (row.refIndex - start < 2) return { x: row.currentX, y: row.currentY };
  let x = trace.refX[start];
  let y = trace.refY[start];
  let vx = 0;
  let vy = 0;
  let lastUs = trace.refTimesUs[start];
  for (let i = start + 1; i <= row.refIndex; i += 1) {
    const dt = (trace.refTimesUs[i] - lastUs) / 1_000_000;
    if (dt <= 0 || dt > 0.1) {
      x = trace.refX[i];
      y = trace.refY[i];
      vx = 0;
      vy = 0;
      lastUs = trace.refTimesUs[i];
      continue;
    }
    const px = x + vx * dt;
    const py = y + vy * dt;
    const rx = trace.refX[i] - px;
    const ry = trace.refY[i] - py;
    x = px + params.alpha * rx;
    y = py + params.alpha * ry;
    vx += params.beta * rx / dt;
    vy += params.beta * ry / dt;
    lastUs = trace.refTimesUs[i];
  }
  const h = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity) / 1000;
  const predictedX = x + vx * h;
  const predictedY = y + vy * h;
  let dx = predictedX - row.currentX;
  let dy = predictedY - row.currentY;
  ({ dx, dy } = clampVector(dx, dy, params.displacementCapPx ?? Infinity));
  return { x: row.currentX + dx, y: row.currentY + dy };
}

function predictAlphaBetaGamma(row, params) {
  const trace = row.trace;
  const start = historyStartIndex(trace, row.refIndex, params.windowMs ?? 120);
  if (row.refIndex - start < 3) return { x: row.currentX, y: row.currentY };
  let x = trace.refX[start];
  let y = trace.refY[start];
  let vx = 0;
  let vy = 0;
  let ax = 0;
  let ay = 0;
  let lastUs = trace.refTimesUs[start];
  for (let i = start + 1; i <= row.refIndex; i += 1) {
    const dt = (trace.refTimesUs[i] - lastUs) / 1_000_000;
    if (dt <= 0 || dt > 0.1) {
      x = trace.refX[i];
      y = trace.refY[i];
      vx = 0;
      vy = 0;
      ax = 0;
      ay = 0;
      lastUs = trace.refTimesUs[i];
      continue;
    }
    const px = x + vx * dt + 0.5 * ax * dt * dt;
    const py = y + vy * dt + 0.5 * ay * dt * dt;
    const rx = trace.refX[i] - px;
    const ry = trace.refY[i] - py;
    x = px + params.alpha * rx;
    y = py + params.alpha * ry;
    vx += params.beta * rx / dt;
    vy += params.beta * ry / dt;
    ax += params.gamma * 2 * rx / (dt * dt);
    ay += params.gamma * 2 * ry / (dt * dt);
    lastUs = trace.refTimesUs[i];
  }
  const h = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity) / 1000;
  const predictedX = x + vx * h + 0.5 * ax * h * h;
  const predictedY = y + vy * h + 0.5 * ay * h * h;
  let dx = predictedX - row.currentX;
  let dy = predictedY - row.currentY;
  ({ dx, dy } = clampVector(dx, dy, params.displacementCapPx ?? Infinity));
  return { x: row.currentX + dx, y: row.currentY + dy };
}

function solve3(a, b) {
  const m = [
    [a[0][0], a[0][1], a[0][2], b[0]],
    [a[1][0], a[1][1], a[1][2], b[1]],
    [a[2][0], a[2][1], a[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    if (pivot !== col) [m[pivot], m[col]] = [m[col], m[pivot]];
    const div = m[col][col];
    for (let j = col; j < 4; j += 1) m[col][j] /= div;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let j = col; j < 4; j += 1) m[row][j] -= factor * m[col][j];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

function fitQuadratic(trace, refIndex, windowMs) {
  const start = historyStartIndex(trace, refIndex, windowMs);
  const n = refIndex - start + 1;
  if (n < 5) return null;
  const anchorUs = trace.refTimesUs[refIndex];
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let bx0 = 0;
  let bx1 = 0;
  let bx2 = 0;
  let by0 = 0;
  let by1 = 0;
  let by2 = 0;
  for (let i = start; i <= refIndex; i += 1) {
    const t = (trace.refTimesUs[i] - anchorUs) / 1000;
    const t2 = t * t;
    const x = trace.refX[i];
    const y = trace.refY[i];
    s0 += 1;
    s1 += t;
    s2 += t2;
    s3 += t2 * t;
    s4 += t2 * t2;
    bx0 += x;
    bx1 += x * t;
    bx2 += x * t2;
    by0 += y;
    by1 += y * t;
    by2 += y * t2;
  }
  const normal = [
    [s0, s1, s2],
    [s1, s2, s3],
    [s2, s3, s4],
  ];
  const cx = solve3(normal, [bx0, bx1, bx2]);
  const cy = solve3(normal, [by0, by1, by2]);
  if (!cx || !cy) return null;
  return { cx, cy };
}

function predictRobustPolynomial(row, params) {
  const fit = fitQuadratic(row.trace, row.refIndex, params.windowMs);
  if (!fit) return predictLeastSquares(row, { windowMs: params.windowMs, horizonCapMs: params.horizonCapMs, displacementCapPx: params.displacementCapPx });
  const h = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity);
  const x = fit.cx[0] + fit.cx[1] * h + fit.cx[2] * h * h;
  const y = fit.cy[0] + fit.cy[1] * h + fit.cy[2] * h * h;
  let dx = x - row.currentX;
  let dy = y - row.currentY;
  ({ dx, dy } = clampVector(dx, dy, params.displacementCapPx ?? Infinity));
  return { x: row.currentX + dx, y: row.currentY + dy };
}

function modelPredict(row, model) {
  if (model.family === "constant_velocity") return predictConstantVelocity(row, model.params);
  if (model.family === "least_squares") return predictLeastSquares(row, model.params);
  if (model.family === "alpha_beta") return predictAlphaBeta(row, model.params);
  if (model.family === "alpha_beta_gamma") return predictAlphaBetaGamma(row, model.params);
  if (model.family === "robust_polynomial") return predictRobustPolynomial(row, model.params);
  throw new Error(`Unknown model family ${model.family}`);
}

function evaluateRows(rows, model, baselineErrors = null) {
  const errors = [];
  const bySpeed = {};
  const byHorizon = {};
  const deltas = [];
  const regressions = {
    count: 0,
    worseOver1px: 0,
    worseOver3px: 0,
    worseOver5px: 0,
    improvedOver1px: 0,
    meanDeltaPx: null,
  };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const prediction = modelPredict(row, model);
    const error = distance(prediction.x, prediction.y, row.targetX, row.targetY);
    errors.push(error);
    if (!bySpeed[row.speedBin]) bySpeed[row.speedBin] = [];
    bySpeed[row.speedBin].push(error);
    const horizonKey = String(row.horizonMs);
    if (!byHorizon[horizonKey]) byHorizon[horizonKey] = [];
    byHorizon[horizonKey].push(error);
    if (baselineErrors) {
      const delta = error - baselineErrors[i];
      deltas.push(delta);
      regressions.count += 1;
      if (delta > 1) regressions.worseOver1px += 1;
      if (delta > 3) regressions.worseOver3px += 1;
      if (delta > 5) regressions.worseOver5px += 1;
      if (delta < -1) regressions.improvedOver1px += 1;
    }
  }
  if (deltas.length > 0) regressions.meanDeltaPx = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const speedBreakdown = {};
  for (const [key, values] of Object.entries(bySpeed)) speedBreakdown[key] = metricStats(values);
  const horizonBreakdown = {};
  for (const [key, values] of Object.entries(byHorizon)) horizonBreakdown[key] = metricStats(values);
  return {
    id: model.id,
    family: model.family,
    params: model.params,
    metrics: metricStats(errors),
    speedBins: speedBreakdown,
    horizons: horizonBreakdown,
    regressionsVsBaseline: baselineErrors ? regressions : null,
    errors,
  };
}

function scoreForSelection(metrics) {
  return metrics.p95 + 0.25 * metrics.p99 + 0.05 * metrics.mean;
}

function candidateModels() {
  const models = [{
    id: "product_constant_velocity_v8_shape",
    family: "constant_velocity",
    params: { gain: 1, horizonCapMs: 10, productAdaptiveCap: true },
  }];

  for (const gain of [0.75, 1, 1.1]) {
    for (const cap of [12, 24]) {
      models.push({
        id: `constant_velocity_gain${String(gain).replace(".", "p")}_cap${cap}`,
        family: "constant_velocity",
        params: { gain, horizonCapMs: 16.67, displacementCapPx: cap },
      });
    }
  }

  for (const windowMs of [48, 72, 96]) {
    for (const horizonCapMs of [10, 16.67]) {
      for (const cap of [12, 24]) {
        models.push({
          id: `least_squares_w${windowMs}_hcap${horizonCapMs}_cap${cap}`,
          family: "least_squares",
          params: { windowMs, horizonCapMs, displacementCapPx: cap },
        });
      }
    }
  }

  for (const alpha of [0.4, 0.7, 0.9]) {
    for (const beta of [0.05, 0.15, 0.35]) {
      for (const horizonCapMs of [10, 16.67]) {
        models.push({
          id: `alpha_beta_a${alpha}_b${beta}_hcap${horizonCapMs}`,
          family: "alpha_beta",
          params: { alpha, beta, horizonCapMs, windowMs: 120, displacementCapPx: 24 },
        });
      }
    }
  }

  for (const alpha of [0.5, 0.8]) {
    for (const beta of [0.08, 0.2]) {
      for (const gamma of [0.02, 0.08]) {
        for (const horizonCapMs of [10, 16.67]) {
          models.push({
            id: `alpha_beta_gamma_a${alpha}_b${beta}_g${gamma}_hcap${horizonCapMs}`,
            family: "alpha_beta_gamma",
            params: { alpha, beta, gamma, horizonCapMs, windowMs: 120, displacementCapPx: 24 },
          });
        }
      }
    }
  }

  for (const windowMs of [64, 96]) {
    for (const horizonCapMs of [10, 16.67]) {
      for (const cap of [12, 24]) {
        models.push({
          id: `robust_polynomial_w${windowMs}_hcap${horizonCapMs}_cap${cap}`,
          family: "robust_polynomial",
          params: { windowMs, horizonCapMs, displacementCapPx: cap },
        });
      }
    }
  }

  return models;
}

function groupModelsByFamily(models) {
  const groups = {};
  for (const model of models) {
    if (!groups[model.family]) groups[model.family] = [];
    groups[model.family].push(model);
  }
  return groups;
}

function compactEvaluation(evaluation) {
  return {
    id: evaluation.id,
    family: evaluation.family,
    params: evaluation.params,
    metrics: evaluation.metrics,
    regressionsVsBaseline: evaluation.regressionsVsBaseline,
    speedBins: evaluation.speedBins,
    horizons: evaluation.horizons,
  };
}

function tuneFamily(trainRows, models) {
  let best = null;
  for (const model of models) {
    const evaluation = evaluateRows(trainRows, model);
    const score = scoreForSelection(evaluation.metrics);
    if (!best || score < best.score) {
      best = { model, trainMetrics: evaluation.metrics, score };
    }
  }
  return best;
}

function runFold(name, trainDataset, evalDataset) {
  const models = candidateModels();
  const baselineModel = models.find((model) => model.id === "product_constant_velocity_v8_shape");
  const baselineEval = evaluateRows(evalDataset.rows, baselineModel);
  const baselineErrors = baselineEval.errors;
  const groups = groupModelsByFamily(models);
  const selected = [];
  for (const [family, familyModels] of Object.entries(groups)) {
    if (family === "constant_velocity") {
      const product = familyModels.find((model) => model.id === "product_constant_velocity_v8_shape");
      const best = tuneFamily(trainDataset.rows, familyModels);
      selected.push({ family, role: "product_baseline", model: product, trainMetrics: null });
      if (best.model.id !== product.id) selected.push({ family, role: "train_selected", model: best.model, trainMetrics: best.trainMetrics });
    } else {
      const best = tuneFamily(trainDataset.rows, familyModels);
      selected.push({ family, role: "train_selected", model: best.model, trainMetrics: best.trainMetrics });
    }
  }

  const seen = new Set();
  const evaluations = [];
  for (const entry of selected) {
    if (seen.has(entry.model.id)) continue;
    seen.add(entry.model.id);
    const evaluated = evaluateRows(evalDataset.rows, entry.model, baselineErrors);
    evaluations.push({
      role: entry.role,
      trainMetrics: entry.trainMetrics,
      ...compactEvaluation(evaluated),
    });
  }
  evaluations.sort((a, b) => scoreForSelection(a.metrics) - scoreForSelection(b.metrics));
  return {
    name,
    trainSession: trainDataset.sessionId,
    evalSession: evalDataset.sessionId,
    trainRows: trainDataset.rows.length,
    evalRows: evalDataset.rows.length,
    baselineId: baselineModel.id,
    candidates: evaluations,
    best: evaluations[0],
  };
}

function datasetJson(traces, datasets) {
  return {
    schemaVersion: "cursor-prediction-v9-phase1-dataset/1",
    generatedAt: new Date().toISOString(),
    policy: {
      anchorStream: "runtimeSelfSchedulerPoll",
      historyStream: "referencePoll at or before anchor time",
      labelStream: "referencePoll interpolated at anchor time + fixed horizon",
      causalInputsOnly: true,
      horizonsMs: HORIZONS_MS,
      largeDatasetWritten: false,
    },
    sessions: datasets.map((dataset) => {
      const trace = dataset.trace;
      return {
        sessionId: dataset.sessionId,
        sourceZip: trace.sourceZip,
        traceFormatVersion: trace.metadata.TraceFormatVersion ?? null,
        qualityWarnings: trace.metadata.QualityWarnings ?? [],
        csvRows: trace.csvRows,
        eventCounts: trace.eventCounts,
        runtimeSelfSchedulerPollIntervalMs: scalarStats(trace.eventIntervalsMs.runtimeSelfSchedulerPoll || []),
        referencePollIntervalMs: scalarStats(trace.eventIntervalsMs.referencePoll || []),
        referencePollCount: trace.refTimesUs.length,
        anchorCount: trace.anchors.length,
        rowsBuilt: dataset.rows.length,
        rowsByHorizon: dataset.summary.rowsByHorizon,
        rowsBySpeedBin: dataset.summary.rowsBySpeedBin,
        diagnostics: dataset.summary.diagnostics,
      };
    }),
  };
}

function baselinesJson(folds) {
  return {
    schemaVersion: "cursor-prediction-v9-phase2-classical-baselines/1",
    generatedAt: new Date().toISOString(),
    selectionObjective: "minimize p95 + 0.25*p99 + 0.05*mean on train session",
    baselineId: "product_constant_velocity_v8_shape",
    candidateFamilies: ["constant_velocity", "least_squares", "alpha_beta", "alpha_beta_gamma", "robust_polynomial"],
    folds: folds.map((fold) => ({
      ...fold,
      candidates: fold.candidates,
    })),
    bestByFold: folds.map((fold) => ({
      fold: fold.name,
      id: fold.best.id,
      family: fold.best.family,
      metrics: fold.best.metrics,
      params: fold.best.params,
    })),
  };
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(digits);
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function renderDatasetMd(data) {
  const rows = data.sessions.map((session) => [
    session.sessionId,
    session.sourceZip,
    String(session.referencePollCount),
    String(session.anchorCount),
    String(session.rowsBuilt),
    fmt(session.runtimeSelfSchedulerPollIntervalMs.p50),
    fmt(session.runtimeSelfSchedulerPollIntervalMs.p95),
    fmt(session.referencePollIntervalMs.p95),
    session.qualityWarnings.length ? session.qualityWarnings.join("<br>") : "none",
  ]);
  return `# Cursor Prediction v9 Phase 1 Dataset

Generated: ${data.generatedAt}

No dataset rows were written to disk; rows were built in memory only.

## Policy

- Anchor stream: \`${data.policy.anchorStream}\`
- History stream: \`${data.policy.historyStream}\`
- Label stream: \`${data.policy.labelStream}\`
- Horizons: ${data.policy.horizonsMs.join(", ")} ms
- Causal inputs only: ${data.policy.causalInputsOnly}

## Sessions

${mdTable(["session", "zip", "reference polls", "anchors", "dataset rows", "anchor p50 ms", "anchor p95 ms", "reference p95 ms", "quality warnings"], rows)}
`;
}

function renderBaselinesMd(data) {
  const foldSections = data.folds.map((fold) => {
    const rows = fold.candidates.map((candidate) => [
      candidate.id,
      candidate.family,
      candidate.role,
      fmt(candidate.metrics.mean),
      fmt(candidate.metrics.rmse),
      fmt(candidate.metrics.p95),
      fmt(candidate.metrics.p99),
      fmt(candidate.metrics.max),
      String(candidate.regressionsVsBaseline?.worseOver1px ?? ""),
      String(candidate.regressionsVsBaseline?.worseOver5px ?? ""),
    ]);
    return `## ${fold.name}

Train: \`${fold.trainSession}\`, eval: \`${fold.evalSession}\`

${mdTable(["candidate", "family", "role", "mean", "rmse", "p95", "p99", "max", ">1px regressions", ">5px regressions"], rows)}
`;
  }).join("\n");

  const bestRows = data.bestByFold.map((best) => [
    best.fold,
    best.id,
    best.family,
    fmt(best.metrics.mean),
    fmt(best.metrics.p95),
    fmt(best.metrics.p99),
    fmt(best.metrics.max),
    JSON.stringify(best.params),
  ]);
  return `# Cursor Prediction v9 Phase 2 Classical Baselines

Generated: ${data.generatedAt}

Selection objective: ${data.selectionObjective}

## Best By Fold

${mdTable(["fold", "candidate", "family", "mean", "p95", "p99", "max", "params"], bestRows)}

${foldSections}
`;
}

function main() {
  const args = parseArgs(process.argv);
  const traces = TRACE_FILES.map((fileName, index) => loadTrace(args.root, fileName, `session-${index + 1}`));
  const datasets = traces.map((trace) => {
    const built = buildDatasetForTrace(trace);
    return { sessionId: trace.sessionId, trace, rows: built.rows, summary: built.summary };
  });

  const phase1 = datasetJson(traces, datasets);
  const folds = [
    runFold("train-session-1-eval-session-2", datasets[0], datasets[1]),
    runFold("train-session-2-eval-session-1", datasets[1], datasets[0]),
  ];
  const phase2 = baselinesJson(folds);

  fs.writeFileSync(args.datasetJson, `${JSON.stringify(phase1, null, 2)}\n`, "utf8");
  fs.writeFileSync(args.datasetMd, renderDatasetMd(phase1), "utf8");
  fs.writeFileSync(args.baselinesJson, `${JSON.stringify(phase2, null, 2)}\n`, "utf8");
  fs.writeFileSync(args.baselinesMd, renderBaselinesMd(phase2), "utf8");

  process.stdout.write(`Wrote ${args.datasetJson}\n`);
  process.stdout.write(`Wrote ${args.datasetMd}\n`);
  process.stdout.write(`Wrote ${args.baselinesJson}\n`);
  process.stdout.write(`Wrote ${args.baselinesMd}\n`);
}

main();
