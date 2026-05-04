#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SCHEMA_VERSION = "cursor-prediction-v12-audit-clean-split/1";
const MOTION_LAB_EXTRA_INFO = 1129139532;
const CONTAMINATION_NEAR_MS = 250;
const SPLIT_SEED = 0xc0def00d;

const TARGET_PACKAGES = [
  { id: "m070055", file: "cursor-mirror-motion-recording-20260504-070055.zip" },
  { id: "m070211", file: "cursor-mirror-motion-recording-20260504-070211.zip" },
  { id: "m070248", file: "cursor-mirror-motion-recording-20260504-070248.zip" },
  { id: "m070307", file: "cursor-mirror-motion-recording-20260504-070307.zip" },
];

const REQUIRED_TRACE_V9_FIELDS = [
  "warmupSample",
  "predictionTargetTicks",
  "presentReferenceTicks",
  "schedulerProvenance",
  "sampleRecordedToPredictionTargetMicroseconds",
  "runtimeSchedulerMissing",
];

const REQUIRED_MOTION_V2_FIELDS = [
  "movementPhase",
  "holdIndex",
  "phaseElapsedMilliseconds",
];

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  const outDir = path.resolve(scriptDir, "..");
  const args = { root, outDir };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v12\\scripts\\audit-and-split.js [--root <repo>] [--out-dir <dir>]
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

function boolValue(value) {
  return value === true || value === "true" || value === "True";
}

function addCount(map, key, increment = 1) {
  map[key] = (map[key] || 0) + increment;
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
    return { count: 0, mean: null, min: null, p50: null, p90: null, p95: null, p99: null, max: null };
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
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = typeof value === "number" ? round(value, digits) : value;
  }
  return result;
}

function scenarioFromElapsedMs(elapsedMs, scenarioDurationMs, scenarioCount) {
  if (!Number.isFinite(elapsedMs)) return null;
  const raw = Math.floor(elapsedMs / Math.max(1, scenarioDurationMs));
  return Math.max(0, Math.min(Math.max(0, scenarioCount - 1), raw));
}

function buildIntervals(centerMilliseconds, nearMs) {
  const raw = centerMilliseconds
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .map((center) => ({ startMs: Math.max(0, center - nearMs), endMs: center + nearMs }));
  const merged = [];
  for (const interval of raw) {
    const last = merged[merged.length - 1];
    if (!last || interval.startMs > last.endMs) merged.push({ ...interval });
    else last.endMs = Math.max(last.endMs, interval.endMs);
  }
  return merged.map((interval) => ({
    startMs: round(interval.startMs, 3),
    endMs: round(interval.endMs, 3),
    durationMs: round(interval.endMs - interval.startMs, 3),
  }));
}

function inIntervals(elapsedMs, intervals) {
  if (!Number.isFinite(elapsedMs)) return false;
  for (const interval of intervals) {
    if (elapsedMs >= interval.startMs && elapsedMs <= interval.endMs) return true;
  }
  return false;
}

