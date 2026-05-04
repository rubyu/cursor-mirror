#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PHASE4_SCHEMA = "cursor-prediction-v10-phase4-pareto-frontier/1";
const BREAKDOWN_SCHEMA = "cursor-prediction-v10-phase4-breakdown/1";
const SCORE_SCHEMA = "cursor-prediction-v10-scores/1";
const HISTOGRAM_BIN_PX = 0.05;
const HISTOGRAM_MAX_PX = 768;

const DEFAULT_ARGS = {
  input: null,
  outDir: null,
  seed: 33003,
  limitScripts: 5000,
  anchorsPerScript: 32,
  sampleIntervalMs: 8.33,
  historyMs: 200,
  trainSampleRows: 100000,
  validationSampleRows: 120000,
  randomWeightTrials: 0,
  shortlistPerBucket: 36,
  fullSearch: false,
};

const CONSTRAINTS = {
  strict: { worseOver10px: 0, worseOver5px: 0 },
  balanced: { worseOver10px: 0, worseOver5px: 50 },
  aggressive: { worseOver10px: 5, worseOver5px: 200 },
  noGo: { worseOver10px: Infinity, worseOver5px: Infinity },
};

function parseArgs(argv) {
  const scriptDir = __dirname;
  const outDir = path.resolve(scriptDir, "..");
  const args = {
    ...DEFAULT_ARGS,
    outDir,
    input: path.join(outDir, "runs", "scripts.synthetic.phase2.jsonl"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--seed") args.seed = intArg(argv[++i], "seed");
    else if (arg === "--limit-scripts") args.limitScripts = intArg(argv[++i], "limit-scripts");
    else if (arg === "--anchors-per-script") args.anchorsPerScript = intArg(argv[++i], "anchors-per-script");
    else if (arg === "--sample-interval-ms") args.sampleIntervalMs = numberArg(argv[++i], "sample-interval-ms");
    else if (arg === "--history-ms") args.historyMs = numberArg(argv[++i], "history-ms");
    else if (arg === "--train-sample-rows") args.trainSampleRows = intArg(argv[++i], "train-sample-rows");
    else if (arg === "--validation-sample-rows") args.validationSampleRows = intArg(argv[++i], "validation-sample-rows");
    else if (arg === "--random-weight-trials") args.randomWeightTrials = intArg(argv[++i], "random-weight-trials");
    else if (arg === "--shortlist-per-bucket") args.shortlistPerBucket = intArg(argv[++i], "shortlist-per-bucket");
    else if (arg === "--full-search") args.fullSearch = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v10\\scripts\\run-v10-phase4.js [--limit-scripts 1000]

Options:
  --input <path>                  JSONL scripts. Default: runs/scripts.synthetic.phase2.jsonl
  --seed <n>                      deterministic script split and search seed
  --limit-scripts <n>             script subset. Default: 5000
  --train-sample-rows <n>         rows used for score quantiles. Default: 100000
  --validation-sample-rows <n>    rows used for screening sweep. Default: 120000
  --random-weight-trials <n>      deterministic nearby weight trials. Default: 0 in priority mode
  --shortlist-per-bucket <n>      candidates retained per constraint bucket before full test
  --full-search                   include all phase4 exploratory predictors and nearby weights
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.limitScripts !== null && args.limitScripts <= 0) throw new Error("--limit-scripts must be positive");
  return args;
}

function intArg(text, name) {
  const value = Number(text);
  if (!Number.isInteger(value)) throw new Error(`--${name} expects an integer`);
  return value;
}

function numberArg(text, name) {
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`--${name} expects a number`);
  return value;
}

function loadPhase3Runtime() {
  const phase3Path = path.join(__dirname, "run-v10-phase3.js");
  const source = fs.readFileSync(phase3Path, "utf8").replace(/\nmain\(\);\s*$/, "\n");
  const context = {
    require,
    console,
    process: { ...process, argv: ["node", phase3Path, "--help"] },
    __dirname,
    __filename: phase3Path,
  };
  vm.createContext(context);
  vm.runInContext(`${source}
globalThis.phase3 = {
  HORIZONS_MS,
  MISSING_SCENARIOS,
  SPEED_BINS,
  TAGS,
  loadPhase2Runtime,
  readScripts,
  makeSplits,
  prepareRows,
  sampleIndices,
  baselineModel,
  evaluateBaseline,
  evaluateGate,
  monotonicScore,
  testBreakdown,
  objectiveScore,
  passesGate,
  renderTable,
  writeJson,
  roundObject,
  fmt,
  idNum,
  mulberry32,
};`, context, { filename: phase3Path });
  return context.phase3;
}

function candidateModels(base, phase3Best, fullSearch) {
  const allCore = [
    {
      id: "least_squares_w50_cap36",
      family: "least_squares_window",
      params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 36 },
    },
    {
      id: "least_squares_w50_cap24",
      family: "least_squares_window",
      params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 24 },
    },
    {
      id: "blend_cv_ls_w50_cap24_ls0p5",
      family: "blend",
      params: {
        weightB: 0.5,
        a: { family: "constant_velocity_last2", params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 } },
        b: { family: "least_squares_window", params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 24 } },
      },
    },
  ];
  const core = fullSearch ? allCore : allCore.filter((model) => model.id === (phase3Best?.candidateId || "least_squares_w50_cap36"));
  const weights = [0.25, 0.5, 0.75, 1.0];
  const out = [];
  for (const model of core) {
    for (const weight of weights) {
      if (weight === 1) {
        out.push({ ...model, advancedBlendWeight: 1.0, sourceCandidateId: model.id });
      } else {
        out.push({
          id: `blend_base_${model.id}_adv${idNum(weight)}`,
          family: "blend",
          params: {
            weightB: weight,
            a: { family: base.family, params: base.params },
            b: { family: model.family, params: model.params },
          },
          advancedBlendWeight: weight,
          sourceCandidateId: model.id,
        });
      }
    }
  }
  return out;
}

