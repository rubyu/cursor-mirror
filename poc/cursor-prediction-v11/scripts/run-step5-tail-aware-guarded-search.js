#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCHEMA_VERSION = "cursor-prediction-v11-step5-tail-aware-guarded-search/1";
const HORIZONS_MS = [0, 8, 16.67, 25, 33.33, 50];
const REGRESSION_THRESHOLDS_PX = [1, 2, 5, 10];
const HISTOGRAM_BIN_PX = 0.25;
const HISTOGRAM_MAX_PX = 2048;
const HISTOGRAM_BINS = Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 1;
const NO_SCHED_LAMBDAS = [0.1, 1, 3, 10, 30, 100];

const PACKAGES = [
  { id: "normal", label: "normal load", file: "cursor-mirror-motion-recording-20260503-212556.zip" },
  { id: "stress", label: "stress load", file: "cursor-mirror-motion-recording-20260503-215632.zip" },
];

const BASE_FEATURE_INDEX = {
  bias: 0,
  horizon: 1,
  horizon2: 2,
  anchorGap: 3,
  schedulerDelay: 4,
  historyMeanGap: 5,
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
  baselineDx: 16,
  baselineDy: 17,
  ls12Dx: 18,
  ls12Dy: 19,
  ls8Dx: 20,
  ls8Dy: 21,
  last2Dx: 22,
  last2Dy: 23,
};

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  return {
    root,
    outDir: path.resolve(scriptDir, "..", "step-5-tail-aware-guarded-search"),
    step1Scores: path.resolve(scriptDir, "..", "step-1-data-audit", "scores.json"),
    step3Script: path.resolve(scriptDir, "run-step3-learned-gates.js"),
    step4Script: path.resolve(scriptDir, "run-step4-fsmn-family-search.js"),
    args: argv.slice(2),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
};
`;
  const sandbox = makeSandbox(step4Script);
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: step4Script });
  return sandbox.module.exports;
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function formatNumber(value, digits = 4) {
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

class NormalEquation {
  constructor(dimension) {
    this.dimension = dimension;
    this.xtx = new Float64Array(dimension * dimension);
    this.xtyX = new Float64Array(dimension);
    this.xtyY = new Float64Array(dimension);
    this.count = 0;
  }

  add(features, residualX, residualY) {
    const d = this.dimension;
    for (let i = 0; i < d; i += 1) {
      const fi = features[i];
      this.xtyX[i] += fi * residualX;
      this.xtyY[i] += fi * residualY;
      const base = i * d;
      for (let j = 0; j <= i; j += 1) this.xtx[base + j] += fi * features[j];
    }
    this.count += 1;
  }

  solve(lambda) {
    return {
      count: this.count,
      lambda,
      weightsX: solveSymmetric(this.xtx, this.xtyX, this.dimension, lambda),
      weightsY: solveSymmetric(this.xtx, this.xtyY, this.dimension, lambda),
    };
  }
}

function solveSymmetric(lowerTriangular, rhs, dimension, lambda) {
  const a = Array.from({ length: dimension }, () => new Float64Array(dimension + 1));
  for (let i = 0; i < dimension; i += 1) {
    for (let j = 0; j < dimension; j += 1) {
      const value = i >= j ? lowerTriangular[i * dimension + j] : lowerTriangular[j * dimension + i];
      a[i][j] = value;
    }
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

function dot(weights, features) {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) sum += weights[i] * features[i];
  return sum;
}

function zeroSchedulerFeature(features) {
  const copy = features.slice();
  copy[BASE_FEATURE_INDEX.schedulerDelay] = 0;
  return copy;
}

function trainNoSchedulerRidge(lib, traces) {
  const dimension = lib.FEATURE_NAMES.length;
  const horizonEquations = new Map(HORIZONS_MS.map((horizon) => [String(horizon), new NormalEquation(dimension)]));
  let trainExamples = 0;
  let labelsMissing = 0;
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      if (anchor.split !== "train") continue;
      anchor.cache = Object.create(null);
      for (const horizonMs of HORIZONS_MS) {
        const target = lib.interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) {
          labelsMissing += 1;
          continue;
        }
        const baseline = lib.predictLeastSquares(trace, anchor, horizonMs, 12, 64);
        const features = zeroSchedulerFeature(lib.featureVector(trace, anchor, horizonMs, baseline));
        horizonEquations.get(String(horizonMs)).add(features, target.x - baseline.x, target.y - baseline.y);
        trainExamples += 1;
      }
    }
  }
  const models = new Map();
  for (const lambda of NO_SCHED_LAMBDAS) {
    models.set(`no_scheduler_ridge_horizon_lambda${lambda}`, {
      id: `no_scheduler_ridge_horizon_lambda${lambda}`,
      lambda,
      coefficientsByHorizon: Object.fromEntries(
        [...horizonEquations.entries()].map(([horizon, equation]) => [horizon, equation.solve(lambda)]),
      ),
    });
  }
  return {
    models,
    summary: {
      trainExamples,
      labelsMissing,
      lambdaGrid: NO_SCHED_LAMBDAS,
      horizonEquationCounts: Object.fromEntries([...horizonEquations.entries()].map(([horizon, eq]) => [horizon, eq.count])),
    },
  };
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
      signedLead: {
        count: 0,
        mean: null,
        meanAbs: null,
        lagRate: null,
        leadRate: null,
      },
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

function addToMap(map, key, error, signedLeadPx) {
  let acc = map.get(key);
  if (!acc) {
    acc = createAccumulator();
    map.set(key, acc);
  }
  addError(acc, error, signedLeadPx);
}

function metricKey(parts) {
  return parts.join("\t");
}

function parseKey(key, fields) {
  const parts = key.split("\t");
  return Object.fromEntries(fields.map((field, index) => [field, parts[index]]));
}

class ScoreStore {
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

function baseModelSpecs(noSchedModels) {
  return [
    {
      id: "ls12_baseline",
      family: "baseline",
      productEligible: true,
      selectable: false,
      description: "Step 2 least-squares velocity n12 cap64 baseline.",
    },
    {
      id: "step3_teacher_ridge_residual_segmented_horizon",
      family: "step3_teacher",
      productEligible: true,
      selectable: false,
      description: "Step 3 best ridge residual segmented by horizon.",
    },
    {
      id: "step4_vfsmn_small_velocity",
      family: "step4_vfsmn",
      productEligible: true,
      selectable: false,
      description: "Step 4 selected VFSMN small velocity model.",
    },
    ...[...noSchedModels.values()].map((model) => ({
      id: model.id,
      family: "no_scheduler_ridge",
      productEligible: true,
      selectable: true,
      description: "Horizon ridge residual with schedulerDelay feature set to zero.",
      lambda: model.lambda,
      usesSchedulerDelay: false,
    })),
  ];
}

function guardedCandidateSpecs(noSchedModels) {
  const specs = [];
  const riskFormulas = ["still_accel_disagree", "gap_projection", "still_to_motion"];
  const thresholds = [0.8, 1.1, 1.4, 1.7];
  const minHorizons = [16.67, 25];
  const fallbacks = ["step3_teacher_ridge_residual_segmented_horizon", "ls12_baseline"];
  for (const riskFormula of riskFormulas) {
    for (const threshold of thresholds) {
      for (const minHorizonMs of minHorizons) {
        for (const fallback of fallbacks) {
          specs.push({
            id: `guard_vfsmn_${riskFormula}_t${threshold}_h${minHorizonMs}_to_${shortModel(fallback)}`,
            family: "tail_guarded_mixture",
            productEligible: true,
            selectable: true,
            description: "Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon.",
            base: "step4_vfsmn_small_velocity",
            fallback,
            riskFormula,
            threshold,
            minHorizonMs,
          });
        }
      }
    }
  }
  for (const fallback of ["step3_teacher_ridge_residual_segmented_horizon", "ls12_baseline"]) {
    specs.push({
      id: `guard_vfsmn_missing_scheduler_to_${shortModel(fallback)}`,
      family: "missing_scheduler_guard",
      productEligible: true,
      selectable: true,
      description: "Fallback when scheduler delay is missing or implausibly large.",
      base: "step4_vfsmn_small_velocity",
      fallback,
      missingSchedulerOnly: true,
    });
  }
  for (const cap of [2, 4, 8, 16]) {
    specs.push({
      id: `clip_vfsmn_residual_cap${cap}`,
      family: "residual_clip_guard",
      productEligible: true,
      selectable: true,
      description: "Clip Step 4 VFSMN residual relative to LS12.",
      source: "step4_vfsmn_small_velocity",
      clipResidualCapPx: cap,
    });
    specs.push({
      id: `clip_teacher_residual_cap${cap}`,
      family: "residual_clip_guard",
      productEligible: true,
      selectable: true,
      description: "Clip Step 3 teacher residual relative to LS12.",
      source: "step3_teacher_ridge_residual_segmented_horizon",
      clipResidualCapPx: cap,
    });
  }
  const noSchedIds = [...noSchedModels.keys()];
  const conservativeNoSched = noSchedIds.includes("no_scheduler_ridge_horizon_lambda30")
    ? "no_scheduler_ridge_horizon_lambda30"
    : noSchedIds[0];
  for (const riskFormula of ["still_accel_disagree", "gap_projection"]) {
    for (const threshold of [1.1, 1.4]) {
      specs.push({
        id: `guard_vfsmn_${riskFormula}_t${threshold}_to_no_scheduler`,
        family: "no_scheduler_guarded_mixture",
        productEligible: true,
        selectable: true,
        description: "Default Step 4 VFSMN; fallback to scheduler-free ridge on high causal risk.",
        base: "step4_vfsmn_small_velocity",
        fallback: conservativeNoSched,
        riskFormula,
        threshold,
        minHorizonMs: 16.67,
      });
    }
  }
  specs.push({
    id: "oracle_resume_category_to_teacher",
    family: "oracle_analysis",
    productEligible: false,
    selectable: false,
    description: "Analysis-only: uses script category=resume to fallback to Step 3 teacher.",
    base: "step4_vfsmn_small_velocity",
    fallback: "step3_teacher_ridge_residual_segmented_horizon",
    oracleCategory: "resume",
    minHorizonMs: 16.67,
  });
  specs.push({
    id: "oracle_resume_category_to_ls12",
    family: "oracle_analysis",
    productEligible: false,
    selectable: false,
    description: "Analysis-only: uses script category=resume to fallback to LS12.",
    base: "step4_vfsmn_small_velocity",
    fallback: "ls12_baseline",
    oracleCategory: "resume",
    minHorizonMs: 16.67,
  });
  specs.push({
    id: "oracle_best_of_ls12_teacher_vfsmn",
    family: "oracle_analysis",
    productEligible: false,
    selectable: false,
    description: "Analysis-only: picks the lowest-error prediction using the label.",
    oracleBestOf: ["ls12_baseline", "step3_teacher_ridge_residual_segmented_horizon", "step4_vfsmn_small_velocity"],
  });
  return specs;
}

function shortModel(modelId) {
  if (modelId === "step3_teacher_ridge_residual_segmented_horizon") return "teacher";
  if (modelId === "step4_vfsmn_small_velocity") return "vfsmn";
  if (modelId === "ls12_baseline") return "ls12";
  return modelId.replaceAll(".", "p");
}

function predictionBundle(lib, step4Lib, step3Teacher, step4Model, noSchedModels, trace, anchor, horizonMs, target) {
  const baseline = lib.predictLeastSquares(trace, anchor, horizonMs, 12, 64);
  const features = lib.featureVector(trace, anchor, horizonMs, baseline);
  const step3Pred = lib.applyRidge(
    baseline,
    features,
    step3Teacher.coefficientsByHorizon[String(horizonMs)],
  );
  const step4Pred = step4Lib.predictCandidate(lib, step4Model, trace, anchor, horizonMs, baseline, features);
  const predictions = new Map([
    ["ls12_baseline", baseline],
    ["step3_teacher_ridge_residual_segmented_horizon", step3Pred],
    ["step4_vfsmn_small_velocity", step4Pred],
  ]);
  const zeroSchedFeatures = zeroSchedulerFeature(features);
  for (const model of noSchedModels.values()) {
    predictions.set(model.id, lib.applyRidge(
      baseline,
      zeroSchedFeatures,
      model.coefficientsByHorizon[String(horizonMs)],
    ));
  }
  const risk = riskScores(features, predictions);
  return { baseline, features, predictions, risk, signedUnit: motionUnit(trace, anchor), target };
}

function riskScores(features, predictions) {
  const teacher = predictions.get("step3_teacher_ridge_residual_segmented_horizon");
  const vfsmn = predictions.get("step4_vfsmn_small_velocity");
  const ls12 = predictions.get("ls12_baseline");
  const disagreementPx = Math.max(
    distancePred(teacher, vfsmn),
    distancePred(teacher, ls12),
    distancePred(vfsmn, ls12),
  );
  const speedSpread = Math.max(
    Math.abs(features[BASE_FEATURE_INDEX.ls12Speed] - features[BASE_FEATURE_INDEX.ls8Speed]),
    Math.abs(features[BASE_FEATURE_INDEX.ls12Speed] - features[BASE_FEATURE_INDEX.last2Speed]),
    Math.abs(features[BASE_FEATURE_INDEX.ls8Speed] - features[BASE_FEATURE_INDEX.last2Speed]),
  );
  const stillness = clamp(features[BASE_FEATURE_INDEX.stillness], 0, 1.5);
  const nearZero = clamp(features[BASE_FEATURE_INDEX.nearZero], 0, 1.5);
  const accel = clamp(features[BASE_FEATURE_INDEX.acceleration], 0, 3);
  const recentSpeed = clamp(features[BASE_FEATURE_INDEX.recentSpeed], 0, 3);
  const maxGap = clamp(features[BASE_FEATURE_INDEX.historyMaxGap], 0, 4);
  const gapStd = clamp(features[BASE_FEATURE_INDEX.historyGapStd], 0, 4);
  const anchorGap = clamp(Math.abs(features[BASE_FEATURE_INDEX.anchorGap]), 0, 4);
  const pathInefficiency = clamp(1 - features[BASE_FEATURE_INDEX.pathEfficiency], 0, 1);
  const disagreement = clamp(disagreementPx / 24, 0, 4);
  return {
    still_accel_disagree: round(
      0.55 * stillness
      + 0.55 * nearZero
      + 0.75 * accel
      + 0.65 * disagreement
      + 0.3 * anchorGap
      + 0.2 * gapStd
      + 0.25 * pathInefficiency,
      6,
    ),
    gap_projection: round(
      0.7 * maxGap
      + 0.55 * gapStd
      + 0.8 * disagreement
      + 0.45 * speedSpread
      + 0.25 * anchorGap,
      6,
    ),
    still_to_motion: round(
      0.75 * nearZero
      + 0.45 * stillness
      + 0.75 * Math.max(0, recentSpeed - 0.05)
      + 0.65 * accel
      + 0.35 * pathInefficiency,
      6,
    ),
    disagreementPx: round(disagreementPx, 4),
  };
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

function predictSpec(lib, bundle, spec, trace, anchor, horizonMs, target) {
  if (bundle.predictions.has(spec.id)) return bundle.predictions.get(spec.id);
  if (spec.oracleBestOf) {
    let best = null;
    for (const modelId of spec.oracleBestOf) {
      const pred = bundle.predictions.get(modelId);
      const error = lib.distance(pred.x, pred.y, target.x, target.y);
      if (!best || error < best.error) best = { pred, error };
    }
    return best.pred;
  }
  if (spec.clipResidualCapPx !== undefined) {
    const source = bundle.predictions.get(spec.source);
    return clipResidual(source, bundle.baseline, spec.clipResidualCapPx);
  }
  if (spec.missingSchedulerOnly) {
    const shouldFallback = isMissingOrImplausibleScheduler(anchor);
    return bundle.predictions.get(shouldFallback ? spec.fallback : spec.base);
  }
  if (spec.oracleCategory) {
    const shouldFallback = (anchor.movementCategory || "unknown") === spec.oracleCategory && horizonMs >= (spec.minHorizonMs || 0);
    return bundle.predictions.get(shouldFallback ? spec.fallback : spec.base);
  }
  if (spec.riskFormula) {
    const risk = bundle.risk[spec.riskFormula] ?? 0;
    const shouldFallback = risk >= spec.threshold && horizonMs >= (spec.minHorizonMs || 0);
    return bundle.predictions.get(shouldFallback ? spec.fallback : spec.base);
  }
  throw new Error(`Unknown candidate spec: ${spec.id}`);
}

function clipResidual(pred, baseline, capPx) {
  const dx = pred.x - baseline.x;
  const dy = pred.y - baseline.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= capPx || d <= 1e-9) return pred;
  const scale = capPx / d;
  return { x: baseline.x + dx * scale, y: baseline.y + dy * scale };
}

function isMissingOrImplausibleScheduler(anchor) {
  if ((anchor.schedulerDelayBin || "missing") === "missing") return true;
  if (!Number.isFinite(anchor.schedulerDelayMs)) return true;
  return anchor.schedulerDelayMs > 8 || anchor.schedulerDelayMs < -2;
}

function evaluateValidationSearch(lib, step4Lib, traces, step3Teacher, step4Model, noSchedModels, candidateSpecs) {
  const allSpecs = [
    ...baseModelSpecs(noSchedModels),
    ...candidateSpecs,
  ];
  const accs = new Map(allSpecs.map((spec) => [spec.id, {
    spec,
    overall: createAccumulator(),
    byLoad: new Map(),
    resumeTail: createAccumulator(),
    lag: createAccumulator(),
  }]));
  let examples = 0;
  let labelsMissing = 0;
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      if (anchor.split !== "validation") continue;
      anchor.cache = Object.create(null);
      for (const horizonMs of HORIZONS_MS) {
        const target = lib.interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) {
          labelsMissing += 1;
          continue;
        }
        const bundle = predictionBundle(lib, step4Lib, step3Teacher, step4Model, noSchedModels, trace, anchor, horizonMs, target);
        for (const spec of allSpecs) {
          const pred = predictSpec(lib, bundle, spec, trace, anchor, horizonMs, target);
          const error = lib.distance(pred.x, pred.y, target.x, target.y);
          const signed = signedLead(pred, target, bundle.signedUnit);
          const entry = accs.get(spec.id);
          addError(entry.overall, error, signed);
          let loadAcc = entry.byLoad.get(trace.id);
          if (!loadAcc) {
            loadAcc = createAccumulator();
            entry.byLoad.set(trace.id, loadAcc);
          }
          addError(loadAcc, error, signed);
          if ((anchor.movementCategory || "unknown") === "resume" && horizonMs >= 16.67) addError(entry.resumeTail, error, signed);
          if (horizonMs >= 16.67) addError(entry.lag, error, signed);
        }
        examples += 1;
      }
    }
  }
  const rows = [...accs.values()].map((entry) => ({
    modelId: entry.spec.id,
    family: entry.spec.family,
    productEligible: Boolean(entry.spec.productEligible),
    selectable: Boolean(entry.spec.selectable),
    description: entry.spec.description,
    objective: null,
    guardrailPass: null,
    overall: finalize(entry.overall),
    byLoad: Object.fromEntries([...entry.byLoad.entries()].map(([load, acc]) => [load, finalize(acc)])),
    resumeTail: finalize(entry.resumeTail),
    lagSensitive: finalize(entry.lag),
  }));
  applyTailObjective(rows);
  rows.sort((a, b) => (a.guardrailPass === b.guardrailPass ? 0 : a.guardrailPass ? -1 : 1)
    || a.objective - b.objective
    || (a.overall.mean ?? Infinity) - (b.overall.mean ?? Infinity));
  return {
    summary: {
      validationExamples: examples,
      labelsMissing,
      candidateCount: allSpecs.length,
      selectableCount: allSpecs.filter((spec) => spec.selectable && spec.productEligible).length,
    },
    ranking: rows,
    allSpecs,
  };
}

function applyTailObjective(rows) {
  const teacher = rows.find((row) => row.modelId === "step3_teacher_ridge_residual_segmented_horizon");
  const step4 = rows.find((row) => row.modelId === "step4_vfsmn_small_velocity");
  for (const row of rows) {
    const overall = row.overall;
    const resume = row.resumeTail;
    const lag = row.lagSensitive.signedLead;
    const loadWorstP95 = Math.max(...Object.values(row.byLoad).map((metric) => metric.p95 ?? 999));
    const loadWorstP99 = Math.max(...Object.values(row.byLoad).map((metric) => metric.p99 ?? 999));
    const gt5 = overall.regressionRates.gt5px ?? 1;
    const gt10 = overall.regressionRates.gt10px ?? 1;
    const resumeGt10 = resume.regressionRates.gt10px ?? 1;
    const lagPenalty = lag.mean !== null ? Math.max(0, -lag.mean) * 0.4 + (lag.lagRate ?? 0) * 1.5 : 0;
    row.objective = round(
      (overall.p95 ?? 999)
      + 0.35 * (overall.p99 ?? 999)
      + 30 * gt5
      + 100 * gt10
      + 0.65 * loadWorstP95
      + 0.2 * loadWorstP99
      + 0.9 * (resume.p95 ?? 0)
      + 0.25 * (resume.p99 ?? 0)
      + 90 * resumeGt10
      + lagPenalty
      + validationRegressionPenalty(row, teacher, step4),
      6,
    );
    row.guardrailPass = row.selectable && row.productEligible && validationGuardrailPass(row, teacher, step4);
  }
}

function validationRegressionPenalty(row, teacher, step4) {
  if (!teacher || !step4 || row.modelId === teacher.modelId || row.modelId === step4.modelId) return 0;
  let penalty = 0;
  const baselines = [teacher, step4];
  const bestOverallP95 = Math.min(...baselines.map((base) => base.overall.p95 ?? 999));
  const bestOverallP99 = Math.min(...baselines.map((base) => base.overall.p99 ?? 999));
  const bestResumeP95 = Math.min(...baselines.map((base) => base.resumeTail.p95 ?? 999));
  const bestResumeP99 = Math.min(...baselines.map((base) => base.resumeTail.p99 ?? 999));
  penalty += Math.max(0, (row.overall.p95 ?? 999) - bestOverallP95 - 0.25) * 8;
  penalty += Math.max(0, (row.overall.p99 ?? 999) - bestOverallP99 - 0.5) * 2;
  penalty += Math.max(0, (row.resumeTail.p95 ?? 999) - bestResumeP95 - 0.25) * 12;
  penalty += Math.max(0, (row.resumeTail.p99 ?? 999) - bestResumeP99 - 0.5) * 4;
  for (const load of ["normal", "stress"]) {
    const rowLoad = row.byLoad[load];
    const bestLoadP95 = Math.min(...baselines.map((base) => base.byLoad[load]?.p95 ?? 999));
    if (rowLoad) penalty += Math.max(0, rowLoad.p95 - bestLoadP95 - 0.25) * 6;
  }
  return penalty;
}

function validationGuardrailPass(row, teacher, step4) {
  if (!teacher || !step4) return false;
  const baselines = [teacher, step4];
  const bestOverallP95 = Math.min(...baselines.map((base) => base.overall.p95 ?? 999));
  const bestOverallP99 = Math.min(...baselines.map((base) => base.overall.p99 ?? 999));
  const bestResumeP95 = Math.min(...baselines.map((base) => base.resumeTail.p95 ?? 999));
  const bestResumeP99 = Math.min(...baselines.map((base) => base.resumeTail.p99 ?? 999));
  if ((row.overall.p95 ?? 999) > bestOverallP95 + 0.25) return false;
  if ((row.overall.p99 ?? 999) > bestOverallP99 + 0.5) return false;
  if ((row.resumeTail.p95 ?? 999) > bestResumeP95 + 0.25) return false;
  if ((row.resumeTail.p99 ?? 999) > bestResumeP99 + 0.5) return false;
  const bestGt10 = Math.min(...baselines.map((base) => base.overall.regressionRates.gt10px ?? 1));
  if ((row.overall.regressionRates.gt10px ?? 1) > bestGt10 + 0.0005) return false;
  for (const load of ["normal", "stress"]) {
    const rowLoad = row.byLoad[load];
    if (!rowLoad) continue;
    const bestLoadP95 = Math.min(...baselines.map((base) => base.byLoad[load]?.p95 ?? 999));
    if (rowLoad.p95 > bestLoadP95 + 0.25) return false;
  }
  return true;
}

function selectValidationCandidate(search) {
  const selectable = search.ranking.filter((row) => row.selectable && row.productEligible);
  const passing = selectable.find((row) => row.guardrailPass);
  return {
    selected: passing || selectable[0],
    guardrailPassed: Boolean(passing),
    top10: search.ranking.slice(0, 10),
    topSelectable10: selectable.slice(0, 10),
  };
}

function evaluateFinalModels(lib, step4Lib, traces, step3Teacher, step4Model, noSchedModels, specs) {
  const store = new ScoreStore();
  const labelsMissing = { count: 0 };
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      anchor.cache = Object.create(null);
      for (const horizonMs of HORIZONS_MS) {
        const target = lib.interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) {
          labelsMissing.count += 1;
          continue;
        }
        const bundle = predictionBundle(lib, step4Lib, step3Teacher, step4Model, noSchedModels, trace, anchor, horizonMs, target);
        for (const spec of specs) {
          const pred = predictSpec(lib, bundle, spec, trace, anchor, horizonMs, target);
          const error = lib.distance(pred.x, pred.y, target.x, target.y);
          store.addObservation(spec, trace, anchor, horizonMs, error, signedLead(pred, target, bundle.signedUnit));
        }
      }
    }
  }
  return {
    scores: store.finalize(),
    labelsMissing: labelsMissing.count,
  };
}

function findSpec(specs, id) {
  const spec = specs.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`Missing candidate spec ${id}`);
  return spec;
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
        signedLeadDelta: round((cand.error.signedLead.mean ?? 0) - (base.error.signedLead.mean ?? 0), 4),
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
        candidateSignedLeadMean: cand.error.signedLead.mean,
        candidateLagRate: cand.error.signedLead.lagRate,
      });
    }
  }
  return rows;
}

function noSchedulerSummary(search) {
  return search.ranking
    .filter((row) => row.family === "no_scheduler_ridge")
    .sort((a, b) => a.objective - b.objective)
    .slice(0, 6)
    .map((row) => ({
      modelId: row.modelId,
      objective: row.objective,
      guardrailPass: row.guardrailPass,
      mean: row.overall.mean,
      p95: row.overall.p95,
      p99: row.overall.p99,
      resumeP95: row.resumeTail.p95,
      resumeP99: row.resumeTail.p99,
      gt10px: row.overall.regressionRates.gt10px,
    }));
}

function missingSchedulerInvestigation(scores, modelIds) {
  return scores.perSchedulerDelayBinScores
    .filter((row) => modelIds.includes(row.modelId) && row.schedulerDelayBin === "missing")
    .map((row) => ({
      modelId: row.modelId,
      loadCondition: row.loadCondition,
      count: row.error.count,
      mean: row.error.mean,
      p95: row.error.p95,
      p99: row.error.p99,
      max: row.error.max,
      gt10px: row.error.regressionRates.gt10px,
    }));
}

function buildReport(result) {
  const selectedId = result.validationSelection.selected.modelId;
  const candidateRows = result.candidateList.map((spec) => [
    spec.id,
    spec.family,
    spec.productEligible ? "yes" : "no",
    spec.selectable ? "yes" : "no",
    spec.usesSchedulerDelay === false ? "no" : "yes",
    spec.description,
  ]);
  const selectionRows = result.validationSelection.topSelectable10.map((row) => [
    row.modelId,
    row.family,
    row.guardrailPass ? "yes" : "no",
    formatNumber(row.objective),
    formatNumber(row.overall.mean),
    formatNumber(row.overall.p95),
    formatNumber(row.overall.p99),
    formatNumber(row.resumeTail.p95),
    formatNumber(row.resumeTail.p99),
    formatNumber(row.overall.regressionRates.gt10px, 6),
  ]);
  const deltaStep3Rows = result.deltaVsStep3Teacher.map((row) => [
    row.split,
    row.loadCondition,
    formatNumber(row.baselineMean),
    formatNumber(row.candidateMean),
    formatNumber(row.meanDelta),
    formatNumber(row.baselineP95),
    formatNumber(row.candidateP95),
    formatNumber(row.p95Delta),
    formatNumber(row.baselineP99),
    formatNumber(row.candidateP99),
    formatNumber(row.p99Delta),
    formatNumber(row.gt10Delta, 6),
  ]);
  const deltaStep4Rows = result.deltaVsStep4Selected.map((row) => [
    row.split,
    row.loadCondition,
    formatNumber(row.baselineMean),
    formatNumber(row.candidateMean),
    formatNumber(row.meanDelta),
    formatNumber(row.baselineP95),
    formatNumber(row.candidateP95),
    formatNumber(row.p95Delta),
    formatNumber(row.baselineP99),
    formatNumber(row.candidateP99),
    formatNumber(row.p99Delta),
    formatNumber(row.gt10Delta, 6),
  ]);
  const horizonRows = result.testHorizonDeltaVsStep3.map((row) => [
    row.loadCondition,
    row.horizonMs,
    formatNumber(row.baselineP95),
    formatNumber(row.candidateP95),
    formatNumber(row.p95Delta),
    formatNumber(row.baselineP99),
    formatNumber(row.candidateP99),
    formatNumber(row.p99Delta),
    formatNumber(row.candidateSignedLeadMean),
    formatNumber(row.candidateLagRate, 6),
  ]);
  const movementRows = result.scores.perValidationTestCategoryHorizonScores
    .filter((row) => row.modelId === selectedId && row.split === "test")
    .map((row) => [
      row.loadCondition,
      row.horizonMs,
      row.movementCategory,
      row.error.count,
      formatNumber(row.error.mean),
      formatNumber(row.error.p95),
      formatNumber(row.error.p99),
      formatNumber(row.error.regressionRates.gt10px, 6),
      formatNumber(row.error.signedLead.mean),
    ]);
  const schedulerRows = result.scores.perSchedulerDelayBinScores
    .filter((row) => row.modelId === selectedId)
    .map((row) => [
      row.loadCondition,
      row.schedulerDelayBin,
      row.error.count,
      formatNumber(row.error.mean),
      formatNumber(row.error.p95),
      formatNumber(row.error.p99),
      formatNumber(row.error.regressionRates.gt10px, 6),
      formatNumber(row.error.signedLead.mean),
    ]);
  const signedRows = result.scores.signedLagLeadByHorizonScores
    .filter((row) => row.modelId === selectedId && row.split === "test" && row.movementCategory === "moving")
    .map((row) => [
      row.loadCondition,
      row.horizonMs,
      row.error.signedLead.count,
      formatNumber(row.error.signedLead.mean),
      formatNumber(row.error.signedLead.meanAbs),
      formatNumber(row.error.signedLead.lagRate, 6),
      formatNumber(row.error.signedLead.leadRate, 6),
    ]);
  const noSchedRows = result.noSchedulerAblation.top.map((row) => [
    row.modelId,
    formatNumber(row.objective),
    row.guardrailPass ? "yes" : "no",
    formatNumber(row.mean),
    formatNumber(row.p95),
    formatNumber(row.p99),
    formatNumber(row.resumeP95),
    formatNumber(row.resumeP99),
    formatNumber(row.gt10px, 6),
  ]);
  const missingRows = result.missingSchedulerInvestigation.map((row) => [
    row.modelId,
    row.loadCondition,
    row.count,
    formatNumber(row.mean),
    formatNumber(row.p95),
    formatNumber(row.p99),
    formatNumber(row.max),
    formatNumber(row.gt10px, 6),
  ]);

  return `# Step 5 Tail-Aware Guarded Search

