# Cursor Prediction v9 Phase 2 Classical Baselines

Generated: 2026-05-03T04:17:02.513Z

Selection objective: minimize p95 + 0.25*p99 + 0.05*mean on train session

## Best By Fold

| fold | candidate | family | mean | p95 | p99 | max | params |
| --- | --- | --- | --- | --- | --- | --- | --- |
| train-session-1-eval-session-2 | alpha_beta_a0.9_b0.15_hcap16.67 | alpha_beta | 10.932 | 51.400 | 140.115 | 597.080 | {"alpha":0.9,"beta":0.15,"horizonCapMs":16.67,"windowMs":120,"displacementCapPx":24} |
| train-session-2-eval-session-1 | alpha_beta_a0.9_b0.35_hcap16.67 | alpha_beta | 4.413 | 18.728 | 73.322 | 590.672 | {"alpha":0.9,"beta":0.35,"horizonCapMs":16.67,"windowMs":120,"displacementCapPx":24} |

## train-session-1-eval-session-2

Train: `session-1`, eval: `session-2`

| candidate | family | role | mean | rmse | p95 | p99 | max | >1px regressions | >5px regressions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| alpha_beta_a0.9_b0.15_hcap16.67 | alpha_beta | train_selected | 10.932 | 29.665 | 51.400 | 140.115 | 597.080 | 6665 | 3208 |
| robust_polynomial_w64_hcap16.67_cap12 | robust_polynomial | train_selected | 12.639 | 31.781 | 58.929 | 148.269 | 561.083 | 12185 | 6607 |
| alpha_beta_gamma_a0.8_b0.08_g0.02_hcap16.67 | alpha_beta_gamma | train_selected | 15.805 | 33.719 | 59.655 | 150.001 | 597.079 | 16420 | 12399 |
| least_squares_w48_hcap16.67_cap12 | least_squares | train_selected | 13.518 | 32.893 | 63.032 | 152.137 | 561.081 | 12978 | 7053 |
| product_constant_velocity_v8_shape | constant_velocity | product_baseline | 13.957 | 34.152 | 65.847 | 155.872 | 573.080 | 0 | 0 |
| constant_velocity_gain1_cap12 | constant_velocity | train_selected | 13.807 | 34.375 | 66.910 | 156.354 | 573.080 | 1881 | 1303 |

## train-session-2-eval-session-1

Train: `session-2`, eval: `session-1`

| candidate | family | role | mean | rmse | p95 | p99 | max | >1px regressions | >5px regressions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| alpha_beta_a0.9_b0.35_hcap16.67 | alpha_beta | train_selected | 4.413 | 19.140 | 18.728 | 73.322 | 590.672 | 4184 | 1616 |
| robust_polynomial_w64_hcap16.67_cap24 | robust_polynomial | train_selected | 5.274 | 20.099 | 24.000 | 77.454 | 590.734 | 11266 | 5038 |
| least_squares_w48_hcap16.67_cap24 | least_squares | train_selected | 5.430 | 20.359 | 23.740 | 82.048 | 590.854 | 10455 | 4839 |
| constant_velocity_gain0p75_cap24 | constant_velocity | train_selected | 5.535 | 21.399 | 24.000 | 88.216 | 614.649 | 1155 | 350 |
| product_constant_velocity_v8_shape | constant_velocity | product_baseline | 5.560 | 21.449 | 24.000 | 88.541 | 614.649 | 0 | 0 |
| alpha_beta_gamma_a0.8_b0.08_g0.02_hcap16.67 | alpha_beta_gamma | train_selected | 7.978 | 21.720 | 28.438 | 74.031 | 590.709 | 16917 | 11999 |

