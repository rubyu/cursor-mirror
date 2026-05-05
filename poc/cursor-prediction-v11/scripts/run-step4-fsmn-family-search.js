#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const childProcess = require("node:child_process");

const SCHEMA_VERSION = "cursor-prediction-v11-step4-fsmn-family-search/1";
const HORIZONS_MS = [0, 8, 16.67, 25, 33.33, 50];
const REGRESSION_THRESHOLDS_PX = [1, 2, 5, 10];
const HISTOGRAM_BIN_PX = 0.25;
const HISTOGRAM_MAX_PX = 2048;
const HISTOGRAM_BINS = Math.ceil(HISTOGRAM_MAX_PX / HISTOGRAM_BIN_PX) + 1;
const PACKAGES = [
  { id: "normal", label: "normal load", file: "cursor-mirror-motion-recording-20260503-212556.zip" },
  { id: "stress", label: "stress load", file: "cursor-mirror-motion-recording-20260503-215632.zip" },
];

const CPU_PROFILES = [
  { id: "scalar_safe", vectorWidthFloats: 1, requires: [] },
  { id: "avx_fma", vectorWidthFloats: 8, requires: ["avx", "fma3"] },
  { id: "avx2_fma", vectorWidthFloats: 8, requires: ["avx2", "fma3"] },
  { id: "avx512f", vectorWidthFloats: 16, requires: ["avx512f"] },
  { id: "avx512_accuracy", vectorWidthFloats: 16, requires: ["avx512f"], note: "same math shape, stricter accumulation/tail checks" },
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
  xNorm: 24,
  yNorm: 25,
};

const FAMILY_DEFINITIONS = {
  FSMN: "Horizon-aware finite-memory residual over the Step 3 causal feature vector.",
  CSFSMN: "Context-sensitive FSMN segmented by horizon and scheduler-delay context.",
  VFSMN: "Velocity-focused FSMN using LS12/LS8/last2 velocity projections and speed.",
  VFSMNv2: "Velocity FSMN plus acceleration/history stability and a causal resume-tail guard.",
  CVFSMN: "Compact convolutional-style finite-memory model using history aggregates and velocity memory.",
  CVFSMNv2: "Compact FSMN v2 with scheduler context, stability features, and guarded tail correction.",
};