function loadPhase3Best(outDir) {
  const filePath = path.join(outDir, "phase-3-learned-gates.json");
  if (!fs.existsSync(filePath)) return null;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return data.selected || null;
}

function buildWeightConfigs(args, phase3Best) {
  const configs = [];
  const seen = new Set();
  const add = (id, weights, source) => {
    const normalized = normalizeWeights(weights);
    const key = JSON.stringify(roundObject(normalized));
    if (seen.has(key)) return;
    seen.add(key);
    configs.push({ id, weights: normalized, source });
  };

  if (phase3Best?.family === "monotonic_score") {
    add("phase3_best", phase3Best.params.weights, "phase3_selected");
  }
  if (!args.fullSearch) return configs;

  const phase3Anchors = [
    {
      id: "phase3_template_conservative",
      weights: monotonicWeights({ accel: 1.2, curvature: 1.0, lowSpeed: 0.8, highSpeed: 0.2, edge: 0.7, history: 0.5, jitter: 1.0, missing25: 0.9, tagJitter: 0.8 }),
    },
    {
      id: "phase3_template_safety",
      weights: monotonicWeights({ accel: 1.8, curvature: 1.2, lowSpeed: 0.5, highSpeed: 0.1, edge: 0.4, history: 0.8, jitter: 1.4, missing25: 1.2, tagJitter: 1.1 }),
    },
    {
      id: "phase3_template_curvature",
      weights: monotonicWeights({ accel: 0.8, curvature: 1.8, lowSpeed: 1.2, highSpeed: 0.4, edge: 0.9, history: 0.3, jitter: 0.7, missing25: 0.8, tagJitter: 0.5 }),
    },
  ];
  for (const anchor of phase3Anchors) add(anchor.id, anchor.weights, "phase3_template");

  const anchors = configs.slice();
  const oneAtATime = [0.70, 0.85, 1.15, 1.35];
  const keys = ["acceleration", "curvature", "jitterProxy", "highSpeed", "missing25"];
  for (const anchor of anchors) {
    for (const key of keys) {
      for (const factor of oneAtATime) add(`${anchor.id}_${key}_${idNum(factor)}`, perturbWeights(anchor.weights, { [key]: factor }), "nearby_one_axis");
    }
    for (const pair of [
      { acceleration: 0.85, curvature: 0.85 },
      { acceleration: 1.15, curvature: 1.15 },
      { jitterProxy: 0.85, missing25: 0.85 },
      { jitterProxy: 1.15, missing25: 1.15 },
      { highSpeed: 0.75, acceleration: 1.15 },
      { highSpeed: 1.25, acceleration: 0.90 },
    ]) {
      add(`${anchor.id}_pair_${configs.length}`, perturbWeights(anchor.weights, pair), "nearby_pair");
    }
  }

  const rng = mulberry32(args.seed ^ 0x4f1bbcdc);
  for (let i = 0; i < args.randomWeightTrials; i += 1) {
    const anchor = anchors[Math.floor(rng() * anchors.length)];
    add(`nearby_random_${i + 1}`, perturbWeights(anchor.weights, {
      acceleration: 0.75 + rng() * 0.70,
      curvature: 0.75 + rng() * 0.70,
      jitterProxy: 0.75 + rng() * 0.70,
      highSpeed: 0.65 + rng() * 0.90,
      missing25: 0.70 + rng() * 0.80,
    }), "nearby_random");
  }
  return configs;
}

function monotonicWeights(w) {
  return {
    intercept: 0,
    lowSpeed: w.lowSpeed,
    highSpeed: w.highSpeed,
    acceleration: w.accel,
    curvature: w.curvature,
    edgeNear: w.edge,
    sparseHistory: w.history,
    jitterProxy: w.jitter,
    missing10: w.missing25 * 0.35,
    missing25: w.missing25,
    horizon: 0.15,
    tagWeights: {
      jitter: w.tagJitter,
      acute_acceleration: w.accel * 0.35,
      edge_proximity: w.edge * 0.30,
      missing_history: w.missing25 * 0.30,
      loop_or_reversal: w.curvature * 0.25,
    },
  };
}

function perturbWeights(weights, factors) {
  const w = JSON.parse(JSON.stringify(weights));
  for (const [key, factor] of Object.entries(factors)) {
    if (key === "missing25") {
      w.missing25 *= factor;
      w.missing10 *= factor;
      if (w.tagWeights?.missing_history !== undefined) w.tagWeights.missing_history *= factor;
    } else if (key === "jitterProxy") {
      w.jitterProxy *= factor;
      if (w.tagWeights?.jitter !== undefined) w.tagWeights.jitter *= factor;
    } else if (key === "acceleration") {
      w.acceleration *= factor;
      if (w.tagWeights?.acute_acceleration !== undefined) w.tagWeights.acute_acceleration *= factor;
    } else if (key === "curvature") {
      w.curvature *= factor;
      if (w.tagWeights?.loop_or_reversal !== undefined) w.tagWeights.loop_or_reversal *= factor;
    } else if (w[key] !== undefined) {
      w[key] *= factor;
    }
  }
  return w;
}