function stableScenarioSplit(count) {
  const order = Array.from({ length: count }, (_, index) => index);
  const random = mulberry32(SPLIT_SEED);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }

  const trainCount = Math.floor(count * 0.7);
  const validationCount = Math.round(count * 0.15);
  const train = order.slice(0, trainCount).sort((a, b) => a - b);
  const validation = order.slice(trainCount, trainCount + validationCount).sort((a, b) => a - b);
  const test = order.slice(trainCount + validationCount).sort((a, b) => a - b);
  const byScenario = new Map();
  for (const scenario of train) byScenario.set(scenario, "train");
  for (const scenario of validation) byScenario.set(scenario, "validation");
  for (const scenario of test) byScenario.set(scenario, "test");

  return {
    method: "Stable Fisher-Yates shuffle over scenario indices using Mulberry32 seed 0xc0def00d.",
    seed: `0x${SPLIT_SEED.toString(16)}`,
    ratio: "70/15/15",
    scenarioCount: count,
    counts: { train: train.length, validation: validation.length, test: test.length },
    train,
    validation,
    test,
    selectionOrder: order,
    byScenario,
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

function summarizeEntries(opened) {
  return [...opened.entries.values()].map((entry) => ({
    name: entry.name,
    compressionMethod: entry.method,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
  }));
}

function metadataSummary(metadata, motionMetadata) {
  const pollP50 = numberOrNull(metadata.RuntimeSchedulerPollIntervalStats?.P50Milliseconds);
  const refreshHz = Number.isFinite(pollP50) && pollP50 > 0 ? 1000 / pollP50 : null;
  const refreshBucket = refreshHz === null ? "unknown" : `${Math.round(refreshHz)}Hz`;
  const monitorCount = Array.isArray(metadata.Monitors) ? metadata.Monitors.length : 0;
  const machineKey = [
    `${metadata.ProcessorCount ?? "unknown"}cpu`,
    `${metadata.VirtualScreenWidth ?? "unknown"}x${metadata.VirtualScreenHeight ?? "unknown"}`,
    `${monitorCount}mon`,
    refreshBucket,
  ].join("_");

  return {
    traceFormatVersion: metadata.TraceFormatVersion ?? null,
    motionSampleFormatVersion: motionMetadata.MotionSampleFormatVersion ?? null,
    productVersion: metadata.ProductVersion ?? null,
    createdUtc: metadata.CreatedUtc ?? null,
    durationMicroseconds: metadata.DurationMicroseconds ?? null,
    sampleCount: metadata.SampleCount ?? null,
    hookSampleCount: metadata.HookSampleCount ?? null,
    pollSampleCount: metadata.PollSampleCount ?? null,
    referencePollSampleCount: metadata.ReferencePollSampleCount ?? null,
    dwmTimingSampleCount: metadata.DwmTimingSampleCount ?? null,
    dwmTimingAvailabilityPercent: metadata.DwmTimingAvailabilityPercent ?? null,
    timerResolutionMilliseconds: metadata.TimerResolutionMilliseconds ?? null,
    timerResolutionSucceeded: metadata.TimerResolutionSucceeded ?? null,
    processorCount: metadata.ProcessorCount ?? null,
    monitorCount,
    virtualScreen: {
      x: metadata.VirtualScreenX ?? null,
      y: metadata.VirtualScreenY ?? null,
      width: metadata.VirtualScreenWidth ?? null,
      height: metadata.VirtualScreenHeight ?? null,
    },
    refreshHz: round(refreshHz, 3),
    refreshBucket,
    machineKey,
    qualityWarnings: Array.isArray(metadata.QualityWarnings) ? metadata.QualityWarnings : [],
    runtimeSchedulerPollIntervalStats: metadata.RuntimeSchedulerPollIntervalStats ?? null,
    runtimeSchedulerLoopIntervalStats: metadata.RuntimeSchedulerLoopIntervalStats ?? null,
    hookMoveIntervalStats: metadata.HookMoveIntervalStats ?? null,
    productPollIntervalStats: metadata.ProductPollIntervalStats ?? null,
    referencePollIntervalStats: metadata.ReferencePollIntervalStats ?? null,
    warmupDurationMilliseconds: metadata.WarmupDurationMilliseconds ?? null,
  };
}

function motionMetadataSummary(motionMetadata) {
  return {
    generationProfile: motionMetadata.GenerationProfile ?? null,
    seed: motionMetadata.Seed ?? null,
    scenarioCount: Number(motionMetadata.ScenarioCount) || 0,
    controlPointCount: motionMetadata.ControlPointCount ?? null,
    speedPointCount: motionMetadata.SpeedPointCount ?? null,
    holdSegmentCount: motionMetadata.HoldSegmentCount ?? null,
    holdDurationMilliseconds: round(Number(motionMetadata.HoldDurationMilliseconds), 3),
    durationMilliseconds: Number(motionMetadata.DurationMilliseconds) || 0,
    scenarioDurationMilliseconds: Number(motionMetadata.ScenarioDurationMilliseconds) || 0,
    sampleRateHz: Number(motionMetadata.SampleRateHz) || 0,
  };
}

function summarizeMotionScript(script) {
  const scenarios = Array.isArray(script.Scenarios) ? script.Scenarios : [script];
  const controlPointCounts = [];
  const speedPointCounts = [];
  const holdCounts = [];
  const durations = [];
  for (const scenario of scenarios) {
    controlPointCounts.push(Array.isArray(scenario.ControlPoints) ? scenario.ControlPoints.length : 0);
    speedPointCounts.push(Array.isArray(scenario.SpeedPoints) ? scenario.SpeedPoints.length : 0);
    holdCounts.push(Array.isArray(scenario.HoldSegments) ? scenario.HoldSegments.length : 0);
    durations.push(Number(scenario.DurationMilliseconds));
  }
  return {
    schemaVersion: script.SchemaVersion ?? null,
    generationProfile: script.GenerationProfile ?? null,
    seed: script.Seed ?? null,
    scenarioCount: scenarios.length,
    controlPointsPerScenario: roundedStats(stats(controlPointCounts), 3),
    speedPointsPerScenario: roundedStats(stats(speedPointCounts), 3),
    holdSegmentsPerScenario: roundedStats(stats(holdCounts), 3),
    scenarioDurationMilliseconds: roundedStats(stats(durations), 3),
  };
}

function cleanPredicate(elapsedMs, scenarioIndex, warmup, finalRule) {
  if (warmup) return false;
  if (finalRule.dropScenarios.includes(scenarioIndex)) return false;
  if (inIntervals(elapsedMs, finalRule.contaminationWindows)) return false;
  return true;
}

function splitName(split, scenarioIndex) {
  return split.byScenario.get(scenarioIndex) || "unassigned";
}

function summarizeTrace(opened, metadata, motion, split) {
  const buffer = readZipEntry(opened, "trace.csv");
  const scenarioDurationMs = motion.scenarioDurationMilliseconds || 12000;
  const scenarioCount = motion.scenarioCount || 64;
  const stopwatchFrequency = Number(metadata.StopwatchFrequency) || 10000000;
  const eventCounts = {};
  const schedulerProvenanceCounts = {};
  const runtimeSchedulerMissingCounts = {};
  const extraInfoCounts = {};
  const contaminationTimes = [];
  const nonWarmContaminationTimes = [];
  const sampleToTargetUs = [];
  const schedulerDelayMs = [];
  let header = [];
  let rowCount = 0;
  let warmupRows = 0;
  let moveRows = 0;
  let motionLabMoveRows = 0;
  let externalMoveRows = 0;
  let externalMoveWarmupRows = 0;
  let externalMoveNonWarmupRows = 0;
  const externalMoveScenarios = {};
  const externalMoveNonWarmupScenarios = {};

  parseCsvText(
    buffer,
    (csvHeader) => {
      header = csvHeader;
    },
    (parts, rowIndex, column) => {
      rowCount = rowIndex;
      const event = parts[column.event] || "(empty)";
      addCount(eventCounts, event);
      const elapsedUs = numberOrNull(parts[column.elapsedMicroseconds]);
      const elapsedMs = Number.isFinite(elapsedUs) ? elapsedUs / 1000 : null;
      const scenarioIndex = scenarioFromElapsedMs(elapsedMs, scenarioDurationMs, scenarioCount);
      const warmup = boolValue(parts[column.warmupSample]);
      if (warmup) warmupRows += 1;
      if (parts[column.schedulerProvenance]) addCount(schedulerProvenanceCounts, parts[column.schedulerProvenance]);
      if (parts[column.runtimeSchedulerMissing]) addCount(runtimeSchedulerMissingCounts, parts[column.runtimeSchedulerMissing]);
      const sampleToTarget = numberOrNull(parts[column.sampleRecordedToPredictionTargetMicroseconds]);
      if (Number.isFinite(sampleToTarget)) sampleToTargetUs.push(sampleToTarget);

      const planned = numberOrNull(parts[column.runtimeSchedulerPlannedTickTicks]);
      const actual = numberOrNull(parts[column.runtimeSchedulerActualTickTicks]);
      if (Number.isFinite(planned) && Number.isFinite(actual)) {
        schedulerDelayMs.push(((actual - planned) / stopwatchFrequency) * 1000);
      }

      if (event !== "move") return;
      moveRows += 1;
      const extraInfo = numberOrNull(parts[column.hookExtraInfo]);
      addCount(extraInfoCounts, Number.isFinite(extraInfo) ? String(extraInfo) : "(missing)");
      if (extraInfo === MOTION_LAB_EXTRA_INFO) {
        motionLabMoveRows += 1;
        return;
      }

      externalMoveRows += 1;
      if (Number.isFinite(elapsedMs)) contaminationTimes.push(elapsedMs);
      if (scenarioIndex !== null) addCount(externalMoveScenarios, String(scenarioIndex));
      if (warmup) {
        externalMoveWarmupRows += 1;
      } else {
        externalMoveNonWarmupRows += 1;
        if (Number.isFinite(elapsedMs)) nonWarmContaminationTimes.push(elapsedMs);
        if (scenarioIndex !== null) addCount(externalMoveNonWarmupScenarios, String(scenarioIndex));
      }
    },
  );

  const contaminationWindows = buildIntervals(contaminationTimes, CONTAMINATION_NEAR_MS);
  const candidateProximity = countCleanTraceRows(buffer, motion, split, {
    dropScenarios: [],
    contaminationWindows,
  });
  const candidateDropScenario0 = countCleanTraceRows(buffer, motion, split, {
    dropScenarios: [0],
    contaminationWindows,
  });

  return {
    header,
    requiredV9FieldsPresent: Object.fromEntries(REQUIRED_TRACE_V9_FIELDS.map((field) => [field, header.includes(field)])),
    rowCount,
    eventCounts,
    warmupRows,
    moveRows,
    motionLabMoveRows,
    externalMoveRows,
    externalMoveWarmupRows,
    externalMoveNonWarmupRows,
    externalMoveScenarios,
    externalMoveNonWarmupScenarios,
    externalMoveElapsedMilliseconds: roundedStats(stats(contaminationTimes), 3),
    externalMoveNonWarmupElapsedMilliseconds: roundedStats(stats(nonWarmContaminationTimes), 3),
    extraInfoCounts,
    contaminationWindows,
    candidateCleaning: {
      proximityOnly: candidateProximity,
      dropScenario0PlusProximity: candidateDropScenario0,
    },
    schedulerProvenanceCounts,
    runtimeSchedulerMissingCounts,
    sampleRecordedToPredictionTargetMicroseconds: roundedStats(stats(sampleToTargetUs), 3),
    schedulerDelayMilliseconds: roundedStats(stats(schedulerDelayMs), 3),
  };
}

function countCleanTraceRows(buffer, motion, split, rule) {
  const scenarioDurationMs = motion.scenarioDurationMilliseconds || 12000;
  const scenarioCount = motion.scenarioCount || 64;
  const counts = emptyCleanCounts();
  parseCsvText(buffer, null, (parts, _rowIndex, column) => {
    const elapsedUs = numberOrNull(parts[column.elapsedMicroseconds]);
    const elapsedMs = Number.isFinite(elapsedUs) ? elapsedUs / 1000 : null;
    const scenarioIndex = scenarioFromElapsedMs(elapsedMs, scenarioDurationMs, scenarioCount);
    const warmup = boolValue(parts[column.warmupSample]);
    addCleanRow(counts, elapsedMs, scenarioIndex, warmup, rule, split);
  });
  return finalizeCleanCounts(counts);
}

function summarizeMotionSamples(opened, metadata, motion, split, finalRule) {
  const buffer = readZipEntry(opened, "motion-samples.csv");
  const scenarioDurationMs = motion.scenarioDurationMilliseconds || 12000;
  const scenarioCount = motion.scenarioCount || 64;
  const warmupMs = Number(metadata.WarmupDurationMilliseconds) || 0;
  const phaseCounts = {};
  const cleanPhaseCounts = {};
  const scenarioCounts = {};
  const cleanScenarioCounts = {};
  const velocityValues = [];
  const cleanVelocityValues = [];
  const cleanCounts = emptyCleanCounts();
  let header = [];
  let rowCount = 0;

  parseCsvText(
    buffer,
    (csvHeader) => {
      header = csvHeader;
    },
    (parts, rowIndex, column) => {
      rowCount = rowIndex;
      const elapsedMs = numberOrNull(parts[column.elapsedMilliseconds]);
      const scenarioIndex = numberOrNull(parts[column.scenarioIndex])
        ?? scenarioFromElapsedMs(elapsedMs, scenarioDurationMs, scenarioCount);
      const phase = parts[column.movementPhase] || "(missing)";
      const velocity = numberOrNull(parts[column.velocityPixelsPerSecond]);
      const warmup = Number.isFinite(elapsedMs) && elapsedMs < warmupMs;
      addCount(phaseCounts, phase);
      if (scenarioIndex !== null) addCount(scenarioCounts, String(scenarioIndex));
      if (Number.isFinite(velocity)) velocityValues.push(velocity);
      addCleanRow(cleanCounts, elapsedMs, scenarioIndex, warmup, finalRule, split);
      if (cleanPredicate(elapsedMs, scenarioIndex, warmup, finalRule)) {
        addCount(cleanPhaseCounts, phase);
        if (scenarioIndex !== null) addCount(cleanScenarioCounts, String(scenarioIndex));
        if (Number.isFinite(velocity)) cleanVelocityValues.push(velocity);
      }
    },
  );

  return {
    header,
    requiredV2FieldsPresent: Object.fromEntries(REQUIRED_MOTION_V2_FIELDS.map((field) => [field, header.includes(field)])),
    rowCount,
    phaseCounts,
    scenarioCounts,
    velocityPixelsPerSecond: roundedStats(stats(velocityValues), 3),
    clean: {
      ...finalizeCleanCounts(cleanCounts),
      phaseCounts: cleanPhaseCounts,
      scenarioCounts: cleanScenarioCounts,
      velocityPixelsPerSecond: roundedStats(stats(cleanVelocityValues), 3),
    },
  };
}

function emptyCleanCounts() {
  return {
    totalRows: 0,
    cleanRows: 0,
    excludedRows: 0,
    warmupExcludedRows: 0,
    contaminationWindowExcludedRows: 0,
    droppedScenarioExcludedRows: 0,
    bySplit: { train: 0, validation: 0, test: 0, unassigned: 0 },
    cleanBySplit: { train: 0, validation: 0, test: 0, unassigned: 0 },
    excludedBySplit: { train: 0, validation: 0, test: 0, unassigned: 0 },
  };
}

function addCleanRow(counts, elapsedMs, scenarioIndex, warmup, rule, split) {
  counts.totalRows += 1;
  const splitId = scenarioIndex === null ? "unassigned" : splitName(split, scenarioIndex);
  addCount(counts.bySplit, splitId);
  const droppedScenario = scenarioIndex !== null && rule.dropScenarios.includes(scenarioIndex);
  const contaminationWindow = inIntervals(elapsedMs, rule.contaminationWindows);
  if (warmup) counts.warmupExcludedRows += 1;
  if (droppedScenario) counts.droppedScenarioExcludedRows += 1;
  if (contaminationWindow) counts.contaminationWindowExcludedRows += 1;
  if (warmup || droppedScenario || contaminationWindow) {
    counts.excludedRows += 1;
    addCount(counts.excludedBySplit, splitId);
  } else {
    counts.cleanRows += 1;
    addCount(counts.cleanBySplit, splitId);
  }
}

function finalizeCleanCounts(counts) {
  return {
    totalRows: counts.totalRows,
    cleanRows: counts.cleanRows,
    excludedRows: counts.excludedRows,
    excludedPercent: round((counts.excludedRows / Math.max(1, counts.totalRows)) * 100, 4),
    warmupExcludedRows: counts.warmupExcludedRows,
    contaminationWindowExcludedRows: counts.contaminationWindowExcludedRows,
    droppedScenarioExcludedRows: counts.droppedScenarioExcludedRows,
    bySplit: counts.bySplit,
    cleanBySplit: counts.cleanBySplit,
    excludedBySplit: counts.excludedBySplit,
  };
}

function decideFinalRule(packageId, trace) {
  const windows = trace.contaminationWindows;
  if (packageId === "m070055") {
    return {
      id: "drop-scenario-0-plus-contamination-windows",
      dropScenarios: [0],
      contaminationWindows: windows,
      rationale: [
        "Non-warmup external move rows continue until roughly 2.46 s in the first scenario.",
        "Dropping the whole first scenario costs about 1/64 of one package and avoids training on an unknown recovery period.",
        "The contamination windows are retained in the manifest for transparency, but scenario 0 is the effective exclusion.",
      ],
    };
  }

  return {
    id: windows.length > 0 ? "warmup-plus-contamination-windows" : "warmup-only",
    dropScenarios: [],
    contaminationWindows: windows,
    rationale: windows.length > 0
      ? [
          `External move rows are sparse, so +/- ${CONTAMINATION_NEAR_MS} ms windows remove the local contamination without discarding a complete scenario.`,
        ]
      : ["No external move rows were found; only warmup rows are removed."],
  };
}

function auditPackage(root, target, split) {
  const zipPath = path.join(root, target.file);
  const stat = fs.statSync(zipPath);
  const opened = openZip(zipPath);
  const metadata = jsonEntry(opened, "metadata.json");
  const motionMetadata = jsonEntry(opened, "motion-metadata.json");
  const motion = motionMetadataSummary(motionMetadata);
  const script = jsonEntry(opened, "motion-script.json");
  const trace = summarizeTrace(opened, metadata, motion, split);
  const finalRule = decideFinalRule(target.id, trace);
  const traceClean = countCleanTraceRows(readZipEntry(opened, "trace.csv"), motion, split, finalRule);
  const motionSamples = summarizeMotionSamples(opened, metadata, motion, split, finalRule);
  const meta = metadataSummary(metadata, motionMetadata);

  return {
    id: target.id,
    sourceZip: target.file,
    relativePath: target.file,
    bytes: stat.size,
    entries: summarizeEntries(opened),
    metadata: meta,
    motionMetadata: motion,
    motionScript: summarizeMotionScript(script),
    trace,
    finalCleaningRule: finalRule,
    cleanTrace: traceClean,
    motionSamples,
    consistency: {
      traceFormatIsV9: meta.traceFormatVersion === 9,
      motionSampleFormatIsV2: meta.motionSampleFormatVersion === 2,
      traceRowsMatchMetadata: trace.rowCount === Number(metadata.SampleCount),
      motionScenarioCountIs64: motion.scenarioCount === 64,
      requiredTraceV9FieldsPresent: Object.values(trace.requiredV9FieldsPresent).every(Boolean),
      requiredMotionV2FieldsPresent: Object.values(motionSamples.requiredV2FieldsPresent).every(Boolean),
      dwmTimingFullyAvailable: Number(meta.dwmTimingAvailabilityPercent) === 100,
      timerResolutionSucceededAt1ms: Boolean(meta.timerResolutionSucceeded) && Number(meta.timerResolutionMilliseconds) === 1,
    },
  };
}

function packageScenarioAssignments(packages, split) {
  return packages.map((pkg) => {
    const dropped = new Set(pkg.finalCleaningRule.dropScenarios);
    const cleanScenarios = Array.from({ length: pkg.motionMetadata.scenarioCount }, (_, index) => index)
      .filter((index) => !dropped.has(index));
    const bySplit = { train: [], validation: [], test: [], unassigned: [] };
    for (const index of cleanScenarios) bySplit[splitName(split, index)].push(index);
    return {
      packageId: pkg.id,
      sourceZip: pkg.sourceZip,
      machineKey: pkg.metadata.machineKey,
      refreshBucket: pkg.metadata.refreshBucket,
      droppedScenarios: [...dropped].sort((a, b) => a - b),
      cleanScenarioCount: cleanScenarios.length,
      scenarioIndicesBySplit: bySplit,
      cleanTraceRowsBySplit: pkg.cleanTrace.cleanBySplit,
      cleanMotionRowsBySplit: pkg.motionSamples.clean.cleanBySplit,
    };
  });
}

function buildHoldoutManifest(packages) {
  const byPackage = packages.map((pkg) => holdoutEntry(`package:${pkg.id}`, [pkg.id], packages));
  const machineKeys = [...new Set(packages.map((pkg) => pkg.metadata.machineKey))].sort();
  const byMachine = machineKeys.map((key) => {
    const ids = packages.filter((pkg) => pkg.metadata.machineKey === key).map((pkg) => pkg.id);
    return holdoutEntry(`machine:${key}`, ids, packages);
  });
  const refreshBuckets = [...new Set(packages.map((pkg) => pkg.metadata.refreshBucket))].sort();
  const byRefresh = refreshBuckets.map((bucket) => {
    const ids = packages.filter((pkg) => pkg.metadata.refreshBucket === bucket).map((pkg) => pkg.id);
    return holdoutEntry(`refresh:${bucket}`, ids, packages);
  });
  return {
    packageHoldouts: byPackage,
    machineHoldouts: byMachine,
    refreshHoldouts: byRefresh,
  };
}

function holdoutEntry(id, testPackageIds, packages) {
  const testSet = new Set(testPackageIds);
  const trainPackages = packages.filter((pkg) => !testSet.has(pkg.id));
  const testPackages = packages.filter((pkg) => testSet.has(pkg.id));
  return {
    id,
    trainPackageIds: trainPackages.map((pkg) => pkg.id),
    testPackageIds: testPackages.map((pkg) => pkg.id),
    trainCleanMotionRows: trainPackages.reduce((sum, pkg) => sum + pkg.motionSamples.clean.cleanRows, 0),
    testCleanMotionRows: testPackages.reduce((sum, pkg) => sum + pkg.motionSamples.clean.cleanRows, 0),
    trainCleanTraceRows: trainPackages.reduce((sum, pkg) => sum + pkg.cleanTrace.cleanRows, 0),
    testCleanTraceRows: testPackages.reduce((sum, pkg) => sum + pkg.cleanTrace.cleanRows, 0),
  };
}

function buildStep1Scores(root, packages) {
  const consistencyItems = packages.flatMap((pkg) => Object.values(pkg.consistency));
  return {
    schemaVersion: `${SCHEMA_VERSION}/step-1`,
    generatedAtUtc: new Date().toISOString(),
    root,
    constraints: {
      gpuUsed: false,
      trainingRun: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
    },
    inputPackages: TARGET_PACKAGES,
    motionLabExtraInfo: MOTION_LAB_EXTRA_INFO,
    contaminationNearMilliseconds: CONTAMINATION_NEAR_MS,
    packages,
    summary: {
      packageCount: packages.length,
      totalDurationSeconds: round(packages.reduce((sum, pkg) => sum + (Number(pkg.metadata.durationMicroseconds) || 0), 0) / 1000000, 3),
      totalTraceRows: packages.reduce((sum, pkg) => sum + pkg.trace.rowCount, 0),
      totalMotionSampleRows: packages.reduce((sum, pkg) => sum + pkg.motionSamples.rowCount, 0),
      totalExternalMoveRows: packages.reduce((sum, pkg) => sum + pkg.trace.externalMoveRows, 0),
      totalExternalMoveNonWarmupRows: packages.reduce((sum, pkg) => sum + pkg.trace.externalMoveNonWarmupRows, 0),
      refreshBuckets: countBy(packages, (pkg) => pkg.metadata.refreshBucket),
      machineKeys: countBy(packages, (pkg) => pkg.metadata.machineKey),
      allConsistencyChecksPassed: consistencyItems.every(Boolean),
    },
  };
}

function buildStep2Scores(root, packages, split) {
  const assignments = packageScenarioAssignments(packages, split);
  const holdouts = buildHoldoutManifest(packages);
  return {
    schemaVersion: `${SCHEMA_VERSION}/step-2`,
    generatedAtUtc: new Date().toISOString(),
    root,
    constraints: {
      gpuUsed: false,
      trainingRun: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
    },
    cleaningPolicy: {
      motionLabExtraInfo: MOTION_LAB_EXTRA_INFO,
      contaminationNearMilliseconds: CONTAMINATION_NEAR_MS,
      globalRules: [
        "Drop rows with warmupSample=true in trace.csv.",
        "Drop motion-samples.csv rows whose elapsed time is inside metadata WarmupDurationMilliseconds.",
        `Treat trace.csv event=move rows with hookExtraInfo != ${MOTION_LAB_EXTRA_INFO} as external input contamination.`,
        `Drop all rows within +/- ${CONTAMINATION_NEAR_MS} ms of external move contamination windows.`,
        "For m070055, drop scenario 0 because non-warmup external input continues into the first scenario.",
      ],
      perPackageRules: Object.fromEntries(packages.map((pkg) => [pkg.id, pkg.finalCleaningRule])),
    },
    baseScenarioSplit: {
      method: split.method,
      seed: split.seed,
      ratio: split.ratio,
      scenarioCount: split.scenarioCount,
      counts: split.counts,
      train: split.train,
      validation: split.validation,
      test: split.test,
      selectionOrder: split.selectionOrder,
    },
    packageScenarioAssignments: assignments,
    holdouts,
    totals: {
      cleanTraceRows: packages.reduce((sum, pkg) => sum + pkg.cleanTrace.cleanRows, 0),
      excludedTraceRows: packages.reduce((sum, pkg) => sum + pkg.cleanTrace.excludedRows, 0),
      cleanMotionRows: packages.reduce((sum, pkg) => sum + pkg.motionSamples.clean.cleanRows, 0),
      excludedMotionRows: packages.reduce((sum, pkg) => sum + pkg.motionSamples.clean.excludedRows, 0),
      cleanMotionRowsBySplit: mergeCountObjects(packages.map((pkg) => pkg.motionSamples.clean.cleanBySplit)),
      cleanTraceRowsBySplit: mergeCountObjects(packages.map((pkg) => pkg.cleanTrace.cleanBySplit)),
    },
  };
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) addCount(result, keyFn(item));
  return result;
}

