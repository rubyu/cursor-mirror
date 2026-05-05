#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SCHEMA_VERSION = "cursor-prediction-v11-step2-baseline-replay/1";
const HORIZONS_MS = [0, 8, 16.67, 25, 33.33, 50];
const REGRESSION_THRESHOLDS_PX = [1, 2, 5, 10];
const HISTOGRAM_BIN_PX = 0.25;
const HISTOGRAM_MAX_PX = 1024;
const HISTOGRAM_BINS = Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 1;

const PACKAGES = [
  { id: "normal", label: "normal load", file: "cursor-mirror-motion-recording-20260503-212556.zip" },
  { id: "stress", label: "stress load", file: "cursor-mirror-motion-recording-20260503-215632.zip" },
];

const SANITY_PACKAGE = {
  id: "sanity",
  label: "short sanity parser smoke",
  file: "cursor-mirror-motion-recording-20260503-212102.zip",
};

const SCHEDULER_DELAY_BINS = [
  { id: "<=1ms", min: -Infinity, max: 1 },
  { id: "1-4ms", min: 1, max: 4 },
  { id: "4-8ms", min: 4, max: 8 },
  { id: ">8ms", min: 8, max: Infinity },
];

const BASELINES = [
  {
    id: "constant_position",
    family: "hold_last",
    description: "Hold the most recent causal referencePoll position.",
    productEligible: true,
    params: {},
  },
  {
    id: "last2_velocity_raw",
    family: "last_two_constant_velocity",
    description: "Constant velocity from the last two referencePoll observations, uncapped.",
    productEligible: true,
    params: { capPx: null },
  },
  {
    id: "last2_velocity_cap64",
    family: "last_two_constant_velocity",
    description: "Constant velocity from the last two referencePoll observations, capped to 64 px displacement.",
    productEligible: true,
    params: { capPx: 64 },
  },
  {
    id: "least_squares_velocity_n3_cap64",
    family: "least_squares_velocity",
    description: "Linear least-squares velocity over the last 3 referencePoll samples.",
    productEligible: true,
    params: { samples: 3, capPx: 64 },
  },
  {
    id: "least_squares_velocity_n5_cap64",
    family: "least_squares_velocity",
    description: "Linear least-squares velocity over the last 5 referencePoll samples.",
    productEligible: true,
    params: { samples: 5, capPx: 64 },
  },
  {
    id: "least_squares_velocity_n8_cap64",
    family: "least_squares_velocity",
    description: "Linear least-squares velocity over the last 8 referencePoll samples.",
    productEligible: true,
    params: { samples: 8, capPx: 64 },
  },
  {
    id: "least_squares_velocity_n12_cap64",
    family: "least_squares_velocity",
    description: "Linear least-squares velocity over the last 12 referencePoll samples.",
    productEligible: true,
    params: { samples: 12, capPx: 64 },
  },
  {
    id: "constant_acceleration_last3_cap96",
    family: "constant_acceleration",
    description: "Velocity and acceleration from the last three causal referencePoll samples.",
    productEligible: true,
    params: { capPx: 96 },
  },
  {
    id: "alpha_beta_light_n12_cap64",
    family: "alpha_beta",
    description: "Light alpha-beta tracker over the last 12 referencePoll samples.",
    productEligible: true,
    params: { samples: 12, alpha: 0.85, beta: 0.15, capPx: 64 },
  },
  {
    id: "gated_speed_constant_or_ls8",
    family: "simple_speed_gate",
    description: "Causal speed gate: constant position below 25 px/s, LS n8 otherwise.",
    productEligible: true,
    params: { stopSpeedPxPerSec: 25, movingModel: "least_squares_velocity_n8_cap64" },
  },
  {
    id: "gated_category_oracle",
    family: "script_category_gate",
    description: "Offline oracle gate: hold uses constant position, resume uses last2 cap64, moving uses LS n8.",
    productEligible: false,
    params: { usesScriptCategory: true },
  },
];

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  const outDir = path.resolve(scriptDir, "..", "step-2-baseline-replay");
  const step1Scores = path.resolve(scriptDir, "..", "step-1-data-audit", "scores.json");
  const args = { root, outDir, step1Scores, includeSanitySmoke: true };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--step1-scores") args.step1Scores = path.resolve(argv[++i]);
    else if (arg === "--skip-sanity-smoke") args.includeSanitySmoke = false;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v11\\scripts\\run-step2-baselines.js

Options:
  --root <path>           repository root containing the source ZIP files
  --out-dir <path>        output directory for Step 2 artifacts
  --step1-scores <path>   Step 1 scores.json with split/category definitions
  --skip-sanity-smoke     skip parser smoke over the 8-scenario sanity ZIP
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central-directory signature at ${offset}`);
    }
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
  if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error(`Invalid local-file signature for ${entryName}`);
  }
  const nameLen = zip.readUInt16LE(localHeaderOffset + 26);
  const extraLen = zip.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = zip.subarray(dataOffset, dataOffset + entry.compressedSize);
  let data;
  if (entry.method === 0) data = Buffer.from(compressed);
  else if (entry.method === 8) data = zlib.inflateRawSync(compressed);
  else throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entryName}`);
  if (data.length !== entry.uncompressedSize) {
    throw new Error(`Unexpected size for ${entryName}: ${data.length} != ${entry.uncompressedSize}`);
  }
  return data;
}

function jsonEntry(opened, entryName) {
  return JSON.parse(readZipEntry(opened, entryName).toString("utf8").replace(/^\uFEFF/, ""));
}

function parseCsvText(buffer, onHeader, onRow) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  let firstNewline = text.indexOf("\n");
  if (firstNewline < 0) firstNewline = text.length;
  const headerLine = text.slice(0, firstNewline).replace(/\r$/, "");
  const header = headerLine.length > 0 ? headerLine.split(",") : [];
  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  if (onHeader) onHeader(header, column);

  let rowCount = 0;
  let pos = Math.min(firstNewline + 1, text.length);
  while (pos < text.length) {
    let next = text.indexOf("\n", pos);
    if (next < 0) next = text.length;
    let line = text.slice(pos, next);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.length > 0) {
      rowCount += 1;
      onRow(line.split(","), rowCount, column);
    }
    pos = next + 1;
  }

  return { header, rowCount };
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function distance(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function clampVector(dx, dy, capPx) {
  if (!Number.isFinite(capPx) || capPx <= 0) return { dx, dy };
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag <= capPx || mag === 0) return { dx, dy };
  const scale = capPx / mag;
  return { dx: dx * scale, dy: dy * scale };
}

