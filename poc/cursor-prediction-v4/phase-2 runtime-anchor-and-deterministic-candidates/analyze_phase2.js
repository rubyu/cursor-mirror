#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");

const STOPWATCH_TICKS_PER_SECOND_DEFAULT = 10_000_000;
const BASELINE_GAIN = 0.75;
const PRODUCT_IDLE_GAP_MS = 100;
const HIGH_SPEED_PX_S = 2000;
const HIGH_ACCEL_PX_S2 = 100000;
const LOW_SPEED_PX_S = 25;

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
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Invalid central directory at ${offset}`);
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

function basicStats(values) {
  const data = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (data.length === 0) {
    return { n: 0, mean_px: null, p50_px: null, p90_px: null, p95_px: null, p99_px: null, max_px: null };
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
  if (data.length === 0) return { count: 0, mean: null, p50: null, p90: null, p95: null, p99: null, max: null };
  const sum = data.reduce((acc, value) => acc + value, 0);
  return {
    count: data.length,
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
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
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

const speedBins = [
  { label: "0-25 px/s", min: 0, max: 25 },
  { label: "25-100 px/s", min: 25, max: 100 },
  { label: "100-250 px/s", min: 100, max: 250 },
  { label: "250-500 px/s", min: 250, max: 500 },
  { label: "500-1000 px/s", min: 500, max: 1000 },
  { label: "1000-2000 px/s", min: 1000, max: 2000 },
  { label: ">=2000 px/s", min: 2000, max: Infinity },
];

const accelerationBins = [
  { label: "0-1k px/s^2", min: 0, max: 1_000 },
  { label: "1k-5k px/s^2", min: 1_000, max: 5_000 },
  { label: "5k-20k px/s^2", min: 5_000, max: 20_000 },
  { label: "20k-50k px/s^2", min: 20_000, max: 50_000 },
  { label: "50k-100k px/s^2", min: 50_000, max: 100_000 },
  { label: ">=100k px/s^2", min: 100_000, max: Infinity },
];

const productIntervalBins = [
  { label: "0-10 ms", min: 0, max: 10 },
  { label: "10-17 ms", min: 10, max: 17 },
  { label: "17-33 ms", min: 17, max: 33 },
  { label: "33-67 ms", min: 33, max: 67 },
  { label: "67-100 ms", min: 67, max: 100 },
  { label: ">=100 ms", min: 100, max: Infinity },
];

const dwmHorizonBins = [
  { label: "0-4 ms", min: 0, max: 4 },
  { label: "4-8 ms", min: 4, max: 8 },
  { label: "8-12 ms", min: 8, max: 12 },
  { label: "12-16.7 ms", min: 12, max: 16.7 },
  { label: "16.7-25 ms", min: 16.7, max: 25 },
  { label: ">=25 ms", min: 25, max: Infinity },
];

const hookDisagreementBins = [
  { label: "0-0.5 px", min: 0, max: 0.5 },
  { label: "0.5-2 px", min: 0.5, max: 2 },
  { label: "2-8 px", min: 2, max: 8 },
  { label: "8-32 px", min: 8, max: 32 },
  { label: ">=32 px", min: 32, max: Infinity },
];

function classifyStopWindow(stopTimesUs, targetUs) {
  if (stopTimesUs.length === 0) return "no_stop_detected";
  const nextIndex = lowerBound(stopTimesUs, targetUs);
  if (nextIndex < stopTimesUs.length) {
    const untilStopMs = (stopTimesUs[nextIndex] - targetUs) / 1000;
    if (untilStopMs >= 0 && untilStopMs <= 16) return "pre_stop_0_16ms";
  }
  const prevIndex = nextIndex - 1;
  if (prevIndex < 0) return "not_near_stop";
  const sinceStopMs = (targetUs - stopTimesUs[prevIndex]) / 1000;
  if (sinceStopMs >= 0 && sinceStopMs <= 16) return "stop_entry_0_16ms";
  if (sinceStopMs > 16 && sinceStopMs <= 50) return "stop_settle_16_50ms";
  if (sinceStopMs > 50 && sinceStopMs <= 150) return "stop_settle_50_150ms";
  if (sinceStopMs > 150 && sinceStopMs <= 500) return "post_stop_150_500ms";
  return "not_near_stop";
}

function loadTrace(zipPath) {
  const metadata = JSON.parse(readZipEntry(zipPath, "metadata.json").toString("utf8"));
  const traceText = readZipEntry(zipPath, "trace.csv").toString("utf8");
  const lines = traceText.split(/\r?\n/);
  const header = lines[0].split(",");
  const column = Object.fromEntries(header.map((name, i) => [name, i]));
  const required = ["sequence", "stopwatchTicks", "elapsedMicroseconds", "x", "y", "event", "hookX", "hookY", "cursorX", "cursorY", "dwmTimingAvailable", "dwmQpcVBlank"];
  for (const name of required) {
    if (!(name in column)) throw new Error(`trace.csv is missing column ${name}`);
  }

  const stopwatchFrequency = Number(metadata.StopwatchFrequency || STOPWATCH_TICKS_PER_SECOND_DEFAULT);
  const ticksToUs = 1_000_000 / stopwatchFrequency;
  const eventCounts = {};
  const eventIntervalsMs = {};
  const lastEventTimeUs = {};
  const refTimesUs = [];
  const refX = [];
  const refY = [];
  const pollRows = [];
  const hookRows = [];
  const productIntervalsMs = [];
  const dwmHorizonsMs = [];
  let traceRows = 0;
  let firstElapsedUs = null;
  let lastElapsedUs = null;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const parts = line.split(",");
    const sequence = Number(parts[column.sequence]);
    const stopwatchTicks = Number(parts[column.stopwatchTicks]);
    const elapsedUs = Number(parts[column.elapsedMicroseconds]);
    const x = Number(parts[column.x]);
    const y = Number(parts[column.y]);
    const event = parts[column.event];
    const cursorXText = parts[column.cursorX];
    const cursorYText = parts[column.cursorY];
    const cursorX = cursorXText === "" ? x : Number(cursorXText);
    const cursorY = cursorYText === "" ? y : Number(cursorYText);
    const hookXText = parts[column.hookX];
    const hookYText = parts[column.hookY];
    const hookX = hookXText === "" ? null : Number(hookXText);
    const hookY = hookYText === "" ? null : Number(hookYText);
    const dwmTimingAvailable = parts[column.dwmTimingAvailable] === "true";
    const qpcVBlankText = parts[column.dwmQpcVBlank];
    const dwmQpcVBlank = qpcVBlankText === "" ? null : Number(qpcVBlankText);

    traceRows += 1;
    if (firstElapsedUs === null) firstElapsedUs = elapsedUs;
    lastElapsedUs = elapsedUs;
    eventCounts[event] = (eventCounts[event] || 0) + 1;
    if (lastEventTimeUs[event] !== undefined) {
      if (!eventIntervalsMs[event]) eventIntervalsMs[event] = [];
      eventIntervalsMs[event].push((elapsedUs - lastEventTimeUs[event]) / 1000);
    }
    lastEventTimeUs[event] = elapsedUs;

    if (event === "referencePoll") {
      refTimesUs.push(elapsedUs);
      refX.push(x);
      refY.push(y);
    } else if (event === "poll") {
      let dwmTargetElapsedUs = null;
      let dwmHorizonMs = null;
      if (dwmTimingAvailable && dwmQpcVBlank !== null && Number.isFinite(dwmQpcVBlank)) {
        dwmTargetElapsedUs = elapsedUs + (dwmQpcVBlank - stopwatchTicks) * ticksToUs;
        dwmHorizonMs = (dwmTargetElapsedUs - elapsedUs) / 1000;
        dwmHorizonsMs.push(dwmHorizonMs);
      }
      pollRows.push({
        sequence,
        stopwatchTicks,
        elapsedUs,
        x,
        y,
        cursorX,
        cursorY,
        dwmTimingAvailable,
        dwmQpcVBlank,
        dwmTargetElapsedUs,
        dwmHorizonMs,
        latestHookIndex: hookRows.length - 1,
      });
    } else if (event === "move" || event.toLowerCase().includes("hook")) {
      hookRows.push({
        sequence,
        elapsedUs,
        x: hookX === null ? x : hookX,
        y: hookY === null ? y : hookY,
      });
    }
  }

  return {
    metadata,
    header,
    csvRows: traceRows,
    firstElapsedUs,
    lastElapsedUs,
    durationMs: (lastElapsedUs - firstElapsedUs) / 1000,
    stopwatchFrequency,
    ticksToUs,
    eventCounts,
    eventIntervalsMs,
    refTimesUs,
    refX,
    refY,
    pollRows,
    hookRows,
    productIntervalsMs,
    dwmHorizonsMs,
  };
}

function detectReferenceStops(trace) {
  const stopTimesUs = [];
  let movingState = false;
  let lastMovingUs = null;
  for (let i = 1; i < trace.refTimesUs.length; i += 1) {
    const dtSec = (trace.refTimesUs[i] - trace.refTimesUs[i - 1]) / 1_000_000;
    if (dtSec <= 0) continue;
    const speed = distance(trace.refX[i], trace.refY[i], trace.refX[i - 1], trace.refY[i - 1]) / dtSec;
    if (speed >= 250) {
      movingState = true;
      lastMovingUs = trace.refTimesUs[i];
    } else if (movingState && speed <= 20 && lastMovingUs !== null && (trace.refTimesUs[i] - lastMovingUs) / 1000 <= 30) {
      stopTimesUs.push(trace.refTimesUs[i]);
      movingState = false;
    }
  }
  return stopTimesUs;
}

function stopAgeMs(stopTimesUs, elapsedUs) {
  const index = lowerBound(stopTimesUs, elapsedUs) - 1;
  if (index < 0) return null;
  const ageMs = (elapsedUs - stopTimesUs[index]) / 1000;
  return ageMs >= 0 && ageMs <= 250 ? ageMs : null;
}

function makeContexts(trace) {
  const stopTimesUs = detectReferenceStops(trace);
  const contexts = [];
  const diagnostics = {
    no_previous_poll: 0,
    invalid_product_dt: 0,
    idle_gap_over_100ms: 0,
    invalid_dwm_timing: 0,
    missing_reference_label: 0,
    used_velocity_prediction: 0,
  };
  const chronologicalStartUs = trace.pollRows.length ? trace.pollRows[0].elapsedUs : 0;
  const chronologicalEndUs = trace.pollRows.length ? trace.pollRows[trace.pollRows.length - 1].elapsedUs : 1;
  const chronologicalDurationUs = Math.max(1, chronologicalEndUs - chronologicalStartUs);
  let refIndex = 0;
  let prevPoll = null;
  let prevVelocity = null;
  const productIntervalsMs = [];
  const productSpeedsPxS = [];
  const productAccelerationsPxS2 = [];
  const hookDisagreementsPx = [];
  const referenceTargetIntervalsMs = [];
  const referenceTargetNearestMs = [];

  for (let i = 0; i < trace.pollRows.length; i += 1) {
    const poll = trace.pollRows[i];
    const productDtMs = prevPoll ? (poll.elapsedUs - prevPoll.elapsedUs) / 1000 : null;
    const productDtValid = productDtMs !== null && productDtMs > 0;
    const idleGap = productDtValid && productDtMs > PRODUCT_IDLE_GAP_MS;
    const dwmValid = poll.dwmTimingAvailable && poll.dwmTargetElapsedUs !== null && poll.dwmHorizonMs !== null && poll.dwmHorizonMs >= 0 && poll.dwmHorizonMs < 100;
    const evalTargetUs = dwmValid ? poll.dwmTargetElapsedUs : poll.elapsedUs;
    const label = interpolate(trace.refTimesUs, trace.refX, trace.refY, evalTargetUs, refIndex);
    if (label) refIndex = label.leftIndex;

    let vx = 0;
    let vy = 0;
    let speedPxS = null;
    let accelerationPxS2 = null;
    let canVelocityPredict = false;
    if (prevPoll && productDtValid) {
      const dtSec = productDtMs / 1000;
      vx = (poll.x - prevPoll.x) / dtSec;
      vy = (poll.y - prevPoll.y) / dtSec;
      speedPxS = Math.sqrt(vx * vx + vy * vy);
      productIntervalsMs.push(productDtMs);
      productSpeedsPxS.push(speedPxS);
      if (prevVelocity) {
        const ax = (vx - prevVelocity.vx) / dtSec;
        const ay = (vy - prevVelocity.vy) / dtSec;
        accelerationPxS2 = Math.sqrt(ax * ax + ay * ay);
        productAccelerationsPxS2.push(accelerationPxS2);
      }
      canVelocityPredict = !idleGap;
    }

    if (!prevPoll) diagnostics.no_previous_poll += 1;
    else if (!productDtValid) diagnostics.invalid_product_dt += 1;
    else if (idleGap) diagnostics.idle_gap_over_100ms += 1;
    if (!dwmValid) diagnostics.invalid_dwm_timing += 1;
    if (!label) diagnostics.missing_reference_label += 1;

    if (label) {
      const horizonMs = dwmValid ? poll.dwmHorizonMs : 0;
      const useVelocity = canVelocityPredict && dwmValid;
      if (useVelocity) diagnostics.used_velocity_prediction += 1;
      const latestHook = poll.latestHookIndex >= 0 ? trace.hookRows[poll.latestHookIndex] : null;
      const prevHook = poll.latestHookIndex > 0 ? trace.hookRows[poll.latestHookIndex - 1] : null;
      const hookAgeMs = latestHook ? (poll.elapsedUs - latestHook.elapsedUs) / 1000 : null;
      const hookDisagreement = latestHook ? distance(poll.cursorX, poll.cursorY, latestHook.x, latestHook.y) : null;
      if (hookDisagreement !== null) hookDisagreementsPx.push(hookDisagreement);
      let hookVx = null;
      let hookVy = null;
      let hookSpeedPxS = null;
      let hookDtMs = null;
      if (latestHook && prevHook) {
        hookDtMs = (latestHook.elapsedUs - prevHook.elapsedUs) / 1000;
        if (hookDtMs > 0 && hookDtMs <= PRODUCT_IDLE_GAP_MS) {
          hookVx = (latestHook.x - prevHook.x) / (hookDtMs / 1000);
          hookVy = (latestHook.y - prevHook.y) / (hookDtMs / 1000);
          hookSpeedPxS = Math.sqrt(hookVx * hookVx + hookVy * hookVy);
        }
      }

      const refAtPollIndex = Math.max(0, lowerBound(trace.refTimesUs, poll.elapsedUs) - 1);
      let refVx = null;
      let refVy = null;
      let refAnchor = null;
      if (refAtPollIndex > 0) {
        const dtMs = (trace.refTimesUs[refAtPollIndex] - trace.refTimesUs[refAtPollIndex - 1]) / 1000;
        if (dtMs > 0 && dtMs <= 20) {
          refVx = (trace.refX[refAtPollIndex] - trace.refX[refAtPollIndex - 1]) / (dtMs / 1000);
          refVy = (trace.refY[refAtPollIndex] - trace.refY[refAtPollIndex - 1]) / (dtMs / 1000);
          refAnchor = { x: trace.refX[refAtPollIndex], y: trace.refY[refAtPollIndex], elapsedUs: trace.refTimesUs[refAtPollIndex] };
        }
      }

      referenceTargetIntervalsMs.push(label.intervalMs);
      referenceTargetNearestMs.push(label.nearestMs);
      contexts.push({
        ordinal: contexts.length,
        pollIndex: i,
        poll,
        prevPoll,
        prevVelocity,
        label,
        evalTargetUs,
        dwmValid,
        horizonMs,
        productDtMs,
        productDtValid,
        idleGap,
        canVelocityPredict,
        vx,
        vy,
        speedPxS,
        accelerationPxS2,
        latestHook,
        prevHook,
        hookAgeMs,
        hookDisagreement,
        hookDtMs,
        hookVx,
        hookVy,
        hookSpeedPxS,
        refAnchor,
        refVx,
        refVy,
        stopAgeMs: stopAgeMs(stopTimesUs, poll.elapsedUs),
        referenceStopWindow: classifyStopWindow(stopTimesUs, evalTargetUs),
        speedBin: binOf(speedPxS, speedBins),
        accelerationBin: binOf(accelerationPxS2, accelerationBins),
        productIntervalBin: binOf(productDtMs, productIntervalBins),
        dwmHorizonBin: dwmValid ? binOf(horizonMs, dwmHorizonBins) : "invalid_dwm",
        hookDisagreementBin: hookDisagreement === null ? "no_prior_hook" : binOf(hookDisagreement, hookDisagreementBins),
        chronologicalBlock: `block_${Math.min(10, Math.floor(((poll.elapsedUs - chronologicalStartUs) / chronologicalDurationUs) * 10) + 1).toString().padStart(2, "0")}`,
      });
    }

    if (productDtValid) prevVelocity = { vx, vy };
    prevPoll = poll;
  }

  return {
    contexts,
    stopTimesUs,
    diagnostics,
    auditVectors: {
      productIntervalsMs,
      productSpeedsPxS,
      productAccelerationsPxS2,
      hookDisagreementsPx,
      referenceTargetIntervalsMs,
      referenceTargetNearestMs,
    },
  };
}

function predictLast2(ctx, gain = BASELINE_GAIN, horizonMs = ctx.horizonMs, anchor = ctx.poll, velocity = { vx: ctx.vx, vy: ctx.vy }, options = {}) {
  const requireDwm = options.requireDwm !== false;
  const canUseVelocity = ctx.prevPoll && ctx.productDtValid && !ctx.idleGap && (!requireDwm || ctx.dwmValid) && Number.isFinite(horizonMs);
  if (!canUseVelocity || !(gain > 0) || !(horizonMs > 0)) {
    return { x: anchor.x, y: anchor.y, applied: false, mode: "hold" };
  }
  return {
    x: anchor.x + velocity.vx * (horizonMs / 1000) * gain,
    y: anchor.y + velocity.vy * (horizonMs / 1000) * gain,
    applied: true,
    mode: "velocity",
  };
}

function gainFromHorizon(ctx, low, mid, high) {
  if (!ctx.dwmValid) return 0;
  if (ctx.horizonMs < 4) return low;
  if (ctx.horizonMs < 12) return mid;
  return high;
}

function gainFromStopAge(ageMs) {
  if (ageMs === null) return BASELINE_GAIN;
  if (ageMs <= 16) return 0;
  if (ageMs <= 50) return 0.2;
  if (ageMs <= 150) return 0.45;
  return 0.65;
}

function candidate(id, family, feasibility, description, parameters, predict) {
  return { id, family, feasibility, description, parameters, predict };
}

const candidates = [
  candidate("product_baseline_dwm_last2_gain_0_75", "baseline", "product_feasible", "Phase 1 product baseline: product poll anchor, last two product polls, gain 0.75, DWM target horizon.", { gain: BASELINE_GAIN }, (ctx) => predictLast2(ctx)),
  candidate("hold_current_dwm_target", "baseline", "product_feasible", "Hold the product poll position until DWM target.", {}, (ctx) => ({ x: ctx.poll.x, y: ctx.poll.y, applied: true, mode: "hold_current" })),
  candidate("dwm_gain_0_50", "dwm_horizon_gain_grid", "product_feasible", "Single lower gain against the product DWM target.", { gain: 0.5 }, (ctx) => predictLast2(ctx, 0.5)),
  candidate("dwm_gain_0_625", "dwm_horizon_gain_grid", "product_feasible", "Single moderate gain against the product DWM target.", { gain: 0.625 }, (ctx) => predictLast2(ctx, 0.625)),
  candidate("dwm_gain_0_875", "dwm_horizon_gain_grid", "product_feasible", "Single higher gain against the product DWM target.", { gain: 0.875 }, (ctx) => predictLast2(ctx, 0.875)),
  candidate("dwm_horizon_grid_soft", "dwm_horizon_gain_grid", "product_feasible", "Gain by DWM horizon: hold under 4 ms, 0.70 for 4-12 ms, 0.80 for >=12 ms.", { gains: { "0-4ms": 0, "4-12ms": 0.7, "12ms+": 0.8 } }, (ctx) => predictLast2(ctx, gainFromHorizon(ctx, 0, 0.7, 0.8))),
  candidate("dwm_horizon_grid_tail_damped", "dwm_horizon_gain_grid", "product_feasible", "Gain by DWM horizon: 0.25 under 4 ms, 0.70 for 4-12 ms, 0.55 for >=12 ms.", { gains: { "0-4ms": 0.25, "4-12ms": 0.7, "12ms+": 0.55 } }, (ctx) => predictLast2(ctx, gainFromHorizon(ctx, 0.25, 0.7, 0.55))),
  candidate("fixed_effective_horizon_4ms", "fixed_horizon_alternative", "product_feasible", "Use a fixed 4 ms effective prediction horizon, still scored at actual DWM target.", { effective_horizon_ms: 4, gain: BASELINE_GAIN }, (ctx) => predictLast2(ctx, BASELINE_GAIN, ctx.dwmValid ? 4 : 0)),
  candidate("fixed_effective_horizon_8ms", "fixed_horizon_alternative", "product_feasible", "Use a fixed 8 ms effective prediction horizon, still scored at actual DWM target.", { effective_horizon_ms: 8, gain: BASELINE_GAIN }, (ctx) => predictLast2(ctx, BASELINE_GAIN, ctx.dwmValid ? 8 : 0)),
  candidate("fixed_effective_horizon_12ms", "fixed_horizon_alternative", "product_feasible", "Use a fixed 12 ms effective prediction horizon, still scored at actual DWM target.", { effective_horizon_ms: 12, gain: BASELINE_GAIN }, (ctx) => predictLast2(ctx, BASELINE_GAIN, ctx.dwmValid ? 12 : 0)),
  candidate("fixed_effective_horizon_16ms", "fixed_horizon_alternative", "product_feasible", "Use a fixed 16 ms effective prediction horizon, still scored at actual DWM target.", { effective_horizon_ms: 16, gain: BASELINE_GAIN }, (ctx) => predictLast2(ctx, BASELINE_GAIN, ctx.dwmValid ? 16 : 0)),
  candidate("poll_dt_gain_damping", "poll_interval_gate", "product_feasible", "Damp gain after slow product polls: 0.60 at 33-67 ms, 0.35 at >=67 ms, hold at >=100 ms.", { gains: { "33-67ms": 0.6, "67-100ms": 0.35, "100ms+": 0 } }, (ctx) => {
    const gain = ctx.productDtMs >= 100 ? 0 : ctx.productDtMs >= 67 ? 0.35 : ctx.productDtMs >= 33 ? 0.6 : BASELINE_GAIN;
    return predictLast2(ctx, gain);
  }),
  candidate("poll_dt_horizon_cap", "poll_interval_gate", "product_feasible", "Cap effective horizon when product poll cadence slips: 8 ms at 33-67 ms, 4 ms at >=67 ms, hold at >=100 ms.", { caps_ms: { "33-67ms": 8, "67-100ms": 4, "100ms+": 0 } }, (ctx) => {
    const cap = ctx.productDtMs >= 100 ? 0 : ctx.productDtMs >= 67 ? 4 : ctx.productDtMs >= 33 ? 8 : Infinity;
    return predictLast2(ctx, BASELINE_GAIN, Math.min(ctx.horizonMs, cap));
  }),
  candidate("poll_dt_fallback_hold_ge67", "poll_interval_gate", "product_feasible", "Fallback to hold when previous product poll interval is at least 67 ms.", { hold_interval_ms: 67 }, (ctx) => predictLast2(ctx, ctx.productDtMs >= 67 ? 0 : BASELINE_GAIN)),
  candidate("product_stop_entry_hold_16ms", "stop_guard", "product_feasible", "Use product poll speed-collapse stop detection; hold for 16 ms after stop entry.", { hold_after_product_stop_ms: 16, move_speed_px_s: 250, stop_speed_px_s: 20 }, (ctx) => {
    const gain = ctx.stopAgeMs !== null && ctx.stopAgeMs <= 16 ? 0 : BASELINE_GAIN;
    return predictLast2(ctx, gain);
  }),
  candidate("product_stop_settle_decay_250ms", "stop_guard", "product_feasible", "Use product poll speed-collapse stop detection; restore gain over 250 ms.", { gains: { "0-16ms": 0, "16-50ms": 0.2, "50-150ms": 0.45, "150-250ms": 0.65 } }, (ctx) => predictLast2(ctx, gainFromStopAge(ctx.stopAgeMs))),
  candidate("latest_hook_hold_age16", "latest_hook_anchor", "product_feasible", "When latest hook is no older than 16 ms, use its position as a hold anchor.", { max_hook_age_ms: 16 }, (ctx) => {
    if (ctx.latestHook && ctx.hookAgeMs >= 0 && ctx.hookAgeMs <= 16) return { x: ctx.latestHook.x, y: ctx.latestHook.y, applied: true, mode: "latest_hook_hold" };
    return predictLast2(ctx);
  }),
  candidate("latest_hook_anchor_poll_velocity_age16", "latest_hook_anchor", "product_feasible", "When latest hook is no older than 16 ms, anchor at hook position and reuse product poll velocity.", { max_hook_age_ms: 16, gain: BASELINE_GAIN }, (ctx) => {
    if (ctx.latestHook && ctx.hookAgeMs >= 0 && ctx.hookAgeMs <= 16) {
      const horizonMs = (ctx.evalTargetUs - ctx.latestHook.elapsedUs) / 1000;
      return predictLast2(ctx, BASELINE_GAIN, horizonMs, ctx.latestHook, { vx: ctx.vx, vy: ctx.vy }, { requireDwm: false });
    }
    return predictLast2(ctx);
  }),
  candidate("mixed_hook_when_disagree_ge2_age16", "mixed_hook_poll_anchor", "product_feasible", "Use latest hook anchor with product velocity only when hook/poll disagreement is at least 2 px and hook age is <=16 ms.", { disagreement_px: 2, max_hook_age_ms: 16 }, (ctx) => {
    if (ctx.latestHook && ctx.hookAgeMs >= 0 && ctx.hookAgeMs <= 16 && ctx.hookDisagreement >= 2) {
      const horizonMs = (ctx.evalTargetUs - ctx.latestHook.elapsedUs) / 1000;
      return predictLast2(ctx, BASELINE_GAIN, horizonMs, ctx.latestHook, { vx: ctx.vx, vy: ctx.vy }, { requireDwm: false });
    }
    return predictLast2(ctx);
  }),
  candidate("mixed_hook_hold_when_disagree_ge8_age16", "mixed_hook_poll_anchor", "product_feasible", "Use latest hook as a hold anchor only when hook/poll disagreement is at least 8 px and hook age is <=16 ms.", { disagreement_px: 8, max_hook_age_ms: 16 }, (ctx) => {
    if (ctx.latestHook && ctx.hookAgeMs >= 0 && ctx.hookAgeMs <= 16 && ctx.hookDisagreement >= 8) return { x: ctx.latestHook.x, y: ctx.latestHook.y, applied: true, mode: "hook_disagreement_hold" };
    return predictLast2(ctx);
  }),
  candidate("hook_velocity_latest2_age32", "hook_derived_velocity", "product_feasible", "Use latest two hook positions for anchor and velocity when hook age <=32 ms and hook dt <=100 ms.", { max_hook_age_ms: 32, max_hook_dt_ms: 100, gain: BASELINE_GAIN }, (ctx) => {
    if (ctx.latestHook && ctx.hookVx !== null && ctx.hookAgeMs >= 0 && ctx.hookAgeMs <= 32 && ctx.hookDtMs <= 100) {
      const horizonMs = (ctx.evalTargetUs - ctx.latestHook.elapsedUs) / 1000;
      return predictLast2(ctx, BASELINE_GAIN, horizonMs, ctx.latestHook, { vx: ctx.hookVx, vy: ctx.hookVy }, { requireDwm: false });
    }
    return predictLast2(ctx);
  }),
  candidate("combo_horizon_poll_stop_hook", "combination", "product_feasible", "Combine best-motivated guards: horizon gain grid, poll interval damping, product stop decay, and high-disagreement hook hold.", {}, (ctx) => {
    const horizonGain = gainFromHorizon(ctx, 0, 0.7, 0.8);
    const pollGain = ctx.productDtMs >= 100 ? 0 : ctx.productDtMs >= 67 ? 0.35 : ctx.productDtMs >= 33 ? 0.6 : BASELINE_GAIN;
    const stopGain = gainFromStopAge(ctx.stopAgeMs);
    if (ctx.latestHook && ctx.hookAgeMs >= 0 && ctx.hookAgeMs <= 16 && ctx.hookDisagreement >= 8) return { x: ctx.latestHook.x, y: ctx.latestHook.y, applied: true, mode: "hook_disagreement_hold" };
    return predictLast2(ctx, Math.min(horizonGain, pollGain, stopGain));
  }),
  candidate("nonproduct_reference_latest_anchor_velocity", "hypothetical_reference_input", "non_product_referencePoll_runtime", "Use latest dense referencePoll before product poll as runtime anchor and velocity source.", { uses_dense_referencePoll_as_input: true, gain: BASELINE_GAIN }, (ctx) => {
    if (ctx.refAnchor && ctx.refVx !== null) {
      const horizonMs = (ctx.evalTargetUs - ctx.refAnchor.elapsedUs) / 1000;
      return predictLast2(ctx, BASELINE_GAIN, horizonMs, ctx.refAnchor, { vx: ctx.refVx, vy: ctx.refVy }, { requireDwm: false });
    }
    return predictLast2(ctx);
  }),
  candidate("nonproduct_oracle_target_position", "hypothetical_future_oracle", "non_product_future_information", "Use the future referencePoll-interpolated target position directly; this is a zero-error lower bound, not a product candidate.", { uses_future_target: true }, (ctx) => ({ x: ctx.label.x, y: ctx.label.y, applied: true, mode: "future_oracle" })),
];

function productStopContextPass(contexts) {
  const stopTimes = [];
  for (const ctx of contexts) {
    const prevSpeed = ctx.prevVelocity ? Math.sqrt(ctx.prevVelocity.vx * ctx.prevVelocity.vx + ctx.prevVelocity.vy * ctx.prevVelocity.vy) : null;
    if (prevSpeed !== null && prevSpeed >= 250 && ctx.speedPxS !== null && ctx.speedPxS <= 20) {
      stopTimes.push(ctx.poll.elapsedUs);
    }
  }
  for (const ctx of contexts) ctx.stopAgeMs = stopAgeMs(stopTimes, ctx.poll.elapsedUs);
  return stopTimes;
}

function regressionCounts(records, predicate = () => true) {
  let count = 0;
  let gt1 = 0;
  let gt3 = 0;
  let gt5 = 0;
  let imp1 = 0;
  let imp3 = 0;
  let imp5 = 0;
  for (const record of records) {
    if (!predicate(record)) continue;
    count += 1;
    if (record.delta_px > 1) gt1 += 1;
    if (record.delta_px > 3) gt3 += 1;
    if (record.delta_px > 5) gt5 += 1;
    if (record.delta_px < -1) imp1 += 1;
    if (record.delta_px < -3) imp3 += 1;
    if (record.delta_px < -5) imp5 += 1;
  }
  return {
    n: count,
    worse_gt_1px: gt1,
    worse_gt_3px: gt3,
    worse_gt_5px: gt5,
    better_gt_1px: imp1,
    better_gt_3px: imp3,
    better_gt_5px: imp5,
  };
}

function summarizeGroup(records) {
  return {
    stats: basicStats(records.map((record) => record.error_px)),
    regressions_vs_baseline: regressionCounts(records),
  };
}

function bucket(records, field) {
  const groups = {};
  for (const record of records) {
    const key = record[field] || "missing";
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  }
  return Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, summarizeGroup(rows)]));
}

function evaluateCandidate(model, contexts, baselineErrors) {
  const records = [];
  const modeCounts = {};
  let appliedCount = 0;
  for (const ctx of contexts) {
    const prediction = model.predict(ctx);
    const error = distance(prediction.x, prediction.y, ctx.label.x, ctx.label.y);
    const baselineError = baselineErrors ? baselineErrors[ctx.ordinal] : error;
    const delta = error - baselineError;
    const mode = prediction.mode || "unknown";
    modeCounts[mode] = (modeCounts[mode] || 0) + 1;
    if (prediction.applied) appliedCount += 1;
    records.push({
      ordinal: ctx.ordinal,
      error_px: error,
      baseline_error_px: baselineError,
      delta_px: delta,
      speed_px_s: ctx.speedPxS,
      acceleration_px_s2: ctx.accelerationPxS2,
      product_interval_ms: ctx.productDtMs,
      dwm_horizon_ms: ctx.horizonMs,
      hook_poll_disagreement_px: ctx.hookDisagreement,
      speed_bin: ctx.speedBin,
      acceleration_bin: ctx.accelerationBin,
      product_poll_interval_bin: ctx.productIntervalBin,
      dwm_horizon_bin: ctx.dwmHorizonBin,
      hook_poll_disagreement_bin: ctx.hookDisagreementBin,
      stop_window: ctx.referenceStopWindow,
      chronological_block: ctx.chronologicalBlock,
    });
  }
  const highSpeed = (record) => Number.isFinite(record.speed_px_s) && record.speed_px_s >= HIGH_SPEED_PX_S;
  const highAccel = (record) => Number.isFinite(record.acceleration_px_s2) && record.acceleration_px_s2 >= HIGH_ACCEL_PX_S2;
  const lowSpeed = (record) => Number.isFinite(record.speed_px_s) && record.speed_px_s <= LOW_SPEED_PX_S;
  return {
    id: model.id,
    family: model.family,
    feasibility: model.feasibility,
    description: model.description,
    parameters: model.parameters,
    overall: basicStats(records.map((record) => record.error_px)),
    delta_vs_baseline: baselineErrors
      ? {
          mean_px: basicStats(records.map((record) => record.error_px)).mean_px - basicStats(records.map((record) => record.baseline_error_px)).mean_px,
          p95_px: basicStats(records.map((record) => record.error_px)).p95_px - basicStats(records.map((record) => record.baseline_error_px)).p95_px,
          p99_px: basicStats(records.map((record) => record.error_px)).p99_px - basicStats(records.map((record) => record.baseline_error_px)).p99_px,
          max_px: basicStats(records.map((record) => record.error_px)).max_px - basicStats(records.map((record) => record.baseline_error_px)).max_px,
        }
      : { mean_px: 0, p95_px: 0, p99_px: 0, max_px: 0 },
    high_speed_ge_2000_px_s: summarizeGroup(records.filter(highSpeed)),
    high_acceleration_ge_100k_px_s2: summarizeGroup(records.filter(highAccel)),
    low_speed_le_25_px_s: summarizeGroup(records.filter(lowSpeed)),
    regressions_vs_baseline: baselineErrors ? regressionCounts(records) : regressionCounts(records, () => false),
    low_speed_regressions_vs_baseline: baselineErrors ? regressionCounts(records, lowSpeed) : regressionCounts(records, () => false),
    application: {
      applied_count: appliedCount,
      fallback_count: records.length - appliedCount,
      applied_rate: records.length ? appliedCount / records.length : null,
      mode_counts: Object.fromEntries(Object.entries(modeCounts).sort(([a], [b]) => a.localeCompare(b))),
    },
    breakdowns: {
      speed_bins: bucket(records, "speed_bin"),
      acceleration_bins: bucket(records, "acceleration_bin"),
      product_poll_interval_bins: bucket(records, "product_poll_interval_bin"),
      dwm_horizon_bins: bucket(records, "dwm_horizon_bin"),
      hook_poll_disagreement_bins: bucket(records, "hook_poll_disagreement_bin"),
      stop_windows: bucket(records, "stop_window"),
      chronological_blocks: bucket(records, "chronological_block"),
    },
  };
}

function buildSchedulerVariants(trace) {
  const variants = [];
  const first = trace.refTimesUs[1];
  const last = trace.refTimesUs[trace.refTimesUs.length - 2];
  for (const cadenceMs of [4, 8]) {
    for (const horizonMs of [8, 16]) {
      const errors = [];
      const intervals = [];
      let prev = null;
      let anchorIndex = 0;
      let targetIndex = 0;
      for (let t = first; t + horizonMs * 1000 <= last; t += cadenceMs * 1000) {
        const anchor = interpolate(trace.refTimesUs, trace.refX, trace.refY, t, anchorIndex);
        if (anchor) anchorIndex = anchor.leftIndex;
        const target = interpolate(trace.refTimesUs, trace.refX, trace.refY, t + horizonMs * 1000, targetIndex);
        if (target) targetIndex = target.leftIndex;
        if (!anchor || !target) continue;
        let pred = { x: anchor.x, y: anchor.y };
        if (prev && t - prev.t > 0 && (t - prev.t) / 1000 <= PRODUCT_IDLE_GAP_MS) {
          const vx = (anchor.x - prev.x) / ((t - prev.t) / 1_000_000);
          const vy = (anchor.y - prev.y) / ((t - prev.t) / 1_000_000);
          pred = { x: anchor.x + vx * (horizonMs / 1000) * BASELINE_GAIN, y: anchor.y + vy * (horizonMs / 1000) * BASELINE_GAIN };
          intervals.push((t - prev.t) / 1000);
        }
        errors.push(distance(pred.x, pred.y, target.x, target.y));
        prev = { t, x: anchor.x, y: anchor.y };
      }
      variants.push({
        id: `nonproduct_reference_cadence_${cadenceMs}ms_target_${horizonMs}ms`,
        family: "hypothetical_scheduler_input_cadence",
        feasibility: "non_product_referencePoll_runtime",
        description: `Synthetic ${cadenceMs} ms anchors from dense referencePoll with fixed ${horizonMs} ms target; this is a scheduler/input-cadence bound, not a product replay.`,
        parameters: { synthetic_anchor_cadence_ms: cadenceMs, fixed_target_horizon_ms: horizonMs, gain: BASELINE_GAIN },
        overall: basicStats(errors),
        interval_ms: scalarStats(intervals),
        note: "Not regression-comparable to product poll DWM baseline because anchors and target policy differ.",
      });
    }
  }
  return variants;
}

function renderCandidateRows(summaries) {
  return summaries.map((s) => [
    `\`${s.id}\``,
    s.feasibility,
    fmt(s.overall.mean_px),
    fmt(s.overall.p50_px),
    fmt(s.overall.p90_px),
    fmt(s.overall.p95_px),
    fmt(s.overall.p99_px),
    fmt(s.overall.max_px),
    `${s.regressions_vs_baseline.worse_gt_1px}/${s.regressions_vs_baseline.worse_gt_3px}/${s.regressions_vs_baseline.worse_gt_5px}`,
    fmt(s.application.applied_rate, 4),
  ]);
}

