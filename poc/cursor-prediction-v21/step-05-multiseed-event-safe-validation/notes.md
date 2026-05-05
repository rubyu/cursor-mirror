# Step 05 Notes - Multi-seed Event-safe Validation

## Scope

This step writes only under `poc/cursor-prediction-v21/step-05-multiseed-event-safe-validation/`. The harness was copied from step04 and localized before edits. Step02 manifest/policy, step04 outputs, repo source, and root ZIPs were read as inputs only.

## Loader And Metrics

- Reused the step04 manifest-aware loader and step02 metric policy.
- Read ZIP entries directly with no CSV extraction: `trace.csv` and `motion-trace-alignment.csv`.
- Evaluated joined `runtimeSchedulerPoll` rows after a 1500 ms per-scenario warmup.
- Used trace reference rows (`referencePoll`, `cursorPoll`, `rawInput`) for future-target interpolation.
- Kept the product baseline path linked to the current `DistilledMlpPredictionModel` with post-stop brake enabled.
- Emitted rowWeighted, scenarioBalanced, fileBalanced, durationBucketBalanced, and qualityBucketBalanced aggregates.

## Training Run

- CPU-only serialized run; no other executor overlap.
- Runtime: 162101 ms.
- Seeds: `2105`, `2205`, `2305`.
- Hidden size: `32`.
- Train cap: `120000`.
- Train rows before cap: `91215`; all train rows were used for every seed.
- The harness includes a deterministic stratified sampler for lower caps, but because the full train split fit under the cap it did not drop rows.
- Epochs: `60`.
- Learning rate: `0.003`.
- Dataset after loader: `252180` rows, `10` packages, `640` scenarios, `9645` event-window rows, `183459` stationary rows.

## Candidate Set

- `product_distilled_lag0_offset_minus4_brake`.
- `mlp_h32_event_safe_fulltrain`: event-safe MLP without runtime guard.
- `mlp_h32_event_safe_seq_latch_cap0p35`: step04 focused candidate shape on full train / multi-seed.
- `mlp_h32_event_safe_seq_latch_cap0p35_gain1p08`: normal-moving gain calibration.
- `mlp_h32_event_safe_seq_latch_cap0p25_gain1p08`: tighter stop cap plus normal-moving gain calibration.
- `mlp_h32_event_safe_seq_latch_cap0p35_productblend0p25`: normal-moving blend 25% toward product baseline.

## FutureLag Gate

The epsilon used for the product futureLag regression gate is `0.005 px`. Product rowWeighted `overall.futureLag.p95` is exactly `0.000000` under the nearest-rank metric, so candidates must be at or below `0.005 px` to pass.

The best guarded family remained around `0.027 px` mean and `0.031 px` worst. The lag-calibrated variants did not materially move this p95 because the metric's eligible slice includes all train/validation rows, not only held-out normal-moving visual rows.

## Build Artifacts

The harness was built and run from `harness/`. `bin/` and `obj/` were removed after verification.
