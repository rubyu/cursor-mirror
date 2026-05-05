# Step 01 Report - Runtime-Horizon Model Search

## Summary

This run trains and evaluates against runtime-shaped horizons. The label horizon is the scheduler sample-to-target duration plus the product target-correction offset, followed by the same expired/excessive/cap behavior used by the application.

The purpose is to test the actual idea behind v25: learn across the range of futures that the UI can request, not the narrow historical horizon used by the older generated model.

## Dataset

- rows per package cap: 2400
- horizon mode: product-offset
- target correction buckets: 17
- feature rows: 408000
- train rows: 163200
- validation rows: 40800
- test rows: 40800

## Test Results

| candidate | visual p95 | visual p99 | lead p99 | stop lead p99 | jitter p95 | MACs | params |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| constant_velocity_v2 | 1.709159 | 3.684243 | 1.483056 | 1.158671 | 0.000000 | 2 | 0 |
| constant_velocity_v2_static_guard | 1.696106 | 3.605551 | 1.401654 | 1.035991 | 0.000000 | 2 | 0 |
| constant_velocity_v12 | 1.853160 | 6.708162 | 2.222354 | 2.359545 | 0.000000 | 2 | 0 |
| constant_velocity_v12_static_guard | 1.687676 | 6.268748 | 1.179100 | 1.064215 | 0.000000 | 2 | 0 |
| current_smooth_predictor | 3.574788 | 8.742579 | 0.136224 | 0.169886 | 0.088963 | 864 | 898 |
| current_smooth_predictor_static_guard | 3.574788 | 8.742579 | 0.000000 | 0.010505 | 0.000000 | 864 | 898 |
| mlp_h32_mse | 2.096188 | 6.291012 | 2.753788 | 1.692821 | 0.691663 | 864 | 898 |
| mlp_h64_mse | 2.459024 | 7.073543 | 2.793301 | 1.718925 | 0.696024 | 1728 | 1794 |
| mlp_h64_asym_lead4 | 3.107378 | 7.688501 | 2.777507 | 1.141791 | 0.696086 | 1728 | 1794 |
| mlp_h64_asym_lead8 | 2.515907 | 7.035265 | 1.305222 | 0.885546 | 0.709383 | 1728 | 1794 |
| mlp_h128_mse | 2.976701 | 7.608093 | 2.580393 | 1.353678 | 0.860298 | 3456 | 3586 |
| residual_cv_mlp_h32_mse | 2.351456 | 6.692416 | 2.929516 | 1.967073 | 0.688771 | 866 | 898 |
| residual_cv_mlp_h32_mse_static_guard | 2.172311 | 6.540248 | 2.698020 | 1.235654 | 0.000000 | 866 | 898 |
| residual_cv_mlp_h64_mse | 2.438650 | 7.733284 | 3.191477 | 1.822486 | 0.861229 | 1730 | 1794 |
| residual_cv_mlp_h64_mse_static_guard | 2.187531 | 7.401102 | 2.500889 | 0.774605 | 0.000000 | 1730 | 1794 |
| residual_cv_mlp_h64_asym_lead4 | 2.614564 | 7.854446 | 2.777680 | 1.442416 | 0.681915 | 1730 | 1794 |
| residual_cv_mlp_h64_asym_lead4_static_guard | 2.456589 | 7.173891 | 2.126448 | 0.799112 | 0.000000 | 1730 | 1794 |
| residual_cv_mlp_h64_asym_lead8 | 2.814417 | 7.535151 | 1.450030 | 1.035195 | 0.744975 | 1730 | 1794 |
| residual_cv_mlp_h64_asym_lead8_static_guard | 2.618170 | 7.157709 | 0.770513 | 0.459511 | 0.000000 | 1730 | 1794 |
| residual_cv_mlp_h128_mse | 2.769590 | 7.526389 | 3.499519 | 2.152477 | 0.629461 | 3458 | 3586 |
| residual_cv_mlp_h128_mse_static_guard | 2.519719 | 7.032128 | 2.833754 | 1.219994 | 0.000000 | 3458 | 3586 |

## Decision

A learned model should only advance if it beats the simple runtime-shaped baselines on visual error without increasing stop-side overshoot or stationary jitter.

## Command

```powershell
& 'C:\Users\seigl\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' poc\cursor-prediction-v25-runtime-horizon-training\step-01-runtime-horizon-model-search\train_runtime_horizon_models.py
```
