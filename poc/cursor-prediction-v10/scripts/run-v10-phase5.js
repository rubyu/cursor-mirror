#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PHASE5_SCHEMA = "cursor-prediction-v10-phase5-ml-teachers/1";
const RUNTIME_SCHEMA = "cursor-prediction-v10-phase5-runtime-shape/1";
const SCORE_SCHEMA = "cursor-prediction-v10-scores/1";

const HORIZONS_MS = [8.33, 16.67, 25, 33.33];
const MISSING_SCENARIOS = [
  { id: "clean", dropRate: 0 },
  { id: "missing_10pct", dropRate: 0.10 },
  { id: "missing_25pct", dropRate: 0.25 },
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
const HISTORY_TAPS = 12;
const SEQ_CHANNELS = 7;
const SEQ_DIMS = HISTORY_TAPS * SEQ_CHANNELS;
const GLOBAL_DIMS = 7 + 3 + TAGS.length;
const FEATURE_DIMS = SEQ_DIMS + GLOBAL_DIMS;
const CONSTRAINTS = {
  strict: { worseOver10px: 0, worseOver5px: 0 },
  balanced: { worseOver10px: 0, worseOver5px: 50 },
  aggressive: { worseOver10px: 5, worseOver5px: 200 },
};

const DEFAULT_ARGS = {
  input: null,
  outDir: null,
  seed: 33003,
  limitScripts: 3000,
  anchorsPerScript: 32,
  sampleIntervalMs: 8.33,
  historyMs: 200,
  trainSampleRows: 80000,
  validationSampleRows: 120000,
  ridgeLambda: 8,
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
    else if (arg === "--ridge-lambda") args.ridgeLambda = numberArg(argv[++i], "ridge-lambda");
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v10\\scripts\\run-v10-phase5.js [--limit-scripts 3000]

Options:
  --input <path>                  JSONL scripts. Default: runs/scripts.synthetic.phase2.jsonl
  --seed <n>                      deterministic script split seed. Default: 33003
  --limit-scripts <n>             script subset. Default: 3000
  --train-sample-rows <n>         rows for ridge teacher fitting. Default: 80000
  --validation-sample-rows <n>    rows for gate threshold screening. Default: 120000
  --ridge-lambda <n>              L2 regularization. Default: 8
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

function makeStore(capacity) {
  return {
    count: 0,
    capacity,
    features: new Float32Array(capacity * FEATURE_DIMS),
    targetDx: new Float32Array(capacity),
    targetDy: new Float32Array(capacity),
    baselineError: new Float32Array(capacity),
    score: new Float32Array(capacity),
  };
}

function prepareRows(scripts, splits, args, phase2, scoreWeights) {
  const maxRowsPerScript = args.anchorsPerScript * MISSING_SCENARIOS.length * HORIZONS_MS.length;
  const stores = {
    train: makeStore(splits.counts.train * maxRowsPerScript + 1024),
    validation: makeStore(splits.counts.validation * maxRowsPerScript + 1024),
    test: makeStore(splits.counts.test * maxRowsPerScript + 1024),
  };
  const rowSummary = {
    evaluatedRows: 0,
    rowsBySplit: { train: 0, validation: 0, test: 0 },
  };
  const baseline = baselineModel();
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
        for (let horizonIndex = 0; horizonIndex < HORIZONS_MS.length; horizonIndex += 1) {
          const horizonMs = HORIZONS_MS[horizonIndex];
          const target = phase2.sampleScript(script, anchorTime + horizonMs);
          const row = { history, target, horizonMs, missingScenario: scenario.id, features };
          const baselinePrediction = phase2.predict(row, baseline);
          const targetDx = target.x - baselinePrediction.x;
          const targetDy = target.y - baselinePrediction.y;
          const baselineError = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
          addPreparedRow(store, history, features, horizonMs, missingIndex, tagMask, targetDx, targetDy, baselineError, scoreWeights);
          rowSummary.evaluatedRows += 1;
          rowSummary.rowsBySplit[split] += 1;
        }
      }
    }
  }
  return { stores, rowSummary };
}

function addPreparedRow(store, history, rowFeatures, horizonMs, missingIndex, tagMask, targetDx, targetDy, baselineError, scoreWeights) {
  const row = store.count;
  if (row >= store.capacity) throw new Error(`Store capacity exceeded: ${store.capacity}`);
  const offset = row * FEATURE_DIMS;
  writeFeatureVector(store.features, offset, history, rowFeatures, horizonMs, missingIndex, tagMask);
  store.targetDx[row] = targetDx;
  store.targetDy[row] = targetDy;
  store.baselineError[row] = baselineError;
  store.score[row] = monotonicScore(rowFeatures, horizonMs, missingIndex, tagMask, scoreWeights);
  store.count += 1;
}

function writeFeatureVector(out, offset, history, f, horizonMs, missingIndex, tagMask) {
  const intervals = [];
  let prevVx = 0;
  let prevVy = 0;
  for (let i = 1; i < history.length; i += 1) {
    const a = history[i - 1];
    const b = history[i];
    const dtSec = Math.max(0.001, (b.t - a.t) / 1000);
    const vx = (b.x - a.x) / dtSec;
    const vy = (b.y - a.y) / dtSec;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const accel = i > 1 ? Math.sqrt((vx - prevVx) ** 2 + (vy - prevVy) ** 2) / dtSec : 0;
    const curve = i > 1 ? angleBetweenDeg(prevVx, prevVy, vx, vy) : 0;
    intervals.push({ dx: b.x - a.x, dy: b.y - a.y, dtMs: b.t - a.t, speed, accel, curve });
    prevVx = vx;
    prevVy = vy;
  }
  const start = Math.max(0, intervals.length - HISTORY_TAPS);
  let p = offset;
  for (let tap = 0; tap < HISTORY_TAPS; tap += 1) {
    const src = intervals[start + tap - Math.max(0, HISTORY_TAPS - intervals.length)];
    if (!src) {
      for (let c = 0; c < SEQ_CHANNELS; c += 1) out[p++] = 0;
    } else {
      out[p++] = clamp(src.dx / 24, -3, 3);
      out[p++] = clamp(src.dy / 24, -3, 3);
      out[p++] = clamp(src.dtMs / 16.67, 0, 6);
      out[p++] = clamp(src.speed / 3000, 0, 3);
      out[p++] = clamp(Math.log1p(src.accel / 8000), 0, 4);
      out[p++] = clamp(src.curve / 90, 0, 2);
      out[p++] = 1;
    }
  }
  const edgeNear = Math.max(0, (64 - f.edgeDistancePx) / 64);
  out[p++] = clamp(f.observedSpeedPxPerSec / 3000, 0, 3);
  out[p++] = clamp(Math.log1p(f.accelerationPxPerSec2 / 8000), 0, 4);
  out[p++] = clamp(f.curvatureDeg / 90, 0, 2);
  out[p++] = clamp(edgeNear, 0, 1.5);
  out[p++] = clamp(Math.log1p((f.jitterProxyPx || 0)), 0, 4);
  out[p++] = clamp(f.historyCount / 24, 0, 2);
  out[p++] = clamp(horizonMs / 33.33, 0, 1.25);
  out[p++] = missingIndex === 0 ? 1 : 0;
  out[p++] = missingIndex === 1 ? 1 : 0;
  out[p++] = missingIndex === 2 ? 1 : 0;
  for (let i = 0; i < TAGS.length; i += 1) out[p++] = (tagMask & (1 << i)) ? 1 : 0;
}

