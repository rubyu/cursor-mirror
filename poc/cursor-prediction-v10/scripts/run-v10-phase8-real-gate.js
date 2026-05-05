#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCHEMA = "cursor-prediction-v10-phase8-real-gate/1";
const GAP_SCHEMA = "cursor-prediction-v10-phase8-synthetic-real-gap/1";
const SCORE_SCHEMA = "cursor-prediction-v10-scores/1";

const HISTOGRAM_BIN_PX = 0.05;
const HISTOGRAM_MAX_PX = 4096;
const HISTORY_MS = 200;
const HORIZONS_MS = [8.33, 16.67, 25, 33.33];
const SPEED_BINS = [
  { id: "0-25", min: 0, max: 25 },
  { id: "25-100", min: 25, max: 100 },
  { id: "100-250", min: 100, max: 250 },
  { id: "250-500", min: 250, max: 500 },
  { id: "500-1000", min: 500, max: 1000 },
  { id: "1000-2000", min: 1000, max: 2000 },
  { id: ">=2000", min: 2000, max: Infinity },
];
const MISSING_SCENARIOS = ["clean", "missing_10pct", "missing_25pct"];

const BASELINE_MODEL = {
  id: "constant_velocity_last2_cap24",
  family: "constant_velocity_last2",
  params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 },
};
const ADVANCED_MODELS = [
  {
    id: "least_squares_w50_cap24",
    family: "least_squares_window",
    params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 24 },
  },
  {
    id: "least_squares_w50_cap36",
    family: "least_squares_window",
    params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 36 },
  },
  {
    id: "least_squares_w70_cap24",
    family: "least_squares_window",
    params: { windowMs: 70, horizonCapMs: 33.33, displacementCapPx: 24 },
  },
  {
    id: "blend_cv_ls_w50_cap36_ls0p25",
    family: "blend",
    params: {
      weightB: 0.25,
      a: BASELINE_MODEL,
      b: { family: "least_squares_window", params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 36 } },
    },
  },
  {
    id: "blend_cv_ls_w50_cap36_ls0p5",
    family: "blend",
    params: {
      weightB: 0.5,
      a: BASELINE_MODEL,
      b: { family: "least_squares_window", params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 36 } },
    },
  },
  {
    id: "blend_cv_ls_w50_cap36_ls0p75",
    family: "blend",
    params: {
      weightB: 0.75,
      a: BASELINE_MODEL,
      b: { family: "least_squares_window", params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 36 } },
    },
  },
];
const MODEL_IDS = [BASELINE_MODEL.id, ...ADVANCED_MODELS.map((m) => m.id)];
const LS_DISAGREEMENT_MODEL_INDEX = ADVANCED_MODELS.findIndex((m) => m.id === "least_squares_w50_cap36");

function parseArgs(argv) {
  const scriptDir = __dirname;
  const outDir = path.resolve(scriptDir, "..");
  const root = path.resolve(outDir, "..", "..");
  const args = {
    root,
    outDir,
    zipLimit: 6,
    zips: null,
    syntheticLimitScripts: 3000,
    skipSyntheticRecompute: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--zip-limit") args.zipLimit = intArg(argv[++i], "zip-limit");
    else if (arg === "--zips") args.zips = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--synthetic-limit-scripts") args.syntheticLimitScripts = intArg(argv[++i], "synthetic-limit-scripts");
    else if (arg === "--skip-synthetic-recompute") args.skipSyntheticRecompute = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v10\\scripts\\run-v10-phase8-real-gate.js [--zip-limit 6]

Options:
  --root <path>                       repo root containing cursor-mirror-trace-*.zip
  --out-dir <path>                    output directory, defaults to poc/cursor-prediction-v10
  --zip-limit <n>                     newest trace ZIP count to read, default 6
  --zips <a,b,c>                      explicit ZIP file names, relative to root unless absolute
  --synthetic-limit-scripts <n>        synthetic script subset for gap recompute, default 3000
  --skip-synthetic-recompute           use existing synthetic summaries only
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.zipLimit <= 0) throw new Error("--zip-limit must be positive");
  return args;
}

function intArg(text, name) {
  const value = Number(text);
  if (!Number.isInteger(value)) throw new Error(`--${name} expects an integer`);
  return value;
}

