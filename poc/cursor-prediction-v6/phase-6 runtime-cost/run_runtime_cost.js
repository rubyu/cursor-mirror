#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { performance } = require("node:perf_hooks");

const BASELINE_GAIN = 0.75;
const IDLE_GAP_MS = 100;
const SPEED_BINS = ["0-25 px/s", "25-100 px/s", "100-250 px/s", "250-500 px/s", "500-1000 px/s", "1000-2000 px/s", ">=2000 px/s"];
const HORIZON_BINS = ["0-2 ms", "2-4 ms", "4-8 ms", "8-12 ms", "12-16.7 ms", ">=16.7 ms"];
const LEAD_BINS = ["<0 us late", "0-500 us", "500-1000 us", "1000-1500 us", "1500-2000 us", ">=2000 us"];

function parseArgs(argv) {
  const args = {
    root: path.resolve(__dirname, ".."),
    dataset: null,
    phase5: null,
    out: __dirname,
    samples: 11,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--dataset") args.dataset = path.resolve(argv[++i]);
    else if (arg === "--phase5") args.phase5 = path.resolve(argv[++i]);
    else if (arg === "--out") args.out = path.resolve(argv[++i]);
    else if (arg === "--samples") args.samples = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.dataset) args.dataset = path.join(args.root, "phase-2 dataset-builder", "dataset.jsonl");
  if (!args.phase5) args.phase5 = path.join(args.root, "phase-5 distillation", "scores.json");
  return args;
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, text) {
  fs.writeFileSync(file, text.replace(/\n/g, "\r\n"), "utf8");
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
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
  const sorted = values.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtInt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Math.round(value).toLocaleString("en-US");
}

function table(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function predictCurrent(row) {
  if (!row.validVelocity || !Number.isFinite(row.dtMs) || row.dtMs <= 0 || row.targetHorizonMs <= 0) {
    return { x: row.anchorX, y: row.anchorY };
  }
  const h = row.targetHorizonMs / 1000;
  return {
    x: row.anchorX + row.velocityX * h * BASELINE_GAIN,
    y: row.anchorY + row.velocityY * h * BASELINE_GAIN,
  };
}

function historyTerms(row) {
  const h = Math.max(0, finite(row.targetHorizonMs) / 1000);
  const dtMs = finite(row.dtMs, 16.6667);
  const prevDtMs = finite(row.prevDtMs, dtMs);
  const hasPrev = row.prevAnchorX !== null && row.prevAnchorY !== null;
  const hasPrevPrev = row.prevPrevAnchorX !== null && row.prevPrevAnchorY !== null && hasPrev;
  const prevDeltaX = hasPrev ? row.anchorX - row.prevAnchorX : 0;
  const prevDeltaY = hasPrev ? row.anchorY - row.prevAnchorY : 0;
  const prevPrevDeltaX = hasPrevPrev ? row.prevAnchorX - row.prevPrevAnchorX : 0;
  const prevPrevDeltaY = hasPrevPrev ? row.prevAnchorY - row.prevPrevAnchorY : 0;
  const prevVelocityX = hasPrevPrev && prevDtMs > 0 ? prevPrevDeltaX / (prevDtMs / 1000) : 0;
  const prevVelocityY = hasPrevPrev && prevDtMs > 0 ? prevPrevDeltaY / (prevDtMs / 1000) : 0;
  let accelX = 0;
  let accelY = 0;
  if (row.validVelocity && hasPrevPrev && dtMs > 0 && prevDtMs > 0 && dtMs <= IDLE_GAP_MS && prevDtMs <= IDLE_GAP_MS) {
    const avgDtSec = ((dtMs + prevDtMs) / 2) / 1000;
    accelX = (row.velocityX - prevVelocityX) / avgDtSec;
    accelY = (row.velocityY - prevVelocityY) / avgDtSec;
  }
  return { h, dtMs, prevDtMs, hasPrev, hasPrevPrev, prevDeltaX, prevDeltaY, prevPrevDeltaX, prevPrevDeltaY, prevVelocityX, prevVelocityY, accelX, accelY };
}

function rawNumericFeature(row) {
  const hist = historyTerms(row);
  const velocityOffsetX = finite(row.velocityX) * hist.h;
  const velocityOffsetY = finite(row.velocityY) * hist.h;
  const accelOffsetX = 0.5 * hist.accelX * hist.h * hist.h;
  const accelOffsetY = 0.5 * hist.accelY * hist.h * hist.h;
  return [
    finite(row.targetHorizonMs),
    hist.h,
    hist.dtMs,
    hist.prevDtMs,
    row.validVelocity ? 1 : 0,
    hist.hasPrev ? 1 : 0,
    hist.hasPrevPrev ? 1 : 0,
    finite(row.anchorX),
    finite(row.anchorY),
    hist.prevDeltaX,
    hist.prevDeltaY,
    hist.prevPrevDeltaX,
    hist.prevPrevDeltaY,
    finite(row.velocityX),
    finite(row.velocityY),
    velocityOffsetX,
    velocityOffsetY,
    velocityOffsetX * BASELINE_GAIN,
    velocityOffsetY * BASELINE_GAIN,
    hist.prevVelocityX,
    hist.prevVelocityY,
    accelOffsetX,
    accelOffsetY,
    finite(row.speedPxS),
    finite(row.speedPxS) * hist.h,
    finite(row.accelerationPxS2),
    finite(row.accelerationPxS2) * hist.h * hist.h,
    finite(row.schedulerLeadUs),
    row.dwmTimingAvailable ? 1 : 0,
  ];
}

function clipVector(dx, dy, cap) {
  if (!Number.isFinite(cap) || cap <= 0) return [dx, dy];
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag <= cap || mag === 0) return [dx, dy];
  const scale = cap / mag;
  return [dx * scale, dy * scale];
}

