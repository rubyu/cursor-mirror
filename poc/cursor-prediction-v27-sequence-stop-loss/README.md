# Cursor Prediction POC v27 - Sequence Stop Loss

## Goal

Investigate the abrupt-stop overshoot problem as a sequence problem.

v26 showed that a row-level asymmetric loss can reduce lead, but it also makes the predictor globally conservative. v27 adds procedural sudden-stop scenarios and sequence-level metrics so that the model is judged on the visible behavior: whether the mirror cursor passes the true cursor and then comes back.

## Rules

- Runtime features use only current and past cursor samples.
- Future positions are used only as labels and metrics.
- Scenario samples are generated procedurally; no per-frame scenario files are precomputed.
- The score must include overshoot max, overshoot duration, recovery time, normal movement error, and stationary jitter.
- Large intermediate datasets and frequent checkpoints are intentionally avoided.

## Steps

1. `step-01-sequence-stop-loss`
   - Generates 60 Hz runtime-like samples from abrupt-stop, eased-stop, curve-stop, reverse-stop, hook-stop, micro-resume, and normal-curve families.
   - Builds multi-horizon labels at `4/8/10/12/16ms`.
   - Evaluates CV baselines, soft braking, current SmoothPredictor, row-loss MLPs, and sequence-stop-weighted MLPs.
   - Writes compact `scores.json` and `report.md`.

## Current Finding

Sequence-stop weighting is useful, but not enough by itself.

Compared with direct row MSE, `direct_sequence_stop_h64` kept similar sequence visual p95 while reducing overshoot duration and stationary jitter:

- `direct_row_mse_h32`: sequence visual p95 `36.643263`, overshoot duration p95 `383.040881ms`, jitter p95 `2.488996`
- `direct_sequence_stop_h64`: sequence visual p95 `36.588033`, overshoot duration p95 `182.658769ms`, jitter p95 `1.303230`

However, it did not reach SmoothPredictor-level overshoot suppression:

- `current_smooth_predictor`: overshoot max p95 `0.616060`, but sequence visual p95 `44.859180`

The next step should search for a non-conservative deceleration detector or a two-regime predictor that applies stop-safe behavior only around actual braking events.
