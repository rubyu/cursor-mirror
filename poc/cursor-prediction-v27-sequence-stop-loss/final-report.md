# Cursor Prediction POC v27 - Final Report

## Summary

v27 reframed abrupt-stop overshoot as a sequence-level problem.

This was a useful step. It did not produce a product-ready model, but it did show that stop-aware sequence weighting can reduce overshoot duration and stationary jitter without paying the full SmoothPredictor-style visual lag penalty.

## Primary Run

- Step: `step-01-sequence-stop-loss`
- Train sequences: `260`
- Validation sequences: `80`
- Test sequences: `100`
- Feature rows: `322880`
- Horizons: `4/8/10/12/16ms`
- Runtime: bundled Python + NumPy, CPU only

## Key Test Results

Best sequence visual candidate:

- `direct_sequence_stop_h64`
- sequence visual p95: `36.588033`
- overshoot max p95: `12.763918`
- overshoot duration p95: `182.658769ms`
- stationary jitter p95: `1.303230`

Direct row-MSE baseline:

- `direct_row_mse_h32`
- sequence visual p95: `36.643263`
- overshoot max p95: `13.038369`
- overshoot duration p95: `383.040881ms`
- stationary jitter p95: `2.488996`

Current SmoothPredictor:

- sequence visual p95: `44.859180`
- overshoot max p95: `0.616060`
- overshoot duration p95: `0.000000ms`
- stationary jitter p95: `0.818744`

## Interpretation

The sequence-stop loss direction is promising, but still incomplete.

The good news is that `direct_sequence_stop_h64` improved the important temporal failure metric compared with row-MSE: overshoot duration was roughly halved while sequence visual p95 stayed almost unchanged.

The bad news is that the model still has the same fundamental trade-off. SmoothPredictor nearly eliminates overshoot, but becomes visibly late. The new sequence-stop model stays much closer visually, but still permits meaningful overshoot.

This suggests the missing piece is not simply "more MLP." The predictor needs either:

- a reliable deceleration/braking detector that only changes behavior when the stop risk is real, or
- a two-regime model that can switch between normal tracking and stop-safe prediction without becoming globally conservative.

## Artifacts

- `step-01-sequence-stop-loss/train_sequence_stop_models.py`
- `step-01-sequence-stop-loss/scores.json`
- `step-01-sequence-stop-loss/report.md`