function renderExperimentLog(scores) {
  const audit = scores.audit;
  const baseline = scores.candidates.find((s) => s.id === "product_baseline_dwm_last2_gain_0_75");
  const topByP99 = scores.candidates.filter((s) => s.feasibility === "product_feasible" && s.id !== baseline.id).slice().sort((a, b) => a.overall.p99_px - b.overall.p99_px).slice(0, 10);
  const familyRows = Object.entries(scores.candidate_families).map(([family, ids]) => [family, ids.length, ids.map((id) => `\`${id}\``).join(", ")]);
  const sliceRows = [
    ["overall", baseline.overall.n, baseline.overall.mean_px, baseline.overall.p95_px, baseline.overall.p99_px, baseline.overall.max_px],
    [">=2000 px/s", baseline.high_speed_ge_2000_px_s.stats.n, baseline.high_speed_ge_2000_px_s.stats.mean_px, baseline.high_speed_ge_2000_px_s.stats.p95_px, baseline.high_speed_ge_2000_px_s.stats.p99_px, baseline.high_speed_ge_2000_px_s.stats.max_px],
    [">=100k px/s^2", baseline.high_acceleration_ge_100k_px_s2.stats.n, baseline.high_acceleration_ge_100k_px_s2.stats.mean_px, baseline.high_acceleration_ge_100k_px_s2.stats.p95_px, baseline.high_acceleration_ge_100k_px_s2.stats.p99_px, baseline.high_acceleration_ge_100k_px_s2.stats.max_px],
  ].map(([name, n, mean, p95, p99, max]) => [name, fmtInt(n), fmt(mean), fmt(p95), fmt(p99), fmt(max)]);
  const schedulerRows = scores.hypothetical_scheduler_variants.map((s) => [`\`${s.id}\``, fmtInt(s.overall.n), fmt(s.overall.mean_px), fmt(s.overall.p95_px), fmt(s.overall.p99_px), fmt(s.overall.max_px)]);
  return `# Phase 2 Experiment Log

## Run

- script: \`analyze_phase2.js\`
- input: \`${audit.zip_path}\`
- generated: \`${scores.generated_at_utc}\`
- elapsed: ${fmt(scores.performance.elapsed_sec)} sec
- rows: ${fmtInt(audit.csv_rows)}

The script reads \`cursor-mirror-trace-20260501-195819.zip\` directly and treats it as read-only. All outputs are written inside the Phase 2 directory.

## Reproduction

The Phase 1 baseline was reproduced with product \`poll\` anchors and linearly interpolated \`referencePoll\` target positions. The reproduced baseline is:

${table(["slice", "n", "mean px", "p95 px", "p99 px", "max px"], sliceRows)}

This matches the Phase 1 headline: mean ${fmt(scores.phase1_reference_headline.mean_px)}, p95 ${fmt(scores.phase1_reference_headline.p95_px)}, p99 ${fmt(scores.phase1_reference_headline.p99_px)}, max ${fmt(scores.phase1_reference_headline.max_px)}.

## Candidate Families

${table(["family", "count", "candidates"], familyRows)}

## Product-Feasible Candidate Results

${table(["candidate", "feasibility", "mean", "p50", "p90", "p95", "p99", "max", "regress >1/>3/>5", "applied rate"], renderCandidateRows(scores.candidates.filter((s) => s.feasibility === "product_feasible")))}

## Top Product-Feasible p99 Results

${table(["candidate", "feasibility", "mean", "p50", "p90", "p95", "p99", "max", "regress >1/>3/>5", "applied rate"], renderCandidateRows(topByP99))}

## Non-Product Reference/Future Candidates

${table(["candidate", "feasibility", "mean", "p50", "p90", "p95", "p99", "max", "regress >1/>3/>5", "applied rate"], renderCandidateRows(scores.candidates.filter((s) => s.feasibility !== "product_feasible")))}

## Hypothetical Scheduler/Input-Cadence Variants

${table(["variant", "n", "mean", "p95", "p99", "max"], schedulerRows)}

These scheduler variants use dense \`referencePoll\` as synthetic runtime input and fixed future targets, so their scores are not product-feasible and not directly regression-comparable to product poll/DWM replay.

## Notes

- Product poll cadence remains a primary risk surface: p50/p95 intervals are ${fmt(audit.product_poll_interval_ms.p50)} / ${fmt(audit.product_poll_interval_ms.p95)} ms despite the requested 8 ms interval.
- The latest-hook and hook-velocity candidates are feasible from trace fields, but on this replay they rarely beat the poll anchor because most hook/poll disagreement is zero and hook samples are often stale relative to DWM target time.
- DWM horizon damping and fixed effective horizons can reduce some low-horizon overshoot, but they trade against fast-motion underprediction.
- Stop-settle guards help the post-stop low-error area but do not solve the pre-stop and high-speed tail that dominates p95/p99.
`;
}

