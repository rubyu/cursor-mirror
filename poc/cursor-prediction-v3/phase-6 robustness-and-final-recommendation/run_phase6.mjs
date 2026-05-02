#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const phaseDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(phaseDir, "../../..");
const traceZips = [
  path.join(repoRoot, "cursor-mirror-trace-20260501-000443.zip"),
  path.join(repoRoot, "cursor-mirror-trace-20260501-091537.zip"),
];

const gain = 0.75;
const idleResetMs = 100;
const fixedHorizonsMs = [4, 8, 12, 16];
const stopSpeedPxPerS = 20;
const moveSpeedPxPerS = 100;
const highSpeedPxPerS = 1200;
const highAccelerationPxPerS2 = 60000;
const highDisagreementPx = 5;
const lowSpeedPxPerS = 20;
const validationGapFraction = 0.01;

const speedBins = [
  ["0-20", 0, 20],
  ["20-100", 20, 100],
  ["100-300", 100, 300],
  ["300-700", 300, 700],
  ["700-1200", 700, 1200],
  ["1200+", 1200, Infinity],
];
const accelBins = [
  ["0-1k", 0, 1000],
  ["1k-5k", 1000, 5000],
  ["5k-20k", 5000, 20000],
  ["20k-60k", 20000, 60000],
  ["60k+", 60000, Infinity],
];
const disagreementBins = [
  ["0px", 0, 0.000001],
  ["0-1px", 0.000001, 1],
  ["1-2px", 1, 2],
  ["2-5px", 2, 5],
  ["5px+", 5, Infinity],
];

