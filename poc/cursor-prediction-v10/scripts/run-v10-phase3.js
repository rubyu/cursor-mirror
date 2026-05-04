#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PHASE3_SCHEMA = "cursor-prediction-v10-phase3-learned-gates/1";
const BREAKDOWN_SCHEMA = "cursor-prediction-v10-phase3-test-breakdown/1";
const SCORE_SCHEMA = "cursor-prediction-v10-scores/1";

const HORIZONS_MS = [8.33, 16.67, 25, 33.33];
const MISSING_SCENARIOS = [
  { id: "clean", dropRate: 0 },
  { id: "missing_10pct", dropRate: 0.10 },
  { id: "missing_25pct", dropRate: 0.25 },
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
const TAGS = [
  "near_stop",
  "acute_acceleration",
  "edge_proximity",
  "missing_history",
  "jitter",
  "loop_or_reversal",
  "high_speed",
  "endpoint_stress",
  "smooth_reference",
];

const HISTOGRAM_BIN_PX = 0.05;
const HISTOGRAM_MAX_PX = 768;
const DEFAULT_ARGS = {
  input: null,
  outDir: null,
  seed: 33003,
  limitScripts: null,
  anchorsPerScript: 32,
  sampleIntervalMs: 8.33,
  historyMs: 200,
  trainSampleRows: 120000,
  monotonicTrials: 48,
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
    else if (arg === "--monotonic-trials") args.monotonicTrials = intArg(argv[++i], "monotonic-trials");
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v10\\scripts\\run-v10-phase3.js [--limit-scripts 1000]

Options:
  --input <path>              JSONL scripts. Default: runs/scripts.synthetic.phase2.jsonl
  --seed <n>                  deterministic script split and search seed
  --limit-scripts <n>         dry-run subset
  --train-sample-rows <n>     rows used for light gate learning
  --monotonic-trials <n>      deterministic random monotonic score configs
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.limitScripts !== null && args.limitScripts <= 0) throw new Error("--limit-scripts must be positive");
  if (args.trainSampleRows <= 0) throw new Error("--train-sample-rows must be positive");
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

function loadPhase2Runtime() {
  const phase2Path = path.join(__dirname, "run-v10-phase2.js");
  const source = fs.readFileSync(phase2Path, "utf8").replace(/\nmain\(\);\s*$/, "\n");
  const context = {
    require,
    console,
    process: { ...process, argv: ["node", phase2Path, "--help"] },
    __dirname,
    __filename: phase2Path,
  };
  vm.createContext(context);
  vm.runInContext(`${source}
globalThis.phase2 = {
  buildSamples,
  anchorTimes,
  historyFor,
  speedAt,
  sampleScript,
  rowFeatures,
  predict,
  dist,
  clamp,
};`, context, { filename: phase2Path });
  return context.phase2;
}

function candidateModels() {
  return [
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
      id: "blend_cv_ls_w50_cap24_ls0p5",
      family: "blend",
      params: {
        weightB: 0.5,
        a: { family: "constant_velocity_last2", params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 } },
        b: { family: "least_squares_window", params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 24 } },
      },
    },
    {
      id: "least_squares_w70_cap24",
      family: "least_squares_window",
      params: { windowMs: 70, horizonCapMs: 33.33, displacementCapPx: 24 },
    },
  ];
}

function baselineModel() {
  return {
    id: "constant_velocity_last2_cap24",
    family: "constant_velocity_last2",
    params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 },
  };
}

function readScripts(inputPath, limitScripts) {
  const text = fs.readFileSync(inputPath, "utf8");
  const scripts = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    scripts.push(JSON.parse(line));
    if (limitScripts !== null && scripts.length >= limitScripts) break;
  }
  return scripts;
}

function makeSplits(scriptCount, seed) {
  const indices = Array.from({ length: scriptCount }, (_, i) => i);
  const rng = mulberry32(seed);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  const trainCount = Math.floor(scriptCount * 0.70);
  const validationCount = Math.floor(scriptCount * 0.15);
  const splitByScript = new Array(scriptCount);
  for (let i = 0; i < indices.length; i += 1) {
    splitByScript[indices[i]] = i < trainCount ? "train" : i < trainCount + validationCount ? "validation" : "test";
  }
  return {
    splitByScript,
    counts: {
      train: trainCount,
      validation: validationCount,
      test: scriptCount - trainCount - validationCount,
    },
  };
}

function makeRowStore(capacity, candidateCount) {
  return {
    count: 0,
    capacity,
    observedSpeed: new Float64Array(capacity),
    acceleration: new Float64Array(capacity),
    curvature: new Float64Array(capacity),
    edgeDistance: new Float64Array(capacity),
    jitterProxy: new Float64Array(capacity),
    historyCount: new Float64Array(capacity),
    horizonMs: new Float64Array(capacity),
    horizonIndex: new Uint8Array(capacity),
    missingIndex: new Uint8Array(capacity),
    tagMask: new Uint16Array(capacity),
    speedBin: new Uint8Array(capacity),
    candidateErrors: Array.from({ length: candidateCount }, () => new Float64Array(capacity)),
    baselineError: new Float64Array(capacity),
  };
}

