# Step 03 Notes - Balanced Reevaluation

## Scope

This step reevaluates existing product/rule candidates and a compact learned set under `poc/cursor-prediction-v21/step-03-balanced-reevaluation/` only. Source data and v20 harness code were read but not modified.

## Loader Choices

- `split-manifest.json` is the package source of truth.
- ZIPs are opened with `System.IO.Compression.ZipFile`; `trace.csv` and `motion-trace-alignment.csv` are read directly from the archive without extraction.
- `motion-trace-alignment.csv` is the primary row source. It supplies `packageId`, split metadata from the manifest, `qualityBucket`, `durationBucket`, `scenarioIndex`, `scenarioElapsedMilliseconds`, `generatedX/Y`, `movementPhase`, generated velocity, `holdIndex`, and `phaseElapsedMilliseconds`.
- Alignment rows are joined to trace rows by `traceSequence`.
- Evaluation calls are limited to joined `runtimeSchedulerPoll` rows after a per-scenario warmup of 1500 ms.
- Future targets are interpolated from `trace.csv` reference rows (`referencePoll`, `cursorPoll`, and `rawInput`) using the effective product target time with the distilled MLP -4 ms target offset.
- Product baseline predictions use trace cursor positions, scheduler sample ticks, target ticks, refresh period, and DWM availability to mirror the v20 product predictor path.
- Scenario grouping, movement phase, stationary/hold slicing, and stop-event identity use row-level alignment metadata. The evaluator does not assume a fixed 12000 ms scenario duration.

## Candidate Set

- `product_distilled_lag0_offset_minus4_brake`
- `rule_hybrid_latch_v5_300_high400_latest2p5`
- `rule_hybrid_cap0p5_v2_150_high400_latest2p0`
- `mlp_h32_event_safe_sampled`
- `mlp_h32_asymmetric_lead_sampled`

The learned candidates use only the manifest train split. The run is intentionally compact: hidden size 32, 60 epochs, learning rate 0.003, seed 2103, and an 80000-row deterministic train cap.

## Metrics

`scores.json` emits row-weighted, scenario-balanced, file-balanced, duration-bucket-balanced, and quality-bucket-balanced aggregates per candidate. Each candidate also includes split-specific metric tables for train, validation, test, and robustness.

Stop events use `packageId#scenarioIndex` as the event grouping key. Reported objective dimensions include:

- normal visual p95/p99
- futureLead p99
- futureLag p95
- peakLead max/p99
- returnMotion max/p99
- OTR >1 px rate
- stationary jitter p95

## Limitations

The learned run is sampled and CPU-only. The event-safe MLP result is useful as a diagnostic but should not be treated as product-ready without rerunning with broader seeds, an unsampled or stratified larger train pass, and code-level runtime integration checks.