function mergeCountObjects(objects) {
  const result = {};
  for (const object of objects) {
    for (const [key, value] of Object.entries(object)) addCount(result, key, value);
  }
  return result;
}

function table(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, index) => Math.max(...all.map((row) => String(row[index] ?? "").length)));
  const format = (row) => `| ${row.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join(" | ")} |`;
  return [
    format(headers),
    format(headers.map((_, index) => "-".repeat(widths[index]))),
    ...rows.map(format),
  ].join("\n");
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (typeof value === "number") return String(round(value, digits));
  return String(value);
}

function renderStep1Report(scores) {
  const packageRows = scores.packages.map((pkg) => [
    pkg.id,
    pkg.sourceZip,
    pkg.metadata.traceFormatVersion,
    pkg.metadata.motionSampleFormatVersion,
    pkg.metadata.processorCount,
    `${pkg.metadata.virtualScreen.width}x${pkg.metadata.virtualScreen.height}`,
    pkg.metadata.refreshBucket,
    pkg.metadata.dwmTimingAvailabilityPercent,
    pkg.metadata.timerResolutionSucceeded ? `${pkg.metadata.timerResolutionMilliseconds}ms` : "failed",
  ]);
  const traceRows = scores.packages.map((pkg) => [
    pkg.id,
    pkg.trace.rowCount,
    pkg.trace.eventCounts.move || 0,
    pkg.trace.eventCounts.poll || 0,
    pkg.trace.eventCounts.referencePoll || 0,
    pkg.trace.eventCounts.runtimeSchedulerPoll || 0,
    pkg.trace.externalMoveRows,
    pkg.trace.externalMoveNonWarmupRows,
    fmt(pkg.trace.externalMoveNonWarmupElapsedMilliseconds.max),
  ]);
  const motionRows = scores.packages.map((pkg) => [
    pkg.id,
    pkg.motionSamples.rowCount,
    pkg.motionSamples.phaseCounts.moving || 0,
    pkg.motionSamples.phaseCounts.hold || 0,
    pkg.motionSamples.phaseCounts.resume || 0,
    fmt(pkg.motionSamples.velocityPixelsPerSecond.p95),
    fmt(pkg.motionSamples.velocityPixelsPerSecond.max),
  ]);
  const candidateRows = scores.packages.map((pkg) => [
    pkg.id,
    pkg.trace.candidateCleaning.proximityOnly.excludedRows,
    fmt(pkg.trace.candidateCleaning.proximityOnly.excludedPercent, 4),
    pkg.trace.candidateCleaning.dropScenario0PlusProximity.excludedRows,
    fmt(pkg.trace.candidateCleaning.dropScenario0PlusProximity.excludedPercent, 4),
    pkg.finalCleaningRule.id,
  ]);

  return `# Step 1 Data Audit

## Scope

This step audits the four v9 Motion Lab recordings supplied for POC 12. It reads the repository-root ZIP files directly and stores only small Markdown and JSON summaries under \`poc/cursor-prediction-v12/\`.

No training, GPU work, long benchmark, raw ZIP copy, or expanded CSV cache was performed.

## Package Metadata

${table(["id", "zip", "trace fmt", "motion fmt", "cpu", "screen", "refresh", "DWM %", "timer"], packageRows)}

All four packages are TraceFormatVersion 9 and MotionSampleFormatVersion 2. The set covers ${Object.keys(scores.summary.machineKeys).length} machine fingerprints and ${Object.keys(scores.summary.refreshBuckets).join(" / ")} refresh buckets.

## Trace Audit

${table(["id", "rows", "move", "poll", "reference", "scheduler", "external move", "non-warm external", "max nonwarm ms"], traceRows)}

The MotionLab-generated mouse marker is \`${MOTION_LAB_EXTRA_INFO}\`. Rows where \`event=move\` and \`hookExtraInfo\` differs from that marker are treated as external user-input contamination.

## Motion Samples

${table(["id", "rows", "moving", "hold", "resume", "velocity p95", "velocity max"], motionRows)}

The v2 motion-sample fields \`movementPhase\`, \`holdIndex\`, and \`phaseElapsedMilliseconds\` are present in all packages, so later steps can evaluate hold/resume behavior without reconstructing phase labels from the script.

## Cleaning Candidate Check

${table(["id", "proximity excluded", "proximity %", "drop scen0 excluded", "drop scen0 %", "final rule"], candidateRows)}

\`m070055\` has non-warmup external moves continuing into the first scenario, up to about ${fmt(scores.packages.find((pkg) => pkg.id === "m070055")?.trace.externalMoveNonWarmupElapsedMilliseconds.max)} ms. The final rule drops scenario 0 for that package rather than trusting a narrow local window. Other packages use warmup removal plus sparse contamination windows where needed.

## Consistency

- Trace rows match \`metadata.json SampleCount\` for all packages: ${scores.packages.every((pkg) => pkg.consistency.traceRowsMatchMetadata) ? "yes" : "no"}.
- Required v9 trace fields are present for all packages: ${scores.packages.every((pkg) => pkg.consistency.requiredTraceV9FieldsPresent) ? "yes" : "no"}.
- Required v2 motion fields are present for all packages: ${scores.packages.every((pkg) => pkg.consistency.requiredMotionV2FieldsPresent) ? "yes" : "no"}.
- DWM timing availability is 100% for all packages: ${scores.packages.every((pkg) => pkg.consistency.dwmTimingFullyAvailable) ? "yes" : "no"}.
- 1 ms timer resolution succeeded for all packages: ${scores.packages.every((pkg) => pkg.consistency.timerResolutionSucceededAt1ms) ? "yes" : "no"}.

## Step 2 Handoff

Use the cleaning policy in \`step-2-clean-split/split-manifest.json\`. The later modeling scripts should load rows lazily from the source ZIP files and apply the manifest filters instead of materializing cleaned CSV files.
`;
}

