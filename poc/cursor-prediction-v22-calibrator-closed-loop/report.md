# Cursor Prediction POC v22 - Current Report

## Status

The POC has been reset to use newly generated verification Lab data. Existing root capture packages are no longer scoring inputs.

## Step 00 Lab Data

Generated:

- `lab-data/calibrator-verification-v22.zip`
- `lab-data/calibrator-verification-v22.manifest.json`
- `lab-data/calibrator-verification-v22.summary.md`

The package is 50 seconds long at 240 Hz and includes hold floor, constant motion, fast stops, reversals, curves, low-speed movement, micro-adjustments, and mixed-speed sweeps.

## Historical Step 01 Findings

The old root Calibrator package audit is retained only as background context:

- total packages: `4`
- closed-loop usable packages with motion context and cadence data: `2`
- primary frames: `1616`
- primary separation avg/p95/p99/max: `3.096 / 12 / 12 / 78 px`
- primary hold/stationary measurement floor p50/p95/max: `12 / 12 / 12 px`
- primary frames over `12px`: `8`
- primary frames over `20px`: `2`
- capture interval avg/p50/p95/max: `42.07 / 44.11 / 52.235 / 66.4 ms`

Interpretation:

- The current Calibrator dark-bounds estimator has a nonzero stationary/hold floor around `12px`.
- Existing captures are around 24fps, so they are useful for large visible tails but not for proving small 1-4ms timing gains.
- The immediate closed-loop target is not p95 `12px`; that likely includes measurement floor. The first real target is the high-speed tail above `20px`, especially the `linear-fast` max `78px` case.
- Older packages without motion context remain in inventory but must not drive v22 closed-loop decisions.

## Step 02 Runbook

The POC includes `scripts/run-calibrator-variant.ps1`, which runs:

- MotionLab package-backed Calibrator playback;
- selected prediction model;
- selected DWM target offset;
- Calibrator visual package output;
- product runtime telemetry output.

The first grid should run against `lab-data/calibrator-verification-v22.zip` and compare:

- `ConstantVelocity` at `2`, `0`, and `-2 ms`;
- `LeastSquares` at `0 ms`;
- `DistilledMLP` at `-4 ms`;
- `RuntimeEventSafeMLP` at `-4` and `-2 ms`;

## Next Action

Completed the full 50s generated Lab package grid through Calibrator for each variant. Results are in:

- `step-03-calibrator-results/scores.json`
- `step-03-calibrator-results/report.md`
- `step-03-calibrator-results/product-runtime-scores.json`
- `step-03-calibrator-results/product-runtime-report.md`

Current visual ranking:

| variant | avg px | p95 px | max px | >12px |
| --- | ---: | ---: | ---: | ---: |
| `least-squares-offset-0` | 7.662 | 12 | 18 | 1 |
| `constant-velocity-offset-plus2` | 8.006 | 12 | 17 | 8 |
| `constant-velocity-offset-0` | 8.097 | 12 | 15 | 3 |
| `constant-velocity-offset-minus2` | 8.183 | 12 | 23 | 5 |
| `distilled-mlp-offset-minus4` | 8.853 | 12 | 19 | 1 |
| `runtime-event-safe-mlp-offset-minus4` | 9.834 | 12 | 19 | 2 |
| `runtime-event-safe-mlp-offset-minus2` | 9.930 | 12 | 17 | 3 |

Interpretation:

- `LeastSquares` at `0ms` is the best first-pass Calibrator result: lowest average and only one frame above the 12px detector floor.
- `ConstantVelocity +2ms` still has a strong max value, but more frames above 12px.
- The learned MLP variants do not win this generated Lab-package Calibrator pass.
- Scenario `006` (`repeated-stop-resume`) is the main visible-tail producer. It should drive the next targeted loop.
- Calibrator capture cadence is still around 44ms p50, so this run is valid for gross visible-tail detection but not for sub-frame timing proof.
- Product runtime telemetry shows prediction CPU cost is small; p95 prediction is under 30us even for MLP variants. Runtime cost is dominated by overlay move/update work around 0.8-1.0ms p95.

Next loop: improve the Calibrator detector/capture fidelity or add a targeted `repeated-stop-resume` package before changing product defaults.