function metricKey(parts) {
  return parts.map((part) => String(part)).join("|");
}

function parseSplit(step1Scores) {
  const split = step1Scores.splitProposal;
  if (!split || !Array.isArray(split.train) || !Array.isArray(split.validation) || !Array.isArray(split.test)) {
    throw new Error("Step 1 scores.json does not contain splitProposal train/validation/test arrays");
  }
  const byScenario = new Map();
  for (const index of split.train) byScenario.set(index, "train");
  for (const index of split.validation) byScenario.set(index, "validation");
  for (const index of split.test) byScenario.set(index, "test");
  return {
    method: split.method,
    ratio: split.ratio,
    counts: split.counts,
    train: split.train,
    validation: split.validation,
    test: split.test,
    byScenario,
  };
}

function applyEasing(value, easing) {
  const x = clamp01(value);
  const normalized = String(easing || "").trim().toLowerCase();
  if (normalized === "smoothstep") return x * x * (3 - 2 * x);
  if (normalized === "sine") return Math.sin((x * Math.PI) / 2);
  return x;
}

function clipPoint(x, y, bounds) {
  if (!bounds) return { x, y };
  const minX = Number(bounds.X) || 0;
  const minY = Number(bounds.Y) || 0;
  const maxX = minX + (Number(bounds.Width) || 0);
  const maxY = minY + (Number(bounds.Height) || 0);
  return {
    x: clamp(x, minX, maxX),
    y: clamp(y, minY, maxY),
  };
}

function evaluateBezier(script, progress) {
  const points = Array.isArray(script.ControlPoints) ? script.ControlPoints : [];
  if (points.length === 0) return { x: 0, y: 0 };
  const x = points.map((point) => Number(point?.X) || 0);
  const y = points.map((point) => Number(point?.Y) || 0);
  const t = clamp01(progress);
  for (let level = points.length - 1; level > 0; level -= 1) {
    for (let i = 0; i < level; i += 1) {
      x[i] += (x[i + 1] - x[i]) * t;
      y[i] += (y[i + 1] - y[i]) * t;
    }
  }
  return clipPoint(x[0], y[0], script.Bounds);
}

function speedMultiplierAt(script, progress) {
  const speedPoints = Array.isArray(script.SpeedPoints) ? script.SpeedPoints : [];
  let multiplier = 1;
  for (const point of speedPoints) {
    if (!point) continue;
    const width = Math.max(0.001, Number(point.EasingWidth) || 0);
    const dist = Math.abs(clamp01(progress) - clamp01(Number(point.Progress) || 0));
    if (dist > width) continue;
    const weight = applyEasing(1 - dist / width, point.Easing);
    multiplier += (Math.max(0.05, Number(point.Multiplier) || 0) - 1) * weight;
  }
  return clamp(multiplier, 0.05, 5);
}

function buildProgressLookup(script) {
  const steps = 256;
  const cumulative = new Array(steps + 1).fill(0);
  const progressByTime = new Array(steps + 1).fill(0);
  let previous = evaluateBezier(script, 0);
  for (let i = 1; i <= steps; i += 1) {
    const progress = i / steps;
    const current = evaluateBezier(script, progress);
    const segmentLength = distance(previous.x, previous.y, current.x, current.y);
    const speed = speedMultiplierAt(script, (progress + (i - 1) / steps) / 2);
    cumulative[i] = cumulative[i - 1] + segmentLength / speed;
    previous = current;
  }
  const total = cumulative[steps];
  if (total <= 0) {
    for (let i = 0; i <= steps; i += 1) progressByTime[i] = i / steps;
    return progressByTime;
  }
  let source = 0;
  for (let i = 0; i <= steps; i += 1) {
    const target = (total * i) / steps;
    while (source < steps && cumulative[source + 1] < target) source += 1;
    const left = cumulative[source];
    const right = cumulative[Math.min(steps, source + 1)];
    const local = right > left ? (target - left) / (right - left) : 0;
    progressByTime[i] = (source + local) / steps;
  }
  return progressByTime;
}

function movementTimeAtProgress(progressByTime, progress) {
  const target = clamp01(progress);
  if (target <= progressByTime[0]) return 0;
  const steps = progressByTime.length - 1;
  for (let i = 0; i < steps; i += 1) {
    const left = progressByTime[i];
    const right = progressByTime[i + 1];
    if (target <= right || i === steps - 1) {
      const local = right > left ? (target - left) / (right - left) : 0;
      return clamp01((i + local) / steps);
    }
  }
  return 1;
}

function normalizeHoldSegments(script) {
  const duration = Math.max(1, Number(script.DurationMilliseconds) || 1);
  const holds = (Array.isArray(script.HoldSegments) ? script.HoldSegments : [])
    .filter((hold) => hold && Number(hold.DurationMilliseconds) > 0)
    .map((hold) => ({
      progress: clamp01(Number(hold.Progress) || 0),
      durationMs: Math.max(1, Number(hold.DurationMilliseconds) || 0),
      resumeMs: Math.max(0, Number(hold.ResumeEasingMilliseconds) || 0),
    }))
    .sort((a, b) => a.progress - b.progress);
  const total = holds.reduce((sum, hold) => sum + hold.durationMs, 0);
  const maximum = Math.max(0, duration - 1);
  if (total > maximum && total > 0) {
    const scale = maximum / total;
    for (const hold of holds) {
      hold.durationMs = Math.max(1, hold.durationMs * scale);
      hold.resumeMs = Math.min(hold.resumeMs, hold.durationMs);
    }
  }
  return holds;
}

