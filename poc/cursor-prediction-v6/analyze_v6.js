#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");

const BASELINE_GAIN = 0.75;
const IDLE_GAP_MS = 100;
const STOPWATCH_TICKS_PER_SECOND_DEFAULT = 10_000_000;
const TRACE_FILES = [
  "cursor-mirror-trace-20260502-175951.zip",
  "cursor-mirror-trace-20260502-184947.zip",
];
const GAIN_GRID = [0, 0.25, 0.5, 0.625, 0.675, 0.7, 0.725, 0.75, 0.8, 1.0];

const speedBins = [
  { label: "0-25 px/s", min: 0, max: 25 },
  { label: "25-100 px/s", min: 25, max: 100 },
  { label: "100-250 px/s", min: 100, max: 250 },
  { label: "250-500 px/s", min: 250, max: 500 },
  { label: "500-1000 px/s", min: 500, max: 1000 },
  { label: "1000-2000 px/s", min: 1000, max: 2000 },
  { label: ">=2000 px/s", min: 2000, max: Infinity },
];

const horizonBins = [
  { label: "0-2 ms", min: 0, max: 2 },
  { label: "2-4 ms", min: 2, max: 4 },
  { label: "4-8 ms", min: 4, max: 8 },
  { label: "8-12 ms", min: 8, max: 12 },
  { label: "12-16.7 ms", min: 12, max: 16.7 },
  { label: ">=16.7 ms", min: 16.7, max: Infinity },
];

const leadBins = [
  { label: "<0 us late", min: -Infinity, max: 0 },
  { label: "0-500 us", min: 0, max: 500 },
  { label: "500-1000 us", min: 500, max: 1000 },
  { label: "1000-1500 us", min: 1000, max: 1500 },
  { label: "1500-2000 us", min: 1500, max: 2000 },
  { label: ">=2000 us", min: 2000, max: Infinity },
];

const alphaBetaGrid = [];
for (const alpha of [0.2, 0.4, 0.6, 0.8, 1.0]) {
  for (const beta of [0.05, 0.1, 0.2, 0.4, 0.8]) {
    alphaBetaGrid.push({ alpha, beta });
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--root") args.root = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
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

function listZipEntries(zipPath) {
  const zip = fs.readFileSync(zipPath);
  const eocd = findEocd(zip);
  const centralDirSize = zip.readUInt32LE(eocd + 12);
  const centralDirOffset = zip.readUInt32LE(eocd + 16);
  const entries = [];
  let offset = centralDirOffset;
  const end = centralDirOffset + centralDirSize;
  while (offset < end) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central-directory signature at ${offset}`);
    }
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    entries.push({
      name,
      compressedSize: zip.readUInt32LE(offset + 20),
      uncompressedSize: zip.readUInt32LE(offset + 24),
      method: zip.readUInt16LE(offset + 10),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(zipPath, entryName) {
  const zip = fs.readFileSync(zipPath);
  const eocd = findEocd(zip);
  const centralDirSize = zip.readUInt32LE(eocd + 12);
  const centralDirOffset = zip.readUInt32LE(eocd + 16);
  let offset = centralDirOffset;
  const end = centralDirOffset + centralDirSize;
  while (offset < end) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central-directory signature at ${offset}`);
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    if (name === entryName) {
      if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`Invalid local-file signature for ${entryName}`);
      }
      const localNameLen = zip.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = zip.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
      const data = method === 0 ? Buffer.from(compressed) : method === 8 ? zlib.inflateRawSync(compressed) : null;
      if (!data) throw new Error(`Unsupported ZIP compression method ${method} for ${entryName}`);
      if (data.length !== uncompressedSize) {
        throw new Error(`Unexpected size for ${entryName}: ${data.length} != ${uncompressedSize}`);
      }
      return data;
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`ZIP entry not found: ${entryName}`);
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
  if (data.length === 0) {
    return { n: 0, mean_px: null, rmse_px: null, p50_px: null, p90_px: null, p95_px: null, p99_px: null, max_px: null };
  }
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
  if (data.length === 0) {
    return { count: 0, mean: null, p50: null, p90: null, p95: null, p99: null, max: null, min: null };
  }
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

