const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step03 = path.join(root, "step-03-tail-classification");
const step04 = path.join(root, "step-04-brake-gate-search");
const rawPath = path.join(step04, "brake-gate-output.json");
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function round(value, digits = 6) {
  return typeof value === "number" ? Number(value.toFixed(digits)) : value;
}

function compactStats(stats) {
  if (!stats) return null;
  return {
    mean: round(stats.mean),
    p50: round(stats.p50),
    p95: round(stats.p95),
    p99: round(stats.p99),
    max: round(stats.max),
  };
}

function rateStats(metrics) {
  return {
    rateGt0p5: round(metrics.overshootThenReturnRateGt0p5),
    rateGt1: round(metrics.overshootThenReturnRateGt1),
    rateGt2: round(metrics.overshootThenReturnRateGt2),
  };
}

function eventBrief(candidate) {
  const e = candidate.eventMetrics;
  return {
    count: e.count,
    peakLead: compactStats(e.peakLead),
    peakDistance: compactStats(e.peakDistance),
    returnMotion: compactStats(e.returnMotion),
    settleFrames0p5: compactStats(e.settleFrames0p5),
    settleFrames1p0: compactStats(e.settleFrames1p0),
    overshootThenReturnRate: rateStats(e),
    gateFireRateInWindows: round(e.gateFireRateInWindows),
  };
}

function rowGuardrails(candidate) {
  const r = candidate.rowMetrics;
  return {
    normalMoveVisualP95: round(r.normalMove.visualError.p95),
    normalMoveVisualP99: round(r.normalMove.visualError.p99),
    highSpeedVisualP95: round(r.highSpeed.visualError.p95),
    highSpeedVisualP99: round(r.highSpeed.visualError.p99),
    postStopJitterP95: round(r.postStopFirstFrames.currentDistance.p95),
    postStopJitterP99: round(r.postStopFirstFrames.currentDistance.p99),
    acuteStopCurrentOvershootMax: round(Math.max(
      r.fastThenNearZero.currentOvershoot.max,
      r.hardBrake.currentOvershoot.max,
      r.stopAfterHighSpeed.currentOvershoot.max,
      r.oneFrameStop.currentOvershoot.max,
      r.postStopFirstFrames.currentOvershoot.max
    )),
  };
}

function candidateBrief(id) {
  const c = raw.candidates[id];
  return {
    id,
    candidate: c.candidate,
    objective: c.objective,
    eventMetrics: eventBrief(c),
    rowGuardrails: rowGuardrails(c),
    gateFire: c.gateFire,
  };
}

function mdTable(headers, rows) {
  const header = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return `${header}\n${sep}\n${body}`;
}

function eventRow(id) {
  const c = raw.candidates[id];
  const e = c.eventMetrics;
  return [
    id,
    e.count,
    round(e.peakLead.p99, 3),
    round(e.peakLead.max, 3),
    round(e.peakDistance.p99, 3),
    round(e.returnMotion.max, 3),
    round(e.overshootThenReturnRateGt1 * 100, 3) + "%",
    round(e.gateFireRateInWindows * 100, 2) + "%",
    round(c.gateFire.overall * 100, 2) + "%",
  ];
}

function tailExampleRow(example) {
  return [
    example.PackageId,
    round(example.StopElapsedMs, 3),
    example.Phase,
    example.PeakFrame,
    round(example.PreMaxSpeed, 1),
    round(example.V2AtStop, 1),
    round(example.V5AtStop, 1),
    round(example.V12AtStop, 1),
    round(example.TargetDistanceAtStop, 3),
    round(example.PeakLeadPx, 3),
    round(example.PeakDistancePx, 3),
    round(example.ReturnMotionPx, 3),
    example.OvershootThenReturn ? "yes" : "no",
  ];
}

