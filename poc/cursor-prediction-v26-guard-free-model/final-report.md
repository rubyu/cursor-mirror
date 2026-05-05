# Cursor Prediction POC v26 - Final Report

## Summary

v26 tested the idea that the predictor should learn stop and overshoot behavior directly, without adding another runtime guard.

The result is not good enough to promote a new model. The guard-free learned losses can reduce abrupt-stop overshoot, but the best overshoot-safe candidates become globally conservative and lose too much visual accuracy.

## Primary Run

- Step: `step-01-guard-free-loss-search`
- Data source: v21 MotionLab split manifest and root motion-recording ZIP files
- Label semantics: v25 product-shaped runtime horizons
- Rows per package: `1600`
- Total rows: `272000`
- Train rows: `108800`
- Validation rows: `27200`
- Test rows: `27200`
- Robustness rows: `108800`

## Key Test Results

Best visual p95:

- `constant_velocity_v3_guard_free`
- visual p95: `1.665096`
- braking lead p99: `9.137524`
- stationary jitter p95: `0.000000`

Best braking-side lead:

- `direct_asym12_stop_brake_h96`
- braking lead p99: `0.205793`
- visual p95: `3.686376`
- stationary jitter p95: `0.092253`

Current generated SmoothPredictor:

- visual p95: `3.826470`
- braking lead p99: `0.582272`
- stationary jitter p95: `0.147279`

## Interpretation

This confirms the suspected shape of the problem.

Simple CV models are still best for ordinary visual tracking, but they can lead too far during braking. The learned guard-free models can learn not to lead, but the available row-level objective makes them too conservative in general. That is why they feel late even when their stop behavior is safer.

The next useful POC should not merely increase hidden size. It should add explicit sudden-stop scenario families and evaluate visible sequence error, because the important behavior is temporal: "do not pass the true cursor and then come back" rather than "minimize one row at one horizon."

## Artifacts

- `step-01-guard-free-loss-search/train_guard_free_models.py`
- `step-01-guard-free-loss-search/scores.json`
- `step-01-guard-free-loss-search/report.md`
