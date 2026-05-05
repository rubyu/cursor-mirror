# Step 03 Report - Initial Multi-Horizon MLP Search

## Summary

This is the first bounded CPU-only model run for v24. It streams existing MotionLab ZIP files, builds a small multi-horizon sample, and compares simple baselines with small horizon-aware MLPs.

It is not a final SOTA run. It exists to validate the data shape and check whether target-horizon-aware learning is worth expanding.

## Dataset

- rows per package cap: 1200
- horizon mode: product-offset
- labels per selected row: 9
- feature rows: 108000
- train rows: 43200
- validation rows: 10800
- test rows: 10800

## Test Results

| candidate | visual p95 | visual p99 | lead p99 | lag p95 | stationary jitter p95 | MACs | params |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cv_v2_feature_baseline | 1.885004 | 4.617162 | 1.483056 | 1.574814 | 0.000000 | 2 | 0 |
| cv_v2_feature_baseline_static_guard | 1.838048 | 4.414031 | 1.406385 | 1.574814 | 0.000000 | 2 | 0 |
| mlp_h32_mse | 2.784284 | 7.288952 | 3.642051 | 1.698357 | 0.733305 | 864 | 898 |
| mlp_h64_mse | 3.067810 | 7.372194 | 3.909207 | 1.781001 | 0.755372 | 1728 | 1794 |
| mlp_h64_asym_lead4 | 2.783471 | 7.959965 | 2.945026 | 2.359995 | 0.821096 | 1728 | 1794 |
| mlp_h128_mse | 3.439084 | 7.427937 | 4.491999 | 2.004496 | 0.848229 | 3456 | 3586 |
| residual_cv_mlp_h32_mse | 2.586147 | 7.276026 | 3.053148 | 1.786119 | 0.921290 | 866 | 898 |
| residual_cv_mlp_h32_mse_static_guard | 2.243876 | 6.777518 | 2.088791 | 1.674316 | 0.000000 | 866 | 898 |
| residual_cv_mlp_h64_mse | 3.213472 | 7.974385 | 4.396368 | 1.462730 | 0.784741 | 1730 | 1794 |
| residual_cv_mlp_h64_mse_static_guard | 2.982236 | 6.920131 | 3.546228 | 1.399000 | 0.000000 | 1730 | 1794 |
| residual_cv_mlp_h64_asym_lead4 | 2.811495 | 7.613113 | 2.848557 | 2.235389 | 0.873993 | 1730 | 1794 |
| residual_cv_mlp_h64_asym_lead4_static_guard | 2.583855 | 7.029397 | 2.250691 | 2.194496 | 0.000000 | 1730 | 1794 |
| residual_cv_mlp_h128_mse | 2.829421 | 7.617160 | 3.917763 | 1.642139 | 0.819323 | 3458 | 3586 |
| residual_cv_mlp_h128_mse_static_guard | 2.597832 | 6.869091 | 3.256669 | 1.574814 | 0.000000 | 3458 | 3586 |

## Decision

The next run should keep the same streaming builder but increase data coverage, add event/stop-aware losses, and report normal/test/robustness gates. If the larger MLP only improves aggregate visual error while increasing lead or jitter, it should not be promoted.

## Command

```powershell
& 'C:\Users\seigl\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' poc\cursor-prediction-v24-multi-horizon-mlp\step-03-teacher-model-search\train_sample_models.py
```
