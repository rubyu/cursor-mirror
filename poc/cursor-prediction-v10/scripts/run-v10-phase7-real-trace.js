#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SCHEMA = "cursor-prediction-v10-phase7-real-trace/1";
const BREAKDOWN_SCHEMA = "cursor-prediction-v10-phase7-real-trace-breakdown/1";
const SCORE_SCHEMA = "cursor-prediction-v10-scores/1";

const HORIZONS_MS = [8.33, 16.67, 25, 33.33];
const HISTORY_MS = 200;
const HISTOGRAM_BIN_PX = 0.05;
const HISTOGRAM_MAX_PX = 4096;
const TAGS = [
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
const SPEED_BINS = [
  { id: "0-25", min: 0, max: 25 },
  { id: "25-100", min: 25, max: 100 },
  { id: "100-250", min: 100, max: 250 },
  { id: "250-500", min: 250, max: 500 },
  { id: "500-1000", min: 500, max: 1000 },
  { id: "1000-2000", min: 1000, max: 2000 },
  { id: ">=2000", min: 2000, max: Infinity },
];

const BASELINE_MODEL = {
  id: "constant_velocity_last2_cap24",
  family: "constant_velocity_last2",
  params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 },
};
const RAW_LS_MODEL = {
  id: "least_squares_w50_cap36",
  family: "least_squares_window",
  params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 36 },
};

function parseArgs(argv) {
  const scriptDir = __dirname;
  const outDir = path.resolve(scriptDir, "..");
  const root = path.resolve(outDir, "..", "..");
  const args = {
    root,
    outDir,
    zipLimit: 6,
    zips: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--zip-limit") args.zipLimit = intArg(argv[++i], "zip-limit");
    else if (arg === "--zips") args.zips = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v10\\scripts\\run-v10-phase7-real-trace.js [--zip-limit 6]

Options:
  --root <path>       repo root containing cursor-mirror-trace-*.zip
  --out-dir <path>    output directory, defaults to poc/cursor-prediction-v10
  --zip-limit <n>     newest trace ZIP count to read, default 6
  --zips <a,b,c>      explicit ZIP file names, relative to root unless absolute
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.zipLimit <= 0) throw new Error("--zip-limit must be positive");
  return args;
}

function intArg(text, name) {
  const value = Number(text);
  if (!Number.isInteger(value)) throw new Error(`--${name} expects an integer`);
  return value;
}

function listTraceZips(args) {
  if (args.zips) {
    return args.zips.map((name) => path.isAbsolute(name) ? name : path.join(args.root, name));
  }
  return fs.readdirSync(args.root)
    .filter((name) => /^cursor-mirror-trace-.*\.zip$/i.test(name))
    .map((name) => {
      const filePath = path.join(args.root, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, args.zipLimit)
    .map((item) => item.filePath);
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
  const localHeaderOffset = entry.localHeaderOffset;
  const zip = opened.zip;
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
  if (!data) throw new Error(`Unsupported ZIP method ${entry.method} for ${entryName}`);
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

function loadTrace(zipPath, sessionId) {
  const sourceZip = path.basename(zipPath);
  const opened = openZip(zipPath);
  const metadata = JSON.parse(readZipEntry(opened, "metadata.json").toString("utf8").replace(/^\uFEFF/, ""));
  const text = readZipEntry(opened, "trace.csv").toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",");
  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  for (const name of ["elapsedMicroseconds", "event", "x", "y", "cursorX", "cursorY"]) {
    if (!(name in column)) throw new Error(`${sourceZip} missing column ${name}`);
  }

  const eventCounts = {};
  const refTimesUs = [];
  const refX = [];
  const refY = [];
  const anchors = [];
  const eventIntervalAcc = {};
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
      const acc = eventIntervalAcc[event] || (eventIntervalAcc[event] = scalarAccumulator());
      addScalar(acc, (elapsedUs - lastEventUs[event]) / 1000);
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
        dwmTimingAvailable: column.dwmTimingAvailable !== undefined ? boolOrFalse(parts[column.dwmTimingAvailable]) : false,
      });
    }
  }

  const eventIntervalsMs = {};
  for (const [event, acc] of Object.entries(eventIntervalAcc)) eventIntervalsMs[event] = finalizeScalar(acc);
  return {
    sessionId,
    sourceZip,
    metadata,
    csvRows,
    eventCounts,
    eventIntervalsMs,
    refTimesUs,
    refX,
    refY,
    anchors,
    screen: screenFromMetadata(metadata),
  };
}

function screenFromMetadata(metadata) {
  const x = Number(metadata.VirtualScreenX ?? 0);
  const y = Number(metadata.VirtualScreenY ?? 0);
  const width = Number(metadata.VirtualScreenWidth ?? 0);
  const height = Number(metadata.VirtualScreenHeight ?? 0);
  if (Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0) return { x, y, width, height };
  return { x: -Infinity, y: -Infinity, width: Infinity, height: Infinity };
}

