#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCHEMA_VERSION = "cursor-prediction-v12-step7/1";
const TARGET_EVENT = "runtimeSchedulerPoll";
const BASE_GATE = {
  id: "gate_s25_net0_eff35_ls12_g100_cap12_off-2",
  family: "state_gated_least_squares",
  productCandidate: true,
  analysisOnly: false,
  params: {
    speedThreshold: 25,
    netThreshold: 0,
    efficiencyThreshold: 0.35,
    n: 12,
    gain: 1,
    capPx: 12,
    offsetMs: -2,
    maxHistoryGapMs: 40,
    gateSpeedN: 12,
  },
};

function parseArgs(argv) {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, "..", "..", "..");
  const outDir = path.resolve(scriptDir, "..");
  const manifest = path.resolve(scriptDir, "..", "step-2-clean-split", "split-manifest.json");
  const args = { root, outDir, manifest };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--manifest") args.manifest = path.resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  node poc\\cursor-prediction-v12\\scripts\\run-step7-tail-and-holdout.js [--root <repo>] [--out-dir <dir>] [--manifest <json>]
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function loadStepLibrary() {
  const libraryPath = path.join(__dirname, "run-step5-step6.js");
  const source = fs.readFileSync(libraryPath, "utf8").replace(/\nmain\(\);\s*$/, "");
  const exportSource = `${source}
globalThis.cursorV12Lib = {
  loadManifest,
  loadPackage,
  buildRows,
  datasetSummary,
  BASELINE_MODELS,
  predictBaseline,
  predictGate,
  evaluateModelRows,
  validationMetricForModel,
  validationObjective,
  holdoutSignals,
  compactError,
  table,
  fmt,
  round,
  clampVector,
  magnitude,
  errorOf,
  signedAlongMotion,
  createAccumulator,
  addError,
  finalizeAccumulator,
};
`;
  const sandbox = {
    require,
    console,
    Buffer,
    process: {
      stdout: process.stdout,
      stderr: process.stderr,
      exit: process.exit.bind(process),
      argv: ["node", libraryPath],
    },
    __dirname,
  };
  vm.runInNewContext(exportSource, sandbox, { filename: libraryPath });
  return sandbox.cursorV12Lib;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function addCount(map, key, increment = 1) {
  map[key] = (map[key] || 0) + increment;
}

function historySpanMs(row, n) {
  let span = 0;
  const intervals = Math.max(1, n - 1);
  for (let i = 0; i < intervals; i += 1) {
    span += row.memory?.[i]?.dtMs || 0;
  }
  return span;
}

function rowFeatures(lib, row) {
  const v2 = row.velocities[2] || { vx: 0, vy: 0, speed: 0 };
  const v8 = row.velocities[8] || { vx: 0, vy: 0, speed: 0 };
  const v12 = row.velocities[12] || { vx: 0, vy: 0, speed: 0 };
  const spanSeconds = Math.max(0.001, historySpanMs(row, 12) / 1000);
  const accel = lib.magnitude(v2.vx - v12.vx, v2.vy - v12.vy) / spanSeconds;
  return {
    speed: v12.speed,
    shortSpeed: v2.speed,
    net: row.path.net,
    efficiency: row.path.efficiency,
    reversals: row.path.reversals,
    historyGapMs: row.historyGapMs,
    horizonMs: row.horizonMs,
    accel,
    refreshBucket: row.refreshBucket,
  };
}

function predictLs(lib, params, row) {
  return lib.predictBaseline({
    id: "least_squares_specialist",
    family: "least_squares",
    params: {
      n: params.n,
      gain: params.gain,
      capPx: params.capPx,
      offsetMs: params.offsetMs,
    },
  }, row);
}

function guardPass(lib, guard, row) {
  const features = row._tailFeatures || rowFeatures(lib, row);
  if (guard.refreshBucket !== "all" && row.refreshBucket !== guard.refreshBucket) return false;
  if (features.speed < guard.speedThreshold) return false;
  if (features.accel < guard.accelThreshold) return false;
  if (features.efficiency < guard.efficiencyThreshold) return false;
  if (features.net < guard.netThreshold) return false;
  if (features.historyGapMs > guard.maxHistoryGapMs) return false;
  return true;
}

function predictTailGuard(lib, model, row) {
  if (guardPass(lib, model.params.guard, row)) return predictLs(lib, model.params.specialist, row);
  return lib.predictGate(BASE_GATE, row);
}

function predictPoolModel(lib, model, row) {
  if (model.family === "base_gate") return lib.predictGate(BASE_GATE, row);
  if (model.family === "constant_position") return { x: row.latestX, y: row.latestY };
  return predictLs(lib, model.params, row);
}

function signedAlongMotion(lib, pred, row) {
  return lib.signedAlongMotion(pred, row);
}

function errorOf(lib, pred, row) {
  return lib.errorOf(pred, row);
}

function validationError(lib, rows, predict) {
  const acc = lib.createAccumulator();
  for (const row of rows) {
    if (row.split !== "validation") continue;
    const pred = predict(row);
    lib.addError(acc, errorOf(lib, pred, row), signedAlongMotion(lib, pred, row));
  }
  return lib.finalizeAccumulator(acc);
}

function groupError(lib, rows, predicate, predict) {
  const acc = lib.createAccumulator();
  for (const row of rows) {
    if (!predicate(row)) continue;
    const pred = predict(row);
    lib.addError(acc, errorOf(lib, pred, row), signedAlongMotion(lib, pred, row));
  }
  return lib.finalizeAccumulator(acc);
}

function compactError(error) {
  return {
    count: error.count,
    mean: error.mean,
    median: error.median,
    p95: error.p95,
    p99: error.p99,
    max: error.max,
    gt5: error.regressionRates.gt5px,
    gt10: error.regressionRates.gt10px,
    signedMean: error.signedAlongMotion.mean,
    lagRate: error.signedAlongMotion.lagRate,
  };
}

function validationTailObjective(overall, highSpeed, resume, refresh30) {
  return round(
    (overall.p95 ?? 999)
      + 0.35 * (overall.p99 ?? 999)
      + 35 * (overall.regressionRates.gt10px ?? 1)
      + 0.45 * (highSpeed.p95 ?? 30)
      + 0.08 * (highSpeed.p99 ?? 80)
      + 0.35 * (resume.p95 ?? 20)
      + 0.08 * (resume.p99 ?? 40)
      + 0.2 * (refresh30.p95 ?? overall.p95 ?? 999)
      + 0.08 * (refresh30.p99 ?? overall.p99 ?? 999)
      + 0.2 * Math.abs(overall.signedAlongMotion.mean ?? 0),
    6,
  );
}

function candidateId(guard, specialist) {
  const eff = Math.round(guard.efficiencyThreshold * 100);
  const acc = Math.round(guard.accelThreshold / 1000);
  const gain = Math.round(specialist.gain * 100);
  return `tailguard_spd${guard.speedThreshold}_acc${acc}k_net${guard.netThreshold}_eff${eff}_${guard.refreshBucket}_ls${specialist.n}_g${gain}_cap${specialist.capPx}_off${specialist.offsetMs}`;
}

function makeModel(guard, specialist) {
  return {
    id: candidateId(guard, specialist),
    family: "tail_guarded_least_squares",
    productCandidate: true,
    analysisOnly: false,
    params: { guard, specialist },
  };
}

function generateSpecialists() {
  const specialists = [];
  for (const n of [8, 12]) {
    for (const gain of [1, 1.15, 1.3, 1.5]) {
      for (const capPx of [12, 24, 48, 96]) {
        for (const offsetMs of [-4, -2, 0, 2, 4]) {
          specialists.push({ n, gain, capPx, offsetMs });
        }
      }
    }
  }
  return specialists;
}

function generateStageACandidates() {
  const candidates = [];
  for (const speedThreshold of [250, 500, 1000, 2000]) {
    for (const refreshBucket of ["all", "30Hz", "60Hz"]) {
      const guard = {
        speedThreshold,
        accelThreshold: 0,
        efficiencyThreshold: 0,
        netThreshold: 0,
        refreshBucket,
        maxHistoryGapMs: 40,
      };
      for (const specialist of generateSpecialists()) candidates.push(makeModel(guard, specialist));
    }
  }
  return candidates;
}

function expandStageB(stageARanking) {
  const byParam = new Map();
  for (const item of stageARanking.slice(0, 48)) {
    const key = JSON.stringify({
      speedThreshold: item.params.guard.speedThreshold,
      refreshBucket: item.params.guard.refreshBucket,
      specialist: item.params.specialist,
    });
    byParam.set(key, item.params);
  }
  const candidates = [];
  for (const params of byParam.values()) {
    for (const accelThreshold of [0, 60000, 150000, 300000]) {
      for (const efficiencyThreshold of [0, 0.35, 0.65]) {
        for (const netThreshold of [0, 8, 24, 64]) {
          const guard = {
            ...params.guard,
            accelThreshold,
            efficiencyThreshold,
            netThreshold,
            maxHistoryGapMs: 40,
          };
          candidates.push(makeModel(guard, params.specialist));
        }
      }
    }
  }
  const unique = new Map();
  for (const candidate of candidates) unique.set(candidate.id, candidate);
  return [...unique.values()];
}

function scoreCandidateOnValidation(lib, rows, model) {
  const overall = validationError(lib, rows, (row) => predictTailGuard(lib, model, row));
  const highSpeed = groupError(
    lib,
    rows,
    (row) => row.split === "validation" && row.speedBin === ">=2000",
    (row) => predictTailGuard(lib, model, row),
  );
  const resume = groupError(
    lib,
    rows,
    (row) => row.split === "validation" && row.phase === "resume",
    (row) => predictTailGuard(lib, model, row),
  );
  const refresh30 = groupError(
    lib,
    rows,
    (row) => row.split === "validation" && row.refreshBucket === "30Hz",
    (row) => predictTailGuard(lib, model, row),
  );
  return {
    modelId: model.id,
    family: model.family,
    params: model.params,
    validation: overall,
    validationHighSpeed: highSpeed,
    validationResume: resume,
    validation30Hz: refresh30,
    objective: validationTailObjective(overall, highSpeed, resume, refresh30),
  };
}

function evaluateModelRows(lib, model, rows, holdouts, predict) {
  return lib.evaluateModelRows(model, rows, holdouts, (_model, row) => predict(row));
}

function findSplitError(sections, split) {
  return sections.bySplit.find((row) => row.split === split)?.error || null;
}

function findRefreshError(sections, split, refreshBucket) {
  return sections.byRefresh.find((row) => row.split === split && row.refreshBucket === refreshBucket)?.error || null;
}

function findPhaseError(sections, split, phase) {
  return sections.byPhase.find((row) => row.split === split && row.movementPhase === phase)?.error || null;
}

function findSpeedError(sections, split, speedBinName) {
  return sections.bySpeedBin.find((row) => row.split === split && row.speedBin === speedBinName)?.error || null;
}

function findHoldoutError(sections, holdoutId, role) {
  return sections.byHoldout.find((row) => row.holdoutId === holdoutId && row.holdoutRole === role)?.error || null;
}

function delta(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base)) return null;
  return round(value - base);
}

