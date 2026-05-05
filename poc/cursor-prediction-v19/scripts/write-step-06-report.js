const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step = path.join(root, "step-06-high-accuracy-model-search");
const scores = JSON.parse(fs.readFileSync(path.join(step, "scores.json"), "utf8"));

function n(value, digits = 3) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "0";
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}

function row(id) {
  const c = scores.candidates[id];
  const s = scores.ranking.find((r) => r.id === id)?.score || {};
  return {
    id,
    objective: s.totalObjective,
    peak: c.step04bStress.events.peakLead.max,
    otr: c.step04bStress.events.overshootThenReturnRateGt1,
    ret: c.step04bStress.events.returnMotion.max,
    realP95: c.realHoldout.overall.visual.p95,
    realP99: c.realHoldout.overall.visual.p99,
    jitter: c.realHoldout.overall.stationaryJitter.p95,
  };
}

const rows = scores.ranking.map((r) => row(r.id));
const table = [
  "| candidate | Step04b peakLead max | Step04b OTR >1px | Step04b return max | real holdout p95/p99 | real jitter p95 | objective |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...rows.map((r) => `| ${r.id} | ${n(r.peak)} | ${n(r.otr * 100, 2)}% | ${n(r.ret)} | ${n(r.realP95)}/${n(r.realP99)} | ${n(r.jitter)} | ${n(r.objective, 1)} |`),
].join("\n");

const best = rows[0];
const baseline = row("product_distilled_lag0_offset_minus4_brake");
const peakImprovement = (1 - best.peak / baseline.peak) * 100;
const returnImprovement = (1 - best.ret / baseline.ret) * 100;

fs.writeFileSync(path.join(step, "notes.md"), `# Step 06 Notes: High-Accuracy Model Search

This step used a compact CPU-only search because Python/GPU setup was unavailable without network dependency download. Product source was not modified.

Dataset sources:

- latest real 60Hz traces from Step 01
- Step 03 original MotionLab abrupt-stop coverage
- Step 04b revised positive abrupt-stop stress scenarios

Split policy is file/scenario-level:

- real: m070248 train, m070307 test
- synthetic: deterministic scenario/family train/validation/test split

Training labels:

- normal shifted-target dx/dy for regular motion
- event-window safe dx/dy = 0 for stop windows
- static safe dx/dy = 0 for stationary rows

Runtime features stay current/past only: recent velocity windows, latest delta, path efficiency, horizon, and product baseline output for rule hybrids.
`);

fs.writeFileSync(path.join(step, "report.md"), `# Step 06 Report: High-Accuracy Model Search

## Summary

Step 06 found that the compact learned MLP/FSMN-like candidates are not ready: they reduced some OTR rates but created larger Step04b peakLead tails than the product baseline. The best result came from a simple runtime-safe rule hybrid.

Best candidate:

- \`${best.id}\`
- Step04b peakLead max: ${n(best.peak)} px (${n(peakImprovement, 1)}% lower than product-brake baseline)
- Step04b returnMotion max: ${n(best.ret)} px (${n(returnImprovement, 1)}% lower)
- Step04b OTR >1px: ${n(best.otr * 100, 2)}%
- real holdout p95/p99: ${n(best.realP95)} / ${n(best.realP99)} px

## Candidate Ranking

${table}

## Interpretation

The event-weighted MLP/FSMN-like models are too blunt in this compact run. They learn to suppress some stop-window overshoot but also make larger peak tails on Step04b stress. That suggests the high-accuracy path needs either a stronger teacher/event sequence loss or more realistic abrupt-stop training data before distillation.

The rule hybrid is more promising immediately. It uses only runtime-safe signals:

- recentHigh >= 400 px/s
- v5 <= 300 px/s
- latestDelta <= 2.5 px
- a short latch over the existing product DistilledMLP output

It does not worsen the latest real holdout metrics in this replay, but it still leaves peakLead max above 3 px and OTR >1px above 20%, so it is not a final product fix.

## Step 07 Decision

\`continueToStep07\`: ${scores.continueToStep07}

Do not proceed to lightweight/distillation yet. The best candidate improves the stress tail, but not clearly enough to justify product-shape distillation under the current gate.

## Next

- Expand rule search around v5/latestDelta latch conditions and include fire-rate diagnostics.
- Add event-sequence training with explicit peakLead/returnMotion loss, not just row-safe labels.
- Gather or synthesize more realistic “stale latest sample / missed poll before stop” traces, because Step04b shows those are the leak dimensions.
`);

const logPath = path.join(root, "experiment-log.md");
fs.appendFileSync(logPath, `

## Step 06 - High-Accuracy Model Search

- Built CPU-only C# training/evaluation dataset from real 60Hz traces, Step03 coverage scenarios, and Step04b positive stress scenarios.
- Dataset rows: ${scores.datasetSummary.rows}; train ${scores.datasetSummary.bySplit.train}, validation ${scores.datasetSummary.bySplit.validation}, test ${scores.datasetSummary.bySplit.test}.
- Tried MLP temporal, larger MLP temporal, FSMN-like MLP, product baseline, and runtime rule hybrids.
- Best: ${best.id}; Step04b peakLead max ${n(best.peak)} px, OTR >1px ${n(best.otr * 100, 2)}%, return max ${n(best.ret)} px, real holdout p95 ${n(best.realP95)} px.
- Product-brake baseline: peakLead max ${n(baseline.peak)} px, OTR >1px ${n(baseline.otr * 100, 2)}%, return max ${n(baseline.ret)} px.
- continueToStep07=false; no distillation step started.
`);

let readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
readme += `

## Step 06 Update

Step 06 ran a compact CPU-only high-accuracy search. The learned MLP/FSMN-like candidates were not acceptable on Step04b peak tails. The best candidate was \`${best.id}\`, lowering Step04b peakLead max from ${n(baseline.peak)} px to ${n(best.peak)} px with no replayed real-holdout p95 regression, but the residual tail is still too high. Step 07 distillation was not started.
`;
fs.writeFileSync(path.join(root, "README.md"), readme);

console.log("wrote Step 06 report");
