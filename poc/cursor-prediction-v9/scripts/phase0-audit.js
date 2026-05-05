#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function parseArgs(argv) {
  const scriptDir = __dirname;
  const defaultRoot = path.resolve(scriptDir, "..", "..", "..");
  const defaultOutDir = path.resolve(scriptDir, "..");
  const args = {
    root: defaultRoot,
    outJson: path.join(defaultOutDir, "phase-0-audit.json"),
    outMd: path.join(defaultOutDir, "phase-0-audit.md"),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--out-json") args.outJson = path.resolve(argv[++i]);
    else if (arg === "--out-md") args.outMd = path.resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node phase0-audit.js [--root <repo>] [--out-json <path>] [--out-md <path>]
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
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
    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return { zip, entries };
}

function readZipEntry(opened, entryName) {
  const entry = opened.entries.get(entryName);
  if (!entry) return null;
  const zip = opened.zip;
  const { localHeaderOffset } = entry;
  if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error(`Invalid local-file signature for ${entryName}`);
  }
  const localNameLen = zip.readUInt16LE(localHeaderOffset + 26);
  const localExtraLen = zip.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
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
  const data = readZipEntry(opened, entryName);
  if (!data) return null;
  const text = data.toString("utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function csvAudit(opened, entryName, groupColumnName) {
  const data = readZipEntry(opened, entryName);
  if (!data) {
    return { present: false, header: [], rowCount: 0, groupCounts: {} };
  }
  const text = data.toString("utf8").replace(/^\uFEFF/, "");
  const firstNewline = text.indexOf("\n");
  const headerLine = (firstNewline >= 0 ? text.slice(0, firstNewline) : text).replace(/\r$/, "");
  const header = headerLine.length > 0 ? headerLine.split(",") : [];
  const groupIndex = groupColumnName ? header.indexOf(groupColumnName) : -1;
  const groupCounts = {};
  let rowCount = 0;
  let pos = firstNewline >= 0 ? firstNewline + 1 : text.length;

  while (pos < text.length) {
    let next = text.indexOf("\n", pos);
    if (next === -1) next = text.length;
    let line = text.slice(pos, next);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.length > 0) {
      rowCount += 1;
      if (groupIndex >= 0) {
        const parts = line.split(",");
        const key = parts[groupIndex] || "(empty)";
        groupCounts[key] = (groupCounts[key] || 0) + 1;
      }
    }
    pos = next + 1;
  }
  return { present: true, header, rowCount, groupCounts };
}

function listZipFiles(root, pattern) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function traceAudit(root, zipPath) {
  const stat = fs.statSync(zipPath);
  const opened = openZip(zipPath);
  const metadata = jsonEntry(opened, "metadata.json");
  const traceCsv = csvAudit(opened, "trace.csv", "event");
  const warnings = Array.isArray(metadata?.QualityWarnings) ? metadata.QualityWarnings : [];
  return {
    file: relativePath(root, zipPath),
    bytes: stat.size,
    entries: [...opened.entries.values()].map((entry) => ({
      name: entry.name,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      method: entry.method,
    })),
    metadata: metadata ? {
      traceFormatVersion: metadata.TraceFormatVersion ?? null,
      productName: metadata.ProductName ?? null,
      productVersion: metadata.ProductVersion ?? null,
      createdUtc: metadata.CreatedUtc ?? null,
      durationMicroseconds: metadata.DurationMicroseconds ?? null,
      stopwatchFrequency: metadata.StopwatchFrequency ?? null,
      timerResolutionMilliseconds: metadata.TimerResolutionMilliseconds ?? null,
      timerResolutionSucceeded: metadata.TimerResolutionSucceeded ?? null,
      sampleCount: metadata.SampleCount ?? null,
      hookSampleCount: metadata.HookSampleCount ?? null,
      pollSampleCount: metadata.PollSampleCount ?? null,
      referencePollSampleCount: metadata.ReferencePollSampleCount ?? null,
      dwmTimingSampleCount: metadata.DwmTimingSampleCount ?? null,
      dwmTimingAvailabilityPercent: metadata.DwmTimingAvailabilityPercent ?? null,
      pollIntervalMilliseconds: metadata.PollIntervalMilliseconds ?? null,
      referencePollIntervalMilliseconds: metadata.ReferencePollIntervalMilliseconds ?? null,
      processorCount: metadata.ProcessorCount ?? null,
      monitorCount: Array.isArray(metadata.Monitors) ? metadata.Monitors.length : null,
      qualityWarnings: warnings,
    } : null,
    traceCsv: {
      present: traceCsv.present,
      rowCount: traceCsv.rowCount,
      headerColumnCount: traceCsv.header.length,
      header: traceCsv.header,
      eventCounts: traceCsv.groupCounts,
    },
    consistency: metadata ? {
      csvRowsMinusMetadataSampleCount: numberOrNull(traceCsv.rowCount - metadata.SampleCount),
    } : null,
  };
}

