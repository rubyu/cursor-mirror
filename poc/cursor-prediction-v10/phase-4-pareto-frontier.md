# Cursor Prediction v10 Phase 4 Pareto Frontier

Generated: 2026-05-03T08:59:40.401Z

Canonical input: `runs/scripts.synthetic.phase2.jsonl`. GPU used: no. Dependencies: Node.js standard library only. No per-frame CSV, raw ZIP, cache, checkpoint, or node_modules output was written.

## Split

| split | scripts | rows |
| --- | ---: | ---: |
| train | 2100 | 806400 |
| validation | 450 | 172800 |
| test | 450 | 172800 |

## Baseline And Phase3

Baseline test mean/p95/p99/max 11.997 / 38.775 / 78.075 / 694.357 px.

Phase3 selected `score_least_squares_w50_cap36_5`: test mean/p95/p99/max 10.375 / 37.175 / 74.325 / 399.790 px, >5/>10 0/0, advanced 29302.

Same-split phase3 selected gate: test mean/p95/p99/max 11.971 / 38.775 / 77.875 / 694.357 px, >5/>10 0/0, advanced 14421.

## Best By Constraint

| bucket | gate | candidate | blend | mean | p95 | p99 | max | >5 | >10 | advanced/fallback | utility |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| strict | phase4_0020_least_squares_w50_cap36_phase3_best_t1p806727 | least_squares_w50_cap36 | 1 | 11.966 | 38.725 | 77.825 | 694.357 | 0 | 0 | 20034/152766 | 0.127 |
| balanced | phase4_0070_blend_base_least_squares_w50_cap36_adv0p75_phase3_best_t3p538744 | blend_base_least_squares_w50_cap36_adv0p75 | 0.75 | 11.941 | 38.575 | 77.575 | 694.357 | 30 | 0 | 61763/111037 | 0.287 |
| aggressive | phase4_0061_blend_base_least_squares_w50_cap36_adv0p75_phase3_best_t4p720413 | blend_base_least_squares_w50_cap36_adv0p75 | 0.75 | 11.934 | 38.475 | 77.475 | 694.357 | 182 | 5 | 76812/95988 | 0.364 |
| noGo | phase4_0037_least_squares_w50_cap36_phase3_best_t16p771158 | least_squares_w50_cap36 | 1 | 9.078 | 33.175 | 71.775 | 682.352 | 13483 | 5940 | 163524/9276 | 7.050 |

## Blend Weight Comparison

| blend | balanced mean | balanced p95 | balanced >5/>10 | balanced advanced/fallback | aggr mean | aggr p95 | aggr >5/>10 | aggr advanced/fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.25 | 11.969 | 38.675 | 0/0 | 76812/95988 | 11.920 | 38.425 | 89/0 | 97836/74964 |
| 0.5 | 11.948 | 38.575 | 32/0 | 76812/95988 | 11.948 | 38.575 | 32/0 | 76812/95988 |
| 0.75 | 11.941 | 38.575 | 30/0 | 61763/111037 | 11.934 | 38.475 | 182/5 | 76812/95988 |
| 1 | 11.966 | 38.725 | 0/0 | 20034/152766 | 11.934 | 38.625 | 45/1 | 53924/118876 |

## Search

- candidate predictors: least_squares_w50_cap36
- advanced blend weights: 0.25, 0.5, 0.75, 1
- monotonic score weight configs: 1
- screening rows: train 100000, validation 120000
- full evaluated shortlisted candidates: 72
- runtime: 64.47 seconds on CPU

## Judgment

Strict remains the production-shaped safety bucket. Balanced and aggressive show how much extra mean/p95/p99 movement is available when small regression counts are permitted. No-go is reference only and should not be productized without a separate risk gate.
