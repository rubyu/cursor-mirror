#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SCHEMA_VERSION = "cursor-prediction-v12-step5-step6/1";
const TARGET_EVENT = "runtimeSchedulerPoll";
const HISTOGRAM_BIN_PX = 0.25;
const HISTOGRAM_MAX_PX = 512;
const HISTOGRAM_BINS = Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 1;
const REGRESSION_THRESHOLDS_PX = [1, 2, 5, 10];
const MAX_LABEL_BRACKET_GAP_US = 60000;
const MAX_OUTPUT_DELTA_PX = 64;

const BASELINE_MODELS = [
  {
    id: "current_product_equivalent",
    family: "last2_constant_velocity",
    description: "Current product-equivalent approximation: CV gain 100%, +2 ms target offset, horizon cap 10 ms, 12/24 px cap.",
    productCandidate: true,
    params: { n: 2, gain: 1, capPx: 12, highSpeedCapPx: 24, highSpeedThreshold: 2400, offsetMs: 2, horizonCapMs: 10 },
  },
  {
    id: "least_squares_n12_gain100_cap24",
    family: "least_squares",
    description: "Step 3 best non-constant baseline.",
    productCandidate: true,
    params: { n: 12, gain: 1, capPx: 24, offsetMs: 0 },
  },
  {
    id: "constant_position",
    family: "constant_position",
    description: "Low-horizon floor baseline.",
    productCandidate: true,
    params: {},
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
  node poc\\cursor-prediction-v12\\scripts\\run-step5-step6.js [--root <repo>] [--out-dir <dir>] [--manifest <json>]
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

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
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

function clampVector(dx, dy, capPx) {
  if (!Number.isFinite(capPx) || capPx <= 0) return { dx, dy };
  const mag = magnitude(dx, dy);
  if (mag <= capPx || mag <= 0) return { dx, dy };
  const scale = capPx / mag;
  return { dx: dx * scale, dy: dy * scale };
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

function createAccumulator() {
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

function addError(acc, error, signed) {
  acc.count += 1;
  acc.sum += error;
  acc.sumSquares += error * error;
  acc.max = Math.max(acc.max, error);
  acc.histogram[Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(error / HISTOGRAM_BIN_PX)))] += 1;
  for (const threshold of REGRESSION_THRESHOLDS_PX) {
    if (error > threshold) acc.regressions[`gt${threshold}px`] += 1;
  }
  if (Number.isFinite(signed)) {
    acc.signedCount += 1;
    acc.signedSum += signed;
    acc.signedAbsSum += Math.abs(signed);
    if (signed < 0) acc.lagCount += 1;
    else if (signed > 0) acc.leadCount += 1;
  }
}

function finalizeAccumulator(acc) {
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

class EvalStore {
  constructor() {
    this.maps = {
      overall: new Map(),
      bySplit: new Map(),
      byRefresh: new Map(),
      byMachine: new Map(),
      byPhase: new Map(),
      bySpeedBin: new Map(),
      byHoldout: new Map(),
    };
  }

  add(section, keyParts, meta, error, signed) {
    const key = keyParts.map(String).join("|");
    let entry = this.maps[section].get(key);
    if (!entry) {
      entry = { ...meta, accumulator: createAccumulator() };
      this.maps[section].set(key, entry);
    }
    addError(entry.accumulator, error, signed);
  }

  addRow(model, row, error, signed, holdouts) {
    const meta = {
      modelId: model.id,
      modelFamily: model.family,
      productCandidate: Boolean(model.productCandidate),
      analysisOnly: Boolean(model.analysisOnly),
    };
    this.add("overall", [model.id], meta, error, signed);
    this.add("bySplit", [model.id, row.split], { ...meta, split: row.split }, error, signed);
    this.add("byRefresh", [model.id, row.split, row.refreshBucket], { ...meta, split: row.split, refreshBucket: row.refreshBucket }, error, signed);
    this.add("byMachine", [model.id, row.split, row.machineKey], { ...meta, split: row.split, machineKey: row.machineKey }, error, signed);
    this.add("byPhase", [model.id, row.split, row.phase], { ...meta, split: row.split, movementPhase: row.phase }, error, signed);
    this.add("bySpeedBin", [model.id, row.split, row.speedBin], { ...meta, split: row.split, speedBin: row.speedBin }, error, signed);
    for (const holdout of holdouts) {
      const role = holdout.testPackageIdSet.has(row.packageId) ? "test" : "train";
      this.add("byHoldout", [model.id, holdout.id, role], {
        ...meta,
        holdoutId: holdout.id,
        holdoutKind: holdout.kind,
        holdoutRole: role,
      }, error, signed);
    }
  }

  finalizeMap(name) {
    return [...this.maps[name].values()].map((entry) => {
      const { accumulator, ...meta } = entry;
      return { ...meta, error: finalizeAccumulator(accumulator) };
    }).sort(metricSort);
  }

  finalize() {
    return Object.fromEntries(Object.keys(this.maps).map((name) => [name, this.finalizeMap(name)]));
  }
}

function metricSort(a, b) {
  return String(a.modelId).localeCompare(String(b.modelId))
    || String(a.split || "").localeCompare(String(b.split || ""))
    || String(a.refreshBucket || "").localeCompare(String(b.refreshBucket || ""))
    || String(a.machineKey || "").localeCompare(String(b.machineKey || ""))
    || String(a.movementPhase || "").localeCompare(String(b.movementPhase || ""))
    || String(a.speedBin || "").localeCompare(String(b.speedBin || ""))
    || String(a.holdoutId || "").localeCompare(String(b.holdoutId || ""))
    || String(a.holdoutRole || "").localeCompare(String(b.holdoutRole || ""));
}

function loadManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const splitMap = new Map();
  for (const index of manifest.baseScenarioSplit.train) splitMap.set(index, "train");
  for (const index of manifest.baseScenarioSplit.validation) splitMap.set(index, "validation");
  for (const index of manifest.baseScenarioSplit.test) splitMap.set(index, "test");
  const holdouts = [
    ...(manifest.holdouts?.machineHoldouts || []).map((item) => ({ ...item, kind: "machine" })),
    ...(manifest.holdouts?.refreshHoldouts || []).map((item) => ({ ...item, kind: "refresh" })),
  ].map((item) => ({ ...item, testPackageIdSet: new Set(item.testPackageIds || []) }));
  return { manifest, splitMap, holdouts };
}

function splitName(splitMap, scenarioIndex) {
  return splitMap.get(scenarioIndex) || "unassigned";
}

function cleanTime(pkg, elapsedMs, scenarioIndex) {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(scenarioIndex)) return false;
  if (elapsedMs <= pkg.warmupMs) return false;
  if ((pkg.rule.dropScenarios || []).includes(scenarioIndex)) return false;
  if (inIntervals(elapsedMs, pkg.rule.contaminationWindows || [])) return false;
  return true;
}

function loadPackage(root, assignment, context) {
  const opened = openZip(path.join(root, assignment.sourceZip));
  const metadata = jsonEntry(opened, "metadata.json");
  const motionMetadata = jsonEntry(opened, "motion-metadata.json");
  const pkg = {
    id: assignment.packageId,
    sourceZip: assignment.sourceZip,
    machineKey: assignment.machineKey,
    refreshBucket: assignment.refreshBucket,
    stopwatchFrequency: Number(metadata.StopwatchFrequency) || 10000000,
    scenarioCount: Number(motionMetadata.ScenarioCount) || 64,
    scenarioDurationMs: Number(motionMetadata.ScenarioDurationMilliseconds) || 12000,
    warmupMs: Number(metadata.WarmupDurationMilliseconds) || 500,
    rule: context.manifest.cleaningPolicy.perPackageRules[assignment.packageId],
    refTimesUs: [],
    refTicks: [],
    refX: [],
    refY: [],
    motionTimesMs: [],
    motionPhase: [],
    motionSpeed: [],
    anchors: [],
  };

  parseCsvText(readZipEntry(opened, "motion-samples.csv"), null, (parts, _row, col) => {
    const elapsedMs = numberOrNull(parts[col.elapsedMilliseconds]);
    const scenarioIndex = numberOrNull(parts[col.scenarioIndex])
      ?? scenarioFromElapsedMs(elapsedMs, pkg.scenarioDurationMs, pkg.scenarioCount);
    if (!cleanTime(pkg, elapsedMs, scenarioIndex)) return;
    pkg.motionTimesMs.push(elapsedMs);
    pkg.motionPhase.push(parts[col.movementPhase] || "(missing)");
    pkg.motionSpeed.push(numberOrNull(parts[col.velocityPixelsPerSecond]) ?? 0);
  });

  parseCsvText(readZipEntry(opened, "trace.csv"), null, (parts, _row, col) => {
    const event = parts[col.event] || "";
    const elapsedUs = numberOrNull(parts[col.elapsedMicroseconds]);
    const stopwatchTicks = numberOrNull(parts[col.stopwatchTicks]);
    if (!Number.isFinite(elapsedUs) || !Number.isFinite(stopwatchTicks)) return;
    const elapsedMs = elapsedUs / 1000;
    const scenarioIndex = scenarioFromElapsedMs(elapsedMs, pkg.scenarioDurationMs, pkg.scenarioCount);
    const warmup = boolValue(parts[col.warmupSample]);
    if (warmup || !cleanTime(pkg, elapsedMs, scenarioIndex)) return;
    const split = splitName(context.splitMap, scenarioIndex);
    const x = numberOrNull(parts[col.cursorX]) ?? numberOrNull(parts[col.x]);
    const y = numberOrNull(parts[col.cursorY]) ?? numberOrNull(parts[col.y]);
    if (event === "referencePoll" && Number.isFinite(x) && Number.isFinite(y)) {
      pkg.refTimesUs.push(elapsedUs);
      pkg.refTicks.push(stopwatchTicks);
      pkg.refX.push(x);
      pkg.refY.push(y);
      return;
    }
    if (event !== TARGET_EVENT) return;
    pkg.anchors.push({
      packageId: pkg.id,
      machineKey: pkg.machineKey,
      refreshBucket: pkg.refreshBucket,
      split,
      scenarioIndex,
      elapsedUs,
      elapsedMs,
      stopwatchTicks,
      stopwatchFrequency: pkg.stopwatchFrequency,
      predictionTargetTicks: numberOrNull(parts[col.predictionTargetTicks]),
      presentReferenceTicks: numberOrNull(parts[col.presentReferenceTicks]),
      dwmVBlankTicks: numberOrNull(parts[col.dwmQpcVBlank]),
      dwmRefreshPeriodTicks: numberOrNull(parts[col.dwmQpcRefreshPeriod]),
      schedulerProvenance: parts[col.schedulerProvenance] || "",
    });
  });

  return pkg;
}

function advanceToFutureVBlank(baseTicks, periodTicks, sampleTicks) {
  if (!Number.isFinite(baseTicks) || !Number.isFinite(periodTicks) || periodTicks <= 0 || !Number.isFinite(sampleTicks)) return null;
  let target = baseTicks;
  if (target <= sampleTicks) {
    target += (Math.floor((sampleTicks - target) / periodTicks) + 1) * periodTicks;
  }
  return target;
}

function resolveTarget(anchor) {
  let target = Number.isFinite(anchor.predictionTargetTicks) ? anchor.predictionTargetTicks : anchor.presentReferenceTicks;
  if (!Number.isFinite(target)) target = anchor.dwmVBlankTicks;
  const ticks = advanceToFutureVBlank(target, anchor.dwmRefreshPeriodTicks, anchor.stopwatchTicks);
  if (!Number.isFinite(ticks)) return null;
  const horizonUs = (ticks - anchor.stopwatchTicks) / anchor.stopwatchFrequency * 1000000;
  if (!Number.isFinite(horizonUs) || horizonUs <= 0) return null;
  return { ticks, horizonUs, horizonMs: horizonUs / 1000, labelUs: anchor.elapsedUs + horizonUs };
}

function packageCleanAtUs(pkg, elapsedUs) {
  const elapsedMs = elapsedUs / 1000;
  const scenarioIndex = scenarioFromElapsedMs(elapsedMs, pkg.scenarioDurationMs, pkg.scenarioCount);
  return cleanTime(pkg, elapsedMs, scenarioIndex);
}

function interpolateReference(pkg, targetUs) {
  if (!packageCleanAtUs(pkg, targetUs)) return null;
  const times = pkg.refTimesUs;
  const index = lowerBound(times, targetUs);
  if (index <= 0 || index >= times.length) return null;
  const leftTime = times[index - 1];
  const rightTime = times[index];
  if ((rightTime - leftTime) > MAX_LABEL_BRACKET_GAP_US) return null;
  const alpha = (targetUs - leftTime) / Math.max(1, rightTime - leftTime);
  const x = pkg.refX[index - 1] + (pkg.refX[index] - pkg.refX[index - 1]) * alpha;
  const y = pkg.refY[index - 1] + (pkg.refY[index] - pkg.refY[index - 1]) * alpha;
  const dt = (rightTime - leftTime) / 1000000;
  const vx = dt > 0 ? (pkg.refX[index] - pkg.refX[index - 1]) / dt : 0;
  const vy = dt > 0 ? (pkg.refY[index] - pkg.refY[index - 1]) / dt : 0;
  return { x, y, vx, vy, speed: magnitude(vx, vy) };
}

function nearestMotion(pkg, elapsedMs) {
  const index = lowerBound(pkg.motionTimesMs, elapsedMs);
  const candidates = [];
  if (index > 0) candidates.push(index - 1);
  if (index < pkg.motionTimesMs.length) candidates.push(index);
  let best = null;
  for (const candidate of candidates) {
    const distance = Math.abs(pkg.motionTimesMs[candidate] - elapsedMs);
    if (!best || distance < best.distance) best = { index: candidate, distance };
  }
  if (!best || best.distance > 20) return { phase: "unknown", speed: null };
  return { phase: pkg.motionPhase[best.index] || "unknown", speed: pkg.motionSpeed[best.index] };
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

function buildRows(packages) {
  const rows = [];
  const skipped = {};
  for (const pkg of packages) {
    for (const anchor of pkg.anchors) {
      const target = resolveTarget(anchor);
      if (!target) {
        addCount(skipped, "missing_target");
        continue;
      }
      const label = interpolateReference(pkg, target.labelUs);
      if (!label) {
        addCount(skipped, "missing_label");
        continue;
      }
      const idx = lowerBound(pkg.refTimesUs, anchor.elapsedUs + 0.000001) - 1;
      if (idx < 12) {
        addCount(skipped, "insufficient_history");
        continue;
      }
      const latestAgeUs = anchor.elapsedUs - pkg.refTimesUs[idx];
      if (latestAgeUs > 100000) {
        addCount(skipped, "stale_history");
        continue;
      }
      const motion = nearestMotion(pkg, target.labelUs / 1000);
      const row = {
        packageId: pkg.id,
        machineKey: pkg.machineKey,
        refreshBucket: pkg.refreshBucket,
        split: anchor.split,
        schedulerProvenance: anchor.schedulerProvenance || "(blank)",
        horizonMs: target.horizonMs,
        latestX: pkg.refX[idx],
        latestY: pkg.refY[idx],
        labelX: label.x,
        labelY: label.y,
        labelVx: label.vx,
        labelVy: label.vy,
        labelSpeed: label.speed,
        speedBin: speedBin(label.speed),
        phase: motion.phase,
        motionSpeed: motion.speed,
        historyGapMs: latestAgeUs / 1000,
        refresh60: pkg.refreshBucket === "60Hz" ? 1 : 0,
        provenanceDwm: anchor.schedulerProvenance === "dwm" ? 1 : 0,
        velocities: {},
        path: analyzePath(pkg, idx, 12),
        memory: memoryFeatures(pkg, idx, 12),
      };
      for (const n of [2, 3, 5, 8, 12]) row.velocities[n] = velocityN(pkg, idx, n);
      rows.push(row);
    }
  }
  return { rows, skipped };
}

function velocityN(pkg, idx, n) {
  if (n === 2) {
    const dt = (pkg.refTimesUs[idx] - pkg.refTimesUs[idx - 1]) / 1000000;
    if (dt <= 0) return { vx: 0, vy: 0, speed: 0, valid: false };
    const vx = (pkg.refX[idx] - pkg.refX[idx - 1]) / dt;
    const vy = (pkg.refY[idx] - pkg.refY[idx - 1]) / dt;
    return { vx, vy, speed: magnitude(vx, vy), valid: true };
  }
  if (idx + 1 < n) return { vx: 0, vy: 0, speed: 0, valid: false };
  const first = idx - n + 1;
  const baseUs = pkg.refTimesUs[idx];
  let sumT = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = first; i <= idx; i += 1) {
    const t = (pkg.refTimesUs[i] - baseUs) / 1000000;
    sumT += t;
    sumX += pkg.refX[i];
    sumY += pkg.refY[i];
  }
  const meanT = sumT / n;
  const meanX = sumX / n;
  const meanY = sumY / n;
  let denominator = 0;
  let numeratorX = 0;
  let numeratorY = 0;
  for (let i = first; i <= idx; i += 1) {
    const centeredT = ((pkg.refTimesUs[i] - baseUs) / 1000000) - meanT;
    denominator += centeredT * centeredT;
    numeratorX += centeredT * (pkg.refX[i] - meanX);
    numeratorY += centeredT * (pkg.refY[i] - meanY);
  }
  if (denominator <= 0) return { vx: 0, vy: 0, speed: 0, valid: false };
  const vx = numeratorX / denominator;
  const vy = numeratorY / denominator;
  return { vx, vy, speed: magnitude(vx, vy), valid: true };
}

function analyzePath(pkg, idx, n) {
  const first = Math.max(0, idx - n + 1);
  let path = 0;
  let reversals = 0;
  let previousSignX = 0;
  let previousSignY = 0;
  for (let i = first + 1; i <= idx; i += 1) {
    const dx = pkg.refX[i] - pkg.refX[i - 1];
    const dy = pkg.refY[i] - pkg.refY[i - 1];
    path += magnitude(dx, dy);
    const sx = dx > 0.5 ? 1 : dx < -0.5 ? -1 : 0;
    const sy = dy > 0.5 ? 1 : dy < -0.5 ? -1 : 0;
    if (sx !== 0 && previousSignX !== 0 && sx !== previousSignX) reversals += 1;
    if (sy !== 0 && previousSignY !== 0 && sy !== previousSignY) reversals += 1;
    if (sx !== 0) previousSignX = sx;
    if (sy !== 0) previousSignY = sy;
  }
  const net = magnitude(pkg.refX[idx] - pkg.refX[first], pkg.refY[idx] - pkg.refY[first]);
  const efficiency = path > 0 ? net / path : 0;
  return { path, net, efficiency, reversals };
}

function memoryFeatures(pkg, idx, n) {
  const result = [];
  for (let k = 0; k < n; k += 1) {
    const i = idx - k;
    if (i <= 0) {
      result.push({ vx: 0, vy: 0, dx: 0, dy: 0, dtMs: 0 });
      continue;
    }
    const dt = (pkg.refTimesUs[i] - pkg.refTimesUs[i - 1]) / 1000000;
    const dx = pkg.refX[i] - pkg.refX[i - 1];
    const dy = pkg.refY[i] - pkg.refY[i - 1];
    result.push({ vx: dt > 0 ? dx / dt : 0, vy: dt > 0 ? dy / dt : 0, dx, dy, dtMs: dt * 1000 });
  }
  return result;
}

function predictBaseline(model, row) {
  if (model.family === "constant_position") return { x: row.latestX, y: row.latestY };
  const params = model.params || {};
  const n = params.n || 2;
  const velocity = row.velocities[n] || row.velocities[2];
  if (!velocity || !velocity.valid) return { x: row.latestX, y: row.latestY };
  let horizonMs = row.horizonMs + (params.offsetMs || 0);
  if (Number.isFinite(params.horizonCapMs) && params.horizonCapMs > 0) horizonMs = Math.min(horizonMs, params.horizonCapMs);
  if (horizonMs <= 0) return { x: row.latestX, y: row.latestY };
  let capPx = params.capPx;
  if (Number.isFinite(params.highSpeedCapPx) && velocity.speed >= (params.highSpeedThreshold || Infinity) && row.path.efficiency >= 0.75 && row.path.net >= 160) {
    capPx = params.highSpeedCapPx;
  }
  const clipped = clampVector(
    velocity.vx * (horizonMs / 1000) * (params.gain || 1),
    velocity.vy * (horizonMs / 1000) * (params.gain || 1),
    capPx,
  );
  return { x: row.latestX + clipped.dx, y: row.latestY + clipped.dy };
}

function predictGate(model, row) {
  const p = model.params;
  const speed = row.velocities[p.gateSpeedN || 12]?.speed ?? 0;
  const holdFloor = speed <= p.speedThreshold || row.path.net <= p.netThreshold || row.path.efficiency < p.efficiencyThreshold || row.historyGapMs > p.maxHistoryGapMs;
  if (holdFloor) return { x: row.latestX, y: row.latestY };
  return predictBaseline({ family: "least_squares", params: { n: p.n, gain: p.gain, capPx: p.capPx, offsetMs: p.offsetMs } }, row);
}

function signedAlongMotion(pred, row) {
  const speed = magnitude(row.labelVx, row.labelVy);
  if (!Number.isFinite(speed) || speed < 1) return null;
  return ((pred.x - row.labelX) * row.labelVx + (pred.y - row.labelY) * row.labelVy) / speed;
}

function errorOf(pred, row) {
  return magnitude(pred.x - row.labelX, pred.y - row.labelY);
}

function validationObjective(error) {
  return (error.p95 ?? Infinity)
    + 0.25 * (error.p99 ?? Infinity)
    + 20 * (error.regressionRates.gt5px ?? 1)
    + 45 * (error.regressionRates.gt10px ?? 1)
    + 0.25 * Math.abs(error.signedAlongMotion.mean ?? 0)
    + 0.5 * Math.max(0, (error.signedAlongMotion.lagRate ?? 0.5) - 0.75);
}

function generateGateCandidates() {
  const candidates = [];
  for (const speedThreshold of [25, 50, 100, 200, 400]) {
    for (const netThreshold of [0, 4, 12]) {
      for (const efficiencyThreshold of [0, 0.35, 0.65]) {
        for (const n of [8, 12]) {
          for (const gain of [0.85, 1, 1.15, 1.3]) {
            for (const capPx of [12, 24, 48]) {
              for (const offsetMs of [-2, 0, 2, 4]) {
                candidates.push({
                  id: `gate_s${speedThreshold}_net${netThreshold}_eff${Math.round(efficiencyThreshold * 100)}_ls${n}_g${Math.round(gain * 100)}_cap${capPx}_off${offsetMs}`,
                  family: "state_gated_least_squares",
                  productCandidate: true,
                  analysisOnly: false,
                  params: { speedThreshold, netThreshold, efficiencyThreshold, n, gain, capPx, offsetMs, maxHistoryGapMs: 40, gateSpeedN: n },
                });
              }
            }
          }
        }
      }
    }
  }
  return candidates;
}

function evaluateModelRows(model, rows, holdouts, predict) {
  const store = new EvalStore();
  for (const row of rows) {
    const pred = predict(model, row);
    const error = errorOf(pred, row);
    store.addRow(model, row, error, signedAlongMotion(pred, row), holdouts);
  }
  return store.finalize();
}

function validationMetricForModel(model, rows, predict) {
  const acc = createAccumulator();
  for (const row of rows) {
    if (row.split !== "validation") continue;
    const pred = predict(model, row);
    addError(acc, errorOf(pred, row), signedAlongMotion(pred, row));
  }
  return finalizeAccumulator(acc);
}

function searchStep5(rows, holdouts) {
  const validationRows = rows.filter((row) => row.split === "validation");
  const allCandidates = generateGateCandidates();
  const ranking = [];
  for (const model of allCandidates) {
    const error = validationMetricForModel(model, validationRows, predictGate);
    ranking.push({
      modelId: model.id,
      family: model.family,
      params: model.params,
      validation: error,
      objective: round(validationObjective(error), 6),
    });
  }
  ranking.sort((a, b) => a.objective - b.objective || (a.validation.p95 ?? Infinity) - (b.validation.p95 ?? Infinity));
  const selectedGateIds = new Set(ranking.slice(0, 16).map((item) => item.modelId));
  const selectedGates = allCandidates.filter((model) => selectedGateIds.has(model.id));
  const evaluatedModels = [...BASELINE_MODELS, ...selectedGates];
  const scores = {};
  for (const model of evaluatedModels) {
    scores[model.id] = evaluateModelRows(model, rows, holdouts, model.family === "state_gated_least_squares" ? predictGate : predictBaseline);
  }
  const selected = ranking[0];
  return {
    candidatesEvaluated: allCandidates.length,
    validationRanking: ranking.slice(0, 50),
    selectedModel: selected,
    evaluatedModelIds: evaluatedModels.map((model) => model.id),
    scores,
    holdoutSignals: holdoutSignals(scores[selected.modelId], selected.modelId),
    brokenCandidates: ranking.slice(-10).reverse(),
  };
}

function holdoutSignals(scoreSections, modelId) {
  const rows = scoreSections?.byHoldout || [];
  const byHoldout = new Map();
  for (const row of rows) {
    if (row.modelId !== modelId) continue;
    const entry = byHoldout.get(row.holdoutId) || { holdoutId: row.holdoutId, holdoutKind: row.holdoutKind, train: null, test: null };
    entry[row.holdoutRole] = compactError(row.error);
    byHoldout.set(row.holdoutId, entry);
  }
  return [...byHoldout.values()].map((entry) => ({
    ...entry,
    p95DeltaTestMinusTrain: entry.train && entry.test ? round(entry.test.p95 - entry.train.p95) : null,
    p99DeltaTestMinusTrain: entry.train && entry.test ? round(entry.test.p99 - entry.train.p99) : null,
  })).sort((a, b) => String(a.holdoutId).localeCompare(String(b.holdoutId)));
}

function compactError(error) {
  return {
    count: error.count,
    mean: error.mean,
    median: error.median,
    p95: error.p95,
    p99: error.p99,
    max: error.max,
    gt5: error.regressionRates.gt5px,
    gt10: error.regressionRates.gt10px,
    signedMean: error.signedAlongMotion.mean,
    lagRate: error.signedAlongMotion.lagRate,
  };
}

function denseBaseFeatures(row) {
  const v2 = row.velocities[2] || { vx: 0, vy: 0, speed: 0 };
  const v3 = row.velocities[3] || { vx: 0, vy: 0, speed: 0 };
  const v8 = row.velocities[8] || { vx: 0, vy: 0, speed: 0 };
  const v12 = row.velocities[12] || { vx: 0, vy: 0, speed: 0 };
  return [
    row.horizonMs / 16.67,
    row.refresh60,
    row.provenanceDwm,
    row.historyGapMs / 10,
    Math.min(5, v2.speed / 1000),
    Math.min(5, v12.speed / 1000),
    v2.vx * row.horizonMs / 1000 / 32,
    v2.vy * row.horizonMs / 1000 / 32,
    v3.vx * row.horizonMs / 1000 / 32,
    v3.vy * row.horizonMs / 1000 / 32,
    v8.vx * row.horizonMs / 1000 / 32,
    v8.vy * row.horizonMs / 1000 / 32,
    v12.vx * row.horizonMs / 1000 / 32,
    v12.vy * row.horizonMs / 1000 / 32,
    row.path.net / 128,
    row.path.path / 256,
    row.path.efficiency,
    row.path.reversals / 8,
  ];
}

function memoryProjectionFeatures(row, k, options) {
  const out = [];
  for (let i = 0; i < k; i += 1) {
    const memory = row.memory[i] || { vx: 0, vy: 0, dx: 0, dy: 0, dtMs: 0 };
    const decay = options.decay ? Math.exp(-i / options.decay) : 1;
    const horizonScale = options.horizon ? row.horizonMs / 16.67 : 1;
    out.push(memory.vx * row.horizonMs / 1000 / 32 * decay * horizonScale);
    out.push(memory.vy * row.horizonMs / 1000 / 32 * decay * horizonScale);
    if (options.includeDt) out.push(memory.dtMs / 8);
  }
  return out;
}

function compactMemoryFeatures(row, k, options) {
  let sumVx = 0;
  let sumVy = 0;
  let sumAbs = 0;
  let valid = 0;
  for (let i = 0; i < k; i += 1) {
    const memory = row.memory[i] || { vx: 0, vy: 0 };
    const weight = options.decay ? Math.exp(-i / options.decay) : 1;
    sumVx += memory.vx * weight;
    sumVy += memory.vy * weight;
    sumAbs += magnitude(memory.vx, memory.vy) * weight;
    valid += weight;
  }
  const scale = row.horizonMs / 1000 / 32 / Math.max(0.0001, valid);
  return [sumVx * scale, sumVy * scale, sumAbs * scale, row.path.net / 128, row.path.efficiency, row.path.reversals / 8];
}

function mlpRandomFeatures(row) {
  const base = denseBaseFeatures(row);
  const hidden = [];
  for (let h = 0; h < 16; h += 1) {
    let sum = 0;
    for (let i = 0; i < base.length; i += 1) {
      sum += base[i] * deterministicWeight(h, i);
    }
    hidden.push(Math.tanh(sum + deterministicWeight(h, base.length)));
  }
  return [...base, ...hidden];
}

function deterministicWeight(a, b) {
  const x = Math.sin((a + 1) * 12.9898 + (b + 1) * 78.233) * 43758.5453;
  return ((x - Math.floor(x)) - 0.5) * 0.7;
}

function mlFeatureDefs() {
  return [
    {
      id: "ridge_residual_dense",
      family: "ridge_residual",
      featureKind: "dense",
      productCandidate: true,
      analysisOnly: false,
      description: "Dense causal hand features with ridge head.",
      feature: denseBaseFeatures,
      lambda: 0.1,
      estimatedOps: 80,
    },
    {
      id: "FSMN_k4_ridge",
      family: "FSMN",
      featureKind: "fsmn",
      productCandidate: true,
      analysisOnly: false,
      description: "Causal finite-memory projections over last 4 velocity deltas.",
      feature: (row) => [...denseBaseFeatures(row).slice(0, 6), ...memoryProjectionFeatures(row, 4, { decay: 3, horizon: false, includeDt: false })],
      lambda: 0.1,
      estimatedOps: 96,
    },
    {
      id: "CSFSMN_k8_ridge",
      family: "CSFSMN",
      featureKind: "compact_fsmn",
      productCandidate: true,
      analysisOnly: false,
      description: "Compact shared finite-memory summary over last 8 deltas.",
      feature: (row) => [...denseBaseFeatures(row).slice(0, 8), ...compactMemoryFeatures(row, 8, { decay: 4 })],
      lambda: 0.1,
      estimatedOps: 76,
    },
    {
      id: "VFSMN_k8_ridge",
      family: "VFSMN",
      featureKind: "variable_fsmn",
      productCandidate: true,
      analysisOnly: false,
      description: "Variable-horizon FSMN projections over last 8 deltas.",
      feature: (row) => [...denseBaseFeatures(row).slice(0, 8), ...memoryProjectionFeatures(row, 8, { decay: 4, horizon: true, includeDt: false })],
      lambda: 0.15,
      estimatedOps: 152,
    },
    {
      id: "VFSMNv2_k12_ridge",
      family: "VFSMNv2",
      featureKind: "variable_fsmn_v2",
      productCandidate: true,
      analysisOnly: false,
      description: "Variable-horizon FSMNv2 with dt and refresh/provenance context.",
      feature: (row) => [...denseBaseFeatures(row), ...memoryProjectionFeatures(row, 12, { decay: 5, horizon: true, includeDt: true })],
      lambda: 0.2,
      estimatedOps: 240,
    },
    {
      id: "CVFSMN_k8_ridge",
      family: "CVFSMN",
      featureKind: "compact_variable_fsmn",
      productCandidate: true,
      analysisOnly: false,
      description: "Compact variable FSMN summary with speed and path context.",
      feature: (row) => [...denseBaseFeatures(row), ...compactMemoryFeatures(row, 8, { decay: 4 })],
      lambda: 0.15,
      estimatedOps: 112,
    },
    {
      id: "CVFSMNv2_k12_ridge",
      family: "CVFSMNv2",
      featureKind: "compact_variable_fsmn_v2",
      productCandidate: true,
      analysisOnly: false,
      description: "Largest CPU-oriented compact variable FSMN candidate.",
      feature: (row) => [...denseBaseFeatures(row), ...compactMemoryFeatures(row, 12, { decay: 5 }), ...memoryProjectionFeatures(row, 4, { decay: 2, horizon: true, includeDt: true })],
      lambda: 0.25,
      estimatedOps: 180,
    },
    {
      id: "small_mlp_tanh16_ridge_head",
      family: "MLP",
      featureKind: "fixed_tanh_hidden_ridge_head",
      productCandidate: false,
      analysisOnly: false,
      description: "Small deterministic tanh hidden layer plus ridge head; precision probe, not a preferred product shape.",
      feature: mlpRandomFeatures,
      lambda: 0.25,
      estimatedOps: 640,
    },
  ];
}

function fitRidgeModel(def, trainRows) {
  const rawFeatures = trainRows.map((row) => def.feature(row));
  const dimension = rawFeatures[0].length;
  const mean = new Array(dimension).fill(0);
  const variance = new Array(dimension).fill(0);
  for (const features of rawFeatures) {
    for (let i = 0; i < dimension; i += 1) mean[i] += features[i];
  }
  for (let i = 0; i < dimension; i += 1) mean[i] /= Math.max(1, rawFeatures.length);
  for (const features of rawFeatures) {
    for (let i = 0; i < dimension; i += 1) {
      const d = features[i] - mean[i];
      variance[i] += d * d;
    }
  }
  const std = variance.map((value) => {
    const s = Math.sqrt(value / Math.max(1, rawFeatures.length - 1));
    return s > 1e-6 ? s : 1;
  });
  const p = dimension + 1;
  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xtyX = new Array(p).fill(0);
  const xtyY = new Array(p).fill(0);
  for (let r = 0; r < trainRows.length; r += 1) {
    const row = trainRows[r];
    const x = new Array(p).fill(1);
    for (let i = 0; i < dimension; i += 1) x[i + 1] = (rawFeatures[r][i] - mean[i]) / std[i];
    const dx = row.labelX - row.latestX;
    const dy = row.labelY - row.latestY;
    for (let i = 0; i < p; i += 1) {
      xtyX[i] += x[i] * dx;
      xtyY[i] += x[i] * dy;
      for (let j = 0; j < p; j += 1) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < p; i += 1) xtx[i][i] += def.lambda || 0.1;
  return {
    ...def,
    dimension,
    mean,
    std,
    betaX: solveLinearSystem(xtx.map((row) => row.slice()), xtyX.slice()),
    betaY: solveLinearSystem(xtx.map((row) => row.slice()), xtyY.slice()),
  };
}

function solveLinearSystem(a, b) {
  const n = b.length;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) continue;
    if (pivot !== col) {
      const tmp = a[pivot];
      a[pivot] = a[col];
      a[col] = tmp;
      const tb = b[pivot];
      b[pivot] = b[col];
      b[col] = tb;
    }
    const div = a[col][col];
    for (let j = col; j < n; j += 1) a[col][j] /= div;
    b[col] /= div;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = col; j < n; j += 1) a[row][j] -= factor * a[col][j];
      b[row] -= factor * b[col];
    }
  }
  return b;
}

