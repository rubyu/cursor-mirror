# Phase 1 Report

## Decision Summary

The reconstructed product poll+DWM baseline on the v2 trace evaluates 160440 anchors with mean error 1.348 px, p95 5.258 px, p99 26.993 px, and max 537.956 px.
Most anchors use the DWM path; status counts are `{"late_advanced":39993,"valid":120446,"warmup_hold":1}`.
The v2 trace metadata records an 8 ms poll interval, but observed poll intervals are p50 15.684 ms and p95 23.212 ms.

The strongest error signal is motion regime: fast anchors and high-acceleration anchors dominate the tail. DWM horizon also matters; late-in-frame horizons are less harmful than long horizons because the extrapolation distance is smaller.
Worst p95 speed bin: `1200+` at 79.869 px. Worst p95 DWM horizon bin: `16-21ms` at 7.282 px. Worst p95 poll-jitter bin: `<=0.5ms` at 8.322 px.
When interpolated hook/poll disagreement exceeds 5 px, p95 error rises to 73.659 px across 8139 anchors, so stream disagreement is a useful Phase 2 gating signal.

## Older Trace Compatibility

- `cursor-mirror-trace-20260501-000443` `compat_fixed_4ms`: mean 2.084 px, p95 8.218 px, p99 21.100 px, max 264.362 px.
- `cursor-mirror-trace-20260501-000443` `compat_fixed_8ms`: mean 4.022 px, p95 16.273 px, p99 42.050 px, max 500.264 px.
- `cursor-mirror-trace-20260501-000443` `compat_fixed_12ms`: mean 6.128 px, p95 25.336 px, p99 65.185 px, max 766.845 px.
- `cursor-mirror-trace-20260501-000443` `compat_fixed_16ms`: mean 8.423 px, p95 35.342 px, p99 88.526 px, max 1034.082 px.

## Phase 2 Direction

Prioritize adaptive gain/horizon damping by motion regime rather than replacing the whole predictor. The Phase 1 tails point at fast acceleration, turns, and stop-entry/settle periods, so Phase 2 should test bounded acceleration-aware gain reduction, stop detection that quickly returns to hold, and possibly a shorter effective horizon when poll jitter or hook/poll disagreement is high.

## Artifacts

- `scores.json`: machine-readable metrics and bins.
- `experiment-log.md`: schema notes, reconstruction details, and full bin summaries.
- `run_phase1.mjs`: reproducible replay/report script.