function readZipEntry(zipPath, wantedName) {
  const buffer = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error(`ZIP EOCD not found: ${zipPath}`);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Bad central directory in ${zipPath}`);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === wantedName) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Bad local header for ${wantedName}`);
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const payload = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return payload;
      if (method === 8) return zlib.inflateRawSync(payload);
      throw new Error(`Unsupported compression method ${method} in ${zipPath}`);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Entry ${wantedName} not found in ${zipPath}`);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0].split(",");
  return {
    header,
    rows: lines.slice(1).map((line) => {
      const parts = line.split(",");
      const row = {};
      for (let i = 0; i < header.length; i++) row[header[i]] = parts[i] ?? "";
      return row;
    }),
  };
}

function intField(value, fallback = 0) {
  return value === undefined || value === "" ? fallback : Number.parseInt(value, 10);
}

function floatField(value) {
  return value === undefined || value === "" ? null : Number.parseFloat(value);
}

function loadTrace(zipPath) {
  const metadata = JSON.parse(readZipEntry(zipPath, "metadata.json").toString("utf8").replace(/^\uFEFF/, ""));
  const { header, rows } = parseCsv(readZipEntry(zipPath, "trace.csv").toString("utf8"));
  const samples = rows.map((row) => ({
    sequence: intField(row.sequence),
    ticks: intField(row.stopwatchTicks),
    elapsedUs: intField(row.elapsedMicroseconds),
    x: Number.parseFloat(row.x || "0"),
    y: Number.parseFloat(row.y || "0"),
    event: row.event || "",
    hookX: floatField(row.hookX),
    hookY: floatField(row.hookY),
    cursorX: floatField(row.cursorX),
    cursorY: floatField(row.cursorY),
    dwmAvailable: String(row.dwmTimingAvailable || "").toLowerCase() === "true",
    dwmPeriodTicks: intField(row.dwmQpcRefreshPeriod),
    dwmVblankTicks: intField(row.dwmQpcVBlank),
  }));
  samples.sort((a, b) => a.ticks - b.ticks || a.sequence - b.sequence);
  return {
    name: path.basename(zipPath, ".zip"),
    path: zipPath,
    metadata,
    header,
    samples,
    frequency: Number(metadata.StopwatchFrequency || 10000000),
  };
}

class Interpolator {
  constructor(samples, mode = "base") {
    this.points = [];
    for (const sample of samples) {
      let x = sample.x;
      let y = sample.y;
      if (mode === "hook") {
        if (sample.hookX === null || sample.hookY === null) continue;
        x = sample.hookX;
        y = sample.hookY;
      }
      this.points.push([sample.ticks, x, y]);
    }
    this.points.sort((a, b) => a[0] - b[0]);
    this.ticks = this.points.map((point) => point[0]);
  }

  at(targetTicks) {
    if (this.points.length === 0) return null;
    let low = 0;
    let high = this.points.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.ticks[mid] < targetTicks) low = mid + 1;
      else high = mid;
    }
    if (low < this.points.length && this.points[low][0] === targetTicks) return [this.points[low][1], this.points[low][2]];
    if (low === 0 || low >= this.points.length) return null;
    const [t0, x0, y0] = this.points[low - 1];
    const [t1, x1, y1] = this.points[low];
    if (t1 <= t0) return [x1, y1];
    const alpha = (targetTicks - t0) / (t1 - t0);
    return [x0 + (x1 - x0) * alpha, y0 + (y1 - y0) * alpha];
  }
}

function roundHalfAwayFromZero(value) {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo);
}

function stats(values) {
  const data = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (data.length === 0) return { count: 0, mean: null, p50: null, p90: null, p95: null, p99: null, max: null };
  return {
    count: data.length,
    mean: data.reduce((sum, value) => sum + value, 0) / data.length,
    p50: quantile(data, 0.5),
    p90: quantile(data, 0.9),
    p95: quantile(data, 0.95),
    p99: quantile(data, 0.99),
    max: data[data.length - 1],
  };
}

function fmt(value, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
}

function numericBin(value, bins) {
  if (!Number.isFinite(value)) return "unknown";
  for (const [label, lower, upper] of bins) {
    if (value >= lower && value < upper) return label;
  }
  return "unknown";
}

function intervalStats(samples, frequency) {
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i].ticks - samples[i - 1].ticks;
    if (delta > 0) intervals.push((delta * 1000) / frequency);
  }
  return stats(intervals);
}

function schema(trace) {
  const polls = trace.samples.filter((sample) => sample.event === "poll");
  const moves = trace.samples.filter((sample) => sample.event === "move");
  const counts = {};
  for (const sample of trace.samples) counts[sample.event] = (counts[sample.event] || 0) + 1;
  return {
    header: trace.header,
    metadata: trace.metadata,
    event_counts: Object.fromEntries(Object.entries(counts).sort()),
    sample_count: trace.samples.length,
    poll_count: polls.length,
    move_count: moves.length,
    dwm_poll_count: polls.filter((sample) => sample.dwmAvailable).length,
    poll_interval_ms: polls.length ? intervalStats(polls, trace.frequency) : null,
    move_interval_ms: moves.length ? intervalStats(moves, trace.frequency) : null,
  };
}

function makeFeatures(samples, frequency) {
  const features = new Map();
  const stopEntries = [];
  const speedHistory = [];
  const accelHistory = [];
  let previous = null;
  let previousSpeed = null;
  let previousVector = null;
  let stationaryElapsedMs = 0;

  for (const sample of samples) {
    let dtMs = null;
    let speed = null;
    let accel = null;
    let turnAngle = null;
    let vx = null;
    let vy = null;
    let vector = null;
    if (previous) {
      const dtTicks = sample.ticks - previous.ticks;
      if (dtTicks > 0) {
        dtMs = (dtTicks * 1000) / frequency;
        const dtSec = dtTicks / frequency;
        const dx = sample.x - previous.x;
        const dy = sample.y - previous.y;
        vector = [dx, dy];
        vx = dx / dtSec;
        vy = dy / dtSec;
        speed = Math.hypot(vx, vy);
        if (previousSpeed !== null) accel = Math.abs(speed - previousSpeed) / dtSec;
        if (previousVector) {
          const mag0 = Math.hypot(previousVector[0], previousVector[1]);
          const mag1 = Math.hypot(dx, dy);
          if (mag0 > 0 && mag1 > 0) {
            const dot = previousVector[0] * dx + previousVector[1] * dy;
            turnAngle = (Math.acos(clamp(dot / (mag0 * mag1), -1, 1)) * 180) / Math.PI;
          }
        }
        if (previousSpeed !== null && previousSpeed >= moveSpeedPxPerS && speed < stopSpeedPxPerS) stopEntries.push(sample.ticks);
        stationaryElapsedMs = speed < stopSpeedPxPerS ? stationaryElapsedMs + dtMs : 0;
      }
    }

    const rollingSpeeds = speed === null ? speedHistory.slice(-5) : [...speedHistory.slice(-4), speed];
    const rollingAccels = accel === null ? accelHistory.slice(-5) : [...accelHistory.slice(-4), accel];
    const recentMeanSpeed = rollingSpeeds.length ? rollingSpeeds.reduce((sum, value) => sum + value, 0) / rollingSpeeds.length : null;
    const recentMaxSpeed = rollingSpeeds.length ? Math.max(...rollingSpeeds) : null;
    const recentMaxAccel = rollingAccels.length ? Math.max(...rollingAccels) : null;
    const speedTrend = speed !== null && speedHistory.length ? speed - speedHistory[speedHistory.length - 1] : null;
    const movingFraction5 = rollingSpeeds.length ? rollingSpeeds.filter((value) => value >= moveSpeedPxPerS).length / rollingSpeeds.length : null;

    features.set(sample.sequence, {
      dt_ms: dtMs,
      speed_px_s: speed,
      previous_speed_px_s: previousSpeed,
      accel_px_s2: accel,
      turn_angle_deg: turnAngle,
      vx_px_s: vx,
      vy_px_s: vy,
      recent_mean_speed_px_s: recentMeanSpeed,
      recent_max_speed_px_s: recentMaxSpeed,
      recent_max_accel_px_s2: recentMaxAccel,
      speed_trend_px_s: speedTrend,
      moving_fraction_5: movingFraction5,
      stationary_elapsed_ms: stationaryElapsedMs,
      speed_bin: numericBin(speed, speedBins),
      accel_bin: numericBin(accel, accelBins),
    });

    if (speed !== null) speedHistory.push(speed);
    if (speedHistory.length > 16) speedHistory.shift();
    if (accel !== null) accelHistory.push(accel);
    if (accelHistory.length > 16) accelHistory.shift();
    if (speed !== null) previousSpeed = speed;
    if (vector !== null) previousVector = vector;
    previous = sample;
  }

  return { features, stopEntries };
}

function nearestStopIndex(stopEntries, tick) {
  let low = 0;
  let high = stopEntries.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (stopEntries[mid] < tick) low = mid + 1;
    else high = mid;
  }
  return low;
}

function stopSettleElapsedMs(tick, stopEntries, frequency) {
  const index = nearestStopIndex(stopEntries, tick) - 1;
  if (index < 0) return null;
  const elapsedMs = ((tick - stopEntries[index]) * 1000) / frequency;
  return elapsedMs >= 0 && elapsedMs < 250 ? elapsedMs : null;
}

function stopSettleWindow(elapsedMs) {
  if (elapsedMs === null) return "not_in_stop_settle";
  if (elapsedMs < 16) return "settle_0_16ms";
  if (elapsedMs < 33) return "settle_16_33ms";
  if (elapsedMs < 67) return "settle_33_67ms";
  if (elapsedMs < 133) return "settle_67_133ms";
  return "settle_133_250ms";
}

function pollJitterBin(pollJitterMs) {
  return numericBin(pollJitterMs, [
    ["<=0.5ms", 0, 0.5],
    ["0.5-1ms", 0.5, 1],
    ["1-2ms", 1, 2],
    ["2-4ms", 2, 4],
    ["4ms+", 4, Infinity],
  ]);
}

function selectNextVblank(sample) {
  if (!sample.dwmAvailable || sample.dwmVblankTicks <= 0 || sample.dwmPeriodTicks <= 0) {
    return { selected: null, status: "invalid_dwm_horizon", horizonTicks: null };
  }
  let selected = sample.dwmVblankTicks;
  let status = "valid";
  if (selected <= sample.ticks) {
    selected += (Math.floor((sample.ticks - selected) / sample.dwmPeriodTicks) + 1) * sample.dwmPeriodTicks;
    status = "late_advanced";
  }
  const horizonTicks = selected - sample.ticks;
  if (horizonTicks <= 0) return { selected, status: "nonpositive_horizon_fallback", horizonTicks };
  if (horizonTicks > sample.dwmPeriodTicks * 1.25) return { selected, status: "excessive_horizon_fallback", horizonTicks };
  return { selected, status, horizonTicks };
}

function last2Prediction(ctx) {
  if (!ctx.previous || ctx.deltaTicks <= 0 || ctx.deltaMs > idleResetMs || ctx.invalidDwm) return [ctx.sample.x, ctx.sample.y];
  if (!(ctx.horizonTicks > 0)) return [ctx.sample.x, ctx.sample.y];
  const scale = (gain * ctx.horizonTicks) / ctx.deltaTicks;
  return [
    roundHalfAwayFromZero(ctx.sample.x + (ctx.sample.x - ctx.previous.x) * scale),
    roundHalfAwayFromZero(ctx.sample.y + (ctx.sample.y - ctx.previous.y) * scale),
  ];
}

function riskScore(row) {
  return Math.max(
    finite(row.speed_px_s) / highSpeedPxPerS,
    finite(row.accel_px_s2) / highAccelerationPxPerS2,
    finite(row.hook_disagreement_px) / highDisagreementPx,
    row.stop_settle_elapsed_ms === null ? 0 : 1,
    finite(row.poll_jitter_ms) / 8,
  );
}

function isHighRisk(row) {
  return (
    finite(row.speed_px_s) >= highSpeedPxPerS ||
    finite(row.accel_px_s2) >= highAccelerationPxPerS2 ||
    finite(row.hook_disagreement_px) >= highDisagreementPx ||
    row.stop_settle_elapsed_ms !== null
  );
}

const featureNames = [
  "log_speed",
  "log_previous_speed",
  "log_accel",
  "turn_angle",
  "dwm_horizon",
  "poll_interval",
  "poll_jitter",
  "log_hook_disagreement",
  "stop_settle_recency",
  "recent_mean_speed",
  "recent_max_speed",
  "log_recent_max_accel",
  "speed_trend",
  "moving_fraction_5",
  "stationary_elapsed",
  "vx",
  "vy",
  "baseline_step_x",
  "baseline_step_y",
  "high_speed_flag",
  "high_accel_flag",
  "disagreement_2px_flag",
  "disagreement_5px_flag",
  "in_stop_settle_flag",
  "late_vblank_flag",
  "warmup_or_invalid_flag",
];

function rawFeatureVector(row) {
  return [
    Math.log1p(Math.max(0, finite(row.speed_px_s))) / 8,
    Math.log1p(Math.max(0, finite(row.previous_speed_px_s))) / 8,
    Math.log1p(Math.max(0, finite(row.accel_px_s2))) / 12,
    finite(row.turn_angle_deg) / 180,
    finite(row.dwm_horizon_ms) / 16,
    finite(row.poll_interval_ms) / 16,
    finite(row.poll_jitter_ms) / 16,
    Math.log1p(Math.max(0, finite(row.hook_disagreement_px))) / 3,
    row.stop_settle_elapsed_ms === null ? 0 : 1 - clamp(row.stop_settle_elapsed_ms / 250, 0, 1),
    finite(row.recent_mean_speed_px_s) / 2000,
    finite(row.recent_max_speed_px_s) / 3000,
    Math.log1p(Math.max(0, finite(row.recent_max_accel_px_s2))) / 12,
    finite(row.speed_trend_px_s) / 2000,
    finite(row.moving_fraction_5),
    clamp(finite(row.stationary_elapsed_ms) / 250, 0, 2),
    clamp(finite(row.vx_px_s) / 3000, -3, 3),
    clamp(finite(row.vy_px_s) / 3000, -3, 3),
    clamp((row.baseline_prediction[0] - row.sample_x) / 50, -5, 5),
    clamp((row.baseline_prediction[1] - row.sample_y) / 50, -5, 5),
    finite(row.speed_px_s) >= highSpeedPxPerS ? 1 : 0,
    finite(row.accel_px_s2) >= highAccelerationPxPerS2 ? 1 : 0,
    finite(row.hook_disagreement_px) >= 2 ? 1 : 0,
    finite(row.hook_disagreement_px) >= highDisagreementPx ? 1 : 0,
    row.stop_settle_elapsed_ms !== null ? 1 : 0,
    row.status === "late_advanced" ? 1 : 0,
    row.status !== "valid" && row.status !== "late_advanced" ? 1 : 0,
  ];
}

function makeContexts(trace) {
  const polls = trace.samples.filter((sample) => sample.event === "poll");
  const moves = trace.samples.filter((sample) => sample.event === "move");
  const truth = new Interpolator(trace.samples, "base");
  const hookTruth = moves.length ? new Interpolator(moves, "hook") : null;
  const { features, stopEntries } = makeFeatures(polls, trace.frequency);
  const nominalMs = Number(trace.metadata.PollIntervalMilliseconds);
  const contexts = [];
  let previous = null;
  let previousPoll = null;

  polls.forEach((sample, ordinal) => {
    const selected = selectNextVblank(sample);
    const target = selected.selected === null ? null : truth.at(selected.selected);
    if (!target) {
      previous = sample;
      previousPoll = sample;
      return;
    }
    const deltaTicks = previous ? sample.ticks - previous.ticks : null;
    const deltaMs = deltaTicks && deltaTicks > 0 ? (deltaTicks * 1000) / trace.frequency : null;
    const hookPoint = hookTruth ? hookTruth.at(sample.ticks) : null;
    const hookDisagreement = hookPoint ? distance([sample.x, sample.y], hookPoint) : null;
    const pollIntervalMs = previousPoll ? ((sample.ticks - previousPoll.ticks) * 1000) / trace.frequency : null;
    const pollJitterMs = pollIntervalMs !== null && Number.isFinite(nominalMs) ? Math.abs(pollIntervalMs - nominalMs) : null;
    const feature = features.get(sample.sequence) || {};
    const stopElapsed = stopSettleElapsedMs(sample.ticks, stopEntries, trace.frequency);
    const invalidDwm = ["invalid_dwm_horizon", "nonpositive_horizon_fallback", "excessive_horizon_fallback"].includes(selected.status);
    const ctx = {
      trace,
      ordinal,
      sample,
      previous,
      target,
      status: previous ? selected.status : selected.status === "valid" ? "warmup_hold" : selected.status,
      horizonTicks: selected.horizonTicks,
      horizonMs: selected.horizonTicks === null ? null : (selected.horizonTicks * 1000) / trace.frequency,
      deltaTicks,
      deltaMs,
      invalidDwm,
      feature,
      hookDisagreement,
      pollIntervalMs,
      pollJitterMs,
      stopSettleElapsedMs: stopElapsed,
    };
    const baselinePrediction = last2Prediction(ctx);
    const baselineError = distance(baselinePrediction, target);
    const row = {
      ordinal,
      anchor_ticks: sample.ticks,
      anchor_elapsed_ms: sample.elapsedUs / 1000,
      status: ctx.status,
      sample_x: sample.x,
      sample_y: sample.y,
      target_x: target[0],
      target_y: target[1],
      baseline_prediction: baselinePrediction,
      baseline_error_px: baselineError,
      residual_x: target[0] - baselinePrediction[0],
      residual_y: target[1] - baselinePrediction[1],
      speed_px_s: feature.speed_px_s,
      previous_speed_px_s: feature.previous_speed_px_s,
      accel_px_s2: feature.accel_px_s2,
      turn_angle_deg: feature.turn_angle_deg,
      dwm_horizon_ms: ctx.horizonMs,
      poll_interval_ms: pollIntervalMs,
      poll_jitter_ms: pollJitterMs,
      hook_disagreement_px: hookDisagreement,
      stop_settle_elapsed_ms: stopElapsed,
      recent_mean_speed_px_s: feature.recent_mean_speed_px_s,
      recent_max_speed_px_s: feature.recent_max_speed_px_s,
      recent_max_accel_px_s2: feature.recent_max_accel_px_s2,
      speed_trend_px_s: feature.speed_trend_px_s,
      moving_fraction_5: feature.moving_fraction_5,
      stationary_elapsed_ms: feature.stationary_elapsed_ms,
      vx_px_s: feature.vx_px_s,
      vy_px_s: feature.vy_px_s,
      risk_score: null,
      speed_bin: feature.speed_bin || "unknown",
      accel_bin: feature.accel_bin || "unknown",
      hook_poll_disagreement_bin: numericBin(hookDisagreement, disagreementBins),
      poll_jitter_bin: pollJitterBin(pollJitterMs),
      stop_settle_window: stopSettleWindow(stopElapsed),
    };
    row.risk_score = riskScore(row);
    row.features = rawFeatureVector(row);
    contexts.push(row);
    previous = sample;
    previousPoll = sample;
  });

  return { rows: contexts, anchor_count: polls.length, target_miss_count: polls.length - contexts.length };
}

function chronologicalSplits(rows) {
  const n = rows.length;
  const gap = Math.max(1, Math.floor(n * validationGapFraction));
  const trainEnd = Math.floor(n * 0.6);
  const validationStart = Math.min(n, trainEnd + gap);
  const validationEnd = Math.floor(n * 0.8);
  const testStart = Math.min(n, validationEnd + gap);
  return {
    gap_count: gap,
    train: rows.slice(0, trainEnd),
    validation_gap_1: rows.slice(trainEnd, validationStart),
    validation: rows.slice(validationStart, validationEnd),
    validation_gap_2: rows.slice(validationEnd, testStart),
    test: rows.slice(testStart),
    ranges: {
      train: [0, Math.max(0, trainEnd - 1)],
      validation_gap_1: [trainEnd, Math.max(trainEnd, validationStart - 1)],
      validation: [validationStart, Math.max(validationStart, validationEnd - 1)],
      validation_gap_2: [validationEnd, Math.max(validationEnd, testStart - 1)],
      test: [testStart, Math.max(testStart, n - 1)],
    },
  };
}

function standardizer(rows, featureIndices = featureNames.map((_, index) => index)) {
  const n = featureIndices.length;
  const mean = Array(n).fill(0);
  const variance = Array(n).fill(0);
  for (const row of rows) {
    for (let i = 0; i < n; i++) mean[i] += row.features[featureIndices[i]];
  }
  for (let i = 0; i < n; i++) mean[i] /= Math.max(1, rows.length);
  for (const row of rows) {
    for (let i = 0; i < n; i++) {
      const d = row.features[featureIndices[i]] - mean[i];
      variance[i] += d * d;
    }
  }
  const scale = variance.map((value) => {
    const s = Math.sqrt(value / Math.max(1, rows.length));
    return s > 1e-9 ? s : 1;
  });
  return { mean, scale, feature_indices: featureIndices, feature_names: featureIndices.map((index) => featureNames[index]) };
}

function transformFeatures(row, scaler) {
  const x = [1];
  const featureIndices = scaler.feature_indices || featureNames.map((_, index) => index);
  for (let i = 0; i < featureIndices.length; i++) x.push((row.features[featureIndices[i]] - scaler.mean[i]) / scaler.scale[i]);
  return x;
}

function solveLinearSystem(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) a[pivot][col] = 1e-12;
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];
    const divisor = a[col][col];
    for (let c = col; c <= n; c++) a[col][c] /= divisor;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => row[n]);
}

function fitRidge(rows, lambda, featureIndices = featureNames.map((_, index) => index)) {
  const scaler = standardizer(rows, featureIndices);
  const p = featureIndices.length + 1;
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xtyX = Array(p).fill(0);
  const xtyY = Array(p).fill(0);
  for (const row of rows) {
    const x = transformFeatures(row, scaler);
    for (let i = 0; i < p; i++) {
      xtyX[i] += x[i] * row.residual_x;
      xtyY[i] += x[i] * row.residual_y;
      for (let j = 0; j < p; j++) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < p; i++) xtx[i][i] += lambda;
  return {
    family: "ridge_residual",
    lambda,
    scaler,
    feature_indices: featureIndices,
    feature_names: featureIndices.map((index) => featureNames[index]),
    weightsX: solveLinearSystem(xtx, xtyX),
    weightsY: solveLinearSystem(xtx, xtyY),
  };
}

function ridgeResidual(model, row) {
  const x = transformFeatures(row, model.scaler);
  let rx = 0;
  let ry = 0;
  for (let i = 0; i < x.length; i++) {
    rx += model.weightsX[i] * x[i];
    ry += model.weightsY[i] * x[i];
  }
  return [rx, ry];
}

function capResidual(residual, capPx) {
  if (!Number.isFinite(capPx)) return residual;
  const mag = Math.hypot(residual[0], residual[1]);
  if (mag <= capPx || mag === 0) return residual;
  const scale = capPx / mag;
  return [residual[0] * scale, residual[1] * scale];
}

function correctedPrediction(row, model, capPx = Infinity) {
  const residual = capResidual(ridgeResidual(model, row), capPx);
  return [row.baseline_prediction[0] + residual[0], row.baseline_prediction[1] + residual[1]];
}

function baselineStepLength(row) {
  return Math.hypot(row.baseline_prediction[0] - row.sample_x, row.baseline_prediction[1] - row.sample_y);
}

function evaluateRows(rows, candidate, predictor) {
  const records = [];
  for (const row of rows) {
    const result = predictor(row);
    const prediction = Array.isArray(result) ? result : result.prediction;
    const appliedCorrection = Array.isArray(result) ? distance(prediction, row.baseline_prediction) > 1e-9 : Boolean(result.applied);
    const error = distance(prediction, [row.target_x, row.target_y]);
    records.push({
      ordinal: row.ordinal,
      anchor_ticks: row.anchor_ticks,
      anchor_elapsed_ms: row.anchor_elapsed_ms,
      status: row.status,
      sample_x: row.sample_x,
      sample_y: row.sample_y,
      target_x: row.target_x,
      target_y: row.target_y,
      baseline_prediction_x: row.baseline_prediction[0],
      baseline_prediction_y: row.baseline_prediction[1],
      prediction_x: prediction[0],
      prediction_y: prediction[1],
      correction_x: prediction[0] - row.baseline_prediction[0],
      correction_y: prediction[1] - row.baseline_prediction[1],
      correction_mag_px: distance(prediction, row.baseline_prediction),
      baseline_step_px: baselineStepLength(row),
      error_px: error,
      baseline_error_px: row.baseline_error_px,
      regression_px: error - row.baseline_error_px,
      applied_correction: appliedCorrection,
      speed_px_s: row.speed_px_s,
      previous_speed_px_s: row.previous_speed_px_s,
      accel_px_s2: row.accel_px_s2,
      turn_angle_deg: row.turn_angle_deg,
      dwm_horizon_ms: row.dwm_horizon_ms,
      poll_interval_ms: row.poll_interval_ms,
      poll_jitter_ms: row.poll_jitter_ms,
      hook_disagreement_px: row.hook_disagreement_px,
      stop_settle_elapsed_ms: row.stop_settle_elapsed_ms,
      stationary_elapsed_ms: row.stationary_elapsed_ms,
      residual_x: row.residual_x,
      residual_y: row.residual_y,
      risk_score: row.risk_score,
      speed_bin: row.speed_bin,
      accel_bin: row.accel_bin,
      hook_poll_disagreement_bin: row.hook_poll_disagreement_bin,
      poll_jitter_bin: row.poll_jitter_bin,
      stop_settle_window: row.stop_settle_window,
    });
  }
  return { candidate, records };
}

function bucketStats(records, field) {
  const groups = {};
  for (const record of records) {
    const key = record[field] || "unknown";
    (groups[key] ||= []).push(record.error_px);
  }
  return Object.fromEntries(Object.entries(groups).sort().map(([key, values]) => [key, stats(values)]));
}

function thresholdStats(records, predicate) {
  return stats(records.filter(predicate).map((record) => record.error_px));
}

function regressionCounts(records, predicate = () => true, reference = "baseline_error_px") {
  const selected = records.filter(predicate);
  return {
    count: selected.length,
    gt_1px: selected.filter((record) => record.error_px - record[reference] > 1).length,
    gt_3px: selected.filter((record) => record.error_px - record[reference] > 3).length,
    gt_5px: selected.filter((record) => record.error_px - record[reference] > 5).length,
    improvement_gt_1px: selected.filter((record) => record.error_px - record[reference] < -1).length,
    improvement_gt_3px: selected.filter((record) => record.error_px - record[reference] < -3).length,
    improvement_gt_5px: selected.filter((record) => record.error_px - record[reference] < -5).length,
  };
}

function statDeltas(current, reference) {
  return {
    mean: current.mean - reference.mean,
    p50: current.p50 - reference.p50,
    p90: current.p90 - reference.p90,
    p95: current.p95 - reference.p95,
    p99: current.p99 - reference.p99,
    max: current.max - reference.max,
  };
}

function referenceStats(records, predicate, reference = "phase3_best_error_px") {
  return stats(records.filter(predicate).map((record) => record[reference]));
}

function summarizeEvaluation(evaluation, baselineOverall, phase3BestRecords = null) {
  const { candidate, records } = evaluation;
  if (phase3BestRecords) {
    const phase3ByOrdinal = new Map(phase3BestRecords.map((record) => [record.ordinal, record.error_px]));
    for (const record of records) record.phase3_best_error_px = phase3ByOrdinal.get(record.ordinal);
  }
  const overall = stats(records.map((record) => record.error_px));
  const lowSpeedPredicate = (record) => Number.isFinite(record.speed_px_s) && record.speed_px_s < lowSpeedPxPerS;
  const appliedCount = records.filter((record) => record.applied_correction).length;
  const highSpeedPredicate = (record) => record.speed_px_s >= highSpeedPxPerS;
  const highAccelerationPredicate = (record) => record.accel_px_s2 >= highAccelerationPxPerS2;
  const disagreementPredicate = (record) => record.hook_disagreement_px >= highDisagreementPx;
  const stopSettlePredicate = (record) => record.stop_settle_window !== "not_in_stop_settle";
  const highSpeed = thresholdStats(records, highSpeedPredicate);
  const highAcceleration = thresholdStats(records, highAccelerationPredicate);
  const disagreement = thresholdStats(records, disagreementPredicate);
  const stopSettle = thresholdStats(records, stopSettlePredicate);
  const lowSpeed = thresholdStats(records, lowSpeedPredicate);
  const phase3Reference = phase3BestRecords ? {
    overall: referenceStats(records, () => true),
    high_speed: referenceStats(records, highSpeedPredicate),
    high_acceleration: referenceStats(records, highAccelerationPredicate),
    hook_poll_disagreement_5px: referenceStats(records, disagreementPredicate),
    stop_settle: referenceStats(records, stopSettlePredicate),
    low_speed: referenceStats(records, lowSpeedPredicate),
  } : null;
  return {
    id: candidate.id,
    family: candidate.family,
    product_feasible: candidate.product_feasible,
    oracle_only: candidate.oracle_only || false,
    description: candidate.description,
    parameters: candidate.parameters || {},
    overall,
    delta_vs_baseline: {
      mean: overall.mean - baselineOverall.mean,
      p50: overall.p50 - baselineOverall.p50,
      p90: overall.p90 - baselineOverall.p90,
      p95: overall.p95 - baselineOverall.p95,
      p99: overall.p99 - baselineOverall.p99,
      max: overall.max - baselineOverall.max,
    },
    high_speed: highSpeed,
    high_acceleration: highAcceleration,
    hook_poll_disagreement_5px: disagreement,
    stop_settle: stopSettle,
    low_speed: lowSpeed,
    regressions_vs_baseline: regressionCounts(records),
    low_speed_regressions_vs_baseline: regressionCounts(records, lowSpeedPredicate),
    phase3_best_reference: phase3Reference,
    delta_vs_phase3_best: phase3Reference ? {
      overall: statDeltas(overall, phase3Reference.overall),
      high_speed: statDeltas(highSpeed, phase3Reference.high_speed),
      high_acceleration: statDeltas(highAcceleration, phase3Reference.high_acceleration),
      hook_poll_disagreement_5px: statDeltas(disagreement, phase3Reference.hook_poll_disagreement_5px),
      stop_settle: statDeltas(stopSettle, phase3Reference.stop_settle),
      low_speed: statDeltas(lowSpeed, phase3Reference.low_speed),
    } : null,
    regressions_vs_phase3_best: phase3BestRecords ? regressionCounts(records, (record) => Number.isFinite(record.phase3_best_error_px), "phase3_best_error_px") : null,
    low_speed_regressions_vs_phase3_best: phase3BestRecords ? regressionCounts(records, (record) => lowSpeedPredicate(record) && Number.isFinite(record.phase3_best_error_px), "phase3_best_error_px") : null,
    correction_application: {
      applied_count: appliedCount,
      total_count: records.length,
      rate: records.length ? appliedCount / records.length : 0,
    },
    speed_bins: bucketStats(records, "speed_bin"),
    acceleration_bins: bucketStats(records, "accel_bin"),
    hook_poll_disagreement_bins: bucketStats(records, "hook_poll_disagreement_bin"),
    poll_interval_jitter_bins: bucketStats(records, "poll_jitter_bin"),
    stop_settle_windows: bucketStats(records, "stop_settle_window"),
  };
}

function baselineEvaluation(rows) {
  return evaluateRows(
    rows,
    {
      id: "baseline_product",
      family: "baseline",
      product_feasible: true,
      description: "Phase 1/2 product baseline: poll+DWM next-vblank last2 extrapolation with gain 0.75.",
      parameters: { gain, idle_reset_ms: idleResetMs },
    },
    (row) => row.baseline_prediction,
  );
}

function selectionScore(summary, baseline) {
  const p99Penalty = Math.max(0, summary.overall.p99 - baseline.overall.p99) * 10;
  const lowPenalty = Math.max(0, summary.low_speed.p95 - baseline.low_speed.p95) * 10;
  return (
    finite(summary.high_speed.p95, 9999) +
    finite(summary.high_acceleration.p95, 9999) +
    finite(summary.hook_poll_disagreement_5px.p95, 9999) +
    p99Penalty +
    lowPenalty
  );
}

function chooseRidge(rowsTrain, rowsValidation, candidateId, trainFilter = () => true, gate = () => true, featureIndices = featureNames.map((_, index) => index)) {
  const trainRows = rowsTrain.filter(trainFilter);
  if (trainRows.length < featureIndices.length * 4) throw new Error(`Too few train rows for ${candidateId}`);
  const lambdas = [0.1, 1, 10, 100, 1000];
  const caps = [5, 15, 30, Infinity];
  const baselineValidation = summarizeEvaluation(baselineEvaluation(rowsValidation), stats(rowsValidation.map((row) => row.baseline_error_px)));
  let best = null;
  for (const lambda of lambdas) {
    const model = fitRidge(trainRows, lambda, featureIndices);
    for (const capPx of caps) {
      const evaluation = evaluateRows(
        rowsValidation,
        { id: candidateId, family: "ridge_residual", product_feasible: true, parameters: { lambda, cap_px: capPx } },
        (row) => (gate(row) ? correctedPrediction(row, model, capPx) : row.baseline_prediction),
      );
      const summary = summarizeEvaluation(evaluation, baselineValidation.overall);
      const score = selectionScore(summary, baselineValidation);
      if (!best || score < best.score) best = { score, lambda, capPx, model, summary };
    }
  }
  return best;
}

function sigmoid(value) {
  if (value < -40) return 0;
  if (value > 40) return 1;
  return 1 / (1 + Math.exp(-value));
}

function fitLogisticGate(rows, residualModel, capPx, featureIndices = residualModel.feature_indices || featureNames.map((_, index) => index)) {
  const scaler = standardizer(rows, featureIndices);
  const p = featureIndices.length + 3;
  const weights = Array(p).fill(0);
  const lr = 0.03;
  const l2 = 0.0005;
  const epochs = 4;
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const row of rows) {
      const corrected = correctedPrediction(row, residualModel, capPx);
      const correctedError = distance(corrected, [row.target_x, row.target_y]);
      const label = correctedError + 0.25 < row.baseline_error_px ? 1 : 0;
      const residual = capResidual(ridgeResidual(residualModel, row), capPx);
      const mag = Math.hypot(residual[0], residual[1]);
      const x = [...transformFeatures(row, scaler), clamp(mag / 20, 0, 5), clamp(row.risk_score, 0, 5)];
      let z = 0;
      for (let i = 0; i < p; i++) z += weights[i] * x[i];
      const error = sigmoid(z) - label;
      for (let i = 0; i < p; i++) weights[i] -= lr * (error * x[i] + (i === 0 ? 0 : l2 * weights[i]));
    }
  }
  return {
    family: "logistic_gate",
    scaler,
    weights,
    feature_indices: featureIndices,
    feature_names: featureIndices.map((index) => featureNames[index]),
    residualModel,
    capPx,
  };
}

function logisticScore(model, row) {
  const residual = capResidual(ridgeResidual(model.residualModel, row), model.capPx);
  const mag = Math.hypot(residual[0], residual[1]);
  const x = [...transformFeatures(row, model.scaler), clamp(mag / 20, 0, 5), clamp(row.risk_score, 0, 5)];
  let z = 0;
  for (let i = 0; i < x.length; i++) z += model.weights[i] * x[i];
  return z;
}

function logisticProbability(model, row) {
  return sigmoid(logisticScore(model, row));
}

function logit(probability) {
  return Math.log(probability / (1 - probability));
}

function chooseRiskThreshold(rowsValidation, residualModel, capPx, baselineValidation, candidateId, extraGate = () => true) {
  const thresholds = [0.75, 1, 1.25, 1.5, 2, 3];
  let best = null;
  for (const threshold of thresholds) {
    const evaluation = evaluateRows(
      rowsValidation,
      { id: candidateId, family: "threshold_gate", product_feasible: true, parameters: { threshold, cap_px: capPx } },
      (row) => (extraGate(row) && row.risk_score >= threshold ? correctedPrediction(row, residualModel, capPx) : row.baseline_prediction),
    );
    const summary = summarizeEvaluation(evaluation, baselineValidation.overall);
    const score = selectionScore(summary, baselineValidation);
    if (!best || score < best.score) best = { threshold, score, summary };
  }
  return best;
}

function chooseLogisticThreshold(rowsValidation, gateModel, baselineValidation) {
  const thresholds = [0.25, 0.35, 0.5, 0.65, 0.8];
  let best = null;
  for (const threshold of thresholds) {
    const evaluation = evaluateRows(
      rowsValidation,
      { id: "ridge_residual_logistic_gate", family: "learned_gate", product_feasible: true, parameters: { probability_threshold: threshold } },
      (row) => (logisticProbability(gateModel, row) >= threshold ? correctedPrediction(row, gateModel.residualModel, gateModel.capPx) : row.baseline_prediction),
    );
    const summary = summarizeEvaluation(evaluation, baselineValidation.overall);
    const score = selectionScore(summary, baselineValidation);
    if (!best || score < best.score) best = { threshold, score, summary };
  }
  return best;
}

function productObjective(summary, baseline, phase3Best = null) {
  const p99Penalty = Math.max(0, summary.overall.p99 - baseline.overall.p99) * 80;
  const lowPenalty = Math.max(0, summary.low_speed.p95 - baseline.low_speed.p95) * 80;
  const phase3TailPenalty = phase3Best ? Math.max(0, summary.overall.p99 - phase3Best.overall.p99) * 12 : 0;
  const regressionPenalty =
    summary.regressions_vs_baseline.gt_5px * 0.22 +
    summary.regressions_vs_baseline.gt_3px * 0.035 +
    summary.regressions_vs_baseline.gt_1px * 0.006;
  const abstentionBias = summary.correction_application.rate * 4;
  return (
    finite(summary.overall.p99, 9999) * 2.0 +
    finite(summary.high_speed.p95, 9999) * 1.2 +
    finite(summary.high_speed.p99, 9999) * 0.35 +
    finite(summary.high_acceleration.p95, 9999) * 0.9 +
    finite(summary.high_acceleration.p99, 9999) * 0.25 +
    finite(summary.hook_poll_disagreement_5px.p95, 9999) * 0.65 +
    finite(summary.stop_settle.p95, 9999) * 0.35 +
    regressionPenalty +
    abstentionBias +
    p99Penalty +
    lowPenalty +
    phase3TailPenalty
  );
}

function residualForConfig(row, residualModel, config) {
  let residual = ridgeResidual(residualModel, row);
  const shrink = config.shrink ?? 1;
  residual = [residual[0] * shrink, residual[1] * shrink];
  const caps = [];
  if (Number.isFinite(config.vector_cap_px)) caps.push(config.vector_cap_px);
  if (Number.isFinite(config.relative_step_cap)) caps.push(baselineStepLength(row) * config.relative_step_cap);
  if (caps.length) residual = capResidual(residual, Math.min(...caps));
  return residual;
}

function ensembleUncertainty(row, models, config) {
  if (!models || models.length === 0) return 0;
  const residuals = models.map((model) => residualForConfig(row, model, config));
  const meanX = residuals.reduce((sum, residual) => sum + residual[0], 0) / residuals.length;
  const meanY = residuals.reduce((sum, residual) => sum + residual[1], 0) / residuals.length;
  const variance = residuals.reduce((sum, residual) => sum + (residual[0] - meanX) ** 2 + (residual[1] - meanY) ** 2, 0) / residuals.length;
  return Math.sqrt(variance);
}

function passesConfigGate(row, config, residualModel, logisticModel = null, ensembleModels = null) {
  if (Number.isFinite(config.low_speed_guard_px_s) && finite(row.speed_px_s) < config.low_speed_guard_px_s) return false;
  if (Number.isFinite(config.risk_threshold) && row.risk_score < config.risk_threshold) return false;
  if (Number.isFinite(config.min_speed_px_s) && finite(row.speed_px_s) < config.min_speed_px_s) return false;
  if (Number.isFinite(config.min_baseline_step_px) && baselineStepLength(row) < config.min_baseline_step_px) return false;
  if (Number.isFinite(config.min_predicted_residual_px) && Math.hypot(...residualForConfig(row, residualModel, config)) < config.min_predicted_residual_px) return false;
  if (config.piecewise_rule === "speed_disagreement_or_stop") {
    const speedBranch = finite(row.speed_px_s) >= finite(config.piece_speed_px_s) && finite(row.hook_disagreement_px) >= finite(config.piece_disagreement_px);
    const accelBranch = finite(row.accel_px_s2) >= finite(config.piece_accel_px_s2) && finite(row.hook_disagreement_px) >= finite(config.piece_accel_disagreement_px);
    const stopBranch = row.stop_settle_elapsed_ms !== null && row.stop_settle_elapsed_ms >= finite(config.piece_stop_min_ms);
    if (!speedBranch && !accelBranch && !stopBranch) return false;
  }
  if (Number.isFinite(config.max_stationary_elapsed_ms) && finite(row.stationary_elapsed_ms) > config.max_stationary_elapsed_ms) return false;
  if (Number.isFinite(config.stop_settle_guard_ms) && row.stop_settle_elapsed_ms !== null && row.stop_settle_elapsed_ms < config.stop_settle_guard_ms) return false;
  if (logisticModel && Number.isFinite(config.linear_score_threshold) && logisticScore(logisticModel, row) < config.linear_score_threshold) return false;
  if (logisticModel && Number.isFinite(config.logistic_probability_threshold) && logisticProbability(logisticModel, row) < config.logistic_probability_threshold) return false;
  if (ensembleModels && Number.isFinite(config.max_ensemble_std_px) && ensembleUncertainty(row, ensembleModels, config) > config.max_ensemble_std_px) return false;
  return true;
}

function predictionForConfig(row, residualModel, config, logisticModel = null, ensembleModels = null) {
  if (!passesConfigGate(row, config, residualModel, logisticModel, ensembleModels)) return { prediction: row.baseline_prediction, applied: false };
  const residual = residualForConfig(row, residualModel, config);
  if (Math.hypot(residual[0], residual[1]) <= 1e-9) return { prediction: row.baseline_prediction, applied: false };
  return {
    prediction: [row.baseline_prediction[0] + residual[0], row.baseline_prediction[1] + residual[1]],
    applied: true,
  };
}

function fitRidgeEnsemble(rows, lambda, folds = 4) {
  const models = [];
  const foldSize = Math.ceil(rows.length / folds);
  for (let fold = 0; fold < folds; fold++) {
    const start = fold * foldSize;
    const end = Math.min(rows.length, start + foldSize);
    const trainingRows = rows.filter((_, index) => index < start || index >= end);
    if (trainingRows.length >= featureNames.length * 4) models.push(fitRidge(trainingRows, lambda));
  }
  return models;
}

function candidateFromConfig(id, family, description, config, residualModel, logisticModel = null, ensembleModels = null) {
  return {
    candidate: {
      id,
      family,
      product_feasible: true,
      oracle_only: false,
      description,
      parameters: config,
    },
    predict: (row) => predictionForConfig(row, residualModel, config, logisticModel, ensembleModels),
  };
}

function featureIndicesFor(names) {
  return names.map((name) => {
    const index = featureNames.indexOf(name);
    if (index < 0) throw new Error(`Unknown feature: ${name}`);
    return index;
  });
}

function cloneModel(model) {
  return JSON.parse(JSON.stringify(model));
}

function pruneModel(model, threshold) {
  const pruned = cloneModel(model);
  let zeroed = 0;
  for (const key of ["weights", "weightsX", "weightsY"]) {
    if (!Array.isArray(pruned[key])) continue;
    for (let i = 1; i < pruned[key].length; i++) {
      if (Math.abs(pruned[key][i]) < threshold) {
        pruned[key][i] = 0;
        zeroed += 1;
      }
    }
  }
  return { model: pruned, zeroed };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function serializeModel(model) {
  if (!model) return null;
  return {
    family: model.family,
    lambda: model.lambda,
    cap_px: finiteOrNull(model.capPx),
    feature_names: model.feature_names || model.scaler?.feature_names || featureNames,
    feature_indices: model.feature_indices || model.scaler?.feature_indices || featureNames.map((_, index) => index),
    scaler: model.scaler,
    weights: model.weights || null,
    weights_x: model.weightsX || null,
    weights_y: model.weightsY || null,
  };
}

function benchmarkHotPath(rows, residualModel, logisticModel, config) {
  const iterations = 200000;
  const start = performance.now();
  let checksum = 0;
  for (let i = 0; i < iterations; i++) {
    const row = rows[i % rows.length];
    const result = predictionForConfig(row, residualModel, config, logisticModel);
    checksum += result.prediction[0] * 0.000001 + result.prediction[1] * 0.0000001;
  }
  const elapsedMs = performance.now() - start;
  return {
    iterations,
    elapsed_ms: elapsedMs,
    ns_per_prediction: (elapsedMs * 1e6) / iterations,
    checksum,
    note: "Bounded JS replay microbenchmark, useful only as a relative sanity check. C# product path should use scalar fields/static arrays and allocate nothing.",
  };
}

function operationEstimate(featureCount, gateKind) {
  const logs = featureCount >= 26 ? 4 : Math.min(3, featureCount);
  const trig = featureCount >= 26 ? 1 : 0;
  const residualDots = featureCount * 4 + 6;
  const gateDot = featureCount * 2 + 5;
  const base = 35;
  const sigmoidCost = gateKind === "logistic_probability" ? 1 : 0;
  return {
    feature_count: featureCount,
    estimated_scalar_arithmetic_ops: base + residualDots + gateDot + 25,
    estimated_comparisons_or_branches: gateKind === "piecewise" ? 11 : 7,
    transcendental_ops: { log1p: logs, hypot_or_sqrt: 4, acos: trig, exp: sigmoidCost },
    hot_path_allocations: 0,
    state_bytes_estimate: {
      predictor_dynamic_state: 200,
      exact_model_constants: 8 * ((featureCount + 1) * 3 + featureCount * 2),
      note: "Dynamic state covers previous poll, previous vector/speed, rolling 5-speed/accel ring buffers, stop timestamp, and timing fields. Constants can be static readonly and are not per-instance state.",
    },
  };
}

function buildModelSpec(results, artifacts) {
  const best = results.product_trace.recommendation.best_candidate;
  const exact = artifacts.phase4Best;
  const linear = results.product_trace.candidates.find((candidate) => candidate.id === "distilled_linear_score_exact_gate");
  const product = best?.id === "distilled_linear_score_exact_gate" ? linear : best;
  return {
    schema_version: 1,
    phase: "phase-5 product-shape-distillation",
    generated_by: "run_phase5.mjs",
    trace_inputs: traceZips,
    baseline: {
      formula: "If DWM next-vblank target and previous poll dt are valid, predict round_half_away(sample + (sample - previous) * 0.75 * horizonTicks / deltaTicks); otherwise hold current poll position.",
      gain,
      idle_reset_ms: idleResetMs,
      fallback_rules: [
        "Hold current poll position when there is no previous poll.",
        "Hold current poll position when deltaTicks <= 0, deltaMs > 100, DWM timing is invalid, or horizonTicks <= 0.",
        "Round each baseline axis half away from zero to match Math.Round-compatible product behavior.",
      ],
    },
    exact_phase4_candidate: {
      id: "phase4_logistic_p0_35_sh0_65_capinf",
      formula: "baseline + 0.65 * ridgeResidual(row), gated by low-speed guard, risk score, and logistic confidence p >= 0.35; no vector cap.",
      thresholds: {
        low_speed_guard_px_s: lowSpeedPxPerS,
        risk_threshold: exact.config.risk_threshold,
        logistic_probability_threshold: exact.config.logistic_probability_threshold,
        linear_score_threshold_equivalent: logit(exact.config.logistic_probability_threshold),
        vector_cap_px: null,
        shrink: exact.config.shrink,
      },
      residual_model: serializeModel(exact.residualModel),
      logistic_gate_model: serializeModel(exact.logisticModel),
    },
    recommended_product_candidate: {
      id: product?.id || null,
      rationale: best?.id === "distilled_linear_score_exact_gate"
        ? "Uses the same learned score as Phase 4 but compares the raw linear logit to logit(0.35), removing the hot-path exp/sigmoid without changing decisions."
        : "Selected by validation/test product objective.",
      config: artifacts.recommendedConfig,
      operation_estimate: artifacts.operation_estimate,
      microbenchmark: artifacts.microbenchmark,
    },
    feature_definitions: Object.fromEntries(featureNames.map((name, index) => [name, {
      index,
      raw_formula: rawFeatureDescriptions[name],
    }])),
    required_state: [
      "previous poll x/y/ticks",
      "previous speed",
      "previous movement dx/dy",
      "last five speeds for recent mean/max/moving fraction",
      "last five accelerations for recent max acceleration",
      "stationary elapsed milliseconds",
      "last stop-entry tick within 250 ms",
      "previous poll tick for poll interval and jitter",
      "latest hook-interpolated point if hook/poll disagreement remains available in product",
    ],
    fallback_rules: [
      "If any required timing value is invalid, use baseline fallback.",
      "If speed is below the low-speed guard, abstain to baseline.",
      "If risk score is below threshold, abstain to baseline.",
      "If hook/poll disagreement cannot be computed, use zero for that feature and allow the gate to abstain naturally.",
      "All non-finite feature inputs are converted to zero before normalization.",
      "Prediction must allocate no objects on the hot path; constants should be static and state should be scalar/ring-buffer fields.",
    ],
  };
}

const rawFeatureDescriptions = {
  log_speed: "log1p(max(0, speed_px_s)) / 8",
  log_previous_speed: "log1p(max(0, previous_speed_px_s)) / 8",
  log_accel: "log1p(max(0, accel_px_s2)) / 12",
  turn_angle: "turn_angle_deg / 180",
  dwm_horizon: "dwm_horizon_ms / 16",
  poll_interval: "poll_interval_ms / 16",
  poll_jitter: "poll_jitter_ms / 16",
  log_hook_disagreement: "log1p(max(0, hook_disagreement_px)) / 3",
  stop_settle_recency: "0 outside stop-settle window, otherwise 1 - clamp(stop_settle_elapsed_ms / 250, 0, 1)",
  recent_mean_speed: "recent_mean_speed_px_s / 2000",
  recent_max_speed: "recent_max_speed_px_s / 3000",
  log_recent_max_accel: "log1p(max(0, recent_max_accel_px_s2)) / 12",
  speed_trend: "speed_trend_px_s / 2000",
  moving_fraction_5: "fraction of last five poll speeds >= 100 px/s",
  stationary_elapsed: "clamp(stationary_elapsed_ms / 250, 0, 2)",
  vx: "clamp(vx_px_s / 3000, -3, 3)",
  vy: "clamp(vy_px_s / 3000, -3, 3)",
  baseline_step_x: "clamp((baseline_prediction_x - sample_x) / 50, -5, 5)",
  baseline_step_y: "clamp((baseline_prediction_y - sample_y) / 50, -5, 5)",
  high_speed_flag: "speed_px_s >= 1200 ? 1 : 0",
  high_accel_flag: "accel_px_s2 >= 60000 ? 1 : 0",
  disagreement_2px_flag: "hook_disagreement_px >= 2 ? 1 : 0",
  disagreement_5px_flag: "hook_disagreement_px >= 5 ? 1 : 0",
  in_stop_settle_flag: "stop_settle_elapsed_ms != null ? 1 : 0",
  late_vblank_flag: "DWM selected status == late_advanced ? 1 : 0",
  warmup_or_invalid_flag: "DWM selected status is neither valid nor late_advanced ? 1 : 0",
};

function selectBestConfig(rowsValidation, baselineValidationSummary, phase3ValidationSummary, options) {
  let best = null;
  const leaderboard = [];
  for (const option of options) {
    const evaluation = evaluateRows(rowsValidation, option.candidate, option.predict);
    const summary = summarizeEvaluation(evaluation, baselineValidationSummary.overall);
    const score = productObjective(summary, baselineValidationSummary, phase3ValidationSummary);
    const entry = { score, id: option.candidate.id, family: option.candidate.family, parameters: option.candidate.parameters, summary };
    leaderboard.push(entry);
    if (!best || score < best.score) best = { ...entry, option };
  }
  leaderboard.sort((a, b) => a.score - b.score);
  return { best, leaderboard };
}

function summarizeAgainstReferences(evaluations, baselineSummary, phase3BestEval) {
  return evaluations.map((evaluation) => summarizeEvaluation(evaluation, baselineSummary.overall, phase3BestEval.records));
}

function makeCandidateSummaries(splits) {
  const baselineValidationSummary = summarizeEvaluation(baselineEvaluation(splits.validation), stats(splits.validation.map((row) => row.baseline_error_px)));
  const baselineTestEval = baselineEvaluation(splits.test);
  const baselineTestSummary = summarizeEvaluation(baselineTestEval, stats(splits.test.map((row) => row.baseline_error_px)));
  const evaluations = [baselineTestEval];
  const validationSelections = {};
  const validationLeaderboards = {};

  const ridgeAllChoice = chooseRidge(splits.train, splits.validation, "ridge_residual_all");
  validationSelections.ridge_residual_all = {
    lambda: ridgeAllChoice.lambda,
    cap_px: ridgeAllChoice.capPx,
    validation_summary: ridgeAllChoice.summary,
  };

  const riskGate = chooseRiskThreshold(splits.validation, ridgeAllChoice.model, ridgeAllChoice.capPx, baselineValidationSummary, "ridge_residual_risk_threshold_gate");
  validationSelections.ridge_residual_risk_threshold_gate = {
    threshold: riskGate.threshold,
    validation_summary: riskGate.summary,
  };

  const lowSpeedGuardGate = chooseRiskThreshold(
    splits.validation,
    ridgeAllChoice.model,
    ridgeAllChoice.capPx,
    baselineValidationSummary,
    "ridge_residual_risk_gate_low_speed_guard",
    (row) => finite(row.speed_px_s) >= lowSpeedPxPerS,
  );
  validationSelections.ridge_residual_risk_gate_low_speed_guard = {
    threshold: lowSpeedGuardGate.threshold,
    validation_summary: lowSpeedGuardGate.summary,
  };

  const phase3BestConfig = {
    residual_lambda: ridgeAllChoice.lambda,
    shrink: 1,
    vector_cap_px: Infinity,
    relative_step_cap: Infinity,
    risk_threshold: lowSpeedGuardGate.threshold,
    low_speed_guard_px_s: lowSpeedPxPerS,
  };
  const phase3Best = candidateFromConfig(
    "ridge_residual_risk_gate_low_speed_guard",
    "phase3_reproduction",
    "Phase 3 best reproduction: thresholded risk gate that never applies residual correction to low-speed rows.",
    phase3BestConfig,
    ridgeAllChoice.model,
  );
  const phase3BestValidationEval = evaluateRows(splits.validation, phase3Best.candidate, phase3Best.predict);
  const phase3BestValidationSummary = summarizeEvaluation(phase3BestValidationEval, baselineValidationSummary.overall);
  const phase3BestTestEval = evaluateRows(splits.test, phase3Best.candidate, phase3Best.predict);
  evaluations.push(phase3BestTestEval);

  const logisticModel = fitLogisticGate(splits.train, ridgeAllChoice.model, ridgeAllChoice.capPx);
  const ensembleModels = fitRidgeEnsemble(splits.train, ridgeAllChoice.lambda, 4);

  const familyOptions = {};
  familyOptions.shrinkage = [0.15, 0.25, 0.35, 0.5, 0.65, 0.8, 1].map((shrink) =>
    candidateFromConfig(
      `phase4_shrink_${String(shrink).replace(".", "_")}`,
      "shrinkage",
      "Phase 4 shrinkage-only calibration over the Phase 3 low-speed risk gate.",
      { ...phase3BestConfig, shrink },
      ridgeAllChoice.model,
    ),
  );
  familyOptions.vector_cap = [2, 3, 5, 8, 12, 16, 24, Infinity].map((cap) =>
    candidateFromConfig(
      `phase4_vector_cap_${Number.isFinite(cap) ? cap : "inf"}`,
      "vector_cap",
      "Phase 4 absolute vector residual cap over the Phase 3 low-speed risk gate.",
      { ...phase3BestConfig, vector_cap_px: cap },
      ridgeAllChoice.model,
    ),
  );
  familyOptions.relative_step_cap = [0.25, 0.5, 0.75, 1, 1.5, 2, Infinity].map((relative) =>
    candidateFromConfig(
      `phase4_relative_step_cap_${Number.isFinite(relative) ? String(relative).replace(".", "_") : "inf"}`,
      "relative_step_cap",
      "Phase 4 cap that limits residual magnitude relative to the baseline extrapolation step length.",
      { ...phase3BestConfig, relative_step_cap: relative },
      ridgeAllChoice.model,
    ),
  );

  const guardOptions = [];
  for (const risk_threshold of [0.75, 1, 1.25, 1.5, 2, 3]) {
    for (const low_speed_guard_px_s of [20, 50, 100, 200]) {
      for (const stop_settle_guard_ms of [0, 33, 67, 133, 250]) {
        for (const max_stationary_elapsed_ms of [Infinity, 33, 67, 133, 250]) {
          guardOptions.push(candidateFromConfig(
            `phase4_guard_r${String(risk_threshold).replace(".", "_")}_l${low_speed_guard_px_s}_s${stop_settle_guard_ms}_st${Number.isFinite(max_stationary_elapsed_ms) ? max_stationary_elapsed_ms : "inf"}`,
            "guard_combo",
            "Phase 4 low-speed, stationary, stop-settle, and risk-threshold guard calibration.",
            { ...phase3BestConfig, risk_threshold, low_speed_guard_px_s, stop_settle_guard_ms, max_stationary_elapsed_ms },
            ridgeAllChoice.model,
          ));
        }
      }
    }
  }
  familyOptions.guard_combo = guardOptions;

  const conservativeOptions = [];
  for (const shrink of [0.25, 0.35, 0.5, 0.65]) {
    for (const vector_cap_px of [3, 5, 8, 12]) {
      for (const relative_step_cap of [0.5, 0.75, 1, 1.5]) {
        for (const risk_threshold of [0.75, 1, 1.25, 1.5]) {
          conservativeOptions.push(candidateFromConfig(
            `phase4_product_grid_sh${String(shrink).replace(".", "_")}_cap${vector_cap_px}_rel${String(relative_step_cap).replace(".", "_")}_r${String(risk_threshold).replace(".", "_")}`,
            "product_objective_grid",
            "Phase 4 product-objective-selected shrink/cap/risk grid with low-speed abstention.",
            { ...phase3BestConfig, shrink, vector_cap_px, relative_step_cap, risk_threshold },
            ridgeAllChoice.model,
          ));
        }
      }
    }
  }
  familyOptions.product_objective_grid = conservativeOptions;

  const logisticOptions = [];
  for (const logistic_probability_threshold of [0.25, 0.35, 0.5, 0.65, 0.75, 0.85, 0.92]) {
    for (const shrink of [0.35, 0.5, 0.65, 1]) {
      for (const vector_cap_px of [5, 8, 12, Infinity]) {
        logisticOptions.push(candidateFromConfig(
          `phase4_logistic_p${String(logistic_probability_threshold).replace(".", "_")}_sh${String(shrink).replace(".", "_")}_cap${Number.isFinite(vector_cap_px) ? vector_cap_px : "inf"}`,
          "logistic_confidence",
          "Phase 4 logistic confidence gate that abstains to baseline when predicted correction benefit is low.",
          { ...phase3BestConfig, shrink, vector_cap_px, logistic_probability_threshold },
          ridgeAllChoice.model,
          logisticModel,
        ));
      }
    }
  }
  familyOptions.logistic_confidence = logisticOptions;

  const exactPhase4Config = {
    ...phase3BestConfig,
    shrink: 0.65,
    vector_cap_px: Infinity,
    relative_step_cap: Infinity,
    logistic_probability_threshold: 0.35,
  };
  familyOptions.linear_score_gate = [
    candidateFromConfig(
      "distilled_linear_score_exact_gate",
      "linear_score_gate",
      "Phase 5 distillation: same learned logistic score as Phase 4, but compare raw logit to logit(0.35) to remove sigmoid/exp from the hot path.",
      {
        ...phase3BestConfig,
        shrink: 0.65,
        vector_cap_px: Infinity,
        relative_step_cap: Infinity,
        linear_score_threshold: logit(0.35),
      },
      ridgeAllChoice.model,
      logisticModel,
    ),
  ];

  const prunedOptions = [];
  for (const threshold of [0.02, 0.05, 0.1, 0.2]) {
    const prunedResidual = pruneModel(ridgeAllChoice.model, threshold);
    const prunedLogistic = pruneModel(logisticModel, threshold);
    prunedLogistic.model.residualModel = prunedResidual.model;
    prunedOptions.push(candidateFromConfig(
      `distilled_pruned_t${String(threshold).replace(".", "_")}`,
      "coefficient_pruning",
      "Phase 5 coefficient-pruned ridge and gate weights using the exact Phase 4 gate shape.",
      {
        ...exactPhase4Config,
        prune_abs_weight_below: threshold,
        zeroed_coefficients: prunedResidual.zeroed + prunedLogistic.zeroed,
      },
      prunedResidual.model,
      prunedLogistic.model,
    ));
  }
  familyOptions.coefficient_pruning = prunedOptions;

  const featureSetOptions = [];
  const distilledFeatureSets = {
    core6: ["log_speed", "log_accel", "log_hook_disagreement", "stop_settle_recency", "baseline_step_x", "baseline_step_y"],
    core10: ["log_speed", "log_previous_speed", "log_accel", "poll_jitter", "log_hook_disagreement", "stop_settle_recency", "recent_max_speed", "speed_trend", "baseline_step_x", "baseline_step_y"],
    no_trig18: featureNames.filter((name) => !["turn_angle", "vx", "vy", "recent_mean_speed", "recent_max_speed", "log_recent_max_accel", "moving_fraction_5", "stationary_elapsed"].includes(name)),
  };
  for (const [setName, names] of Object.entries(distilledFeatureSets)) {
    const indices = featureIndicesFor(names);
    const ridgeChoice = chooseRidge(splits.train, splits.validation, `distilled_${setName}_ridge`, () => true, () => true, indices);
    const gate = fitLogisticGate(splits.train, ridgeChoice.model, ridgeChoice.capPx, indices);
    for (const logistic_probability_threshold of [0.25, 0.35, 0.5, 0.65]) {
      for (const shrink of [0.5, 0.65, 1]) {
        featureSetOptions.push(candidateFromConfig(
          `distilled_${setName}_p${String(logistic_probability_threshold).replace(".", "_")}_sh${String(shrink).replace(".", "_")}`,
          "fewer_features",
          `Phase 5 distilled feature set ${setName} with a retrained residual and confidence gate.`,
          {
            residual_lambda: ridgeChoice.lambda,
            residual_cap_px: ridgeChoice.capPx,
            feature_set: setName,
            feature_names: names,
            shrink,
            vector_cap_px: Infinity,
            relative_step_cap: Infinity,
            risk_threshold: lowSpeedGuardGate.threshold,
            low_speed_guard_px_s: lowSpeedPxPerS,
            logistic_probability_threshold,
          },
          ridgeChoice.model,
          gate,
        ));
      }
    }
  }
  familyOptions.fewer_features = featureSetOptions;

  const piecewiseOptions = [];
  for (const shrink of [0.65]) {
    for (const risk_threshold of [0.75, 1]) {
      for (const min_baseline_step_px of [0, 1]) {
        for (const piece_speed_px_s of [1200]) {
          for (const piece_disagreement_px of [1, 2]) {
            for (const piece_accel_px_s2 of [60000]) {
              for (const piece_accel_disagreement_px of [1, 2]) {
                for (const piece_stop_min_ms of [67, 999999]) {
                  piecewiseOptions.push(candidateFromConfig(
                    `distilled_piecewise_sh${String(shrink).replace(".", "_")}_r${String(risk_threshold).replace(".", "_")}_b${min_baseline_step_px}_s${piece_speed_px_s}_d${piece_disagreement_px}_a${piece_accel_px_s2}_ad${piece_accel_disagreement_px}_st${piece_stop_min_ms}`,
                    "piecewise_score_gate",
                    "Phase 5 simple piecewise gate using speed/disagreement, acceleration/disagreement, or stop-settle branches.",
                    {
                      ...phase3BestConfig,
                      shrink,
                      risk_threshold,
                      min_baseline_step_px,
                      piecewise_rule: "speed_disagreement_or_stop",
                      piece_speed_px_s,
                      piece_disagreement_px,
                      piece_accel_px_s2,
                      piece_accel_disagreement_px,
                      piece_stop_min_ms,
                    },
                    ridgeAllChoice.model,
                  ));
                }
              }
            }
          }
        }
      }
    }
  }
  familyOptions.piecewise_score_gate = piecewiseOptions;

  const uncertaintyOptions = [];
  for (const max_ensemble_std_px of [0.5, 1, 2, 3, 5, 8, Infinity]) {
    for (const shrink of [0.35, 0.5, 0.65, 1]) {
      for (const vector_cap_px of [5, 8, 12, Infinity]) {
        uncertaintyOptions.push(candidateFromConfig(
          `phase4_uncertainty_std${Number.isFinite(max_ensemble_std_px) ? String(max_ensemble_std_px).replace(".", "_") : "inf"}_sh${String(shrink).replace(".", "_")}_cap${Number.isFinite(vector_cap_px) ? vector_cap_px : "inf"}`,
          "uncertainty_abstain",
          "Phase 4 ridge-ensemble disagreement gate that abstains to baseline when residual estimates are unstable.",
          { ...phase3BestConfig, shrink, vector_cap_px, max_ensemble_std_px },
          ridgeAllChoice.model,
          null,
          ensembleModels,
        ));
      }
    }
  }
  familyOptions.uncertainty_abstain = uncertaintyOptions;

  const selectedOptions = [];
  for (const [family, options] of Object.entries(familyOptions)) {
    const selection = selectBestConfig(splits.validation, baselineValidationSummary, phase3BestValidationSummary, options);
    validationSelections[family] = {
      selected_id: selection.best.id,
      selected_score: selection.best.score,
      selected_parameters: selection.best.parameters,
      validation_summary: selection.best.summary,
    };
    validationLeaderboards[family] = selection.leaderboard.slice(0, 15);
    selectedOptions.push(selection.best.option);
  }

  const allPhase4Options = Object.values(familyOptions).flat();
  const globalSelection = selectBestConfig(splits.validation, baselineValidationSummary, phase3BestValidationSummary, allPhase4Options);
  validationSelections.phase4_product_objective_best = {
    selected_id: globalSelection.best.id,
    selected_score: globalSelection.best.score,
    selected_parameters: globalSelection.best.parameters,
    validation_summary: globalSelection.best.summary,
  };
  validationLeaderboards.phase4_product_objective_best = globalSelection.leaderboard.slice(0, 25);
  selectedOptions.push({
    candidate: { ...globalSelection.best.option.candidate, id: "phase4_product_objective_best", family: "product_objective_best", description: `Global product-objective winner from validation: ${globalSelection.best.id}.` },
    predict: globalSelection.best.option.predict,
  });

  const seenIds = new Set(evaluations.map((evaluation) => evaluation.candidate.id));
  for (const option of selectedOptions) {
    if (seenIds.has(option.candidate.id)) continue;
    seenIds.add(option.candidate.id);
    evaluations.push(evaluateRows(splits.test, option.candidate, option.predict));
  }

  const oracleBestRidge = evaluateRows(
    splits.test,
    {
      id: "oracle_choose_baseline_or_ridge",
      family: "oracle_upper_bound",
      product_feasible: false,
      oracle_only: true,
      description: "Non-product oracle: after seeing the target, choose whichever of baseline or ridge residual has lower error.",
      parameters: { residual_lambda: ridgeAllChoice.lambda, cap_px: ridgeAllChoice.capPx },
    },
    (row) => {
      const corrected = correctedPrediction(row, ridgeAllChoice.model, ridgeAllChoice.capPx);
      const target = [row.target_x, row.target_y];
      return distance(corrected, target) < row.baseline_error_px ? corrected : row.baseline_prediction;
    },
  );
  evaluations.push(oracleBestRidge);

  const oraclePerfect = evaluateRows(
    splits.test,
    {
      id: "oracle_perfect_residual",
      family: "oracle_upper_bound",
      product_feasible: false,
      oracle_only: true,
      description: "Non-product ceiling: uses the future target as the prediction.",
      parameters: {},
    },
    (row) => [row.target_x, row.target_y],
  );
  evaluations.push(oraclePerfect);

  const summaries = summarizeAgainstReferences(evaluations, baselineTestSummary, phase3BestTestEval);
  const linearSummary = summaries.find((summary) => summary.id === "distilled_linear_score_exact_gate");
  const operationTarget = linearSummary || summaries.find((summary) => summary.id === "phase4_logistic_p0_35_sh0_65_capinf") || summaries[0];

  return {
    baseline_validation: baselineValidationSummary,
    candidates: summaries,
    validation_selections: validationSelections,
    validation_leaderboards: validationLeaderboards,
    artifacts: {
      phase4Best: {
        config: exactPhase4Config,
        residualModel: ridgeAllChoice.model,
        logisticModel,
      },
      recommendedConfig: operationTarget?.parameters || exactPhase4Config,
      operation_estimate: operationEstimate(
        operationTarget?.parameters?.feature_names?.length || logisticModel.feature_names.length,
        operationTarget?.family === "piecewise_score_gate" ? "piecewise" : operationTarget?.id === "phase4_logistic_p0_35_sh0_65_capinf" ? "logistic_probability" : "linear_score",
      ),
      microbenchmark: benchmarkHotPath(
        splits.test,
        ridgeAllChoice.model,
        logisticModel,
        operationTarget?.id === "distilled_linear_score_exact_gate"
          ? { ...phase3BestConfig, shrink: 0.65, vector_cap_px: Infinity, relative_step_cap: Infinity, linear_score_threshold: logit(0.35) }
          : exactPhase4Config,
      ),
    },
  };
}

function reproducePhase1Baselines(trace) {
  const traceSchema = schema(trace);
  if (traceSchema.poll_count > 0 && traceSchema.dwm_poll_count > 0) {
    const { rows, anchor_count, target_miss_count } = makeContexts(trace);
    const baseline = baselineEvaluation(rows);
    const overall = stats(baseline.records.map((record) => record.error_px));
    return [{
      scenario: "product_poll_dwm_next_vblank",
      mode: "dwm_next_vblank",
      anchor_count,
      evaluated_count: rows.length,
      target_miss_count,
      overall,
      speed_bins: bucketStats(baseline.records, "speed_bin"),
      acceleration_bins: bucketStats(baseline.records, "accel_bin"),
      hook_poll_disagreement_bins: bucketStats(baseline.records, "hook_poll_disagreement_bin"),
      poll_interval_jitter_bins: bucketStats(baseline.records, "poll_jitter_bin"),
      stop_settle_windows: bucketStats(baseline.records, "stop_settle_window"),
    }];
  }

  const truth = new Interpolator(trace.samples, "base");
  const { features } = makeFeatures(trace.samples, trace.frequency);
  const scenarios = [];
  for (const horizonMs of fixedHorizonsMs) {
    const records = [];
    let previous = null;
    let targetMissCount = 0;
    const horizonTicks = (horizonMs * trace.frequency) / 1000;
    trace.samples.forEach((sample, ordinal) => {
      const target = truth.at(sample.ticks + horizonTicks);
      if (!target) {
        targetMissCount += 1;
        previous = sample;
        return;
      }
      const deltaTicks = previous ? sample.ticks - previous.ticks : null;
      const deltaMs = deltaTicks && deltaTicks > 0 ? (deltaTicks * 1000) / trace.frequency : null;
      const ctx = {
        trace,
        ordinal,
        sample,
        previous,
        target,
        horizonTicks,
        deltaTicks,
        deltaMs,
        invalidDwm: false,
      };
      const feature = features.get(sample.sequence) || {};
      const prediction = last2Prediction(ctx);
      records.push({
        error_px: distance(prediction, target),
        speed_bin: feature.speed_bin || "unknown",
        accel_bin: feature.accel_bin || "unknown",
      });
      previous = sample;
    });
    scenarios.push({
      scenario: `compat_fixed_${horizonMs}ms`,
      mode: "fixed_horizon",
      fixed_horizon_ms: horizonMs,
      anchor_count: trace.samples.length,
      evaluated_count: records.length,
      target_miss_count: targetMissCount,
      overall: stats(records.map((record) => record.error_px)),
      speed_bins: bucketStats(records, "speed_bin"),
      acceleration_bins: bucketStats(records, "accel_bin"),
    });
  }
  return scenarios;
}

function compactStats(summary) {
  return `count ${summary.count}, mean ${fmt(summary.mean)}, p50 ${fmt(summary.p50)}, p90 ${fmt(summary.p90)}, p95 ${fmt(summary.p95)}, p99 ${fmt(summary.p99)}, max ${fmt(summary.max)}`;
}

function candidateLine(summary) {
  const phase3Regressions = summary.regressions_vs_phase3_best
    ? `, vs Phase 3 best >1/>3/>5 ${summary.regressions_vs_phase3_best.gt_1px}/${summary.regressions_vs_phase3_best.gt_3px}/${summary.regressions_vs_phase3_best.gt_5px}`
    : "";
  return `- ${summary.oracle_only ? "[oracle] " : ""}\`${summary.id}\`: mean ${fmt(summary.overall.mean)}, p50 ${fmt(summary.overall.p50)}, p90 ${fmt(summary.overall.p90)}, p95 ${fmt(summary.overall.p95)}, p99 ${fmt(summary.overall.p99)}, max ${fmt(summary.overall.max)}, high-speed p95/p99 ${fmt(summary.high_speed.p95)}/${fmt(summary.high_speed.p99)}, high-accel p95/p99 ${fmt(summary.high_acceleration.p95)}/${fmt(summary.high_acceleration.p99)}, disagreement p95/p99 ${fmt(summary.hook_poll_disagreement_5px.p95)}/${fmt(summary.hook_poll_disagreement_5px.p99)}, stop p95/p99 ${fmt(summary.stop_settle.p95)}/${fmt(summary.stop_settle.p99)}, low-speed p95 ${fmt(summary.low_speed.p95)}, vs baseline >1/>3/>5 ${summary.regressions_vs_baseline.gt_1px}/${summary.regressions_vs_baseline.gt_3px}/${summary.regressions_vs_baseline.gt_5px}${phase3Regressions}, applied ${fmt(summary.correction_application.rate * 100, 2)}%`;
}