function candidateSpecs() {
  const all = [
    {
      id: "FSMN_small_horizon",
      family: "FSMN",
      size: "small",
      segment: "horizon",
      lambda: 1,
      indices: [
        BASE_FEATURE_INDEX.bias,
        BASE_FEATURE_INDEX.horizon,
        BASE_FEATURE_INDEX.anchorGap,
        BASE_FEATURE_INDEX.schedulerDelay,
        BASE_FEATURE_INDEX.recentSpeed,
        BASE_FEATURE_INDEX.ls12Speed,
        BASE_FEATURE_INDEX.baselineDx,
        BASE_FEATURE_INDEX.baselineDy,
        BASE_FEATURE_INDEX.ls12Dx,
        BASE_FEATURE_INDEX.ls12Dy,
      ],
      taps: 4,
      channels: 12,
      productEligible: true,
    },
    {
      id: "FSMN_medium_horizon",
      family: "FSMN",
      size: "medium",
      segment: "horizon",
      lambda: 0.1,
      indices: "all",
      taps: 8,
      channels: 24,
      productEligible: true,
    },
    {
      id: "CSFSMN_medium_sched",
      family: "CSFSMN",
      size: "medium",
      segment: "horizonScheduler",
      lambda: 1,
      indices: "all",
      extras: ["schedulerOneHot"],
      taps: 8,
      channels: 24,
      productEligible: true,
    },
    {
      id: "CSFSMN_large_sched_speed",
      family: "CSFSMN",
      size: "large",
      segment: "horizonSchedulerSpeed",
      lambda: 10,
      indices: "all",
      extras: ["schedulerOneHot", "speedOneHot"],
      taps: 12,
      channels: 32,
      productEligible: true,
    },
    {
      id: "VFSMN_small_velocity",
      family: "VFSMN",
      size: "small",
      segment: "horizon",
      lambda: 1,
      indices: [
        BASE_FEATURE_INDEX.bias,
        BASE_FEATURE_INDEX.horizon,
        BASE_FEATURE_INDEX.recentSpeed,
        BASE_FEATURE_INDEX.ls12Speed,
        BASE_FEATURE_INDEX.ls8Speed,
        BASE_FEATURE_INDEX.last2Speed,
        BASE_FEATURE_INDEX.baselineDx,
        BASE_FEATURE_INDEX.baselineDy,
        BASE_FEATURE_INDEX.ls12Dx,
        BASE_FEATURE_INDEX.ls12Dy,
        BASE_FEATURE_INDEX.ls8Dx,
        BASE_FEATURE_INDEX.ls8Dy,
        BASE_FEATURE_INDEX.last2Dx,
        BASE_FEATURE_INDEX.last2Dy,
      ],
      taps: 6,
      channels: 16,
      productEligible: true,
    },
    {
      id: "VFSMN_medium_velocity",
      family: "VFSMN",
      size: "medium",
      segment: "horizonSpeed",
      lambda: 3,
      indices: [
        BASE_FEATURE_INDEX.bias,
        BASE_FEATURE_INDEX.horizon,
        BASE_FEATURE_INDEX.anchorGap,
        BASE_FEATURE_INDEX.recentSpeed,
        BASE_FEATURE_INDEX.ls12Speed,
        BASE_FEATURE_INDEX.ls8Speed,
        BASE_FEATURE_INDEX.last2Speed,
        BASE_FEATURE_INDEX.acceleration,
        BASE_FEATURE_INDEX.baselineDx,
        BASE_FEATURE_INDEX.baselineDy,
        BASE_FEATURE_INDEX.ls12Dx,
        BASE_FEATURE_INDEX.ls12Dy,
        BASE_FEATURE_INDEX.ls8Dx,
        BASE_FEATURE_INDEX.ls8Dy,
        BASE_FEATURE_INDEX.last2Dx,
        BASE_FEATURE_INDEX.last2Dy,
      ],
      taps: 8,
      channels: 24,
      productEligible: true,
    },
    {
      id: "VFSMNv2_medium_guarded",
      family: "VFSMNv2",
      size: "medium",
      segment: "horizonSpeed",
      lambda: 3,
      indices: "velocityStability",
      extras: ["resumeRisk"],
      tailGuard: "causalResumeRisk",
      taps: 10,
      channels: 24,
      productEligible: true,
    },
    {
      id: "CVFSMN_small_compact",
      family: "CVFSMN",
      size: "small",
      segment: "horizon",
      lambda: 1,
      indices: "compact",
      taps: 6,
      channels: 16,
      productEligible: true,
    },
    {
      id: "CVFSMN_medium_compact_sched",
      family: "CVFSMN",
      size: "medium",
      segment: "horizonScheduler",
      lambda: 3,
      indices: "compact",
      extras: ["schedulerOneHot"],
      taps: 8,
      channels: 24,
      productEligible: true,
    },
    {
      id: "CVFSMNv2_medium_guarded",
      family: "CVFSMNv2",
      size: "medium",
      segment: "horizonSchedulerSpeed",
      lambda: 10,
      indices: "all",
      extras: ["schedulerOneHot", "speedOneHot", "resumeRisk"],
      tailGuard: "causalResumeRisk",
      taps: 12,
      channels: 32,
      productEligible: true,
    },
    {
      id: "CVFSMNv2_large_guarded",
      family: "CVFSMNv2",
      size: "large",
      segment: "horizonSchedulerSpeed",
      lambda: 30,
      indices: "all",
      extras: ["schedulerOneHot", "speedOneHot", "resumeRisk"],
      tailGuard: "causalResumeRisk",
      taps: 16,
      channels: 48,
      productEligible: true,
    },
    {
      id: "CSFSMN_loadaware_analysis",
      family: "CSFSMN",
      size: "analysis",
      segment: "horizonLoad",
      lambda: 1,
      indices: "all",
      extras: ["loadOneHot"],
      taps: 8,
      channels: 24,
      productEligible: false,
      note: "uses recording load id, not a runtime-stable product input",
    },
  ];
  return all.map((spec) => ({
    ...spec,
    description: `${spec.family} ${spec.size}: ${FAMILY_DEFINITIONS[spec.family]}`,
  }));
}

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  return {
    root,
    outDir: path.resolve(scriptDir, "..", "step-4-fsmn-family-search"),
    step1Scores: path.resolve(scriptDir, "..", "step-1-data-audit", "scores.json"),
    step3Script: path.resolve(scriptDir, "run-step3-learned-gates.js"),
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
  const sandbox = {
    require,
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(step3Script),
    __filename: step3Script,
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
  vm.runInContext(source, sandbox, { filename: step3Script });
  return sandbox.module.exports;
}

function cpuFeatureAudit(root) {
  const cpus = os.cpus();
  const audit = {
    processorModel: cpus[0]?.model || "unknown",
    logicalCpuCount: cpus.length,
    detectionMethod: "Node os.cpus plus optional CURSOR_PREDICTION_CPU_FEATURES_JSON override; fallback tries kernel32 IsProcessorFeaturePresent via PowerShell Add-Type",
    avx: null,
    avx2: null,
    fma3: null,
    avx512f: null,
    notes: [],
  };
  if (process.env.CURSOR_PREDICTION_CPU_FEATURES_JSON) {
    try {
      const parsed = JSON.parse(process.env.CURSOR_PREDICTION_CPU_FEATURES_JSON);
      for (const key of ["avx", "avx2", "fma3", "avx512f"]) {
        if (typeof parsed[key] === "boolean") audit[key] = parsed[key];
      }
      audit.notes.push("CPU feature override came from CURSOR_PREDICTION_CPU_FEATURES_JSON, generated from PowerShell .NET Intrinsics.");
    } catch (error) {
      audit.notes.push(`CURSOR_PREDICTION_CPU_FEATURES_JSON parse failed: ${error.message}`);
    }
  }
  try {
    if (audit.avx === null || audit.avx2 === null || audit.avx512f === null) {
      const ps = [
        "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CpuFeat { [DllImport(\"kernel32.dll\")] public static extern bool IsProcessorFeaturePresent(int f); }';",
        "$o=[ordered]@{",
        "avx=[CpuFeat]::IsProcessorFeaturePresent(39);",
        "avx2=[CpuFeat]::IsProcessorFeaturePresent(40);",
        "avx512f=[CpuFeat]::IsProcessorFeaturePresent(41)",
        "};",
        "$o | ConvertTo-Json -Compress",
      ].join(" ");
      const text = childProcess.execFileSync("powershell", ["-NoProfile", "-Command", ps], {
        cwd: root,
        encoding: "utf8",
        timeout: 30000,
        windowsHide: true,
      }).trim();
      const parsed = JSON.parse(text);
      if (audit.avx === null) audit.avx = Boolean(parsed.avx);
      if (audit.avx2 === null) audit.avx2 = Boolean(parsed.avx2);
      if (audit.avx512f === null) audit.avx512f = Boolean(parsed.avx512f);
    }
  } catch (error) {
    audit.notes.push(`IsProcessorFeaturePresent audit failed: ${error.message}`);
  }
  if (audit.fma3 === null) {
    audit.notes.push("FMA3 is not exposed by the safe kernel32 fallback; avx_fma/avx2_fma deployability records FMA3 as unknown unless .NET Intrinsics or native CPUID is used.");
  }
  audit.profileAvailability = Object.fromEntries(CPU_PROFILES.map((profile) => [
    profile.id,
    {
      available: profile.requires.every((feature) => audit[feature] === true),
      unknownRequired: profile.requires.filter((feature) => audit[feature] === null),
      requires: profile.requires,
    },
  ]));
  audit.profileAvailability.scalar_safe.available = true;
  return audit;
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
      a[i][j] = (i >= j ? lowerTriangular[i * dimension + j] : lowerTriangular[j * dimension + i]) + (i === j ? lambda : 0);
    }
    a[i][dimension] = rhs[i];
  }
  for (let col = 0; col < dimension; col += 1) {
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let row = col + 1; row < dimension; row += 1) {
      const value = Math.abs(a[row][col]);
      if (value > best) {
        best = value;
        pivot = row;
      }
    }
    if (best < 1e-12) continue;
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    const pivotValue = a[col][col];
    for (let j = col; j <= dimension; j += 1) a[col][j] /= pivotValue;
    for (let row = 0; row < dimension; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= dimension; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return Array.from({ length: dimension }, (_, i) => a[i][dimension]);
}

