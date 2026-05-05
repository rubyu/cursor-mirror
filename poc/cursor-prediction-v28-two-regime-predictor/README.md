# Cursor Prediction POC v28 - Two-Regime Predictor

## Goal

Test whether a two-regime predictor can reduce abrupt-stop overshoot without making the cursor globally conservative.

v27 showed that sequence-stop weighting helps, but still leaves visible overshoot. v28 keeps the same procedural sequence dataset and adds a gate that blends a normal-tracking predictor with a stop-safe predictor.

## Rules

- Runtime features use only current and past cursor samples.
- Future positions are used only for labels, oracle gate targets, and metrics.
- The test dataset uses the same seed and shape as v27 for apples-to-apples comparison.
- The score must include sequence visual error, overshoot max, overshoot duration, recovery time, and stationary jitter.
- Large intermediate datasets and checkpoints are not written.

## Step

1. `step-01-gated-stop-safe-blend`
   - Builds the same procedural sudden-stop scenario families used in v27.
   - Trains a normal direct MLP and a more stop-safe direct MLP.
   - Tests rule gates and logistic oracle-approximation gates.
   - Tests blends against the current SmoothPredictor as the stop-safe regime.

## Current Finding

The best trade-off was a simple rule gate that blends the normal learned predictor toward SmoothPredictor only when braking risk is high.

Compared with the normal learned predictor:

- `normal_direct_sequence_stop_h64`: sequence visual p95 `36.990163`, overshoot max p95 `11.694030`, overshoot duration p95 `249.639027ms`, jitter p95 `1.650574`
- `rule_gate_normal_to_smooth_aggressive`: sequence visual p95 `37.065958`, overshoot max p95 `9.104569`, overshoot duration p95 `133.434998ms`, jitter p95 `0.806114`

This is the first POC in this series that materially improves overshoot and jitter while keeping visual p95 close to the best non-SmoothPredictor candidate.

The learned logistic gates were not clearly better than the rule gate. The next step should refine the braking risk signal and verify the rule-gated candidate through Calibrator closed-loop measurement.
