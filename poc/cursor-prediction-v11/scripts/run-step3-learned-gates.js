#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SCHEMA_VERSION = "cursor-prediction-v11-step3-learned-gates/1";
const HORIZONS_MS = [0, 8, 16.67, 25, 33.33, 50];
const REGRESSION_THRESHOLDS_PX = [1, 2, 5, 10];
const HISTOGRAM_BIN_PX = 0.25;
const HISTOGRAM_MAX_PX = 1024;
const HISTOGRAM_BINS = Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 1;
const RIDGE_LAMBDAS = [0.1, 1, 10, 100];

const PACKAGES = [
  { id: "normal", label: "normal load", file: "cursor-mirror-motion-recording-20260503-212556.zip" },
  { id: "stress", label: "stress load", file: "cursor-mirror-motion-recording-20260503-215632.zip" },
];

const SCHEDULER_DELAY_BINS = [
  { id: "<=1ms", min: -Infinity, max: 1 },
  { id: "1-4ms", min: 1, max: 4 },
  { id: "4-8ms", min: 4, max: 8 },
  { id: ">8ms", min: 8, max: Infinity },
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

const GATE_CANDIDATES = [];
for (const stopSpeed of [15, 25, 50, 100]) {
  for (const stillnessRatio of [0.5, 0.75, 0.9]) {
    for (const gapMaxMs of [12, 24]) {
      GATE_CANDIDATES.push({
        id: `gate_stop${stopSpeed}_still${String(stillnessRatio).replace(".", "p")}_gap${gapMaxMs}`,
        stopSpeed,
        stillnessRatio,
        gapMaxMs,
      });
    }
  }
}

const FEATURE_NAMES = [
  "bias",
  "horizonMs/50",
  "horizonMs^2/2500",
  "anchorGapMs/16",
  "schedulerDelayMs/8",
  "historyMeanGapMs/8",
  "historyMaxGapMs/24",
  "historyGapStdMs/8",
  "recentSpeed/2000",
  "ls12Speed/2000",
  "ls8Speed/2000",
  "last2Speed/2000",
  "acceleration/50000",
  "stillnessRatio",
  "nearZeroRatio",
  "pathEfficiency",
  "baselineDx/64",
  "baselineDy/64",
  "ls12DxOverHorizon/64",
  "ls12DyOverHorizon/64",
  "ls8DxOverHorizon/64",
  "ls8DyOverHorizon/64",
  "last2DxOverHorizon/64",
  "last2DyOverHorizon/64",
  "currentXNormalized",
  "currentYNormalized",
];

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  const outDir = path.resolve(scriptDir, "..", "step-3-learned-gates");
  const step1Scores = path.resolve(scriptDir, "..", "step-1-data-audit", "scores.json");
  const args = { root, outDir, step1Scores };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--step1-scores") args.step1Scores = path.resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v11\\scripts\\run-step3-learned-gates.js

Options:
  --root <path>           repository root containing source ZIPs
  --out-dir <path>        output directory for Step 3 artifacts
  --step1-scores <path>   Step 1 scores.json with fixed split
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

function parseCsvText(buffer, onRow) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  let firstNewline = text.indexOf("\n");
  if (firstNewline < 0) firstNewline = text.length;
  const headerLine = text.slice(0, firstNewline).replace(/\r$/, "");
  const header = headerLine.length > 0 ? headerLine.split(",") : [];
  const column = Object.fromEntries(header.map((name, index) => [name, index]));

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

function refIndexAtOrBefore(times, elapsedUs) {
  const right = lowerBound(times, elapsedUs);
  if (right < times.length && times[right] === elapsedUs) return right;
  return right - 1;
}

function metricKey(parts) {
  return parts.map((part) => String(part)).join("|");
}

function parseSplit(step1Scores) {
  const split = step1Scores.splitProposal;
  const byScenario = new Map();
  for (const index of split.train) byScenario.set(index, "train");
  for (const index of split.validation) byScenario.set(index, "validation");
  for (const index of split.test) byScenario.set(index, "test");
  return { ...split, byScenario };
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
  return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
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
  for (const bin of SPEED_BINS) {
    if (speed >= bin.min && speed < bin.max) return bin.id;
  }
  return "missing";
}

function loadTracePackage(root, target, split) {
  const zipPath = path.join(root, target.file);
  const opened = openZip(zipPath);
  const metadata = jsonEntry(opened, "metadata.json");
  const motionMetadata = jsonEntry(opened, "motion-metadata.json");
  const script = jsonEntry(opened, "motion-script.json");
  const scenarios = Array.isArray(script.Scenarios) ? script.Scenarios : [script];
  const intervalsByScenario = scenarios.map((scenario) => holdIntervals(scenario));
  const trace = {
    id: target.id,
    label: target.label,
    sourceZip: target.file,
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
    screen: {
      x: Number(metadata.VirtualScreenX) || -2560,
      y: Number(metadata.VirtualScreenY) || 0,
      width: Number(metadata.VirtualScreenWidth) || 7680,
      height: Number(metadata.VirtualScreenHeight) || 1440,
    },
  };
  const stopwatchFrequency = Number(metadata.StopwatchFrequency) || 10000000;
  parseCsvText(readZipEntry(opened, "trace.csv"), (parts, rowIndex, column) => {
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
    } else if (event === "poll") {
      trace.pollTimesUs.push(elapsedUs);
    } else if (event === "runtimeSchedulerPoll") {
      const planned = numberOrNull(parts[column.runtimeSchedulerPlannedTickTicks]);
      const actual = numberOrNull(parts[column.runtimeSchedulerActualTickTicks]);
      if (Number.isFinite(planned) && Number.isFinite(actual)) {
        trace.schedulerTimesUs.push(elapsedUs);
        trace.schedulerDelayMs.push(((actual - planned) / stopwatchFrequency) * 1000);
      }
    }
  });
  trace.anchors = buildAnchors(trace, motionMetadata, intervalsByScenario, split);
  return trace;
}