function renderStep1Notes(scores) {
  const contaminated = scores.packages
    .filter((pkg) => pkg.trace.externalMoveRows > 0)
    .map((pkg) => `- ${pkg.id}: ${pkg.trace.externalMoveRows} external move rows, ${pkg.trace.externalMoveNonWarmupRows} after warmup, scenarios ${Object.keys(pkg.trace.externalMoveNonWarmupScenarios).join(", ") || "none"}.`)
    .join("\n");
  return `# Step 1 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v12\\scripts\\audit-and-split.js
\`\`\`

## Contamination Findings

${contaminated || "No external move rows were found."}

The exclusion marker is intentionally strict: only \`event=move\` rows with \`hookExtraInfo == ${MOTION_LAB_EXTRA_INFO}\` are trusted as MotionLab-generated cursor motion. The trace can still contain poll/reference/scheduler rows around contamination, so the cleaning manifest drops nearby time windows as well.

## Why m070055 Drops Scenario 0

The \`m070055\` contamination is not limited to warmup. It continues into the first scenario and reaches ${fmt(scores.packages.find((pkg) => pkg.id === "m070055")?.trace.externalMoveNonWarmupElapsedMilliseconds.max)} ms. A narrow window would keep the rest of scenario 0, but the early recovery period could still contain position-history artifacts. Dropping one scenario from one package is cheaper and cleaner.

## Data Hygiene

No raw ZIP, expanded CSV, sample-level cache, checkpoint, or model artifact is written by this step. The script only emits JSON/Markdown summaries and a split manifest.
`;
}

