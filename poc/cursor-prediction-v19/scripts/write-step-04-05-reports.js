const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step04 = path.join(root, "step-04-reproduction");
const step04b = path.join(root, "step-04b-generator-revision");
const step05 = path.join(root, "step-05-dataset-loss-design");
fs.mkdirSync(step05, { recursive: true });

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function n(value, digits = 3) {
  if (value === undefined || value === null || Number.isNaN(value)) return "0";
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}

function candidateSummary(scores) {
  return Object.entries(scores.candidates).map(([id, c]) => ({
    id,
    rows: c.rows,
    events: c.eventMetrics.count,
    visualP95: c.overallMetrics.visual.p95,
    visualP99: c.overallMetrics.visual.p99,
    peakLeadP95: c.eventMetrics.peakLead.p95,
    peakLeadP99: c.eventMetrics.peakLead.p99,
    peakLeadMax: c.eventMetrics.peakLead.max,
    otrGt1: c.eventMetrics.overshootThenReturnRateGt1,
    returnP99: c.eventMetrics.returnMotion.p99,
    returnMax: c.eventMetrics.returnMotion.max,
    jitterP95: c.overallMetrics.stationaryJitter.p95,
    jitterP99: c.overallMetrics.stationaryJitter.p99,
  }));
}

function markdownTable(rows) {
  const header = "| candidate | events | visual p95/p99 | peakLead p95/p99/max | OTR >1px | return p99/max | jitter p95/p99 |";
  const sep = "|---|---:|---:|---:|---:|---:|---:|";
  const body = rows.map((r) =>
    `| ${r.id} | ${r.events} | ${n(r.visualP95)}/${n(r.visualP99)} | ${n(r.peakLeadP95)}/${n(r.peakLeadP99)}/${n(r.peakLeadMax)} | ${n(r.otrGt1 * 100, 2)}% | ${n(r.returnP99)}/${n(r.returnMax)} | ${n(r.jitterP95)}/${n(r.jitterP99)} |`);
  return [header, sep, ...body].join("\n");
}

const original = readJson(path.join(step04, "scores.json"));
const revisedReplay = readJson(path.join(step04b, "replay-scores.json"));
const revisedGenerator = readJson(path.join(step04b, "scores.json"));
const originalRows = candidateSummary(original);
const revisedRows = candidateSummary(revisedReplay);

fs.writeFileSync(path.join(step04, "notes.md"), `# Step 04 Notes: Reproduction Replay

Step 04 ran product-equivalent C# replay over the Step 03 MotionLab abrupt-stop scenario set:

- \`${original.inputs.ScenarioPath}\`
- scenarios: ${original.inputs.scenarioCount}
- call rate: ${original.inputs.CallRateHz ?? original.inputs.callRateHz ?? 60} Hz
- DWM phase offsets: ${original.inputs.PhaseOffsetsMs?.join(", ") ?? original.inputs.phaseOffsetsMs?.join(", ")}

Compared candidates:

- ConstantVelocity, default +2ms target offset
- LeastSquares, default +2ms target offset
- DistilledMLP lag0, target offset -4ms, no post-stop brake
- DistilledMLP lag0, target offset -4ms, current product post-stop brake

Result: the original Step 03 scenario set did not produce detected stop events under the Step 01 event-window definition. It showed broad current-position lead in row metrics, but it was too slow/gentle to satisfy recent-high plus near-zero stop-onset criteria.

This triggered Step 04b generator revision.
`);

fs.writeFileSync(path.join(step04, "report.md"), `# Step 04 Report: Original MotionLab Reproduction Attempt

## Result

The first replay did **not** reproduce the event-window abrupt-stop leak.

- no-brake reproduction: ${original.reproduction.noBrakeReproducesLeak}
- product-brake reproduction: ${original.reproduction.productBrakeReproducesLeak}
- detected stop events: 0 for all candidates

${markdownTable(originalRows)}

## Interpretation

The Step 03 scenarios encoded holds and abrupt-stop intent, but the path lengths and 3.6s durations made the 60Hz runtime sequence too gentle. The Step 01 event detector never observed the required high-speed-to-near-zero transition. This is a generator issue, not proof that the product is safe on synthetic abrupt stops.

## Follow-up

Step 04b revises the generator with shorter/faster paths, 1-3 frame deceleration proxies, DWM phase crossing, stale/missed-poll proxies, near-zero last velocity, and curved approaches.
`);

