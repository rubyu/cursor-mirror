#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SCHEMA_VERSION = "cursor-prediction-v12-step3-step4/1";
const HISTOGRAM_BIN_PX = 0.25;
const HISTOGRAM_MAX_PX = 512;
const HISTOGRAM_BINS = Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 1;
const MAX_LABEL_BRACKET_GAP_US = 60000;
const REGRESSION_THRESHOLDS_PX = [1, 2, 5, 10];
const TARGET_EVENTS = ["poll", "runtimeSchedulerPoll"];

const HORIZON_MODES = [
  { id: "fixed_8ms", label: "fixed 8 ms", kind: "fixed", milliseconds: 8 },
  { id: "fixed_16p67ms", label: "fixed 16.67 ms", kind: "fixed", milliseconds: 16.67 },
  { id: "v9_target", label: "v9 prediction target", kind: "target" },
  { id: "v9_present_corrected", label: "v9 present advanced to future vblank", kind: "presentCorrected" },
];

const BASELINES = [
  {
    id: "constant_position",
    family: "constant_position",
    productEligible: true,
    description: "Hold the most recent causal referencePoll position.",
    params: {},
  },
  {
    id: "product_current_cv_gain100_cap12_24_hcap10_offset2",
    family: "last2_constant_velocity",
    productEligible: true,
    productEquivalent: true,
    description: "Approximation of current production ConstantVelocity: gain 100%, target offset +2 ms, horizon cap 10 ms, 12 px cap with a 24 px high-speed linear cap.",
    params: { gain: 1, capPx: 12, highSpeedCapPx: 24, horizonCapMs: 10, targetOffsetMs: 2, highSpeedThreshold: 2400 },
  },
  {
    id: "last2_cv_gain75_cap12",
    family: "last2_constant_velocity",
    productEligible: true,
    description: "Last-two velocity, gain 75%, 12 px cap.",
    params: { gain: 0.75, capPx: 12 },
  },
  {
    id: "last2_cv_gain100_cap12",
    family: "last2_constant_velocity",
    productEligible: true,
    description: "Last-two velocity, gain 100%, 12 px cap.",
    params: { gain: 1, capPx: 12 },
  },
  {
    id: "last2_cv_gain125_cap12",
    family: "last2_constant_velocity",
    productEligible: true,
    description: "Last-two velocity, gain 125%, 12 px cap.",
    params: { gain: 1.25, capPx: 12 },
  },
  {
    id: "last2_cv_gain100_cap24",
    family: "last2_constant_velocity",
    productEligible: true,
    description: "Last-two velocity, gain 100%, 24 px cap.",
    params: { gain: 1, capPx: 24 },
  },
  {
    id: "last2_cv_gain125_cap24",
    family: "last2_constant_velocity",
    productEligible: true,
    description: "Last-two velocity, gain 125%, 24 px cap.",
    params: { gain: 1.25, capPx: 24 },
  },
  {
    id: "last2_cv_gain100_cap48",
    family: "last2_constant_velocity",
    productEligible: true,
    description: "Last-two velocity, gain 100%, 48 px cap.",
    params: { gain: 1, capPx: 48 },
  },
  ...[3, 5, 8, 12].map((samples) => ({
    id: `least_squares_n${samples}_gain100_cap24`,
    family: "least_squares",
    productEligible: true,
    description: `Least-squares velocity over the last ${samples} referencePoll samples, gain 100%, 24 px cap.`,
    params: { samples, gain: 1, capPx: 24 },
  })),
  ...[3, 5, 8, 12].map((samples) => ({
    id: `least_squares_n${samples}_gain100_cap48`,
    family: "least_squares",
    productEligible: true,
    description: `Least-squares velocity over the last ${samples} referencePoll samples, gain 100%, 48 px cap.`,
    params: { samples, gain: 1, capPx: 48 },
  })),
  {
    id: "least_squares_n8_gain75_cap24",
    family: "least_squares",
    productEligible: true,
    description: "Least-squares n8, gain 75%, 24 px cap.",
    params: { samples: 8, gain: 0.75, capPx: 24 },
  },
  {
    id: "least_squares_n8_gain125_cap24",
    family: "least_squares",
    productEligible: true,
    description: "Least-squares n8, gain 125%, 24 px cap.",
    params: { samples: 8, gain: 1.25, capPx: 24 },
  },
];

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  const outDir = path.resolve(scriptDir, "..");
  const manifest = path.resolve(scriptDir, "..", "step-2-clean-split", "split-manifest.json");
  const args = { root, outDir, manifest };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--manifest") args.manifest = path.resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v12\\scripts\\run-step3-step4.js [--root <repo>] [--out-dir <dir>] [--manifest <json>]
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

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function addCount(map, key, increment = 1) {
  map[key] = (map[key] || 0) + increment;
}

function scenarioFromElapsedMs(elapsedMs, scenarioDurationMs, scenarioCount) {
  if (!Number.isFinite(elapsedMs)) return null;
  const raw = Math.floor(elapsedMs / Math.max(1, scenarioDurationMs));
  return Math.max(0, Math.min(Math.max(0, scenarioCount - 1), raw));
}

function inIntervals(elapsedMs, intervals) {
  if (!Number.isFinite(elapsedMs)) return false;
  for (const interval of intervals || []) {
    if (elapsedMs >= interval.startMs && elapsedMs <= interval.endMs) return true;
  }
  return false;
}

function buildSplitMap(split) {
  const map = new Map();
  for (const index of split.train || []) map.set(index, "train");
  for (const index of split.validation || []) map.set(index, "validation");
  for (const index of split.test || []) map.set(index, "test");
  return map;
}

function splitName(splitMap, scenarioIndex) {
  return splitMap.get(scenarioIndex) || "unassigned";
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

function magnitude(x, y) {
  return Math.sqrt((x * x) + (y * y));
}

function clampVector(dx, dy, maximumMagnitude) {
  if (!Number.isFinite(maximumMagnitude) || maximumMagnitude <= 0) return { dx, dy };
  const mag = magnitude(dx, dy);
  if (mag <= maximumMagnitude || mag <= 0) return { dx, dy };
  const scale = maximumMagnitude / mag;
  return { dx: dx * scale, dy: dy * scale };
}

function percentileFromHistogram(histogram, count, p) {
  if (count <= 0) return null;
  const target = Math.max(1, Math.ceil(count * p));
  let cumulative = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= target) return i * HISTOGRAM_BIN_PX;
  }
  return HISTOGRAM_MAX_PX;
}

function createErrorAccumulator() {
  return {
    count: 0,
    sum: 0,
    sumSquares: 0,
    max: 0,
    histogram: new Uint32Array(HISTOGRAM_BINS),
    regressions: Object.fromEntries(REGRESSION_THRESHOLDS_PX.map((threshold) => [`gt${threshold}px`, 0])),
    signedCount: 0,
    signedSum: 0,
    signedAbsSum: 0,
    lagCount: 0,
    leadCount: 0,
  };
}

function addError(acc, error, signedAlongMotion) {
  acc.count += 1;
  acc.sum += error;
  acc.sumSquares += error * error;
  acc.max = Math.max(acc.max, error);
  const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(error / HISTOGRAM_BIN_PX)));
  acc.histogram[bin] += 1;
  for (const threshold of REGRESSION_THRESHOLDS_PX) {
    if (error > threshold) acc.regressions[`gt${threshold}px`] += 1;
  }
  if (Number.isFinite(signedAlongMotion)) {
    acc.signedCount += 1;
    acc.signedSum += signedAlongMotion;
    acc.signedAbsSum += Math.abs(signedAlongMotion);
    if (signedAlongMotion < 0) acc.lagCount += 1;
    else if (signedAlongMotion > 0) acc.leadCount += 1;
  }
}

