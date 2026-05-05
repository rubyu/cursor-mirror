#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCHEMA_VERSION = "cursor-prediction-v11-step7-oracle-observability-ceiling/1";
const HORIZONS_MS = [0, 8, 16.67, 25, 33.33, 50];
const BASE_MODEL_IDS = [
  "ls12_baseline",
  "step3_teacher_ridge_residual_segmented_horizon",
  "step4_vfsmn_small_velocity",
  "step5_guarded_selected",
  "step6_timing_gain_1p15",
];
const FEATURE_NAMES = [
  "horizon",
  "anchorGap",
  "schedulerDelay",
  "historyMaxGap",
  "historyGapStd",
  "recentSpeed",
  "ls12Speed",
  "ls8Speed",
  "last2Speed",
  "acceleration",
  "stillness",
  "nearZero",
  "pathEfficiency",
  "projectionDisagreement",
  "speedSpread",
];
const FEATURE_INDEX = Object.fromEntries(FEATURE_NAMES.map((name, index) => [name, index]));
const SAMPLE_CAPS = {
  trainSelector: 90000,
  validationSelector: 30000,
  ambiguityTrain: 9000,
  ambiguityValidation: 5000,
  ambiguityResumeValidation: 2500,
};

const PACKAGES = [
  { id: "normal", label: "normal load", file: "cursor-mirror-motion-recording-20260503-212556.zip" },
  { id: "stress", label: "stress load", file: "cursor-mirror-motion-recording-20260503-215632.zip" },
];

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  return {
    root,
    outDir: path.resolve(scriptDir, "..", "step-7-oracle-observability-ceiling"),
    step1Scores: path.resolve(scriptDir, "..", "step-1-data-audit", "scores.json"),
    step3Script: path.resolve(scriptDir, "run-step3-learned-gates.js"),
    step4Script: path.resolve(scriptDir, "run-step4-fsmn-family-search.js"),
    step6Script: path.resolve(scriptDir, "run-step6-timing-alignment-search.js"),
    args: argv.slice(2),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadStep6Library(step6Script) {
  let source = fs.readFileSync(step6Script, "utf8");
  source = source.replace(/\nmain\(\);\s*$/, "\n");
  source += `
module.exports = {
  loadStep3Library,
  loadStep4Library,
  clamp,
  round,
  fmt,
  table,
  predictAligned,
  motionUnit,
  signedLead,
  distancePred,
  DetailScoreStore,
  createAccumulator,
  addError,
  finalize,
  HORIZONS_MS,
};
`;
  const sandbox = {
    require,
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(step6Script),
    __filename: step6Script,
    process,
    console,
    Buffer,
    Uint32Array,
    Float64Array,
    Map,
    Set,
    Array,
    Date,
    Math,
    Number,
    String,
    JSON,
    Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: step6Script });
  return sandbox.module.exports;
}