fs.writeFileSync(path.join(step04b, "notes.md"), `# Step 04b Notes: Revised Generator and Reproduction

Step 04b was created because Step 04 produced zero detected stop events.

The revised scenario set adds:

- very high-speed stops
- 1-3 frame deceleration proxies
- DWM phase-crossing proxy families
- stale latest sample and missed poll proxies
- near-zero last velocity that is not exactly zero
- curved approach before stop

The same Step 04 C# harness replayed the revised set. Product source was not modified.
`);

fs.writeFileSync(path.join(step04b, "report.md"), `# Step 04b Report: Revised Generator Reproduces Leak

## Result

The revised generator **does reproduce** abrupt-stop overshoot/return in the product-equivalent C# path.

- no-brake reproduction: ${revisedReplay.reproduction.noBrakeReproducesLeak}
- product-brake reproduction: ${revisedReplay.reproduction.productBrakeReproducesLeak}
- revised scenarios: ${revisedReplay.inputs.scenarioCount}
- DWM phase offsets: ${revisedReplay.inputs.PhaseOffsetsMs?.join(", ") ?? revisedReplay.inputs.phaseOffsetsMs?.join(", ")}

${markdownTable(revisedRows)}

## Key Finding

The current product post-stop brake reduces overshoot-then-return rate versus no-brake DistilledMLP, but it does **not** eliminate the revised synthetic leak:

- no-brake DistilledMLP OTR >1px: ${n(revisedReplay.candidates.distilled_mlp_lag0_offset_minus4.eventMetrics.overshootThenReturnRateGt1 * 100, 2)}%
- product-brake DistilledMLP OTR >1px: ${n(revisedReplay.candidates.distilled_mlp_lag0_offset_minus4_post_stop_brake.eventMetrics.overshootThenReturnRateGt1 * 100, 2)}%
- product-brake peakLead max: ${n(revisedReplay.candidates.distilled_mlp_lag0_offset_minus4_post_stop_brake.eventMetrics.peakLead.max)} px
- product-brake returnMotion max: ${n(revisedReplay.candidates.distilled_mlp_lag0_offset_minus4_post_stop_brake.eventMetrics.returnMotion.max)} px

## Failure Shape

The leak is provoked by the dimensions the Step 03 set lacked: much higher pre-stop speed, very narrow deceleration, and near-zero/stale/missed-poll stop proxies. These can bypass or shorten the effective product brake protection because stop intent is not always an exact zero-current-delta plus tiny target-distance frame.

## Decision

Proceed to Step 05 dataset/loss design using this revised generator as an abrupt-stop synthetic family. The generator is still a stress test, not a final training distribution; it should be mixed with real 60Hz traces and guarded against leakage by file/scenario-level splits.
`);

const step04bScores = {
  ...revisedGenerator,
  replay: {
    schemaVersion: revisedReplay.schemaVersion,
    inputs: revisedReplay.inputs,
    reproduction: revisedReplay.reproduction,
    candidateSummary: revisedRows,
    ranking: revisedReplay.ranking,
  },
  conclusion: {
    originalStep03Reproduced: false,
    revisedGeneratorReproducedNoBrake: revisedReplay.reproduction.noBrakeReproducesLeak,
    revisedGeneratorReproducedProductBrake: revisedReplay.reproduction.productBrakeReproducesLeak,
    next: "Use revised abrupt-stop family in dataset/loss design, then validate against real traces and holdout synthetic scenarios.",
  },
};
fs.writeFileSync(path.join(step04b, "scores.json"), JSON.stringify(step04bScores, null, 2) + "\n");