function holdIntervals(script) {
  const duration = Math.max(1, Number(script.DurationMilliseconds) || 1);
  const holds = normalizeHoldSegments(script);
  const totalHold = holds.reduce((sum, hold) => sum + hold.durationMs, 0);
  const movementDuration = Math.max(1, duration - totalHold);
  const progressByTime = buildProgressLookup(script);
  let completedHoldDuration = 0;
  const intervals = [];
  for (const hold of holds) {
    const holdMovementStart = movementTimeAtProgress(progressByTime, hold.progress) * movementDuration;
    const holdStart = holdMovementStart + completedHoldDuration;
    const holdEnd = Math.min(duration, holdStart + hold.durationMs);
    intervals.push({
      holdStartMs: holdStart,
      holdEndMs: holdEnd,
      resumeStartMs: holdEnd,
      resumeEndMs: Math.min(duration, holdEnd + hold.resumeMs),
    });
    completedHoldDuration += hold.durationMs;
  }
  for (let i = 0; i < intervals.length; i += 1) {
    const nextHoldStart = i + 1 < intervals.length ? intervals[i + 1].holdStartMs : duration;
    intervals[i].resumeEndClippedMs = Math.max(
      intervals[i].resumeStartMs,
      Math.min(intervals[i].resumeEndMs, nextHoldStart),
    );
  }
  return intervals;
}

function buildIntervalsByScenario(script) {
  const scenarios = Array.isArray(script.Scenarios) ? script.Scenarios : [script];
  return scenarios.map((scenario) => holdIntervals(scenario));
}

function classifyMovement(scenarioElapsedMs, intervals) {
  for (const interval of intervals) {
    if (scenarioElapsedMs >= interval.holdStartMs && scenarioElapsedMs <= interval.holdEndMs) return "hold";
  }
  for (const interval of intervals) {
    if (scenarioElapsedMs > interval.resumeStartMs && scenarioElapsedMs <= interval.resumeEndClippedMs) return "resume";
  }
  return "moving";
}

function schedulerDelayBin(delayMs) {
  if (!Number.isFinite(delayMs)) return "missing";
  for (const bin of SCHEDULER_DELAY_BINS) {
    if (delayMs > bin.min && delayMs <= bin.max) return bin.id;
  }
  return "missing";
}

function speedBin(speed) {
  if (!Number.isFinite(speed)) return "missing";
  if (speed < 25) return "0-25";
  if (speed < 100) return "25-100";
  if (speed < 250) return "100-250";
  if (speed < 500) return "250-500";
  if (speed < 1000) return "500-1000";
  if (speed < 2000) return "1000-2000";
  return ">=2000";
}

function loadTracePackage(root, target, split) {
  const zipPath = path.join(root, target.file);
  const opened = openZip(zipPath);
  const metadata = jsonEntry(opened, "metadata.json");
  const motionMetadata = jsonEntry(opened, "motion-metadata.json");
  const script = jsonEntry(opened, "motion-script.json");
  const intervalsByScenario = buildIntervalsByScenario(script);
  const trace = {
    sourceZip: target.file,
    id: target.id,
    label: target.label,
    metadata,
    motionMetadata,
    refTimesUs: [],
    refX: [],
    refY: [],
    pollTimesUs: [],
    schedulerTimesUs: [],
    schedulerDelayMs: [],
    eventCounts: {},
    csvRows: 0,
  };

  const stopwatchFrequency = Number(metadata.StopwatchFrequency) || 10000000;
  const traceData = readZipEntry(opened, "trace.csv");
  parseCsvText(traceData, null, (parts, rowIndex, column) => {
    trace.csvRows = rowIndex;
    const event = parts[column.event] || "(empty)";
    trace.eventCounts[event] = (trace.eventCounts[event] || 0) + 1;
    const elapsedUs = numberOrNull(parts[column.elapsedMicroseconds]);
    if (!Number.isFinite(elapsedUs)) return;

    const x = numberOrNull(parts[column.cursorX]) ?? numberOrNull(parts[column.x]);
    const y = numberOrNull(parts[column.cursorY]) ?? numberOrNull(parts[column.y]);
    if (event === "referencePoll" && Number.isFinite(x) && Number.isFinite(y)) {
      trace.refTimesUs.push(elapsedUs);
      trace.refX.push(x);
      trace.refY.push(y);
      return;
    }
    if (event === "poll") {
      trace.pollTimesUs.push(elapsedUs);
      return;
    }
    if (event === "runtimeSchedulerPoll") {
      const planned = numberOrNull(parts[column.runtimeSchedulerPlannedTickTicks]);
      const actual = numberOrNull(parts[column.runtimeSchedulerActualTickTicks]);
      if (Number.isFinite(planned) && Number.isFinite(actual)) {
        trace.schedulerTimesUs.push(elapsedUs);
        trace.schedulerDelayMs.push(((actual - planned) / stopwatchFrequency) * 1000);
      }
    }
  });

  return {
    ...trace,
    script,
    intervalsByScenario,
    anchors: buildAnchors(trace, motionMetadata, intervalsByScenario, split),
  };
}

function loadSanitySmoke(root) {
  const zipPath = path.join(root, SANITY_PACKAGE.file);
  const opened = openZip(zipPath);
  const metadata = jsonEntry(opened, "metadata.json");
  const motionMetadata = jsonEntry(opened, "motion-metadata.json");
  const entries = [...opened.entries.keys()].sort();
  return {
    sourceZip: SANITY_PACKAGE.file,
    entries,
    traceRows: metadata.SampleCount ?? null,
    referencePollRows: metadata.ReferencePollSampleCount ?? null,
    scenarioCount: motionMetadata.ScenarioCount ?? null,
    qualityWarnings: Array.isArray(metadata.QualityWarnings) ? metadata.QualityWarnings : [],
    usedForModelSelection: false,
  };
}