function teacherSpecs(seed) {
  return [
    {
      id: "linear_ridge_residual",
      family: "linear_ridge",
      outputCapPx: 24,
      lambdaScale: 1.0,
      makePhi: (store, row, out) => phiLinear(store, row, out),
      phiDim: 1 + FEATURE_DIMS,
      shape: { params: (1 + FEATURE_DIMS) * 2, macs: FEATURE_DIMS * 2, simd: "excellent contiguous dot products" },
    },
    {
      id: "fsmn_lite_ridge",
      family: "FSMN-lite",
      outputCapPx: 24,
      lambdaScale: 0.8,
      makePhi: (store, row, out) => phiFsmn(store, row, out, false),
      phiDim: 1 + 54,
      shape: { params: (1 + 54) * 2, macs: 54 * 2 + 42, simd: "excellent fixed tap reductions plus dot products" },
    },
    {
      id: "csfsmn_lite_ridge",
      family: "CSFSMN-lite",
      outputCapPx: 24,
      lambdaScale: 0.8,
      makePhi: (store, row, out) => phiFsmn(store, row, out, true),
      phiDim: 1 + 66,
      shape: { params: (1 + 66) * 2, macs: 66 * 2 + 54, simd: "excellent compact memory state and shared taps" },
    },
    {
      id: "tcn_small_ridge",
      family: "1D-CNN/TCN-small",
      outputCapPx: 24,
      lambdaScale: 1.2,
      makePhi: (store, row, out) => phiTcn(store, row, out),
      phiDim: 1 + 70,
      shape: { params: (1 + 70) * 2, macs: 70 * 2 + 280, simd: "good fixed kernels over short history" },
    },
    randomProjectionSpec("rfn_rbf_48_ridge", "RFN/RBF-ridge", 48, 0.55, seed + 11, 1.5, "good random projection plus sin/cos"),
    randomProjectionSpec("mlp_small_ridge", "MLP-small", 32, 0.75, seed + 23, 1.0, "fair dense hidden layer; batch SIMD recommended"),
    randomProjectionSpec("mlp_medium_ridge", "MLP-medium", 64, 0.9, seed + 37, 1.0, "fair larger dense hidden layer; still CPU-only viable at 64 hidden"),
  ];
}

function randomProjectionSpec(id, family, hidden, lambdaScale, seed, omegaScale, simd) {
  const compactDim = compactFeatureDims();
  const rng = mulberry32(seed);
  const weights = new Float32Array(hidden * compactDim);
  const bias = new Float32Array(hidden);
  for (let i = 0; i < weights.length; i += 1) weights[i] = gaussian(rng) * omegaScale / Math.sqrt(compactDim);
  for (let i = 0; i < bias.length; i += 1) bias[i] = (rng() * 2 - 1) * Math.PI;
  return {
    id,
    family,
    outputCapPx: 24,
    lambdaScale,
    makePhi: (store, row, out) => {
      if (family === "RFN/RBF-ridge") return phiRandomFourier(store, row, out, weights, bias, hidden, compactDim);
      return phiRandomTanh(store, row, out, weights, bias, hidden, compactDim);
    },
    phiDim: 1 + compactDim + hidden,
    shape: {
      params: (1 + compactDim + hidden) * 2,
      macs: hidden * compactDim + (compactDim + hidden) * 2,
      simd,
    },
    coefficientSampleOnly: true,
  };
}

function compactFeatureDims() {
  return 42;
}

function compactFeatures(features, offset, out) {
  let p = 0;
  const lastBase = offset + (HISTORY_TAPS - 1) * SEQ_CHANNELS;
  for (let c = 0; c < 6; c += 1) out[p++] = features[lastBase + c];
  const prevBase = offset + (HISTORY_TAPS - 2) * SEQ_CHANNELS;
  for (let c = 0; c < 6; c += 1) out[p++] = features[prevBase + c];
  for (let c = 0; c < 6; c += 1) {
    let sum = 0;
    let valid = 0;
    for (let t = Math.max(0, HISTORY_TAPS - 4); t < HISTORY_TAPS; t += 1) {
      const v = features[offset + t * SEQ_CHANNELS + c];
      const m = features[offset + t * SEQ_CHANNELS + 6];
      sum += v * m;
      valid += m;
    }
    out[p++] = valid > 0 ? sum / valid : 0;
  }
  for (let c = 0; c < 6; c += 1) {
    let sum = 0;
    let valid = 0;
    for (let t = 0; t < HISTORY_TAPS; t += 1) {
      const m = features[offset + t * SEQ_CHANNELS + 6];
      sum += features[offset + t * SEQ_CHANNELS + c] * m;
      valid += m;
    }
    out[p++] = valid > 0 ? sum / valid : 0;
  }
  const global = offset + SEQ_DIMS;
  for (let i = 0; i < 10; i += 1) out[p++] = features[global + i];
  for (let i = 0; i < 8; i += 1) out[p++] = features[global + 10 + i];
  return out;
}

function phiLinear(store, row, out) {
  const offset = row * FEATURE_DIMS;
  out[0] = 1;
  for (let i = 0; i < FEATURE_DIMS; i += 1) out[i + 1] = store.features[offset + i];
}

