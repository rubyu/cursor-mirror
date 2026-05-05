# Step 00 Report - Inventory

## Summary

v24 starts from the current product `SmoothPredictor` and the v21 runtime-only POC. The current model is small enough that scalar C# should remain the reference implementation while the model search explores whether accuracy improves with larger or horizon-aware models.

## Current Product Model

- Model: `SmoothPredictor`
- Runtime shape: 25 input features, one hidden layer with 32 `tanh` units, 2 outputs (`dx`, `dy`)
- Estimated model cost from generated code: 864 MAC-like operations, 898 parameters
- Runtime allocation profile: static weights plus reusable instance arrays; no per-call array allocation in normal evaluation
- Product output path: model displacement is multiplied by prediction gain, clamped, then stop/static guards may force or cap displacement

## Runtime Feature Policy

The v21 correction is the baseline for v24:

- future/reference target distance may be used only as a label or metric;
- runtime model inputs must be computed from current and past samples;
- runtime guard decisions must not read generated movement phase, future target distance, static labels, or event labels.

## Existing Evidence

v20 showed that asymmetric future-lead loss reduces common lead-side row error, but can worsen rare event tails if used alone. v21 corrected oracle leakage and found a runtime-only event-safe candidate that passed deployment gates, but the model was not designed as a multi-horizon predictor.

This leaves an open risk: UI target correction changes the effective prediction horizon, while the current model may be mostly tuned to the default horizon region.

## Kernel Observations

The existing KernelBench native code is useful as a feature-detection and benchmarking reference, not as a drop-in MLP runtime:

- it benchmarks dot products, not full MLP inference;
- a product native path would need a dedicated ABI, CPU dispatch, fallback, and packaging;
- native AVX2/FMA or AVX-512F should be considered only if scalar generated C# is clearly too slow for a better model.

## Initial Direction

The first useful experiment is not to train a bigger model immediately. It is to audit the current and baseline predictors over a sweep of effective future horizons and target correction values. If this shows horizon sensitivity, v24 will build multi-horizon labels and train models that understand the requested future time directly.
