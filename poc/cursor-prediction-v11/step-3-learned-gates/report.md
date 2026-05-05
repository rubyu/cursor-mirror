# Step 3 Learned Gates

## Scope

This is a CPU-only learned pilot. It keeps the Step 1 scenario split fixed, uses Step 2's causal poll/reference evaluation contract, and writes only aggregate JSON/Markdown outputs. No GPU, large checkpoint, raw ZIP copy, or per-frame cache was produced.

The baseline/teacher is `least_squares_velocity_n12_cap64`, recorded here as `ls12_baseline`.

## Models

- `ls12_baseline`: Step 2 LS12 cap64 baseline.
- `causal_speed_gate`: validation-selected causal threshold gate over speed, stillness, and history gap.
- `ridge_residual_linear`: global ridge correction of LS12 residuals.
- `ridge_residual_segmented_horizon`: horizon-segmented ridge correction.
- `piecewise_speed_horizon_residual`: dependency-free piecewise residual table by horizon, speed bin, and scheduler-delay bin.
- `oracle_category_gate`: non-product oracle using script-derived movement category.

## Validation Best Product Models

| load   | model                            | mean px | p95 px | >5px    | >10px   |
| ------ | -------------------------------- | ------- | ------ | ------- | ------- |
| normal | ridge_residual_segmented_horizon | 1.929   | 5      | 0.05295 | 0.02336 |
| stress | ridge_residual_segmented_horizon | 1.704   | 4.75   | 0.04667 | 0.01871 |

Selected product-eligible candidate for Step 4 comparison: `ridge_residual_segmented_horizon`.

## Ridge Selection

| segment | lambda | mean px | p95 px | >5px    | >10px   |
| ------- | ------ | ------- | ------ | ------- | ------- |
| global  | 0.1    | 1.8679  | 5      | 0.05086 | 0.02127 |
| global  | 1      | 1.868   | 5      | 0.05085 | 0.02127 |
| global  | 10     | 1.8689  | 5      | 0.05084 | 0.02133 |
| global  | 100    | 1.8746  | 5      | 0.05069 | 0.02152 |
| horizon | 0.1    | 1.8165  | 4.75   | 0.04981 | 0.02103 |
| horizon | 1      | 1.8176  | 4.75   | 0.04974 | 0.02109 |
| horizon | 10     | 1.8315  | 4.75   | 0.04975 | 0.02114 |
| horizon | 100    | 1.8751  | 5      | 0.05004 | 0.02195 |

## Overall Scores

| model                            | split      | load   | count | mean px | median px | p95 px | max px   | >5px    | >10px   |
| -------------------------------- | ---------- | ------ | ----- | ------- | --------- | ------ | -------- | ------- | ------- |
| ls12_baseline                    | validation | normal | 89994 | 2.1     | 1         | 5.25   | 175.521  | 0.0566  | 0.02646 |
| ridge_residual_segmented_horizon | validation | normal | 89994 | 1.929   | 0.75      | 5      | 175.577  | 0.05295 | 0.02336 |
| oracle_category_gate             | validation | normal | 89994 | 2.102   | 1         | 5.25   | 175.935  | 0.05595 | 0.02741 |
| ls12_baseline                    | validation | stress | 90000 | 1.877   | 1         | 5      | 121.435  | 0.05152 | 0.02133 |
| ridge_residual_segmented_horizon | validation | stress | 90000 | 1.704   | 0.75      | 4.75   | 130.8    | 0.04667 | 0.01871 |
| oracle_category_gate             | validation | stress | 90000 | 2.216   | 1         | 6      | 159.38   | 0.06232 | 0.03142 |
| ls12_baseline                    | test       | normal | 89976 | 2.012   | 1         | 4.5    | 1034.302 | 0.04308 | 0.01843 |
| ridge_residual_segmented_horizon | test       | normal | 89976 | 1.846   | 0.75      | 4      | 1034.215 | 0.03453 | 0.0162  |
| oracle_category_gate             | test       | normal | 89976 | 2.066   | 1         | 4.5    | 1034.302 | 0.04332 | 0.02019 |
| ls12_baseline                    | test       | stress | 89994 | 2.081   | 1         | 5      | 954.894  | 0.05092 | 0.02012 |
| ridge_residual_segmented_horizon | test       | stress | 89994 | 1.867   | 0.75      | 4.25   | 954.894  | 0.04016 | 0.0181  |
| oracle_category_gate             | test       | stress | 89994 | 2.265   | 1         | 5.5    | 954.894  | 0.05969 | 0.02604 |

## Improvement Vs LS12

| split      | load   | LS12 p95 | candidate p95 | p95 delta | p95 improvement % | mean delta |
| ---------- | ------ | -------- | ------------- | --------- | ----------------- | ---------- |
| validation | normal | 5.25     | 5             | -0.25     | 4.762             | -0.171     |
| validation | stress | 5        | 4.75          | -0.25     | 5                 | -0.173     |
| test       | normal | 4.5      | 4             | -0.5      | 11.111            | -0.166     |
| test       | stress | 5        | 4.25          | -0.75     | 15                | -0.215     |