function accelBin(row) {
  const hist = historyTerms(row);
  const accelHorizon = finite(row.accelerationPxS2) * hist.h * hist.h;
  if (accelHorizon < 0.025) return "accel:tiny";
  if (accelHorizon < 0.1) return "accel:low";
  if (accelHorizon < 0.35) return "accel:mid";
  return "accel:high";
}

function turnBin(row) {
  const hist = historyTerms(row);
  if (!hist.hasPrevPrev) return "turn:nohist";
  const aMag = Math.sqrt(hist.prevDeltaX ** 2 + hist.prevDeltaY ** 2);
  const bMag = Math.sqrt(hist.prevPrevDeltaX ** 2 + hist.prevPrevDeltaY ** 2);
  if (aMag < 0.01 || bMag < 0.01) return "turn:idle";
  const cos = (hist.prevDeltaX * hist.prevPrevDeltaX + hist.prevDeltaY * hist.prevPrevDeltaY) / (aMag * bMag);
  if (cos > 0.85) return "turn:straight";
  if (cos < 0.2) return "turn:sharp";
  return "turn:bend";
}

function leadBin(row) {
  if (!row.dwmTimingAvailable) return "lead:nodwm";
  if (row.schedulerLeadUs < 0) return "lead:late";
  if (row.schedulerLeadUs < 1500) return "lead:short";
  if (row.schedulerLeadUs >= 2000) return "lead:max";
  return "lead:nominal";
}

function tableKey(row, shape) {
  if (shape === "speed_accel_lead") return [row.speedBin, accelBin(row), leadBin(row)].join("|");
  if (shape === "speed_turn_lead") return [row.speedBin, turnBin(row), leadBin(row)].join("|");
  return [row.speedBin, accelBin(row), turnBin(row), leadBin(row)].join("|");
}

function speedIndex(label) {
  const idx = SPEED_BINS.indexOf(label);
  return idx >= 0 ? idx : SPEED_BINS.length;
}

function ridgeCorrection(spec, row) {
  const raw = rawNumericFeature(row);
  let dx = spec.weights[0][0];
  let dy = spec.weights[0][1];
  let w = 1;
  for (let i = 0; i < raw.length; i += 1, w += 1) {
    const x = (raw[i] - spec.means[i]) / spec.stds[i];
    dx += x * spec.weights[w][0];
    dy += x * spec.weights[w][1];
  }
  for (const label of SPEED_BINS) {
    const x = row.speedBin === label ? 1 : 0;
    dx += x * spec.weights[w][0];
    dy += x * spec.weights[w][1];
    w += 1;
  }
  for (const label of HORIZON_BINS) {
    const x = row.horizonBin === label ? 1 : 0;
    dx += x * spec.weights[w][0];
    dy += x * spec.weights[w][1];
    w += 1;
  }
  for (const label of LEAD_BINS) {
    const x = row.schedulerLeadBin === label ? 1 : 0;
    dx += x * spec.weights[w][0];
    dy += x * spec.weights[w][1];
    w += 1;
  }
  return clipVector(dx, dy, spec.capPx);
}