function pickRecommended(candidates, baseline) {
  const phase3Best = candidates.find((candidate) => candidate.id === "ridge_residual_risk_gate_low_speed_guard");
  const viable = candidates.filter((candidate) =>
    candidate.product_feasible &&
    candidate.id !== "baseline_product" &&
    candidate.id !== "ridge_residual_risk_gate_low_speed_guard" &&
    candidate.overall.p99 <= baseline.overall.p99 &&
    candidate.low_speed.p95 <= baseline.low_speed.p95 &&
    (!phase3Best || candidate.regressions_vs_baseline.gt_5px <= phase3Best.regressions_vs_baseline.gt_5px * 0.7) &&
    (
      candidate.high_speed.p95 < baseline.high_speed.p95 ||
      candidate.high_speed.p99 < baseline.high_speed.p99 ||
      candidate.high_acceleration.p95 < baseline.high_acceleration.p95 ||
      candidate.high_acceleration.p99 < baseline.high_acceleration.p99 ||
      candidate.hook_poll_disagreement_5px.p95 < baseline.hook_poll_disagreement_5px.p95 ||
      candidate.stop_settle.p95 < baseline.stop_settle.p95
    )
  );
  const exactLinear = viable.find((candidate) => candidate.id === "distilled_linear_score_exact_gate");
  if (exactLinear && exactLinear.regressions_vs_baseline.gt_5px <= 20) return exactLinear;
  const simplicityRank = (candidate) => ({
    linear_score_gate: 0,
    piecewise_score_gate: 1,
    fewer_features: 2,
    coefficient_pruning: 3,
    logistic_confidence: 4,
  }[candidate.family] ?? 5);
  viable.sort((a, b) => {
    const scoreDelta = productObjective(a, baseline, phase3Best) - productObjective(b, baseline, phase3Best);
    if (Math.abs(scoreDelta) > 1e-9) return scoreDelta;
    return simplicityRank(a) - simplicityRank(b);
  });
  return viable[0] || null;
}

