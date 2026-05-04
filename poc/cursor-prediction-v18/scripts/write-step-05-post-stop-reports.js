const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step = path.join(root, "step-05-post-stop-latch-search");
const rawPath = path.join(step, "post-stop-latch-output.json");
const step04ScoresPath = path.join(root, "step-04-brake-gate-search", "scores.json");
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const step04Scores = fs.existsSync(step04ScoresPath)
  ? JSON.parse(fs.readFileSync(step04ScoresPath, "utf8"))
  : null;

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

function briefCandidate(id) {
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
    },
    guardrails: {
      normalMoveVisual: rowStats(c.rowMetrics.normalMove.visualError),
      highSpeedVisual: rowStats(c.rowMetrics.highSpeed.visualError),
      staticCurrentDistance: rowStats(c.rowMetrics.staticHold.currentDistance),
      postStopJitter: rowStats(c.rowMetrics.postStopFirstFrames.currentDistance),
    },
    gateFire: c.gateFire,
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

function scoreRow(id) {
  const c = raw.candidates[id];
  return [
    id,
    c.eventMetrics.count,
    round(c.eventMetrics.peakLead.p99, 3),
    round(c.eventMetrics.peakLead.max, 3),
    round(c.eventMetrics.peakDistance.max, 3),
    round(c.eventMetrics.returnMotion.max, 3),
    round(c.eventMetrics.overshootThenReturnRateGt1 * 100, 3) + "%",
    round(c.gateFire.overall * 100, 2) + "%",
    round(c.gateFire.normalMove * 100, 2) + "%",
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
    round(c.gateFire.movementResumeFalseSnapRows, 0),
  ];
}

const baselineId = "none";
const step04Id = "step04_oneFrameStopSnap_v20_h400_td0p25";
const selectedId = raw.selected;
const comparisonIds = [
  baselineId,
  step04Id,
  selectedId,
  "oneFramePlus_postStopLatchN_N6_td0p25",
  "postStopCurrentDistanceCapN10_cap0_v20_h400_td0p25",
  "postStopDecayN12_s0_v20_h400_td0p25",
  "postStopDirectionClampN10_cap0p25_h600",
].filter((id, index, arr) => raw.candidates[id] && arr.indexOf(id) === index);

const candidateBriefs = {};
for (const id of Object.keys(raw.candidates)) {
  candidateBriefs[id] = briefCandidate(id);
}

const datasetSummary = {
  replayRows: raw.candidates[baselineId].rows,
  sourceZipsReadInPlace: [
    "cursor-mirror-motion-recording-20260504-070248.zip",
    "cursor-mirror-motion-recording-20260504-070307.zip",
  ],
  sliceCounts: Object.fromEntries(Object.entries(raw.candidates[baselineId].rowMetrics).map(([key, value]) => [key, value.count])),
};

const scores = {
  schemaVersion: "cursor-prediction-v18-step-05-post-stop-latch-search/1",
  generatedAtUtc: new Date().toISOString(),
  source: path.relative(root, rawPath).replaceAll("\\", "/"),
  harness: {
    kind: "C# chronological replay with POC-only post-stop gate overlay",
    productSourceModified: false,
    baseline: raw.baseline,
    lagConst: raw.lagConst,
    candidateCount: raw.candidateCount,
    recentHighSignal:
      "max(v5, v8, v12, recent segment max over latest 6 samples); added because the worst Step 04 event had high pre-window motion but low v5/v12 at the stop row.",
  },
  datasetSummary,
  selectedCandidate: selectedId,
  baselineCandidate: baselineId,
  step04BestCandidateInStep05Harness: step04Id,
  step04OriginalReference: step04Scores?.comparedCandidates?.oneFrameStopSnap_v20_h400_td0p25 ?? null,
  ranking: raw.ranking,
  comparedCandidates: Object.fromEntries(comparisonIds.map((id) => [id, briefCandidate(id)])),
  candidates: candidateBriefs,
  tailRowsSummary: raw.candidates[baselineId].eventMetrics.examples,
  interpretation: {
    bestFinding:
      "A 10-frame post-stop snap latch with strict stop onset removes peakLead/peakDistance/returnMotion in the detected event windows.",
    bestCandidate:
      "postStopLatchN10_v20_h400_td0p25_rv100_rt0p5",
    caveat:
      "The best candidate fires on 2.88% of all rows and 22.2% of rows classified as normalMove, even though normal/high-speed visual p95 did not regress in this replay. That fire rate is too broad to ship without product-side replay or a narrower runtime signal.",
    runtimeShape:
      "Small stateful branch: detect stop onset with v2 <= 20px/s, target displacement <= 0.25px, recentHigh >= 400px/s; snap to current for up to 10 frames; release when v2 > 100px/s or target displacement > 0.5px.",
    nextNeed:
      "Need a product-side chronological replay or live instrumentation that logs the stop-latch trigger, recentHigh, release reason, and mirror/current positions for the user-visible stop events.",
  },
};