function normalizeWeights(weights) {
  const w = JSON.parse(JSON.stringify(weights));
  for (const key of Object.keys(w)) {
    if (typeof w[key] === "number") w[key] = Math.max(0, w[key]);
  }
  for (const key of Object.keys(w.tagWeights || {})) w.tagWeights[key] = Math.max(0, w.tagWeights[key]);
  return w;
}

function thresholdQuantiles(runtime, store, indices, weights, phase3Threshold, fullSearch) {
  const scores = new Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) scores[i] = runtime.monotonicScore(store, indices[i], weights);
  scores.sort((a, b) => a - b);
  const quantiles = fullSearch
    ? [0.02, 0.035, 0.05, 0.07, 0.09, 0.11, 0.14, 0.17, 0.20, 0.24, 0.28, 0.33, 0.39, 0.46, 0.54, 0.63, 0.72, 0.82, 0.90]
    : [0.02, 0.04, 0.06, 0.08, 0.10, 0.14, 0.18, 0.22, 0.28, 0.34, 0.42, 0.50, 0.62, 0.74, 0.86, 0.94];
  const thresholds = quantiles.map((q) => scores[Math.min(scores.length - 1, Math.max(0, Math.floor(q * (scores.length - 1))))]);
  if (Number.isFinite(phase3Threshold)) {
    const factors = fullSearch ? [0.75, 0.85, 0.95, 1.0, 1.05, 1.15, 1.30, 1.50] : [0.50, 0.65, 0.80, 0.90, 1.0, 1.10, 1.25, 1.50, 2.0, 3.0, 5.0, 8.0];
    for (const factor of factors) thresholds.push(phase3Threshold * factor);
  }
  return Array.from(new Set(thresholds.map((x) => Math.round(x * 1000000) / 1000000))).sort((a, b) => a - b);
}

function screenCandidates(runtime, stores, models, weightConfigs, args, phase3Best) {
  const trainSample = runtime.sampleIndices(stores.train, args.trainSampleRows);
  const validationSample = runtime.sampleIndices(stores.validation, args.validationSampleRows);
  const baseline = evaluateBaselineOnIndices(stores.validation, validationSample);
  const buckets = Object.fromEntries(Object.keys(CONSTRAINTS).map((key) => [key, []]));
  let evaluatedThresholds = 0;
  for (let candidateIndex = 0; candidateIndex < models.length; candidateIndex += 1) {
    for (const config of weightConfigs) {
      const thresholds = thresholdQuantiles(
        runtime,
        stores.train,
        trainSample,
        config.weights,
        config.id === "phase3_best" ? phase3Best?.params?.threshold : null,
        args.fullSearch,
      );
      const swept = evaluateScoreSweep(runtime, stores.validation, validationSample, candidateIndex, config, thresholds, baseline.metrics);
      evaluatedThresholds += thresholds.length;
      for (const row of swept) {
        for (const [bucketName, constraint] of Object.entries(CONSTRAINTS)) {
          if (!passesConstraint(row.metric, constraint)) continue;
          pushRanked(buckets[bucketName], row, args.shortlistPerBucket, bucketName);
        }
      }
    }
  }
  return {
    shortlist: uniqueScreenRows(Object.values(buckets).flat()),
    screening: {
      trainSampleRows: trainSample.length,
      validationSampleRows: validationSample.length,
      models: models.length,
      weightConfigs: weightConfigs.length,
      evaluatedThresholds,
      buckets: Object.fromEntries(Object.entries(buckets).map(([key, rows]) => [key, rows.map((row) => summarizeScreenRow(row))])),
    },
  };
}

function evaluateBaselineOnIndices(store, indices) {
  const acc = metricAccumulator();
  const reg = regressionAccumulator();
  for (let i = 0; i < indices.length; i += 1) {
    addMetric(acc, store.baselineError[indices[i]]);
    addRegression(reg, 0);
  }
  return {
    metrics: finalizeMetric(acc),
    regressionsVsBaseline: finalizeRegression(reg),
    gateUses: { advanced: 0, fallback: indices.length },
  };
}

function evaluateScoreSweep(runtime, store, indices, candidateIndex, config, thresholds, baselineMetrics) {
  const rows = new Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) {
    const row = indices[i];
    rows[i] = { row, score: runtime.monotonicScore(store, row, config.weights) };
  }
  rows.sort((a, b) => a.score - b.score);
  const acc = metricAccumulator();
  const reg = regressionAccumulator();
  for (let i = 0; i < indices.length; i += 1) addMetric(acc, store.baselineError[indices[i]]);
  let cursor = 0;
  const out = [];
  for (const threshold of thresholds) {
    while (cursor < rows.length && rows[cursor].score <= threshold) {
      const row = rows[cursor].row;
      const baselineError = store.baselineError[row];
      const candidateError = store.candidateErrors[candidateIndex][row];
      addMetric(acc, baselineError, -1);
      addMetric(acc, candidateError, 1);
      addRegression(reg, candidateError - baselineError);
      cursor += 1;
    }
    const metric = {
      metrics: finalizeMetric(acc),
      regressionsVsBaseline: finalizeRegression(reg, indices.length),
      gateUses: { advanced: cursor, fallback: indices.length - cursor },
    };
    out.push({
      gate: {
        id: `phase4_score_${config.id}_${candidateIndex}_${idNum(threshold)}`,
        family: "monotonic_score",
        candidateIndex,
        candidateId: null,
        params: { weights: config.weights, threshold, weightConfigId: config.id, weightSource: config.source },
      },
      metric,
      validationUtility: utility(metric, baselineMetrics),
    });
  }
  return out;
}