function phiFsmn(store, row, out, compactSkip) {
  const features = store.features;
  const offset = row * FEATURE_DIMS;
  let p = 0;
  out[p++] = 1;
  const tapStarts = [HISTORY_TAPS - 1, Math.max(0, HISTORY_TAPS - 3), Math.max(0, HISTORY_TAPS - 6), 0];
  for (let c = 0; c < 6; c += 1) {
    out[p++] = features[offset + (HISTORY_TAPS - 1) * SEQ_CHANNELS + c];
    for (let ti = 1; ti < tapStarts.length; ti += 1) {
      let sum = 0;
      let valid = 0;
      for (let t = tapStarts[ti]; t < HISTORY_TAPS; t += 1) {
        const m = features[offset + t * SEQ_CHANNELS + 6];
        sum += features[offset + t * SEQ_CHANNELS + c] * m;
        valid += m;
      }
      out[p++] = valid > 0 ? sum / valid : 0;
    }
    const first = features[offset + tapStarts[3] * SEQ_CHANNELS + c];
    const last = features[offset + (HISTORY_TAPS - 1) * SEQ_CHANNELS + c];
    out[p++] = last - first;
  }
  const global = offset + SEQ_DIMS;
  for (let i = 0; i < GLOBAL_DIMS; i += 1) out[p++] = features[global + i];
  if (compactSkip) {
    const h = features[global + 6];
    const lastDx = features[offset + (HISTORY_TAPS - 1) * SEQ_CHANNELS];
    const lastDy = features[offset + (HISTORY_TAPS - 1) * SEQ_CHANNELS + 1];
    const speed = features[global];
    const accel = features[global + 1];
    const curve = features[global + 2];
    const edge = features[global + 3];
    const jitter = features[global + 4];
    const hist = features[global + 5];
    out[p++] = lastDx * h;
    out[p++] = lastDy * h;
    out[p++] = speed * h;
    out[p++] = accel * h;
    out[p++] = curve * h;
    out[p++] = edge * h;
    out[p++] = jitter * h;
    out[p++] = hist * h;
    out[p++] = lastDx * speed;
    out[p++] = lastDy * speed;
    out[p++] = accel * curve;
    out[p++] = edge * jitter;
  }
}

function phiTcn(store, row, out) {
  const features = store.features;
  const offset = row * FEATURE_DIMS;
  let p = 0;
  out[p++] = 1;
  const kernels = [
    [1],
    [-1, 1],
    [1, -2, 1],
    [0.25, 0.5, 0.25],
  ];
  for (let c = 0; c < 6; c += 1) {
    for (const kernel of kernels) {
      let sum = 0;
      let maxAbs = 0;
      let count = 0;
      for (let t = kernel.length - 1; t < HISTORY_TAPS; t += 1) {
        let v = 0;
        let valid = 1;
        for (let k = 0; k < kernel.length; k += 1) {
          const idx = t - kernel.length + 1 + k;
          valid *= features[offset + idx * SEQ_CHANNELS + 6];
          v += kernel[k] * features[offset + idx * SEQ_CHANNELS + c];
        }
        if (!valid) continue;
        sum += v;
        maxAbs = Math.max(maxAbs, Math.abs(v));
        count += 1;
      }
      out[p++] = count > 0 ? sum / count : 0;
      out[p++] = maxAbs;
    }
  }
  const global = offset + SEQ_DIMS;
  for (let i = 0; i < GLOBAL_DIMS; i += 1) out[p++] = features[global + i];
}

function phiRandomFourier(store, row, out, weights, bias, hidden, compactDim) {
  const compact = phiRandomFourier.scratch || (phiRandomFourier.scratch = new Float64Array(compactDim));
  compactFeatures(store.features, row * FEATURE_DIMS, compact);
  let p = 0;
  out[p++] = 1;
  for (let i = 0; i < compactDim; i += 1) out[p++] = compact[i];
  const scale = Math.sqrt(2 / hidden);
  for (let h = 0; h < hidden; h += 1) {
    let z = bias[h];
    const base = h * compactDim;
    for (let i = 0; i < compactDim; i += 1) z += weights[base + i] * compact[i];
    out[p++] = Math.cos(z) * scale;
  }
}

function phiRandomTanh(store, row, out, weights, bias, hidden, compactDim) {
  const compact = phiRandomTanh.scratch || (phiRandomTanh.scratch = new Float64Array(compactDim));
  compactFeatures(store.features, row * FEATURE_DIMS, compact);
  let p = 0;
  out[p++] = 1;
  for (let i = 0; i < compactDim; i += 1) out[p++] = compact[i];
  for (let h = 0; h < hidden; h += 1) {
    let z = bias[h];
    const base = h * compactDim;
    for (let i = 0; i < compactDim; i += 1) z += weights[base + i] * compact[i];
    out[p++] = Math.tanh(z);
  }
}

function trainTeacher(spec, trainStore, indices, lambda) {
  const d = spec.phiDim;
  const xtx = new Float64Array(d * d);
  const xtyX = new Float64Array(d);
  const xtyY = new Float64Array(d);
  const phi = new Float64Array(d);
  for (let ii = 0; ii < indices.length; ii += 1) {
    const row = indices[ii];
    spec.makePhi(trainStore, row, phi);
    const yx = clamp(trainStore.targetDx[row], -48, 48);
    const yy = clamp(trainStore.targetDy[row], -48, 48);
    for (let i = 0; i < d; i += 1) {
      const pi = phi[i];
      xtyX[i] += pi * yx;
      xtyY[i] += pi * yy;
      const base = i * d;
      for (let j = 0; j <= i; j += 1) xtx[base + j] += pi * phi[j];
    }
  }
  for (let i = 0; i < d; i += 1) {
    for (let j = 0; j < i; j += 1) xtx[j * d + i] = xtx[i * d + j];
    xtx[i * d + i] += lambda;
  }
  const wx = solveLinearSystem(xtx, xtyX, d);
  const wy = solveLinearSystem(xtx, xtyY, d);
  return { ...spec, wx, wy, trainRows: indices.length, lambda };
}

function predictResidual(model, store, row, phi, scale) {
  model.makePhi(store, row, phi);
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < model.phiDim; i += 1) {
    dx += model.wx[i] * phi[i];
    dy += model.wy[i] * phi[i];
  }
  dx *= scale;
  dy *= scale;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag > model.outputCapPx && mag > 0) {
    const s = model.outputCapPx / mag;
    dx *= s;
    dy *= s;
  }
  return { dx, dy };
}

