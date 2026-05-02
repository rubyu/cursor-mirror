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
const fixedHorizonsMs = [4, 8, 12, 16];
const gain = 0.75;
const idleResetMs = 100;
const stopSpeedPxPerS = 20;
const moveSpeedPxPerS = 100;

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
const turnBins = [
  ["0-15", 0, 15],
  ["15-45", 15, 45],
  ["45-90", 45, 90],
  ["90-135", 90, 135],
  ["135-180", 135, 181],
];
const horizonBins = [
  ["0-2ms", 0, 2],
  ["2-4ms", 2, 4],
  ["4-8ms", 4, 8],
  ["8-12ms", 8, 12],
  ["12-16ms", 12, 16],
  ["16-21ms", 16, 21],
  ["21ms+", 21, Infinity],
];
const jitterBins = [
  ["<=0.5ms", 0, 0.5],
  ["0.5-1ms", 0.5, 1],
  ["1-2ms", 1, 2],
  ["2-4ms", 2, 4],
  ["4ms+", 4, Infinity],
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
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Bad central directory entry in ${zipPath} at ${cursor}`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === wantedName) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error(`Bad local file header for ${wantedName}`);
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const payload = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return payload;
      if (method === 8) return zlib.inflateRawSync(payload);
      throw new Error(`Unsupported ZIP compression method ${method} for ${wantedName}`);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Entry ${wantedName} not found in ${zipPath}`);
}

function parseIntField(value, fallback = 0) {
  return value === undefined || value === "" ? fallback : Number.parseInt(value, 10);
}

function parseFloatField(value) {
  return value === undefined || value === "" ? null : Number.parseFloat(value);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = parts[j] ?? "";
    rows.push(row);
  }
  return { header, rows };
}

function loadTrace(zipPath) {
  const metadata = JSON.parse(readZipEntry(zipPath, "metadata.json").toString("utf8").replace(/^\uFEFF/, ""));
  const { header, rows } = parseCsv(readZipEntry(zipPath, "trace.csv").toString("utf8"));
  const samples = rows.map((row) => ({
    sequence: parseIntField(row.sequence),
    ticks: parseIntField(row.stopwatchTicks),
    elapsedUs: parseIntField(row.elapsedMicroseconds),
    x: Number.parseFloat(row.x || "0"),
    y: Number.parseFloat(row.y || "0"),
    event: row.event || "",
    hookX: parseFloatField(row.hookX),
    hookY: parseFloatField(row.hookY),
    cursorX: parseFloatField(row.cursorX),
    cursorY: parseFloatField(row.cursorY),
    dwmAvailable: String(row.dwmTimingAvailable || "").toLowerCase() === "true",
    dwmPeriodTicks: parseIntField(row.dwmQpcRefreshPeriod),
    dwmVblankTicks: parseIntField(row.dwmQpcVBlank),
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
      } else if (mode === "cursor") {
        if (sample.cursorX === null || sample.cursorY === null) continue;
        x = sample.cursorX;
        y = sample.cursorY;
      }
      this.points.push([sample.ticks, x, y]);
    }
    this.points.sort((a, b) => a[0] - b[0]);
    this.ticks = this.points.map((point) => point[0]);
  }

  at(targetTicks) {
    if (this.points.length === 0) return null;
    let low = 0;
    let high = this.ticks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.ticks[mid] < targetTicks) low = mid + 1;
      else high = mid;
    }
    if (low < this.points.length && this.points[low][0] === targetTicks) {
      return [this.points[low][1], this.points[low][2]];
    }
    if (low === 0 || low >= this.points.length) return null;
    const [t0, x0, y0] = this.points[low - 1];
    const [t1, x1, y1] = this.points[low];
    if (t1 <= t0) return [x1, y1];
    const alpha = (targetTicks - t0) / (t1 - t0);
    return [x0 + (x1 - x0) * alpha, y0 + (y1 - y0) * alpha];
  }
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const frac = position - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