function pushRanked(bucket, row, limit, bucketName) {
  bucket.push(row);
  bucket.sort((a, b) => rankForBucket(a.metric, a.validationUtility, bucketName) - rankForBucket(b.metric, b.validationUtility, bucketName));
  if (bucket.length > limit) bucket.length = limit;
}

function rankForBucket(result, rowUtility, bucketName) {
  const r = result.regressionsVsBaseline;
  const penalty = r.worseOver10px * 1000000 + r.worseOver5px * 10000 + r.worseOver3px * 10;
  const useBonus = result.gateUses.advanced / Math.max(1, result.metrics.count);
  if (bucketName === "noGo") return -(rowUtility + useBonus * 0.25);
  return penalty - rowUtility * 1000 - useBonus;
}

function uniqueScreenRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.gate.candidateIndex}:${row.gate.params.weightConfigId}:${row.gate.params.threshold}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function fullEvaluate(runtime, stores, models, screenRows) {
  const baseline = {
    train: runtime.evaluateBaseline(stores.train),
    validation: runtime.evaluateBaseline(stores.validation),
    test: runtime.evaluateBaseline(stores.test),
  };
  const rows = [];
  for (let i = 0; i < screenRows.length; i += 1) {
    const gate = JSON.parse(JSON.stringify(screenRows[i].gate));
    gate.id = `phase4_${String(i + 1).padStart(4, "0")}_${models[gate.candidateIndex].id}_${gate.params.weightConfigId}_t${idNum(gate.params.threshold)}`;
    gate.candidateId = models[gate.candidateIndex].id;
    const validation = runtime.evaluateGate(stores.validation, gate);
    const test = runtime.evaluateGate(stores.test, gate);
    rows.push({
      id: gate.id,
      family: gate.family,
      candidateId: gate.candidateId,
      sourceCandidateId: models[gate.candidateIndex].sourceCandidateId,
      advancedBlendWeight: models[gate.candidateIndex].advancedBlendWeight,
      params: gate.params,
      validation,
      test,
      validationUtility: utility(validation, baseline.validation.metrics),
      testUtility: utility(test, baseline.test.metrics),
      gate,
    });
  }
  rows.sort((a, b) => rankFull(b, baseline.test.metrics) - rankFull(a, baseline.test.metrics));
  return { baseline, rows };
}

function evaluatePhase3SameSplit(runtime, stores, models, phase3Best) {
  if (!phase3Best || phase3Best.family !== "monotonic_score") return null;
  const candidateIndex = models.findIndex((model) => model.sourceCandidateId === phase3Best.candidateId && model.advancedBlendWeight === 1);
  if (candidateIndex < 0) return null;
  const gate = {
    id: "phase3_selected_same_split",
    family: "monotonic_score",
    candidateIndex,
    candidateId: models[candidateIndex].id,
    params: phase3Best.params,
  };
  return {
    id: gate.id,
    family: gate.family,
    candidateId: gate.candidateId,
    sourceCandidateId: models[candidateIndex].sourceCandidateId,
    advancedBlendWeight: models[candidateIndex].advancedBlendWeight,
    params: gate.params,
    validation: runtime.evaluateGate(stores.validation, gate),
    test: runtime.evaluateGate(stores.test, gate),
    originalPhase3: phase3Best,
  };
}

function rankFull(row, baselineMetrics) {
  const r = row.test.regressionsVsBaseline;
  return utility(row.test, baselineMetrics)
    + (row.test.gateUses.advanced / Math.max(1, row.test.metrics.count)) * 0.05
    - r.worseOver10px * 1000
    - r.worseOver5px * 10;
}

function utility(result, baselineMetrics) {
  return (baselineMetrics.mean - result.metrics.mean)
    + 0.40 * (baselineMetrics.p95 - result.metrics.p95)
    + 0.30 * (baselineMetrics.p99 - result.metrics.p99);
}

function selectConstraints(rows) {
  const out = {};
  for (const [name, constraint] of Object.entries(CONSTRAINTS)) {
    const feasible = rows.filter((row) => passesConstraint(row.test, constraint));
    feasible.sort((a, b) => {
      const delta = b.testUtility - a.testUtility;
      if (Math.abs(delta) > 1e-9) return delta;
      return b.test.gateUses.advanced - a.test.gateUses.advanced;
    });
    out[name] = {
      constraint,
      best: feasible[0] ? summarizeFullRow(feasible[0]) : null,
      frontier: paretoFrontier(feasible).slice(0, 24).map(summarizeFullRow),
      candidateCount: feasible.length,
    };
  }
  return out;
}

function selectBlendWeightComparison(rows) {
  const out = {};
  for (const weight of [0.25, 0.5, 0.75, 1.0]) {
    const weightRows = rows.filter((row) => row.advancedBlendWeight === weight);
    out[String(weight)] = {};
    for (const [name, constraint] of Object.entries(CONSTRAINTS)) {
      const feasible = weightRows.filter((row) => passesConstraint(row.test, constraint));
      feasible.sort((a, b) => b.testUtility - a.testUtility || b.test.gateUses.advanced - a.test.gateUses.advanced);
      out[String(weight)][name] = feasible[0] ? summarizeFullRow(feasible[0]) : null;
    }
  }
  return out;
}