## Test Horizon Breakdown

| load   | horizon ms | LS12 p95 | candidate p95 | p95 delta | mean delta |
| ------ | ---------- | -------- | ------------- | --------- | ---------- |
| normal | 0          | 1.5      | 0.5           | -1        | -0.545     |
| normal | 8          | 2.5      | 2.5           | 0         | -0.07      |
| normal | 16.67      | 3        | 2.75          | -0.25     | -0.089     |
| normal | 25         | 4        | 4             | 0         | -0.076     |
| normal | 33.33      | 5        | 4.5           | -0.5      | -0.079     |
| normal | 50         | 7.25     | 6.5           | -0.75     | -0.139     |
| stress | 0          | 1.75     | 0.5           | -1.25     | -0.6       |
| stress | 8          | 3        | 3             | 0         | -0.102     |
| stress | 16.67      | 3.5      | 3.25          | -0.25     | -0.114     |
| stress | 25         | 4.25     | 4.25          | 0         | -0.123     |
| stress | 33.33      | 5.5      | 5             | -0.5      | -0.135     |
| stress | 50         | 8        | 7.25          | -0.75     | -0.215     |

## Movement Category Breakdown

| split      | load   | category | count | LS12 p95 | candidate p95 | p95 delta | mean delta |
| ---------- | ------ | -------- | ----- | -------- | ------------- | --------- | ---------- |
| validation | normal | moving   | 66126 | 5        | 4.75          | -0.25     | -0.147     |
| validation | normal | hold     | 19548 | 4        | 2.75          | -1.25     | -0.239     |
| validation | normal | resume   | 4320  | 27.5     | 27            | -0.5      | -0.227     |
| validation | stress | moving   | 65988 | 4.5      | 4.25          | -0.25     | -0.194     |
| validation | stress | hold     | 19974 | 8        | 8             | 0         | -0.117     |
| validation | stress | resume   | 4038  | 9        | 8.25          | -0.75     | -0.088     |
| test       | normal | moving   | 72714 | 4        | 3.5           | -0.5      | -0.161     |
| test       | normal | hold     | 12726 | 5.25     | 3.25          | -2        | -0.215     |
| test       | normal | resume   | 4536  | 21       | 20.75         | -0.25     | -0.117     |
| test       | stress | moving   | 71244 | 4.75     | 4.25          | -0.5      | -0.273     |
| test       | stress | hold     | 14700 | 6.25     | 5.5           | -0.75     | 0.086      |
| test       | stress | resume   | 4050  | 5        | 4.25          | -0.75     | -0.277     |

## Segment Regression Risks

| split      | load   | horizon ms | category | count | LS12 p95 | candidate p95 | p95 delta | mean delta |
| ---------- | ------ | ---------- | -------- | ----- | -------- | ------------- | --------- | ---------- |
| test       | normal | 33.33      | resume   | 756   | 29       | 31.5          | 2.5       | 0.051      |
| validation | normal | 33.33      | resume   | 720   | 36.25    | 38.5          | 2.25      | -0.067     |
| validation | stress | 8          | resume   | 673   | 7.25     | 8.75          | 1.5       | 0.127      |
| test       | normal | 16.67      | resume   | 756   | 12       | 13.5          | 1.5       | -0.013     |
| validation | normal | 25         | resume   | 720   | 25.25    | 26.75         | 1.5       | -0.112     |
| test       | normal | 50         | resume   | 756   | 47.25    | 48.75         | 1.5       | -0.114     |
| validation | stress | 33.33      | hold     | 3329  | 11       | 11.5          | 0.5       | -0.002     |
| validation | stress | 16.67      | resume   | 673   | 6.5      | 7             | 0.5       | -0.022     |
| validation | normal | 50         | resume   | 720   | 56.5     | 57            | 0.5       | -0.033     |
| validation | normal | 33.33      | moving   | 11021 | 5.75     | 6             | 0.25      | 0.007      |
| validation | stress | 16.67      | hold     | 3329  | 6.25     | 6.5           | 0.25      | -0.023     |
| validation | stress | 16.67      | moving   | 10998 | 3.5      | 3.75          | 0.25      | -0.072     |

## Interpretation

- The residual models are useful as diagnostics: they reveal whether causal scheduler/history/speed features can correct LS12 without using future labels at inference.
- The oracle category gate is intentionally non-product. In this pilot the simple oracle switch is diagnostic, not an upper bound, and it regresses versus LS12 overall.
- Any segment with positive p95 delta in the regression-risk table should be treated as a gating risk before moving to a larger FSMN/MLP search.

## Step 4 Hand-Off

For FSMN-family exploration, pass these features first: horizon, anchor-to-reference gap, LS12/LS8/last2 velocity projections, speed magnitude, acceleration estimate, history gap mean/max/std, stillness/near-zero ratios, path efficiency, scheduler delay, normalized position, and baseline displacement. Start with horizon-conditioned small models before adding load-specific or category-oracle information.
