# Phase 2 - Deterministic Candidate Search

## Purpose

This phase tests lightweight, product-shaped deterministic candidates now that the runtime input cadence is DWM-synchronized.

## Candidate Ranking

| Candidate | Family | mean | p95 | p99 | p99 delta | >5px regressions | low-speed >5px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dwm_gain_0_575 | gain_grid_fine | 1.651 | 4.722 | 30.971 | -0.089 | 103 | 0 |
| dwm_gain_0_800 | gain_grid_fine | 1.724 | 5.238 | 31.045 | -0.015 | 30 | 0 |
| runtime_baseline_dwm_last2_gain_0_75 | baseline | 1.707 | 5.165 | 31.061 | 0.000 | 0 | 0 |
| last3_accel_gain_0_25 | acceleration | 1.731 | 5.144 | 31.102 | 0.041 | 59 | 12 |
| dwm_gain_0_625 | gain_grid | 1.666 | 4.881 | 31.103 | 0.043 | 55 | 0 |
| dwm_gain_0_50 | gain_grid | 1.631 | 4.472 | 31.133 | 0.072 | 164 | 0 |
| horizon_ge_12ms_gain_0_50 | horizon_threshold | 1.704 | 5.196 | 31.139 | 0.078 | 95 | 0 |
| horizon_ge_8ms_gain_0_50 | horizon_threshold | 1.709 | 5.201 | 31.160 | 0.099 | 112 | 0 |
| dwm_gain_0_675 | gain_grid_fine | 1.682 | 5.000 | 31.175 | 0.114 | 26 | 0 |
| dwm_gain_0_700 | gain_grid_fine | 1.690 | 5.000 | 31.240 | 0.180 | 14 | 0 |

## Decision

Best raw candidate by p99: `dwm_gain_0_575`.

Baseline rank by p99: `3`.

Selected product candidate: `runtime_baseline_dwm_last2_gain_0_75`.

The best raw candidate improves p99 by only 0.089 px and adds 103 pointwise >5px regressions. That fails the default-on guard, so keep the current predictor shape.

## Interpretation

With scheduler-backed runtime samples, the prediction horizon is often short, and the current gain is already conservative. The search mainly checks whether further damping helps late or long-horizon frames. The deciding factor is not just p99: any candidate that improves a small tail while adding visible low-speed regressions should stay out of the default path.
