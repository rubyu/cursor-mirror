# Phase 5 - Distillation

## Setup

Dependency-free Node.js CPU experiment on Windows_NT 10.0.26200 x64, Node v24.14.0. Dataset rows: 27,738 across sessions 175951: 15,828, 184947: 11,910.

Fold policy matches Phase 4: fit on the first 70% chronological block of one session, select on that session's last 30%, then evaluate on the other full session. No trace ZIPs or product source files were edited.

## Candidate Families

- `safe_ridge_residual_guarded`: retrained residual ridge with stricter caps up to 1 px.
- `piecewise_residual_table`: tiny C#-friendly residual table keyed by speed bin, acceleration or turning proxy, and scheduler lead state.
- `thresholded_piecewise_table`: same table, but cells are enabled only if validation deltas show high-confidence benefit.
- `confidence_gated_ridge`: ridge residual correction gated by speed, correction magnitude, and validation safety stats.

The optional shallow MLP was not advanced here: Phase 4's larger guarded MLP had broad small regressions, and these Phase 5 product-shaped candidates were designed to remove that failure mode before adding another neural hot path.

## Held-Out Cross-Session Metrics

| fold | model | mean/rmse/p95/p99/max | delta mean/p95/p99 | >1 worse | >3 worse | >5 worse | >1 better |
| --- | --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | current_dwm_aware_last2_gain_0_75 | 3.306 / 9.291 / 15.186 / 44.097 / 137.481 | 0.000 / 0.000 / 0.000 | 0 | 0 | 0 | 0 |
| train_175951_eval_184947 | safe_ridge_residual_guarded | 3.352 / 9.289 / 15.210 / 44.071 / 137.363 | 0.046 / 0.024 / -0.026 | 0 | 0 | 0 | 0 |
| train_175951_eval_184947 | piecewise_residual_table | 3.309 / 9.291 / 15.225 / 44.140 / 137.412 | 0.002 / 0.039 / 0.043 | 0 | 0 | 0 | 0 |
| train_175951_eval_184947 | thresholded_piecewise_table | 3.306 / 9.291 / 15.186 / 44.097 / 137.481 | 0.000 / 0.000 / 0.000 | 0 | 0 | 0 | 0 |
| train_175951_eval_184947 | confidence_gated_ridge | 3.306 / 9.291 / 15.186 / 44.097 / 137.481 | 0.000 / 0.000 / 0.000 | 0 | 0 | 0 | 0 |
| train_184947_eval_175951 | current_dwm_aware_last2_gain_0_75 | 1.285 / 7.262 / 5.251 / 20.866 / 480.667 | 0.000 / 0.000 / 0.000 | 0 | 0 | 0 | 0 |
| train_184947_eval_175951 | safe_ridge_residual_guarded | 1.402 / 7.263 / 5.237 / 20.838 / 480.420 | 0.117 / -0.014 / -0.028 | 0 | 0 | 0 | 0 |
| train_184947_eval_175951 | piecewise_residual_table | 1.299 / 7.265 / 5.337 / 21.002 / 480.667 | 0.014 / 0.086 / 0.136 | 33 | 0 | 0 | 0 |
| train_184947_eval_175951 | thresholded_piecewise_table | 1.285 / 7.262 / 5.251 / 20.866 / 480.667 | 0.000 / 0.000 / 0.000 | 0 | 0 | 0 | 0 |
| train_184947_eval_175951 | confidence_gated_ridge | 1.285 / 7.262 / 5.251 / 20.866 / 480.667 | 0.000 / 0.000 / 0.000 | 0 | 0 | 0 | 0 |

## Aggregate

| model | delta mean | delta p95 | delta p99 | total >1 worse | total >3 worse | total >5 worse | total >1 better | params | C# complexity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current_dwm_aware_last2_gain_0_75 | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 | 0 | 1 | already implemented |
| thresholded_piecewise_table | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 | 0 | 2 | low: small keyed table with active-cell guard |
| confidence_gated_ridge | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 | 0 | 156 | moderate: feature normalization plus simple gate |
| safe_ridge_residual_guarded | 0.081 | 0.005 | -0.027 | 0 | 0 | 0 | 0 | 156 | moderate: feature normalization and dot products |
| piecewise_residual_table | 0.008 | 0.062 | 0.090 | 33 | 0 | 0 | 0 | 250 | low: small keyed table |

## Validation-Selected Parameters