function guardrail(baseSections, candidateSections) {
  const baseValidation = findSplitError(baseSections, "validation");
  const baseTest = findSplitError(baseSections, "test");
  const candidateValidation = findSplitError(candidateSections, "validation");
  const candidateTest = findSplitError(candidateSections, "test");
  const base30 = findHoldoutError(baseSections, "refresh:30Hz", "test");
  const candidate30 = findHoldoutError(candidateSections, "refresh:30Hz", "test");
  const deltas = {
    validationP95: delta(candidateValidation?.p95, baseValidation?.p95),
    validationP99: delta(candidateValidation?.p99, baseValidation?.p99),
    validationGt10: delta(candidateValidation?.regressionRates.gt10px, baseValidation?.regressionRates.gt10px),
    testP95: delta(candidateTest?.p95, baseTest?.p95),
    testP99: delta(candidateTest?.p99, baseTest?.p99),
    testGt10: delta(candidateTest?.regressionRates.gt10px, baseTest?.regressionRates.gt10px),
    holdout30P95: delta(candidate30?.p95, base30?.p95),
    holdout30P99: delta(candidate30?.p99, base30?.p99),
  };
  const pass = (deltas.validationP95 ?? Infinity) <= 0.25
    && (deltas.validationP99 ?? Infinity) <= 0.25
    && (deltas.validationGt10 ?? Infinity) <= 0.001
    && (deltas.testP95 ?? Infinity) <= 0.25
    && (deltas.testP99 ?? Infinity) <= 0.25
    && (deltas.testGt10 ?? Infinity) <= 0.001
    && (deltas.holdout30P95 ?? Infinity) <= 0
    && (deltas.holdout30P99 ?? Infinity) <= 0;
  return { pass, deltas };
}