## Intent

Step 5 searches product-eligible tail-aware guards around the Step 3 teacher, Step 4 \`VFSMN_small_velocity\`, and LS12 baseline. The evaluation contract is unchanged: product poll anchors, causal referencePoll history only, Step 1 scenario split, and horizons ${HORIZONS_MS.join(", ")} ms. Validation chooses the guarded candidate; test is read after selection.

## Tail Objective

The validation objective weights p95/p99, >5px, >10px, worst normal/stress p95/p99, resume-only horizons 16.67-50 ms, and signed lag bias. Candidate guardrails reject validation tail regressions beyond small tolerances versus both \`ridge_residual_segmented_horizon\` and \`VFSMN_small_velocity\`. Mean improvement alone is not sufficient.

## Candidate List

${table(["model", "family", "product eligible", "selectable", "uses scheduler delay", "description"], candidateRows)}

## Validation Selection

Selected: \`${selectedId}\`. Guardrail passed: ${result.validationSelection.guardrailPassed ? "yes" : "no"}.

${table(["model", "family", "guard", "objective", "mean", "p95", "p99", "resume p95", "resume p99", ">10px"], selectionRows)}

## Delta Vs Step 3 Teacher

${table(["split", "load", "teacher mean", "candidate mean", "mean delta", "teacher p95", "candidate p95", "p95 delta", "teacher p99", "candidate p99", "p99 delta", ">10px delta"], deltaStep3Rows)}

## Delta Vs Step 4 Selected

${table(["split", "load", "step4 mean", "candidate mean", "mean delta", "step4 p95", "candidate p95", "p95 delta", "step4 p99", "candidate p99", "p99 delta", ">10px delta"], deltaStep4Rows)}

## Test Horizon Breakdown Vs Step 3

${table(["load", "horizon", "teacher p95", "candidate p95", "p95 delta", "teacher p99", "candidate p99", "p99 delta", "signed lead mean", "lag rate"], horizonRows)}

## Test Movement Category Breakdown

${table(["load", "horizon", "category", "count", "mean", "p95", "p99", ">10px", "signed lead mean"], movementRows)}

## Scheduler Delay Bins

${table(["load", "scheduler bin", "count", "mean", "p95", "p99", ">10px", "signed lead mean"], schedulerRows)}

## Signed Lag / Lead Bias

Positive signed lead means prediction is ahead of causal motion direction; negative means lagging behind. Rows below are test moving segments.

${table(["load", "horizon", "signed count", "mean signed lead", "mean abs", "lag rate", "lead rate"], signedRows)}

## No-Scheduler-Delay Ablation

${table(["model", "objective", "guard", "mean", "p95", "p99", "resume p95", "resume p99", ">10px"], noSchedRows)}

## Missing Scheduler Investigation

${table(["model", "load", "count", "mean", "p95", "p99", "max", ">10px"], missingRows)}

## Interpretation

${result.interpretation}

## Step 6 Recommendation

${result.nextStepRecommendation}
`;
}