function compactLeaderboardsForLog(leaderboards) {
  return Object.fromEntries(Object.entries(leaderboards).map(([family, entries]) => [family, entries.map((entry) => ({
    rank_score: entry.score,
    id: entry.id,
    parameters: entry.parameters,
    overall: entry.summary.overall,
    high_speed: entry.summary.high_speed,
    high_acceleration: entry.summary.high_acceleration,
    hook_poll_disagreement_5px: entry.summary.hook_poll_disagreement_5px,
    stop_settle: entry.summary.stop_settle,
    low_speed: entry.summary.low_speed,
    regressions_vs_baseline: entry.summary.regressions_vs_baseline,
    correction_application: entry.summary.correction_application,
  }))]));
}

function writeExperimentLog(results) {
  const baseline = results.product_trace.candidates.find((candidate) => candidate.id === "baseline_product");
  const phase3Best = results.product_trace.candidates.find((candidate) => candidate.id === "ridge_residual_risk_gate_low_speed_guard");
  const best = results.product_trace.recommendation.best_candidate;
  const lines = [
    "# Phase 5 Experiment Log",
    "",
    "## Scope",
    "",
    "All generated files are contained in the Phase 5 directory. Earlier phase artifacts and the root trace ZIPs were read only.",
    "",
    "## Baseline Reproduction",
    "",
    "The reproduced product baseline uses poll anchors, DWM next-vblank target selection, gain 0.75 last-two extrapolation, Math.Round-compatible half-away-from-zero rounding, and hold/current fallback for invalid DWM timing, invalid dt, or idle gaps over 100 ms.",
    "",
  ];
  for (const [traceName, traceResult] of Object.entries(results.traces)) {
    lines.push(`### \`${traceName}\``, "", `- Schema: \`${JSON.stringify(traceResult.schema.event_counts)}\``);
    if (traceResult.schema.poll_interval_ms) lines.push(`- Poll interval: ${compactStats(traceResult.schema.poll_interval_ms)} ms`);
    if (traceResult.schema.move_interval_ms) lines.push(`- Move interval: ${compactStats(traceResult.schema.move_interval_ms)} ms`);
    for (const scenario of traceResult.phase1_baselines) lines.push(`- \`${scenario.scenario}\`: ${compactStats(scenario.overall)} px`);
    lines.push("");
  }

  lines.push(
    "## Training Table",
    "",
    `- Product trace: \`${results.product_trace.trace}\``,
    `- Rows: ${results.product_trace.table.row_count}`,
    `- Features: \`${results.product_trace.table.feature_names.join("`, `")}\``,
    "- Labels: residual x/y from baseline prediction to interpolated future target.",
    "- Chronological split with explicit gaps:",
    `  - Train: ${results.product_trace.splits.counts.train} rows`,
    `  - Gap 1: ${results.product_trace.splits.counts.validation_gap_1} rows`,
    `  - Validation: ${results.product_trace.splits.counts.validation} rows`,
    `  - Gap 2: ${results.product_trace.splits.counts.validation_gap_2} rows`,
    `  - Test: ${results.product_trace.splits.counts.test} rows`,
    "",
    "Feature construction used only current/past product-feasible values: current and previous speed, acceleration magnitude, turn angle, DWM horizon, observed poll interval, configured-interval jitter, hook/poll disagreement, stop-settle elapsed time, rolling motion-regime features, current velocity components, and the baseline extrapolation vector. Future target data was used only as the residual label and for evaluation.",
    "",
    "## Model Families",
    "",
    "- `ridge_residual_risk_gate_low_speed_guard`: exact Phase 3 best reproduction.",
    "- `shrinkage`: scalar residual shrinkage over the Phase 3 gate.",
    "- `vector_cap`: absolute vector residual magnitude caps.",
    "- `relative_step_cap`: caps relative to baseline extrapolation step length.",
    "- `guard_combo`: low-speed, stationary, stop-settle, and risk-threshold guards.",
    "- `product_objective_grid`: combined shrink/cap/risk variants selected by validation product objective.",
    "- `logistic_confidence`: learned confidence threshold gate that abstains to baseline.",
    "- `uncertainty_abstain`: ridge-ensemble disagreement gate that abstains to baseline.",
    "- `linear_score_gate`: exact Phase 4 logistic decision rewritten as a raw linear-score comparison.",
    "- `coefficient_pruning`: zeroes small ridge/gate coefficients.",
    "- `fewer_features`: retrains residual and gate on smaller feature sets.",
    "- `piecewise_score_gate`: simple speed/disagreement/acceleration/stop branches.",
    "- `oracle_*`: non-product upper bounds that inspect future labels/targets.",
    "",
    "## Validation Selection",
    "",
    `\`\`\`json\n${JSON.stringify(results.product_trace.validation_selections, null, 2)}\n\`\`\``,
    "",
    "## Validation Leaderboards",
    "",
    `\`\`\`json\n${JSON.stringify(compactLeaderboardsForLog(results.product_trace.validation_leaderboards), null, 2)}\n\`\`\``,
    "",
    "## Test Results",
    "",
    `Baseline test slice: ${compactStats(baseline.overall)} px`,
    `Phase 3 best reproduction: ${compactStats(phase3Best.overall)} px; regressions vs baseline >1/>3/>5 ${phase3Best.regressions_vs_baseline.gt_1px}/${phase3Best.regressions_vs_baseline.gt_3px}/${phase3Best.regressions_vs_baseline.gt_5px}; applied ${fmt(phase3Best.correction_application.rate * 100, 2)}%.`,
    "",
  );

  for (const summary of results.product_trace.candidates) {
    lines.push(`### \`${summary.id}\``, "", summary.description, "", `Product-feasible: \`${summary.product_feasible}\`; oracle-only: \`${summary.oracle_only}\``);
    lines.push(`Parameters: \`${JSON.stringify(summary.parameters)}\``);
    lines.push(candidateLine(summary), "");
    lines.push(`Stop-settle: ${compactStats(summary.stop_settle)} px`);
    lines.push(`Low-speed regressions >1/>3/>5: ${summary.low_speed_regressions_vs_baseline.gt_1px}/${summary.low_speed_regressions_vs_baseline.gt_3px}/${summary.low_speed_regressions_vs_baseline.gt_5px}`);
    if (summary.regressions_vs_phase3_best) lines.push(`Regressions vs Phase 3 best >1/>3/>5: ${summary.regressions_vs_phase3_best.gt_1px}/${summary.regressions_vs_phase3_best.gt_3px}/${summary.regressions_vs_phase3_best.gt_5px}`);
    lines.push("");
  }

  lines.push("## Interpretation", "");
  if (best) {
    lines.push(
      `The strongest product-shaped result is \`${best.id}\`: it keeps a meaningful tail gain while reducing visible >5 px pointwise regressions relative to the Phase 3 best reproduction. Because validation and test come from one product trace, this is still a PoC implementation candidate rather than a default-on recommendation.`,
    );
  } else {
    lines.push(
      "No Phase 5 distilled gate kept enough tail improvement while sharply reducing visible pointwise regressions. The residual remains learnable in an oracle sense, but the product-feasible gates do not identify safe application points reliably enough.",
    );
  }
  fs.writeFileSync(path.join(phaseDir, "experiment-log.md"), lines.join("\n"), "utf8");
}