function evaluateRaw(model, store, scale) {
  const acc = metricAccumulator();
  const reg = regressionAccumulator();
  const phi = new Float64Array(model.phiDim);
  for (let row = 0; row < store.count; row += 1) {
    const p = predictResidual(model, store, row, phi, scale);
    const ex = p.dx - store.targetDx[row];
    const ey = p.dy - store.targetDy[row];
    const err = Math.sqrt(ex * ex + ey * ey);
    addMetric(acc, err);
    addRegression(reg, err - store.baselineError[row]);
  }
  return { metrics: finalizeMetric(acc), regressionsVsBaseline: finalizeRegression(reg), gateUses: { advanced: store.count, fallback: 0 } };
}

function evaluateGate(model, store, scale, threshold) {
  const acc = metricAccumulator();
  const reg = regressionAccumulator();
  const phi = new Float64Array(model.phiDim);
  let advanced = 0;
  for (let row = 0; row < store.count; row += 1) {
    let err = store.baselineError[row];
    if (store.score[row] <= threshold) {
      const p = predictResidual(model, store, row, phi, scale);
      const ex = p.dx - store.targetDx[row];
      const ey = p.dy - store.targetDy[row];
      err = Math.sqrt(ex * ex + ey * ey);
      advanced += 1;
    }
    addMetric(acc, err);
    addRegression(reg, err - store.baselineError[row]);
  }
  return { metrics: finalizeMetric(acc), regressionsVsBaseline: finalizeRegression(reg), gateUses: { advanced, fallback: store.count - advanced } };
}

function evaluateThresholdSweep(model, store, indices, scale, thresholds) {
  const rows = [];
  const phi = new Float64Array(model.phiDim);
  for (let i = 0; i < indices.length; i += 1) {
    const row = indices[i];
    const p = predictResidual(model, store, row, phi, scale);
    const ex = p.dx - store.targetDx[row];
    const ey = p.dy - store.targetDy[row];
    rows.push({
      row,
      score: store.score[row],
      baseline: store.baselineError[row],
      candidate: Math.sqrt(ex * ex + ey * ey),
    });
  }
  rows.sort((a, b) => a.score - b.score);
  const acc = metricAccumulator();
  const reg = regressionAccumulator();
  for (const r of rows) addMetric(acc, r.baseline);
  const out = [];
  let cursor = 0;
  for (const threshold of thresholds) {
    while (cursor < rows.length && rows[cursor].score <= threshold) {
      const r = rows[cursor];
      addMetric(acc, r.baseline, -1);
      addMetric(acc, r.candidate, 1);
      addRegression(reg, r.candidate - r.baseline);
      cursor += 1;
    }
    out.push({
      threshold,
      metric: {
        metrics: finalizeMetric(acc),
        regressionsVsBaseline: finalizeRegression(reg, rows.length),
        gateUses: { advanced: cursor, fallback: rows.length - cursor },
      },
    });
  }
  return out;
}

function trainAndEvaluate(stores, specs, args, phase3Best) {
  const trainIndices = sampleIndices(stores.train, args.trainSampleRows);
  const validationIndices = sampleIndices(stores.validation, args.validationSampleRows);
  const thresholds = thresholdCandidates(stores.train, trainIndices, phase3Best?.params?.threshold);
  const baseline = {
    train: evaluateBaseline(stores.train),
    validation: evaluateBaseline(stores.validation),
    test: evaluateBaseline(stores.test),
  };
  const results = [];
  for (const spec of specs) {
    const t0 = Date.now();
    const model = trainTeacher(spec, stores.train, trainIndices, args.ridgeLambda * spec.lambdaScale);
    const trainSec = (Date.now() - t0) / 1000;
    const scaleRows = [];
    for (const scale of [0.25, 0.5, 0.75, 1.0]) {
      const validationRaw = evaluateRaw(model, stores.validation, scale);
      const fixed = Number.isFinite(phase3Best?.params?.threshold)
        ? evaluateGate(model, stores.validation, scale, phase3Best.params.threshold)
        : null;
      const sweep = evaluateThresholdSweep(model, stores.validation, validationIndices, scale, thresholds);
      scaleRows.push({ scale, validationRaw, fixed, sweep });
    }
    const bestRawScale = [...scaleRows].sort((a, b) => rawRank(a.validationRaw) - rawRank(b.validationRaw))[0];
    const raw = {
      scale: bestRawScale.scale,
      validation: bestRawScale.validationRaw,
      test: evaluateRaw(model, stores.test, bestRawScale.scale),
    };
    const fixedScale = [...scaleRows].filter((r) => r.fixed).sort((a, b) => gatedRank(a.fixed) - gatedRank(b.fixed))[0] || null;
    const fixedPhase3Gate = fixedScale ? {
      scale: fixedScale.scale,
      threshold: phase3Best.params.threshold,
      validation: fixedScale.fixed,
      test: evaluateGate(model, stores.test, fixedScale.scale, phase3Best.params.threshold),
    } : null;
    const selected = {};
    for (const [name, constraint] of Object.entries(CONSTRAINTS)) {
      const candidates = [];
      for (const sr of scaleRows) {
        for (const item of sr.sweep) {
          if (passesConstraint(item.metric.regressionsVsBaseline, constraint)) {
            candidates.push({ scale: sr.scale, threshold: item.threshold, validation: item.metric });
          }
        }
      }
      candidates.sort((a, b) => gatedRank(a.validation) - gatedRank(b.validation));
      const best = candidates[0] || null;
      selected[name] = best ? {
        scale: best.scale,
        threshold: best.threshold,
        validation: best.validation,
        test: evaluateGate(model, stores.test, best.scale, best.threshold),
      } : null;
    }
    results.push({
      id: model.id,
      family: model.family,
      output: "baseline constant_velocity_last2_cap24 plus learned residual dx/dy",
      train: { rows: model.trainRows, lambda: model.lambda, elapsedSec: trainSec },
      raw,
      fixedPhase3Gate,
      constraints: selected,
      runtimeShape: runtimeShapeFor(model),
      coefficientSample: {
        wx: Array.from(model.wx.slice(0, Math.min(8, model.wx.length))),
        wy: Array.from(model.wy.slice(0, Math.min(8, model.wy.length))),
      },
    });
    process.stdout.write(`trained ${model.id}: raw test mean ${fmt(raw.test.metrics.mean)} strict ${selected.strict ? fmt(selected.strict.test.metrics.mean) : "n/a"}\n`);
  }
  return { baseline, thresholds, trainSampleRows: trainIndices.length, validationSampleRows: validationIndices.length, results };
}