function fullCandidateSummary(baseSections, sections, model) {
  const validation = findSplitError(sections, "validation");
  const test = findSplitError(sections, "test");
  const validationHighSpeed = findSpeedError(sections, "validation", ">=2000");
  const testHighSpeed = findSpeedError(sections, "test", ">=2000");
  const validationResume = findPhaseError(sections, "validation", "resume");
  const testResume = findPhaseError(sections, "test", "resume");
  const validation30 = findRefreshError(sections, "validation", "30Hz");
  const test30 = findRefreshError(sections, "test", "30Hz");
  const guard = guardrail(baseSections, sections);
  const objective = validationTailObjective(validation, validationHighSpeed, validationResume, validation30);
  return {
    modelId: model.id,
    family: model.family,
    productCandidate: model.productCandidate,
    analysisOnly: Boolean(model.analysisOnly),
    params: model.params,
    guardrail: guard,
    objective,
    validation: compactError(validation),
    test: compactError(test),
    validationHighSpeed: compactError(validationHighSpeed),
    testHighSpeed: compactError(testHighSpeed),
    validationResume: compactError(validationResume),
    testResume: compactError(testResume),
    validation30Hz: compactError(validation30),
    test30Hz: compactError(test30),
  };
}

function modelPoolForOracle() {
  const pool = [
    { id: "base_gate_step5_selected", family: "base_gate", params: {} },
    { id: "constant_position", family: "constant_position", params: {} },
  ];
  for (const specialist of generateSpecialists()) {
    pool.push({
      id: `oracle_ls${specialist.n}_g${Math.round(specialist.gain * 100)}_cap${specialist.capPx}_off${specialist.offsetMs}`,
      family: "least_squares",
      params: specialist,
    });
  }
  return pool;
}