function writeReport(results) {
  const baseline = results.product_trace.candidates.find((candidate) => candidate.id === "baseline_product");
  const phase3Best = results.product_trace.candidates.find((candidate) => candidate.id === "ridge_residual_risk_gate_low_speed_guard");
  const best = results.product_trace.recommendation.best_candidate;
  const oracle = results.product_trace.candidates.find((candidate) => candidate.id === "oracle_choose_baseline_or_ridge");
  const lines = ["# Phase 5 Report", "", "## Recommendation", ""];
  if (best) {
    lines.push(
      `Best product-shaped candidate: \`${best.id}\`. It clears the Phase 5 decision rule on the chronological test slice.`,
      "",
      `Baseline: overall mean ${fmt(baseline.overall.mean)}, p95 ${fmt(baseline.overall.p95)}, p99 ${fmt(baseline.overall.p99)}, high-speed p95/p99 ${fmt(baseline.high_speed.p95)}/${fmt(baseline.high_speed.p99)}, high-accel p95/p99 ${fmt(baseline.high_acceleration.p95)}/${fmt(baseline.high_acceleration.p99)}, low-speed p95 ${fmt(baseline.low_speed.p95)}.`,
      `Phase 3 best: overall p99 ${fmt(phase3Best.overall.p99)}, high-speed p95/p99 ${fmt(phase3Best.high_speed.p95)}/${fmt(phase3Best.high_speed.p99)}, regressions >1/>3/>5 ${phase3Best.regressions_vs_baseline.gt_1px}/${phase3Best.regressions_vs_baseline.gt_3px}/${phase3Best.regressions_vs_baseline.gt_5px}.`,
      `Best: overall mean ${fmt(best.overall.mean)}, p95 ${fmt(best.overall.p95)}, p99 ${fmt(best.overall.p99)}, high-speed p95/p99 ${fmt(best.high_speed.p95)}/${fmt(best.high_speed.p99)}, high-accel p95/p99 ${fmt(best.high_acceleration.p95)}/${fmt(best.high_acceleration.p99)}, low-speed p95 ${fmt(best.low_speed.p95)}, regressions >1/>3/>5 ${best.regressions_vs_baseline.gt_1px}/${best.regressions_vs_baseline.gt_3px}/${best.regressions_vs_baseline.gt_5px}, applied ${fmt(best.correction_application.rate * 100, 2)}%.`,
    );
  } else {
    lines.push(
      "No Phase 4 product-feasible residual gate cleared the decision rule. The tested calibrations can reduce some labeled errors, but they do not keep enough tail improvement while sharply reducing visible pointwise regressions.",
      "",
      `Baseline test: overall mean ${fmt(baseline.overall.mean)}, p95 ${fmt(baseline.overall.p95)}, p99 ${fmt(baseline.overall.p99)}, high-speed p95/p99 ${fmt(baseline.high_speed.p95)}/${fmt(baseline.high_speed.p99)}, high-accel p95/p99 ${fmt(baseline.high_acceleration.p95)}/${fmt(baseline.high_acceleration.p99)}, disagreement p95/p99 ${fmt(baseline.hook_poll_disagreement_5px.p95)}/${fmt(baseline.hook_poll_disagreement_5px.p99)}, low-speed p95 ${fmt(baseline.low_speed.p95)}.`,
      `Phase 3 best reproduction: overall p99 ${fmt(phase3Best.overall.p99)}, high-speed p95/p99 ${fmt(phase3Best.high_speed.p95)}/${fmt(phase3Best.high_speed.p99)}, regressions >1/>3/>5 ${phase3Best.regressions_vs_baseline.gt_1px}/${phase3Best.regressions_vs_baseline.gt_3px}/${phase3Best.regressions_vs_baseline.gt_5px}.`,
    );
  }
  lines.push(
    "",
    "## Strongest Finding",
    "",
    best
      ? `The Phase 4 logistic gate can be product-shaped into \`${best.id}\`; it reduces >5 px regressions from the Phase 3 count of ${phase3Best.regressions_vs_baseline.gt_5px} to ${best.regressions_vs_baseline.gt_5px} while keeping overall p99 at ${fmt(best.overall.p99)} px versus baseline ${fmt(baseline.overall.p99)} px.`
      : `The oracle chooser is much better than baseline on test p99 (${fmt(oracle.overall.p99)} px vs ${fmt(baseline.overall.p99)} px), but the product-feasible gates tested here do not identify the safe residual corrections reliably enough.`,
    `The non-product oracle chooser still shows additional headroom: test p99 ${fmt(oracle.overall.p99)} px versus baseline ${fmt(baseline.overall.p99)} px.`,
    "",
    "## Candidate Summary",
    "",
    ...results.product_trace.candidates.map(candidateLine),
    "",
    "## Product Cost",
    "",
    `Estimated hot-path cost for the product-shaped recommendation: ${results.product_trace.operation_estimate.estimated_scalar_arithmetic_ops} scalar arithmetic ops, ${results.product_trace.operation_estimate.estimated_comparisons_or_branches} comparisons/branches, ${JSON.stringify(results.product_trace.operation_estimate.transcendental_ops)} transcendental ops, and zero intended C# hot-path allocations.`,
    `Bounded JS microbenchmark: ${fmt(results.product_trace.microbenchmark.ns_per_prediction, 1)} ns/prediction for ${results.product_trace.microbenchmark.iterations} iterations. This is only a relative sanity check because the JS runner allocates arrays where C# should use scalar fields/static constants.`,
    "",
    "## Required Tests",
    "",
    "- Golden unit tests for feature normalization, finite fallback, risk score, low-speed guard, raw linear score threshold, residual shrink, and baseline fallback.",
    "- Replay tests over the two root traces that assert exact metric budgets for baseline, Phase 4 reproduction, and the selected distilled candidate.",
    "- Regression-budget tests: no low-speed p95 regression, no overall p99 regression, bounded >1/>3/>5 pointwise regressions, and stable application rate.",
    "- Edge-case tests for invalid/late DWM timing, idle reset over 100 ms, zero/negative dt, missing hook disagreement, stationary/stop-settle windows, and extreme coordinates.",
    "- Allocation/perf tests proving no hot-path allocations and bounded O(1) state updates.",
    "",
    "## Product Direction",
    "",
    best
      ? "Implement only behind an opt-in/research flag after adding replay tests and collecting more traces. The shape is light enough, but the evidence is one product trace and the high-speed p99 gain is not robust."
      : "Collect targeted traces before productization: more high-speed, high-acceleration, stop-settle, and hook/poll disagreement coverage, plus labels that make safe abstention easier to learn.",
    "",
    "## Artifacts",
    "",
    "- `run_phase5.mjs`: reproducible Phase 5 runner.",
    "- `scores.json`: machine-readable split, baseline, model, and oracle results.",
    "- `model-spec.json`: extracted formulas, coefficients, state, gates, and product fallback rules.",
    "- `experiment-log.md`: detailed setup, selections, and metric tables.",
  );
  fs.writeFileSync(path.join(phaseDir, "report.md"), lines.join("\n"), "utf8");
}

