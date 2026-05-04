# Cursor Prediction v10 Phase 2 Safe Gates

Generated: 2026-05-03T08:12:55.220Z

Best safe gate: `safe_gate_blend_cv_ls_w50_cap24_ls0p5_g3`.

Selection: mean + 0.50*p95 + 0.25*p99 + 90*worseOver5Rate

## Top Gates

| gate | mean | p95 | p99 | max | >5px reg | >10px reg | advanced/fallback | safe score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| safe_gate_blend_cv_ls_w50_cap24_ls0p5_g3 | 10.941 | 38.175 | 75.475 | 694.357 | 914 | 11 | 1362204/2477796 | 48.919 |
| safe_gate_blend_cv_ls_w50_cap24_ls0p5_g5 | 10.944 | 38.175 | 75.475 | 694.357 | 1230 | 16 | 1409736/2430264 | 48.929 |
| safe_gate_blend_cv_ls_w50_cap24_ls0p5_g4 | 10.937 | 38.225 | 75.475 | 694.357 | 515 | 4 | 1287492/2552508 | 48.930 |
| safe_gate_blend_cv_ls_w50_cap24_ls0p5_g2 | 10.958 | 38.175 | 75.475 | 694.357 | 2180 | 32 | 2161188/1678812 | 48.966 |
| safe_gate_least_squares_w50_cap24_g4 | 10.973 | 38.225 | 75.475 | 694.357 | 4137 | 621 | 1287492/2552508 | 49.051 |
| safe_gate_blend_cv_ls_w50_cap24_ls0p5_g1 | 10.962 | 38.175 | 75.475 | 694.357 | 5908 | 103 | 2336364/1503636 | 49.057 |
| safe_gate_least_squares_w50_cap24_g3 | 10.987 | 38.225 | 75.475 | 694.357 | 7267 | 1063 | 1362204/2477796 | 49.139 |
| safe_gate_least_squares_w50_cap24_g5 | 10.999 | 38.175 | 75.475 | 694.357 | 11323 | 1442 | 1409736/2430264 | 49.221 |
| safe_gate_least_squares_w70_cap24_g4 | 11.031 | 38.225 | 75.475 | 694.357 | 17449 | 3528 | 1287492/2552508 | 49.421 |
| safe_gate_least_squares_w50_cap24_g2 | 11.047 | 38.175 | 75.475 | 694.357 | 21400 | 2547 | 2161188/1678812 | 49.505 |
| safe_gate_least_squares_w70_cap24_g3 | 11.058 | 38.225 | 75.475 | 694.357 | 26724 | 5222 | 1362204/2477796 | 49.666 |
| safe_gate_least_squares_w70_cap24_g5 | 11.080 | 38.225 | 75.475 | 694.357 | 36406 | 7002 | 1409736/2430264 | 49.914 |

The winning gate keeps the advanced predictor only when history is sufficiently dense and recent motion is not dominated by high acceleration, high curvature, very small edge distance, or the noisiest missing-history scenario. The fallback remains `constant_velocity_last2_cap24`.