function buildNotes(result) {
  return `# Step 5 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v11\\scripts\\run-step5-tail-aware-guarded-search.js
\`\`\`

## Causality

Product-eligible candidates use causal referencePoll history, model outputs, product poll timing, and scheduler-delay feature only when the candidate is marked as using scheduler delay. Script movement category is used for evaluation labels only. \`oracle_*\` candidates are analysis-only and are not selectable.

## Tail Objective

The objective is validation-only and prioritizes p95/p99, >5px/>10px, resume horizons 16.67-50 ms, worst normal/stress load tails, and signed lag tendency. Guardrails compare against both Step 3 teacher and Step 4 selected so a candidate that improves mean but worsens tail is not considered a clean advance.

## Missing Scheduler

The normal recording still has a tiny missing-scheduler bucket with very large errors. Because the count is tiny, this should be treated as warm-up/trace alignment risk rather than a learned-model win until the recorder/runtime path explains why scheduler timing is absent.

## Outcome

Selected candidate: \`${result.validationSelection.selected.modelId}\`. Guardrail passed: ${result.validationSelection.guardrailPassed ? "yes" : "no"}.
`;
}

function buildInterpretation(result) {
  const selectedId = result.validationSelection.selected.modelId;
  const testDeltas = result.deltaVsStep3Teacher.filter((row) => row.split === "test");
  const worsened = testDeltas.filter((row) => row.p95Delta > 0 || row.p99Delta > 0 || row.gt10Delta > 0);
  const aggregateTailImproved = testDeltas.some((row) => row.p95Delta < 0 || row.p99Delta < 0);
  if (!result.validationSelection.guardrailPassed) {
    return `No new selectable candidate passed the validation tail guardrail. \`${selectedId}\` is reported as the least-bad selectable candidate, but Step 3 teacher should remain the production-safe reference until more causal resume-state signal is available.`;
  }
  if (worsened.length) {
    return `\`${selectedId}\` passed validation guardrails, but test still has tail regressions in ${worsened.map((row) => `${row.loadCondition} (${row.p95Delta}/${row.p99Delta})`).join(", ")}. Treat it as a design candidate rather than a production replacement.`;
  }
  if (!aggregateTailImproved) {
    return `\`${selectedId}\` passed validation guardrails and did not regress aggregate test p95/p99 versus the Step 3 teacher, but it did not materially improve tail. The guard mostly trades away part of Step 4's mean gain to avoid known resume-tail regressions. The remaining p99 failures are dominated by causal ambiguity in resume windows: the available history/stability/scheduler features can flag some risk, but not enough to choose the best fallback consistently. The analysis-only oracle best-of model shows tail headroom, so the limiting factor is the causal selector signal, not the three base predictors alone.`;
  }
  return `\`${selectedId}\` passed validation guardrails and improved at least one aggregate test tail metric versus the Step 3 teacher. It should still be treated as a guarded design candidate until resume-specific test p99 is stable across another recording.`;
}