function predictRidge(model, row) {
  const raw = model.feature(row);
  let dx = model.betaX[0];
  let dy = model.betaY[0];
  for (let i = 0; i < model.dimension; i += 1) {
    const value = (raw[i] - model.mean[i]) / model.std[i];
    dx += model.betaX[i + 1] * value;
    dy += model.betaY[i + 1] * value;
  }
  const clipped = clampVector(dx, dy, MAX_OUTPUT_DELTA_PX);
  return { x: row.latestX + clipped.dx, y: row.latestY + clipped.dy };
}

function searchStep6(rows, holdouts) {
  const trainRows = rows.filter((row) => row.split === "train");
  const defs = mlFeatureDefs();
  const models = defs.map((def) => fitRidgeModel(def, trainRows));
  const ranking = [];
  const scores = {};
  for (const model of models) {
    const sections = evaluateModelRows(model, rows, holdouts, predictRidge);
    scores[model.id] = sections;
    const validation = (sections.bySplit || []).find((row) => row.split === "validation" && row.modelId === model.id)?.error;
    ranking.push({
      modelId: model.id,
      family: model.family,
      featureKind: model.featureKind,
      dimension: model.dimension,
      estimatedOpsPerPrediction: model.estimatedOps,
      productCandidate: model.productCandidate,
      validation,
      objective: round(validationObjective(validation), 6),
    });
  }
  ranking.sort((a, b) => a.objective - b.objective || (a.validation?.p95 ?? Infinity) - (b.validation?.p95 ?? Infinity));
  const selected = ranking[0];
  return {
    modelsEvaluated: models.length,
    trainingRows: trainRows.length,
    validationRanking: ranking,
    selectedModel: selected,
    scores,
    holdoutSignals: holdoutSignals(scores[selected.modelId], selected.modelId),
    cpuImplementationNotes: models.map((model) => ({
      modelId: model.id,
      family: model.family,
      dimension: model.dimension,
      estimatedOpsPerPrediction: model.estimatedOps,
      productCandidate: model.productCandidate,
      simdSuitability: model.dimension >= 16 ? "good AVX2/AVX-512 dot-product candidate" : "small scalar or SIMD both acceptable",
    })),
    brokenCandidates: ranking.slice(-5).reverse(),
  };
}