function buildAnchors(trace, motionMetadata, intervalsByScenario, split) {
  const scenarioDurationMs = Number(motionMetadata.ScenarioDurationMilliseconds) || 12000;
  const scenarioCount = Number(motionMetadata.ScenarioCount) || intervalsByScenario.length || 1;
  const rows = [];
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
    const schedulerIndex = refIndexAtOrBefore(trace.schedulerTimesUs, pollUs);
    const schedulerDelayMs = schedulerIndex >= 0 ? trace.schedulerDelayMs[schedulerIndex] : null;
    const recent = recentKinematics(trace, refIndex);
    rows.push({
      loadCondition: trace.id,
      sourceZip: trace.sourceZip,
      anchorUs: pollUs,
      refIndex,
      lastObservedUs: trace.refTimesUs[refIndex],
      scenarioIndex,
      scenarioElapsedMs,
      split: split.byScenario.get(scenarioIndex) || "unassigned",
      movementCategory: classifyMovement(scenarioElapsedMs, intervalsByScenario[scenarioIndex] || []),
      schedulerDelayMs,
      schedulerDelayBin: schedulerDelayBin(schedulerDelayMs),
      recentSpeedPxPerSec: recent.speed,
      speedBin: speedBin(recent.speed),
      cache: Object.create(null),
    });
  }
  return {
    rows,
    summary: {
      pollAnchorsSeen: trace.pollTimesUs.length,
      anchorsBuilt: rows.length,
      skippedNoReference,
      bySplit: countBy(rows, (row) => row.split),
      byMovementCategory: countBy(rows, (row) => row.movementCategory),
      bySchedulerDelayBin: countBy(rows, (row) => row.schedulerDelayBin),
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

function interpolateReference(trace, targetUs) {
  const times = trace.refTimesUs;
  const right = lowerBound(times, targetUs);
  if (right < times.length && times[right] === targetUs) {
    return { x: trace.refX[right], y: trace.refY[right] };
  }
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
  return { x0, y0, vx, vy, speed: Math.sqrt(vx * vx + vy * vy) };
}

function targetDeltaSeconds(trace, anchor, horizonMs) {
  return ((anchor.anchorUs + horizonMs * 1000) - trace.refTimesUs[anchor.refIndex]) / 1_000_000;
}

function predictConstant(trace, anchor) {
  return { x: trace.refX[anchor.refIndex], y: trace.refY[anchor.refIndex] };
}

function predictLastTwo(trace, anchor, horizonMs, capPx) {
  const i = anchor.refIndex;
  if (i <= 0) return predictConstant(trace, anchor);
  const dtHistory = (trace.refTimesUs[i] - trace.refTimesUs[i - 1]) / 1_000_000;
  if (dtHistory <= 0) return predictConstant(trace, anchor);
  const vx = (trace.refX[i] - trace.refX[i - 1]) / dtHistory;
  const vy = (trace.refY[i] - trace.refY[i - 1]) / dtHistory;
  const dt = targetDeltaSeconds(trace, anchor, horizonMs);
  let dx = vx * dt;
  let dy = vy * dt;
  ({ dx, dy } = clampVector(dx, dy, capPx));
  return { x: trace.refX[i] + dx, y: trace.refY[i] + dy };
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

function historyStats(trace, refIndex) {
  const cacheKey = "historyStats";
  const anchor = arguments[2];
  if (anchor && anchor.cache[cacheKey]) return anchor.cache[cacheKey];
  const start = Math.max(0, refIndex - 11);
  const gaps = [];
  const moves = [];
  let path = 0;
  let net = 0;
  for (let i = start + 1; i <= refIndex; i += 1) {
    const gapMs = (trace.refTimesUs[i] - trace.refTimesUs[i - 1]) / 1000;
    const move = distance(trace.refX[i], trace.refY[i], trace.refX[i - 1], trace.refY[i - 1]);
    gaps.push(gapMs);
    moves.push(move);
    path += move;
  }
  if (refIndex > start) {
    net = distance(trace.refX[refIndex], trace.refY[refIndex], trace.refX[start], trace.refY[start]);
  }
  const gapMean = mean(gaps);
  const gapStd = stddev(gaps, gapMean);
  const gapMax = gaps.length ? Math.max(...gaps) : 0;
  const stillnessRatio = moves.length ? moves.filter((value) => value <= 0.5).length / moves.length : 1;
  const nearZeroRatio = moves.length ? moves.filter((value) => value <= 1.5).length / moves.length : 1;
  const result = {
    gapMean,
    gapStd,
    gapMax,
    stillnessRatio,
    nearZeroRatio,
    pathEfficiency: path > 0 ? net / path : 0,
  };
  if (anchor) anchor.cache[cacheKey] = result;
  return result;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values, avg) {
  if (values.length <= 1) return 0;
  let sum = 0;
  for (const value of values) sum += (value - avg) * (value - avg);
  return Math.sqrt(sum / values.length);
}

function accelerationEstimate(trace, refIndex) {
  if (refIndex < 2) return 0;
  const dt0 = (trace.refTimesUs[refIndex - 1] - trace.refTimesUs[refIndex - 2]) / 1_000_000;
  const dt1 = (trace.refTimesUs[refIndex] - trace.refTimesUs[refIndex - 1]) / 1_000_000;
  if (dt0 <= 0 || dt1 <= 0) return 0;
  const vx0 = (trace.refX[refIndex - 1] - trace.refX[refIndex - 2]) / dt0;
  const vy0 = (trace.refY[refIndex - 1] - trace.refY[refIndex - 2]) / dt0;
  const vx1 = (trace.refX[refIndex] - trace.refX[refIndex - 1]) / dt1;
  const vy1 = (trace.refY[refIndex] - trace.refY[refIndex - 1]) / dt1;
  const dt = Math.max(0.001, (dt0 + dt1) / 2);
  return distance(vx0, vy0, vx1, vy1) / dt;
}

function featureVector(trace, anchor, horizonMs, baselinePred) {
  const i = anchor.refIndex;
  const stats = historyStats(trace, i, anchor);
  const ls12 = anchor.cache["ls:12"] || fitLinearSamples(trace, i, 12);
  anchor.cache["ls:12"] = ls12;
  const ls8 = anchor.cache["ls:8"] || fitLinearSamples(trace, i, 8);
  anchor.cache["ls:8"] = ls8;
  const recent = recentKinematics(trace, i);
  const currentX = trace.refX[i];
  const currentY = trace.refY[i];
  const dtTarget = targetDeltaSeconds(trace, anchor, horizonMs);
  const schedulerDelay = Number.isFinite(anchor.schedulerDelayMs) ? anchor.schedulerDelayMs : 0;
  const accel = accelerationEstimate(trace, i);
  const width = Math.max(1, trace.screen.width);
  const height = Math.max(1, trace.screen.height);
  return [
    1,
    horizonMs / 50,
    (horizonMs * horizonMs) / 2500,
    ((anchor.anchorUs - trace.refTimesUs[i]) / 1000) / 16,
    clamp(schedulerDelay, -4, 32) / 8,
    stats.gapMean / 8,
    stats.gapMax / 24,
    stats.gapStd / 8,
    recent.speed / 2000,
    (ls12?.speed || 0) / 2000,
    (ls8?.speed || 0) / 2000,
    recent.speed / 2000,
    accel / 50000,
    stats.stillnessRatio,
    stats.nearZeroRatio,
    stats.pathEfficiency,
    (baselinePred.x - currentX) / 64,
    (baselinePred.y - currentY) / 64,
    ((ls12?.vx || 0) * dtTarget) / 64,
    ((ls12?.vy || 0) * dtTarget) / 64,
    ((ls8?.vx || 0) * dtTarget) / 64,
    ((ls8?.vy || 0) * dtTarget) / 64,
    (recent.vx * dtTarget) / 64,
    (recent.vy * dtTarget) / 64,
    (currentX - trace.screen.x) / width,
    (currentY - trace.screen.y) / height,
  ];
}

class NormalEquation {
  constructor(dimension) {
    this.dimension = dimension;
    this.xtx = new Float64Array(dimension * dimension);
    this.xtyX = new Float64Array(dimension);
    this.xtyY = new Float64Array(dimension);
    this.count = 0;
  }

  add(features, residualX, residualY) {
    const d = this.dimension;
    for (let i = 0; i < d; i += 1) {
      const fi = features[i];
      this.xtyX[i] += fi * residualX;
      this.xtyY[i] += fi * residualY;
      const base = i * d;
      for (let j = 0; j <= i; j += 1) {
        this.xtx[base + j] += fi * features[j];
      }
    }
    this.count += 1;
  }

  solve(lambda) {
    return {
      count: this.count,
      lambda,
      weightsX: solveSymmetric(this.xtx, this.xtyX, this.dimension, lambda),
      weightsY: solveSymmetric(this.xtx, this.xtyY, this.dimension, lambda),
    };
  }
}

function solveSymmetric(lowerTriangular, rhs, dimension, lambda) {
  const a = new Array(dimension);
  for (let i = 0; i < dimension; i += 1) {
    a[i] = new Float64Array(dimension + 1);
  }
  for (let i = 0; i < dimension; i += 1) {
    for (let j = 0; j < dimension; j += 1) {
      const value = i >= j
        ? lowerTriangular[i * dimension + j]
        : lowerTriangular[j * dimension + i];
      a[i][j] = value + (i === j ? lambda : 0);
    }
    a[i][dimension] = rhs[i];
  }
  for (let col = 0; col < dimension; col += 1) {
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let row = col + 1; row < dimension; row += 1) {
      const value = Math.abs(a[row][col]);
      if (value > best) {
        best = value;
        pivot = row;
      }
    }
    if (best < 1e-12) continue;
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    const pivotValue = a[col][col];
    for (let j = col; j <= dimension; j += 1) a[col][j] /= pivotValue;
    for (let row = 0; row < dimension; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= dimension; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return Array.from({ length: dimension }, (_, i) => a[i][dimension]);
}

function dot(weights, features) {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) sum += weights[i] * features[i];
  return sum;
}

class PiecewiseResidual {
  constructor() {
    this.cells = new Map();
  }

  add(key, residualX, residualY) {
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { count: 0, sumX: 0, sumY: 0 };
      this.cells.set(key, cell);
    }
    cell.count += 1;
    cell.sumX += residualX;
    cell.sumY += residualY;
  }

  finalize() {
    const out = new Map();
    for (const [key, cell] of this.cells.entries()) {
      out.set(key, {
        count: cell.count,
        dx: cell.count ? cell.sumX / cell.count : 0,
        dy: cell.count ? cell.sumY / cell.count : 0,
      });
    }
    return out;
  }
}

function trainModels(traces) {
  const dimension = FEATURE_NAMES.length;
  const globalEquation = new NormalEquation(dimension);
  const horizonEquations = new Map(HORIZONS_MS.map((horizon) => [String(horizon), new NormalEquation(dimension)]));
  const piecewise = new PiecewiseResidual();
  const gateTrainAccs = new Map(GATE_CANDIDATES.map((candidate) => [candidate.id, createAccumulator()]));
  const gateValidationAccs = new Map(GATE_CANDIDATES.map((candidate) => [candidate.id, createAccumulator()]));
  const trainingSummary = {
    trainExamples: 0,
    validationExamplesForSelection: 0,
    labelsMissing: 0,
  };

  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      anchor.cache = Object.create(null);
      if (anchor.split !== "train" && anchor.split !== "validation") continue;
      for (const horizonMs of HORIZONS_MS) {
        const target = interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) {
          trainingSummary.labelsMissing += 1;
          continue;
        }
        const baseline = predictLeastSquares(trace, anchor, horizonMs, 12, 64);
        const residualX = target.x - baseline.x;
        const residualY = target.y - baseline.y;
        if (anchor.split === "train") {
          const features = featureVector(trace, anchor, horizonMs, baseline);
          globalEquation.add(features, residualX, residualY);
          horizonEquations.get(String(horizonMs)).add(features, residualX, residualY);
          piecewise.add(piecewiseKey(anchor, horizonMs), residualX, residualY);
          trainingSummary.trainExamples += 1;
        } else {
          trainingSummary.validationExamplesForSelection += 1;
        }
        if (anchor.split === "train" || anchor.split === "validation") {
          for (const candidate of GATE_CANDIDATES) {
            const pred = predictGateCandidate(trace, anchor, horizonMs, candidate);
            const err = distance(pred.x, pred.y, target.x, target.y);
            const accs = anchor.split === "train" ? gateTrainAccs : gateValidationAccs;
            addError(accs.get(candidate.id), err);
          }
        }
      }
    }
  }

  const ridgeGlobalCandidates = RIDGE_LAMBDAS.map((lambda) => ({
    id: `ridge_residual_linear_lambda${lambda}`,
    lambda,
    coefficients: globalEquation.solve(lambda),
  }));
  const ridgeHorizonCandidates = RIDGE_LAMBDAS.map((lambda) => ({
    id: `ridge_residual_by_horizon_lambda${lambda}`,
    lambda,
    coefficientsByHorizon: Object.fromEntries(
      [...horizonEquations.entries()].map(([horizon, equation]) => [horizon, equation.solve(lambda)]),
    ),
  }));
  const piecewiseModel = {
    id: "piecewise_speed_horizon_residual",
    cells: piecewise.finalize(),
  };

  const selectedGate = selectBestGate(gateValidationAccs);
  return {
    trainingSummary,
    globalEquationCount: globalEquation.count,
    horizonEquationCounts: Object.fromEntries([...horizonEquations.entries()].map(([h, eq]) => [h, eq.count])),
    ridgeGlobalCandidates,
    ridgeHorizonCandidates,
    piecewiseModel,
    gateSelection: {
      candidateCount: GATE_CANDIDATES.length,
      selected: selectedGate,
      trainTop5: topGateTable(gateTrainAccs),
      validationTop5: topGateTable(gateValidationAccs),
    },
  };
}

