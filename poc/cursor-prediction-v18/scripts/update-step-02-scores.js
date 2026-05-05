const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const step = path.join(root, "poc/cursor-prediction-v18/step-02-current-position-baseline");
const lag0 = JSON.parse(fs.readFileSync(path.join(step, "output-lag0p0.json"), "utf8"));
const lag05 = JSON.parse(fs.readFileSync(path.join(step, "output-lag0p5.json"), "utf8"));
const candidates = { ...lag0.candidates, ...lag05.candidates };

const aliases = {
  current_product_direct: "lagp0_offsetm4",
  product_lag0_offset0: "lagp0_offsetp0",
  product_lag0_offsetm3p5: "lagp0_offsetm3p5",
  overlay_lag0p5_offset0: "lagp0p5_offsetp0",
  overlay_lag0p5_offsetm4: "lagp0p5_offsetm4"
};

const ranking = Object.values(candidates)
  .map(c => ({
    id: c.id,
    lagPx: c.lagPx,
    offsetMs: c.offsetMs,
    fastRows: c.metrics.fastThenNearZero.count,
    currentOvershootP99: c.metrics.fastThenNearZero.currentOvershoot.p99,
    currentOvershootMax: c.metrics.fastThenNearZero.currentOvershoot.max,
    currentOvershootGt1: c.metrics.fastThenNearZero.currentOvershoot.gt1,
    currentOvershootGt2: c.metrics.fastThenNearZero.currentOvershoot.gt2,
    currentDistanceP99: c.metrics.fastThenNearZero.currentDistance.p99,
    shiftedVisualP95: c.metrics.fastThenNearZero.visualError.p95,
    normalVisualP95: c.metrics.normalMove.visualError.p95,
    highSpeedVisualP95: c.metrics.highSpeed.visualError.p95,
    staticDistanceP95: c.metrics.staticHold.currentDistance.p95,
    acuteStopObjective: c.objective.acuteStopObjective,
    sideEffectObjective: c.objective.sideEffectObjective,
    balancedObjective: c.objective.balancedObjective
  }))
  .sort((a, b) => a.balancedObjective - b.balancedObjective);

const scores = {
  schemaVersion: "cursor-prediction-v18-step-02-current-position-baseline/1",
  generatedAtUtc: new Date().toISOString(),
  constraints: {
    productSourceEdited: false,
    rawZipCopied: false,
    gpuTrainingRun: false,
    cpuOnly: true,
    heavyParallelism: false
  },
  productSourceState: {
    generatedModel: "src/CursorMirror.Core/DistilledMlpPredictionModel.g.cs",
    modelId: "mlp_fsmn_h8_hardtanh_label_q0p125_lag0",
    lagCompensationPixels: 0.0,
    currentProductDirectCandidate: "lagp0_offsetm4",
    note: "The current product generated model already has lag0. Step02 lag0 overlay is equivalent to product direct for DistilledMLP weights/lag; product source was not edited."
  },
  inputs: {
    sourceZipsReadInPlace: [
      "cursor-mirror-motion-recording-20260504-070248.zip",
      "cursor-mirror-motion-recording-20260504-070307.zip"
    ],
    harnessProject: "poc/cursor-prediction-v18/step-02-current-position-baseline/harness/CurrentPositionHarness.csproj"
  },
  datasetSummary: {
    replayRows: candidates.lagp0_offsetm4.rows,
    byCandidateSliceCounts: {
      fastThenNearZero: candidates.lagp0_offsetm4.metrics.fastThenNearZero.count,
      hardBrake: candidates.lagp0_offsetm4.metrics.hardBrake.count,
      stopAfterHighSpeed: candidates.lagp0_offsetm4.metrics.stopAfterHighSpeed.count,
      oneFrameStop: candidates.lagp0_offsetm4.metrics.oneFrameStop.count,
      postStopFirstFrames: candidates.lagp0_offsetm4.metrics.postStopFirstFrames.count,
      normalMove: candidates.lagp0_offsetm4.metrics.normalMove.count,
      highSpeed: candidates.lagp0_offsetm4.metrics.highSpeed.count,
      staticHold: candidates.lagp0_offsetm4.metrics.staticHold.count
    }
  },
  candidateAliases: aliases,
  candidates,
  ranking,
  keyComparisons: Object.fromEntries(Object.entries(aliases).map(([alias, id]) => [alias, candidates[id]])),
  tailRowsSummary: {
    currentProductDirectFastThenNearZeroGt1: candidates.lagp0_offsetm4.acuteTailExamples.length,
    currentProductDirectExamples: candidates.lagp0_offsetm4.acuteTailExamples,
    overlayLag0p5OffsetM4Examples: candidates.lagp0p5_offsetm4.acuteTailExamples
  },
  interpretation: {
    primaryFinding: "In the available C# chronological replay, current product direct (lag0 offset -4ms) almost eliminates current-position overshoot on acute-stop slices: fastThenNearZero p99 is 0 and max is about 1.99px.",
    residualTailCauseHypothesis: "The remaining current-position tail is a one-frame-stop style residual prediction: v2 is already zero, v5/v12 remain high, shifted and offset0 targets are at current position, but the predictor emits about 2px displacement. This is the exact shape a small hard-stop brake/snap can target.",
    shiftedTargetContrast: "lag0 offset -4 can still have shifted-target visual error on acute-stop rows, but user-visible current-position overshoot is near zero. v18 should not optimize shifted-target error at the expense of current-position safety.",
    comparison: "lag0 offset -3.5 and offset0 are worse for current-position acute-stop overshoot. lag0.5 offset -4 has a small >2px current-position tail that lag0 removes."
  },
  nextBrakeGateCandidates: [
    "oneFrameStop hard snap: if v2 <= 100 and v5 >= 500 and shifted/offset0 target distance <= 0.5px, return current position",
    "hardBrake displacement cap: if v12 >= 800 and v2 <= 0.35*v12, clamp current displacement magnitude to <= 0.5px",
    "fastThenNearZero current safety gate: if v12 >= 500 and target speed <= 150 and target displacement <= 0.75px, zero prediction",
    "brake confidence gain scale: multiply predicted displacement by a factor from v2/v5/v12 ratio only inside acute-stop slices",
    "postStopFirstFrames hold latch: for 1-2 frames after v2<=100/v5<=250/v12>=500, hold at current unless movement resumes",
    "axis-preserving along clamp: remove only forward component along recent motion while preserving perpendicular correction"
  ]
};

fs.writeFileSync(path.join(step, "scores.json"), JSON.stringify(scores, null, 2));