function loadPhase4Gates(outDir) {
  const phase4Path = path.join(outDir, "phase-4-pareto-frontier.json");
  const data = JSON.parse(fs.readFileSync(phase4Path, "utf8"));
  const strict = data.constraints?.strict?.best;
  const balanced = data.constraints?.balanced?.best;
  if (!strict) throw new Error("phase-4-pareto-frontier.json missing constraints.strict.best");
  if (!balanced) throw new Error("phase-4-pareto-frontier.json missing constraints.balanced.best");
  return { data, strict, balanced };
}

function buildCandidateSpecs(phase4) {
  return [
    { id: BASELINE_MODEL.id, role: "baseline", model: BASELINE_MODEL },
    { id: RAW_LS_MODEL.id, role: "raw", model: RAW_LS_MODEL },
    { id: "phase4_strict", role: "gate", gate: phase4.strict, sourceId: phase4.strict.id },
    { id: "phase4_balanced", role: "gate", gate: phase4.balanced, sourceId: phase4.balanced.id },
  ];
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
  const f = (targetUs - t0) / (t1 - t0);
  return {
    x: trace.refX[left] + (trace.refX[right] - trace.refX[left]) * f,
    y: trace.refY[left] + (trace.refY[right] - trace.refY[left]) * f,
  };
}

