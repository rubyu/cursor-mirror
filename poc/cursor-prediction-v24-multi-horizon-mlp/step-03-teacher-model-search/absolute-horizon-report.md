# Step 03 Report - Initial Multi-Horizon MLP Search

## Summary

This is the first bounded CPU-only model run for v24. It streams existing MotionLab ZIP files, builds a small multi-horizon sample, and compares simple baselines with small horizon-aware MLPs.

It is not a final SOTA run. It exists to validate the data shape and check whether target-horizon-aware learning is worth expanding.

## Dataset

- rows per package cap: 1200
- horizon labels per selected row: 11
- feature rows: 132000
- train rows: 52800
- validation rows: 13200
- test rows: 13200

## Test Results

| candidate | visual p95 | visual p99 | lead p99 | lag p95 | stationary jitter p95 | MACs | params |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cv_v2_feature_baseline | 8.547431 | 26.419690 | 5.399856 | 7.670744 | 0.000000 | 2 | 0 |
| cv_v2_feature_baseline_static_guard | 8.343499 | 25.612497 | 4.243323 | 7.670744 | 0.000000 | 2 | 0 |
| mlp_h32_mse | 10.140082 | 30.069130 | 9.556017 | 9.024823 | 5.861250 | 864 | 898 |
| mlp_h64_mse | 11.536184 | 29.405962 | 9.702269 | 10.411204 | 6.144303 | 1728 | 1794 |
| mlp_h64_asym_lead4 | 10.586946 | 29.319259 | 10.285795 | 9.248626 | 6.780073 | 1728 | 1794 |
| mlp_h128_mse | 10.298803 | 29.640281 | 10.593353 | 8.920651 | 7.672920 | 3456 | 3586 |
| residual_cv_mlp_h32_mse | 10.416756 | 29.099175 | 9.023571 | 9.455838 | 7.107333 | 866 | 898 |
| residual_cv_mlp_h32_mse_static_guard | 10.117519 | 27.640735 | 5.850753 | 9.444955 | 0.000000 | 866 | 898 |
| residual_cv_mlp_h64_mse | 10.602912 | 30.062548 | 9.311271 | 9.629240 | 6.043097 | 1730 | 1794 |
| residual_cv_mlp_h64_mse_static_guard | 10.277832 | 28.508229 | 6.290843 | 9.622008 | 0.000000 | 1730 | 1794 |
| residual_cv_mlp_h64_asym_lead4 | 10.903315 | 29.460334 | 9.060364 | 9.846118 | 5.874077 | 1730 | 1794 |
| residual_cv_mlp_h64_asym_lead4_static_guard | 10.591527 | 28.470580 | 6.503842 | 9.844507 | 0.000000 | 1730 | 1794 |
| residual_cv_mlp_h128_mse | 11.671083 | 28.452166 | 10.619094 | 10.370818 | 6.372741 | 3458 | 3586 |
| residual_cv_mlp_h128_mse_static_guard | 11.380210 | 27.668528 | 7.715009 | 10.358333 | 0.000000 | 3458 | 3586 |

## Decision

The next run should keep the same streaming builder but increase data coverage, add event/stop-aware losses, and report normal/test/robustness gates. If the larger MLP only improves aggregate visual error while increasing lead or jitter, it should not be promoted.

## Command

```powershell
& 'C:\Users\seigl\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' poc\cursor-prediction-v24-multi-horizon-mlp\step-03-teacher-model-search\train_sample_models.py
```