function oracleKey(row) {
  return `${row.phase}|${row.speedBin}|${row.refreshBucket}`;
}

function buildGroupOracle(lib, rows) {
  const pool = modelPoolForOracle();
  const stats = new Map();
  for (const row of rows) {
    if (row.split !== "validation") continue;
    const key = oracleKey(row);
    for (const model of pool) {
      const statKey = `${key}||${model.id}`;
      let acc = stats.get(statKey);
      if (!acc) {
        acc = lib.createAccumulator();
        stats.set(statKey, acc);
      }
      const pred = predictPoolModel(lib, model, row);
      lib.addError(acc, errorOf(lib, pred, row), signedAlongMotion(lib, pred, row));
    }
  }
  const selectedByGroup = {};
  const groupRanking = [];
  const modelById = new Map(pool.map((model) => [model.id, model]));
  const grouped = new Map();
  for (const [statKey, acc] of stats.entries()) {
    const [key, modelId] = statKey.split("||");
    const error = lib.finalizeAccumulator(acc);
    const list = grouped.get(key) || [];
    list.push({ key, modelId, error, objective: validationTailObjective(error, error, error, error) });
    grouped.set(key, list);
  }
  for (const [key, list] of grouped.entries()) {
    list.sort((a, b) => a.objective - b.objective || (a.error.p99 ?? Infinity) - (b.error.p99 ?? Infinity));
    selectedByGroup[key] = list[0].modelId;
    groupRanking.push({ group: key, selectedModelId: list[0].modelId, validation: compactError(list[0].error), alternatives: list.slice(0, 5).map((item) => ({
      modelId: item.modelId,
      validation: compactError(item.error),
      objective: item.objective,
    })) });
  }
  const oracleModel = {
    id: "oracle_phase_speed_refresh_group_best",
    family: "analysis_only_phase_speed_oracle",
    productCandidate: false,
    analysisOnly: true,
    params: { groupKey: "movementPhase|futureSpeedBin|refreshBucket", selectedByGroup },
  };
  return {
    model: oracleModel,
    selectedByGroup,
    groupRanking: groupRanking.sort((a, b) => String(a.group).localeCompare(String(b.group))),
    modelById,
    predict: (row) => {
      const modelId = selectedByGroup[oracleKey(row)] || "base_gate_step5_selected";
      return predictPoolModel(lib, modelById.get(modelId) || modelById.get("base_gate_step5_selected"), row);
    },
  };
}

