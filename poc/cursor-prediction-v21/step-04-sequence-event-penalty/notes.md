# Step 04 Notes - Sequence/Event Penalty

## Scope

This step works only under `poc/cursor-prediction-v21/step-04-sequence-event-penalty/`. The harness was copied from step03 and modified locally. Step02 manifest/metric policy and step03 outputs were read as inputs; source files and earlier step folders were not edited.

## Loader And Metrics

- Reused the v21 manifest-aware loader from step03.
- Read ZIP entries directly with no CSV extraction: `trace.csv` and `motion-trace-alignment.csv`.
- Evaluated joined `runtimeSchedulerPoll` rows after a 1500 ms per-scenario warmup.
- Future target interpolation and product baseline prediction path match step03.
- Emitted rowWeighted, scenarioBalanced, fileBalanced, durationBucketBalanced, and qualityBucketBalanced aggregates.
- Emitted split-specific train, validation, test, and robustness metric tables.
- Ranked by the step02 metric-policy objective.

## Training Run

- CPU-only serialized run.
- Seed: `2104`.
- Hidden size: `32`.
- Train split only.
- Deterministic train cap: `80000` rows from `91215` train rows.
- Epochs: `60`.
- Learning rate: `0.003`.
- Dataset after loader: `252180` rows, `10` packages, `640` scenarios, `9645` event-window rows, `183459` stationary rows.

## Candidate Set

- `product_distilled_lag0_offset_minus4_brake`.
- Step03 best sampled event-safe MLP baseline: `mlp_h32_event_safe_sampled`.
- Asymmetric-lead MLP baseline: `mlp_h32_asymmetric_lead_sampled`.
- Event/sequence variants:
  - `mlp_h32_event_peaklead_hinge_stoprows`: event-safe target plus peakLead hinge on stop rows.
  - `mlp_h32_event_returnmotion_proxy`: event-safe target plus stop-window output magnitude / returnMotion proxy.
  - `mlp_h32_asym_lagguard_jitter`: event lead penalty plus normal-moving lag guard and stationary jitter penalty.
  - `mlp_h32_stop_safety_target_cap`: stop-window safety target and differentiable cap proxy.
  - `mlp_h32_event_safe_seq_latch_cap0p35`: post-model sequence latch/cap over the event-safe MLP.
  - `mlp_h32_asym_seq_latch_blend0p50_cap0p45`: post-model sequence latch/blend/cap over the asymmetric MLP.
- Kept the two step03/v20 rule hybrids as reference baselines.

## Loss/Guard Design

- Used row-level differentiable proxies rather than sequence backprop.
- Applied lead-side hinge penalties only on event/stop-safety rows.
- Added a lag guard for normal moving rows in the asymmetric guard variant.
- Penalized nonzero output on static/hold rows to suppress stationary jitter.
- Added stop-safety rows when `recentHigh >= 400`, `v2 <= 140`, `latestDelta <= 2.5`, and `targetDistance <= 1.25`.
- Sequence guards latch for up to 10 rows per scenario and cap/blend learned output during stop windows.

## Limitations

The compact run is useful for signal, not promotion. It uses one seed and an 80k deterministic cap. The learned candidates still need repeatability checks and a direct runtime integration pass before they can be considered for product code.
