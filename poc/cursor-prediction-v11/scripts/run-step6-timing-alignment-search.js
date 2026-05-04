#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCHEMA_VERSION = "cursor-prediction-v11-step6-timing-alignment-search/1";
const HORIZONS_MS = [0, 8, 16.67, 25, 33.33, 50];
const OFFSET_CANDIDATES_MS = [-16.67, -12, -8, -4, 0, 4, 8, 12, 16.67];
const GAIN_CANDIDATES = [0.85, 0.95, 1.0, 1.05, 1.15];
const REGRESSION_THRESHOLDS_PX = [1, 2, 5, 10];
const HISTOGRAM_BIN_PX = 0.25;
const HISTOGRAM_MAX_PX = 2048;
const HISTOGRAM_BINS = Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 1;
const MAX_INTERNAL_HORIZON_MS = 66.67;

const PACKAGES = [
  { id: "normal", label: "normal load", file: "cursor-mirror-motion-recording-20260503-212556.zip" },
  { id: "stress", label: "stress load", file: "cursor-mirror-motion-recording-20260503-215632.zip" },
];

const BASE_FEATURE_INDEX = {
  horizon: 1,
  anchorGap: 3,
  schedulerDelay: 4,
  historyMaxGap: 6,
  historyGapStd: 7,
  recentSpeed: 8,
  ls12Speed: 9,
  ls8Speed: 10,
  last2Speed: 11,
  acceleration: 12,
  stillness: 13,
  nearZero: 14,
  pathEfficiency: 15,
};

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  return {
    root,
    outDir: path.resolve(scriptDir, "..", "step-6-timing-alignment-search"),
    step1Scores: path.resolve(scriptDir, "..", "step-1-data-audit", "scores.json"),
    step3Script: path.resolve(scriptDir, "run-step3-learned-gates.js"),
    step4Script: path.resolve(scriptDir, "run-step4-fsmn-family-search.js"),
    args: argv.slice(2),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function makeSandbox(filename) {
  return {
    require,
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(filename),
    __filename: filename,
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
}

function loadStep3Library(step3Script) {
  let source = fs.readFileSync(step3Script, "utf8");
  source = source.replace(/\nmain\(\);\s*$/, "\n");
  source += `
module.exports = {
  parseSplit,
  loadTracePackage,
  trainModels,
  evaluateRidgeCandidates,
  predictLeastSquares,
  interpolateReference,
  featureVector,
  applyRidge,
  distance,
  HORIZONS_MS,
  FEATURE_NAMES,
};
`;
  const sandbox = makeSandbox(step3Script);
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: step3Script });
  return sandbox.module.exports;
}

function loadStep4Library(step4Script) {
  let source = fs.readFileSync(step4Script, "utf8");
  source = source.replace(/\nmain\(\);\s*$/, "\n");
  source += `
module.exports = {
  candidateSpecs,
  trainCandidates,
  predictCandidate,
  makeFeatures,
  applyTailGuard,
};
`;
  const sandbox = makeSandbox(step4Script);
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: step4Script });
  return sandbox.module.exports;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function dot(weights, features) {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) sum += weights[i] * features[i];
  return sum;
}

function addVectors(a, b, t) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] * (1 - t) + b[i] * t;
  return out;
}

function nearestHorizon(horizonMs) {
  let best = HORIZONS_MS[0];
  let bestDistance = Math.abs(horizonMs - best);
  for (const horizon of HORIZONS_MS.slice(1)) {
    const d = Math.abs(horizonMs - horizon);
    if (d < bestDistance) {
      best = horizon;
      bestDistance = d;
    }
  }
  return best;
}

function interpolationPair(horizonMs) {
  const h = clamp(horizonMs, HORIZONS_MS[0], HORIZONS_MS[HORIZONS_MS.length - 1]);
  if (h <= HORIZONS_MS[0]) return { left: HORIZONS_MS[0], right: HORIZONS_MS[0], t: 0 };
  for (let i = 1; i < HORIZONS_MS.length; i += 1) {
    const right = HORIZONS_MS[i];
    const left = HORIZONS_MS[i - 1];
    if (h <= right) {
      const t = right === left ? 0 : (h - left) / (right - left);
      return { left, right, t };
    }
  }
  const last = HORIZONS_MS[HORIZONS_MS.length - 1];
  return { left: last, right: last, t: 0 };
}

function interpolateRidgeCoefficients(coefficientsByHorizon, horizonMs) {
  const { left, right, t } = interpolationPair(horizonMs);
  const a = coefficientsByHorizon[String(left)];
  const b = coefficientsByHorizon[String(right)];
  if (!a || !b || left === right) return a || b;
  return {
    count: Math.min(a.count || 0, b.count || 0),
    lambda: a.lambda,
    weightsX: addVectors(a.weightsX, b.weightsX, t),
    weightsY: addVectors(a.weightsY, b.weightsY, t),
  };
}

function interpolateStep4Segment(model, horizonMs) {
  const { left, right, t } = interpolationPair(horizonMs);
  const a = model.segments.get(String(left));
  const b = model.segments.get(String(right));
  if (!a || !b || left === right) return a || b || model.fallback;
  return {
    count: Math.min(a.count || 0, b.count || 0),
    lambda: a.lambda,
    weightsX: addVectors(a.weightsX, b.weightsX, t),
    weightsY: addVectors(a.weightsY, b.weightsY, t),
  };
}

function sanitizeOffset(offsetMs) {
  if (offsetMs === 0) return "0";
  const sign = offsetMs > 0 ? "p" : "m";
  return `${sign}${String(Math.abs(offsetMs)).replace(".", "p")}`;
}

function sanitizeGain(gain) {
  return String(gain).replace(".", "p");
}

function internalHorizonForSpec(spec, horizonMs, context) {
  let offset = spec.offsetMs || 0;
  if (spec.offsetsByHorizon) offset = spec.offsetsByHorizon[String(horizonMs)] || 0;
  if (spec.conditionalOffsets) offset = conditionalOffset(spec, horizonMs, context);
  if (spec.oracleLoadOffset && context.trace.id === spec.oracleLoadOffset.load && horizonMs >= spec.oracleLoadOffset.minHorizonMs) {
    offset = spec.oracleLoadOffset.offsetMs;
  }
  if (spec.oracleCategoryOffset && (context.anchor.movementCategory || "unknown") === spec.oracleCategoryOffset.category && horizonMs >= spec.oracleCategoryOffset.minHorizonMs) {
    offset = spec.oracleCategoryOffset.offsetMs;
  }
  const gain = spec.gain === undefined ? 1 : spec.gain;
  return clamp(horizonMs * gain + offset, 0, MAX_INTERNAL_HORIZON_MS);
}