fs.writeFileSync(path.join(step, "scores.json"), JSON.stringify(scores, null, 2) + "\n");

const notes = `# Step 05 Notes: Post-Stop Latch Search

This step extends the Step 04 C# chronological replay harness with POC-only post-stop gates. Product source files are referenced read-only and are not modified.

## Added Runtime-Safe Signal

The Step 04 max event was \`postStopFirstFrames\` with high pre-window motion but low v5/v12 on the stop row. Step 05 therefore uses a lightweight \`recentHigh\` scalar:

\`recentHigh = max(v5, v8, v12, recent segment max over latest 6 samples)\`

This is intended to approximate the event-window \`preMax\` using only runtime history.

## Candidate Families

- \`postStopLatchN\`: snap to current for N frames after stop onset.
- \`postStopDecayN\`: scale prediction displacement during the latch window, then return to normal.
- \`postStopCurrentDistanceCap\`: cap mirror-current distance during the latch window.
- \`oneFramePlus_*\`: Step 04 one-frame snap plus post-stop latch/decay.
- \`postStopDirectionClamp\`: clamp only the forward component along recent motion.

Primary metrics are event-window peakLead, peakDistance, returnMotion, settle frames, and overshootThenReturn rate. Row metrics are guardrails.
`;
fs.writeFileSync(path.join(step, "notes.md"), notes);

const report = `# Step 05 Report: Post-Stop Latch Search

## Result

Selected candidate: \`${selectedId}\`.

${mdTable(
  ["candidate", "events", "peakLead p99", "peakLead max", "peakDistance max", "return max", "OTR >1", "overall fire", "normal fire"],
  comparisonIds.map(scoreRow)
)}

## Guardrails

${mdTable(
  ["candidate", "normal p95", "normal p99", "high p95", "static jitter p95", "false resume rows"],
  comparisonIds.map(guardRow)
)}

## Interpretation

The strict 10-frame post-stop latch removes the detected event-window tail in this replay: peakLead, peakDistance, returnMotion, and overshoot-then-return rate all become zero for the Step 03 event set. This directly addresses the user-visible sequence: overshoot after stop followed by a return.

The important caveat is fire rate. \`${selectedId}\` fires on \`${round(raw.candidates[selectedId].gateFire.overall * 100, 2)}%\` of all rows and \`${round(raw.candidates[selectedId].gateFire.normalMove * 100, 2)}%\` of rows classified as normalMove. Normal/high-speed visual p95 did not regress here, but that many normalMove firings means this should not be shipped blindly.

Compared with Step 04 one-frame snap, the latch is the first candidate to remove the max event. Decay and direction-only clamp are gentler, but leave max tail around 1.4-2.0px. Current-distance cap with cap 0 behaves like snap and has similar caution.

## Product Decision

Best POC candidate for the next validation is:

\`postStopLatchN10_v20_h400_td0p25_rv100_rt0p5\`

Runtime shape:

- stop onset: \`v2 <= 20px/s\`
- target displacement: \`<= 0.25px\`
- recent high speed: \`>= 400px/s\`, where recent high includes a latest-6-sample segment max
- action: snap prediction to current for up to 10 frames
- release: immediately when \`v2 > 100px/s\` or target displacement \`> 0.5px\`

Recommendation: do not put this directly into product as final behavior yet. It is a strong candidate behind a flag or in a product-side replay harness, because it eliminates the event tail but fires broadly enough that user-visible delay risk needs direct validation.
`;
fs.writeFileSync(path.join(step, "report.md"), report);

const logPath = path.join(root, "experiment-log.md");
let log = fs.readFileSync(logPath, "utf8");
const marker = "Ran Step 05 post-stop latch search";
if (!log.includes(marker)) {
  log += `
- ${marker}: C# replay over 546 post-stop latch/decay/cap/direction-clamp candidates.
- Best event candidate is \`${selectedId}\`, which drives event peakLead/peakDistance/returnMotion max to 0 on the detected windows, but fires on 2.88% overall and 22.2% of normalMove rows; treat as a validation candidate, not a final product change.
`;
  fs.writeFileSync(logPath, log);
}

console.log(`wrote Step 05 reports; selected=${selectedId}`);