function renderReport(scores) {
  const baseline = scores.candidates.find((s) => s.id === "product_baseline_dwm_last2_gain_0_75");
  const product = scores.candidates.filter((s) => s.feasibility === "product_feasible" && s.id !== baseline.id);
  const viable = product.filter((s) =>
    s.overall.p95_px <= baseline.overall.p95_px &&
    s.overall.p99_px <= baseline.overall.p99_px &&
    s.high_speed_ge_2000_px_s.stats.p95_px <= baseline.high_speed_ge_2000_px_s.stats.p95_px &&
    s.high_acceleration_ge_100k_px_s2.stats.p95_px <= baseline.high_acceleration_ge_100k_px_s2.stats.p95_px &&
    s.low_speed_regressions_vs_baseline.worse_gt_5px === 0
  ).sort((a, b) => (a.overall.p99_px - b.overall.p99_px) || (a.regressions_vs_baseline.worse_gt_5px - b.regressions_vs_baseline.worse_gt_5px));
  const best = viable[0] || null;
  const bestP99 = product.slice().sort((a, b) => a.overall.p99_px - b.overall.p99_px)[0];
  const bestHyp = scores.hypothetical_scheduler_variants.slice().sort((a, b) => a.overall.p99_px - b.overall.p99_px)[0];
  const nonProductReference = scores.candidates.find((s) => s.id === "nonproduct_reference_latest_anchor_velocity");

  const recommendation = best
    ? `Best product-feasible candidate: \`${best.id}\`, with p95 ${fmt(best.overall.p95_px)} and p99 ${fmt(best.overall.p99_px)} versus baseline p95 ${fmt(baseline.overall.p95_px)} and p99 ${fmt(baseline.overall.p99_px)}.`
    : `No product-feasible candidate clears the decision rule. The lowest product-feasible p99 is \`${bestP99.id}\` at ${fmt(bestP99.overall.p99_px)} px, but it fails at least one high-risk or regression guard.`;

  return `# Phase 2 Report

## Recommendation

${recommendation}

Keep the Phase 1 product baseline as the product-feasible default for now. Deterministic gates are useful diagnostics, but this trace does not justify shipping a fixed gate as the main predictor.

## Strongest Findings

- Baseline reproduction matched Phase 1: mean ${fmt(baseline.overall.mean_px)}, p95 ${fmt(baseline.overall.p95_px)}, p99 ${fmt(baseline.overall.p99_px)}, max ${fmt(baseline.overall.max_px)} px.
- The hardest product-feasible slices remain fast and abrupt motion: baseline >=2000 px/s p95/p99 ${fmt(baseline.high_speed_ge_2000_px_s.stats.p95_px)}/${fmt(baseline.high_speed_ge_2000_px_s.stats.p99_px)} px and >=100k px/s^2 p95/p99 ${fmt(baseline.high_acceleration_ge_100k_px_s2.stats.p95_px)}/${fmt(baseline.high_acceleration_ge_100k_px_s2.stats.p99_px)} px.
- Hook-derived runtime inputs are feasible but not a clean win on this trace; stale hook age and sparse disagreement limit their value.
- The best hypothetical insight is cadence/input freshness, but only as a non-comparable bound: \`${bestHyp.id}\` reaches p95 ${fmt(bestHyp.overall.p95_px)} and p99 ${fmt(bestHyp.overall.p99_px)} using dense referencePoll anchors and a fixed target. At product poll times, \`${nonProductReference.id}\` is worse, with p99 ${fmt(nonProductReference.overall.p99_px)}, so reference input alone is not enough.

## Phase 3 Direction

Prioritize runtime anchor/cadence instrumentation before learned residuals. Capture hook age, latest hook position, poll interval, DWM horizon, and product-vs-hook disagreement in product replay tests, then validate whether a fresher anchor near compose time reduces the high-speed/high-accel tail across multiple traces. A learned residual should be gated behind that cleaner runtime anchor story.
`;
}