function conditionalOffset(spec, horizonMs, context) {
  const rule = spec.conditionalOffsets;
  const risk = context.risk;
  if (horizonMs < (rule.minHorizonMs || 0)) return 0;
  if (rule.type === "speed" && risk.recentSpeedNorm >= rule.threshold) return rule.offsetMs;
  if (rule.type === "scheduler" && risk.schedulerDelayNorm >= rule.threshold) return rule.offsetMs;
  if (rule.type === "disagreement" && risk.disagreementPx >= rule.threshold) return rule.offsetMs;
  if (rule.type === "lagRisk" && risk.lagRisk >= rule.threshold) return rule.offsetMs;
  if (rule.type === "stillResumeRisk" && risk.stillResumeRisk >= rule.threshold) return rule.offsetMs;
  return 0;
}

function createReferenceSpecs() {
  return [
    {
      id: "ls12_baseline",
      family: "reference",
      baseModel: "ls12",
      productEligible: true,
      selectable: false,
      description: "Step 2 LS12 cap64 at contract horizon.",
    },
    {
      id: "step3_teacher_ridge_residual_segmented_horizon",
      family: "reference",
      baseModel: "step3",
      productEligible: true,
      selectable: false,
      description: "Step 3 teacher at contract horizon.",
    },
    {
      id: "step4_vfsmn_small_velocity",
      family: "reference",
      baseModel: "step4",
      productEligible: true,
      selectable: false,
      description: "Step 4 selected VFSMN at contract horizon.",
    },
    {
      id: "step5_guarded_selected",
      family: "reference",
      baseModel: "step5",
      productEligible: true,
      selectable: false,
      description: "Step 5 selected guarded mixture at contract horizon.",
    },
  ];
}

function fixedOffsetSpecs() {
  const specs = [];
  for (const baseModel of ["ls12", "step3", "step4"]) {
    for (const offsetMs of OFFSET_CANDIDATES_MS) {
      specs.push({
        id: `${baseModel}_fixed_offset_${sanitizeOffset(offsetMs)}ms`,
        family: "fixed_offset",
        baseModel,
        offsetMs,
        gain: 1,
        productEligible: true,
        selectable: offsetMs !== 0,
        description: `${baseModel} with internal horizon = horizon + ${offsetMs} ms.`,
      });
    }
  }
  for (const offsetMs of [-8, -4, 0, 4, 8, 12]) {
    specs.push({
      id: `step5_fixed_offset_${sanitizeOffset(offsetMs)}ms`,
      family: "fixed_offset",
      baseModel: "step5",
      offsetMs,
      gain: 1,
      productEligible: true,
      selectable: offsetMs !== 0,
      description: `Step 5 guard with internal horizon = horizon + ${offsetMs} ms.`,
    });
  }
  return specs;
}

function gainSpecs() {
  const specs = [];
  for (const baseModel of ["ls12", "step3", "step4"]) {
    for (const gain of GAIN_CANDIDATES) {
      specs.push({
        id: `${baseModel}_gain_${sanitizeGain(gain)}`,
        family: "fixed_gain",
        baseModel,
        offsetMs: 0,
        gain,
        productEligible: true,
        selectable: gain !== 1.0,
        description: `${baseModel} with internal horizon = horizon * ${gain}.`,
      });
    }
  }
  return specs;
}

function conditionalSpecs() {
  return [
    { baseModel: "step4", type: "speed", threshold: 0.65, offsetMs: 4, minHorizonMs: 16.67 },
    { baseModel: "step4", type: "speed", threshold: 0.65, offsetMs: 8, minHorizonMs: 25 },
    { baseModel: "step4", type: "scheduler", threshold: 0.18, offsetMs: 4, minHorizonMs: 16.67 },
    { baseModel: "step4", type: "disagreement", threshold: 4, offsetMs: 4, minHorizonMs: 16.67 },
    { baseModel: "step4", type: "lagRisk", threshold: 1.2, offsetMs: 4, minHorizonMs: 25 },
    { baseModel: "step3", type: "lagRisk", threshold: 1.2, offsetMs: 4, minHorizonMs: 25 },
    { baseModel: "step4", type: "stillResumeRisk", threshold: 1.5, offsetMs: 8, minHorizonMs: 25 },
    { baseModel: "step5", type: "lagRisk", threshold: 1.2, offsetMs: 4, minHorizonMs: 25 },
  ].map((rule) => ({
    id: `${rule.baseModel}_conditional_${rule.type}_t${String(rule.threshold).replace(".", "p")}_${sanitizeOffset(rule.offsetMs)}ms_h${String(rule.minHorizonMs).replace(".", "p")}`,
    family: "causal_conditional_offset",
    baseModel: rule.baseModel,
    conditionalOffsets: rule,
    productEligible: true,
    selectable: true,
    description: `${rule.baseModel} applies +${rule.offsetMs} ms when causal ${rule.type} risk >= ${rule.threshold} and horizon >= ${rule.minHorizonMs}.`,
  }));
}

function analysisOnlySpecs() {
  return [
    {
      id: "analysis_stress_long_step4_plus8",
      family: "analysis_load_offset",
      baseModel: "step4",
      oracleLoadOffset: { load: "stress", minHorizonMs: 25, offsetMs: 8 },
      productEligible: false,
      selectable: false,
      description: "Analysis-only load-id offset: stress long horizons use +8 ms.",
    },
    {
      id: "analysis_resume_step4_plus8",
      family: "analysis_category_offset",
      baseModel: "step4",
      oracleCategoryOffset: { category: "resume", minHorizonMs: 16.67, offsetMs: 8 },
      productEligible: false,
      selectable: false,
      description: "Analysis-only script-category offset: resume horizons >=16.67 use +8 ms.",
    },
    {
      id: "analysis_resume_step3_plus8",
      family: "analysis_category_offset",
      baseModel: "step3",
      oracleCategoryOffset: { category: "resume", minHorizonMs: 16.67, offsetMs: 8 },
      productEligible: false,
      selectable: false,
      description: "Analysis-only script-category offset on Step 3 teacher.",
    },
  ];
}

function baseCandidateSpecs() {
  return [
    ...createReferenceSpecs(),
    ...fixedOffsetSpecs(),
    ...gainSpecs(),
    ...conditionalSpecs(),
    ...analysisOnlySpecs(),
  ];
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
    signedLagCount: 0,
    signedLeadCount: 0,
  };
}

