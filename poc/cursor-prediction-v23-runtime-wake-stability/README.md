# Cursor Prediction v23 - Runtime Wake Stability

## Goal

This POC keeps the cursor prediction model fixed and isolates the product runtime scheduler. The current best practical models are `LeastSquares` and `ConstantVelocity`; the remaining visible lag is suspected to come from wake-up jitter after the runtime thread sleeps.

## Hypothesis

Scheduler wake variance can be reduced by testing:

- `SetWaitableTimerEx` with zero tolerable delay.
- Larger fine-wait windows before the DWM-aligned deadline.
- Deadline-near message deferral so posted UI messages do not steal the last sub-millisecond window before the tick.
- Optional thread latency profile/MMCSS promotion.

## Fixed Inputs

- Motion package: `poc/cursor-prediction-v22-calibrator-closed-loop/lab-data/calibrator-verification-v22.zip`
- Runtime mode: `ProductRuntime`
- Primary model for the first grid: `LeastSquares`, target offset `0 ms`
- Secondary check: `ConstantVelocity`, target offset `+2 ms`

## Measurement

Each variant writes:

- `calibration.zip` for visual closed-loop metrics.
- `product-runtime.zip` for product runtime scheduler/controller/overlay telemetry.
- `command.txt` for exact reproduction.

Generated zips remain in `artifacts/` and are not source artifacts. Reports and score JSON files live under `step-01-calibrator-grid/`.

## Decision

The selected product runtime scheduler is `SetWaitableTimerEx + fine wait 1000 us + yield threshold 250 us`. In the v23 Calibrator run, the product-default `ConstantVelocity +2 ms` model with that scheduler reduced wake-late p95 from the old baseline's `801 us` to `94 us` while keeping the same coarse visual p95 band.