function datasetSummary(rows, skipped, packages) {
  const bySplit = {};
  const byRefresh = {};
  const byPhase = {};
  const bySpeed = {};
  for (const row of rows) {
    addCount(bySplit, row.split);
    addCount(byRefresh, row.refreshBucket);
    addCount(byPhase, row.phase);
    addCount(bySpeed, row.speedBin);
  }
  return {
    rows: rows.length,
    skipped,
    bySplit,
    byRefresh,
    byPhase,
    bySpeedBin: bySpeed,
    packages: packages.map((pkg) => ({
      id: pkg.id,
      sourceZip: pkg.sourceZip,
      referencePollRows: pkg.refTimesUs.length,
      runtimeSchedulerAnchors: pkg.anchors.length,
      motionRows: pkg.motionTimesMs.length,
      refreshBucket: pkg.refreshBucket,
      machineKey: pkg.machineKey,
    })),
  };
}

function buildStep5Scores(root, manifestPath, manifest, data, step5) {
  const baselineComparison = {};
  for (const modelId of ["current_product_equivalent", "least_squares_n12_gain100_cap24", "constant_position", step5.selectedModel.modelId]) {
    const sections = step5.scores[modelId];
    if (!sections) continue;
    baselineComparison[modelId] = {
      validation: compactError(sections.bySplit.find((row) => row.split === "validation")?.error || finalizeAccumulator(createAccumulator())),
      test: compactError(sections.bySplit.find((row) => row.split === "test")?.error || finalizeAccumulator(createAccumulator())),
    };
  }
  return {
    schemaVersion: `${SCHEMA_VERSION}/step-5`,
    generatedAtUtc: new Date().toISOString(),
    root,
    manifestPath: path.relative(root, manifestPath).replaceAll(path.sep, "/"),
    constraints: {
      gpuUsed: false,
      trainingRun: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
      execution: "single-process CPU-only sequential gate search",
    },
    evaluationContract: {
      anchor: TARGET_EVENT,
      horizon: "v9_target",
      productInputs: ["causal referencePoll history", "v9 target horizon", "scheduler provenance", "refresh bucket", "history gap", "speed", "path stability"],
      analysisOnlyBreakdowns: ["motion-samples.csv movementPhase", "label speed bins"],
    },
    dataset: data,
    search: {
      candidatesEvaluated: step5.candidatesEvaluated,
      objective: "p95 + 0.25*p99 + weighted >5/>10px + signed lag penalties",
      selectedModel: step5.selectedModel,
      validationRanking: step5.validationRanking,
      brokenCandidates: step5.brokenCandidates,
    },
    baselineComparison,
    scores: step5.scores,
    holdoutSignals: step5.holdoutSignals,
  };
}