function addRow(store, features, horizonMs, horizonIndex, missingIndex, tagMask, speedBin, baselineError, candidateErrors) {
  const i = store.count;
  if (i >= store.capacity) throw new Error(`Row store capacity exceeded: ${store.capacity}`);
  store.observedSpeed[i] = features.observedSpeedPxPerSec;
  store.acceleration[i] = features.accelerationPxPerSec2;
  store.curvature[i] = features.curvatureDeg;
  store.edgeDistance[i] = features.edgeDistancePx;
  store.jitterProxy[i] = features.jitterProxyPx;
  store.historyCount[i] = features.historyCount;
  store.horizonMs[i] = horizonMs;
  store.horizonIndex[i] = horizonIndex;
  store.missingIndex[i] = missingIndex;
  store.tagMask[i] = tagMask;
  store.speedBin[i] = speedBin;
  store.baselineError[i] = baselineError;
  for (let c = 0; c < candidateErrors.length; c += 1) store.candidateErrors[c][i] = candidateErrors[c];
  store.count += 1;
}

function prepareRows(scripts, splits, args, phase2, models, base) {
  const maxRowsPerScript = args.anchorsPerScript * MISSING_SCENARIOS.length * HORIZONS_MS.length;
  const stores = {
    train: makeRowStore(splits.counts.train * maxRowsPerScript + 1024, models.length),
    validation: makeRowStore(splits.counts.validation * maxRowsPerScript + 1024, models.length),
    test: makeRowStore(splits.counts.test * maxRowsPerScript + 1024, models.length),
  };
  const rowSummary = {
    evaluatedRows: 0,
    rowsBySplit: { train: 0, validation: 0, test: 0 },
  };
  for (let scriptIndex = 0; scriptIndex < scripts.length; scriptIndex += 1) {
    const script = scripts[scriptIndex];
    const split = splits.splitByScript[scriptIndex];
    const store = stores[split];
    const samples = phase2.buildSamples(script, args.sampleIntervalMs);
    const anchors = phase2.anchorTimes(script, args.anchorsPerScript);
    const tagMask = tagsToMask(script.conditions?.tags || []);
    for (const anchorTime of anchors) {
      const trueSpeed = phase2.speedAt(script, anchorTime);
      for (let missingIndex = 0; missingIndex < MISSING_SCENARIOS.length; missingIndex += 1) {
        const scenario = MISSING_SCENARIOS[missingIndex];
        const history = phase2.historyFor(samples, script, anchorTime, scenario, args.historyMs);
        if (history.length === 0) continue;
        const features = phase2.rowFeatures(script, history, anchorTime, trueSpeed);
        features.jitterProxyPx = recentJitterProxy(history);
        const speedBinIndex = speedBinIndexOf(trueSpeed);
        for (let horizonIndex = 0; horizonIndex < HORIZONS_MS.length; horizonIndex += 1) {
          const horizonMs = HORIZONS_MS[horizonIndex];
          const target = phase2.sampleScript(script, anchorTime + horizonMs);
          const row = { history, target, horizonMs, missingScenario: scenario.id, features };
          const baselinePrediction = phase2.predict(row, base);
          const baselineError = phase2.dist(baselinePrediction.x, baselinePrediction.y, target.x, target.y);
          const errors = models.map((model) => {
            const prediction = phase2.predict(row, model);
            return phase2.dist(prediction.x, prediction.y, target.x, target.y);
          });
          addRow(store, features, horizonMs, horizonIndex, missingIndex, tagMask, speedBinIndex, baselineError, errors);
          rowSummary.evaluatedRows += 1;
          rowSummary.rowsBySplit[split] += 1;
        }
      }
    }
  }
  return { stores, rowSummary };
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
    const dx = p.x - x;
    const dy = p.y - y;
    sum += dx * dx + dy * dy;
    count += 1;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function tagsToMask(tags) {
  let mask = 0;
  for (const tag of tags) {
    const index = TAGS.indexOf(tag);
    if (index >= 0) mask |= 1 << index;
  }
  return mask;
}

function speedBinIndexOf(speed) {
  for (let i = 0; i < SPEED_BINS.length; i += 1) {
    const bin = SPEED_BINS[i];
    if (speed >= bin.min && speed < bin.max) return i;
  }
  return SPEED_BINS.length - 1;
}

function sampleIndices(store, maxRows) {
  const n = store.count;
  const m = Math.min(n, maxRows);
  const indices = new Uint32Array(m);
  if (m === n) {
    for (let i = 0; i < m; i += 1) indices[i] = i;
    return indices;
  }
  const step = n / m;
  for (let i = 0; i < m; i += 1) indices[i] = Math.min(n - 1, Math.floor((i + 0.5) * step));
  return indices;
}

const FEATURE_DEFS = [
  { id: "observedSpeed", thresholds: [25, 100, 250, 500, 1000, 1500, 2000, 2500, 3000, 4000] },
  { id: "acceleration", thresholds: [500, 1000, 2000, 4000, 6000, 8000, 12000, 20000, 40000] },
  { id: "curvature", thresholds: [2, 5, 10, 20, 30, 45, 60, 90, 135] },
  { id: "edgeDistance", thresholds: [4, 8, 12, 24, 48, 64, 128] },
  { id: "historyCount", thresholds: [3, 6, 8, 10, 13, 18, 24] },
  { id: "horizonMs", thresholds: [8.33, 16.67, 25] },
  { id: "missingIndex", thresholds: [0.5, 1.5] },
  { id: "jitterProxy", thresholds: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8] },
  ...TAGS.map((tag, tagIndex) => ({ id: `tag:${tag}`, tagIndex, thresholds: [0.5] })),
];

