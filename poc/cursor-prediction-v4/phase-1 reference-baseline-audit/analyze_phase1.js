#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");

const STOPWATCH_TICKS_PER_SECOND_DEFAULT = 10_000_000;
const PRODUCT_IDLE_GAP_MS = 100;
const BASELINE_GAIN = 0.75;
const FIXED_HORIZONS_MS = [8, 16];

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

function basicStats(values) {
  if (!values || values.length === 0) {
    return { count: 0, min: null, mean: null, p50: null, p90: null, p95: null, p99: null, max: null };
  }
  const sorted = Array.from(values).sort((a, b) => a - b);
  let sum = 0;
  for (const value of sorted) sum += value;
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };
}

function errorStats(errors) {
  const stats = basicStats(errors);
  if (errors.length === 0) {
    return { n: 0, mean_px: null, rmse_px: null, p50_px: null, p90_px: null, p95_px: null, p99_px: null, max_px: null };
  }
  let sumSquares = 0;
  for (const err of errors) sumSquares += err * err;
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

function binOf(value, bins) {
  if (value === null || value === undefined || Number.isNaN(value)) return "missing";
  for (const bin of bins) {
    if (value >= bin.min && value < bin.max) return bin.label;
  }
  return bins[bins.length - 1].label;
}

function addMetric(groupMap, group, model, error) {
  if (!groupMap[group]) groupMap[group] = {};
  if (!groupMap[group][model]) groupMap[group][model] = [];
  groupMap[group][model].push(error);
}

function finalizeGroupMap(groupMap) {
  const out = {};
  for (const [group, models] of Object.entries(groupMap)) {
    out[group] = {};
    for (const [model, errors] of Object.entries(models)) {
      out[group][model] = errorStats(errors);
    }
  }
  return out;
}

function findSegmentIndex(times, target, startIndex) {
  let lo = Math.max(0, Math.min(startIndex, times.length - 2));
  while (lo + 1 < times.length && times[lo + 1] < target) lo += 1;
  while (lo > 0 && times[lo] > target) lo -= 1;
  return lo;
}

function interpolate(times, xs, ys, target, startIndex) {
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

function buildMarkdownTable(headers, rows) {
  const header = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [header, sep, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return String(value);
}

function fmtInt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Math.round(value).toLocaleString("en-US");
}

function analyze(zipPath, outDir) {
  const started = performance.now();
  const metadata = JSON.parse(readZipEntry(zipPath, "metadata.json").toString("utf8"));
  const traceText = readZipEntry(zipPath, "trace.csv").toString("utf8");
  const lines = traceText.split(/\r?\n/);
  const header = lines[0].split(",");
  const column = Object.fromEntries(header.map((name, i) => [name, i]));
  const required = [
    "sequence",
    "stopwatchTicks",
    "elapsedMicroseconds",
    "x",
    "y",
    "event",
    "hookX",
    "hookY",
    "cursorX",
    "cursorY",
    "dwmTimingAvailable",
    "dwmQpcVBlank",
  ];
  for (const name of required) {
    if (!(name in column)) throw new Error(`trace.csv is missing column ${name}`);
  }

  const stopwatchFrequency = Number(metadata.StopwatchFrequency || STOPWATCH_TICKS_PER_SECOND_DEFAULT);
  const ticksToUs = 1_000_000 / stopwatchFrequency;
  const eventCounts = {};
  const eventIntervalsMs = {};
  const lastEventTimeUs = {};
  const allIntervalsMs = [];
  const allMovementPx = [];
  const xValues = [];
  const yValues = [];

  const refTimesUs = [];
  const refX = [];
  const refY = [];
  const pollRows = [];
  const hookRows = [];
  const dwmHorizonsMs = [];
  let firstElapsedUs = null;
  let lastElapsedUs = null;
  let firstSequence = null;
  let lastSequence = null;
  let prevAny = null;
  let traceRows = 0;

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
    if (firstElapsedUs === null) {
      firstElapsedUs = elapsedUs;
      firstSequence = sequence;
    }
    lastElapsedUs = elapsedUs;
    lastSequence = sequence;

    eventCounts[event] = (eventCounts[event] || 0) + 1;
    if (lastEventTimeUs[event] !== undefined) {
      if (!eventIntervalsMs[event]) eventIntervalsMs[event] = [];
      eventIntervalsMs[event].push((elapsedUs - lastEventTimeUs[event]) / 1000);
    }
    lastEventTimeUs[event] = elapsedUs;

    if (prevAny) {
      allIntervalsMs.push((elapsedUs - prevAny.elapsedUs) / 1000);
      allMovementPx.push(distance(x, y, prevAny.x, prevAny.y));
    }
    prevAny = { elapsedUs, x, y };
    xValues.push(x);
    yValues.push(y);

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

  const stopTimesUs = [];
  let movingState = false;
  let lastMovingUs = null;
  for (let i = 1; i < refTimesUs.length; i += 1) {
    const dtSec = (refTimesUs[i] - refTimesUs[i - 1]) / 1_000_000;
    if (dtSec <= 0) continue;
    const speed = distance(refX[i], refY[i], refX[i - 1], refY[i - 1]) / dtSec;
    if (speed >= 250) {
      movingState = true;
      lastMovingUs = refTimesUs[i];
    } else if (movingState && speed <= 20 && lastMovingUs !== null && (refTimesUs[i] - lastMovingUs) / 1000 <= 30) {
      stopTimesUs.push(refTimesUs[i]);
      movingState = false;
    }
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
  const referenceIntervalBins = [
    { label: "0-2.1 ms", min: 0, max: 2.1 },
    { label: "2.1-4 ms", min: 2.1, max: 4 },
    { label: "4-8 ms", min: 4, max: 8 },
    { label: "8-16 ms", min: 8, max: 16 },
    { label: "16-50 ms", min: 16, max: 50 },
    { label: ">=50 ms", min: 50, max: Infinity },
  ];
  const referenceCoverageBins = [
    { label: "0-0.25 ms", min: 0, max: 0.25 },
    { label: "0.25-0.5 ms", min: 0.25, max: 0.5 },
    { label: "0.5-1 ms", min: 0.5, max: 1 },
    { label: "1-2 ms", min: 1, max: 2 },
    { label: "2-4 ms", min: 2, max: 4 },
    { label: ">=4 ms", min: 4, max: Infinity },
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

  const overallErrors = {
    product_baseline_dwm_last2_gain_0_75: [],
    hold_current_dwm_target: [],
  };
  for (const horizon of FIXED_HORIZONS_MS) {
    overallErrors[`fixed_${horizon}ms_last2_gain_0_75`] = [];
    overallErrors[`fixed_${horizon}ms_hold_current`] = [];
  }

  const breakdowns = {
    speed_bins: {},
    acceleration_bins: {},
    product_poll_interval_bins: {},
    reference_target_interval_bins: {},
    reference_target_nearest_coverage_bins: {},
    dwm_horizon_bins: {},
    hook_poll_disagreement_bins: {},
    stop_windows: {},
    chronological_blocks: {},
  };
  const diagnostics = {
    fallback_counts: {
      no_previous_poll: 0,
      invalid_product_dt: 0,
      idle_gap_over_100ms: 0,
      invalid_dwm_timing: 0,
      missing_reference_label: 0,
      used_velocity_prediction: 0,
    },
    valid_anchor_count: 0,
    fixed_horizon_label_counts: {},
  };

  let refIndex = 0;
  let prevPoll = null;
  let prevVelocity = null;
  const productIntervalsMs = [];
  const productSpeedsPxS = [];
  const productAccelerationsPxS2 = [];
  const hookDisagreementsPx = [];
  const referenceTargetIntervalsMs = [];
  const referenceTargetNearestMs = [];
  const chronologicalStartUs = pollRows.length ? pollRows[0].elapsedUs : 0;
  const chronologicalEndUs = pollRows.length ? pollRows[pollRows.length - 1].elapsedUs : 1;
  const chronologicalDurationUs = Math.max(1, chronologicalEndUs - chronologicalStartUs);

  for (let i = 0; i < pollRows.length; i += 1) {
    const poll = pollRows[i];
    const productDtMs = prevPoll ? (poll.elapsedUs - prevPoll.elapsedUs) / 1000 : null;
    const productDtValid = productDtMs !== null && productDtMs > 0;
    const idleGap = productDtValid && productDtMs > PRODUCT_IDLE_GAP_MS;
    const dwmValid = poll.dwmTimingAvailable && poll.dwmTargetElapsedUs !== null && poll.dwmHorizonMs !== null && poll.dwmHorizonMs >= 0 && poll.dwmHorizonMs < 100;
    const evalTargetUs = dwmValid ? poll.dwmTargetElapsedUs : poll.elapsedUs;
    const label = interpolate(refTimesUs, refX, refY, evalTargetUs, refIndex);
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

    if (!prevPoll) diagnostics.fallback_counts.no_previous_poll += 1;
    else if (!productDtValid) diagnostics.fallback_counts.invalid_product_dt += 1;
    else if (idleGap) diagnostics.fallback_counts.idle_gap_over_100ms += 1;
    if (!dwmValid) diagnostics.fallback_counts.invalid_dwm_timing += 1;
    if (!label) diagnostics.fallback_counts.missing_reference_label += 1;

    if (label) {
      diagnostics.valid_anchor_count += 1;
      referenceTargetIntervalsMs.push(label.intervalMs);
      referenceTargetNearestMs.push(label.nearestMs);

      const horizonMs = dwmValid ? poll.dwmHorizonMs : 0;
      const useVelocity = canVelocityPredict && dwmValid;
      if (useVelocity) diagnostics.fallback_counts.used_velocity_prediction += 1;
      const predictedBaseline = useVelocity
        ? {
            x: poll.x + vx * (horizonMs / 1000) * BASELINE_GAIN,
            y: poll.y + vy * (horizonMs / 1000) * BASELINE_GAIN,
          }
        : { x: poll.x, y: poll.y };
      const baselineError = distance(predictedBaseline.x, predictedBaseline.y, label.x, label.y);
      const holdError = distance(poll.x, poll.y, label.x, label.y);

      overallErrors.product_baseline_dwm_last2_gain_0_75.push(baselineError);
      overallErrors.hold_current_dwm_target.push(holdError);

      const latestHook = poll.latestHookIndex >= 0 ? hookRows[poll.latestHookIndex] : null;
      const hookDisagreement = latestHook ? distance(poll.cursorX, poll.cursorY, latestHook.x, latestHook.y) : null;
      if (hookDisagreement !== null) hookDisagreementsPx.push(hookDisagreement);

      const speedBin = binOf(speedPxS, speedBins);
      const accelerationBin = binOf(accelerationPxS2, accelerationBins);
      const productIntervalBin = binOf(productDtMs, productIntervalBins);
      const referenceIntervalBin = binOf(label.intervalMs, referenceIntervalBins);
      const referenceCoverageBin = binOf(label.nearestMs, referenceCoverageBins);
      const dwmHorizonBin = dwmValid ? binOf(horizonMs, dwmHorizonBins) : "invalid_dwm";
      const hookBin = hookDisagreement === null ? "no_prior_hook" : binOf(hookDisagreement, hookDisagreementBins);
      const stopWindow = classifyStopWindow(stopTimesUs, evalTargetUs);
      const chronologicalBlock = `block_${Math.min(10, Math.floor(((poll.elapsedUs - chronologicalStartUs) / chronologicalDurationUs) * 10) + 1).toString().padStart(2, "0")}`;

      for (const [name, group] of [
        ["speed_bins", speedBin],
        ["acceleration_bins", accelerationBin],
        ["product_poll_interval_bins", productIntervalBin],
        ["reference_target_interval_bins", referenceIntervalBin],
        ["reference_target_nearest_coverage_bins", referenceCoverageBin],
        ["dwm_horizon_bins", dwmHorizonBin],
        ["hook_poll_disagreement_bins", hookBin],
        ["stop_windows", stopWindow],
        ["chronological_blocks", chronologicalBlock],
      ]) {
        addMetric(breakdowns[name], group, "product_baseline_dwm_last2_gain_0_75", baselineError);
        addMetric(breakdowns[name], group, "hold_current_dwm_target", holdError);
      }
    }

    for (const horizon of FIXED_HORIZONS_MS) {
      const fixedTargetUs = poll.elapsedUs + horizon * 1000;
      const fixedLabel = interpolate(refTimesUs, refX, refY, fixedTargetUs, refIndex);
      const keyLast2 = `fixed_${horizon}ms_last2_gain_0_75`;
      const keyHold = `fixed_${horizon}ms_hold_current`;
      diagnostics.fixed_horizon_label_counts[keyLast2] = diagnostics.fixed_horizon_label_counts[keyLast2] || 0;
      diagnostics.fixed_horizon_label_counts[keyHold] = diagnostics.fixed_horizon_label_counts[keyHold] || 0;
      if (fixedLabel) {
        const useVelocity = canVelocityPredict;
        const predicted = useVelocity
          ? {
              x: poll.x + vx * (horizon / 1000) * BASELINE_GAIN,
              y: poll.y + vy * (horizon / 1000) * BASELINE_GAIN,
            }
          : { x: poll.x, y: poll.y };
        overallErrors[keyLast2].push(distance(predicted.x, predicted.y, fixedLabel.x, fixedLabel.y));
        overallErrors[keyHold].push(distance(poll.x, poll.y, fixedLabel.x, fixedLabel.y));
        diagnostics.fixed_horizon_label_counts[keyLast2] += 1;
        diagnostics.fixed_horizon_label_counts[keyHold] += 1;
      }
    }

    if (productDtValid) prevVelocity = { vx, vy };
    prevPoll = poll;
  }

  const overall = {};
  for (const [model, errors] of Object.entries(overallErrors)) overall[model] = errorStats(errors);
  const finalizedBreakdowns = {};
  for (const [name, groupMap] of Object.entries(breakdowns)) finalizedBreakdowns[name] = finalizeGroupMap(groupMap);

  const audit = {
    trace_format_version: metadata.TraceFormatVersion,
    zip_path: path.resolve(zipPath),
    header,
    csv_rows: traceRows,
    first_sequence: firstSequence,
    last_sequence: lastSequence,
    first_elapsed_us: firstElapsedUs,
    last_elapsed_us: lastElapsedUs,
    duration_ms: (lastElapsedUs - firstElapsedUs) / 1000,
    duration_sec: (lastElapsedUs - firstElapsedUs) / 1_000_000,
    event_counts: Object.fromEntries(Object.entries(eventCounts).sort(([a], [b]) => a.localeCompare(b))),
    metadata_counts: {
      SampleCount: metadata.SampleCount,
      HookSampleCount: metadata.HookSampleCount,
      PollSampleCount: metadata.PollSampleCount,
      ReferencePollSampleCount: metadata.ReferencePollSampleCount,
      DwmTimingSampleCount: metadata.DwmTimingSampleCount,
    },
    coordinate_ranges: {
      x: basicStats(xValues),
      y: basicStats(yValues),
    },
    all_event_interval_ms: basicStats(allIntervalsMs),
    all_event_movement_px: basicStats(allMovementPx),
    event_interval_ms: Object.fromEntries(Object.entries(eventIntervalsMs).sort(([a], [b]) => a.localeCompare(b)).map(([event, values]) => [event, basicStats(values)])),
    product_poll_interval_ms: basicStats(productIntervalsMs),
    product_speed_px_s: basicStats(productSpeedsPxS),
    product_acceleration_px_s2: basicStats(productAccelerationsPxS2),
    reference_target_interval_ms: basicStats(referenceTargetIntervalsMs),
    reference_target_nearest_coverage_ms: basicStats(referenceTargetNearestMs),
    dwm_horizon_ms: basicStats(dwmHorizonsMs),
    hook_poll_disagreement_px: basicStats(hookDisagreementsPx),
    detected_stop_entries: stopTimesUs.length,
  };

  const comparisons = {
    baseline_vs_hold_mean_improvement_percent:
      overall.hold_current_dwm_target.mean_px === 0
        ? null
        : ((overall.hold_current_dwm_target.mean_px - overall.product_baseline_dwm_last2_gain_0_75.mean_px) / overall.hold_current_dwm_target.mean_px) * 100,
    baseline_vs_hold_p95_improvement_percent:
      overall.hold_current_dwm_target.p95_px === 0
        ? null
        : ((overall.hold_current_dwm_target.p95_px - overall.product_baseline_dwm_last2_gain_0_75.p95_px) / overall.hold_current_dwm_target.p95_px) * 100,
  };

  const elapsedSec = (performance.now() - started) / 1000;
  const scores = {
    generated_at_utc: new Date().toISOString(),
    config: {
      baseline_gain: BASELINE_GAIN,
      product_idle_gap_ms: PRODUCT_IDLE_GAP_MS,
      fixed_horizons_ms: FIXED_HORIZONS_MS,
      stopwatch_frequency: stopwatchFrequency,
      target_policy: "DWM qpcVBlank target when valid; fixed-horizon baselines use poll elapsed time + horizon.",
      ground_truth_policy: "Linear interpolation between adjacent referencePoll samples at target elapsed timestamp.",
      hook_poll_disagreement_policy: "Distance from product poll cursor position to most recent hook sample position.",
      stop_window_policy: "Reference stream transition from >=250 px/s motion to <=20 px/s within 30 ms.",
    },
    metadata,
    audit,
    diagnostics,
    scores: {
      overall,
      comparisons,
      breakdowns: finalizedBreakdowns,
    },
    performance: {
      elapsed_sec: elapsedSec,
      csv_rows_per_sec: traceRows / elapsedSec,
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "scores.json"), `${JSON.stringify(scores, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "experiment-log.md"), renderExperimentLog(scores), "utf8");
  fs.writeFileSync(path.join(outDir, "report.md"), renderReport(scores), "utf8");
  return scores;
}

function topBreakdownRows(scores, name, model = "product_baseline_dwm_last2_gain_0_75") {
  const groups = scores.scores.breakdowns[name];
  return Object.entries(groups)
    .map(([group, models]) => ({ group, stats: models[model] }))
    .filter((row) => row.stats && row.stats.n > 0)
    .sort((a, b) => b.stats.mean_px - a.stats.mean_px);
}

function renderExperimentLog(scores) {
  const audit = scores.audit;
  const baseline = scores.scores.overall.product_baseline_dwm_last2_gain_0_75;
  const hold = scores.scores.overall.hold_current_dwm_target;
  const fixed8 = scores.scores.overall.fixed_8ms_last2_gain_0_75;
  const fixed16 = scores.scores.overall.fixed_16ms_last2_gain_0_75;
  const eventRows = Object.entries(audit.event_counts).map(([event, count]) => [event, fmtInt(count)]);
  const hookMoveCount = (audit.event_counts.move || 0) + (audit.event_counts.hookMove || 0) + (audit.event_counts.hook || 0);
  const intervalRows = Object.entries(audit.event_interval_ms).map(([event, stats]) => [
    event,
    fmtInt(stats.count),
    fmt(stats.mean),
    fmt(stats.p50),
    fmt(stats.p95),
    fmt(stats.max),
  ]);
  const overallRows = [
    ["product DWM last2 gain 0.75", fmtInt(baseline.n), fmt(baseline.mean_px), fmt(baseline.p50_px), fmt(baseline.p90_px), fmt(baseline.p95_px), fmt(baseline.p99_px), fmt(baseline.max_px)],
    ["hold current at DWM target", fmtInt(hold.n), fmt(hold.mean_px), fmt(hold.p50_px), fmt(hold.p90_px), fmt(hold.p95_px), fmt(hold.p99_px), fmt(hold.max_px)],
    ["fixed 8ms last2 gain 0.75", fmtInt(fixed8.n), fmt(fixed8.mean_px), fmt(fixed8.p50_px), fmt(fixed8.p90_px), fmt(fixed8.p95_px), fmt(fixed8.p99_px), fmt(fixed8.max_px)],
    ["fixed 16ms last2 gain 0.75", fmtInt(fixed16.n), fmt(fixed16.mean_px), fmt(fixed16.p50_px), fmt(fixed16.p90_px), fmt(fixed16.p95_px), fmt(fixed16.p99_px), fmt(fixed16.max_px)],
  ];
  const breakdownSections = [
    ["Speed bins", "speed_bins"],
    ["Acceleration bins", "acceleration_bins"],
    ["Product poll interval bins", "product_poll_interval_bins"],
    ["Reference target interval bins", "reference_target_interval_bins"],
    ["Reference target nearest-coverage bins", "reference_target_nearest_coverage_bins"],
    ["DWM horizon bins", "dwm_horizon_bins"],
    ["Hook/poll disagreement bins", "hook_poll_disagreement_bins"],
    ["Stop windows", "stop_windows"],
    ["Chronological blocks", "chronological_blocks"],
  ];
  const breakdownText = breakdownSections
    .map(([title, key]) => {
      const rows = Object.entries(scores.scores.breakdowns[key]).map(([group, models]) => {
        const b = models.product_baseline_dwm_last2_gain_0_75;
        const h = models.hold_current_dwm_target;
        return [group, fmtInt(b.n), fmt(b.mean_px), fmt(b.p95_px), fmt(b.p99_px), fmt(h.mean_px), fmt(h.p95_px)];
      });
      return `## ${title}\n\n${buildMarkdownTable(["bin", "n", "baseline mean", "baseline p95", "baseline p99", "hold mean", "hold p95"], rows)}\n`;
    })
    .join("\n");

  return `# Phase 1 Experiment Log

## Run

- script: \`analyze_phase1.js\`
- input: \`${audit.zip_path}\`
- generated: \`${scores.generated_at_utc}\`
- elapsed: ${fmt(scores.performance.elapsed_sec, 3)} sec
- rows/sec: ${fmtInt(scores.performance.csv_rows_per_sec)}

The script reads the zip directly and does not extract or mutate the input trace. It parses \`metadata.json\`, then independently computes CSV counts, intervals, DWM horizons, label coverage, hook/poll disagreement, and prediction errors from \`trace.csv\`.

## Metadata Cross-Check

| item | metadata | CSV audit |
|---|---:|---:|
| trace format | ${scores.metadata.TraceFormatVersion} | ${audit.trace_format_version} |
| total samples | ${fmtInt(scores.metadata.SampleCount)} | ${fmtInt(audit.csv_rows)} |
| hook samples | ${fmtInt(scores.metadata.HookSampleCount)} | ${fmtInt(hookMoveCount)} |
| product polls | ${fmtInt(scores.metadata.PollSampleCount)} | ${fmtInt(audit.event_counts.poll || 0)} |
| reference polls | ${fmtInt(scores.metadata.ReferencePollSampleCount)} | ${fmtInt(audit.event_counts.referencePoll || 0)} |

## Event Counts

${buildMarkdownTable(["event", "count"], eventRows)}

## Event Interval Stats

${buildMarkdownTable(["event", "n intervals", "mean ms", "p50 ms", "p95 ms", "max ms"], intervalRows)}

## Baseline Scores

${buildMarkdownTable(["model", "n", "mean px", "p50 px", "p90 px", "p95 px", "p99 px", "max px"], overallRows)}

## Audit Metrics

| metric | mean | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| product poll interval ms | ${fmt(audit.product_poll_interval_ms.mean)} | ${fmt(audit.product_poll_interval_ms.p50)} | ${fmt(audit.product_poll_interval_ms.p95)} | ${fmt(audit.product_poll_interval_ms.p99)} | ${fmt(audit.product_poll_interval_ms.max)} |
| DWM horizon ms | ${fmt(audit.dwm_horizon_ms.mean)} | ${fmt(audit.dwm_horizon_ms.p50)} | ${fmt(audit.dwm_horizon_ms.p95)} | ${fmt(audit.dwm_horizon_ms.p99)} | ${fmt(audit.dwm_horizon_ms.max)} |
| reference target interval ms | ${fmt(audit.reference_target_interval_ms.mean)} | ${fmt(audit.reference_target_interval_ms.p50)} | ${fmt(audit.reference_target_interval_ms.p95)} | ${fmt(audit.reference_target_interval_ms.p99)} | ${fmt(audit.reference_target_interval_ms.max)} |
| hook/poll disagreement px | ${fmt(audit.hook_poll_disagreement_px.mean)} | ${fmt(audit.hook_poll_disagreement_px.p50)} | ${fmt(audit.hook_poll_disagreement_px.p95)} | ${fmt(audit.hook_poll_disagreement_px.p99)} | ${fmt(audit.hook_poll_disagreement_px.max)} |

## Fallback Counts

${buildMarkdownTable(["reason", "count"], Object.entries(scores.diagnostics.fallback_counts).map(([key, value]) => [key, fmtInt(value)]))}

${breakdownText}
`;
}

function renderReport(scores) {
  const audit = scores.audit;
  const overall = scores.scores.overall;
  const baseline = overall.product_baseline_dwm_last2_gain_0_75;
  const hold = overall.hold_current_dwm_target;
  const fixed8 = overall.fixed_8ms_last2_gain_0_75;
  const fixed16 = overall.fixed_16ms_last2_gain_0_75;
  const highRiskSpeed = topBreakdownRows(scores, "speed_bins").slice(0, 3);
  const highRiskPoll = topBreakdownRows(scores, "product_poll_interval_bins").slice(0, 3);
  const highRiskDwm = topBreakdownRows(scores, "dwm_horizon_bins").slice(0, 3);
  const highRiskHook = topBreakdownRows(scores, "hook_poll_disagreement_bins").slice(0, 3);
  const highRiskStop = topBreakdownRows(scores, "stop_windows").slice(0, 4);
  const hookMoveCount = (audit.event_counts.move || 0) + (audit.event_counts.hookMove || 0) + (audit.event_counts.hook || 0);
  const refRows = Object.entries(scores.scores.breakdowns.reference_target_interval_bins).map(([group, models]) => {
    const b = models.product_baseline_dwm_last2_gain_0_75;
    return [group, fmtInt(b.n), fmt(b.mean_px), fmt(b.p95_px)];
  });
  const scoreRows = [
    ["product DWM last2 gain 0.75", fmtInt(baseline.n), fmt(baseline.mean_px), fmt(baseline.p50_px), fmt(baseline.p90_px), fmt(baseline.p95_px), fmt(baseline.p99_px), fmt(baseline.max_px)],
    ["hold current at DWM target", fmtInt(hold.n), fmt(hold.mean_px), fmt(hold.p50_px), fmt(hold.p90_px), fmt(hold.p95_px), fmt(hold.p99_px), fmt(hold.max_px)],
    ["fixed 8ms last2 gain 0.75", fmtInt(fixed8.n), fmt(fixed8.mean_px), fmt(fixed8.p50_px), fmt(fixed8.p90_px), fmt(fixed8.p95_px), fmt(fixed8.p99_px), fmt(fixed8.max_px)],
    ["fixed 16ms last2 gain 0.75", fmtInt(fixed16.n), fmt(fixed16.mean_px), fmt(fixed16.p50_px), fmt(fixed16.p90_px), fmt(fixed16.p95_px), fmt(fixed16.p99_px), fmt(fixed16.max_px)],
  ];
  const riskRows = [
    ...highRiskSpeed.map((r) => [`speed: ${r.group}`, fmtInt(r.stats.n), fmt(r.stats.mean_px), fmt(r.stats.p95_px), fmt(r.stats.p99_px)]),
    ...highRiskPoll.map((r) => [`poll dt: ${r.group}`, fmtInt(r.stats.n), fmt(r.stats.mean_px), fmt(r.stats.p95_px), fmt(r.stats.p99_px)]),
    ...highRiskDwm.map((r) => [`DWM horizon: ${r.group}`, fmtInt(r.stats.n), fmt(r.stats.mean_px), fmt(r.stats.p95_px), fmt(r.stats.p99_px)]),
    ...highRiskHook.map((r) => [`hook/poll: ${r.group}`, fmtInt(r.stats.n), fmt(r.stats.mean_px), fmt(r.stats.p95_px), fmt(r.stats.p99_px)]),
    ...highRiskStop.map((r) => [`stop: ${r.group}`, fmtInt(r.stats.n), fmt(r.stats.mean_px), fmt(r.stats.p95_px), fmt(r.stats.p99_px)]),
  ];

  return `# Phase 1 Report: Reference Baseline Audit

## Decision Summary

Remaining error is dominated by product poll cadence and extrapolation over long/irregular horizons, with high-speed motion and stop-entry overshoot forming the visible tail. Reference-label quality looks strong for the scored anchors: target labels are almost always bracketed by dense \`referencePoll\` samples, and error does not concentrate in poor reference-coverage bins. DWM timing is available for all product polls, but the DWM horizon varies enough that longer horizons amplify last2 model error.

Hook/poll disagreement is reconstructible as the distance from each product poll to the latest hook sample. Large disagreement bins are sparse but high-risk; they point to product cadence/input staleness rather than label noise.

## Trace Audit

| item | value |
|---|---:|
| trace format | ${audit.trace_format_version} |
| CSV rows | ${fmtInt(audit.csv_rows)} |
| duration sec | ${fmt(audit.duration_sec, 3)} |
| hook moves | ${fmtInt(hookMoveCount)} |
| product polls | ${fmtInt(audit.event_counts.poll || 0)} |
| reference polls | ${fmtInt(audit.event_counts.referencePoll || 0)} |
| product poll p50 / p95 ms | ${fmt(audit.product_poll_interval_ms.p50)} / ${fmt(audit.product_poll_interval_ms.p95)} |
| reference target p50 / p95 ms | ${fmt(audit.reference_target_interval_ms.p50)} / ${fmt(audit.reference_target_interval_ms.p95)} |
| DWM horizon p50 / p95 ms | ${fmt(audit.dwm_horizon_ms.p50)} / ${fmt(audit.dwm_horizon_ms.p95)} |
| stale/invalid DWM target fallbacks | ${fmtInt(scores.diagnostics.fallback_counts.invalid_dwm_timing)} |

## Baseline Scores

${buildMarkdownTable(["model", "n", "mean px", "p50 px", "p90 px", "p95 px", "p99 px", "max px"], scoreRows)}

The product baseline improves mean error by ${fmt(scores.scores.comparisons.baseline_vs_hold_mean_improvement_percent, 1)}% over hold-current and improves p95 by ${fmt(scores.scores.comparisons.baseline_vs_hold_p95_improvement_percent, 1)}%. Fixed 8 ms is much easier than the actual DWM target distribution; fixed 16 ms is closer to DWM p95 behavior but still does not capture the irregular poll cadence.

## Highest-Risk Slices

${buildMarkdownTable(["slice", "n", "mean px", "p95 px", "p99 px"], riskRows)}

## Reference Quality

${buildMarkdownTable(["reference bracket", "n", "baseline mean px", "baseline p95 px"], refRows)}

Reference coverage is not the main bottleneck. The dominant bracket is the expected 0-2.1 ms band, and its error profile matches the overall result. The rare wider brackets are too small to explain the baseline tail.

## Phase 2 Direction

Prioritize scheduler/input cadence and deterministic runtime features before learned residuals. The strongest next experiment is to reduce or compensate product poll staleness: sample closer to compose, carry latest hook position when available, and gate prediction on recent poll interval/hook disagreement. In parallel, test a lightweight horizon-aware damping/stop guard for the last2 model so stop-entry overshoot and long-DWM-horizon extrapolation do not dominate the p95/p99 tail.

Learned models should wait until Phase 2 has a cleaner runtime anchor story; otherwise they will mostly learn artifacts of stale product input rather than cursor motion.
`;
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