function addError(acc, error, signedLeadPx = null) {
  if (!Number.isFinite(error)) return;
  acc.count += 1;
  acc.sum += error;
  acc.sumSquares += error * error;
  if (error > acc.max) acc.max = error;
  const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(error / HISTOGRAM_BIN_PX)));
  acc.histogram[bin] += 1;
  for (const threshold of REGRESSION_THRESHOLDS_PX) {
    if (error > threshold) acc.regressions[`gt${threshold}px`] += 1;
  }
  if (Number.isFinite(signedLeadPx)) {
    acc.signedCount += 1;
    acc.signedSum += signedLeadPx;
    acc.signedAbsSum += Math.abs(signedLeadPx);
    if (signedLeadPx < -0.25) acc.signedLagCount += 1;
    if (signedLeadPx > 0.25) acc.signedLeadCount += 1;
  }
}

function percentile(histogram, count, p) {
  if (count <= 0) return null;
  const target = Math.max(1, Math.ceil(count * p));
  let cumulative = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= target) return i * HISTOGRAM_BIN_PX;
  }
  return HISTOGRAM_MAX_PX;
}

function finalize(acc) {
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
      signedLead: { count: 0, mean: null, meanAbs: null, lagRate: null, leadRate: null },
    };
  }
  return {
    count: acc.count,
    mean: round(acc.sum / acc.count),
    median: round(percentile(acc.histogram, acc.count, 0.5)),
    p95: round(percentile(acc.histogram, acc.count, 0.95)),
    p99: round(percentile(acc.histogram, acc.count, 0.99)),
    max: round(acc.max),
    rmse: round(Math.sqrt(acc.sumSquares / acc.count)),
    regressionRates: Object.fromEntries(REGRESSION_THRESHOLDS_PX.map((threshold) => {
      const key = `gt${threshold}px`;
      return [key, round(acc.regressions[key] / acc.count, 6)];
    })),
    signedLead: {
      count: acc.signedCount,
      mean: acc.signedCount ? round(acc.signedSum / acc.signedCount) : null,
      meanAbs: acc.signedCount ? round(acc.signedAbsSum / acc.signedCount) : null,
      lagRate: acc.signedCount ? round(acc.signedLagCount / acc.signedCount, 6) : null,
      leadRate: acc.signedCount ? round(acc.signedLeadCount / acc.signedCount, 6) : null,
    },
  };
}

function metricKey(parts) {
  return parts.join("\t");
}

function parseKey(key, fields) {
  const parts = key.split("\t");
  return Object.fromEntries(fields.map((field, index) => [field, parts[index]]));
}

function addToMap(map, key, error, signedLeadPx) {
  let acc = map.get(key);
  if (!acc) {
    acc = createAccumulator();
    map.set(key, acc);
  }
  addError(acc, error, signedLeadPx);
}

class DetailScoreStore {
  constructor() {
    this.maps = {
      overallScores: new Map(),
      perSplitScores: new Map(),
      perLoadConditionScores: new Map(),
      perHorizonScores: new Map(),
      perMovementCategoryScores: new Map(),
      perSchedulerDelayBinScores: new Map(),
      perSplitHorizonLoadScores: new Map(),
      perValidationTestCategoryHorizonScores: new Map(),
      signedLagLeadByHorizonScores: new Map(),
    };
  }

  addObservation(model, trace, anchor, horizonMs, error, signedLeadPx) {
    const base = [model.id, model.family, model.productEligible ? "1" : "0"];
    const split = anchor.split;
    const load = trace.id;
    const category = anchor.movementCategory || "unknown";
    const schedulerBin = anchor.schedulerDelayBin || "missing";
    addToMap(this.maps.overallScores, metricKey(base), error, signedLeadPx);
    addToMap(this.maps.perSplitScores, metricKey([...base, split, load]), error, signedLeadPx);
    addToMap(this.maps.perLoadConditionScores, metricKey([...base, load]), error, signedLeadPx);
    addToMap(this.maps.perHorizonScores, metricKey([...base, String(horizonMs), load]), error, signedLeadPx);
    addToMap(this.maps.perMovementCategoryScores, metricKey([...base, category, load]), error, signedLeadPx);
    addToMap(this.maps.perSchedulerDelayBinScores, metricKey([...base, schedulerBin, load]), error, signedLeadPx);
    addToMap(this.maps.perSplitHorizonLoadScores, metricKey([...base, split, String(horizonMs), load]), error, signedLeadPx);
    if (split === "validation" || split === "test") {
      addToMap(this.maps.perValidationTestCategoryHorizonScores, metricKey([...base, split, String(horizonMs), load, category]), error, signedLeadPx);
      addToMap(this.maps.signedLagLeadByHorizonScores, metricKey([...base, split, String(horizonMs), load, category]), error, signedLeadPx);
    }
  }

  finalize() {
    const result = {};
    result.overallScores = finalizeMap(this.maps.overallScores, ["modelId", "family", "productEligible"]);
    result.perSplitScores = finalizeMap(this.maps.perSplitScores, ["modelId", "family", "productEligible", "split", "loadCondition"]);
    result.perLoadConditionScores = finalizeMap(this.maps.perLoadConditionScores, ["modelId", "family", "productEligible", "loadCondition"]);
    result.perHorizonScores = finalizeMap(this.maps.perHorizonScores, ["modelId", "family", "productEligible", "horizonMs", "loadCondition"]);
    result.perMovementCategoryScores = finalizeMap(this.maps.perMovementCategoryScores, ["modelId", "family", "productEligible", "movementCategory", "loadCondition"]);
    result.perSchedulerDelayBinScores = finalizeMap(this.maps.perSchedulerDelayBinScores, ["modelId", "family", "productEligible", "schedulerDelayBin", "loadCondition"]);
    result.perSplitHorizonLoadScores = finalizeMap(this.maps.perSplitHorizonLoadScores, ["modelId", "family", "productEligible", "split", "horizonMs", "loadCondition"]);
    result.perValidationTestCategoryHorizonScores = finalizeMap(this.maps.perValidationTestCategoryHorizonScores, ["modelId", "family", "productEligible", "split", "horizonMs", "loadCondition", "movementCategory"]);
    result.signedLagLeadByHorizonScores = finalizeMap(this.maps.signedLagLeadByHorizonScores, ["modelId", "family", "productEligible", "split", "horizonMs", "loadCondition", "movementCategory"]);
    for (const rows of Object.values(result)) {
      for (const row of rows) {
        row.productEligible = row.productEligible === "1";
        if (row.horizonMs !== undefined) row.horizonMs = Number(row.horizonMs);
      }
    }
    return result;
  }
}

function finalizeMap(map, fields) {
  return [...map.entries()].map(([key, acc]) => ({
    ...parseKey(key, fields),
    error: finalize(acc),
  }));
}