function stats(values) {
  const data = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (data.length === 0) {
    return { count: 0, mean: null, p50: null, p90: null, p95: null, p99: null, max: null };
  }
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

function roundHalfAwayFromZero(value) {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function numericBin(value, bins) {
  if (!Number.isFinite(value)) return "unknown";
  for (const [label, lower, upper] of bins) {
    if (value >= lower && value < upper) return label;
  }
  return "unknown";
}

function bucketStats(records, field) {
  const groups = new Map();
  for (const record of records) {
    const key = record[field] || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record.error_px);
  }
  return Object.fromEntries([...groups.entries()].sort().map(([key, values]) => [key, stats(values)]));
}

function chronologicalSegments(records, count = 10) {
  const ordered = [...records].sort((a, b) => a.anchor_ticks - b.anchor_ticks);
  const result = {};
  for (let i = 0; i < count; i++) {
    const start = Math.floor((ordered.length * i) / count);
    const end = Math.floor((ordered.length * (i + 1)) / count);
    const chunk = ordered.slice(start, end);
    if (chunk.length === 0) continue;
    result[`${String(i * 10).padStart(2, "0")}-${String((i + 1) * 10).padStart(2, "0")}%`] = stats(
      chunk.map((record) => record.error_px),
    );
  }
  return result;
}

function featureMaps(samples, frequency) {
  const features = new Map();
  const stopEntries = [];
  let previous = null;
  let previousSpeed = null;
  let previousVector = null;
  for (const sample of samples) {
    let dtMs = null;
    let speed = null;
    let accel = null;
    let turnAngle = null;
    let vector = null;
    if (previous) {
      const dtTicks = sample.ticks - previous.ticks;
      if (dtTicks > 0) {
        dtMs = (dtTicks * 1000) / frequency;
        const dx = sample.x - previous.x;
        const dy = sample.y - previous.y;
        vector = [dx, dy];
        speed = (Math.hypot(dx, dy) * frequency) / dtTicks;
        if (previousSpeed !== null) accel = Math.abs(speed - previousSpeed) / (dtMs / 1000);
        if (previousVector) {
          const mag0 = Math.hypot(previousVector[0], previousVector[1]);
          const mag1 = Math.hypot(dx, dy);
          if (mag0 > 0 && mag1 > 0) {
            const dot = previousVector[0] * dx + previousVector[1] * dy;
            const cosine = Math.max(-1, Math.min(1, dot / (mag0 * mag1)));
            turnAngle = (Math.acos(cosine) * 180) / Math.PI;
          }
        }
        if (previousSpeed !== null && previousSpeed >= moveSpeedPxPerS && speed < stopSpeedPxPerS) {
          stopEntries.push(sample.ticks);
        }
      }
    }
    features.set(sample.sequence, {
      dt_ms: dtMs,
      speed_px_s: speed,
      accel_px_s2: accel,
      turn_angle_deg: turnAngle,
      speed_bin: numericBin(speed, speedBins),
      accel_bin: numericBin(accel, accelBins),
      turn_angle_bin: numericBin(turnAngle, turnBins),
    });
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

function stopWindow(tick, stopEntries, frequency) {
  if (stopEntries.length === 0) return "not_near_stop_entry";
  const index = nearestStopIndex(stopEntries, tick);
  const candidates = [];
  if (index < stopEntries.length) candidates.push(stopEntries[index]);
  if (index > 0) candidates.push(stopEntries[index - 1]);
  const nearest = candidates.reduce((best, current) => (Math.abs(current - tick) < Math.abs(best - tick) ? current : best));
  const offsetMs = ((tick - nearest) * 1000) / frequency;
  if (offsetMs >= -32 && offsetMs < -16) return "pre_32_16ms";
  if (offsetMs >= -16 && offsetMs < 0) return "pre_16_0ms";
  if (offsetMs >= 0 && offsetMs < 16) return "post_0_16ms";
  if (offsetMs >= 16 && offsetMs < 33) return "post_16_33ms";
  if (offsetMs >= 33 && offsetMs < 67) return "post_33_67ms";
  if (offsetMs >= 67 && offsetMs < 133) return "post_67_133ms";
  return "not_near_stop_entry";
}

function stopSettleWindow(tick, stopEntries, frequency) {
  if (stopEntries.length === 0) return "not_in_stop_settle";
  const index = nearestStopIndex(stopEntries, tick) - 1;
  if (index < 0) return "not_in_stop_settle";
  const elapsedMs = ((tick - stopEntries[index]) * 1000) / frequency;
  if (elapsedMs < 0 || elapsedMs >= 250) return "not_in_stop_settle";
  if (elapsedMs < 16) return "settle_0_16ms";
  if (elapsedMs < 33) return "settle_16_33ms";
  if (elapsedMs < 67) return "settle_33_67ms";
  if (elapsedMs < 133) return "settle_67_133ms";
  return "settle_133_250ms";
}

function pollJitterBin(sample, previousPoll, frequency, nominalMs) {
  if (!previousPoll || !Number.isFinite(nominalMs)) return "unknown";
  const intervalMs = ((sample.ticks - previousPoll.ticks) * 1000) / frequency;
  return numericBin(Math.abs(intervalMs - nominalMs), jitterBins);
}

function selectNextVblank(sample) {
  if (!sample.dwmAvailable || sample.dwmVblankTicks <= 0 || sample.dwmPeriodTicks <= 0) {
    return { selected: null, status: "invalid_dwm_horizon", horizonTicks: null };
  }
  let selected = sample.dwmVblankTicks;
  let status = "valid";
  if (selected <= sample.ticks) {
    const periodsLate = Math.floor((sample.ticks - selected) / sample.dwmPeriodTicks) + 1;
    selected += periodsLate * sample.dwmPeriodTicks;
    status = "late_advanced";
  }
  const horizonTicks = selected - sample.ticks;
  if (horizonTicks <= 0) return { selected, status: "nonpositive_horizon_fallback", horizonTicks };
  if (horizonTicks > sample.dwmPeriodTicks * 1.25) return { selected, status: "excessive_horizon_fallback", horizonTicks };
  return { selected, status, horizonTicks };
}

function evaluateScenario({
  trace,
  scenarioName,
  anchors,
  truth,
  features,
  stopEntries,
  fixedHorizonMs,
  useDwm,
  hookTruth,
}) {
  const records = [];
  const statusCounts = {};
  let previous = null;
  let previousPoll = null;
  const nominalMs = trace.metadata.PollIntervalMilliseconds === undefined ? null : Number(trace.metadata.PollIntervalMilliseconds);
  let targetMissCount = 0;

  anchors.forEach((sample, ordinal) => {
    let status = "valid";
    let targetTicks = null;
    let horizonTicks = null;
    if (useDwm) {
      const selected = selectNextVblank(sample);
      status = selected.status;
      horizonTicks = selected.horizonTicks;
      targetTicks = selected.selected;
    } else {
      horizonTicks = (fixedHorizonMs * trace.frequency) / 1000;
      targetTicks = sample.ticks + horizonTicks;
    }

    const target = targetTicks === null ? null : truth.at(targetTicks);
    if (!target) {
      targetMissCount += 1;
      previous = sample;
      if (sample.event === "poll") previousPoll = sample;
      return;
    }

    let prediction = [sample.x, sample.y];
    if (!previous) {
      if (status === "valid") status = "warmup_hold";
    } else {
      const deltaTicks = sample.ticks - previous.ticks;
      const deltaMs = deltaTicks > 0 ? (deltaTicks * 1000) / trace.frequency : null;
      const invalidDt = deltaTicks <= 0 || deltaMs === null || deltaMs > idleResetMs;
      const fallbackStatuses = new Set(["invalid_dwm_horizon", "nonpositive_horizon_fallback", "excessive_horizon_fallback"]);
      if (invalidDt) {
        status = "invalid_dt_or_idle_gap_fallback";
      } else if (useDwm && fallbackStatuses.has(status)) {
        // Hold current position.
      } else if (horizonTicks !== null && horizonTicks > 0) {
        const scale = (gain * horizonTicks) / deltaTicks;
        prediction = [
          roundHalfAwayFromZero(sample.x + (sample.x - previous.x) * scale),
          roundHalfAwayFromZero(sample.y + (sample.y - previous.y) * scale),
        ];
      }
    }

    const feature = features.get(sample.sequence) || {};
    let hookDisagreement = null;
    if (hookTruth) {
      const hookPoint = hookTruth.at(sample.ticks);
      if (hookPoint) hookDisagreement = distance([sample.x, sample.y], hookPoint);
    }
    const horizonMs = horizonTicks === null ? null : (horizonTicks * 1000) / trace.frequency;
    const record = {
      ordinal,
      anchor_ticks: sample.ticks,
      anchor_elapsed_ms: sample.elapsedUs / 1000,
      error_px: distance(prediction, target),
      target_horizon_ms: horizonMs,
      status,
      speed_bin: feature.speed_bin || "unknown",
      accel_bin: feature.accel_bin || "unknown",
      turn_angle_bin: feature.turn_angle_bin || "unknown",
      stop_entry_window: stopWindow(sample.ticks, stopEntries, trace.frequency),
      stop_settle_window: stopSettleWindow(sample.ticks, stopEntries, trace.frequency),
      dwm_horizon_bin: useDwm ? numericBin(horizonMs, horizonBins) : "not_dwm",
      poll_jitter_bin: pollJitterBin(sample, previousPoll, trace.frequency, nominalMs),
      hook_poll_disagreement_bin: numericBin(hookDisagreement, disagreementBins),
    };
    records.push(record);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    previous = sample;
    if (sample.event === "poll") previousPoll = sample;
  });

  return {
    scenario: scenarioName,
    trace: trace.name,
    mode: useDwm ? "dwm_next_vblank" : "fixed_horizon",
    fixed_horizon_ms: fixedHorizonMs,
    gain,
    anchor_count: anchors.length,
    evaluated_count: records.length,
    target_miss_count: targetMissCount,
    status_counts: Object.fromEntries(Object.entries(statusCounts).sort()),
    overall: stats(records.map((record) => record.error_px)),
    speed_bins: bucketStats(records, "speed_bin"),
    acceleration_bins: bucketStats(records, "accel_bin"),
    turn_angle_bins: bucketStats(records, "turn_angle_bin"),
    stop_entry_windows: bucketStats(records, "stop_entry_window"),
    stop_settle_windows: bucketStats(records, "stop_settle_window"),
    dwm_horizon_bins: bucketStats(records, "dwm_horizon_bin"),
    poll_interval_jitter_bins: bucketStats(records, "poll_jitter_bin"),
    hook_poll_disagreement_bins: bucketStats(records, "hook_poll_disagreement_bin"),
    chronological_segments: chronologicalSegments(records),
  };
}

function eventCounts(samples) {
  const counts = {};
  for (const sample of samples) counts[sample.event] = (counts[sample.event] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

function intervalSummary(samples, frequency) {
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i].ticks - samples[i - 1].ticks;
    if (delta > 0) intervals.push((delta * 1000) / frequency);
  }
  return stats(intervals);
}

function inferSchema(trace) {
  const polls = trace.samples.filter((sample) => sample.event === "poll");
  const moves = trace.samples.filter((sample) => sample.event === "move");
  const dwmPolls = polls.filter((sample) => sample.dwmAvailable);
  return {
    header: trace.header,
    metadata: trace.metadata,
    event_counts: eventCounts(trace.samples),
    sample_count: trace.samples.length,
    poll_count: polls.length,
    move_count: moves.length,
    dwm_poll_count: dwmPolls.length,
    all_poll_rows_have_dwm_timing: polls.length > 0 && dwmPolls.length === polls.length,
    poll_interval_ms: polls.length > 0 ? intervalSummary(polls, trace.frequency) : null,
    move_interval_ms: moves.length > 0 ? intervalSummary(moves, trace.frequency) : null,
  };
}

function evaluateTrace(trace) {
  const polls = trace.samples.filter((sample) => sample.event === "poll");
  const moves = trace.samples.filter((sample) => sample.event === "move");
  const truth = new Interpolator(trace.samples, "base");
  const hookTruth = polls.length && moves.length ? new Interpolator(moves, "hook") : null;
  const scenarios = [];
  if (polls.length && polls.some((sample) => sample.dwmAvailable)) {
    const { features, stopEntries } = featureMaps(polls, trace.frequency);
    scenarios.push(
      evaluateScenario({
        trace,
        scenarioName: "product_poll_dwm_next_vblank",
        anchors: polls,
        truth,
        features,
        stopEntries,
        fixedHorizonMs: null,
        useDwm: true,
        hookTruth,
      }),
    );
  } else {
    const { features, stopEntries } = featureMaps(trace.samples, trace.frequency);
    for (const horizon of fixedHorizonsMs) {
      scenarios.push(
        evaluateScenario({
          trace,
          scenarioName: `compat_fixed_${horizon}ms`,
          anchors: trace.samples,
          truth,
          features,
          stopEntries,
          fixedHorizonMs: horizon,
          useDwm: false,
          hookTruth: null,
        }),
      );
    }
  }
  return { schema: inferSchema(trace), scenarios };
}

function fmt(value, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
}

function compactStats(summary) {
  return `count ${summary.count}, mean ${fmt(summary.mean)}, p50 ${fmt(summary.p50)}, p90 ${fmt(summary.p90)}, p95 ${fmt(summary.p95)}, p99 ${fmt(summary.p99)}, max ${fmt(summary.max)}`;
}

function topBins(bins, limit = 8) {
  return Object.entries(bins)
    .filter(([, summary]) => summary.count)
    .sort((a, b) => (b[1].p95 ?? -1) - (a[1].p95 ?? -1) || (b[1].mean ?? -1) - (a[1].mean ?? -1))
    .slice(0, limit)
    .map(([name, summary]) => `- \`${name}\`: ${compactStats(summary)}`);
}

function findScenario(results, scenarioName) {
  for (const traceResult of Object.values(results.traces)) {
    for (const scenario of traceResult.scenarios) {
      if (scenario.scenario === scenarioName) return scenario;
    }
  }
  return null;
}

function writeExperimentLog(results) {
  const lines = [
    "# Phase 1 Experiment Log",
    "",
    "## Scope",
    "",
    "Replayed the two root trace ZIPs directly from disk. No application source, tests, specs, build scripts, or root trace ZIPs were modified.",
    "",
    "## Baseline Reconstruction",
    "",
    "- Product-supported v2 path: poll rows are anchors; target timestamp is the selected next DWM vblank; prediction is rounded `current + (current - previous) * 0.75 * horizonTicks / deltaTicks`.",
    "- DWM selection follows the source predictor: missing timing is invalid; stale/late `QpcVBlank` is advanced by refresh periods; nonpositive or `> 1.25x` refresh-period horizons fall back to hold/current.",
    "- Default idle reset is 100 ms; invalid dt or idle gaps fall back to hold/current.",
    "- Older traces without DWM timing are evaluated as compatibility fixed-horizon slices at 4, 8, 12, and 16 ms with the same 0.75 gain.",
    "- Ground truth is timestamp interpolation over the merged recorded position stream. For v2 hook/poll disagreement, hook position is separately interpolated from hook/move rows.",
    "",
    "## Inferred Schemas",
    "",
  ];
  for (const [traceName, traceResult] of Object.entries(results.traces)) {
    const schema = traceResult.schema;
    lines.push(
      `### \`${traceName}\``,
      "",
      `- Header fields: \`${schema.header.join(", ")}\``,
      `- Metadata: \`${JSON.stringify(schema.metadata)}\``,
      `- Event counts: \`${JSON.stringify(schema.event_counts)}\``,
      `- Poll rows: ${schema.poll_count}; move rows: ${schema.move_count}; DWM poll rows: ${schema.dwm_poll_count}`,
    );
    if (schema.poll_interval_ms) lines.push(`- Poll interval stats: ${compactStats(schema.poll_interval_ms)} ms`);
    if (schema.move_interval_ms) lines.push(`- Move interval stats: ${compactStats(schema.move_interval_ms)} ms`);
    lines.push("");
  }
  lines.push("## Scenario Results", "");
  for (const [traceName, traceResult] of Object.entries(results.traces)) {
    for (const scenario of traceResult.scenarios) {
      lines.push(
        `### \`${traceName}\` / \`${scenario.scenario}\``,
        "",
        `- Mode: \`${scenario.mode}\`; fixed horizon: \`${scenario.fixed_horizon_ms}\`; gain: \`${scenario.gain}\``,
        `- Anchors: ${scenario.anchor_count}; evaluated: ${scenario.evaluated_count}; target misses: ${scenario.target_miss_count}`,
        `- Status counts: \`${JSON.stringify(scenario.status_counts)}\``,
        `- Overall: ${compactStats(scenario.overall)} px`,
        "",
        "Speed bins:",
        ...topBins(scenario.speed_bins),
        "",
        "Acceleration bins:",
        ...topBins(scenario.acceleration_bins),
        "",
        "Turn-angle bins:",
        ...topBins(scenario.turn_angle_bins),
        "",
        "Stop-entry windows:",
        ...topBins(scenario.stop_entry_windows),
        "",
        "Stop-settle windows:",
        ...topBins(scenario.stop_settle_windows),
        "",
        "DWM horizon bins:",
        ...topBins(scenario.dwm_horizon_bins),
        "",
        "Poll interval jitter bins:",
        ...topBins(scenario.poll_interval_jitter_bins),
        "",
        "Hook/poll disagreement bins:",
        ...topBins(scenario.hook_poll_disagreement_bins),
        "",
        "Chronological robustness:",
      );
      for (const [segment, summary] of Object.entries(scenario.chronological_segments)) {
        lines.push(`- \`${segment}\`: ${compactStats(summary)} px`);
      }
      lines.push("");
    }
  }
  fs.writeFileSync(path.join(phaseDir, "experiment-log.md"), lines.join("\n"), "utf8");
}

function writeReport(results) {
  const product = findScenario(results, "product_poll_dwm_next_vblank");
  const fixed = [];
  for (const [traceName, traceResult] of Object.entries(results.traces)) {
    for (const scenario of traceResult.scenarios) {
      if (scenario.mode === "fixed_horizon") fixed.push([traceName, scenario]);
    }
  }
  const lines = ["# Phase 1 Report", "", "## Decision Summary", ""];
  if (product) {
    const overall = product.overall;
    const productSchema = results.traces[product.trace].schema;
    const worstSpeed = Object.entries(product.speed_bins).sort((a, b) => (b[1].p95 ?? -1) - (a[1].p95 ?? -1))[0];
    const worstHorizon = Object.entries(product.dwm_horizon_bins).sort((a, b) => (b[1].p95 ?? -1) - (a[1].p95 ?? -1))[0];
    const worstJitter = Object.entries(product.poll_interval_jitter_bins).sort((a, b) => (b[1].p95 ?? -1) - (a[1].p95 ?? -1))[0];
    const highDisagreement = product.hook_poll_disagreement_bins["5px+"];
    lines.push(
      `The reconstructed product poll+DWM baseline on the v2 trace evaluates ${overall.count} anchors with mean error ${fmt(overall.mean)} px, p95 ${fmt(overall.p95)} px, p99 ${fmt(overall.p99)} px, and max ${fmt(overall.max)} px.`,
      `Most anchors use the DWM path; status counts are \`${JSON.stringify(product.status_counts)}\`.`,
      `The v2 trace metadata records an 8 ms poll interval, but observed poll intervals are p50 ${fmt(productSchema.poll_interval_ms.p50)} ms and p95 ${fmt(productSchema.poll_interval_ms.p95)} ms.`,
      "",
      "The strongest error signal is motion regime: fast anchors and high-acceleration anchors dominate the tail. DWM horizon also matters; late-in-frame horizons are less harmful than long horizons because the extrapolation distance is smaller.",
      `Worst p95 speed bin: \`${worstSpeed[0]}\` at ${fmt(worstSpeed[1].p95)} px. Worst p95 DWM horizon bin: \`${worstHorizon[0]}\` at ${fmt(worstHorizon[1].p95)} px. Worst p95 poll-jitter bin: \`${worstJitter[0]}\` at ${fmt(worstJitter[1].p95)} px.`,
    );
    if (highDisagreement && highDisagreement.count) {
      lines.push(
        `When interpolated hook/poll disagreement exceeds 5 px, p95 error rises to ${fmt(highDisagreement.p95)} px across ${highDisagreement.count} anchors, so stream disagreement is a useful Phase 2 gating signal.`,
      );
    }
  } else {
    lines.push("No DWM-capable product trace was available; only fixed-horizon compatibility slices were evaluated.");
  }
  if (fixed.length) {
    lines.push("", "## Older Trace Compatibility", "");
    for (const [traceName, scenario] of fixed) {
      const overall = scenario.overall;
      lines.push(
        `- \`${traceName}\` \`${scenario.scenario}\`: mean ${fmt(overall.mean)} px, p95 ${fmt(overall.p95)} px, p99 ${fmt(overall.p99)} px, max ${fmt(overall.max)} px.`,
      );
    }
  }
  lines.push(
    "",
    "## Phase 2 Direction",
    "",
    "Prioritize adaptive gain/horizon damping by motion regime rather than replacing the whole predictor. The Phase 1 tails point at fast acceleration, turns, and stop-entry/settle periods, so Phase 2 should test bounded acceleration-aware gain reduction, stop detection that quickly returns to hold, and possibly a shorter effective horizon when poll jitter or hook/poll disagreement is high.",
    "",
    "## Artifacts",
    "",
    "- `scores.json`: machine-readable metrics and bins.",
    "- `experiment-log.md`: schema notes, reconstruction details, and full bin summaries.",
    "- `run_phase1.mjs`: reproducible replay/report script.",
  );
  fs.writeFileSync(path.join(phaseDir, "report.md"), lines.join("\n"), "utf8");
}

function main() {
  const traces = traceZips.map(loadTrace);
  const results = {
    phase: "phase-1 baseline-replay-and-error-anatomy",
    generated_by: "run_phase1.mjs",
    inputs: traceZips,
    assumptions: {
      gain,
      idle_reset_ms: idleResetMs,
      fixed_horizons_ms: fixedHorizonsMs,
      stop_speed_px_per_s: stopSpeedPxPerS,
      move_speed_px_per_s: moveSpeedPxPerS,
      prediction_rounding: "Math.Round-compatible half-away-from-zero for .5 cases",
      ground_truth: "linear timestamp interpolation over recorded position samples",
    },
    traces: Object.fromEntries(traces.map((trace) => [trace.name, evaluateTrace(trace)])),
  };
  fs.writeFileSync(path.join(phaseDir, "scores.json"), JSON.stringify(results, null, 2), "utf8");
  writeExperimentLog(results);
  writeReport(results);
}

main();
