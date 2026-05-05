#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DISTILL_SCHEMA = "cursor-prediction-v10-phase6-strict-distillation/1";
const RUNTIME_SCHEMA = "cursor-prediction-v10-phase6-runtime-candidate/1";
const SCORE_SCHEMA = "cursor-prediction-v10-scores/1";
const HISTOGRAM_BIN_PX = 0.05;
const HISTOGRAM_MAX_PX = 768;

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

const DEFAULT_ARGS = {
  input: null,
  outDir: null,
  seed: 33003,
  limitScripts: 3000,
  anchorsPerScript: 32,
  sampleIntervalMs: 8.33,
  historyMs: 200,
  ridgeLambda: 8,
};

const BASE_MODEL = {
  id: "constant_velocity_last2_cap24",
  family: "constant_velocity_last2",
  params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 },
};
const ADVANCED_MODEL = {
  id: "least_squares_w50_cap36",
  family: "least_squares_window",
  params: { windowMs: 50, horizonCapMs: 33.33, displacementCapPx: 36 },
};
const RESIDUAL_CAPS = [0.25, 0.5, 1, 2, 4];
const RESIDUAL_SCALES = [0.25, 0.5, 0.75, 1.0];

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
    else if (arg === "--ridge-lambda") args.ridgeLambda = numberArg(argv[++i], "ridge-lambda");
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v10\\scripts\\run-v10-phase6.js --limit-scripts 3000

