# Phase 1 Report: Reference Baseline Audit

## Decision Summary

Remaining error is dominated by product poll cadence and extrapolation over long/irregular horizons, with high-speed motion and stop-entry overshoot forming the visible tail. Reference-label quality looks strong for the scored anchors: target labels are almost always bracketed by dense `referencePoll` samples, and error does not concentrate in poor reference-coverage bins. DWM timing is available for all product polls, but the DWM horizon varies enough that longer horizons amplify last2 model error.

Hook/poll disagreement is reconstructible as the distance from each product poll to the latest hook sample. Large disagreement bins are sparse but high-risk; they point to product cadence/input staleness rather than label noise.

## Trace Audit

| item | value |
|---|---:|
| trace format | 3 |
| CSV rows | 975,443 |
| duration sec | 2,110.246 |
| hook moves | 51,541 |
| product polls | 99,624 |
| reference polls | 824,278 |
| product poll p50 / p95 ms | 15.923 / 63.081 |
| reference target p50 / p95 ms | 2.000 / 2.001 |
| DWM horizon p50 / p95 ms | 8.153 / 15.638 |
| stale/invalid DWM target fallbacks | 713 |

## Baseline Scores

| model | n | mean px | p50 px | p90 px | p95 px | p99 px | max px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| product DWM last2 gain 0.75 | 99,622 | 1.695 | 0.000 | 2.348 | 6.771 | 36.245 | 682.467 |
| hold current at DWM target | 99,622 | 2.444 | 0.000 | 2.828 | 10.000 | 57.057 | 522.433 |
| fixed 8ms last2 gain 0.75 | 99,623 | 1.494 | 0.000 | 2.281 | 6.146 | 31.295 | 448.368 |
| fixed 16ms last2 gain 0.75 | 99,622 | 2.877 | 0.000 | 4.636 | 12.416 | 60.463 | 799.888 |

The product baseline improves mean error by 30.6% over hold-current and improves p95 by 32.3%. Fixed 8 ms is much easier than the actual DWM target distribution; fixed 16 ms is closer to DWM p95 behavior but still does not capture the irregular poll cadence.

## Highest-Risk Slices

| slice | n | mean px | p95 px | p99 px |
| --- | --- | --- | --- | --- |
| speed: >=2000 px/s | 3,462 | 25.569 | 88.444 | 161.659 |
| speed: 1000-2000 px/s | 2,821 | 7.565 | 21.771 | 51.594 |
| speed: 500-1000 px/s | 3,254 | 4.610 | 14.631 | 34.344 |
| poll dt: >=100 ms | 72 | 6.494 | 29.313 | 133.976 |
| poll dt: 67-100 ms | 3,667 | 3.302 | 14.952 | 69.421 |
| poll dt: 0-10 ms | 16,251 | 2.103 | 7.635 | 44.701 |
| DWM horizon: 12-16.7 ms | 26,324 | 2.645 | 11.338 | 56.646 |
| DWM horizon: 8-12 ms | 24,443 | 1.722 | 7.153 | 34.243 |
| DWM horizon: 4-8 ms | 24,075 | 1.553 | 6.557 | 33.943 |
| hook/poll: >=32 px | 175 | 73.669 | 212.847 | 320.169 |
| hook/poll: 8-32 px | 509 | 19.938 | 56.445 | 97.770 |
| hook/poll: 2-8 px | 731 | 4.438 | 11.283 | 18.930 |
| stop: pre_stop_0_16ms | 22,716 | 6.499 | 28.565 | 87.138 |
| stop: stop_entry_0_16ms | 5,946 | 3.139 | 13.205 | 52.878 |
| stop: stop_settle_16_50ms | 5,944 | 0.412 | 0.939 | 7.195 |
| stop: stop_settle_50_150ms | 11,328 | 0.012 | 0.000 | 0.117 |

## Reference Quality

| reference bracket | n | baseline mean px | baseline p95 px |
| --- | --- | --- | --- |
| 0-2.1 ms | 98,244 | 1.682 | 6.746 |
| 2.1-4 ms | 293 | 0.892 | 4.854 |
| 4-8 ms | 160 | 6.371 | 39.483 |
| 8-16 ms | 248 | 1.743 | 6.119 |
| 16-50 ms | 625 | 2.801 | 9.029 |
| >=50 ms | 52 | 3.464 | 9.424 |

Reference coverage is not the main bottleneck. The dominant bracket is the expected 0-2.1 ms band, and its error profile matches the overall result. The rare wider brackets are too small to explain the baseline tail.

## Phase 2 Direction

Prioritize scheduler/input cadence and deterministic runtime features before learned residuals. The strongest next experiment is to reduce or compensate product poll staleness: sample closer to compose, carry latest hook position when available, and gate prediction on recent poll interval/hook disagreement. In parallel, test a lightweight horizon-aware damping/stop guard for the last2 model so stop-entry overshoot and long-DWM-horizon extrapolation do not dominate the p95/p99 tail.

Learned models should wait until Phase 2 has a cleaner runtime anchor story; otherwise they will mostly learn artifacts of stale product input rather than cursor motion.
