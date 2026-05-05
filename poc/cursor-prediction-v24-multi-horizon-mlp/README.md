# Cursor Prediction POC v24 - Multi-Horizon MLP and Runtime Kernel Study

## Goal

Find a better CPU-runtime prediction model for Cursor Mirror while preserving runtime safety.

The specific question for v24 is whether the current `SmoothPredictor` family has learned the right future time for every target correction setting, and whether a larger or multi-horizon model can improve accuracy without making the product runtime too expensive.

The target remains "as close to zero error as practical", but every candidate must be evaluated against product constraints:

- runtime inference must work on CPU only;
- GPU is allowed only for offline training and teacher-model search;
- runtime inputs must be available from past and current cursor samples only;
- target correction must be represented as an actual future horizon, not as an after-the-fact UI offset;
- stop and static behavior must not introduce visible jitter or lead-side overshoot;
- measurement runs must be serialized because host load affects timing results.

## Key Questions

1. Does the existing `SmoothPredictor` behave correctly when target correction is swept across the full product range?
2. Is the model trained across a wide enough future horizon range to cover target correction, refresh timing, and runtime scheduling variation?
3. Does a multi-horizon target or horizon-conditioned model reduce lag/lead bias compared with the current single-output model?
4. Can high-capacity teacher models improve the score enough to justify distillation?
5. Can a larger CPU model remain cheap enough in scalar C#?
6. If scalar C# is insufficient, which SIMD path is actually useful: `System.Numerics`, native AVX2/FMA, or native AVX-512F?
7. Can online adaptation or an ensemble help without making stationary jitter and abrupt-stop overshoot worse?

## Execution Rules

- CPU-only analysis and code reading may be parallelized across subagents.
- GPU training must be single-runner.
- Calibrator or runtime performance measurements must be single-runner.
- Avoid frequent checkpoints and large intermediate files. Keep only scripts, compact reports, final scores, and selected candidate weights.
- Do not use future/reference data as runtime features. Future data is allowed only for labels and metrics.

## Planned Steps

### Step 00 - Inventory

Collect reusable artifacts from v19-v23 and the current product implementation:

- current `SmoothPredictorModel.g.cs` shape and tests;
- v21 runtime-only training harness and score policy;
- v20 asymmetric loss notes;
- v22/v23 Calibrator/runtime timing notes;
- KernelBench SIMD/native code that can be reused for a later kernel study.

### Step 01 - Horizon and Target-Correction Audit

Evaluate existing product candidates while sweeping effective target horizon:

- target correction from -32 ms to +32 ms;
- refresh-like horizons around 60 Hz;
- target horizon buckets and motion-regime buckets;
- lead/lag, visual error, stop-event peak lead, return motion, stationary jitter.

This step decides whether the current model is horizon-robust or only tuned to the current default.

### Step 02 - Multi-Horizon Dataset

Build a dataset view with multiple future labels per row:

- current history features only;
- missing-history masks or equivalent runtime-safe indicators;
- labels for a grid of future horizons;
- scenario and package split metadata;
- explicit buckets for static, slow, medium, fast, abrupt stop, resume, high-load, and scheduler-delay regimes.

### Step 03 - Teacher Model Search

Use larger models to find the best achievable accuracy:

- larger MLPs;
- horizon-conditioned MLPs;
- multi-head MLPs that predict several future horizons at once;
- FSMN-like temporal memory variants where the input shape justifies it;
- small ensembles and asymmetric/event-sequence losses.

GPU may be used here, but only one GPU job may run at a time.

### Step 04 - Distillation and Runtime Shape

Compress the best teacher behavior into product-shaped candidates:

- scalar C# generated model first;
- smaller hidden sizes and feature pruning;
- optional two-stage model, such as a cheap stop/static gate plus a horizon-conditioned predictor;
- optional online correction only if it is bounded, deterministic, and reset-safe.

### Step 05 - SIMD Kernel Study

Only after scalar size/cost is known, benchmark inference options:

- current scalar generated C#;
- hand-unrolled generated C# for larger hidden layers;
- `System.Numerics` if the project shape supports it cleanly;
- native AVX2/FMA and AVX-512F through a small ABI if model size demands it.

### Step 06 - Calibrator Validation

Run closed-loop Calibrator measurements for finalists:

- product default `ConstantVelocity`;
- `LeastSquares`;
- current `SmoothPredictor`;
- best v24 candidate.

Measure target-correction sweeps, abrupt-stop overshoot, jitter, runtime scheduler outliers, and visible error.

## Success Criteria

A candidate is worth product integration only if it:

- improves or matches visual p95/p99 in normal 60 Hz captures;
- does not regress lead-side overshoot and return motion in abrupt-stop scenarios;
- keeps stationary jitter below visible thresholds;
- handles target correction across the full configured range;
- has predictable CPU cost on the product runtime path;
- has a safe fallback when optional SIMD/native acceleration is unavailable.