function loadPhase7Runtime() {
  const phase7Path = path.join(__dirname, "run-v10-phase7-real-trace.js");
  const source = fs.readFileSync(phase7Path, "utf8").replace(/\nmain\(\);\s*$/, "\n");
  const context = {
    require,
    console,
    process: { ...process, argv: ["node", phase7Path, "--help"] },
    __dirname,
    __filename: phase7Path,
  };
  vm.createContext(context);
  vm.runInContext(`${source}
globalThis.phase7 = {
  HORIZONS_MS,
  listTraceZips,
  loadTrace,
  lowerBound,
  interpolateRef,
  refIndexAtOrBefore,
  rowFeatures,
  predict,
  distance,
  fmt,
  roundObject,
};`, context, { filename: phase7Path });
  return context.phase7;
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
  loadPhase2Runtime,
  readScripts,
  makeSplits,
  prepareRows,
  baselineModel,
};`, context, { filename: phase3Path });
  return context.phase3;
}

function loadRows(phase7, zipPaths) {
  const traces = [];
  const rows = [];
  for (let i = 0; i < zipPaths.length; i += 1) {
    const trace = phase7.loadTrace(zipPaths[i], `session_${i + 1}`);
    traces.push(trace);
    for (const anchor of trace.anchors) {
      const refIndex = phase7.refIndexAtOrBefore(trace, anchor.elapsedUs);
      if (refIndex < 2) continue;
      const features = phase7.rowFeatures(trace, refIndex);
      for (const horizonMs of HORIZONS_MS) {
        const target = phase7.interpolateRef(trace, anchor.elapsedUs + horizonMs * 1000);
        if (!target) continue;
        const row = { trace, refIndex, horizonMs, target, features };
        const basePrediction = phase7.predict(row, BASELINE_MODEL);
        const baselineError = phase7.distance(basePrediction.x, basePrediction.y, target.x, target.y);
        const candidateErrors = [];
        const candidateDisagreements = [];
        for (const model of ADVANCED_MODELS) {
          const prediction = phase7.predict(row, model);
          candidateErrors.push(phase7.distance(prediction.x, prediction.y, target.x, target.y));
          candidateDisagreements.push(phase7.distance(prediction.x, prediction.y, basePrediction.x, basePrediction.y));
        }
        rows.push({
          sessionIndex: i,
          sourceZip: path.basename(zipPaths[i]),
          anchorUs: anchor.elapsedUs,
          refIndex,
          horizonMs,
          baselineError,
          candidateErrors,
          observedSpeed: features.observedSpeedPxPerSec,
          acceleration: features.accelerationPxPerSec2,
          curvature: features.curvatureDeg,
          historyCount: features.historyCount,
          edgeDistance: features.edgeDistancePx,
          jitterProxy: features.jitterProxyPx,
          speedBin: features.speedBin,
          lsCvDisagreement: candidateDisagreements[LS_DISAGREEMENT_MODEL_INDEX],
          missingScenario: "real_trace_no_synthetic_dropout",
        });
      }
    }
  }
  return { traces, rows };
}

function sessionSummaries(traces, rows) {
  return traces.map((trace, sessionIndex) => {
    const sessionRows = rows.filter((row) => row.sessionIndex === sessionIndex);
    return {
      sessionId: trace.sessionId,
      sourceZip: trace.sourceZip,
      traceFormatVersion: trace.metadata.TraceFormatVersion ?? null,
      createdUtc: trace.metadata.CreatedUtc ?? null,
      csvRows: trace.csvRows,
      eventCounts: trace.eventCounts,
      referencePollCount: trace.refTimesUs.length,
      anchorCount: trace.anchors.length,
      rowsBuilt: sessionRows.length,
      qualityWarnings: trace.metadata.QualityWarnings ?? [],
    };
  });
}

function chronologicalRows(rows, traces) {
  const createdBySession = traces.map((trace, i) => Date.parse(trace.metadata.CreatedUtc || "") || i);
  return [...rows].sort((a, b) => {
    const d = createdBySession[a.sessionIndex] - createdBySession[b.sessionIndex];
    return d || a.anchorUs - b.anchorUs || a.horizonMs - b.horizonMs;
  });
}

function splitTrainValidation(rows) {
  const ordered = [...rows].sort((a, b) => a.anchorUs - b.anchorUs || a.horizonMs - b.horizonMs);
  const trainEnd = Math.max(1, Math.floor(ordered.length * 0.70));
  return { train: ordered.slice(0, trainEnd), validation: ordered.slice(trainEnd) };
}

function crossSessionSplits(rows, traces) {
  const nonEmptySessions = traces
    .map((trace, sessionIndex) => ({ sessionIndex, sourceZip: trace.sourceZip, rows: rows.filter((row) => row.sessionIndex === sessionIndex) }))
    .filter((session) => session.rows.length > 0)
    .slice(0, 2);
  if (nonEmptySessions.length < 2) throw new Error("phase8 needs two non-empty real sessions for cross-session evaluation");
  return [
    makeCrossSplit(nonEmptySessions[0], nonEmptySessions[1]),
    makeCrossSplit(nonEmptySessions[1], nonEmptySessions[0]),
  ];
}

function makeCrossSplit(trainSession, testSession) {
  const split = splitTrainValidation(trainSession.rows);
  return {
    id: `${trainSession.sourceZip}_to_${testSession.sourceZip}`,
    trainSourceZip: trainSession.sourceZip,
    validationSourceZip: trainSession.sourceZip,
    testSourceZip: testSession.sourceZip,
    trainRows: split.train,
    validationRows: split.validation,
    testRows: [...testSession.rows].sort((a, b) => a.anchorUs - b.anchorUs || a.horizonMs - b.horizonMs),
  };
}

function chronologicalSplit(rows, traces) {
  const ordered = chronologicalRows(rows, traces);
  const trainEnd = Math.max(1, Math.floor(ordered.length * 0.70));
  const validationEnd = Math.max(trainEnd + 1, Math.floor(ordered.length * 0.85));
  return {
    id: "chronological_70_15_15",
    trainRows: ordered.slice(0, trainEnd),
    validationRows: ordered.slice(trainEnd, validationEnd),
    testRows: ordered.slice(validationEnd),
  };
}

function fixedCandidateGate(modelIndex, id, role) {
  return { id, role, family: "fixed_candidate", candidateIndex: modelIndex, candidateId: ADVANCED_MODELS[modelIndex].id };
}

function baselineGate() {
  return { id: "constant_velocity_last2_cap24", role: "baseline", family: "baseline", candidateIndex: null, candidateId: null };
}

function trainGates(split) {
  const gates = [baselineGate()];
  for (let i = 0; i < ADVANCED_MODELS.length; i += 1) {
    gates.push(fixedCandidateGate(i, ADVANCED_MODELS[i].id, "raw"));
  }
  for (let i = 0; i < ADVANCED_MODELS.length; i += 1) {
    gates.push(...trainMonotonicGates(split.trainRows, split.validationRows, i));
    gates.push(...trainTreeGates(split.trainRows, split.validationRows, i));
  }
  const evaluated = gates.map((gate) => ({
    gate,
    train: evaluateGate(split.trainRows, gate),
    validation: evaluateGate(split.validationRows, gate),
    test: evaluateGate(split.testRows, gate),
    rank: gateRank(evaluateGate(split.validationRows, gate)),
  })).sort((a, b) => a.rank - b.rank);
  return {
    selected: evaluated[0],
    evaluated: evaluated.slice(0, 32),
  };
}

function trainMonotonicGates(trainRows, validationRows, candidateIndex) {
  const configs = monotonicWeightConfigs();
  const gates = [];
  for (let c = 0; c < configs.length; c += 1) {
    const weights = configs[c];
    const scores = trainRows.map((row) => monotonicScore(row, weights)).sort((a, b) => a - b);
    const quantiles = [0.002, 0.005, 0.01, 0.02, 0.035, 0.05, 0.075, 0.10, 0.14, 0.18, 0.24, 0.32, 0.42, 0.55, 0.70, 0.85];
    for (const q of quantiles) {
      const threshold = scores[Math.min(scores.length - 1, Math.max(0, Math.floor(q * (scores.length - 1))))];
      gates.push({
        id: `real_monotonic_${ADVANCED_MODELS[candidateIndex].id}_c${c}_q${idNum(q)}`,
        role: "real_monotonic_gate",
        family: "monotonic",
        candidateIndex,
        candidateId: ADVANCED_MODELS[candidateIndex].id,
        params: { weights, threshold },
      });
    }
  }
  return gates
    .map((gate) => ({ gate, validation: evaluateGate(validationRows, gate), rank: gateRank(evaluateGate(validationRows, gate)) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)
    .map((item, i) => ({ ...item.gate, id: `real_monotonic_${ADVANCED_MODELS[candidateIndex].id}_${i + 1}` }));
}

function monotonicWeightConfigs() {
  return [
    { lowSpeed: 1.4, highSpeed: 0.3, acceleration: 1.0, curvature: 0.8, edgeNear: 0.4, sparseHistory: 0.2, jitterProxy: 0.8, horizon: 0.2, disagreement: 1.2 },
    { lowSpeed: 2.0, highSpeed: 0.2, acceleration: 1.5, curvature: 1.2, edgeNear: 0.6, sparseHistory: 0.2, jitterProxy: 1.2, horizon: 0.2, disagreement: 1.8 },
    { lowSpeed: 0.8, highSpeed: 0.1, acceleration: 2.0, curvature: 1.6, edgeNear: 0.5, sparseHistory: 0.3, jitterProxy: 0.6, horizon: 0.1, disagreement: 1.0 },
    { lowSpeed: 1.8, highSpeed: 0.6, acceleration: 0.7, curvature: 0.6, edgeNear: 0.8, sparseHistory: 0.2, jitterProxy: 1.6, horizon: 0.4, disagreement: 2.4 },
    { lowSpeed: 1.2, highSpeed: 0.2, acceleration: 1.2, curvature: 2.0, edgeNear: 0.2, sparseHistory: 0.2, jitterProxy: 0.6, horizon: 0.4, disagreement: 0.6 },
  ];
}

function monotonicScore(row, weights) {
  let score = 0;
  score += weights.lowSpeed * Math.max(0, (350 - row.observedSpeed) / 350);
  score += weights.highSpeed * Math.max(0, (row.observedSpeed - 3000) / 1200);
  score += weights.acceleration * Math.log1p(row.acceleration / 8000);
  score += weights.curvature * (row.curvature / 90);
  score += weights.edgeNear * Math.max(0, (64 - row.edgeDistance) / 64);
  score += weights.sparseHistory * Math.max(0, (13 - row.historyCount) / 13);
  score += weights.jitterProxy * Math.log1p(row.jitterProxy || 0);
  score += weights.horizon * (row.horizonMs / 33.33);
  score += weights.disagreement * Math.log1p(row.lsCvDisagreement || 0);
  return score;
}

const TREE_FEATURES = [
  { id: "observedSpeed", thresholds: [5, 25, 100, 250, 500, 1000, 2000, 3000] },
  { id: "acceleration", thresholds: [500, 2000, 8000, 20000, 50000, 100000] },
  { id: "curvature", thresholds: [1, 5, 15, 30, 60, 90] },
  { id: "historyCount", thresholds: [8, 13, 24, 50, 80, 120] },
  { id: "horizonMs", thresholds: [8.33, 16.67, 25] },
  { id: "jitterProxy", thresholds: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2] },
  { id: "edgeDistance", thresholds: [8, 24, 64, 128] },
  { id: "lsCvDisagreement", thresholds: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 24] },
];

function trainTreeGates(trainRows, validationRows, candidateIndex) {
  const policies = [
    { id: "strict", maxWorse10: 0, maxWorse5Rate: 0, minRows: Math.max(40, Math.floor(trainRows.length * 0.002)), minGain: 0.015 },
    { id: "balanced", maxWorse10: 0, maxWorse5Rate: 0.002, minRows: Math.max(60, Math.floor(trainRows.length * 0.003)), minGain: 0.025 },
  ];
  const gates = [];
  for (const policy of policies) {
    for (const depth of [1, 2, 3, 4]) {
      const tree = buildTree(trainRows, candidateIndex, 0, depth, policy);
      gates.push({
        id: `real_tree_${policy.id}_d${depth}_${ADVANCED_MODELS[candidateIndex].id}`,
        role: "real_tree_gate",
        family: "tree",
        candidateIndex,
        candidateId: ADVANCED_MODELS[candidateIndex].id,
        params: { policy, maxDepth: depth, root: tree },
      });
    }
  }
  return gates
    .map((gate) => ({ gate, validation: evaluateGate(validationRows, gate), rank: gateRank(evaluateGate(validationRows, gate)) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)
    .map((item, i) => ({ ...item.gate, id: `real_tree_${ADVANCED_MODELS[candidateIndex].id}_${i + 1}` }));
}

function buildTree(rows, candidateIndex, depth, maxDepth, policy) {
  const leaf = leafForRows(rows, candidateIndex, policy);
  if (depth >= maxDepth || rows.length < policy.minRows * 2) return leaf;
  const parentCost = leaf.cost;
  let best = null;
  for (const feature of TREE_FEATURES) {
    for (const threshold of feature.thresholds) {
      const left = [];
      const right = [];
      for (const row of rows) (featureValue(row, feature.id) <= threshold ? left : right).push(row);
      if (left.length < policy.minRows || right.length < policy.minRows) continue;
      const leftCost = leafForRows(left, candidateIndex, policy).cost;
      const rightCost = leafForRows(right, candidateIndex, policy).cost;
      const cost = leftCost + rightCost;
      if (!best || cost < best.cost) best = { feature, threshold, left, right, cost };
    }
  }
  if (!best || best.cost >= parentCost - rows.length * policy.minGain) return leaf;
  return {
    type: "split",
    feature: best.feature.id,
    threshold: best.threshold,
    left: buildTree(best.left, candidateIndex, depth + 1, maxDepth, policy),
    right: buildTree(best.right, candidateIndex, depth + 1, maxDepth, policy),
  };
}

function leafForRows(rows, candidateIndex, policy) {
  let sumDelta = 0;
  let worse5 = 0;
  let worse10 = 0;
  let worse3 = 0;
  for (const row of rows) {
    const delta = row.candidateErrors[candidateIndex] - row.baselineError;
    sumDelta += delta;
    if (delta > 3) worse3 += 1;
    if (delta > 5) worse5 += 1;
    if (delta > 10) worse10 += 1;
  }
  const meanDeltaPx = sumDelta / Math.max(1, rows.length);
  const allowed = worse10 <= policy.maxWorse10
    && worse5 / Math.max(1, rows.length) <= policy.maxWorse5Rate
    && meanDeltaPx < -0.02;
  const cost = allowed ? sumDelta + worse3 * 2 + worse5 * 200 + worse10 * 100000 : 0;
  return { type: "leaf", useAdvanced: allowed && cost < 0, rows: rows.length, worseOver5px: worse5, worseOver10px: worse10, meanDeltaPx, cost };
}

function featureValue(row, id) {
  return row[id];
}

function passesGate(row, gate) {
  if (gate.family === "baseline") return false;
  if (gate.family === "fixed_candidate") return true;
  if (gate.family === "monotonic") return monotonicScore(row, gate.params.weights) <= gate.params.threshold;
  if (gate.family === "tree") return passesTree(row, gate.params.root);
  throw new Error(`Unknown gate family: ${gate.family}`);
}

function passesTree(row, node) {
  if (node.type === "leaf") return node.useAdvanced;
  return featureValue(row, node.feature) <= node.threshold ? passesTree(row, node.left) : passesTree(row, node.right);
}

function evaluateGate(rows, gate) {
  const metric = metricAccumulator();
  const reg = regressionAccumulator();
  let advanced = 0;
  let fallback = 0;
  for (const row of rows) {
    const useAdvanced = passesGate(row, gate);
    const error = useAdvanced ? row.candidateErrors[gate.candidateIndex] : row.baselineError;
    if (useAdvanced) advanced += 1;
    else fallback += 1;
    addMetric(metric, error);
    addRegression(reg, error - row.baselineError);
  }
  return { metrics: finalizeMetric(metric), regressionsVsBaseline: finalizeRegression(reg), gateUses: { advanced, fallback } };
}

function gateRank(result) {
  const r = result.regressionsVsBaseline;
  return r.worseOver10px * 1e12
    + r.worseOver5px * 1e8
    + Math.max(0, r.meanDeltaPx) * 1e7
    + result.metrics.mean * 1000
    + result.metrics.p95
    + result.metrics.p99 * 0.1;
}

function summarizeAggregate(label, selectedResults) {
  const metric = metricAccumulator();
  const reg = regressionAccumulator();
  const gateUses = { advanced: 0, fallback: 0 };
  for (const result of selectedResults) {
    mergeMetric(metric, hydrateMetricFromFinal(result.metrics));
    mergeRegression(reg, hydrateRegressionFromFinal(result.regressionsVsBaseline));
    gateUses.advanced += result.gateUses.advanced;
    gateUses.fallback += result.gateUses.fallback;
  }
  return { id: label, metrics: finalizeMetric(metric), regressionsVsBaseline: finalizeRegression(reg), gateUses };
}

function summarizeSelectedCrossSession(label, splits) {
  const metric = metricAccumulator();
  const reg = regressionAccumulator();
  const gateUses = { advanced: 0, fallback: 0 };
  for (const split of splits) {
    const gate = split.selected.gate;
    for (const row of split.testRows) {
      const useAdvanced = passesGate(row, gate);
      const error = useAdvanced ? row.candidateErrors[gate.candidateIndex] : row.baselineError;
      if (useAdvanced) gateUses.advanced += 1;
      else gateUses.fallback += 1;
      addMetric(metric, error);
      addRegression(reg, error - row.baselineError);
    }
  }
  return { id: label, metrics: finalizeMetric(metric), regressionsVsBaseline: finalizeRegression(reg), gateUses };
}

function hydrateMetricFromFinal(finalMetric) {
  const acc = metricAccumulator();
  acc.count = finalMetric.count;
  acc.sum = (finalMetric.mean || 0) * finalMetric.count;
  acc.sumSq = ((finalMetric.rmse || 0) ** 2) * finalMetric.count;
  acc.max = finalMetric.max || 0;
  return acc;
}

function hydrateRegressionFromFinal(finalReg) {
  return {
    count: finalReg.count,
    worseOver1px: finalReg.worseOver1px,
    worseOver3px: finalReg.worseOver3px,
    worseOver5px: finalReg.worseOver5px,
    worseOver10px: finalReg.worseOver10px,
    improvedOver1px: finalReg.improvedOver1px,
    improvedOver3px: finalReg.improvedOver3px,
    sumDeltaPx: finalReg.meanDeltaPx * finalReg.count,
  };
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

function addMetric(acc, value) {
  if (!Number.isFinite(value)) return;
  acc.count += 1;
  acc.sum += value;
  acc.sumSq += value * value;
  acc.max = Math.max(acc.max, value);
  const bin = Math.max(0, Math.min(acc.hist.length - 1, Math.floor(value / HISTOGRAM_BIN_PX)));
  acc.hist[bin] += 1;
}

function mergeMetric(target, source) {
  target.count += source.count;
  target.sum += source.sum;
  target.sumSq += source.sumSq;
  target.max = Math.max(target.max, source.max);
  for (let i = 0; i < target.hist.length; i += 1) target.hist[i] += source.hist[i] || 0;
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
  return { count: 0, worseOver1px: 0, worseOver3px: 0, worseOver5px: 0, worseOver10px: 0, improvedOver1px: 0, improvedOver3px: 0, sumDeltaPx: 0 };
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

function mergeRegression(target, source) {
  target.count += source.count;
  target.worseOver1px += source.worseOver1px;
  target.worseOver3px += source.worseOver3px;
  target.worseOver5px += source.worseOver5px;
  target.worseOver10px += source.worseOver10px;
  target.improvedOver1px += source.improvedOver1px;
  target.improvedOver3px += source.improvedOver3px;
  target.sumDeltaPx += source.sumDeltaPx;
}

function finalizeRegression(acc) {
  return {
    count: acc.count,
    worseOver1px: acc.worseOver1px,
    worseOver3px: acc.worseOver3px,
    worseOver5px: acc.worseOver5px,
    worseOver10px: acc.worseOver10px,
    improvedOver1px: acc.improvedOver1px,
    improvedOver3px: acc.improvedOver3px,
    meanDeltaPx: acc.sumDeltaPx / Math.max(1, acc.count),
  };
}

function distributionSummaryFromRows(rows) {
  const numeric = {
    speed: numericSummary(rows.map((r) => r.observedSpeed)),
    acceleration: numericSummary(rows.map((r) => r.acceleration)),
    curvature: numericSummary(rows.map((r) => r.curvature)),
    historyCount: numericSummary(rows.map((r) => r.historyCount)),
    horizonMs: numericSummary(rows.map((r) => r.horizonMs)),
    lsVsCvDisagreement: numericSummary(rows.map((r) => r.lsCvDisagreement)),
    jitterProxy: numericSummary(rows.map((r) => r.jitterProxy)),
  };
  return {
    rows: rows.length,
    numeric,
    speedBins: countBins(rows.map((r) => r.observedSpeed), SPEED_BINS),
    accelerationBins: countNamedBins(rows.map((r) => r.acceleration), [
      { id: "0-2000", min: 0, max: 2000 },
      { id: "2000-8000", min: 2000, max: 8000 },
      { id: "8000-20000", min: 8000, max: 20000 },
      { id: ">=20000", min: 20000, max: Infinity },
    ]),
    curvatureBins: countNamedBins(rows.map((r) => r.curvature), [
      { id: "0-10", min: 0, max: 10 },
      { id: "10-30", min: 10, max: 30 },
      { id: "30-60", min: 30, max: 60 },
      { id: ">=60", min: 60, max: Infinity },
    ]),
    historyCountBins: countNamedBins(rows.map((r) => r.historyCount), [
      { id: "1-2", min: 1, max: 3 },
      { id: "3-5", min: 3, max: 6 },
      { id: "6-12", min: 6, max: 13 },
      { id: ">=13", min: 13, max: Infinity },
    ]),
    horizonBins: Object.fromEntries(HORIZONS_MS.map((h) => [String(h), rows.filter((r) => r.horizonMs === h).length])),
    missingScenarioBins: rows.reduce((acc, row) => {
      acc[row.missingScenario] = (acc[row.missingScenario] || 0) + 1;
      return acc;
    }, {}),
  };
}

function syntheticDistribution(args) {
  const phase2Regression = readJsonIfExists(path.join(args.outDir, "phase-2-regression-anatomy.json"));
  const phase2Distribution = readJsonIfExists(path.join(args.outDir, "phase-2-distribution.json"));
  const phase4 = readJsonIfExists(path.join(args.outDir, "phase-4-pareto-frontier.json"));
  const existing = {
    phase2FullArtifacts: phase2Regression ? {
      rows: phase2Regression.rowSummary.evaluatedRows,
      speedBins: phase2Regression.rowSummary.rowsBySpeedBin,
      accelerationBins: phase2Regression.rowSummary.rowsByAcceleration,
      curvatureBins: phase2Regression.rowSummary.rowsByCurvature,
      historyCountBins: phase2Regression.rowSummary.rowsByHistoryCount,
      horizonBins: phase2Regression.rowSummary.rowsByHorizon,
      missingScenarioBins: phase2Regression.rowSummary.rowsByMissingScenario,
      tagBins: phase2Regression.rowSummary.rowsByTag,
      lsVsCvDisagreement: "not present in phase2 artifact; recomputed subset below",
    } : null,
    phase2Distribution: phase2Distribution ? {
      scripts: phase2Distribution.scripts,
      policy: phase2Distribution.policy,
    } : null,
    phase4Artifact: phase4 ? {
      scriptCount: phase4.scriptCount,
      splitPolicy: phase4.splitPolicy,
      rowSummary: phase4.rowSummary,
      strict: pickGateSummary(phase4.constraints?.strict?.best),
      balanced: pickGateSummary(phase4.constraints?.balanced?.best),
    } : null,
  };
  if (args.skipSyntheticRecompute) return { existing, recomputed: null };

  const phase3 = loadPhase3Runtime();
  const phase2 = phase3.loadPhase2Runtime();
  const input = path.join(args.outDir, "runs", "scripts.synthetic.phase2.jsonl");
  const scripts = phase3.readScripts(input, args.syntheticLimitScripts);
  const splits = phase3.makeSplits(scripts.length, 33003);
  const models = [{
    id: "least_squares_w50_cap36",
    family: "least_squares_window",
    params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 36 },
  }];
  const prepared = syntheticRowsFromScripts(phase2, phase3, scripts, splits, models[0], phase3.baselineModel());
  return {
    existing,
    recomputed: {
      limitScripts: scripts.length,
      allPhase2Subset: distributionSummaryFromRows([...prepared.train, ...prepared.validation, ...prepared.test]),
      phase4Train: distributionSummaryFromRows(prepared.train),
      phase4Validation: distributionSummaryFromRows(prepared.validation),
      phase4Test: distributionSummaryFromRows(prepared.test),
    },
  };
}

function pickGateSummary(gate) {
  if (!gate) return null;
  return {
    id: gate.id,
    candidateId: gate.candidateId,
    test: gate.test ? {
      metrics: gate.test.metrics,
      regressionsVsBaseline: gate.test.regressionsVsBaseline,
      gateUses: gate.test.gateUses,
    } : null,
  };
}

function syntheticRowsFromScripts(phase2, phase3, scripts, splits, model, base) {
  const rowsBySplit = { train: [], validation: [], test: [] };
  const scenarios = phase3.MISSING_SCENARIOS;
  for (let scriptIndex = 0; scriptIndex < scripts.length; scriptIndex += 1) {
    const script = scripts[scriptIndex];
    const split = splits.splitByScript[scriptIndex];
    const samples = phase2.buildSamples(script, 8.33);
    const anchors = phase2.anchorTimes(script, 32);
    for (const anchorTime of anchors) {
      const trueSpeed = phase2.speedAt(script, anchorTime);
      for (const scenario of scenarios) {
        const history = phase2.historyFor(samples, script, anchorTime, scenario, HISTORY_MS);
        if (history.length === 0) continue;
        const features = phase2.rowFeatures(script, history, anchorTime, trueSpeed);
        features.jitterProxyPx = recentJitterProxy(history);
        for (const horizonMs of HORIZONS_MS) {
          const target = phase2.sampleScript(script, anchorTime + horizonMs);
          const row = { history, target, horizonMs, missingScenario: scenario.id, features };
          const baselinePrediction = phase2.predict(row, base);
          const advancedPrediction = phase2.predict(row, model);
          rowsBySplit[split].push({
            observedSpeed: features.observedSpeedPxPerSec,
            acceleration: features.accelerationPxPerSec2,
            curvature: features.curvatureDeg,
            historyCount: features.historyCount,
            horizonMs,
            jitterProxy: features.jitterProxyPx,
            lsCvDisagreement: phase2.dist(advancedPrediction.x, advancedPrediction.y, baselinePrediction.x, baselinePrediction.y),
            missingScenario: scenario.id,
          });
        }
      }
    }
  }
  return rowsBySplit;
}

function recentJitterProxy(history) {
  if (history.length < 4) return 0;
  const start = Math.max(0, history.length - 7);
  const points = history.slice(start);
  const first = points[0];
  const last = points[points.length - 1];
  const span = Math.max(1e-6, last.t - first.t);
  let sum = 0;
  let count = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const f = (p.t - first.t) / span;
    const x = first.x + (last.x - first.x) * f;
    const y = first.y + (last.y - first.y) * f;
    sum += (p.x - x) ** 2 + (p.y - y) ** 2;
    count += 1;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function numericSummary(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, mean: null, p50: null, p90: null, p95: null, p99: null, max: null };
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.50),
    p90: percentile(sorted, 0.90),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - rank) + sorted[hi] * (rank - lo);
}

function countBins(values, bins) {
  return countNamedBins(values, bins);
}

function countNamedBins(values, bins) {
  const out = Object.fromEntries(bins.map((bin) => [bin.id, 0]));
  for (const value of values) {
    for (const bin of bins) {
      if (value >= bin.min && value < bin.max) {
        out[bin.id] += 1;
        break;
      }
    }
  }
  return out;
}

function gapFindings(real, synthetic) {
  const phase4 = synthetic.recomputed?.phase4Test;
  const phase2 = synthetic.existing.phase2FullArtifacts;
  const findings = [];
  if (phase4) {
    findings.push({
      feature: "speed",
      finding: `real p50 ${fmt(real.numeric.speed.p50)} px/s and p90 ${fmt(real.numeric.speed.p90)} px/s vs synthetic phase4-test p50 ${fmt(phase4.numeric.speed.p50)} and p90 ${fmt(phase4.numeric.speed.p90)}; real is dominated by near-stop rows with a small high-speed tail.`,
    });
    findings.push({
      feature: "history/missingScenario",
      finding: `real history is dense (p50 ${fmt(real.numeric.historyCount.p50)}, p95 ${fmt(real.numeric.historyCount.p95)}) and has no synthetic dropout scenarios; phase2 intentionally allocates rows equally across clean/10%/25% missing-history scenarios.`,
    });
    findings.push({
      feature: "LS-vs-CV disagreement",
      finding: `real p50/p95 disagreement ${fmt(real.numeric.lsVsCvDisagreement.p50)} / ${fmt(real.numeric.lsVsCvDisagreement.p95)} px vs synthetic phase4-test ${fmt(phase4.numeric.lsVsCvDisagreement.p50)} / ${fmt(phase4.numeric.lsVsCvDisagreement.p95)} px; real has a lower median but a clamp-heavy p95 tail, so disagreement alone did not separate safe LS adoption.`,
    });
    findings.push({
      feature: "curvature/acceleration",
      finding: `real curvature p95 ${fmt(real.numeric.curvature.p95)} deg and acceleration p95 ${fmt(real.numeric.acceleration.p95)} px/s^2 differ from synthetic phase4-test p95 ${fmt(phase4.numeric.curvature.p95)} deg and ${fmt(phase4.numeric.acceleration.p95)} px/s^2, making phase4's risk score thresholds poorly calibrated.`,
    });
  }
  if (phase2) {
    const realLowSpeedRate = rate(real.speedBins["0-25"], real.rows);
    const syntheticLowSpeedRate = rate(phase2.speedBins["0-25"], phase2.rows);
    findings.push({
      feature: "phase2 speed mix",
      finding: `phase2 full artifact has ${fmtPct(syntheticLowSpeedRate)} in 0-25 px/s vs real ${fmtPct(realLowSpeedRate)}; the generator overrepresents mid-speed scripted motion relative to the latest real traces.`,
    });
  }
  return findings;
}

