# Step 07 Notes - Runtime-only Correction

## Scope

This step writes only under `poc/cursor-prediction-v21/step-07-runtime-only-correction/`.

Read-only inputs:

- `poc/cursor-prediction-v21/step-06-deployment-gate-analysis/harness/`
- `poc/cursor-prediction-v21/step-06-deployment-gate-analysis/scores.json`
- `poc/cursor-prediction-v21/step-02-balanced-evaluation/split-manifest.json`
- `poc/cursor-prediction-v21/step-02-balanced-evaluation/metric-policy.json`
- repository-root recording ZIPs referenced by the manifest

## Confirmed Leakage in Prior Harness

Step06 used values that are not available in product runtime:

- `F.TargetDistance` was interpolated from the future/reference target and was included in the MLP feature vector as `f.TargetDistance / 8`.
- `F.SamplerSpeed` was also derived from the same future/reference interpolation and was included as `f.SamplerSpeed / 3000`.
- `EvaluateGuardedModel` started/released the latch with `EventWindowLabel`, `StaticLabel`, and future target distance.

These values are still valid for training labels and evaluation metrics, but not for runtime model input or runtime guard decisions.

## Correction

The data model now separates:

- `DataRow.FutureTargetDistance`: future/reference distance used only for label construction and evaluation slices.
- `Features.RuntimeTargetDisplacementEstimate`: runtime-only estimate used by features and guards.

Exact feature-vector change:

- old: `f.TargetDistance / 8`
- new: `f.RuntimeTargetDisplacementEstimate / 8`

Additional correction:

- old: `f.SamplerSpeed / 3000`, where sampler speed came from future/reference interpolation
- new: `f.RuntimeSpeedEstimate / 3000`, where runtime speed is the v2 speed from current/past samples

`RuntimeTargetDisplacementEstimate` is computed as:

```text
max(0, horizonMs / 1000) * v2 speed from current/past samples
```

The runtime guard no longer reads `EventWindowLabel`, `StaticLabel`, `MovementPhase`, generated velocity/phase, or future target distance. It uses only runtime signals from current/past history: v2/v12/recentHigh/latestDelta/path efficiency/horizon/runtime estimated target displacement.

Training labels still use event/static labels and future reference targets, which is allowed because they are training-only.

## Compute

- Command shape: `dotnet run --project ...Step07RuntimeOnlyCorrection.csproj --no-restore`
- Runtime: 169699 ms.
- Execution: CPU-only serialized run.
- Rows evaluated: 252180.
- Seeds: `2105`, `2205`, `2305`.
- Runs: 15 learned candidate-seed evaluations plus product baseline.

## Cleanup

The harness produced `bin/` and `obj/` during build/run. They were removed after verifying the paths were inside the step07 workspace.
