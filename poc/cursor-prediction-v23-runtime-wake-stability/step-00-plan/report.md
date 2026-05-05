# Step 00 - Plan

## Objective

Evaluate whether wake-up stability, rather than prediction math, is the current limiting factor for Cursor Mirror. Use the same generated Calibrator lab package for all variants so the comparison focuses on scheduler behavior.

## Variants

1. Baseline `LeastSquares`.
2. `LeastSquares` with `SetWaitableTimerEx`.
3. `LeastSquares` with a 1000 us fine-wait window.
4. `LeastSquares` with a 2000 us fine-wait window.
5. `LeastSquares` with 1000 us deadline message deferral.
6. `LeastSquares` with `SetWaitableTimerEx`, 1000 us fine wait, 250 us yield threshold, and 1000 us message deferral.
7. The same combined scheduler settings with the practical `ConstantVelocity +2 ms` model.

## Scoring

Visual Calibrator scores are treated as coarse closed-loop confirmation because Windows Graphics Capture cadence is often below 60 Hz. Product runtime telemetry is the primary signal for scheduler work:

- `wakeLateMicroseconds` p95/p99/max
- `vBlankLeadMicroseconds` p95/p99/max
- `messageWakeCount`
- `fineSleepZeroCount`
- `fineSpinCount`
- controller and overlay operation cost

## Decision Rule

Prefer a variant only if it reduces scheduler lateness without increasing visual separation tails or overlay/controller cost. If WGC cadence masks the result, use product runtime telemetry to choose the next Calibrator run.