function buildPhase8Json(args, generatedAt, zipPaths, traces, rows, cross, chronological, elapsedSec) {
  const aggregate = summarizeSelectedCrossSession("selected_real_gate_cross_session_aggregate", cross);
  return {
    schemaVersion: SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    environment: { node: process.version, gpuUsed: false, dependencies: "node standard library only" },
    policy: {
      anchorStream: "runtimeSelfSchedulerPoll",
      historyStream: "referencePoll at or before anchor time",
      labelStream: "referencePoll interpolated at anchor time + fixed horizon",
      targetPolicy: "fixed horizons only; DWM next-vblank target not reconstructed",
      horizonsMs: HORIZONS_MS,
      historyMs: HISTORY_MS,
      zipSelection: args.zips ? "explicit --zips" : `newest ${args.zipLimit} cursor-mirror-trace ZIPs`,
      zipExpandedToDisk: false,
      perFrameCsvWritten: false,
      rawCsvCopyWritten: false,
      cacheWritten: false,
      checkpointWritten: false,
    },
    inputZips: zipPaths.map((filePath) => path.basename(filePath)),
    rowSummary: {
      totalRows: rows.length,
      sessions: sessionSummaries(traces, rows),
      nonEmptySessions: sessionSummaries(traces, rows).filter((s) => s.rowsBuilt > 0).length,
    },
    candidateModels: {
      baseline: BASELINE_MODEL,
      advanced: ADVANCED_MODELS,
    },
    crossSession: {
      splits: cross.map(cleanSplitResult),
      selectedAggregate: aggregate,
    },
    chronological: chronological ? cleanSplitResult(chronological) : null,
    recommendation: recommendation(aggregate, cross),
    elapsedSec,
  };
}

