# Phase 1 Data Audit and Timebase Reconstruction

## Input
- Trace zip: `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\cursor-mirror-trace-20260501-091537.zip`
- Trace format: `2`
- Metadata sample count: `218146`
- Observed CSV rows: `218146`
- Duration from metadata: `2524.306s`

## Data Quality
- Row count matches metadata: `True`
- Event counts: hook/move `57704`, poll `160442`
- Sequence gaps/non-monotonic: `0` / `0`
- Stopwatch non-increasing rows: `0`
- Elapsed timestamp decreases: `0`
- Elapsed-vs-stopwatch max absolute drift: `0.900`us

## Sampling and Idle Behavior
- Poll interval mean/p50/p95/p99: `15.733` / `15.684` / `23.212` / `28.089` ms
- Hook interval mean/p50/p95/p99: `43.742` / `8.008` / `96.158` / `712.076` ms
- Consecutive duplicate poll positions: `128823`
- Poll idle periods >=100ms / >=500ms / >=1000ms: `2556` / `776` / `409`
- Longest poll idle period: `46,703.610` ms

## DWM Timing
- DWM timing availability: `{"true":160442}`
- DWM refresh rate keys: `{"10000000/166615":1,"10000000/166617":1,"10000000/166624":1,"10000000/166634":2,"10000000/166657":2,"10000000/166662":1,"10000000/166666":73,"10000000/166668":1,"10000000/166669":2,"10000000/166670":1,"10000000/166672":1,"10000000/166674":2,"10000000/166675":1,"10000000/166676":1,"10000000/166677":20,"10000000/166678":9,"10000000/166679":118,"10000000/166680":60274,"10000000/166681":98149,"10000000/166682":1765,"10000000/166683":15,"10000000/166696":1,"10000000/166706":1}`
- DWM refresh-period field mean/p50/p95/p99: `16.668` / `16.668` / `16.668` / `16.668` ms
- Changed-vblank cadence observed at poll samples mean/p50/p95/p99: `22.658` / `16.668` / `50.005` / `83.340` ms
- QPC vblank non-monotonic count: `0`
- QPC vblank continuity anomalies: `0`
- Poll timestamp to DWM vblank p50/p95: `5.224` / `15.317` ms

## Hook vs Nearest Poll
- Matched hook samples: `57704`
- Absolute nearest-poll timing p50/p95/p99: `3.844` / `9.440` / `12.091` ms
- Position delta p50/p95/p99 for all nearest matches: `1.000` / `24.759` / `82.489` px
- Position delta p95 within 8ms: `21.000` px across `52209` hooks

## Recommended Time Split
- Clock: poll `elapsedMicroseconds`
- Train: `9807` to `1766997033` us (`1766.987`s)
- Validation: `1768001404` to `2145647570` us (`377.646`s)
- Test: `2146657102` to `2524302498` us (`377.645`s)
- Gaps: 1s between train/validation and validation/test

## Phase 2 Implications
Use poll samples as the visible-position ground truth and build labels by timestamp interpolation instead of fixed sample offsets. DWM timing is present for every poll and has a stable approximately 16.668ms refresh-period field, so Phase 2 should include `dwm-next-vblank` and latency-offset targets. The trace also has enough hook/poll divergence during motion to keep hook-derived features separate from poll-derived labels.
