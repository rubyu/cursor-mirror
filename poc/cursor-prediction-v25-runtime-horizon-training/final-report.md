# Cursor Prediction POC v25 - Final Report

## Summary

v25 tested the original multi-horizon idea directly: training and evaluation labels were rebuilt from product-shaped runtime horizons, including `sample-to-target + target correction`, expired/excessive rejection, and the default horizon cap.

The result is clear for this dataset: the best practical predictor is still a short-window constant velocity predictor (`cv2`) with static guard. Larger MLPs, central-weighted residual MLPs, product-inspired LeastSquares replay, and a learned candidate selector did not beat it on the hard central target-correction buckets.

## Dataset

- Primary source: `poc/cursor-prediction-v21/step-02-balanced-evaluation/split-manifest.json`
- Runtime-shaped labels: 17 target-correction buckets from `-32ms` to `+32ms` in `4ms` steps
- Bounded run size: `408,000` feature rows
- Test rows: `40,800`
- Central bucket rows: `12,000`
- Large intermediate row dumps: not written

## Step Results

### Step 01 - Runtime-Horizon Model Search

Best simple candidates:

- `constant_velocity_v12_static_guard`: visual p95 `1.687676`, visual p99 `6.268748`
- `constant_velocity_v2_static_guard`: visual p95 `1.696106`, visual p99 `3.605551`

Best learned model by visual p95:

- `mlp_h32_mse`: visual p95 `2.096188`, visual p99 `6.291012`, stationary jitter p95 `0.691663`

The current generated SmoothPredictor stayed conservative on lead but lagged badly:

- `current_smooth_predictor_static_guard`: visual p95 `3.574788`, visual p99 `8.742579`

### Step 02 - Central Bucket Diagnostics

The hard region is `-8..+8ms`, especially `0/4/8ms`.

Simple CV-window combinations improved overall p95 but did not improve the central bucket:

- best overall: `switch_highspeed_cv2_threshold500_static_guard`, visual p95 `1.571674`
- best central: `cv2_static_guard`, central visual p95 `2.395489`, central visual p99 `6.391241`

### Step 03 - Central-Weighted MLP

Central/accepted/moving-weighted residual MLPs did not beat `cv2_static_guard`.

Best learned central visual p95 was still worse than CV2:

- `cv2_static_guard`: central visual p95 `2.395489`
- best learned residual: central visual p95 `4.090400`

Asymmetric/stop-weighted losses reduced some stop lead tails, but visual error became much worse.

### Step 04 - Product Replay Baselines

Product-inspired LeastSquares replay did not improve central buckets.

- `feature_cv2_static_guard`: central visual p95 `2.395489`
- `product_cv_uncapped_static_guard`: central visual p95 `2.395489`
- `least_squares_or_cv2_static_guard`: central visual p95 `4.302879`

LeastSquares valid rate was about `23.1%`. It reduced stop lead but increased lag/visual error too much.

### Step 05 - Central Residual Analysis

For CV2 on central buckets:

- visual p95 `2.395489`
- visual p99 `6.391241`
- lead p99 `2.421011`
- lag p99 `5.746955`

Lag is the larger tail. The worst buckets are `0/4/8ms`, all with:

- visual p95 `2.747414`
- visual p99 `7.779963`
- lag p99 `6.664437`

An oracle choosing among hold/CV2/CV12/current SmoothPredictor would improve central visual p95 to `2.014395`, but p99 only to `6.086140`.

### Step 06 - Candidate Gate

A learned gate tried to approximate the oracle by choosing among hold, CV2, CV12, and SmoothPredictor.

It did not beat CV2:

- `cv2`: central visual p95 `2.395489`, p99 `6.391241`
- best learned gate: central visual p95 `3.220971`, p99 `9.698919`
- oracle: central visual p95 `2.014395`, p99 `6.086140`

The oracle gap exists, but this simple selector cannot capture it safely.

## Interpretation

The multi-horizon correction was necessary for a fair experiment, and v25 confirms the old SmoothPredictor was trained against the wrong horizon distribution. However, once the labels are aligned with the product runtime, direct MLP regression is still not competitive.

The strongest practical signal is:

1. CV2 is the most robust central-bucket predictor.
2. CV12/LeastSquares can reduce some stop lead but introduce too much lag/visual error.
3. Current SmoothPredictor is conservative but too laggy under current target correction.
4. The remaining hard error is mostly lag tail in the `0/4/8ms` buckets.
5. The remaining gain likely requires better sample/target timing or a sequence-aware timing model, not a larger feed-forward displacement MLP.

## Recommendation

Do not promote a new MLP from v25.

The next product-facing direction should be:

- keep `ConstantVelocity`/CV2-like behavior as the stable baseline,
- investigate scheduler/sample/target timing alignment for the `0/4/8ms` buckets,
- only revisit ML after adding sequence-level timing labels or closed-loop Calibrator evidence that exposes information beyond the current short history features.