function cleanSplitResult(split) {
  return {
    id: split.id,
    trainSourceZip: split.trainSourceZip ?? null,
    validationSourceZip: split.validationSourceZip ?? null,
    testSourceZip: split.testSourceZip ?? null,
    rowCounts: { train: split.trainRows.length, validation: split.validationRows.length, test: split.testRows.length },
    selected: {
      gate: cleanGate(split.selected.gate),
      train: split.selected.train,
      validation: split.selected.validation,
      test: split.selected.test,
      validationRank: split.selected.rank,
    },
    topValidation: split.evaluated.slice(0, 12).map((item) => ({
      gate: cleanGate(item.gate),
      validation: item.validation,
      test: item.test,
      validationRank: item.rank,
    })),
  };
}

function cleanGate(gate) {
  return {
    id: gate.id,
    role: gate.role,
    family: gate.family,
    candidateId: gate.candidateId,
    params: gate.params ?? null,
  };
}

function recommendation(aggregate, cross) {
  const r = aggregate.regressionsVsBaseline;
  if (r.worseOver10px === 0 && r.worseOver5px === 0 && r.meanDeltaPx < 0) return "proceed_to_calibrator_with_real_gate_as_safety_anchor";
  if (r.worseOver10px === 0 && r.worseOver5px <= Math.max(2, Math.floor(r.count * 0.00005)) && r.meanDeltaPx < 0) {
    return "collect_more_real_trace_then_consider_calibrator_with_guardrails";
  }
  if (cross.every((split) => split.selected.gate.family === "baseline")) return "do_not_proceed_to_calibrator_yet_collect_more_real_trace_and_fix_generator";
  return "fix_synthetic_generator_and_collect_more_real_trace_before_calibrator";
}