function buildAnchors(trace, motionMetadata, intervalsByScenario, split) {
  const scenarioDurationMs = Number(motionMetadata.ScenarioDurationMilliseconds) || 12000;
  const scenarioCount = Number(motionMetadata.ScenarioCount) || intervalsByScenario.length || 1;
  const anchors = [];
  let skippedNoReference = 0;
  for (const pollUs of trace.pollTimesUs) {
    const refIndex = refIndexAtOrBefore(trace.refTimesUs, pollUs);
    if (refIndex < 0) {
      skippedNoReference += 1;
      continue;
    }
    const elapsedMs = pollUs / 1000;
    const scenarioIndex = clamp(Math.floor(elapsedMs / scenarioDurationMs), 0, scenarioCount - 1);
    const scenarioElapsedMs = elapsedMs - scenarioIndex * scenarioDurationMs;
    const movementCategory = classifyMovement(scenarioElapsedMs, intervalsByScenario[scenarioIndex] || []);
    const splitName = split.byScenario.get(scenarioIndex) || "unassigned";
    const schedulerIndex = refIndexAtOrBefore(trace.schedulerTimesUs, pollUs);
    const schedulerDelay = schedulerIndex >= 0 ? trace.schedulerDelayMs[schedulerIndex] : null;
    const recent = recentKinematics(trace, refIndex);
    anchors.push({
      loadCondition: trace.id,
      sourceZip: trace.sourceZip,
      anchorUs: pollUs,
      refIndex,
      lastObservedUs: trace.refTimesUs[refIndex],
      scenarioIndex,
      scenarioElapsedMs,
      split: splitName,
      movementCategory,
      schedulerDelayMs: schedulerDelay,
      schedulerDelayBin: schedulerDelayBin(schedulerDelay),
      recentSpeedPxPerSec: recent.speed,
      speedBin: speedBin(recent.speed),
      cache: Object.create(null),
    });
  }

  return {
    rows: anchors,
    summary: {
      pollAnchorsSeen: trace.pollTimesUs.length,
      anchorsBuilt: anchors.length,
      skippedNoReference,
      bySplit: countBy(anchors, (anchor) => anchor.split),
      byMovementCategory: countBy(anchors, (anchor) => anchor.movementCategory),
      bySchedulerDelayBin: countBy(anchors, (anchor) => anchor.schedulerDelayBin),
    },
  };
}