const baselineId = "none";
const selectedId = raw.selected;
const baselineRows = raw.candidates[baselineId].rowMetrics;
const datasetSummary = {
  replayRows: raw.candidates[baselineId].rows,
  sourceZipsReadInPlace: [
    "cursor-mirror-motion-recording-20260504-070248.zip",
    "cursor-mirror-motion-recording-20260504-070307.zip",
  ],
  sliceCounts: Object.fromEntries(Object.entries(baselineRows).map(([key, value]) => [key, value.count])),
};
const compareIds = [
  baselineId,
  selectedId,
  "hardBrakeCap_h800_cap0p5",
  "postStopOneFrameLatch_td0p5",
  "nearZeroTargetSnap_h400_td0p25",
].filter((id, ix, arr) => raw.candidates[id] && arr.indexOf(id) === ix);

mkdirp(step03);
mkdirp(step04);

const step03Scores = {
  schemaVersion: "cursor-prediction-v18-step-03-event-window-classification/1",
  generatedAtUtc: new Date().toISOString(),
  source: path.relative(root, rawPath).replaceAll("\\", "/"),
  baselineCandidate: baselineId,
  datasetSummary,
  eventWindowDefinition: {
    preFrames: raw.candidates[baselineId].eventMetrics.preFrames,
    postFrames: raw.candidates[baselineId].eventMetrics.postFrames,
    stopEventRule: {
      description: "near-stop transition after recent motion",
      nearStop: "v2 <= 100 px/s and targetDistance <= 0.75 px",
      priorState: "previous row in package is not near-stop",
      preMotion: "max v12 over previous 6 rows >= 500 px/s",
      direction: "direction of the highest-v12 row in the pre window",
    },
    primaryMetrics: [
      "peakLeadPx",
      "peakDistancePx",
      "settleFrames/settleMs",
      "returnMotionPx",
      "overshootThenReturnRate",
    ],
  },
  baselineEventMetrics: eventBrief(raw.candidates[baselineId]),
  rowMetricsDemotedToSecondary: {
    reason: "single-frame current-position overshoot misses stop-window peaks and return motion",
    guardrails: rowGuardrails(raw.candidates[baselineId]),
  },
  tailRowsSummary: raw.candidates[baselineId].eventMetrics.examples,
  interpretation: {
    whyStep02Underestimated:
      "Step 02 counted per-row current overshoot. Event replay shows some peaks occur several frames after the detected stop, including peakFrame 8/10 cases; the visible problem is the peak followed by return, not only the row where stop is detected.",
    baselineFinding:
      "lag0 offset -4ms is still strong in p95, but event p99/max reveals stop-window tail: peakLead p99 1.517px, max 2.441px, and overshoot-then-return >1px rate 1.124%.",
    likelyCause:
      "Recent-motion features remain high after current/target displacement has dropped to near zero, so the distilled model can emit residual forward displacement for one or more frames. The largest event is postStopFirstFrames, not the single one-frame-stop row from Step 02.",
  },
};

fs.writeFileSync(path.join(step03, "scores.json"), JSON.stringify(step03Scores, null, 2) + "\n");

const step03Notes = `# Step 03 Notes: Event-Window Tail Classification

This step supersedes the earlier single-row tail classification. The user-visible issue is an event: after a fast or medium movement stops, the mirror can continue forward, peak ahead of the real cursor, and then return.

## Stop Event Definition

- Candidate row is near stop: \`v2 <= 100 px/s\` and target displacement \`<= 0.75 px\`.
- Previous row in the same package is not near stop.
- The previous 6 rows contain recent motion: max \`v12 >= 500 px/s\`.
- Event window: 6 frames before stop and 10 frames after stop.
- Motion direction: direction of the highest-\`v12\` row in the pre-window.

## Primary Event Metrics

- \`peakLeadPx\`: maximum mirror-current displacement along the pre-stop direction in the post-stop window.
- \`peakDistancePx\`: maximum Euclidean mirror-current distance in the post-stop window.
- \`settleFrames0p5\` / \`settleFrames1p0\`: frames after peak until current distance drops below the threshold.
- \`returnMotionPx\`: peak distance minus the smallest later distance in the window.
- \`overshootThenReturnRate\`: event rate where peak lead exceeds a threshold and the later frames return toward current.

Per-row current overshoot is retained as a secondary guardrail only.
`;
fs.writeFileSync(path.join(step03, "notes.md"), step03Notes);

