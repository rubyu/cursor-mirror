# Cursor Prediction v10 Phase 1 Baselines

Generated: 2026-05-03T08:04:12.280Z

Baseline equivalent: `constant_velocity_last2_cap24`

Evaluated rows: 768000

## Candidates

| candidate | family | baseline | mean | rmse | p50 | p90 | p95 | p99 | max | >5px regressions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| least_squares_w50_cap24 | least_squares_window |  | 1.209 | 2.235 | 0.528 | 3.273 | 4.599 | 7.731 | 95.436 | 978 |
| least_squares_w100_cap24 | least_squares_window |  | 1.312 | 2.420 | 0.628 | 3.342 | 4.528 | 8.533 | 96.021 | 5201 |
| alpha_beta_a0p60_b0p12_cap24 | alpha_beta |  | 1.306 | 2.366 | 0.594 | 3.504 | 4.939 | 8.001 | 95.611 | 2094 |
| alpha_beta_a0p80_b0p25_cap24 | alpha_beta |  | 1.411 | 2.609 | 0.537 | 4.092 | 5.918 | 9.370 | 95.401 | 639 |
| least_squares_w160_cap24 | least_squares_window |  | 1.641 | 3.118 | 0.796 | 3.884 | 5.445 | 12.587 | 102.529 | 17050 |
| hold_last | hold_last |  | 3.631 | 5.676 | 2.307 | 8.101 | 11.229 | 21.290 | 119.213 | 88140 |
| constant_velocity_last2_cap24 | constant_velocity_last2 | yes | 3.099 | 6.481 | 0.522 | 10.724 | 16.382 | 26.273 | 95.278 | 0 |
| constant_velocity_last2_cap48 | constant_velocity_last2 |  | 3.146 | 6.718 | 0.522 | 10.665 | 16.442 | 28.120 | 71.386 | 4310 |

## Missing-History Robustness

| candidate | scenario | mean | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| least_squares_w50_cap24 | clean | 1.166 | 4.340 | 7.064 | 95.436 |
| least_squares_w50_cap24 | missing_10pct | 1.204 | 4.585 | 7.628 | 95.421 |
| least_squares_w50_cap24 | missing_25pct | 1.256 | 4.900 | 8.359 | 95.358 |
| least_squares_w100_cap24 | clean | 1.306 | 4.402 | 8.555 | 96.021 |
| least_squares_w100_cap24 | missing_10pct | 1.311 | 4.524 | 8.503 | 96.014 |
| least_squares_w100_cap24 | missing_25pct | 1.320 | 4.659 | 8.544 | 95.869 |
| alpha_beta_a0p60_b0p12_cap24 | clean | 1.255 | 4.793 | 7.579 | 95.511 |
| alpha_beta_a0p60_b0p12_cap24 | missing_10pct | 1.296 | 4.917 | 7.935 | 95.591 |
| alpha_beta_a0p60_b0p12_cap24 | missing_25pct | 1.367 | 5.116 | 8.427 | 95.611 |
| alpha_beta_a0p80_b0p25_cap24 | clean | 1.396 | 5.899 | 9.231 | 95.372 |
| alpha_beta_a0p80_b0p25_cap24 | missing_10pct | 1.410 | 5.921 | 9.365 | 95.401 |
| alpha_beta_a0p80_b0p25_cap24 | missing_25pct | 1.428 | 5.938 | 9.536 | 95.401 |