function finalizeError(acc) {
  if (!acc || acc.count === 0) {
    return {
      count: 0,
      mean: null,
      median: null,
      p95: null,
      p99: null,
      max: null,
      rmse: null,
      regressionRates: Object.fromEntries(REGRESSION_THRESHOLDS_PX.map((threshold) => [`gt${threshold}px`, null])),
      signedAlongMotion: { count: 0, mean: null, meanAbs: null, lagRate: null, leadRate: null },
    };
  }
  return {
    count: acc.count,
    mean: round(acc.sum / acc.count),
    median: round(percentileFromHistogram(acc.histogram, acc.count, 0.5)),
    p95: round(percentileFromHistogram(acc.histogram, acc.count, 0.95)),
    p99: round(percentileFromHistogram(acc.histogram, acc.count, 0.99)),
    max: round(acc.max),
    rmse: round(Math.sqrt(acc.sumSquares / acc.count)),
    regressionRates: Object.fromEntries(REGRESSION_THRESHOLDS_PX.map((threshold) => {
      const key = `gt${threshold}px`;
      return [key, round(acc.regressions[key] / acc.count, 6)];
    })),
    signedAlongMotion: {
      count: acc.signedCount,
      mean: acc.signedCount ? round(acc.signedSum / acc.signedCount) : null,
      meanAbs: acc.signedCount ? round(acc.signedAbsSum / acc.signedCount) : null,
      lagRate: acc.signedCount ? round(acc.lagCount / acc.signedCount, 6) : null,
      leadRate: acc.signedCount ? round(acc.leadCount / acc.signedCount, 6) : null,
    },
  };
}

function createValueAccumulator() {
  return { values: [] };
}

function addValue(acc, value) {
  if (Number.isFinite(value)) acc.values.push(value);
}

