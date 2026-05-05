const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step = path.join(root, "step-06-latch-fire-rate-refinement");
const rawPath = path.join(step, "latch-refinement-output.json");
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));

function round(value, digits = 6) {
  return typeof value === "number" ? Number(value.toFixed(digits)) : value;
}

function stats(s) {
  return {
    mean: round(s.mean),
    p50: round(s.p50),
    p95: round(s.p95),
    p99: round(s.p99),
    max: round(s.max),
  };
}

function rowStats(s) {
  return {
    mean: round(s.mean),
    p95: round(s.p95),
    p99: round(s.p99),
    max: round(s.max),
  };
}

function brief(id) {
  const c = raw.candidates[id];
  return {
    id,
    candidate: c.candidate,
    eventMetrics: {
      count: c.eventMetrics.count,
      peakLead: stats(c.eventMetrics.peakLead),
      peakDistance: stats(c.eventMetrics.peakDistance),
      returnMotion: stats(c.eventMetrics.returnMotion),
      settleFrames0p5: stats(c.eventMetrics.settleFrames0p5),
      settleFrames1p0: stats(c.eventMetrics.settleFrames1p0),
      overshootThenReturnRateGt0p5: round(c.eventMetrics.overshootThenReturnRateGt0p5),
      overshootThenReturnRateGt1: round(c.eventMetrics.overshootThenReturnRateGt1),
      leadGt1: round(c.eventMetrics.leadGt1),
      leadGt2: round(c.eventMetrics.leadGt2),
      distanceGt2: round(c.eventMetrics.distanceGt2),
      gateFireRateInWindows: round(c.eventMetrics.gateFireRateInWindows),
      examples: c.eventMetrics.examples.slice(0, 8),
    },
    guardrails: {
      normalMoveVisual: rowStats(c.rowMetrics.normalMove.visualError),
      highSpeedVisual: rowStats(c.rowMetrics.highSpeed.visualError),
      staticCurrentDistance: rowStats(c.rowMetrics.staticHold.currentDistance),
      postStopJitter: rowStats(c.rowMetrics.postStopFirstFrames.currentDistance),
    },
    gateFire: c.gateFire,
    fireClassification: c.fireClassification,
    objective: c.objective,
  };
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function pct(value) {
  return `${round(value * 100, 3)}%`;
}

function scoreRow(id) {
  const c = raw.candidates[id];
  return [
    id,
    round(c.eventMetrics.peakLead.p99, 3),
    round(c.eventMetrics.peakLead.max, 3),
    round(c.eventMetrics.peakDistance.max, 3),
    round(c.eventMetrics.returnMotion.max, 3),
    pct(c.eventMetrics.overshootThenReturnRateGt1),
    pct(c.gateFire.overall),
    pct(c.gateFire.normalMove),
    pct(c.fireClassification.normalMoveFireLooksStopSoonRate),
  ];
}

function guardRow(id) {
  const c = raw.candidates[id];
  return [
    id,
    round(c.rowMetrics.normalMove.visualError.p95, 3),
    round(c.rowMetrics.normalMove.visualError.p99, 3),
    round(c.rowMetrics.highSpeed.visualError.p95, 3),
    round(c.rowMetrics.staticHold.currentDistance.p95, 3),
    c.gateFire.movementResumeFalseSnapRows,
  ];
}

function compactRanking(filter) {
  return raw.ranking
    .filter((r) => filter(raw.candidates[r.id]))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      score: r.score,
      event: {
        peakLeadP99: round(raw.candidates[r.id].eventMetrics.peakLead.p99),
        peakLeadMax: round(raw.candidates[r.id].eventMetrics.peakLead.max),
        peakDistanceMax: round(raw.candidates[r.id].eventMetrics.peakDistance.max),
        returnMotionMax: round(raw.candidates[r.id].eventMetrics.returnMotion.max),
        otrGt1: round(raw.candidates[r.id].eventMetrics.overshootThenReturnRateGt1),
      },
      fire: {
        overall: round(raw.candidates[r.id].gateFire.overall),
        normalMove: round(raw.candidates[r.id].gateFire.normalMove),
        highSpeed: round(raw.candidates[r.id].gateFire.highSpeed),
        stopSoonRate: round(raw.candidates[r.id].fireClassification.normalMoveFireLooksStopSoonRate),
      },
    }));
}

