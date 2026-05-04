# Step 03 - Lag And Deceleration Ablation

## Scope

This step keeps the v16 DistilledMLP weights fixed and evaluates lag-compensation and runtime-safe deceleration guards with CPU inference only. No GPU learning was run.

## Inputs

- Dataset rows: 90621
- Runtime descriptor: `poc\cursor-prediction-v16\runtime\selected-candidate.json`
- Base model: `mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5`
- Slice counts: `{'all': 90621, 'stopApproach': 1994, 'hardStopApproach': 645, 'postStopHold': 14353, 'directionFlip': 19}`
- Guard trigger counts: `{'runtimeSharpDrop': 3613, 'runtimeShrinkingPath': 19725, 'runtimeDecel': 3040, 'runtimeDecelCapacity': 2872, 'oracleFutureStopDiagnostic': 1994, 'oracleHardStopDiagnostic': 645, 'nearStopHoldRuntime': 56923}`

## Ranking

| candidate | guard kind | product safe | all p95 | all p99 | stop p95 | stop p99 | stop signed | stop over p95 | stop over p99 | over >1 | over >2 | hard over p95 | post jitter p95 | flip penalty p95 | objective |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| mlp_lag0p0_q0p125 | lag_ablation | True | 1.8916 | 4.5434 | 13.3899 | 29.4379 | -1.4397 | 3.273 | 5.288 | 0.209127 | 0.106319 | 3.4468 | 0.375 | 25.2779 | 6.769309 |
| oracle_remove_lag_on_future_stop | diagnostic_remove_lag_when_future_label_stop | False | 1.8911 | 4.3386 | 13.3899 | 29.4379 | -1.4397 | 3.273 | 5.288 | 0.209127 | 0.106319 | 3.4468 | 0.7563 | 25.3279 | 6.781489 |
| mlp_lag0p125_q0p125 | lag_ablation | True | 1.8792 | 4.4878 | 13.265 | 29.3135 | -1.3147 | 3.398 | 5.413 | 0.225677 | 0.117352 | 3.5718 | 0.4507 | 25.4029 | 6.994899 |
| mlp_lag0p25_q0p125 | lag_ablation | True | 1.8792 | 4.4299 | 13.1527 | 29.1892 | -1.1897 | 3.523 | 5.538 | 0.247242 | 0.124875 | 3.6968 | 0.5245 | 25.5279 | 7.217093 |
| remove_lag_on_runtime_decel | remove_lag_when_decelerating | True | 1.8916 | 4.3103 | 13.2238 | 29.4048 | -1.1448 | 3.5409 | 5.288 | 0.26329 | 0.12989 | 3.7954 | 0.7563 | 25.3279 | 7.299785 |
| remove_lag_on_runtime_decel_capacity | remove_lag_when_prediction_exceeds_recent_capacity | True | 1.8916 | 4.3103 | 13.2238 | 29.4048 | -1.1395 | 3.5409 | 5.288 | 0.263791 | 0.12989 | 3.7954 | 0.7563 | 25.3279 | 7.300536 |
| v16_selected_lag0p5_q0p125 | lag_ablation | True | 1.8975 | 4.3629 | 12.9103 | 29.0009 | -0.9397 | 3.773 | 5.788 | 0.2999 | 0.153962 | 3.9468 | 0.7563 | 25.7779 | 7.812934 |
| along_clamp8_on_runtime_decel | along_motion_clamp_8ms_capacity | True | 1.8792 | 4.5794 | 16.5874 | 32.1071 | -1.9554 | 2.0893 | 3.6363 | 0.145436 | 0.056169 | 2.6381 | 0.7563 | 20.7204 | 17.324522 |
| along_clamp8_on_runtime_decel_capacity | along_motion_clamp_when_prediction_exceeds_capacity | True | 1.8792 | 4.5794 | 16.5874 | 32.1071 | -1.9554 | 2.0893 | 3.6363 | 0.145436 | 0.056169 | 2.6381 | 0.7563 | 20.7204 | 17.324522 |
| zero_on_runtime_decel | zero_hold_when_runtime_decelerating | True | 1.8792 | 4.5837 | 16.846 | 32.3422 | -2.0558 | 2.0847 | 3.6363 | 0.14343 | 0.055667 | 2.6381 | 0.7563 | 20.4954 | 18.406889 |
| zero_on_runtime_decel_capacity | zero_hold_when_prediction_exceeds_recent_capacity | True | 1.8792 | 4.5837 | 16.846 | 32.3422 | -2.0559 | 2.0847 | 3.6363 | 0.143932 | 0.055667 | 2.6381 | 0.7563 | 20.4954 | 18.407692 |
| short_cv8_on_runtime_decel | short_constant_velocity_8ms_when_decelerating | True | 1.8792 | 4.5837 | 16.846 | 32.3422 | -2.053 | 2.0893 | 3.6363 | 0.144433 | 0.056169 | 2.6381 | 0.7563 | 20.4954 | 18.412597 |
| short_cv4_on_runtime_decel | short_constant_velocity_4ms_when_decelerating | True | 1.8792 | 4.5837 | 16.846 | 32.3422 | -2.053 | 2.0893 | 3.6363 | 0.144433 | 0.056169 | 2.6381 | 0.7563 | 20.4954 | 18.412597 |
| step5_gate | baseline | True | 2.1269 | 5.7868 | 15.916 | 31.2828 | -1.1979 | 3.2887 | 4.86 | 0.565697 | 0.175527 | 4.0844 | 0.0839 | 23.8979 | 19.16484 |
| oracle_zero_on_future_stop | diagnostic_zero_when_future_label_stop | False | 1.8792 | 4.5014 | 17.2267 | 33.3467 | -2.873 | 0.0 | 0.0 | 0.006018 | 0.003511 | 0.0 | 0.7563 | 20.4954 | 16015.236689 |

## Best Candidate

Selected for Step 4 consideration: `mlp_lag0p0_q0p125`.

- Runtime note: `{'kind': 'lag_ablation', 'productSafe': True, 'extraBranchesEstimate': 0, 'state': 'stateless', 'allocationRisk': 'none; vector math can be stack/local scalar operations'}`
- Summary: `{'allP95': 1.8916, 'allP99': 4.5434, 'stopP95': 13.3899, 'stopP99': 29.4379, 'stopSignedMean': -1.4397, 'stopOvershootP95': 3.273, 'stopOvershootP99': 5.288, 'stopOvershootGt1': 0.209127, 'stopOvershootGt2': 0.106319, 'hardStopP95': 16.5429, 'hardStopP99': 28.7619, 'hardStopOvershootP95': 3.4468, 'hardStopOvershootP99': 5.7633, 'hardStopOvershootGt1': 0.234109, 'hardStopOvershootGt2': 0.128682, 'postStopJitterP95': 0.375, 'postStopJitterP99': 1.1319, 'directionFlipPenaltyP95': 25.2779, 'directionFlipRows': 19}`

## Interpretation

Best product-safe Step 3 candidate is mlp_lag0p0_q0p125. Versus v16 selected, stop overshoot p95 delta is -0.5px, post-stop jitter p95 delta is -0.3813px, and all p95 delta is -0.0059px. This is a plausible Step 4 runtime guard candidate.

## Caveats

- Label/future-speed diagnostic variants are included only to bound possible improvement; they are marked non-product-safe.
- Direction-flip slice is small, so it is a guardrail rather than the primary objective.
- This does not retrain the MLP; it only changes post-processing.
