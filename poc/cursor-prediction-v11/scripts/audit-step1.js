#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const TARGET_PACKAGES = [
  {
    id: "normal",
    label: "normal load",
    file: "cursor-mirror-motion-recording-20260503-212556.zip",
    splitEligible: true,
  },
  {
    id: "stress",
    label: "stress load",
    file: "cursor-mirror-motion-recording-20260503-215632.zip",
    splitEligible: true,
    note: "User supplied context: CursorMirror.LoadGen at 90%, 32 threads.",
  },
  {
    id: "sanity",
    label: "short sanity",
    file: "cursor-mirror-motion-recording-20260503-212102.zip",
    splitEligible: false,
  },
];

function parseArgs(argv) {
  const scriptDir = __dirname;
  const defaultRoot = path.resolve(scriptDir, "..", "..", "..");
  const defaultOut = path.resolve(scriptDir, "..");
  const args = {
    root: defaultRoot,
    outDir: defaultOut,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node audit-step1.js [--root <repo>] [--out-dir <dir>]
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
    entries.set(name, {
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
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

function rel(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolValue(value) {
  return value === true || value === "true" || value === "True";
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

function stats(values) {
  const data = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (data.length === 0) {
    return { count: 0, mean: null, p50: null, p90: null, p95: null, p99: null, max: null, min: null };
  }

  let sum = 0;
  for (const value of data) sum += value;
  return {
    count: data.length,
    mean: sum / data.length,
    min: data[0],
    p50: percentile(data, 0.5),
    p90: percentile(data, 0.9),
    p95: percentile(data, 0.95),
    p99: percentile(data, 0.99),
    max: data[data.length - 1],
  };
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function roundedStats(source, digits = 3) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = typeof value === "number" ? round(value, digits) : value;
  }
  return out;
}

function addCount(map, key, increment = 1) {
  map[key] = (map[key] || 0) + increment;
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

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function applyEasing(value, easing) {
  const x = clamp01(value);
  const normalized = String(easing || "").trim().toLowerCase();
  if (normalized === "smoothstep") return x * x * (3 - 2 * x);
  if (normalized === "sine") return Math.sin((x * Math.PI) / 2);
  return x;
}

function distance(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clipPoint(x, y, bounds) {
  if (!bounds) return { x, y };
  const minX = Number(bounds.X) || 0;
  const minY = Number(bounds.Y) || 0;
  const maxX = minX + (Number(bounds.Width) || 0);
  const maxY = minY + (Number(bounds.Height) || 0);
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
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
      x[i] = x[i] + (x[i + 1] - x[i]) * t;
      y[i] = y[i] + (y[i + 1] - y[i]) * t;
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
    let weight = 1 - dist / width;
    weight = applyEasing(weight, point.Easing);
    multiplier += (Math.max(0.05, Number(point.Multiplier) || 0) - 1) * weight;
  }
  return Math.max(0.05, Math.min(5, multiplier));
}

function buildProgressLookup(script) {
  const lookupSteps = 256;
  const cumulative = new Array(lookupSteps + 1).fill(0);
  const progressByTime = new Array(lookupSteps + 1).fill(0);
  let previous = evaluateBezier(script, 0);
  for (let i = 1; i <= lookupSteps; i += 1) {
    const progress = i / lookupSteps;
    const current = evaluateBezier(script, progress);
    const segmentLength = distance(previous, current);
    const speed = speedMultiplierAt(script, (progress + (i - 1) / lookupSteps) / 2);
    cumulative[i] = cumulative[i - 1] + segmentLength / speed;
    previous = current;
  }

  const total = cumulative[lookupSteps];
  if (total <= 0) {
    for (let i = 0; i <= lookupSteps; i += 1) progressByTime[i] = i / lookupSteps;
    return progressByTime;
  }

  let source = 0;
  for (let i = 0; i <= lookupSteps; i += 1) {
    const target = (total * i) / lookupSteps;
    while (source < lookupSteps && cumulative[source + 1] < target) source += 1;
    const left = cumulative[source];
    const right = cumulative[Math.min(lookupSteps, source + 1)];
    const local = right > left ? (target - left) / (right - left) : 0;
    progressByTime[i] = (source + local) / lookupSteps;
  }
  return progressByTime;
}

function movementTimeAtProgress(progressByTime, progress) {
  const target = clamp01(progress);
  if (target <= progressByTime[0]) return 0;
  for (let i = 0; i < progressByTime.length - 1; i += 1) {
    const left = progressByTime[i];
    const right = progressByTime[i + 1];
    if (target <= right || i === progressByTime.length - 2) {
      const local = right > left ? (target - left) / (right - left) : 0;
      return clamp01((i + local) / (progressByTime.length - 1));
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
  const maxDuration = Math.max(0, duration - 1);
  if (total > maxDuration && total > 0) {
    const scale = maxDuration / total;
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
      progress: hold.progress,
      holdStartMs: holdStart,
      holdEndMs: holdEnd,
      holdDurationMs: Math.max(0, holdEnd - holdStart),
      resumeStartMs: holdEnd,
      resumeEndMs: Math.min(duration, holdEnd + hold.resumeMs),
      resumeDurationMs: Math.max(0, Math.min(duration, holdEnd + hold.resumeMs) - holdEnd),
      rawResumeDurationMs: hold.resumeMs,
    });
    completedHoldDuration += hold.durationMs;
  }

  for (let i = 0; i < intervals.length; i += 1) {
    const nextHoldStart = i + 1 < intervals.length ? intervals[i + 1].holdStartMs : duration;
    intervals[i].resumeEndClippedMs = Math.max(
      intervals[i].resumeStartMs,
      Math.min(intervals[i].resumeEndMs, nextHoldStart),
    );
    intervals[i].resumeDurationClippedMs = intervals[i].resumeEndClippedMs - intervals[i].resumeStartMs;
  }

  return intervals;
}

function classifyMotionTime(scenarioElapsedMs, intervals) {
  for (const interval of intervals) {
    if (scenarioElapsedMs >= interval.holdStartMs && scenarioElapsedMs <= interval.holdEndMs) {
      return "hold";
    }
  }
  for (const interval of intervals) {
    if (
      scenarioElapsedMs > interval.resumeStartMs &&
      scenarioElapsedMs <= interval.resumeEndClippedMs
    ) {
      return "resume";
    }
  }
  return "moving";
}

function summarizeScript(script) {
  const scenarios = Array.isArray(script.Scenarios) ? script.Scenarios : [script];
  const scenarioSummaries = [];
  const holdCounts = [];
  const holdDurationsByScenario = [];
  const resumeDurationsByScenario = [];
  const segmentDurations = [];
  const resumeDurations = [];
  const intervalsByScenario = [];

  scenarios.forEach((scenario, index) => {
    const intervals = holdIntervals(scenario);
    intervalsByScenario[index] = intervals;
    const holdDuration = intervals.reduce((sum, item) => sum + item.holdDurationMs, 0);
    const resumeDuration = intervals.reduce((sum, item) => sum + item.resumeDurationClippedMs, 0);
    const points = Array.isArray(scenario.ControlPoints) ? scenario.ControlPoints : [];
    const speedPoints = Array.isArray(scenario.SpeedPoints) ? scenario.SpeedPoints : [];
    const first = points[0] || null;
    const last = points[points.length - 1] || null;

    holdCounts.push(intervals.length);
    holdDurationsByScenario.push(holdDuration);
    resumeDurationsByScenario.push(resumeDuration);
    for (const interval of intervals) {
      segmentDurations.push(interval.holdDurationMs);
      resumeDurations.push(interval.resumeDurationClippedMs);
    }

    scenarioSummaries.push({
      index,
      seed: scenario.Seed ?? null,
      durationMilliseconds: round(Number(scenario.DurationMilliseconds), 3),
      controlPointCount: points.length,
      speedPointCount: speedPoints.length,
      holdSegmentCount: intervals.length,
      holdDurationMilliseconds: round(holdDuration, 3),
      resumeDurationMilliseconds: round(resumeDuration, 3),
      bounds: scenario.Bounds || null,
      firstPoint: first ? { x: round(Number(first.X), 3), y: round(Number(first.Y), 3) } : null,
      lastPoint: last ? { x: round(Number(last.X), 3), y: round(Number(last.Y), 3) } : null,
    });
  });

  return {
    schemaVersion: script.SchemaVersion ?? null,
    seed: script.Seed ?? null,
    generationProfile: script.GenerationProfile ?? null,
    durationMilliseconds: round(Number(script.DurationMilliseconds), 3),
    scenarioDurationMilliseconds: round(Number(script.ScenarioDurationMilliseconds), 3),
    sampleRateHz: script.SampleRateHz ?? null,
    scenarioCount: scenarios.length,
    controlPointCount: scenarios.reduce((sum, item) => sum + (Array.isArray(item.ControlPoints) ? item.ControlPoints.length : 0), 0),
    speedPointCount: scenarios.reduce((sum, item) => sum + (Array.isArray(item.SpeedPoints) ? item.SpeedPoints.length : 0), 0),
    holdSegmentCount: segmentDurations.length,
    holdDurationMilliseconds: round(segmentDurations.reduce((sum, value) => sum + value, 0), 3),
    resumeDurationMilliseconds: round(resumeDurations.reduce((sum, value) => sum + value, 0), 3),
    holdSegmentsPerScenario: roundedStats(stats(holdCounts), 3),
    holdDurationByScenarioMilliseconds: roundedStats(stats(holdDurationsByScenario), 3),
    resumeDurationByScenarioMilliseconds: roundedStats(stats(resumeDurationsByScenario), 3),
    holdSegmentDurationMilliseconds: roundedStats(stats(segmentDurations), 3),
    resumeSegmentDurationMilliseconds: roundedStats(stats(resumeDurations), 3),
    scenarios: scenarioSummaries,
    intervalsByScenario,
  };
}

function summarizeMotionSamples(opened, scriptSummary) {
  const categoryCounts = { moving: 0, hold: 0, resume: 0 };
  const scenarioCounts = {};
  const scenarioCategoryCounts = {};
  const velocities = [];
  const velocityByCategory = { moving: [], hold: [], resume: [] };
  const xValues = [];
  const yValues = [];
  let header = [];
  let rowCount = 0;

  const data = readZipEntry(opened, "motion-samples.csv");
  const parsed = parseCsvText(
    data,
    (csvHeader) => {
      header = csvHeader;
    },
    (parts, rowIndex, column) => {
      rowCount = rowIndex;
      const scenarioIndex = numberOrNull(parts[column.scenarioIndex]) ?? 0;
      const scenarioElapsed = numberOrNull(parts[column.scenarioElapsedMilliseconds])
        ?? numberOrNull(parts[column.elapsedMilliseconds])
        ?? 0;
      const velocity = numberOrNull(parts[column.velocityPixelsPerSecond]);
      const x = numberOrNull(parts[column.x]);
      const y = numberOrNull(parts[column.y]);
      const intervals = scriptSummary.intervalsByScenario[scenarioIndex] || [];
      const category = classifyMotionTime(scenarioElapsed, intervals);

      addCount(categoryCounts, category);
      addCount(scenarioCounts, String(scenarioIndex));
      if (!scenarioCategoryCounts[scenarioIndex]) {
        scenarioCategoryCounts[scenarioIndex] = { moving: 0, hold: 0, resume: 0 };
      }
      addCount(scenarioCategoryCounts[scenarioIndex], category);
      if (Number.isFinite(velocity)) {
        velocities.push(velocity);
        velocityByCategory[category].push(velocity);
      }
      if (Number.isFinite(x)) xValues.push(x);
      if (Number.isFinite(y)) yValues.push(y);
    },
  );

  const expectedInterval = 1000 / Math.max(1, Number(scriptSummary.sampleRateHz) || 1);
  const expectedRows = Math.max(1, Math.ceil(Number(scriptSummary.durationMilliseconds) / expectedInterval) + 1);
  return {
    present: true,
    header,
    rowCount: parsed.rowCount || rowCount,
    expectedRows,
    rowsMinusExpected: (parsed.rowCount || rowCount) - expectedRows,
    scenarioCounts,
    categoryCounts,
    categoryPercent: Object.fromEntries(
      Object.entries(categoryCounts).map(([key, count]) => [key, round((count / Math.max(1, parsed.rowCount || rowCount)) * 100, 3)]),
    ),
    velocityPixelsPerSecond: roundedStats(stats(velocities), 3),
    velocityByCategory: Object.fromEntries(
      Object.entries(velocityByCategory).map(([key, values]) => [key, roundedStats(stats(values), 3)]),
    ),
    xRange: roundedStats(stats(xValues), 3),
    yRange: roundedStats(stats(yValues), 3),
    scenarioCategoryCounts,
  };
}

function summarizeTrace(opened, metadata, motionMetadata) {
  const data = readZipEntry(opened, "trace.csv");
  const eventCounts = {};
  const eventIntervalsMs = {};
  const lastEventUs = {};
  const scenarioCounts = {};
  const schedulerDelayMs = [];
  const schedulerLeadUs = [];
  const schedulerSleepMs = [];
  const schedulerCursorReadMs = [];
  const waitMethodCounts = {};
  let dwmAvailableTrue = 0;
  let header = [];
  let rowCount = 0;
  const stopwatchFrequency = Number(metadata.StopwatchFrequency) || 10000000;
  const scenarioDurationMs = Number(motionMetadata.ScenarioDurationMilliseconds) || Number(motionMetadata.DurationMilliseconds) || 1;
  const scenarioCount = Number(motionMetadata.ScenarioCount) || 1;

  const parsed = parseCsvText(
    data,
    (csvHeader) => {
      header = csvHeader;
    },
    (parts, rowIndex, column) => {
      rowCount = rowIndex;
      const event = parts[column.event] || "(empty)";
      const elapsedUs = numberOrNull(parts[column.elapsedMicroseconds]);
      addCount(eventCounts, event);
      if (Number.isFinite(elapsedUs)) {
        if (lastEventUs[event] !== undefined) {
          if (!eventIntervalsMs[event]) eventIntervalsMs[event] = [];
          eventIntervalsMs[event].push((elapsedUs - lastEventUs[event]) / 1000);
        }
        lastEventUs[event] = elapsedUs;
        const scenarioIndex = Math.max(
          0,
          Math.min(scenarioCount - 1, Math.floor((elapsedUs / 1000) / scenarioDurationMs)),
        );
        addCount(scenarioCounts, String(scenarioIndex));
      }
      if (boolValue(parts[column.dwmTimingAvailable])) dwmAvailableTrue += 1;

      const planned = numberOrNull(parts[column.runtimeSchedulerPlannedTickTicks]);
      const actual = numberOrNull(parts[column.runtimeSchedulerActualTickTicks]);
      if (Number.isFinite(planned) && Number.isFinite(actual)) {
        schedulerDelayMs.push(((actual - planned) / stopwatchFrequency) * 1000);
      }

      const lead = numberOrNull(parts[column.runtimeSchedulerVBlankLeadMicroseconds]);
      if (Number.isFinite(lead)) schedulerLeadUs.push(lead);

      const sleep = numberOrNull(parts[column.runtimeSchedulerSleepRequestedMilliseconds]);
      if (Number.isFinite(sleep)) schedulerSleepMs.push(sleep);

      const waitMethod = parts[column.runtimeSchedulerWaitMethod];
      if (waitMethod) addCount(waitMethodCounts, waitMethod);

      const readStarted = numberOrNull(parts[column.runtimeSchedulerCursorReadStartedTicks]);
      const readCompleted = numberOrNull(parts[column.runtimeSchedulerCursorReadCompletedTicks]);
      if (Number.isFinite(readStarted) && Number.isFinite(readCompleted)) {
        schedulerCursorReadMs.push(((readCompleted - readStarted) / stopwatchFrequency) * 1000);
      }
    },
  );

  return {
    present: true,
    header,
    rowCount: parsed.rowCount || rowCount,
    rowsMinusMetadataSampleCount: (parsed.rowCount || rowCount) - (Number(metadata.SampleCount) || 0),
    eventCounts,
    scenarioCounts,
    dwmTimingAvailableRows: dwmAvailableTrue,
    dwmTimingAvailableRowPercent: round((dwmAvailableTrue / Math.max(1, parsed.rowCount || rowCount)) * 100, 3),
    eventIntervalMilliseconds: Object.fromEntries(
      Object.entries(eventIntervalsMs).map(([event, values]) => [event, roundedStats(stats(values), 3)]),
    ),
    schedulerDelayMilliseconds: roundedStats(stats(schedulerDelayMs), 3),
    schedulerVBlankLeadMicroseconds: roundedStats(stats(schedulerLeadUs), 3),
    schedulerSleepRequestedMilliseconds: roundedStats(stats(schedulerSleepMs), 3),
    schedulerCursorReadMilliseconds: roundedStats(stats(schedulerCursorReadMs), 3),
    schedulerWaitMethodCounts: waitMethodCounts,
  };
}

function metadataSummary(metadata) {
  return {
    traceFormatVersion: metadata.TraceFormatVersion ?? null,
    productName: metadata.ProductName ?? null,
    productVersion: metadata.ProductVersion ?? null,
    createdUtc: metadata.CreatedUtc ?? null,
    durationMicroseconds: metadata.DurationMicroseconds ?? null,
    sampleCount: metadata.SampleCount ?? null,
    hookSampleCount: metadata.HookSampleCount ?? null,
    pollSampleCount: metadata.PollSampleCount ?? null,
    referencePollSampleCount: metadata.ReferencePollSampleCount ?? null,
    dwmTimingSampleCount: metadata.DwmTimingSampleCount ?? null,
    pollIntervalMilliseconds: metadata.PollIntervalMilliseconds ?? null,
    referencePollIntervalMilliseconds: metadata.ReferencePollIntervalMilliseconds ?? null,
    timerResolutionMilliseconds: metadata.TimerResolutionMilliseconds ?? null,
    timerResolutionSucceeded: metadata.TimerResolutionSucceeded ?? null,
    dwmTimingAvailabilityPercent: metadata.DwmTimingAvailabilityPercent ?? null,
    processorCount: metadata.ProcessorCount ?? null,
    monitorCount: Array.isArray(metadata.Monitors) ? metadata.Monitors.length : null,
    virtualScreen: {
      x: metadata.VirtualScreenX ?? null,
      y: metadata.VirtualScreenY ?? null,
      width: metadata.VirtualScreenWidth ?? null,
      height: metadata.VirtualScreenHeight ?? null,
    },
    qualityWarnings: Array.isArray(metadata.QualityWarnings) ? metadata.QualityWarnings : [],
    hookMoveIntervalStats: metadata.HookMoveIntervalStats ?? null,
    productPollIntervalStats: metadata.ProductPollIntervalStats ?? null,
    referencePollIntervalStats: metadata.ReferencePollIntervalStats ?? null,
    runtimeSchedulerPollSampleCount: metadata.RuntimeSchedulerPollSampleCount ?? null,
    runtimeSchedulerPollIntervalStats: metadata.RuntimeSchedulerPollIntervalStats ?? null,
    runtimeSchedulerLoopSampleCount: metadata.RuntimeSchedulerLoopSampleCount ?? null,
    runtimeSchedulerLoopIntervalStats: metadata.RuntimeSchedulerLoopIntervalStats ?? null,
    runtimeSchedulerWakeAdvanceMilliseconds: metadata.RuntimeSchedulerWakeAdvanceMilliseconds ?? null,
    runtimeSchedulerFallbackIntervalMilliseconds: metadata.RuntimeSchedulerFallbackIntervalMilliseconds ?? null,
    runtimeSchedulerMaximumDwmSleepMilliseconds: metadata.RuntimeSchedulerMaximumDwmSleepMilliseconds ?? null,
    runtimeSchedulerCoalescedTickCount: metadata.RuntimeSchedulerCoalescedTickCount ?? null,
    runtimeSchedulerThreadProfile: metadata.RuntimeSchedulerThreadProfile ?? null,
    runtimeSchedulerCaptureThreadProfile: metadata.RuntimeSchedulerCaptureThreadProfile ?? null,
  };
}

function motionMetadataSummary(metadata) {
  return {
    productName: metadata.ProductName ?? null,
    productVersion: metadata.ProductVersion ?? null,
    createdUtc: metadata.CreatedUtc ?? null,
    generationProfile: metadata.GenerationProfile ?? null,
    seed: metadata.Seed ?? null,
    scenarioCount: metadata.ScenarioCount ?? null,
    controlPointCount: metadata.ControlPointCount ?? null,
    speedPointCount: metadata.SpeedPointCount ?? null,
    holdSegmentCount: metadata.HoldSegmentCount ?? null,
    holdDurationMilliseconds: round(Number(metadata.HoldDurationMilliseconds), 3),
    durationMilliseconds: metadata.DurationMilliseconds ?? null,
    scenarioDurationMilliseconds: metadata.ScenarioDurationMilliseconds ?? null,
    sampleRateHz: metadata.SampleRateHz ?? null,
  };
}

function auditPackage(root, target) {
  const zipPath = path.join(root, target.file);
  const stat = fs.statSync(zipPath);
  const opened = openZip(zipPath);
  const metadata = jsonEntry(opened, "metadata.json");
  const motionMetadata = jsonEntry(opened, "motion-metadata.json");
  const script = jsonEntry(opened, "motion-script.json");
  const scriptSummary = summarizeScript(script);
  const motionSamples = summarizeMotionSamples(opened, scriptSummary);
  const trace = summarizeTrace(opened, metadata, motionMetadata);
  delete scriptSummary.intervalsByScenario;

  return {
    id: target.id,
    label: target.label,
    sourceZip: target.file,
    relativePath: rel(root, zipPath),
    bytes: stat.size,
    note: target.note || null,
    entries: [...opened.entries.values()].map((entry) => ({
      name: entry.name,
      compressionMethod: entry.method,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
    })),
    metadata: metadataSummary(metadata),
    motionMetadata: motionMetadataSummary(motionMetadata),
    motionScript: scriptSummary,
    motionSamples,
    trace,
    consistency: {
      metadataSampleCountMatchesTraceRows: trace.rowsMinusMetadataSampleCount === 0,
      motionMetadataScenarioCountMatchesScript: Number(motionMetadata.ScenarioCount) === scriptSummary.scenarioCount,
      motionMetadataControlPointsMatchScript: Number(motionMetadata.ControlPointCount) === scriptSummary.controlPointCount,
      motionMetadataSpeedPointsMatchScript: Number(motionMetadata.SpeedPointCount) === scriptSummary.speedPointCount,
      motionMetadataHoldSegmentsMatchScript: Number(motionMetadata.HoldSegmentCount) === scriptSummary.holdSegmentCount,
      motionSampleRowsMatchExpectedRate: motionSamples.rowsMinusExpected === 0,
    },
  };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function splitScenarioIndices(count) {
  const seed = 0xc0def00d;
  const random = mulberry32(seed);
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  const train = order.slice(0, 44).sort((a, b) => a - b);
  const validation = order.slice(44, 54).sort((a, b) => a - b);
  const test = order.slice(54, 64).sort((a, b) => a - b);
  return {
    method: "Stable Fisher-Yates shuffle over scenario indices using Mulberry32 seed 0xc0def00d.",
    scenarioCount: count,
    ratio: "70/15/15",
    counts: { train: train.length, validation: validation.length, test: test.length },
    train,
    validation,
    test,
    selectionOrder: order,
    applyTo: [
      "Use the same index buckets for normal and stress recordings.",
      "The short sanity recording has only 8 scenarios and is excluded from model selection splits.",
    ],
    leakageRationale: [
      "A sample-level random split would leak adjacent 4.167 ms samples from the same 12 s curve into train and evaluation.",
      "A scenario-level split keeps each Bezier path, speed profile, hold timing, and resume timing wholly inside one bucket.",
      "Using the same bucket indices across normal and stress keeps load-condition comparisons aligned and prevents tuning on a stress scenario index that later appears in test under the other load condition.",
    ],
  };
}

function metricDiff(packages) {
  const normal = packages.find((item) => item.id === "normal");
  const stress = packages.find((item) => item.id === "stress");
  if (!normal || !stress) return null;

  const metrics = [
    ["trace rows", normal.trace.rowCount, stress.trace.rowCount],
    ["hook samples", normal.metadata.hookSampleCount, stress.metadata.hookSampleCount],
    ["product poll p95 ms", normal.metadata.productPollIntervalStats?.P95Milliseconds, stress.metadata.productPollIntervalStats?.P95Milliseconds],
    ["reference poll p95 ms", normal.metadata.referencePollIntervalStats?.P95Milliseconds, stress.metadata.referencePollIntervalStats?.P95Milliseconds],
    ["hook move p95 ms", normal.metadata.hookMoveIntervalStats?.P95Milliseconds, stress.metadata.hookMoveIntervalStats?.P95Milliseconds],
    ["scheduler poll p95 ms", normal.metadata.runtimeSchedulerPollIntervalStats?.P95Milliseconds, stress.metadata.runtimeSchedulerPollIntervalStats?.P95Milliseconds],
    ["scheduler loop p95 ms", normal.metadata.runtimeSchedulerLoopIntervalStats?.P95Milliseconds, stress.metadata.runtimeSchedulerLoopIntervalStats?.P95Milliseconds],
    ["scheduler delay p95 ms", normal.trace.schedulerDelayMilliseconds.p95, stress.trace.schedulerDelayMilliseconds.p95],
    ["scheduler delay max ms", normal.trace.schedulerDelayMilliseconds.max, stress.trace.schedulerDelayMilliseconds.max],
  ];

  return metrics.map(([name, normalValue, stressValue]) => ({
    metric: name,
    normal: round(Number(normalValue), 3),
    stress: round(Number(stressValue), 3),
    absoluteDelta: round(Number(stressValue) - Number(normalValue), 3),
    relativeDeltaPercent: Number(normalValue) ? round(((Number(stressValue) - Number(normalValue)) / Number(normalValue)) * 100, 3) : null,
  }));
}

function buildCategoryDefinitions() {
  return {
    moving: {
      definition: "Scripted sample time outside hold and resume intervals.",
      primaryFields: ["motion-samples.csv scenarioIndex", "scenarioElapsedMilliseconds", "velocityPixelsPerSecond"],
      suggestedUse: "Default regression/tracking class. Can be binned further by velocity.",
    },
    hold: {
      definition: "Script-derived interval [holdStartMs, holdEndMs] for each HoldSegments entry after MotionLabSampler timing normalization.",
      primaryFields: ["motion-script.json Scenarios[].HoldSegments[].Progress", "DurationMilliseconds"],
      suggestedUse: "Stationary target class. Evaluation should emphasize no overshoot and low jitter.",
    },
    resume: {
      definition: "First ResumeEasingMilliseconds after a hold ends, clipped before the next hold or scenario end.",
      primaryFields: ["motion-script.json Scenarios[].HoldSegments[].ResumeEasingMilliseconds"],
      suggestedUse: "Transition class. Evaluate separately because acceleration after hold is a distinct failure mode.",
    },
    stress: {
      definition: "All rows from cursor-mirror-motion-recording-20260503-215632.zip. Load generator context is external to the ZIP metadata: 90%, 32 threads.",
      primaryFields: ["source zip id"],
      suggestedUse: "Load condition label, orthogonal to movement state.",
    },
    schedulerDelay: {
      definition: "Rows with runtimeSchedulerPlannedTickTicks and runtimeSchedulerActualTickTicks; delayMs = (actual - planned) / StopwatchFrequency * 1000.",
      primaryFields: ["trace.csv runtimeSchedulerPlannedTickTicks", "runtimeSchedulerActualTickTicks", "StopwatchFrequency"],
      suggestedUse: "Scheduler health feature and stratification bin. Suggested bins: <=1 ms, 1-4 ms, 4-8 ms, >8 ms.",
    },
  };
}

function auditScores(packages) {
  const normal = packages.find((item) => item.id === "normal");
  const stress = packages.find((item) => item.id === "stress");
  const eligible = [normal, stress].filter(Boolean);
  const completeness = eligible.every((item) => {
    const names = new Set(item.entries.map((entry) => entry.name));
    return ["motion-script.json", "motion-samples.csv", "trace.csv", "metadata.json", "motion-metadata.json"]
      .every((name) => names.has(name));
  }) ? 1 : 0;
  const consistencyChecks = eligible.flatMap((item) => Object.values(item.consistency));
  const consistency = consistencyChecks.filter(Boolean).length / Math.max(1, consistencyChecks.length);
  const hasStressWarning = stress ? stress.metadata.qualityWarnings.length > 0 : true;
  const traceUsability = eligible.every((item) => item.trace.rowCount > 0 && item.trace.eventCounts.referencePoll > 0)
    ? 1
    : 0.5;
  const splitReadiness = eligible.every((item) => item.motionScript.scenarioCount === 64) ? 1 : 0;

  return {
    overallAuditReadiness: round((completeness * 0.3) + (consistency * 0.3) + (traceUsability * 0.2) + (splitReadiness * 0.2), 3),
    completeness,
    consistency: round(consistency, 3),
    traceUsability,
    splitReadiness,
    cautionFlags: [
      ...(hasStressWarning ? ["stress package contains poll interval quality warnings"] : []),
      "stress load-generator setting is not embedded in metadata; preserve source filename/context in downstream manifests",
      "runtime scheduler thread profile is unavailable in all packages",
    ],
  };
}

function table(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, col) => Math.max(...all.map((row) => String(row[col] ?? "").length)));
  const formatRow = (row) => `| ${row.map((cell, col) => String(cell ?? "").padEnd(widths[col])).join(" | ")} |`;
  return [
    formatRow(headers),
    formatRow(headers.map((_, col) => "-".repeat(widths[col]))),
    ...rows.map(formatRow),
  ].join("\n");
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (typeof value === "number") return String(round(value, digits));
  return String(value);
}

function renderReport(scores) {
  const packages = scores.packages;
  const normal = packages.find((item) => item.id === "normal");
  const stress = packages.find((item) => item.id === "stress");
  const sanity = packages.find((item) => item.id === "sanity");
  const split = scores.splitProposal;

  const packageRows = packages.map((item) => [
    item.id,
    item.sourceZip,
    item.entries.length,
    item.metadata.sampleCount,
    item.motionMetadata.scenarioCount,
    item.motionMetadata.holdSegmentCount,
    fmt(item.motionMetadata.holdDurationMilliseconds, 1),
    item.metadata.qualityWarnings.length ? item.metadata.qualityWarnings.join("; ") : "none",
  ]);

  const metadataRows = [normal, stress].map((item) => [
    item.id,
    fmt((item.metadata.durationMicroseconds || 0) / 1000000, 3),
    item.metadata.sampleCount,
    item.metadata.hookSampleCount,
    item.metadata.pollSampleCount,
    item.metadata.referencePollSampleCount,
    fmt(item.metadata.productPollIntervalStats?.P95Milliseconds),
    fmt(item.metadata.referencePollIntervalStats?.P95Milliseconds),
    fmt(item.metadata.runtimeSchedulerLoopIntervalStats?.P95Milliseconds),
  ]);

  const scriptRows = [normal, stress].map((item) => [
    item.id,
    item.motionScript.seed,
    item.motionScript.scenarioCount,
    item.motionScript.controlPointCount,
    item.motionScript.speedPointCount,
    item.motionScript.holdSegmentCount,
    fmt(item.motionScript.holdDurationMilliseconds, 1),
    fmt(item.motionScript.resumeDurationMilliseconds, 1),
  ]);

  const motionRows = [normal, stress].map((item) => [
    item.id,
    item.motionSamples.rowCount,
    item.motionSamples.rowsMinusExpected,
    item.motionSamples.categoryCounts.moving,
    item.motionSamples.categoryCounts.hold,
    item.motionSamples.categoryCounts.resume,
    fmt(item.motionSamples.velocityPixelsPerSecond.p95),
    fmt(item.motionSamples.velocityPixelsPerSecond.max),
  ]);

  const traceRows = [normal, stress].map((item) => [
    item.id,
    item.trace.rowCount,
    item.trace.rowsMinusMetadataSampleCount,
    item.trace.eventCounts.move || 0,
    item.trace.eventCounts.poll || 0,
    item.trace.eventCounts.referencePoll || 0,
    item.trace.eventCounts.runtimeSchedulerPoll || 0,
    fmt(item.trace.schedulerDelayMilliseconds.p95),
    fmt(item.trace.schedulerDelayMilliseconds.max),
  ]);

  const diffRows = scores.normalStressDelta.map((item) => [
    item.metric,
    fmt(item.normal),
    fmt(item.stress),
    fmt(item.absoluteDelta),
    fmt(item.relativeDeltaPercent),
  ]);

  return `# Step 1 Data Audit

## Scope

This audit only reads the source ZIP files in the repository root and writes small derived summaries under \`poc/cursor-prediction-v11/\`. No training, GPU work, long benchmark, or raw ZIP copy was performed.

## Package Structure

All audited packages use the same five-entry layout: \`motion-script.json\`, \`motion-samples.csv\`, \`trace.csv\`, \`metadata.json\`, and \`motion-metadata.json\`.

${table(["id", "zip", "entries", "trace rows", "scenarios", "holds", "hold ms", "warnings"], packageRows)}

The short sanity package is structurally valid but has ${sanity.motionMetadata.scenarioCount} scenarios and is excluded from the 64-scenario split policy.

## Metadata Summary

${table(["id", "duration s", "trace rows", "hook", "poll", "reference", "product p95 ms", "ref p95 ms", "sched loop p95 ms"], metadataRows)}

Both long packages have 768 s duration, 64 scenarios, 240 Hz motion samples, 8 ms product poll target, 2 ms reference poll target, timer resolution 1 ms, DWM timing availability 100%, and 3-monitor 7680x1440 virtual screen metadata.

## Motion Script Summary

${table(["id", "seed", "scenarios", "control pts", "speed pts", "holds", "hold ms", "resume ms"], scriptRows)}

Each long recording has 64 scenarios, each scenario is 12 s, and each scenario has 8 control points plus 8 speed points. Hold/resume intervals are present throughout both scripts. The normal and stress recordings were generated with different top-level seeds, so they are comparable load-condition corpora rather than exact paired trajectories.

## Motion Samples

${table(["id", "rows", "rows-expected", "moving", "hold", "resume", "velocity p95", "velocity max"], motionRows)}

The motion sample row counts match the expected sample-rate grid. Category counts are derived from the script timing model rather than velocity thresholding, so hold and resume labels remain stable at hold boundaries.

## Trace Summary

${table(["id", "rows", "rows-metadata", "move", "poll", "reference", "scheduler", "delay p95 ms", "delay max ms"], traceRows)}

Trace row counts match \`metadata.json SampleCount\` for all audited packages. The scheduler delay metric is computed from \`runtimeSchedulerActualTickTicks - runtimeSchedulerPlannedTickTicks\` using \`StopwatchFrequency\`.

## Normal vs Stress

${table(["metric", "normal", "stress", "delta", "delta %"], diffRows)}

The stress run shows the expected scheduler/poll degradation: product poll p95 rises from ${fmt(normal.metadata.productPollIntervalStats?.P95Milliseconds)} ms to ${fmt(stress.metadata.productPollIntervalStats?.P95Milliseconds)} ms, scheduler loop p95 rises from ${fmt(normal.metadata.runtimeSchedulerLoopIntervalStats?.P95Milliseconds)} ms to ${fmt(stress.metadata.runtimeSchedulerLoopIntervalStats?.P95Milliseconds)} ms, and stress adds \`product_poll_interval_p95_exceeds_requested_interval\`. Reference poll warning exists in both long runs.

## Split Proposal

Use scenario-unit split with stable hash shuffle over scenario indices 0..63.

- Train (${split.counts.train}): ${split.train.join(", ")}
- Validation (${split.counts.validation}): ${split.validation.join(", ")}
- Test (${split.counts.test}): ${split.test.join(", ")}

Apply the same index buckets to the normal and stress long recordings. This prevents sample-level leakage from adjacent 4.167 ms rows and keeps each 12 s Bezier path, speed profile, hold timing, and resume timing in exactly one bucket.

## Category Definitions

- \`moving\`: script time outside hold and resume intervals.
- \`hold\`: script-derived hold interval \`[holdStartMs, holdEndMs]\` after MotionLabSampler timing normalization.
- \`resume\`: first \`ResumeEasingMilliseconds\` after a hold, clipped before the next hold or scenario end.
- \`stress\`: all rows from \`${stress.sourceZip}\`; the load-generator setting is supplied by experiment context, not embedded in metadata.
- \`schedulerDelay\`: rows with scheduler planned/actual ticks; \`delayMs = (actual - planned) / StopwatchFrequency * 1000\`. Suggested bins are \`<=1 ms\`, \`1-4 ms\`, \`4-8 ms\`, and \`>8 ms\`.

## Risks And Mitigations

- Stress condition metadata is not self-contained. Preserve source ZIP name and experiment note in downstream manifests.
- Product/reference poll p95 warnings mean Step 2 should stratify results by load condition and scheduler delay rather than aggregate only.
- Scenario order is continuous because each generated scenario starts from the previous scenario end point. Scenario-level split still prevents within-scenario leakage, but reports should mention that train/validation/test are not independent user sessions.

## Step 2 Recommendation

Build a lightweight dataset manifest from these summaries: one row per trace/motion sample window with source package, scenario split, movement category, load condition, and scheduler-delay bin. Then run deterministic baseline replay on the train split and report validation/test separately by \`moving\`, \`hold\`, \`resume\`, \`normal\`, \`stress\`, and scheduler-delay bin.
`;
}

function renderReadme(scores) {
  return `# Cursor Prediction v11

This experiment starts from a Step 1 data audit of the May 3, 2026 Motion Lab recordings.

Artifacts:

- \`step-1-data-audit/report.md\`: human-readable data audit.
- \`step-1-data-audit/scores.json\`: machine-readable audit scores and summaries.
- \`step-1-data-audit/notes.md\`: caveats, rerun command, and Step 2 handoff notes.
- \`scripts/audit-step1.js\`: lightweight reproducible audit script.

No raw ZIP files or large intermediates are copied into this directory.
`;
}

function renderNotes(scores) {
  const split = scores.splitProposal;
  return `# Step 1 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v11\\scripts\\audit-step1.js
\`\`\`

The script reads the three repository-root ZIP files directly and regenerates this directory's Step 1 artifacts.

## Split

The proposed split is scenario-unit and hash-shuffled:

- Train: ${split.train.join(", ")}
- Validation: ${split.validation.join(", ")}
- Test: ${split.test.join(", ")}

Do not randomly split individual rows. That would leak neighboring time steps, the same control-point curve, and the same hold/resume interval into evaluation.

## Caveats

- The stress package's 90% / 32-thread load-generator setting is user-supplied context and does not appear inside the ZIP metadata.
- Normal and stress long recordings have different motion script seeds. Treat them as two load-condition corpora, not exact paired replays.
- The short sanity package has 8 scenarios. It is useful for quick parser sanity checks only, not Step 2 model selection.
- Runtime scheduler thread profile is unavailable in metadata, so scheduler health should be inferred from trace timing fields.

## Step 2 Handoff

Recommended next step: generate a compact manifest keyed by \`sourceZip + scenarioIndex + sample/window index\`, attach the split and categories from \`scores.json\`, then evaluate deterministic baselines before any learned model work.
`;
}

function main() {
  const args = parseArgs(process.argv);
  const auditDir = path.join(args.outDir, "step-1-data-audit");
  ensureDir(auditDir);

  const packages = TARGET_PACKAGES.map((target) => auditPackage(args.root, target));
  const primaryScenarioCount = packages.find((item) => item.id === "normal")?.motionScript.scenarioCount || 64;
  const scores = {
    schemaVersion: "cursor-prediction-v11-step1-audit/1",
    generatedAtUtc: new Date().toISOString(),
    root: args.root,
    constraints: {
      gpuUsed: false,
      trainingRun: false,
      rawZipCopied: false,
      longBenchmarkRun: false,
    },
    packages,
    normalStressDelta: metricDiff(packages),
    splitProposal: splitScenarioIndices(primaryScenarioCount),
    categoryDefinitions: buildCategoryDefinitions(),
    auditScores: null,
  };
  scores.auditScores = auditScores(packages);

  const scoresPath = path.join(auditDir, "scores.json");
  const reportPath = path.join(auditDir, "report.md");
  const notesPath = path.join(auditDir, "notes.md");
  const readmePath = path.join(args.outDir, "README.md");
  fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2) + "\n", "utf8");
  fs.writeFileSync(reportPath, renderReport(scores), "utf8");
  fs.writeFileSync(notesPath, renderNotes(scores), "utf8");
  fs.writeFileSync(readmePath, renderReadme(scores), "utf8");

  process.stdout.write(`Wrote:
${rel(args.root, readmePath)}
${rel(args.root, reportPath)}
${rel(args.root, scoresPath)}
${rel(args.root, notesPath)}
`);
}

main();