function thresholdCandidates(store, indices, phase3Threshold) {
  const scores = Array.from(indices, (row) => store.score[row]).sort((a, b) => a - b);
  const qs = [0, 0.005, 0.01, 0.02, 0.035, 0.05, 0.075, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.975, 0.99];
  const out = [];
  for (const q of qs) out.push(scores[Math.min(scores.length - 1, Math.max(0, Math.floor(q * (scores.length - 1))))]);
  if (Number.isFinite(phase3Threshold)) {
    for (const f of [0.35, 0.5, 0.7, 0.85, 1, 1.15, 1.35, 1.6, 2.0, 2.5, 3.0]) out.push(phase3Threshold * f);
  }
  return [...new Set(out.map((v) => Number(v.toFixed(6))))].sort((a, b) => a - b);
}

function selectBest(results) {
  const raw = [...results].sort((a, b) => a.raw.test.metrics.mean - b.raw.test.metrics.mean)[0];
  const gated = {};
  for (const name of Object.keys(CONSTRAINTS)) {
    const rows = results
      .map((r) => ({ teacher: r, gate: r.constraints[name] }))
      .filter((r) => r.gate)
      .sort((a, b) => gatedRank(a.gate.test) - gatedRank(b.gate.test));
    gated[name] = rows[0] ? {
      teacherId: rows[0].teacher.id,
      family: rows[0].teacher.family,
      ...rows[0].gate,
    } : null;
  }
  return {
    raw: raw ? { teacherId: raw.id, family: raw.family, ...raw.raw } : null,
    gated,
  };
}

function loadPhase3Best(outDir) {
  const filePath = path.join(outDir, "phase-3-learned-gates.json");
  if (!fs.existsSync(filePath)) return null;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return data.selected || null;
}

function loadPhase4Comparison(outDir) {
  const filePath = path.join(outDir, "phase-4-pareto-frontier.json");
  if (!fs.existsSync(filePath)) return null;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const out = {};
  for (const name of ["strict", "balanced", "aggressive"]) {
    out[name] = data.constraints?.[name]?.best || null;
  }
  return out;
}

function runtimeShapeFor(model) {
  const bytes = model.shape.params * 4;
  return {
    teacherId: model.id,
    family: model.family,
    featureDims: FEATURE_DIMS,
    historyTaps: HISTORY_TAPS,
    parameters: model.shape.params,
    coefficientBytesFloat32: bytes,
    estimatedMacsPerPrediction: model.shape.macs,
    outputCapPx: model.outputCapPx,
    cpuViability: bytes < 4096 && model.shape.macs < 6000 ? "high" : "medium",
    simdNotes: model.shape.simd,
    checkpointPolicy: "no checkpoint written; report keeps coefficient sample only",
  };
}

function buildPhase5Json(args, generatedAt, scripts, splits, prepared, learned, phase3Best, phase4Comparison, elapsedSec) {
  const selected = selectBest(learned.results);
  return {
    schemaVersion: PHASE5_SCHEMA,
    generatedAt,
    command: process.argv.join(" "),
    environment: {
      node: process.version,
      python: "not available on PATH",
      torch: "not available; JS ridge teachers used",
      gpuUsed: false,
      dependencies: "node standard library only",
    },
    canonicalInput: path.relative(args.outDir, args.input).replace(/\\/g, "/"),
    scriptCount: scripts.length,
    splitPolicy: { seed: args.seed, unit: "script", ...splits.counts },
    rowSummary: prepared.rowSummary,
    learningPolicy: {
      causalOnly: true,
      featureHistoryTaps: HISTORY_TAPS,
      trainSampleRows: learned.trainSampleRows,
      validationSampleRows: learned.validationSampleRows,
      teacherFamilies: learned.results.map((r) => r.family),
      output: "residual dx/dy added to constant_velocity_last2_cap24 baseline",
      noCheckpoint: true,
    },
    phase3Gate: phase3Best ? {
      id: phase3Best.id,
      candidateId: phase3Best.candidateId,
      threshold: phase3Best.params?.threshold,
      weightsSource: "phase-3-learned-gates.json selected monotonic score",
    } : null,
    phase4Comparison,
    baseline: learned.baseline,
    teachers: learned.results,
    selected,
    elapsedSec,
  };
}

function buildRuntimeJson(phase5) {
  return {
    schemaVersion: RUNTIME_SCHEMA,
    generatedAt: phase5.generatedAt,
    scriptCount: phase5.scriptCount,
    rowSummary: phase5.rowSummary,
    featureContract: {
      causalOnly: true,
      historyTaps: HISTORY_TAPS,
      sequenceChannels: ["dx", "dy", "dt", "speed", "acceleration_proxy", "curvature_proxy", "valid"],
      globalFeatures: ["observedSpeed", "acceleration", "curvature", "edgeNear", "jitterProxy", "historyCount", "horizon", "missing one-hot", "tag bits"],
      featureDims: FEATURE_DIMS,
    },
    runtimeShapes: phase5.teachers.map((t) => t.runtimeShape),
    productCandidateRanking: productCandidateRanking(phase5.teachers),
  };
}

function productCandidateRanking(teachers) {
  return teachers.map((t) => {
    const strict = t.constraints.strict?.test || null;
    return {
      teacherId: t.id,
      family: t.family,
      strictMean: strict?.metrics?.mean ?? null,
      strictRegressionsOver5Over10: strict ? `${strict.regressionsVsBaseline.worseOver5px}/${strict.regressionsVsBaseline.worseOver10px}` : null,
      parameters: t.runtimeShape.parameters,
      estimatedMacsPerPrediction: t.runtimeShape.estimatedMacsPerPrediction,
      cpuViability: t.runtimeShape.cpuViability,
    };
  }).sort((a, b) => {
    const av = a.strictMean ?? Infinity;
    const bv = b.strictMean ?? Infinity;
    if (av !== bv) return av - bv;
    return a.estimatedMacsPerPrediction - b.estimatedMacsPerPrediction;
  });
}

