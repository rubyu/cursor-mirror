# Cursor Prediction v9 Experiment Plan

## Phase 0 - Setup And Audit

Purpose: verify available data, Python/uv/CUDA status, prior scripts, and the
current product baseline. This phase should not train models.

Outputs:

- `phase-0-audit.json`
- `phase-0-audit.md`

## Phase 1 - Dataset Builder

Purpose: build an in-memory dataset pipeline from trace zip files. The builder
must support causal history windows, missing-history masks, target horizons, and
session-based splits.

Rules:

- do not write a large `dataset.jsonl`;
- stream or cache in memory only;
- expose deterministic split manifests as small JSON.

Outputs:

- `phase-1-dataset.json`
- `phase-1-dataset.md`

## Phase 2 - Current And Classical Baselines

Purpose: reproduce the current product predictor and compare it with classical
low-cost candidates.

Candidates:

- current `ConstantVelocity`;
- `LeastSquares`;
- alpha-beta and alpha-beta-gamma filters;
- Kalman-style constant-velocity and constant-acceleration filters;
- robust polynomial extrapolation with clipping.

Promotion condition:

- beat the product baseline in mean and p95 without increasing p99/max risk.

## Phase 3 - Accuracy Ceiling Teachers

Purpose: find the best possible offline score without regard for product cost.

Candidates:

- MLP residual models;
- CNN/TCN sequence models;
- FSMN sequence models;
- GRU/LSTM teacher models;
- RFN/RBF random feature networks;
- mixture-of-experts with motion-regime gates.

GPU is allowed here. Report the best teacher even if too expensive.

## Phase 4 - Robustness And Leakage Checks

Purpose: ensure the best teacher is genuinely causal and robust.

Checks:

- cross-session train/test;
- chronological holdout;
- missing-history masking;
- speed-bin breakdown;
- acceleration/reversal/idle breakdown;
- comparison against a deliberately non-causal oracle to estimate the remaining
  irreducible gap.

## Phase 5 - Distillation And Runtime Approximation

Purpose: compress the best teacher into a product-shaped model.

Candidates:

- small linear/ridge residual models;
- RFN with fixed random features and small head;
- piecewise-linear or table-driven gates;
- SIMD-friendly dot products;
- small FSMN/CNN with quantized weights if it remains fast enough.

Outputs must include scalar and SIMD cost estimates where applicable.

## Phase 6 - Product Runtime Integration Candidate

Purpose: test the best distilled candidate in the actual product/Calibrator path.

This phase may require code changes outside `poc/`, but those changes should be
made only after the offline evidence is strong.

Measurements:

- Calibrator 30-second ProductRuntime run;
- repeated final runs for the top two candidates;
- comparison with current `ConstantVelocity` and `LeastSquares`.

## Iteration Rule

After every phase:

1. record what improved;
2. record what regressed;
3. decide the next hypothesis;
4. add a new phase if a promising signal appears.

Do not stop at the first model that improves mean error if p99/max behavior or
runtime cost is not understood.

