# Phase 2 - Deterministic Candidate Search

## Purpose

This phase tests lightweight, product-shaped deterministic candidates now that the runtime input cadence is DWM-synchronized.

## Candidate Ranking

| Candidate | Family | mean | p95 | p99 | p99 delta | >5px regressions | low-speed >5px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dwm_gain_0_800 | gain_grid_fine | 1.443 | 6.489 | 22.489 | -0.484 | 4 | 0 |
| runtime_baseline_dwm_last2_gain_0_75 | baseline | 1.428 | 6.410 | 22.973 | 0.000 | 0 | 0 |
| last3_accel_gain_0_25 | acceleration | 1.423 | 6.373 | 23.008 | 0.036 | 2 | 0 |
| dwm_gain_0_725 | gain_grid_fine | 1.422 | 6.375 | 23.521 | 0.548 | 1 | 0 |
| last3_accel_gain_0_50 | acceleration | 1.422 | 6.368 | 23.688 | 0.716 | 9 | 2 |
| dwm_gain_0_875 | gain_grid | 1.468 | 6.729 | 23.801 | 0.828 | 11 | 0 |
| dwm_gain_0_700 | gain_grid_fine | 1.416 | 6.392 | 24.032 | 1.060 | 7 | 0 |
| dwm_gain_1_00 | gain_grid | 1.525 | 7.123 | 24.517 | 1.544 | 48 | 0 |
| dwm_gain_0_675 | gain_grid_fine | 1.410 | 6.293 | 24.620 | 1.648 | 11 | 0 |
| dwm_gain_0_50 | gain_grid | 1.383 | 5.870 | 24.785 | 1.812 | 47 | 0 |

## Decision

Best raw candidate by p99: `dwm_gain_0_800`.

Baseline rank by p99: `2`.

Selected product candidate: `runtime_baseline_dwm_last2_gain_0_75`.

The best raw candidate improves p99 by only 0.484 px and adds 4 pointwise >5px regressions. That fails the default-on guard, so keep the current predictor shape.

## Interpretation

With scheduler-backed runtime samples, the prediction horizon is often short, and the current gain is already conservative. The search mainly checks whether further damping helps late or long-horizon frames. The deciding factor is not just p99: any candidate that improves a small tail while adding visible low-speed regressions should stay out of the default path.