const step03Report = `# Step 03 Report: Event-Window Tail Classification

## Baseline

Baseline is \`lag0 offset -4ms\` from the Step 02 C# chronological replay.

${mdTable(
  ["candidate", "events", "peakLead p99", "peakLead max", "peakDistance p99", "return max", "OTR >1", "window fire", "overall fire"],
  [eventRow(baselineId)]
)}

## Representative Event Tail

${mdTable(
  ["package", "stop ms", "phase", "peak frame", "preMax", "v2", "v5", "v12", "target", "peakLead", "peakDist", "return", "OTR"],
  raw.candidates[baselineId].eventMetrics.examples.slice(0, 5).map(tailExampleRow)
)}

## Interpretation

The earlier Step 02 per-row metric understated the visual issue because it measured each row independently. In the largest tail, the peak is not the initial stop row: the event reaches \`2.441px\` lead at \`peakFrame 8\`, then returns by about \`2.491px\`. That sequence matches the user report more closely than a single-frame current-position overshoot.

The tail is sparse but real: p95 is still zero, while p99/max expose the problem. The largest case is classified as \`postStopFirstFrames\`; the one-frame-stop residual is important but not the only failure mode.
`;
fs.writeFileSync(path.join(step03, "report.md"), step03Report);

const compactCandidates = {};
for (const [id, candidate] of Object.entries(raw.candidates)) {
  compactCandidates[id] = {
    candidate: candidate.candidate,
    eventMetrics: eventBrief(candidate),
    rowGuardrails: rowGuardrails(candidate),
    gateFire: candidate.gateFire,
    objective: candidate.objective,
  };
}

const step04Scores = {
  schemaVersion: "cursor-prediction-v18-step-04-event-level-brake-gate-search/1",
  generatedAtUtc: new Date().toISOString(),
  source: path.relative(root, rawPath).replaceAll("\\", "/"),
  harness: {
    kind: "C# chronological replay with POC-only brake gate overlay",
    productSourceModified: false,
    baseline: raw.baseline,
    lagConst: raw.lagConst,
  },
  datasetSummary,
  eventWindowDefinition: step03Scores.eventWindowDefinition,
  selectedCandidate: selectedId,
  baselineCandidate: baselineId,
  ranking: raw.ranking,
  comparedCandidates: Object.fromEntries(compareIds.map((id) => [id, candidateBrief(id)])),
  candidates: compactCandidates,
  conclusion: {
    recommendation:
      "oneFrameStopSnap_v20_h400_td0p25 is the best narrow validation branch for event p99 and overshoot-then-return rate, but it does not remove the max postStopFirstFrames event; do not treat it as a final product fix without the next validation.",
    productShape:
      "allocation-free scalar branch: if v2 is zero/near-zero, target displacement <= 0.25px, and recent high speed >= 400 px/s, snap prediction to current for that frame.",
    caveat:
      "The selected branch reduces p99 but leaves the largest post-stop event unchanged. A postStopFirstFrames-specific guard or runtime timing verification is still needed.",
  },
};
fs.writeFileSync(path.join(step04, "scores.json"), JSON.stringify(step04Scores, null, 2) + "\n");