function dot(weights, features) {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) sum += weights[i] * features[i];
  return sum;
}

function featureIndices(spec, baseFeatureCount) {
  if (spec.indices === "all") return Array.from({ length: baseFeatureCount }, (_, i) => i);
  if (spec.indices === "velocityStability") {
    return [
      BASE_FEATURE_INDEX.bias,
      BASE_FEATURE_INDEX.horizon,
      BASE_FEATURE_INDEX.anchorGap,
      BASE_FEATURE_INDEX.schedulerDelay,
      BASE_FEATURE_INDEX.historyMeanGap,
      BASE_FEATURE_INDEX.historyMaxGap,
      BASE_FEATURE_INDEX.recentSpeed,
      BASE_FEATURE_INDEX.ls12Speed,
      BASE_FEATURE_INDEX.ls8Speed,
      BASE_FEATURE_INDEX.last2Speed,
      BASE_FEATURE_INDEX.acceleration,
      BASE_FEATURE_INDEX.stillness,
      BASE_FEATURE_INDEX.nearZero,
      BASE_FEATURE_INDEX.pathEfficiency,
      BASE_FEATURE_INDEX.baselineDx,
      BASE_FEATURE_INDEX.baselineDy,
      BASE_FEATURE_INDEX.ls12Dx,
      BASE_FEATURE_INDEX.ls12Dy,
      BASE_FEATURE_INDEX.ls8Dx,
      BASE_FEATURE_INDEX.ls8Dy,
      BASE_FEATURE_INDEX.last2Dx,
      BASE_FEATURE_INDEX.last2Dy,
    ];
  }
  if (spec.indices === "compact") {
    return [
      BASE_FEATURE_INDEX.bias,
      BASE_FEATURE_INDEX.horizon,
      BASE_FEATURE_INDEX.anchorGap,
      BASE_FEATURE_INDEX.schedulerDelay,
      BASE_FEATURE_INDEX.historyMeanGap,
      BASE_FEATURE_INDEX.historyMaxGap,
      BASE_FEATURE_INDEX.historyGapStd,
      BASE_FEATURE_INDEX.recentSpeed,
      BASE_FEATURE_INDEX.ls12Speed,
      BASE_FEATURE_INDEX.acceleration,
      BASE_FEATURE_INDEX.stillness,
      BASE_FEATURE_INDEX.nearZero,
      BASE_FEATURE_INDEX.pathEfficiency,
      BASE_FEATURE_INDEX.baselineDx,
      BASE_FEATURE_INDEX.baselineDy,
    ];
  }
  return spec.indices;
}

function schedulerOneHot(bin) {
  return ["<=1ms", "1-4ms", "4-8ms", ">8ms", "missing"].map((id) => bin === id ? 1 : 0);
}

function speedOneHot(bin) {
  return ["0-25", "25-100", "100-250", "250-500", "500-1000", "1000-2000", ">=2000", "missing"].map((id) => bin === id ? 1 : 0);
}

function resumeRiskScore(baseFeatures, horizonMs) {
  const speed = baseFeatures[BASE_FEATURE_INDEX.recentSpeed];
  const accel = baseFeatures[BASE_FEATURE_INDEX.acceleration];
  const still = baseFeatures[BASE_FEATURE_INDEX.stillness];
  const nearZero = baseFeatures[BASE_FEATURE_INDEX.nearZero];
  const h = horizonMs >= 16 ? 1 : 0;
  return Math.max(0, Math.min(2, (speed * 0.8) + (accel * 0.7) + ((1 - still) * 0.35) + ((1 - nearZero) * 0.25) + h * 0.2));
}

