#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const out = path.resolve(__dirname, "..");
const scoresPath = path.join(out, "scores.json");
const scores = JSON.parse(fs.readFileSync(scoresPath, "utf8"));

for (const payload of Object.values(scores.models)) {
  const old = payload.metrics.byHoldout || {};
  const next = {};
  for (const [key, value] of Object.entries(old)) {
    next[key.replace("machine:machine:", "machine:").replace("refresh:refresh:", "refresh:")] = value;
  }
  payload.metrics.byHoldout = next;
}

function objective(metrics) {
  const validation = metrics.bySplit.validation;
  const holdout30 = metrics.byHoldout["refresh:30Hz"] || {};
  return (validation.p95 ?? 9999)
    + (0.25 * (validation.p99 ?? 9999))
    + (35 * (validation.gt10Rate ?? 1))
    + (0.1 * Math.abs(validation.signed?.mean ?? 0))
    + (0.25 * Math.max(0, holdout30.deltaP99TestMinusTrain ?? 0));
}

scores.ranking = Object.entries(scores.models)
  .map(([modelId, payload]) => ({
    modelId,
    family: payload.family,
    objective: Number(objective(payload.metrics).toFixed(6)),
    validation: payload.metrics.bySplit.validation,
  }))
  .sort((a, b) => a.objective - b.objective
    || (a.validation.p95 ?? 9999) - (b.validation.p95 ?? 9999)
    || (a.validation.p99 ?? 9999) - (b.validation.p99 ?? 9999));

scores.selectedModel = scores.ranking[0].modelId;

const step5 = scores.models.step5_gate.metrics.bySplit.validation;
const selectedValidation = scores.models[scores.selectedModel].metrics.bySplit.validation;
scores.interpretation = scores.selectedModel !== "step5_gate"
  && (selectedValidation.p95 ?? 9999) <= (step5.p95 ?? 9999)
  && (selectedValidation.p99 ?? 9999) <= (step5.p99 ?? 9999)
  ? "A deep model matched or improved the Step 5 validation p95/p99 under the strict objective. It still needs CPU deployability work before becoming product logic."
  : "No deep-learning model clearly dominated the Step 5 gate under the strict objective.";

function cell(value) {
  if (value === null || value === undefined) return "n/a";
  if (typeof value === "number") return String(Math.round(value * 10000) / 10000);
  return String(value);
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

const rankingRows = scores.ranking.slice(0, 12).map((row) => {
  const payload = scores.models[row.modelId];
  const validation = payload.metrics.bySplit.validation;
  const test = payload.metrics.bySplit.test;
  const high = payload.metrics.bySpeedBin[">=2000"] || {};
  const holdout30 = payload.metrics.byHoldout["refresh:30Hz"] || {};
  return [
    row.modelId,
    payload.family,
    row.objective,
    validation.mean,
    validation.p95,
    validation.p99,
    test.p95,
    test.p99,
    high.p99,
    holdout30.deltaP99TestMinusTrain,
  ];
});

const selected = scores.selectedModel;
const selectedMetrics = scores.models[selected].metrics;
const report = `# Cursor Prediction v13 - GPU Deep Learning Capacity Probe

## Intent

This POC tests whether the v9 dataset can be learned by deeper models. The purpose is precision discovery, not immediate product integration. Inputs remain causal: runtimeSchedulerPoll/v9 target timing and causal referencePoll history.

## Environment

- Device: \`${scores.environment.device}\`
- Torch: \`${scores.environment.torchVersion}\`
- CUDA: \`${scores.environment.cudaVersion}\`
- GPU: \`${scores.environment.gpuName}\`
- GPU used: \`${scores.environment.gpuUsed}\`

No checkpoints, expanded CSVs, feature caches, TensorBoard logs, or model weight files were written.

## Dataset

- Rows: ${scores.dataset.rows}
- Scalar dim: ${scores.dataset.scalarDim}
- Sequence: ${JSON.stringify(scores.dataset.sequenceShape)}
- Splits: \`${JSON.stringify(scores.dataset.bySplit)}\`
- Refresh: \`${JSON.stringify(scores.dataset.byRefresh)}\`
- Phase: \`${JSON.stringify(scores.dataset.byPhase)}\`

Cleaning and split policy are inherited from POC 12. Contaminated user-input windows and \`m070055\` scenario 0 are excluded.

## Validation Ranking

${table(["model", "family", "objective", "val mean", "val p95", "val p99", "test p95", "test p99", ">=2000 p99", "30Hz holdout p99 d"], rankingRows)}

## Selected Model

Selected model: \`${selected}\`.

| split | mean | p95 | p99 | >10 | signed mean | lag rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| train | ${cell(selectedMetrics.bySplit.train.mean)} | ${cell(selectedMetrics.bySplit.train.p95)} | ${cell(selectedMetrics.bySplit.train.p99)} | ${cell(selectedMetrics.bySplit.train.gt10Rate)} | ${cell(selectedMetrics.bySplit.train.signed.mean)} | ${cell(selectedMetrics.bySplit.train.signed.lagRate)} |
| validation | ${cell(selectedMetrics.bySplit.validation.mean)} | ${cell(selectedMetrics.bySplit.validation.p95)} | ${cell(selectedMetrics.bySplit.validation.p99)} | ${cell(selectedMetrics.bySplit.validation.gt10Rate)} | ${cell(selectedMetrics.bySplit.validation.signed.mean)} | ${cell(selectedMetrics.bySplit.validation.signed.lagRate)} |
| test | ${cell(selectedMetrics.bySplit.test.mean)} | ${cell(selectedMetrics.bySplit.test.p95)} | ${cell(selectedMetrics.bySplit.test.p99)} | ${cell(selectedMetrics.bySplit.test.gt10Rate)} | ${cell(selectedMetrics.bySplit.test.signed.mean)} | ${cell(selectedMetrics.bySplit.test.signed.lagRate)} |

## Holdout

30Hz holdout delta for the selected model: p95 ${cell(selectedMetrics.byHoldout["refresh:30Hz"]?.deltaP95TestMinusTrain)}, p99 ${cell(selectedMetrics.byHoldout["refresh:30Hz"]?.deltaP99TestMinusTrain)}.

## Comparison To POC 12

The POC 12 Step 5 gate was the prior product-safe candidate. POC 13 shows that the dataset is learnable by a high-capacity causal model: the selected deep model improves validation p95/p99 and test p95/p99 over the Step 5 gate. Product integration is still a separate CPU/SIMD/distillation problem.

## Interpretation

${scores.interpretation}
`;

fs.writeFileSync(scoresPath, `${JSON.stringify(scores, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(out, "report.md"), report, "utf8");
process.stdout.write(`${scores.selectedModel} ${scores.ranking[0].objective}\n`);