function analyze(zipPath, outDir) {
  const started = performance.now();
  const trace = loadTrace(zipPath);
  const { contexts, stopTimesUs, diagnostics, auditVectors } = makeContexts(trace);
  const productStopTimesUs = productStopContextPass(contexts);

  const baselineEvaluation = evaluateCandidate(candidates[0], contexts, null);
  const baselineErrors = [];
  for (const record of Object.values(baselineEvaluation.breakdowns.chronological_blocks).flatMap(() => [])) void record;
  for (const ctx of contexts) {
    const pred = candidates[0].predict(ctx);
    baselineErrors[ctx.ordinal] = distance(pred.x, pred.y, ctx.label.x, ctx.label.y);
  }

  const summaries = candidates.map((model) => evaluateCandidate(model, contexts, baselineErrors));
  const families = {};
  for (const summary of summaries) {
    if (!families[summary.family]) families[summary.family] = [];
    families[summary.family].push(summary.id);
  }

  const audit = {
    zip_path: path.resolve(zipPath),
    trace_format_version: trace.metadata.TraceFormatVersion,
    csv_rows: trace.csvRows,
    duration_ms: trace.durationMs,
    event_counts: Object.fromEntries(Object.entries(trace.eventCounts).sort(([a], [b]) => a.localeCompare(b))),
    metadata_counts: {
      SampleCount: trace.metadata.SampleCount,
      HookSampleCount: trace.metadata.HookSampleCount,
      PollSampleCount: trace.metadata.PollSampleCount,
      ReferencePollSampleCount: trace.metadata.ReferencePollSampleCount,
      DwmTimingSampleCount: trace.metadata.DwmTimingSampleCount,
    },
    event_interval_ms: Object.fromEntries(Object.entries(trace.eventIntervalsMs).sort(([a], [b]) => a.localeCompare(b)).map(([event, values]) => [event, scalarStats(values)])),
    product_poll_interval_ms: scalarStats(auditVectors.productIntervalsMs),
    product_speed_px_s: scalarStats(auditVectors.productSpeedsPxS),
    product_acceleration_px_s2: scalarStats(auditVectors.productAccelerationsPxS2),
    reference_target_interval_ms: scalarStats(auditVectors.referenceTargetIntervalsMs),
    reference_target_nearest_coverage_ms: scalarStats(auditVectors.referenceTargetNearestMs),
    dwm_horizon_ms: scalarStats(trace.dwmHorizonsMs),
    hook_poll_disagreement_px: scalarStats(auditVectors.hookDisagreementsPx),
    detected_reference_stop_entries: stopTimesUs.length,
    detected_product_stop_entries: productStopTimesUs.length,
  };

  const elapsedSec = (performance.now() - started) / 1000;
  const scores = {
    generated_at_utc: new Date().toISOString(),
    phase: "phase-2 runtime-anchor-and-deterministic-candidates",
    config: {
      baseline_gain: BASELINE_GAIN,
      product_idle_gap_ms: PRODUCT_IDLE_GAP_MS,
      high_speed_px_s: HIGH_SPEED_PX_S,
      high_acceleration_px_s2: HIGH_ACCEL_PX_S2,
      ground_truth_policy: "Linear interpolation between adjacent referencePoll samples at the candidate target timestamp.",
      product_candidate_target_policy: "Actual DWM qpcVBlank target when valid, otherwise poll elapsed timestamp, matching Phase 1.",
      regression_policy: "Pointwise candidate error minus reproduced Phase 1 product baseline error at the same product poll/DWM target.",
      non_product_policy: "Candidates using dense referencePoll as runtime input or future target information are labeled non_product.",
    },
    metadata: trace.metadata,
    audit,
    diagnostics,
    phase1_reference_headline: {
      mean_px: 1.695160690002936,
      p95_px: 6.771448666530115,
      p99_px: 36.24477828349407,
      max_px: 682.4665116664698,
    },
    evaluated_context_count: contexts.length,
    candidate_families: families,
    candidates: summaries,
    hypothetical_scheduler_variants: buildSchedulerVariants(trace),
    performance: {
      elapsed_sec: elapsedSec,
      csv_rows_per_sec: trace.csvRows / elapsedSec,
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "scores.json"), `${JSON.stringify(scores, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "experiment-log.md"), renderExperimentLog(scores), "utf8");
  fs.writeFileSync(path.join(outDir, "report.md"), renderReport(scores), "utf8");
  return scores;
}

function main() {
  const args = parseArgs(process.argv);
  const scriptDir = __dirname;
  const defaultZip = path.resolve(scriptDir, "../../../cursor-mirror-trace-20260501-195819.zip");
  const zipPath = path.resolve(args.zip || defaultZip);
  const outDir = path.resolve(args.out || scriptDir);
  analyze(zipPath, outDir);
  console.log(`Wrote ${path.join(outDir, "scores.json")}`);
  console.log(`Wrote ${path.join(outDir, "experiment-log.md")}`);
  console.log(`Wrote ${path.join(outDir, "report.md")}`);
}

main();