function renderPhase5Md(data) {
  const selectedRows = [];
  for (const name of ["strict", "balanced", "aggressive"]) {
    const row = data.selected.gated[name];
    selectedRows.push([
      name,
      row?.teacherId || "-",
      row ? fmt(row.test.metrics.mean) : "-",
      row ? fmt(row.test.metrics.p95) : "-",
      row ? fmt(row.test.metrics.p99) : "-",
      row ? `${row.test.regressionsVsBaseline.worseOver5px}/${row.test.regressionsVsBaseline.worseOver10px}` : "-",
      row ? `${row.test.gateUses.advanced}/${row.test.gateUses.fallback}` : "-",
      row ? fmt(row.threshold, 6) : "-",
      row ? fmt(row.scale, 2) : "-",
    ]);
  }
  const teacherRows = data.teachers.map((t) => [
    t.id,
    t.family,
    fmt(t.raw.test.metrics.mean),
    fmt(t.raw.test.metrics.p95),
    `${t.raw.test.regressionsVsBaseline.worseOver5px}/${t.raw.test.regressionsVsBaseline.worseOver10px}`,
    t.constraints.strict ? fmt(t.constraints.strict.test.metrics.mean) : "-",
    t.constraints.strict ? fmt(t.constraints.strict.test.metrics.p95) : "-",
    t.constraints.strict ? `${t.constraints.strict.test.regressionsVsBaseline.worseOver5px}/${t.constraints.strict.test.regressionsVsBaseline.worseOver10px}` : "-",
    String(t.runtimeShape.parameters),
    String(t.runtimeShape.estimatedMacsPerPrediction),
  ]);
  const compareRows = ["strict", "balanced", "aggressive"].map((name) => {
    const p4 = data.phase4Comparison?.[name];
    const p5 = data.selected.gated[name];
    return [
      name,
      p4 ? fmt(p4.test.metrics.mean) : "-",
      p5 ? fmt(p5.test.metrics.mean) : "-",
      p4 && p5 ? fmt(p5.test.metrics.mean - p4.test.metrics.mean) : "-",
      p4 ? fmt(p4.test.metrics.p95) : "-",
      p5 ? fmt(p5.test.metrics.p95) : "-",
      p4 && p5 ? fmt(p5.test.metrics.p95 - p4.test.metrics.p95) : "-",
      p4 ? fmt(p4.test.metrics.p99) : "-",
      p5 ? fmt(p5.test.metrics.p99) : "-",
      p4 && p5 ? fmt(p5.test.metrics.p99 - p4.test.metrics.p99) : "-",
      p5 ? `${p5.test.regressionsVsBaseline.worseOver5px}/${p5.test.regressionsVsBaseline.worseOver10px}` : "-",
    ];
  });
  return `# Phase 5 ML Teacher Probe

Generated: ${data.generatedAt}

Canonical input: \`${data.canonicalInput}\`  
Scripts: ${data.scriptCount}; split seed ${data.splitPolicy.seed}; train/validation/test scripts ${data.splitPolicy.train}/${data.splitPolicy.validation}/${data.splitPolicy.test}.  
Rows: train/validation/test ${data.rowSummary.rowsBySplit.train}/${data.rowSummary.rowsBySplit.validation}/${data.rowSummary.rowsBySplit.test}.  
Environment: Node ${data.environment.node}; Python/torch unavailable on PATH; GPU not used.

The probe uses causal history only and learns residual dx/dy over \`constant_velocity_last2_cap24\`. No checkpoints, per-frame CSVs, feature caches, zips, or dependency folders were written.

## Selected gated teachers

${renderTable(["bucket", "teacher", "mean", "p95", "p99", ">5/>10", "advanced/fallback", "threshold", "scale"], selectedRows)}

## Raw and strict results

${renderTable(["teacher", "family", "raw mean", "raw p95", "raw >5/>10", "strict mean", "strict p95", "strict >5/>10", "params", "MACs"], teacherRows)}

Best raw teacher: \`${data.selected.raw.teacherId}\` (${data.selected.raw.family}), test mean/p95/p99 ${fmt(data.selected.raw.test.metrics.mean)} / ${fmt(data.selected.raw.test.metrics.p95)} / ${fmt(data.selected.raw.test.metrics.p99)} px, >5/>10 ${data.selected.raw.test.regressionsVsBaseline.worseOver5px}/${data.selected.raw.test.regressionsVsBaseline.worseOver10px}.

## Phase 4 comparison

${renderTable(["bucket", "phase4 mean", "phase5 mean", "mean delta", "phase4 p95", "phase5 p95", "p95 delta", "phase4 p99", "phase5 p99", "p99 delta", "phase5 >5/>10"], compareRows)}

Negative deltas are improvements. Phase5 improves mean in the selected gated buckets, but p95/p99 move worse than Phase4, so it is not a clean frontier replacement under the same safety framing.

## Product read

FSMN-lite and CSFSMN-lite are the closest CPU-only product shapes: small fixed tap reductions, tiny ridge heads, no recurrent state, and easy SIMD dot products. RFN/RBF is also viable but has random projection cost and less interpretability. The MLP variants are useful as accuracy probes, but the random hidden transforms do not justify productization from this run.

Next step: keep the phase4 strict gate as the product baseline, then run a targeted residual teacher only on rows where the gate already advances, with distillation against LS/blend residuals and an explicit per-bucket no-regression loss.
`;
}

function renderRuntimeMd(data) {
  const rows = data.runtimeShapes.map((r) => [
    r.teacherId,
    r.family,
    String(r.parameters),
    String(r.coefficientBytesFloat32),
    String(r.estimatedMacsPerPrediction),
    r.cpuViability,
    r.simdNotes,
  ]);
  const rankingRows = data.productCandidateRanking.map((r) => [
    r.teacherId,
    r.family,
    r.strictMean === null ? "-" : fmt(r.strictMean),
    r.strictRegressionsOver5Over10 || "-",
    String(r.parameters),
    String(r.estimatedMacsPerPrediction),
    r.cpuViability,
  ]);
  return `# Phase 5 Runtime Shape

Feature contract: ${data.featureContract.historyTaps} history taps, ${data.featureContract.sequenceChannels.length} sequence channels, ${data.featureContract.featureDims} normalized causal features.

${renderTable(["teacher", "family", "params", "bytes f32", "MACs/pred", "CPU", "SIMD notes"], rows)}

## Product candidate order

${renderTable(["teacher", "family", "strict mean", ">5/>10", "params", "MACs/pred", "CPU"], rankingRows)}

All product candidates are described as CPU-only. GPU was not used for training or evaluation in this run.
`;
}

function appendScores(outDir, phase5) {
  const scoresPath = path.join(outDir, "scores.json");
  let scores = {};
  if (fs.existsSync(scoresPath)) scores = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
  scores.schemaVersion = scores.schemaVersion || SCORE_SCHEMA;
  scores.generatedAt = phase5.generatedAt;
  scores.phase5 = {
    scriptCount: phase5.scriptCount,
    evaluatedRows: phase5.rowSummary.evaluatedRows,
    canonicalDataset: phase5.canonicalInput,
    splitPolicy: phase5.splitPolicy,
    environment: phase5.environment,
    baseline: phase5.baseline.test,
    bestRawTeacher: phase5.selected.raw,
    strict: phase5.selected.gated.strict,
    balanced: phase5.selected.gated.balanced,
    aggressive: phase5.selected.gated.aggressive,
    productCandidateRanking: buildRuntimeJson(phase5).productCandidateRanking,
  };
  writeJson(scoresPath, scores);
}