function makeFeatures(spec, baseFeatures, anchor, trace, horizonMs) {
  const indices = featureIndices(spec, baseFeatures.length);
  const out = indices.map((index) => baseFeatures[index]);
  for (const extra of spec.extras || []) {
    if (extra === "schedulerOneHot") out.push(...schedulerOneHot(anchor.schedulerDelayBin));
    else if (extra === "speedOneHot") out.push(...speedOneHot(anchor.speedBin));
    else if (extra === "loadOneHot") out.push(trace.id === "stress" ? 1 : 0);
    else if (extra === "resumeRisk") out.push(resumeRiskScore(baseFeatures, horizonMs));
  }
  return out;
}

function segmentKey(spec, anchor, trace, horizonMs) {
  if (spec.segment === "global") return "global";
  if (spec.segment === "horizon") return String(horizonMs);
  if (spec.segment === "horizonScheduler") return `${horizonMs}|${anchor.schedulerDelayBin}`;
  if (spec.segment === "horizonSpeed") return `${horizonMs}|${anchor.speedBin}`;
  if (spec.segment === "horizonSchedulerSpeed") return `${horizonMs}|${anchor.schedulerDelayBin}|${anchor.speedBin}`;
  if (spec.segment === "horizonLoad") return `${horizonMs}|${trace.id}`;
  return String(horizonMs);
}

function applyTailGuard(spec, dx, dy, baseFeatures, horizonMs) {
  if (spec.tailGuard !== "causalResumeRisk") return { dx, dy };
  const risk = resumeRiskScore(baseFeatures, horizonMs);
  if (risk < 0.9) return { dx, dy };
  const blend = risk > 1.35 ? 0.35 : 0.6;
  return { dx: dx * blend, dy: dy * blend };
}

function trainCandidates(lib, traces, specs) {
  const equations = new Map();
  const summary = { trainExamples: 0, labelsMissing: 0 };
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      if (anchor.split !== "train") continue;
      anchor.cache = Object.create(null);
      for (const horizonMs of HORIZONS_MS) {
        const target = lib.interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) {
          summary.labelsMissing += 1;
          continue;
        }
        const baseline = lib.predictLeastSquares(trace, anchor, horizonMs, 12, 64);
        const baseFeatures = lib.featureVector(trace, anchor, horizonMs, baseline);
        for (const spec of specs) {
          const features = makeFeatures(spec, baseFeatures, anchor, trace, horizonMs);
          const key = `${spec.id}|${segmentKey(spec, anchor, trace, horizonMs)}`;
          let equation = equations.get(key);
          if (!equation) {
            equation = { specId: spec.id, segment: segmentKey(spec, anchor, trace, horizonMs), equation: new NormalEquation(features.length) };
            equations.set(key, equation);
          }
          equation.equation.add(features, target.x - baseline.x, target.y - baseline.y);
        }
        summary.trainExamples += 1;
      }
    }
  }
  const models = new Map();
  for (const spec of specs) models.set(spec.id, { spec, segments: new Map(), fallback: null });
  for (const entry of equations.values()) {
    const model = models.get(entry.specId);
    const solved = entry.equation.solve(model.spec.lambda);
    model.segments.set(entry.segment, solved);
    if (!model.fallback || solved.count > model.fallback.count) model.fallback = solved;
  }
  return { models, summary };
}

function predictCandidate(lib, model, trace, anchor, horizonMs, baseline, baseFeatures) {
  const features = makeFeatures(model.spec, baseFeatures, anchor, trace, horizonMs);
  const seg = model.segments.get(segmentKey(model.spec, anchor, trace, horizonMs)) || model.fallback;
  if (!seg) return baseline;
  let dx = dot(seg.weightsX, features);
  let dy = dot(seg.weightsY, features);
  ({ dx, dy } = applyTailGuard(model.spec, dx, dy, baseFeatures, horizonMs));
  return { x: baseline.x + dx, y: baseline.y + dy };
}

function createAccumulator() {
  return {
    count: 0,
    sum: 0,
    sumSquares: 0,
    max: 0,
    histogram: new Uint32Array(HISTOGRAM_BINS),
    regressions: Object.fromEntries(REGRESSION_THRESHOLDS_PX.map((threshold) => [`gt${threshold}px`, 0])),
  };
}