function finalizeValue(acc) {
  const data = acc.values.filter(Number.isFinite).sort((a, b) => a - b);
  if (data.length === 0) {
    return { count: 0, mean: null, min: null, p50: null, p90: null, p95: null, p99: null, max: null };
  }
  let sum = 0;
  for (const value of data) sum += value;
  return {
    count: data.length,
    mean: round(sum / data.length),
    min: round(data[0]),
    p50: round(percentile(data, 0.5)),
    p90: round(percentile(data, 0.9)),
    p95: round(percentile(data, 0.95)),
    p99: round(percentile(data, 0.99)),
    max: round(data[data.length - 1]),
  };
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

class ScoreStore {
  constructor() {
    this.maps = {
      overall: new Map(),
      bySplit: new Map(),
      bySplitAnchorHorizon: new Map(),
      byRefresh: new Map(),
      byMachine: new Map(),
      byPackage: new Map(),
      byHoldout: new Map(),
    };
  }

  add(section, keyParts, meta, error, signedAlongMotion) {
    const key = keyParts.map(String).join("|");
    let entry = this.maps[section].get(key);
    if (!entry) {
      entry = { ...meta, accumulator: createErrorAccumulator() };
      this.maps[section].set(key, entry);
    }
    addError(entry.accumulator, error, signedAlongMotion);
  }

  addObservation(model, anchor, mode, error, signedAlongMotion, holdouts) {
    const meta = {
      modelId: model.id,
      modelFamily: model.family,
      productEligible: model.productEligible,
      productEquivalent: Boolean(model.productEquivalent),
      horizonMode: mode.id,
      anchorEvent: anchor.event,
    };
    this.add("overall", [model.id, mode.id, anchor.event], meta, error, signedAlongMotion);
    this.add("bySplit", [model.id, mode.id, anchor.event, anchor.split], { ...meta, split: anchor.split }, error, signedAlongMotion);
    this.add("bySplitAnchorHorizon", [model.id, mode.id, anchor.event, anchor.split, anchor.refreshBucket], {
      ...meta,
      split: anchor.split,
      refreshBucket: anchor.refreshBucket,
    }, error, signedAlongMotion);
    this.add("byRefresh", [model.id, mode.id, anchor.event, anchor.split, anchor.refreshBucket], {
      ...meta,
      split: anchor.split,
      refreshBucket: anchor.refreshBucket,
    }, error, signedAlongMotion);
    this.add("byMachine", [model.id, mode.id, anchor.event, anchor.split, anchor.machineKey], {
      ...meta,
      split: anchor.split,
      machineKey: anchor.machineKey,
    }, error, signedAlongMotion);
    this.add("byPackage", [model.id, mode.id, anchor.event, anchor.split, anchor.packageId], {
      ...meta,
      split: anchor.split,
      packageId: anchor.packageId,
      refreshBucket: anchor.refreshBucket,
      machineKey: anchor.machineKey,
    }, error, signedAlongMotion);

    for (const holdout of holdouts) {
      const role = holdout.testPackageIdSet.has(anchor.packageId) ? "test" : "train";
      this.add("byHoldout", [model.id, mode.id, anchor.event, holdout.id, role], {
        ...meta,
        holdoutId: holdout.id,
        holdoutKind: holdout.kind,
        holdoutRole: role,
      }, error, signedAlongMotion);
    }
  }

  finalizeMap(name) {
    return [...this.maps[name].values()].map((entry) => {
      const { accumulator, ...meta } = entry;
      return { ...meta, error: finalizeError(accumulator) };
    }).sort(scoreSort);
  }

  finalize() {
    return Object.fromEntries(Object.keys(this.maps).map((name) => [name, this.finalizeMap(name)]));
  }
}

function scoreSort(a, b) {
  return String(a.modelId).localeCompare(String(b.modelId))
    || String(a.horizonMode || "").localeCompare(String(b.horizonMode || ""))
    || String(a.anchorEvent || "").localeCompare(String(b.anchorEvent || ""))
    || String(a.split || "").localeCompare(String(b.split || ""))
    || String(a.refreshBucket || "").localeCompare(String(b.refreshBucket || ""))
    || String(a.machineKey || "").localeCompare(String(b.machineKey || ""))
    || String(a.packageId || "").localeCompare(String(b.packageId || ""))
    || String(a.holdoutId || "").localeCompare(String(b.holdoutId || ""))
    || String(a.holdoutRole || "").localeCompare(String(b.holdoutRole || ""));
}

class TimingStore {
  constructor() {
    this.maps = {
      overall: new Map(),
      byEventRefresh: new Map(),
      byEventRefreshProvenance: new Map(),
      byPackage: new Map(),
    };
    this.counts = {
      anchorRows: 0,
      cleanAnchorRows: 0,
      targetTicksAvailable: 0,
      presentTicksAvailable: 0,
      targetResolvedRows: 0,
      presentCorrectedRows: 0,
      targetLateRows: 0,
      presentRawPastRows: 0,
      predictionTargetMissingRows: 0,
    };
  }

  addAnchor(anchor) {
    this.counts.cleanAnchorRows += 1;
    if (Number.isFinite(anchor.predictionTargetTicks)) this.counts.targetTicksAvailable += 1;
    else this.counts.predictionTargetMissingRows += 1;
    if (Number.isFinite(anchor.presentReferenceTicks)) this.counts.presentTicksAvailable += 1;
    const target = resolveTargetTicks(anchor);
    const present = resolvePresentCorrectedTicks(anchor);
    if (target) {
      this.counts.targetResolvedRows += 1;
      if (target.horizonMs <= 0) this.counts.targetLateRows += 1;
    }
    if (present) this.counts.presentCorrectedRows += 1;
    const rawPresentMs = Number.isFinite(anchor.presentReferenceTicks)
      ? ticksToMs(anchor.presentReferenceTicks - anchor.stopwatchTicks, anchor.stopwatchFrequency)
      : null;
    if (Number.isFinite(rawPresentMs) && rawPresentMs <= 0) this.counts.presentRawPastRows += 1;

    const values = {
      targetHorizonMs: target ? target.horizonMs : null,
      presentRawHorizonMs: rawPresentMs,
      presentCorrectedHorizonMs: present ? present.horizonMs : null,
      targetMinusRawPresentMs: target && Number.isFinite(anchor.presentReferenceTicks)
        ? ticksToMs(target.ticks - anchor.presentReferenceTicks, anchor.stopwatchFrequency)
        : null,
      targetMinusCorrectedPresentMs: target && present
        ? ticksToMs(target.ticks - present.ticks, anchor.stopwatchFrequency)
        : null,
      sampleRecordedToPredictionTargetMicroseconds: anchor.sampleRecordedToPredictionTargetMicroseconds,
    };
    this.add("overall", ["all"], {}, values);
    this.add("byEventRefresh", [anchor.event, anchor.refreshBucket], {
      anchorEvent: anchor.event,
      refreshBucket: anchor.refreshBucket,
    }, values);
    this.add("byEventRefreshProvenance", [anchor.event, anchor.refreshBucket, anchor.schedulerProvenance || "(blank)"], {
      anchorEvent: anchor.event,
      refreshBucket: anchor.refreshBucket,
      schedulerProvenance: anchor.schedulerProvenance || "(blank)",
    }, values);
    this.add("byPackage", [anchor.packageId, anchor.event], {
      packageId: anchor.packageId,
      anchorEvent: anchor.event,
      refreshBucket: anchor.refreshBucket,
      machineKey: anchor.machineKey,
    }, values);
  }

  add(section, keyParts, meta, values) {
    const key = keyParts.map(String).join("|");
    let entry = this.maps[section].get(key);
    if (!entry) {
      entry = {
        ...meta,
        targetHorizonMs: createValueAccumulator(),
        presentRawHorizonMs: createValueAccumulator(),
        presentCorrectedHorizonMs: createValueAccumulator(),
        targetMinusRawPresentMs: createValueAccumulator(),
        targetMinusCorrectedPresentMs: createValueAccumulator(),
        sampleRecordedToPredictionTargetMicroseconds: createValueAccumulator(),
      };
      this.maps[section].set(key, entry);
    }
    for (const name of [
      "targetHorizonMs",
      "presentRawHorizonMs",
      "presentCorrectedHorizonMs",
      "targetMinusRawPresentMs",
      "targetMinusCorrectedPresentMs",
      "sampleRecordedToPredictionTargetMicroseconds",
    ]) {
      addValue(entry[name], values[name]);
    }
  }

  finalizeMap(name) {
    return [...this.maps[name].values()].map((entry) => ({
      ...Object.fromEntries(Object.entries(entry).filter(([, value]) => !value || !Array.isArray(value.values))),
      targetHorizonMs: finalizeValue(entry.targetHorizonMs),
      presentRawHorizonMs: finalizeValue(entry.presentRawHorizonMs),
      presentCorrectedHorizonMs: finalizeValue(entry.presentCorrectedHorizonMs),
      targetMinusRawPresentMs: finalizeValue(entry.targetMinusRawPresentMs),
      targetMinusCorrectedPresentMs: finalizeValue(entry.targetMinusCorrectedPresentMs),
      sampleRecordedToPredictionTargetMicroseconds: finalizeValue(entry.sampleRecordedToPredictionTargetMicroseconds),
    })).sort((a, b) => String(a.anchorEvent || "").localeCompare(String(b.anchorEvent || ""))
      || String(a.refreshBucket || "").localeCompare(String(b.refreshBucket || ""))
      || String(a.schedulerProvenance || "").localeCompare(String(b.schedulerProvenance || ""))
      || String(a.packageId || "").localeCompare(String(b.packageId || "")));
  }

  finalize() {
    return {
      counts: this.counts,
      sections: Object.fromEntries(Object.keys(this.maps).map((name) => [name, this.finalizeMap(name)])),
    };
  }
}

function loadManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const splitMap = buildSplitMap(manifest.baseScenarioSplit);
  const packageById = new Map(manifest.packageScenarioAssignments.map((item) => [item.packageId, item]));
  const holdouts = [
    ...(manifest.holdouts?.machineHoldouts || []).map((item) => ({ ...item, kind: "machine" })),
    ...(manifest.holdouts?.refreshHoldouts || []).map((item) => ({ ...item, kind: "refresh" })),
  ].map((item) => ({
    ...item,
    testPackageIdSet: new Set(item.testPackageIds || []),
  }));
  return { manifest, splitMap, packageById, holdouts };
}

function cleanTime(elapsedMs, scenarioIndex, warmup, rule) {
  if (warmup) return false;
  if (scenarioIndex === null || scenarioIndex === undefined) return false;
  if ((rule.dropScenarios || []).includes(scenarioIndex)) return false;
  if (inIntervals(elapsedMs, rule.contaminationWindows || [])) return false;
  return true;
}

function packageCleanTime(pkg, elapsedUs) {
  const elapsedMs = elapsedUs / 1000;
  const scenarioIndex = scenarioFromElapsedMs(elapsedMs, pkg.scenarioDurationMs, pkg.scenarioCount);
  const warmup = elapsedMs <= pkg.warmupMs;
  return cleanTime(elapsedMs, scenarioIndex, warmup, pkg.rule);
}

