const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step01 = path.join(root, "step-01-baseline-audit");
const step02 = path.join(root, "step-02-failure-signatures");
const rawPath = path.join(step01, "baseline-audit-output.json");
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function round(v, d = 6) { return typeof v === "number" ? Number(v.toFixed(d)) : v; }
function pct(v) { return `${round(v * 100, 3)}%`; }
function mdTable(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map(r => `| ${r.join(" | ")} |`)].join("\n");
}
function stats(s) {
  return { mean: round(s.mean), p50: round(s.p50), p95: round(s.p95), p99: round(s.p99), max: round(s.max) };
}
function compactCandidate(id) {
  const c = raw.candidates[id];
  return {
    id,
    candidate: c.candidate,
    rows: c.rows,
    elapsedMs: round(c.elapsedMs),
    runtimeEstimate: {
      usPerPrediction: round(c.runtimeEstimate.usPerPrediction),
      estimatedMacs: c.runtimeEstimate.estimatedMacs,
      cpuOnly: c.runtimeEstimate.cpuOnly,
    },
    overallMetrics: {
      mae: round(c.overallMetrics.mae),
      rmse: round(c.overallMetrics.rmse),
      visual: stats(c.overallMetrics.visual),
      stationaryJitter: stats(c.overallMetrics.stationaryJitter),
    },
    eventMetrics: {
      count: c.eventMetrics.count,
      peakLead: stats(c.eventMetrics.peakLead),
      peakDistance: stats(c.eventMetrics.peakDistance),
      returnMotion: stats(c.eventMetrics.returnMotion),
      overshootThenReturnRateGt0p5: round(c.eventMetrics.overshootThenReturnRateGt0p5),
      overshootThenReturnRateGt1: round(c.eventMetrics.overshootThenReturnRateGt1),
      overshootThenReturnRateGt2: round(c.eventMetrics.overshootThenReturnRateGt2),
      leadGt1: round(c.eventMetrics.leadGt1),
      leadGt2: round(c.eventMetrics.leadGt2),
      byPhase: c.eventMetrics.byPhase,
      bySpeedBand: c.eventMetrics.bySpeedBand,
      examples: c.eventMetrics.examples.slice(0, 8),
    },
    failureSignatures: c.failureSignatures,
  };
}
function candidateRow(id) {
  const c = raw.candidates[id];
  return [
    id,
    round(c.overallMetrics.mae, 3),
    round(c.overallMetrics.rmse, 3),
    round(c.overallMetrics.visual.p95, 3),
    round(c.overallMetrics.visual.p99, 3),
    c.eventMetrics.count,
    round(c.eventMetrics.peakLead.p99, 3),
    round(c.eventMetrics.peakLead.max, 3),
    round(c.eventMetrics.returnMotion.max, 3),
    pct(c.eventMetrics.overshootThenReturnRateGt1),
    round(c.runtimeEstimate.usPerPrediction, 3),
  ];
}

const candidateIds = Object.keys(raw.candidates);
const distilledNoBrakeId = "distilled_mlp_lag0_offset_minus4";
const brakeId = "distilled_mlp_lag0_offset_minus4_post_stop_brake";
ensureDir(step01);
ensureDir(step02);

const scores01 = {
  schemaVersion: "cursor-prediction-v19-step-01-baseline-audit/1",
  generatedAtUtc: new Date().toISOString(),
  source: path.relative(root, rawPath).replaceAll("\\", "/"),
  inputs: raw.inputs,
  productState: raw.productState,
  datasetSummary: raw.datasetSummary,
  ranking: raw.ranking,
  candidates: Object.fromEntries(candidateIds.map(id => [id, compactCandidate(id)])),
  interpretation: {
    selectedBaseline: brakeId,
    summary: "On the latest 60Hz replay pair, current DistilledMLP lag0/-4ms with product post-stop brake eliminates detected event-window peakLead/returnMotion, while no-brake DistilledMLP still leaks sparse 2.44px peakLead / 2.49px returnMotion events.",
    caveat: "This does not prove the live user-visible failure is solved; v18 showed slice labels can hide stop-prep fire rate. Step 02 classifies remaining no-brake signatures and Step 03 should add targeted synthetic reproduction."
  }
};
fs.writeFileSync(path.join(step01, "scores.json"), JSON.stringify(scores01, null, 2) + "\n");

