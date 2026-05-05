# Final Report

## What Changed

The v28 two-regime candidate was integrated into the product code as `TwoRegimeSmoothPredictor`.

It is available from:

- the main settings window prediction model dropdown;
- the demo prediction model dropdown;
- Calibrator CLI aliases including `v28` and `two-regime`.

The normal-regime MLP weights are generated in `src/CursorMirror.Core/TwoRegimeNormalPredictorModel.g.cs`. Runtime blending uses the existing SmoothPredictor feature vector, so the implementation does not add new telemetry collection or allocation-heavy feature construction.

## Verification

Build and unit tests passed in both configurations:

- `scripts/test.ps1 -Configuration Debug`
- `scripts/test.ps1 -Configuration Release`

Closed-loop Calibrator validation was run for:

- `ConstantVelocity`;
- `SmoothPredictor`;
- `TwoRegimeSmoothPredictor`.

The main comparison is `step-02-default-target-closed-loop`, using raw target offset `8 ms`, equivalent to UI target correction `0 ms`.

## Result

The new candidate did not become the closed-loop SOTA.

At default target correction, `TwoRegimeSmoothPredictor` had similar p95 separation to the other candidates but slightly worse average separation and higher prediction CPU cost:

- `ConstantVelocity`: avg `4.402 px`, p95 `12 px`, max `14 px`, predict p95 `5.8 us`
- `SmoothPredictor`: avg `4.382 px`, p95 `12 px`, max `17 px`, predict p95 `35.0 us`
- `TwoRegimeSmoothPredictor`: avg `4.512 px`, p95 `12 px`, max `14 px`, predict p95 `47.8 us`

Because the capture interval p50 was about `44-45 ms` and hold/stationary floor p95 was `12 px`, this Calibrator run is mainly a regression/tail check. It does not prove small timing improvements. It does show that the new model is not an obvious product-runtime improvement.

## Decision

Keep `TwoRegimeSmoothPredictor` selectable for further experiments, but do not promote it to default.

The practical SOTA for the product remains the existing simple models, with `ConstantVelocity` as the default and `SmoothPredictor` as the stronger experimental alternative for some stop-safe cases.
