# Step 04 Report - Runtime Horizon Semantics Audit

## Summary

This audit checks whether the future time used to train the v21 SmoothPredictor matches the future time requested by the current product settings.

The answer is: probably not. The v21 harness used a training label offset of -4ms relative to the scheduler target. The current user-facing target offset display value 0 maps to an internal +8ms offset. On the scanned runtime scheduler rows, this separates the learned/default runtime horizon by roughly 12ms.

## Observed Runtime Timing

| metric | value |
| --- | ---: |
| rows | 308804 |
| sample-to-target p50 (ms) | 3.858 |
| sample-to-target p95 (ms) | 3.926 |
| refresh p50 (ms) | 16.6671 |
| v21 training horizon p50 estimate (ms) | -0.142 |
| current default runtime horizon p50 estimate (ms) | 11.858 |
| generated model horizon normalizer mean (ms) | -0.383562 |
| generated model horizon normalizer std (ms) | 0.8335 |

## Target Offset Sweep

| display offset (ms) | internal offset (ms) | horizon p50 before reject | accepted rate | expired rate | excessive rate | used p50 after cap |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| -32 | -24 | -20.142 | 0 | 1 | 0 | 0 |
| -24 | -16 | -12.142 | 0 | 1 | 0 | 0 |
| -16 | -8 | -4.142 | 0 | 1 | 0 | 0 |
| -8 | 0 | 3.858 | 0.995181 | 0.004819 | 0 | 3.859 |
| 0 | 8 | 11.858 | 0.999845 | 0.000155 | 0 | 10 |
| 8 | 16 | 19.858 | 0.999968 | 3.2E-05 | 0 | 10 |
| 16 | 24 | 27.858 | 0.000557 | 1.3E-05 | 0.99943 | 10 |
| 24 | 32 | 35.858 | 7.4E-05 | 1.3E-05 | 0.999913 | 10 |
| 32 | 40 | 43.858 | 1.6E-05 | 6E-06 | 0.999977 | 10 |

## Interpretation

- The current SmoothPredictor model is trained from v21 assets whose horizon distribution is centered near the -4ms training-label convention.
- The current UI default does not mean internal 0ms; it means internal +8ms.
- Because the runtime predictor rejects horizons above 1.25x refresh before applying the horizon cap, large positive target correction is not merely capped. It can become a hold fallback.
- The next ML run should train/evaluate against product-shaped horizons: sample-to-target plus internal offset, with expired/excessive horizons treated the same way product runtime treats them.

## Decision

Do not promote a larger MLP from Step 03. First repair the training/evaluation target semantics. The next run should use product-shaped horizons and compare CV/static-guard, current SmoothPredictor-style MLP, and residual models under those semantics.

## Command

```powershell
powershell -ExecutionPolicy Bypass -File poc\cursor-prediction-v24-multi-horizon-mlp\step-04-distillation-and-runtime-shape\runtime-horizon-audit.ps1
```