function piecewiseKey(anchor, horizonMs) {
  return `${horizonMs}|${anchor.speedBin}|${anchor.schedulerDelayBin}`;
}

function selectBestGate(validationAccs) {
  const rows = topGateTable(validationAccs);
  const selected = rows[0];
  return {
    ...selected,
    params: GATE_CANDIDATES.find((candidate) => candidate.id === selected.id),
  };
}

function topGateTable(accs) {
  return [...accs.entries()]
    .map(([id, acc]) => ({ id, error: finalizeAccumulator(acc) }))
    .sort((a, b) => (a.error.p95 ?? Infinity) - (b.error.p95 ?? Infinity)
      || (a.error.mean ?? Infinity) - (b.error.mean ?? Infinity))
    .slice(0, 5)
    .map((row) => ({
      id: row.id,
      count: row.error.count,
      mean: row.error.mean,
      p95: row.error.p95,
      gt5px: row.error.regressionRates.gt5px,
      gt10px: row.error.regressionRates.gt10px,
    }));
}

function predictGateCandidate(trace, anchor, horizonMs, candidate) {
  const stats = historyStats(trace, anchor.refIndex, anchor);
  if (anchor.recentSpeedPxPerSec <= candidate.stopSpeed || stats.stillnessRatio >= candidate.stillnessRatio) {
    return predictConstant(trace, anchor);
  }
  if (stats.gapMax > candidate.gapMaxMs) return predictLeastSquares(trace, anchor, horizonMs, 8, 64);
  return predictLeastSquares(trace, anchor, horizonMs, 12, 64);
}