function makeValidationEntry(spec) {
  return {
    spec,
    overall: createAccumulator(),
    byLoad: new Map(),
    byHorizon: new Map(),
    resumeTail: createAccumulator(),
    longHorizon: createAccumulator(),
  };
}

function addValidationObservation(entry, trace, anchor, horizonMs, error, signedLeadPx) {
  addError(entry.overall, error, signedLeadPx);
  addMapAccumulator(entry.byLoad, trace.id, error, signedLeadPx);
  addMapAccumulator(entry.byHorizon, String(horizonMs), error, signedLeadPx);
  if ((anchor.movementCategory || "unknown") === "resume" && horizonMs >= 16.67) {
    addError(entry.resumeTail, error, signedLeadPx);
  }
  if (horizonMs >= 25) addError(entry.longHorizon, error, signedLeadPx);
}

function addMapAccumulator(map, key, error, signedLeadPx) {
  let acc = map.get(key);
  if (!acc) {
    acc = createAccumulator();
    map.set(key, acc);
  }
  addError(acc, error, signedLeadPx);
}

function contextAtContractHorizon(lib, step4Lib, models, trace, anchor, horizonMs) {
  const baseline = predictAligned(lib, step4Lib, models, "ls12", trace, anchor, horizonMs, horizonMs);
  const features = lib.featureVector(trace, anchor, horizonMs, baseline);
  const step3 = predictAligned(lib, step4Lib, models, "step3", trace, anchor, horizonMs, horizonMs);
  const step4 = predictAligned(lib, step4Lib, models, "step4", trace, anchor, horizonMs, horizonMs);
  const disagreementPx = Math.max(
    distancePred(baseline, step3),
    distancePred(baseline, step4),
    distancePred(step3, step4),
  );
  const speedSpread = Math.max(
    Math.abs(features[BASE_FEATURE_INDEX.ls12Speed] - features[BASE_FEATURE_INDEX.ls8Speed]),
    Math.abs(features[BASE_FEATURE_INDEX.ls12Speed] - features[BASE_FEATURE_INDEX.last2Speed]),
    Math.abs(features[BASE_FEATURE_INDEX.ls8Speed] - features[BASE_FEATURE_INDEX.last2Speed]),
  );
  const risk = {
    recentSpeedNorm: Math.max(0, features[BASE_FEATURE_INDEX.recentSpeed]),
    schedulerDelayNorm: Math.abs(features[BASE_FEATURE_INDEX.schedulerDelay] || 0),
    disagreementPx,
    lagRisk: round(
      0.65 * clamp(disagreementPx / 12, 0, 4)
      + 0.45 * clamp(features[BASE_FEATURE_INDEX.historyMaxGap], 0, 4)
      + 0.35 * clamp(features[BASE_FEATURE_INDEX.historyGapStd], 0, 4)
      + 0.35 * speedSpread
      + 0.25 * Math.abs(features[BASE_FEATURE_INDEX.anchorGap] || 0),
      6,
    ),
    stillResumeRisk: round(
      0.65 * clamp(features[BASE_FEATURE_INDEX.nearZero], 0, 1.5)
      + 0.45 * clamp(features[BASE_FEATURE_INDEX.stillness], 0, 1.5)
      + 0.7 * clamp(features[BASE_FEATURE_INDEX.acceleration], 0, 3)
      + 0.35 * clamp(1 - features[BASE_FEATURE_INDEX.pathEfficiency], 0, 1),
      6,
    ),
  };
  return { trace, anchor, horizonMs, features, baseline, step3, step4, risk };
}

function predictAligned(lib, step4Lib, models, baseModel, trace, anchor, targetHorizonMs, internalHorizonMs) {
  const cacheKey = `${baseModel}:${round(internalHorizonMs, 3)}`;
  if (!anchor._step6PredictionCache) anchor._step6PredictionCache = new Map();
  if (anchor._step6PredictionCache.has(cacheKey)) return anchor._step6PredictionCache.get(cacheKey);
  const internal = clamp(internalHorizonMs, 0, MAX_INTERNAL_HORIZON_MS);
  let pred;
  if (baseModel === "ls12") {
    pred = lib.predictLeastSquares(trace, anchor, internal, 12, 64);
  } else if (baseModel === "step3") {
    const baseline = lib.predictLeastSquares(trace, anchor, internal, 12, 64);
    const features = lib.featureVector(trace, anchor, internal, baseline);
    const coeff = interpolateRidgeCoefficients(models.step3Teacher.coefficientsByHorizon, internal);
    pred = lib.applyRidge(baseline, features, coeff);
  } else if (baseModel === "step4") {
    const baseline = lib.predictLeastSquares(trace, anchor, internal, 12, 64);
    const baseFeatures = lib.featureVector(trace, anchor, internal, baseline);
    const features = step4Lib.makeFeatures(models.step4Model.spec, baseFeatures, anchor, trace, internal);
    const seg = interpolateStep4Segment(models.step4Model, internal);
    if (!seg) {
      pred = baseline;
    } else {
      let dx = dot(seg.weightsX, features);
      let dy = dot(seg.weightsY, features);
      ({ dx, dy } = step4Lib.applyTailGuard(models.step4Model.spec, dx, dy, baseFeatures, internal));
      pred = { x: baseline.x + dx, y: baseline.y + dy };
    }
  } else if (baseModel === "step5") {
    const step4 = predictAligned(lib, step4Lib, models, "step4", trace, anchor, targetHorizonMs, internal);
    const step3 = predictAligned(lib, step4Lib, models, "step3", trace, anchor, targetHorizonMs, internal);
    const baseline = lib.predictLeastSquares(trace, anchor, internal, 12, 64);
    const features = lib.featureVector(trace, anchor, internal, baseline);
    const risk = stillToMotionRisk(features);
    pred = (risk >= 1.4 && targetHorizonMs >= 25) ? step3 : step4;
  } else {
    throw new Error(`Unknown base model: ${baseModel}`);
  }
  anchor._step6PredictionCache.set(cacheKey, pred);
  return pred;
}

function stillToMotionRisk(features) {
  return round(
    0.75 * clamp(features[BASE_FEATURE_INDEX.nearZero], 0, 1.5)
    + 0.45 * clamp(features[BASE_FEATURE_INDEX.stillness], 0, 1.5)
    + 0.75 * Math.max(0, clamp(features[BASE_FEATURE_INDEX.recentSpeed], 0, 3) - 0.05)
    + 0.65 * clamp(features[BASE_FEATURE_INDEX.acceleration], 0, 3)
    + 0.35 * clamp(1 - features[BASE_FEATURE_INDEX.pathEfficiency], 0, 1),
    6,
  );
}