function countBy(items, getter) {
  const out = {};
  for (const item of items) {
    const key = getter(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function refIndexAtOrBefore(times, elapsedUs) {
  const right = lowerBound(times, elapsedUs);
  if (right < times.length && times[right] === elapsedUs) return right;
  return right - 1;
}

function interpolateReference(trace, targetUs) {
  const times = trace.refTimesUs;
  const right = lowerBound(times, targetUs);
  if (right < 0 || right >= times.length) return null;
  if (times[right] === targetUs) {
    return { x: trace.refX[right], y: trace.refY[right] };
  }
  if (right <= 0) return null;
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

function recentKinematics(trace, refIndex) {
  if (refIndex <= 0) return { vx: 0, vy: 0, speed: 0 };
  const t0 = trace.refTimesUs[refIndex - 1];
  const t1 = trace.refTimesUs[refIndex];
  const dt = (t1 - t0) / 1_000_000;
  if (dt <= 0) return { vx: 0, vy: 0, speed: 0 };
  const vx = (trace.refX[refIndex] - trace.refX[refIndex - 1]) / dt;
  const vy = (trace.refY[refIndex] - trace.refY[refIndex - 1]) / dt;
  return { vx, vy, speed: Math.sqrt(vx * vx + vy * vy) };
}

function fitLinearSamples(trace, refIndex, samples) {
  const start = Math.max(0, refIndex - samples + 1);
  const n = refIndex - start + 1;
  if (n < 2) return null;
  const anchorUs = trace.refTimesUs[refIndex];
  let st = 0;
  let stt = 0;
  let sx = 0;
  let sy = 0;
  let stx = 0;
  let sty = 0;
  for (let i = start; i <= refIndex; i += 1) {
    const t = (trace.refTimesUs[i] - anchorUs) / 1_000_000;
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
  if (Math.abs(denom) < 1e-12) return null;
  const vx = (n * stx - st * sx) / denom;
  const vy = (n * sty - st * sy) / denom;
  const x0 = (sx - vx * st) / n;
  const y0 = (sy - vy * st) / n;
  return { x0, y0, vx, vy };
}

function alphaBetaState(trace, refIndex, samples, alpha, beta) {
  const key = `ab:${samples}:${alpha}:${beta}`;
  const start = Math.max(0, refIndex - samples + 1);
  if (refIndex - start < 1) return null;
  let x = trace.refX[start];
  let y = trace.refY[start];
  let vx = 0;
  let vy = 0;
  if (start + 1 <= refIndex) {
    const dt0 = (trace.refTimesUs[start + 1] - trace.refTimesUs[start]) / 1_000_000;
    if (dt0 > 0) {
      vx = (trace.refX[start + 1] - trace.refX[start]) / dt0;
      vy = (trace.refY[start + 1] - trace.refY[start]) / dt0;
    }
  }
  let lastUs = trace.refTimesUs[start];
  for (let i = start + 1; i <= refIndex; i += 1) {
    const dt = (trace.refTimesUs[i] - lastUs) / 1_000_000;
    if (dt <= 0 || dt > 0.2) {
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
    x = px + alpha * rx;
    y = py + alpha * ry;
    vx += (beta * rx) / dt;
    vy += (beta * ry) / dt;
    lastUs = trace.refTimesUs[i];
  }
  return { key, x, y, vx, vy };
}

function predict(model, trace, anchor, horizonMs) {
  if (model.family === "hold_last") return predictConstant(trace, anchor);
  if (model.family === "last_two_constant_velocity") {
    return predictLastTwo(trace, anchor, horizonMs, model.params.capPx);
  }
  if (model.family === "least_squares_velocity") {
    return predictLeastSquares(trace, anchor, horizonMs, model.params.samples, model.params.capPx);
  }
  if (model.family === "constant_acceleration") {
    return predictAcceleration(trace, anchor, horizonMs, model.params.capPx);
  }
  if (model.family === "alpha_beta") {
    return predictAlphaBeta(trace, anchor, horizonMs, model.params);
  }
  if (model.family === "simple_speed_gate") {
    if (anchor.recentSpeedPxPerSec < model.params.stopSpeedPxPerSec) return predictConstant(trace, anchor);
    return predictLeastSquares(trace, anchor, horizonMs, 8, 64);
  }
  if (model.family === "script_category_gate") {
    if (anchor.movementCategory === "hold") return predictConstant(trace, anchor);
    if (anchor.movementCategory === "resume") return predictLastTwo(trace, anchor, horizonMs, 64);
    return predictLeastSquares(trace, anchor, horizonMs, 8, 64);
  }
  throw new Error(`Unsupported baseline family: ${model.family}`);
}

function targetDeltaSeconds(trace, anchor, horizonMs) {
  const targetUs = anchor.anchorUs + horizonMs * 1000;
  return (targetUs - trace.refTimesUs[anchor.refIndex]) / 1_000_000;
}

function predictConstant(trace, anchor) {
  return { x: trace.refX[anchor.refIndex], y: trace.refY[anchor.refIndex] };
}

function predictLastTwo(trace, anchor, horizonMs, capPx) {
  const refIndex = anchor.refIndex;
  if (refIndex <= 0) return predictConstant(trace, anchor);
  const dtHistory = (trace.refTimesUs[refIndex] - trace.refTimesUs[refIndex - 1]) / 1_000_000;
  if (dtHistory <= 0) return predictConstant(trace, anchor);
  const vx = (trace.refX[refIndex] - trace.refX[refIndex - 1]) / dtHistory;
  const vy = (trace.refY[refIndex] - trace.refY[refIndex - 1]) / dtHistory;
  const dt = targetDeltaSeconds(trace, anchor, horizonMs);
  let dx = vx * dt;
  let dy = vy * dt;
  ({ dx, dy } = clampVector(dx, dy, capPx));
  return { x: trace.refX[refIndex] + dx, y: trace.refY[refIndex] + dy };
}

function predictLeastSquares(trace, anchor, horizonMs, samples, capPx) {
  const cacheKey = `ls:${samples}`;
  let fit = anchor.cache[cacheKey];
  if (fit === undefined) {
    fit = fitLinearSamples(trace, anchor.refIndex, samples);
    anchor.cache[cacheKey] = fit;
  }
  if (!fit) return predictConstant(trace, anchor);
  const dt = targetDeltaSeconds(trace, anchor, horizonMs);
  let dx = (fit.x0 + fit.vx * dt) - trace.refX[anchor.refIndex];
  let dy = (fit.y0 + fit.vy * dt) - trace.refY[anchor.refIndex];
  ({ dx, dy } = clampVector(dx, dy, capPx));
  return { x: trace.refX[anchor.refIndex] + dx, y: trace.refY[anchor.refIndex] + dy };
}

function predictAcceleration(trace, anchor, horizonMs, capPx) {
  const i = anchor.refIndex;
  if (i < 2) return predictLastTwo(trace, anchor, horizonMs, capPx);
  const dt0 = (trace.refTimesUs[i - 1] - trace.refTimesUs[i - 2]) / 1_000_000;
  const dt1 = (trace.refTimesUs[i] - trace.refTimesUs[i - 1]) / 1_000_000;
  if (dt0 <= 0 || dt1 <= 0) return predictLastTwo(trace, anchor, horizonMs, capPx);
  const vx0 = (trace.refX[i - 1] - trace.refX[i - 2]) / dt0;
  const vy0 = (trace.refY[i - 1] - trace.refY[i - 2]) / dt0;
  const vx1 = (trace.refX[i] - trace.refX[i - 1]) / dt1;
  const vy1 = (trace.refY[i] - trace.refY[i - 1]) / dt1;
  const avgDt = Math.max(0.001, (dt0 + dt1) / 2);
  const ax = (vx1 - vx0) / avgDt;
  const ay = (vy1 - vy0) / avgDt;
  const dt = targetDeltaSeconds(trace, anchor, horizonMs);
  let dx = vx1 * dt + 0.5 * ax * dt * dt;
  let dy = vy1 * dt + 0.5 * ay * dt * dt;
  ({ dx, dy } = clampVector(dx, dy, capPx));
  return { x: trace.refX[i] + dx, y: trace.refY[i] + dy };
}

function predictAlphaBeta(trace, anchor, horizonMs, params) {
  const cacheKey = `ab:${params.samples}:${params.alpha}:${params.beta}`;
  let state = anchor.cache[cacheKey];
  if (state === undefined) {
    state = alphaBetaState(trace, anchor.refIndex, params.samples, params.alpha, params.beta);
    anchor.cache[cacheKey] = state;
  }
  if (!state) return predictConstant(trace, anchor);
  const dt = targetDeltaSeconds(trace, anchor, horizonMs);
  let dx = (state.x + state.vx * dt) - trace.refX[anchor.refIndex];
  let dy = (state.y + state.vy * dt) - trace.refY[anchor.refIndex];
  ({ dx, dy } = clampVector(dx, dy, params.capPx));
  return { x: trace.refX[anchor.refIndex] + dx, y: trace.refY[anchor.refIndex] + dy };
}

function createAccumulator() {
  return {
    count: 0,
    sum: 0,
    sumSquares: 0,
    max: 0,
    histogram: new Uint32Array(HISTOGRAM_BINS),
    regressions: Object.fromEntries(REGRESSION_THRESHOLDS_PX.map((threshold) => [`gt${threshold}px`, 0])),
  };
}

function addError(acc, error) {
  if (!Number.isFinite(error)) return;
  acc.count += 1;
  acc.sum += error;
  acc.sumSquares += error * error;
  if (error > acc.max) acc.max = error;
  const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(error / HISTOGRAM_BIN_PX)));
  acc.histogram[bin] += 1;
  for (const threshold of REGRESSION_THRESHOLDS_PX) {
    if (error > threshold) acc.regressions[`gt${threshold}px`] += 1;
  }
}

function histogramPercentile(histogram, count, p) {
  if (count <= 0) return null;
  const target = Math.max(1, Math.ceil(count * p));
  let cumulative = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= target) return i * HISTOGRAM_BIN_PX;
  }
  return HISTOGRAM_MAX_PX;
}

function finalizeAccumulator(acc) {
  if (!acc || acc.count === 0) {
    return {
      count: 0,
      mean: null,
      median: null,
      p95: null,
      max: null,
      rmse: null,
      regressionRates: Object.fromEntries(REGRESSION_THRESHOLDS_PX.map((threshold) => [`gt${threshold}px`, null])),
    };
  }
  return {
    count: acc.count,
    mean: round(acc.sum / acc.count),
    median: round(histogramPercentile(acc.histogram, acc.count, 0.5)),
    p95: round(histogramPercentile(acc.histogram, acc.count, 0.95)),
    max: round(acc.max),
    rmse: round(Math.sqrt(acc.sumSquares / acc.count)),
    regressionRates: Object.fromEntries(
      REGRESSION_THRESHOLDS_PX.map((threshold) => {
        const key = `gt${threshold}px`;
        return [key, round(acc.regressions[key] / acc.count, 6)];
      }),
    ),
  };
}

class ScoreStore {
  constructor() {
    this.maps = {
      overallScores: new Map(),
      perHorizonScores: new Map(),
      perSplitScores: new Map(),
      perLoadConditionScores: new Map(),
      perMovementCategoryScores: new Map(),
      perSchedulerDelayBinScores: new Map(),
      perSplitHorizonLoadScores: new Map(),
      perValidationTestCategoryHorizonScores: new Map(),
    };
  }

  add(section, keyParts, meta, error) {
    const key = metricKey(keyParts);
    let entry = this.maps[section].get(key);
    if (!entry) {
      entry = { ...meta, accumulator: createAccumulator() };
      this.maps[section].set(key, entry);
    }
    addError(entry.accumulator, error);
  }

  addObservation(model, trace, anchor, horizonMs, error) {
    const modelMeta = {
      modelId: model.id,
      modelFamily: model.family,
      productEligible: model.productEligible,
    };
    this.add("overallScores", [model.id], modelMeta, error);
    this.add("perHorizonScores", [model.id, horizonMs, trace.id], {
      ...modelMeta,
      horizonMs,
      loadCondition: trace.id,
    }, error);
    this.add("perSplitScores", [model.id, anchor.split, trace.id], {
      ...modelMeta,
      split: anchor.split,
      loadCondition: trace.id,
    }, error);
    this.add("perLoadConditionScores", [model.id, trace.id], {
      ...modelMeta,
      loadCondition: trace.id,
    }, error);
    this.add("perMovementCategoryScores", [model.id, anchor.movementCategory, trace.id], {
      ...modelMeta,
      movementCategory: anchor.movementCategory,
      loadCondition: trace.id,
    }, error);
    this.add("perSchedulerDelayBinScores", [model.id, anchor.schedulerDelayBin, trace.id], {
      ...modelMeta,
      schedulerDelayBin: anchor.schedulerDelayBin,
      loadCondition: trace.id,
    }, error);
    this.add("perSplitHorizonLoadScores", [model.id, anchor.split, horizonMs, trace.id], {
      ...modelMeta,
      split: anchor.split,
      horizonMs,
      loadCondition: trace.id,
    }, error);
    if (anchor.split === "validation" || anchor.split === "test") {
      this.add("perValidationTestCategoryHorizonScores", [
        model.id,
        anchor.split,
        trace.id,
        horizonMs,
        anchor.movementCategory,
      ], {
        ...modelMeta,
        split: anchor.split,
        loadCondition: trace.id,
        horizonMs,
        movementCategory: anchor.movementCategory,
      }, error);
    }
  }

  finalizeMap(name) {
    return [...this.maps[name].values()]
      .map((entry) => {
        const { accumulator, ...meta } = entry;
        return { ...meta, error: finalizeAccumulator(accumulator) };
      })
      .sort(scoreSort);
  }

  finalize() {
    return Object.fromEntries(Object.keys(this.maps).map((name) => [name, this.finalizeMap(name)]));
  }
}

function scoreSort(a, b) {
  return String(a.modelId).localeCompare(String(b.modelId))
    || String(a.loadCondition || "").localeCompare(String(b.loadCondition || ""))
    || String(a.split || "").localeCompare(String(b.split || ""))
    || Number(a.horizonMs || 0) - Number(b.horizonMs || 0)
    || String(a.movementCategory || "").localeCompare(String(b.movementCategory || ""))
    || String(a.schedulerDelayBin || "").localeCompare(String(b.schedulerDelayBin || ""));
}

function evaluateTraces(traces) {
  const store = new ScoreStore();
  const evaluationSummary = {};

  for (const trace of traces) {
    const summary = {
      loadCondition: trace.id,
      sourceZip: trace.sourceZip,
      traceRows: trace.csvRows,
      referencePollRows: trace.refTimesUs.length,
      pollAnchors: trace.pollTimesUs.length,
      schedulerDelayRows: trace.schedulerTimesUs.length,
      anchors: trace.anchors.summary,
      labelsByHorizon: Object.fromEntries(HORIZONS_MS.map((horizon) => [String(horizon), 0])),
      labelsMissingByHorizon: Object.fromEntries(HORIZONS_MS.map((horizon) => [String(horizon), 0])),
    };

    for (const anchor of trace.anchors.rows) {
      anchor.cache = Object.create(null);
      for (const horizonMs of HORIZONS_MS) {
        const target = interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) {
          summary.labelsMissingByHorizon[String(horizonMs)] += 1;
          continue;
        }
        summary.labelsByHorizon[String(horizonMs)] += 1;
        for (const model of BASELINES) {
          const prediction = predict(model, trace, anchor, horizonMs);
          const error = distance(prediction.x, prediction.y, target.x, target.y);
          store.addObservation(model, trace, anchor, horizonMs, error);
        }
      }
    }

    evaluationSummary[trace.id] = summary;
  }

  return { sections: store.finalize(), evaluationSummary };
}

function chooseBest(scores) {
  const baselinesById = new Map(BASELINES.map((baseline) => [baseline.id, baseline]));
  const bestBySplitHorizonLoad = bestBySegment(
    scores.perSplitHorizonLoadScores.filter((row) => row.split === "validation" || row.split === "test"),
    (row) => metricKey([row.split, row.loadCondition, row.horizonMs]),
    baselinesById,
  );
  const bestByValidationCategoryHorizon = bestBySegment(
    scores.perValidationTestCategoryHorizonScores.filter((row) => row.split === "validation"),
    (row) => metricKey([row.loadCondition, row.horizonMs, row.movementCategory]),
    baselinesById,
  );
  const validationOverall = bestBySegment(
    scores.perSplitScores.filter((row) => row.split === "validation"),
    (row) => metricKey([row.loadCondition]),
    baselinesById,
  );
  return {
    rankingMetric: "lowest p95 error, then lowest mean error",
    bestBySplitHorizonLoad,
    bestByValidationCategoryHorizon,
    validationOverall,
  };
}

function bestBySegment(rows, segmentKeyFn, baselinesById) {
  const segments = new Map();
  for (const row of rows) {
    const key = segmentKeyFn(row);
    let segment = segments.get(key);
    if (!segment) {
      segment = { segmentKey: key, all: null, productEligible: null };
      segments.set(key, segment);
    }
    if (isBetter(row, segment.all)) segment.all = compactBest(row);
    if (baselinesById.get(row.modelId)?.productEligible && isBetter(row, segment.productEligible)) {
      segment.productEligible = compactBest(row);
    }
  }
  return [...segments.values()].sort((a, b) => a.segmentKey.localeCompare(b.segmentKey));
}

function isBetter(candidate, incumbent) {
  if (!incumbent) return true;
  const cp95 = (candidate.error?.p95 ?? candidate.p95) ?? Infinity;
  const ip95 = (incumbent.error?.p95 ?? incumbent.p95) ?? Infinity;
  if (cp95 !== ip95) return cp95 < ip95;
  const cmean = (candidate.error?.mean ?? candidate.mean) ?? Infinity;
  const imean = (incumbent.error?.mean ?? incumbent.mean) ?? Infinity;
  return cmean < imean;
}

function compactBest(row) {
  return {
    modelId: row.modelId,
    productEligible: row.productEligible,
    split: row.split,
    loadCondition: row.loadCondition,
    horizonMs: row.horizonMs,
    movementCategory: row.movementCategory,
    schedulerDelayBin: row.schedulerDelayBin,
    count: row.error.count,
    mean: row.error.mean,
    median: row.error.median,
    p95: row.error.p95,
    max: row.error.max,
    regressionRates: row.error.regressionRates,
  };
}

function table(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, col) => Math.max(...all.map((row) => String(row[col] ?? "").length)));
  const format = (row) => `| ${row.map((cell, col) => String(cell ?? "").padEnd(widths[col])).join(" | ")} |`;
  return [
    format(headers),
    format(headers.map((_, col) => "-".repeat(widths[col]))),
    ...rows.map(format),
  ].join("\n");
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (typeof value === "number") return String(round(value, digits));
  return String(value);
}

