const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step = path.join(root, "step-07-deep-rule-event-search");
const scorePath = path.join(step, "scores.json");
const scores = JSON.parse(fs.readFileSync(scorePath, "utf8"));

function n(value, digits = 3) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "0";
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}

const topIds = Array.from(new Set([
  "product_distilled_lag0_offset_minus4_brake",
  ...scores.ranking.slice(0, 40).map((r) => r.id),
]));
const originalCandidateCount = Object.keys(scores.candidates).length;
const prunedCandidates = {};
for (const id of topIds) {
  if (scores.candidates[id]) prunedCandidates[id] = scores.candidates[id];
}
scores.candidates = prunedCandidates;
scores.ranking = scores.ranking.filter((r) => prunedCandidates[r.id]);
scores.pruned = {
  originalCandidateCount,
  retainedCandidateCount: Object.keys(prunedCandidates).length,
  note: "Step07 raw candidate diagnostics were pruned to baseline plus top-ranked candidates to keep the artifact compact.",
};
fs.writeFileSync(scorePath, JSON.stringify(scores, null, 2) + "\n");

function row(id) {
  const c = scores.candidates[id];
  const rank = scores.ranking.find((r) => r.id === id)?.score || {};
  return {
    id,
    objective: rank.totalObjective,
    peak: c.step04bStress.events.peakLead.max,
    otr: c.step04bStress.events.overshootThenReturnRateGt1,
    ret: c.step04bStress.events.returnMotion.max,
    realP95: c.realHoldout.overall.visual.p95,
    realP99: c.realHoldout.overall.visual.p99,
    normalFire: c.fireDiagnostics.normalMoveFireRate,
    totalFire: c.fireDiagnostics.totalFireRate,
    stopFire: c.fireDiagnostics.stopWindowFireRate,
  };
}

const best = row(scores.ranking[0].id);
const baseline = row("product_distilled_lag0_offset_minus4_brake");
const step06Best = {
  id: "step06_rule_hybrid_latch_v5_300_high400_latest2p5",
  peak: 3.3571763589079637,
  otr: 0.22340425531914893,
  ret: 3.2260076107490847,
  realP95: 0.4951999999880172,
  realP99: 1.67939999997634,
};

const tableRows = scores.ranking.slice(0, 12).map((r) => row(r.id));
const table = [
  "| candidate | Step04b peakLead max | OTR >1px | return max | real p95/p99 | normal fire | total fire | objective |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...tableRows.map((r) => `| ${r.id} | ${n(r.peak)} | ${n(r.otr * 100, 2)}% | ${n(r.ret)} | ${n(r.realP95)}/${n(r.realP99)} | ${n(r.normalFire * 100, 2)}% | ${n(r.totalFire * 100, 2)}% | ${n(r.objective, 1)} |`),
].join("\n");

fs.writeFileSync(path.join(step, "notes.md"), `# Step 07 Notes: Deep Rule/Event Search

Step 07 is an added CPU-only deep rule search. No distillation or product source changes were made.

The first unbounded grid was too slow, so the completed pass uses a bounded 300-spec search:

- 120 curated specs around the Step 06 high-signal v5/latestDelta latch family
- 180 coarse specs covering velocity windows, recentHigh, latestDelta, target distance, path efficiency, decel ratio, horizon range, action type, latch duration, cap/blend, and along-only suppression

Actions covered: snap-to-current, displacement cap, blend toward current, along-direction cap, and along-direction zero.

Fire diagnostics are reported by source/split/family for retained top candidates.
`);

fs.writeFileSync(path.join(step, "report.md"), `# Step 07 Report: Deep Rule/Event Search

## Summary

The deep rule/event search found a slightly better version of the Step 06 rule family, but it did **not** find a product-shaped candidate strong enough to justify Step 08.

Best candidate:

- \`${best.id}\`
- Step04b peakLead max: ${n(best.peak)} px
- Step04b OTR >1px: ${n(best.otr * 100, 2)}%
- Step04b returnMotion max: ${n(best.ret)} px
- real holdout p95/p99: ${n(best.realP95)} / ${n(best.realP99)} px
- normalMove fire rate: ${n(best.normalFire * 100, 2)}%
- total fire rate: ${n(best.totalFire * 100, 2)}%

Compared with current product brake:

- peakLead max: ${n(baseline.peak)} -> ${n(best.peak)} px
- OTR >1px: ${n(baseline.otr * 100, 2)}% -> ${n(best.otr * 100, 2)}%
- returnMotion max: ${n(baseline.ret)} -> ${n(best.ret)} px

Compared with Step 06 best:

- peakLead max: ${n(step06Best.peak)} -> ${n(best.peak)} px
- OTR >1px: ${n(step06Best.otr * 100, 2)}% -> ${n(best.otr * 100, 2)}%
- returnMotion max: ${n(step06Best.ret)} -> ${n(best.ret)} px

## Ranking

${table}

## Fire Diagnostics

For the selected candidate:

- total fire rate: ${n(best.totalFire * 100, 2)}%
- stop-window fire rate: ${n(best.stopFire * 100, 2)}%
- normalMove fire rate: ${n(best.normalFire * 100, 2)}%

The rule fires often enough near stop windows to reduce return tail, but it still misses enough Step04b leak windows that OTR remains above 20%. This suggests the remaining tail is not fully observable from the current v2/v5/latestDelta gate alone.

## Decision

\`continueToStep08\`: ${scores.continueToStep08}

Do not start Step 08. Step 07 improves Step 06 only marginally and does not drive OTR or returnMotion close enough to zero.

## Next

- Add exact runtime signal logging around stop onset: duplicate sample count, last raw input age, scheduler-vs-DWM phase, and whether target crosses the stop boundary.
- Revisit the synthetic generator with explicit stale/duplicate poll streams rather than speed-point proxies.
- If training resumes, use event-sequence losses over peak/return directly rather than row-safe labels.
`);

const logPath = path.join(root, "experiment-log.md");
fs.appendFileSync(logPath, `

## Step 07 - Deep Rule/Event Search

- Ran CPU-only deep rule/event search over 300 runtime-safe rule specs.
- Best: ${best.id}; Step04b peakLead max ${n(best.peak)} px, OTR >1px ${n(best.otr * 100, 2)}%, return max ${n(best.ret)} px, real holdout p95 ${n(best.realP95)} px.
- Current product brake baseline: peakLead max ${n(baseline.peak)} px, OTR >1px ${n(baseline.otr * 100, 2)}%, return max ${n(baseline.ret)} px.
- continueToStep08=false; no distillation or product integration started.
`);

let readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
readme += `

## Step 07 Update

Step 07 ran a CPU-only deep runtime-rule search. Best candidate \`${best.id}\` slightly improves Step 06 and product brake, but OTR remains ${n(best.otr * 100, 2)}% and return max remains ${n(best.ret)} px. Step 08 was not started.
`;
fs.writeFileSync(path.join(root, "README.md"), readme);

console.log("wrote Step 07 report and pruned scores");
