# Phase 3 Feature Engineering and Error Anatomy

## Method
- Reconstructed the accepted Phase 2 product path: poll anchors, dwm-next-vblank labels, chronological Phase 1 split, and gained-last2-0.75 baseline.
- Built labels by timestamp interpolation over poll samples and kept required history inside each split.
- Analyzed the primary baseline by speed, acceleration, turn angle, target horizon, hook age, poll-movement age, DWM phase, and duplicate-vs-moving anchors.
- Evaluated fixed 16ms and fixed 24ms comparison targets with the same poll-anchor gained-last2-0.75 predictor.

## Baseline Reconstruction
- Reconstructed validation: count 23637, mean 0.597 px, p95 1.936 px, max 314.232 px.
- Reconstructed test: count 23801, mean 0.947 px, p95 3.002 px, max 465.342 px.
- Phase 2 reference validation/test counts: 23637 / 23801; means 0.597 / 0.947 px.
- Fixed comparison targets with the same predictor: 16ms validation/test means 0.989 / 1.666 px; 24ms validation/test means 1.560 / 2.641 px.

The reconstruction matches the Phase 2 product baseline counts and metrics.

## Major Error Drivers
- speed_x_horizon / 3000+ | horizon 12-16: count 39, mean 37.883 px, p95 167.804 px.
- hook_age_x_speed / 0-2 | speed 3000+: count 46, mean 30.480 px, p95 144.672 px.
- speed / 3000+: count 181, mean 21.200 px, p95 69.300 px.
- speed_x_duplicate / 3000+ | moving: count 181, mean 21.200 px, p95 69.300 px.
- turn_x_speed / 0-15 | speed 3000+: count 164, mean 20.655 px, p95 67.297 px.

The high-error tail is dominated by motion state rather than ordinary standing-still anchors. The biggest validation clusters are high-speed movement, high acceleration, long DWM/target horizons, and recent hook activity during motion. Direction-change bins show that true reversals are rare in this trace; many failures are fast, nearly straight segments where the last poll delta underestimates the target-window displacement. Duplicate anchors have a low average error, but some recent-movement duplicates create very large single-sample misses.

## Lightweight Oracle / Gating Check
- Speed-gated gain analysis selected train-only gains by speed bin and changed validation mean by -0.0034 px (-0.58%); test mean changed by -0.0048 px (-0.50%).

This check is deliberately small: speed-bin gains are selected from train only, then applied unchanged to validation and test. It should be treated as a Phase 4 feature signal, not a final model.

## Phase 4 Feature Direction
- Minimal product-shaped search should start with last delta/velocity, speed, horizon, DWM phase, hook age, poll-movement age, and duplicate-anchor flags, predicting a residual or gain correction over gained-last2-0.75.
- Rich tabular models should add last-5 relative positions, velocity/acceleration history, turn angle, jerk proxy, hook-count windows, duplicate run length, and horizon normalized by DWM period.
- Temporal models should use a masked 16-step poll-history tensor plus context features for target horizon, DWM phase, hook age, and idle age.

## Leakage Rules
- Features must be computable at anchor time only.
- Future target positions and post-anchor hooks are labels/evaluation data only.
- Train-derived normalization, feature selection, and gating choices must be frozen before validation/test reporting.

See scores.json for full bin tables, representative high-error samples, gating metrics, leakage rules, and Phase 4 feature schemas.