function buildGapJson(args, generatedAt, realRows, synthetic) {
  const real = distributionSummaryFromRows(realRows);
  return {
    schemaVersion: GAP_SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    environment: { node: process.version, gpuUsed: false, dependencies: "node standard library only" },
    realPhase7: real,
    synthetic,
    findings: gapFindings(real, synthetic),
  };
}

function renderPhase8Md(data) {
  const sessionRows = data.rowSummary.sessions.map((s) => [
    s.sessionId,
    s.sourceZip,
    String(s.referencePollCount),
    String(s.anchorCount),
    String(s.rowsBuilt),
    s.qualityWarnings?.length ? s.qualityWarnings.join("<br>") : "none",
  ]);
  const splitRows = data.crossSession.splits.map((s) => [
    s.id,
    `${s.rowCounts.train}/${s.rowCounts.validation}/${s.rowCounts.test}`,
    s.selected.gate.id,
    s.selected.gate.family,
    s.selected.gate.candidateId || "-",
    fmt(s.selected.test.metrics.mean),
    fmt(s.selected.test.metrics.p95),
    fmt(s.selected.test.metrics.p99),
    `${s.selected.test.regressionsVsBaseline.worseOver5px}/${s.selected.test.regressionsVsBaseline.worseOver10px}`,
    fmt(s.selected.test.regressionsVsBaseline.meanDeltaPx),
    `${s.selected.test.gateUses.advanced}/${s.selected.test.gateUses.fallback}`,
  ]);
  const agg = data.crossSession.selectedAggregate;
  return `# Cursor Prediction v10 Phase 8 Real Gate

Generated: ${data.generatedAt}

Input ZIPs: ${data.inputZips.map((z) => `\`${z}\``).join(", ")}. GPU used: no. Dependencies: Node.js standard library only. ZIPs were read in place; no extraction, raw CSV copy, per-frame CSV, cache, checkpoint, or node_modules output was written.

