const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const step = path.join(root, "poc/cursor-prediction-v17/step-10-csharp-lag-overlay-grid");
const files = ["0p0", "0p125", "0p25", "0p5"].map(id => path.join(step, `output-lag${id}.json`));

const candidates = {};
for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [id, c] of Object.entries(raw.candidates)) {
    candidates[id] = c;
  }
}

const ranking = Object.values(candidates)
  .map(c => ({
    id: c.id,
    lagPx: c.lagPx,
    offsetMs: c.offsetMs,
    allP95: c.metrics.all.p95,
    stopP95: c.metrics.stopApproach.p95,
    stopP99: c.metrics.stopApproach.p99,
    stopOvershootBaseP99: c.metrics.stopApproach.overshootBaseP99,
    stopOvershootTargetP99: c.metrics.stopApproach.overshootTargetP99,
    postStopP95: c.metrics.postStop.p95,
    highSpeedP95: c.metrics.highSpeed.p95,
    visualObjective: c.objective.visualObjective,
    tailObjective: c.objective.tailObjective,
    balancedObjective: c.objective.balancedObjective
  }))
  .sort((a, b) => a.balancedObjective - b.balancedObjective);

const tailRanking = [...ranking].sort((a, b) => a.tailObjective - b.tailObjective);
const visualRanking = [...ranking].sort((a, b) => a.visualObjective - b.visualObjective);

function pick(lag, offset) {
  const id = `lag${fmt(lag)}_offset${fmt(offset)}`;
  return candidates[id];
}

function fmt(value) {
  return (value < 0 ? "m" : "p") + Math.abs(value).toString().replace(".", "p");
}

const keyIds = [
  "lagp0p5_offsetm4",
  "lagp0_offsetm4",
  "lagp0p125_offsetm4",
  "lagp0p25_offsetm4",
  "lagp0_offsetm3p5",
  "lagp0p5_offsetm3p5",
  "lagp0_offsetm3",
  "lagp0p5_offsetm3",
  "lagp0_offsetp0",
  "lagp0p5_offsetp0"
];

const scores = {
  schemaVersion: "cursor-prediction-v17-step-10-csharp-lag-overlay-grid/1",
  generatedAtUtc: new Date().toISOString(),
  constraints: {
    productSourceEdited: false,
    generatedModelOverlayOnly: true,
    gpuTrainingRun: false,
    cpuOnly: true,
    heavyParallelism: false,
    rawExpandedCsvCopied: false
  },
  inputs: {
    sourceZipsReadInPlace: [
      "cursor-mirror-motion-recording-20260504-070248.zip",
      "cursor-mirror-motion-recording-20260504-070307.zip"
    ],
    productGeneratedModelSource: "src/CursorMirror.Core/DistilledMlpPredictionModel.g.cs",
    overlayGeneratedModelSource: "poc/cursor-prediction-v17/step-10-csharp-lag-overlay-grid/harness/Overlay/DistilledMlpPredictionModel.g.cs",
    harnessProject: "poc/cursor-prediction-v17/step-10-csharp-lag-overlay-grid/harness/LagOverlayHarness.csproj"
  },
  buildAndRun: {
    dotnetPath: "C:\\Program Files\\dotnet\\dotnet.exe",
    sdkVersion: "10.0.203",
    buildSucceeded: true,
    runSucceeded: true,
    lagsRunSequentially: [0, 0.125, 0.25, 0.5],
    offsetsMs: [-4.5, -4.25, -4, -3.75, -3.5, -3.25, -3, -2, 0],
    buildWarnings: [
      "CS8632 nullable annotation context warning at Program.cs lines 143 and 196"
    ]
  },
  overlayMethod: {
    summary: "The harness compiles product DwmAwareCursorPositionPredictor with a POC-local copy of DistilledMlpPredictionModel.g.cs. Before each lag run, LagCompensationPixels is patched to 0/0.125/0.25/0.5 in the overlay file. Product source remains unchanged.",
    predictorCopyNeeded: false,
    limitation: "Only generated lag const is overlaid. Other product predictor behavior is linked from product source."
  },
  metricSemantics: {
    euclidean: "Absolute predicted cursor position compared with candidate effective target position.",
    overshootBase: "Signed error projected on offset0 target direction. This matches earlier Step8/9 tail interpretation and can mark hold/zero as overshoot when the shifted target crosses behind the cursor.",
    overshootTarget: "Signed error projected on candidate effective target direction. This better answers whether the candidate itself leads past its own target.",
    observedConflict: "The Step9 -4ms tail is much smaller under candidate-target direction than under offset0 direction for some rows, confirming part of the tail is metric-frame crossing rather than visible MLP amplitude."
  },
  candidateCount: Object.keys(candidates).length,
  candidates,
  ranking,
  tailRanking,
  visualRanking,
  keyComparisons: Object.fromEntries(keyIds.filter(id => candidates[id]).map(id => [id, {
    lagPx: candidates[id].lagPx,
    offsetMs: candidates[id].offsetMs,
    metrics: candidates[id].metrics,
    objective: candidates[id].objective
  }])),
  selectedRecommendation: {
    id: ranking[0].id,
    lagPx: ranking[0].lagPx,
    offsetMs: ranking[0].offsetMs,
    rationale: "Best balanced objective in the overlay grid."
  },
  productRecommendation: {
    minimalIntegerChange: "Set target offset to -4ms and keep generated lag 0.5px if the product change must be minimal/integer-only.",
    strongerButNonMinimal: "Lag 0 with offset -3.5ms improves balanced/tail objective in this harness but requires both generated model regeneration and fractional offset support.",
    lagConstValue: "Lag reduction has value, especially around -3.5/-3ms. It is not worth changing lag alone without also choosing the target offset.",
    fractionalOffsetValue: "Yes. Fractional -3.5ms remains useful for tail/balanced behavior, but it costs visual p95 versus -4ms and requires product support."
  }
};

fs.writeFileSync(path.join(step, "scores.json"), JSON.stringify(scores, null, 2));