function refIndexAtOrBefore(trace, elapsedUs) {
  const right = lowerBound(trace.refTimesUs, elapsedUs);
  if (right < trace.refTimesUs.length && trace.refTimesUs[right] === elapsedUs) return right;
  return right - 1;
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

function historyStartIndex(trace, refIndex, windowMs) {
  const minUs = trace.refTimesUs[refIndex] - windowMs * 1000;
  return Math.max(0, lowerBound(trace.refTimesUs, minUs));
}

function velocityBetween(trace, a, b) {
  const dt = Math.max(0.001, (trace.refTimesUs[b] - trace.refTimesUs[a]) / 1_000_000);
  const vx = (trace.refX[b] - trace.refX[a]) / dt;
  const vy = (trace.refY[b] - trace.refY[a]) / dt;
  return { vx, vy, speed: Math.sqrt(vx * vx + vy * vy) };
}

function angleBetweenDeg(ax, ay, bx, by) {
  const am = Math.sqrt(ax * ax + ay * ay);
  const bm = Math.sqrt(bx * bx + by * by);
  if (am < 1e-6 || bm < 1e-6) return 0;
  const c = clamp((ax * bx + ay * by) / (am * bm), -1, 1);
  return Math.acos(c) * 180 / Math.PI;
}

function rowFeatures(trace, refIndex) {
  const currentX = trace.refX[refIndex];
  const currentY = trace.refY[refIndex];
  const prev = refIndex >= 1 ? refIndex - 1 : null;
  const prev2 = refIndex >= 2 ? refIndex - 2 : null;
  const observed = prev !== null ? velocityBetween(trace, prev, refIndex) : { vx: 0, vy: 0, speed: 0 };
  let accelerationPxPerSec2 = 0;
  let curvatureDeg = 0;
  if (prev !== null && prev2 !== null) {
    const v0 = velocityBetween(trace, prev2, prev);
    const v1 = observed;
    const dt = Math.max(0.001, (trace.refTimesUs[refIndex] - trace.refTimesUs[prev]) / 1_000_000);
    accelerationPxPerSec2 = distance(v0.vx, v0.vy, v1.vx, v1.vy) / dt;
    curvatureDeg = angleBetweenDeg(v0.vx, v0.vy, v1.vx, v1.vy);
  }
  const start = historyStartIndex(trace, refIndex, HISTORY_MS);
  const edgeDistancePx = edgeDistance(trace.screen, currentX, currentY);
  return {
    observedSpeedPxPerSec: observed.speed,
    accelerationPxPerSec2,
    curvatureDeg,
    historyCount: refIndex - start + 1,
    edgeDistancePx,
    jitterProxyPx: recentJitterProxy(trace, refIndex),
    speedBin: speedBin(observed.speed),
  };
}

function edgeDistance(screen, x, y) {
  return Math.max(0, Math.min(
    x - screen.x,
    y - screen.y,
    screen.x + screen.width - x,
    screen.y + screen.height - y,
  ));
}

function recentJitterProxy(trace, refIndex) {
  if (refIndex < 3) return 0;
  const start = Math.max(0, refIndex - 6);
  const first = start;
  const last = refIndex;
  const span = Math.max(1e-6, trace.refTimesUs[last] - trace.refTimesUs[first]);
  let sum = 0;
  let count = 0;
  for (let i = first + 1; i < last; i += 1) {
    const f = (trace.refTimesUs[i] - trace.refTimesUs[first]) / span;
    const x = trace.refX[first] + (trace.refX[last] - trace.refX[first]) * f;
    const y = trace.refY[first] + (trace.refY[last] - trace.refY[first]) * f;
    sum += (trace.refX[i] - x) ** 2 + (trace.refY[i] - y) ** 2;
    count += 1;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function speedBin(speed) {
  for (const bin of SPEED_BINS) {
    if (speed >= bin.min && speed < bin.max) return bin.id;
  }
  return ">=2000";
}

function predict(row, model) {
  if (model.family === "constant_velocity_last2") return predictConstantVelocity(row, model.params);
  if (model.family === "least_squares_window") return predictLeastSquares(row, model.params);
  if (model.family === "blend") {
    const a = predict(row, model.params.a);
    const b = predict(row, model.params.b);
    const w = model.params.weightB;
    return { x: a.x * (1 - w) + b.x * w, y: a.y * (1 - w) + b.y * w };
  }
  throw new Error(`Unknown model family: ${model.family}`);
}

function predictConstantVelocity(row, params) {
  const trace = row.trace;
  const refIndex = row.refIndex;
  const currentX = trace.refX[refIndex];
  const currentY = trace.refY[refIndex];
  if (refIndex < 1) return { x: currentX, y: currentY };
  const prev = refIndex - 1;
  const dtSec = (trace.refTimesUs[refIndex] - trace.refTimesUs[prev]) / 1_000_000;
  if (dtSec <= 0 || dtSec > 0.12) return { x: currentX, y: currentY };
  const vx = (currentX - trace.refX[prev]) / dtSec;
  const vy = (currentY - trace.refY[prev]) / dtSec;
  const horizonSec = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity) / 1000;
  let dx = vx * horizonSec * (params.gain ?? 1);
  let dy = vy * horizonSec * (params.gain ?? 1);
  ({ dx, dy } = clampVector(dx, dy, params.displacementCapPx ?? Infinity));
  return { x: currentX + dx, y: currentY + dy };
}

function predictLeastSquares(row, params) {
  const trace = row.trace;
  const refIndex = row.refIndex;
  const currentX = trace.refX[refIndex];
  const currentY = trace.refY[refIndex];
  const start = historyStartIndex(trace, refIndex, params.windowMs);
  const n = refIndex - start + 1;
  if (n < 3) return predictConstantVelocity(row, { horizonCapMs: params.horizonCapMs, displacementCapPx: params.displacementCapPx });
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
  if (Math.abs(denom) < 1e-9) return { x: currentX, y: currentY };
  const vxMs = (n * stx - st * sx) / denom;
  const vyMs = (n * sty - st * sy) / denom;
  const x0 = (sx - vxMs * st) / n;
  const y0 = (sy - vyMs * st) / n;
  const horizonMs = Math.min(row.horizonMs, params.horizonCapMs ?? Infinity);
  let dx = x0 + vxMs * horizonMs - currentX;
  let dy = y0 + vyMs * horizonMs - currentY;
  ({ dx, dy } = clampVector(dx, dy, params.displacementCapPx ?? Infinity));
  return { x: currentX + dx, y: currentY + dy };
}

function modelForCandidateId(candidateId) {
  if (candidateId === "least_squares_w50_cap36") return RAW_LS_MODEL;
  if (candidateId === "constant_velocity_last2_cap24") return BASELINE_MODEL;
  if (candidateId === "blend_base_least_squares_w50_cap36_adv0p75") {
    return {
      id: candidateId,
      family: "blend",
      params: { weightB: 0.75, a: BASELINE_MODEL, b: RAW_LS_MODEL },
    };
  }
  if (candidateId === "blend_base_least_squares_w50_cap36_adv0p5") {
    return {
      id: candidateId,
      family: "blend",
      params: { weightB: 0.5, a: BASELINE_MODEL, b: RAW_LS_MODEL },
    };
  }
  if (candidateId === "blend_base_least_squares_w50_cap36_adv0p25") {
    return {
      id: candidateId,
      family: "blend",
      params: { weightB: 0.25, a: BASELINE_MODEL, b: RAW_LS_MODEL },
    };
  }
  throw new Error(`Unsupported phase4 candidateId on real trace: ${candidateId}`);
}

function predictSpec(row, spec) {
  if (spec.role === "baseline" || spec.role === "raw") return { prediction: predict(row, spec.model), usedAdvanced: spec.role === "raw" };
  const score = monotonicScore(row.features, row.horizonMs, spec.gate.params.weights);
  if (score > spec.gate.params.threshold) return { prediction: predict(row, BASELINE_MODEL), usedAdvanced: false };
  const model = modelForCandidateId(spec.gate.candidateId);
  return { prediction: predict(row, model), usedAdvanced: true };
}

function monotonicScore(f, horizonMs, weights) {
  let score = weights.intercept;
  score += weights.lowSpeed * Math.max(0, (350 - f.observedSpeedPxPerSec) / 350);
  score += weights.highSpeed * Math.max(0, (f.observedSpeedPxPerSec - 3000) / 1200);
  score += weights.acceleration * Math.log1p(f.accelerationPxPerSec2 / 8000);
  score += weights.curvature * (f.curvatureDeg / 90);
  score += weights.edgeNear * Math.max(0, (64 - f.edgeDistancePx) / 64);
  score += weights.sparseHistory * Math.max(0, (13 - f.historyCount) / 13);
  score += weights.jitterProxy * Math.log1p(f.jitterProxyPx || 0);
  score += weights.horizon * (horizonMs / 33.33);
  return score;
}

function candidateAccumulator(spec) {
  return {
    id: spec.id,
    role: spec.role,
    sourceId: spec.sourceId ?? spec.model?.id ?? null,
    metric: metricAccumulator(),
    bySpeed: Object.fromEntries(SPEED_BINS.map((bin) => [bin.id, metricAccumulator()])),
    byHorizon: Object.fromEntries(HORIZONS_MS.map((h) => [String(h), metricAccumulator()])),
    regressionsVsBaseline: regressionAccumulator(),
    gateUses: { advanced: 0, fallback: 0 },
  };
}

function addCandidateError(acc, row, error, baselineError, usedAdvanced) {
  addMetric(acc.metric, error);
  addMetric(acc.bySpeed[row.features.speedBin], error);
  addMetric(acc.byHorizon[String(row.horizonMs)], error);
  addRegression(acc.regressionsVsBaseline, error - baselineError);
  if (usedAdvanced) acc.gateUses.advanced += 1;
  else acc.gateUses.fallback += 1;
}

function finalizeCandidate(acc) {
  return {
    id: acc.id,
    role: acc.role,
    sourceId: acc.sourceId,
    metrics: finalizeMetric(acc.metric),
    regressionsVsBaseline: finalizeRegression(acc.regressionsVsBaseline),
    gateUses: acc.gateUses,
    speedBins: Object.fromEntries(Object.entries(acc.bySpeed).map(([key, value]) => [key, finalizeMetric(value)])),
    horizons: Object.fromEntries(Object.entries(acc.byHorizon).map(([key, value]) => [key, finalizeMetric(value)])),
  };
}

function combineResults(sessionResults, candidateSpecs) {
  const combinedAccs = Object.fromEntries(candidateSpecs.map((spec) => [spec.id, candidateAccumulator(spec)]));
  for (const session of sessionResults) {
    for (const spec of candidateSpecs) {
      mergeCandidate(combinedAccs[spec.id], session._accs[spec.id]);
    }
  }
  return Object.fromEntries(Object.entries(combinedAccs).map(([id, acc]) => [id, finalizeCandidate(acc)]));
}

function mergeCandidate(target, source) {
  mergeMetric(target.metric, source.metric);
  for (const key of Object.keys(target.bySpeed)) mergeMetric(target.bySpeed[key], source.bySpeed[key]);
  for (const key of Object.keys(target.byHorizon)) mergeMetric(target.byHorizon[key], source.byHorizon[key]);
  mergeRegression(target.regressionsVsBaseline, source.regressionsVsBaseline);
  target.gateUses.advanced += source.gateUses.advanced;
  target.gateUses.fallback += source.gateUses.fallback;
}

function evaluateTraceWithAcc(trace, candidateSpecs) {
  const sessionAccs = Object.fromEntries(candidateSpecs.map((spec) => [spec.id, candidateAccumulator(spec)]));
  const diagnostics = {
    anchorsSeen: trace.anchors.length,
    anchorsWithInsufficientHistory: 0,
    labelsMissing: 0,
    rowsBuilt: 0,
  };
  const rowsByHorizon = Object.fromEntries(HORIZONS_MS.map((h) => [String(h), 0]));
  const rowsBySpeedBin = Object.fromEntries(SPEED_BINS.map((b) => [b.id, 0]));

  for (const anchor of trace.anchors) {
    const refIndex = refIndexAtOrBefore(trace, anchor.elapsedUs);
    if (refIndex < 2) {
      diagnostics.anchorsWithInsufficientHistory += 1;
      continue;
    }
    const features = rowFeatures(trace, refIndex);
    for (const horizonMs of HORIZONS_MS) {
      const target = interpolateRef(trace, anchor.elapsedUs + horizonMs * 1000);
      if (!target) {
        diagnostics.labelsMissing += 1;
        continue;
      }
      const row = { trace, refIndex, horizonMs, target, features };
      const basePrediction = predict(row, BASELINE_MODEL);
      const baselineError = distance(basePrediction.x, basePrediction.y, target.x, target.y);
      for (const spec of candidateSpecs) {
        const evaluated = predictSpec(row, spec);
        const error = distance(evaluated.prediction.x, evaluated.prediction.y, target.x, target.y);
        addCandidateError(sessionAccs[spec.id], row, error, baselineError, evaluated.usedAdvanced);
      }
      diagnostics.rowsBuilt += 1;
      rowsByHorizon[String(horizonMs)] += 1;
      rowsBySpeedBin[features.speedBin] += 1;
    }
  }

  return {
    _accs: sessionAccs,
    session: {
      sessionId: trace.sessionId,
      sourceZip: trace.sourceZip,
      traceFormatVersion: trace.metadata.TraceFormatVersion ?? null,
      createdUtc: trace.metadata.CreatedUtc ?? null,
      csvRows: trace.csvRows,
      eventCounts: trace.eventCounts,
      referencePollCount: trace.refTimesUs.length,
      anchorCount: trace.anchors.length,
      runtimeSelfSchedulerPollIntervalMs: trace.eventIntervalsMs.runtimeSelfSchedulerPoll || emptyScalarStats(),
      referencePollIntervalMs: trace.eventIntervalsMs.referencePoll || emptyScalarStats(),
      rowsBuilt: diagnostics.rowsBuilt,
      rowsByHorizon,
      rowsBySpeedBin,
      diagnostics,
      qualityWarnings: trace.metadata.QualityWarnings ?? [],
    },
    candidateResults: Object.fromEntries(Object.entries(sessionAccs).map(([id, acc]) => [id, finalizeCandidate(acc)])),
  };
}

function metricAccumulator() {
  return {
    count: 0,
    sum: 0,
    sumSq: 0,
    max: 0,
    hist: new Int32Array(Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 2),
  };
}

function addMetric(acc, value) {
  if (!Number.isFinite(value)) return;
  acc.count += 1;
  acc.sum += value;
  acc.sumSq += value * value;
  acc.max = Math.max(acc.max, value);
  const bin = Math.max(0, Math.min(acc.hist.length - 1, Math.floor(value / HISTOGRAM_BIN_PX)));
  acc.hist[bin] += 1;
}

function mergeMetric(target, source) {
  target.count += source.count;
  target.sum += source.sum;
  target.sumSq += source.sumSq;
  target.max = Math.max(target.max, source.max);
  for (let i = 0; i < target.hist.length; i += 1) target.hist[i] += source.hist[i];
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

function regressionAccumulator() {
  return {
    count: 0,
    worseOver1px: 0,
    worseOver3px: 0,
    worseOver5px: 0,
    worseOver10px: 0,
    improvedOver1px: 0,
    improvedOver3px: 0,
    sumDeltaPx: 0,
  };
}

function addRegression(acc, delta) {
  acc.count += 1;
  acc.sumDeltaPx += delta;
  if (delta > 1) acc.worseOver1px += 1;
  if (delta > 3) acc.worseOver3px += 1;
  if (delta > 5) acc.worseOver5px += 1;
  if (delta > 10) acc.worseOver10px += 1;
  if (delta < -1) acc.improvedOver1px += 1;
  if (delta < -3) acc.improvedOver3px += 1;
}

function mergeRegression(target, source) {
  target.count += source.count;
  target.worseOver1px += source.worseOver1px;
  target.worseOver3px += source.worseOver3px;
  target.worseOver5px += source.worseOver5px;
  target.worseOver10px += source.worseOver10px;
  target.improvedOver1px += source.improvedOver1px;
  target.improvedOver3px += source.improvedOver3px;
  target.sumDeltaPx += source.sumDeltaPx;
}

function finalizeRegression(acc) {
  return {
    count: acc.count,
    worseOver1px: acc.worseOver1px,
    worseOver3px: acc.worseOver3px,
    worseOver5px: acc.worseOver5px,
    worseOver10px: acc.worseOver10px,
    improvedOver1px: acc.improvedOver1px,
    improvedOver3px: acc.improvedOver3px,
    meanDeltaPx: acc.sumDeltaPx / Math.max(1, acc.count),
  };
}

function scalarAccumulator() {
  return { values: [] };
}

function addScalar(acc, value) {
  if (Number.isFinite(value)) acc.values.push(value);
}

function finalizeScalar(acc) {
  const values = acc.values.sort((a, b) => a - b);
  if (values.length === 0) return emptyScalarStats();
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    mean: sum / values.length,
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    max: values[values.length - 1],
  };
}

function emptyScalarStats() {
  return { count: 0, mean: null, p50: null, p95: null, max: null };
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

function syntheticComparison(phase4Data, combined) {
  const strictSynthetic = phase4Data.constraints.strict.best.test;
  const balancedSynthetic = phase4Data.constraints.balanced.best.test;
  const strictReal = combined.phase4_strict;
  const balancedReal = combined.phase4_balanced;
  return {
    synthetic: {
      strict: pickCompare(strictSynthetic),
      balanced: pickCompare(balancedSynthetic),
    },
    realTrace: {
      strict: pickCompare(strictReal),
      balanced: pickCompare(balancedReal),
    },
    sameDirection: {
      strict: strictSynthetic.regressionsVsBaseline.meanDeltaPx < 0 && strictReal.regressionsVsBaseline.meanDeltaPx < 0,
      balanced: balancedSynthetic.regressionsVsBaseline.meanDeltaPx < 0 && balancedReal.regressionsVsBaseline.meanDeltaPx < 0,
    },
  };
}

function pickCompare(result) {
  return {
    mean: result.metrics.mean,
    p95: result.metrics.p95,
    p99: result.metrics.p99,
    regressionsVsBaseline: result.regressionsVsBaseline,
    gateUses: result.gateUses,
  };
}

function recommendation(comparison, combined) {
  const strict = combined.phase4_strict;
  const balanced = combined.phase4_balanced;
  if (strict.regressionsVsBaseline.meanDeltaPx < 0 && strict.regressionsVsBaseline.worseOver10px === 0) {
    if (balanced.regressionsVsBaseline.meanDeltaPx < strict.regressionsVsBaseline.meanDeltaPx && balanced.regressionsVsBaseline.worseOver10px === 0) {
      return "proceed_to_calibrator_with_phase4_strict_as_safety_anchor_and_balanced_as_risk_reference";
    }
    return "proceed_to_calibrator_with_phase4_strict_only";
  }
  if (comparison.sameDirection.strict || comparison.sameDirection.balanced) {
    return "fix_synthetic_distribution_before_productizing_then_rerun_real_trace";
  }
  return "fix_synthetic_distribution_before_calibrator";
}

function buildPhase7Json(args, generatedAt, zipPaths, phase4, sessionResults, combined, elapsedSec) {
  const comparison = syntheticComparison(phase4.data, combined);
  const rows = sessionResults.reduce((sum, item) => sum + item.session.rowsBuilt, 0);
  return {
    schemaVersion: SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    environment: {
      node: process.version,
      gpuUsed: false,
      dependencies: "node standard library only",
    },
    policy: {
      anchorStream: "runtimeSelfSchedulerPoll",
      historyStream: "referencePoll at or before anchor time",
      labelStream: "referencePoll interpolated at anchor time + fixed horizon",
      targetPolicy: "fixed horizons only; DWM next-vblank target not reconstructed",
      horizonsMs: HORIZONS_MS,
      historyMs: HISTORY_MS,
      zipSelection: args.zips ? "explicit --zips" : `newest ${args.zipLimit} cursor-mirror-trace ZIPs`,
      zipExpandedToDisk: false,
      perFrameCsvWritten: false,
      phase6StrictDistillation: {
        evaluated: false,
        reason: "phase6 artifacts report coefficient samples only; full trained residual heads/checkpoint are intentionally not written, so exact real-trace replay is not reproducible from existing outputs",
      },
    },
    inputZips: zipPaths.map((filePath) => path.basename(filePath)),
    rowSummary: {
      totalRows: rows,
      sessions: sessionResults.map((item) => item.session),
    },
    candidates: combined,
    syntheticComparison: comparison,
    recommendation: recommendation(comparison, combined),
    elapsedSec,
  };
}

function buildBreakdownJson(generatedAt, phase7, sessionResults) {
  return {
    schemaVersion: BREAKDOWN_SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    inputZips: phase7.inputZips,
    combined: Object.fromEntries(Object.entries(phase7.candidates).map(([id, result]) => [id, {
      speedBins: result.speedBins,
      horizons: result.horizons,
      gateUses: result.gateUses,
      regressionsVsBaseline: result.regressionsVsBaseline,
    }])),
    sessions: sessionResults.map((item) => ({
      session: item.session,
      candidates: Object.fromEntries(Object.entries(item.candidateResults).map(([id, result]) => [id, {
        metrics: result.metrics,
        speedBins: result.speedBins,
        horizons: result.horizons,
        gateUses: result.gateUses,
        regressionsVsBaseline: result.regressionsVsBaseline,
      }])),
    })),
  };
}

function renderPhase7Md(data) {
  const candidateRows = Object.values(data.candidates).map((c) => [
    c.id,
    c.role,
    fmt(c.metrics.mean),
    fmt(c.metrics.rmse),
    fmt(c.metrics.p50),
    fmt(c.metrics.p90),
    fmt(c.metrics.p95),
    fmt(c.metrics.p99),
    fmt(c.metrics.max),
    String(c.regressionsVsBaseline.worseOver1px),
    String(c.regressionsVsBaseline.worseOver3px),
    String(c.regressionsVsBaseline.worseOver5px),
    String(c.regressionsVsBaseline.worseOver10px),
    fmt(c.regressionsVsBaseline.meanDeltaPx),
    `${c.gateUses.advanced}/${c.gateUses.fallback}`,
  ]);
  const sessionRows = data.rowSummary.sessions.map((s) => [
    s.sessionId,
    s.sourceZip,
    String(s.referencePollCount),
    String(s.anchorCount),
    String(s.rowsBuilt),
    fmt(s.runtimeSelfSchedulerPollIntervalMs.p50),
    fmt(s.runtimeSelfSchedulerPollIntervalMs.p95),
    fmt(s.referencePollIntervalMs.p95),
    s.qualityWarnings?.length ? s.qualityWarnings.join("<br>") : "none",
  ]);
  const cmp = data.syntheticComparison;
  const comparisonRows = ["strict", "balanced"].map((name) => [
    name,
    fmt(cmp.synthetic[name].regressionsVsBaseline.meanDeltaPx),
    `${cmp.synthetic[name].regressionsVsBaseline.worseOver5px}/${cmp.synthetic[name].regressionsVsBaseline.worseOver10px}`,
    fmt(cmp.realTrace[name].regressionsVsBaseline.meanDeltaPx),
    `${cmp.realTrace[name].regressionsVsBaseline.worseOver5px}/${cmp.realTrace[name].regressionsVsBaseline.worseOver10px}`,
    cmp.sameDirection[name] ? "yes" : "no",
  ]);
  return `# Cursor Prediction v10 Phase 7 Real Trace

Generated: ${data.generatedAt}

Input ZIPs: ${data.inputZips.map((z) => `\`${z}\``).join(", ")}. GPU used: no. Dependencies: Node.js standard library only. ZIPs were read in place; no extraction, per-frame CSV, cache, checkpoint, raw copy, or node_modules output was written.

Policy: anchors from \`${data.policy.anchorStream}\`; history/labels from \`${data.policy.historyStream}\`; fixed horizons ${data.policy.horizonsMs.join(", ")} ms. DWM next-vblank target was not reconstructed for this pass.

## Sessions

${renderTable(["session", "zip", "reference polls", "anchors", "rows", "anchor p50 ms", "anchor p95 ms", "reference p95 ms", "quality warnings"], sessionRows)}

## Combined Metrics

${renderTable(["candidate", "role", "mean", "rmse", "p50", "p90", "p95", "p99", "max", ">1", ">3", ">5", ">10", "mean delta", "advanced/fallback"], candidateRows)}

## Synthetic Direction Check

${renderTable(["bucket", "synthetic mean delta", "synthetic >5/>10", "real mean delta", "real >5/>10", "same direction"], comparisonRows)}

## Judgment

Recommendation: \`${data.recommendation}\`.

Phase6 strict distillation was omitted because the existing phase6 artifact intentionally keeps only coefficient samples, not the full trained residual heads needed for exact replay on real traces.
`;
}

function renderBreakdownMd(data) {
  const chunks = [`# Cursor Prediction v10 Phase 7 Breakdown

Generated: ${data.generatedAt}
`];
  for (const [candidateId, result] of Object.entries(data.combined)) {
    const speedRows = Object.entries(result.speedBins).map(([bucket, metric]) => [
      bucket,
      String(metric.count),
      fmt(metric.mean),
      fmt(metric.p90),
      fmt(metric.p95),
      fmt(metric.p99),
      fmt(metric.max),
    ]);
    const horizonRows = Object.entries(result.horizons).map(([bucket, metric]) => [
      bucket,
      String(metric.count),
      fmt(metric.mean),
      fmt(metric.p90),
      fmt(metric.p95),
      fmt(metric.p99),
      fmt(metric.max),
    ]);
    chunks.push(`## ${candidateId}

Overall regressions >1/>3/>5/>10: ${result.regressionsVsBaseline.worseOver1px}/${result.regressionsVsBaseline.worseOver3px}/${result.regressionsVsBaseline.worseOver5px}/${result.regressionsVsBaseline.worseOver10px}; advanced/fallback ${result.gateUses.advanced}/${result.gateUses.fallback}.

### Speed

${renderTable(["speed", "rows", "mean", "p90", "p95", "p99", "max"], speedRows)}

### Horizon

${renderTable(["horizon", "rows", "mean", "p90", "p95", "p99", "max"], horizonRows)}
`);
  }
  return chunks.join("\n");
}

function appendScores(outDir, phase7) {
  const scoresPath = path.join(outDir, "scores.json");
  let scores = {};
  if (fs.existsSync(scoresPath)) scores = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
  scores.schemaVersion = scores.schemaVersion || SCORE_SCHEMA;
  scores.generatedAt = phase7.generatedAt;
  scores.phase7 = {
    canonicalDataset: "repo-root cursor-mirror-trace-*.zip",
    inputZips: phase7.inputZips,
    evaluatedRows: phase7.rowSummary.totalRows,
    environment: phase7.environment,
    policy: phase7.policy,
    candidates: Object.fromEntries(Object.entries(phase7.candidates).map(([id, result]) => [id, {
      metrics: result.metrics,
      regressionsVsBaseline: result.regressionsVsBaseline,
      gateUses: result.gateUses,
    }])),
    syntheticComparison: phase7.syntheticComparison,
    recommendation: phase7.recommendation,
  };
  writeJson(scoresPath, scores);
}

function appendExperimentLog(outDir, phase7) {
  const c = phase7.candidates;
  const nonEmptySessions = phase7.rowSummary.sessions.filter((s) => s.rowsBuilt > 0).length;
  const block = `

## Phase 7 real trace (${phase7.generatedAt})

\`\`\`powershell
node poc\\cursor-prediction-v10\\scripts\\run-v10-phase7-real-trace.js --zip-limit ${phase7.inputZips.length}
\`\`\`

- input ZIPs: ${phase7.inputZips.map((z) => `\`${z}\``).join(", ")};
- rows: ${phase7.rowSummary.totalRows} from ${nonEmptySessions} nonempty / ${phase7.rowSummary.sessions.length} selected sessions;
- baseline \`${BASELINE_MODEL.id}\`: mean/p95/p99/max ${fmt(c.constant_velocity_last2_cap24.metrics.mean)} / ${fmt(c.constant_velocity_last2_cap24.metrics.p95)} / ${fmt(c.constant_velocity_last2_cap24.metrics.p99)} / ${fmt(c.constant_velocity_last2_cap24.metrics.max)} px;
- raw \`${RAW_LS_MODEL.id}\`: mean delta ${fmt(c.least_squares_w50_cap36.regressionsVsBaseline.meanDeltaPx)} px, >5/>10 ${c.least_squares_w50_cap36.regressionsVsBaseline.worseOver5px}/${c.least_squares_w50_cap36.regressionsVsBaseline.worseOver10px};
- phase4 strict: mean delta ${fmt(c.phase4_strict.regressionsVsBaseline.meanDeltaPx)} px, >5/>10 ${c.phase4_strict.regressionsVsBaseline.worseOver5px}/${c.phase4_strict.regressionsVsBaseline.worseOver10px}, advanced ${c.phase4_strict.gateUses.advanced};
- phase4 balanced: mean delta ${fmt(c.phase4_balanced.regressionsVsBaseline.meanDeltaPx)} px, >5/>10 ${c.phase4_balanced.regressionsVsBaseline.worseOver5px}/${c.phase4_balanced.regressionsVsBaseline.worseOver10px}, advanced ${c.phase4_balanced.gateUses.advanced};
- synthetic direction: strict ${phase7.syntheticComparison.sameDirection.strict ? "same" : "not same"}, balanced ${phase7.syntheticComparison.sameDirection.balanced ? "same" : "not same"};
- recommendation: \`${phase7.recommendation}\`;
- phase6 omitted: ${phase7.policy.phase6StrictDistillation.reason};
- runtime: ${fmt(phase7.elapsedSec, 2)} seconds on CPU; no GPU, ZIP extraction, per-frame CSV, raw copy, node_modules, cache, or checkpoint.
`;
  fs.appendFileSync(path.join(outDir, "experiment-log.md"), block, "utf8");
}

function renderTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(roundObject(data), null, 2)}\n`, "utf8");
}

function roundObject(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : value;
  if (Array.isArray(value)) return value.map(roundObject);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key !== "_accs") out[key] = roundObject(item);
    }
    return out;
  }
  return value;
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return (Math.round(value * (10 ** digits)) / (10 ** digits)).toFixed(digits);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function main() {
  const started = Date.now();
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const phase4 = loadPhase4Gates(args.outDir);
  const candidateSpecs = buildCandidateSpecs(phase4);
  const zipPaths = listTraceZips(args);
  if (zipPaths.length === 0) throw new Error("No cursor-mirror-trace-*.zip files found");

  const sessionResults = [];
  for (let i = 0; i < zipPaths.length; i += 1) {
    const trace = loadTrace(zipPaths[i], `session_${i + 1}`);
    sessionResults.push(evaluateTraceWithAcc(trace, candidateSpecs));
  }
  const combined = combineResults(sessionResults, candidateSpecs);
  const elapsedSec = (Date.now() - started) / 1000;
  const phase7 = buildPhase7Json(args, generatedAt, zipPaths, phase4, sessionResults, combined, elapsedSec);
  const breakdown = buildBreakdownJson(generatedAt, phase7, sessionResults);

  writeJson(path.join(args.outDir, "phase-7-real-trace.json"), phase7);
  writeJson(path.join(args.outDir, "phase-7-real-trace-breakdown.json"), breakdown);
  fs.writeFileSync(path.join(args.outDir, "phase-7-real-trace.md"), renderPhase7Md(roundObject(phase7)), "utf8");
  fs.writeFileSync(path.join(args.outDir, "phase-7-real-trace-breakdown.md"), renderBreakdownMd(roundObject(breakdown)), "utf8");
  appendScores(args.outDir, roundObject(phase7));
  appendExperimentLog(args.outDir, roundObject(phase7));

  process.stdout.write(`Input ZIPs: ${phase7.inputZips.join(", ")}\n`);
  process.stdout.write(`Rows: ${phase7.rowSummary.totalRows}\n`);
  for (const id of ["constant_velocity_last2_cap24", "least_squares_w50_cap36", "phase4_strict", "phase4_balanced"]) {
    const row = phase7.candidates[id];
    process.stdout.write(`${id}: mean/p95/p99=${fmt(row.metrics.mean)}/${fmt(row.metrics.p95)}/${fmt(row.metrics.p99)} delta=${fmt(row.regressionsVsBaseline.meanDeltaPx)} >5/>10=${row.regressionsVsBaseline.worseOver5px}/${row.regressionsVsBaseline.worseOver10px} adv=${row.gateUses.advanced}\n`);
  }
  process.stdout.write(`Synthetic direction strict/balanced: ${phase7.syntheticComparison.sameDirection.strict}/${phase7.syntheticComparison.sameDirection.balanced}\n`);
  process.stdout.write(`Recommendation: ${phase7.recommendation}\n`);
  process.stdout.write(`Runtime sec: ${fmt(elapsedSec, 2)}\n`);
}

main();