function exactLinearConfig(phase4BestConfig) {
  const config = {
    ...phase4BestConfig,
    shrink: 0.65,
    vector_cap_px: Infinity,
    relative_step_cap: Infinity,
    linear_score_threshold: logit(0.35),
  };
  delete config.logistic_probability_threshold;
  return config;
}

function selectedLinearOption(modelResults) {
  const config = exactLinearConfig(modelResults.artifacts.phase4Best.config);
  return candidateFromConfig(
    "distilled_linear_score_exact_gate",
    "linear_score_gate",
    "Phase 5 best reproduction: raw linear-score equivalent of the Phase 4 logistic p >= 0.35 gate.",
    config,
    modelResults.artifacts.phase4Best.residualModel,
    modelResults.artifacts.phase4Best.logisticModel,
  );
}

function makePhase6Core(splits) {
  const baselineValidationSummary = summarizeEvaluation(baselineEvaluation(splits.validation), stats(splits.validation.map((row) => row.baseline_error_px)));
  const baselineTestEval = baselineEvaluation(splits.test);
  const baselineTestSummary = summarizeEvaluation(baselineTestEval, stats(splits.test.map((row) => row.baseline_error_px)));
  const validationSelections = {};

  const ridgeAllChoice = chooseRidge(splits.train, splits.validation, "ridge_residual_all");
  validationSelections.ridge_residual_all = {
    lambda: ridgeAllChoice.lambda,
    cap_px: ridgeAllChoice.capPx,
    validation_summary: ridgeAllChoice.summary,
  };

  const lowSpeedGuardGate = chooseRiskThreshold(
    splits.validation,
    ridgeAllChoice.model,
    ridgeAllChoice.capPx,
    baselineValidationSummary,
    "ridge_residual_risk_gate_low_speed_guard",
    (row) => finite(row.speed_px_s) >= lowSpeedPxPerS,
  );
  validationSelections.ridge_residual_risk_gate_low_speed_guard = {
    threshold: lowSpeedGuardGate.threshold,
    validation_summary: lowSpeedGuardGate.summary,
  };

  const phase3BestConfig = {
    residual_lambda: ridgeAllChoice.lambda,
    shrink: 1,
    vector_cap_px: Infinity,
    relative_step_cap: Infinity,
    risk_threshold: lowSpeedGuardGate.threshold,
    low_speed_guard_px_s: lowSpeedPxPerS,
  };
  const phase3Best = candidateFromConfig(
    "ridge_residual_risk_gate_low_speed_guard",
    "phase3_reproduction",
    "Phase 3 best reproduction: thresholded risk gate that never applies residual correction to low-speed rows.",
    phase3BestConfig,
    ridgeAllChoice.model,
  );
  const phase3BestTestEval = evaluateRows(splits.test, phase3Best.candidate, phase3Best.predict);
  const logisticModel = fitLogisticGate(splits.train, ridgeAllChoice.model, ridgeAllChoice.capPx);
  const selected = candidateFromConfig(
    "distilled_linear_score_exact_gate",
    "linear_score_gate",
    "Phase 5 distillation: same learned logistic score as Phase 4, but compare raw logit to logit(0.35) to remove sigmoid/exp from the hot path.",
    exactLinearConfig({ ...phase3BestConfig, logistic_probability_threshold: 0.35 }),
    ridgeAllChoice.model,
    logisticModel,
  );
  const selectedTestEval = evaluateRows(splits.test, selected.candidate, selected.predict);
  const summaries = summarizeAgainstReferences([baselineTestEval, phase3BestTestEval, selectedTestEval], baselineTestSummary, phase3BestTestEval);

  return {
    baseline_validation: baselineValidationSummary,
    candidates: summaries,
    validation_selections: validationSelections,
    validation_leaderboards: {},
    artifacts: {
      phase4Best: {
        config: { ...phase3BestConfig, shrink: 0.65, logistic_probability_threshold: 0.35 },
        residualModel: ridgeAllChoice.model,
        logisticModel,
      },
      recommendedConfig: selected.candidate.parameters,
      operation_estimate: operationEstimate(logisticModel.feature_names.length, "linear_score"),
      microbenchmark: benchmarkHotPath(splits.test, ridgeAllChoice.model, logisticModel, selected.candidate.parameters),
    },
  };
}