function appendExperimentLog(outDir, args, phase5) {
  const best = phase5.selected;
  const lineFor = (name) => {
    const row = best.gated[name];
    return row
      ? `- ${name}: \`${row.teacherId}\`, mean/p95/p99 ${fmt(row.test.metrics.mean)} / ${fmt(row.test.metrics.p95)} / ${fmt(row.test.metrics.p99)} px, >5/>10 ${row.test.regressionsVsBaseline.worseOver5px}/${row.test.regressionsVsBaseline.worseOver10px}, advanced ${row.test.gateUses.advanced};`
      : `- ${name}: no candidate satisfied constraints;`;
  };
  const block = `

## Phase 5 ML teacher probe (${phase5.generatedAt})

\`\`\`powershell
node poc\\cursor-prediction-v10\\scripts\\run-v10-phase5.js --limit-scripts ${args.limitScripts} --train-sample-rows ${args.trainSampleRows} --validation-sample-rows ${args.validationSampleRows}
\`\`\`

- read ${phase5.scriptCount} scripts from \`${phase5.canonicalInput}\`;
- split by script seed ${phase5.splitPolicy.seed}: train ${phase5.splitPolicy.train}, validation ${phase5.splitPolicy.validation}, test ${phase5.splitPolicy.test};
- rows train/validation/test ${phase5.rowSummary.rowsBySplit.train}/${phase5.rowSummary.rowsBySplit.validation}/${phase5.rowSummary.rowsBySplit.test};
- environment: Node ${phase5.environment.node}; Python/torch unavailable; GPU not used; no checkpoints or feature caches written;
- best raw: \`${best.raw.teacherId}\`, mean/p95/p99 ${fmt(best.raw.test.metrics.mean)} / ${fmt(best.raw.test.metrics.p95)} / ${fmt(best.raw.test.metrics.p99)} px, >5/>10 ${best.raw.test.regressionsVsBaseline.worseOver5px}/${best.raw.test.regressionsVsBaseline.worseOver10px};
${lineFor("strict")}
${lineFor("balanced")}
${lineFor("aggressive")}
- judgment: Phase5 improves selected gated mean versus Phase4 but worsens tail percentiles, so it is not a clean replacement. FSMN-lite/CSFSMN-lite are the most product-shaped ML teachers if a CPU-only residual path is revisited.
- runtime: ${fmt(phase5.elapsedSec, 2)} seconds on CPU.
`;
  fs.appendFileSync(path.join(outDir, "experiment-log.md"), block, "utf8");
}

function baselineModel() {
  return {
    id: "constant_velocity_last2_cap24",
    family: "constant_velocity_last2",
    params: { gain: 1, horizonCapMs: 33.33, displacementCapPx: 24 },
  };
}

function defaultScoreWeights() {
  return {
    intercept: 0,
    lowSpeed: 0.8,
    highSpeed: 0.2,
    acceleration: 1.2,
    curvature: 1.0,
    edgeNear: 0.7,
    sparseHistory: 0.5,
    jitterProxy: 1.0,
    horizon: 0.4,
    missing10: 0.25,
    missing25: 0.9,
    tagWeights: Object.fromEntries(TAGS.map((tag) => [tag, 0])),
  };
}

function monotonicScore(f, horizonMs, missingIndex, tagMask, weights) {
  const w = weights || defaultScoreWeights();
  let score = w.intercept || 0;
  score += (w.lowSpeed || 0) * Math.max(0, (350 - f.observedSpeedPxPerSec) / 350);
  score += (w.highSpeed || 0) * Math.max(0, (f.observedSpeedPxPerSec - 3000) / 1200);
  score += (w.acceleration || 0) * Math.log1p(f.accelerationPxPerSec2 / 8000);
  score += (w.curvature || 0) * (f.curvatureDeg / 90);
  score += (w.edgeNear || 0) * Math.max(0, (64 - f.edgeDistancePx) / 64);
  score += (w.sparseHistory || 0) * Math.max(0, (13 - f.historyCount) / 13);
  score += (w.jitterProxy || 0) * Math.log1p(f.jitterProxyPx || 0);
  score += (w.horizon || 0) * (horizonMs / 33.33);
  if (missingIndex === 1) score += w.missing10 || 0;
  if (missingIndex === 2) score += w.missing25 || 0;
  for (const [tag, weight] of Object.entries(w.tagWeights || {})) {
    const index = TAGS.indexOf(tag);
    if (index >= 0 && (tagMask & (1 << index))) score += weight;
  }
  return score;
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

function metricAccumulator() {
  return {
    count: 0,
    sum: 0,
    sumSq: 0,
    max: 0,
    hist: new Int32Array(Math.ceil(768 / 0.05) + 1),
  };
}

function addMetric(acc, value, weight = 1) {
  acc.count += weight;
  acc.sum += value * weight;
  acc.sumSq += value * value * weight;
  if (weight > 0) acc.max = Math.max(acc.max, value);
  const bin = Math.max(0, Math.min(acc.hist.length - 1, Math.floor(value / 0.05)));
  acc.hist[bin] += weight;
}

function finalizeMetric(acc) {
  return {
    count: acc.count,
    mean: acc.count > 0 ? acc.sum / acc.count : 0,
    rmse: acc.count > 0 ? Math.sqrt(acc.sumSq / acc.count) : 0,
    p50: histPercentile(acc.hist, acc.count, 0.50),
    p90: histPercentile(acc.hist, acc.count, 0.90),
    p95: histPercentile(acc.hist, acc.count, 0.95),
    p99: histPercentile(acc.hist, acc.count, 0.99),
    max: acc.max,
  };
}

function histPercentile(hist, count, p) {
  if (count <= 0) return 0;
  const target = Math.max(1, Math.ceil(count * p));
  let seen = 0;
  for (let i = 0; i < hist.length; i += 1) {
    seen += hist[i];
    if (seen >= target) return i * 0.05 + 0.025;
  }
  return (hist.length - 1) * 0.05;
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
    deltaSum: 0,
  };
}