function loadTracePackage(root, packageAssignment, manifestContext) {
  const zipPath = path.join(root, packageAssignment.sourceZip);
  const opened = openZip(zipPath);
  const metadata = jsonEntry(opened, "metadata.json");
  const motionMetadata = jsonEntry(opened, "motion-metadata.json");
  const stopwatchFrequency = Number(metadata.StopwatchFrequency) || 10000000;
  const scenarioCount = Number(motionMetadata.ScenarioCount) || 64;
  const scenarioDurationMs = Number(motionMetadata.ScenarioDurationMilliseconds) || 12000;
  const warmupMs = Number(metadata.WarmupDurationMilliseconds) || 500;
  const rule = manifestContext.manifest.cleaningPolicy.perPackageRules[packageAssignment.packageId];
  const pkg = {
    id: packageAssignment.packageId,
    sourceZip: packageAssignment.sourceZip,
    machineKey: packageAssignment.machineKey,
    refreshBucket: packageAssignment.refreshBucket,
    stopwatchFrequency,
    scenarioCount,
    scenarioDurationMs,
    warmupMs,
    rule,
    refTimesUs: [],
    refTicks: [],
    refX: [],
    refY: [],
    anchors: [],
    eventCounts: {},
    cleanAnchorCounts: {},
  };

  const traceData = readZipEntry(opened, "trace.csv");
  parseCsvText(traceData, null, (parts, _rowIndex, column) => {
    const event = parts[column.event] || "";
    addCount(pkg.eventCounts, event || "(blank)");
    const elapsedUs = numberOrNull(parts[column.elapsedMicroseconds]);
    const stopwatchTicks = numberOrNull(parts[column.stopwatchTicks]);
    if (!Number.isFinite(elapsedUs) || !Number.isFinite(stopwatchTicks)) return;
    const elapsedMs = elapsedUs / 1000;
    const scenarioIndex = scenarioFromElapsedMs(elapsedMs, scenarioDurationMs, scenarioCount);
    const warmup = boolValue(parts[column.warmupSample]);
    const isClean = cleanTime(elapsedMs, scenarioIndex, warmup, rule);
    if (!isClean) return;

    const split = splitName(manifestContext.splitMap, scenarioIndex);
    const x = numberOrNull(parts[column.cursorX]) ?? numberOrNull(parts[column.x]);
    const y = numberOrNull(parts[column.cursorY]) ?? numberOrNull(parts[column.y]);
    if (event === "referencePoll" && Number.isFinite(x) && Number.isFinite(y)) {
      pkg.refTimesUs.push(elapsedUs);
      pkg.refTicks.push(stopwatchTicks);
      pkg.refX.push(x);
      pkg.refY.push(y);
      return;
    }

    if (!TARGET_EVENTS.includes(event)) return;
    addCount(pkg.cleanAnchorCounts, event);
    pkg.anchors.push({
      packageId: pkg.id,
      sourceZip: pkg.sourceZip,
      machineKey: pkg.machineKey,
      refreshBucket: pkg.refreshBucket,
      event,
      split,
      scenarioIndex,
      elapsedUs,
      elapsedMs,
      stopwatchTicks,
      stopwatchFrequency,
      predictionTargetTicks: numberOrNull(parts[column.predictionTargetTicks]),
      presentReferenceTicks: numberOrNull(parts[column.presentReferenceTicks]),
      schedulerProvenance: parts[column.schedulerProvenance] || "",
      sampleRecordedToPredictionTargetMicroseconds: numberOrNull(parts[column.sampleRecordedToPredictionTargetMicroseconds]),
      runtimeSchedulerMissing: boolValue(parts[column.runtimeSchedulerMissing]),
      dwmVBlankTicks: numberOrNull(parts[column.dwmQpcVBlank]),
      dwmRefreshPeriodTicks: numberOrNull(parts[column.dwmQpcRefreshPeriod]),
    });
  });

  return pkg;
}

function ticksToUs(ticks, frequency) {
  if (!Number.isFinite(ticks) || !Number.isFinite(frequency) || frequency <= 0) return null;
  return (ticks / frequency) * 1000000;
}

function ticksToMs(ticks, frequency) {
  if (!Number.isFinite(ticks) || !Number.isFinite(frequency) || frequency <= 0) return null;
  return (ticks / frequency) * 1000;
}

function advanceToFutureVBlank(baseTicks, periodTicks, sampleTicks) {
  if (!Number.isFinite(baseTicks) || !Number.isFinite(periodTicks) || periodTicks <= 0 || !Number.isFinite(sampleTicks)) {
    return null;
  }
  let target = baseTicks;
  if (target <= sampleTicks) {
    const periodsLate = Math.floor((sampleTicks - target) / periodTicks) + 1;
    target += periodsLate * periodTicks;
  }
  return target;
}

function resolveTargetTicks(anchor) {
  const period = anchor.dwmRefreshPeriodTicks;
  let target = anchor.predictionTargetTicks;
  let source = "predictionTargetTicks";
  if (!Number.isFinite(target)) {
    target = anchor.presentReferenceTicks;
    source = "presentReferenceTicks";
  }
  if (!Number.isFinite(target)) {
    target = anchor.dwmVBlankTicks;
    source = "dwmQpcVBlank";
  }
  if (!Number.isFinite(target)) return null;
  const advanced = advanceToFutureVBlank(target, period, anchor.stopwatchTicks);
  const ticks = advanced ?? target;
  return {
    ticks,
    source,
    horizonUs: ticksToUs(ticks - anchor.stopwatchTicks, anchor.stopwatchFrequency),
    horizonMs: ticksToMs(ticks - anchor.stopwatchTicks, anchor.stopwatchFrequency),
  };
}

function resolvePresentCorrectedTicks(anchor) {
  const base = Number.isFinite(anchor.presentReferenceTicks) ? anchor.presentReferenceTicks : anchor.dwmVBlankTicks;
  if (!Number.isFinite(base)) return null;
  const ticks = advanceToFutureVBlank(base, anchor.dwmRefreshPeriodTicks, anchor.stopwatchTicks);
  if (!Number.isFinite(ticks)) return null;
  return {
    ticks,
    horizonUs: ticksToUs(ticks - anchor.stopwatchTicks, anchor.stopwatchFrequency),
    horizonMs: ticksToMs(ticks - anchor.stopwatchTicks, anchor.stopwatchFrequency),
  };
}

function resolveHorizon(anchor, mode) {
  if (mode.kind === "fixed") {
    return {
      modeId: mode.id,
      labelUs: anchor.elapsedUs + mode.milliseconds * 1000,
      labelHorizonMs: mode.milliseconds,
      modelBaseHorizonMs: mode.milliseconds,
      source: "fixed",
    };
  }

  const resolved = mode.kind === "presentCorrected"
    ? resolvePresentCorrectedTicks(anchor)
    : resolveTargetTicks(anchor);
  if (!resolved || !Number.isFinite(resolved.horizonUs) || resolved.horizonUs <= 0) return null;
  return {
    modeId: mode.id,
    labelUs: anchor.elapsedUs + resolved.horizonUs,
    labelHorizonMs: resolved.horizonMs,
    modelBaseHorizonMs: resolved.horizonMs,
    source: resolved.source || mode.kind,
  };
}

function interpolateReference(pkg, targetUs) {
  if (!packageCleanTime(pkg, targetUs)) return null;
  const times = pkg.refTimesUs;
  const index = lowerBound(times, targetUs);
  if (index <= 0 || index >= times.length) return null;
  const leftTime = times[index - 1];
  const rightTime = times[index];
  if ((rightTime - leftTime) > MAX_LABEL_BRACKET_GAP_US) return null;
  const t = (targetUs - leftTime) / Math.max(1, rightTime - leftTime);
  const x = pkg.refX[index - 1] + (pkg.refX[index] - pkg.refX[index - 1]) * t;
  const y = pkg.refY[index - 1] + (pkg.refY[index] - pkg.refY[index - 1]) * t;
  const velocityXPerSecond = (pkg.refX[index] - pkg.refX[index - 1]) / ((rightTime - leftTime) / 1000000);
  const velocityYPerSecond = (pkg.refY[index] - pkg.refY[index - 1]) / ((rightTime - leftTime) / 1000000);
  return { x, y, velocityXPerSecond, velocityYPerSecond, leftIndex: index - 1, rightIndex: index };
}

function historyIndex(pkg, anchorUs) {
  return lowerBound(pkg.refTimesUs, anchorUs + 0.000001) - 1;
}

function sampleAt(pkg, index) {
  return {
    t: pkg.refTimesUs[index],
    x: pkg.refX[index],
    y: pkg.refY[index],
  };
}