function buildRowBestOracle(lib, rows, holdouts) {
  const pool = modelPoolForOracle();
  const model = {
    id: "oracle_per_row_best_pool_lower_bound",
    family: "analysis_only_impossible_row_best",
    productCandidate: false,
    analysisOnly: true,
    params: { poolSize: pool.length, note: "Uses actual label error to pick a model per row; impossible in product." },
  };
  const sections = evaluateModelRows(lib, model, rows, holdouts, (row) => {
    let best = null;
    for (const candidate of pool) {
      const pred = predictPoolModel(lib, candidate, row);
      const error = errorOf(lib, pred, row);
      if (!best || error < best.error) best = { pred, error };
    }
    return best.pred;
  });
  return { model, sections };
}

function searchStep7(lib, rows, holdouts) {
  for (const row of rows) row._tailFeatures = rowFeatures(lib, row);

  const baseSections = evaluateModelRows(lib, BASE_GATE, rows, holdouts, (row) => lib.predictGate(BASE_GATE, row));
  const stageA = [];
  for (const model of generateStageACandidates()) stageA.push(scoreCandidateOnValidation(lib, rows, model));
  stageA.sort((a, b) => a.objective - b.objective || (a.validation.p99 ?? Infinity) - (b.validation.p99 ?? Infinity));

  const stageBCandidates = expandStageB(stageA);
  const stageB = [];
  for (const model of stageBCandidates) stageB.push(scoreCandidateOnValidation(lib, rows, model));
  stageB.sort((a, b) => a.objective - b.objective || (a.validation.p99 ?? Infinity) - (b.validation.p99 ?? Infinity));

  const candidateIds = new Set();
  const fullModels = [];
  const addFull = (item) => {
    if (!candidateIds.has(item.modelId)) {
      candidateIds.add(item.modelId);
      fullModels.push(makeModel(item.params.guard, item.params.specialist));
    }
  };
  for (const item of stageA.slice(0, 12)) addFull(item);
  for (const item of stageB.slice(0, 48)) addFull(item);
  fullModels.unshift(BASE_GATE);

  const full = {};
  const summaries = [];
  for (const model of fullModels) {
    const sections = model.id === BASE_GATE.id
      ? baseSections
      : evaluateModelRows(lib, model, rows, holdouts, (row) => predictTailGuard(lib, model, row));
    full[model.id] = sections;
    summaries.push(fullCandidateSummary(baseSections, sections, model));
  }

  const productCandidates = summaries.filter((item) => item.productCandidate && item.modelId !== BASE_GATE.id);
  const safeCandidates = productCandidates.filter((item) => item.guardrail.pass)
    .sort((a, b) => a.objective - b.objective || (a.validationHighSpeed.p99 ?? Infinity) - (b.validationHighSpeed.p99 ?? Infinity));
  const nearMisses = productCandidates.filter((item) => !item.guardrail.pass)
    .sort((a, b) => a.objective - b.objective || (a.validationHighSpeed.p99 ?? Infinity) - (b.validationHighSpeed.p99 ?? Infinity));
  const selected = safeCandidates[0] || summaries.find((item) => item.modelId === BASE_GATE.id);

  const groupOracle = buildGroupOracle(lib, rows);
  const groupOracleSections = evaluateModelRows(lib, groupOracle.model, rows, holdouts, groupOracle.predict);
  const rowBestOracle = buildRowBestOracle(lib, rows, holdouts);
  full[groupOracle.model.id] = groupOracleSections;
  full[rowBestOracle.model.id] = rowBestOracle.sections;

  const oracleSummaries = [
    fullCandidateSummary(baseSections, groupOracleSections, groupOracle.model),
    fullCandidateSummary(baseSections, rowBestOracle.sections, rowBestOracle.model),
  ];

  return {
    baseModel: summaries.find((item) => item.modelId === BASE_GATE.id),
    stageA: {
      candidatesEvaluated: stageA.length,
      top: stageA.slice(0, 24),
      broken: stageA.slice(-8).reverse(),
    },
    stageB: {
      candidatesEvaluated: stageB.length,
      top: stageB.slice(0, 48),
      broken: stageB.slice(-8).reverse(),
    },
    fullEvaluation: {
      modelsEvaluated: fullModels.length,
      selectedProductSafeCandidate: selected,
      safeCandidates: safeCandidates.slice(0, 16),
      nearMisses: nearMisses.slice(0, 16),
      evaluatedSummaries: summaries.sort((a, b) => a.objective - b.objective),
    },
    oracle: {
      groupOracle: {
        model: groupOracle.model,
        summary: oracleSummaries[0],
        groupRanking: groupOracle.groupRanking,
      },
      rowBestLowerBound: {
        model: rowBestOracle.model,
        summary: oracleSummaries[1],
      },
    },
    scores: full,
  };
}