function makePredictor(spec) {
  if (spec.type === "current") return predictCurrent;
  if (spec.type === "ridge_residual_guarded") {
    return (row) => {
      const base = predictCurrent(row);
      const [dx, dy] = ridgeCorrection(spec, row);
      return { x: base.x + dx, y: base.y + dy };
    };
  }
  if (spec.type === "confidence_gated_ridge") {
    return (row) => {
      const base = predictCurrent(row);
      if (!spec.enabled || speedIndex(row.speedBin) < spec.gate.minSpeedIndex) return base;
      const [dx, dy] = ridgeCorrection(spec, row);
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag < spec.gate.minCorrectionPx) return base;
      return { x: base.x + dx, y: base.y + dy };
    };
  }
  if (spec.type === "piecewise_residual_table") {
    return (row) => {
      const base = predictCurrent(row);
      const cell = spec.cells[tableKey(row, spec.options.shape)];
      if (!cell || cell.n < spec.options.minN) return base;
      return { x: base.x + cell.dx, y: base.y + cell.dy };
    };
  }
  if (spec.type === "thresholded_piecewise_table") {
    return (row) => {
      const base = predictCurrent(row);
      const key = tableKey(row, spec.tableOptions.shape);
      if (!spec.active[key]) return base;
      const cell = spec.cells[key];
      if (!cell) return base;
      return { x: base.x + cell.dx, y: base.y + cell.dy };
    };
  }
  throw new Error(`Unsupported runtime spec type: ${spec.type}`);
}

function summarizeSpec(spec) {
  if (spec.type === "current") return { parameter_count: 1, allocation_note: "no per-prediction model allocation", complexity: "already implemented" };
  if (spec.type === "ridge_residual_guarded" || spec.type === "confidence_gated_ridge") {
    return {
      parameter_count: spec.weights.length * 2 + spec.means.length + spec.stds.length,
      allocation_note: "JS proxy allocates a temporary feature array; C# can use stackalloc or a reused buffer",
      complexity: spec.type === "confidence_gated_ridge" ? "moderate: ridge dot products plus simple gate" : "moderate: ridge dot products",
    };
  }
  const active = Object.keys(spec.active || spec.cells || {}).length;
  return {
    parameter_count: active * 2,
    allocation_note: "no numeric feature vector; key construction in JS allocates strings, C# can use enum indices",
    complexity: spec.type === "thresholded_piecewise_table" ? "low: table lookup plus active-cell guard" : "low: table lookup",
  };
}

function benchmarkPredictor(rows, predictor, samples, rounds) {
  const nsPerPrediction = [];
  const heapDeltas = [];
  let guard = 0;
  for (let s = 0; s < samples; s += 1) {
    for (let i = 0; i < rows.length; i += 1) {
      const pred = predictor(rows[i]);
      guard += pred.x * 1e-12 + pred.y * 1e-13;
    }
    const beforeHeap = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let r = 0; r < rounds; r += 1) {
      for (let i = 0; i < rows.length; i += 1) {
        const pred = predictor(rows[i]);
        guard += pred.x * 1e-12 + pred.y * 1e-13;
      }
    }
    const elapsedMs = performance.now() - start;
    const afterHeap = process.memoryUsage().heapUsed;
    nsPerPrediction.push((elapsedMs * 1e6) / (rows.length * rounds));
    heapDeltas.push(afterHeap - beforeHeap);
  }
  return {
    samples,
    rounds,
    predictions_per_sample: rows.length * rounds,
    ns_per_prediction: stats(nsPerPrediction),
    us_per_prediction: stats(nsPerPrediction.map((value) => value / 1000)),
    heap_delta_bytes_per_sample: stats(heapDeltas),
    guard,
  };
}

function chooseRounds(spec) {
  if (spec.type === "current") return 700;
  if (spec.type === "piecewise_residual_table" || spec.type === "thresholded_piecewise_table") return 350;
  if (spec.type === "confidence_gated_ridge" && !spec.enabled) return 700;
  return 120;
}

function runtimeModels(phase5) {
  const firstFold = phase5.cross_validation[0];
  const selectedId = phase5.recommendation.selected.id;
  return firstFold.models.map((model) => ({
    id: model.id,
    selected: model.id === selectedId,
    spec: model.runtime_spec,
    phase5_summary: phase5.aggregate.find((entry) => entry.id === model.id),
  }));
}