const report01 = `# Step 01 Report: Baseline Audit

## Inputs

- Source traces read in place: \`cursor-mirror-motion-recording-20260504-070248.zip\`, \`cursor-mirror-motion-recording-20260504-070307.zip\`
- Replay rows: \`${raw.datasetSummary.totalCalls}\`
- Reference rows: \`${raw.datasetSummary.totalRefs}\`
- Product model: \`${raw.productState.distilledMlpModelId}\`, lag \`${raw.productState.distilledMlpLagCompensationPixels}px\`

## Candidate Comparison

${mdTable(
  ["candidate", "MAE", "RMSE", "p95", "p99", "events", "peakLead p99", "peakLead max", "return max", "OTR >1", "us/pred"],
  candidateIds.map(candidateRow)
)}

## Findings

The current product-equivalent \`${brakeId}\` is the best audited baseline. It preserves the low normal visual error of DistilledMLP and drives the detected stop-event peakLead, peakDistance, returnMotion, and overshoot-then-return rates to zero on this replay pair.

Without the post-stop brake, DistilledMLP still leaks sparse event-window failures: peakLead max \`${round(raw.candidates[distilledNoBrakeId].eventMetrics.peakLead.max, 3)}px\`, returnMotion max \`${round(raw.candidates[distilledNoBrakeId].eventMetrics.returnMotion.max, 3)}px\`, OTR >1 \`${pct(raw.candidates[distilledNoBrakeId].eventMetrics.overshootThenReturnRateGt1)}\`.

ConstantVelocity and LeastSquares reproduce the broad overshoot-then-return failure strongly, but their error magnitudes are much worse than the current DistilledMLP path.

## Caveat

This Step 01 audit only covers the latest two 60Hz recordings used by v18. Because the user still reports abrupt-stop overshoot in the live product path, v19 must add targeted scenario reproduction and richer failure signatures before declaring the runtime brake final.
`;
fs.writeFileSync(path.join(step01, "report.md"), report01);

const notes01 = `# Step 01 Notes

Audited current product-equivalent chronological replay candidates:

- ConstantVelocity, default +2ms target offset
- LeastSquares, default +2ms target offset
- DistilledMLP lag0, recommended -4ms target offset, post-stop brake disabled
- DistilledMLP lag0, recommended -4ms target offset, product post-stop brake enabled

Metrics include normal visual MAE/RMSE/p95/p99, current-position event-window peakLead/peakDistance/returnMotion, overshoot-then-return rates, stationary jitter, and rough C# replay runtime.

No product source files were modified.
`;
fs.writeFileSync(path.join(step01, "notes.md"), notes01);

const noBrake = raw.candidates[distilledNoBrakeId];
const signatures = noBrake.failureSignatures;
const scores02 = {
  schemaVersion: "cursor-prediction-v19-step-02-failure-signatures/1",
  generatedAtUtc: new Date().toISOString(),
  sourceCandidate: distilledNoBrakeId,
  currentBrakeCandidate: brakeId,
  noBrakeEventMetrics: compactCandidate(distilledNoBrakeId).eventMetrics,
  brakeEventMetrics: compactCandidate(brakeId).eventMetrics,
  failureSignatures: signatures,
  interpretation: {
    primaryLeak:
      "No-brake DistilledMLP leaks abrupt stop events mainly when v2 and target displacement are zero but recent high speed remains large; the largest event is postStopFirstFrames with peakFrame 8 and full return.",
    speedBands:
      "Failures cover low/medium/high/veryHigh preMax bands; the sparse product-like tail is not a single speed-only pattern.",
    deceleration:
      "Most top failures are fullStop or hardBrake profiles, with high path efficiency near the stop, suggesting straight-line abrupt stop rather than noisy oscillation.",
    phase:
      "Top cases include postStopFirstFrames, oneFrameStop, and fastThenNearZero, so a one-frame-only snap is insufficient.",
    next:
      "Step 03 should generate parameterized MotionLab abrupt-stop families with straight and curved approaches, phase offsets, stop duration variation, and near-zero creep."
  }
};
fs.writeFileSync(path.join(step02, "scores.json"), JSON.stringify(scores02, null, 2) + "\n");