function addError(acc, error) {
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
  };
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
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
    };
  }
  add(section, keyParts, meta, error) {
    const key = keyParts.map(String).join("|");
    let entry = this.maps[section].get(key);
    if (!entry) {
      entry = { ...meta, accumulator: createAccumulator() };
      this.maps[section].set(key, entry);
    }
    addError(entry.accumulator, error);
  }
  addObservation(model, trace, anchor, horizonMs, error) {
    const meta = {
      modelId: model.id,
      family: model.family,
      productEligible: model.productEligible,
    };
    this.add("overallScores", [model.id], meta, error);
    this.add("perSplitScores", [model.id, anchor.split, trace.id], { ...meta, split: anchor.split, loadCondition: trace.id }, error);
    this.add("perLoadConditionScores", [model.id, trace.id], { ...meta, loadCondition: trace.id }, error);
    this.add("perHorizonScores", [model.id, horizonMs, trace.id], { ...meta, horizonMs, loadCondition: trace.id }, error);
    this.add("perMovementCategoryScores", [model.id, anchor.movementCategory, trace.id], { ...meta, movementCategory: anchor.movementCategory, loadCondition: trace.id }, error);
    this.add("perSchedulerDelayBinScores", [model.id, anchor.schedulerDelayBin, trace.id], { ...meta, schedulerDelayBin: anchor.schedulerDelayBin, loadCondition: trace.id }, error);
    this.add("perSplitHorizonLoadScores", [model.id, anchor.split, horizonMs, trace.id], { ...meta, split: anchor.split, horizonMs, loadCondition: trace.id }, error);
    if (anchor.split === "validation" || anchor.split === "test") {
      this.add("perValidationTestCategoryHorizonScores", [model.id, anchor.split, trace.id, horizonMs, anchor.movementCategory], {
        ...meta,
        split: anchor.split,
        horizonMs,
        loadCondition: trace.id,
        movementCategory: anchor.movementCategory,
      }, error);
    }
  }
  finalizeMap(name) {
    return [...this.maps[name].values()].map((entry) => {
      const { accumulator, ...meta } = entry;
      return { ...meta, error: finalize(accumulator) };
    }).sort(scoreSort);
  }
  finalize() {
    return Object.fromEntries(Object.keys(this.maps).map((name) => [name, this.finalizeMap(name)]));
  }
}

function scoreSort(a, b) {
  return String(a.modelId).localeCompare(String(b.modelId))
    || String(a.loadCondition || "").localeCompare(String(b.loadCondition || ""))
    || String(a.split || "").localeCompare(String(b.split || ""))
    || Number(a.horizonMs || 0) - Number(b.horizonMs || 0)
    || String(a.movementCategory || "").localeCompare(String(b.movementCategory || ""))
    || String(a.schedulerDelayBin || "").localeCompare(String(b.schedulerDelayBin || ""));
}

function evaluate(lib, traces, models, step3Teacher) {
  const store = new ScoreStore();
  const modelList = [
    { id: "ls12_baseline", family: "baseline", productEligible: true },
    { id: "step3_teacher_ridge_residual_segmented_horizon", family: "step3_teacher", productEligible: true },
    ...[...models.values()].map((model) => ({
      id: model.spec.id,
      family: model.spec.family,
      productEligible: model.spec.productEligible,
    })),
  ];
  for (const trace of traces) {
    for (const anchor of trace.anchors.rows) {
      anchor.cache = Object.create(null);
      for (const horizonMs of HORIZONS_MS) {
        const target = lib.interpolateReference(trace, anchor.anchorUs + horizonMs * 1000);
        if (!target) continue;
        const baseline = lib.predictLeastSquares(trace, anchor, horizonMs, 12, 64);
        const baseFeatures = lib.featureVector(trace, anchor, horizonMs, baseline);
        const teacher = lib.applyRidge(baseline, baseFeatures, step3Teacher.coefficientsByHorizon[String(horizonMs)]);
        const predictions = new Map();
        predictions.set("ls12_baseline", baseline);
        predictions.set("step3_teacher_ridge_residual_segmented_horizon", teacher);
        for (const model of models.values()) {
          predictions.set(model.spec.id, predictCandidate(lib, model, trace, anchor, horizonMs, baseline, baseFeatures));
        }
        for (const model of modelList) {
          const pred = predictions.get(model.id);
          store.addObservation(model, trace, anchor, horizonMs, lib.distance(pred.x, pred.y, target.x, target.y));
        }
      }
    }
  }
  return { scores: store.finalize(), modelList };
}

function operationEstimate(spec, model, cpuAudit) {
  const dim = model.fallback?.weightsX?.length || featureDimension(spec);
  const segmentCount = model.segments.size || 1;
  const paramCount = dim * 2 * segmentCount;
  const macsPerPrediction = dim * 2;
  const memoryFloats = dim + dim * 2;
  return CPU_PROFILES.map((profile) => {
    const availability = cpuAudit.profileAvailability[profile.id] || { available: false, unknownRequired: [] };
    const vectorOps = Math.ceil(dim / profile.vectorWidthFloats) * 2;
    return {
      modelId: spec.id,
      family: spec.family,
      size: spec.size,
      cpuProfile: profile.id,
      deployableOnThisMachine: Boolean(availability.available),
      unknownRequiredFeatures: availability.unknownRequired,
      vectorWidthFloats: profile.vectorWidthFloats,
      dim,
      segmentCount,
      paramCount,
      macsPerPrediction,
      estimatedVectorOps: vectorOps,
      memoryFloatsPerPrediction: memoryFloats,
      simdLaneUtilization: round(dim / (Math.ceil(dim / profile.vectorWidthFloats) * profile.vectorWidthFloats), 4),
      branchOrGateComplexity: spec.tailGuard ? "tail_guard + segment lookup" : "segment lookup",
      note: profile.note || spec.note || null,
    };
  });
}

function featureDimension(spec) {
  const base = featureIndices(spec, 26).length;
  let extra = 0;
  for (const item of spec.extras || []) {
    if (item === "schedulerOneHot") extra += 5;
    else if (item === "speedOneHot") extra += 8;
    else if (item === "loadOneHot") extra += 1;
    else if (item === "resumeRisk") extra += 1;
  }
  return base + extra;
}

