# Phase 6 Experiment Log

## Scope

All writes are contained in the Phase 6 directory. Earlier phase artifacts and the two root trace ZIPs were read only.

## Reproduction

- Product trace: `cursor-mirror-trace-20260501-091537`
- Evaluated rows: 160440
- Baseline test: mean 1.367, p95 5.099, p99 29.282.
- Phase 5 best reproduction: mean 1.216, p95 4.226, p99 25.728, >5px regressions 16, applied 6.91%.

## Chronological Blocks

- V2 all-row blocks won on p99: 10/10.
- Test-slice blocks won on p99: 5/5.

| block | split | rows | baseline p99 | selected p99 | selected >5 regressions | applied |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | train | 16044 | 38.281 | 34.240 | 12 | 7.84% |
| 2 | train | 16044 | 29.009 | 25.644 | 10 | 6.52% |
| 3 | train | 16044 | 25.676 | 22.199 | 4 | 4.98% |
| 4 | train | 16044 | 28.801 | 24.296 | 12 | 7.74% |
| 5 | train | 16044 | 25.317 | 21.408 | 7 | 6.89% |
| 6 | train | 16044 | 19.061 | 16.127 | 8 | 8.15% |
| 7 | validation | 16044 | 30.566 | 26.886 | 11 | 8.25% |
| 8 | validation | 16044 | 19.599 | 15.411 | 7 | 4.26% |
| 9 | test | 16044 | 22.621 | 19.059 | 3 | 6.66% |
| 10 | test | 16044 | 37.582 | 30.739 | 13 | 6.61% |

## Stricter Variants

- Variants evaluated: 176
- Safest candidate: `p6_vector_cap_5`, p99 27.111 vs baseline 29.282, >5px regressions 0, applied 6.91%.

Top safety-scored variants:

| id | kind | p99 | high-risk avg p95 | >5 regressions | applied |
| --- | --- | ---: | ---: | ---: | ---: |
| `p6_combo_p0_65_sh0_15_vc1_rc0_5` | combined_near_zero_regression | 28.676 | 66.072 | 0 | 3.74% |
| `p6_combo_p0_65_sh0_15_vc1_rc0_25` | combined_near_zero_regression | 28.676 | 66.072 | 0 | 3.74% |
| `p6_combo_p0_85_sh0_25_vc2_rc0_5` | combined_near_zero_regression | 28.601 | 65.928 | 0 | 2.01% |
| `p6_combo_p0_85_sh0_25_vc2_rc0_25` | combined_near_zero_regression | 28.601 | 65.949 | 0 | 2.01% |
| `p6_combo_p0_85_sh0_15_vc5_rc0_5` | combined_near_zero_regression | 28.637 | 65.827 | 0 | 2.01% |
| `p6_combo_p0_85_sh0_15_vc5_rc0_25` | combined_near_zero_regression | 28.637 | 65.827 | 0 | 2.01% |
| `p6_combo_p0_85_sh0_15_vc3_rc0_5` | combined_near_zero_regression | 28.676 | 65.890 | 0 | 2.01% |
| `p6_combo_p0_85_sh0_15_vc3_rc0_25` | combined_near_zero_regression | 28.676 | 65.890 | 0 | 2.01% |
| `p6_combo_p0_65_sh0_15_vc1_rc0_1` | combined_near_zero_regression | 28.907 | 66.077 | 0 | 3.74% |
| `p6_combo_p0_65_sh0_25_vc1_rc0_5` | combined_near_zero_regression | 28.672 | 66.062 | 0 | 3.74% |
| `p6_combo_p0_65_sh0_25_vc1_rc0_25` | combined_near_zero_regression | 28.672 | 66.062 | 0 | 3.74% |
| `p6_combo_p0_85_sh0_15_vc2_rc0_5` | combined_near_zero_regression | 28.676 | 66.041 | 0 | 2.01% |

## Regression Inspection

- Selected candidate >5px regressions: 16
- Cause counts: `{"high_speed":16,"hook_poll_disagreement_5px_plus":14,"poll_jitter_4ms_plus":13,"correction_overshoot":11,"long_dwm_horizon":9,"correction_wrong_direction":8,"high_acceleration":8,"low_baseline_error_visible_introduction":8,"stop_settle":7,"correction_exceeds_baseline_step":2}`