function datasetSummary(rows, skipped, packages) {
  const bySplit = {};
  const byRefresh = {};
  const byPhase = {};
  const bySpeed = {};
  for (const row of rows) {
    addCount(bySplit, row.split);
    addCount(byRefresh, row.refreshBucket);
    addCount(byPhase, row.phase);
    addCount(bySpeed, row.speedBin);
  }
  return {
    rows: rows.length,
    skipped,
    bySplit,
    byRefresh,
    byPhase,
    bySpeedBin: bySpeed,
    packages: packages.map((pkg) => ({
      id: pkg.id,
      sourceZip: pkg.sourceZip,
      referencePollRows: pkg.refTimesUs.length,
      runtimeSchedulerAnchors: pkg.anchors.length,
      motionRows: pkg.motionTimesMs.length,
      refreshBucket: pkg.refreshBucket,
      machineKey: pkg.machineKey,
    })),
  };
}

function buildScores(root, manifestPath, data, step7) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAtUtc: new Date().toISOString(),
    root,
    manifestPath: path.relative(root, manifestPath).replaceAll(path.sep, "/"),
    constraints: {
      gpuUsed: false,
      trainingRun: false,
      rawZipCopied: false,
      largePerFrameCacheWritten: false,
      execution: "single-process CPU-only sequential product-safe guard and analysis-only oracle search",
    },
    evaluationContract: {
      anchor: TARGET_EVENT,
      horizon: "v9_target",
      baseline: BASE_GATE.id,
      productInputs: [
        "causal referencePoll history",
        "v9 target horizon",
        "scheduler provenance",
        "refresh bucket",
        "history gap",
        "causal speed",
        "net displacement",
        "path efficiency/stability",
        "causal acceleration estimate",
      ],
      analysisOnlyInputs: [
        "motion-samples.csv movementPhase",
        "future label speed bin",
      ],
    },
    dataset: data,
    search: {
      objective: "overall p95/p99/>10 plus high-speed, resume, and 30Hz tail penalties",
      guardrails: {
        overall: "validation/test p95 and p99 may worsen by at most 0.25px; >10px rate may worsen by at most 0.001 absolute",
        refresh30Holdout: "refresh:30Hz holdout test p95/p99 must not worsen",
      },
      baseModel: step7.baseModel,
      stageA: step7.stageA,
      stageB: step7.stageB,
      fullEvaluation: step7.fullEvaluation,
      oracle: step7.oracle,
    },
    scores: step7.scores,
  };
}

function table(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, index) => Math.max(...all.map((row) => String(row[index] ?? "").length)));
  const format = (row) => `| ${row.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join(" | ")} |`;
  return [
    format(headers),
    format(headers.map((_, index) => "-".repeat(widths[index]))),
    ...rows.map(format),
  ].join("\n");
}

function fmt(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (typeof value === "number") return String(round(value, digits));
  return String(value);
}

function reportRowsFromSummary(items) {
  return items.map((item, index) => [
    index + 1,
    item.modelId,
    item.guardrail?.pass ? "yes" : "no",
    fmt(item.validation?.mean),
    fmt(item.validation?.p95),
    fmt(item.validation?.p99),
    fmt(item.validation?.gt10, 6),
    fmt(item.validationHighSpeed?.p95),
    fmt(item.validationHighSpeed?.p99),
    fmt(item.validationResume?.p95),
    fmt(item.validationResume?.p99),
    fmt(item.test30Hz?.p95),
    fmt(item.test30Hz?.p99),
    fmt(item.objective),
  ]);
}

