# Phase 3 Report

## Recommendation

Best product-feasible candidate: `ridge_residual_risk_gate_low_speed_guard`. It clears the Phase 3 decision rule on the chronological test slice.

Baseline: overall mean 1.367, p95 5.099, p99 29.282, high-speed p95/p99 83.630/132.606, high-accel p95/p99 92.945/162.269, low-speed p95 0.440.
Best: overall mean 1.223, p95 4.543, p99 25.287, high-speed p95/p99 64.977/120.602, high-accel p95/p99 76.101/150.112, low-speed p95 0.440.

## Strongest Finding

A low-speed guard is the difference between a useful residual and an unsafe one: `ridge_residual_risk_gate_low_speed_guard` keeps low-speed p95 at 0.440 px while cutting high-speed p95 from 83.630 px to 64.977 px and overall p99 from 29.282 px to 25.287 px.
The non-product oracle chooser still shows additional headroom: test p99 20.102 px versus baseline 29.282 px.

## Candidate Summary

- `baseline_product`: mean 1.367, p95 5.099, p99 29.282, high-speed p95/p99 83.630/132.606, high-accel p95/p99 92.945/162.269, disagreement p95/p99 69.641/130.374, stop p95/p99 19.158/75.099, low-speed p95 0.440, regressions >1/>3/>5 0/0/0
- `ridge_residual_all`: mean 1.338, p95 4.547, p99 25.254, high-speed p95/p99 64.977/120.602, high-accel p95/p99 76.101/150.112, disagreement p95/p99 55.120/117.477, stop p95/p99 16.414/55.234, low-speed p95 0.757, regressions >1/>3/>5 1080/504/320
- `ridge_residual_high_risk_only`: mean 1.273, p95 4.865, p99 25.290, high-speed p95/p99 65.128/120.962, high-accel p95/p99 77.376/151.707, disagreement p95/p99 55.291/117.410, stop p95/p99 16.303/56.579, low-speed p95 0.908, regressions >1/>3/>5 938/430/298
- `ridge_residual_risk_threshold_gate`: mean 1.267, p95 5.173, p99 25.416, high-speed p95/p99 64.977/120.602, high-accel p95/p99 76.101/150.112, disagreement p95/p99 55.120/117.477, stop p95/p99 17.363/55.234, low-speed p95 0.681, regressions >1/>3/>5 251/184/167
- `ridge_residual_risk_gate_low_speed_guard`: mean 1.223, p95 4.543, p99 25.287, high-speed p95/p99 64.977/120.602, high-accel p95/p99 76.101/150.112, disagreement p95/p99 55.192/118.025, stop p95/p99 16.524/55.234, low-speed p95 0.440, regressions >1/>3/>5 935/488/317
- `ridge_residual_logistic_gate`: mean 1.165, p95 4.000, p99 24.232, high-speed p95/p99 74.117/131.860, high-accel p95/p99 85.716/148.946, disagreement p95/p99 62.970/128.221, stop p95/p99 15.287/64.585, low-speed p95 0.604, regressions >1/>3/>5 284/106/50
- [oracle] `oracle_choose_baseline_or_ridge`: mean 0.984, p95 3.424, p99 20.102, high-speed p95/p99 51.991/100.701, high-accel p95/p99 70.336/148.878, disagreement p95/p99 48.226/112.988, stop p95/p99 12.780/49.969, low-speed p95 0.402, regressions >1/>3/>5 0/0/0
- [oracle] `oracle_perfect_residual`: mean 0.000, p95 0.000, p99 0.000, high-speed p95/p99 0.000/0.000, high-accel p95/p99 0.000/0.000, disagreement p95/p99 0.000/0.000, stop p95/p99 0.000/0.000, low-speed p95 0.000, regressions >1/>3/>5 0/0/0

## Phase 4 Direction

Take the low-speed-guarded residual into Phase 4 as an offline candidate, but do not ship it from this single trace. Phase 4 should validate it on more traces, reduce pointwise regression counts, calibrate the gate as an uncertainty estimator, and collect targeted high-speed, stop-settle, and hook/poll disagreement coverage.

## Artifacts

- `run_phase3.mjs`: reproducible Phase 3 runner.
- `scores.json`: machine-readable split, baseline, model, and oracle results.
- `experiment-log.md`: detailed setup, selections, and metric tables.