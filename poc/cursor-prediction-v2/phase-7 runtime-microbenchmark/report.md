# Phase 7 Runtime Microbenchmark

## Scope
- Candidate: `baseline + DWM-aware next-vblank horizon`, gained last2 velocity with gain `0.75`.
- No learned correction is accepted or benchmarked for productization.
- Trace data was read from the root zip in place: `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\cursor-mirror-trace-20260501-091537.zip`.
- Measurement was run serially in compiled C# through PowerShell `Add-Type`; CPU timing is the relevant signal.

## Hot Path Results
- Best repeat mean: `0.023827` us/call.
- Best repeat p50: `0.023047` us/call.
- Best repeat p90: `0.023828` us/call.
- Best repeat p95: `0.029297` us/call.
- Best repeat p99: `0.033594` us/call.
- Worst repeat p99: `0.039266` us/call.
- Repeat variability: mean range `0.023701-0.027777` us/call, p50 range `0.023047-0.023047` us/call, p99 range `0.033203-0.039266` us/call.
- Allocation check: `0` bytes over `2000000` predictions (`0` bytes/prediction).

The percentile values are batch-timing estimates: each recorded sample is one batch divided by `256` predictions. This avoids per-call Stopwatch overhead but makes the highest percentiles sensitive to OS scheduling noise.

## Replay and Parity
- Poll predictions checked: `160441`.
- Max absolute coordinate difference against the reference formula: `0` px.
- Target tolerance: `0.01` px.

## Instrumentation
The product implementation should expose counters for:
- `invalid_dwm_horizon`
- `late_dwm_horizon`
- `horizon_over_1_25x_refresh_period`
- `fallback_to_hold`
- `prediction_reset_due_to_invalid_dt_or_idle_gap`

## Target Status
- Hot path p50 under 0.5 us: `met`.
- Hot path p99 under 2 us: `met`.
- Zero allocations after warmup: `met`.
- End-to-end poll-to-prediction budget under 50 us p99 estimate: `met`.
- Numerical parity within 0.01 px: `met`.

## Phase 8 Input
Proceed with baseline + DWM-aware next-vblank horizon using gained last2 velocity at gain 0.75. Learned correction remains out of scope for productization.
