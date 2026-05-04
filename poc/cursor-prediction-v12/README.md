# Cursor Prediction v12

POC 12 starts from four v9 Motion Lab recordings captured after the user-input blocking countermeasure.

The first phase audits the data, removes warmup and external-input contamination, and creates scenario-level split manifests for normal train/validation/test, machine holdout, and 30/60Hz refresh holdout evaluation.

Artifacts:

- `final-report.md`: integrated POC 12 conclusion and implementation recommendation.
- `scores.json`: top-level aggregate of key metrics, selected candidates, rejections, oracle ceilings, cleaning, and holdout results.
- `step-1-data-audit/report.md`: data and contamination audit.
- `step-1-data-audit/scores.json`: machine-readable audit summary.
- `step-1-data-audit/notes.md`: detailed cleaning rationale.
- `step-2-clean-split/report.md`: split and holdout report.
- `step-2-clean-split/scores.json`: machine-readable split scores.
- `step-2-clean-split/split-manifest.json`: compact downstream manifest.
- `step-2-clean-split/notes.md`: loader contract and leakage notes.
- `step-3-baseline-retune/report.md`: clean-manifest baseline retune report.
- `step-3-baseline-retune/scores.json`: machine-readable baseline scores across split, anchor, refresh, machine, and holdout views.
- `step-3-baseline-retune/notes.md`: baseline rerun and product-approximation notes.
- `step-4-timing-target-audit/report.md`: v9 target/present timing audit.
- `step-4-timing-target-audit/scores.json`: machine-readable timing and lag-bias summaries.
- `step-4-timing-target-audit/notes.md`: target semantics and bias-sign notes.
- `step-5-state-gated-search/report.md`: product-safe state-gated least-squares search.
- `step-5-state-gated-search/scores.json`: gate ranking, split/holdout/phase/speed breakdowns.
- `step-5-state-gated-search/notes.md`: product-safe gate notes.
- `step-6-ml-fsmn-search/report.md`: ML/FSMN family precision and CPU deployability search.
- `step-6-ml-fsmn-search/scores.json`: ML/FSMN scores and holdout signals.
- `step-6-ml-fsmn-search/notes.md`: training and family-mapping notes.
- `step-7-tail-and-holdout-refinement/report.md`: tail, resume, and 30Hz holdout guard refinement.
- `step-7-tail-and-holdout-refinement/scores.json`: product-safe guard search and analysis-only oracle scores.
- `step-7-tail-and-holdout-refinement/notes.md`: Step 7 rerun and guardrail notes.
- `scripts/audit-and-split.js`: reproducible audit/split script.
- `scripts/run-step3-step4.js`: reproducible baseline/timing audit script.
- `scripts/run-step5-step6.js`: reproducible state-gate and ML/FSMN search script.
- `scripts/run-step7-tail-and-holdout.js`: reproducible Step 7 refinement script.

Final recommendation:

- Primary candidate: `gate_s25_net0_eff35_ls12_g100_cap12_off-2`.
- Runtime contract: `runtimeSchedulerPoll + v9 target-derived horizon`.
- Fixed 16.67 ms horizons are diagnostic controls only for scheduler anchors.
- Step 7 specialist guards are rejected because the best tail improvement worsens 30Hz holdout p99.
- ML/FSMN remains a precision probe, not the current implementation candidate.

No raw ZIP files, expanded CSV files, model checkpoints, or large intermediate datasets are stored in this directory.