function bestValidation(scores) {
  const rows = scores.perSplitScores.filter((row) => row.split === "validation" && row.productEligible);
  const ranked = rows.map((row) => ({
    modelId: row.modelId,
    family: row.family,
    loadCondition: row.loadCondition,
    count: row.error.count,
    mean: row.error.mean,
    p95: row.error.p95,
    p99: row.error.p99,
    gt5px: row.error.regressionRates.gt5px,
    gt10px: row.error.regressionRates.gt10px,
  })).sort((a, b) => a.p95 - b.p95 || a.mean - b.mean);
  const byModel = new Map();
  for (const row of rows) {
    let item = byModel.get(row.modelId);
    if (!item) item = { modelId: row.modelId, family: row.family, count: 0, weightedMean: 0, weightedP95: 0, weightedP99: 0 };
    item.count += row.error.count;
    item.weightedMean += row.error.mean * row.error.count;
    item.weightedP95 += row.error.p95 * row.error.count;
    item.weightedP99 += row.error.p99 * row.error.count;
    byModel.set(row.modelId, item);
  }
  const overall = [...byModel.values()].map((item) => ({
    modelId: item.modelId,
    family: item.family,
    count: item.count,
    mean: round(item.weightedMean / item.count),
    p95: round(item.weightedP95 / item.count),
    p99: round(item.weightedP99 / item.count),
  })).sort((a, b) => a.p95 - b.p95 || a.mean - b.mean);
  const comparisonOnly = new Set(["ls12_baseline", "step3_teacher_ridge_residual_segmented_horizon"]);
  const selected = overall.find((row) => !comparisonOnly.has(row.modelId)) || overall[0];
  return { rankedByLoad: ranked, overall, selected };
}

function scoreLookup(scores, modelId, split, loadCondition) {
  return scores.perSplitScores.find((row) => row.modelId === modelId && row.split === split && row.loadCondition === loadCondition);
}

function scoreLookupHorizon(scores, modelId, split, loadCondition, horizonMs) {
  return scores.perSplitHorizonLoadScores.find((row) => (
    row.modelId === modelId && row.split === split && row.loadCondition === loadCondition && Number(row.horizonMs) === Number(horizonMs)
  ));
}

function improvementRows(scores, candidateId, baselineId) {
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
      });
    }
  }
  return rows;
}

function segmentRegressionRows(scores, candidateId, baselineId) {
  const rows = [];
  for (const base of scores.perValidationTestCategoryHorizonScores.filter((row) => row.modelId === baselineId)) {
    const cand = scores.perValidationTestCategoryHorizonScores.find((row) => (
      row.modelId === candidateId
      && row.split === base.split
      && row.loadCondition === base.loadCondition
      && Number(row.horizonMs) === Number(base.horizonMs)
      && row.movementCategory === base.movementCategory
    ));
    if (!cand) continue;
    const p95Delta = round(cand.error.p95 - base.error.p95);
    const p99Delta = round(cand.error.p99 - base.error.p99);
    const meanDelta = round(cand.error.mean - base.error.mean);
    if (p95Delta > 0 || p99Delta > 0 || meanDelta > 0) {
      rows.push({
        split: base.split,
        loadCondition: base.loadCondition,
        horizonMs: base.horizonMs,
        movementCategory: base.movementCategory,
        count: base.error.count,
        baselineP95: base.error.p95,
        candidateP95: cand.error.p95,
        p95Delta,
        baselineP99: base.error.p99,
        candidateP99: cand.error.p99,
        p99Delta,
        meanDelta,
      });
    }
  }
  return rows.sort((a, b) => b.p95Delta - a.p95Delta || b.p99Delta - a.p99Delta || b.meanDelta - a.meanDelta);
}

function table(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, col) => Math.max(...all.map((row) => String(row[col] ?? "").length)));
  const format = (row) => `| ${row.map((cell, col) => String(cell ?? "").padEnd(widths[col])).join(" | ")} |`;
  return [format(headers), format(headers.map((_, col) => "-".repeat(widths[col]))), ...rows.map(format)].join("\n");
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (typeof value === "number") return String(round(value, digits));
  return String(value);
}

