# Step 06 Report - Calibrator Validation Decision

## Summary

v24 should not run a closed-loop Calibrator validation for a new MLP candidate yet.

The CPU-only sample runs found that the best candidate under product-shaped horizon semantics is still the simple `cv_v2_feature_baseline_static_guard`, not a learned MLP. Since there is no learned candidate that beats the baseline on the sampled test slice, a Calibrator run would mostly validate the existing baseline rather than answer the v24 ML question.

## Evidence

Step 03 absolute-horizon run:

- simple MLPs and residual MLPs did not beat `cv_v2` on visual p95/p99;
- standalone MLPs introduced visible stationary jitter;
- residual MLPs reduced jitter only when a static guard was applied, but still did not beat the guarded baseline.

Step 04 runtime horizon audit:

- v21 SmoothPredictor training labels used approximately scheduler target minus 4 ms;
- current UI display offset `0ms` maps to internal `+8ms`;
- the current default runtime horizon is therefore about 12 ms later than the v21 training horizon;
- large positive offsets may be rejected as excessive before the horizon cap is applied.

Step 05 kernel study:

- AVX2/FMA and AVX-512F are available and fast for dot-product proxy work;
- however, SIMD is not the immediate blocker because larger MLPs did not yet win on accuracy.

## Decision

Do not spend Calibrator measurement time on the Step 03 MLPs.

The next useful closed-loop Calibrator validation should wait until one of these exists:

- a product-shaped retrained model that beats `ConstantVelocity` or `cv_v2_static_guard` in offline product-horizon scoring;
- a runtime change to target-offset semantics or horizon rejection/cap ordering that needs visible validation;
- a final candidate combining CV/LeastSquares plus a bounded static/stop guard.

## Next Work

The next POC phase should focus on product-shaped target semantics before model size:

1. Rebuild labels using `sample-to-target + internal target offset`.
2. Treat expired and excessive horizons exactly as product runtime does.
3. Compare `ConstantVelocity`, `LeastSquares`, current `SmoothPredictor`, and `cv_v2_static_guard` under the same product-shaped scoring.
4. Only then try a learned residual or teacher model.

If a learned candidate finally beats the baseline offline, run Calibrator with the same MotionLab scenario set and target-offset sweep.
