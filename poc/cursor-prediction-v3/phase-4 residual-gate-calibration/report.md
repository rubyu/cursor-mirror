# Phase 4 Report

## Recommendation

Best product-feasible candidate: `phase4_logistic_p0_35_sh0_65_capinf`. It clears the Phase 4 decision rule on the chronological test slice.

Baseline: overall mean 1.367, p95 5.099, p99 29.282, high-speed p95/p99 83.630/132.606, high-accel p95/p99 92.945/162.269, low-speed p95 0.440.
Phase 3 best: overall p99 25.287, high-speed p95/p99 64.977/120.602, regressions >1/>3/>5 935/488/317.
Best: overall mean 1.216, p95 4.226, p99 25.728, high-speed p95/p99 77.455/132.606, high-accel p95/p99 89.781/154.310, low-speed p95 0.440, regressions >1/>3/>5 148/41/16, applied 6.91%.

## Strongest Finding

Conservative gating can buy down the Phase 3 visible regression count: `phase4_logistic_p0_35_sh0_65_capinf` reduces >5 px regressions from 317 to 16 while keeping overall p99 at 25.728 px versus baseline 29.282 px.
The non-product oracle chooser still shows additional headroom: test p99 20.102 px versus baseline 29.282 px.

## Candidate Summary

- `baseline_product`: mean 1.367, p50 0.000, p90 1.737, p95 5.099, p99 29.282, max 312.923, high-speed p95/p99 83.630/132.606, high-accel p95/p99 92.945/162.269, disagreement p95/p99 69.641/130.374, stop p95/p99 19.158/75.099, low-speed p95 0.440, vs baseline >1/>3/>5 0/0/0, vs Phase 3 best >1/>3/>5 1617/834/529, applied 0.00%
- `ridge_residual_risk_gate_low_speed_guard`: mean 1.223, p50 0.000, p90 1.733, p95 4.543, p99 25.287, max 312.923, high-speed p95/p99 64.977/120.602, high-accel p95/p99 76.101/150.112, disagreement p95/p99 55.192/118.025, stop p95/p99 16.524/55.234, low-speed p95 0.440, vs baseline >1/>3/>5 935/488/317, vs Phase 3 best >1/>3/>5 0/0/0, applied 18.72%
- `phase4_shrink_0_5`: mean 1.234, p50 0.000, p90 1.639, p95 4.514, p99 26.817, max 312.923, high-speed p95/p99 68.618/115.628, high-accel p95/p99 84.351/156.147, disagreement p95/p99 60.180/120.864, stop p95/p99 16.697/61.479, low-speed p95 0.440, vs baseline >1/>3/>5 526/225/145, vs Phase 3 best >1/>3/>5 1007/411/261, applied 18.72%
- `phase4_vector_cap_5`: mean 1.269, p50 0.000, p90 1.713, p95 4.363, p99 27.049, max 312.923, high-speed p95/p99 79.968/127.650, high-accel p95/p99 87.966/157.269, disagreement p95/p99 67.566/125.397, stop p95/p99 16.239/71.622, low-speed p95 0.440, vs baseline >1/>3/>5 826/374/1, vs Phase 3 best >1/>3/>5 466/355/288, applied 18.72%
- `phase4_relative_step_cap_0_5`: mean 1.224, p50 0.000, p90 1.650, p95 4.512, p99 26.307, max 312.923, high-speed p95/p99 67.206/121.233, high-accel p95/p99 82.033/157.153, disagreement p95/p99 57.874/118.440, stop p95/p99 16.157/59.630, low-speed p95 0.440, vs baseline >1/>3/>5 592/313/202, vs Phase 3 best >1/>3/>5 610/225/146, applied 13.26%
- `phase4_guard_r3_l200_s33_stinf`: mean 1.271, p50 0.000, p90 1.756, p95 5.139, p99 25.532, max 312.923, high-speed p95/p99 67.678/130.843, high-accel p95/p99 82.033/150.112, disagreement p95/p99 57.410/120.864, stop p95/p99 17.163/58.865, low-speed p95 0.440, vs baseline >1/>3/>5 192/173/157, vs Phase 3 best >1/>3/>5 1267/508/226, applied 1.82%
- `phase4_product_grid_sh0_5_cap12_rel0_75_r1_5`: mean 1.274, p50 0.000, p90 1.723, p95 5.000, p99 26.837, max 312.923, high-speed p95/p99 74.696/123.185, high-accel p95/p99 85.882/156.147, disagreement p95/p99 62.827/122.804, stop p95/p99 16.763/66.278, low-speed p95 0.440, vs baseline >1/>3/>5 275/172/117, vs Phase 3 best >1/>3/>5 1467/638/330, applied 4.98%
- `phase4_logistic_p0_35_sh0_65_capinf`: mean 1.216, p50 0.000, p90 1.512, p95 4.226, p99 25.728, max 312.923, high-speed p95/p99 77.455/132.606, high-accel p95/p99 89.781/154.310, disagreement p95/p99 66.152/127.284, stop p95/p99 15.824/69.331, low-speed p95 0.440, vs baseline >1/>3/>5 148/41/16, vs Phase 3 best >1/>3/>5 898/371/233, applied 6.91%
- `phase4_uncertainty_std8_sh0_5_capinf`: mean 1.234, p50 0.000, p90 1.639, p95 4.514, p99 26.817, max 312.923, high-speed p95/p99 68.618/115.628, high-accel p95/p99 84.351/156.147, disagreement p95/p99 60.180/120.864, stop p95/p99 16.697/61.479, low-speed p95 0.440, vs baseline >1/>3/>5 526/225/145, vs Phase 3 best >1/>3/>5 1007/411/261, applied 18.72%
- `phase4_product_objective_best`: mean 1.216, p50 0.000, p90 1.512, p95 4.226, p99 25.728, max 312.923, high-speed p95/p99 77.455/132.606, high-accel p95/p99 89.781/154.310, disagreement p95/p99 66.152/127.284, stop p95/p99 15.824/69.331, low-speed p95 0.440, vs baseline >1/>3/>5 148/41/16, vs Phase 3 best >1/>3/>5 898/371/233, applied 6.91%
- [oracle] `oracle_choose_baseline_or_ridge`: mean 0.984, p50 0.000, p90 1.314, p95 3.424, p99 20.102, max 312.923, high-speed p95/p99 51.991/100.701, high-accel p95/p99 70.336/148.878, disagreement p95/p99 48.226/112.988, stop p95/p99 12.780/49.969, low-speed p95 0.402, vs baseline >1/>3/>5 0/0/0, vs Phase 3 best >1/>3/>5 0/0/0, applied 11.29%
- [oracle] `oracle_perfect_residual`: mean 0.000, p50 0.000, p90 0.000, p95 0.000, p99 0.000, max 0.000, high-speed p95/p99 0.000/0.000, high-accel p95/p99 0.000/0.000, disagreement p95/p99 0.000/0.000, stop p95/p99 0.000/0.000, low-speed p95 0.000, vs baseline >1/>3/>5 0/0/0, vs Phase 3 best >1/>3/>5 0/0/0, applied 22.07%

## Phase 4 Direction

Move to Phase 5 distillation/product-shape feasibility with this gate as an offline candidate, while adding trace diversity and explicit regression-budget tests.

## Artifacts

- `run_phase4.mjs`: reproducible Phase 4 runner.
- `scores.json`: machine-readable split, baseline, model, and oracle results.
- `experiment-log.md`: detailed setup, selections, and metric tables.