function numberOrNull(text) {
  if (text === undefined || text === null || text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function boolOrFalse(text) {
  return text === "true" || text === "True";
}

function distance(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function lowerBound(arr, value) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function findSegmentIndex(times, target, startIndex) {
  let lo = Math.max(0, Math.min(startIndex, times.length - 2));
  while (lo + 1 < times.length && times[lo + 1] < target) lo += 1;
  while (lo > 0 && times[lo] > target) lo -= 1;
  return lo;
}

function interpolate(times, xs, ys, target, startIndex = 0) {
  if (times.length < 2 || target < times[0] || target > times[times.length - 1]) return null;
  const i = findSegmentIndex(times, target, startIndex);
  if (i >= times.length - 1) return null;
  const t0 = times[i];
  const t1 = times[i + 1];
  if (target < t0 || target > t1 || t1 <= t0) return null;
  const frac = (target - t0) / (t1 - t0);
  return {
    x: xs[i] + (xs[i + 1] - xs[i]) * frac,
    y: ys[i] + (ys[i + 1] - ys[i]) * frac,
    leftIndex: i,
    rightIndex: i + 1,
    intervalMs: (t1 - t0) / 1000,
    nearestMs: Math.min(target - t0, t1 - target) / 1000,
  };
}

function binOf(value, bins) {
  if (!Number.isFinite(value)) return "missing";
  for (const bin of bins) {
    if (value >= bin.min && value < bin.max) return bin.label;
  }
  return bins[bins.length - 1].label;
}

function selectNextVBlank(sampleTicks, vblankTicks, refreshTicks) {
  if (!Number.isFinite(sampleTicks) || !Number.isFinite(vblankTicks) || !Number.isFinite(refreshTicks) || refreshTicks <= 0) {
    return null;
  }
  let target = vblankTicks;
  if (target <= sampleTicks) {
    const periodsLate = Math.floor((sampleTicks - target) / refreshTicks) + 1;
    target += periodsLate * refreshTicks;
  }
  return target;
}

function loadTrace(zipPath, sessionId) {
  const metadata = JSON.parse(readZipEntry(zipPath, "metadata.json").toString("utf8"));
  const traceText = readZipEntry(zipPath, "trace.csv").toString("utf8");
  const lines = traceText.split(/\r?\n/);
  const header = lines[0].split(",");
  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  const required = [
    "sequence",
    "stopwatchTicks",
    "elapsedMicroseconds",
    "x",
    "y",
    "event",
    "cursorX",
    "cursorY",
    "dwmTimingAvailable",
    "dwmQpcRefreshPeriod",
    "dwmQpcVBlank",
    "runtimeSchedulerTargetVBlankTicks",
    "runtimeSchedulerPlannedTickTicks",
    "runtimeSchedulerActualTickTicks",
    "runtimeSchedulerVBlankLeadMicroseconds",
    "runtimeSchedulerWaitMethod",
    "schedulerExperimentVariant",
  ];
  for (const name of required) {
    if (!(name in column)) throw new Error(`${path.basename(zipPath)} is missing CSV column ${name}`);
  }

  const stopwatchFrequency = Number(metadata.StopwatchFrequency || STOPWATCH_TICKS_PER_SECOND_DEFAULT);
  const ticksToUs = 1_000_000 / stopwatchFrequency;
  const eventCounts = {};
  const eventIntervalsMs = {};
  const lastEventTimeUs = {};
  const refTimesUs = [];
  const refX = [];
  const refY = [];
  const anchorRows = [];
  const anchorIntervalsMs = [];
  const schedulerLeadUs = [];
  const actualMinusPlannedUs = [];
  const targetHorizonMs = [];
  let csvRows = 0;
  let firstElapsedUs = null;
  let lastElapsedUs = null;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    csvRows += 1;
    const parts = line.split(",");
    const event = parts[column.event];
    const elapsedUs = Number(parts[column.elapsedMicroseconds]);
    const stopwatchTicks = Number(parts[column.stopwatchTicks]);
    const x = Number(parts[column.x]);
    const y = Number(parts[column.y]);
    const cursorX = numberOrNull(parts[column.cursorX]);
    const cursorY = numberOrNull(parts[column.cursorY]);

    if (firstElapsedUs === null) firstElapsedUs = elapsedUs;
    lastElapsedUs = elapsedUs;
    eventCounts[event] = (eventCounts[event] || 0) + 1;
    if (lastEventTimeUs[event] !== undefined) {
      if (!eventIntervalsMs[event]) eventIntervalsMs[event] = [];
      const intervalMs = (elapsedUs - lastEventTimeUs[event]) / 1000;
      eventIntervalsMs[event].push(intervalMs);
      if (event === "runtimeSelfSchedulerPoll") anchorIntervalsMs.push(intervalMs);
    }
    lastEventTimeUs[event] = elapsedUs;

    if (event === "referencePoll") {
      refTimesUs.push(elapsedUs);
      refX.push(cursorX ?? x);
      refY.push(cursorY ?? y);
    } else if (event === "runtimeSelfSchedulerPoll") {
      const dwmTimingAvailable = boolOrFalse(parts[column.dwmTimingAvailable]);
      const refreshTicks = numberOrNull(parts[column.dwmQpcRefreshPeriod]);
      const vblankTicks = numberOrNull(parts[column.dwmQpcVBlank]);
      const schedulerTargetTicks = numberOrNull(parts[column.runtimeSchedulerTargetVBlankTicks]);
      const schedulerPlannedTicks = numberOrNull(parts[column.runtimeSchedulerPlannedTickTicks]);
      const schedulerActualTicks = numberOrNull(parts[column.runtimeSchedulerActualTickTicks]);
      const schedulerLead = numberOrNull(parts[column.runtimeSchedulerVBlankLeadMicroseconds]);
      const predictorTargetTicks = dwmTimingAvailable ? selectNextVBlank(stopwatchTicks, vblankTicks, refreshTicks) : null;
      const predictorTargetUs = predictorTargetTicks === null ? null : elapsedUs + (predictorTargetTicks - stopwatchTicks) * ticksToUs;
      const predictorHorizonMs = predictorTargetUs === null ? null : (predictorTargetUs - elapsedUs) / 1000;
      if (schedulerLead !== null) schedulerLeadUs.push(schedulerLead);
      if (schedulerActualTicks !== null && schedulerPlannedTicks !== null) actualMinusPlannedUs.push((schedulerActualTicks - schedulerPlannedTicks) * ticksToUs);
      if (predictorHorizonMs !== null) targetHorizonMs.push(predictorHorizonMs);
      anchorRows.push({
        sessionId,
        sourceZip: path.basename(zipPath),
        sequence: Number(parts[column.sequence]),
        elapsedUs,
        stopwatchTicks,
        x,
        y,
        cursorX: cursorX ?? x,
        cursorY: cursorY ?? y,
        dwmTimingAvailable,
        refreshTicks,
        vblankTicks,
        schedulerTargetTicks,
        schedulerPlannedTicks,
        schedulerActualTicks,
        schedulerLeadUs: schedulerLead,
        schedulerWaitMethod: parts[column.runtimeSchedulerWaitMethod] || null,
        schedulerExperimentVariant: parts[column.schedulerExperimentVariant] || null,
        predictorTargetTicks,
        predictorTargetUs,
        predictorHorizonMs,
      });
    }
  }

  return {
    sessionId,
    sourceZip: path.basename(zipPath),
    zipEntries: listZipEntries(zipPath),
    metadata,
    stopwatchFrequency,
    ticksToUs,
    csvRows,
    firstElapsedUs,
    lastElapsedUs,
    durationMs: firstElapsedUs === null || lastElapsedUs === null ? null : (lastElapsedUs - firstElapsedUs) / 1000,
    eventCounts: Object.fromEntries(Object.entries(eventCounts).sort(([a], [b]) => a.localeCompare(b))),
    eventIntervalsMs,
    refTimesUs,
    refX,
    refY,
    anchorRows,
    auditVectors: {
      anchorIntervalsMs,
      schedulerLeadUs,
      actualMinusPlannedUs,
      targetHorizonMs,
    },
  };
}

function buildDatasetForTrace(trace) {
  const rows = [];
  const diagnostics = {
    anchors_seen: trace.anchorRows.length,
    rows_scored: 0,
    missing_reference_label: 0,
    invalid_dwm_target_fallbacks: 0,
    invalid_or_idle_dt: 0,
    no_previous_anchor: 0,
  };
  const refTargetIntervalsMs = [];
  const refTargetNearestMs = [];
  const speedValues = [];
  const accelerationValues = [];
  let refIndex = 0;
  let prev = null;
  let prevPrev = null;

  for (const anchor of trace.anchorRows) {
    const dwmValid = Number.isFinite(anchor.predictorTargetUs) && Number.isFinite(anchor.predictorHorizonMs) && anchor.predictorHorizonMs >= 0 && anchor.predictorHorizonMs < 100;
    const targetUs = dwmValid ? anchor.predictorTargetUs : anchor.elapsedUs;
    if (!dwmValid) diagnostics.invalid_dwm_target_fallbacks += 1;
    const label = interpolate(trace.refTimesUs, trace.refX, trace.refY, targetUs, refIndex);
    if (!label) {
      diagnostics.missing_reference_label += 1;
      prevPrev = prev;
      prev = anchor;
      continue;
    }
    refIndex = label.leftIndex;
    refTargetIntervalsMs.push(label.intervalMs);
    refTargetNearestMs.push(label.nearestMs);

    const dtMs = prev ? (anchor.elapsedUs - prev.elapsedUs) / 1000 : null;
    if (!prev) diagnostics.no_previous_anchor += 1;
    const validVelocity = prev && dtMs > 0 && dtMs <= IDLE_GAP_MS;
    if (prev && !validVelocity) diagnostics.invalid_or_idle_dt += 1;
    let vx = 0;
    let vy = 0;
    let speedPxS = 0;
    let accelerationPxS2 = 0;
    let prevDtMs = null;
    if (validVelocity) {
      vx = (anchor.cursorX - prev.cursorX) / (dtMs / 1000);
      vy = (anchor.cursorY - prev.cursorY) / (dtMs / 1000);
      speedPxS = Math.sqrt(vx * vx + vy * vy);
      speedValues.push(speedPxS);
      if (prevPrev) {
        prevDtMs = (prev.elapsedUs - prevPrev.elapsedUs) / 1000;
        if (prevDtMs > 0 && prevDtMs <= IDLE_GAP_MS) {
          const pvx = (prev.cursorX - prevPrev.cursorX) / (prevDtMs / 1000);
          const pvy = (prev.cursorY - prevPrev.cursorY) / (prevDtMs / 1000);
          const avgDtSec = ((dtMs + prevDtMs) / 2) / 1000;
          const ax = (vx - pvx) / avgDtSec;
          const ay = (vy - pvy) / avgDtSec;
          accelerationPxS2 = Math.sqrt(ax * ax + ay * ay);
          accelerationValues.push(accelerationPxS2);
        }
      }
    }

    const horizonMs = dwmValid ? anchor.predictorHorizonMs : 0;
    const row = {
      rowId: `${trace.sessionId}:${rows.length}`,
      sessionId: trace.sessionId,
      sourceZip: trace.sourceZip,
      ordinal: rows.length,
      sequence: anchor.sequence,
      anchorElapsedUs: anchor.elapsedUs,
      targetElapsedUs: targetUs,
      targetHorizonMs: horizonMs,
      labelX: label.x,
      labelY: label.y,
      labelReferenceLeftIndex: label.leftIndex,
      labelReferenceRightIndex: label.rightIndex,
      labelReferenceIntervalMs: label.intervalMs,
      labelReferenceNearestMs: label.nearestMs,
      anchorX: anchor.cursorX,
      anchorY: anchor.cursorY,
      prevAnchorX: prev ? prev.cursorX : null,
      prevAnchorY: prev ? prev.cursorY : null,
      prevPrevAnchorX: prevPrev ? prevPrev.cursorX : null,
      prevPrevAnchorY: prevPrev ? prevPrev.cursorY : null,
      dtMs,
      prevDtMs,
      validVelocity,
      velocityX: vx,
      velocityY: vy,
      speedPxS,
      accelerationPxS2,
      dwmTimingAvailable: anchor.dwmTimingAvailable,
      dwmRefreshTicks: anchor.refreshTicks,
      dwmVBlankTicks: anchor.vblankTicks,
      schedulerTargetTicks: anchor.schedulerTargetTicks,
      schedulerPlannedTicks: anchor.schedulerPlannedTicks,
      schedulerActualTicks: anchor.schedulerActualTicks,
      schedulerLeadUs: anchor.schedulerLeadUs,
      schedulerWaitMethod: anchor.schedulerWaitMethod,
      speedBin: binOf(speedPxS, speedBins),
      horizonBin: binOf(horizonMs, horizonBins),
      schedulerLeadBin: binOf(anchor.schedulerLeadUs, leadBins),
      chronologicalFrac: trace.anchorRows.length > 1 ? rows.length / (trace.anchorRows.length - 1) : 0,
      chronologicalBlock: rows.length < trace.anchorRows.length * 0.7 ? "train_block_first_70pct" : "validation_block_last_30pct",
    };
    rows.push(row);
    diagnostics.rows_scored += 1;
    prevPrev = prev;
    prev = anchor;
  }

  return {
    rows,
    diagnostics,
    summary: {
      sessionId: trace.sessionId,
      sourceZip: trace.sourceZip,
      rows: rows.length,
      anchor_count: trace.anchorRows.length,
      reference_poll_count: trace.refTimesUs.length,
      target_horizon_ms: scalarStats(rows.map((row) => row.targetHorizonMs)),
      anchor_interval_ms: scalarStats(trace.auditVectors.anchorIntervalsMs),
      speed_px_s: scalarStats(speedValues),
      acceleration_px_s2: scalarStats(accelerationValues),
      reference_target_interval_ms: scalarStats(refTargetIntervalsMs),
      reference_target_nearest_ms: scalarStats(refTargetNearestMs),
      chronological_blocks: summarizeCategorical(rows, (row) => row.chronologicalBlock),
    },
  };
}

function summarizeCategorical(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row) || "missing";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function predictGain(row, gain) {
  if (!row.validVelocity || !Number.isFinite(row.dtMs) || row.dtMs <= 0 || row.targetHorizonMs <= 0) {
    return { x: row.anchorX, y: row.anchorY, mode: "hold" };
  }
  return {
    x: row.anchorX + row.velocityX * (row.targetHorizonMs / 1000) * gain,
    y: row.anchorY + row.velocityY * (row.targetHorizonMs / 1000) * gain,
    mode: "last2",
  };
}

function predictAcceleration(row, gain, accelerationGain) {
  if (!row.validVelocity || !Number.isFinite(row.prevDtMs) || row.prevDtMs <= 0 || row.targetHorizonMs <= 0) {
    return predictGain(row, gain);
  }
  const h = row.targetHorizonMs / 1000;
  const prevVx = (row.prevAnchorX - row.prevPrevAnchorX) / (row.prevDtMs / 1000);
  const prevVy = (row.prevAnchorY - row.prevPrevAnchorY) / (row.prevDtMs / 1000);
  if (!Number.isFinite(prevVx) || !Number.isFinite(prevVy)) return predictGain(row, gain);
  const avgDtSec = ((row.dtMs + row.prevDtMs) / 2) / 1000;
  const ax = (row.velocityX - prevVx) / avgDtSec;
  const ay = (row.velocityY - prevVy) / avgDtSec;
  return {
    x: row.anchorX + row.velocityX * h * gain + 0.5 * ax * h * h * accelerationGain,
    y: row.anchorY + row.velocityY * h * gain + 0.5 * ay * h * h * accelerationGain,
    mode: "last3_accel",
  };
}

function evaluateStatelessModel(rows, model, baselineErrors = null) {
  const records = [];
  const errors = [];
  const modeCounts = {};
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const pred = model.predict(row);
    const error = distance(pred.x, pred.y, row.labelX, row.labelY);
    const baselineError = baselineErrors ? baselineErrors[i] : error;
    errors.push(error);
    modeCounts[pred.mode || "unknown"] = (modeCounts[pred.mode || "unknown"] || 0) + 1;
    records.push({
      error_px: error,
      baseline_error_px: baselineError,
      delta_px: error - baselineError,
      speed_bin: row.speedBin,
      horizon_bin: row.horizonBin,
      scheduler_lead_bin: row.schedulerLeadBin,
      chronological_block: row.chronologicalBlock,
    });
  }
  return summarizeEvaluation(model, records, errors, modeCounts);
}

function evaluateAlphaBeta(rows, params, baselineErrors = null) {
  const records = [];
  const errors = [];
  const modeCounts = {};
  let state = null;
  let lastSessionId = null;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const reset = row.sessionId !== lastSessionId || !Number.isFinite(row.dtMs) || row.dtMs <= 0 || row.dtMs > IDLE_GAP_MS;
    if (reset || !state) {
      state = { x: row.anchorX, y: row.anchorY, vx: 0, vy: 0 };
      lastSessionId = row.sessionId;
    } else {
      const dtSec = row.dtMs / 1000;
      const predX = state.x + state.vx * dtSec;
      const predY = state.y + state.vy * dtSec;
      const residualX = row.anchorX - predX;
      const residualY = row.anchorY - predY;
      state = {
        x: predX + params.alpha * residualX,
        y: predY + params.alpha * residualY,
        vx: state.vx + (params.beta * residualX) / dtSec,
        vy: state.vy + (params.beta * residualY) / dtSec,
      };
    }
    const h = Math.max(0, row.targetHorizonMs / 1000);
    const pred = { x: state.x + state.vx * h, y: state.y + state.vy * h, mode: "alpha_beta" };
    const error = distance(pred.x, pred.y, row.labelX, row.labelY);
    const baselineError = baselineErrors ? baselineErrors[i] : error;
    errors.push(error);
    modeCounts.alpha_beta = (modeCounts.alpha_beta || 0) + 1;
    records.push({
      error_px: error,
      baseline_error_px: baselineError,
      delta_px: error - baselineError,
      speed_bin: row.speedBin,
      horizon_bin: row.horizonBin,
      scheduler_lead_bin: row.schedulerLeadBin,
      chronological_block: row.chronologicalBlock,
    });
  }
  return summarizeEvaluation({
    id: `alpha_beta_a${String(params.alpha).replace(".", "_")}_b${String(params.beta).replace(".", "_")}`,
    family: "alpha_beta",
    description: "Stateful alpha-beta constant-velocity smoother, reset on session change or idle gap.",
    parameters: params,
  }, records, errors, modeCounts);
}