## Sessions

${renderTable(["session", "zip", "reference polls", "anchors", "rows", "quality warnings"], sessionRows)}

## Cross-session Real Gate

${renderTable(["split", "train/val/test rows", "selected gate", "family", "candidate", "test mean", "test p95", "test p99", "test >5/>10", "test mean delta", "advanced/fallback"], splitRows)}

Selected aggregate: mean/p95/p99 ${fmt(agg.metrics.mean)} / ${fmt(agg.metrics.p95)} / ${fmt(agg.metrics.p99)} px; regressions >5/>10 ${agg.regressionsVsBaseline.worseOver5px}/${agg.regressionsVsBaseline.worseOver10px}; mean delta ${fmt(agg.regressionsVsBaseline.meanDeltaPx)} px; advanced/fallback ${agg.gateUses.advanced}/${agg.gateUses.fallback}.

## Chronological Split

${data.chronological ? renderChronological(data.chronological) : "Chronological split was not available."}

## Judgment

Recommendation: \`${data.recommendation}\`.
`;
}

function renderChronological(split) {
  const selected = split.selected;
  return `Rows train/validation/test: ${split.rowCounts.train}/${split.rowCounts.validation}/${split.rowCounts.test}. Selected \`${selected.gate.id}\` (${selected.gate.family}, candidate ${selected.gate.candidateId || "-"}) with test mean/p95/p99 ${fmt(selected.test.metrics.mean)} / ${fmt(selected.test.metrics.p95)} / ${fmt(selected.test.metrics.p99)} px, >5/>10 ${selected.test.regressionsVsBaseline.worseOver5px}/${selected.test.regressionsVsBaseline.worseOver10px}, mean delta ${fmt(selected.test.regressionsVsBaseline.meanDeltaPx)} px.`;
}