function calibrationAudit(root, zipPath) {
  const stat = fs.statSync(zipPath);
  const opened = openZip(zipPath);
  const metrics = jsonEntry(opened, "metrics.json");
  const framesCsv = csvAudit(opened, "frames.csv", "patternName");
  const phaseCsv = csvAudit(opened, "frames.csv", "phaseName");
  const warnings = Array.isArray(metrics?.QualityWarnings) ? metrics.QualityWarnings : [];
  return {
    file: relativePath(root, zipPath),
    bytes: stat.size,
    entries: [...opened.entries.values()].map((entry) => ({
      name: entry.name,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      method: entry.method,
    })),
    metrics: metrics ? {
      frameCount: metrics.FrameCount ?? metrics.frameCount ?? null,
      darkFrameCount: metrics.DarkFrameCount ?? metrics.darkFrameCount ?? null,
      averageEstimatedSeparationPixels: metrics.AverageEstimatedSeparationPixels ?? metrics.averageEstimatedSeparationPixels ?? null,
      p95EstimatedSeparationPixels: metrics.P95EstimatedSeparationPixels ?? metrics.p95EstimatedSeparationPixels ?? null,
      maximumEstimatedSeparationPixels: metrics.MaximumEstimatedSeparationPixels ?? metrics.maximumEstimatedSeparationPixels ?? null,
      captureSource: metrics.CaptureSource ?? metrics.captureSource ?? null,
      runtimeMode: metrics.RuntimeMode ?? metrics.runtimeMode ?? null,
      dwmPredictionModel: metrics.DwmPredictionModel ?? metrics.dwmPredictionModel ?? null,
      dwmPredictionHorizonCapMilliseconds: metrics.DwmPredictionHorizonCapMilliseconds ?? metrics.dwmPredictionHorizonCapMilliseconds ?? null,
      dwmPredictionTargetOffsetMilliseconds: metrics.DwmPredictionTargetOffsetMilliseconds ?? metrics.dwmPredictionTargetOffsetMilliseconds ?? null,
      qualityWarnings: warnings,
      patternSummaries: metrics.PatternSummaries ?? metrics.patternSummaries ?? [],
    } : null,
    framesCsv: {
      present: framesCsv.present,
      rowCount: framesCsv.rowCount,
      headerColumnCount: framesCsv.header.length,
      header: framesCsv.header,
      patternCounts: framesCsv.groupCounts,
      phaseCounts: phaseCsv.groupCounts,
    },
    consistency: metrics ? {
      csvRowsMinusMetricsFrameCount: numberOrNull(framesCsv.rowCount - (metrics.FrameCount ?? metrics.frameCount)),
    } : null,
  };
}