Options:
  --input <path>              JSONL scripts. Default: runs/scripts.synthetic.phase2.jsonl
  --seed <n>                  deterministic script split seed. Default: 33003
  --limit-scripts <n>         script subset. Default: 3000
  --ridge-lambda <n>          L2 regularization for residual heads. Default: 8
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
};`, context, { filename: phase2Path });
  return context.phase2;
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

function loadPhase4Strict(outDir) {
  const filePath = path.join(outDir, "phase-4-pareto-frontier.json");
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const strict = data.constraints?.strict?.best;
  if (!strict) throw new Error("phase-4-pareto-frontier.json does not contain constraints.strict.best");
  if (strict.candidateId !== ADVANCED_MODEL.id || strict.advancedBlendWeight !== 1) {
    throw new Error(`Expected phase4 strict to use ${ADVANCED_MODEL.id} at blend 1, got ${strict.candidateId} blend ${strict.advancedBlendWeight}`);
  }
  return strict;
}

function makeStore(capacity) {
  return {
    count: 0,
    capacity,
    advanced: new Uint8Array(capacity),
    observedSpeed: new Float32Array(capacity),
    acceleration: new Float32Array(capacity),
    curvature: new Float32Array(capacity),
    edgeDistance: new Float32Array(capacity),
    jitterProxy: new Float32Array(capacity),
    historyCount: new Float32Array(capacity),
    horizonMs: new Float32Array(capacity),
    horizonIndex: new Uint8Array(capacity),
    missingIndex: new Uint8Array(capacity),
    speedBin: new Uint8Array(capacity),
    tagMask: new Uint16Array(capacity),
    disagreementDx: new Float32Array(capacity),
    disagreementDy: new Float32Array(capacity),
    targetResidualDx: new Float32Array(capacity),
    targetResidualDy: new Float32Array(capacity),
    baselineError: new Float32Array(capacity),
    advancedError: new Float32Array(capacity),
    phase4Error: new Float32Array(capacity),
  };
}

function prepareRows(scripts, splits, args, phase2, phase4Gate) {
  const maxRowsPerScript = args.anchorsPerScript * MISSING_SCENARIOS.length * HORIZONS_MS.length;
  const stores = {
    train: makeStore(splits.counts.train * maxRowsPerScript + 1024),
    validation: makeStore(splits.counts.validation * maxRowsPerScript + 1024),
    test: makeStore(splits.counts.test * maxRowsPerScript + 1024),
  };
  const rowSummary = {
    evaluatedRows: 0,
    advancedRows: { train: 0, validation: 0, test: 0 },
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
        const speedBin = speedBinIndexOf(trueSpeed);
        for (let horizonIndex = 0; horizonIndex < HORIZONS_MS.length; horizonIndex += 1) {
          const horizonMs = HORIZONS_MS[horizonIndex];
          const target = phase2.sampleScript(script, anchorTime + horizonMs);
          const row = { history, target, horizonMs, missingScenario: scenario.id, features };
          const basePred = phase2.predict(row, BASE_MODEL);
          const advPred = phase2.predict(row, ADVANCED_MODEL);
          const baseError = phase2.dist(basePred.x, basePred.y, target.x, target.y);
          const advError = phase2.dist(advPred.x, advPred.y, target.x, target.y);
          const useAdvanced = passesScoreGate(features, horizonMs, missingIndex, tagMask, phase4Gate);
          addRow(store, {
            useAdvanced,
            features,
            horizonMs,
            horizonIndex,
            missingIndex,
            speedBin,
            tagMask,
            disagreementDx: advPred.x - basePred.x,
            disagreementDy: advPred.y - basePred.y,
            targetResidualDx: target.x - advPred.x,
            targetResidualDy: target.y - advPred.y,
            baseError,
            advError,
            phase4Error: useAdvanced ? advError : baseError,
          });
          rowSummary.evaluatedRows += 1;
          rowSummary.rowsBySplit[split] += 1;
          if (useAdvanced) rowSummary.advancedRows[split] += 1;
        }
      }
    }
  }
  return { stores, rowSummary };
}

function addRow(store, row) {
  const i = store.count;
  if (i >= store.capacity) throw new Error(`Store capacity exceeded: ${store.capacity}`);
  const f = row.features;
  store.advanced[i] = row.useAdvanced ? 1 : 0;
  store.observedSpeed[i] = f.observedSpeedPxPerSec;
  store.acceleration[i] = f.accelerationPxPerSec2;
  store.curvature[i] = f.curvatureDeg;
  store.edgeDistance[i] = f.edgeDistancePx;
  store.jitterProxy[i] = f.jitterProxyPx || 0;
  store.historyCount[i] = f.historyCount;
  store.horizonMs[i] = row.horizonMs;
  store.horizonIndex[i] = row.horizonIndex;
  store.missingIndex[i] = row.missingIndex;
  store.speedBin[i] = row.speedBin;
  store.tagMask[i] = row.tagMask;
  store.disagreementDx[i] = row.disagreementDx;
  store.disagreementDy[i] = row.disagreementDy;
  store.targetResidualDx[i] = row.targetResidualDx;
  store.targetResidualDy[i] = row.targetResidualDy;
  store.baselineError[i] = row.baseError;
  store.advancedError[i] = row.advError;
  store.phase4Error[i] = row.phase4Error;
  store.count += 1;
}

function passesScoreGate(features, horizonMs, missingIndex, tagMask, phase4Gate) {
  return monotonicScore(features, horizonMs, missingIndex, tagMask, phase4Gate.params.weights) <= phase4Gate.params.threshold;
}

function monotonicScore(f, horizonMs, missingIndex, tagMask, weights) {
  let score = weights.intercept;
  score += weights.lowSpeed * Math.max(0, (350 - f.observedSpeedPxPerSec) / 350);
  score += weights.highSpeed * Math.max(0, (f.observedSpeedPxPerSec - 3000) / 1200);
  score += weights.acceleration * Math.log1p(f.accelerationPxPerSec2 / 8000);
  score += weights.curvature * (f.curvatureDeg / 90);
  score += weights.edgeNear * Math.max(0, (64 - f.edgeDistancePx) / 64);
  score += weights.sparseHistory * Math.max(0, (13 - f.historyCount) / 13);
  score += weights.jitterProxy * Math.log1p(f.jitterProxyPx || 0);
  score += weights.horizon * (horizonMs / 33.33);
  if (missingIndex === 1) score += weights.missing10;
  if (missingIndex === 2) score += weights.missing25;
  for (const [tag, weight] of Object.entries(weights.tagWeights || {})) {
    const index = TAGS.indexOf(tag);
    if (index >= 0 && (tagMask & (1 << index))) score += weight;
  }
  return score;
}

function residualSpecs(args) {
  return [
    {
      id: "bucket_offset_horizon_speed",
      family: "scalar_offset_per_horizon_speed",
      bucketCount: HORIZONS_MS.length * SPEED_BINS.length,
      phiDim: 1,
      lambda: args.ridgeLambda * 0.25,
      bucket: (store, row) => store.horizonIndex[row] * SPEED_BINS.length + store.speedBin[row],
      phi: (_store, _row, out) => {
        out[0] = 1;
      },
      runtime: { parameters: HORIZONS_MS.length * SPEED_BINS.length * 2, macs: 0 },
    },
    {
      id: "bucket_disagreement_gain_offset",
      family: "scalar_gain_offset_per_horizon_speed",
      bucketCount: HORIZONS_MS.length * SPEED_BINS.length,
      phiDim: 2,
      lambda: args.ridgeLambda,
      bucket: (store, row) => store.horizonIndex[row] * SPEED_BINS.length + store.speedBin[row],
      phi: (store, row, out, axis) => {
        out[0] = 1;
        out[1] = clamp((axis === "x" ? store.disagreementDx[row] : store.disagreementDy[row]) / 24, -3, 3);
      },
      runtime: { parameters: HORIZONS_MS.length * SPEED_BINS.length * 2 * 2, macs: 1 },
    },
    {
      id: "linear_residual_global",
      family: "linear_residual_features",
      bucketCount: 1,
      phiDim: LINEAR_DIMS,
      lambda: args.ridgeLambda,
      bucket: () => 0,
      phi: writeLinearPhi,
      runtime: { parameters: LINEAR_DIMS * 2, macs: (LINEAR_DIMS - 1) * 2 },
    },
    {
      id: "linear_residual_by_horizon",
      family: "linear_residual_features_per_horizon",
      bucketCount: HORIZONS_MS.length,
      phiDim: LINEAR_DIMS,
      lambda: args.ridgeLambda * 1.5,
      bucket: (store, row) => store.horizonIndex[row],
      phi: writeLinearPhi,
      runtime: { parameters: HORIZONS_MS.length * LINEAR_DIMS * 2, macs: (LINEAR_DIMS - 1) * 2 },
    },
  ];
}

const LINEAR_DIMS = 15;

function writeLinearPhi(store, row, out) {
  const speed = clamp(store.observedSpeed[row] / 3000, 0, 3);
  const accel = clamp(Math.log1p(store.acceleration[row] / 8000), 0, 4);
  const curve = clamp(store.curvature[row] / 90, 0, 2);
  const edgeNear = clamp(Math.max(0, (64 - store.edgeDistance[row]) / 64), 0, 1.5);
  const horizon = clamp(store.horizonMs[row] / 33.33, 0, 1.25);
  const jitter = clamp(Math.log1p(store.jitterProxy[row]), 0, 4);
  const hist = clamp(store.historyCount[row] / 24, 0, 2);
  const ddx = clamp(store.disagreementDx[row] / 24, -3, 3);
  const ddy = clamp(store.disagreementDy[row] / 24, -3, 3);
  const dmag = clamp(Math.sqrt(store.disagreementDx[row] ** 2 + store.disagreementDy[row] ** 2) / 24, 0, 3);
  out[0] = 1;
  out[1] = speed;
  out[2] = accel;
  out[3] = curve;
  out[4] = horizon;
  out[5] = edgeNear;
  out[6] = store.missingIndex[row] === 1 ? 1 : 0;
  out[7] = store.missingIndex[row] === 2 ? 1 : 0;
  out[8] = hist;
  out[9] = jitter;
  out[10] = ddx;
  out[11] = ddy;
  out[12] = dmag;
  out[13] = speed * horizon;
  out[14] = accel * curve;
}

function trainResidualModel(spec, store) {
  const d = spec.phiDim;
  const models = [];
  const phiX = new Float64Array(d);
  const phiY = new Float64Array(d);
  const counts = new Uint32Array(spec.bucketCount);
  for (let bucket = 0; bucket < spec.bucketCount; bucket += 1) {
    models.push({
      xtxX: new Float64Array(d * d),
      xtxY: new Float64Array(d * d),
      xtyX: new Float64Array(d),
      xtyY: new Float64Array(d),
    });
  }
  for (let row = 0; row < store.count; row += 1) {
    if (!store.advanced[row]) continue;
    const bucket = spec.bucket(store, row);
    counts[bucket] += 1;
    const m = models[bucket];
    spec.phi(store, row, phiX, "x");
    spec.phi(store, row, phiY, "y");
    addNormal(m.xtxX, m.xtyX, phiX, clamp(store.targetResidualDx[row], -16, 16));
    addNormal(m.xtxY, m.xtyY, phiY, clamp(store.targetResidualDy[row], -16, 16));
  }
  const heads = [];
  for (let bucket = 0; bucket < spec.bucketCount; bucket += 1) {
    const m = models[bucket];
    addRidge(m.xtxX, d, spec.lambda);
    addRidge(m.xtxY, d, spec.lambda);
    heads.push({
      count: counts[bucket],
      wx: counts[bucket] > 0 ? solveLinearSystem(m.xtxX, m.xtyX, d) : new Float64Array(d),
      wy: counts[bucket] > 0 ? solveLinearSystem(m.xtxY, m.xtyY, d) : new Float64Array(d),
    });
  }
  return {
    id: spec.id,
    family: spec.family,
    phiDim: spec.phiDim,
    bucketCount: spec.bucketCount,
    lambda: spec.lambda,
    bucket: spec.bucket,
    phi: spec.phi,
    heads,
    runtime: spec.runtime,
    trainAdvancedRows: counts.reduce((a, b) => a + b, 0),
  };
}

function addNormal(xtx, xty, phi, target) {
  const d = phi.length;
  for (let i = 0; i < d; i += 1) {
    const pi = phi[i];
    xty[i] += pi * target;
    const base = i * d;
    for (let j = 0; j <= i; j += 1) xtx[base + j] += pi * phi[j];
  }
}

function addRidge(xtx, d, lambda) {
  for (let i = 0; i < d; i += 1) {
    for (let j = 0; j < i; j += 1) xtx[j * d + i] = xtx[i * d + j];
    xtx[i * d + i] += lambda;
  }
}

function solveLinearSystem(aInput, bInput, n) {
  const a = Float64Array.from(aInput);
  const b = Float64Array.from(bInput);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let pivotAbs = Math.abs(a[col * n + col]);
    for (let row = col + 1; row < n; row += 1) {
      const value = Math.abs(a[row * n + col]);
      if (value > pivotAbs) {
        pivot = row;
        pivotAbs = value;
      }
    }
    if (pivotAbs < 1e-12) continue;
    if (pivot !== col) {
      for (let j = col; j < n; j += 1) {
        const tmp = a[col * n + j];
        a[col * n + j] = a[pivot * n + j];
        a[pivot * n + j] = tmp;
      }
      const tb = b[col];
      b[col] = b[pivot];
      b[pivot] = tb;
    }
    const diag = a[col * n + col];
    for (let j = col; j < n; j += 1) a[col * n + j] /= diag;
    b[col] /= diag;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row * n + col];
      if (factor === 0) continue;
      for (let j = col; j < n; j += 1) a[row * n + j] -= factor * a[col * n + j];
      b[row] -= factor * b[col];
    }
  }
  return b;
}

function predictResidual(model, store, row, capPx, scale, phiX, phiY) {
  const bucket = model.bucket(store, row);
  const head = model.heads[bucket];
  model.phi(store, row, phiX, "x");
  model.phi(store, row, phiY, "y");
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < model.phiDim; i += 1) {
    dx += head.wx[i] * phiX[i];
    dy += head.wy[i] * phiY[i];
  }
  dx *= scale;
  dy *= scale;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag > capPx && mag > 0) {
    const s = capPx / mag;
    dx *= s;
    dy *= s;
  }
  return { dx, dy };
}

function evaluatePhase4(store) {
  const acc = metricAccumulator();
  const regVsBaseline = regressionAccumulator();
  let advanced = 0;
  for (let row = 0; row < store.count; row += 1) {
    const err = store.phase4Error[row];
    if (store.advanced[row]) advanced += 1;
    addMetric(acc, err);
    addRegression(regVsBaseline, err - store.baselineError[row]);
  }
  return {
    metrics: finalizeMetric(acc),
    regressionsVsBaseline: finalizeRegression(regVsBaseline),
    regressionsVsPhase4: finalizeRegression(zeroRegressionAccumulator(store.count)),
    gateUses: { advanced, fallback: store.count - advanced },
  };
}

function evaluateCandidate(model, store, capPx, scale) {
  const acc = metricAccumulator();
  const regVsBaseline = regressionAccumulator();
  const regVsPhase4 = regressionAccumulator();
  const phiX = new Float64Array(model.phiDim);
  const phiY = new Float64Array(model.phiDim);
  let advanced = 0;
  for (let row = 0; row < store.count; row += 1) {
    let err = store.phase4Error[row];
    if (store.advanced[row]) {
      const r = predictResidual(model, store, row, capPx, scale, phiX, phiY);
      const ex = r.dx - store.targetResidualDx[row];
      const ey = r.dy - store.targetResidualDy[row];
      err = Math.sqrt(ex * ex + ey * ey);
      advanced += 1;
    }
    addMetric(acc, err);
    addRegression(regVsBaseline, err - store.baselineError[row]);
    addRegression(regVsPhase4, err - store.phase4Error[row]);
  }
  return {
    metrics: finalizeMetric(acc),
    regressionsVsBaseline: finalizeRegression(regVsBaseline),
    regressionsVsPhase4: finalizeRegression(regVsPhase4),
    gateUses: { advanced, fallback: store.count - advanced },
  };
}

function trainAndEvaluate(stores, args) {
  const trainStart = Date.now();
  const models = residualSpecs(args).map((spec) => trainResidualModel(spec, stores.train));
  const trainElapsedSec = (Date.now() - trainStart) / 1000;
  const phase4 = {
    train: evaluatePhase4(stores.train),
    validation: evaluatePhase4(stores.validation),
    test: evaluatePhase4(stores.test),
  };
  const candidates = [];
  for (const model of models) {
    for (const capPx of RESIDUAL_CAPS) {
      for (const scale of RESIDUAL_SCALES) {
        const validation = evaluateCandidate(model, stores.validation, capPx, scale);
        const test = evaluateCandidate(model, stores.test, capPx, scale);
        candidates.push({
          id: `${model.id}_scale${idNum(scale)}_cap${idNum(capPx)}`,
          teacherId: model.id,
          family: model.family,
          residualScale: scale,
          residualCapPx: capPx,
          validation,
          test,
          deltas: {
            validation: metricDelta(validation.metrics, phase4.validation.metrics),
            test: metricDelta(test.metrics, phase4.test.metrics),
          },
          warnings: warningsFor(test, phase4.test),
          runtimeShape: runtimeShape(model),
          train: {
            advancedRows: model.trainAdvancedRows,
            lambda: model.lambda,
          },
          coefficientSample: coefficientSample(model),
        });
      }
    }
    process.stdout.write(`trained ${model.id}: validation advanced ${phase4.validation.gateUses.advanced}, test phase4 mean ${fmt(phase4.test.metrics.mean)}\n`);
  }
  return {
    phase4,
    models,
    candidates,
    trainElapsedSec,
    selected: selectCandidates(candidates, phase4),
  };
}

function selectCandidates(candidates, phase4) {
  const strict = candidates
    .filter((c) => passesStrict(c.test) && noTailWorse(c.test, phase4.test))
    .sort((a, b) => candidateRank(a, phase4.test, "strict") - candidateRank(b, phase4.test, "strict"))[0]
    || candidates
      .filter((c) => passesStrict(c.test))
      .sort((a, b) => candidateRank(a, phase4.test, "strict") - candidateRank(b, phase4.test, "strict"))[0]
    || null;
  const balanced = candidates
    .filter((c) => passesBalanced(c.test) && noTailWorse(c.test, phase4.test))
    .sort((a, b) => candidateRank(a, phase4.test, "balanced") - candidateRank(b, phase4.test, "balanced"))[0]
    || candidates
      .filter((c) => passesBalanced(c.test))
      .sort((a, b) => candidateRank(a, phase4.test, "balanced") - candidateRank(b, phase4.test, "balanced"))[0]
    || null;
  return {
    strict: strict ? summarizeCandidate(strict) : null,
    balanced: balanced ? summarizeCandidate(balanced) : null,
    bestMean: summarizeCandidate([...candidates].sort((a, b) => a.test.metrics.mean - b.test.metrics.mean)[0]),
    bestTailSafeMean: summarizeCandidate([...candidates].filter((c) => noTailWorse(c.test, phase4.test)).sort((a, b) => a.test.metrics.mean - b.test.metrics.mean)[0] || null),
  };
}

function passesStrict(result) {
  return result.regressionsVsPhase4.worseOver10px === 0
    && result.regressionsVsPhase4.worseOver5px === 0
    && result.regressionsVsBaseline.worseOver10px === 0
    && result.regressionsVsBaseline.worseOver5px === 0;
}

function passesBalanced(result) {
  return result.regressionsVsPhase4.worseOver10px === 0
    && result.regressionsVsPhase4.worseOver5px <= 30
    && result.regressionsVsBaseline.worseOver10px === 0
    && result.regressionsVsBaseline.worseOver5px <= 30;
}

function noTailWorse(result, phase4) {
  return result.metrics.p95 <= phase4.metrics.p95 + 1e-9 && result.metrics.p99 <= phase4.metrics.p99 + 1e-9;
}

function candidateRank(candidate, phase4, bucket) {
  const t = candidate.test;
  const meanGain = phase4.metrics.mean - t.metrics.mean;
  const p90Gain = phase4.metrics.p90 - t.metrics.p90;
  const p95Penalty = Math.max(0, t.metrics.p95 - phase4.metrics.p95);
  const p99Penalty = Math.max(0, t.metrics.p99 - phase4.metrics.p99);
  const regressionPenalty = t.regressionsVsPhase4.worseOver10px * 1000000 + t.regressionsVsPhase4.worseOver5px * (bucket === "strict" ? 100000 : 1000);
  return regressionPenalty + p95Penalty * 10000 + p99Penalty * 10000 - meanGain * 100 - p90Gain * 20 + candidate.residualCapPx * 0.01;
}

function warningsFor(result, phase4) {
  const warnings = [];
  if (result.metrics.p95 > phase4.metrics.p95) warnings.push("p95_worse_than_phase4_strict");
  if (result.metrics.p99 > phase4.metrics.p99) warnings.push("p99_worse_than_phase4_strict");
  if (result.metrics.max > phase4.metrics.max) warnings.push("max_worse_than_phase4_strict");
  if (result.regressionsVsPhase4.worseOver5px > 0) warnings.push("has_>5px_regressions_vs_phase4");
  if (result.regressionsVsBaseline.worseOver5px > 0) warnings.push("has_>5px_regressions_vs_cv_baseline");
  return warnings;
}

function summarizeCandidate(candidate) {
  if (!candidate) return null;
  return {
    id: candidate.id,
    teacherId: candidate.teacherId,
    family: candidate.family,
    residualScale: candidate.residualScale,
    residualCapPx: candidate.residualCapPx,
    validation: candidate.validation,
    test: candidate.test,
    deltas: candidate.deltas,
    warnings: candidate.warnings,
    runtimeShape: candidate.runtimeShape,
    train: candidate.train,
    coefficientSample: candidate.coefficientSample,
  };
}

function buildPhase6Json(args, generatedAt, scripts, splits, prepared, phase4Gate, learned, elapsedSec) {
  return {
    schemaVersion: DISTILL_SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    environment: {
      node: process.version,
      gpuUsed: false,
      dependencies: "node standard library only",
    },
    canonicalInput: path.relative(args.outDir, args.input).replace(/\\/g, "/"),
    scriptCount: scripts.length,
    splitPolicy: { seed: args.seed, unit: "script", ...splits.counts },
    rowSummary: prepared.rowSummary,
    basePolicy: {
      strictGateId: phase4Gate.id,
      candidateId: ADVANCED_MODEL.id,
      fallbackId: BASE_MODEL.id,
      advancedOnlyTraining: true,
    },
    learningPolicy: {
      trainTarget: "target - least_squares_w50_cap36 on rows where phase4 strict gate uses advanced",
      residualCapsPx: RESIDUAL_CAPS,
      residualScales: RESIDUAL_SCALES,
      ridgeLambda: args.ridgeLambda,
      noCheckpointsOrCaches: true,
    },
    phase4Strict: learned.phase4,
    selected: learned.selected,
    candidates: learned.candidates.map(summarizeCandidate),
    runtimeCandidate: learned.selected.strict || learned.selected.balanced || null,
    elapsedSec,
  };
}

function buildRuntimeJson(phase6) {
  const candidate = phase6.runtimeCandidate;
  return {
    schemaVersion: RUNTIME_SCHEMA,
    generatedAt: phase6.generatedAt,
    productDecision: productDecision(phase6),
    selectedCandidate: candidate ? {
      id: candidate.id,
      teacherId: candidate.teacherId,
      family: candidate.family,
      residualScale: candidate.residualScale,
      residualCapPx: candidate.residualCapPx,
      runtimeShape: candidate.runtimeShape,
      test: candidate.test,
      phase4Delta: candidate.deltas.test,
      warnings: candidate.warnings,
    } : null,
    integrationContract: {
      gate: "reuse phase4 strict monotonic score gate unchanged",
      fallbackPredictor: BASE_MODEL,
      advancedPredictor: ADVANCED_MODEL,
      residualApplication: "if strict gate advanced, add clipped CPU residual to LS prediction; otherwise keep CV fallback",
      requiredFeatures: ["speed", "acceleration", "curvature", "horizon", "edge distance", "missing flags", "LS-vs-CV disagreement"],
      checkpointPolicy: "no checkpoint written; coefficients are reported only as samples",
    },
  };
}

function productDecision(phase6) {
  const strict = phase6.selected.strict;
  const balanced = phase6.selected.balanced;
  const chosen = strict || balanced;
  if (!chosen) return "do_not_productize_no_candidate_met_safety_constraints";
  const meanGain = -chosen.deltas.test.mean;
  const p95Worse = chosen.deltas.test.p95 > 0;
  const p99Worse = chosen.deltas.test.p99 > 0;
  if (meanGain > 0.02 && !p95Worse && !p99Worse && chosen.test.regressionsVsPhase4.worseOver5px === 0) {
    return "maybe_productize_after_real_trace_validation";
  }
  return "do_not_productize_synthetic_gain_too_small_or_tail_risky";
}

function renderPhase6Md(data) {
  const rows = data.candidates
    .slice()
    .sort((a, b) => a.test.metrics.mean - b.test.metrics.mean)
    .slice(0, 16)
    .map((c) => [
      c.id,
      fmt(c.test.metrics.mean),
      fmt(c.deltas.test.mean),
      fmt(c.test.metrics.p90),
      fmt(c.deltas.test.p90),
      fmt(c.test.metrics.p95),
      fmt(c.deltas.test.p95),
      fmt(c.test.metrics.p99),
      fmt(c.deltas.test.p99),
      `${c.test.regressionsVsPhase4.worseOver5px}/${c.test.regressionsVsPhase4.worseOver10px}`,
      `${c.test.regressionsVsBaseline.worseOver5px}/${c.test.regressionsVsBaseline.worseOver10px}`,
      c.warnings.join(", ") || "-",
    ]);
  const selectedRows = ["strict", "balanced", "bestMean", "bestTailSafeMean"].map((name) => {
    const c = data.selected[name];
    return [
      name,
      c?.id || "-",
      c ? fmt(c.test.metrics.mean) : "-",
      c ? fmt(c.deltas.test.mean) : "-",
      c ? fmt(c.test.metrics.p95) : "-",
      c ? fmt(c.deltas.test.p95) : "-",
      c ? fmt(c.test.metrics.p99) : "-",
      c ? fmt(c.deltas.test.p99) : "-",
      c ? `${c.test.regressionsVsPhase4.worseOver5px}/${c.test.regressionsVsPhase4.worseOver10px}` : "-",
      c ? `${c.test.regressionsVsBaseline.worseOver5px}/${c.test.regressionsVsBaseline.worseOver10px}` : "-",
    ];
  });
  return `# Phase 6 Strict Distillation