function findScore(scores, modelId, split, loadCondition, horizonMs) {
  return scores.perSplitHorizonLoadScores.find((row) => (
    row.modelId === modelId
    && row.split === split
    && row.loadCondition === loadCondition
    && Number(row.horizonMs) === Number(horizonMs)
  ));
}

function findCategoryScore(scores, modelId, split, loadCondition, category) {
  const rows = scores.perValidationTestCategoryHorizonScores.filter((row) => (
    row.modelId === modelId
    && row.split === split
    && row.loadCondition === loadCondition
    && row.movementCategory === category
  ));
  return mergeFinalizedRows(rows);
}

function mergeFinalizedRows(rows) {
  if (rows.length === 0) return null;
  const acc = createAccumulator();
  // Reconstructing exact histograms is not possible from finalized rows; use count-weighted means and max for report-only summary.
  let count = 0;
  let weightedMean = 0;
  let max = 0;
  let p95Weighted = 0;
  for (const row of rows) {
    const c = row.error.count || 0;
    count += c;
    weightedMean += (row.error.mean || 0) * c;
    p95Weighted += (row.error.p95 || 0) * c;
    max = Math.max(max, row.error.max || 0);
  }
  acc.count = count;
  return {
    count,
    mean: count ? round(weightedMean / count) : null,
    p95: count ? round(p95Weighted / count) : null,
    max: round(max),
  };
}