function renderStep2Report(scores) {
  const assignmentRows = scores.packageScenarioAssignments.map((item) => [
    item.packageId,
    item.refreshBucket,
    item.droppedScenarios.join(", ") || "none",
    item.cleanScenarioCount,
    item.cleanMotionRowsBySplit.train || 0,
    item.cleanMotionRowsBySplit.validation || 0,
    item.cleanMotionRowsBySplit.test || 0,
  ]);
  const holdoutRows = [
    ...scores.holdouts.machineHoldouts.map((item) => [item.id, item.trainPackageIds.join(", "), item.testPackageIds.join(", "), item.trainCleanMotionRows, item.testCleanMotionRows]),
    ...scores.holdouts.refreshHoldouts.map((item) => [item.id, item.trainPackageIds.join(", "), item.testPackageIds.join(", "), item.trainCleanMotionRows, item.testCleanMotionRows]),
  ];

  return `# Step 2 Clean Split

## Scope

This step defines the reusable cleaning and split manifest for POC 12. It does not train a model; it makes later model evaluation deterministic and leak-resistant.

## Cleaning Policy

- Drop trace rows with \`warmupSample=true\`.
- Drop motion-sample rows before \`WarmupDurationMilliseconds\`.
- Treat \`event=move\` with \`hookExtraInfo != ${MOTION_LAB_EXTRA_INFO}\` as external input contamination.
- Drop all rows inside +/- ${CONTAMINATION_NEAR_MS} ms contamination windows.
- Drop scenario 0 from \`m070055\`.

## Base Scenario Split

The base split is scenario-unit and uses the same stable shuffle as earlier POCs:

- Train (${scores.baseScenarioSplit.counts.train}): ${scores.baseScenarioSplit.train.join(", ")}
- Validation (${scores.baseScenarioSplit.counts.validation}): ${scores.baseScenarioSplit.validation.join(", ")}
- Test (${scores.baseScenarioSplit.counts.test}): ${scores.baseScenarioSplit.test.join(", ")}

Scenario-level splitting avoids leaking adjacent 4.167 ms rows from the same generated curve into evaluation.

## Package Assignments

${table(["pkg", "refresh", "dropped", "clean scenarios", "train motion", "val motion", "test motion"], assignmentRows)}

## Holdout Evaluation Manifests

${table(["holdout", "train packages", "test packages", "train motion rows", "test motion rows"], holdoutRows)}

Machine holdout is keyed by the observable runtime fingerprint: CPU count, virtual screen size, monitor count, and refresh bucket. Refresh holdout separates 30Hz from 60Hz packages.

## Totals

- Clean trace rows: ${scores.totals.cleanTraceRows}
- Excluded trace rows: ${scores.totals.excludedTraceRows}
- Clean motion rows: ${scores.totals.cleanMotionRows}
- Excluded motion rows: ${scores.totals.excludedMotionRows}

## Next Experiment

Step 3 should re-run deterministic product baselines on this exact manifest, then check whether v9 timing targets reduce the one-sided lag bias before re-opening heavier model search.
`;
}