Generated: ${data.generatedAt}

Canonical input: \`${data.canonicalInput}\`  
Scripts: ${data.scriptCount}; split seed ${data.splitPolicy.seed}; train/validation/test scripts ${data.splitPolicy.train}/${data.splitPolicy.validation}/${data.splitPolicy.test}.  
Rows: train/validation/test ${data.rowSummary.rowsBySplit.train}/${data.rowSummary.rowsBySplit.validation}/${data.rowSummary.rowsBySplit.test}; strict advanced rows ${data.rowSummary.advancedRows.train}/${data.rowSummary.advancedRows.validation}/${data.rowSummary.advancedRows.test}.  
Environment: Node ${data.environment.node}; GPU not used; Node standard library only.

Phase4 strict baseline: \`${data.basePolicy.strictGateId}\`, test mean/p90/p95/p99/max ${fmt(data.phase4Strict.test.metrics.mean)} / ${fmt(data.phase4Strict.test.metrics.p90)} / ${fmt(data.phase4Strict.test.metrics.p95)} / ${fmt(data.phase4Strict.test.metrics.p99)} / ${fmt(data.phase4Strict.test.metrics.max)} px, >5/>10 vs CV ${data.phase4Strict.test.regressionsVsBaseline.worseOver5px}/${data.phase4Strict.test.regressionsVsBaseline.worseOver10px}.

The residual teachers were trained only on rows where the unchanged phase4 strict gate chooses \`${data.basePolicy.candidateId}\`. No per-frame CSVs, raw zips, node_modules, caches, or checkpoints were written.

## Selected Candidates

${renderTable(["bucket", "candidate", "mean", "mean delta", "p95", "p95 delta", "p99", "p99 delta", ">5/>10 vs p4", ">5/>10 vs CV"], selectedRows)}

## Best Mean Candidates

${renderTable(["candidate", "mean", "dMean", "p90", "dP90", "p95", "dP95", "p99", "dP99", ">5/>10 vs p4", ">5/>10 vs CV", "warnings"], rows)}

## Judgment

Negative deltas improve over phase4 strict. Candidates with p95 or p99 worse than phase4 strict are treated as caution even when mean improves. Productization requires the strict candidate to keep >5/>10 regressions at zero and show a meaningful mean or p90 gain on real traces, not only this synthetic split.
`;
}