function renderGapMd(data) {
  const real = data.realPhase7;
  const phase4 = data.synthetic.recomputed?.phase4Test;
  const rows = [
    ["rows", String(real.rows), phase4 ? String(phase4.rows) : "-"],
    ["speed p50/p95", `${fmt(real.numeric.speed.p50)} / ${fmt(real.numeric.speed.p95)}`, phase4 ? `${fmt(phase4.numeric.speed.p50)} / ${fmt(phase4.numeric.speed.p95)}` : "-"],
    ["acceleration p50/p95", `${fmt(real.numeric.acceleration.p50)} / ${fmt(real.numeric.acceleration.p95)}`, phase4 ? `${fmt(phase4.numeric.acceleration.p50)} / ${fmt(phase4.numeric.acceleration.p95)}` : "-"],
    ["curvature p50/p95", `${fmt(real.numeric.curvature.p50)} / ${fmt(real.numeric.curvature.p95)}`, phase4 ? `${fmt(phase4.numeric.curvature.p50)} / ${fmt(phase4.numeric.curvature.p95)}` : "-"],
    ["history p50/p95", `${fmt(real.numeric.historyCount.p50)} / ${fmt(real.numeric.historyCount.p95)}`, phase4 ? `${fmt(phase4.numeric.historyCount.p50)} / ${fmt(phase4.numeric.historyCount.p95)}` : "-"],
    ["LS-vs-CV disagreement p50/p95", `${fmt(real.numeric.lsVsCvDisagreement.p50)} / ${fmt(real.numeric.lsVsCvDisagreement.p95)}`, phase4 ? `${fmt(phase4.numeric.lsVsCvDisagreement.p50)} / ${fmt(phase4.numeric.lsVsCvDisagreement.p95)}` : "-"],
  ];
  return `# Cursor Prediction v10 Phase 8 Synthetic/Real Gap

Generated: ${data.generatedAt}

## Distribution Snapshot

${renderTable(["feature", "real phase7", "synthetic phase4 test recompute"], rows)}

## Findings

${data.findings.map((item) => `- **${item.feature}**: ${item.finding}`).join("\n")}

## Why Phase4 Gates Failed on Real Trace

The phase4 strict/balanced thresholds were fitted against a synthetic mix with explicit missing-history scenarios, broad mid-speed coverage, and scripted high-curvature/high-acceleration segments. The two usable real traces are dense reference-poll sessions with no synthetic dropout label and a very different speed/disagreement mix. That means the synthetic risk score did not isolate real LS regressions: it advanced in regions where real raw LS still regressed, while falling back in many rows that synthetic considered risky for different reasons.
`;
}