function buildStep6Scores(root, manifestPath, data, step6) {
  const baselineIds = ["current_product_equivalent", "least_squares_n12_gain100_cap24"];
  return {
    schemaVersion: `${SCHEMA_VERSION}/step-6`,
    generatedAtUtc: new Date().toISOString(),
    root,
    manifestPath: path.relative(root, manifestPath).replaceAll(path.sep, "/"),
    constraints: {
      gpuUsed: false,
      trainingRun: true,
      trainingExecution: "in-memory CPU ridge solves only; no checkpoint or large intermediate file",
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
    },
    evaluationContract: {
      anchor: TARGET_EVENT,
      horizon: "v9_target",
      trainingSplit: "train",
      modelFamilies: ["FSMN", "CSFSMN", "VFSMN", "VFSMNv2", "CVFSMN", "CVFSMNv2", "MLP", "ridge_residual"],
      productConstraint: "Final product candidates must remain CPU/SIMD deployable; GPU is not used in the application.",
    },
    dataset: data,
    search: {
      modelsEvaluated: step6.modelsEvaluated,
      trainingRows: step6.trainingRows,
      objective: "p95 + 0.25*p99 + weighted >5/>10px + signed lag penalties",
      selectedModel: step6.selectedModel,
      validationRanking: step6.validationRanking,
      brokenCandidates: step6.brokenCandidates,
      cpuImplementationNotes: step6.cpuImplementationNotes,
    },
    comparisonBaselines: baselineIds,
    scores: step6.scores,
    holdoutSignals: step6.holdoutSignals,
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

function renderStep5Report(scores) {
  const rankingRows = scores.search.validationRanking.slice(0, 12).map((row, index) => [
    index + 1,
    row.modelId,
    row.validation.count,
    fmt(row.validation.mean),
    fmt(row.validation.p95),
    fmt(row.validation.p99),
    fmt(row.validation.regressionRates.gt5px, 6),
    fmt(row.validation.regressionRates.gt10px, 6),
    fmt(row.validation.signedAlongMotion.mean),
    fmt(row.objective),
  ]);
  const comparisonRows = Object.entries(scores.baselineComparison).map(([id, item]) => [
    id,
    fmt(item.validation.mean),
    fmt(item.validation.p95),
    fmt(item.validation.p99),
    fmt(item.validation.gt5, 6),
    fmt(item.validation.gt10, 6),
    fmt(item.validation.signedMean),
    fmt(item.test.p95),
    fmt(item.test.p99),
  ]);
  const holdoutRows = scores.holdoutSignals.map((row) => [
    row.holdoutId,
    row.holdoutKind,
    fmt(row.train?.p95),
    fmt(row.test?.p95),
    fmt(row.p95DeltaTestMinusTrain),
    fmt(row.train?.p99),
    fmt(row.test?.p99),
    fmt(row.p99DeltaTestMinusTrain),
  ]);
  const phaseRows = scores.scores[scores.search.selectedModel.modelId].byPhase
    .filter((row) => row.split === "validation" || row.split === "test")
    .map((row) => [row.split, row.movementPhase, row.error.count, fmt(row.error.mean), fmt(row.error.p95), fmt(row.error.p99), fmt(row.error.signedAlongMotion.mean)]);
  const speedRows = scores.scores[scores.search.selectedModel.modelId].bySpeedBin
    .filter((row) => row.split === "validation" || row.split === "test")
    .map((row) => [row.split, row.speedBin, row.error.count, fmt(row.error.mean), fmt(row.error.p95), fmt(row.error.p99), fmt(row.error.regressionRates.gt10px, 6)]);
  return `# Step 5 State-Gated Search

## Scope

This step searches product-safe state gates using \`runtimeSchedulerPoll + v9_target\` as the main evaluation contract. Candidate inputs are causal referencePoll history, v9 target horizon, scheduler provenance, refresh bucket, history gap, speed, and path stability. Motion phase is used only for analysis breakdowns.

No GPU, checkpoint, raw ZIP copy, or large intermediate file was used.

## Selected Gate

Selected model: \`${scores.search.selectedModel.modelId}\`

Objective: ${scores.search.objective}

Candidates evaluated: ${scores.search.candidatesEvaluated}

## Validation Ranking

${table(["rank", "model", "count", "mean", "p95", "p99", ">5", ">10", "signed mean", "objective"], rankingRows)}

## Baseline Comparison

${table(["model", "val mean", "val p95", "val p99", "val >5", "val >10", "val signed", "test p95", "test p99"], comparisonRows)}

## Holdout Signals

${table(["holdout", "kind", "train p95", "test p95", "delta p95", "train p99", "test p99", "delta p99"], holdoutRows)}

## Movement Phase Breakdown

${table(["split", "phase", "count", "mean", "p95", "p99", "signed mean"], phaseRows)}

## Speed Bin Breakdown

${table(["split", "speed", "count", "mean", "p95", "p99", ">10"], speedRows)}

## Interpretation

- The gate explicitly keeps constant-position behavior for low-speed or unstable history and switches to least-squares only when the causal path looks useful.
- The selected gate should be compared against \`least_squares_n12_gain100_cap24\` rather than against \`constant_position\` alone, because the latter wins low-horizon p95 but leaves a strong lag signature during motion.
- 30Hz holdout deltas remain important because Step 3 showed 30Hz as the likely cross-refresh weak spot.
`;
}

function renderStep5Notes() {
  return `# Step 5 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v12\\scripts\\run-step5-step6.js
\`\`\`

## Product-Safe Rule

The gate does not use \`movementPhase\`, \`holdIndex\`, or any future label. It uses only causal referencePoll history and runtime timing/context available to the product.

## Objective

Selection uses p95, p99, >5px, >10px, signed lag, and lag-rate penalties. This intentionally avoids choosing a candidate that improves p95 while creating a bad tail or one-sided lag.
`;
}

function renderStep6Report(scores) {
  const rankingRows = scores.search.validationRanking.map((row, index) => [
    index + 1,
    row.modelId,
    row.family,
    row.dimension,
    row.estimatedOpsPerPrediction,
    row.productCandidate ? "yes" : "no",
    fmt(row.validation.mean),
    fmt(row.validation.p95),
    fmt(row.validation.p99),
    fmt(row.validation.regressionRates.gt10px, 6),
    fmt(row.validation.signedAlongMotion.mean),
    fmt(row.objective),
  ]);
  const selectedSections = scores.scores[scores.search.selectedModel.modelId];
  const splitRows = selectedSections.bySplit.map((row) => [
    row.split,
    row.error.count,
    fmt(row.error.mean),
    fmt(row.error.p95),
    fmt(row.error.p99),
    fmt(row.error.regressionRates.gt5px, 6),
    fmt(row.error.regressionRates.gt10px, 6),
    fmt(row.error.signedAlongMotion.mean),
    fmt(row.error.signedAlongMotion.lagRate, 6),
  ]);
  const holdoutRows = scores.holdoutSignals.map((row) => [
    row.holdoutId,
    row.holdoutKind,
    fmt(row.train?.p95),
    fmt(row.test?.p95),
    fmt(row.p95DeltaTestMinusTrain),
    fmt(row.train?.p99),
    fmt(row.test?.p99),
    fmt(row.p99DeltaTestMinusTrain),
  ]);
  const refreshRows = selectedSections.byRefresh
    .filter((row) => row.split === "validation" || row.split === "test")
    .map((row) => [
      row.split,
      row.refreshBucket,
      row.error.count,
      fmt(row.error.mean),
      fmt(row.error.p95),
      fmt(row.error.p99),
      fmt(row.error.regressionRates.gt10px, 6),
      fmt(row.error.signedAlongMotion.mean),
    ]);
  const phaseRows = selectedSections.byPhase
    .filter((row) => row.split === "validation" || row.split === "test")
    .map((row) => [
      row.split,
      row.movementPhase,
      row.error.count,
      fmt(row.error.mean),
      fmt(row.error.p95),
      fmt(row.error.p99),
      fmt(row.error.regressionRates.gt10px, 6),
      fmt(row.error.signedAlongMotion.mean),
    ]);
  const speedRows = selectedSections.bySpeedBin
    .filter((row) => row.split === "validation" || row.split === "test")
    .map((row) => [
      row.split,
      row.speedBin,
      row.error.count,
      fmt(row.error.mean),
      fmt(row.error.p95),
      fmt(row.error.p99),
      fmt(row.error.regressionRates.gt10px, 6),
      fmt(row.error.signedAlongMotion.mean),
    ]);
  const cpuRows = scores.search.cpuImplementationNotes.map((row) => [
    row.modelId,
    row.family,
    row.dimension,
    row.estimatedOpsPerPrediction,
    row.productCandidate ? "yes" : "no",
    row.simdSuitability,
  ]);
  const brokenRows = scores.search.brokenCandidates.map((row) => [
    row.modelId,
    row.family,
    fmt(row.validation.mean),
    fmt(row.validation.p95),
    fmt(row.validation.p99),
    fmt(row.validation.regressionRates.gt10px, 6),
    fmt(row.objective),
  ]);
  return `# Step 6 ML / FSMN Search

## Scope

This step compares CPU-deployable FSMN-family ridge heads, a dense ridge residual, and a small MLP-like fixed tanh hidden layer. Training is in-memory CPU normal-equation solving on the train split only. No GPU, checkpoint, raw ZIP copy, or large intermediate file was used.

## Validation Ranking

${table(["rank", "model", "family", "dim", "ops", "product", "mean", "p95", "p99", ">10", "signed mean", "objective"], rankingRows)}

## Selected Model Split Scores

Selected model: \`${scores.search.selectedModel.modelId}\`

${table(["split", "count", "mean", "p95", "p99", ">5", ">10", "signed mean", "lag rate"], splitRows)}

## Holdout Signals

${table(["holdout", "kind", "train p95", "test p95", "delta p95", "train p99", "test p99", "delta p99"], holdoutRows)}

## Refresh Breakdown

${table(["split", "refresh", "count", "mean", "p95", "p99", ">10", "signed mean"], refreshRows)}

## Movement Phase Breakdown

${table(["split", "phase", "count", "mean", "p95", "p99", ">10", "signed mean"], phaseRows)}

## Speed Bin Breakdown

${table(["split", "speed", "count", "mean", "p95", "p99", ">10", "signed mean"], speedRows)}

## CPU Implementation Notes

${table(["model", "family", "dim", "ops", "product", "SIMD"], cpuRows)}

## Broken / Weak Candidates

${table(["model", "family", "mean", "p95", "p99", ">10", "objective"], brokenRows)}

## Interpretation

- These ML/FSMN candidates are precision probes first and product candidates second.
- A candidate that only wins validation p95 but worsens p99, >10px, lag, or 30Hz holdout should not be promoted.
- The MLP-like candidate is intentionally marked non-preferred for product because it is harder to reason about and less directly SIMD-friendly than the ridge/FSMN family.
`;
}

function renderStep6Notes() {
  return `# Step 6 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v12\\scripts\\run-step5-step6.js
\`\`\`

## Training

Training is limited to the \`train\` split and happens entirely in memory. The script writes only aggregate scores and reports. No model checkpoint is persisted.

## Family Mapping

- FSMN: explicit finite-memory velocity projections.
- CSFSMN: compact shared memory summaries.
- VFSMN/VFSMNv2: horizon-conditioned memory projections.
- CVFSMN/CVFSMNv2: compact variable summaries with path and context features.
- MLP: fixed tanh hidden layer with ridge head, used as a small nonlinear precision probe.
`;
}

function updateReadme(readmePath) {
  let text = fs.readFileSync(readmePath, "utf8");
  const additions = [
    "- `step-5-state-gated-search/report.md`: product-safe state-gated least-squares search.",
    "- `step-5-state-gated-search/scores.json`: gate ranking, split/holdout/phase/speed breakdowns.",
    "- `step-5-state-gated-search/notes.md`: product-safe gate notes.",
    "- `step-6-ml-fsmn-search/report.md`: ML/FSMN family precision and CPU deployability search.",
    "- `step-6-ml-fsmn-search/scores.json`: ML/FSMN scores and holdout signals.",
    "- `step-6-ml-fsmn-search/notes.md`: training and family-mapping notes.",
    "- `scripts/run-step5-step6.js`: reproducible state-gate and ML/FSMN search script.",
  ];
  for (const line of additions) {
    if (!text.includes(line)) {
      text = text.replace("- `scripts/run-step3-step4.js`: reproducible baseline/timing audit script.\n", `- \`scripts/run-step3-step4.js\`: reproducible baseline/timing audit script.\n${line}\n`);
    }
  }
  fs.writeFileSync(readmePath, text, "utf8");
}

function writeOutputs(root, outDir, step5, step6) {
  const step5Dir = path.join(outDir, "step-5-state-gated-search");
  const step6Dir = path.join(outDir, "step-6-ml-fsmn-search");
  ensureDir(step5Dir);
  ensureDir(step6Dir);
  fs.writeFileSync(path.join(step5Dir, "scores.json"), JSON.stringify(step5, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(step5Dir, "report.md"), renderStep5Report(step5), "utf8");
  fs.writeFileSync(path.join(step5Dir, "notes.md"), renderStep5Notes(), "utf8");
  fs.writeFileSync(path.join(step6Dir, "scores.json"), JSON.stringify(step6, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(step6Dir, "report.md"), renderStep6Report(step6), "utf8");
  fs.writeFileSync(path.join(step6Dir, "notes.md"), renderStep6Notes(), "utf8");
  updateReadme(path.join(outDir, "README.md"));

  const outputs = [
    path.join(step5Dir, "scores.json"),
    path.join(step5Dir, "report.md"),
    path.join(step5Dir, "notes.md"),
    path.join(step6Dir, "scores.json"),
    path.join(step6Dir, "report.md"),
    path.join(step6Dir, "notes.md"),
    path.join(outDir, "README.md"),
  ];
  process.stdout.write(`Wrote:\n${outputs.map((item) => path.relative(root, item).replaceAll(path.sep, "/")).join("\n")}\n`);
}

function main() {
  const args = parseArgs(process.argv);
  const context = loadManifest(args.manifest);
  const packages = context.manifest.packageScenarioAssignments.map((assignment) => loadPackage(args.root, assignment, context));
  const built = buildRows(packages);
  const data = datasetSummary(built.rows, built.skipped, packages);
  const step5Search = searchStep5(built.rows, context.holdouts);
  const step6Search = searchStep6(built.rows, context.holdouts);
  const step5 = buildStep5Scores(args.root, args.manifest, context.manifest, data, step5Search);
  const step6 = buildStep6Scores(args.root, args.manifest, data, step6Search);
  writeOutputs(args.root, args.outDir, step5, step6);
}

main();
