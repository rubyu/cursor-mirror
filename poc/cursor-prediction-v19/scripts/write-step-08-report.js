const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step = path.join(root, "step-08-missing-signal-oracle");
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
    family: c.candidate.Family,
    signals: c.candidate.Signals,
    feasibility: c.candidate.Feasibility,
    peak: c.step04bStress.events.peakLead.max,
    otr: c.step04bStress.events.overshootThenReturnRateGt1,
    ret: c.step04bStress.events.returnMotion.max,
    realP95: c.realHoldout.overall.visual.p95,
    realP99: c.realHoldout.overall.visual.p99,
    normalFire: c.fireDiagnostics.normalMoveFireRate,
    totalFire: c.fireDiagnostics.totalFireRate,
    objective: s.totalObjective,
  };
}

const rows = scores.ranking.map((r) => row(r.id));
const baseline = row("baseline_product_brake");
const best = rows[0];
const table = [
  "| candidate | signal family | feasibility | Step04b peak | OTR >1px | return max | real p95/p99 | normal fire |",
  "|---|---|---|---:|---:|---:|---:|---:|",
  ...rows.map((r) => `| ${r.id} | ${r.signals} | ${r.feasibility} | ${n(r.peak)} | ${n(r.otr * 100, 2)}% | ${n(r.ret)} | ${n(r.realP95)}/${n(r.realP99)} | ${n(r.normalFire * 100, 2)}% |`),
].join("\n");

fs.writeFileSync(path.join(step, "notes.md"), `# Step 08 Notes: Missing-Signal Oracle

Step 08 tested explicit poll-stream signals before any product or TraceTool changes.

The synthetic replay differs from Step04b by separating:

- true cursor position used for visual/current error
- observed poll position fed into the product predictor
- explicit duplicate/hold run length
- last raw movement age
- sample/stale age
- missed poll before stop
- target phase relative to detected stop onset
- target-crosses-stop-boundary oracle
- future stop-window oracle

No product predictor code was modified.
`);

fs.writeFileSync(path.join(step, "report.md"), `# Step 08 Report: Missing-Signal Oracle

## Summary

Step 08 did **not** identify a strong runtime-feasible missing signal.

The explicit poll-stream variant made the stress case harsher: stale/duplicated poll samples can create a large return tail when visual error is measured against the true cursor position rather than the stale observed sample. Under that replay, neither current signals nor the proposed extra signals drove OTR/returnMotion close to zero.

Best ranked candidate:

- \`${best.id}\`
- signal: ${best.signals}
- feasibility: ${best.feasibility}
- Step04b peakLead max: ${n(best.peak)} px
- OTR >1px: ${n(best.otr * 100, 2)}%
- returnMotion max: ${n(best.ret)} px
- real holdout p95/p99: ${n(best.realP95)} / ${n(best.realP99)} px

Baseline product brake on explicit poll stream:

- Step04b peakLead max: ${n(baseline.peak)} px
- OTR >1px: ${n(baseline.otr * 100, 2)}%
- returnMotion max: ${n(baseline.ret)} px

## Ablation Results

${table}

## Interpretation

The proposed signals are useful for diagnosis, but this oracle pass says they are not sufficient as simple runtime gates:

- duplicate/hold and raw-input-age gates fire too late or too sparsely
- sample age alone does not identify enough of the return tail
- target-cross/phase oracle rows do not align with the worst stale-poll return tail in this synthetic construction
- combined runtime-feasible signals do not improve the event objective
- combined oracle signals still leave the large return tail

The important new clue is that explicit stale poll/current truth separation can create much larger returnMotion than Step04b speed-point proxies. That means the next experiment should improve data generation/capture fidelity, not add another product rule yet.

## Decision

\`continueToStep09\`: ${scores.conclusion.continueToStep09}

No Step 09 was started. There is not enough evidence for a bounded product/tooling change candidate.

## Required Next Data

- observed poll position and true/reference cursor position at the same prediction call
- sample age of the latest cursor sample
- raw input age / last movement age
- duplicate sample run length
- missed-poll indicator or expected poll cadence gap
- DWM target phase relative to the actual stop boundary
`);

const interim = `# v19 Interim Summary

v19 has now reproduced and analyzed the abrupt stop overshoot/return leak through Step 08.

## Current State

- Step04b reproduced the leak in product-equivalent replay.
- Step06/07 rule searches improved peakLead and return tail partially, but OTR stayed above 20%.
- Step08 explicit poll-stream/oracle replay did not find a runtime-feasible missing signal that solves the leak.

## Best Practical Candidate So Far

The best product-shaped idea remains the Step07/Step06 v5/latestDelta snap-latch family:

- peakLead max around 3.36px on Step04b stress
- OTR still around 21-22%
- real holdout p95/p99 unchanged in replay

This is not sufficient for product adoption.

## Blocker

The remaining failure appears to depend on poll-stream fidelity: whether the predictor sees a stale/duplicated/latest sample while the real cursor has already stopped or moved differently. Current logs/scenarios do not expose enough first-class state to design a robust runtime gate.

## Next Required Work

Do not modify the product predictor yet. First add or collect data with:

- observed poll position vs reference/true current position at prediction time
- sample age and raw input age
- duplicate/hold run length
- missed-poll/cadence gap
- DWM target phase relative to stop boundary

Then rerun v19 Step08-style oracle and Step07-style search on those traces.
`;
fs.writeFileSync(path.join(root, "interim-summary.md"), interim);

const logPath = path.join(root, "experiment-log.md");
fs.appendFileSync(logPath, `

## Step 08 - Missing-Signal Oracle

- Built explicit poll-stream synthetic replay separating true cursor position from observed poll position.
- Evaluated current signals, duplicate/hold, raw input age, sample age, target-cross-boundary, phase, combined runtime-feasible, and oracle candidates.
- Best ranked candidate: ${best.id}; peak ${n(best.peak)} px, OTR >1px ${n(best.otr * 100, 2)}%, return ${n(best.ret)} px.
- No strong runtime-feasible signal found; continueToStep09=false.
- Wrote interim v19 summary with blocker and required data capture.
`);

let readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
readme += `

## Step 08 Update

Step 08 tested explicit poll-stream and missing-signal oracle candidates. No runtime-feasible signal solved the leak; even oracle-style target-cross/phase signals did not collapse the explicit stale-poll return tail. See \`interim-summary.md\` for the current blocker and required data capture.
`;
fs.writeFileSync(path.join(root, "README.md"), readme);

console.log("wrote Step 08 report and interim summary");
