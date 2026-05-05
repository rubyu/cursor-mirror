# Cursor Prediction POC v25 - Runtime Horizon Training

## Goal

Find whether a learned predictor can beat the current simple runtime predictors when the training labels use the same target time semantics as the product.

The key hypothesis is that the previous SmoothPredictor model was trained around a narrow future-time convention, while the application now asks for `sample-to-target + target correction`. v25 therefore treats the UI target-correction range as part of the training problem instead of as an afterthought.

## Scope

- Use the existing v21 MotionLab split manifest as the first controlled dataset.
- Build multi-horizon labels from runtime scheduler timing plus target correction.
- Preserve product behavior for expired, excessive, and capped horizons.
- Compare simple velocity baselines, the current generated SmoothPredictor, and small horizon-aware MLPs.
- Score normal visual error, lead-side overshoot, stop/slow overshoot, and stationary jitter.

## Non-goals

- Do not write large intermediate row dumps.
- Do not promote a model to product code from this POC alone.
- Do not run Calibrator until an offline candidate beats the simple baselines under product-shaped scoring.

## Steps

1. `step-01-runtime-horizon-model-search`: bounded CPU-only runtime-horizon model search.
2. Later steps may add product-faithful LeastSquares replay, larger MLPs, SIMD runtime shape, and Calibrator validation if a learned model becomes competitive.

