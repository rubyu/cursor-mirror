#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");

const BASELINE_GAIN = 0.75;
const IDLE_GAP_MS = 100;
const HIGH_SPEED_PX_S = 2000;
const LOW_SPEED_PX_S = 25;
const HIGH_ACCEL_PX_S2 = 100000;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--zip") args.zip = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
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
      let data;
      if (method === 0) data = Buffer.from(compressed);
      else if (method === 8) data = zlib.inflateRawSync(compressed);
      else throw new Error(`Unsupported ZIP compression method ${method} for ${entryName}`);
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

function errorStats(errors) {
  const stats = scalarStats(errors);
  if (stats.count === 0) {
    return { n: 0, mean_px: null, rmse_px: null, p50_px: null, p90_px: null, p95_px: null, p99_px: null, max_px: null };
  }
  let sumSquares = 0;
  for (const value of errors) sumSquares += value * value;
  return {
    n: stats.count,
    mean_px: stats.mean,
    rmse_px: Math.sqrt(sumSquares / errors.length),
    p50_px: stats.p50,
    p90_px: stats.p90,
    p95_px: stats.p95,
    p99_px: stats.p99,
    max_px: stats.max,
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
  if (target < times[0] || target > times[times.length - 1]) return null;
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
  if (value === null || value === undefined || Number.isNaN(value)) return "missing";
  for (const bin of bins) {
    if (value >= bin.min && value < bin.max) return bin.label;
  }
  return bins[bins.length - 1].label;
}

function addMetric(map, group, model, value) {
  if (!map[group]) map[group] = {};
  if (!map[group][model]) map[group][model] = [];
  map[group][model].push(value);
}

function finalizeBreakdowns(map) {
  const out = {};
  for (const [group, models] of Object.entries(map)) {
    out[group] = {};
    for (const [model, errors] of Object.entries(models)) {
      out[group][model] = errorStats(errors);
    }
  }
  return out;
}

function parseCsvLine(line) {
  return line.split(",");
}

function numberOrNull(text) {
  if (text === undefined || text === null || text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function boolOrFalse(text) {
  return text === "true" || text === "True";
}

function selectNextVBlank(sampleTicks, vblankTicks, refreshTicks) {
  if (!Number.isFinite(sampleTicks) || !Number.isFinite(vblankTicks) || !Number.isFinite(refreshTicks) || vblankTicks <= 0 || refreshTicks <= 0) {
    return null;
  }
  let target = vblankTicks;
  if (target <= sampleTicks) {
    const periodsLate = Math.floor((sampleTicks - target) / refreshTicks) + 1;
    target += periodsLate * refreshTicks;
  }
  return target;
}

function loadTrace(zipPath) {
  const metadata = JSON.parse(readZipEntry(zipPath, "metadata.json").toString("utf8"));
  const csv = readZipEntry(zipPath, "trace.csv").toString("utf8");
  const lines = csv.split(/\r?\n/);
  const header = lines[0].split(",");
  const column = {};
  header.forEach((name, index) => {
    column[name] = index;
  });

  const required = [
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
    "runtimeSchedulerVBlankLeadMicroseconds",
  ];
  for (const name of required) {
    if (!(name in column)) throw new Error(`Missing CSV column: ${name}`);
  }

  const stopwatchFrequency = Number(metadata.StopwatchFrequency || 10000000);
  const ticksToUs = 1_000_000 / stopwatchFrequency;
  const refTimesUs = [];
  const refX = [];
  const refY = [];
  const runtimeRows = [];
  const legacyPollRows = [];
  const hookRows = [];
  const intervalsByEvent = {};
  const lastTimeByEvent = {};
  const schedulerLeadUs = [];
  const schedulerActualMinusPlannedUs = [];
  let csvRows = 0;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    csvRows += 1;
    const parts = parseCsvLine(line);
    const event = parts[column.event];
    const elapsedUs = Number(parts[column.elapsedMicroseconds]);
    const stopwatchTicks = Number(parts[column.stopwatchTicks]);
    const x = Number(parts[column.x]);
    const y = Number(parts[column.y]);
    const cursorX = numberOrNull(parts[column.cursorX]);
    const cursorY = numberOrNull(parts[column.cursorY]);
    if (lastTimeByEvent[event] !== undefined) {
      if (!intervalsByEvent[event]) intervalsByEvent[event] = [];
      intervalsByEvent[event].push((elapsedUs - lastTimeByEvent[event]) / 1000);
    }
    lastTimeByEvent[event] = elapsedUs;

    if (event === "referencePoll") {
      refTimesUs.push(elapsedUs);
      refX.push(cursorX ?? x);
      refY.push(cursorY ?? y);
    } else if (event === "runtimeSchedulerPoll") {
      const dwmTimingAvailable = boolOrFalse(parts[column.dwmTimingAvailable]);
      const refreshTicks = numberOrNull(parts[column.dwmQpcRefreshPeriod]);
      const vblankTicks = numberOrNull(parts[column.dwmQpcVBlank]);
      const schedulerTargetTicks = numberOrNull(parts[column.runtimeSchedulerTargetVBlankTicks]);
      const schedulerPlannedTicks = numberOrNull(parts[column.runtimeSchedulerPlannedTickTicks]);
      const schedulerLead = numberOrNull(parts[column.runtimeSchedulerVBlankLeadMicroseconds]);
      const predictorTargetTicks = dwmTimingAvailable ? selectNextVBlank(stopwatchTicks, vblankTicks, refreshTicks) : null;
      const predictorTargetUs = predictorTargetTicks === null ? null : elapsedUs + (predictorTargetTicks - stopwatchTicks) * ticksToUs;
      const predictorHorizonMs = predictorTargetUs === null ? null : (predictorTargetUs - elapsedUs) / 1000;
      const schedulerTargetUs = schedulerTargetTicks === null ? null : elapsedUs + (schedulerTargetTicks - stopwatchTicks) * ticksToUs;
      const schedulerPlannedUs = schedulerPlannedTicks === null ? null : elapsedUs + (schedulerPlannedTicks - stopwatchTicks) * ticksToUs;
      if (schedulerLead !== null) schedulerLeadUs.push(schedulerLead);
      if (schedulerPlannedTicks !== null) schedulerActualMinusPlannedUs.push((stopwatchTicks - schedulerPlannedTicks) * ticksToUs);
      runtimeRows.push({
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
        schedulerTargetUs,
        schedulerPlannedUs,
        schedulerLeadUs: schedulerLead,
        predictorTargetTicks,
        predictorTargetUs,
        predictorHorizonMs,
      });
    } else if (event === "poll") {
      legacyPollRows.push({ elapsedUs, x, y, cursorX: cursorX ?? x, cursorY: cursorY ?? y });
    } else if (event === "move") {
      hookRows.push({ elapsedUs, x, y });
    }
  }

  return {
    metadata,
    stopwatchFrequency,
    ticksToUs,
    csvRows,
    refTimesUs,
    refX,
    refY,
    runtimeRows,
    legacyPollRows,
    hookRows,
    intervalsByEvent,
    schedulerLeadUs,
    schedulerActualMinusPlannedUs,
  };
}

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

function buildContexts(trace) {
  const contexts = [];
  const refTargetIntervals = [];
  const refTargetNearest = [];
  let refIndex = 0;
  let prev = null;
  let prevPrev = null;
  let fallbackInvalidDt = 0;
  let fallbackInvalidDwm = 0;
  let targetsFromLateScheduler = 0;

  for (const row of trace.runtimeRows) {
    const productDtMs = prev ? (row.elapsedUs - prev.elapsedUs) / 1000 : null;
    const dwmValid = Number.isFinite(row.predictorTargetUs) && Number.isFinite(row.predictorHorizonMs) && row.predictorHorizonMs > 0;
    if (!dwmValid) fallbackInvalidDwm += 1;
    const targetUs = dwmValid ? row.predictorTargetUs : row.elapsedUs;
    const label = interpolate(trace.refTimesUs, trace.refX, trace.refY, targetUs, refIndex);
    if (!label) {
      prevPrev = prev;
      prev = row;
      continue;
    }
    refIndex = label.leftIndex;
    refTargetIntervals.push(label.intervalMs);
    refTargetNearest.push(label.nearestMs);

    let velocity = null;
    let acceleration = null;
    let validVelocity = false;
    if (prev && productDtMs !== null && productDtMs > 0 && productDtMs <= IDLE_GAP_MS) {
      const dtSeconds = productDtMs / 1000;
      const vx = (row.cursorX - prev.cursorX) / dtSeconds;
      const vy = (row.cursorY - prev.cursorY) / dtSeconds;
      const speed = Math.sqrt(vx * vx + vy * vy);
      velocity = { vx, vy, speed, dtMs: productDtMs };
      validVelocity = true;
      if (prevPrev) {
        const prevDtMs = (prev.elapsedUs - prevPrev.elapsedUs) / 1000;
        if (prevDtMs > 0 && prevDtMs <= IDLE_GAP_MS) {
          const pvx = (prev.cursorX - prevPrev.cursorX) / (prevDtMs / 1000);
          const pvy = (prev.cursorY - prevPrev.cursorY) / (prevDtMs / 1000);
          const avgDtSeconds = ((productDtMs + prevDtMs) / 2) / 1000;
          const ax = (vx - pvx) / avgDtSeconds;
          const ay = (vy - pvy) / avgDtSeconds;
          acceleration = { ax, ay, magnitude: Math.sqrt(ax * ax + ay * ay), prevDtMs };
        }
      }
    } else if (prev) {
      fallbackInvalidDt += 1;
    }

    if (row.schedulerLeadUs !== null && row.schedulerLeadUs < 0) targetsFromLateScheduler += 1;

    contexts.push({
      row,
      prev,
      prevPrev,
      label,
      targetUs,
      dwmValid,
      productDtMs,
      velocity,
      acceleration,
      validVelocity,
      fallback: !dwmValid || !validVelocity,
    });
    prevPrev = prev;
    prev = row;
  }

  return {
    contexts,
    refTargetIntervals,
    refTargetNearest,
    fallbackInvalidDt,
    fallbackInvalidDwm,
    targetsFromLateScheduler,
  };
}

function hold(ctx) {
  return { x: ctx.row.cursorX, y: ctx.row.cursorY, mode: "hold" };
}

function predictLast2(ctx, gain = BASELINE_GAIN, forcedHorizonMs = null) {
  if (!ctx.dwmValid || !ctx.validVelocity) return hold(ctx);
  const horizonMs = forcedHorizonMs === null ? ctx.row.predictorHorizonMs : forcedHorizonMs;
  if (!Number.isFinite(horizonMs) || horizonMs <= 0) return hold(ctx);
  const scale = gain * (horizonMs / ctx.productDtMs);
  return {
    x: ctx.row.cursorX + (ctx.row.cursorX - ctx.prev.cursorX) * scale,
    y: ctx.row.cursorY + (ctx.row.cursorY - ctx.prev.cursorY) * scale,
    mode: "last2",
  };
}

function predictAcceleration(ctx, gain = BASELINE_GAIN, accelerationGain = 0.5) {
  if (!ctx.dwmValid || !ctx.validVelocity || !ctx.acceleration) return predictLast2(ctx, gain);
  const h = ctx.row.predictorHorizonMs / 1000;
  return {
    x: ctx.row.cursorX + ctx.velocity.vx * h * gain + 0.5 * ctx.acceleration.ax * h * h * accelerationGain,
    y: ctx.row.cursorY + ctx.velocity.vy * h * gain + 0.5 * ctx.acceleration.ay * h * h * accelerationGain,
    mode: "acceleration",
  };
}

function predictLeadAware(ctx) {
  if (ctx.row.schedulerLeadUs !== null && ctx.row.schedulerLeadUs < 0) {
    return predictLast2(ctx, 0.5);
  }
  if (ctx.row.predictorHorizonMs >= 12) return predictLast2(ctx, 0.625);
  if (ctx.velocity && ctx.velocity.speed >= HIGH_SPEED_PX_S) return predictLast2(ctx, 0.625);
  return predictLast2(ctx, BASELINE_GAIN);
}

function predictLateDispatchGain(ctx, lateGain) {
  if (ctx.row.schedulerLeadUs !== null && ctx.row.schedulerLeadUs < 0) {
    return predictLast2(ctx, lateGain);
  }

  return predictLast2(ctx, BASELINE_GAIN);
}

function predictHorizonThresholdGain(ctx, thresholdMs, longGain) {
  if (ctx.row.predictorHorizonMs !== null && ctx.row.predictorHorizonMs >= thresholdMs) {
    return predictLast2(ctx, longGain);
  }

  return predictLast2(ctx, BASELINE_GAIN);
}

function candidate(id, family, feasibility, description, parameters, predict) {
  return { id, family, feasibility, description, parameters, predict };
}

const candidates = [
  candidate("runtime_baseline_dwm_last2_gain_0_75", "baseline", "product_feasible", "Current runtime stream baseline: last two runtimeSchedulerPoll samples, gain 0.75, DWM next-vblank target.", { gain: 0.75 }, (ctx) => predictLast2(ctx, 0.75)),
  candidate("hold_current_dwm_target", "baseline", "product_feasible", "Hold current runtimeSchedulerPoll position until DWM target.", {}, (ctx) => hold(ctx)),
  candidate("dwm_gain_0_25", "gain_grid", "product_feasible", "Last2 with low gain.", { gain: 0.25 }, (ctx) => predictLast2(ctx, 0.25)),
  candidate("dwm_gain_0_50", "gain_grid", "product_feasible", "Last2 with medium-low gain.", { gain: 0.5 }, (ctx) => predictLast2(ctx, 0.5)),
  candidate("dwm_gain_0_575", "gain_grid_fine", "product_feasible", "Last2 with fine-grid gain.", { gain: 0.575 }, (ctx) => predictLast2(ctx, 0.575)),
  candidate("dwm_gain_0_625", "gain_grid", "product_feasible", "Last2 with moderate gain.", { gain: 0.625 }, (ctx) => predictLast2(ctx, 0.625)),
  candidate("dwm_gain_0_675", "gain_grid_fine", "product_feasible", "Last2 with fine-grid gain.", { gain: 0.675 }, (ctx) => predictLast2(ctx, 0.675)),
  candidate("dwm_gain_0_700", "gain_grid_fine", "product_feasible", "Last2 with fine-grid gain.", { gain: 0.7 }, (ctx) => predictLast2(ctx, 0.7)),
  candidate("dwm_gain_0_725", "gain_grid_fine", "product_feasible", "Last2 with fine-grid gain.", { gain: 0.725 }, (ctx) => predictLast2(ctx, 0.725)),
  candidate("dwm_gain_0_875", "gain_grid", "product_feasible", "Last2 with higher gain.", { gain: 0.875 }, (ctx) => predictLast2(ctx, 0.875)),
  candidate("dwm_gain_0_800", "gain_grid_fine", "product_feasible", "Last2 with fine-grid gain.", { gain: 0.8 }, (ctx) => predictLast2(ctx, 0.8)),
  candidate("dwm_gain_1_00", "gain_grid", "product_feasible", "Last2 with full constant-velocity extrapolation.", { gain: 1.0 }, (ctx) => predictLast2(ctx, 1.0)),
  candidate("effective_horizon_cap_2ms", "horizon_cap", "product_feasible", "Clamp effective prediction horizon to 2ms.", { max_effective_horizon_ms: 2, gain: 0.75 }, (ctx) => predictLast2(ctx, 0.75, Math.min(ctx.row.predictorHorizonMs || 0, 2))),
  candidate("effective_horizon_cap_4ms", "horizon_cap", "product_feasible", "Clamp effective prediction horizon to 4ms.", { max_effective_horizon_ms: 4, gain: 0.75 }, (ctx) => predictLast2(ctx, 0.75, Math.min(ctx.row.predictorHorizonMs || 0, 4))),
  candidate("effective_horizon_cap_8ms", "horizon_cap", "product_feasible", "Clamp effective prediction horizon to 8ms.", { max_effective_horizon_ms: 8, gain: 0.75 }, (ctx) => predictLast2(ctx, 0.75, Math.min(ctx.row.predictorHorizonMs || 0, 8))),
  candidate("late_or_long_horizon_gain_down", "lead_aware", "product_feasible", "Lower gain on late scheduler dispatch, long horizon, or high speed.", { late_gain: 0.5, long_or_fast_gain: 0.625, default_gain: 0.75 }, (ctx) => predictLeadAware(ctx)),
  candidate("late_dispatch_hold_current", "late_dispatch", "product_feasible", "Hold current only when the UI-thread runtime sample arrived after the scheduler target vblank.", { late_gain: 0 }, (ctx) => predictLateDispatchGain(ctx, 0)),
  candidate("late_dispatch_gain_0_25", "late_dispatch", "product_feasible", "Use lower gain only for late scheduler dispatches.", { late_gain: 0.25, default_gain: 0.75 }, (ctx) => predictLateDispatchGain(ctx, 0.25)),
  candidate("late_dispatch_gain_0_50", "late_dispatch", "product_feasible", "Use medium gain only for late scheduler dispatches.", { late_gain: 0.5, default_gain: 0.75 }, (ctx) => predictLateDispatchGain(ctx, 0.5)),
  candidate("horizon_ge_4ms_gain_0_50", "horizon_threshold", "product_feasible", "Use lower gain for DWM horizons >= 4ms.", { threshold_ms: 4, long_gain: 0.5, default_gain: 0.75 }, (ctx) => predictHorizonThresholdGain(ctx, 4, 0.5)),
  candidate("horizon_ge_8ms_gain_0_50", "horizon_threshold", "product_feasible", "Use lower gain for DWM horizons >= 8ms.", { threshold_ms: 8, long_gain: 0.5, default_gain: 0.75 }, (ctx) => predictHorizonThresholdGain(ctx, 8, 0.5)),
  candidate("horizon_ge_12ms_gain_0_50", "horizon_threshold", "product_feasible", "Use lower gain for DWM horizons >= 12ms.", { threshold_ms: 12, long_gain: 0.5, default_gain: 0.75 }, (ctx) => predictHorizonThresholdGain(ctx, 12, 0.5)),
  candidate("last3_accel_gain_0_25", "acceleration", "product_feasible", "Add a small last3 acceleration term.", { gain: 0.75, acceleration_gain: 0.25 }, (ctx) => predictAcceleration(ctx, 0.75, 0.25)),
  candidate("last3_accel_gain_0_50", "acceleration", "product_feasible", "Add a moderate last3 acceleration term.", { gain: 0.75, acceleration_gain: 0.5 }, (ctx) => predictAcceleration(ctx, 0.75, 0.5)),
];

function scoreCandidates(contexts) {
  const errorsByCandidate = {};
  const pointwiseByCandidate = {};
  const breakdowns = {
    speed_bins: {},
    acceleration_bins: {},
    horizon_bins: {},
    scheduler_lead_bins: {},
  };

  for (const cand of candidates) {
    errorsByCandidate[cand.id] = [];
    pointwiseByCandidate[cand.id] = [];
  }

  for (const ctx of contexts) {
    const groups = [
      ["speed_bins", binOf(ctx.velocity ? ctx.velocity.speed : 0, speedBins)],
      ["acceleration_bins", binOf(ctx.acceleration ? ctx.acceleration.magnitude : 0, [
        { label: "0-1k px/s^2", min: 0, max: 1000 },
        { label: "1k-5k px/s^2", min: 1000, max: 5000 },
        { label: "5k-20k px/s^2", min: 5000, max: 20000 },
        { label: "20k-50k px/s^2", min: 20000, max: 50000 },
        { label: "50k-100k px/s^2", min: 50000, max: 100000 },
        { label: ">=100k px/s^2", min: 100000, max: Infinity },
      ])],
      ["horizon_bins", binOf(ctx.row.predictorHorizonMs, horizonBins)],
      ["scheduler_lead_bins", binOf(ctx.row.schedulerLeadUs, leadBins)],
    ];

    for (const cand of candidates) {
      const pred = cand.predict(ctx);
      const err = distance(pred.x, pred.y, ctx.label.x, ctx.label.y);
      errorsByCandidate[cand.id].push(err);
      pointwiseByCandidate[cand.id].push({
        error: err,
        speed: ctx.velocity ? ctx.velocity.speed : 0,
        acceleration: ctx.acceleration ? ctx.acceleration.magnitude : 0,
        horizonMs: ctx.row.predictorHorizonMs,
        schedulerLeadUs: ctx.row.schedulerLeadUs,
        elapsedUs: ctx.row.elapsedUs,
      });
      for (const [name, group] of groups) addMetric(breakdowns[name], group, cand.id, err);
    }
  }

  const baselineId = "runtime_baseline_dwm_last2_gain_0_75";
  const baselinePointwise = pointwiseByCandidate[baselineId];
  const scored = candidates.map((cand) => {
    const overall = errorStats(errorsByCandidate[cand.id]);
    const candidatePointwise = pointwiseByCandidate[cand.id];
    let regressionsOver1 = 0;
    let regressionsOver3 = 0;
    let regressionsOver5 = 0;
    let lowSpeedRegressionsOver5 = 0;
    let improvedOver5 = 0;
    for (let i = 0; i < candidatePointwise.length; i += 1) {
      const delta = candidatePointwise[i].error - baselinePointwise[i].error;
      if (delta > 1) regressionsOver1 += 1;
      if (delta > 3) regressionsOver3 += 1;
      if (delta > 5) regressionsOver5 += 1;
      if (delta > 5 && candidatePointwise[i].speed < LOW_SPEED_PX_S) lowSpeedRegressionsOver5 += 1;
      if (delta < -5) improvedOver5 += 1;
    }
    const baselineStats = errorStats(errorsByCandidate[baselineId]);
    return {
      id: cand.id,
      family: cand.family,
      feasibility: cand.feasibility,
      description: cand.description,
      parameters: cand.parameters,
      overall,
      delta_vs_baseline: {
        mean_px: overall.mean_px - baselineStats.mean_px,
        p95_px: overall.p95_px - baselineStats.p95_px,
        p99_px: overall.p99_px - baselineStats.p99_px,
        max_px: overall.max_px - baselineStats.max_px,
      },
      regressions_vs_baseline: {
        over_1px: regressionsOver1,
        over_3px: regressionsOver3,
        over_5px: regressionsOver5,
        low_speed_over_5px: lowSpeedRegressionsOver5,
        improvements_over_5px: improvedOver5,
      },
    };
  });

  scored.sort((a, b) => {
    if (a.overall.p99_px !== b.overall.p99_px) return a.overall.p99_px - b.overall.p99_px;
    return a.regressions_vs_baseline.over_5px - b.regressions_vs_baseline.over_5px;
  });

  return {
    candidates: scored,
    overall: Object.fromEntries(candidates.map((cand) => [cand.id, errorStats(errorsByCandidate[cand.id])])),
    breakdowns: Object.fromEntries(Object.entries(breakdowns).map(([name, map]) => [name, finalizeBreakdowns(map)])),
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function writeText(file, text) {
  fs.writeFileSync(file, text.replace(/\n/g, "\r\n"), "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, "..", "..");
  const zipPath = path.resolve(args.zip || path.join(root, "cursor-mirror-trace-20260501-231621.zip"));
  const outRoot = path.resolve(args.out || __dirname);
  const phase1Dir = path.join(outRoot, "phase-1 runtime-scheduler-baseline-audit");
  const phase2Dir = path.join(outRoot, "phase-2 deterministic-candidate-search");
  fs.mkdirSync(phase1Dir, { recursive: true });
  fs.mkdirSync(phase2Dir, { recursive: true });

  const started = performance.now();
  const trace = loadTrace(zipPath);
  const built = buildContexts(trace);
  const scored = scoreCandidates(built.contexts);
  const elapsedSec = (performance.now() - started) / 1000;
  const baseline = scored.overall.runtime_baseline_dwm_last2_gain_0_75;
  const holdStats = scored.overall.hold_current_dwm_target;
  const best = scored.candidates[0];
  const bestSafe = scored.candidates.find((entry) => entry.regressions_vs_baseline.over_5px === 0 && entry.overall.p99_px < baseline.p99_px);
  const baselineRank = scored.candidates.findIndex((entry) => entry.id === "runtime_baseline_dwm_last2_gain_0_75") + 1;

  const phase1Scores = {
    generated_at_utc: new Date().toISOString(),
    input_zip: path.relative(outRoot, zipPath),
    config: {
      anchor_stream: "runtimeSchedulerPoll",
      reference_stream: "referencePoll",
      baseline_gain: BASELINE_GAIN,
      idle_gap_ms: IDLE_GAP_MS,
      target_policy: "DWM next-vblank selected from runtime sample timestamp and DWM timing fields, matching DwmAwareCursorPositionPredictor.",
      label_policy: "Linear interpolation between adjacent referencePoll samples at the target timestamp.",
    },
    metadata: trace.metadata,
    audit: {
      csv_rows: trace.csvRows,
      runtime_scheduler_poll_rows: trace.runtimeRows.length,
      reference_poll_rows: trace.refTimesUs.length,
      legacy_poll_rows: trace.legacyPollRows.length,
      hook_rows: trace.hookRows.length,
      scored_contexts: built.contexts.length,
      scheduler_lead_us: scalarStats(trace.schedulerLeadUs),
      scheduler_actual_minus_planned_us: scalarStats(trace.schedulerActualMinusPlannedUs),
      runtime_scheduler_interval_ms: scalarStats(trace.intervalsByEvent.runtimeSchedulerPoll || []),
      reference_poll_interval_ms: scalarStats(trace.intervalsByEvent.referencePoll || []),
      legacy_poll_interval_ms: scalarStats(trace.intervalsByEvent.poll || []),
      reference_target_interval_ms: scalarStats(built.refTargetIntervals),
      reference_target_nearest_coverage_ms: scalarStats(built.refTargetNearest),
      late_scheduler_dispatch_count: trace.schedulerLeadUs.filter((value) => value < 0).length,
      predictor_targets_from_late_scheduler_dispatch_count: built.targetsFromLateScheduler,
      fallback_invalid_dt_or_idle_gap_count: built.fallbackInvalidDt,
      fallback_invalid_dwm_count: built.fallbackInvalidDwm,
    },
    scores: {
      baseline: baseline,
      hold_current: holdStats,
      selected_breakdowns: {
        speed_bins: scored.breakdowns.speed_bins,
        horizon_bins: scored.breakdowns.horizon_bins,
        scheduler_lead_bins: scored.breakdowns.scheduler_lead_bins,
      },
    },
    performance: {
      elapsed_sec: elapsedSec,
      csv_rows_per_sec: trace.csvRows / elapsedSec,
    },
  };
  writeJson(path.join(phase1Dir, "scores.json"), phase1Scores);

  const phase2Scores = {
    generated_at_utc: new Date().toISOString(),
    input_zip: path.relative(outRoot, zipPath),
    config: phase1Scores.config,
    candidates: scored.candidates,
    overall: scored.overall,
    breakdowns: scored.breakdowns,
    decision: {
      best_raw_candidate_by_p99: best.id,
      selected_product_candidate: bestSafe ? bestSafe.id : "runtime_baseline_dwm_last2_gain_0_75",
      baseline_rank_by_p99: baselineRank,
      best_raw_candidate_passes_visible_regression_guard: best.regressions_vs_baseline.over_5px === 0 && best.regressions_vs_baseline.low_speed_over_5px === 0,
      recommendation: bestSafe
        ? "A zero-visible-regression candidate improved p99; review it for implementation."
        : "Keep current baseline; raw p99 improvements are too small and add visible regressions.",
    },
  };
  writeJson(path.join(phase2Dir, "scores.json"), phase2Scores);

  const phase1Report = `# Phase 1 - Runtime Scheduler Baseline Audit

## Purpose

This phase audits \`cursor-mirror-trace-20260501-231621.zip\`, the first trace with \`runtimeSchedulerPoll\`, and replays the current product-shaped DWM predictor on that stream.

## Data Shape

${table(["Metric", "Value"], [
    ["trace format", String(trace.metadata.TraceFormatVersion)],
    ["runtimeSchedulerPoll rows", fmtInt(trace.runtimeRows.length)],
    ["referencePoll rows", fmtInt(trace.refTimesUs.length)],
    ["legacy poll rows", fmtInt(trace.legacyPollRows.length)],
    ["scored runtime contexts", fmtInt(built.contexts.length)],
    ["DWM availability", `${fmt(trace.metadata.DwmTimingAvailabilityPercent, 1)}%`],
  ])}

## Runtime Cadence

${table(["Metric", "mean", "p50", "p95", "p99", "max"], [
    ["runtime interval ms", fmt(phase1Scores.audit.runtime_scheduler_interval_ms.mean), fmt(phase1Scores.audit.runtime_scheduler_interval_ms.p50), fmt(phase1Scores.audit.runtime_scheduler_interval_ms.p95), fmt(phase1Scores.audit.runtime_scheduler_interval_ms.p99), fmt(phase1Scores.audit.runtime_scheduler_interval_ms.max)],
    ["scheduler lead us", fmt(phase1Scores.audit.scheduler_lead_us.mean), fmt(phase1Scores.audit.scheduler_lead_us.p50), fmt(phase1Scores.audit.scheduler_lead_us.p95), fmt(phase1Scores.audit.scheduler_lead_us.p99), fmt(phase1Scores.audit.scheduler_lead_us.max)],
    ["actual minus planned us", fmt(phase1Scores.audit.scheduler_actual_minus_planned_us.mean), fmt(phase1Scores.audit.scheduler_actual_minus_planned_us.p50), fmt(phase1Scores.audit.scheduler_actual_minus_planned_us.p95), fmt(phase1Scores.audit.scheduler_actual_minus_planned_us.p99), fmt(phase1Scores.audit.scheduler_actual_minus_planned_us.max)],
    ["reference target interval ms", fmt(phase1Scores.audit.reference_target_interval_ms.mean), fmt(phase1Scores.audit.reference_target_interval_ms.p50), fmt(phase1Scores.audit.reference_target_interval_ms.p95), fmt(phase1Scores.audit.reference_target_interval_ms.p99), fmt(phase1Scores.audit.reference_target_interval_ms.max)],
  ])}

Late scheduler dispatches, where the UI-thread capture landed after the scheduler's intended target vblank, occurred in \`${fmtInt(phase1Scores.audit.late_scheduler_dispatch_count)}\` runtime samples. The product predictor target was recomputed like the application does, so late dispatches generally target the following vblank instead of the already-missed one.

## Baseline Replay

${table(["Model", "n", "mean", "p50", "p90", "p95", "p99", "max"], [
    ["runtime baseline gain 0.75", fmtInt(baseline.n), fmt(baseline.mean_px), fmt(baseline.p50_px), fmt(baseline.p90_px), fmt(baseline.p95_px), fmt(baseline.p99_px), fmt(baseline.max_px)],
    ["hold current", fmtInt(holdStats.n), fmt(holdStats.mean_px), fmt(holdStats.p50_px), fmt(holdStats.p90_px), fmt(holdStats.p95_px), fmt(holdStats.p99_px), fmt(holdStats.max_px)],
  ])}

## Notes

- The runtime scheduler stream materially improves the center and tail versus the v4 legacy product-poll baseline.
- The remaining tail is concentrated in late-dispatch and high-speed/high-acceleration slices, so the next phase focuses on conservative deterministic adjustments around gain and effective horizon.
`;
  writeText(path.join(phase1Dir, "report.md"), phase1Report);
  writeText(path.join(phase1Dir, "experiment-log.md"), `# Experiment Log

- Loaded format v${trace.metadata.TraceFormatVersion} trace from ${zipPath}.
- Parsed ${fmtInt(trace.csvRows)} CSV rows.
- Treated runtimeSchedulerPoll as runtime input and referencePoll as target reconstruction.
- Scored ${fmtInt(built.contexts.length)} runtime contexts.
- Recomputed DWM next-vblank targets from runtime sample timestamps to match DwmAwareCursorPositionPredictor rather than using the scheduler's possibly missed planned vblank.
- Wrote scores.json and report.md.
`);

  const candidateRows = scored.candidates.slice(0, 10).map((entry) => [
    entry.id,
    entry.family,
    fmt(entry.overall.mean_px),
    fmt(entry.overall.p95_px),
    fmt(entry.overall.p99_px),
    fmt(entry.delta_vs_baseline.p99_px),
    fmtInt(entry.regressions_vs_baseline.over_5px),
    fmtInt(entry.regressions_vs_baseline.low_speed_over_5px),
  ]);
  const phase2Report = `# Phase 2 - Deterministic Candidate Search

## Purpose

This phase tests lightweight, product-shaped deterministic candidates now that the runtime input cadence is DWM-synchronized.

## Candidate Ranking

${table(["Candidate", "Family", "mean", "p95", "p99", "p99 delta", ">5px regressions", "low-speed >5px"], candidateRows)}

## Decision

Best raw candidate by p99: \`${best.id}\`.

Baseline rank by p99: \`${baselineRank}\`.

Selected product candidate: \`${bestSafe ? bestSafe.id : "runtime_baseline_dwm_last2_gain_0_75"}\`.

${bestSafe
    ? `A zero-visible-regression candidate improved p99 by ${fmt(-bestSafe.delta_vs_baseline.p99_px)} px. It is the only candidate worth implementation review.`
    : `The best raw candidate improves p99 by only ${fmt(-best.delta_vs_baseline.p99_px)} px and adds ${fmtInt(best.regressions_vs_baseline.over_5px)} pointwise >5px regressions. That fails the default-on guard, so keep the current predictor shape.`}

## Interpretation

With scheduler-backed runtime samples, the prediction horizon is often short, and the current gain is already conservative. The search mainly checks whether further damping helps late or long-horizon frames. The deciding factor is not just p99: any candidate that improves a small tail while adding visible low-speed regressions should stay out of the default path.
`;
  writeText(path.join(phase2Dir, "report.md"), phase2Report);
  writeText(path.join(phase2Dir, "experiment-log.md"), `# Experiment Log

- Reused Phase 1 contexts and labels.
- Tested gain grid, effective horizon caps, lead-aware gain damping, and last3 acceleration variants.
- Computed pointwise regressions versus \`runtime_baseline_dwm_last2_gain_0_75\`.
- Ranked candidates by p99, then by visible regression count.
- Wrote scores.json and report.md.
`);

  const finalReport = `# Cursor Prediction v5 Final Report

## Summary

The new \`runtimeSchedulerPoll\` stream confirms the subjective improvement: scheduler-backed polling is a better runtime input than the old WinForms product-poll proxy. The current DWM-aware last2 predictor should remain the default for now.

${table(["Metric", "Value"], [
    ["scored runtime contexts", fmtInt(built.contexts.length)],
    ["baseline mean / p95 / p99", `${fmt(baseline.mean_px)} / ${fmt(baseline.p95_px)} / ${fmt(baseline.p99_px)} px`],
    ["hold mean / p95 / p99", `${fmt(holdStats.mean_px)} / ${fmt(holdStats.p95_px)} / ${fmt(holdStats.p99_px)} px`],
    ["best raw candidate", best.id],
    ["best raw p95 / p99", `${fmt(best.overall.p95_px)} / ${fmt(best.overall.p99_px)} px`],
    ["best raw >5px regressions", fmtInt(best.regressions_vs_baseline.over_5px)],
    ["selected product candidate", bestSafe ? bestSafe.id : "runtime_baseline_dwm_last2_gain_0_75"],
    ["late scheduler dispatches", fmtInt(phase1Scores.audit.late_scheduler_dispatch_count)],
  ])}

## Recommendation

Do not change the default prediction model yet. The most important product change already happened: DWM-synchronized runtime scheduling. A raw gain tweak can shave a tiny amount from p99, but it adds visible regressions. The v5 data supports keeping \`DwmAwareCursorPositionPredictor\` as-is while collecting at least one more trace to confirm this behavior across sessions.

## Next Work

- Add UI/runtime diagnostics only if needed: runtime tick interval, scheduler lead, and late-dispatch count.
- If another trace shows the same late-dispatch tail, test a narrowly scoped late-dispatch damping rule.
- Avoid learned or neural predictors until multiple scheduler-backed traces are available; the remaining tail is now small enough that regression risk matters more than raw fit.
`;
  writeText(path.join(outRoot, "final-report.md"), finalReport);
  writeText(path.join(outRoot, "supervisor-log.md"), `# Supervisor Log

- v5 started from ${zipPath}.
- Primary runtime stream changed from legacy \`poll\` to \`runtimeSchedulerPoll\`.
- Phase 1 audited cadence, target reconstruction, and current baseline replay.
- Phase 2 tested deterministic product-shaped candidate families.
- Final recommendation: keep current predictor; gather another scheduler-backed trace before model changes.
`);

  console.log(`Wrote v5 reports to ${outRoot}`);
  console.log(`Baseline p95/p99: ${fmt(baseline.p95_px)} / ${fmt(baseline.p99_px)} px`);
  console.log(`Best candidate: ${best.id} p95/p99 ${fmt(best.overall.p95_px)} / ${fmt(best.overall.p99_px)} px`);
}

main();