function trainAllGates(stores, models, args) {
  const trainStore = stores.train;
  const sample = sampleIndices(trainStore, args.trainSampleRows);
  const gates = [noAdoptionGate()];
  for (let candidateIndex = 0; candidateIndex < models.length; candidateIndex += 1) {
    const policies = [
      { id: "strict", maxLeafWorse10Rate: 0, maxLeafWorse5Rate: 0.001, reg5Penalty: 80, reg10Penalty: 4000, minLeafRows: Math.max(80, Math.floor(sample.length * 0.0025)) },
      { id: "balanced", maxLeafWorse10Rate: 0.0002, maxLeafWorse5Rate: 0.006, reg5Penalty: 20, reg10Penalty: 1200, minLeafRows: Math.max(120, Math.floor(sample.length * 0.0030)) },
      { id: "utility", maxLeafWorse10Rate: 0.0008, maxLeafWorse5Rate: 0.025, reg5Penalty: 6, reg10Penalty: 350, minLeafRows: Math.max(160, Math.floor(sample.length * 0.0040)) },
    ];
    for (const policy of policies) {
      for (const depth of [2, 3, 4, 5, 6]) {
        const tree = trainTreeGate(trainStore, sample, candidateIndex, depth, policy);
        gates.push({
          id: `tree_${policy.id}_d${depth}_${models[candidateIndex].id}`,
          family: "decision_tree",
          candidateIndex,
          candidateId: models[candidateIndex].id,
          depth,
          params: tree,
        });
      }
    }
    const scoreGates = trainMonotonicScoreGates(trainStore, sample, candidateIndex, models[candidateIndex].id, args);
    gates.push(...scoreGates);
  }
  return gates;
}

function noAdoptionGate() {
  return {
    id: "no_adoption_baseline_only",
    family: "none",
    candidateIndex: null,
    candidateId: null,
    params: { rule: "always use fallback baseline" },
  };
}

function trainTreeGate(store, indices, candidateIndex, maxDepth, policy) {
  const root = buildTreeNode(store, indices, candidateIndex, 0, maxDepth, policy);
  return {
    maxDepth,
    policy,
    root,
  };
}

function buildTreeNode(store, indices, candidateIndex, depth, maxDepth, policy) {
  const leaf = leafDecision(store, indices, candidateIndex, policy);
  if (depth >= maxDepth || indices.length < policy.minLeafRows * 2) return leaf;
  const parentCost = leaf.cost;
  let best = null;
  for (const feature of FEATURE_DEFS) {
    for (const threshold of feature.thresholds) {
      const stats = splitStats(store, indices, candidateIndex, feature, threshold, policy);
      if (stats.leftCount < policy.minLeafRows || stats.rightCount < policy.minLeafRows) continue;
      const cost = stats.leftCost + stats.rightCost;
      if (!best || cost < best.cost) best = { feature, threshold, cost, stats };
    }
  }
  if (!best || best.cost >= parentCost - Math.max(1, indices.length * 0.0005)) return leaf;
  const left = [];
  const right = [];
  for (let i = 0; i < indices.length; i += 1) {
    const row = indices[i];
    if (featureValue(store, row, best.feature) <= best.threshold) left.push(row);
    else right.push(row);
  }
  return {
    type: "split",
    feature: best.feature.id,
    tagIndex: best.feature.tagIndex ?? null,
    threshold: best.threshold,
    left: buildTreeNode(store, Uint32Array.from(left), candidateIndex, depth + 1, maxDepth, policy),
    right: buildTreeNode(store, Uint32Array.from(right), candidateIndex, depth + 1, maxDepth, policy),
  };
}

function splitStats(store, indices, candidateIndex, feature, threshold, policy) {
  const left = emptyCostStats();
  const right = emptyCostStats();
  for (let i = 0; i < indices.length; i += 1) {
    const row = indices[i];
    addCostStats(featureValue(store, row, feature) <= threshold ? left : right, store, row, candidateIndex);
  }
  return {
    leftCount: left.count,
    rightCount: right.count,
    leftCost: leafCost(left, policy),
    rightCost: leafCost(right, policy),
  };
}

function leafDecision(store, indices, candidateIndex, policy) {
  const stats = emptyCostStats();
  for (let i = 0; i < indices.length; i += 1) addCostStats(stats, store, indices[i], candidateIndex);
  const cost = leafCost(stats, policy);
  return {
    type: "leaf",
    useAdvanced: cost < 0,
    rows: stats.count,
    worseOver5px: stats.worseOver5px,
    worseOver10px: stats.worseOver10px,
    meanDeltaPx: stats.sumDelta / Math.max(1, stats.count),
    cost,
  };
}

function emptyCostStats() {
  return { count: 0, sumDelta: 0, worseOver1px: 0, worseOver3px: 0, worseOver5px: 0, worseOver10px: 0 };
}

function addCostStats(stats, store, row, candidateIndex) {
  const delta = store.candidateErrors[candidateIndex][row] - store.baselineError[row];
  stats.count += 1;
  stats.sumDelta += delta;
  if (delta > 1) stats.worseOver1px += 1;
  if (delta > 3) stats.worseOver3px += 1;
  if (delta > 5) stats.worseOver5px += 1;
  if (delta > 10) stats.worseOver10px += 1;
}

function leafCost(stats, policy) {
  if (stats.count === 0) return 0;
  if (stats.worseOver10px / stats.count > policy.maxLeafWorse10Rate) return 0;
  if (stats.worseOver5px / stats.count > policy.maxLeafWorse5Rate) return 0;
  const cost = stats.sumDelta
    + stats.worseOver3px * 1.5
    + stats.worseOver5px * policy.reg5Penalty
    + stats.worseOver10px * policy.reg10Penalty;
  if (cost >= -stats.count * 0.02) return 0;
  return cost;
}

