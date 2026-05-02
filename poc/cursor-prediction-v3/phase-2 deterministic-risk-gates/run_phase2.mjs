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
const filterVelocityClampPxPerS = 5000;
const filterAccelerationClampPxPerS2 = 250000;

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
    const a = (targetTicks - t0) / (t1 - t0);
    return [x0 + (x1 - x0) * a, y0 + (y1 - y0) * a];
  }
}

function roundHalfAwayFromZero(value) {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function clamp(value, limit) {
  return Math.max(-limit, Math.min(limit, value));
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

function makeFeatures(samples, frequency) {
  const features = new Map();
  const stopEntries = [];
  let previous = null;
  let previousSpeed = null;
  for (const sample of samples) {
    let dtMs = null;
    let speed = null;
    let accel = null;
    if (previous) {
      const dtTicks = sample.ticks - previous.ticks;
      if (dtTicks > 0) {
        dtMs = (dtTicks * 1000) / frequency;
        speed = (Math.hypot(sample.x - previous.x, sample.y - previous.y) * frequency) / dtTicks;
        if (previousSpeed !== null) accel = Math.abs(speed - previousSpeed) / (dtMs / 1000);
        if (previousSpeed !== null && previousSpeed >= moveSpeedPxPerS && speed < stopSpeedPxPerS) stopEntries.push(sample.ticks);
      }
    }
    features.set(sample.sequence, {
      dt_ms: dtMs,
      speed_px_s: speed,
      previous_speed_px_s: previousSpeed,
      accel_px_s2: accel,
      speed_bin: numericBin(speed, speedBins),
      accel_bin: numericBin(accel, accelBins),
    });
    if (speed !== null) previousSpeed = speed;
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

function pollJitterBin(sample, previousPoll, frequency, nominalMs) {
  if (!previousPoll || !Number.isFinite(nominalMs)) return "unknown";
  const intervalMs = ((sample.ticks - previousPoll.ticks) * 1000) / frequency;
  return numericBin(Math.abs(intervalMs - nominalMs), [
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

function last2Prediction(ctx, gainValue = gain, horizonScale = 1, horizonCapMs = Infinity) {
  if (!ctx.previous || ctx.deltaTicks <= 0 || ctx.deltaMs > idleResetMs || ctx.invalidDwm) return [ctx.sample.x, ctx.sample.y];
  const cappedHorizonTicks = Math.min(ctx.horizonTicks * horizonScale, (horizonCapMs * ctx.trace.frequency) / 1000);
  if (!(cappedHorizonTicks > 0) || !(gainValue > 0)) return [ctx.sample.x, ctx.sample.y];
  const scale = (gainValue * cappedHorizonTicks) / ctx.deltaTicks;
  return [
    roundHalfAwayFromZero(ctx.sample.x + (ctx.sample.x - ctx.previous.x) * scale),
    roundHalfAwayFromZero(ctx.sample.y + (ctx.sample.y - ctx.previous.y) * scale),
  ];
}

function speedGain(speed, table) {
  if (!Number.isFinite(speed)) return gain;
  if (speed >= 1200) return table[1200] ?? gain;
  if (speed >= 700) return table[700] ?? gain;
  if (speed >= 300) return table[300] ?? gain;
  if (speed >= 100) return table[100] ?? gain;
  return gain;
}

function accelGain(accel, table) {
  if (!Number.isFinite(accel)) return gain;
  if (accel >= 60000) return table[60000] ?? gain;
  if (accel >= 20000) return table[20000] ?? gain;
  if (accel >= 5000) return table[5000] ?? gain;
  return gain;
}

function stopGain(elapsedMs, table) {
  if (elapsedMs === null) return gain;
  if (elapsedMs < 16) return table[16] ?? gain;
  if (elapsedMs < 33) return table[33] ?? gain;
  if (elapsedMs < 67) return table[67] ?? gain;
  if (elapsedMs < 133) return table[133] ?? gain;
  return table[250] ?? gain;
}

function makeLast2Candidate(id, family, description, parameters, modifier) {
  return {
    id,
    family,
    description,
    parameters,
    kind: "last2",
    predict(ctx) {
      const m = modifier(ctx);
      return last2Prediction(ctx, m.gain ?? gain, m.horizonScale ?? 1, m.horizonCapMs ?? Infinity);
    },
  };
}

const candidates = [
  makeLast2Candidate("baseline_product", "baseline", "Phase 1 product baseline: gain 0.75 and full DWM horizon.", { gain }, () => ({ gain })),
  makeLast2Candidate(
    "gain_speed_light",
    "gain_grid",
    "Speed-only gain grid with conservative damping above 700 px/s.",
    { gains: { "300+": 0.7, "700+": 0.6, "1200+": 0.45 } },
    (ctx) => ({ gain: speedGain(ctx.feature.speed_px_s, { 300: 0.7, 700: 0.6, 1200: 0.45 }) }),
  ),
  makeLast2Candidate(
    "gain_speed_strong",
    "gain_grid",
    "Speed-only gain grid with strong high-speed damping.",
    { gains: { "300+": 0.6, "700+": 0.45, "1200+": 0.3 } },
    (ctx) => ({ gain: speedGain(ctx.feature.speed_px_s, { 300: 0.6, 700: 0.45, 1200: 0.3 }) }),
  ),
  makeLast2Candidate(
    "gain_accel_light",
    "gain_grid",
    "Acceleration-only gain grid.",
    { gains: { "5k+": 0.65, "20k+": 0.5, "60k+": 0.35 } },
    (ctx) => ({ gain: accelGain(ctx.feature.accel_px_s2, { 5000: 0.65, 20000: 0.5, 60000: 0.35 }) }),
  ),
  makeLast2Candidate(
    "gain_speed_accel_min",
    "gain_grid",
    "Use the smaller of the speed and acceleration gain grids.",
    { speed_gains: { "300+": 0.65, "700+": 0.5, "1200+": 0.35 }, accel_gains: { "5k+": 0.65, "20k+": 0.5, "60k+": 0.35 } },
    (ctx) => ({
      gain: Math.min(
        speedGain(ctx.feature.speed_px_s, { 300: 0.65, 700: 0.5, 1200: 0.35 }),
        accelGain(ctx.feature.accel_px_s2, { 5000: 0.65, 20000: 0.5, 60000: 0.35 }),
      ),
    }),
  ),
  makeLast2Candidate(
    "horizon_speed_cap",
    "horizon_clamp",
    "Cap DWM horizon under high speed.",
    { caps_ms: { "700+": 8, "1200+": 4 } },
    (ctx) => ({ horizonCapMs: ctx.feature.speed_px_s >= 1200 ? 4 : ctx.feature.speed_px_s >= 700 ? 8 : Infinity }),
  ),
  makeLast2Candidate(
    "horizon_accel_cap",
    "horizon_clamp",
    "Cap DWM horizon under high acceleration.",
    { caps_ms: { "20k+": 8, "60k+": 4 } },
    (ctx) => ({ horizonCapMs: ctx.feature.accel_px_s2 >= 60000 ? 4 : ctx.feature.accel_px_s2 >= 20000 ? 8 : Infinity }),
  ),
  makeLast2Candidate(
    "horizon_speed_scale",
    "horizon_clamp",
    "Scale the effective horizon down as speed rises.",
    { scales: { "300+": 0.8, "700+": 0.6, "1200+": 0.35 } },
    (ctx) => ({
      horizonScale: ctx.feature.speed_px_s >= 1200 ? 0.35 : ctx.feature.speed_px_s >= 700 ? 0.6 : ctx.feature.speed_px_s >= 300 ? 0.8 : 1,
    }),
  ),
  makeLast2Candidate(
    "disagreement_hold_5px",
    "hook_poll_gate",
    "Hold/current when hook/poll disagreement is at least 5 px.",
    { hold_threshold_px: 5 },
    (ctx) => ({ gain: ctx.hookDisagreement >= 5 ? 0 : gain }),
  ),
  makeLast2Candidate(
    "disagreement_gain_grid",
    "hook_poll_gate",
    "Reduce gain when hook/poll disagreement indicates stale or split streams.",
    { gains: { "2px+": 0.45, "5px+": 0.15 } },
    (ctx) => ({ gain: ctx.hookDisagreement >= 5 ? 0.15 : ctx.hookDisagreement >= 2 ? 0.45 : gain }),
  ),
  makeLast2Candidate(
    "disagreement_horizon_cap",
    "hook_poll_gate",
    "Cap horizon when hook/poll disagreement exceeds 5 px.",
    { caps_ms: { "5px+": 4 } },
    (ctx) => ({ horizonCapMs: ctx.hookDisagreement >= 5 ? 4 : Infinity }),
  ),
  makeLast2Candidate(
    "poll_interval_cap",
    "poll_gate",
    "Cap horizon when observed poll cadence slips.",
    { caps_ms: { "18ms+": 8, "24ms+": 4 } },
    (ctx) => ({ horizonCapMs: ctx.pollIntervalMs >= 24 ? 4 : ctx.pollIntervalMs >= 18 ? 8 : Infinity }),
  ),
  makeLast2Candidate(
    "poll_jitter_gain",
    "poll_gate",
    "Reduce gain when observed cadence diverges from the configured 8 ms interval.",
    { gains: { "8ms_jitter+": 0.6, "16ms_jitter+": 0.45 } },
    (ctx) => ({ gain: ctx.pollJitterMs >= 16 ? 0.45 : ctx.pollJitterMs >= 8 ? 0.6 : gain }),
  ),
  makeLast2Candidate(
    "stop_entry_hold_33ms",
    "stop_decay",
    "Hold/current for the first 33 ms after stop entry.",
    { hold_stop_settle_ms: 33 },
    (ctx) => ({ gain: ctx.stopSettleElapsedMs !== null && ctx.stopSettleElapsedMs < 33 ? 0 : gain }),
  ),
  makeLast2Candidate(
    "stop_settle_decay",
    "stop_decay",
    "Gradually restore gain during the first 250 ms after stop entry.",
    { gains: { "0-16": 0, "16-33": 0.15, "33-67": 0.35, "67-133": 0.55, "133-250": 0.65 } },
    (ctx) => ({ gain: stopGain(ctx.stopSettleElapsedMs, { 16: 0, 33: 0.15, 67: 0.35, 133: 0.55, 250: 0.65 }) }),
  ),
  makeLast2Candidate(
    "combo_speed_accel_disagreement",
    "combination",
    "Combine strongest single-factor tail gates: motion gain grid plus hook/poll disagreement gain.",
    {
      speed_gains: { "300+": 0.65, "700+": 0.5, "1200+": 0.35 },
      accel_gains: { "5k+": 0.65, "20k+": 0.5, "60k+": 0.35 },
      disagreement_gains: { "2px+": 0.45, "5px+": 0.15 },
    },
    (ctx) => ({
      gain: Math.min(
        speedGain(ctx.feature.speed_px_s, { 300: 0.65, 700: 0.5, 1200: 0.35 }),
        accelGain(ctx.feature.accel_px_s2, { 5000: 0.65, 20000: 0.5, 60000: 0.35 }),
        ctx.hookDisagreement >= 5 ? 0.15 : ctx.hookDisagreement >= 2 ? 0.45 : gain,
      ),
    }),
  ),
  makeLast2Candidate(
    "combo_motion_horizon_disagreement",
    "combination",
    "Combine motion gain grid, high-risk horizon caps, and hook/poll disagreement gain.",
    {
      speed_gains: { "300+": 0.65, "700+": 0.5, "1200+": 0.35 },
      accel_gains: { "5k+": 0.65, "20k+": 0.5, "60k+": 0.35 },
      caps_ms: { "speed1200+": 4, "accel60k+": 4, "disagreement5px+": 4 },
      disagreement_gains: { "2px+": 0.45, "5px+": 0.15 },
    },
    (ctx) => ({
      gain: Math.min(
        speedGain(ctx.feature.speed_px_s, { 300: 0.65, 700: 0.5, 1200: 0.35 }),
        accelGain(ctx.feature.accel_px_s2, { 5000: 0.65, 20000: 0.5, 60000: 0.35 }),
        ctx.hookDisagreement >= 5 ? 0.15 : ctx.hookDisagreement >= 2 ? 0.45 : gain,
      ),
      horizonCapMs:
        ctx.feature.speed_px_s >= 1200 || ctx.feature.accel_px_s2 >= 60000 || ctx.hookDisagreement >= 5 ? 4 : Infinity,
    }),
  ),
];

function makeAlphaBetaCandidate(id, alpha, beta) {
  return {
    id,
    family: "alpha_beta",
    description: `Alpha-beta filter with alpha ${alpha} and beta ${beta}.`,
    parameters: { alpha, beta },
    kind: "ab",
    alpha,
    beta,
  };
}

function makeAlphaBetaGammaCandidate(id, alpha, beta, gammaValue) {
  return {
    id,
    family: "alpha_beta_gamma",
    description: `Alpha-beta-gamma filter with alpha ${alpha}, beta ${beta}, gamma ${gammaValue}.`,
    parameters: { alpha, beta, gamma: gammaValue },
    kind: "abg",
    alpha,
    beta,
    gamma: gammaValue,
  };
}

candidates.push(
  makeAlphaBetaCandidate("alpha_beta_085_020", 0.85, 0.2),
  makeAlphaBetaCandidate("alpha_beta_070_120", 0.7, 0.12),
  makeAlphaBetaCandidate("alpha_beta_055_080", 0.55, 0.08),
  makeAlphaBetaGammaCandidate("alpha_beta_gamma_080_180_020", 0.8, 0.18, 0.02),
  makeAlphaBetaGammaCandidate("alpha_beta_gamma_065_120_010", 0.65, 0.12, 0.01),
);

function filterPrediction(candidate, ctx, state) {
  const dtSec = ctx.deltaTicks > 0 ? ctx.deltaTicks / ctx.trace.frequency : null;
  if (!state.ready || dtSec === null || ctx.deltaMs > idleResetMs || ctx.invalidDwm) {
    state.ready = true;
    state.x = ctx.sample.x;
    state.y = ctx.sample.y;
    state.vx = 0;
    state.vy = 0;
    state.ax = 0;
    state.ay = 0;
    return [ctx.sample.x, ctx.sample.y];
  }

  const horizonSec = ctx.horizonTicks / ctx.trace.frequency;
  if (candidate.kind === "ab") {
    const xPred = state.x + state.vx * dtSec;
    const yPred = state.y + state.vy * dtSec;
    const rx = ctx.sample.x - xPred;
    const ry = ctx.sample.y - yPred;
    state.x = xPred + candidate.alpha * rx;
    state.y = yPred + candidate.alpha * ry;
    state.vx = clamp(state.vx + (candidate.beta * rx) / dtSec, filterVelocityClampPxPerS);
    state.vy = clamp(state.vy + (candidate.beta * ry) / dtSec, filterVelocityClampPxPerS);
    return [roundHalfAwayFromZero(state.x + state.vx * horizonSec), roundHalfAwayFromZero(state.y + state.vy * horizonSec)];
  }

  const xPred = state.x + state.vx * dtSec + 0.5 * state.ax * dtSec * dtSec;
  const yPred = state.y + state.vy * dtSec + 0.5 * state.ay * dtSec * dtSec;
  const vxPred = state.vx + state.ax * dtSec;
  const vyPred = state.vy + state.ay * dtSec;
  const rx = ctx.sample.x - xPred;
  const ry = ctx.sample.y - yPred;
  state.x = xPred + candidate.alpha * rx;
  state.y = yPred + candidate.alpha * ry;
  state.vx = clamp(vxPred + (candidate.beta * rx) / dtSec, filterVelocityClampPxPerS);
  state.vy = clamp(vyPred + (candidate.beta * ry) / dtSec, filterVelocityClampPxPerS);
  state.ax = clamp(state.ax + (2 * candidate.gamma * rx) / (dtSec * dtSec), filterAccelerationClampPxPerS2);
  state.ay = clamp(state.ay + (2 * candidate.gamma * ry) / (dtSec * dtSec), filterAccelerationClampPxPerS2);
  return [
    roundHalfAwayFromZero(state.x + state.vx * horizonSec + 0.5 * state.ax * horizonSec * horizonSec),
    roundHalfAwayFromZero(state.y + state.vy * horizonSec + 0.5 * state.ay * horizonSec * horizonSec),
  ];
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
    contexts.push({
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
      hook_poll_disagreement_bin: numericBin(hookDisagreement, disagreementBins),
      pollIntervalMs,
      pollJitterMs,
      poll_jitter_bin: pollJitterBin(sample, previousPoll, trace.frequency, nominalMs),
      stopSettleElapsedMs: stopElapsed,
      stop_settle_window: stopSettleWindow(stopElapsed),
      speed_bin: feature.speed_bin || "unknown",
      accel_bin: feature.accel_bin || "unknown",
    });
    previous = sample;
    previousPoll = sample;
  });
  return { contexts, anchor_count: polls.length, target_miss_count: polls.length - contexts.length };
}

function evaluateCandidate(candidate, contexts, baselineErrors = null) {
  const values = [];
  const records = [];
  const filterState = {};
  const statusCounts = {};
  for (const ctx of contexts) {
    let prediction;
    if (candidate.kind === "last2") prediction = candidate.predict(ctx);
    else prediction = filterPrediction(candidate, ctx, filterState);
    const error = distance(prediction, ctx.target);
    statusCounts[ctx.status] = (statusCounts[ctx.status] || 0) + 1;
    const baselineError = baselineErrors ? baselineErrors.get(ctx.ordinal) : error;
    const delta = error - baselineError;
    records.push({
      ordinal: ctx.ordinal,
      error_px: error,
      baseline_error_px: baselineError,
      regression_px: delta,
      speed_px_s: ctx.feature.speed_px_s,
      accel_px_s2: ctx.feature.accel_px_s2,
      hook_disagreement_px: ctx.hookDisagreement,
      stop_settle_window: ctx.stop_settle_window,
      speed_bin: ctx.speed_bin,
      accel_bin: ctx.accel_bin,
      hook_poll_disagreement_bin: ctx.hook_poll_disagreement_bin,
      poll_jitter_bin: ctx.poll_jitter_bin,
    });
    values.push(error);
  }
  return { candidate, records, status_counts: Object.fromEntries(Object.entries(statusCounts).sort()), overall: stats(values) };
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
  const { candidate, records, overall } = evaluation;
  const lowSpeedPredicate = (record) => Number.isFinite(record.speed_px_s) && record.speed_px_s < lowSpeedPxPerS;
  const summary = {
    id: candidate.id,
    family: candidate.family,
    kind: candidate.kind,
    description: candidate.description,
    parameters: candidate.parameters,
    status_counts: evaluation.status_counts,
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
    low_speed: thresholdStats(records, lowSpeedPredicate),
    stop_settle: thresholdStats(records, (record) => record.stop_settle_window !== "not_in_stop_settle"),
    regressions_vs_baseline: regressionCounts(records),
    low_speed_regressions_vs_baseline: regressionCounts(records, lowSpeedPredicate),
    speed_bins: bucketStats(records, "speed_bin"),
    acceleration_bins: bucketStats(records, "accel_bin"),
    hook_poll_disagreement_bins: bucketStats(records, "hook_poll_disagreement_bin"),
    poll_interval_jitter_bins: bucketStats(records, "poll_jitter_bin"),
    stop_settle_windows: bucketStats(records, "stop_settle_window"),
  };
  return summary;
}

function reproducePhase1Baselines(trace) {
  const traceSchema = schema(trace);
  if (traceSchema.poll_count > 0 && traceSchema.dwm_poll_count > 0) {
    const { contexts, anchor_count, target_miss_count } = makeContexts(trace);
    const baseline = evaluateCandidate(candidates[0], contexts);
    return [{
      scenario: "product_poll_dwm_next_vblank",
      mode: "dwm_next_vblank",
      anchor_count,
      evaluated_count: contexts.length,
      target_miss_count,
      status_counts: baseline.status_counts,
      overall: baseline.overall,
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
        feature: features.get(sample.sequence) || {},
      };
      const prediction = last2Prediction(ctx, gain);
      records.push({
        error_px: distance(prediction, target),
        speed_bin: ctx.feature.speed_bin || "unknown",
        accel_bin: ctx.feature.accel_bin || "unknown",
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
  return `- \`${summary.id}\`: mean ${fmt(summary.overall.mean)}, p95 ${fmt(summary.overall.p95)}, p99 ${fmt(summary.overall.p99)}, high-speed p95/p99 ${fmt(summary.high_speed.p95)}/${fmt(summary.high_speed.p99)}, high-accel p95/p99 ${fmt(summary.high_acceleration.p95)}/${fmt(summary.high_acceleration.p99)}, disagreement p95/p99 ${fmt(summary.hook_poll_disagreement_5px.p95)}/${fmt(summary.hook_poll_disagreement_5px.p99)}, low-speed p95 ${fmt(summary.low_speed.p95)}, regressions >1/>3/>5 ${summary.regressions_vs_baseline.gt_1px}/${summary.regressions_vs_baseline.gt_3px}/${summary.regressions_vs_baseline.gt_5px}`;
}

function writeExperimentLog(results) {
  const lines = [
    "# Phase 2 Experiment Log",
    "",
    "## Scope",
    "",
    "All work is contained in this phase directory. The root trace ZIPs and Phase 1 artifacts were read as inputs only.",
    "",
    "## Baseline Formula",
    "",
    "For each poll anchor with valid DWM timing, select the next DWM vblank, advancing stale vblank ticks by refresh periods. The product baseline predicts:",
    "",
    "`prediction = round_half_away_from_zero(current + (current - previous) * 0.75 * horizonTicks / deltaTicks)`",
    "",
    "Invalid timing, nonpositive deltas, and gaps over 100 ms fall back to hold/current. Ground truth is linear timestamp interpolation over the merged recorded position stream. Hook/poll disagreement is measured by interpolating hook move rows at the poll timestamp.",
    "",
    "## Reproduced Phase 1 Baselines",
    "",
  ];

  for (const [traceName, traceResult] of Object.entries(results.traces)) {
    lines.push(`### \`${traceName}\``, "", `- Schema: \`${JSON.stringify(traceResult.schema.event_counts)}\``);
    if (traceResult.schema.poll_interval_ms) lines.push(`- Poll interval: ${compactStats(traceResult.schema.poll_interval_ms)} ms`);
    if (traceResult.schema.move_interval_ms) lines.push(`- Move interval: ${compactStats(traceResult.schema.move_interval_ms)} ms`);
    for (const scenario of traceResult.phase1_baselines) {
      lines.push(`- \`${scenario.scenario}\`: ${compactStats(scenario.overall)} px`);
    }
    lines.push("");
  }

  lines.push(
    "## Candidate Formulas",
    "",
    "- Gain grids multiply the last2 velocity term by a lower gain in high-speed and/or high-acceleration regimes.",
    "- Horizon clamps keep the gain unchanged but reduce the effective lookahead used by the velocity term.",
    "- Hook/poll gates reduce gain or horizon when interpolated hook position and poll position disagree by 2 px or 5 px.",
    "- Poll gates use observed poll interval and configured-interval jitter. They are included because Phase 1 showed the configured 8 ms interval was effectively closer to 16 ms.",
    "- Stop candidates reduce gain during the first 250 ms after a speed collapse from at least 100 px/s to below 20 px/s.",
    `- Alpha-beta and alpha-beta-gamma filters keep O(1) state over the poll stream and predict from their filtered position/velocity/acceleration state to the DWM target. Velocity is clamped to ${filterVelocityClampPxPerS} px/s and acceleration to ${filterAccelerationClampPxPerS2} px/s^2.`,
    "- Combination candidates were restricted to the best-supported deterministic signals from Phase 1: motion regime plus hook/poll disagreement, with an optional horizon cap.",
    "",
    "## Candidate Results",
    "",
  );

  for (const summary of results.product_trace.candidates) {
    lines.push(`### \`${summary.id}\``, "", summary.description, "", `Parameters: \`${JSON.stringify(summary.parameters)}\``, "", candidateLine(summary), "");
    lines.push(`Stop-settle: ${compactStats(summary.stop_settle)} px`);
    lines.push(`Low-speed regressions >1/>3/>5: ${summary.low_speed_regressions_vs_baseline.gt_1px}/${summary.low_speed_regressions_vs_baseline.gt_3px}/${summary.low_speed_regressions_vs_baseline.gt_5px}`);
    lines.push("");
  }

  lines.push(
    "## Rejected Options",
    "",
    "- Alpha-beta and alpha-beta-gamma filters were rejected because smoothing introduced large low-speed and overall tail regressions on this trace.",
    "- Poll interval/jitter gates were rejected because the signal was too broad: the common effective cadence already differs from configured 8 ms, so cadence gating catches too much normal behavior or too little tail behavior depending on threshold.",
    "- Stop-only decay was rejected as a primary direction because stop windows are mixed with resumption/settle behavior; holding briefly helps some individual samples but worsens enough others that aggregate p99 regresses.",
    "- Strong motion damping was rejected because it undershoots steady fast movement; on this trace it worsens high-speed and high-acceleration p95/p99 rather than improving them.",
  );
  fs.writeFileSync(path.join(phaseDir, "experiment-log.md"), lines.join("\n"), "utf8");
}

function pickRecommended(candidatesSummary, baseline) {
  const viable = candidatesSummary.filter((candidate) =>
    candidate.id !== "baseline_product" &&
    candidate.overall.p99 <= baseline.overall.p99 &&
    candidate.low_speed.p95 <= baseline.low_speed.p95 &&
    candidate.high_speed.p95 < baseline.high_speed.p95 &&
    candidate.high_acceleration.p95 < baseline.high_acceleration.p95
  );
  viable.sort((a, b) =>
    (a.high_speed.p95 - baseline.high_speed.p95) - (b.high_speed.p95 - baseline.high_speed.p95) ||
    a.regressions_vs_baseline.gt_5px - b.regressions_vs_baseline.gt_5px
  );
  return viable[0] || null;
}

function writeReport(results) {
  const baseline = results.product_trace.candidates.find((candidate) => candidate.id === "baseline_product");
  const best = results.product_trace.recommendation.best_candidate;
  const lines = [
    "# Phase 2 Report",
    "",
    "## Recommendation",
    "",
  ];
  if (best) {
    lines.push(
      `The best deterministic candidate is \`${best.id}\`. It improves the high-risk tails while keeping overall p99 and low-speed p95 at or below baseline.`,
      "",
      `Baseline: overall mean ${fmt(baseline.overall.mean)}, p95 ${fmt(baseline.overall.p95)}, p99 ${fmt(baseline.overall.p99)}, high-speed p95/p99 ${fmt(baseline.high_speed.p95)}/${fmt(baseline.high_speed.p99)}, high-accel p95/p99 ${fmt(baseline.high_acceleration.p95)}/${fmt(baseline.high_acceleration.p99)}, low-speed p95 ${fmt(baseline.low_speed.p95)}.`,
      `Best: overall mean ${fmt(best.overall.mean)}, p95 ${fmt(best.overall.p95)}, p99 ${fmt(best.overall.p99)}, high-speed p95/p99 ${fmt(best.high_speed.p95)}/${fmt(best.high_speed.p99)}, high-accel p95/p99 ${fmt(best.high_acceleration.p95)}/${fmt(best.high_acceleration.p99)}, low-speed p95 ${fmt(best.low_speed.p95)}.`,
    );
  } else {
    lines.push(
      "No deterministic candidate cleared the decision rule. The product baseline remains best on overall p99, high-speed p95/p99, and high-acceleration p95/p99. The deterministic gates mostly undershoot normal fast motion or react too broadly to stale-stream signals, so they should not ship as the next product step.",
    );
  }

  const ranked = results.product_trace.candidates
    .filter((candidate) => candidate.id !== "baseline_product")
    .slice()
    .sort((a, b) => a.overall.p99 - b.overall.p99)
    .slice(0, 6);
  lines.push("", "## Strongest Findings", "");
  lines.push(
    `- Hook/poll disagreement remains the cleanest deterministic risk signal: baseline disagreement >=5 px has p95/p99 ${fmt(baseline.hook_poll_disagreement_5px.p95)}/${fmt(baseline.hook_poll_disagreement_5px.p99)} px.`,
    `- Motion damping is the wrong deterministic default for this trace: the light speed gate worsens high-speed p95 from ${fmt(baseline.high_speed.p95)} px to ${fmt(results.product_trace.candidates.find((candidate) => candidate.id === "gain_speed_light").high_speed.p95)} px.`,
    `- Stateful alpha-beta filters are a poor fit for this trace without an oracle gate; their smoothing tails are worse than the product baseline.`,
    "",
    "Top deterministic p99 results:",
    ...ranked.map(candidateLine),
    "",
    "## Phase 3 Direction",
    "",
    "Move to a learned oracle/residual phase rather than shipping a fixed deterministic gate as the main predictor. Feed it speed, acceleration, previous speed, DWM horizon, observed poll interval, configured-interval jitter, hook/poll disagreement, stop-settle elapsed time, and recent error/regime labels when available. Keep the product baseline as fallback and let the learned stage decide whether to damp, hold, or trust extrapolation.",
    "",
    "## Artifacts",
    "",
    "- `run_phase2.mjs`: reproducible evaluator.",
    "- `scores.json`: machine-readable candidate metrics.",
    "- `experiment-log.md`: formulas, parameters, full candidate summaries, and rejected options.",
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

  const { contexts, anchor_count, target_miss_count } = makeContexts(productTrace);
  const baselineEvaluation = evaluateCandidate(candidates[0], contexts);
  const baselineErrors = new Map(baselineEvaluation.records.map((record) => [record.ordinal, record.error_px]));
  const baselineSummary = summarizeEvaluation(baselineEvaluation, baselineEvaluation.overall);
  const candidateSummaries = [baselineSummary];
  for (const candidate of candidates.slice(1)) {
    candidateSummaries.push(summarizeEvaluation(evaluateCandidate(candidate, contexts, baselineErrors), baselineEvaluation.overall));
  }

  const recommendation = pickRecommended(candidateSummaries, baselineSummary);
  const results = {
    phase: "phase-2 deterministic-risk-gates",
    generated_by: "run_phase2.mjs",
    inputs: traceZips,
    assumptions: {
      baseline_gain: gain,
      idle_reset_ms: idleResetMs,
      high_speed_px_per_s: highSpeedPxPerS,
      high_acceleration_px_per_s2: highAccelerationPxPerS2,
      high_hook_poll_disagreement_px: highDisagreementPx,
      low_speed_px_per_s: lowSpeedPxPerS,
      ground_truth: "linear timestamp interpolation over recorded position samples",
      prediction_rounding: "Math.Round-compatible half-away-from-zero for .5 cases",
    },
    traces: traceResults,
    product_trace: {
      trace: productTrace.name,
      anchor_count,
      evaluated_count: contexts.length,
      target_miss_count,
      candidates: candidateSummaries,
      recommendation: {
        best_candidate_id: recommendation ? recommendation.id : null,
        best_candidate: recommendation,
        decision_rule: "Recommend only if high-risk tails improve while overall p99 and low-speed p95 do not worsen.",
      },
    },
  };

  fs.writeFileSync(path.join(phaseDir, "scores.json"), JSON.stringify(results, null, 2), "utf8");
  writeExperimentLog(results);
  writeReport(results);
}

main();