const top = signatures.top.slice(0, 8).map(e => [
  e.PackageId,
  round(e.StopElapsedMs, 3),
  e.Phase,
  e.SpeedBand,
  e.DecelBand,
  round(e.PreMaxSpeed, 1),
  round(e.V2AtStop, 1),
  round(e.RecentHighAtStop, 1),
  round(e.PeakLeadPx, 3),
  round(e.PeakDistancePx, 3),
  round(e.ReturnMotionPx, 3),
  e.OvershootThenReturn ? "yes" : "no",
]);

const report02 = `# Step 02 Report: Failure Signatures

## Scope

This step classifies the remaining abrupt-stop leak in \`${distilledNoBrakeId}\`. The current product brake is included as a reference and eliminates these detected windows on the audited pair.

## Top No-Brake Event Failures

${mdTable(
  ["package", "stop ms", "phase", "speed", "decel", "preMax", "v2", "recentHigh", "peakLead", "peakDist", "return", "OTR"],
  top
)}

## Classification

- Phase is mixed: \`postStopFirstFrames\`, \`oneFrameStop\`, and \`fastThenNearZero\` all appear near the top.
- Deceleration is mostly \`fullStop\`; the issue is a time-window failure after rapid deceleration, not just a single bad frame.
- Path efficiency is high in representative rows, so these are clean approach-to-stop events rather than jittery path reversals.
- Speed bands range from low/medium to high/veryHigh; a robust fix cannot depend only on a very-high-speed threshold.
- DWM timing is available in the top examples from these traces, so the leak is not explained by missing DWM alone.

## Implication

The existing post-stop brake’s 10-frame latch matches the detected leak family on these traces. The remaining research risk is reproduction coverage: if the user still sees overshoot live, the missing case likely differs in phase/timing, data density, curved approach, near-zero creep, load/no-load scheduling, or stop duration. Step 03 should therefore add synthetic abrupt-stop scenarios rather than only tuning this trace pair.
`;
fs.writeFileSync(path.join(step02, "report.md"), report02);

const notes02 = `# Step 02 Notes

Failure signature source: \`${distilledNoBrakeId}\`.

Classification dimensions captured in \`scores.json\`:

- speed band
- deceleration band
- event phase
- package
- DWM availability
- v2/v5/v8/v12/recentHigh
- latest sample delta
- path efficiency
- peak frame, peakLead, peakDistance, returnMotion

No new replay was run for Step 02; it is derived from Step 01 output.
`;
fs.writeFileSync(path.join(step02, "notes.md"), notes02);

const readme = `# Cursor Prediction POC v19

Goal: robustly solve abrupt deceleration/stop overshoot where the mirror cursor passes the real cursor and then returns.

## Current Status

- Step 01 baseline audit is complete on the latest v18 60Hz replay pair.
- Step 02 failure signature classification is complete for the no-brake DistilledMLP leak.
- Current product-equivalent DistilledMLP lag0/-4ms with post-stop brake eliminates detected stop-event tail on this replay pair.

## Current Recommendation

Keep the product post-stop brake as validation/safety candidate, but do not stop the investigation. The live user report means v19 should next add parameterized abrupt-stop MotionLab scenarios and verify reproduction outside the two latest real recordings.

## Next Step

Step 03: add or prototype abrupt deceleration/stop scenario families with velocity/deceleration/stop-duration, near-zero creep, curve shape, phase, polling/dropout, and load/no-load metadata where tooling supports it.
`;
fs.writeFileSync(path.join(root, "README.md"), readme);

const log = `# Experiment Log

## 2026-05-04

- Created v19 workspace under \`poc/cursor-prediction-v19/\`.
- Ran Step 01 C# chronological baseline audit over \`m070248\` and \`m070307\`.
- Audited ConstantVelocity, LeastSquares, DistilledMLP lag0/-4ms, and DistilledMLP lag0/-4ms with product post-stop brake.
- Step 01 result: product post-stop brake drives detected event-window peakLead/returnMotion to zero on the latest 60Hz replay pair.
- Created Step 02 failure signature classification from Step 01 output without re-running replay.
- Step 02 result: no-brake DistilledMLP leak is mixed phase (\`postStopFirstFrames\`, \`oneFrameStop\`, \`fastThenNearZero\`) and mostly full-stop/high-efficiency approach; Step 03 should add synthetic abrupt-stop coverage.
`;
fs.writeFileSync(path.join(root, "experiment-log.md"), log);

console.log("wrote Step 01/02 reports");