function trainMonotonicScoreGates(store, sample, candidateIndex, candidateId, args) {
  const rng = mulberry32(args.seed ^ ((candidateIndex + 1) * 0x9e3779b9));
  const configs = [
    monotonicWeights({ accel: 1.2, curvature: 1.0, lowSpeed: 0.8, highSpeed: 0.2, edge: 0.7, history: 0.5, jitter: 1.0, missing25: 0.9, tagJitter: 0.8 }),
    monotonicWeights({ accel: 1.8, curvature: 1.2, lowSpeed: 0.5, highSpeed: 0.1, edge: 0.4, history: 0.8, jitter: 1.4, missing25: 1.2, tagJitter: 1.1 }),
    monotonicWeights({ accel: 0.8, curvature: 1.8, lowSpeed: 1.2, highSpeed: 0.4, edge: 0.9, history: 0.3, jitter: 0.7, missing25: 0.8, tagJitter: 0.5 }),
  ];
  for (let i = 0; i < args.monotonicTrials; i += 1) {
    configs.push(monotonicWeights({
      accel: 0.3 + rng() * 2.2,
      curvature: 0.3 + rng() * 2.2,
      lowSpeed: rng() * 1.8,
      highSpeed: rng() * 1.0,
      edge: rng() * 1.4,
      history: rng() * 1.4,
      jitter: rng() * 1.8,
      missing25: rng() * 1.8,
      tagJitter: rng() * 1.6,
    }));
  }
  const best = [];
  for (let c = 0; c < configs.length; c += 1) {
    const weights = configs[c];
    const thresholds = scoreThresholds(store, sample, weights);
    for (const threshold of thresholds) {
      const gate = {
        id: `score_${candidateId}_c${c}_t${idNum(threshold)}`,
        family: "monotonic_score",
        candidateIndex,
        candidateId,
        params: { weights, threshold },
      };
      const metric = evaluateGateOnIndices(store, sample, gate);
      best.push({ gate, metric, rank: gateRank(metric) });
    }
  }
  best.sort((a, b) => a.rank - b.rank);
  return best.slice(0, 10).map((x, i) => ({ ...x.gate, id: `score_${candidateId}_${i + 1}` }));
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

function scoreThresholds(store, sample, weights) {
  const scores = new Array(sample.length);
  for (let i = 0; i < sample.length; i += 1) {
    const score = monotonicScore(store, sample[i], weights);
    scores[i] = score;
  }
  scores.sort((a, b) => a - b);
  return [0.01, 0.02, 0.04, 0.06, 0.08, 0.10, 0.14, 0.18, 0.22, 0.28, 0.34, 0.42, 0.50, 0.62, 0.74]
    .map((q) => scores[Math.min(scores.length - 1, Math.max(0, Math.floor(q * (scores.length - 1))))]);
}

function evaluateGateOnIndices(store, indices, gate) {
  const acc = metricAccumulator();
  const reg = regressionAccumulator();
  let advanced = 0;
  let fallback = 0;
  for (let i = 0; i < indices.length; i += 1) {
    const row = indices[i];
    const useAdvanced = passesGate(store, row, gate);
    if (useAdvanced) advanced += 1;
    else fallback += 1;
    const error = useAdvanced ? store.candidateErrors[gate.candidateIndex][row] : store.baselineError[row];
    addMetric(acc, error);
    addRegression(reg, error - store.baselineError[row]);
  }
  return { metrics: finalizeMetric(acc), regressionsVsBaseline: finalizeRegression(reg), gateUses: { advanced, fallback } };
}

function evaluateGate(store, gate) {
  const acc = metricAccumulator();
  const reg = regressionAccumulator();
  let advanced = 0;
  let fallback = 0;
  for (let row = 0; row < store.count; row += 1) {
    const useAdvanced = passesGate(store, row, gate);
    if (useAdvanced) advanced += 1;
    else fallback += 1;
    const error = useAdvanced ? store.candidateErrors[gate.candidateIndex][row] : store.baselineError[row];
    addMetric(acc, error);
    addRegression(reg, error - store.baselineError[row]);
  }
  return { metrics: finalizeMetric(acc), regressionsVsBaseline: finalizeRegression(reg), gateUses: { advanced, fallback } };
}

function evaluateBaseline(store) {
  const acc = metricAccumulator();
  const reg = regressionAccumulator();
  for (let row = 0; row < store.count; row += 1) {
    addMetric(acc, store.baselineError[row]);
    addRegression(reg, 0);
  }
  return { metrics: finalizeMetric(acc), regressionsVsBaseline: finalizeRegression(reg), gateUses: { advanced: 0, fallback: store.count } };
}

function passesGate(store, row, gate) {
  if (gate.family === "none") return false;
  if (gate.family === "monotonic_score") return monotonicScore(store, row, gate.params.weights) <= gate.params.threshold;
  if (gate.family === "decision_tree") return passesTree(store, row, gate.params.root);
  if (gate.family === "phase2_fixed_safe_gate") return passesPhase2SafeGate(store, row);
  throw new Error(`Unknown gate family: ${gate.family}`);
}

function passesTree(store, row, node) {
  if (node.type === "leaf") return node.useAdvanced;
  const feature = node.feature.startsWith("tag:")
    ? { id: node.feature, tagIndex: node.tagIndex }
    : { id: node.feature };
  return featureValue(store, row, feature) <= node.threshold
    ? passesTree(store, row, node.left)
    : passesTree(store, row, node.right);
}

function passesPhase2SafeGate(store, row) {
  return store.historyCount[row] >= 8
    && store.missingIndex[row] !== 2
    && store.edgeDistance[row] >= 12
    && store.acceleration[row] <= 8000
    && store.curvature[row] <= 60
    && store.observedSpeed[row] <= 3000;
}

function monotonicScore(store, row, weights) {
  let score = weights.intercept;
  score += weights.lowSpeed * Math.max(0, (350 - store.observedSpeed[row]) / 350);
  score += weights.highSpeed * Math.max(0, (store.observedSpeed[row] - 3000) / 1200);
  score += weights.acceleration * Math.log1p(store.acceleration[row] / 8000);
  score += weights.curvature * (store.curvature[row] / 90);
  score += weights.edgeNear * Math.max(0, (64 - store.edgeDistance[row]) / 64);
  score += weights.sparseHistory * Math.max(0, (13 - store.historyCount[row]) / 13);
  score += weights.jitterProxy * Math.log1p(store.jitterProxy[row]);
  score += weights.horizon * (store.horizonMs[row] / 33.33);
  if (store.missingIndex[row] === 1) score += weights.missing10;
  if (store.missingIndex[row] === 2) score += weights.missing25;
  const mask = store.tagMask[row];
  for (const [tag, weight] of Object.entries(weights.tagWeights)) {
    const index = TAGS.indexOf(tag);
    if (index >= 0 && (mask & (1 << index))) score += weight;
  }
  return score;
}

function featureValue(store, row, feature) {
  if (feature.id === "observedSpeed") return store.observedSpeed[row];
  if (feature.id === "acceleration") return store.acceleration[row];
  if (feature.id === "curvature") return store.curvature[row];
  if (feature.id === "edgeDistance") return store.edgeDistance[row];
  if (feature.id === "historyCount") return store.historyCount[row];
  if (feature.id === "horizonMs") return store.horizonMs[row];
  if (feature.id === "missingIndex") return store.missingIndex[row];
  if (feature.id === "jitterProxy") return store.jitterProxy[row];
  if (feature.id.startsWith("tag:")) return (store.tagMask[row] & (1 << feature.tagIndex)) ? 1 : 0;
  throw new Error(`Unknown feature: ${feature.id}`);
}

function selectAndEvaluateGates(stores, gates, models) {
  const validation = [];
  for (const gate of gates) {
    const result = gate.family === "none" ? evaluateBaseline(stores.validation) : evaluateGate(stores.validation, gate);
    validation.push({ gate, validation: result, rank: gateRank(result) });
  }
  validation.sort((a, b) => a.rank - b.rank);
  const objectiveSorted = [...validation].sort((a, b) => objectiveScore(a.validation) - objectiveScore(b.validation));
  const zeroTenSorted = validation.filter((x) => x.validation.regressionsVsBaseline.worseOver10px === 0)
    .sort((a, b) => objectiveScore(a.validation) - objectiveScore(b.validation));
  const requiredTreeRows = validation.filter((x) => x.gate.family === "decision_tree" && x.gate.depth >= 2 && x.gate.depth <= 5);
  const shortlist = uniqueGates([
    noAdoptionGate(),
    ...validation.slice(0, 24).map((x) => x.gate),
    ...zeroTenSorted.slice(0, 16).map((x) => x.gate),
    ...objectiveSorted.slice(0, 16).map((x) => x.gate),
    ...requiredTreeRows.map((x) => x.gate),
  ]);
  const phase2Gate = {
    id: "phase2_safe_gate_blend_cv_ls_w50_cap24_ls0p5_g3",
    family: "phase2_fixed_safe_gate",
    candidateIndex: models.findIndex((m) => m.id === "blend_cv_ls_w50_cap24_ls0p5"),
    candidateId: "blend_cv_ls_w50_cap24_ls0p5",
    params: { copiedFrom: "safe_gate_blend_cv_ls_w50_cap24_ls0p5_g3" },
  };
  shortlist.push(phase2Gate);
  const rows = [];
  for (const gate of shortlist) {
    rows.push({
      gate,
      train: gate.family === "none" ? evaluateBaseline(stores.train) : evaluateGate(stores.train, gate),
      validation: gate.family === "none" ? evaluateBaseline(stores.validation) : evaluateGate(stores.validation, gate),
      test: gate.family === "none" ? evaluateBaseline(stores.test) : evaluateGate(stores.test, gate),
    });
  }
  rows.sort((a, b) => gateRank(a.validation) - gateRank(b.validation));
  return { selected: rows[0], evaluated: rows };
}

function uniqueGates(gates) {
  const seen = new Set();
  const out = [];
  for (const gate of gates) {
    if (seen.has(gate.id)) continue;
    seen.add(gate.id);
    out.push(gate);
  }
  return out;
}

function gateRank(result) {
  const r = result.regressionsVsBaseline;
  const objective = objectiveScore(result);
  const constraintPenalty = r.worseOver10px > 0 ? 1e12 + r.worseOver10px * 1e8 : 0;
  const fivePenalty = r.worseOver5px > 100 ? 1e9 + r.worseOver5px * 1e5 : r.worseOver5px * 1000;
  return constraintPenalty + fivePenalty + objective;
}

function objectiveScore(result) {
  const m = result.metrics;
  const r = result.regressionsVsBaseline;
  return m.mean + 0.40 * m.p95 + 0.30 * m.p99
    + 10000 * r.worseOver10px / Math.max(1, r.count)
    + 600 * r.worseOver5px / Math.max(1, r.count)
    + Math.max(0, r.meanDeltaPx) * 50;
}

function testBreakdown(store, gate) {
  const dimensions = {
    speed: Object.fromEntries(SPEED_BINS.map((b) => [b.id, makeBreakdownBucket()])),
    horizon: Object.fromEntries(HORIZONS_MS.map((h) => [String(h), makeBreakdownBucket()])),
    missingScenario: Object.fromEntries(MISSING_SCENARIOS.map((s) => [s.id, makeBreakdownBucket()])),
    tag: Object.fromEntries(TAGS.map((tag) => [tag, makeBreakdownBucket()])),
  };
  for (let row = 0; row < store.count; row += 1) {
    const useAdvanced = passesGate(store, row, gate);
    const error = useAdvanced ? store.candidateErrors[gate.candidateIndex][row] : store.baselineError[row];
    const delta = error - store.baselineError[row];
    addBreakdown(dimensions.speed[SPEED_BINS[store.speedBin[row]].id], error, delta, useAdvanced);
    addBreakdown(dimensions.horizon[String(store.horizonMs[row])], error, delta, useAdvanced);
    addBreakdown(dimensions.missingScenario[MISSING_SCENARIOS[store.missingIndex[row]].id], error, delta, useAdvanced);
    const mask = store.tagMask[row];
    for (let tagIndex = 0; tagIndex < TAGS.length; tagIndex += 1) {
      if (mask & (1 << tagIndex)) addBreakdown(dimensions.tag[TAGS[tagIndex]], error, delta, useAdvanced);
    }
  }
  return finalizeBreakdown(dimensions);
}

function makeBreakdownBucket() {
  return { metric: metricAccumulator(), reg: regressionAccumulator(), gateUses: { advanced: 0, fallback: 0 } };
}

function addBreakdown(bucket, error, delta, useAdvanced) {
  addMetric(bucket.metric, error);
  addRegression(bucket.reg, delta);
  if (useAdvanced) bucket.gateUses.advanced += 1;
  else bucket.gateUses.fallback += 1;
}

function finalizeBreakdown(dimensions) {
  const out = {};
  for (const [dimension, buckets] of Object.entries(dimensions)) {
    out[dimension] = {};
    for (const [bucket, value] of Object.entries(buckets)) {
      out[dimension][bucket] = {
        metrics: finalizeMetric(value.metric),
        regressionsVsBaseline: finalizeRegression(value.reg),
        gateUses: value.gateUses,
      };
    }
  }
  return out;
}

function metricAccumulator() {
  return {
    count: 0,
    sum: 0,
    sumSq: 0,
    max: 0,
    hist: new Uint32Array(Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 2),
  };
}

function addMetric(acc, value) {
  if (!Number.isFinite(value)) return;
  acc.count += 1;
  acc.sum += value;
  acc.sumSq += value * value;
  if (value > acc.max) acc.max = value;
  const idx = Math.min(acc.hist.length - 1, Math.max(0, Math.floor(value / HISTOGRAM_BIN_PX)));
  acc.hist[idx] += 1;
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

function buildLearnedGatesJson(args, generatedAt, scripts, splitCounts, rowSummary, models, learned, elapsedSec) {
  const selected = learned.selected;
  return {
    schemaVersion: PHASE3_SCHEMA,
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
    learningPolicy: {
      trainSampleRows: args.trainSampleRows,
      objective: "mean + 0.40*p95 + 0.30*p99 + strong regression penalty",
      primaryConstraint: "test >10px regression should be 0; >5px target <=100 when possible",
      perFrameCsvWritten: false,
    },
    baselineId: baselineModel().id,
    candidatePredictors: models,
    selected: summarizeEvaluatedGate(selected),
    gates: learned.evaluated.map(summarizeEvaluatedGate),
    elapsedSec,
  };
}

function summarizeEvaluatedGate(row) {
  return {
    id: row.gate.id,
    family: row.gate.family,
    candidateId: row.gate.candidateId,
    params: row.gate.params,
    objective: {
      train: objectiveScore(row.train),
      validation: objectiveScore(row.validation),
      test: objectiveScore(row.test),
    },
    train: row.train,
    validation: row.validation,
    test: row.test,
  };
}

function renderLearnedGatesMd(data) {
  const rows = data.gates.slice(0, 12).map((g) => [
    g.id,
    g.family,
    g.candidateId || "baseline",
    fmt(g.validation.metrics.mean),
    fmt(g.validation.metrics.p95),
    fmt(g.validation.metrics.p99),
    String(g.validation.regressionsVsBaseline.worseOver5px),
    String(g.validation.regressionsVsBaseline.worseOver10px),
    fmt(g.test.metrics.mean),
    fmt(g.test.metrics.p95),
    fmt(g.test.metrics.p99),
    String(g.test.regressionsVsBaseline.worseOver5px),
    String(g.test.regressionsVsBaseline.worseOver10px),
  ]);
  const best = data.selected;
  const phase2 = data.gates.find((g) => g.id === "phase2_safe_gate_blend_cv_ls_w50_cap24_ls0p5_g3");
  const treeRows = data.gates
    .filter((g) => g.family === "decision_tree" && /^tree_.*_d[2-5]_/.test(g.id))
    .map((g) => [
      g.id,
      g.candidateId,
      fmt(g.validation.metrics.mean),
      fmt(g.validation.metrics.p95),
      fmt(g.validation.metrics.p99),
      String(g.validation.regressionsVsBaseline.worseOver5px),
      String(g.validation.regressionsVsBaseline.worseOver10px),
      fmt(g.test.metrics.mean),
      fmt(g.test.metrics.p95),
      fmt(g.test.metrics.p99),
      String(g.test.regressionsVsBaseline.worseOver5px),
      String(g.test.regressionsVsBaseline.worseOver10px),
      `${g.test.gateUses.advanced}/${g.test.gateUses.fallback}`,
    ]);
  const comparison = phase2
    ? `Phase2 fixed safe gate on the same test split: mean/p95/p99/max ${fmt(phase2.test.metrics.mean)} / ${fmt(phase2.test.metrics.p95)} / ${fmt(phase2.test.metrics.p99)} / ${fmt(phase2.test.metrics.max)} px, >5px ${phase2.test.regressionsVsBaseline.worseOver5px}, >10px ${phase2.test.regressionsVsBaseline.worseOver10px}.`
    : "Phase2 fixed safe gate was not evaluated.";
  return `# Cursor Prediction v10 Phase 3 Learned Gates

Generated: ${data.generatedAt}

Canonical input: \`${data.canonicalInput}\`. GPU used: no. Dependencies: Node.js standard library only. No per-frame CSV, raw ZIP, cache, checkpoint, or node_modules output was written.

## Split

| split | scripts | rows |
| --- | ---: | ---: |
| train | ${data.splitPolicy.train} | ${data.rowSummary.rowsBySplit.train} |
| validation | ${data.splitPolicy.validation} | ${data.rowSummary.rowsBySplit.validation} |
| test | ${data.splitPolicy.test} | ${data.rowSummary.rowsBySplit.test} |

## Best Gate

Selected gate: \`${best.id}\` (${best.family}) using \`${best.candidateId || data.baselineId}\`.

Test metrics: mean/p95/p99/max ${fmt(best.test.metrics.mean)} / ${fmt(best.test.metrics.p95)} / ${fmt(best.test.metrics.p99)} / ${fmt(best.test.metrics.max)} px. Regressions: >5px ${best.test.regressionsVsBaseline.worseOver5px}, >10px ${best.test.regressionsVsBaseline.worseOver10px}. Gate use: ${best.test.gateUses.advanced} advanced / ${best.test.gateUses.fallback} fallback.

${comparison}

## Top Validation Gates

${renderTable(["gate", "family", "candidate", "val mean", "val p95", "val p99", "val >5", "val >10", "test mean", "test p95", "test p99", "test >5", "test >10"], rows)}

## Decision Tree Depth 2-5

${renderTable(["tree", "candidate", "val mean", "val p95", "val p99", "val >5", "val >10", "test mean", "test p95", "test p99", "test >5", "test >10", "test advanced/fallback"], treeRows)}

## Judgment

The selected model is kept only if it beats the explicit \`no_adoption_baseline_only\` option under the validation constraint ranking. If the selected row is baseline-only, phase 3 found no learned gate worth porting.
`;
}

function buildBreakdownJson(args, generatedAt, learned, breakdown) {
  return {
    schemaVersion: BREAKDOWN_SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    selectedGateId: learned.selected.gate.id,
    selectedFamily: learned.selected.gate.family,
    selectedCandidateId: learned.selected.gate.candidateId,
    test: learned.selected.test,
    breakdown,
  };
}

function renderBreakdownMd(data) {
  const rows = [];
  for (const [dimension, buckets] of Object.entries(data.breakdown)) {
    for (const [bucket, value] of Object.entries(buckets)) {
      if (value.metrics.count === 0) continue;
      rows.push([
        dimension,
        bucket,
        String(value.metrics.count),
        fmt(value.metrics.mean),
        fmt(value.metrics.p95),
        fmt(value.metrics.p99),
        String(value.regressionsVsBaseline.worseOver5px),
        String(value.regressionsVsBaseline.worseOver10px),
        `${value.gateUses.advanced}/${value.gateUses.fallback}`,
      ]);
    }
  }
  return `# Cursor Prediction v10 Phase 3 Test Breakdown

Generated: ${data.generatedAt}

Selected gate: \`${data.selectedGateId}\` (${data.selectedFamily}) using \`${data.selectedCandidateId || "baseline"}\`.

Overall test metrics: mean/p95/p99/max ${fmt(data.test.metrics.mean)} / ${fmt(data.test.metrics.p95)} / ${fmt(data.test.metrics.p99)} / ${fmt(data.test.metrics.max)} px. Regressions: >5px ${data.test.regressionsVsBaseline.worseOver5px}, >10px ${data.test.regressionsVsBaseline.worseOver10px}.

${renderTable(["dimension", "bucket", "rows", "mean", "p95", "p99", ">5px reg", ">10px reg", "advanced/fallback"], rows)}
`;
}

function appendScores(outDir, phase3) {
  const scoresPath = path.join(outDir, "scores.json");
  let scores = {};
  if (fs.existsSync(scoresPath)) scores = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
  scores.schemaVersion = scores.schemaVersion || SCORE_SCHEMA;
  scores.generatedAt = phase3.generatedAt;
  scores.phase3 = {
    scriptCount: phase3.scriptCount,
    evaluatedRows: phase3.rowSummary.evaluatedRows,
    gpuUsed: false,
    canonicalDataset: phase3.canonicalInput,
    perFrameCsvWritten: false,
    splitPolicy: phase3.splitPolicy,
    trainSampleRows: phase3.learningPolicy.trainSampleRows,
    bestLearnedGate: phase3.selected,
    phase2Comparison: phase3.gates.find((g) => g.id === "phase2_safe_gate_blend_cv_ls_w50_cap24_ls0p5_g3") || null,
  };
  writeJson(scoresPath, scores);
}

function appendExperimentLog(outDir, generatedAt, args, phase3, elapsedSec) {
  const best = phase3.selected;
  const phase2 = phase3.gates.find((g) => g.id === "phase2_safe_gate_blend_cv_ls_w50_cap24_ls0p5_g3");
  const text = `
## ${jstStamp(generatedAt)} - Phase 3 Learned Gates

Environment:

- Node.js: \`${process.version}\`
- GPU used: no
- Dependency install: none

Command:

\`\`\`powershell
node poc\\cursor-prediction-v10\\scripts\\run-v10-phase3.js${args.limitScripts ? ` --limit-scripts ${args.limitScripts}` : ""}
\`\`\`

Result:

- read ${phase3.scriptCount} scripts from \`${phase3.canonicalInput}\`;
- split by script: train ${phase3.splitPolicy.train}, validation ${phase3.splitPolicy.validation}, test ${phase3.splitPolicy.test};
- evaluated ${phase3.rowSummary.evaluatedRows} rows without writing per-frame CSV or feature files;
- selected \`${best.id}\` (${best.family}) with \`${best.candidateId || phase3.baselineId}\`;
- test p95/p99/max ${fmt(best.test.metrics.p95)} / ${fmt(best.test.metrics.p99)} / ${fmt(best.test.metrics.max)} px;
- test regressions >5px ${best.test.regressionsVsBaseline.worseOver5px}, >10px ${best.test.regressionsVsBaseline.worseOver10px};
${phase2 ? `- phase2 fixed safe gate on test: p95/p99/max ${fmt(phase2.test.metrics.p95)} / ${fmt(phase2.test.metrics.p99)} / ${fmt(phase2.test.metrics.max)} px, >5px ${phase2.test.regressionsVsBaseline.worseOver5px}, >10px ${phase2.test.regressionsVsBaseline.worseOver10px};` : ""}
- runtime: ${fmt(elapsedSec, 2)} seconds on CPU.

Judgment:

- The learned gate search kept \`no_adoption_baseline_only\` in the candidate set, so any selected learned gate must beat baseline-only under validation constraints.
- If test >10px regressions remain non-zero or >5px regressions stay materially above 100, the next phase should prioritize data/evaluation design before adding a heavier teacher.
`;
  fs.appendFileSync(path.join(outDir, "experiment-log.md"), text, "utf8");
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
    for (const [key, item] of Object.entries(value)) out[key] = roundObject(item);
    return out;
  }
  return value;
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined) return "n/a";
  return (Math.round(value * (10 ** digits)) / (10 ** digits)).toFixed(digits);
}