function predictSpec(lib, step4Lib, models, spec, trace, anchor, horizonMs, context) {
  const internalHorizon = internalHorizonForSpec(spec, horizonMs, context);
  return predictAligned(lib, step4Lib, models, spec.baseModel, trace, anchor, horizonMs, internalHorizon);
}

function distancePred(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function motionUnit(trace, anchor) {
  const i = anchor.refIndex;
  if (i <= 0) return null;
  const currentX = trace.refX[i];
  const currentY = trace.refY[i];
  for (let lookback = 1; lookback <= Math.min(6, i); lookback += 1) {
    const j = i - lookback;
    const dx = currentX - trace.refX[j];
    const dy = currentY - trace.refY[j];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= 0.5) return { x: dx / d, y: dy / d };
  }
  return null;
}

function signedLead(pred, target, unit) {
  if (!unit) return null;
  return (pred.x - target.x) * unit.x + (pred.y - target.y) * unit.y;
}

function evaluateValidation(lib, step4Lib, traces, models, specs) {
  const entries = new Map(specs.map((spec) => [spec.id, makeValidationEntry(spec)]));
  let examples = 0;
  let labelsMissing = 0;
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      if (anchor.split !== "validation") continue;
      anchor.cache = Object.create(null);
      anchor._step6PredictionCache = new Map();
      for (const horizonMs of HORIZONS_MS) {
        const target = lib.interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) {
          labelsMissing += 1;
          continue;
        }
        const context = contextAtContractHorizon(lib, step4Lib, models, trace, anchor, horizonMs);
        const unit = motionUnit(trace, anchor);
        for (const spec of specs) {
          const pred = predictSpec(lib, step4Lib, models, spec, trace, anchor, horizonMs, context);
          const error = lib.distance(pred.x, pred.y, target.x, target.y);
          addValidationObservation(entries.get(spec.id), trace, anchor, horizonMs, error, signedLead(pred, target, unit));
        }
        examples += 1;
      }
    }
  }
  const rows = [...entries.values()].map(finalizeValidationEntry);
  applyTimingObjective(rows);
  rows.sort((a, b) => (a.guardrailPass === b.guardrailPass ? 0 : a.guardrailPass ? -1 : 1)
    || a.objective - b.objective
    || Math.abs(a.offsetMagnitude || 0) - Math.abs(b.offsetMagnitude || 0)
    || (a.overall.mean ?? Infinity) - (b.overall.mean ?? Infinity));
  return { rows, summary: { examples, labelsMissing, candidateCount: specs.length } };
}

function finalizeValidationEntry(entry) {
  const spec = entry.spec;
  const row = {
    modelId: spec.id,
    family: spec.family,
    baseModel: spec.baseModel,
    productEligible: Boolean(spec.productEligible),
    selectable: Boolean(spec.selectable),
    description: spec.description,
    offsetMs: spec.offsetMs,
    gain: spec.gain,
    offsetMagnitude: offsetMagnitude(spec),
    objective: null,
    guardrailPass: null,
    overall: finalize(entry.overall),
    byLoad: Object.fromEntries([...entry.byLoad.entries()].map(([load, acc]) => [load, finalize(acc)])),
    byHorizon: Object.fromEntries([...entry.byHorizon.entries()].map(([horizon, acc]) => [horizon, finalize(acc)])),
    resumeTail: finalize(entry.resumeTail),
    longHorizon: finalize(entry.longHorizon),
  };
  return row;
}

function offsetMagnitude(spec) {
  if (spec.offsetsByHorizon) {
    return Object.values(spec.offsetsByHorizon).reduce((sum, value) => sum + Math.abs(value), 0) / HORIZONS_MS.length;
  }
  if (spec.conditionalOffsets) return Math.abs(spec.conditionalOffsets.offsetMs) * 0.5;
  if (spec.gain !== undefined && spec.gain !== 1) return Math.abs(spec.gain - 1) * 50;
  return Math.abs(spec.offsetMs || 0);
}

function applyTimingObjective(rows) {
  const refs = ["step3_teacher_ridge_residual_segmented_horizon", "step4_vfsmn_small_velocity", "step5_guarded_selected"]
    .map((id) => rows.find((row) => row.modelId === id))
    .filter(Boolean);
  for (const row of rows) {
    const signed = row.longHorizon.signedLead;
    const lagPenalty = signed.mean !== null
      ? 2.4 * Math.max(0, -signed.mean) + 7.5 * (signed.lagRate ?? 0) + 0.6 * (signed.meanAbs ?? 0)
      : 0;
    const leadPenalty = signed.mean !== null ? 0.7 * Math.max(0, signed.mean) + 2.0 * (signed.leadRate ?? 0) : 0;
    const gt5 = row.overall.regressionRates.gt5px ?? 1;
    const gt10 = row.overall.regressionRates.gt10px ?? 1;
    row.objective = round(
      (row.overall.p95 ?? 999)
      + 0.4 * (row.overall.p99 ?? 999)
      + 35 * gt5
      + 130 * gt10
      + 0.8 * (row.resumeTail.p95 ?? 0)
      + 0.35 * (row.resumeTail.p99 ?? 0)
      + 0.55 * (row.longHorizon.p95 ?? 0)
      + 0.25 * (row.longHorizon.p99 ?? 0)
      + lagPenalty
      + leadPenalty
      + offsetMagnitude(row) * 0.04
      + validationRegressionPenalty(row, refs),
      6,
    );
    row.guardrailPass = row.productEligible && row.selectable && validationGuardrailPass(row, refs);
  }
}

function validationRegressionPenalty(row, refs) {
  if (!refs.length || refs.some((ref) => ref.modelId === row.modelId)) return 0;
  const bestOverallP95 = Math.min(...refs.map((ref) => ref.overall.p95 ?? 999));
  const bestOverallP99 = Math.min(...refs.map((ref) => ref.overall.p99 ?? 999));
  const bestResumeP95 = Math.min(...refs.map((ref) => ref.resumeTail.p95 ?? 999));
  const bestResumeP99 = Math.min(...refs.map((ref) => ref.resumeTail.p99 ?? 999));
  let penalty = 0;
  penalty += Math.max(0, (row.overall.p95 ?? 999) - bestOverallP95 - 0.25) * 14;
  penalty += Math.max(0, (row.overall.p99 ?? 999) - bestOverallP99 - 0.5) * 5;
  penalty += Math.max(0, (row.resumeTail.p95 ?? 999) - bestResumeP95 - 0.5) * 8;
  penalty += Math.max(0, (row.resumeTail.p99 ?? 999) - bestResumeP99 - 1.0) * 3;
  const bestGt10 = Math.min(...refs.map((ref) => ref.overall.regressionRates.gt10px ?? 1));
  penalty += Math.max(0, (row.overall.regressionRates.gt10px ?? 1) - bestGt10 - 0.0005) * 1000;
  return penalty;
}

