#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const REQUIRED_COLUMNS = [
  "frameIndex",
  "timestampTicks",
  "elapsedMilliseconds",
  "patternName",
  "phaseName",
  "expectedX",
  "expectedY",
  "expectedVelocityPixelsPerSecond",
  "width",
  "height",
  "darkPixelCount",
  "hasDarkPixels",
  "darkBoundsX",
  "darkBoundsY",
  "darkBoundsWidth",
  "darkBoundsHeight",
  "estimatedSeparationPixels",
];

const DEFAULT_PATTERNS = [
  "linear-slow",
  "hold-right",
  "linear-fast",
  "hold-left",
  "quadratic-ease-in",
  "quadratic-ease-out",
  "cubic-smoothstep",
  "cubic-in-out",
  "rapid-reversal",
  "sine-sweep",
  "short-jitter",
];

const PATTERN_WEIGHTS = new Map([
  ["linear-slow", 1.0],
  ["hold-right", 0.75],
  ["linear-fast", 1.4],
  ["hold-left", 0.75],
  ["quadratic-ease-in", 1.2],
  ["quadratic-ease-out", 1.2],
  ["cubic-smoothstep", 1.2],
  ["cubic-in-out", 1.25],
  ["rapid-reversal", 1.6],
  ["sine-sweep", 1.4],
  ["short-jitter", 1.4],
]);

function parseArgs(argv) {
  const result = { runs: [], baseline: null, out: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run") {
      const spec = argv[++i];
      if (!spec || !spec.includes("=")) {
        throw new Error("--run expects candidateId=path.zip");
      }
      const equals = spec.indexOf("=");
      result.runs.push({
        candidateId: spec.slice(0, equals),
        packagePath: spec.slice(equals + 1),
      });
    } else if (arg === "--baseline") {
      result.baseline = argv[++i];
    } else if (arg === "--out") {
      result.out = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (result.runs.length === 0) {
    throw new Error("At least one --run candidateId=path.zip is required");
  }
  return result;
}

function printHelp() {
  process.stdout.write(`Usage:
  node score-calibration.js --baseline current-default --run current-default=path.zip --out summary.json

Options:
  --run <candidateId=path.zip>   Add one calibrator package. Repeat for more runs.
  --baseline <candidateId>       Candidate id used for delta calculations.
  --out <path>                   Write JSON summary to this path. Defaults to stdout.
`);
}

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("ZIP end-of-central-directory was not found");
}

function listZipEntries(zipPath) {
  const zip = fs.readFileSync(zipPath);
  const eocd = findEocd(zip);
  const centralDirSize = zip.readUInt32LE(eocd + 12);
  const centralDirOffset = zip.readUInt32LE(eocd + 16);
  const entries = [];
  let offset = centralDirOffset;
  const end = centralDirOffset + centralDirSize;
  while (offset < end) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central-directory signature at ${offset}`);
    }
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    entries.push(name);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(zipPath, entryName) {
  const zip = fs.readFileSync(zipPath);
  const eocd = findEocd(zip);
  const centralDirSize = zip.readUInt32LE(eocd + 12);
  const centralDirOffset = zip.readUInt32LE(eocd + 16);
  let offset = centralDirOffset;
  const end = centralDirOffset + centralDirSize;
  while (offset < end) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central-directory signature at ${offset}`);
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    if (name === entryName) {
      if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`Invalid local-file signature for ${entryName}`);
      }
      const localNameLen = zip.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = zip.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
      let data;
      if (method === 0) data = Buffer.from(compressed);
      else if (method === 8) data = zlib.inflateRawSync(compressed);
      else throw new Error(`Unsupported ZIP compression method ${method} for ${entryName}`);
      if (data.length !== uncompressedSize) {
        throw new Error(`Unexpected size for ${entryName}: ${data.length} != ${uncompressedSize}`);
      }
      return data;
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`ZIP entry not found: ${entryName}`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          cell += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolValue(value) {
  return value === true || value === "true" || value === "True";
}

function nearestRank(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[index];
}

function stats(values, frameCount, darkFrameCount) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return {
      frameCount,
      darkFrameCount,
      meanPx: null,
      p50Px: null,
      p90Px: null,
      p95Px: null,
      p99Px: null,
      maxPx: null,
    };
  }
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    frameCount,
    darkFrameCount,
    meanPx: sum / sorted.length,
    p50Px: nearestRank(sorted, 0.5),
    p90Px: nearestRank(sorted, 0.9),
    p95Px: nearestRank(sorted, 0.95),
    p99Px: nearestRank(sorted, 0.99),
    maxPx: sorted[sorted.length - 1],
  };
}