function renderStep2Notes(scores) {
  return `# Step 2 Notes

## Manifest Files

- \`scores.json\`: full Step 2 scores plus cleaning and split definitions.
- \`split-manifest.json\`: compact manifest intended for downstream model scripts.

## Leakage Rules

Do not sample-randomize rows across train/validation/test. The generated cursor path is temporally dense and scenario-local, so sample-level randomization would put nearly identical neighboring positions into different splits.

For machine and refresh holdouts, the holdout package/group is the test set. The non-holdout packages can still use the base scenario split internally for training/validation selection.

## Downstream Loader Contract

A downstream loader should:

1. Read source ZIP files from the repository root.
2. Apply per-package \`dropScenarios\`.
3. Drop warmup rows.
4. Drop rows inside per-package contamination windows.
5. Attach \`baseScenarioSplit\`, \`machineKey\`, and \`refreshBucket\` labels from the manifest.

This keeps POC 12 reproducible without storing large derived datasets in git.
`;
}

function renderReadme() {
  return `# Cursor Prediction v12

POC 12 starts from four v9 Motion Lab recordings captured after the user-input blocking countermeasure.

The first phase audits the data, removes warmup and external-input contamination, and creates scenario-level split manifests for normal train/validation/test, machine holdout, and 30/60Hz refresh holdout evaluation.

Artifacts:

- \`step-1-data-audit/report.md\`: data and contamination audit.
- \`step-1-data-audit/scores.json\`: machine-readable audit summary.
- \`step-1-data-audit/notes.md\`: detailed cleaning rationale.
- \`step-2-clean-split/report.md\`: split and holdout report.
- \`step-2-clean-split/scores.json\`: machine-readable split scores.
- \`step-2-clean-split/split-manifest.json\`: compact downstream manifest.
- \`step-2-clean-split/notes.md\`: loader contract and leakage notes.
- \`scripts/audit-and-split.js\`: reproducible audit/split script.

No raw ZIP files, expanded CSV files, model checkpoints, or large intermediate datasets are stored in this directory.
`;
}