const baselineId = "none";
const step05Id = "step05_best_latchN10_v20_h400_td0p25";
const selectedId = raw.selected;
const comparisonIds = [
  baselineId,
  "step04_oneFrameStopSnap_v20_h400_td0p25",
  step05Id,
  selectedId,
  "sustainedStopN10_c2_h400_td0p25",
  "targetAndCurrentZeroN10_ld0p25_h400_td0p25",
  "distanceCapN10_cap0p25_ld0p25_h400",
].filter((id, index, arr) => raw.candidates[id] && arr.indexOf(id) === index);

const compared = Object.fromEntries(comparisonIds.map((id) => [id, brief(id)]));
const selected = raw.candidates[selectedId];
const baselineRows = raw.candidates[baselineId].rowMetrics;
const datasetSummary = {
  replayRows: raw.candidates[baselineId].rows,
  sourceZipsReadInPlace: [
    "cursor-mirror-motion-recording-20260504-070248.zip",
    "cursor-mirror-motion-recording-20260504-070307.zip",
  ],
  sliceCounts: Object.fromEntries(Object.entries(baselineRows).map(([key, value]) => [key, value.count])),
};

const scores = {
  schemaVersion: "cursor-prediction-v18-step-06-latch-fire-rate-refinement/1",
  generatedAtUtc: new Date().toISOString(),
  source: path.relative(root, rawPath).replaceAll("\\", "/"),
  rawOutputDeletedAfterSummary: true,
  harness: {
    kind: "C# chronological replay output summarized without re-running replay",
    productSourceModified: false,
    baseline: raw.baseline,
    lagConst: raw.lagConst,
    candidateCount: raw.candidateCount,
  },
  datasetSummary,
  selectedCandidate: selectedId,
  baselineCandidate: baselineId,
  step05BestCandidate: step05Id,
  comparedCandidates: compared,
  topRanking: raw.ranking.slice(0, 50).map((r) => ({
    id: r.id,
    score: r.score,
    event: {
      peakLeadP99: round(raw.candidates[r.id].eventMetrics.peakLead.p99),
      peakLeadMax: round(raw.candidates[r.id].eventMetrics.peakLead.max),
      peakDistanceMax: round(raw.candidates[r.id].eventMetrics.peakDistance.max),
      returnMotionMax: round(raw.candidates[r.id].eventMetrics.returnMotion.max),
      otrGt1: round(raw.candidates[r.id].eventMetrics.overshootThenReturnRateGt1),
    },
    fire: {
      overall: round(raw.candidates[r.id].gateFire.overall),
      normalMove: round(raw.candidates[r.id].gateFire.normalMove),
      highSpeed: round(raw.candidates[r.id].gateFire.highSpeed),
      stopSoonRate: round(raw.candidates[r.id].fireClassification.normalMoveFireLooksStopSoonRate),
    },
  })),
  lowFireTradeoffRanking: compactRanking((c) => c.gateFire.normalMove < 0.05),
  zeroTailRanking: compactRanking((c) => c.eventMetrics.peakLead.max <= 0.5 && c.eventMetrics.peakDistance.max <= 0.5 && c.eventMetrics.returnMotion.max <= 0.5),
  normalMoveFireInterpretation: {
    selectedNormalMoveFireRate: round(selected.gateFire.normalMove),
    selectedNormalMoveFireLooksStopSoonRate: round(selected.fireClassification.normalMoveFireLooksStopSoonRate),
    selectedNormalMoveFiredStats: selected.fireClassification.normalMoveFired,
    interpretation:
      "Selected still fires on 21.66% of normalMove rows, but about 99.46% of those fired rows are followed by stop/near-stop within 10 frames. This suggests most normalMove firings are stop-prep/hold rows rather than ordinary continuous motion, but live validation is still required.",
  },
  adoptionDecision: {
    recommendation:
      "Do not ship directly. Selected is a validation-flag candidate because it preserves zero event tail while only slightly lowering fire rate versus Step05 best; normalMove fire remains high by slice label.",
    productCandidate:
      "baseLatchN10_v0_h400_td0p1_rv50_rt0p25",
    runtimeShape:
      "snap for up to 10 frames after stop onset: v2 <= 0px/s, target displacement <= 0.1px, recentHigh >= 400px/s; release when v2 > 50px/s or target displacement > 0.25px.",
  },
};

fs.writeFileSync(path.join(step, "scores.json"), JSON.stringify(scores, null, 2) + "\n");