| fold | model | selected parameters | validation delta mean/p95/p99 | validation >3 worse | validation >5 worse |
| --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | safe_ridge_residual_guarded | {"lambda":1,"capPx":0.125} | 0.076 / -0.043 / 0.077 | 0 | 0 |
| train_175951_eval_184947 | piecewise_residual_table | {"shape":"speed_accel_lead","capPx":0.125,"shrinkage":200,"minN":50} | 0.003 / -0.022 / 0.098 | 0 | 0 |
| train_175951_eval_184947 | thresholded_piecewise_table | {"shape":"speed_accel_lead","capPx":0.125,"shrinkage":10,"minValidationN":8,"minMeanBenefitPx":0.025,"maxP95DeltaPx":0.05,"maxDeltaPx":0.25,"activeCells":0} | 0.000 / 0.000 / 0.000 | 0 | 0 |
| train_175951_eval_184947 | confidence_gated_ridge | {"lambda":0.01,"capPx":0.125,"minSpeedBin":"250-500 px/s","minCorrectionPx":0.05,"minMeanBenefitPx":0.025,"enabled":false} | 0.000 / 0.000 / 0.000 | 0 | 0 |
| train_184947_eval_175951 | safe_ridge_residual_guarded | {"lambda":0.01,"capPx":0.25} | 0.053 / 0.009 / -0.103 | 0 | 0 |
| train_184947_eval_175951 | piecewise_residual_table | {"shape":"speed_accel_turn_lead","capPx":1,"shrinkage":10,"minN":20} | 0.027 / -0.039 / -0.318 | 0 | 0 |
| train_184947_eval_175951 | thresholded_piecewise_table | {"shape":"speed_turn_lead","capPx":0.125,"shrinkage":10,"minValidationN":8,"minMeanBenefitPx":0.025,"maxP95DeltaPx":0.05,"maxDeltaPx":0.25,"activeCells":1} | -0.000 / 0.000 / 0.000 | 0 | 0 |
| train_184947_eval_175951 | confidence_gated_ridge | {"lambda":0.01,"capPx":0.125,"minSpeedBin":"250-500 px/s","minCorrectionPx":0.05,"minMeanBenefitPx":0.025,"enabled":false} | 0.000 / 0.000 / 0.000 | 0 | 0 |

## Speed-Bin Breakdown For Best Distilled Candidate

| fold | speed bin | n | mean | p95 | p99 | >1 worse | >3 worse | >5 worse |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | >=2000 px/s | 2,238 | 12.603 | 43.785 | 80.529 | 0 | 0 | 0 |
| train_175951_eval_184947 | 0-25 px/s | 4,480 | 0.268 | 0.125 | 1.957 | 0 | 0 | 0 |
| train_175951_eval_184947 | 100-250 px/s | 964 | 0.711 | 2.993 | 6.856 | 0 | 0 | 0 |
| train_175951_eval_184947 | 1000-2000 px/s | 1,433 | 4.146 | 14.329 | 22.784 | 0 | 0 | 0 |
| train_175951_eval_184947 | 25-100 px/s | 677 | 0.276 | 0.956 | 2.687 | 0 | 0 | 0 |
| train_175951_eval_184947 | 250-500 px/s | 911 | 1.196 | 4.641 | 10.154 | 0 | 0 | 0 |
| train_175951_eval_184947 | 500-1000 px/s | 1,207 | 2.164 | 7.835 | 12.909 | 0 | 0 | 0 |
| train_184947_eval_175951 | >=2000 px/s | 872 | 12.157 | 40.471 | 92.946 | 0 | 0 | 0 |
| train_184947_eval_175951 | 0-25 px/s | 9,323 | 0.321 | 0.250 | 1.160 | 0 | 0 | 0 |
| train_184947_eval_175951 | 100-250 px/s | 1,346 | 0.598 | 1.944 | 4.981 | 0 | 0 | 0 |
| train_184947_eval_175951 | 1000-2000 px/s | 991 | 3.785 | 11.096 | 17.756 | 0 | 0 | 0 |
| train_184947_eval_175951 | 25-100 px/s | 1,315 | 0.341 | 0.978 | 2.109 | 0 | 0 | 0 |
| train_184947_eval_175951 | 250-500 px/s | 996 | 1.509 | 4.090 | 11.533 | 0 | 0 | 0 |
| train_184947_eval_175951 | 500-1000 px/s | 985 | 2.123 | 6.691 | 15.169 | 0 | 0 | 0 |

## Recommendation

Selection rule: Select a distilled model only if it has zero >5px regressions, preferably zero >3px regressions, p95 delta <= +0.05 px, negative average p99 delta, and no fold with material p99 worsening.

Selected: `safe_ridge_residual_guarded`.

`safe_ridge_residual_guarded` passes the stricter Phase 5 rule and is the implementation candidate. The win is still small, so it should ship only behind a feature flag and with trace collection left on.