function modelSpecs(trained, selectedRidgeGlobal, selectedRidgeHorizon) {
  return [
    {
      id: "ls12_baseline",
      family: "least_squares_velocity",
      productEligible: true,
      description: "Step 2 baseline/teacher: LS velocity over 12 causal referencePoll samples, cap64.",
    },
    {
      id: "causal_speed_gate",
      family: "causal_threshold_gate",
      productEligible: true,
      description: "Validation-selected causal speed/stillness/gap gate switching constant, LS8, and LS12.",
      selection: trained.gateSelection.selected,
    },
    {
      id: "ridge_residual_linear",
      family: "ridge_residual",
      productEligible: true,
      description: "Global ridge residual correction over causal features.",
      selectedLambda: selectedRidgeGlobal.lambda,
    },
    {
      id: "ridge_residual_segmented_horizon",
      family: "ridge_residual_by_horizon",
      productEligible: true,
      description: "Horizon-segmented ridge residual correction over the same causal features.",
      selectedLambda: selectedRidgeHorizon.lambda,
    },
    {
      id: "piecewise_speed_horizon_residual",
      family: "piecewise_residual",
      productEligible: true,
      description: "Dependency-free piecewise residual mean by horizon, causal speed bin, and scheduler-delay bin.",
    },
    {
      id: "oracle_category_gate",
      family: "script_category_oracle",
      productEligible: false,
      description: "Non-product oracle: uses script-derived hold/resume/moving category to switch baselines.",
    },
  ];
}

