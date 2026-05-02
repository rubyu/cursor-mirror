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

function standardizer(rows) {
  const n = featureNames.length;
  const mean = Array(n).fill(0);
  const variance = Array(n).fill(0);
  for (const row of rows) {
    for (let i = 0; i < n; i++) mean[i] += row.features[i];
  }
  for (let i = 0; i < n; i++) mean[i] /= Math.max(1, rows.length);
  for (const row of rows) {
    for (let i = 0; i < n; i++) {
      const d = row.features[i] - mean[i];
      variance[i] += d * d;
    }
  }
  const scale = variance.map((value) => {
    const s = Math.sqrt(value / Math.max(1, rows.length));
    return s > 1e-9 ? s : 1;
  });
  return { mean, scale };
}

function transformFeatures(row, scaler) {
  const x = [1];
  for (let i = 0; i < featureNames.length; i++) x.push((row.features[i] - scaler.mean[i]) / scaler.scale[i]);
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

function fitRidge(rows, lambda) {
  const scaler = standardizer(rows);
  const p = featureNames.length + 1;
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

function evaluateRows(rows, candidate, predictor) {
  const records = [];
  for (const row of rows) {
    const prediction = predictor(row);
    const error = distance(prediction, [row.target_x, row.target_y]);
    records.push({
      ordinal: row.ordinal,
      error_px: error,
      baseline_error_px: row.baseline_error_px,
      regression_px: error - row.baseline_error_px,
      speed_px_s: row.speed_px_s,
      accel_px_s2: row.accel_px_s2,
      hook_disagreement_px: row.hook_disagreement_px,
      stop_settle_elapsed_ms: row.stop_settle_elapsed_ms,
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

function regressionCounts(records, predicate = () => true) {
  const selected = records.filter(predicate);
  return {
    count: selected.length,
    gt_1px: selected.filter((record) => record.regression_px > 1).length,
    gt_3px: selected.filter((record) => record.regression_px > 3).length,
    gt_5px: selected.filter((record) => record.regression_px > 5).length,
    improvement_gt_1px: selected.filter((record) => record.regression_px < -1).length,
    improvement_gt_3px: selected.filter((record) => record.regression_px < -3).length,
    improvement_gt_5px: selected.filter((record) => record.regression_px < -5).length,
  };
}

function summarizeEvaluation(evaluation, baselineOverall) {
  const { candidate, records } = evaluation;
  const overall = stats(records.map((record) => record.error_px));
  const lowSpeedPredicate = (record) => Number.isFinite(record.speed_px_s) && record.speed_px_s < lowSpeedPxPerS;
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
    high_speed: thresholdStats(records, (record) => record.speed_px_s >= highSpeedPxPerS),
    high_acceleration: thresholdStats(records, (record) => record.accel_px_s2 >= highAccelerationPxPerS2),
    hook_poll_disagreement_5px: thresholdStats(records, (record) => record.hook_disagreement_px >= highDisagreementPx),
    stop_settle: thresholdStats(records, (record) => record.stop_settle_window !== "not_in_stop_settle"),
    low_speed: thresholdStats(records, lowSpeedPredicate),
    regressions_vs_baseline: regressionCounts(records),
    low_speed_regressions_vs_baseline: regressionCounts(records, lowSpeedPredicate),
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

function chooseRidge(rowsTrain, rowsValidation, candidateId, trainFilter = () => true, gate = () => true) {
  const trainRows = rowsTrain.filter(trainFilter);
  if (trainRows.length < featureNames.length * 4) throw new Error(`Too few train rows for ${candidateId}`);
  const lambdas = [0.1, 1, 10, 100, 1000];
  const caps = [5, 15, 30, Infinity];
  const baselineValidation = summarizeEvaluation(baselineEvaluation(rowsValidation), stats(rowsValidation.map((row) => row.baseline_error_px)));
  let best = null;
  for (const lambda of lambdas) {
    const model = fitRidge(trainRows, lambda);
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

function fitLogisticGate(rows, residualModel, capPx) {
  const scaler = standardizer(rows);
  const p = featureNames.length + 3;
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
    residualModel,
    capPx,
  };
}

function logisticProbability(model, row) {
  const residual = capResidual(ridgeResidual(model.residualModel, row), model.capPx);
  const mag = Math.hypot(residual[0], residual[1]);
  const x = [...transformFeatures(row, model.scaler), clamp(mag / 20, 0, 5), clamp(row.risk_score, 0, 5)];
  let z = 0;
  for (let i = 0; i < x.length; i++) z += model.weights[i] * x[i];
  return sigmoid(z);
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

function makeCandidateSummaries(splits) {
  const baselineValidationSummary = summarizeEvaluation(baselineEvaluation(splits.validation), stats(splits.validation.map((row) => row.baseline_error_px)));
  const baselineTestEval = baselineEvaluation(splits.test);
  const baselineTestSummary = summarizeEvaluation(baselineTestEval, stats(splits.test.map((row) => row.baseline_error_px)));
  const summaries = [baselineTestSummary];
  const validationSelections = {};

  const ridgeAllChoice = chooseRidge(splits.train, splits.validation, "ridge_residual_all");
  validationSelections.ridge_residual_all = {
    lambda: ridgeAllChoice.lambda,
    cap_px: ridgeAllChoice.capPx,
    validation_summary: ridgeAllChoice.summary,
  };
  summaries.push(
    summarizeEvaluation(
      evaluateRows(
        splits.test,
        {
          id: "ridge_residual_all",
          family: "ridge_residual",
          product_feasible: true,
          description: "Ridge residual correction over the baseline using product-feasible current/past features.",
          parameters: { lambda: ridgeAllChoice.lambda, cap_px: ridgeAllChoice.capPx },
        },
        (row) => correctedPrediction(row, ridgeAllChoice.model, ridgeAllChoice.capPx),
      ),
      baselineTestSummary.overall,
    ),
  );

  const highRiskChoice = chooseRidge(splits.train, splits.validation, "ridge_residual_high_risk_only", isHighRisk, isHighRisk);
  validationSelections.ridge_residual_high_risk_only = {
    lambda: highRiskChoice.lambda,
    cap_px: highRiskChoice.capPx,
    validation_summary: highRiskChoice.summary,
  };
  summaries.push(
    summarizeEvaluation(
      evaluateRows(
        splits.test,
        {
          id: "ridge_residual_high_risk_only",
          family: "ridge_residual",
          product_feasible: true,
          description: "Ridge residual trained only on high-risk rows and applied only to product-feasible high-risk rows.",
          parameters: { lambda: highRiskChoice.lambda, cap_px: highRiskChoice.capPx, high_risk_rule: "speed>=1200 || accel>=60000 || disagreement>=5 || stop_settle" },
        },
        (row) => (isHighRisk(row) ? correctedPrediction(row, highRiskChoice.model, highRiskChoice.capPx) : row.baseline_prediction),
      ),
      baselineTestSummary.overall,
    ),
  );

  const riskGate = chooseRiskThreshold(splits.validation, ridgeAllChoice.model, ridgeAllChoice.capPx, baselineValidationSummary, "ridge_residual_risk_threshold_gate");
  validationSelections.ridge_residual_risk_threshold_gate = {
    threshold: riskGate.threshold,
    validation_summary: riskGate.summary,
  };
  summaries.push(
    summarizeEvaluation(
      evaluateRows(
        splits.test,
        {
          id: "ridge_residual_risk_threshold_gate",
          family: "threshold_gate",
          product_feasible: true,
          description: "Thresholded product-feasible risk score gate choosing baseline or ridge-corrected prediction.",
          parameters: { threshold: riskGate.threshold, residual_lambda: ridgeAllChoice.lambda, cap_px: ridgeAllChoice.capPx },
        },
        (row) => (row.risk_score >= riskGate.threshold ? correctedPrediction(row, ridgeAllChoice.model, ridgeAllChoice.capPx) : row.baseline_prediction),
      ),
      baselineTestSummary.overall,
    ),
  );

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
  summaries.push(
    summarizeEvaluation(
      evaluateRows(
        splits.test,
        {
          id: "ridge_residual_risk_gate_low_speed_guard",
          family: "threshold_gate",
          product_feasible: true,
          description: "Thresholded risk gate that never applies residual correction to low-speed rows.",
          parameters: { threshold: lowSpeedGuardGate.threshold, residual_lambda: ridgeAllChoice.lambda, cap_px: ridgeAllChoice.capPx, low_speed_guard_px_s: lowSpeedPxPerS },
        },
        (row) => (finite(row.speed_px_s) >= lowSpeedPxPerS && row.risk_score >= lowSpeedGuardGate.threshold ? correctedPrediction(row, ridgeAllChoice.model, ridgeAllChoice.capPx) : row.baseline_prediction),
      ),
      baselineTestSummary.overall,
    ),
  );

  const logisticModel = fitLogisticGate(splits.train, ridgeAllChoice.model, ridgeAllChoice.capPx);
  const logisticChoice = chooseLogisticThreshold(splits.validation, logisticModel, baselineValidationSummary);
  validationSelections.ridge_residual_logistic_gate = {
    probability_threshold: logisticChoice.threshold,
    validation_summary: logisticChoice.summary,
  };
  summaries.push(
    summarizeEvaluation(
      evaluateRows(
        splits.test,
        {
          id: "ridge_residual_logistic_gate",
          family: "learned_gate",
          product_feasible: true,
          description: "Small bounded logistic gate trained to choose whether the ridge residual should replace baseline.",
          parameters: {
            residual_lambda: ridgeAllChoice.lambda,
            cap_px: ridgeAllChoice.capPx,
            probability_threshold: logisticChoice.threshold,
            epochs: 4,
          },
        },
        (row) => (logisticProbability(logisticModel, row) >= logisticChoice.threshold ? correctedPrediction(row, ridgeAllChoice.model, ridgeAllChoice.capPx) : row.baseline_prediction),
      ),
      baselineTestSummary.overall,
    ),
  );

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
  summaries.push(summarizeEvaluation(oracleBestRidge, baselineTestSummary.overall));

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
  summaries.push(summarizeEvaluation(oraclePerfect, baselineTestSummary.overall));

  return {
    baseline_validation: baselineValidationSummary,
    candidates: summaries,
    validation_selections: validationSelections,
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
  return `- ${summary.oracle_only ? "[oracle] " : ""}\`${summary.id}\`: mean ${fmt(summary.overall.mean)}, p95 ${fmt(summary.overall.p95)}, p99 ${fmt(summary.overall.p99)}, high-speed p95/p99 ${fmt(summary.high_speed.p95)}/${fmt(summary.high_speed.p99)}, high-accel p95/p99 ${fmt(summary.high_acceleration.p95)}/${fmt(summary.high_acceleration.p99)}, disagreement p95/p99 ${fmt(summary.hook_poll_disagreement_5px.p95)}/${fmt(summary.hook_poll_disagreement_5px.p99)}, stop p95/p99 ${fmt(summary.stop_settle.p95)}/${fmt(summary.stop_settle.p99)}, low-speed p95 ${fmt(summary.low_speed.p95)}, regressions >1/>3/>5 ${summary.regressions_vs_baseline.gt_1px}/${summary.regressions_vs_baseline.gt_3px}/${summary.regressions_vs_baseline.gt_5px}`;
}

function pickRecommended(candidates, baseline) {
  const viable = candidates.filter((candidate) =>
    candidate.product_feasible &&
    candidate.id !== "baseline_product" &&
    candidate.overall.p99 <= baseline.overall.p99 &&
    candidate.low_speed.p95 <= baseline.low_speed.p95 &&
    (
      candidate.high_speed.p95 < baseline.high_speed.p95 ||
      candidate.high_acceleration.p95 < baseline.high_acceleration.p95 ||
      candidate.hook_poll_disagreement_5px.p95 < baseline.hook_poll_disagreement_5px.p95 ||
      candidate.stop_settle.p95 < baseline.stop_settle.p95
    )
  );
  viable.sort((a, b) => selectionScore(a, baseline) - selectionScore(b, baseline));
  return viable[0] || null;
}

function writeExperimentLog(results) {
  const baseline = results.product_trace.candidates.find((candidate) => candidate.id === "baseline_product");
  const best = results.product_trace.recommendation.best_candidate;
  const lines = [
    "# Phase 3 Experiment Log",
    "",
    "## Scope",
    "",
    "All generated files are contained in the Phase 3 directory. Phase 1/2 artifacts and the root trace ZIPs were read only.",
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
    "- `ridge_residual_all`: ridge regression over baseline residual x/y.",
    "- `ridge_residual_high_risk_only`: ridge regression trained and applied only in speed/acceleration/disagreement/stop high-risk regions.",
    "- `ridge_residual_risk_threshold_gate`: thresholded product-feasible risk score chooses baseline vs corrected prediction.",
    "- `ridge_residual_logistic_gate`: bounded logistic gate chooses baseline vs corrected prediction.",
    "- `oracle_*`: non-product upper bounds that inspect future labels/targets.",
    "- Small MLP residual: skipped because no Python/NumPy or local ML library was available, and dependencies were not installed.",
    "",
    "## Validation Selection",
    "",
    `\`\`\`json\n${JSON.stringify(results.product_trace.validation_selections, null, 2)}\n\`\`\``,
    "",
    "## Test Results",
    "",
    `Baseline test slice: ${compactStats(baseline.overall)} px`,
    "",
  );

  for (const summary of results.product_trace.candidates) {
    lines.push(`### \`${summary.id}\``, "", summary.description, "", `Product-feasible: \`${summary.product_feasible}\`; oracle-only: \`${summary.oracle_only}\``);
    lines.push(`Parameters: \`${JSON.stringify(summary.parameters)}\``);
    lines.push(candidateLine(summary), "");
    lines.push(`Stop-settle: ${compactStats(summary.stop_settle)} px`);
    lines.push(`Low-speed regressions >1/>3/>5: ${summary.low_speed_regressions_vs_baseline.gt_1px}/${summary.low_speed_regressions_vs_baseline.gt_3px}/${summary.low_speed_regressions_vs_baseline.gt_5px}`);
    lines.push("");
  }

  lines.push("## Interpretation", "");
  if (best) {
    lines.push(
      `The strongest product-feasible result is \`${best.id}\`: it improves high-risk tails while keeping overall p99 and low-speed p95 no worse than baseline on the held-out chronological test slice. It is still not product-ready because pointwise regressions remain material, so it should be treated as an interesting Phase 4 candidate rather than a ship recommendation.`,
    );
  } else {
    lines.push(
      "No learned product-feasible residual cleared the decision rule on the held-out chronological test slice. The residual is learnable in an oracle sense, but the learned gates do not reliably know when to apply correction without creating low-risk or tail regressions.",
    );
  }
  fs.writeFileSync(path.join(phaseDir, "experiment-log.md"), lines.join("\n"), "utf8");
}

function writeReport(results) {
  const baseline = results.product_trace.candidates.find((candidate) => candidate.id === "baseline_product");
  const best = results.product_trace.recommendation.best_candidate;
  const oracle = results.product_trace.candidates.find((candidate) => candidate.id === "oracle_choose_baseline_or_ridge");
  const lines = ["# Phase 3 Report", "", "## Recommendation", ""];
  if (best) {
    lines.push(
      `Best product-feasible candidate: \`${best.id}\`. It clears the Phase 3 decision rule on the chronological test slice.`,
      "",
      `Baseline: overall mean ${fmt(baseline.overall.mean)}, p95 ${fmt(baseline.overall.p95)}, p99 ${fmt(baseline.overall.p99)}, high-speed p95/p99 ${fmt(baseline.high_speed.p95)}/${fmt(baseline.high_speed.p99)}, high-accel p95/p99 ${fmt(baseline.high_acceleration.p95)}/${fmt(baseline.high_acceleration.p99)}, low-speed p95 ${fmt(baseline.low_speed.p95)}.`,
      `Best: overall mean ${fmt(best.overall.mean)}, p95 ${fmt(best.overall.p95)}, p99 ${fmt(best.overall.p99)}, high-speed p95/p99 ${fmt(best.high_speed.p95)}/${fmt(best.high_speed.p99)}, high-accel p95/p99 ${fmt(best.high_acceleration.p95)}/${fmt(best.high_acceleration.p99)}, low-speed p95 ${fmt(best.low_speed.p95)}.`,
    );
  } else {
    lines.push(
      "No product-feasible learned residual or learned gate cleared the decision rule. The tested models can reduce some labeled errors, but they either fail to improve high-risk tails on the held-out chronological test slice or worsen overall p99 / low-speed p95.",
      "",
      `Baseline test: overall mean ${fmt(baseline.overall.mean)}, p95 ${fmt(baseline.overall.p95)}, p99 ${fmt(baseline.overall.p99)}, high-speed p95/p99 ${fmt(baseline.high_speed.p95)}/${fmt(baseline.high_speed.p99)}, high-accel p95/p99 ${fmt(baseline.high_acceleration.p95)}/${fmt(baseline.high_acceleration.p99)}, disagreement p95/p99 ${fmt(baseline.hook_poll_disagreement_5px.p95)}/${fmt(baseline.hook_poll_disagreement_5px.p99)}, low-speed p95 ${fmt(baseline.low_speed.p95)}.`,
    );
  }
  lines.push(
    "",
    "## Strongest Finding",
    "",
    best
      ? `A low-speed guard is the difference between a useful residual and an unsafe one: \`${best.id}\` keeps low-speed p95 at ${fmt(best.low_speed.p95)} px while cutting high-speed p95 from ${fmt(baseline.high_speed.p95)} px to ${fmt(best.high_speed.p95)} px and overall p99 from ${fmt(baseline.overall.p99)} px to ${fmt(best.overall.p99)} px.`
      : `The oracle chooser is much better than baseline on test p99 (${fmt(oracle.overall.p99)} px vs ${fmt(baseline.overall.p99)} px), which proves useful corrective alternatives exist, but the product-feasible gates tested here do not identify them reliably enough.`,
    `The non-product oracle chooser still shows additional headroom: test p99 ${fmt(oracle.overall.p99)} px versus baseline ${fmt(baseline.overall.p99)} px.`,
    "",
    "## Candidate Summary",
    "",
    ...results.product_trace.candidates.map(candidateLine),
    "",
    "## Phase 4 Direction",
    "",
    "Take the low-speed-guarded residual into Phase 4 as an offline candidate, but do not ship it from this single trace. Phase 4 should validate it on more traces, reduce pointwise regression counts, calibrate the gate as an uncertainty estimator, and collect targeted high-speed, stop-settle, and hook/poll disagreement coverage.",
    "",
    "## Artifacts",
    "",
    "- `run_phase3.mjs`: reproducible Phase 3 runner.",
    "- `scores.json`: machine-readable split, baseline, model, and oracle results.",
    "- `experiment-log.md`: detailed setup, selections, and metric tables.",
  );
  fs.writeFileSync(path.join(phaseDir, "report.md"), lines.join("\n"), "utf8");
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
  const modelResults = makeCandidateSummaries(splits);
  const baseline = modelResults.candidates.find((candidate) => candidate.id === "baseline_product");
  const recommendation = pickRecommended(modelResults.candidates, baseline);

  const results = {
    phase: "phase-3 learned-oracle-residual",
    generated_by: "run_phase3.mjs",
    inputs: traceZips,
    assumptions: {
      baseline_gain: gain,
      idle_reset_ms: idleResetMs,
      high_speed_px_per_s: highSpeedPxPerS,
      high_acceleration_px_per_s2: highAccelerationPxPerS2,
      high_hook_poll_disagreement_px: highDisagreementPx,
      low_speed_px_per_s: lowSpeedPxPerS,
      chronological_split: "60% train, 1% gap, validation through 80%, 1% gap, remaining test",
      ml_tooling: "No Python/NumPy or local ML library detected; used bounded self-contained JS ridge/logistic models and skipped MLP.",
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
      baseline_validation: modelResults.baseline_validation,
      candidates: modelResults.candidates,
      recommendation: {
        best_candidate_id: recommendation ? recommendation.id : null,
        best_candidate: recommendation,
        decision_rule: "Interesting only if high-risk tails improve without worsening overall p99 or low-speed p95.",
      },
    },
  };

  fs.writeFileSync(path.join(phaseDir, "scores.json"), JSON.stringify(results, null, 2), "utf8");
  writeExperimentLog(results);
  writeReport(results);
}

main();
