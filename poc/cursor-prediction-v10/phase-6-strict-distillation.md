# Phase 6 Strict Distillation

Generated: 2026-05-03T09:18:27.472Z

Canonical input: `runs/scripts.synthetic.phase2.jsonl`  
Scripts: 3000; split seed 33003; train/validation/test scripts 2100/450/450.  
Rows: train/validation/test 806400/172800/172800; strict advanced rows 112049/23549/20034.  
Environment: Node v24.14.0; GPU not used; Node standard library only.

Phase4 strict baseline: `phase4_0020_least_squares_w50_cap36_phase3_best_t1p806727`, test mean/p90/p95/p99/max 11.966 / 29.925 / 38.725 / 77.825 / 694.357 px, >5/>10 vs CV 0/0.

The residual teachers were trained only on rows where the unchanged phase4 strict gate chooses `least_squares_w50_cap36`. No per-frame CSVs, raw zips, node_modules, caches, or checkpoints were written.

## Selected Candidates

| bucket           | candidate                                     | mean   | mean delta | p95    | p95 delta | p99    | p99 delta | >5/>10 vs p4 | >5/>10 vs CV |
| ---------------- | --------------------------------------------- | ------ | ---------- | ------ | --------- | ------ | --------- | ------------ | ------------ |
| strict           | bucket_disagreement_gain_offset_scale0p5_cap4 | 11.955 | -0.01      | 38.725 | 0         | 77.825 | 0         | 0/0          | 0/0          |
| balanced         | bucket_disagreement_gain_offset_scale1_cap4   | 11.954 | -0.012     | 38.725 | 0         | 77.825 | 0         | 0/0          | 3/0          |
| bestMean         | bucket_disagreement_gain_offset_scale1_cap4   | 11.954 | -0.012     | 38.725 | 0         | 77.825 | 0         | 0/0          | 3/0          |
| bestTailSafeMean | bucket_disagreement_gain_offset_scale1_cap4   | 11.954 | -0.012     | 38.725 | 0         | 77.825 | 0         | 0/0          | 3/0          |

## Best Mean Candidates

| candidate                                      | mean   | dMean  | p90    | dP90 | p95    | dP95 | p99    | dP99 | >5/>10 vs p4 | >5/>10 vs CV | warnings                            |
| ---------------------------------------------- | ------ | ------ | ------ | ---- | ------ | ---- | ------ | ---- | ------------ | ------------ | ----------------------------------- |
| bucket_disagreement_gain_offset_scale1_cap4    | 11.954 | -0.012 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 3/0          | has_>5px_regressions_vs_cv_baseline |
| bucket_disagreement_gain_offset_scale0p75_cap4 | 11.954 | -0.011 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 2/0          | has_>5px_regressions_vs_cv_baseline |
| bucket_disagreement_gain_offset_scale0p5_cap4  | 11.955 | -0.01  | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 0/0          | -                                   |
| bucket_disagreement_gain_offset_scale1_cap2    | 11.957 | -0.008 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 3/0          | has_>5px_regressions_vs_cv_baseline |
| bucket_disagreement_gain_offset_scale0p75_cap2 | 11.958 | -0.008 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 2/0          | has_>5px_regressions_vs_cv_baseline |
| linear_residual_by_horizon_scale0p5_cap4       | 11.958 | -0.007 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 4/0          | has_>5px_regressions_vs_cv_baseline |
| bucket_disagreement_gain_offset_scale0p5_cap2  | 11.959 | -0.007 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 0/0          | -                                   |
| linear_residual_global_scale0p5_cap4           | 11.959 | -0.007 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 4/0          | has_>5px_regressions_vs_cv_baseline |
| bucket_disagreement_gain_offset_scale0p25_cap4 | 11.959 | -0.006 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 0/0          | -                                   |
| linear_residual_by_horizon_scale0p75_cap4      | 11.959 | -0.006 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 9/0          | has_>5px_regressions_vs_cv_baseline |
| bucket_disagreement_gain_offset_scale1_cap1    | 11.96  | -0.006 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 0/0          | -                                   |
| bucket_disagreement_gain_offset_scale0p25_cap2 | 11.96  | -0.006 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 0/0          | -                                   |
| bucket_disagreement_gain_offset_scale0p75_cap1 | 11.96  | -0.006 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 0/0          | -                                   |
| linear_residual_global_scale0p75_cap4          | 11.961 | -0.005 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 9/0          | has_>5px_regressions_vs_cv_baseline |
| bucket_disagreement_gain_offset_scale0p5_cap1  | 11.961 | -0.005 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 0/0          | -                                   |
| linear_residual_by_horizon_scale0p25_cap4      | 11.961 | -0.005 | 29.925 | 0    | 38.725 | 0    | 77.825 | 0    | 0/0          | 1/0          | has_>5px_regressions_vs_cv_baseline |

## Judgment

Negative deltas improve over phase4 strict. Candidates with p95 or p99 worse than phase4 strict are treated as caution even when mean improves. Productization requires the strict candidate to keep >5/>10 regressions at zero and show a meaningful mean or p90 gain on real traces, not only this synthetic split.