function renderReport(result) {
  const scores = result.scores;
  const selectedModel = result.nextStepRecommendation.primaryModelCandidate;
  const horizonRows = [];
  for (const split of ["validation", "test"]) {
    for (const load of ["normal", "stress"]) {
      for (const horizon of [0, 16.67, 33.33, 50]) {
        const row = findScore(scores, selectedModel, split, load, horizon);
        horizonRows.push([
          selectedModel,
          split,
          load,
          horizon,
          row ? row.error.count : 0,
          row ? fmt(row.error.mean) : "n/a",
          row ? fmt(row.error.median) : "n/a",
          row ? fmt(row.error.p95) : "n/a",
          row ? fmt(row.error.regressionRates.gt5px, 5) : "n/a",
          row ? fmt(row.error.regressionRates.gt10px, 5) : "n/a",
        ]);
      }
    }
  }

  const baselineRows = BASELINES.map((model) => [
    model.id,
    model.family,
    model.productEligible ? "yes" : "no",
    model.description,
  ]);

  const sourceRows = Object.values(result.evaluationSummary).map((item) => [
    item.loadCondition,
    item.sourceZip,
    item.traceRows,
    item.referencePollRows,
    item.pollAnchors,
    item.schedulerDelayRows,
    item.anchors.bySplit.validation || 0,
    item.anchors.bySplit.test || 0,
  ]);

  const bestRows = result.bestModelPerSegment.validationOverall.map((segment) => [
    segment.segmentKey,
    segment.productEligible?.modelId || "n/a",
    fmt(segment.productEligible?.mean),
    fmt(segment.productEligible?.p95),
    segment.all?.modelId || "n/a",
    fmt(segment.all?.p95),
  ]);
  const rankingRows = result.nextStepRecommendation.rankedValidationProductCandidates.slice(0, 6).map((item, index) => [
    index + 1,
    item.modelId,
    item.count,
    fmt(item.validationMean),
    fmt(item.validationP95),
  ]);

  const categoryRows = [];
  for (const load of ["normal", "stress"]) {
    for (const split of ["validation", "test"]) {
      for (const category of ["moving", "hold", "resume"]) {
        const row = findCategoryScore(scores, selectedModel, split, load, category);
        categoryRows.push([
          selectedModel,
          split,
          load,
          category,
          row ? row.count : 0,
          row ? fmt(row.mean) : "n/a",
          row ? fmt(row.p95) : "n/a",
          row ? fmt(row.max) : "n/a",
        ]);
      }
    }
  }

  return `# Step 2 Baseline Replay

## Scope

This step evaluates deterministic, causal baselines only. It reads the normal and stress Motion Lab ZIP files from the repository root, keeps all work on CPU, does not use GPU, and writes only aggregate Markdown/JSON artifacts.

The prediction anchor is each product \`poll\` event. Input history is limited to \`referencePoll\` rows at or before the anchor time. Future referencePoll interpolation is used only as the evaluation label.

## Sources And Splits

${table(["load", "zip", "trace rows", "reference rows", "poll anchors", "sched rows", "val anchors", "test anchors"], sourceRows)}

The Step 1 scenario split is reused without sample randomization. The 8-scenario sanity ZIP is parser smoke only and is excluded from model selection.

## Baselines

${table(["id", "family", "product eligible", "description"], baselineRows)}

## Validation Overall Best

${table(["load segment", "best product model", "mean px", "p95 px", "best incl oracle", "oracle/all p95"], bestRows)}

## Product Candidate Ranking

${table(["rank", "model", "validation count", "mean px", "weighted p95 px"], rankingRows)}

Primary Step 3 candidate from this run: \`${selectedModel}\`.

## Primary Candidate Scores

${table(["model", "split", "load", "horizon ms", "count", "mean px", "median px", "p95 px", ">5px", ">10px"], horizonRows)}

## Category Breakdown For Primary Candidate

${table(["model", "split", "load", "category", "count", "mean px", "p95 px", "max px"], categoryRows)}

## Observations

- Constant position is a strong baseline for hold and near-zero horizons.
- Velocity extrapolation is necessary for moving/resume categories, but raw last-two velocity has larger outlier risk.
- Stress must stay separate from normal: scheduler delay max and poll jitter are larger under stress, and aggregate-only reporting hides that difference.
- The category oracle is included only as an offline ceiling; product-candidate ranking excludes it.

## Step 3 Recommendation

Use \`${selectedModel}\` as the first product-safe teacher/baseline target, then test a compact FSMN or tiny MLP that takes causal speed, recent LS velocity residuals, movement-state proxies, horizon, and scheduler-delay bin. Keep the Step 1 scenario split fixed.
`;
}