function buildNextStepRecommendation(result) {
  if (!result.validationSelection.guardrailPassed) {
    return "Step 6 should add stronger causal resume-state observability: explicit hold/resume transition telemetry, warm-up/missing scheduler markers, and a tail-weighted objective trained directly on resume windows. Keep Step 3 teacher as the reference.";
  }
  const aggregateTailImproved = result.deltaVsStep3Teacher
    .filter((row) => row.split === "test")
    .some((row) => row.p95Delta < 0 || row.p99Delta < 0);
  if (!aggregateTailImproved) {
    return "Step 6 should not treat the guarded mixture as a final replacement. Keep Step 3 teacher as the safety reference, carry the selected guard as a fallback design, and collect/emit explicit resume transition, warm-up, and scheduler-missing telemetry so a causal selector can target the oracle headroom.";
  }
  return "Step 6 should harden the selected guarded mixture in a small native/C# prototype, add a no-scheduler deployment mode, and collect an extra trace with explicit resume transition markers to reduce p99 uncertainty.";
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

  const noSched = trainNoSchedulerRidge(lib, traces);
  const candidateSpecs = guardedCandidateSpecs(noSched.models);
  const validationSearch = evaluateValidationSearch(lib, step4Lib, traces, step3Teacher, step4Model, noSched.models, candidateSpecs);
  const validationSelection = selectValidationCandidate(validationSearch);

  const baseSpecs = baseModelSpecs(noSched.models);
  const selectedSpec = findSpec([...baseSpecs, ...candidateSpecs], validationSelection.selected.modelId);
  const finalSpecIds = new Set([
    "ls12_baseline",
    "step3_teacher_ridge_residual_segmented_horizon",
    "step4_vfsmn_small_velocity",
    selectedSpec.id,
    "oracle_resume_category_to_teacher",
    "oracle_best_of_ls12_teacher_vfsmn",
  ]);
  const bestNoSched = noSchedulerSummary(validationSearch)[0];
  if (bestNoSched) finalSpecIds.add(bestNoSched.modelId);
  const finalSpecs = [...baseSpecs, ...candidateSpecs].filter((spec) => finalSpecIds.has(spec.id));
  const finalEvaluation = evaluateFinalModels(lib, step4Lib, traces, step3Teacher, step4Model, noSched.models, finalSpecs);

  const result = {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUtc: new Date().toISOString(),
    constraints: {
      gpuUsed: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
      trainingRun: "CPU-only tail-aware guarded mixture search",
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
      signedLagLead: "signed projection of prediction-target error onto causal recent motion direction; negative means lag",
    },
    tailObjective: {
      selectionSplit: "validation",
      terms: [
        "overall p95/p99",
        ">5px and >10px rates",
        "worst normal/stress p95/p99",
        "resume category horizons 16.67-50ms",
        "negative signed lead lag penalty",
        "regression penalties versus Step 3 teacher and Step 4 selected",
      ],
      guardrail: "reject selectable candidates with validation tail regression beyond p95 +0.25px, p99 +0.5px, or >10px +0.0005 versus both comparison models",
    },
    trainingSummary: {
      step3TeacherLambda: step3Teacher.lambda,
      step4TrainExamples: step4Training.summary.trainExamples,
      noSchedulerRidge: noSched.summary,
    },
    candidateList: [...baseSpecs, ...candidateSpecs].map((spec) => ({
      id: spec.id,
      family: spec.family,
      productEligible: Boolean(spec.productEligible),
      selectable: Boolean(spec.selectable),
      usesSchedulerDelay: spec.usesSchedulerDelay === false ? false : true,
      description: spec.description,
      threshold: spec.threshold,
      riskFormula: spec.riskFormula,
      minHorizonMs: spec.minHorizonMs,
      fallback: spec.fallback,
    })),
    validationSearch: {
      summary: validationSearch.summary,
      ranking: validationSearch.ranking.map((row) => ({
        modelId: row.modelId,
        family: row.family,
        productEligible: row.productEligible,
        selectable: row.selectable,
        guardrailPass: row.guardrailPass,
        objective: row.objective,
        overall: row.overall,
        resumeTail: row.resumeTail,
        byLoad: row.byLoad,
        lagSensitive: row.lagSensitive,
      })),
    },
    validationSelection,
    finalModelList: finalSpecs.map((spec) => ({
      id: spec.id,
      family: spec.family,
      productEligible: Boolean(spec.productEligible),
      selectable: Boolean(spec.selectable),
    })),
    scores: finalEvaluation.scores,
    finalLabelsMissing: finalEvaluation.labelsMissing,
    deltaVsStep3Teacher: deltaRows(finalEvaluation.scores, selectedSpec.id, "step3_teacher_ridge_residual_segmented_horizon"),
    deltaVsStep4Selected: deltaRows(finalEvaluation.scores, selectedSpec.id, "step4_vfsmn_small_velocity"),
    testHorizonDeltaVsStep3: horizonDeltaRows(finalEvaluation.scores, selectedSpec.id, "step3_teacher_ridge_residual_segmented_horizon"),
    noSchedulerAblation: {
      top: noSchedulerSummary(validationSearch),
    },
    missingSchedulerInvestigation: missingSchedulerInvestigation(finalEvaluation.scores, [
      selectedSpec.id,
      "step3_teacher_ridge_residual_segmented_horizon",
      "step4_vfsmn_small_velocity",
      "ls12_baseline",
    ]),
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