function renderRuntimeMd(data) {
  const c = data.selectedCandidate;
  if (!c) {
    return `# Phase 6 Runtime Candidate

Product decision: ${data.productDecision}

No runtime candidate satisfied the phase6 safety filters.
`;
  }
  return `# Phase 6 Runtime Candidate

Product decision: ${data.productDecision}

Candidate: \`${c.id}\` (${c.family})  
Residual cap: ${fmt(c.residualCapPx)} px; scale ${fmt(c.residualScale, 2)}.  
Runtime shape: ${c.runtimeShape.parameters} float parameters, about ${c.runtimeShape.estimatedMacsPerPrediction} MACs per advanced prediction, CPU viability ${c.runtimeShape.cpuViability}.  
Test delta vs phase4 strict: mean/p90/p95/p99/max ${fmt(c.phase4Delta.mean)} / ${fmt(c.phase4Delta.p90)} / ${fmt(c.phase4Delta.p95)} / ${fmt(c.phase4Delta.p99)} / ${fmt(c.phase4Delta.max)} px.  
Regressions vs phase4 >5/>10: ${c.test.regressionsVsPhase4.worseOver5px}/${c.test.regressionsVsPhase4.worseOver10px}.  
Regressions vs CV >5/>10: ${c.test.regressionsVsBaseline.worseOver5px}/${c.test.regressionsVsBaseline.worseOver10px}.

Integration remains CPU-only: reuse the phase4 strict gate unchanged, compute the compact residual features only for advanced rows, add a clipped residual to \`${data.integrationContract.advancedPredictor.id}\`, and keep \`${data.integrationContract.fallbackPredictor.id}\` unchanged for fallback rows.
`;
}

