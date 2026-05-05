# Step 02 - Overshoot Metrics

## Scope

This step defines and computes stop/overshoot diagnostics for Step5 and the v16 selected DistilledMLP runtime candidate. It reads 60Hz MotionLab rows in place and performs CPU inference only.

## Metric Definitions

- `signedAlongMotionError`: dot product of prediction error `(prediction - target)` with the recent motion direction. Positive means lead/overshoot; negative means lag.
- `overshootPx`: `max(0, signedAlongMotionError)`.
- `overshootRateGt0p5/Gt1/Gt2`: fraction of rows whose overshoot exceeds 0.5, 1.0, or 2.0 px.
- `stopApproach`: recent v12 speed >= 500 px/s and future label speed is low or sharply lower.
- `hardStopApproach`: recent v12 speed >= 1000 px/s and label speed <= 100 px/s.
- `postStopJitter`: prediction magnitude during low-speed hold rows.
- `directionFlipPenalty`: residual prediction component in the old motion direction on direction-flip rows.

## Dataset

- Rows: 90621
- Splits: `{'test': 14174, 'validation': 14220, 'train': 62227}`
- Packages: `{'m070248': 45855, 'm070307': 44766}`
- Slice counts: `{'all': 90621, 'stopApproach': 1994, 'hardStopApproach': 645, 'postStopHold': 14353, 'directionFlip': 19}`

## Stop-Approach Summary

| model | stop rows | stop p95 | stop p99 | signed mean | overshoot p95 | overshoot >1px | post-stop jitter p95 | flip penalty p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| step5_gate | 1994 | 15.916 | 31.2828 | -1.1979 | 3.2887 | 0.565697 | 0.0839 | 23.8979 |
| mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5 | 1994 | 12.9103 | 29.0009 | -0.9397 | 3.773 | 0.2999 | 0.7563 | 25.7779 |

## Initial Read

DistilledMLP shows higher stop-approach overshoot p95 than Step5 by 0.4843px; v17 should prioritize deceleration/lag-compensation gating.