function evaluateRidgeCandidates(traces, trained) {
  const globalAccs = new Map(trained.ridgeGlobalCandidates.map((candidate) => [candidate.id, createAccumulator()]));
  const horizonAccs = new Map(trained.ridgeHorizonCandidates.map((candidate) => [candidate.id, createAccumulator()]));
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      if (anchor.split !== "validation") continue;
      anchor.cache = Object.create(null);
      for (const horizonMs of HORIZONS_MS) {
        const target = interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) continue;
        const baseline = predictLeastSquares(trace, anchor, horizonMs, 12, 64);
        const features = featureVector(trace, anchor, horizonMs, baseline);
        for (const candidate of trained.ridgeGlobalCandidates) {
          const pred = applyRidge(baseline, features, candidate.coefficients);
          addError(globalAccs.get(candidate.id), distance(pred.x, pred.y, target.x, target.y));
        }
        for (const candidate of trained.ridgeHorizonCandidates) {
          const coeff = candidate.coefficientsByHorizon[String(horizonMs)];
          const pred = applyRidge(baseline, features, coeff);
          addError(horizonAccs.get(candidate.id), distance(pred.x, pred.y, target.x, target.y));
        }
      }
    }
  }
  return {
    global: selectBestRidge(trained.ridgeGlobalCandidates, globalAccs),
    horizon: selectBestRidge(trained.ridgeHorizonCandidates, horizonAccs),
  };
}

function selectBestRidge(candidates, accs) {
  const ranking = candidates.map((candidate) => ({
    id: candidate.id,
    lambda: candidate.lambda,
    error: finalizeAccumulator(accs.get(candidate.id)),
  })).sort((a, b) => (a.error.p95 ?? Infinity) - (b.error.p95 ?? Infinity)
    || (a.error.mean ?? Infinity) - (b.error.mean ?? Infinity));
  return {
    selected: candidates.find((candidate) => candidate.id === ranking[0].id),
    ranking: ranking.map((row) => ({
      id: row.id,
      lambda: row.lambda,
      count: row.error.count,
      mean: row.error.mean,
      p95: row.error.p95,
      gt5px: row.error.regressionRates.gt5px,
      gt10px: row.error.regressionRates.gt10px,
    })),
  };
}

function applyRidge(baseline, features, coefficients) {
  return {
    x: baseline.x + dot(coefficients.weightsX, features),
    y: baseline.y + dot(coefficients.weightsY, features),
  };
}

function dot(weights, features) {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) sum += weights[i] * features[i];
  return sum;
}

function predictOracle(trace, anchor, horizonMs) {
  if (anchor.movementCategory === "hold") return predictConstant(trace, anchor);
  if (anchor.movementCategory === "resume") return predictLastTwo(trace, anchor, horizonMs, 64);
  return predictLeastSquares(trace, anchor, horizonMs, 12, 64);
}

function predictPiecewise(trace, anchor, horizonMs, baseline, model) {
  const cell = model.cells.get(piecewiseKey(anchor, horizonMs));
  if (!cell || cell.count < 20) return baseline;
  return { x: baseline.x + cell.dx, y: baseline.y + cell.dy };
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
      perSplitScores: new Map(),
      perLoadConditionScores: new Map(),
      perHorizonScores: new Map(),
      perMovementCategoryScores: new Map(),
      perSplitMovementCategoryScores: new Map(),
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
    this.add("perSplitScores", [model.id, anchor.split, trace.id], {
      ...modelMeta,
      split: anchor.split,
      loadCondition: trace.id,
    }, error);
    this.add("perLoadConditionScores", [model.id, trace.id], {
      ...modelMeta,
      loadCondition: trace.id,
    }, error);
    this.add("perHorizonScores", [model.id, horizonMs, trace.id], {
      ...modelMeta,
      horizonMs,
      loadCondition: trace.id,
    }, error);
    this.add("perMovementCategoryScores", [model.id, anchor.movementCategory, trace.id], {
      ...modelMeta,
      movementCategory: anchor.movementCategory,
      loadCondition: trace.id,
    }, error);
    this.add("perSplitMovementCategoryScores", [model.id, anchor.split, anchor.movementCategory, trace.id], {
      ...modelMeta,
      split: anchor.split,
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

function evaluateModels(traces, trained, selectedGlobal, selectedHorizon) {
  const store = new ScoreStore();
  const models = modelSpecs(trained, selectedGlobal, selectedHorizon);
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      anchor.cache = Object.create(null);
      for (const horizonMs of HORIZONS_MS) {
        const target = interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) continue;
        const baseline = predictLeastSquares(trace, anchor, horizonMs, 12, 64);
        const features = featureVector(trace, anchor, horizonMs, baseline);
        const predictions = {
          ls12_baseline: baseline,
          causal_speed_gate: predictGateCandidate(trace, anchor, horizonMs, trained.gateSelection.selected.params),
          ridge_residual_linear: applyRidge(baseline, features, selectedGlobal.coefficients),
          ridge_residual_segmented_horizon: applyRidge(
            baseline,
            features,
            selectedHorizon.coefficientsByHorizon[String(horizonMs)],
          ),
          piecewise_speed_horizon_residual: predictPiecewise(trace, anchor, horizonMs, baseline, trained.piecewiseModel),
          oracle_category_gate: predictOracle(trace, anchor, horizonMs),
        };
        for (const model of models) {
          const pred = predictions[model.id];
          store.addObservation(model, trace, anchor, horizonMs, distance(pred.x, pred.y, target.x, target.y));
        }
      }
    }
  }
  return { scores: store.finalize(), models };
}

function bestBySegment(rows, keyFn, productOnly = false) {
  const byKey = new Map();
  for (const row of rows) {
    if (productOnly && !row.productEligible) continue;
    const key = keyFn(row);
    const current = byKey.get(key);
    if (!current || isBetter(row, current)) byKey.set(key, row);
  }
  return [...byKey.entries()].map(([segmentKey, row]) => ({ segmentKey, ...compactBest(row) }))
    .sort((a, b) => a.segmentKey.localeCompare(b.segmentKey));
}