function paretoFrontier(rows) {
  const sorted = [...rows].sort((a, b) => b.testUtility - a.testUtility);
  const frontier = [];
  for (const row of sorted) {
    let dominated = false;
    for (const other of frontier) {
      if (dominates(other, row)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) frontier.push(row);
  }
  return frontier;
}

function dominates(a, b) {
  const ar = a.test.regressionsVsBaseline;
  const br = b.test.regressionsVsBaseline;
  const noWorse = a.test.metrics.mean <= b.test.metrics.mean
    && a.test.metrics.p95 <= b.test.metrics.p95
    && a.test.metrics.p99 <= b.test.metrics.p99
    && ar.worseOver5px <= br.worseOver5px
    && ar.worseOver10px <= br.worseOver10px
    && a.test.gateUses.advanced >= b.test.gateUses.advanced;
  const better = a.test.metrics.mean < b.test.metrics.mean
    || a.test.metrics.p95 < b.test.metrics.p95
    || a.test.metrics.p99 < b.test.metrics.p99
    || ar.worseOver5px < br.worseOver5px
    || ar.worseOver10px < br.worseOver10px
    || a.test.gateUses.advanced > b.test.gateUses.advanced;
  return noWorse && better;
}

function passesConstraint(result, constraint) {
  const r = result.regressionsVsBaseline;
  return r.worseOver10px <= constraint.worseOver10px && r.worseOver5px <= constraint.worseOver5px;
}

function buildBreakdowns(runtime, stores, selected) {
  const out = {};
  for (const name of ["strict", "balanced", "aggressive"]) {
    const best = selected.public[name]?.best;
    if (!best) continue;
    const row = selected._rowsById.get(best.id);
    out[name] = {
      gateId: row.id,
      candidateId: row.candidateId,
      sourceCandidateId: row.sourceCandidateId,
      advancedBlendWeight: row.advancedBlendWeight,
      test: row.test,
      breakdown: runtime.testBreakdown(stores.test, row.gate),
    };
  }
  return out;
}

function buildFrontierJson(args, generatedAt, scripts, splitCounts, rowSummary, models, weightConfigs, phase3Best, phase3SameSplit, screening, evaluated, selected, elapsedSec) {
  return {
    schemaVersion: PHASE4_SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    environment: {
      node: process.version,
      gpuUsed: false,
      dependencies: "node standard library only",
    },
    canonicalInput: path.relative(args.outDir, args.input).replace(/\\/g, "/"),
    scriptCount: scripts.length,
    splitPolicy: {
      seed: args.seed,
      unit: "script",
      train: splitCounts.train,
      validation: splitCounts.validation,
      test: splitCounts.test,
    },
    rowSummary,
    searchPolicy: {
      predictorFamilies: Array.from(new Set(models.map((m) => m.sourceCandidateId))),
      advancedBlendWeights: [0.25, 0.5, 0.75, 1.0],
      monotonicScoreWeightConfigs: weightConfigs.length,
      mode: args.fullSearch ? "full" : "priority_phase3_threshold_and_blend",
      thresholdSweep: "train score quantiles plus phase3 selected threshold neighborhood",
      screening,
      perFrameCsvWritten: false,
    },
    baseline: evaluated.baseline,
    phase3Comparison: phase3Best,
    phase3SelectedSameSplit: phase3SameSplit,
    candidatePredictors: models,
    constraints: selected.public,
    blendWeightComparison: selectBlendWeightComparison(evaluated.rows),
    evaluatedCandidates: evaluated.rows.map(summarizeFullRow),
    elapsedSec,
  };
}

function summarizeScreenRow(row) {
  return {
    gateId: row.gate.id,
    candidateIndex: row.gate.candidateIndex,
    weightConfigId: row.gate.params.weightConfigId,
    threshold: row.gate.params.threshold,
    validationUtility: row.validationUtility,
    validation: row.metric,
  };
}

function summarizeFullRow(row) {
  return {
    id: row.id,
    family: row.family,
    candidateId: row.candidateId,
    sourceCandidateId: row.sourceCandidateId,
    advancedBlendWeight: row.advancedBlendWeight,
    params: row.params,
    validationUtility: row.validationUtility,
    testUtility: row.testUtility,
    validation: row.validation,
    test: row.test,
  };
}

function renderFrontierMd(data) {
  const rows = [];
  for (const name of ["strict", "balanced", "aggressive", "noGo"]) {
    const best = data.constraints[name].best;
    rows.push(best ? [
      name,
      best.id,
      best.candidateId,
      String(best.advancedBlendWeight),
      fmt(best.test.metrics.mean),
      fmt(best.test.metrics.p95),
      fmt(best.test.metrics.p99),
      fmt(best.test.metrics.max),
      String(best.test.regressionsVsBaseline.worseOver5px),
      String(best.test.regressionsVsBaseline.worseOver10px),
      `${best.test.gateUses.advanced}/${best.test.gateUses.fallback}`,
      fmt(best.testUtility),
    ] : [name, "none", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]);
  }
  const phase3 = data.phase3Comparison;
  const phase3Text = phase3 ? `Phase3 selected \`${phase3.id}\`: test mean/p95/p99/max ${fmt(phase3.test.metrics.mean)} / ${fmt(phase3.test.metrics.p95)} / ${fmt(phase3.test.metrics.p99)} / ${fmt(phase3.test.metrics.max)} px, >5/>10 ${phase3.test.regressionsVsBaseline.worseOver5px}/${phase3.test.regressionsVsBaseline.worseOver10px}, advanced ${phase3.test.gateUses.advanced}.` : "Phase3 selected gate was not available for comparison.";
  const phase3Same = data.phase3SelectedSameSplit;
  const phase3SameText = phase3Same ? `Same-split phase3 selected gate: test mean/p95/p99/max ${fmt(phase3Same.test.metrics.mean)} / ${fmt(phase3Same.test.metrics.p95)} / ${fmt(phase3Same.test.metrics.p99)} / ${fmt(phase3Same.test.metrics.max)} px, >5/>10 ${phase3Same.test.regressionsVsBaseline.worseOver5px}/${phase3Same.test.regressionsVsBaseline.worseOver10px}, advanced ${phase3Same.test.gateUses.advanced}.` : "Same-split phase3 selected gate could not be evaluated.";
  const blendRows = [];
  for (const weight of ["0.25", "0.5", "0.75", "1"]) {
    const balanced = data.blendWeightComparison[weight]?.balanced;
    const aggressive = data.blendWeightComparison[weight]?.aggressive;
    blendRows.push([
      weight,
      balanced ? fmt(balanced.test.metrics.mean) : "-",
      balanced ? fmt(balanced.test.metrics.p95) : "-",
      balanced ? `${balanced.test.regressionsVsBaseline.worseOver5px}/${balanced.test.regressionsVsBaseline.worseOver10px}` : "-",
      balanced ? `${balanced.test.gateUses.advanced}/${balanced.test.gateUses.fallback}` : "-",
      aggressive ? fmt(aggressive.test.metrics.mean) : "-",
      aggressive ? fmt(aggressive.test.metrics.p95) : "-",
      aggressive ? `${aggressive.test.regressionsVsBaseline.worseOver5px}/${aggressive.test.regressionsVsBaseline.worseOver10px}` : "-",
      aggressive ? `${aggressive.test.gateUses.advanced}/${aggressive.test.gateUses.fallback}` : "-",
    ]);
  }
  return `# Cursor Prediction v10 Phase 4 Pareto Frontier

Generated: ${data.generatedAt}

Canonical input: \`${data.canonicalInput}\`. GPU used: no. Dependencies: Node.js standard library only. No per-frame CSV, raw ZIP, cache, checkpoint, or node_modules output was written.

## Split

| split | scripts | rows |
| --- | ---: | ---: |
| train | ${data.splitPolicy.train} | ${data.rowSummary.rowsBySplit.train} |
| validation | ${data.splitPolicy.validation} | ${data.rowSummary.rowsBySplit.validation} |
| test | ${data.splitPolicy.test} | ${data.rowSummary.rowsBySplit.test} |

## Baseline And Phase3

Baseline test mean/p95/p99/max ${fmt(data.baseline.test.metrics.mean)} / ${fmt(data.baseline.test.metrics.p95)} / ${fmt(data.baseline.test.metrics.p99)} / ${fmt(data.baseline.test.metrics.max)} px.

${phase3Text}

${phase3SameText}

## Best By Constraint

${renderTable(["bucket", "gate", "candidate", "blend", "mean", "p95", "p99", "max", ">5", ">10", "advanced/fallback", "utility"], rows)}

## Blend Weight Comparison

${renderTable(["blend", "balanced mean", "balanced p95", "balanced >5/>10", "balanced advanced/fallback", "aggr mean", "aggr p95", "aggr >5/>10", "aggr advanced/fallback"], blendRows)}

## Search

- candidate predictors: ${data.searchPolicy.predictorFamilies.join(", ")}
- advanced blend weights: ${data.searchPolicy.advancedBlendWeights.join(", ")}
- monotonic score weight configs: ${data.searchPolicy.monotonicScoreWeightConfigs}
- screening rows: train ${data.searchPolicy.screening.trainSampleRows}, validation ${data.searchPolicy.screening.validationSampleRows}
- full evaluated shortlisted candidates: ${data.evaluatedCandidates.length}
- runtime: ${fmt(data.elapsedSec, 2)} seconds on CPU

## Judgment

Strict remains the production-shaped safety bucket. Balanced and aggressive show how much extra mean/p95/p99 movement is available when small regression counts are permitted. No-go is reference only and should not be productized without a separate risk gate.
`;
}

function renderBreakdownMd(data) {
  const chunks = [`# Cursor Prediction v10 Phase 4 Breakdown

Generated: ${data.generatedAt}
`];
  for (const [bucket, value] of Object.entries(data.buckets)) {
    const rows = [];
    for (const [dimension, buckets] of Object.entries(value.breakdown)) {
      for (const [name, item] of Object.entries(buckets)) {
        if (item.metrics.count === 0) continue;
        rows.push([
          dimension,
          name,
          String(item.metrics.count),
          fmt(item.metrics.mean),
          fmt(item.metrics.p95),
          fmt(item.metrics.p99),
          String(item.regressionsVsBaseline.worseOver5px),
          String(item.regressionsVsBaseline.worseOver10px),
          `${item.gateUses.advanced}/${item.gateUses.fallback}`,
        ]);
      }
    }
    chunks.push(`## ${bucket}

Gate: \`${value.gateId}\` using \`${value.candidateId}\` (source \`${value.sourceCandidateId}\`, blend ${value.advancedBlendWeight}).

Overall test mean/p95/p99/max ${fmt(value.test.metrics.mean)} / ${fmt(value.test.metrics.p95)} / ${fmt(value.test.metrics.p99)} / ${fmt(value.test.metrics.max)} px. Regressions >5/>10 ${value.test.regressionsVsBaseline.worseOver5px}/${value.test.regressionsVsBaseline.worseOver10px}.

${renderTable(["dimension", "bucket", "rows", "mean", "p95", "p99", ">5", ">10", "advanced/fallback"], rows)}
`);
  }
  return chunks.join("\n");
}

function appendScores(outDir, phase4) {
  const scoresPath = path.join(outDir, "scores.json");
  let scores = {};
  if (fs.existsSync(scoresPath)) scores = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
  scores.schemaVersion = scores.schemaVersion || SCORE_SCHEMA;
  scores.generatedAt = phase4.generatedAt;
  scores.phase4 = {
    scriptCount: phase4.scriptCount,
    evaluatedRows: phase4.rowSummary.evaluatedRows,
    gpuUsed: false,
    canonicalDataset: phase4.canonicalInput,
    perFrameCsvWritten: false,
    splitPolicy: phase4.splitPolicy,
    searchPolicy: phase4.searchPolicy,
    baseline: phase4.baseline.test,
    phase3Comparison: phase4.phase3Comparison,
    phase3SelectedSameSplit: phase4.phase3SelectedSameSplit,
    blendWeightComparison: phase4.blendWeightComparison,
    strict: phase4.constraints.strict.best,
    balanced: phase4.constraints.balanced.best,
    aggressive: phase4.constraints.aggressive.best,
    noGo: phase4.constraints.noGo.best,
  };
  writeJson(scoresPath, scores);
}

function appendExperimentLog(outDir, generatedAt, args, phase4) {
  const best = phase4.constraints;
  const lineFor = (name) => {
    const row = best[name].best;
    if (!row) return `- ${name}: no candidate met the constraint;`;
    return `- ${name}: \`${row.id}\`, candidate \`${row.candidateId}\`, mean/p95/p99 ${fmt(row.test.metrics.mean)} / ${fmt(row.test.metrics.p95)} / ${fmt(row.test.metrics.p99)} px, >5/>10 ${row.test.regressionsVsBaseline.worseOver5px}/${row.test.regressionsVsBaseline.worseOver10px}, advanced ${row.test.gateUses.advanced};`;
  };
  const text = `
## ${jstStamp(generatedAt)} - Phase 4 Pareto Frontier

Environment:

- Node.js: \`${process.version}\`
- GPU used: no
- Dependency install: none

Command:

\`\`\`powershell
node poc\\cursor-prediction-v10\\scripts\\run-v10-phase4.js${args.limitScripts ? ` --limit-scripts ${args.limitScripts}` : ""}
\`\`\`

Result:

- read ${phase4.scriptCount} scripts from \`${phase4.canonicalInput}\`;
- split by script: train ${phase4.splitPolicy.train}, validation ${phase4.splitPolicy.validation}, test ${phase4.splitPolicy.test};
- evaluated ${phase4.rowSummary.evaluatedRows} rows without writing per-frame CSV or feature files;
${phase4.phase3SelectedSameSplit ? `- same-split phase3 selected gate: mean/p95/p99 ${fmt(phase4.phase3SelectedSameSplit.test.metrics.mean)} / ${fmt(phase4.phase3SelectedSameSplit.test.metrics.p95)} / ${fmt(phase4.phase3SelectedSameSplit.test.metrics.p99)} px, >5/>10 ${phase4.phase3SelectedSameSplit.test.regressionsVsBaseline.worseOver5px}/${phase4.phase3SelectedSameSplit.test.regressionsVsBaseline.worseOver10px}, advanced ${phase4.phase3SelectedSameSplit.test.gateUses.advanced};` : "- same-split phase3 selected gate: unavailable;"}
${lineFor("strict")}
${lineFor("balanced")}
${lineFor("aggressive")}
${lineFor("noGo")}
- runtime: ${fmt(phase4.elapsedSec, 2)} seconds on CPU.

Judgment:

- Strict remains the safest product-shaped result.
- Balanced/aggressive are useful as risk envelope references, but require an explicit product risk gate before adoption.
`;
  fs.appendFileSync(path.join(outDir, "experiment-log.md"), text, "utf8");
}

function metricAccumulator() {
  return {
    count: 0,
    sum: 0,
    sumSq: 0,
    max: 0,
    hist: new Int32Array(Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 2),
  };
}

function addMetric(acc, value, sign = 1) {
  if (!Number.isFinite(value)) return;
  acc.count += sign;
  acc.sum += value * sign;
  acc.sumSq += value * value * sign;
  if (sign > 0 && value > acc.max) acc.max = value;
  const idx = Math.min(acc.hist.length - 1, Math.max(0, Math.floor(value / HISTOGRAM_BIN_PX)));
  acc.hist[idx] += sign;
}

function percentileFromHist(acc, p) {
  if (acc.count === 0) return null;
  const target = Math.max(1, Math.ceil(acc.count * p));
  let seen = 0;
  for (let i = 0; i < acc.hist.length; i += 1) {
    seen += acc.hist[i];
    if (seen >= target) return Math.min(acc.max, (i + 0.5) * HISTOGRAM_BIN_PX);
  }
  return acc.max;
}

function finalizeMetric(acc) {
  if (acc.count === 0) return { count: 0, mean: null, rmse: null, p50: null, p90: null, p95: null, p99: null, max: null };
  return {
    count: acc.count,
    mean: acc.sum / acc.count,
    rmse: Math.sqrt(acc.sumSq / acc.count),
    p50: percentileFromHist(acc, 0.50),
    p90: percentileFromHist(acc, 0.90),
    p95: percentileFromHist(acc, 0.95),
    p99: percentileFromHist(acc, 0.99),
    max: acc.max,
  };
}

function regressionAccumulator() {
  return {
    count: 0,
    worseOver1px: 0,
    worseOver3px: 0,
    worseOver5px: 0,
    worseOver10px: 0,
    improvedOver1px: 0,
    improvedOver3px: 0,
    sumDeltaPx: 0,
  };
}

function addRegression(acc, delta) {
  acc.count += 1;
  acc.sumDeltaPx += delta;
  if (delta > 1) acc.worseOver1px += 1;
  if (delta > 3) acc.worseOver3px += 1;
  if (delta > 5) acc.worseOver5px += 1;
  if (delta > 10) acc.worseOver10px += 1;
  if (delta < -1) acc.improvedOver1px += 1;
  if (delta < -3) acc.improvedOver3px += 1;
}

function finalizeRegression(acc, countOverride = null) {
  return {
    count: countOverride ?? acc.count,
    worseOver1px: acc.worseOver1px,
    worseOver3px: acc.worseOver3px,
    worseOver5px: acc.worseOver5px,
    worseOver10px: acc.worseOver10px,
    improvedOver1px: acc.improvedOver1px,
    improvedOver3px: acc.improvedOver3px,
    meanDeltaPx: acc.sumDeltaPx / Math.max(1, countOverride ?? acc.count),
  };
}

function renderTable(headers, rows) {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(roundObject(value), null, 2)}\n`, "utf8");
}

function roundObject(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : value;
  if (Array.isArray(value)) return value.map(roundObject);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key !== "gate") out[key] = roundObject(item);
    }
    return out;
  }
  return value;
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined) return "n/a";
  return (Math.round(value * (10 ** digits)) / (10 ** digits)).toFixed(digits);
}

function idNum(value) {
  return String(Math.round(value * 1000000) / 1000000).replace("-", "m").replace(".", "p");
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jstStamp(iso) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} JST`;
}