const selected = revisedReplay.candidates.distilled_mlp_lag0_offset_minus4_post_stop_brake;
const noBrake = revisedReplay.candidates.distilled_mlp_lag0_offset_minus4;
const datasetLossScores = {
  schemaVersion: "cursor-prediction-v19-step-05-dataset-loss-design/1",
  generatedAtUtc: new Date().toISOString(),
  reproductionBasis: {
    originalStep03ScenarioPath: original.inputs.ScenarioPath,
    revisedStep04bScenarioPath: revisedReplay.inputs.ScenarioPath,
    revisedProductBrakePeakLeadMax: selected.eventMetrics.peakLead.max,
    revisedProductBrakeOtrGt1: selected.eventMetrics.overshootThenReturnRateGt1,
    revisedNoBrakeOtrGt1: noBrake.eventMetrics.overshootThenReturnRateGt1,
  },
  proposedDatasets: {
    real60HzLatest: {
      include: true,
      source: "latest cursor-mirror-motion-recording ZIPs used by v18/v19 Step 01",
      splitUnit: "file/package",
      role: "anchor real runtime timing and prevent synthetic overfit",
    },
    motionLabStep03Original: {
      include: true,
      splitUnit: "scenario family",
      role: "negative/coverage set; does not reproduce event leak but covers smooth holds",
    },
    motionLabStep04bRevised: {
      include: true,
      splitUnit: "scenario id and family",
      role: "positive abrupt-stop reproduction set",
    },
    futureCalibratorLoadData: {
      includeIfAvailable: true,
      splitUnit: "recording session",
      role: "load/no-load and display phase validation",
    },
  },
  proposedSplits: {
    train: 0.70,
    validation: 0.15,
    test: 0.15,
    leakageRule: "Split by file/session/scenario id; keep variants of the same generated stop family out of opposite splits when measuring generalization.",
    syntheticHoldout: "Reserve at least one high-speed, one near-zero-creep, one curved, and one phase-crossing family entirely for test.",
  },
  lossDesign: {
    runtimeInputsOnly: [
      "recent positions/timestamps",
      "target horizon",
      "path efficiency",
      "recent velocity windows",
    ],
    trainingEvaluationOnly: [
      "future current position labels",
      "stop event windows",
      "peakLead over post-stop windows",
      "returnMotion after peak",
      "overshootThenReturn event labels",
    ],
    objectiveTerms: [
      { name: "normalVisualHuber", weightHint: 1.0, target: "candidate shifted target visual error", appliesTo: "all non-stop rows" },
      { name: "eventPeakLeadHinge", weightHint: 3.0, target: "max lead over stop window above 0.25/0.5px", appliesTo: "stop events" },
      { name: "returnMotionPenalty", weightHint: 2.0, target: "distance returned after overshoot peak", appliesTo: "overshootThenReturn events" },
      { name: "stationaryJitterPenalty", weightHint: 1.5, target: "mirror-current distance during hold/static windows", appliesTo: "static/post-stop rows" },
      { name: "normalLatencyGuard", weightHint: 0.75, target: "avoid signed lag drift in normal/high-speed movement", appliesTo: "normal and high-speed rows" },
    ],
  },
  evaluationMetrics: [
    "overall MAE/RMSE/p95/p99",
    "event count",
    "peakLead p95/p99/max",
    "overshootThenReturn >0.5/>1/>2px",
    "returnMotion p95/p99/max",
    "settleFrames/settleMs",
    "stationary jitter p95/p99",
    "normalMove/highSpeed visual p95/p99 guardrails",
    "runtime microseconds per prediction",
  ],
  nextImplementationOptions: [
    "Train high-accuracy temporal teacher with event-window penalties, then distill to small MLP/FSMN.",
    "Search rule-hybrid brake features using Step04b positive set plus real traces as guardrails.",
    "Add data logging fields for exact stop-onset runtime state if product-brake leakage cannot be explained from existing traces.",
  ],
};