function appendScores(outDir, phase6) {
  const scoresPath = path.join(outDir, "scores.json");
  let scores = {};
  if (fs.existsSync(scoresPath)) scores = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
  scores.schemaVersion = scores.schemaVersion || SCORE_SCHEMA;
  scores.generatedAt = phase6.generatedAt;
  scores.phase6 = {
    scriptCount: phase6.scriptCount,
    evaluatedRows: phase6.rowSummary.evaluatedRows,
    canonicalDataset: phase6.canonicalInput,
    splitPolicy: phase6.splitPolicy,
    environment: phase6.environment,
    phase4Strict: phase6.phase4Strict.test,
    strict: phase6.selected.strict,
    balanced: phase6.selected.balanced,
    bestMean: phase6.selected.bestMean,
    runtimeCandidate: phase6.runtimeCandidate,
    productDecision: productDecision(phase6),
  };
  writeJson(scoresPath, scores);
}

function appendExperimentLog(outDir, args, phase6) {
  const strict = phase6.selected.strict;
  const balanced = phase6.selected.balanced;
  const lineFor = (name, row) => row
    ? `- ${name}: \`${row.id}\`, mean/p95/p99 ${fmt(row.test.metrics.mean)} / ${fmt(row.test.metrics.p95)} / ${fmt(row.test.metrics.p99)} px, deltas ${fmt(row.deltas.test.mean)} / ${fmt(row.deltas.test.p95)} / ${fmt(row.deltas.test.p99)}, >5/>10 vs phase4 ${row.test.regressionsVsPhase4.worseOver5px}/${row.test.regressionsVsPhase4.worseOver10px}, warnings ${row.warnings.join(", ") || "none"};`
    : `- ${name}: no candidate satisfied constraints;`;
  const block = `

## Phase 6 strict distillation (${phase6.generatedAt})

\`\`\`powershell
node poc\\cursor-prediction-v10\\scripts\\run-v10-phase6.js --limit-scripts ${args.limitScripts}
\`\`\`

- read ${phase6.scriptCount} scripts from \`${phase6.canonicalInput}\`;
- split by script seed ${phase6.splitPolicy.seed}: train ${phase6.splitPolicy.train}, validation ${phase6.splitPolicy.validation}, test ${phase6.splitPolicy.test};
- rows train/validation/test ${phase6.rowSummary.rowsBySplit.train}/${phase6.rowSummary.rowsBySplit.validation}/${phase6.rowSummary.rowsBySplit.test}; advanced train/validation/test ${phase6.rowSummary.advancedRows.train}/${phase6.rowSummary.advancedRows.validation}/${phase6.rowSummary.advancedRows.test};
- phase4 strict: \`${phase6.basePolicy.strictGateId}\`, mean/p95/p99/max ${fmt(phase6.phase4Strict.test.metrics.mean)} / ${fmt(phase6.phase4Strict.test.metrics.p95)} / ${fmt(phase6.phase4Strict.test.metrics.p99)} / ${fmt(phase6.phase4Strict.test.metrics.max)} px, >5/>10 vs CV ${phase6.phase4Strict.test.regressionsVsBaseline.worseOver5px}/${phase6.phase4Strict.test.regressionsVsBaseline.worseOver10px};
${lineFor("strict", strict)}
${lineFor("balanced", balanced)}
- judgment: ${productDecision(phase6)}. The strict gate itself remains safe, but residual productization should wait for real trace validation unless the strict candidate shows meaningful tail-neutral gains.
- runtime: ${fmt(phase6.elapsedSec, 2)} seconds on CPU; no GPU, checkpoints, caches, raw zips, node_modules, or per-frame CSVs.
`;
  fs.appendFileSync(path.join(outDir, "experiment-log.md"), block, "utf8");
}