function renderReport(result) {
  const selected = result.selection.selected.modelId;
  const cpuRows = CPU_PROFILES.map((profile) => {
    const avail = result.cpuFeatureAudit.profileAvailability[profile.id];
    return [
      profile.id,
      profile.vectorWidthFloats,
      avail.available ? "yes" : "no",
      avail.unknownRequired.join(", ") || "none",
      profile.requires.join(", ") || "none",
    ];
  });
  const familyRows = Object.entries(FAMILY_DEFINITIONS).map(([family, definition]) => [family, definition]);
  const sourceRows = result.sourceFiles.map((source) => [source.id, source.file, source.label]);
  const splitRows = ["train", "validation", "test"].map((splitName) => [
    splitName,
    result.splitDefinition[splitName].length,
    result.splitDefinition[splitName].join(", "),
  ]);
  const designRows = result.modelDesigns.map((model) => [
    model.id,
    model.family,
    model.size,
    model.productEligible ? "yes" : "no",
    model.segment,
    model.channels,
    model.taps,
  ]);
  const rankRows = result.selection.overall.slice(0, 10).map((row, index) => [index + 1, row.modelId, row.family, row.count, fmt(row.mean), fmt(row.p95), fmt(row.p99)]);
  const diffRows = result.step3TeacherDelta.map((row) => [
    row.split,
    row.loadCondition,
    fmt(row.baselineP95),
    fmt(row.candidateP95),
    fmt(row.p95Delta),
    fmt(row.baselineP99),
    fmt(row.candidateP99),
    fmt(row.p99Delta),
    fmt(row.gt5Delta, 5),
    fmt(row.gt10Delta, 5),
  ]);
  const horizonRows = [];
  for (const load of ["normal", "stress"]) {
    for (const horizon of HORIZONS_MS) {
      const base = scoreLookupHorizon(result.scores, "step3_teacher_ridge_residual_segmented_horizon", "test", load, horizon);
      const cand = scoreLookupHorizon(result.scores, selected, "test", load, horizon);
      if (!base || !cand) continue;
      horizonRows.push([load, horizon, fmt(base.error.p95), fmt(cand.error.p95), fmt(cand.error.p95 - base.error.p95), fmt(base.error.p99), fmt(cand.error.p99), fmt(cand.error.p99 - base.error.p99)]);
    }
  }
  const movementRows = result.scores.perValidationTestCategoryHorizonScores
    .filter((row) => row.modelId === selected && row.loadCondition && ["moving", "hold", "resume"].includes(row.movementCategory))
    .sort((a, b) => a.split.localeCompare(b.split) || a.loadCondition.localeCompare(b.loadCondition) || a.horizonMs - b.horizonMs || a.movementCategory.localeCompare(b.movementCategory))
    .map((row) => [
      row.split,
      row.loadCondition,
      row.horizonMs,
      row.movementCategory,
      row.error.count,
      fmt(row.error.mean),
      fmt(row.error.p95),
      fmt(row.error.p99),
      fmt(row.error.regressionRates.gt5px, 5),
      fmt(row.error.regressionRates.gt10px, 5),
    ]);
  const schedulerRows = result.scores.perSchedulerDelayBinScores
    .filter((row) => row.modelId === selected && row.loadCondition)
    .map((row) => [row.loadCondition, row.schedulerDelayBin, row.error.count, fmt(row.error.mean), fmt(row.error.p95), fmt(row.error.p99), fmt(row.error.regressionRates.gt10px, 5)])
    .slice(0, 20);
  const riskRows = result.segmentRegressionRisksVsStep3.slice(0, 12).map((row) => [
    row.split,
    row.loadCondition,
    row.horizonMs,
    row.movementCategory,
    row.count,
    fmt(row.baselineP95),
    fmt(row.candidateP95),
    fmt(row.p95Delta),
    fmt(row.baselineP99),
    fmt(row.candidateP99),
    fmt(row.p99Delta),
  ]);
  const costRows = result.deployabilityEstimates
    .filter((row) => row.modelId === selected)
    .map((row) => [row.cpuProfile, row.deployableOnThisMachine ? "yes" : "no", row.dim, row.segmentCount, row.paramCount, row.macsPerPrediction, row.estimatedVectorOps, row.simdLaneUtilization]);

  return `# Step 4 FSMN Family Search

## Intent

This step searches CPU-deployable finite-memory residual models named as FSMN-family variants. The evaluation contract is unchanged from Steps 2/3: product \`poll\` anchor, causal \`referencePoll\` history, horizons ${HORIZONS_MS.join(", ")} ms, and Step 1 scenario split. Validation selects the best model; test is read once after selection.

Step 3 best, \`ridge_residual_segmented_horizon\`, is included as \`step3_teacher_ridge_residual_segmented_horizon\` and used as the comparison/teacher baseline.

## Data Split / Sources

${table(["load id", "zip", "label"], sourceRows)}

Split is scenario-level and reused for normal/stress to avoid leakage through near-identical motion scripts.

${table(["split", "scenario count", "scenario indices"], splitRows)}

## CPU Feature Audit

Processor: \`${result.cpuFeatureAudit.processorModel}\`, logical CPUs: ${result.cpuFeatureAudit.logicalCpuCount}.

Detected: AVX=${result.cpuFeatureAudit.avx}, AVX2=${result.cpuFeatureAudit.avx2}, FMA3=${result.cpuFeatureAudit.fma3}, AVX-512F=${result.cpuFeatureAudit.avx512f}.

${table(["profile", "lanes", "available", "unknown required", "requires"], cpuRows)}

## Family Definitions

${table(["family", "definition"], familyRows)}

## CPU Profile / Model Designs

${table(["model", "family", "size", "product eligible", "segment", "channels", "taps"], designRows)}

## Validation Selection

${table(["rank", "model", "family", "count", "mean px", "p95 px", "p99 px"], rankRows)}

Selected for test comparison: \`${selected}\`.

## Delta Vs Step 3 Teacher

${table(["split", "load", "teacher p95", "candidate p95", "p95 delta", "teacher p99", "candidate p99", "p99 delta", ">5px delta", ">10px delta"], diffRows)}

## Test Horizon Breakdown

${table(["load", "horizon ms", "teacher p95", "candidate p95", "p95 delta", "teacher p99", "candidate p99", "p99 delta"], horizonRows)}

## Movement Category / Horizon Breakdown

${table(["split", "load", "horizon ms", "category", "count", "mean px", "p95 px", "p99 px", ">5px", ">10px"], movementRows)}

## Scheduler Delay Breakdown

${table(["load", "scheduler bin", "count", "mean px", "p95 px", "p99 px", ">10px"], schedulerRows)}

## Resume Tail Regression Check

${table(["split", "load", "horizon ms", "category", "count", "teacher p95", "candidate p95", "p95 delta", "teacher p99", "candidate p99", "p99 delta"], riskRows.length ? riskRows : [["none", "none", "none", "none", 0, 0, 0, 0, 0, 0, 0]])}

## Deployability Estimate For Selected Model

${table(["profile", "available", "dim", "segments", "params", "MACs", "vector ops", "lane utilization"], costRows)}

## Step 5 Recommendation

Carry \`${selected}\` forward only as a design reference if its test tail is no worse than the Step 3 teacher. If it does not beat the teacher, keep \`ridge_residual_segmented_horizon\` as the production-safe teacher and use Step 5 to search a guarded VFSMNv2/CVFSMNv2 with explicit resume-tail loss. Missing ingredients toward near-zero error are: stronger resume-state inference from causal history, tail-aware loss/selection, and a no-scheduler-delay ablation for runtimes that cannot expose scheduler timing to the predictor.
`;
}