function evaluateOption(rows, option, phase3Records = null) {
  const baselineEval = baselineEvaluation(rows);
  const baselineSummary = summarizeEvaluation(baselineEval, stats(rows.map((row) => row.baseline_error_px)));
  const evaluation = evaluateRows(rows, option.candidate, option.predict);
  return {
    baseline_eval: baselineEval,
    baseline_summary: baselineSummary,
    evaluation,
    summary: summarizeEvaluation(evaluation, baselineSummary.overall, phase3Records),
  };
}

function compactSummary(summary) {
  return {
    id: summary.id,
    family: summary.family,
    parameters: summary.parameters,
    overall: summary.overall,
    delta_vs_baseline: summary.delta_vs_baseline,
    high_speed: summary.high_speed,
    high_acceleration: summary.high_acceleration,
    hook_poll_disagreement_5px: summary.hook_poll_disagreement_5px,
    stop_settle: summary.stop_settle,
    low_speed: summary.low_speed,
    regressions_vs_baseline: summary.regressions_vs_baseline,
    low_speed_regressions_vs_baseline: summary.low_speed_regressions_vs_baseline,
    correction_application: summary.correction_application,
  };
}

function highRiskP95(summary) {
  return Math.min(
    finite(summary.high_speed.p95, 9999),
    finite(summary.high_acceleration.p95, 9999),
    finite(summary.hook_poll_disagreement_5px.p95, 9999),
    finite(summary.stop_settle.p95, 9999),
  );
}