function renderReport(scores) {
  const selected = scores.search.fullEvaluation.selectedProductSafeCandidate;
  const base = scores.search.baseModel;
  const safeRows = reportRowsFromSummary(scores.search.fullEvaluation.safeCandidates.slice(0, 12));
  const nearMissRows = reportRowsFromSummary(scores.search.fullEvaluation.nearMisses.slice(0, 12));
  const oracleRows = [scores.search.oracle.groupOracle.summary, scores.search.oracle.rowBestLowerBound.summary].map((item, index) => [
    index + 1,
    item.modelId,
    item.analysisOnly ? "yes" : "no",
    fmt(item.validation?.mean),
    fmt(item.validation?.p95),
    fmt(item.validation?.p99),
    fmt(item.validation?.gt10, 6),
    fmt(item.validationHighSpeed?.p95),
    fmt(item.validationHighSpeed?.p99),
    fmt(item.validationResume?.p95),
    fmt(item.validationResume?.p99),
    fmt(item.test30Hz?.p95),
    fmt(item.test30Hz?.p99),
    fmt(item.objective),
  ]);
  const baseRows = reportRowsFromSummary(selected.modelId === base.modelId ? [base] : [base, selected]);
  const stageRows = scores.search.stageB.top.slice(0, 12).map((row, index) => [
    index + 1,
    row.modelId,
    fmt(row.validation.mean),
    fmt(row.validation.p95),
    fmt(row.validation.p99),
    fmt(row.validation.regressionRates.gt10px, 6),
    fmt(row.validationHighSpeed.p95),
    fmt(row.validationHighSpeed.p99),
    fmt(row.validationResume.p95),
    fmt(row.validationResume.p99),
    fmt(row.validation30Hz.p95),
    fmt(row.validation30Hz.p99),
    fmt(row.objective),
  ]);
  const groupRows = scores.search.oracle.groupOracle.groupRanking
    .filter((row) => row.group.includes(">=2000") || row.group.startsWith("resume|"))
    .slice(0, 24)
    .map((row) => [
      row.group,
      row.selectedModelId,
      row.validation.count,
      fmt(row.validation.mean),
      fmt(row.validation.p95),
      fmt(row.validation.p99),
      fmt(row.validation.gt10, 6),
    ]);

  return `# Step 7 Tail and Holdout Refinement

## Scope

This step keeps the Step 5 selected gate \`${BASE_GATE.id}\` as the baseline and searches product-safe specialist guards for the remaining \`>=2000 px/s\`, \`resume\`, and 30Hz holdout tails. Inputs for product candidates remain causal: referencePoll history, v9 target horizon, scheduler/refresh context, history gap, speed, net displacement, path efficiency, and acceleration estimate.

No GPU, checkpoint, raw ZIP copy, or large intermediate file was used.

## Baseline vs Selected

${selected.modelId === base.modelId
    ? "No product-safe specialist guard passed all guardrails, so the selected product candidate remains the Step 5 baseline."
    : `Selected product-safe candidate: \`${selected.modelId}\``}

${table(["rank", "model", "guard ok", "val mean", "val p95", "val p99", "val >10", "val >=2000 p95", "val >=2000 p99", "val resume p95", "val resume p99", "30Hz test p95", "30Hz test p99", "objective"], baseRows)}

## Safe Product Candidates

${safeRows.length ? table(["rank", "model", "guard ok", "val mean", "val p95", "val p99", "val >10", "val >=2000 p95", "val >=2000 p99", "val resume p95", "val resume p99", "30Hz test p95", "30Hz test p99", "objective"], safeRows) : "No specialist guard passed all guardrails. The baseline remains the safe product candidate."}

## Near Misses

${table(["rank", "model", "guard ok", "val mean", "val p95", "val p99", "val >10", "val >=2000 p95", "val >=2000 p99", "val resume p95", "val resume p99", "30Hz test p95", "30Hz test p99", "objective"], nearMissRows)}

## Validation Search Top

${table(["rank", "model", "mean", "p95", "p99", ">10", ">=2000 p95", ">=2000 p99", "resume p95", "resume p99", "30Hz p95", "30Hz p99", "objective"], stageRows)}

