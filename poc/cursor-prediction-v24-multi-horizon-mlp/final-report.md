# Cursor Prediction POC v24 - Interim Final Report

## Summary

v24 found a more fundamental issue than model capacity: the learned MLP horizon and the current product runtime horizon appear misaligned.

The current `SmoothPredictor` is structurally horizon-aware, but the v21-generated model was trained around a narrow horizon centered near the v21 `-4ms` label convention. Current product settings expose display target offset `0ms` as internal `+8ms`, and runtime scheduler traces show a typical sample-to-target value around `3.86ms`. This means the current default runtime often asks the model for roughly `11.86ms`, while the v21 model's learned horizon distribution is centered near `-0.38ms`.

That mismatch is large enough that simply making the MLP bigger is not the right next move.

## Completed Steps

### Step 00 - Inventory

Confirmed the current product model:

- `SmoothPredictor`
- 25 input features
- hidden size 32
- 2 output displacements
- about 864 MAC-like operations
- no normal per-call array allocation

### Step 01 - Horizon and Target-Correction Audit

Found that the target-correction UI range is far wider than the generated model's apparent horizon training distribution.

The model is horizon-aware, but v21 aggregate scores do not prove robustness across the full target-offset range.

### Step 02 - Multi-Horizon Dataset Audit

Verified the v21 MotionLab ZIP shape and estimated multi-horizon dataset size without writing large row dumps.

All required ZIP entries and required columns were present. The initial multi-horizon grid would produce roughly:

- train: about 648k labels
- validation: about 238k labels
- test: about 106k labels
- robustness: about 760k labels

### Step 03 - Initial MLP Search

Two bounded CPU-only sample runs were executed.

The absolute-horizon run showed simple MLPs did not beat a `cv_v2` baseline and introduced stationary jitter.

After switching to product-shaped horizon semantics, scores improved overall, but the best sample candidate remained:

```text
cv_v2_feature_baseline_static_guard
```

Best product-shaped sample result:

- visual p95: `1.838048`
- visual p99: `4.414031`
- lead p99: `1.406385`
- stationary jitter p95: `0`

Best MLP-family sample result:

- `residual_cv_mlp_h32_mse_static_guard`
- visual p95: `2.243876`
- visual p99: `6.777518`
- lead p99: `2.088791`

So the learned models are not yet competitive.

### Step 04 - Runtime Horizon Semantics Audit

Scanned 308,804 runtime scheduler rows.

Key timing:

- sample-to-target p50: `3.858ms`
- v21 training horizon estimate p50: `-0.142ms`
- current default runtime horizon estimate p50: `11.858ms`
- generated model horizon normalizer mean: about `-0.384ms`
- generated model horizon normalizer std: about `0.834ms`

Large positive target offsets can be rejected before the horizon cap is applied, so target offset `+16ms` and above often becomes hold fallback rather than capped prediction.

### Step 05 - SIMD Kernel Study

The existing KernelBench dot-product proxy was run once.

CPU features available:

- AVX
- AVX2
- FMA3
- AVX-512F

Directional dot-product result:

- managed scalar: 1.00x
- managed unrolled4: 1.87x
- native AVX2/FMA: 4.37x
- native AVX-512F: 9.06x

This confirms SIMD could matter for a larger model, but accuracy is the current blocker, not inference speed.

### Step 06 - Calibrator Decision

No new MLP candidate should be sent to Calibrator yet.

The offline sample search has not produced a learned model that beats the simple guarded CV baseline. Calibrator time should be reserved for a candidate that first wins under product-shaped offline scoring.

## Current Conclusion

The next best engineering move is not "train a bigger MLP".

The next move is to repair the experiment target semantics:

1. Train and evaluate using product-shaped horizons: `sample-to-target + internal target offset`.
2. Model expired and excessive horizons exactly as product runtime does.
3. Compare `ConstantVelocity`, `LeastSquares`, current `SmoothPredictor`, and a CV/static-guard baseline under the same scoring.
4. Only after a learned residual or teacher beats that baseline should we explore larger MLPs, SIMD kernels, or Calibrator validation.

## Recommendation

Treat the existing `SmoothPredictor` as experimental and avoid expanding it until the horizon mismatch is resolved.

For product behavior, `ConstantVelocity`/`LeastSquares` plus explicit static/stop guards is currently the stronger path than a larger MLP.
