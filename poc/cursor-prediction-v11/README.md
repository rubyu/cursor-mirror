# Cursor Prediction v11

This experiment starts from a Step 1 data audit of the May 3, 2026 Motion Lab recordings, continues with CPU-only deterministic baseline replay, adds a lightweight CPU-only learned gate/residual pilot, includes a CPU-deployable FSMN-family design search, adds a tail-aware guarded search, checks timing alignment / horizon compensation, estimates oracle observability ceilings, and records the telemetry changes needed for the next dataset.

Artifacts:

- `step-1-data-audit/report.md`: human-readable data audit.
- `step-1-data-audit/scores.json`: machine-readable audit scores and summaries.
- `step-1-data-audit/notes.md`: caveats, rerun command, and Step 2 handoff notes.
- `step-2-baseline-replay/report.md`: deterministic causal baseline report.
- `step-2-baseline-replay/scores.json`: machine-readable baseline scores by horizon, split, load, movement category, and scheduler-delay bin.
- `step-2-baseline-replay/notes.md`: rerun command and leakage notes for baseline replay.
- `step-3-learned-gates/report.md`: lightweight learned gate/residual pilot report.
- `step-3-learned-gates/scores.json`: machine-readable learned pilot scores and segment regression risks.
- `step-3-learned-gates/notes.md`: causality, product-eligibility, and Step 4 handoff notes.
- `step-4-fsmn-family-search/report.md`: FSMN-family search report with CPU feature audit, validation selection, and Step 3 teacher deltas.
- `step-4-fsmn-family-search/scores.json`: machine-readable FSMN-family scores by split, load, horizon, movement category, and scheduler-delay bin.
- `step-4-fsmn-family-search/notes.md`: rerun command, causality notes, CPU audit caveat, and Step 5 guardrail.
- `step-5-tail-aware-guarded-search/report.md`: tail-aware guarded search report with validation objective, no-scheduler ablation, signed lag/lead bias, and Step 3/4 deltas.
- `step-5-tail-aware-guarded-search/scores.json`: machine-readable guarded-search scores by split, load, horizon, movement category, scheduler-delay bin, and signed bias.
- `step-5-tail-aware-guarded-search/notes.md`: rerun command, causality notes, tail objective notes, and Step 6 handoff.
- `step-6-timing-alignment-search/report.md`: timing alignment report with fixed offset, horizon-specific offset, conditional offset, signed lag/lead, and Step 3/4/5 deltas.
- `step-6-timing-alignment-search/scores.json`: machine-readable timing alignment scores by split, load, horizon, movement category, and signed bias.
- `step-6-timing-alignment-search/notes.md`: rerun command, offset semantics, causality notes, and Step 7 handoff.
- `step-7-oracle-observability-ceiling/report.md`: oracle observability ceiling report with product selector metrics, oracle headroom, history ambiguity, and telemetry priorities.
- `step-7-oracle-observability-ceiling/scores.json`: machine-readable oracle/selector scores, history ambiguity summaries, and telemetry proxy comparisons.
- `step-7-oracle-observability-ceiling/notes.md`: rerun command, product eligibility notes, sampling notes, and Step 8 handoff.
- `step-8-instrumentation-telemetry/report.md`: instrumentation report describing the trace and Motion Lab fields added after the observability ceiling analysis.
- `step-8-instrumentation-telemetry/scores.json`: machine-readable telemetry readiness summary and verification result.
- `step-8-instrumentation-telemetry/notes.md`: scope, product-eligibility notes, and fresh-data handoff.
- `scripts/audit-step1.js`: lightweight reproducible audit script.
- `scripts/run-step2-baselines.js`: lightweight reproducible baseline replay script.
- `scripts/run-step3-learned-gates.js`: lightweight reproducible learned gate/residual script.
- `scripts/run-step4-fsmn-family-search.js`: lightweight reproducible CPU-only FSMN-family search script.
- `scripts/run-step5-tail-aware-guarded-search.js`: lightweight reproducible CPU-only tail-aware guarded search script.
- `scripts/run-step6-timing-alignment-search.js`: lightweight reproducible CPU-only timing alignment search script.
- `scripts/run-step7-oracle-observability-ceiling.js`: lightweight reproducible CPU-only oracle observability ceiling script.

No raw ZIP files or large intermediates are copied into this directory.
