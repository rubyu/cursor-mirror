# Step 01 Report - Horizon and Target-Correction Audit

## Summary

This step performed a lightweight structural audit. It did not run Calibrator and did not retrain a model.

The current SmoothPredictor is structurally horizon-aware because horizonMilliseconds / 16.67 is feature 0 and runtimeTargetDisplacement is derived from the same horizon. However, the generated normalizer suggests the horizon distribution used for the current model is narrow: mean approximately -0.383 ms and std approximately 0.833 ms.

The UI target correction range is -32 ms to +32 ms around the display default. That range is far wider than the apparent horizon training spread. This does not prove the model fails at the edges, but it means aggregate v21 scores are not enough evidence for target-correction robustness.

## Model Shape

| item | value |
| --- | ---: |
| input features | 25 |
| hidden units | 32 |
| estimated MACs | 864 |
| parameters | 898 |
| horizon feature mean | -0.023009 |
| horizon feature std | 0.05 |
| approx horizon mean (ms) | -0.383 |
| approx horizon std (ms) | 0.833 |

## Target Correction Sweep

| display offset (ms) | internal offset (ms) | shift from default (ms) | approx std shift |
| ---: | ---: | ---: | ---: |
| -32 | -24 | -32 | -38.4 |
| -24 | -16 | -24 | -28.8 |
| -16 | -8 | -16 | -19.2 |
| -8 | 0 | -8 | -9.6 |
| 0 | 8 | 0 | 0 |
| 8 | 16 | 8 | 9.6 |
| 16 | 24 | 16 | 19.2 |
| 24 | 32 | 24 | 28.8 |
| 32 | 40 | 32 | 38.4 |

The std-shift column is relative to the default display setting and uses the generated model's horizon-feature std. It is an OOD-risk indicator, not a direct accuracy metric.

## Runtime Structure Findings

- Horizon is an explicit model input: True.
- Runtime target displacement also depends on horizon: True.
- Horizons above 1.25x refresh are rejected before prediction: True.
- The horizon cap is applied after that rejection check: True.

This ordering matters. A large positive target correction may cause a hold fallback before the cap has a chance to constrain the horizon.

## v21 Aggregate Reference

| metric | current SmoothPredictor summary | product reference |
| --- | ---: | ---: |
| normal visual p95 mean | 0.93442 | 0.941407 |
| normal visual p99 mean | 2.141065 | 2.161728 |
| peakLead max worst | 0.311208 | 3 |
| returnMotion max worst | 0.403024 | 3.204001 |
| futureLead p99 worst | 0.914915 | 0.9522 |

These aggregate numbers are strong, but they are not bucketed by target correction or requested future horizon.

## Decision

Proceed to Step 02. The dataset must expose labels over a horizon grid and all later scores must be reported by horizon bucket. Training a larger MLP without this audit dimension would risk improving the default case while leaving target correction behavior unproven.

## Command

```powershell
powershell -ExecutionPolicy Bypass -File poc\cursor-prediction-v24-multi-horizon-mlp\step-01-horizon-target-audit\audit.ps1
```
