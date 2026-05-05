# Step 01 Report: Baseline Audit

## Inputs

- Source traces read in place: `cursor-mirror-motion-recording-20260504-070248.zip`, `cursor-mirror-motion-recording-20260504-070307.zip`
- Replay rows: `90522`
- Reference rows: `492800`
- Product model: `mlp_fsmn_h8_hardtanh_label_q0p125_lag0`, lag `0px`

## Candidate Comparison

| candidate | MAE | RMSE | p95 | p99 | events | peakLead p99 | peakLead max | return max | OTR >1 | us/pred |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| constant_velocity_default_offset2 | 0.941 | 2.241 | 2.828 | 8.546 | 340 | 23.882 | 24 | 24 | 35.294% | 1.912 |
| least_squares_default_offset2 | 0.674 | 2.024 | 2.711 | 7.443 | 340 | 12.086 | 18.297 | 18.299 | 39.706% | 3.514 |
| distilled_mlp_lag0_offset_minus4 | 0.075 | 0.541 | 0.415 | 1.555 | 623 | 1.517 | 2.441 | 2.491 | 1.124% | 1.785 |
| distilled_mlp_lag0_offset_minus4_post_stop_brake | 0.074 | 0.54 | 0.407 | 1.537 | 623 | 0 | 0 | 0 | 0% | 1.596 |

## Findings

The current product-equivalent `distilled_mlp_lag0_offset_minus4_post_stop_brake` is the best audited baseline. It preserves the low normal visual error of DistilledMLP and drives the detected stop-event peakLead, peakDistance, returnMotion, and overshoot-then-return rates to zero on this replay pair.

Without the post-stop brake, DistilledMLP still leaks sparse event-window failures: peakLead max `2.441px`, returnMotion max `2.491px`, OTR >1 `1.124%`.

ConstantVelocity and LeastSquares reproduce the broad overshoot-then-return failure strongly, but their error magnitudes are much worse than the current DistilledMLP path.

## Caveat

This Step 01 audit only covers the latest two 60Hz recordings used by v18. Because the user still reports abrupt-stop overshoot in the live product path, v19 must add targeted scenario reproduction and richer failure signatures before declaring the runtime brake final.