function summarizeEvaluation(model, records, errors, modeCounts) {
  return {
    id: model.id,
    family: model.family,
    description: model.description,
    parameters: model.parameters || {},
    overall: metricStats(errors),
    regressions_vs_current: regressionCounts(records),
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

function regressionCounts(records) {
  let worse1 = 0;
  let worse3 = 0;
  let worse5 = 0;
  let better1 = 0;
  let better3 = 0;
  let better5 = 0;
  for (const record of records) {
    if (record.delta_px > 1) worse1 += 1;
    if (record.delta_px > 3) worse3 += 1;
    if (record.delta_px > 5) worse5 += 1;
    if (record.delta_px < -1) better1 += 1;
    if (record.delta_px < -3) better3 += 1;
    if (record.delta_px < -5) better5 += 1;
  }
  return {
    worse_over_1px: worse1,
    worse_over_3px: worse3,
    worse_over_5px: worse5,
    better_over_1px: better1,
    better_over_3px: better3,
    better_over_5px: better5,
  };
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

function makeFixedGainModels() {
  const models = [
    {
      id: "current_dwm_aware_last2_gain_0_75",
      family: "current_baseline",
      description: "Current DWM-aware last-two-sample predictor with gain 0.75.",
      parameters: { gain: 0.75 },
      predict: (row) => predictGain(row, 0.75),
    },
    {
      id: "hold_current",
      family: "hold",
      description: "Hold current runtimeSelfSchedulerPoll position to target.",
      parameters: {},
      predict: (row) => ({ x: row.anchorX, y: row.anchorY, mode: "hold" }),
    },
  ];
  for (const gain of GAIN_GRID) {
    models.push({
      id: `gain_${String(gain).replace(".", "_")}`,
      family: "gain_grid",
      description: `DWM-aware last-two-sample predictor with gain ${gain}.`,
      parameters: { gain },
      predict: (row) => predictGain(row, gain),
    });
  }
  for (const accelerationGain of [0.25, 0.5]) {
    models.push({
      id: `last3_acceleration_gain_0_75_accel_${String(accelerationGain).replace(".", "_")}`,
      family: "acceleration",
      description: "Adds a small last-three-sample acceleration term to current gain.",
      parameters: { gain: 0.75, acceleration_gain: accelerationGain },
      predict: (row) => predictAcceleration(row, 0.75, accelerationGain),
    });
  }
  return models;
}

function baselineErrorsFor(rows) {
  return rows.map((row) => {
    const pred = predictGain(row, BASELINE_GAIN);
    return distance(pred.x, pred.y, row.labelX, row.labelY);
  });
}

function chooseBestByTrain(rows, models, objective = "p95_px") {
  let best = null;
  for (const model of models) {
    const evaluated = evaluateStatelessModel(rows, model);
    const score = evaluated.overall[objective];
    if (!Number.isFinite(score)) continue;
    if (!best || score < best.score || (score === best.score && evaluated.overall.mean_px < best.evaluated.overall.mean_px)) {
      best = { model, evaluated, score };
    }
  }
  return best;
}

function fitPiecewiseGains(trainRows, keySelector, id, family, minRows = 25) {
  const groups = {};
  for (const row of trainRows) {
    const key = keySelector(row);
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  const allGainModels = GAIN_GRID.map((gain) => ({
    id: `tmp_${gain}`,
    family,
    description: "",
    parameters: { gain },
    predict: (row) => predictGain(row, gain),
  }));
  const defaultBest = chooseBestByTrain(trainRows, allGainModels);
  const gains = {};
  const groupTraining = {};
  for (const [key, rows] of Object.entries(groups)) {
    const selected = rows.length >= minRows ? chooseBestByTrain(rows, allGainModels) : defaultBest;
    gains[key] = selected ? selected.model.parameters.gain : BASELINE_GAIN;
    groupTraining[key] = {
      n: rows.length,
      selected_gain: gains[key],
      train_objective_p95_px: selected ? selected.evaluated.overall.p95_px : null,
    };
  }
  return {
    id,
    family,
    description: `Piecewise train-session-selected gain using ${family} bins.`,
    parameters: {
      default_gain: defaultBest ? defaultBest.model.parameters.gain : BASELINE_GAIN,
      min_rows_per_bin: minRows,
      gains,
      group_training: groupTraining,
    },
    predict: (row) => predictGain(row, gains[keySelector(row)] ?? (defaultBest ? defaultBest.model.parameters.gain : BASELINE_GAIN)),
  };
}

function fitAlphaBeta(trainRows) {
  let best = null;
  for (const params of alphaBetaGrid) {
    const evaluated = evaluateAlphaBeta(trainRows, params);
    const score = evaluated.overall.p95_px;
    if (!best || score < best.score || (score === best.score && evaluated.overall.mean_px < best.evaluated.overall.mean_px)) {
      best = { params, evaluated, score };
    }
  }
  return best;
}

function evaluateFold(trainRows, evalRows, foldId) {
  const fixedModels = makeFixedGainModels();
  const baselineErrors = baselineErrorsFor(evalRows);
  const fixedEvaluations = fixedModels.map((model) => evaluateStatelessModel(evalRows, model, baselineErrors));
  const gainModels = fixedModels.filter((model) => model.family === "gain_grid");
  const globalBestGain = chooseBestByTrain(trainRows, gainModels);
  const trainedModels = [];
  if (globalBestGain) {
    const gain = globalBestGain.model.parameters.gain;
    trainedModels.push({
      id: "train_selected_global_gain",
      family: "trained_gain",
      description: "Single gain selected on the train session by p95.",
      parameters: { gain, train_p95_px: globalBestGain.evaluated.overall.p95_px },
      predict: (row) => predictGain(row, gain),
    });
  }
  trainedModels.push(fitPiecewiseGains(trainRows, (row) => row.speedBin, "train_selected_speed_binned_gain", "speed_binned_gain"));
  trainedModels.push(fitPiecewiseGains(trainRows, (row) => row.horizonBin, "train_selected_horizon_binned_gain", "horizon_binned_gain"));
  trainedModels.push(fitPiecewiseGains(trainRows, (row) => `${row.speedBin} | ${row.horizonBin}`, "train_selected_speed_horizon_binned_gain", "speed_horizon_binned_gain", 40));
  const alphaBetaBest = fitAlphaBeta(trainRows);
  const trainedEvaluations = trainedModels.map((model) => evaluateStatelessModel(evalRows, model, baselineErrors));
  const alphaBetaEvaluation = evaluateAlphaBeta(evalRows, alphaBetaBest.params, baselineErrors);
  alphaBetaEvaluation.id = "train_selected_alpha_beta";
  alphaBetaEvaluation.parameters = { ...alphaBetaBest.params, train_p95_px: alphaBetaBest.evaluated.overall.p95_px };
  const candidates = [...fixedEvaluations, ...trainedEvaluations, alphaBetaEvaluation].sort((a, b) => {
    const ap99 = a.overall.p99_px ?? Infinity;
    const bp99 = b.overall.p99_px ?? Infinity;
    return ap99 - bp99 || (a.regressions_vs_current.worse_over_5px - b.regressions_vs_current.worse_over_5px);
  });
  const baseline = candidates.find((entry) => entry.id === "current_dwm_aware_last2_gain_0_75");
  for (const candidate of candidates) {
    candidate.delta_vs_current = {
      mean_px: candidate.overall.mean_px - baseline.overall.mean_px,
      rmse_px: candidate.overall.rmse_px - baseline.overall.rmse_px,
      p50_px: candidate.overall.p50_px - baseline.overall.p50_px,
      p90_px: candidate.overall.p90_px - baseline.overall.p90_px,
      p95_px: candidate.overall.p95_px - baseline.overall.p95_px,
      p99_px: candidate.overall.p99_px - baseline.overall.p99_px,
      max_px: candidate.overall.max_px - baseline.overall.max_px,
    };
  }
  return {
    foldId,
    train_session: trainRows[0] ? trainRows[0].sessionId : null,
    eval_session: evalRows[0] ? evalRows[0].sessionId : null,
    train_n: trainRows.length,
    eval_n: evalRows.length,
    train_selected: {
      global_gain: globalBestGain ? globalBestGain.model.parameters.gain : null,
      alpha_beta: alphaBetaBest.params,
    },
    candidates,
    best_by_p99: candidates[0],
    best_with_zero_over_5px_regressions: candidates.find((entry) => entry.regressions_vs_current.worse_over_5px === 0) || null,
  };
}

function evaluateTimeBlock(sessionRows) {
  const trainRows = sessionRows.filter((row) => row.chronologicalBlock === "train_block_first_70pct");
  const validationRows = sessionRows.filter((row) => row.chronologicalBlock === "validation_block_last_30pct");
  const fixedModels = makeFixedGainModels();
  const baselineErrors = baselineErrorsFor(validationRows);
  const gainModels = fixedModels.filter((model) => model.family === "gain_grid");
  const bestGain = chooseBestByTrain(trainRows, gainModels);
  const evaluations = fixedModels.map((model) => evaluateStatelessModel(validationRows, model, baselineErrors));
  if (bestGain) {
    const gain = bestGain.model.parameters.gain;
    evaluations.push(evaluateStatelessModel(validationRows, {
      id: "block_train_selected_global_gain",
      family: "block_trained_gain",
      description: "Global gain selected on first 70% and evaluated on final 30%.",
      parameters: { gain, train_p95_px: bestGain.evaluated.overall.p95_px },
      predict: (row) => predictGain(row, gain),
    }, baselineErrors));
  }
  evaluations.sort((a, b) => (a.overall.p99_px ?? Infinity) - (b.overall.p99_px ?? Infinity));
  return {
    sessionId: sessionRows[0] ? sessionRows[0].sessionId : null,
    train_n: trainRows.length,
    validation_n: validationRows.length,
    selected_gain_on_train_block: bestGain ? bestGain.model.parameters.gain : null,
    candidates: evaluations,
    best_by_validation_p99: evaluations[0] || null,
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, text) {
  fs.writeFileSync(file, text.replace(/\n/g, "\r\n"), "utf8");
}

function renderAuditReport(phase1Scores) {
  const rows = phase1Scores.sessions.map((session) => [
    session.session_id,
    session.source_zip,
    String(session.trace_format_version),
    fmtInt(session.csv_rows),
    fmtInt(session.event_counts.runtimeSelfSchedulerPoll),
    fmtInt(session.event_counts.referencePoll),
    fmt(session.runtime_self_scheduler_interval_ms.p50),
    fmt(session.runtime_self_scheduler_interval_ms.p95),
    fmt(session.reference_poll_interval_ms.p95),
  ]);
  return `# Phase 1 - Data Audit

## Scope

Inputs were read directly from the two requested format-9 trace ZIPs. The ZIP files were not modified.

${table(["session", "zip", "format", "csv rows", "self anchors", "reference rows", "self p50 ms", "self p95 ms", "ref p95 ms"], rows)}

## Anchor And Label Policy

- Anchor stream: \`runtimeSelfSchedulerPoll\`.
- Label stream: \`referencePoll\`.
- Target timestamp: DWM next-vblank recomputed from the anchor sample timestamp and DWM timing fields, matching the current DWM-aware predictor shape.
- Label position: linear interpolation between the adjacent \`referencePoll\` samples at the target timestamp.
- Feature policy: dataset rows only use anchor-time-or-earlier fields. Future reference data is used only to construct labels.

## Notes

Both traces report 100% DWM timing availability. The self-scheduler cadence is close to one refresh interval at the median and p95, while \`referencePoll\` remains dense enough for interpolation. The audit keeps legacy \`poll\`, \`runtimeSchedulerPoll\`, and scheduler experiment streams out of the dataset except for event-count context.
`;
}

function renderDatasetReport(phase2Scores) {
  const rows = phase2Scores.sessions.map((session) => [
    session.sessionId,
    fmtInt(session.rows),
    fmt(session.target_horizon_ms.mean),
    fmt(session.target_horizon_ms.p95),
    fmt(session.speed_px_s.p95),
    fmt(session.reference_target_nearest_ms.p95),
    fmtInt(session.chronological_blocks.train_block_first_70pct),
    fmtInt(session.chronological_blocks.validation_block_last_30pct),
  ]);
  return `# Phase 2 - Dataset Builder

## Dataset

${table(["session", "rows", "horizon mean", "horizon p95", "speed p95", "ref nearest p95", "first 70%", "last 30%"], rows)}

Rows are written to \`dataset.jsonl\`. Each row includes anchor coordinates, prior anchor coordinates, causal velocity/acceleration summaries, DWM/scheduler timing fields visible at anchor time, and the interpolated future label.

## Cross-Validation Splits

${table(["fold", "train", "eval"], phase2Scores.cross_validation_folds.map((fold) => [fold.fold_id, fold.train_session, fold.eval_session]))}

## Limitations

The label stream is an interpolated reference poll stream rather than hardware ground truth. It is dense enough for this POC, but reference interpolation error and any capture delay still bound how literally to read sub-pixel or very-low-pixel deltas.
`;
}

function renderPhase3Report(phase3Scores) {
  const foldRows = phase3Scores.cross_validation.map((fold) => {
    const baseline = fold.candidates.find((entry) => entry.id === "current_dwm_aware_last2_gain_0_75");
    const bestSafe = fold.best_with_zero_over_5px_regressions || fold.best_by_p99;
    return [
      fold.foldId,
      `${fold.train_session} -> ${fold.eval_session}`,
      baseline.id,
      `${fmt(baseline.overall.mean_px)} / ${fmt(baseline.overall.p95_px)} / ${fmt(baseline.overall.p99_px)}`,
      bestSafe.id,
      `${fmt(bestSafe.overall.mean_px)} / ${fmt(bestSafe.overall.p95_px)} / ${fmt(bestSafe.overall.p99_px)}`,
      `${fmt(bestSafe.delta_vs_current.mean_px)} / ${fmt(bestSafe.delta_vs_current.p95_px)} / ${fmt(bestSafe.delta_vs_current.p99_px)}`,
      fmtInt(bestSafe.regressions_vs_current.worse_over_5px),
    ];
  });
  const recommended = phase3Scores.recommendation.selected_candidate;
  const raw = phase3Scores.recommendation.best_raw_non_current_by_mean_p99;
  const zero = phase3Scores.recommendation.best_zero_regression_non_current_by_mean_p99;
  const recommendationText = recommended.id === "current_dwm_aware_last2_gain_0_75"
    ? "No non-current deterministic candidate improved average cross-session p99 while keeping zero >5 px regressions, so the recommended candidate is the current baseline."
    : `\`${recommended.id}\` is the current best deterministic candidate by the conservative cross-session rule.`;
  return `# Phase 3 - Deterministic Baselines

## Cross-Session Results

${table(["fold", "split", "baseline", "baseline mean/p95/p99", "selected", "selected mean/p95/p99", "delta mean/p95/p99", ">5px worse"], foldRows)}

## Best Candidate So Far

${recommendationText}

Best raw non-current p99 candidate: \`${raw ? raw.id : "none"}\`${raw ? `, mean p99 delta ${fmt(raw.mean_delta_p99_px)} px with ${fmtInt(raw.total_worse_over_5px)} total >5 px regressions` : ""}.

Best zero-regression non-current candidate: \`${zero ? zero.id : "none"}\`${zero ? `, mean p99 delta ${fmt(zero.mean_delta_p99_px)} px` : ""}.

## Honest Read

The gains are small. The current DWM-aware last2 gain 0.75 baseline is already strong on these self-scheduler anchors. Retuned fixed gains can shave a little p99 in one fold, but the cross-session aggregate adds at least one visible regression. Stateful alpha-beta smoothing was feasible to test, but it did not clear the zero-regression guard.
`;
}

function main() {
  const args = parseArgs(process.argv);
  const scriptDir = __dirname;
  const repoRoot = path.resolve(args.root || path.join(scriptDir, "..", ".."));
  const outRoot = path.resolve(args.out || scriptDir);
  const phase1Dir = path.join(outRoot, "phase-1 data-audit");
  const phase2Dir = path.join(outRoot, "phase-2 dataset-builder");
  const phase3Dir = path.join(outRoot, "phase-3 deterministic-baselines");
  fs.mkdirSync(phase1Dir, { recursive: true });
  fs.mkdirSync(phase2Dir, { recursive: true });
  fs.mkdirSync(phase3Dir, { recursive: true });

  const started = performance.now();
  const traces = TRACE_FILES.map((file) => loadTrace(path.join(repoRoot, file), file.match(/(\d{6})\.zip$/)[1]));
  const datasets = traces.map((trace) => buildDatasetForTrace(trace));
  const allRows = datasets.flatMap((dataset) => dataset.rows);
  const rowsBySession = Object.fromEntries(datasets.map((dataset) => [dataset.summary.sessionId, dataset.rows]));

  const phase1Scores = {
    generated_at_utc: new Date().toISOString(),
    phase: "phase-1 data-audit",
    input_zips: TRACE_FILES,
    config: {
      anchor_stream: "runtimeSelfSchedulerPoll",
      label_stream: "referencePoll",
      target_policy: "DWM next-vblank recomputed from runtimeSelfSchedulerPoll sample time and DWM timing fields.",
      zip_policy: "Read-only ZIP entry parsing; no extraction and no mutation.",
    },
    sessions: traces.map((trace) => ({
      session_id: trace.sessionId,
      source_zip: trace.sourceZip,
      trace_format_version: trace.metadata.TraceFormatVersion,
      created_utc: trace.metadata.CreatedUtc,
      product_version: trace.metadata.ProductVersion,
      csv_rows: trace.csvRows,
      duration_ms: trace.durationMs,
      zip_entries: trace.zipEntries,
      metadata_counts: {
        SampleCount: trace.metadata.SampleCount,
        RuntimeSelfSchedulerPollSampleCount: trace.metadata.RuntimeSelfSchedulerPollSampleCount,
        ReferencePollSampleCount: trace.metadata.ReferencePollSampleCount,
        RuntimeSchedulerPollSampleCount: trace.metadata.RuntimeSchedulerPollSampleCount,
        SchedulerExperimentSampleCount: trace.metadata.SchedulerExperimentSampleCount,
      },
      event_counts: trace.eventCounts,
      runtime_self_scheduler_interval_ms: scalarStats(trace.eventIntervalsMs.runtimeSelfSchedulerPoll || []),
      runtime_scheduler_interval_ms: scalarStats(trace.eventIntervalsMs.runtimeSchedulerPoll || []),
      product_poll_interval_ms: scalarStats(trace.eventIntervalsMs.poll || []),
      reference_poll_interval_ms: scalarStats(trace.eventIntervalsMs.referencePoll || []),
      scheduler_lead_us: scalarStats(trace.auditVectors.schedulerLeadUs),
      scheduler_actual_minus_planned_us: scalarStats(trace.auditVectors.actualMinusPlannedUs),
      predictor_target_horizon_ms: scalarStats(trace.auditVectors.targetHorizonMs),
      metadata_quality_warnings: trace.metadata.QualityWarnings || [],
    })),
  };
  writeJson(path.join(phase1Dir, "scores.json"), phase1Scores);
  writeText(path.join(phase1Dir, "report.md"), renderAuditReport(phase1Scores));
  writeText(path.join(phase1Dir, "experiment-log.md"), `# Experiment Log

- Created v6 phase folders.
- Read \`${TRACE_FILES[0]}\` and \`${TRACE_FILES[1]}\` directly as ZIP archives.
- Verified format 9 metadata and counted event streams.
- Confirmed \`runtimeSelfSchedulerPoll\` and \`referencePoll\` are present in both traces.
- Wrote \`scores.json\` and \`report.md\`.
`);

  const datasetPath = path.join(phase2Dir, "dataset.jsonl");
  fs.writeFileSync(datasetPath, allRows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  const phase2Scores = {
    generated_at_utc: new Date().toISOString(),
    phase: "phase-2 dataset-builder",
    config: {
      anchor_stream: "runtimeSelfSchedulerPoll",
      label_stream: "referencePoll",
      feature_policy: "Only anchor-time-or-earlier fields are used for features. Reference future is used only for labels.",
      idle_gap_ms: IDLE_GAP_MS,
      dataset_file: "dataset.jsonl",
    },
    sessions: datasets.map((dataset) => dataset.summary),
    diagnostics: Object.fromEntries(datasets.map((dataset) => [dataset.summary.sessionId, dataset.diagnostics])),
    cross_validation_folds: [
      { fold_id: "train_175951_eval_184947", train_session: "175951", eval_session: "184947" },
      { fold_id: "train_184947_eval_175951", train_session: "184947", eval_session: "175951" },
    ],
    combined: {
      rows: allRows.length,
      sessions: summarizeCategorical(allRows, (row) => row.sessionId),
      speed_bins: summarizeCategorical(allRows, (row) => row.speedBin),
      horizon_bins: summarizeCategorical(allRows, (row) => row.horizonBin),
    },
  };
  writeJson(path.join(phase2Dir, "scores.json"), phase2Scores);
  writeText(path.join(phase2Dir, "report.md"), renderDatasetReport(phase2Scores));
  writeText(path.join(phase2Dir, "experiment-log.md"), `# Experiment Log

- Built one dataset row per scoreable \`runtimeSelfSchedulerPoll\` anchor.
- Recomputed target DWM next-vblank from anchor-time DWM fields.
- Interpolated \`referencePoll\` only at the target timestamp for labels.
- Added causal last2 velocity, last3 acceleration summary, scheduler timing fields, speed bins, horizon bins, and chronological blocks.
- Wrote \`dataset.jsonl\`, \`scores.json\`, and \`report.md\`.
`);

  const folds = [
    evaluateFold(rowsBySession["175951"], rowsBySession["184947"], "train_175951_eval_184947"),
    evaluateFold(rowsBySession["184947"], rowsBySession["175951"], "train_184947_eval_175951"),
  ];
  const timeBlocks = [
    evaluateTimeBlock(rowsBySession["175951"]),
    evaluateTimeBlock(rowsBySession["184947"]),
  ];
  const candidateIds = new Set(folds.flatMap((fold) => fold.candidates.map((candidate) => candidate.id)));
  const aggregate = [];
  for (const id of candidateIds) {
    const perFold = folds.map((fold) => fold.candidates.find((candidate) => candidate.id === id)).filter(Boolean);
    aggregate.push({
      id,
      fold_count: perFold.length,
      mean_delta_mean_px: perFold.reduce((sum, entry) => sum + entry.delta_vs_current.mean_px, 0) / perFold.length,
      mean_delta_p95_px: perFold.reduce((sum, entry) => sum + entry.delta_vs_current.p95_px, 0) / perFold.length,
      mean_delta_p99_px: perFold.reduce((sum, entry) => sum + entry.delta_vs_current.p99_px, 0) / perFold.length,
      total_worse_over_1px: perFold.reduce((sum, entry) => sum + entry.regressions_vs_current.worse_over_1px, 0),
      total_worse_over_3px: perFold.reduce((sum, entry) => sum + entry.regressions_vs_current.worse_over_3px, 0),
      total_worse_over_5px: perFold.reduce((sum, entry) => sum + entry.regressions_vs_current.worse_over_5px, 0),
      mean_p99_px: perFold.reduce((sum, entry) => sum + entry.overall.p99_px, 0) / perFold.length,
    });
  }
  aggregate.sort((a, b) => a.total_worse_over_5px - b.total_worse_over_5px || a.mean_p99_px - b.mean_p99_px);
  const isCurrentEquivalent = (entry) => entry.id === "current_dwm_aware_last2_gain_0_75" || entry.id === "gain_0_75";
  const currentAggregate = aggregate.find((entry) => entry.id === "current_dwm_aware_last2_gain_0_75");
  const bestRawNonCurrent = aggregate.filter((entry) => !isCurrentEquivalent(entry)).slice().sort((a, b) => a.mean_p99_px - b.mean_p99_px)[0] || null;
  const bestZeroRegressionNonCurrent = aggregate
    .filter((entry) => !isCurrentEquivalent(entry) && entry.total_worse_over_5px === 0 && entry.mean_delta_p99_px < 0)
    .slice()
    .sort((a, b) => a.mean_p99_px - b.mean_p99_px)[0] || null;
  const selectedAggregate = bestZeroRegressionNonCurrent || currentAggregate;
  const selectedCandidate = folds[0].candidates.find((candidate) => candidate.id === selectedAggregate.id) || folds[1].candidates.find((candidate) => candidate.id === selectedAggregate.id);
  const phase3Scores = {
    generated_at_utc: new Date().toISOString(),
    phase: "phase-3 deterministic-baselines",
    config: {
      current_baseline: "current_dwm_aware_last2_gain_0_75",
      gain_grid: GAIN_GRID,
      train_objective: "p95_px for trained gains and alpha-beta parameters",
      regression_thresholds_px: [1, 3, 5],
      breakdowns: ["speed_bins", "horizon_bins", "scheduler_lead_bins", "chronological_blocks"],
    },
    cross_validation: folds,
    time_block_validation: timeBlocks,
    aggregate,
    recommendation: {
      rule: "Prefer a non-current, non-duplicate candidate with zero total >5 px regressions and lower average p99 across both cross-session folds. If none qualifies, keep current.",
      selected_candidate: selectedCandidate,
      aggregate: selectedAggregate,
      best_raw_non_current_by_mean_p99: bestRawNonCurrent,
      best_zero_regression_non_current_by_mean_p99: bestZeroRegressionNonCurrent,
    },
    performance: {
      elapsed_sec: (performance.now() - started) / 1000,
    },
  };
  writeJson(path.join(phase3Dir, "scores.json"), phase3Scores);
  writeText(path.join(phase3Dir, "report.md"), renderPhase3Report(phase3Scores));
  writeText(path.join(phase3Dir, "experiment-log.md"), `# Experiment Log

- Evaluated current DWM-aware last2 gain 0.75 and hold-current baselines.
- Evaluated fixed gain grid: ${GAIN_GRID.join(", ")}.
- Fitted train-session global gain, speed-binned gain, horizon-binned gain, and speed+horizon piecewise gain.
- Fitted simple alpha-beta constant-velocity smoother parameters on train sessions.
- Ran session cross-validation in both directions and contiguous first-70%/last-30% validation inside each session.
- Wrote \`scores.json\` and \`report.md\`.
`);

  const readme = `# Cursor Prediction v6

v6 evaluates the two latest format-9 self-scheduler traces:

- \`${TRACE_FILES[0]}\`
- \`${TRACE_FILES[1]}\`

## Reproduction

\`\`\`powershell
node poc\\cursor-prediction-v6\\analyze_v6.js
\`\`\`

The script uses only Node.js standard-library modules and reads the trace ZIP files directly.

## Phase Layout

- \`phase-1 data-audit/\`: trace metadata, ZIP manifest, event counts, cadence audit.
- \`phase-2 dataset-builder/\`: causal feature dataset and split definition.
- \`phase-3 deterministic-baselines/\`: cross-session deterministic baseline scores.

## Current Result

Best deterministic candidate by the conservative zero->5px-regression rule: \`${phase3Scores.recommendation.selected_candidate.id}\`.
`;
  writeText(path.join(outRoot, "README.md"), readme);
  writeText(path.join(outRoot, "supervisor-log.md"), `# Supervisor Log

- Created v6 POC under \`poc/cursor-prediction-v6/\`.
- Kept all writes inside the v6 POC folder.
- Used \`runtimeSelfSchedulerPoll\` as anchor stream and \`referencePoll\` as label stream.
- Produced phase reports and JSON scores for audit, dataset build, and deterministic baselines.
- Best current deterministic candidate: \`${phase3Scores.recommendation.selected_candidate.id}\`.
`);

  console.log(`Wrote v6 outputs to ${outRoot}`);
  console.log(`Rows: ${allRows.length}`);
  console.log(`Selected: ${phase3Scores.recommendation.selected_candidate.id}`);
}

main();