function predict(model, pkg, anchor, historyIdx, horizon) {
  const latest = sampleAt(pkg, historyIdx);
  if (model.family === "constant_position") {
    return { x: latest.x, y: latest.y };
  }

  let effectiveHorizonMs = horizon.modelBaseHorizonMs + (model.params.targetOffsetMs || 0);
  if (Number.isFinite(model.params.horizonCapMs) && model.params.horizonCapMs > 0) {
    effectiveHorizonMs = Math.min(effectiveHorizonMs, model.params.horizonCapMs);
  }
  if (effectiveHorizonMs <= 0) {
    return { x: latest.x, y: latest.y };
  }
  const horizonSeconds = effectiveHorizonMs / 1000;
  let velocity;
  if (model.family === "last2_constant_velocity") {
    velocity = lastTwoVelocity(pkg, historyIdx);
  } else if (model.family === "least_squares") {
    velocity = leastSquaresVelocity(pkg, historyIdx, model.params.samples || 3);
  }
  if (!velocity) {
    return { x: latest.x, y: latest.y };
  }

  let dx = velocity.vx * horizonSeconds * (model.params.gain || 1);
  let dy = velocity.vy * horizonSeconds * (model.params.gain || 1);
  let capPx = model.params.capPx;
  if (Number.isFinite(model.params.highSpeedCapPx) && shouldUseHighSpeedCap(pkg, historyIdx, velocity, model.params)) {
    capPx = model.params.highSpeedCapPx;
  }
  const clipped = clampVector(dx, dy, capPx);
  dx = clipped.dx;
  dy = clipped.dy;
  return { x: latest.x + dx, y: latest.y + dy };
}

function lastTwoVelocity(pkg, historyIdx) {
  if (historyIdx < 1) return null;
  const t0 = pkg.refTimesUs[historyIdx - 1];
  const t1 = pkg.refTimesUs[historyIdx];
  const dt = (t1 - t0) / 1000000;
  if (dt <= 0) return null;
  return {
    vx: (pkg.refX[historyIdx] - pkg.refX[historyIdx - 1]) / dt,
    vy: (pkg.refY[historyIdx] - pkg.refY[historyIdx - 1]) / dt,
    speed: magnitude((pkg.refX[historyIdx] - pkg.refX[historyIdx - 1]) / dt, (pkg.refY[historyIdx] - pkg.refY[historyIdx - 1]) / dt),
  };
}

function leastSquaresVelocity(pkg, historyIdx, samples) {
  if (historyIdx + 1 < samples) return null;
  const first = historyIdx - samples + 1;
  const baseUs = pkg.refTimesUs[historyIdx];
  let sumT = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = first; i <= historyIdx; i += 1) {
    const t = (pkg.refTimesUs[i] - baseUs) / 1000000;
    sumT += t;
    sumX += pkg.refX[i];
    sumY += pkg.refY[i];
  }
  const meanT = sumT / samples;
  const meanX = sumX / samples;
  const meanY = sumY / samples;
  let denominator = 0;
  let numeratorX = 0;
  let numeratorY = 0;
  for (let i = first; i <= historyIdx; i += 1) {
    const centeredT = ((pkg.refTimesUs[i] - baseUs) / 1000000) - meanT;
    denominator += centeredT * centeredT;
    numeratorX += centeredT * (pkg.refX[i] - meanX);
    numeratorY += centeredT * (pkg.refY[i] - meanY);
  }
  if (denominator <= 0) return null;
  const vx = numeratorX / denominator;
  const vy = numeratorY / denominator;
  return { vx, vy, speed: magnitude(vx, vy) };
}

function shouldUseHighSpeedCap(pkg, historyIdx, velocity, params) {
  if (velocity.speed < (params.highSpeedThreshold || Infinity)) return false;
  if (historyIdx < 3) return false;
  const window = Math.min(18, historyIdx + 1);
  const first = historyIdx - window + 1;
  let path = 0;
  for (let i = first + 1; i <= historyIdx; i += 1) {
    path += magnitude(pkg.refX[i] - pkg.refX[i - 1], pkg.refY[i] - pkg.refY[i - 1]);
  }
  const net = magnitude(pkg.refX[historyIdx] - pkg.refX[first], pkg.refY[historyIdx] - pkg.refY[first]);
  if (path <= 0) return false;
  return (net / path) >= 0.75 && net >= 160;
}

function signedAlongMotion(prediction, label) {
  const speed = magnitude(label.velocityXPerSecond, label.velocityYPerSecond);
  if (!Number.isFinite(speed) || speed < 1) return null;
  const ex = prediction.x - label.x;
  const ey = prediction.y - label.y;
  return (ex * label.velocityXPerSecond + ey * label.velocityYPerSecond) / speed;
}

function evaluate(packages, manifestContext) {
  const store = new ScoreStore();
  const timing = new TimingStore();
  const evaluationSummary = {};
  const skipCounts = {};

  for (const pkg of packages) {
    const summary = {
      packageId: pkg.id,
      sourceZip: pkg.sourceZip,
      machineKey: pkg.machineKey,
      refreshBucket: pkg.refreshBucket,
      referencePollRows: pkg.refTimesUs.length,
      anchors: pkg.anchors.length,
      cleanAnchorCounts: pkg.cleanAnchorCounts,
      evaluatedLabels: 0,
      skipped: {},
    };
    evaluationSummary[pkg.id] = summary;

    for (const anchor of pkg.anchors) {
      timing.addAnchor(anchor);
      const idx = historyIndex(pkg, anchor.elapsedUs);
      if (idx < 1) {
        addCount(summary.skipped, "missing_history");
        addCount(skipCounts, "missing_history");
        continue;
      }
      const latestRefAgeUs = anchor.elapsedUs - pkg.refTimesUs[idx];
      if (latestRefAgeUs > 100000) {
        addCount(summary.skipped, "stale_history");
        addCount(skipCounts, "stale_history");
        continue;
      }
      for (const mode of HORIZON_MODES) {
        const horizon = resolveHorizon(anchor, mode);
        if (!horizon) {
          addCount(summary.skipped, `missing_horizon:${mode.id}`);
          addCount(skipCounts, `missing_horizon:${mode.id}`);
          continue;
        }
        const label = interpolateReference(pkg, horizon.labelUs);
        if (!label) {
          addCount(summary.skipped, `missing_label:${mode.id}`);
          addCount(skipCounts, `missing_label:${mode.id}`);
          continue;
        }
        summary.evaluatedLabels += 1;
        for (const model of BASELINES) {
          const prediction = predict(model, pkg, anchor, idx, horizon);
          const error = magnitude(prediction.x - label.x, prediction.y - label.y);
          store.addObservation(model, anchor, mode, error, signedAlongMotion(prediction, label), manifestContext.holdouts);
        }
      }
    }
  }

  const scores = store.finalize();
  const timingScores = timing.finalize();
  const selectedBaseline = selectBaseline(scores);
  return {
    scores,
    timingScores,
    selectedBaseline,
    evaluationSummary,
    skipCounts,
  };
}