function patternScore(metricStats) {
  if (!Number.isFinite(metricStats.p95Px) || !Number.isFinite(metricStats.p99Px) || !Number.isFinite(metricStats.maxPx)) {
    return null;
  }
  return (0.5 * metricStats.p95Px) + (0.35 * metricStats.p99Px) + (0.15 * metricStats.maxPx);
}

function patternWeight(patternName) {
  return PATTERN_WEIGHTS.get(patternName) || 1.0;
}

function summarizePackage(runSpec) {
  const packagePath = path.resolve(runSpec.packagePath);
  const qualityWarnings = [];
  const entries = listZipEntries(packagePath);
  for (const required of ["frames.csv", "metrics.json"]) {
    if (!entries.includes(required)) {
      throw new Error(`${packagePath} is missing ${required}`);
    }
  }

  const metrics = JSON.parse(readZipEntry(packagePath, "metrics.json").toString("utf8").replace(/^\uFEFF/, ""));
  const csvRows = parseCsv(readZipEntry(packagePath, "frames.csv").toString("utf8").replace(/^\uFEFF/, ""));
  if (csvRows.length === 0) {
    throw new Error(`${packagePath} has an empty frames.csv`);
  }

  const header = csvRows[0];
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  for (const column of missingColumns) {
    qualityWarnings.push(`missing_column:${column}`);
  }
  if (missingColumns.length > 0) {
    throw new Error(`${packagePath} is missing required columns: ${missingColumns.join(", ")}`);
  }

  const index = new Map(header.map((column, i) => [column, i]));
  const patternFrames = new Map();
  const allSeparations = [];
  let darkFrameCount = 0;

  for (let i = 1; i < csvRows.length; i += 1) {
    const row = csvRows[i];
    if (row.length === 1 && row[0] === "") continue;
    const patternName = row[index.get("patternName")] || "";
    if (!patternFrames.has(patternName)) {
      patternFrames.set(patternName, { frameCount: 0, darkFrameCount: 0, separations: [] });
    }
    const group = patternFrames.get(patternName);
    group.frameCount += 1;
    const hasDarkPixels = boolValue(row[index.get("hasDarkPixels")]);
    if (hasDarkPixels) {
      const separation = numberOrNull(row[index.get("estimatedSeparationPixels")]);
      if (Number.isFinite(separation)) {
        group.darkFrameCount += 1;
        group.separations.push(separation);
        allSeparations.push(separation);
        darkFrameCount += 1;
      }
    }
  }

  if (metrics.FrameCount !== undefined && metrics.FrameCount !== csvRows.length - 1) {
    qualityWarnings.push(`frame_count_mismatch:metrics=${metrics.FrameCount}:csv=${csvRows.length - 1}`);
  }
  if (metrics.DarkFrameCount !== undefined && metrics.DarkFrameCount !== darkFrameCount) {
    qualityWarnings.push(`dark_frame_count_mismatch:metrics=${metrics.DarkFrameCount}:csv=${darkFrameCount}`);
  }

  for (const patternName of DEFAULT_PATTERNS) {
    if (!patternFrames.has(patternName)) {
      qualityWarnings.push(`missing_pattern:${patternName}`);
    } else if (patternFrames.get(patternName).darkFrameCount < 10) {
      qualityWarnings.push(`low_dark_frame_count:${patternName}:${patternFrames.get(patternName).darkFrameCount}`);
    }
  }

  const patterns = Array.from(patternFrames.entries()).map(([patternName, group]) => {
    const metricStats = stats(group.separations, group.frameCount, group.darkFrameCount);
    return {
      patternName,
      weight: patternWeight(patternName),
      scorePx: patternScore(metricStats),
      stats: metricStats,
      _separations: group.separations,
    };
  }).sort((a, b) => DEFAULT_PATTERNS.indexOf(a.patternName) - DEFAULT_PATTERNS.indexOf(b.patternName));

  const overallStats = stats(allSeparations, csvRows.length - 1, darkFrameCount);
  return {
    candidateId: runSpec.candidateId,
    packagePath,
    entries,
    metricsJson: {
      frameCount: metrics.FrameCount ?? null,
      darkFrameCount: metrics.DarkFrameCount ?? null,
      captureSource: metrics.CaptureSource ?? null,
      averageEstimatedSeparationPixels: metrics.AverageEstimatedSeparationPixels ?? null,
      p95EstimatedSeparationPixels: metrics.P95EstimatedSeparationPixels ?? null,
      maximumEstimatedSeparationPixels: metrics.MaximumEstimatedSeparationPixels ?? null,
    },
    qualityWarnings,
    overall: {
      scorePx: patternScore(overallStats),
      stats: overallStats,
    },
    patterns,
  };
}