function appendScores(outDir, phase8, gap) {
  const scoresPath = path.join(outDir, "scores.json");
  const scores = fs.existsSync(scoresPath) ? JSON.parse(fs.readFileSync(scoresPath, "utf8")) : {};
  scores.schemaVersion = scores.schemaVersion || SCORE_SCHEMA;
  scores.generatedAt = phase8.generatedAt;
  scores.phase8 = {
    canonicalDataset: "repo-root cursor-mirror-trace-*.zip",
    inputZips: phase8.inputZips,
    evaluatedRows: phase8.rowSummary.totalRows,
    environment: phase8.environment,
    policy: phase8.policy,
    crossSession: {
      splits: phase8.crossSession.splits.map((split) => ({
        id: split.id,
        rowCounts: split.rowCounts,
        selectedGate: split.selected.gate,
        test: split.selected.test,
      })),
      selectedAggregate: phase8.crossSession.selectedAggregate,
    },
    chronological: phase8.chronological ? {
      rowCounts: phase8.chronological.rowCounts,
      selectedGate: phase8.chronological.selected.gate,
      test: phase8.chronological.selected.test,
    } : null,
    syntheticRealGapFindings: gap.findings,
    recommendation: phase8.recommendation,
  };
  writeJson(scoresPath, scores);
}

function appendExperimentLog(outDir, phase8, gap) {
  const agg = phase8.crossSession.selectedAggregate;
  const block = `

## Phase 8 real gate (${phase8.generatedAt})

\`\`\`powershell
node poc\\cursor-prediction-v10\\scripts\\run-v10-phase8-real-gate.js --zip-limit ${phase8.inputZips.length}
\`\`\`

- input ZIPs: ${phase8.inputZips.map((z) => `\`${z}\``).join(", ")};
- rows: ${phase8.rowSummary.totalRows} from ${phase8.rowSummary.nonEmptySessions} nonempty / ${phase8.rowSummary.sessions.length} selected sessions;
- cross-session selected aggregate: mean/p95/p99 ${fmt(agg.metrics.mean)} / ${fmt(agg.metrics.p95)} / ${fmt(agg.metrics.p99)} px, >5/>10 ${agg.regressionsVsBaseline.worseOver5px}/${agg.regressionsVsBaseline.worseOver10px}, mean delta ${fmt(agg.regressionsVsBaseline.meanDeltaPx)} px, advanced ${agg.gateUses.advanced};
- selected gates: ${phase8.crossSession.splits.map((s) => `${s.id} => ${s.selected.gate.id}`).join("; ")};
- synthetic gap primary finding: ${gap.findings[0]?.finding || "n/a"};
- recommendation: \`${phase8.recommendation}\`;
- runtime: ${fmt(phase8.elapsedSec, 2)} seconds on CPU; no GPU, ZIP extraction, raw CSV copy, per-frame CSV, cache, checkpoint, or node_modules.
`;
  fs.appendFileSync(path.join(outDir, "experiment-log.md"), block, "utf8");
}

function renderTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(roundObject(data), null, 2)}\n`, "utf8");
}

function roundObject(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : value;
  if (Array.isArray(value)) return value.map(roundObject);
  if (value && typeof value === "object") {
    if (ArrayBuffer.isView(value)) return Array.from(value).map(roundObject);
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = roundObject(item);
    return out;
  }
  return value;
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return (Math.round(value * (10 ** digits)) / (10 ** digits)).toFixed(digits);
}

function fmtPct(value) {
  return `${fmt(value * 100, 2)}%`;
}

function rate(count, total) {
  return count / Math.max(1, total);
}

function idNum(value) {
  return String(value).replace("-", "m").replace(".", "p");
}

function main() {
  const started = Date.now();
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const phase7 = loadPhase7Runtime();
  const zipPaths = phase7.listTraceZips(args);
  if (zipPaths.length === 0) throw new Error("No cursor-mirror-trace-*.zip files found");
  const { traces, rows } = loadRows(phase7, zipPaths);
  const cross = crossSessionSplits(rows, traces).map((split) => ({ ...split, ...trainGates(split) }));
  const chronoBase = chronologicalSplit(rows, traces);
  const chronological = { ...chronoBase, ...trainGates(chronoBase) };
  const synthetic = syntheticDistribution(args);
  const gap = buildGapJson(args, generatedAt, rows, synthetic);
  const elapsedSec = (Date.now() - started) / 1000;
  const phase8 = buildPhase8Json(args, generatedAt, zipPaths, traces, rows, cross, chronological, elapsedSec);

  writeJson(path.join(args.outDir, "phase-8-real-gate.json"), phase8);
  fs.writeFileSync(path.join(args.outDir, "phase-8-real-gate.md"), renderPhase8Md(roundObject(phase8)), "utf8");
  writeJson(path.join(args.outDir, "phase-8-synthetic-real-gap.json"), gap);
  fs.writeFileSync(path.join(args.outDir, "phase-8-synthetic-real-gap.md"), renderGapMd(roundObject(gap)), "utf8");
  appendScores(args.outDir, roundObject(phase8), roundObject(gap));
  appendExperimentLog(args.outDir, roundObject(phase8), roundObject(gap));

  const agg = phase8.crossSession.selectedAggregate;
  process.stdout.write(`Input ZIPs: ${phase8.inputZips.join(", ")}\n`);
  process.stdout.write(`Rows: ${phase8.rowSummary.totalRows}\n`);
  for (const split of phase8.crossSession.splits) {
    const s = split.selected;
    process.stdout.write(`${split.id}: ${s.gate.id} ${s.gate.family}/${s.gate.candidateId || "-"} test mean=${fmt(s.test.metrics.mean)} >5/>10=${s.test.regressionsVsBaseline.worseOver5px}/${s.test.regressionsVsBaseline.worseOver10px} delta=${fmt(s.test.regressionsVsBaseline.meanDeltaPx)} adv=${s.test.gateUses.advanced}\n`);
  }
  process.stdout.write(`Cross-session aggregate: mean=${fmt(agg.metrics.mean)} >5/>10=${agg.regressionsVsBaseline.worseOver5px}/${agg.regressionsVsBaseline.worseOver10px} delta=${fmt(agg.regressionsVsBaseline.meanDeltaPx)} adv=${agg.gateUses.advanced}\n`);
  process.stdout.write(`Recommendation: ${phase8.recommendation}\n`);
  process.stdout.write(`Runtime sec: ${fmt(elapsedSec, 2)}\n`);
}

main();