function validationGuardrailPass(row, refs) {
  if (!refs.length) return false;
  const bestOverallP95 = Math.min(...refs.map((ref) => ref.overall.p95 ?? 999));
  const bestOverallP99 = Math.min(...refs.map((ref) => ref.overall.p99 ?? 999));
  const bestResumeP95 = Math.min(...refs.map((ref) => ref.resumeTail.p95 ?? 999));
  const bestResumeP99 = Math.min(...refs.map((ref) => ref.resumeTail.p99 ?? 999));
  if ((row.overall.p95 ?? 999) > bestOverallP95 + 0.25) return false;
  if ((row.overall.p99 ?? 999) > bestOverallP99 + 0.5) return false;
  if ((row.resumeTail.p95 ?? 999) > bestResumeP95 + 0.5) return false;
  if ((row.resumeTail.p99 ?? 999) > bestResumeP99 + 1.0) return false;
  const bestGt10 = Math.min(...refs.map((ref) => ref.overall.regressionRates.gt10px ?? 1));
  if ((row.overall.regressionRates.gt10px ?? 1) > bestGt10 + 0.0005) return false;
  return true;
}

function buildHorizonSpecificSpecs(validationRows) {
  const specs = [];
  const selections = [];
  for (const baseModel of ["ls12", "step3", "step4"]) {
    const offsetsByHorizon = {};
    for (const horizon of HORIZONS_MS) {
      const prefix = `${baseModel}_fixed_offset_`;
      const candidates = validationRows
        .filter((row) => row.modelId.startsWith(prefix))
        .map((row) => {
          const metric = row.byHorizon[String(horizon)];
          return {
            row,
            metric,
            score: horizonObjective(metric, row.offsetMs || 0),
          };
        })
        .filter((row) => row.metric && row.metric.count > 0)
        .sort((a, b) => a.score - b.score || Math.abs(a.row.offsetMs || 0) - Math.abs(b.row.offsetMs || 0));
      const selected = candidates[0];
      offsetsByHorizon[String(horizon)] = selected?.row.offsetMs || 0;
      selections.push({
        baseModel,
        horizonMs: horizon,
        offsetMs: offsetsByHorizon[String(horizon)],
        validationScore: selected ? round(selected.score, 6) : null,
        p95: selected?.metric.p95 ?? null,
        p99: selected?.metric.p99 ?? null,
        signedLeadMean: selected?.metric.signedLead.mean ?? null,
        lagRate: selected?.metric.signedLead.lagRate ?? null,
      });
    }
    specs.push({
      id: `${baseModel}_horizon_specific_offset_valbest`,
      family: "horizon_specific_offset",
      baseModel,
      offsetsByHorizon,
      productEligible: true,
      selectable: true,
      description: `${baseModel} horizon-specific offsets selected on validation with small regularization.`,
    });
  }
  return { specs, selections };
}

function horizonObjective(metric, offsetMs) {
  if (!metric) return Infinity;
  const signed = metric.signedLead;
  return (metric.p95 ?? 999)
    + 0.4 * (metric.p99 ?? 999)
    + 60 * (metric.regressionRates.gt10px ?? 1)
    + 1.8 * Math.max(0, -(signed.mean ?? 0))
    + 5 * (signed.lagRate ?? 0)
    + Math.abs(offsetMs) * 0.05;
}

function selectCandidate(validationRows) {
  const selectable = validationRows.filter((row) => row.productEligible && row.selectable);
  const passing = selectable.find((row) => row.guardrailPass);
  return {
    selected: passing || selectable[0],
    guardrailPassed: Boolean(passing),
    top10: validationRows.slice(0, 10),
    topSelectable10: selectable.slice(0, 10),
  };
}

function evaluateDetailed(lib, step4Lib, traces, models, specs) {
  const store = new DetailScoreStore();
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
        const context = contextAtContractHorizon(lib, step4Lib, models, trace, anchor, horizonMs);
        const unit = motionUnit(trace, anchor);
        for (const spec of specs) {
          const pred = predictSpec(lib, step4Lib, models, spec, trace, anchor, horizonMs, context);
          const error = lib.distance(pred.x, pred.y, target.x, target.y);
          store.addObservation(spec, trace, anchor, horizonMs, error, signedLead(pred, target, unit));
        }
      }
    }
  }
  return { scores: store.finalize(), labelsMissing };
}

function scoreLookup(scores, modelId, split, loadCondition) {
  return scores.perSplitScores.find((row) => row.modelId === modelId && row.split === split && row.loadCondition === loadCondition);
}

function horizonLookup(scores, modelId, split, loadCondition, horizonMs) {
  return scores.perSplitHorizonLoadScores.find((row) => row.modelId === modelId
    && row.split === split
    && row.loadCondition === loadCondition
    && Number(row.horizonMs) === Number(horizonMs));
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
        gt5Delta: round(cand.error.regressionRates.gt5px - base.error.regressionRates.gt5px, 6),
        gt10Delta: round(cand.error.regressionRates.gt10px - base.error.regressionRates.gt10px, 6),
        signedLeadMeanDelta: round((cand.error.signedLead.mean ?? 0) - (base.error.signedLead.mean ?? 0), 4),
        lagRateDelta: round((cand.error.signedLead.lagRate ?? 0) - (base.error.signedLead.lagRate ?? 0), 6),
      });
    }
  }
  return rows;
}

function horizonDeltaRows(scores, candidateId, baselineId) {
  const rows = [];
  for (const load of ["normal", "stress"]) {
    for (const horizon of HORIZONS_MS) {
      const base = horizonLookup(scores, baselineId, "test", load, horizon);
      const cand = horizonLookup(scores, candidateId, "test", load, horizon);
      if (!base || !cand) continue;
      rows.push({
        loadCondition: load,
        horizonMs: horizon,
        baselineP95: base.error.p95,
        candidateP95: cand.error.p95,
        p95Delta: round(cand.error.p95 - base.error.p95),
        baselineP99: base.error.p99,
        candidateP99: cand.error.p99,
        p99Delta: round(cand.error.p99 - base.error.p99),
        baselineSignedLeadMean: base.error.signedLead.mean,
        candidateSignedLeadMean: cand.error.signedLead.mean,
        signedLeadMeanDelta: round((cand.error.signedLead.mean ?? 0) - (base.error.signedLead.mean ?? 0), 4),
        candidateLagRate: cand.error.signedLead.lagRate,
      });
    }
  }
  return rows;
}