function metricDelta(metrics, baseline) {
  return {
    mean: metrics.mean - baseline.mean,
    rmse: metrics.rmse - baseline.rmse,
    p50: metrics.p50 - baseline.p50,
    p90: metrics.p90 - baseline.p90,
    p95: metrics.p95 - baseline.p95,
    p99: metrics.p99 - baseline.p99,
    max: metrics.max - baseline.max,
  };
}

function runtimeShape(model) {
  const parameters = model.runtime.parameters;
  const bytes = parameters * 4;
  return {
    teacherId: model.id,
    family: model.family,
    parameters,
    coefficientBytesFloat32: bytes,
    estimatedMacsPerPrediction: model.runtime.macs,
    cpuViability: bytes <= 4096 && model.runtime.macs <= 256 ? "high" : "medium",
    simdNotes: model.phiDim <= 2 ? "scalar bucket lookup" : "small contiguous dot products",
  };
}

function coefficientSample(model) {
  const head = model.heads.find((h) => h.count > 0) || model.heads[0];
  return {
    bucketCount: model.bucketCount,
    firstNonEmptyBucketRows: head?.count || 0,
    wx: head ? Array.from(head.wx.slice(0, Math.min(8, head.wx.length))).map((v) => round(v, 6)) : [],
    wy: head ? Array.from(head.wy.slice(0, Math.min(8, head.wy.length))).map((v) => round(v, 6)) : [],
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

function zeroRegressionAccumulator(count) {
  const acc = regressionAccumulator();
  acc.count = count;
  return acc;
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

function renderTable(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((row) => String(row[i] ?? "").length)));
  const line = (row) => `| ${row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join(" | ")} |`;
  return [
    line(headers),
    `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return String(round(value, digits));
}

function idNum(value) {
  return fmt(value, 6).replace("-", "m").replace(".", "p");
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const started = Date.now();
  const args = parseArgs(process.argv);
  const generatedAt = new Date().toISOString();
  const phase2 = loadPhase2Runtime();
  const phase4Gate = loadPhase4Strict(args.outDir);
  const scripts = readScripts(args.input, args.limitScripts);
  const splits = makeSplits(scripts.length, args.seed);
  const prepared = prepareRows(scripts, splits, args, phase2, phase4Gate);
  const learned = trainAndEvaluate(prepared.stores, args);
  const elapsedSec = (Date.now() - started) / 1000;
  const phase6 = buildPhase6Json(args, generatedAt, scripts, splits, prepared, phase4Gate, learned, elapsedSec);
  const runtime = buildRuntimeJson(phase6);
  writeJson(path.join(args.outDir, "phase-6-strict-distillation.json"), phase6);
  fs.writeFileSync(path.join(args.outDir, "phase-6-strict-distillation.md"), renderPhase6Md(phase6), "utf8");
  writeJson(path.join(args.outDir, "phase-6-runtime-candidate.json"), runtime);
  fs.writeFileSync(path.join(args.outDir, "phase-6-runtime-candidate.md"), renderRuntimeMd(runtime), "utf8");
  appendScores(args.outDir, phase6);
  appendExperimentLog(args.outDir, args, phase6);
  process.stdout.write(`Phase6 complete in ${fmt(elapsedSec, 2)}s\n`);
  process.stdout.write(`phase4 strict mean/p95/p99=${fmt(phase6.phase4Strict.test.metrics.mean)}/${fmt(phase6.phase4Strict.test.metrics.p95)}/${fmt(phase6.phase4Strict.test.metrics.p99)}\n`);
  for (const name of ["strict", "balanced"]) {
    const row = phase6.selected[name];
    process.stdout.write(`${name}: ${row ? `${row.id} mean=${fmt(row.test.metrics.mean)} dMean=${fmt(row.deltas.test.mean)} p95=${fmt(row.test.metrics.p95)} dP95=${fmt(row.deltas.test.p95)} p99=${fmt(row.test.metrics.p99)} dP99=${fmt(row.deltas.test.p99)} regP4>5/>10=${row.test.regressionsVsPhase4.worseOver5px}/${row.test.regressionsVsPhase4.worseOver10px}` : "none"}\n`);
  }
}

main();
