# Cursor Prediction v10 Phase 7 Real Trace

Generated: 2026-05-03T09:28:12.701Z

Input ZIPs: `cursor-mirror-trace-20260502-184947.zip`, `cursor-mirror-trace-20260502-175951.zip`, `cursor-mirror-trace-20260502-173150.zip`, `cursor-mirror-trace-20260502-165358.zip`, `cursor-mirror-trace-20260502-163258.zip`, `cursor-mirror-trace-20260502-161143.zip`. GPU used: no. Dependencies: Node.js standard library only. ZIPs were read in place; no extraction, per-frame CSV, cache, checkpoint, raw copy, or node_modules output was written.

Policy: anchors from `runtimeSelfSchedulerPoll`; history/labels from `referencePoll at or before anchor time`; fixed horizons 8.33, 16.67, 25, 33.33 ms. DWM next-vblank target was not reconstructed for this pass.

## Sessions

| session | zip | reference polls | anchors | rows | anchor p50 ms | anchor p95 ms | reference p95 ms | quality warnings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| session_1 | cursor-mirror-trace-20260502-184947.zip | 97907 | 11911 | 47636 | 16.668 | 16.777 | 2.001 | product_poll_interval_p95_exceeds_requested_interval |
| session_2 | cursor-mirror-trace-20260502-175951.zip | 122812 | 15829 | 63309 | 16.668 | 16.969 | 2.001 | product_poll_interval_p95_exceeds_requested_interval |
| session_3 | cursor-mirror-trace-20260502-173150.zip | 133611 | 0 | 0 | - | - | 2.000 | product_poll_interval_p95_exceeds_requested_interval |
| session_4 | cursor-mirror-trace-20260502-165358.zip | 141143 | 0 | 0 | - | - | 2.001 | product_poll_interval_p95_exceeds_requested_interval |
| session_5 | cursor-mirror-trace-20260502-163258.zip | 88345 | 0 | 0 | - | - | 2.000 | product_poll_interval_p95_exceeds_requested_interval |
| session_6 | cursor-mirror-trace-20260502-161143.zip | 144258 | 0 | 0 | - | - | 2.000 | product_poll_interval_p95_exceeds_requested_interval |

## Combined Metrics

| candidate | role | mean | rmse | p50 | p90 | p95 | p99 | max | >1 | >3 | >5 | >10 | mean delta | advanced/fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| constant_velocity_last2_cap24 | baseline | 17.136 | 50.560 | 1.025 | 43.775 | 84.025 | 240.025 | 962.266 | 0 | 0 | 0 | 0 | 0.000 | 0/110945 |
| least_squares_w50_cap36 | raw | 16.015 | 46.474 | 2.025 | 36.025 | 69.625 | 219.275 | 926.857 | 25329 | 18751 | 15575 | 10866 | -1.121 | 110945/0 |
| phase4_strict | gate | 17.632 | 50.529 | 2.025 | 43.425 | 83.525 | 238.175 | 962.266 | 8011 | 4665 | 3428 | 2085 | 0.496 | 60372/50573 |
| phase4_balanced | gate | 17.229 | 50.299 | 1.925 | 41.675 | 82.975 | 238.275 | 962.266 | 11400 | 7217 | 5492 | 3297 | 0.093 | 77135/33810 |

## Synthetic Direction Check

| bucket | synthetic mean delta | synthetic >5/>10 | real mean delta | real >5/>10 | same direction |
| --- | --- | --- | --- | --- | --- |
| strict | -0.032 | 0/0 | 0.496 | 3428/2085 | no |
| balanced | -0.057 | 30/0 | 0.093 | 5492/3297 | no |

## Judgment

Recommendation: `fix_synthetic_distribution_before_calibrator`.

Phase6 strict distillation was omitted because the existing phase6 artifact intentionally keeps only coefficient samples, not the full trained residual heads needed for exact replay on real traces.