function idNum(value) {
  return String(Math.round(value * 1000) / 1000).replace("-", "m").replace(".", "p");
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

  const phase2 = loadPhase2Runtime();
  const scripts = readScripts(args.input, args.limitScripts);
  const splits = makeSplits(scripts.length, args.seed);
  const models = candidateModels();
  const base = baselineModel();
  const prepared = prepareRows(scripts, splits, args, phase2, models, base);
  const gates = trainAllGates(prepared.stores, models, args);
  const learned = selectAndEvaluateGates(prepared.stores, gates, models);
  const breakdown = testBreakdown(prepared.stores.test, learned.selected.gate);
  const elapsedSec = (Date.now() - started) / 1000;

  const phase3 = buildLearnedGatesJson(args, generatedAt, scripts, splits.counts, prepared.rowSummary, models, learned, elapsedSec);
  const breakdownJson = buildBreakdownJson(args, generatedAt, learned, breakdown);
  writeJson(path.join(args.outDir, "phase-3-learned-gates.json"), phase3);
  writeJson(path.join(args.outDir, "phase-3-test-breakdown.json"), breakdownJson);
  fs.writeFileSync(path.join(args.outDir, "phase-3-learned-gates.md"), renderLearnedGatesMd(roundObject(phase3)), "utf8");
  fs.writeFileSync(path.join(args.outDir, "phase-3-test-breakdown.md"), renderBreakdownMd(roundObject(breakdownJson)), "utf8");
  appendScores(args.outDir, roundObject(phase3));
  appendExperimentLog(args.outDir, generatedAt, args, roundObject(phase3), elapsedSec);

  process.stdout.write(`Read scripts: ${scripts.length}\n`);
  process.stdout.write(`Evaluated rows: ${prepared.rowSummary.evaluatedRows}\n`);
  process.stdout.write(`Split rows train/validation/test: ${prepared.rowSummary.rowsBySplit.train}/${prepared.rowSummary.rowsBySplit.validation}/${prepared.rowSummary.rowsBySplit.test}\n`);
  process.stdout.write(`Selected gate: ${phase3.selected.id} (${phase3.selected.family}) candidate=${phase3.selected.candidateId || phase3.baselineId}\n`);
  process.stdout.write(`Test mean/p95/p99/max: ${fmt(phase3.selected.test.metrics.mean)} / ${fmt(phase3.selected.test.metrics.p95)} / ${fmt(phase3.selected.test.metrics.p99)} / ${fmt(phase3.selected.test.metrics.max)}\n`);
  process.stdout.write(`Test regressions >5px/>10px: ${phase3.selected.test.regressionsVsBaseline.worseOver5px}/${phase3.selected.test.regressionsVsBaseline.worseOver10px}\n`);
  process.stdout.write(`Runtime sec: ${fmt(elapsedSec, 2)}\n`);
}

main();