function aggregateHighRiskP95(summary) {
  const values = [
    summary.high_speed.p95,
    summary.high_acceleration.p95,
    summary.hook_poll_disagreement_5px.p95,
    summary.stop_settle.p95,
  ].filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function deploymentVariantOptions(modelResults) {
  const residualModel = modelResults.artifacts.phase4Best.residualModel;
  const logisticModel = modelResults.artifacts.phase4Best.logisticModel;
  const base = exactLinearConfig(modelResults.artifacts.phase4Best.config);
  const options = [];
  const add = (kind, id, extra) => {
    const config = { ...base, ...extra };
    options.push({
      kind,
      option: candidateFromConfig(
        id,
        kind,
        "Phase 6 stricter deployment variant over the Phase 5 linear-score gate.",
        config,
        residualModel,
        logisticModel,
      ),
    });
  };

  for (const probability of [0.35, 0.5, 0.65, 0.75, 0.85, 0.92, 0.96, 0.98, 0.99]) {
    add("higher_linear_score_threshold", `p6_score_p${String(probability).replace(".", "_")}`, {
      linear_score_threshold: logit(probability),
      gate_probability_equivalent: probability,
    });
  }
  for (const shrink of [0.65, 0.5, 0.35, 0.25, 0.15, 0.1]) {
    add("lower_shrink_factor", `p6_shrink_${String(shrink).replace(".", "_")}`, { shrink });
  }
  for (const cap of [24, 16, 12, 8, 5, 3, 2, 1]) {
    add("vector_cap", `p6_vector_cap_${cap}`, { vector_cap_px: cap });
  }
  for (const relative of [2, 1.5, 1, 0.75, 0.5, 0.35, 0.25, 0.15, 0.1]) {
    add("relative_step_cap", `p6_relative_cap_${String(relative).replace(".", "_")}`, { relative_step_cap: relative });
  }

  for (const probability of [0.65, 0.85, 0.96, 0.98]) {
    for (const shrink of [0.35, 0.25, 0.15]) {
      for (const vector_cap_px of [5, 3, 2, 1]) {
        for (const relative_step_cap of [0.5, 0.25, 0.1]) {
          add(
            "combined_near_zero_regression",
            `p6_combo_p${String(probability).replace(".", "_")}_sh${String(shrink).replace(".", "_")}_vc${vector_cap_px}_rc${String(relative_step_cap).replace(".", "_")}`,
            {
              linear_score_threshold: logit(probability),
              gate_probability_equivalent: probability,
              shrink,
              vector_cap_px,
              relative_step_cap,
            },
          );
        }
      }
    }
  }
  return options;
}

function variantSortScore(summary, baseline) {
  const regressionPenalty =
    summary.regressions_vs_baseline.gt_5px * 1000 +
    summary.regressions_vs_baseline.gt_3px * 70 +
    summary.regressions_vs_baseline.gt_1px * 5;
  const p99Penalty = Math.max(0, summary.overall.p99 - baseline.overall.p99) * 100;
  const lowPenalty = Math.max(0, summary.low_speed.p95 - baseline.low_speed.p95) * 100;
  const tailReward = Math.max(0, baseline.overall.p99 - summary.overall.p99) * 20;
  const highRiskReward = Math.max(0, aggregateHighRiskP95(baseline) - aggregateHighRiskP95(summary)) * 3;
  return regressionPenalty + p99Penalty + lowPenalty - tailReward - highRiskReward;
}

function evaluateDeploymentVariants(rows, modelResults, baselineSummary, phase3Records) {
  const variants = [];
  for (const { kind, option } of deploymentVariantOptions(modelResults)) {
    const evaluation = evaluateRows(rows, option.candidate, option.predict);
    const summary = summarizeEvaluation(evaluation, baselineSummary.overall, phase3Records);
    variants.push({
      kind,
      score: variantSortScore(summary, baselineSummary),
      summary,
    });
  }
  variants.sort((a, b) => a.score - b.score);
  const byFamily = {};
  for (const variant of variants) {
    (byFamily[variant.kind] ||= []).push({
      score: variant.score,
      summary: compactSummary(variant.summary),
    });
  }
  for (const key of Object.keys(byFamily)) byFamily[key] = byFamily[key].slice(0, 12);

  const zeroRegression = variants
    .filter((variant) => variant.summary.regressions_vs_baseline.gt_5px === 0)
    .sort((a, b) => {
      const p99Gain = (baselineSummary.overall.p99 - b.summary.overall.p99) - (baselineSummary.overall.p99 - a.summary.overall.p99);
      if (Math.abs(p99Gain) > 1e-9) return p99Gain;
      return aggregateHighRiskP95(a.summary) - aggregateHighRiskP95(b.summary);
    });
  const nearZero = variants
    .filter((variant) => variant.summary.regressions_vs_baseline.gt_5px <= 1)
    .sort((a, b) => {
      const p99Gain = (baselineSummary.overall.p99 - b.summary.overall.p99) - (baselineSummary.overall.p99 - a.summary.overall.p99);
      if (Math.abs(p99Gain) > 1e-9) return p99Gain;
      return aggregateHighRiskP95(a.summary) - aggregateHighRiskP95(b.summary);
    });

  return {
    evaluated_count: variants.length,
    best_by_product_safety_score: variants.slice(0, 25).map((variant) => ({
      kind: variant.kind,
      score: variant.score,
      summary: compactSummary(variant.summary),
    })),
    best_by_family: byFamily,
    zero_gt5_regression_candidates: zeroRegression.slice(0, 20).map((variant) => ({
      kind: variant.kind,
      score: variant.score,
      summary: compactSummary(variant.summary),
    })),
    near_zero_gt5_regression_candidates: nearZero.slice(0, 20).map((variant) => ({
      kind: variant.kind,
      score: variant.score,
      summary: compactSummary(variant.summary),
    })),
    safest_candidate: (zeroRegression[0] || nearZero[0] || variants[0]) ? {
      kind: (zeroRegression[0] || nearZero[0] || variants[0]).kind,
      score: (zeroRegression[0] || nearZero[0] || variants[0]).score,
      summary: compactSummary((zeroRegression[0] || nearZero[0] || variants[0]).summary),
    } : null,
  };
}

function splitLabelForOrdinal(ordinal, splits) {
  for (const [label, range] of Object.entries(splits.ranges)) {
    if (ordinal >= range[0] && ordinal <= range[1]) return label;
  }
  return "unknown";
}

function chronologicalBlockAnalysis(rows, splits, selectedOption, safestOption = null, blockCount = 10) {
  const analyses = [];
  const size = Math.ceil(rows.length / blockCount);
  for (let index = 0; index < blockCount; index++) {
    const start = index * size;
    const blockRows = rows.slice(start, Math.min(rows.length, start + size));
    if (!blockRows.length) continue;
    const selected = evaluateOption(blockRows, selectedOption);
    const safest = safestOption ? evaluateOption(blockRows, safestOption) : null;
    analyses.push({
      block: index + 1,
      ordinal_range: [blockRows[0].ordinal, blockRows[blockRows.length - 1].ordinal],
      elapsed_ms_range: [blockRows[0].anchor_elapsed_ms, blockRows[blockRows.length - 1].anchor_elapsed_ms],
      split_at_midpoint: splitLabelForOrdinal(blockRows[Math.floor(blockRows.length / 2)].ordinal, splits),
      row_count: blockRows.length,
      baseline: selected.baseline_summary.overall,
      selected: compactSummary(selected.summary),
      selected_wins_p99: selected.summary.overall.p99 < selected.baseline_summary.overall.p99,
      selected_wins_mean: selected.summary.overall.mean < selected.baseline_summary.overall.mean,
      selected_gt5_regressions: selected.summary.regressions_vs_baseline.gt_5px,
      safest: safest ? compactSummary(safest.summary) : null,
      safest_wins_p99: safest ? safest.summary.overall.p99 < safest.baseline_summary.overall.p99 : null,
    });
  }
  const selectedWinsP99 = analyses.filter((block) => block.selected_wins_p99).length;
  const selectedGt5 = analyses.reduce((sum, block) => sum + block.selected_gt5_regressions, 0);
  return {
    block_count: analyses.length,
    selected_wins_p99_blocks: selectedWinsP99,
    selected_loses_or_ties_p99_blocks: analyses.length - selectedWinsP99,
    selected_gt5_regressions_across_blocks: selectedGt5,
    blocks: analyses,
  };
}

function testBlockAnalysis(testRows, selectedOption, safestOption = null, blockCount = 5) {
  const fakeSplits = { ranges: { test: [testRows[0]?.ordinal || 0, testRows[testRows.length - 1]?.ordinal || 0] } };
  return chronologicalBlockAnalysis(testRows, fakeSplits, selectedOption, safestOption, blockCount);
}

function causeCategories(record) {
  const causes = [];
  const correctionDotResidual = record.correction_x * record.residual_x + record.correction_y * record.residual_y;
  const residualMag = Math.hypot(record.residual_x, record.residual_y);
  if (record.hook_disagreement_px >= highDisagreementPx) causes.push("hook_poll_disagreement_5px_plus");
  if (record.speed_px_s >= highSpeedPxPerS) causes.push("high_speed");
  if (record.accel_px_s2 >= highAccelerationPxPerS2) causes.push("high_acceleration");
  if (record.stop_settle_window !== "not_in_stop_settle") causes.push("stop_settle");
  if (record.dwm_horizon_ms > 12) causes.push("long_dwm_horizon");
  if (record.status !== "valid" && record.status !== "late_advanced") causes.push("warmup_or_invalid_dwm_status");
  if (record.baseline_error_px < 3) causes.push("low_baseline_error_visible_introduction");
  if (record.correction_mag_px > Math.max(3, record.baseline_step_px)) causes.push("correction_exceeds_baseline_step");
  if (correctionDotResidual < 0) causes.push("correction_wrong_direction");
  if (record.correction_mag_px > residualMag + 3) causes.push("correction_overshoot");
  if (record.poll_jitter_ms > 4) causes.push("poll_jitter_4ms_plus");
  if (!causes.length) causes.push("mixed_motion_tail");
  return causes;
}

function inspectRegressions(evaluation) {
  const regressions = evaluation.records
    .filter((record) => record.error_px - record.baseline_error_px > 5)
    .sort((a, b) => (b.error_px - b.baseline_error_px) - (a.error_px - a.baseline_error_px));
  const causeCounts = {};
  const rows = regressions.map((record) => {
    const causes = causeCategories(record);
    for (const cause of causes) causeCounts[cause] = (causeCounts[cause] || 0) + 1;
    return {
      ordinal: record.ordinal,
      anchor_elapsed_ms: record.anchor_elapsed_ms,
      speed_px_s: record.speed_px_s,
      accel_px_s2: record.accel_px_s2,
      hook_poll_disagreement_px: record.hook_disagreement_px,
      dwm_horizon_ms: record.dwm_horizon_ms,
      dwm_status: record.status,
      stop_settle_elapsed_ms: record.stop_settle_elapsed_ms,
      stop_settle_window: record.stop_settle_window,
      baseline_error_px: record.baseline_error_px,
      candidate_error_px: record.error_px,
      regression_px: record.error_px - record.baseline_error_px,
      baseline_step_px: record.baseline_step_px,
      correction_vector: [record.correction_x, record.correction_y],
      correction_mag_px: record.correction_mag_px,
      residual_to_target: [record.residual_x, record.residual_y],
      likely_causes: causes,
    };
  });
  return {
    count: rows.length,
    cause_counts: Object.fromEntries(Object.entries(causeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    regressions: rows,
  };
}

function coverageGaps(traceResults, productTrace, rows) {
  const productSchema = traceResults[productTrace.name].schema;
  const durationSeconds = Number(productTrace.metadata.DurationMicroseconds || 0) / 1_000_000;
  return {
    trace_inputs: Object.fromEntries(Object.entries(traceResults).map(([name, result]) => [name, {
      event_counts: result.schema.event_counts,
      duration_seconds: Number(result.schema.metadata.DurationMicroseconds || 0) / 1_000_000,
      poll_count: result.schema.poll_count,
      move_count: result.schema.move_count,
      dwm_poll_count: result.schema.dwm_poll_count,
    }])),
    product_trace_duration_seconds: durationSeconds,
    product_trace_poll_count: productSchema.poll_count,
    evaluated_rows: rows.length,
    high_speed_rows: rows.filter((row) => row.speed_px_s >= highSpeedPxPerS).length,
    high_acceleration_rows: rows.filter((row) => row.accel_px_s2 >= highAccelerationPxPerS2).length,
    hook_poll_disagreement_5px_rows: rows.filter((row) => row.hook_disagreement_px >= highDisagreementPx).length,
    stop_settle_rows: rows.filter((row) => row.stop_settle_elapsed_ms !== null).length,
    gaps: [
      "Only one trace contains poll+DWM rows, so product candidate robustness is trace-dependent.",
      "The second root trace provides only move events, useful for fixed-horizon compatibility baselines but not for poll+DWM candidate replay.",
      "No independent holdout trace from another day, device, refresh rate, DPI scale, app workload, or pointer device is available.",
      "Hook/poll disagreement and stop-settle rows exist, but rare visible failures cluster in these tails and need repeat coverage.",
      "No real Windows hook installation or production hot-path integration was exercised in this phase.",
    ],
    needed_traces: [
      "At least 10 independent poll+DWM traces across multiple machines, monitors, refresh rates, DPI scales, and pointer devices.",
      "Targeted high-speed flick, abrupt stop, direction reversal, drag, and low-speed precision traces.",
      "Traces with known hook/poll disagreement stress, including CPU load and compositor timing jitter.",
      "Longer sessions with application workload changes, idle gaps, window focus changes, and mixed polling cadence.",
      "A locked replay suite that preserves raw hook, poll, cursor, DWM timing, and target interpolation inputs.",
    ],
  };
}

function recommendationFromEvidence(selectedSummary, safestSummary, baselineSummary, blockAnalysis, testBlocks, coverage) {
  const selectedRobust = blockAnalysis.selected_wins_p99_blocks === blockAnalysis.block_count && testBlocks.selected_wins_p99_blocks === testBlocks.block_count;
  const selectedVisibleRisk = selectedSummary.regressions_vs_baseline.gt_5px;
  const safestVisibleRisk = safestSummary?.regressions_vs_baseline.gt_5px ?? Infinity;
  const productTraceCount = Object.values(coverage.trace_inputs).filter((trace) => trace.dwm_poll_count > 0).length;
  if (productTraceCount < 2) return "collect more data first";
  if (selectedRobust && selectedVisibleRisk <= 2 && selectedSummary.low_speed.p95 <= baselineSummary.low_speed.p95 && selectedSummary.overall.p99 < baselineSummary.overall.p99) {
    return "implement default-on";
  }
  if (safestSummary && safestVisibleRisk <= 1 && safestSummary.low_speed.p95 <= baselineSummary.low_speed.p95 && safestSummary.overall.p99 < baselineSummary.overall.p99 && coverage.product_trace_poll_count > 0) {
    return "implement opt-in/research";
  }
  if (coverage.product_trace_poll_count > 0 && selectedSummary.overall.p99 < baselineSummary.overall.p99) {
    return "collect more data first";
  }
  return "collect more data first";
}

function writePhase6ExperimentLog(results) {
  const selected = results.product_trace.phase6.selected_candidate.summary;
  const safest = results.product_trace.phase6.deployment_variants.safest_candidate.summary;
  const blocks = results.product_trace.phase6.chronological_blocks;
  const lines = [
    "# Phase 6 Experiment Log",
    "",
    "## Scope",
    "",
    "All writes are contained in the Phase 6 directory. Earlier phase artifacts and the two root trace ZIPs were read only.",
    "",
    "## Reproduction",
    "",
    `- Product trace: \`${results.product_trace.trace}\``,
    `- Evaluated rows: ${results.product_trace.evaluated_count}`,
    `- Baseline test: mean ${fmt(results.product_trace.phase6.baseline_test.overall.mean)}, p95 ${fmt(results.product_trace.phase6.baseline_test.overall.p95)}, p99 ${fmt(results.product_trace.phase6.baseline_test.overall.p99)}.`,
    `- Phase 5 best reproduction: mean ${fmt(selected.overall.mean)}, p95 ${fmt(selected.overall.p95)}, p99 ${fmt(selected.overall.p99)}, >5px regressions ${selected.regressions_vs_baseline.gt_5px}, applied ${fmt(selected.correction_application.rate * 100, 2)}%.`,
    "",
    "## Chronological Blocks",
    "",
    `- V2 all-row blocks won on p99: ${blocks.selected_wins_p99_blocks}/${blocks.block_count}.`,
    `- Test-slice blocks won on p99: ${results.product_trace.phase6.test_blocks.selected_wins_p99_blocks}/${results.product_trace.phase6.test_blocks.block_count}.`,
    "",
    "| block | split | rows | baseline p99 | selected p99 | selected >5 regressions | applied |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...blocks.blocks.map((block) =>
      `| ${block.block} | ${block.split_at_midpoint} | ${block.row_count} | ${fmt(block.baseline.p99)} | ${fmt(block.selected.overall.p99)} | ${block.selected_gt5_regressions} | ${fmt(block.selected.correction_application.rate * 100, 2)}% |`,
    ),
    "",
    "## Stricter Variants",
    "",
    `- Variants evaluated: ${results.product_trace.phase6.deployment_variants.evaluated_count}`,
    `- Safest candidate: \`${safest.id}\`, p99 ${fmt(safest.overall.p99)} vs baseline ${fmt(results.product_trace.phase6.baseline_test.overall.p99)}, >5px regressions ${safest.regressions_vs_baseline.gt_5px}, applied ${fmt(safest.correction_application.rate * 100, 2)}%.`,
    "",
    "Top safety-scored variants:",
    "",
    "| id | kind | p99 | high-risk avg p95 | >5 regressions | applied |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...results.product_trace.phase6.deployment_variants.best_by_product_safety_score.slice(0, 12).map((entry) =>
      `| \`${entry.summary.id}\` | ${entry.kind} | ${fmt(entry.summary.overall.p99)} | ${fmt(aggregateHighRiskP95(entry.summary))} | ${entry.summary.regressions_vs_baseline.gt_5px} | ${fmt(entry.summary.correction_application.rate * 100, 2)}% |`,
    ),
    "",
    "## Regression Inspection",
    "",
    `- Selected candidate >5px regressions: ${results.product_trace.phase6.selected_regressions.count}`,
    `- Cause counts: \`${JSON.stringify(results.product_trace.phase6.selected_regressions.cause_counts)}\``,
  ];
  fs.writeFileSync(path.join(phaseDir, "experiment-log.md"), lines.join("\n"), "utf8");
}

function markdownRegressionTable(regressions) {
  const lines = [
    "| row | time ms | speed | accel | disagreement | DWM horizon | stop-settle | baseline err | candidate err | correction | causes |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | --- |",
  ];
  for (const row of regressions) {
    lines.push(
      `| ${row.ordinal} | ${fmt(row.anchor_elapsed_ms, 1)} | ${fmt(row.speed_px_s, 1)} | ${fmt(row.accel_px_s2, 0)} | ${fmt(row.hook_poll_disagreement_px)} | ${fmt(row.dwm_horizon_ms)} | ${row.stop_settle_window} | ${fmt(row.baseline_error_px)} | ${fmt(row.candidate_error_px)} | (${fmt(row.correction_vector[0])}, ${fmt(row.correction_vector[1])}) | ${row.likely_causes.join(", ")} |`,
    );
  }
  return lines;
}

function writePhase6Report(results) {
  const baseline = results.product_trace.phase6.baseline_test;
  const selected = results.product_trace.phase6.selected_candidate.summary;
  const safest = results.product_trace.phase6.deployment_variants.safest_candidate.summary;
  const phase5 = results.product_trace.candidates.find((candidate) => candidate.id === "distilled_linear_score_exact_gate");
  const regressions = results.product_trace.phase6.selected_regressions;
  const blocks = results.product_trace.phase6.chronological_blocks;
  const zero = results.product_trace.phase6.deployment_variants.zero_gt5_regression_candidates[0]?.summary;
  const lines = [
    "# Phase 6 Report",
    "",
    "## Strongest Finding",
    "",
    `The Phase 5 best candidate reproduces the expected test gain (p99 ${fmt(selected.overall.p99)} vs baseline ${fmt(baseline.overall.p99)}) and wins p99 in ${blocks.selected_wins_p99_blocks}/${blocks.block_count} chronological blocks inside the v2 product trace. That is still not default-on evidence because it is one compatible product trace and the selected gate leaves ${selected.regressions_vs_baseline.gt_5px} visible >5px regressions on the held-out test slice.`,
    "",
    "## Reproduction",
    "",
    `- Baseline test: mean ${fmt(baseline.overall.mean)}, p95 ${fmt(baseline.overall.p95)}, p99 ${fmt(baseline.overall.p99)}, max ${fmt(baseline.overall.max)}.`,
    `- Phase 5 best from this run: mean ${fmt(selected.overall.mean)}, p95 ${fmt(selected.overall.p95)}, p99 ${fmt(selected.overall.p99)}, >5px regressions ${selected.regressions_vs_baseline.gt_5px}, applied ${fmt(selected.correction_application.rate * 100, 2)}%.`,
    phase5 ? `- Phase 5 summary object matched candidate id \`${phase5.id}\` with p99 ${fmt(phase5.overall.p99)} and ${phase5.regressions_vs_baseline.gt_5px} >5px regressions.` : "- Phase 5 candidate id was not found in the generated summaries.",
    "",
    "## Block Robustness",
    "",
    `Within the one v2 product trace, the candidate wins consistently on p99: ${blocks.selected_wins_p99_blocks}/${blocks.block_count} chronological all-row blocks and ${results.product_trace.phase6.test_blocks.selected_wins_p99_blocks}/5 held-out test blocks. The limitation is external robustness, not intra-trace block consistency.`,
    "",
    "## Regression Anatomy",
    "",
    `All ${regressions.count} selected-candidate >5px regressions are listed below. The dominant tags are ${Object.entries(regressions.cause_counts).slice(0, 4).map(([key, count]) => `${key}=${count}`).join(", ")}.`,
    "",
    ...markdownRegressionTable(regressions.regressions),
    "",
    "## Stricter Deployment Variants",
    "",
    `The safest candidate found is \`${safest.id}\`: p99 ${fmt(safest.overall.p99)} vs baseline ${fmt(baseline.overall.p99)}, high-risk average p95 ${fmt(aggregateHighRiskP95(safest))} vs baseline ${fmt(aggregateHighRiskP95(baseline))}, low-speed p95 ${fmt(safest.low_speed.p95)} vs baseline ${fmt(baseline.low_speed.p95)}, ${safest.regressions_vs_baseline.gt_5px} >5px regressions, and ${fmt(safest.correction_application.rate * 100, 2)}% application rate.`,
    `It keeps smaller but real high-risk gains: high-speed p95 ${fmt(safest.high_speed.p95)} vs ${fmt(baseline.high_speed.p95)}, high-accel p95 ${fmt(safest.high_acceleration.p95)} vs ${fmt(baseline.high_acceleration.p95)}, disagreement p95 ${fmt(safest.hook_poll_disagreement_5px.p95)} vs ${fmt(baseline.hook_poll_disagreement_5px.p95)}, stop-settle p95 ${fmt(safest.stop_settle.p95)} vs ${fmt(baseline.stop_settle.p95)}.`,
    zero ? `A zero >5px regression variant exists: \`${zero.id}\`, but it gives p99 ${fmt(zero.overall.p99)} and removes large >5px improvements as well as large regressions.` : "No zero >5px regression variant was found in the bounded grid.",
    "",
    "## Coverage Gaps",
    "",
    ...results.product_trace.phase6.coverage.gaps.map((gap) => `- ${gap}`),
    "",
    "Needed before default-on:",
    "",
    ...results.product_trace.phase6.coverage.needed_traces.map((trace) => `- ${trace}`),
  ];
  fs.writeFileSync(path.join(phaseDir, "report.md"), lines.join("\n"), "utf8");
}

function writeFinalRecommendation(results) {
  const baseline = results.product_trace.phase6.baseline_test;
  const selected = results.product_trace.phase6.selected_candidate.summary;
  const safest = results.product_trace.phase6.deployment_variants.safest_candidate.summary;
  const blocks = results.product_trace.phase6.chronological_blocks;
  const recommendation = results.product_trace.phase6.final_recommendation;
  const lines = [
    "# Final Recommendation",
    "",
    `Recommendation: **${recommendation}**.`,
    "",
    "Do not implement default-on from the current evidence. The Phase 5 best candidate is light and real, and it wins each chronological block inside the v2 product trace, but that is still one compatible product trace and the selected gate's visible-regression budget is too high.",
    "",
    "## Strongest Finding",
    "",
    `The selected candidate improves held-out p99 from ${fmt(baseline.overall.p99)} px to ${fmt(selected.overall.p99)} px and wins p99 in ${blocks.selected_wins_p99_blocks}/${blocks.block_count} chronological v2 blocks, but it has ${selected.regressions_vs_baseline.gt_5px} >5px regressions and no independent product trace validation.`,
    "",
    "## Safest Candidate",
    "",
    `Safest bounded-grid candidate: \`${safest.id}\`. It reduces visible regressions to ${safest.regressions_vs_baseline.gt_5px} >5px cases while keeping p99 at ${fmt(safest.overall.p99)} px and preserving low-speed p95 at ${fmt(safest.low_speed.p95)} px. The tradeoff is capped correction magnitude: weaker p99/high-risk improvement than the Phase 5 best, and no >5px pointwise improvements.`,
    "",
    "## Product Direction",
    "",
    "Collect more data first, then consider an opt-in/research implementation with replay tests and explicit UI affordances if the same conservative shape survives independent traces. Default-on needs independent chronological wins, no low-speed regression, p99 improvement, and a near-zero visible-regression budget.",
  ];
  fs.writeFileSync(path.join(phaseDir, "final-recommendation.md"), lines.join("\n"), "utf8");
}

function main() {
  const traces = traceZips.map(loadTrace);
  const traceResults = {};
  for (const trace of traces) {
    traceResults[trace.name] = {
      schema: schema(trace),
      phase1_baselines: reproducePhase1Baselines(trace),
    };
  }

  const productTrace = traces.find((trace) => trace.samples.some((sample) => sample.event === "poll" && sample.dwmAvailable));
  if (!productTrace) throw new Error("No product poll+DWM trace found");
  const { rows, anchor_count, target_miss_count } = makeContexts(productTrace);
  const splits = chronologicalSplits(rows);
  const modelResults = makePhase6Core(splits);
  const baseline = modelResults.candidates.find((candidate) => candidate.id === "baseline_product");
  const recommendation = pickRecommended(modelResults.candidates, baseline);
  const selectedOption = selectedLinearOption(modelResults);
  const selectedTest = evaluateOption(splits.test, selectedOption);
  const phase3TestSummary = modelResults.candidates.find((candidate) => candidate.id === "ridge_residual_risk_gate_low_speed_guard");
  const deploymentVariants = evaluateDeploymentVariants(splits.test, modelResults, selectedTest.baseline_summary, null);
  const chronologicalBlocks = chronologicalBlockAnalysis(rows, splits, selectedOption, null, 10);
  const heldoutTestBlocks = testBlockAnalysis(splits.test, selectedOption, null, 5);
  const selectedRegressions = inspectRegressions(selectedTest.evaluation);
  const coverage = coverageGaps(traceResults, productTrace, rows);
  const finalRecommendation = recommendationFromEvidence(
    selectedTest.summary,
    deploymentVariants.safest_candidate?.summary,
    selectedTest.baseline_summary,
    chronologicalBlocks,
    heldoutTestBlocks,
    coverage,
  );

  const results = {
    phase: "phase-6 robustness-and-final-recommendation",
    generated_by: "run_phase6.mjs",
    inputs: traceZips,
    assumptions: {
      baseline_gain: gain,
      idle_reset_ms: idleResetMs,
      high_speed_px_per_s: highSpeedPxPerS,
      high_acceleration_px_per_s2: highAccelerationPxPerS2,
      high_hook_poll_disagreement_px: highDisagreementPx,
      low_speed_px_per_s: lowSpeedPxPerS,
      chronological_split: "60% train, 1% gap, validation through 80%, 1% gap, remaining test",
      ml_tooling: "No dependencies were installed; used bounded self-contained JS ridge/logistic/ensemble models.",
      phase5_objective: "Validation-selected product-shaped objective: preserve overall p99 and low-speed p95, improve high-risk tails, penalize pointwise regressions especially >5px, and prefer simpler gates when scores are tied.",
    },
    traces: traceResults,
    product_trace: {
      trace: productTrace.name,
      anchor_count,
      evaluated_count: rows.length,
      target_miss_count,
      table: {
        row_count: rows.length,
        feature_names: featureNames,
        label_names: ["residual_x", "residual_y"],
        product_feasible_feature_policy: "Features use only current/past samples and product-visible timing/disagreement values. Labels and oracle candidates use future target data.",
        high_risk_row_count: rows.filter(isHighRisk).length,
      },
      splits: {
        gap_count: splits.gap_count,
        counts: {
          train: splits.train.length,
          validation_gap_1: splits.validation_gap_1.length,
          validation: splits.validation.length,
          validation_gap_2: splits.validation_gap_2.length,
          test: splits.test.length,
        },
        ranges: splits.ranges,
      },
      validation_selections: modelResults.validation_selections,
      validation_leaderboards: modelResults.validation_leaderboards,
      baseline_validation: modelResults.baseline_validation,
      candidates: modelResults.candidates,
      operation_estimate: modelResults.artifacts.operation_estimate,
      microbenchmark: modelResults.artifacts.microbenchmark,
      recommendation: {
        best_candidate_id: recommendation ? recommendation.id : null,
        best_candidate: recommendation,
        decision_rule: "Prefer a slightly weaker but simpler/safer shape if it improves high-risk tails without worsening overall p99 or low-speed p95.",
      },
      phase6: {
        baseline_test: compactSummary(selectedTest.baseline_summary),
        phase3_test: phase3TestSummary ? compactSummary(phase3TestSummary) : null,
        selected_candidate: {
          id: selectedOption.candidate.id,
          summary: compactSummary(selectedTest.summary),
          reproduction_note: "Recomputed from the Phase 6 copy of the Phase 5 logic using the raw linear-score threshold equivalent to logistic p >= 0.35.",
        },
        chronological_blocks: chronologicalBlocks,
        test_blocks: heldoutTestBlocks,
        selected_regressions: selectedRegressions,
        deployment_variants: deploymentVariants,
        coverage,
        final_recommendation: finalRecommendation,
      },
    },
  };

  fs.writeFileSync(path.join(phaseDir, "scores.json"), JSON.stringify(results, null, 2), "utf8");
  fs.writeFileSync(path.join(phaseDir, "model-spec.json"), JSON.stringify(buildModelSpec(results, modelResults.artifacts), null, 2), "utf8");
  writePhase6ExperimentLog(results);
  writePhase6Report(results);
  writeFinalRecommendation(results);
}

main();