## Analysis-Only Oracle Ceiling

${table(["rank", "model", "analysis only", "val mean", "val p95", "val p99", "val >10", "val >=2000 p95", "val >=2000 p99", "val resume p95", "val resume p99", "30Hz test p95", "30Hz test p99", "objective"], oracleRows)}

## Oracle Tail Groups

${table(["group", "selected oracle model", "count", "mean", "p95", "p99", ">10"], groupRows)}

## Interpretation

- The guard search is intentionally conservative: if a tail specialist improves high-speed rows but worsens overall p99, >10px rate, or 30Hz holdout, it is not a product candidate.
- The group oracle uses true motion phase and future speed bin, so it is a ceiling probe rather than an implementation candidate.
- The per-row oracle lower bound uses label error to pick the best model per row; it is impossible in product but useful for judging whether the model pool itself can approach zero error.
`;
}

function renderNotes(scores) {
  return `# Step 7 Notes

## Rerun

\`\`\`powershell
node poc\\cursor-prediction-v12\\scripts\\run-step7-tail-and-holdout.js
\`\`\`

## Search Shape

- Stage A explores speed threshold, refresh branch, and every requested LS specialist parameter tuple.
- Stage B expands the best Stage A tuples with acceleration, path efficiency, and net displacement thresholds.
- The selected Step 5 gate remains the fallback for every row that does not satisfy the specialist guard.

## Product Safety

Product candidates do not use \`movementPhase\`, future speed bins, or labels. Those are reserved for analysis-only oracle scoring.

## Main Result

Selected candidate: \`${scores.search.fullEvaluation.selectedProductSafeCandidate.modelId}\`

The safe choice is whichever model passes validation/test overall guardrails and does not worsen \`refresh:30Hz\` holdout p95/p99. If no specialist passes, the Step 5 selected gate remains selected.
`;
}

function updateReadme(readmePath) {
  let text = fs.readFileSync(readmePath, "utf8");
  const additions = [
    "- `step-7-tail-and-holdout-refinement/report.md`: tail, resume, and 30Hz holdout guard refinement.",
    "- `step-7-tail-and-holdout-refinement/scores.json`: product-safe guard search and analysis-only oracle scores.",
    "- `step-7-tail-and-holdout-refinement/notes.md`: Step 7 rerun and guardrail notes.",
    "- `scripts/run-step7-tail-and-holdout.js`: reproducible Step 7 refinement script.",
  ];
  for (const line of additions) {
    if (!text.includes(line)) {
      text = text.replace("- `scripts/run-step5-step6.js`: reproducible state-gate and ML/FSMN search script.\n", `- \`scripts/run-step5-step6.js\`: reproducible state-gate and ML/FSMN search script.\n${line}\n`);
    }
  }
  fs.writeFileSync(readmePath, text, "utf8");
}

function writeOutputs(root, outDir, scores) {
  const stepDir = path.join(outDir, "step-7-tail-and-holdout-refinement");
  ensureDir(stepDir);
  fs.writeFileSync(path.join(stepDir, "scores.json"), JSON.stringify(scores, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(stepDir, "report.md"), renderReport(scores), "utf8");
  fs.writeFileSync(path.join(stepDir, "notes.md"), renderNotes(scores), "utf8");
  updateReadme(path.join(outDir, "README.md"));
  const outputs = [
    path.join(stepDir, "scores.json"),
    path.join(stepDir, "report.md"),
    path.join(stepDir, "notes.md"),
    path.join(outDir, "README.md"),
  ];
  process.stdout.write(`Wrote:\n${outputs.map((item) => path.relative(root, item).replaceAll(path.sep, "/")).join("\n")}\n`);
}

function main() {
  const args = parseArgs(process.argv);
  const lib = loadStepLibrary();
  const context = lib.loadManifest(args.manifest);
  const packages = context.manifest.packageScenarioAssignments.map((assignment) => lib.loadPackage(args.root, assignment, context));
  const built = lib.buildRows(packages);
  const data = datasetSummary(built.rows, built.skipped, packages);
  const step7 = searchStep7(lib, built.rows, context.holdouts);
  const scores = buildScores(args.root, args.manifest, data, step7);
  writeOutputs(args.root, args.outDir, scores);
}

main();
