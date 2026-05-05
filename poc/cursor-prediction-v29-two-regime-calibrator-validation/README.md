# cursor-prediction-v29-two-regime-calibrator-validation

## Goal

Validate the v28 `rule_gate_normal_to_smooth_aggressive` candidate in the actual product runtime path.

The candidate is implemented as `TwoRegimeSmoothPredictor`, a selectable prediction model that blends:

- the existing `SmoothPredictor` output for aggressive deceleration / stop-risk regions;
- a newly exported v28 normal-regime MLP for regular motion;
- a lightweight rule gate using existing SmoothPredictor runtime features.

## Measurement Method

This POC uses a freshly generated MotionLab package:

- `lab-data/calibrator-verification-v29.zip`

The source generator is the existing v22 Calibrator verification generator, so the package metadata still reports `calibrator-verification-v22` as its generation profile. The file itself was generated for this v29 run and does not use existing captured user trace data.

Each Calibrator run used:

- Release build;
- `ProductRuntime`;
- Windows Graphics Capture enabled;
- product runtime telemetry enabled;
- SetWaitableTimerEx enabled;
- fine wait `2000 us`;
- spin threshold `100 us`;
- message deferral `100 us`;
- low-latency runtime profile enabled.

## Steps

| step | purpose |
| --- | --- |
| `step-01-calibrator-closed-loop` | First closed-loop comparison with raw target offset `0 ms`. Kept as auxiliary data because this is not the current UI-default target correction. |
| `step-02-default-target-closed-loop` | Main closed-loop comparison with raw target offset `8 ms`, which corresponds to UI target correction `0 ms`. |

## Decision

`TwoRegimeSmoothPredictor` is selectable and passes unit tests, but the Calibrator result does not justify promoting it over the existing default.

At the current default target correction:

| model | avg | p95 | max | frames >12px | predict p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ConstantVelocity | 4.402 px | 12 px | 14 px | 5 | 5.8 us |
| SmoothPredictor | 4.382 px | 12 px | 17 px | 2 | 35.0 us |
| TwoRegimeSmoothPredictor | 4.512 px | 12 px | 14 px | 5 | 47.8 us |

The Calibrator capture cadence was below 60 Hz, and the stationary measurement floor is around `12 px`, so small differences are not reliable. Still, the new candidate is not a clear closed-loop win and costs more prediction time than the existing alternatives.

Recommended status: keep as an experimental selectable model, do not make it the default.
