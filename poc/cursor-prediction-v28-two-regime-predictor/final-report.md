# Cursor Prediction POC v28 - Final Report

## Summary

v28 tested a two-regime predictor: use a normal learned predictor most of the time, and blend toward a stop-safe predictor only when braking risk is high.

This is a useful improvement over v27. A simple rule gate reduced overshoot and jitter while keeping sequence visual p95 almost unchanged. The learned logistic gate did not beat the rule gate.

## Primary Run

- Step: `step-01-gated-stop-safe-blend`
- Seed: `2701`
- Train sequences: `260`
- Validation sequences: `80`
- Test sequences: `100`
- Feature rows: `322880`
- Candidates: `22`
- Runtime: bundled Python + NumPy, CPU only

## Key Test Results

Normal learned predictor:

- `normal_direct_sequence_stop_h64`
- sequence visual p95: `36.990163`
- overshoot max p95: `11.694030`
- overshoot duration p95: `249.639027ms`
- stationary jitter p95: `1.650574`

Best rule-gated trade-off:

- `rule_gate_normal_to_smooth_aggressive`
- sequence visual p95: `37.065958`
- overshoot max p95: `9.104569`
- overshoot duration p95: `133.434998ms`
- stationary jitter p95: `0.806114`
- safe ratio: `0.222987`

Lowest overshoot reference:

- `current_smooth_predictor`
- sequence visual p95: `44.859180`
- overshoot max p95: `0.616060`
- overshoot duration p95: `0.000000ms`
- stationary jitter p95: `0.818744`

## Interpretation

The two-regime idea is now justified.

The rule-gated blend did not eliminate overshoot like SmoothPredictor, but it reduced the bad temporal behavior substantially while preserving most of the normal predictor's visual tracking:

- overshoot max p95 improved from `11.694030` to `9.104569`
- overshoot duration p95 improved from `249.639027ms` to `133.434998ms`
- stationary jitter p95 improved from `1.650574` to `0.806114`
- sequence visual p95 changed only from `36.990163` to `37.065958`

The learned logistic gate is not ready. It approximates the row-level oracle target, but does not beat the hand-shaped deceleration gate. That suggests the current gate target is still too row-local. The useful signal is temporal braking risk, not just whether one row prefers the safe predictor.

## Recommendation

Promote `rule_gate_normal_to_smooth_aggressive` to the next POC stage, but not directly to product code yet.

The next step should be Calibrator closed-loop validation of this exact candidate. If closed-loop confirms the same improvement, the implementation path is a lightweight runtime gate over existing predictors rather than a larger MLP.

## Artifacts

- `step-01-gated-stop-safe-blend/train_two_regime_predictor.py`
- `step-01-gated-stop-safe-blend/scores.json`
- `step-01-gated-stop-safe-blend/report.md`