function round(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function fmt(value, digits = 4) {
  if (value === null || value === undefined) return "";
  return String(round(value, digits));
}

function table(headers, rows) {
  const all = [headers, ...rows].map((row) => row.map((cell) => String(cell ?? "")));
  const widths = headers.map((_, index) => Math.max(...all.map((row) => row[index].length)));
  const render = (row) => `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [
    render(all[0]),
    render(widths.map((width) => "-".repeat(Math.max(3, width)))),
    ...all.slice(1).map(render),
  ].join("\n");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function modelSpec(id, family, productEligible, selectable, description) {
  return { id, family, productEligible, selectable, description };
}

function referenceSpecs() {
  return [
    modelSpec("ls12_baseline", "reference", true, false, "Step 2 LS12 cap64."),
    modelSpec("step3_teacher_ridge_residual_segmented_horizon", "reference", true, false, "Step 3 teacher."),
    modelSpec("step4_vfsmn_small_velocity", "reference", true, false, "Step 4 selected VFSMN."),
    modelSpec("step5_guarded_selected", "reference", true, false, "Step 5 selected guarded mixture."),
    modelSpec("step6_timing_gain_1p15", "reference", true, false, "Step 6 timing gain selected candidate."),
  ];
}

function basePrediction(lib6, lib, step4Lib, models, trace, anchor, horizonMs, modelId) {
  if (modelId === "ls12_baseline") return lib6.predictAligned(lib, step4Lib, models, "ls12", trace, anchor, horizonMs, horizonMs);
  if (modelId === "step3_teacher_ridge_residual_segmented_horizon") return lib6.predictAligned(lib, step4Lib, models, "step3", trace, anchor, horizonMs, horizonMs);
  if (modelId === "step4_vfsmn_small_velocity") return lib6.predictAligned(lib, step4Lib, models, "step4", trace, anchor, horizonMs, horizonMs);
  if (modelId === "step5_guarded_selected") return lib6.predictAligned(lib, step4Lib, models, "step5", trace, anchor, horizonMs, horizonMs);
  if (modelId === "step6_timing_gain_1p15") return lib6.predictAligned(lib, step4Lib, models, "step4", trace, anchor, horizonMs, horizonMs * 1.15);
  throw new Error(`Unknown base model id: ${modelId}`);
}

function buildSample(lib6, lib, step4Lib, models, trace, anchor, horizonMs, target) {
  const unit = lib6.motionUnit(trace, anchor);
  const predictions = new Map();
  const errors = {};
  const signed = {};
  for (const modelId of BASE_MODEL_IDS) {
    const pred = basePrediction(lib6, lib, step4Lib, models, trace, anchor, horizonMs, modelId);
    predictions.set(modelId, pred);
    errors[modelId] = lib.distance(pred.x, pred.y, target.x, target.y);
    signed[modelId] = lib6.signedLead(pred, target, unit);
  }
  const ls12 = predictions.get("ls12_baseline");
  const baseFeatures = lib.featureVector(trace, anchor, horizonMs, ls12);
  const featureVector = selectorFeatures(baseFeatures, predictions);
  const currentX = trace.refX[anchor.refIndex];
  const currentY = trace.refY[anchor.refIndex];
  const bestBase = BASE_MODEL_IDS
    .map((modelId) => ({ modelId, error: errors[modelId] }))
    .sort((a, b) => a.error - b.error)[0].modelId;
  return {
    split: anchor.split,
    loadCondition: trace.id,
    horizonMs,
    movementCategory: anchor.movementCategory || "unknown",
    schedulerDelayBin: anchor.schedulerDelayBin || "missing",
    scenarioProgressBin: progressBin(anchor.scenarioElapsedMs),
    featureVector,
    errors,
    signed,
    predictions,
    target,
    current: { x: currentX, y: currentY },
    targetDelta: { x: target.x - currentX, y: target.y - currentY },
    unit,
    bestBase,
  };
}

function selectorFeatures(baseFeatures, predictions) {
  const disagreement = Math.max(
    distancePred(predictions.get("ls12_baseline"), predictions.get("step3_teacher_ridge_residual_segmented_horizon")),
    distancePred(predictions.get("ls12_baseline"), predictions.get("step4_vfsmn_small_velocity")),
    distancePred(predictions.get("step3_teacher_ridge_residual_segmented_horizon"), predictions.get("step4_vfsmn_small_velocity")),
    distancePred(predictions.get("step4_vfsmn_small_velocity"), predictions.get("step6_timing_gain_1p15")),
  );
  const ls12Speed = baseFeatures[9] || 0;
  const ls8Speed = baseFeatures[10] || 0;
  const last2Speed = baseFeatures[11] || 0;
  const speedSpread = Math.max(Math.abs(ls12Speed - ls8Speed), Math.abs(ls12Speed - last2Speed), Math.abs(ls8Speed - last2Speed));
  return [
    baseFeatures[1] || 0,
    baseFeatures[3] || 0,
    baseFeatures[4] || 0,
    baseFeatures[6] || 0,
    baseFeatures[7] || 0,
    baseFeatures[8] || 0,
    ls12Speed,
    ls8Speed,
    last2Speed,
    baseFeatures[12] || 0,
    baseFeatures[13] || 0,
    baseFeatures[14] || 0,
    baseFeatures[15] || 0,
    disagreement / 24,
    speedSpread,
  ];
}

function distancePred(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function progressBin(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 500) return "<500ms";
  if (ms < 1500) return "500-1500ms";
  if (ms < 3500) return "1500-3500ms";
  return ">=3500ms";
}

function objectiveFromAccumulator(lib6, acc) {
  const metric = lib6.finalize(acc);
  return objectiveFromMetric(metric);
}

function objectiveFromMetric(metric) {
  if (!metric || !metric.count) return Infinity;
  return (metric.p95 ?? 999)
    + 0.45 * (metric.p99 ?? 999)
    + 35 * (metric.regressionRates.gt5px ?? 1)
    + 130 * (metric.regressionRates.gt10px ?? 1)
    + 1.8 * Math.max(0, -(metric.signedLead.mean ?? 0))
    + 6 * (metric.signedLead.lagRate ?? 0);
}

function selectorMetric(lib6, samples, selector) {
  const acc = lib6.createAccumulator();
  for (const sample of samples) {
    const modelId = selectBaseModel(sample, selector);
    lib6.addError(acc, sample.errors[modelId], sample.signed[modelId]);
  }
  return lib6.finalize(acc);
}

function chooseBestModelForSamples(lib6, samples) {
  const accs = new Map(BASE_MODEL_IDS.map((id) => [id, lib6.createAccumulator()]));
  for (const sample of samples) {
    for (const modelId of BASE_MODEL_IDS) lib6.addError(accs.get(modelId), sample.errors[modelId], sample.signed[modelId]);
  }
  return BASE_MODEL_IDS
    .map((modelId) => ({ modelId, objective: objectiveFromAccumulator(lib6, accs.get(modelId)), metric: lib6.finalize(accs.get(modelId)) }))
    .sort((a, b) => a.objective - b.objective || a.metric.mean - b.metric.mean)[0]?.modelId || BASE_MODEL_IDS[0];
}

function buildConstantSelector(lib6, trainSamples) {
  return {
    id: "causal_selector_constant_train_best",
    family: "causal_constant_selector",
    productEligible: true,
    selectable: true,
    selectedModel: chooseBestModelForSamples(lib6, trainSamples),
    description: "Product-eligible lower-bound selector: always choose the train-best base predictor.",
  };
}

function quantiles(values, qs) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [];
  return qs.map((q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]);
}

function buildStumpSelectors(lib6, trainSamples) {
  const candidates = [];
  for (let featureIndex = 0; featureIndex < FEATURE_NAMES.length; featureIndex += 1) {
    const thresholds = [...new Set(quantiles(trainSamples.map((sample) => sample.featureVector[featureIndex]), [0.2, 0.35, 0.5, 0.65, 0.8]).map((v) => round(v, 5)))];
    for (const threshold of thresholds) {
      const left = trainSamples.filter((sample) => sample.featureVector[featureIndex] <= threshold);
      const right = trainSamples.filter((sample) => sample.featureVector[featureIndex] > threshold);
      if (left.length < 200 || right.length < 200) continue;
      const selector = {
        id: `causal_selector_stump_${FEATURE_NAMES[featureIndex]}_${String(threshold).replace("-", "m").replace(".", "p")}`,
        family: "causal_stump_selector",
        productEligible: true,
        selectable: true,
        featureIndex,
        featureName: FEATURE_NAMES[featureIndex],
        threshold,
        leftModel: chooseBestModelForSamples(lib6, left),
        rightModel: chooseBestModelForSamples(lib6, right),
        description: `Decision stump on ${FEATURE_NAMES[featureIndex]} <= ${threshold}.`,
      };
      const metric = selectorMetric(lib6, trainSamples, selector);
      candidates.push({ selector, trainObjective: objectiveFromMetric(metric) });
    }
  }
  return candidates
    .sort((a, b) => a.trainObjective - b.trainObjective)
    .slice(0, 24)
    .map((row) => row.selector);
}

function buildHorizonSelector(lib6, trainSamples) {
  const byHorizon = {};
  for (const horizon of HORIZONS_MS) {
    const subset = trainSamples.filter((sample) => Number(sample.horizonMs) === Number(horizon));
    byHorizon[String(horizon)] = chooseBestModelForSamples(lib6, subset);
  }
  return {
    id: "causal_selector_horizon_train_best",
    family: "causal_horizon_selector",
    productEligible: true,
    selectable: true,
    byHorizon,
    description: "Product-eligible selector using requested horizon only.",
  };
}

function buildHorizonStumpSelector(lib6, trainSamples, stumpSelectors) {
  const byHorizon = {};
  for (const horizon of HORIZONS_MS) {
    const subset = trainSamples.filter((sample) => Number(sample.horizonMs) === Number(horizon));
    const best = stumpSelectors
      .map((selector) => ({ selector, metric: selectorMetric(lib6, subset, selector) }))
      .sort((a, b) => objectiveFromMetric(a.metric) - objectiveFromMetric(b.metric))[0]?.selector;
    byHorizon[String(horizon)] = best || buildHorizonSelector(lib6, trainSamples);
  }
  return {
    id: "causal_selector_horizon_stump_train_best",
    family: "causal_small_tree_selector",
    productEligible: true,
    selectable: true,
    byHorizon,
    description: "Small tree: horizon root, then train-best causal stump.",
  };
}

class NormalEquation {
  constructor(dimension) {
    this.dimension = dimension;
    this.xtx = new Float64Array(dimension * dimension);
    this.xty = new Float64Array(dimension);
    this.count = 0;
  }

  add(features, target) {
    const d = this.dimension;
    for (let i = 0; i < d; i += 1) {
      const fi = features[i];
      this.xty[i] += fi * target;
      const base = i * d;
      for (let j = 0; j <= i; j += 1) this.xtx[base + j] += fi * features[j];
    }
    this.count += 1;
  }

  solve(lambda) {
    return solveSymmetric(this.xtx, this.xty, this.dimension, lambda);
  }
}

function solveSymmetric(lowerTriangular, rhs, dimension, lambda) {
  const a = Array.from({ length: dimension }, () => new Float64Array(dimension + 1));
  for (let i = 0; i < dimension; i += 1) {
    for (let j = 0; j < dimension; j += 1) a[i][j] = i >= j ? lowerTriangular[i * dimension + j] : lowerTriangular[j * dimension + i];
    a[i][i] += lambda;
    a[i][dimension] = rhs[i];
  }
  for (let col = 0; col < dimension; col += 1) {
    let pivot = col;
    let pivotAbs = Math.abs(a[col][col]);
    for (let row = col + 1; row < dimension; row += 1) {
      const candidate = Math.abs(a[row][col]);
      if (candidate > pivotAbs) {
        pivot = row;
        pivotAbs = candidate;
      }
    }
    if (pivotAbs < 1e-12) continue;
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let k = col; k <= dimension; k += 1) a[col][k] /= div;
    for (let row = 0; row < dimension; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-20) continue;
      for (let k = col; k <= dimension; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row) => row[dimension]);
}

function selectorLinearFeatures(sample) {
  return [1, ...sample.featureVector];
}

function dot(weights, features) {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) sum += weights[i] * features[i];
  return sum;
}

function buildRidgeErrorSelector(trainSamples) {
  const dimension = FEATURE_NAMES.length + 1;
  const models = {};
  for (const modelId of BASE_MODEL_IDS) {
    const equation = new NormalEquation(dimension);
    for (const sample of trainSamples) equation.add(selectorLinearFeatures(sample), Math.min(128, sample.errors[modelId]));
    models[modelId] = equation.solve(10);
  }
  return {
    id: "causal_selector_ridge_error_score",
    family: "causal_ridge_score_selector",
    productEligible: true,
    selectable: true,
    errorWeightsByModel: models,
    description: "Ridge-like linear error score per base predictor; choose lowest predicted error.",
  };
}

function buildPrototypeSelector(trainSamples) {
  const sums = new Map();
  for (const modelId of BASE_MODEL_IDS) sums.set(modelId, { count: 0, sum: new Float64Array(FEATURE_NAMES.length) });
  for (const sample of trainSamples) {
    const bucket = sums.get(sample.bestBase);
    bucket.count += 1;
    for (let i = 0; i < FEATURE_NAMES.length; i += 1) bucket.sum[i] += sample.featureVector[i];
  }
  const prototypes = {};
  for (const [modelId, bucket] of sums.entries()) {
    if (bucket.count === 0) continue;
    prototypes[modelId] = Array.from(bucket.sum, (value) => value / bucket.count);
  }
  return {
    id: "causal_selector_nn_prototype",
    family: "causal_nearest_neighbor_style_selector",
    productEligible: true,
    selectable: true,
    prototypes,
    description: "Nearest-prototype selector trained from oracle-best regions in causal feature space.",
  };
}

function buildCategorySelector(lib6, trainSamples) {
  const map = {};
  const groups = groupBy(trainSamples, (sample) => `${sample.movementCategory}|${sample.horizonMs}`);
  for (const [key, samples] of groups.entries()) map[key] = chooseBestModelForSamples(lib6, samples);
  return {
    id: "oracle_category_selector",
    family: "analysis_category_selector",
    productEligible: false,
    selectable: false,
    map,
    defaultModel: chooseBestModelForSamples(lib6, trainSamples),
    description: "Analysis-only selector using script/evaluation movement category and horizon.",
  };
}

function buildTelemetryProxySelectors(lib6, trainSamples) {
  return [
    buildProxySelector(lib6, trainSamples, "telemetry_proxy_category_load_horizon", "category_load_horizon", (sample) => `${sample.movementCategory}|${sample.loadCondition}|${sample.horizonMs}`),
    buildProxySelector(lib6, trainSamples, "telemetry_proxy_category_progress_horizon", "category_progress_horizon", (sample) => `${sample.movementCategory}|${sample.scenarioProgressBin}|${sample.horizonMs}`),
    buildProxySelector(lib6, trainSamples, "telemetry_proxy_warmup_scheduler_horizon", "warmup_scheduler_horizon", (sample) => `${sample.scenarioProgressBin}|${sample.schedulerDelayBin}|${sample.horizonMs}`),
  ];
}

function buildProxySelector(lib6, trainSamples, id, family, keyFn) {
  const map = {};
  const groups = groupBy(trainSamples, keyFn);
  for (const [key, samples] of groups.entries()) map[key] = chooseBestModelForSamples(lib6, samples);
  return {
    id,
    family,
    productEligible: false,
    selectable: false,
    map,
    keyFnName: family,
    defaultModel: chooseBestModelForSamples(lib6, trainSamples),
    description: `Analysis-only telemetry proxy selector: ${family}.`,
  };
}

function groupBy(samples, keyFn) {
  const groups = new Map();
  for (const sample of samples) {
    const key = keyFn(sample);
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(sample);
  }
  return groups;
}

function selectBaseModel(sample, selector) {
  if (BASE_MODEL_IDS.includes(selector.id)) return selector.id;
  if (selector.id === "oracle_best_of_ls12_step3_step4_step5_step6") return sample.bestBase;
  if (selector.selectedModel) return selector.selectedModel;
  if (selector.featureIndex !== undefined) return sample.featureVector[selector.featureIndex] <= selector.threshold ? selector.leftModel : selector.rightModel;
  if (selector.byHorizon) {
    const entry = selector.byHorizon[String(sample.horizonMs)];
    if (typeof entry === "string") return entry;
    return selectBaseModel(sample, entry);
  }
  if (selector.errorWeightsByModel) {
    const features = selectorLinearFeatures(sample);
    return BASE_MODEL_IDS
      .map((modelId) => ({ modelId, score: dot(selector.errorWeightsByModel[modelId], features) }))
      .sort((a, b) => a.score - b.score)[0].modelId;
  }
  if (selector.prototypes) {
    return Object.entries(selector.prototypes)
      .map(([modelId, prototype]) => ({ modelId, distance: featureDistance(sample.featureVector, prototype) }))
      .sort((a, b) => a.distance - b.distance)[0]?.modelId || BASE_MODEL_IDS[0];
  }
  if (selector.map) {
    let key;
    if (selector.id === "oracle_category_selector") key = `${sample.movementCategory}|${sample.horizonMs}`;
    else if (selector.id === "telemetry_proxy_category_load_horizon") key = `${sample.movementCategory}|${sample.loadCondition}|${sample.horizonMs}`;
    else if (selector.id === "telemetry_proxy_category_progress_horizon") key = `${sample.movementCategory}|${sample.scenarioProgressBin}|${sample.horizonMs}`;
    else if (selector.id === "telemetry_proxy_warmup_scheduler_horizon") key = `${sample.scenarioProgressBin}|${sample.schedulerDelayBin}|${sample.horizonMs}`;
    return selector.map[key] || selector.defaultModel || BASE_MODEL_IDS[0];
  }
  return BASE_MODEL_IDS[0];
}

function featureDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function buildSelectors(lib6, trainSamples) {
  const constant = buildConstantSelector(lib6, trainSamples);
  const stumps = buildStumpSelectors(lib6, trainSamples);
  const horizon = buildHorizonSelector(lib6, trainSamples);
  const horizonStump = buildHorizonStumpSelector(lib6, trainSamples, stumps);
  const ridge = buildRidgeErrorSelector(trainSamples);
  const proto = buildPrototypeSelector(trainSamples);
  const category = buildCategorySelector(lib6, trainSamples);
  const proxies = buildTelemetryProxySelectors(lib6, trainSamples);
  return {
    product: [constant, horizon, horizonStump, ridge, proto, ...stumps],
    analysis: [
      modelSpec("oracle_best_of_ls12_step3_step4_step5_step6", "oracle_best_of", false, false, "Analysis-only direct label oracle choosing the lowest-error base predictor per sample."),
      category,
      ...proxies,
    ],
  };
}

function collectTrainingSamples(lib6, lib, step4Lib, models, traces) {
  const train = [];
  const validation = [];
  const ambiguityTrain = [];
  const ambiguityValidation = [];
  const ambiguityResumeValidation = [];
  let seenTrain = 0;
  let seenValidation = 0;
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      if (anchor.split !== "train" && anchor.split !== "validation") continue;
      anchor.cache = Object.create(null);
      anchor._step6PredictionCache = new Map();
      for (const horizonMs of HORIZONS_MS) {
        const target = lib.interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) continue;
        const sample = buildSample(lib6, lib, step4Lib, models, trace, anchor, horizonMs, target);
        if (anchor.split === "train") {
          seenTrain += 1;
          reservoirPush(train, sample, SAMPLE_CAPS.trainSelector, seenTrain);
          reservoirPush(ambiguityTrain, sample, SAMPLE_CAPS.ambiguityTrain, seenTrain);
        } else {
          seenValidation += 1;
          reservoirPush(validation, sample, SAMPLE_CAPS.validationSelector, seenValidation);
          reservoirPush(ambiguityValidation, sample, SAMPLE_CAPS.ambiguityValidation, seenValidation);
          if (sample.movementCategory === "resume" && horizonMs >= 16.67) {
            reservoirPush(ambiguityResumeValidation, sample, SAMPLE_CAPS.ambiguityResumeValidation, seenValidation + horizonMs * 1000);
          }
        }
      }
    }
  }
  return {
    train,
    validation,
    ambiguityTrain,
    ambiguityValidation,
    ambiguityResumeValidation,
    seenTrain,
    seenValidation,
  };
}

function reservoirPush(items, item, cap, seen) {
  if (items.length < cap) {
    items.push(item);
    return;
  }
  const r = deterministicUnit(seen);
  const index = Math.floor(r * seen);
  if (index < cap) items[index] = item;
}

function deterministicUnit(value) {
  let x = (Math.floor(value) + 0x9e3779b9) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x / 0x100000000;
}

function evaluateValidation(lib6, lib, step4Lib, models, traces, selectors) {
  const accs = new Map(selectors.map((selector) => [selector.id, {
    selector,
    overall: lib6.createAccumulator(),
    resumeTail: lib6.createAccumulator(),
    hold: lib6.createAccumulator(),
    moving: lib6.createAccumulator(),
  }]));
  let count = 0;
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      if (anchor.split !== "validation") continue;
      anchor.cache = Object.create(null);
      anchor._step6PredictionCache = new Map();
      for (const horizonMs of HORIZONS_MS) {
        const target = lib.interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) continue;
        const sample = buildSample(lib6, lib, step4Lib, models, trace, anchor, horizonMs, target);
        for (const selector of selectors) {
          const modelId = selectBaseModel(sample, selector);
          const entry = accs.get(selector.id);
          lib6.addError(entry.overall, sample.errors[modelId], sample.signed[modelId]);
          if (sample.movementCategory === "resume" && horizonMs >= 16.67) lib6.addError(entry.resumeTail, sample.errors[modelId], sample.signed[modelId]);
          if (sample.movementCategory === "hold") lib6.addError(entry.hold, sample.errors[modelId], sample.signed[modelId]);
          if (sample.movementCategory === "moving") lib6.addError(entry.moving, sample.errors[modelId], sample.signed[modelId]);
        }
        count += 1;
      }
    }
  }
  const rows = [...accs.values()].map((entry) => ({
    modelId: entry.selector.id,
    family: entry.selector.family,
    productEligible: Boolean(entry.selector.productEligible),
    selectable: Boolean(entry.selector.selectable),
    objective: null,
    guardrailPass: null,
    overall: lib6.finalize(entry.overall),
    resumeTail: lib6.finalize(entry.resumeTail),
    hold: lib6.finalize(entry.hold),
    moving: lib6.finalize(entry.moving),
  }));
  applySelectorObjective(rows);
  rows.sort((a, b) => (a.guardrailPass === b.guardrailPass ? 0 : a.guardrailPass ? -1 : 1)
    || a.objective - b.objective
    || (a.overall.mean ?? Infinity) - (b.overall.mean ?? Infinity));
  return { rows, count };
}

function applySelectorObjective(rows) {
  const refs = rows.filter((row) => [
    "step3_teacher_ridge_residual_segmented_horizon",
    "step4_vfsmn_small_velocity",
    "step5_guarded_selected",
    "step6_timing_gain_1p15",
  ].includes(row.modelId));
  for (const row of rows) {
    row.objective = round(
      objectiveFromMetric(row.overall)
      + 0.7 * (row.resumeTail.p95 ?? 0)
      + 0.3 * (row.resumeTail.p99 ?? 0)
      + selectorRegressionPenalty(row, refs),
      6,
    );
    row.guardrailPass = row.productEligible && row.selectable && selectorGuardrailPass(row, refs);
  }
}

function selectorRegressionPenalty(row, refs) {
  if (!refs.length || refs.some((ref) => ref.modelId === row.modelId)) return 0;
  const bestP95 = Math.min(...refs.map((ref) => ref.overall.p95 ?? 999));
  const bestP99 = Math.min(...refs.map((ref) => ref.overall.p99 ?? 999));
  const bestResumeP95 = Math.min(...refs.map((ref) => ref.resumeTail.p95 ?? 999));
  const bestResumeP99 = Math.min(...refs.map((ref) => ref.resumeTail.p99 ?? 999));
  let penalty = 0;
  penalty += Math.max(0, (row.overall.p95 ?? 999) - bestP95 - 0.25) * 10;
  penalty += Math.max(0, (row.overall.p99 ?? 999) - bestP99 - 0.5) * 4;
  penalty += Math.max(0, (row.resumeTail.p95 ?? 999) - bestResumeP95 - 0.5) * 8;
  penalty += Math.max(0, (row.resumeTail.p99 ?? 999) - bestResumeP99 - 1.0) * 3;
  return penalty;
}

function selectorGuardrailPass(row, refs) {
  if (!refs.length) return false;
  const bestP95 = Math.min(...refs.map((ref) => ref.overall.p95 ?? 999));
  const bestP99 = Math.min(...refs.map((ref) => ref.overall.p99 ?? 999));
  const bestResumeP95 = Math.min(...refs.map((ref) => ref.resumeTail.p95 ?? 999));
  const bestResumeP99 = Math.min(...refs.map((ref) => ref.resumeTail.p99 ?? 999));
  if ((row.overall.p95 ?? 999) > bestP95 + 0.25) return false;
  if ((row.overall.p99 ?? 999) > bestP99 + 0.5) return false;
  if ((row.resumeTail.p95 ?? 999) > bestResumeP95 + 0.5) return false;
  if ((row.resumeTail.p99 ?? 999) > bestResumeP99 + 1.0) return false;
  return true;
}

function selectProductSelector(validationRows) {
  const selectable = validationRows.filter((row) => row.productEligible && row.selectable);
  const passing = selectable.find((row) => row.guardrailPass);
  return {
    selected: passing || selectable[0],
    guardrailPassed: Boolean(passing),
    topProduct10: selectable.slice(0, 10),
    topOverall12: validationRows.slice(0, 12),
  };
}

function evaluateDetailed(lib6, lib, step4Lib, models, traces, selectors) {
  const store = new lib6.DetailScoreStore();
  let labelsMissing = 0;
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      anchor.cache = Object.create(null);
      anchor._step6PredictionCache = new Map();
      for (const horizonMs of HORIZONS_MS) {
        const target = lib.interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) {
          labelsMissing += 1;
          continue;
        }
        const sample = buildSample(lib6, lib, step4Lib, models, trace, anchor, horizonMs, target);
        for (const selector of selectors) {
          const modelId = selectBaseModel(sample, selector);
          store.addObservation(selector, trace, anchor, horizonMs, sample.errors[modelId], sample.signed[modelId]);
        }
      }
    }
  }
  return { scores: store.finalize(), labelsMissing };
}

function scoreLookup(scores, modelId, split, loadCondition) {
  return scores.perSplitScores.find((row) => row.modelId === modelId && row.split === split && row.loadCondition === loadCondition);
}

function deltaRows(scores, candidateId, baselineId) {
  const rows = [];
  for (const split of ["validation", "test"]) {
    for (const load of ["normal", "stress"]) {
      const base = scoreLookup(scores, baselineId, split, load);
      const cand = scoreLookup(scores, candidateId, split, load);
      if (!base || !cand) continue;
      rows.push({
        split,
        loadCondition: load,
        baselineModel: baselineId,
        candidateModel: candidateId,
        baselineMean: base.error.mean,
        candidateMean: cand.error.mean,
        meanDelta: round(cand.error.mean - base.error.mean),
        baselineP95: base.error.p95,
        candidateP95: cand.error.p95,
        p95Delta: round(cand.error.p95 - base.error.p95),
        baselineP99: base.error.p99,
        candidateP99: cand.error.p99,
        p99Delta: round(cand.error.p99 - base.error.p99),
        gt10Delta: round(cand.error.regressionRates.gt10px - base.error.regressionRates.gt10px, 6),
        signedLeadDelta: round((cand.error.signedLead.mean ?? 0) - (base.error.signedLead.mean ?? 0), 4),
        lagRateDelta: round((cand.error.signedLead.lagRate ?? 0) - (base.error.signedLead.lagRate ?? 0), 6),
      });
    }
  }
  return rows;
}

function ambiguityAnalysis(trainRefs, validationQueries, resumeQueries) {
  const refsByHorizon = groupBy(trainRefs, (sample) => String(sample.horizonMs));
  return {
    overall: ambiguityForQueries(refsByHorizon, validationQueries),
    resumeTail: ambiguityForQueries(refsByHorizon, resumeQueries),
  };
}

function ambiguityForQueries(refsByHorizon, queries) {
  const rows = [];
  for (const query of queries) {
    const refs = refsByHorizon.get(String(query.horizonMs)) || [];
    if (!refs.length) continue;
    let best = null;
    for (const ref of refs) {
      const d = featureDistance(query.featureVector, ref.featureVector);
      if (!best || d < best.distance) best = { ref, distance: d };
    }
    const divergence = Math.sqrt(
      (query.targetDelta.x - best.ref.targetDelta.x) ** 2
      + (query.targetDelta.y - best.ref.targetDelta.y) ** 2,
    );
    rows.push({
      distance: best.distance,
      divergence,
      sameBestBase: query.bestBase === best.ref.bestBase,
      queryCategory: query.movementCategory,
      refCategory: best.ref.movementCategory,
      horizonMs: query.horizonMs,
    });
  }
  if (!rows.length) return { count: 0 };
  const distances = rows.map((row) => row.distance).sort((a, b) => a - b);
  const divergences = rows.map((row) => row.divergence).sort((a, b) => a - b);
  const closeThreshold = quantileSorted(distances, 0.25);
  const close = rows.filter((row) => row.distance <= closeThreshold);
  return {
    count: rows.length,
    nearestDistance: {
      median: round(quantileSorted(distances, 0.5)),
      p75: round(quantileSorted(distances, 0.75)),
      p90: round(quantileSorted(distances, 0.9)),
      closeThreshold: round(closeThreshold),
    },
    futureDivergencePx: {
      median: round(quantileSorted(divergences, 0.5)),
      p75: round(quantileSorted(divergences, 0.75)),
      p90: round(quantileSorted(divergences, 0.9)),
      p95: round(quantileSorted(divergences, 0.95)),
    },
    closeButDivergentRates: {
      gt10px: round(close.filter((row) => row.divergence > 10).length / close.length, 6),
      gt25px: round(close.filter((row) => row.divergence > 25).length / close.length, 6),
      oracleBestDiffers: round(close.filter((row) => !row.sameBestBase).length / close.length, 6),
      movementCategoryDiffers: round(close.filter((row) => row.queryCategory !== row.refCategory).length / close.length, 6),
    },
  };
}

function quantileSorted(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

function buildTelemetryValue(scores) {
  const rows = [];
  for (const modelId of [
    "oracle_best_of_ls12_step3_step4_step5_step6",
    "oracle_category_selector",
    "telemetry_proxy_category_load_horizon",
    "telemetry_proxy_category_progress_horizon",
    "telemetry_proxy_warmup_scheduler_horizon",
  ]) {
    for (const load of ["normal", "stress"]) {
      const score = scoreLookup(scores, modelId, "test", load);
      const ref = scoreLookup(scores, "step3_teacher_ridge_residual_segmented_horizon", "test", load);
      if (!score || !ref) continue;
      rows.push({
        modelId,
        loadCondition: load,
        mean: score.error.mean,
        p95: score.error.p95,
        p99: score.error.p99,
        gt10px: score.error.regressionRates.gt10px,
        p95DeltaVsStep3: round(score.error.p95 - ref.error.p95),
        p99DeltaVsStep3: round(score.error.p99 - ref.error.p99),
        gt10DeltaVsStep3: round(score.error.regressionRates.gt10px - ref.error.regressionRates.gt10px, 6),
      });
    }
  }
  return rows;
}

function buildReport(result) {
  const selectedId = result.validationSelection.selected.modelId;
  const oracleRows = result.telemetryValue
    .filter((row) => row.modelId.startsWith("oracle") || row.modelId.startsWith("telemetry_proxy"))
    .map((row) => [row.modelId, row.loadCondition, fmt(row.mean), fmt(row.p95), fmt(row.p99), fmt(row.gt10px, 6), fmt(row.p95DeltaVsStep3), fmt(row.p99DeltaVsStep3), fmt(row.gt10DeltaVsStep3, 6)]);
  const productRows = result.validationSelection.topProduct10.map((row) => [row.modelId, row.family, row.guardrailPass ? "yes" : "no", fmt(row.objective), fmt(row.overall.mean), fmt(row.overall.p95), fmt(row.overall.p99), fmt(row.resumeTail.p95), fmt(row.resumeTail.p99)]);
  const compareRows = [];
  for (const baselineId of ["step3_teacher_ridge_residual_segmented_horizon", "step4_vfsmn_small_velocity", "step5_guarded_selected", "step6_timing_gain_1p15"]) {
    for (const row of result.deltas[baselineId].filter((item) => item.split === "test")) {
      compareRows.push([baselineId, row.loadCondition, fmt(row.baselineMean), fmt(row.candidateMean), fmt(row.meanDelta), fmt(row.baselineP95), fmt(row.candidateP95), fmt(row.p95Delta), fmt(row.baselineP99), fmt(row.candidateP99), fmt(row.p99Delta), fmt(row.signedLeadDelta), fmt(row.lagRateDelta, 6)]);
    }
  }
  const breakdownRows = result.scores.perValidationTestCategoryHorizonScores
    .filter((row) => row.modelId === selectedId && row.split === "test")
    .map((row) => [row.loadCondition, row.horizonMs, row.movementCategory, row.error.count, fmt(row.error.mean), fmt(row.error.p95), fmt(row.error.p99), fmt(row.error.regressionRates.gt10px, 6), fmt(row.error.signedLead.mean)]);
  const ambiguityRows = [
    ["overall", result.historyAmbiguity.overall.count, fmt(result.historyAmbiguity.overall.nearestDistance?.median), fmt(result.historyAmbiguity.overall.nearestDistance?.p90), fmt(result.historyAmbiguity.overall.futureDivergencePx?.p90), fmt(result.historyAmbiguity.overall.futureDivergencePx?.p95), fmt(result.historyAmbiguity.overall.closeButDivergentRates?.gt10px, 6), fmt(result.historyAmbiguity.overall.closeButDivergentRates?.gt25px, 6), fmt(result.historyAmbiguity.overall.closeButDivergentRates?.oracleBestDiffers, 6)],
    ["resumeTail", result.historyAmbiguity.resumeTail.count, fmt(result.historyAmbiguity.resumeTail.nearestDistance?.median), fmt(result.historyAmbiguity.resumeTail.nearestDistance?.p90), fmt(result.historyAmbiguity.resumeTail.futureDivergencePx?.p90), fmt(result.historyAmbiguity.resumeTail.futureDivergencePx?.p95), fmt(result.historyAmbiguity.resumeTail.closeButDivergentRates?.gt10px, 6), fmt(result.historyAmbiguity.resumeTail.closeButDivergentRates?.gt25px, 6), fmt(result.historyAmbiguity.resumeTail.closeButDivergentRates?.oracleBestDiffers, 6)],
  ];

  return `# Step 7 Oracle Observability Ceiling

## Intent

Step 7 estimates how close the current causal input can get to the best available replay candidates, and whether larger models are likely to help without additional telemetry. The evaluation contract remains the same as Steps 2-6: product poll anchors, causal referencePoll history, Step 1 split, and labels at anchor + horizon for ${HORIZONS_MS.join(", ")} ms.

## Oracle Metrics And Telemetry Proxies

Oracle rows are analysis-only. They either use the label directly, script/evaluation movement category, load id, or scenario-progress proxies.

${table(["model", "load", "mean", "p95", "p99", ">10px", "p95 d vs S3", "p99 d vs S3", ">10 d vs S3"], oracleRows)}

## Product-Eligible Selector Metrics

Validation selected \`${selectedId}\`. Guardrail passed: ${result.validationSelection.guardrailPassed ? "yes" : "no"}.

${table(["model", "family", "guard", "objective", "mean", "p95", "p99", "resume p95", "resume p99"], productRows)}

## Step 3 / 4 / 5 / 6 Comparison

${table(["baseline", "load", "base mean", "cand mean", "mean d", "base p95", "cand p95", "p95 d", "base p99", "cand p99", "p99 d", "signed d", "lag d"], compareRows)}

## Resume / Hold / Moving Breakdown

${table(["load", "horizon", "category", "count", "mean", "p95", "p99", ">10px", "signed lead"], breakdownRows)}

## History Ambiguity

Nearest-neighbor analysis uses sampled train references and sampled validation queries in causal feature space, constrained to the same requested horizon. Future divergence compares target displacement vectors, not absolute screen position.

${table(["segment", "queries", "dist median", "dist p90", "future div p90", "future div p95", "close gt10", "close gt25", "close oracle differs"], ambiguityRows)}

## Telemetry Priority

1. Prediction target timestamp and present/compositor timestamp: Step 6 showed signed lag is movable, but tail can regress without knowing the actual presentation target.
2. Explicit hold/resume transition telemetry: resume-tail ambiguity remains high, and category/proxy oracles show headroom that causal history selectors do not reach.
3. Warm-up/missing scheduler marker: tiny missing-scheduler buckets create extreme outliers and should be separable before learning.
4. Causal transition-age features: time since last hold/resume-like state is the product-shaped version of the analysis-only movement category proxy.
5. Runtime scheduler/poll gap provenance: scheduler delay is useful only if its meaning is stable across normal/stress and warm-up.

## Zero-Error Feasibility

${result.zeroErrorFeasibility}

## Step 8 Recommendation

${result.nextStepRecommendation}
`;
}

function buildNotes(result) {
  return `# Step 7 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v11\\scripts\\run-step7-oracle-observability-ceiling.js
\`\`\`

## Product Eligibility

Product-eligible selectors use causal feature vectors derived from referencePoll history and product poll timing. Analysis-only selectors use label-best choices, script/evaluation movement category, load id, or scenario progress proxies and are excluded from validation selection.

## Sampling

Selector training uses a deterministic reservoir sample capped at ${SAMPLE_CAPS.trainSelector} train examples. History ambiguity uses capped nearest-neighbor samples to avoid writing per-frame caches or running a heavy benchmark.

Selected product selector: \`${result.validationSelection.selected.modelId}\`.
`;
}

function buildZeroErrorFeasibility(result) {
  const oracleNormal = result.telemetryValue.find((row) => row.modelId === "oracle_best_of_ls12_step3_step4_step5_step6" && row.loadCondition === "normal");
  const oracleStress = result.telemetryValue.find((row) => row.modelId === "oracle_best_of_ls12_step3_step4_step5_step6" && row.loadCondition === "stress");
  const ambiguity = result.historyAmbiguity.resumeTail;
  return `Current candidate diversity has real headroom: oracle best-of reaches normal p95 ${oracleNormal?.p95}px / p99 ${oracleNormal?.p99}px and stress p95 ${oracleStress?.p95}px / p99 ${oracleStress?.p99}px, but this oracle uses the label. Product-eligible causal selectors do not close that gap. Resume-tail nearest-neighbor collisions show close causal histories with future divergence >10px at rate ${fmt(ambiguity.closeButDivergentRates?.gt10px, 6)} and oracle-best mismatch rate ${fmt(ambiguity.closeButDivergentRates?.oracleBestDiffers, 6)}. Near-zero error is therefore not plausible from the current inputs alone; larger models may overfit selectors unless the runtime records transition/timing telemetry that makes those collisions separable.`;
}

function buildNextStepRecommendation() {
  return "Step 8 should prioritize instrumentation over larger model search: add explicit prediction target/present timestamps, hold/resume transition age, warm-up/missing scheduler markers, and scheduler provenance to MotionLab/TraceTool, then rerun Steps 3-7 with those causal fields.";
}

function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.outDir);
  const lib6 = loadStep6Library(args.step6Script);
  const lib = lib6.loadStep3Library(args.step3Script);
  const step4Lib = lib6.loadStep4Library(args.step4Script);
  const step1Scores = JSON.parse(fs.readFileSync(args.step1Scores, "utf8"));
  const split = lib.parseSplit(step1Scores);
  const traces = PACKAGES.map((target) => lib.loadTracePackage(args.root, target, split));

  const step3Training = lib.trainModels(traces);
  const step3Selection = lib.evaluateRidgeCandidates(traces, step3Training);
  const step3Teacher = step3Selection.horizon.selected;
  const step4Spec = step4Lib.candidateSpecs().filter((spec) => spec.id === "VFSMN_small_velocity");
  const step4Training = step4Lib.trainCandidates(lib, traces, step4Spec);
  const step4Model = step4Training.models.get("VFSMN_small_velocity");
  const models = { step3Teacher, step4Model };

  const samples = collectTrainingSamples(lib6, lib, step4Lib, models, traces);
  const selectors = buildSelectors(lib6, samples.train);
  const reference = referenceSpecs();
  const validationSelectors = [...reference, ...selectors.product, ...selectors.analysis];
  const validation = evaluateValidation(lib6, lib, step4Lib, models, traces, validationSelectors);
  const validationSelection = selectProductSelector(validation.rows);
  const selectedSelector = validationSelectors.find((selector) => selector.id === validationSelection.selected.modelId);

  const finalSelectors = [
    ...reference,
    selectedSelector,
    selectors.product.find((selector) => selector.id === "causal_selector_ridge_error_score"),
    selectors.product.find((selector) => selector.id === "causal_selector_nn_prototype"),
    ...selectors.analysis,
  ].filter(Boolean);
  const finalEvaluation = evaluateDetailed(lib6, lib, step4Lib, models, traces, finalSelectors);
  const historyAmbiguity = ambiguityAnalysis(samples.ambiguityTrain, samples.ambiguityValidation, samples.ambiguityResumeValidation);
  const telemetryValue = buildTelemetryValue(finalEvaluation.scores);

  const result = {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUtc: new Date().toISOString(),
    constraints: {
      gpuUsed: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
      trainingRun: "CPU-only oracle observability ceiling and selector search",
      validationSelectsBest: true,
      testViewedAfterSelection: true,
    },
    sourceFiles: PACKAGES,
    splitDefinition: {
      method: split.method,
      ratio: split.ratio,
      counts: split.counts,
      train: split.train,
      validation: split.validation,
      test: split.test,
    },
    evaluationDesign: {
      anchor: "trace.csv event=poll",
      causalHistory: "referencePoll rows with elapsedMicroseconds <= anchor elapsedMicroseconds",
      label: "interpolated referencePoll at anchor + horizon",
      horizonsMs: HORIZONS_MS,
      basePredictors: BASE_MODEL_IDS,
    },
    featureSet: FEATURE_NAMES,
    sampleSummary: {
      seenTrain: samples.seenTrain,
      seenValidation: samples.seenValidation,
      trainSelectorSamples: samples.train.length,
      validationSelectorSamples: samples.validation.length,
      ambiguityTrainSamples: samples.ambiguityTrain.length,
      ambiguityValidationSamples: samples.ambiguityValidation.length,
      ambiguityResumeValidationSamples: samples.ambiguityResumeValidation.length,
    },
    trainingSummary: {
      step3TeacherLambda: step3Teacher.lambda,
      step4TrainExamples: step4Training.summary.trainExamples,
    },
    candidateList: validationSelectors.map((selector) => ({
      id: selector.id,
      family: selector.family,
      productEligible: Boolean(selector.productEligible),
      selectable: Boolean(selector.selectable),
      description: selector.description,
    })),
    validationSearch: {
      count: validation.count,
      ranking: validation.rows,
    },
    validationSelection,
    finalModelList: finalSelectors.map((selector) => ({
      id: selector.id,
      family: selector.family,
      productEligible: Boolean(selector.productEligible),
      selectable: Boolean(selector.selectable),
    })),
    scores: finalEvaluation.scores,
    finalLabelsMissing: finalEvaluation.labelsMissing,
    deltas: {
      step3_teacher_ridge_residual_segmented_horizon: deltaRows(finalEvaluation.scores, selectedSelector.id, "step3_teacher_ridge_residual_segmented_horizon"),
      step4_vfsmn_small_velocity: deltaRows(finalEvaluation.scores, selectedSelector.id, "step4_vfsmn_small_velocity"),
      step5_guarded_selected: deltaRows(finalEvaluation.scores, selectedSelector.id, "step5_guarded_selected"),
      step6_timing_gain_1p15: deltaRows(finalEvaluation.scores, selectedSelector.id, "step6_timing_gain_1p15"),
    },
    telemetryValue,
    historyAmbiguity,
  };
  result.zeroErrorFeasibility = buildZeroErrorFeasibility(result);
  result.nextStepRecommendation = buildNextStepRecommendation(result);

  fs.writeFileSync(path.join(args.outDir, "scores.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(args.outDir, "report.md"), buildReport(result), "utf8");
  fs.writeFileSync(path.join(args.outDir, "notes.md"), buildNotes(result), "utf8");
  process.stdout.write(`Wrote:
${path.relative(args.root, path.join(args.outDir, "report.md")).replaceAll(path.sep, "/")}
${path.relative(args.root, path.join(args.outDir, "scores.json")).replaceAll(path.sep, "/")}
${path.relative(args.root, path.join(args.outDir, "notes.md")).replaceAll(path.sep, "/")}
`);
}

main();