function main() {
  const args = parseArgs(process.argv);
  const started = Date.now();
  const generatedAt = new Date().toISOString();
  fs.mkdirSync(args.outDir, { recursive: true });

  const runtime = loadPhase3Runtime();
  const phase2 = runtime.loadPhase2Runtime();
  const scripts = runtime.readScripts(args.input, args.limitScripts);
  const splits = runtime.makeSplits(scripts.length, args.seed);
  const base = runtime.baselineModel();
  const phase3Best = loadPhase3Best(args.outDir);
  const models = candidateModels(base, phase3Best, args.fullSearch);
  const prepared = runtime.prepareRows(scripts, splits, args, phase2, models, base);
  const weightConfigs = buildWeightConfigs(args, phase3Best);
  const screened = screenCandidates(runtime, prepared.stores, models, weightConfigs, args, phase3Best);
  const evaluated = fullEvaluate(runtime, prepared.stores, models, screened.shortlist);
  const phase3SameSplit = evaluatePhase3SameSplit(runtime, prepared.stores, models, phase3Best);
  const publicSelected = selectConstraints(evaluated.rows);
  const selected = {
    public: publicSelected,
    _rowsById: new Map(evaluated.rows.map((row) => [row.id, row])),
  };
  const breakdowns = buildBreakdowns(runtime, prepared.stores, selected);
  const elapsedSec = (Date.now() - started) / 1000;

  const phase4 = buildFrontierJson(args, generatedAt, scripts, splits.counts, prepared.rowSummary, models, weightConfigs, phase3Best, phase3SameSplit, screened.screening, evaluated, selected, elapsedSec);
  const breakdownJson = {
    schemaVersion: BREAKDOWN_SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    canonicalInput: phase4.canonicalInput,
    buckets: breakdowns,
  };
  writeJson(path.join(args.outDir, "phase-4-pareto-frontier.json"), phase4);
  writeJson(path.join(args.outDir, "phase-4-breakdown.json"), breakdownJson);
  fs.writeFileSync(path.join(args.outDir, "phase-4-pareto-frontier.md"), renderFrontierMd(roundObject(phase4)), "utf8");
  fs.writeFileSync(path.join(args.outDir, "phase-4-breakdown.md"), renderBreakdownMd(roundObject(breakdownJson)), "utf8");
  appendScores(args.outDir, roundObject(phase4));
  appendExperimentLog(args.outDir, generatedAt, roundObject(args), roundObject(phase4));

  process.stdout.write(`Read scripts: ${scripts.length}\n`);
  process.stdout.write(`Evaluated rows: ${prepared.rowSummary.evaluatedRows}\n`);
  process.stdout.write(`Split rows train/validation/test: ${prepared.rowSummary.rowsBySplit.train}/${prepared.rowSummary.rowsBySplit.validation}/${prepared.rowSummary.rowsBySplit.test}\n`);
  for (const name of ["strict", "balanced", "aggressive", "noGo"]) {
    const best = phase4.constraints[name].best;
    if (!best) {
      process.stdout.write(`${name}: no candidate\n`);
      continue;
    }
    process.stdout.write(`${name}: ${best.id} candidate=${best.candidateId} mean/p95/p99=${fmt(best.test.metrics.mean)}/${fmt(best.test.metrics.p95)}/${fmt(best.test.metrics.p99)} reg>5/>10=${best.test.regressionsVsBaseline.worseOver5px}/${best.test.regressionsVsBaseline.worseOver10px} adv=${best.test.gateUses.advanced}\n`);
  }
  process.stdout.write(`Runtime sec: ${fmt(elapsedSec, 2)}\n`);
}

main();