function buildInterpretation(result) {
  const selected = result.validationSelection.selected.modelId;
  const testVsStep3 = result.deltaVsStep3Teacher.filter((row) => row.split === "test");
  const tailRegressions = testVsStep3.filter((row) => row.p95Delta > 0 || row.p99Delta > 0 || row.gt10Delta > 0.0005);
  const lagImproved = testVsStep3.some((row) => row.signedLeadMeanDelta > 0.05 || row.lagRateDelta < -0.005);
  const tailImproved = testVsStep3.some((row) => row.p95Delta < 0 || row.p99Delta < 0);
  if (tailRegressions.length) {
    return `\`${selected}\` was validation-selected, but test shows tail regression in ${tailRegressions.map((row) => row.loadCondition).join(", ")}. Timing offset alone is not production-safe; it can move signed bias while increasing tail risk.`;
  }
  if (tailImproved || lagImproved) {
    return `\`${selected}\` improves timing alignment without aggregate test tail regression. This suggests a small prediction time offset/horizon compensation is a plausible product-side knob, but it still needs native runtime confirmation because this script evaluates replayed referencePoll traces, not compositor/display latency directly.`;
  }
  return `\`${selected}\` passed validation guardrails but did not materially reduce test tail or signed lag versus the Step 3/4/5 references. The remaining residual is more consistent with causal feature/selector insufficiency and resume-state ambiguity than with a single global prediction-time offset.`;
}

function buildNextStepRecommendation(result) {
  const testVsStep3 = result.deltaVsStep3Teacher.filter((row) => row.split === "test");
  const tailRegressions = testVsStep3.filter((row) => row.p95Delta > 0 || row.p99Delta > 0 || row.gt10Delta > 0.0005);
  const lagImproved = testVsStep3.some((row) => row.signedLeadMeanDelta > 0.05 || row.lagRateDelta < -0.005);
  if (!tailRegressions.length && lagImproved) {
    return "Step 7 should prototype the selected offset as a runtime horizon-compensation parameter behind a feature flag, then validate against fresh traces with real present/compositor timing markers.";
  }
  return "Step 7 should prioritize additional causal observability: explicit prediction-target timestamp, present/compositor timestamp, hold/resume transition markers, and missing-scheduler/warm-up flags. Keep Step 3/5 as safety references until timing telemetry can disambiguate model error from display-time offset.";
}

function buildReport(result) {
  const selectedId = result.validationSelection.selected.modelId;
  const candidateRows = result.candidateList.map((spec) => [
    spec.id,
    spec.family,
    spec.baseModel,
    spec.productEligible ? "yes" : "no",
    spec.selectable ? "yes" : "no",
    spec.offsetMs ?? "",
    spec.gain ?? "",
    spec.description,
  ]);
  const selectionRows = result.validationSelection.topSelectable10.map((row) => [
    row.modelId,
    row.family,
    row.baseModel,
    row.guardrailPass ? "yes" : "no",
    fmt(row.objective),
    fmt(row.overall.mean),
    fmt(row.overall.p95),
    fmt(row.overall.p99),
    fmt(row.resumeTail.p95),
    fmt(row.longHorizon.signedLead.mean),
    fmt(row.longHorizon.signedLead.lagRate, 6),
  ]);
  const deltaTable = (rows) => table(
    ["split", "load", "base mean", "cand mean", "mean d", "base p95", "cand p95", "p95 d", "base p99", "cand p99", "p99 d", "signed d", "lag d"],
    rows.map((row) => [
      row.split,
      row.loadCondition,
      fmt(row.baselineMean),
      fmt(row.candidateMean),
      fmt(row.meanDelta),
      fmt(row.baselineP95),
      fmt(row.candidateP95),
      fmt(row.p95Delta),
      fmt(row.baselineP99),
      fmt(row.candidateP99),
      fmt(row.p99Delta),
      fmt(row.signedLeadMeanDelta),
      fmt(row.lagRateDelta, 6),
    ]),
  );
  const horizonRows = result.testHorizonDeltaVsStep3.map((row) => [
    row.loadCondition,
    row.horizonMs,
    fmt(row.baselineP95),
    fmt(row.candidateP95),
    fmt(row.p95Delta),
    fmt(row.baselineP99),
    fmt(row.candidateP99),
    fmt(row.p99Delta),
    fmt(row.baselineSignedLeadMean),
    fmt(row.candidateSignedLeadMean),
    fmt(row.signedLeadMeanDelta),
    fmt(row.candidateLagRate, 6),
  ]);
  const categoryRows = result.scores.perValidationTestCategoryHorizonScores
    .filter((row) => row.modelId === selectedId && row.split === "test")
    .map((row) => [
      row.loadCondition,
      row.horizonMs,
      row.movementCategory,
      row.error.count,
      fmt(row.error.mean),
      fmt(row.error.p95),
      fmt(row.error.p99),
      fmt(row.error.signedLead.mean),
      fmt(row.error.signedLead.lagRate, 6),
    ]);
  const signedRows = result.scores.signedLagLeadByHorizonScores
    .filter((row) => row.modelId === selectedId && row.split === "test" && row.movementCategory === "moving")
    .map((row) => [
      row.loadCondition,
      row.horizonMs,
      row.error.signedLead.count,
      fmt(row.error.signedLead.mean),
      fmt(row.error.signedLead.meanAbs),
      fmt(row.error.signedLead.lagRate, 6),
      fmt(row.error.signedLead.leadRate, 6),
    ]);
  const horizonSpecificRows = result.horizonSpecificSelections.map((row) => [
    row.baseModel,
    row.horizonMs,
    row.offsetMs,
    fmt(row.validationScore),
    fmt(row.p95),
    fmt(row.p99),
    fmt(row.signedLeadMean),
    fmt(row.lagRate, 6),
  ]);

  return `# Step 6 Timing Alignment Search

## Intent

This step tests whether residual lag/tail can be explained by prediction-time alignment rather than model capacity. The evaluation contract remains unchanged from Steps 2-5: product poll anchors, causal referencePoll history, Step 1 scenario split, and labels at anchor + horizon for horizons ${HORIZONS_MS.join(", ")} ms. Candidates change the predictor's internal horizon only; labels stay fixed.

## Timing Objective And Guardrails

Validation selects the candidate. The objective weights p95/p99, >5px/>10px, resume-tail horizons, long-horizon signed lag, and offset magnitude. Guardrails reject product candidates whose validation p95/p99/>10px/resume tail regress beyond small tolerances versus Step 3 teacher, Step 4 selected, and Step 5 selected. Positive signed lead means prediction is ahead of the causal motion direction; negative means lagging.

## Candidate List

${table(["model", "family", "base", "product", "selectable", "offset", "gain", "description"], candidateRows)}

## Horizon-Specific Validation Choices

${table(["base", "horizon", "offset", "score", "p95", "p99", "signed lead", "lag rate"], horizonSpecificRows)}

## Validation Selection

Selected: \`${selectedId}\`. Guardrail passed: ${result.validationSelection.guardrailPassed ? "yes" : "no"}.

${table(["model", "family", "base", "guard", "objective", "mean", "p95", "p99", "resume p95", "long signed", "long lag"], selectionRows)}

## Delta Vs Step 3 Teacher

${deltaTable(result.deltaVsStep3Teacher)}

## Delta Vs Step 4 Selected

${deltaTable(result.deltaVsStep4Selected)}

## Delta Vs Step 5 Selected

${deltaTable(result.deltaVsStep5Selected)}

## Test Horizon Breakdown Vs Step 3

${table(["load", "horizon", "base p95", "cand p95", "p95 d", "base p99", "cand p99", "p99 d", "base signed", "cand signed", "signed d", "cand lag"], horizonRows)}

## Test Category Breakdown

${table(["load", "horizon", "category", "count", "mean", "p95", "p99", "signed lead", "lag rate"], categoryRows)}

## Signed Lag / Lead Bias

${table(["load", "horizon", "signed count", "mean signed", "mean abs", "lag rate", "lead rate"], signedRows)}

## Interpretation

${result.interpretation}

## Step 7 Recommendation

${result.nextStepRecommendation}
`;
}