function summarizeCandidates(runs) {
  const byCandidate = new Map();
  for (const run of runs) {
    if (!byCandidate.has(run.candidateId)) byCandidate.set(run.candidateId, []);
    byCandidate.get(run.candidateId).push(run);
  }

  return Array.from(byCandidate.entries()).map(([candidateId, candidateRuns]) => {
    const byPattern = new Map();
    for (const run of candidateRuns) {
      for (const pattern of run.patterns) {
        if (!byPattern.has(pattern.patternName)) {
          byPattern.set(pattern.patternName, { frameCount: 0, darkFrameCount: 0, separations: [] });
        }
        const group = byPattern.get(pattern.patternName);
        group.frameCount += pattern.stats.frameCount;
        group.darkFrameCount += pattern.stats.darkFrameCount;
        group.separations.push(...pattern._separations);
      }
    }

    const patterns = Array.from(byPattern.entries()).map(([patternName, group]) => {
      const metricStats = stats(group.separations, group.frameCount, group.darkFrameCount);
      return {
        patternName,
        weight: patternWeight(patternName),
        scorePx: patternScore(metricStats),
        stats: metricStats,
      };
    }).sort((a, b) => DEFAULT_PATTERNS.indexOf(a.patternName) - DEFAULT_PATTERNS.indexOf(b.patternName));

    let weightedScoreSum = 0;
    let weightSum = 0;
    for (const pattern of patterns) {
      if (Number.isFinite(pattern.scorePx)) {
        weightedScoreSum += pattern.scorePx * pattern.weight;
        weightSum += pattern.weight;
      }
    }

    return {
      candidateId,
      runCount: candidateRuns.length,
      visualScorePx: weightSum === 0 ? null : weightedScoreSum / weightSum,
      qualityWarnings: Array.from(new Set(candidateRuns.flatMap((run) => run.qualityWarnings))),
      patterns,
    };
  }).sort((a, b) => {
    if (a.visualScorePx === null) return 1;
    if (b.visualScorePx === null) return -1;
    return a.visualScorePx - b.visualScorePx;
  });
}

function addBaselineDeltas(candidates, baselineCandidateId) {
  if (!baselineCandidateId) return;
  const baseline = candidates.find((candidate) => candidate.candidateId === baselineCandidateId);
  if (!baseline) return;
  const baselinePatterns = new Map(baseline.patterns.map((pattern) => [pattern.patternName, pattern]));
  for (const candidate of candidates) {
    candidate.deltaToBaselineScorePx = Number.isFinite(candidate.visualScorePx) && Number.isFinite(baseline.visualScorePx)
      ? candidate.visualScorePx - baseline.visualScorePx
      : null;
    for (const pattern of candidate.patterns) {
      const basePattern = baselinePatterns.get(pattern.patternName);
      if (!basePattern) {
        pattern.deltaToBaseline = null;
        continue;
      }
      pattern.deltaToBaseline = {
        scorePx: finiteDelta(pattern.scorePx, basePattern.scorePx),
        meanPx: finiteDelta(pattern.stats.meanPx, basePattern.stats.meanPx),
        p95Px: finiteDelta(pattern.stats.p95Px, basePattern.stats.p95Px),
        p99Px: finiteDelta(pattern.stats.p99Px, basePattern.stats.p99Px),
        maxPx: finiteDelta(pattern.stats.maxPx, basePattern.stats.maxPx),
      };
    }
  }
}

function finiteDelta(value, baseline) {
  return Number.isFinite(value) && Number.isFinite(baseline) ? value - baseline : null;
}

function stripInternal(run) {
  return {
    ...run,
    patterns: run.patterns.map((pattern) => {
      const copy = { ...pattern };
      delete copy._separations;
      return copy;
    }),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const runs = args.runs.map(summarizePackage);
  const candidates = summarizeCandidates(runs);
  addBaselineDeltas(candidates, args.baseline);

  const output = {
    schemaVersion: "cursor-prediction-v7-score/1",
    generatedAt: new Date().toISOString(),
    baselineCandidate: args.baseline,
    objective: {
      sourceColumn: "estimatedSeparationPixels",
      darkFramesOnly: true,
      lowerIsBetter: true,
      patternScoreFormula: "0.50*p95 + 0.35*p99 + 0.15*max",
      candidateScore: "weighted mean of pattern scores",
      patternWeights: Object.fromEntries(PATTERN_WEIGHTS.entries()),
    },
    requiredColumns: REQUIRED_COLUMNS,
    defaultPatterns: DEFAULT_PATTERNS,
    runs: runs.map(stripInternal),
    candidates,
  };

  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}

main();