function addRegression(acc, delta) {
  acc.count += 1;
  acc.deltaSum += delta;
  if (delta > 1) acc.worseOver1px += 1;
  if (delta > 3) acc.worseOver3px += 1;
  if (delta > 5) acc.worseOver5px += 1;
  if (delta > 10) acc.worseOver10px += 1;
  if (delta < -1) acc.improvedOver1px += 1;
  if (delta < -3) acc.improvedOver3px += 1;
}

function finalizeRegression(acc, forcedCount = null) {
  const count = forcedCount ?? acc.count;
  return {
    count,
    worseOver1px: acc.worseOver1px,
    worseOver3px: acc.worseOver3px,
    worseOver5px: acc.worseOver5px,
    worseOver10px: acc.worseOver10px,
    improvedOver1px: acc.improvedOver1px,
    improvedOver3px: acc.improvedOver3px,
    meanDeltaPx: count > 0 ? acc.deltaSum / count : 0,
  };
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

function rawRank(result) {
  const r = result.regressionsVsBaseline;
  return result.metrics.mean + r.worseOver10px * 1000 + r.worseOver5px * 50;
}

function gatedRank(result) {
  const r = result.regressionsVsBaseline;
  return r.worseOver10px * 1000000 + r.worseOver5px * 10000 + result.metrics.mean - result.gateUses.advanced * 1e-9;
}

function passesConstraint(r, c) {
  return r.worseOver10px <= c.worseOver10px && r.worseOver5px <= c.worseOver5px;
}

function solveLinearSystem(a, b, n) {
  const m = new Float64Array(a);
  const x = new Float64Array(b);
  for (let k = 0; k < n; k += 1) {
    let pivot = k;
    let best = Math.abs(m[k * n + k]);
    for (let i = k + 1; i < n; i += 1) {
      const v = Math.abs(m[i * n + k]);
      if (v > best) {
        best = v;
        pivot = i;
      }
    }
    if (best < 1e-10) {
      m[k * n + k] += 1e-6;
      best = Math.abs(m[k * n + k]);
    }
    if (pivot !== k) {
      for (let j = k; j < n; j += 1) {
        const tmp = m[k * n + j];
        m[k * n + j] = m[pivot * n + j];
        m[pivot * n + j] = tmp;
      }
      const tb = x[k];
      x[k] = x[pivot];
      x[pivot] = tb;
    }
    const diag = m[k * n + k];
    for (let j = k; j < n; j += 1) m[k * n + j] /= diag;
    x[k] /= diag;
    for (let i = 0; i < n; i += 1) {
      if (i === k) continue;
      const factor = m[i * n + k];
      if (Math.abs(factor) < 1e-18) continue;
      for (let j = k; j < n; j += 1) m[i * n + j] -= factor * m[k * n + j];
      x[i] -= factor * x[k];
    }
  }
  return x;
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

function angleBetweenDeg(ax, ay, bx, by) {
  const am = Math.sqrt(ax * ax + ay * ay);
  const bm = Math.sqrt(bx * bx + by * by);
  if (am < 1e-6 || bm < 1e-6) return 0;
  const c = clamp((ax * bx + ay * by) / (am * bm), -1, 1);
  return Math.acos(c) * 180 / Math.PI;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function gaussian(rng) {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function roundObject(value, digits = 6) {
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
  if (Array.isArray(value)) return value.map((v) => roundObject(v, digits));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = roundObject(v, digits);
    return out;
  }
  return value;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(roundObject(value), null, 2)}\n`, "utf8");
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Number(value).toFixed(digits);
}

function renderTable(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, col) => Math.max(...all.map((row) => String(row[col] ?? "").length)));
  const line = (row) => `| ${row.map((cell, col) => String(cell ?? "").padEnd(widths[col])).join(" | ")} |`;
  return [
    line(headers),
    `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

function main() {
  const started = Date.now();
  const args = parseArgs(process.argv);
  const generatedAt = new Date().toISOString();
  const phase2 = loadPhase2Runtime();
  const phase3Best = loadPhase3Best(args.outDir);
  const scoreWeights = phase3Best?.params?.weights || defaultScoreWeights();
  const scripts = readScripts(args.input, args.limitScripts);
  const splits = makeSplits(scripts.length, args.seed);
  process.stdout.write(`phase5: preparing ${scripts.length} scripts...\n`);
  const prepared = prepareRows(scripts, splits, args, phase2, scoreWeights);
  process.stdout.write(`phase5: rows train/validation/test ${prepared.rowSummary.rowsBySplit.train}/${prepared.rowSummary.rowsBySplit.validation}/${prepared.rowSummary.rowsBySplit.test}\n`);
  const specs = teacherSpecs(args.seed);
  const learned = trainAndEvaluate(prepared.stores, specs, args, phase3Best);
  const phase4Comparison = loadPhase4Comparison(args.outDir);
  const elapsedSec = (Date.now() - started) / 1000;
  const phase5 = buildPhase5Json(args, generatedAt, scripts, splits, prepared, learned, phase3Best, phase4Comparison, elapsedSec);
  const runtime = buildRuntimeJson(phase5);
  writeJson(path.join(args.outDir, "phase-5-ml-teachers.json"), phase5);
  fs.writeFileSync(path.join(args.outDir, "phase-5-ml-teachers.md"), renderPhase5Md(roundObject(phase5)), "utf8");
  writeJson(path.join(args.outDir, "phase-5-runtime-shape.json"), runtime);
  fs.writeFileSync(path.join(args.outDir, "phase-5-runtime-shape.md"), renderRuntimeMd(roundObject(runtime)), "utf8");
  appendScores(args.outDir, roundObject(phase5));
  appendExperimentLog(args.outDir, roundObject(args), roundObject(phase5));
  process.stdout.write(`Best raw: ${phase5.selected.raw.teacherId} mean=${fmt(phase5.selected.raw.test.metrics.mean)} >5/>10=${phase5.selected.raw.test.regressionsVsBaseline.worseOver5px}/${phase5.selected.raw.test.regressionsVsBaseline.worseOver10px}\n`);
  for (const name of ["strict", "balanced", "aggressive"]) {
    const row = phase5.selected.gated[name];
    process.stdout.write(`${name}: ${row ? `${row.teacherId} mean=${fmt(row.test.metrics.mean)} >5/>10=${row.test.regressionsVsBaseline.worseOver5px}/${row.test.regressionsVsBaseline.worseOver10px}` : "none"}\n`);
  }
  process.stdout.write(`Elapsed: ${fmt(elapsedSec, 2)} sec\n`);
}

main();