function compactManifest(step2) {
  return {
    schemaVersion: `${SCHEMA_VERSION}/split-manifest`,
    generatedAtUtc: step2.generatedAtUtc,
    cleaningPolicy: step2.cleaningPolicy,
    baseScenarioSplit: step2.baseScenarioSplit,
    packageScenarioAssignments: step2.packageScenarioAssignments,
    holdouts: step2.holdouts,
  };
}

function writeOutputs(root, outDir, step1, step2) {
  const step1Dir = path.join(outDir, "step-1-data-audit");
  const step2Dir = path.join(outDir, "step-2-clean-split");
  ensureDir(step1Dir);
  ensureDir(step2Dir);

  fs.writeFileSync(path.join(outDir, "README.md"), renderReadme(), "utf8");
  fs.writeFileSync(path.join(step1Dir, "scores.json"), JSON.stringify(step1, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(step1Dir, "report.md"), renderStep1Report(step1), "utf8");
  fs.writeFileSync(path.join(step1Dir, "notes.md"), renderStep1Notes(step1), "utf8");
  fs.writeFileSync(path.join(step2Dir, "scores.json"), JSON.stringify(step2, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(step2Dir, "split-manifest.json"), JSON.stringify(compactManifest(step2), null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(step2Dir, "report.md"), renderStep2Report(step2), "utf8");
  fs.writeFileSync(path.join(step2Dir, "notes.md"), renderStep2Notes(step2), "utf8");

  const outputs = [
    path.join(outDir, "README.md"),
    path.join(step1Dir, "scores.json"),
    path.join(step1Dir, "report.md"),
    path.join(step1Dir, "notes.md"),
    path.join(step2Dir, "scores.json"),
    path.join(step2Dir, "split-manifest.json"),
    path.join(step2Dir, "report.md"),
    path.join(step2Dir, "notes.md"),
  ];
  process.stdout.write(`Wrote:\n${outputs.map((item) => path.relative(root, item).replaceAll(path.sep, "/")).join("\n")}\n`);
}

function main() {
  const args = parseArgs(process.argv);
  const split = stableScenarioSplit(64);
  const packages = TARGET_PACKAGES.map((target) => auditPackage(args.root, target, split));
  const step1 = buildStep1Scores(args.root, packages);
  const step2 = buildStep2Scores(args.root, packages, split);
  writeOutputs(args.root, args.outDir, step1, step2);
}

main();