function renderNotes(result) {
  return `# Step 4 Notes

## Rerun

\`\`\`powershell
$env:CURSOR_PREDICTION_CPU_FEATURES_JSON='{"avx":true,"avx2":true,"fma3":true,"avx512f":true}'
node poc\\cursor-prediction-v11\\scripts\\run-step4-fsmn-family-search.js
\`\`\`

## Causality

All product-eligible FSMN-family variants use the same causal Step 3 feature vector. The \`CSFSMN_loadaware_analysis\` candidate is marked non-product because it uses recording load id. Script-derived movement category is used only as an evaluation label, not as product input.

## CPU Audit Caveat

This run recorded AVX/AVX2/FMA/AVX-512F through a PowerShell .NET Intrinsics check passed via \`CURSOR_PREDICTION_CPU_FEATURES_JSON\`. If the override is omitted, the script falls back to \`IsProcessorFeaturePresent\`; in this sandbox that child-process fallback may be blocked, and FMA3 is otherwise unknown without native CPUID. Performance numbers are deployability estimates, not actual SIMD kernel timings, and should be treated as noisy because the machine is shared.

## Step 5 Guardrail

Do not advance a model solely on aggregate mean. Require normal/stress test p95 and p99 not to regress against \`step3_teacher_ridge_residual_segmented_horizon\`, with extra scrutiny on resume horizons 16.67-50 ms.
`;
}

function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.outDir);
  const lib = loadStep3Library(args.step3Script);
  const step1Scores = JSON.parse(fs.readFileSync(args.step1Scores, "utf8"));
  const split = lib.parseSplit(step1Scores);
  const cpuAudit = cpuFeatureAudit(args.root);
  const traces = PACKAGES.map((target) => lib.loadTracePackage(args.root, target, split));
  const step3Training = lib.trainModels(traces);
  const step3Selection = lib.evaluateRidgeCandidates(traces, step3Training);
  const step3Teacher = step3Selection.horizon.selected;
  const specs = candidateSpecs();
  const trained = trainCandidates(lib, traces, specs);
  const { scores, modelList } = evaluate(lib, traces, trained.models, step3Teacher);
  const selection = bestValidation(scores);
  const selectedId = selection.selected.modelId;
  const step3TeacherDelta = improvementRows(scores, selectedId, "step3_teacher_ridge_residual_segmented_horizon");
  const ls12Delta = improvementRows(scores, selectedId, "ls12_baseline");
  const segmentRegressionRisksVsStep3 = segmentRegressionRows(scores, selectedId, "step3_teacher_ridge_residual_segmented_horizon");
  const deployabilityEstimates = specs.flatMap((spec) => operationEstimate(spec, trained.models.get(spec.id), cpuAudit));

  const result = {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUtc: new Date().toISOString(),
    constraints: {
      gpuUsed: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
      trainingRun: "CPU-only ridge finite-memory family search",
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
      validationSelectsBest: true,
      testViewedAfterSelection: true,
    },
    cpuFeatureAudit: cpuAudit,
    familyDefinitions: FAMILY_DEFINITIONS,
    cpuProfiles: CPU_PROFILES,
    modelDesigns: specs,
    trainingSummary: trained.summary,
    step3Teacher: {
      id: "step3_teacher_ridge_residual_segmented_horizon",
      selectedLambda: step3Teacher.lambda,
    },
    modelList,
    scores,
    selection,
    step3TeacherDelta,
    ls12Delta,
    segmentRegressionRisksVsStep3,
    deployabilityEstimates,
    nextStepRecommendation: {
      advanceModel: selectedId,
      advanceCondition: "Advance only if tail deltas against Step 3 teacher are acceptable; otherwise keep Step 3 teacher and use Step 4 features for guarded Step 5.",
      requiredStep5Ablations: [
        "no scheduler-delay feature",
        "resume-tail guarded loss",
        "VFSMNv2 vs CVFSMNv2 at 16/24/32 channels",
        "normal/stress separate validation and test reports",
      ],
    },
  };

  fs.writeFileSync(path.join(args.outDir, "scores.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(args.outDir, "report.md"), renderReport(result), "utf8");
  fs.writeFileSync(path.join(args.outDir, "notes.md"), renderNotes(result), "utf8");
  process.stdout.write(`Wrote:
${path.relative(args.root, path.join(args.outDir, "report.md")).replaceAll(path.sep, "/")}
${path.relative(args.root, path.join(args.outDir, "scores.json")).replaceAll(path.sep, "/")}
${path.relative(args.root, path.join(args.outDir, "notes.md")).replaceAll(path.sep, "/")}
`);
}

main();
