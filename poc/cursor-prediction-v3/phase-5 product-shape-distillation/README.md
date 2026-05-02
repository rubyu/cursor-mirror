# Phase 5: Product Shape Distillation

This phase decides whether the Phase 4 gated residual can become a practical Cursor Mirror predictor.

## Goal

Translate the best offline candidate into a clear product shape and determine whether it is safe enough to implement.

## Required Outputs

- `report.md`
- `experiment-log.md`
- `scores.json`
- `model-spec.json`
- reproducible scripts/configs

## Questions

1. What state, features, coefficients, and gates are required?
2. Can the model be reduced without losing most of the gain?
3. What is the approximate hot-path cost?
4. Can the predictor run without allocations?
5. What tests would be needed before integration?
6. Should it be default-on, opt-in, or research-only?

## Product Bias

The current product baseline is still the safety fallback. The learned correction must abstain whenever its gate is uncertain.