function renderReport(scores) {
  const rows = scores.models.map((model) => [
    model.id,
    model.selected ? "yes" : "",
    fmt(model.benchmark.ns_per_prediction.median, 1),
    fmt(model.benchmark.ns_per_prediction.p95, 1),
    fmt(model.benchmark.us_per_prediction.median, 4),
    fmtInt(model.parameter_count),
    model.allocation_note,
    model.complexity,
  ]);
  const safetyRows = scores.models.map((model) => {
    const summary = model.phase5_summary;
    return [
      model.id,
      fmt(summary.mean_delta_mean_px),
      fmt(summary.mean_delta_p95_px),
      fmt(summary.mean_delta_p99_px),
      fmtInt(summary.total_worse_over_1px),
      fmtInt(summary.total_worse_over_3px),
      fmtInt(summary.total_worse_over_5px),
    ];
  });
  const selected = scores.models.find((model) => model.selected);
  return `# Phase 6 - Runtime Cost

## Setup

Benchmarked Phase 5 first-fold runtime specs over ${fmtInt(scores.dataset.rows)} dataset rows in dependency-free Node.js on ${scores.environment.platform}, Node ${scores.environment.node}. Timing reports hot-path prediction only; training and JSON loading are outside the measured loop.

Node is a proxy, not the target runtime. Ridge specs allocate a temporary JS feature array in this benchmark; a C# implementation can avoid that with stack allocation or a reused buffer. Table specs allocate JS strings for keys; a C# implementation should use integer bin indices.

## Hot-Path Cost

${table(["model", "Phase 5 selected", "median ns/pred", "p95 ns/pred", "median us/pred", "params", "allocation note", "C# complexity"], rows)}

## Safety Context From Phase 5

${table(["model", "delta mean", "delta p95", "delta p99", ">1 worse", ">3 worse", ">5 worse"], safetyRows)}

## Recommendation

The selected model by Phase 5 is \`${selected.id}\`, with median ${fmt(selected.benchmark.ns_per_prediction.median, 1)} ns/prediction in this Node proxy and ${fmtInt(selected.parameter_count)} runtime parameters.

Runtime cost is acceptable for a cursor prediction hot path, but the measured accuracy gain is tiny and mean error worsens. Runtime is not the blocker; confidence in the behavior is.
`;
}

function renderLog(scores) {
  return `# Experiment Log

- ${scores.generated_at_utc}: Created Phase 6 runtime-cost experiment under \`phase-6 runtime-cost/\`.
- Read Phase 5 runtime specs from \`${scores.phase5_path}\`.
- Benchmarked current baseline plus all Phase 5 candidate hot paths over ${fmtInt(scores.dataset.rows)} rows.
- Reported median and p95 ns/us per prediction, parameter counts, allocation notes, and C# implementation complexity.
- Wrote \`scores.json\`, \`report.md\`, and this log.
`;
}

function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.out, { recursive: true });
  const started = performance.now();
  const rows = readJsonl(args.dataset);
  const phase5 = JSON.parse(fs.readFileSync(args.phase5, "utf8"));
  const models = runtimeModels(phase5).map((model) => {
    const predictor = makePredictor(model.spec);
    const specSummary = summarizeSpec(model.spec);
    const rounds = chooseRounds(model.spec);
    const benchmark = benchmarkPredictor(rows, predictor, args.samples, rounds);
    return {
      id: model.id,
      selected: model.selected,
      spec_type: model.spec.type,
      rounds,
      parameter_count: specSummary.parameter_count,
      allocation_note: specSummary.allocation_note,
      complexity: specSummary.complexity,
      phase5_summary: model.phase5_summary,
      benchmark,
    };
  });
  const scores = {
    generated_at_utc: new Date().toISOString(),
    phase: "phase-6 runtime-cost",
    phase5_path: path.relative(args.root, args.phase5).replace(/\\/g, "/"),
    dataset_path: path.relative(args.root, args.dataset).replace(/\\/g, "/"),
    dataset: { rows: rows.length },
    environment: {
      node: process.version,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      cpus: os.cpus().length,
      hrtime: "performance.now()",
    },
    benchmark_policy: {
      samples: args.samples,
      units: ["ns_per_prediction", "us_per_prediction"],
      note: "Each sample performs a warm-up pass, then loops over every dataset row for model-specific rounds.",
    },
    models,
    performance: {
      elapsed_sec: (performance.now() - started) / 1000,
    },
  };
  writeJson(path.join(args.out, "scores.json"), scores);
  writeText(path.join(args.out, "report.md"), renderReport(scores));
  writeText(path.join(args.out, "experiment-log.md"), renderLog(scores));
  console.log(`Wrote ${path.join(args.out, "scores.json")}`);
  for (const model of scores.models) {
    console.log(`${model.id}: median ${fmt(model.benchmark.ns_per_prediction.median, 1)} ns/pred`);
  }
  console.log(`Elapsed: ${fmt(scores.performance.elapsed_sec, 2)} sec`);
}

main();
