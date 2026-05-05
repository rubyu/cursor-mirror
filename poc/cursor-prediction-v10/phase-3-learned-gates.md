# Cursor Prediction v10 Phase 3 Learned Gates

Generated: 2026-05-03T08:41:50.992Z

Canonical input: `runs/scripts.synthetic.phase2.jsonl`. GPU used: no. Dependencies: Node.js standard library only. No per-frame CSV, raw ZIP, cache, checkpoint, or node_modules output was written.

## Split

| split | scripts | rows |
| --- | ---: | ---: |
| train | 3500 | 1344000 |
| validation | 750 | 288000 |
| test | 750 | 288000 |

## Best Gate

Selected gate: `score_least_squares_w50_cap36_5` (monotonic_score) using `least_squares_w50_cap36`.

Test metrics: mean/p95/p99/max 10.375 / 37.175 / 74.325 / 399.790 px. Regressions: >5px 0, >10px 0. Gate use: 29302 advanced / 258698 fallback.

Phase2 fixed safe gate on the same test split: mean/p95/p99/max 10.432 / 37.225 / 74.375 / 399.790 px, >5px 70, >10px 1.

## Top Validation Gates

| gate | family | candidate | val mean | val p95 | val p99 | val >5 | val >10 | test mean | test p95 | test p99 | test >5 | test >10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| score_least_squares_w50_cap36_5 | monotonic_score | least_squares_w50_cap36 | 11.599 | 39.325 | 73.425 | 0 | 0 | 10.375 | 37.175 | 74.325 | 0 | 0 |
| score_least_squares_w50_cap36_3 | monotonic_score | least_squares_w50_cap36 | 11.598 | 39.375 | 73.425 | 0 | 0 | 10.374 | 37.175 | 74.325 | 0 | 0 |
| score_least_squares_w50_cap36_4 | monotonic_score | least_squares_w50_cap36 | 11.598 | 39.375 | 73.425 | 0 | 0 | 10.375 | 37.175 | 74.325 | 0 | 0 |
| score_least_squares_w50_cap36_2 | monotonic_score | least_squares_w50_cap36 | 11.600 | 39.375 | 73.425 | 0 | 0 | 10.368 | 37.175 | 74.325 | 0 | 0 |
| score_least_squares_w50_cap36_8 | monotonic_score | least_squares_w50_cap36 | 11.601 | 39.375 | 73.425 | 0 | 0 | 10.369 | 37.175 | 74.325 | 0 | 0 |
| score_least_squares_w50_cap36_6 | monotonic_score | least_squares_w50_cap36 | 11.603 | 39.375 | 73.425 | 0 | 0 | 10.376 | 37.175 | 74.325 | 0 | 0 |
| score_least_squares_w50_cap36_1 | monotonic_score | least_squares_w50_cap36 | 11.586 | 39.375 | 73.525 | 0 | 0 | 10.365 | 37.175 | 74.325 | 0 | 0 |
| score_least_squares_w50_cap36_10 | monotonic_score | least_squares_w50_cap36 | 11.601 | 39.375 | 73.525 | 0 | 0 | 10.372 | 37.175 | 74.325 | 0 | 0 |
| score_least_squares_w50_cap36_9 | monotonic_score | least_squares_w50_cap36 | 11.601 | 39.375 | 73.525 | 0 | 0 | 10.374 | 37.175 | 74.375 | 0 | 0 |
| score_least_squares_w50_cap36_7 | monotonic_score | least_squares_w50_cap36 | 11.610 | 39.375 | 73.525 | 0 | 0 | 10.381 | 37.175 | 74.325 | 0 | 0 |
| score_least_squares_w70_cap24_1 | monotonic_score | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 |
| score_least_squares_w70_cap24_7 | monotonic_score | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 |

## Decision Tree Depth 2-5

| tree | candidate | val mean | val p95 | val p99 | val >5 | val >10 | test mean | test p95 | test p99 | test >5 | test >10 | test advanced/fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tree_strict_d2_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d3_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d4_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d5_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d2_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d3_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d4_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d5_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_utility_d2_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_utility_d3_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_utility_d4_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_utility_d5_least_squares_w50_cap24 | least_squares_w50_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d2_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d3_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d4_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d5_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d2_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d3_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d4_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d5_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d2_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d3_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d4_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d5_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d2_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d3_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d4_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_strict_d5_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d2_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d3_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d4_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_balanced_d5_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_utility_d2_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_utility_d3_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_utility_d4_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_utility_d5_least_squares_w70_cap24 | least_squares_w70_cap24 | 11.646 | 39.425 | 73.575 | 0 | 0 | 10.411 | 37.225 | 74.375 | 0 | 0 | 0/288000 |
| tree_utility_d5_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.511 | 39.275 | 73.275 | 2 | 0 | 10.263 | 37.025 | 74.175 | 2 | 0 | 24198/263802 |
| tree_utility_d4_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.512 | 39.275 | 73.275 | 2 | 0 | 10.264 | 37.075 | 74.175 | 2 | 0 | 22278/265722 |
| tree_utility_d3_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.512 | 39.275 | 73.275 | 2 | 0 | 10.263 | 37.025 | 74.175 | 2 | 0 | 29704/258296 |
| tree_balanced_d2_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.535 | 39.275 | 73.325 | 2 | 0 | 10.304 | 37.125 | 74.175 | 3 | 0 | 23444/264556 |
| tree_balanced_d3_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.541 | 39.325 | 73.425 | 2 | 0 | 10.310 | 37.175 | 74.275 | 0 | 0 | 22140/265860 |
| tree_balanced_d4_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.541 | 39.325 | 73.425 | 2 | 0 | 10.310 | 37.175 | 74.275 | 0 | 0 | 22140/265860 |
| tree_balanced_d5_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.541 | 39.325 | 73.425 | 2 | 0 | 10.310 | 37.175 | 74.275 | 0 | 0 | 22140/265860 |
| tree_utility_d2_least_squares_w50_cap36 | least_squares_w50_cap36 | 11.506 | 39.225 | 73.225 | 21 | 2 | 10.261 | 37.025 | 74.125 | 26 | 1 | 31104/256896 |
| tree_utility_d2_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 10.899 | 38.825 | 73.525 | 1026 | 46 | 9.876 | 36.525 | 74.425 | 972 | 28 | 52180/235820 |
| tree_utility_d5_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 10.879 | 38.775 | 73.425 | 996 | 49 | 9.867 | 36.525 | 74.425 | 912 | 26 | 39000/249000 |
| tree_utility_d3_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 10.882 | 38.775 | 73.525 | 1027 | 52 | 9.872 | 36.525 | 74.425 | 933 | 30 | 50400/237600 |
| tree_utility_d4_blend_cv_ls_w50_cap24_ls0p5 | blend_cv_ls_w50_cap24_ls0p5 | 10.884 | 38.775 | 73.525 | 1050 | 52 | 9.874 | 36.525 | 74.425 | 975 | 30 | 65684/222316 |

## Judgment

The selected model is kept only if it beats the explicit `no_adoption_baseline_only` option under the validation constraint ranking. If the selected row is baseline-only, phase 3 found no learned gate worth porting.