function renderNotes(result) {
  return `# Step 2 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v11\\scripts\\run-step2-baselines.js
\`\`\`

## Evaluation Contract

- Anchor: product \`poll\` rows from \`trace.csv\`.
- History: only \`referencePoll\` rows with elapsed time <= anchor time.
- Label: interpolated \`referencePoll\` position at anchor + horizon.
- Horizons: ${HORIZONS_MS.join(", ")} ms.
- Split: scenario-level Step 1 train/validation/test.
- Sanity package: parser smoke only, not model selection.

## Leakage Notes

No future point is used by a predictor. The only future lookup is the label interpolation after the prediction is produced. Baselines that use \`movementCategory\` are marked non-product-eligible when the category is script-derived oracle information.

## Next Step

For Step 3, start with the best product-eligible validation model from \`scores.json\`, then add a small learned residual/gate and compare against the same validation/test score tables.
`;
}

function buildNextStepRecommendation(scores, bestModelPerSegment) {
  const productEligible = new Set(BASELINES.filter((baseline) => baseline.productEligible).map((baseline) => baseline.id));
  const candidates = scores.perSplitScores
    .filter((row) => row.split === "validation" && productEligible.has(row.modelId));
  const byModel = new Map();
  for (const candidate of candidates) {
    const item = byModel.get(candidate.modelId) || { modelId: candidate.modelId, weightedP95: 0, weightedMean: 0, count: 0 };
    const count = candidate.error.count || 0;
    item.weightedP95 += (candidate.error.p95 || 0) * count;
    item.weightedMean += (candidate.error.mean || 0) * count;
    item.count += count;
    byModel.set(candidate.modelId, item);
  }
  const ranked = [...byModel.values()]
    .map((item) => ({
      modelId: item.modelId,
      validationMean: item.count ? round(item.weightedMean / item.count) : null,
      validationP95: item.count ? round(item.weightedP95 / item.count) : null,
      count: item.count,
    }))
    .sort((a, b) => (a.validationP95 ?? Infinity) - (b.validationP95 ?? Infinity)
      || (a.validationMean ?? Infinity) - (b.validationMean ?? Infinity));
  const primary = ranked[0]?.modelId || "constant_position";
  return {
    primaryModelCandidate: primary,
    rankedValidationProductCandidates: ranked,
    step3: [
      "Keep scenario split fixed.",
      "Use deterministic baseline residuals as labels/features.",
      "Start with compact product-eligible gates before any heavier model.",
      "Report normal and stress separately for validation and test.",
    ],
  };
}

function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.outDir);

  const step1Scores = JSON.parse(fs.readFileSync(args.step1Scores, "utf8"));
  const split = parseSplit(step1Scores);
  const traces = PACKAGES.map((target) => loadTracePackage(args.root, target, split));
  const { sections, evaluationSummary } = evaluateTraces(traces);
  const bestModelPerSegment = chooseBest(sections);
  const nextStepRecommendation = buildNextStepRecommendation(sections, bestModelPerSegment);
  const sanitySmoke = args.includeSanitySmoke ? loadSanitySmoke(args.root) : null;

  const result = {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUtc: new Date().toISOString(),
    constraints: {
      gpuUsed: false,
      trainingRun: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
    },
    sourceFiles: PACKAGES.map((item) => ({ id: item.id, label: item.label, file: item.file })),
    sanitySmoke,
    splitDefinition: {
      method: split.method,
      ratio: split.ratio,
      counts: split.counts,
      train: split.train,
      validation: split.validation,
      test: split.test,
    },
    evaluationDesign: {
      anchor: "trace.csv event=poll",
      causalHistory: "referencePoll rows with elapsedMicroseconds <= anchor elapsedMicroseconds",
      label: "interpolated referencePoll at anchor + horizon",
      horizonsMs: HORIZONS_MS,
      schedulerDelayBins: SCHEDULER_DELAY_BINS,
      regressionThresholdsPx: REGRESSION_THRESHOLDS_PX,
      histogramApproximation: {
        binPixels: HISTOGRAM_BIN_PX,
        maxPixelsBeforeOverflowBin: HISTOGRAM_MAX_PX,
      },
    },
    baselineList: BASELINES,
    evaluationSummary,
    scores: sections,
    bestModelPerSegment,
    nextStepRecommendation,
  };

  fs.writeFileSync(path.join(args.outDir, "scores.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(args.outDir, "report.md"), renderReport(result), "utf8");
  fs.writeFileSync(path.join(args.outDir, "notes.md"), renderNotes(result), "utf8");

  process.stdout.write(`Wrote:
${path.relative(args.root, path.join(args.outDir, "report.md")).replaceAll(path.sep, "/")}
${path.relative(args.root, path.join(args.outDir, "scores.json")).replaceAll(path.sep, "/")}
${path.relative(args.root, path.join(args.outDir, "notes.md")).replaceAll(path.sep, "/")}
`);
}

main();