function selectBaseline(scores) {
  const candidates = scores.bySplit.filter((row) => (
    row.split === "validation"
    && row.anchorEvent === "runtimeSchedulerPoll"
    && row.horizonMode === "v9_target"
    && row.productEligible
    && row.error.count > 0
  ));
  const ranked = candidates.sort((a, b) => (a.error.p95 ?? Infinity) - (b.error.p95 ?? Infinity)
    || (a.error.mean ?? Infinity) - (b.error.mean ?? Infinity));
  const selected = ranked[0] || null;
  const rankedPrediction = ranked.filter((row) => row.modelFamily !== "constant_position");
  const selectedPrediction = rankedPrediction[0] || null;
  const productEquivalent = ranked.find((row) => row.productEquivalent) || null;
  return {
    selectionMetric: "validation runtimeSchedulerPoll + v9_target lowest p95, then mean",
    selectedModelId: selected ? selected.modelId : null,
    selectedModelFamily: selected ? selected.modelFamily : null,
    selectedPredictionCandidateModelId: selectedPrediction ? selectedPrediction.modelId : null,
    selectedPredictionCandidateFamily: selectedPrediction ? selectedPrediction.modelFamily : null,
    selectedValidationRuntimeSchedulerTarget: selected ? {
      count: selected.error.count,
      mean: selected.error.mean,
      median: selected.error.median,
      p95: selected.error.p95,
      p99: selected.error.p99,
      max: selected.error.max,
      signedAlongMotion: selected.error.signedAlongMotion,
    } : null,
    selectedPredictionValidationRuntimeSchedulerTarget: selectedPrediction ? {
      count: selectedPrediction.error.count,
      mean: selectedPrediction.error.mean,
      median: selectedPrediction.error.median,
      p95: selectedPrediction.error.p95,
      p99: selectedPrediction.error.p99,
      max: selectedPrediction.error.max,
      signedAlongMotion: selectedPrediction.error.signedAlongMotion,
    } : null,
    currentProductEquivalentValidationRuntimeSchedulerTarget: productEquivalent ? {
      modelId: productEquivalent.modelId,
      count: productEquivalent.error.count,
      mean: productEquivalent.error.mean,
      median: productEquivalent.error.median,
      p95: productEquivalent.error.p95,
      p99: productEquivalent.error.p99,
      max: productEquivalent.error.max,
      signedAlongMotion: productEquivalent.error.signedAlongMotion,
    } : null,
    rankedValidationRuntimeSchedulerTarget: ranked.slice(0, 10).map((row) => ({
      modelId: row.modelId,
      modelFamily: row.modelFamily,
      productEquivalent: row.productEquivalent,
      count: row.error.count,
      mean: row.error.mean,
      median: row.error.median,
      p95: row.error.p95,
      p99: row.error.p99,
      signedMean: row.error.signedAlongMotion.mean,
      lagRate: row.error.signedAlongMotion.lagRate,
    })),
  };
}

function compactStep3(result, manifestContext) {
  return {
    schemaVersion: `${SCHEMA_VERSION}/step-3`,
    generatedAtUtc: new Date().toISOString(),
    constraints: {
      gpuUsed: false,
      trainingRun: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
      execution: "single-process CPU-only sequential evaluation",
    },
    manifest: {
      path: "poc/cursor-prediction-v12/step-2-clean-split/split-manifest.json",
      schemaVersion: manifestContext.manifest.schemaVersion,
      baseScenarioSplit: manifestContext.manifest.baseScenarioSplit,
      cleaningPolicy: manifestContext.manifest.cleaningPolicy,
    },
    evaluationContract: {
      anchors: TARGET_EVENTS,
      causalHistory: "clean referencePoll rows with elapsedMicroseconds <= anchor elapsedMicroseconds",
      labels: "interpolated clean referencePoll rows at the selected horizon target",
      maxLabelBracketGapMicroseconds: MAX_LABEL_BRACKET_GAP_US,
      horizonModes: HORIZON_MODES,
    },
    baselineList: BASELINES,
    selectedBaseline: result.selectedBaseline,
    evaluationSummary: result.evaluationSummary,
    skipCounts: result.skipCounts,
    scores: result.scores,
    holdoutSignals: buildHoldoutSignals(result.scores, result.selectedBaseline.selectedModelId),
  };
}

function compactStep4(result, step3) {
  const predictionCandidateId = step3.selectedBaseline.selectedPredictionCandidateModelId;
  return {
    schemaVersion: `${SCHEMA_VERSION}/step-4`,
    generatedAtUtc: new Date().toISOString(),
    constraints: {
      gpuUsed: false,
      trainingRun: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
      execution: "single-process CPU-only sequential audit",
    },
    telemetryColumns: [
      "predictionTargetTicks",
      "presentReferenceTicks",
      "sampleRecordedToPredictionTargetMicroseconds",
      "schedulerProvenance",
      "dwmQpcRefreshPeriod",
    ],
    timingScores: result.timingScores,
    selectedBaselineLagAudit: buildSelectedLagAudit(step3.scores, step3.selectedBaseline.selectedModelId),
    selectedPredictionCandidateLagAudit: buildSelectedLagAudit(step3.scores, predictionCandidateId),
    horizonModeComparison: buildHorizonModeComparison(step3.scores, step3.selectedBaseline.selectedModelId),
    predictionCandidateHorizonModeComparison: buildHorizonModeComparison(step3.scores, predictionCandidateId),
    conclusion: buildTimingConclusion(result.timingScores, step3.scores, step3.selectedBaseline.selectedModelId),
  };
}

function buildHoldoutSignals(scores, selectedModelId) {
  if (!selectedModelId) return [];
  const rows = scores.byHoldout.filter((row) => (
    row.modelId === selectedModelId
    && row.anchorEvent === "runtimeSchedulerPoll"
    && row.horizonMode === "v9_target"
  ));
  const byHoldout = new Map();
  for (const row of rows) {
    const entry = byHoldout.get(row.holdoutId) || { holdoutId: row.holdoutId, holdoutKind: row.holdoutKind, train: null, test: null };
    entry[row.holdoutRole] = compactError(row.error);
    byHoldout.set(row.holdoutId, entry);
  }
  return [...byHoldout.values()].map((entry) => ({
    ...entry,
    p95DeltaTestMinusTrain: entry.train && entry.test ? round(entry.test.p95 - entry.train.p95) : null,
    meanDeltaTestMinusTrain: entry.train && entry.test ? round(entry.test.mean - entry.train.mean) : null,
  })).sort((a, b) => String(a.holdoutId).localeCompare(String(b.holdoutId)));
}

function buildSelectedLagAudit(scores, selectedModelId) {
  if (!selectedModelId) return [];
  return scores.byRefresh
    .filter((row) => row.modelId === selectedModelId && (row.split === "validation" || row.split === "test"))
    .map((row) => ({
      horizonMode: row.horizonMode,
      anchorEvent: row.anchorEvent,
      split: row.split,
      refreshBucket: row.refreshBucket,
      error: compactError(row.error),
      signedAlongMotion: row.error.signedAlongMotion,
    }))
    .sort((a, b) => String(a.horizonMode).localeCompare(String(b.horizonMode))
      || String(a.anchorEvent).localeCompare(String(b.anchorEvent))
      || String(a.split).localeCompare(String(b.split))
      || String(a.refreshBucket).localeCompare(String(b.refreshBucket)));
}

function buildHorizonModeComparison(scores, selectedModelId) {
  if (!selectedModelId) return [];
  return scores.bySplit
    .filter((row) => row.modelId === selectedModelId && row.anchorEvent === "runtimeSchedulerPoll")
    .map((row) => ({
      horizonMode: row.horizonMode,
      split: row.split,
      error: compactError(row.error),
      signedAlongMotion: row.error.signedAlongMotion,
    }))
    .sort((a, b) => String(a.split).localeCompare(String(b.split))
      || String(a.horizonMode).localeCompare(String(b.horizonMode)));
}