function buildNotes(result) {
  return `# Step 6 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v11\\scripts\\run-step6-timing-alignment-search.js
\`\`\`

## Causality

Product-eligible candidates use only causal history, product poll timing, scheduler-delay bins, and predictions available at the anchor. Load-id and script movement-category offset candidates are analysis-only and are not selectable.

## Offset Semantics

The target label remains anchor + requested horizon. A candidate only changes the internal horizon passed into the predictor. Negative internal horizons are clamped to 0 ms; positive offsets may extend to ${MAX_INTERNAL_HORIZON_MS} ms for the 50 ms horizon.

## Selection

Validation chooses the candidate and test is read afterward. Tail guardrails are intentionally conservative because timing offsets can reduce lag while increasing resume p99.

Selected candidate: \`${result.validationSelection.selected.modelId}\`.
`;
}

function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.outDir);
  const lib = loadStep3Library(args.step3Script);
  const step4Lib = loadStep4Library(args.step4Script);
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

  const initialSpecs = baseCandidateSpecs();
  const initialValidation = evaluateValidation(lib, step4Lib, traces, models, initialSpecs);
  const horizonSpecific = buildHorizonSpecificSpecs(initialValidation.rows);
  const allSpecs = [...initialSpecs, ...horizonSpecific.specs];
  const validation = evaluateValidation(lib, step4Lib, traces, models, allSpecs);
  const validationSelection = selectCandidate(validation.rows);
  const selectedSpec = allSpecs.find((spec) => spec.id === validationSelection.selected.modelId);

  const finalIds = new Set([
    "ls12_baseline",
    "step3_teacher_ridge_residual_segmented_horizon",
    "step4_vfsmn_small_velocity",
    "step5_guarded_selected",
    selectedSpec.id,
    "analysis_stress_long_step4_plus8",
    "analysis_resume_step4_plus8",
  ]);
  const finalSpecs = allSpecs.filter((spec) => finalIds.has(spec.id));
  const detailed = evaluateDetailed(lib, step4Lib, traces, models, finalSpecs);

  const result = {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUtc: new Date().toISOString(),
    constraints: {
      gpuUsed: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
      trainingRun: "CPU-only timing alignment and signed lag search",
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
      label: "interpolated referencePoll at anchor + requested horizon; internal prediction horizon may differ",
      requestedHorizonsMs: HORIZONS_MS,
      offsetCandidatesMs: OFFSET_CANDIDATES_MS,
      gainCandidates: GAIN_CANDIDATES,
      signedLagLead: "projection of prediction-target error onto causal recent motion direction; negative means lag",
    },
    timingObjective: {
      selectionSplit: "validation",
      terms: [
        "overall p95/p99",
        ">5px and >10px rates",
        "resume category horizons 16.67-50 ms",
        "long-horizon signed lead mean/lag rate",
        "offset magnitude regularization",
        "tail regression penalties versus Step 3, Step 4, and Step 5 references",
      ],
      guardrail: "reject p95 > best reference +0.25px, p99 > best reference +0.5px, resume p95 > +0.5px, resume p99 > +1px, or >10px > +0.0005",
    },
    trainingSummary: {
      step3TeacherLambda: step3Teacher.lambda,
      step4TrainExamples: step4Training.summary.trainExamples,
    },
    candidateList: allSpecs.map((spec) => ({
      id: spec.id,
      family: spec.family,
      baseModel: spec.baseModel,
      productEligible: Boolean(spec.productEligible),
      selectable: Boolean(spec.selectable),
      offsetMs: spec.offsetMs,
      gain: spec.gain,
      offsetsByHorizon: spec.offsetsByHorizon,
      conditionalOffsets: spec.conditionalOffsets,
      description: spec.description,
    })),
    horizonSpecificSelections: horizonSpecific.selections,
    validationSearch: {
      summary: validation.summary,
      ranking: validation.rows.map((row) => ({
        modelId: row.modelId,
        family: row.family,
        baseModel: row.baseModel,
        productEligible: row.productEligible,
        selectable: row.selectable,
        guardrailPass: row.guardrailPass,
        objective: row.objective,
        offsetMs: row.offsetMs,
        gain: row.gain,
        overall: row.overall,
        resumeTail: row.resumeTail,
        longHorizon: row.longHorizon,
        byLoad: row.byLoad,
      })),
    },
    validationSelection,
    finalModelList: finalSpecs.map((spec) => ({
      id: spec.id,
      family: spec.family,
      baseModel: spec.baseModel,
      productEligible: Boolean(spec.productEligible),
      selectable: Boolean(spec.selectable),
    })),
    scores: detailed.scores,
    finalLabelsMissing: detailed.labelsMissing,
    deltaVsStep3Teacher: deltaRows(detailed.scores, selectedSpec.id, "step3_teacher_ridge_residual_segmented_horizon"),
    deltaVsStep4Selected: deltaRows(detailed.scores, selectedSpec.id, "step4_vfsmn_small_velocity"),
    deltaVsStep5Selected: deltaRows(detailed.scores, selectedSpec.id, "step5_guarded_selected"),
    testHorizonDeltaVsStep3: horizonDeltaRows(detailed.scores, selectedSpec.id, "step3_teacher_ridge_residual_segmented_horizon"),
  };
  result.interpretation = buildInterpretation(result);
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