function isBetter(a, b) {
  const ap95 = a.error?.p95 ?? a.p95 ?? Infinity;
  const bp95 = b.error?.p95 ?? b.p95 ?? Infinity;
  if (ap95 !== bp95) return ap95 < bp95;
  return (a.error?.mean ?? a.mean ?? Infinity) < (b.error?.mean ?? b.mean ?? Infinity);
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

function buildBestModelSummary(scores) {
  return {
    rankingMetric: "lowest p95 error, then lowest mean error",
    validationOverallProduct: bestBySegment(
      scores.perSplitScores.filter((row) => row.split === "validation"),
      (row) => row.loadCondition,
      true,
    ),
    validationOverallAll: bestBySegment(
      scores.perSplitScores.filter((row) => row.split === "validation"),
      (row) => row.loadCondition,
      false,
    ),
    validationCategoryHorizonProduct: bestBySegment(
      scores.perValidationTestCategoryHorizonScores.filter((row) => row.split === "validation"),
      (row) => metricKey([row.loadCondition, row.horizonMs, row.movementCategory]),
      true,
    ),
  };
}

function scoreLookup(scores, modelId, split, loadCondition) {
  return scores.perSplitScores.find((row) => (
    row.modelId === modelId && row.split === split && row.loadCondition === loadCondition
  ));
}

function scoreLookupHorizon(scores, modelId, split, loadCondition, horizonMs) {
  return scores.perSplitHorizonLoadScores.find((row) => (
    row.modelId === modelId
    && row.split === split
    && row.loadCondition === loadCondition
    && Number(row.horizonMs) === Number(horizonMs)
  ));
}

function scoreLookupCategory(scores, modelId, split, loadCondition, movementCategory) {
  return scores.perSplitMovementCategoryScores.find((row) => (
    row.modelId === modelId
    && row.split === split
    && row.loadCondition === loadCondition
    && row.movementCategory === movementCategory
  ));
}

function improvementRows(scores, candidateId, baselineId = "ls12_baseline") {
  const rows = [];
  for (const split of ["validation", "test"]) {
    for (const load of ["normal", "stress"]) {
      const base = scoreLookup(scores, baselineId, split, load);
      const candidate = scoreLookup(scores, candidateId, split, load);
      if (!base || !candidate) continue;
      rows.push({
        split,
        loadCondition: load,
        baselineMean: base.error.mean,
        candidateMean: candidate.error.mean,
        meanDelta: round(candidate.error.mean - base.error.mean),
        meanImprovementPercent: round(((base.error.mean - candidate.error.mean) / base.error.mean) * 100),
        baselineP95: base.error.p95,
        candidateP95: candidate.error.p95,
        p95Delta: round(candidate.error.p95 - base.error.p95),
        p95ImprovementPercent: round(((base.error.p95 - candidate.error.p95) / base.error.p95) * 100),
      });
    }
  }
  return rows;
}

function segmentRegressionRows(scores, candidateId, baselineId = "ls12_baseline") {
  const rows = [];
  for (const base of scores.perValidationTestCategoryHorizonScores.filter((row) => row.modelId === baselineId)) {
    const candidate = scores.perValidationTestCategoryHorizonScores.find((row) => (
      row.modelId === candidateId
      && row.split === base.split
      && row.loadCondition === base.loadCondition
      && Number(row.horizonMs) === Number(base.horizonMs)
      && row.movementCategory === base.movementCategory
    ));
    if (!candidate) continue;
    const p95Delta = round(candidate.error.p95 - base.error.p95);
    const meanDelta = round(candidate.error.mean - base.error.mean);
    if (p95Delta > 0 || meanDelta > 0) {
      rows.push({
        split: base.split,
        loadCondition: base.loadCondition,
        horizonMs: base.horizonMs,
        movementCategory: base.movementCategory,
        count: base.error.count,
        baselineMean: base.error.mean,
        candidateMean: candidate.error.mean,
        meanDelta,
        baselineP95: base.error.p95,
        candidateP95: candidate.error.p95,
        p95Delta,
      });
    }
  }
  return rows.sort((a, b) => b.p95Delta - a.p95Delta || b.meanDelta - a.meanDelta);
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

function renderReport(result) {
  const bestCandidate = result.nextStepRecommendation.bestProductEligibleModel;
  const scoreRows = [];
  for (const split of ["validation", "test"]) {
    for (const load of ["normal", "stress"]) {
      for (const modelId of ["ls12_baseline", bestCandidate, "oracle_category_gate"]) {
        const row = scoreLookup(result.scores, modelId, split, load);
        if (!row) continue;
        scoreRows.push([
          modelId,
          split,
          load,
          row.error.count,
          fmt(row.error.mean),
          fmt(row.error.median),
          fmt(row.error.p95),
          fmt(row.error.max),
          fmt(row.error.regressionRates.gt5px, 5),
          fmt(row.error.regressionRates.gt10px, 5),
        ]);
      }
    }
  }

  const improvementTable = result.improvementVsBaseline.map((row) => [
    row.split,
    row.loadCondition,
    fmt(row.baselineP95),
    fmt(row.candidateP95),
    fmt(row.p95Delta),
    fmt(row.p95ImprovementPercent),
    fmt(row.meanDelta),
  ]);

  const ridgeRows = [
    ...result.training.ridgeSelection.global.map((row) => ["global", row.lambda, row.mean, row.p95, row.gt5px, row.gt10px]),
    ...result.training.ridgeSelection.horizon.map((row) => ["horizon", row.lambda, row.mean, row.p95, row.gt5px, row.gt10px]),
  ].map((row) => row.map((cell, index) => index >= 2 ? fmt(cell, 5) : cell));

  const horizonRows = [];
  for (const load of ["normal", "stress"]) {
    for (const horizon of HORIZONS_MS) {
      const base = scoreLookupHorizon(result.scores, "ls12_baseline", "test", load, horizon);
      const cand = scoreLookupHorizon(result.scores, bestCandidate, "test", load, horizon);
      if (!base || !cand) continue;
      horizonRows.push([
        load,
        horizon,
        fmt(base.error.p95),
        fmt(cand.error.p95),
        fmt(cand.error.p95 - base.error.p95),
        fmt(cand.error.mean - base.error.mean),
      ]);
    }
  }

  const categoryRows = [];
  for (const split of ["validation", "test"]) {
    for (const load of ["normal", "stress"]) {
      for (const category of ["moving", "hold", "resume"]) {
        const base = scoreLookupCategory(result.scores, "ls12_baseline", split, load, category);
        const cand = scoreLookupCategory(result.scores, bestCandidate, split, load, category);
        if (!base || !cand) continue;
        categoryRows.push([
          split,
          load,
          category,
          cand.error.count,
          fmt(base.error.p95),
          fmt(cand.error.p95),
          fmt(cand.error.p95 - base.error.p95),
          fmt(cand.error.mean - base.error.mean),
        ]);
      }
    }
  }

  const regressionRiskRows = result.segmentRegressionRisksVsBaseline.slice(0, 12).map((row) => [
    row.split,
    row.loadCondition,
    row.horizonMs,
    row.movementCategory,
    row.count,
    fmt(row.baselineP95),
    fmt(row.candidateP95),
    fmt(row.p95Delta),
    fmt(row.meanDelta),
  ]);

  const bestRows = result.bestModelPerSegment.validationOverallProduct.map((row) => [
    row.segmentKey,
    row.modelId,
    fmt(row.mean),
    fmt(row.p95),
    fmt(row.regressionRates.gt5px, 5),
    fmt(row.regressionRates.gt10px, 5),
  ]);

  return `# Step 3 Learned Gates

## Scope

This is a CPU-only learned pilot. It keeps the Step 1 scenario split fixed, uses Step 2's causal poll/reference evaluation contract, and writes only aggregate JSON/Markdown outputs. No GPU, large checkpoint, raw ZIP copy, or per-frame cache was produced.

The baseline/teacher is \`least_squares_velocity_n12_cap64\`, recorded here as \`ls12_baseline\`.

## Models

- \`ls12_baseline\`: Step 2 LS12 cap64 baseline.
- \`causal_speed_gate\`: validation-selected causal threshold gate over speed, stillness, and history gap.
- \`ridge_residual_linear\`: global ridge correction of LS12 residuals.
- \`ridge_residual_segmented_horizon\`: horizon-segmented ridge correction.
- \`piecewise_speed_horizon_residual\`: dependency-free piecewise residual table by horizon, speed bin, and scheduler-delay bin.
- \`oracle_category_gate\`: non-product oracle using script-derived movement category.

## Validation Best Product Models

${table(["load", "model", "mean px", "p95 px", ">5px", ">10px"], bestRows)}

Selected product-eligible candidate for Step 4 comparison: \`${bestCandidate}\`.

## Ridge Selection

${table(["segment", "lambda", "mean px", "p95 px", ">5px", ">10px"], ridgeRows)}

## Overall Scores

${table(["model", "split", "load", "count", "mean px", "median px", "p95 px", "max px", ">5px", ">10px"], scoreRows)}

## Improvement Vs LS12

${table(["split", "load", "LS12 p95", "candidate p95", "p95 delta", "p95 improvement %", "mean delta"], improvementTable)}

## Test Horizon Breakdown

${table(["load", "horizon ms", "LS12 p95", "candidate p95", "p95 delta", "mean delta"], horizonRows)}

## Movement Category Breakdown

${table(["split", "load", "category", "count", "LS12 p95", "candidate p95", "p95 delta", "mean delta"], categoryRows)}

## Segment Regression Risks

${table(["split", "load", "horizon ms", "category", "count", "LS12 p95", "candidate p95", "p95 delta", "mean delta"], regressionRiskRows.length ? regressionRiskRows : [["none", "none", "none", "none", 0, 0, 0, 0, 0]])}

## Interpretation

- The residual models are useful as diagnostics: they reveal whether causal scheduler/history/speed features can correct LS12 without using future labels at inference.
- The oracle category gate is intentionally non-product. In this pilot the simple oracle switch is diagnostic, not an upper bound, and it regresses versus LS12 overall.
- Any segment with positive p95 delta in the regression-risk table should be treated as a gating risk before moving to a larger FSMN/MLP search.

## Step 4 Hand-Off

For FSMN-family exploration, pass these features first: horizon, anchor-to-reference gap, LS12/LS8/last2 velocity projections, speed magnitude, acceleration estimate, history gap mean/max/std, stillness/near-zero ratios, path efficiency, scheduler delay, normalized position, and baseline displacement. Start with horizon-conditioned small models before adding load-specific or category-oracle information.
`;
}

function renderNotes(result) {
  return `# Step 3 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v11\\scripts\\run-step3-learned-gates.js
\`\`\`

## Causality

All product-eligible predictors use only fields available at the product poll anchor: prior referencePoll samples, causal scheduler delay from the latest scheduler poll, current horizon, and current position. The label is used only after prediction for loss computation.

## Product Eligibility

- Product-eligible: \`ls12_baseline\`, \`causal_speed_gate\`, \`ridge_residual_linear\`, \`ridge_residual_segmented_horizon\`, \`piecewise_speed_horizon_residual\`.
- Non-product oracle: \`oracle_category_gate\`, because it uses script-derived hold/resume/moving category.

The residual models include scheduler delay. That is product-eligible only if the runtime exports the latest scheduler timing sample to the predictor at anchor time; otherwise train a no-scheduler variant in Step 4.

## Tiny MLP

No dependency-based MLP was run in this step. A small piecewise residual model was used instead because it is deterministic, CPU-light, and avoids introducing a training framework before the FSMN/MLP search stage.

## Selection Protocol

Ridge coefficients and piecewise residual means are fit on train scenarios only. Ridge lambda and causal gate thresholds are selected on validation. Test is evaluated after selection and is not used for choosing coefficients or thresholds.
`;
}

function buildNextStepRecommendation(scores, bestSummary, improvement) {
  const validationProduct = bestSummary.validationOverallProduct;
  const weighted = new Map();
  for (const row of scores.perSplitScores) {
    if (row.split !== "validation" || !row.productEligible) continue;
    const item = weighted.get(row.modelId) || { modelId: row.modelId, count: 0, weightedP95: 0, weightedMean: 0 };
    item.count += row.error.count;
    item.weightedP95 += row.error.p95 * row.error.count;
    item.weightedMean += row.error.mean * row.error.count;
    weighted.set(row.modelId, item);
  }
  const ranked = [...weighted.values()].map((item) => ({
    modelId: item.modelId,
    count: item.count,
    validationMean: item.count ? round(item.weightedMean / item.count) : null,
    validationP95: item.count ? round(item.weightedP95 / item.count) : null,
  })).sort((a, b) => (a.validationP95 ?? Infinity) - (b.validationP95 ?? Infinity)
    || (a.validationMean ?? Infinity) - (b.validationMean ?? Infinity));
  const best = ranked[0]?.modelId || "ls12_baseline";
  const regressions = improvement.filter((row) => row.p95Delta > 0 || row.meanDelta > 0);
  return {
    bestProductEligibleModel: best,
    rankedValidationProductModels: ranked,
    validationBestByLoad: validationProduct,
    regressionRisksVsLs12: regressions,
    fsmnFeatureSet: FEATURE_NAMES,
    fsmnFamilyPlan: [
      {
        family: "FSMN",
        firstSize: "1 hidden/state projection, 16-32 channels, horizon-conditioned output",
        reason: "Start with the smallest temporal memory over causal deltas and LS residuals.",
      },
      {
        family: "CSFSMN",
        firstSize: "shared causal memory plus scheduler-delay and horizon conditioning",
        reason: "Useful if scheduler-delay bins explain stress tails.",
      },
      {
        family: "VFSMN / VFSMNv2",
        firstSize: "velocity-focused input branch with LS12/LS8/last2 projections",
        reason: "Resume and moving segments are velocity/residual dominated.",
      },
      {
        family: "CVFSMN / CVFSMNv2",
        firstSize: "compact convolutional velocity memory, <=32 channels",
        reason: "Only escalate here if Step 3 residual features improve p95 without tail regressions.",
      },
    ],
  };
}

function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.outDir);

  const step1Scores = JSON.parse(fs.readFileSync(args.step1Scores, "utf8"));
  const split = parseSplit(step1Scores);
  const traces = PACKAGES.map((target) => loadTracePackage(args.root, target, split));
  const trained = trainModels(traces);
  const ridgeSelection = evaluateRidgeCandidates(traces, trained);
  trained.ridgeSelection = {
    global: ridgeSelection.global,
    horizon: ridgeSelection.horizon,
  };
  const selectedGlobal = ridgeSelection.global.selected;
  const selectedHorizon = ridgeSelection.horizon.selected;
  const { scores, models } = evaluateModels(traces, trained, selectedGlobal, selectedHorizon);
  const bestModelPerSegment = buildBestModelSummary(scores);
  const nextStepRecommendation = buildNextStepRecommendation(
    scores,
    bestModelPerSegment,
    improvementRows(scores, "ridge_residual_segmented_horizon"),
  );
  const bestCandidate = nextStepRecommendation.bestProductEligibleModel;
  const improvementVsBaseline = improvementRows(scores, bestCandidate);
  const segmentRegressionRisksVsBaseline = segmentRegressionRows(scores, bestCandidate);
  nextStepRecommendation.regressionRisksVsLs12 = improvementVsBaseline.filter((row) => (
    row.p95Delta > 0 || row.meanDelta > 0
  ));
  nextStepRecommendation.segmentRegressionRisksVsLs12 = segmentRegressionRisksVsBaseline.slice(0, 20);

  const result = {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUtc: new Date().toISOString(),
    constraints: {
      gpuUsed: false,
      trainingRun: "lightweight CPU ridge/threshold/piecewise pilot only",
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
    },
    sourceFiles: PACKAGES.map((item) => ({ id: item.id, label: item.label, file: item.file })),
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
      regressionThresholdsPx: REGRESSION_THRESHOLDS_PX,
      schedulerDelayBins: SCHEDULER_DELAY_BINS,
    },
    features: {
      names: FEATURE_NAMES,
      productEligibilityNote: "Scheduler delay is causal only if the runtime exposes the latest scheduler timing sample at anchor time.",
    },
    training: {
      summary: trained.trainingSummary,
      ridgeFeatureCount: FEATURE_NAMES.length,
      ridgeLambdas: RIDGE_LAMBDAS,
      ridgeGlobalEquationCount: trained.globalEquationCount,
      ridgeHorizonEquationCounts: trained.horizonEquationCounts,
      ridgeSelection: {
        global: ridgeSelection.global.ranking,
        horizon: ridgeSelection.horizon.ranking,
      },
      causalGateSelection: trained.gateSelection,
      piecewiseCellCount: trained.piecewiseModel.cells.size,
    },
    modelList: models,
    scores,
    bestModelPerSegment,
    improvementVsBaseline,
    segmentRegressionRisksVsBaseline,
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
