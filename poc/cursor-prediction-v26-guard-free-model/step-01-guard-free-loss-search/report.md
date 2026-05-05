# Step 01 Report - Guard-Free Loss Search

## Summary

This POC tests whether stop and overshoot behavior can be learned directly, without product-side static guards. It keeps the v25 runtime-shaped horizon labels and changes the training objective so braking and stop rows are first-class loss terms.

The important check is not just aggregate visual error. A candidate must also reduce braking-side lead and stationary jitter, because those are the visible failure modes reported for SmoothPredictor-like models.

## Dataset

- rows per package cap: 1600
- labels: product-shaped horizon with target correction buckets
- total rows: 272000
- train rows: 108800
- validation rows: 27200
- test rows: 27200
- robustness rows: 108800

## Best Test Candidates

| candidate | visual p95 | visual p99 | brake lead p99 | stop lead p99 | jitter p95 | MACs | params |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| constant_velocity_v3_guard_free | 1.665096 | 4.598657 | 9.137524 | 1.080314 | 0.000000 | 2 | 0 |
| constant_velocity_v2_guard_free | 1.785531 | 4.141691 | 13.194644 | 1.064054 | 0.000000 | 2 | 0 |
| constant_velocity_v12_guard_free | 1.909139 | 7.451250 | 7.700061 | 2.787532 | 0.000000 | 2 | 0 |
| soft_brake_cv2_gamma1_floor0.15_min0 | 1.943836 | 4.149038 | 12.476805 | 1.028272 | 0.000000 | 14 | 0 |
| soft_brake_cv2_gamma1.5_floor0.1_min0 | 2.000000 | 4.187571 | 11.922520 | 1.006739 | 0.000000 | 14 | 0 |
| soft_brake_cv2_gamma2_floor0.1_min0 | 2.009905 | 4.234724 | 11.922520 | 1.000130 | 0.000000 | 14 | 0 |
| soft_brake_cv2_gamma2_floor0.2_min0.05 | 2.010592 | 4.229923 | 11.922520 | 1.000130 | 0.000000 | 14 | 0 |
| residual_cv2_mse_h32 | 2.100129 | 6.653614 | 11.928995 | 2.186721 | 0.699059 | 866 | 898 |
| direct_mild_stop_brake_h32 | 2.284878 | 6.877650 | 6.300890 | 1.421882 | 0.443355 | 864 | 898 |
| direct_mse_h32 | 2.390903 | 6.595812 | 12.764291 | 2.689134 | 0.686661 | 864 | 898 |
| residual_cv2_mild_stop_brake_h32 | 2.512603 | 5.801957 | 10.069909 | 1.169283 | 0.517848 | 866 | 898 |
| residual_cv2_mild_asym2_stop_brake_h32 | 2.787814 | 7.931678 | 4.789184 | 0.685237 | 0.508320 | 866 | 898 |

## Brake-Safe Test Candidates

| candidate | brake lead p99 | visual p95 | visual p99 | stop lead p99 | jitter p95 | MACs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| direct_asym12_stop_brake_h96 | 0.205793 | 3.686376 | 8.655449 | 0.093726 | 0.092253 | 2592 |
| direct_asym8_stop_brake_h64 | 0.537460 | 3.805254 | 8.548915 | 0.093617 | 0.173241 | 1728 |
| current_smooth_predictor_guard_free | 0.582272 | 3.826470 | 9.041695 | 0.180757 | 0.147279 | 864 |
| direct_asym4_stop_brake_h32 | 0.845139 | 3.576541 | 8.483587 | 0.230000 | 0.204417 | 864 |
| direct_stop_brake_h32 | 1.558394 | 3.360928 | 7.416951 | 0.647403 | 0.230531 | 864 |
| direct_balanced_asym2_stop_brake_h64 | 1.940325 | 3.328906 | 7.630792 | 0.358708 | 0.288356 | 1728 |
| direct_mild_asym2_stop_brake_h32 | 2.719869 | 2.966852 | 7.240679 | 0.997672 | 0.346340 | 864 |
| residual_cv2_asym12_stop_brake_h96 | 4.039694 | 3.909833 | 9.890728 | 0.147452 | 0.466833 | 2594 |
| residual_cv2_mild_asym2_stop_brake_h32 | 4.789184 | 2.787814 | 7.931678 | 0.685237 | 0.508320 | 866 |
| residual_cv2_asym4_stop_brake_h32 | 5.567559 | 4.294522 | 9.429008 | 0.412691 | 1.088338 | 866 |

## Best By Test Ordering

- `constant_velocity_v3_guard_free`: visual p95 `1.665096`, brake lead p99 `9.137524`, jitter p95 `0.000000`
- `constant_velocity_v2_guard_free`: visual p95 `1.785531`, brake lead p99 `13.194644`, jitter p95 `0.000000`
- `constant_velocity_v12_guard_free`: visual p95 `1.909139`, brake lead p99 `7.700061`, jitter p95 `0.000000`

## Interpretation

The best visual candidate is `constant_velocity_v3_guard_free` with visual p95 `1.665096`, but its braking lead p99 is `9.137524`.
The best braking-lead candidate is `direct_asym12_stop_brake_h96` with braking lead p99 `0.205793`, but its visual p95 is `3.686376`.
`current_smooth_predictor_guard_free` follows the same trade-off: braking lead p99 `0.582272` but visual p95 `3.826470`.

This step is deliberately guard-free. The learned asymmetric/stop-weighted losses can suppress overshoot, but in this split they do so by becoming too conservative and losing visual accuracy. No learned candidate dominates the simple CV baselines yet.

The next step should train/evaluate on explicit sudden-stop scenario families and score visible sequence error, because row-level labels alone are not separating safe braking from global lag.

## Command

```powershell
& 'C:\Users\seigl\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' poc\cursor-prediction-v26-guard-free-model\step-01-guard-free-loss-search\train_guard_free_models.py
```