const notes = `# Step 06 Notes: Latch Fire-Rate Refinement

This step summarizes the existing C# replay output only. The C# replay was not re-run while producing these notes.

## Goal

Step 05 eliminated event-window overshoot/return tail, but its best latch fired on 2.88% overall and 22.21% of normalMove rows. Step 06 searched around that latch to reduce fire rate while keeping event max <= 0.5px where possible.

## Added Refinement Signals

- tighter target displacement thresholds: 0.1/0.25/0.5 px
- tighter v2 thresholds: 0/10/20/50 px/s
- release thresholds: v2 50/100/150 and target 0.25/0.5/0.75/1.0 px
- sustained stop frames: 1/2/3
- latest current delta thresholds for target+current zero
- path efficiency filters
- distance cap variants

## Interpretation Rule

normalMove fire is classified by whether a stop/near-stop follows within 10 frames. This is not an oracle used by the gate; it is diagnostic only.
`;
fs.writeFileSync(path.join(step, "notes.md"), notes);

const report = `# Step 06 Report: Latch Fire-Rate Refinement

## Selected

Selected candidate: \`${selectedId}\`.

${mdTable(
  ["candidate", "peakLead p99", "peakLead max", "peakDist max", "return max", "OTR >1", "overall fire", "normal fire", "normal fire stop-soon"],
  comparisonIds.map(scoreRow)
)}

## Guardrails

${mdTable(
  ["candidate", "normal p95", "normal p99", "high p95", "static jitter p95", "false resume rows"],
  comparisonIds.map(guardRow)
)}

## NormalMove Fire Classification

The selected candidate still fires on \`${pct(selected.gateFire.normalMove)}\` of normalMove rows. However, \`${pct(selected.fireClassification.normalMoveFireLooksStopSoonRate)}\` of those fired normalMove rows are followed by stop/near-stop within 10 frames. In other words, most of the apparent normalMove fire looks like stop-prep/hold behavior under this replay definition, not ordinary continuous movement.

That lowers concern, but it does not eliminate it. The slice label and the user-visible experience can diverge, so product-side live logging or a validation flag is still needed before broad rollout.

## Tradeoff

The selected candidate preserves the Step 05 zero-tail result:

- event \`peakLead p99/max = 0/0px\`
- event \`peakDistance max = 0px\`
- event \`returnMotion max = 0px\`
- \`overshootThenReturn >1px = 0%\`

Fire rate improves only slightly versus Step 05 best:

- Step 05 best overall fire: \`${pct(raw.candidates[step05Id].gateFire.overall)}\`
- Step 06 selected overall fire: \`${pct(selected.gateFire.overall)}\`
- Step 05 best normalMove fire: \`${pct(raw.candidates[step05Id].gateFire.normalMove)}\`
- Step 06 selected normalMove fire: \`${pct(selected.gateFire.normalMove)}\`

Low-fire candidates below 5% normalMove fire exist, but they leave the max event tail around the Step 04/Step 05 failure level. Under the current available runtime signals, keeping event max <= 0.5px appears to require a latch that still fires in many rows labeled normalMove.

## Product Decision

Do not put this directly into product as default behavior. The best next candidate is \`${selectedId}\` behind a validation flag or product-side chronological replay:

- stop onset: \`v2 <= 0px/s\`
- target displacement: \`<= 0.1px\`
- recentHigh: \`>= 400px/s\`
- action: snap to current for up to 10 frames
- release: \`v2 > 50px/s\` or target displacement \`> 0.25px\`

Next validation should log actual trigger rows, stop-soon classification, release reason, and mirror/current positions in the user environment.
`;
fs.writeFileSync(path.join(step, "report.md"), report);

const logPath = path.join(root, "experiment-log.md");
let log = fs.readFileSync(logPath, "utf8");
const marker = "Completed Step 06 latch fire-rate refinement";
if (!log.includes(marker)) {
  log += `
- ${marker} from existing \`latch-refinement-output.json\` without re-running C# replay.
- Selected \`${selectedId}\`: event tail remains zero, overall fire is ${pct(selected.gateFire.overall)}, normalMove fire is ${pct(selected.gateFire.normalMove)}, and ${pct(selected.fireClassification.normalMoveFireLooksStopSoonRate)} of fired normalMove rows are followed by stop/near-stop within 10 frames.
- Adoption remains validation-flag only; product default needs live logging/product replay due to high normalMove fire label.
`;
  fs.writeFileSync(logPath, log);
}

console.log(`wrote Step 06 reports; selected=${selectedId}`);