fs.writeFileSync(path.join(step05, "scores.json"), JSON.stringify(datasetLossScores, null, 2) + "\n");
fs.writeFileSync(path.join(step05, "notes.md"), `# Step 05 Notes: Dataset and Loss Design

Step 05 is design-only. No GPU training was run.

Because Step 04b reproduced the leak, the next dataset should mix real 60Hz traces with synthetic abrupt-stop positives. Splits must be file/session/scenario-level to avoid leakage.

Training losses can use future labels and event-window labels, but runtime candidates must only use current/past samples and DWM target timing.
`);

fs.writeFileSync(path.join(step05, "report.md"), `# Step 05 Report: Dataset and Loss Design

## Basis

Step 04b reproduced the abrupt-stop overshoot/return leak in product-equivalent C# replay:

- Product-brake peakLead max: ${n(selected.eventMetrics.peakLead.max)} px
- Product-brake OTR >1px: ${n(selected.eventMetrics.overshootThenReturnRateGt1 * 100, 2)}%
- No-brake OTR >1px: ${n(noBrake.eventMetrics.overshootThenReturnRateGt1 * 100, 2)}%

## Dataset Plan

- Include latest real 60Hz cursor trace ZIPs as the primary timing anchor.
- Include Step 03 original MotionLab set as non-reproducing coverage.
- Include Step 04b revised MotionLab set as positive abrupt-stop reproduction.
- Add calibrator/load-generator data when format-compatible.
- Split by file/session/scenario id, not by row.
- Reserve full synthetic families for test to measure generalization.

## Loss Plan

- Normal movement: Huber/MAE on shifted visual target.
- Stop events: peakLead hinge penalty over post-stop windows.
- Return behavior: returnMotion penalty after overshoot peak.
- Static/hold: stationary jitter penalty.
- Guardrail: signed-lag and high-speed p95/p99 penalties to avoid making normal cursor motion feel late.

## Runtime Boundary

Event-window labels and future current positions are allowed for training/evaluation only. Runtime candidates must remain CPU-only and use only recent samples, horizon, velocity windows, path efficiency, and small branch/state features.
`);

const logPath = path.join(root, "experiment-log.md");
fs.appendFileSync(logPath, `

## Step 04 - Reproduction

- Ran C# product-equivalent replay over Step 03 MotionLab abrupt-stop scenarios.
- Result: original Step 03 set produced zero detected stop events; no event-window leak reproduced.
- Revised generator in Step 04b with high-speed, narrow-decel, phase, stale/missed-poll, near-zero-creep, and curved families.
- Step 04b result: no-brake and current product post-stop brake both reproduce abrupt-stop event-window overshoot/return.
- Product-brake revised metrics: peakLead max ${n(selected.eventMetrics.peakLead.max)} px, OTR >1px ${n(selected.eventMetrics.overshootThenReturnRateGt1 * 100, 2)}%, returnMotion max ${n(selected.eventMetrics.returnMotion.max)} px.

## Step 05 - Dataset/Loss Design

- Created design-only dataset/loss plan using real 60Hz traces plus Step 03 coverage and Step 04b positive abrupt-stop families.
- No GPU training run in this step.
`);

const readmePath = path.join(root, "README.md");
let readme = fs.readFileSync(readmePath, "utf8");
readme += `

## Step 04-05 Update

Step 04 showed the original Step 03 scenarios were too gentle: zero stop events were detected by the Step 01 event-window predicate. Step 04b revised the generator and reproduced the leak in product-equivalent C# replay, including with current product post-stop brake enabled.

Current Step 04b product-brake stress score: peakLead max ${n(selected.eventMetrics.peakLead.max)} px, OTR >1px ${n(selected.eventMetrics.overshootThenReturnRateGt1 * 100, 2)}%, returnMotion max ${n(selected.eventMetrics.returnMotion.max)} px.

Step 05 is a design-only dataset/loss plan. Next work should train/search against real 60Hz traces plus the revised abrupt-stop positive family, with file/scenario-level holdouts.
`;
fs.writeFileSync(readmePath, readme);

console.log("wrote Step 04, Step 04b, and Step 05 reports");