function buildTimingConclusion(timingScores, scores, selectedModelId) {
  const eventRows = timingScores.sections.byEventRefresh;
  const runtime30 = eventRows.find((row) => row.anchorEvent === "runtimeSchedulerPoll" && row.refreshBucket === "30Hz");
  const runtime60 = eventRows.find((row) => row.anchorEvent === "runtimeSchedulerPoll" && row.refreshBucket === "60Hz");
  const selectedRows = selectedModelId
    ? scores.bySplit.filter((row) => row.modelId === selectedModelId && row.anchorEvent === "runtimeSchedulerPoll" && row.split === "validation")
    : [];
  const targetRow = selectedRows.find((row) => row.horizonMode === "v9_target");
  const fixedRow = selectedRows.find((row) => row.horizonMode === "fixed_16p67ms");
  return {
    runtimeSchedulerTargetHorizonP50ByRefreshMs: {
      "30Hz": runtime30?.targetHorizonMs?.p50 ?? null,
      "60Hz": runtime60?.targetHorizonMs?.p50 ?? null,
    },
    runtimeSchedulerSampleRecordedToTargetP50Us: {
      "30Hz": runtime30?.sampleRecordedToPredictionTargetMicroseconds?.p50 ?? null,
      "60Hz": runtime60?.sampleRecordedToPredictionTargetMicroseconds?.p50 ?? null,
    },
    selectedValidationRuntimeSchedulerP95: {
      fixed16p67: fixedRow?.error?.p95 ?? null,
      v9Target: targetRow?.error?.p95 ?? null,
      deltaTargetMinusFixed: fixedRow && targetRow ? round(targetRow.error.p95 - fixedRow.error.p95) : null,
    },
    qualitative: [
      "Runtime scheduler anchors are recorded shortly before the resolved DWM target; the target-derived horizon is therefore much shorter than a full refresh interval.",
      "A fixed 16.67 ms horizon is not refresh-aware and is expected to over-project for scheduler anchors that are already near vblank.",
      "Raw presentReferenceTicks often describes the current or previous DWM vblank; it must be advanced to a future vblank before use as a prediction target.",
    ],
  };
}