function sumValues(items, getter) {
  return items.reduce((sum, item) => {
    const value = getter(item);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort();
}

function buildSummary(traceFiles, calibrationFiles) {
  const allEvents = {};
  for (const trace of traceFiles) {
    for (const [event, count] of Object.entries(trace.traceCsv.eventCounts)) {
      allEvents[event] = (allEvents[event] || 0) + count;
    }
  }
  const allPatterns = {};
  for (const calibration of calibrationFiles) {
    for (const [pattern, count] of Object.entries(calibration.framesCsv.patternCounts)) {
      allPatterns[pattern] = (allPatterns[pattern] || 0) + count;
    }
  }
  return {
    traceZipCount: traceFiles.length,
    calibrationZipCount: calibrationFiles.length,
    traceCsvRows: sumValues(traceFiles, (item) => item.traceCsv.rowCount),
    traceMetadataSampleCount: sumValues(traceFiles, (item) => item.metadata?.sampleCount),
    calibrationFrameRows: sumValues(calibrationFiles, (item) => item.framesCsv.rowCount),
    calibrationMetricsFrameCount: sumValues(calibrationFiles, (item) => item.metrics?.frameCount),
    traceFormatVersions: uniqueSorted(traceFiles.map((item) => item.metadata?.traceFormatVersion)),
    captureSources: uniqueSorted(calibrationFiles.map((item) => item.metrics?.captureSource)),
    traceQualityWarningFiles: traceFiles.filter((item) => item.metadata?.qualityWarnings?.length > 0).length,
    calibrationQualityWarningFiles: calibrationFiles.filter((item) => item.metrics?.qualityWarnings?.length > 0).length,
    eventCounts: allEvents,
    patternCounts: allPatterns,
  };
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function renderMarkdown(audit) {
  const traceRows = audit.traceFiles.map((item) => [
    item.file,
    String(item.traceCsv.rowCount),
    String(item.metadata?.sampleCount ?? ""),
    String(Object.keys(item.traceCsv.eventCounts).length),
    item.metadata?.qualityWarnings?.length ? item.metadata.qualityWarnings.join("<br>") : "none",
  ]);
  const calibrationRows = audit.calibrationFiles.map((item) => [
    item.file,
    String(item.framesCsv.rowCount),
    String(item.metrics?.frameCount ?? ""),
    String(item.metrics?.darkFrameCount ?? ""),
    item.metrics?.qualityWarnings?.length ? item.metrics.qualityWarnings.join("<br>") : "none",
  ]);

  return `# Cursor Prediction v9 Phase 0 Audit

Generated: ${audit.generatedAt}

This audit only reads existing root-level trace and calibration ZIP packages.
It does not run Calibrator, train models, or write extracted ZIP contents.

## Summary

- Trace ZIPs: ${audit.summary.traceZipCount}
- Calibration ZIPs: ${audit.summary.calibrationZipCount}
- Trace CSV rows: ${audit.summary.traceCsvRows}
- Trace metadata sample count: ${audit.summary.traceMetadataSampleCount}
- Calibration frame rows: ${audit.summary.calibrationFrameRows}
- Calibration metrics frame count: ${audit.summary.calibrationMetricsFrameCount}
- Trace format versions: ${audit.summary.traceFormatVersions.join(", ") || "none"}
- Calibration capture sources: ${audit.summary.captureSources.join(", ") || "none"}
- Trace files with quality warnings: ${audit.summary.traceQualityWarningFiles}
- Calibration files with quality warnings: ${audit.summary.calibrationQualityWarningFiles}

## Trace Event Counts

${mdTable(["event", "count"], Object.entries(audit.summary.eventCounts).sort((a, b) => b[1] - a[1]).map(([event, count]) => [event, String(count)]))}

## Calibration Pattern Counts

${mdTable(["pattern", "count"], Object.entries(audit.summary.patternCounts).sort((a, b) => b[1] - a[1]).map(([pattern, count]) => [pattern, String(count)]))}

## Trace Files

${mdTable(["file", "csv rows", "metadata samples", "event kinds", "quality warnings"], traceRows)}

## Calibration Files

${mdTable(["file", "frame rows", "metric frames", "dark frames", "quality warnings"], calibrationRows)}

## Reusable Inputs For v9

- Trace packages contain \`metadata.json\` and \`trace.csv\`; these are suitable for causal replay and offline teacher experiments.
- Calibration packages contain \`frames.csv\` and \`metrics.json\`; these are suitable for promotion scoring with the v7 scorer or a v9 successor.
- No extracted data or large dataset artifact was written by this audit.
`;
}

function main() {
  const args = parseArgs(process.argv);
  const tracePaths = listZipFiles(args.root, /^cursor-mirror-trace-.*\.zip$/);
  const calibrationPaths = listZipFiles(args.root, /^cursor-mirror-calibration-.*\.zip$/);
  const traceFiles = tracePaths.map((zipPath) => traceAudit(args.root, zipPath));
  const calibrationFiles = calibrationPaths.map((zipPath) => calibrationAudit(args.root, zipPath));
  const audit = {
    schemaVersion: "cursor-prediction-v9-phase0-audit/1",
    generatedAt: new Date().toISOString(),
    repositoryRoot: args.root,
    inputs: {
      traceGlob: "cursor-mirror-trace-*.zip",
      calibrationGlob: "cursor-mirror-calibration-*.zip",
    },
    summary: buildSummary(traceFiles, calibrationFiles),
    traceFiles,
    calibrationFiles,
  };

  fs.mkdirSync(path.dirname(args.outJson), { recursive: true });
  fs.writeFileSync(args.outJson, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  fs.writeFileSync(args.outMd, renderMarkdown(audit), "utf8");
  process.stdout.write(`Wrote ${args.outJson}\nWrote ${args.outMd}\n`);
}

main();