const step04Notes = `# Step 04 Notes: Event-Level Brake Gate Search

The search uses the Step 02 C# chronological replay baseline \`lag0 offset -4ms\` and applies POC-only brake gates in the harness. Product source files are not modified.

## Evaluated Gate Families

- \`none\`: baseline.
- \`oneFrameStopSnap\`: snap to current when the newest motion and target are near zero after recent movement.
- \`nearZeroTargetSnap\`: broader snap on near-zero target after recent movement.
- \`hardBrakeCap\`: cap predicted displacement magnitude during hard brake.
- \`brakeGainScale\`: scale predicted displacement during brake confidence.
- \`postStopOneFrameLatch\`: one-frame hold after stop detection.
- \`alongOnlyBrake\`: reduce only the forward component along recent motion.

## Ranking Objective

Primary ranking minimizes event-window \`peakLead\`, \`peakDistance\`, \`returnMotion\`, and overshoot-then-return rate. Normal-move and high-speed visual p95/p99 plus gate fire rate are guardrails.
`;
fs.writeFileSync(path.join(step04, "notes.md"), step04Notes);

const step04Report = `# Step 04 Report: Event-Level Brake Gate Search

## Top Result

Selected candidate: \`${selectedId}\`.

${mdTable(
  ["candidate", "events", "peakLead p99", "peakLead max", "peakDistance p99", "return max", "OTR >1", "window fire", "overall fire"],
  compareIds.map(eventRow)
)}

## Guardrails

${mdTable(
  ["candidate", "normal visual p95", "high visual p95", "post-stop jitter p95", "acute row max"],
  compareIds.map((id) => {
    const g = rowGuardrails(raw.candidates[id]);
    return [
      id,
      round(g.normalMoveVisualP95, 3),
      round(g.highSpeedVisualP95, 3),
      round(g.postStopJitterP95, 3),
      round(g.acuteStopCurrentOvershootMax, 3),
    ];
  })
)}

## Interpretation

\`${selectedId}\` sharply reduces event p99: baseline peakLead p99 is \`${round(raw.candidates[baselineId].eventMetrics.peakLead.p99, 3)}px\`, selected p99 is \`${round(raw.candidates[selectedId].eventMetrics.peakLead.p99, 3)}px\`. It also reduces overshoot-then-return >1px rate from \`${round(raw.candidates[baselineId].eventMetrics.overshootThenReturnRateGt1 * 100, 3)}%\` to \`${round(raw.candidates[selectedId].eventMetrics.overshootThenReturnRateGt1 * 100, 3)}%\`.

However, the max event remains \`${round(raw.candidates[selectedId].eventMetrics.peakLead.max, 3)}px\`, because the worst tail is classified as \`postStopFirstFrames\`, not the narrow one-frame stop case. Broad gates such as \`nearZeroTargetSnap\` are not attractive because they fire much more often, including normal/high-speed slices.

## Adoption Decision

Do not ship a broad brake gate from this step. The best small branch to validate next is \`${selectedId}\`: snap to current only when \`v2 == 0\`, target displacement \`<= 0.25px\`, and recent speed \`>= 400 px/s\`. It is allocation-free and leaves row-level normal/high-speed p95 unchanged in this replay, but it is not a complete fix because the largest post-stop return tail remains.
`;
fs.writeFileSync(path.join(step04, "report.md"), step04Report);

const logPath = path.join(root, "experiment-log.md");
const marker = "Redefined Step 03/04 around event-window overshoot";
let log = fs.readFileSync(logPath, "utf8");
if (!log.includes(marker)) {
  log += `
- User clarified that the visible failure is not a single-frame current-position overshoot but a stop-event sequence: mirror leads after stop, then returns.
- ${marker}: stop events use a 6-frame pre-window and 10-frame post-window, with peakLead/peakDistance/settle/returnMotion/overshootThenReturn as primary metrics.
- Ran Step 04 C# replay brake-gate search with event-level scoring. Best narrow candidate is \`${selectedId}\`; it reduces event p99 but leaves the max postStopFirstFrames event, so broad adoption is not yet recommended.
`;
  fs.writeFileSync(logPath, log);
}

console.log(`wrote Step 03/04 event reports; selected=${selectedId}`);