function compactError(error) {
  return {
    count: error.count,
    mean: error.mean,
    median: error.median,
    p95: error.p95,
    p99: error.p99,
    max: error.max,
    signedMean: error.signedAlongMotion.mean,
    lagRate: error.signedAlongMotion.lagRate,
  };
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

function fmt(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (typeof value === "number") return String(round(value, digits));
  return String(value);
}

function renderStep3Report(step3) {
  const selectedId = step3.selectedBaseline.selectedModelId;
  const predictionCandidateId = step3.selectedBaseline.selectedPredictionCandidateModelId;
  const productEquivalent = step3.selectedBaseline.currentProductEquivalentValidationRuntimeSchedulerTarget;
  const rankingRows = step3.selectedBaseline.rankedValidationRuntimeSchedulerTarget.map((row, index) => [
    index + 1,
    row.modelId,
    row.modelFamily,
    row.productEquivalent ? "yes" : "no",
    row.count,
    fmt(row.mean),
    fmt(row.p95),
    fmt(row.p99),
    fmt(row.signedMean),
    fmt(row.lagRate, 6),
  ]);
  const selectedRows = step3.scores.bySplit
    .filter((row) => row.modelId === selectedId && (row.split === "validation" || row.split === "test"))
    .map((row) => [
      row.anchorEvent,
      row.horizonMode,
      row.split,
      row.error.count,
      fmt(row.error.mean),
      fmt(row.error.median),
      fmt(row.error.p95),
      fmt(row.error.p99),
      fmt(row.error.signedAlongMotion.mean),
      fmt(row.error.signedAlongMotion.lagRate, 6),
    ]);
  const holdoutRows = step3.holdoutSignals.map((row) => [
    row.holdoutId,
    row.holdoutKind,
    row.train?.count ?? 0,
    fmt(row.train?.p95),
    row.test?.count ?? 0,
    fmt(row.test?.p95),
    fmt(row.p95DeltaTestMinusTrain),
  ]);
  const summaryRows = Object.values(step3.evaluationSummary).map((item) => [
    item.packageId,
    item.refreshBucket,
    item.machineKey,
    item.referencePollRows,
    item.cleanAnchorCounts.poll || 0,
    item.cleanAnchorCounts.runtimeSchedulerPoll || 0,
    item.evaluatedLabels,
  ]);
  return `# Step 3 Baseline Retune

## Scope

This step re-evaluates deterministic product-safe baselines on the clean POC 12 split manifest. It uses only CPU, runs sequentially, reads the source ZIP files directly, and writes only aggregate Markdown/JSON artifacts.

Anchor rows are clean \`poll\` and \`runtimeSchedulerPoll\` events. Predictor history is limited to clean causal \`referencePoll\` rows at or before each anchor.

## Source Summary

${table(["pkg", "refresh", "machine", "reference", "poll anchors", "scheduler anchors", "labels"], summaryRows)}

## Baseline Ranking

Selection metric: ${step3.selectedBaseline.selectionMetric}.

Selected baseline: \`${selectedId}\`.

Best non-constant prediction candidate: \`${predictionCandidateId}\`.

Current product-equivalent baseline: \`${productEquivalent?.modelId || "n/a"}\`, validation runtimeScheduler/v9_target p95=${fmt(productEquivalent?.p95)} px, mean=${fmt(productEquivalent?.mean)} px.

${table(["rank", "model", "family", "product equiv", "count", "mean", "p95", "p99", "signed mean", "lag rate"], rankingRows)}

## Selected Baseline Scores

${table(["anchor", "horizon", "split", "count", "mean", "median", "p95", "p99", "signed mean", "lag rate"], selectedRows)}

## Holdout Signals

${table(["holdout", "kind", "train n", "train p95", "test n", "test p95", "test-train p95"], holdoutRows)}

Positive holdout deltas indicate a potential cross-machine or cross-refresh regression risk. These rows are diagnostic only; no model was trained in this step.

## Interpretation

- Runtime scheduler anchors have the most production-like timing, so the selected baseline is chosen there.
- The p95 winner is \`constant_position\`, which is useful as a low-horizon floor but is not a good stand-alone prediction strategy because its signed error is almost always lagging during motion.
- The best non-constant candidate is the better next implementation target.
- \`v9_target\` is the most relevant horizon mode for runtime scheduler rows because it uses the target vblank recorded by the runtime scheduler.
- Fixed horizons remain useful as controls, but they mix 30Hz and 60Hz assumptions and can over-project scheduler rows that are already close to vblank.
`;
}

function renderStep3Notes(step3) {
  return `# Step 3 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v12\\scripts\\run-step3-step4.js
\`\`\`

## Evaluation Contract

- Manifest: \`poc/cursor-prediction-v12/step-2-clean-split/split-manifest.json\`.
- Anchors: clean \`poll\` and \`runtimeSchedulerPoll\`.
- History: clean causal \`referencePoll\` rows only.
- Labels: clean interpolated \`referencePoll\` positions at the selected horizon target.
- Label interpolation is rejected when the surrounding reference gap exceeds ${MAX_LABEL_BRACKET_GAP_US} us.

## Product Approximation

\`product_current_cv_gain100_cap12_24_hcap10_offset2\` approximates the current production ConstantVelocity default. It intentionally keeps the +2 ms target offset and 10 ms DWM horizon cap so Step 4 can quantify whether that offset is helping or creating one-sided lead/lag.

## Split Hygiene

Rows are not sample-randomized. Split labels come from scenario indices in the Step 2 manifest. Holdout reports group packages by machine fingerprint and refresh bucket.
`;
}

function renderStep4Report(step4) {
  const timingRows = step4.timingScores.sections.byEventRefresh.map((row) => [
    row.anchorEvent,
    row.refreshBucket,
    row.targetHorizonMs.count,
    fmt(row.targetHorizonMs.p50),
    fmt(row.targetHorizonMs.p95),
    fmt(row.presentRawHorizonMs.p50),
    fmt(row.presentCorrectedHorizonMs.p50),
    fmt(row.targetMinusRawPresentMs.p50),
    fmt(row.sampleRecordedToPredictionTargetMicroseconds.p50),
  ]);
  const lagRows = step4.selectedBaselineLagAudit
    .filter((row) => row.anchorEvent === "runtimeSchedulerPoll")
    .map((row) => [
      row.horizonMode,
      row.split,
      row.refreshBucket,
      row.error.count,
      fmt(row.error.mean),
      fmt(row.error.p95),
      fmt(row.signedAlongMotion.mean),
      fmt(row.signedAlongMotion.lagRate, 6),
    ]);
  const horizonRows = step4.horizonModeComparison.map((row) => [
    row.split,
    row.horizonMode,
    row.error.count,
    fmt(row.error.mean),
    fmt(row.error.p95),
    fmt(row.error.p99),
    fmt(row.signedAlongMotion.mean),
      fmt(row.signedAlongMotion.lagRate, 6),
    ]);
  const predictionCandidateRows = step4.predictionCandidateHorizonModeComparison.map((row) => [
    row.split,
    row.horizonMode,
    row.error.count,
    fmt(row.error.mean),
    fmt(row.error.p95),
    fmt(row.error.p99),
    fmt(row.signedAlongMotion.mean),
    fmt(row.signedAlongMotion.lagRate, 6),
  ]);
  return `# Step 4 Timing Target Audit

## Scope

This step audits v9 timing columns and compares fixed horizons with target-derived horizons. It shares the Step 3 data pass and remains CPU-only.

## Timing By Anchor And Refresh

${table(["anchor", "refresh", "n", "target p50 ms", "target p95 ms", "raw present p50 ms", "corrected present p50 ms", "target-raw present p50 ms", "recorded-target p50 us"], timingRows)}

\`presentReferenceTicks\` is often the current or previous DWM vblank. The corrected-present mode advances it to a future vblank before deriving a prediction horizon.

## Selected Baseline Lag Audit

${table(["horizon", "split", "refresh", "count", "mean", "p95", "signed mean", "lag rate"], lagRows)}

Signed error is projected along instantaneous cursor motion. Negative signed mean means the prediction is behind the future cursor position; positive means it leads.

## Horizon Mode Comparison

${table(["split", "horizon", "count", "mean", "p95", "p99", "signed mean", "lag rate"], horizonRows)}

## Non-Constant Prediction Candidate Horizon Comparison

${table(["split", "horizon", "count", "mean", "p95", "p99", "signed mean", "lag rate"], predictionCandidateRows)}

## Conclusion

- Runtime scheduler target p50 by refresh: 30Hz=${fmt(step4.conclusion.runtimeSchedulerTargetHorizonP50ByRefreshMs["30Hz"])} ms, 60Hz=${fmt(step4.conclusion.runtimeSchedulerTargetHorizonP50ByRefreshMs["60Hz"])} ms.
- Runtime scheduler sample-recorded-to-target p50: 30Hz=${fmt(step4.conclusion.runtimeSchedulerSampleRecordedToTargetP50Us["30Hz"])} us, 60Hz=${fmt(step4.conclusion.runtimeSchedulerSampleRecordedToTargetP50Us["60Hz"])} us.
- Selected validation runtimeScheduler p95: fixed16.67=${fmt(step4.conclusion.selectedValidationRuntimeSchedulerP95.fixed16p67)} px, v9Target=${fmt(step4.conclusion.selectedValidationRuntimeSchedulerP95.v9Target)} px, delta=${fmt(step4.conclusion.selectedValidationRuntimeSchedulerP95.deltaTargetMinusFixed)} px.

The main timing lesson is that runtime scheduler rows are already near their target vblank. For those rows, a full fixed-frame horizon is not equivalent to the recorded prediction target.
`;
}

function renderStep4Notes() {
  return `# Step 4 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v12\\scripts\\run-step3-step4.js
\`\`\`

## Target Semantics

- \`predictionTargetTicks\`: runtime scheduler target when available.
- \`presentReferenceTicks\`: DWM \`QpcVBlank\`; often current or previous vblank.
- \`v9_target\`: use \`predictionTargetTicks\` when present, otherwise advance \`presentReferenceTicks\` or DWM vblank to the next future vblank.
- \`v9_present_corrected\`: advance \`presentReferenceTicks\` to the next future vblank.

Raw \`presentReferenceTicks\` is audited but not used directly as a prediction label when it is in the past.

## Bias Sign

Signed error is \`dot(prediction - label, motionDirection)\`. Negative values are lag; positive values are lead. This is more useful than x/y signed error because the generated motion is not axis-aligned.
`;
}

function writeOutputs(root, outDir, step3, step4) {
  const step3Dir = path.join(outDir, "step-3-baseline-retune");
  const step4Dir = path.join(outDir, "step-4-timing-target-audit");
  ensureDir(step3Dir);
  ensureDir(step4Dir);
  fs.writeFileSync(path.join(step3Dir, "scores.json"), JSON.stringify(step3, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(step3Dir, "report.md"), renderStep3Report(step3), "utf8");
  fs.writeFileSync(path.join(step3Dir, "notes.md"), renderStep3Notes(step3), "utf8");
  fs.writeFileSync(path.join(step4Dir, "scores.json"), JSON.stringify(step4, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(step4Dir, "report.md"), renderStep4Report(step4), "utf8");
  fs.writeFileSync(path.join(step4Dir, "notes.md"), renderStep4Notes(step4), "utf8");

  const outputs = [
    path.join(step3Dir, "scores.json"),
    path.join(step3Dir, "report.md"),
    path.join(step3Dir, "notes.md"),
    path.join(step4Dir, "scores.json"),
    path.join(step4Dir, "report.md"),
    path.join(step4Dir, "notes.md"),
  ];
  process.stdout.write(`Wrote:\n${outputs.map((item) => path.relative(root, item).replaceAll(path.sep, "/")).join("\n")}\n`);
}

function main() {
  const args = parseArgs(process.argv);
  const manifestContext = loadManifest(args.manifest);
  const packages = manifestContext.manifest.packageScenarioAssignments.map((assignment) => (
    loadTracePackage(args.root, assignment, manifestContext)
  ));
  const result = evaluate(packages, manifestContext);
  const step3 = compactStep3(result, manifestContext);
  const step4 = compactStep4(result, step3);
  writeOutputs(args.root, args.outDir, step3, step4);
}

main();
