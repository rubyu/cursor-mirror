# Step 8 Notes: C# Chronological Replay

## Scope

- Goal: verify whether the Step 7 `target offset -4ms` result survives a product-shaped chronological replay through `DwmAwareCursorPositionPredictor`.
- Product source was read only. No product file was modified.
- Heavy work stayed CPU-only and sequential.
- Raw ZIP contents were read in place; no expanded CSV copy was written.

## Product API Inventory

- `src/CursorMirror.Core/DwmAwareCursorPositionPredictor.cs`
  - `public sealed class DwmAwareCursorPositionPredictor`
  - Public prediction entry points:
    - `Predict(CursorPollSample, CursorPredictionCounters, long targetVBlankTicks, long refreshPeriodTicks)`
    - `PredictRounded(...)`
  - Public controls:
    - `ApplyPredictionModel(int)`
    - `ApplyPredictionTargetOffsetMilliseconds(int)`
    - `ApplyHorizonCapMilliseconds(int)`
    - `ApplyPredictionGainPercent(int)`
- `src/CursorMirror.Core/CursorPollSample.cs`
  - Public fields are sufficient for a replay sample: position, timestamp, stopwatch frequency, DWM vblank, DWM refresh period.
- `src/CursorMirror.Core/CursorPredictionCounters.cs`
  - Public counters can be created by the harness.
- `src/CursorMirror.Core/CursorMirrorSettings.cs`
  - DistilledMLP model id: `DwmPredictionModelDistilledMlp = 3`
  - Default target offset: `2ms`
  - Target offset range: `-8..8ms`
  - Default DWM horizon cap: `10ms`
- `src/CursorMirror.Core/DistilledMlpPredictionModel.g.cs`
  - Model id: `mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5`
  - Quantization step: `0.125px`
  - Lag compensation: `public const float LagCompensationPixels = 0.5f`
  - `ApplyLagCompensation` is private and runs after output quantization.

## Lag0 Blocking Finding

`lag0` cannot be directly evaluated through the product predictor API. The generated model bakes lag compensation as a `const` value, and the predictor exposes no runtime lag setting. Reflection cannot reliably change a compiled `const`; a direct C# lag0 replay requires either a POC-only generated model copy or a product/runtime change that makes lag a setting or generated variant.

## Replay Reconstruction Plan

The harness source was created under `harness/`.

- Call stream: `trace.csv` rows where `event == runtimeSchedulerPoll`
- `CursorPollSample.Position`: `cursorX/cursorY`, falling back to `x/y`
- sample timestamp: `runtimeSchedulerSampleRecordedTicks`, falling back to `stopwatchTicks`
- scheduler target: `predictionTargetTicks`, falling back to `presentReferenceTicks`
- refresh period: `dwmQpcRefreshPeriod`
- reference target: interpolated `referencePoll/cursorPoll/rawInput` positions by `elapsedMicroseconds`
- offsets to test: `0ms`, `-2ms`, `-4ms`
- lag directly testable: only `0.5px`

Estimated replay fidelity if built: **medium**. The trace has the main chronological call data, but not every controller-level reset/session boundary or product settings snapshot needed for high-fidelity replay.

## Execution Status

- `dotnet` is not on PATH, but `C:\Program Files\dotnet\dotnet.exe` works.
- `dotnet --info`:
  - SDK `10.0.203`
  - MSBuild `18.3.3+c23858a6d`
  - Host `10.0.7`
  - RID `win-x64`
- Initial build attempts hit sandbox/user config issues. Fixed by setting local Step8 paths for `APPDATA`, `DOTNET_CLI_HOME`, and `NUGET_PACKAGES`.
- The harness target was changed from `net8.0` to `net10.0` because only .NET 10 reference packs are available.
- Build succeeded with two nullable annotation warnings.
- Run succeeded and wrote `csharp-harness-output.json`.

## Direct C# Scores

| Candidate | rows | all p95 | stop p95 | stop overshoot p95/p99 | stop >1px / >2px | postStopJitter p95 | highSpeed p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| C# lag0.5 offset0 | 90522 | 1.9244 | 6.5783 | 0.0000 / 0.0000 | 0.0016 / 0.0000 | 1.0744 | 4.7716 |
| C# lag0.5 offset-2 | 90522 | 1.4170 | 4.3229 | 0.0000 / 0.3804 | 0.0021 / 0.0000 | 0.9461 | 1.3705 |
| C# lag0.5 offset-4 | 90522 | 0.4171 | 2.2742 | 0.0000 / 4.1280 | 0.0274 / 0.0193 | 0.0000 | 0.4730 |

## Step 7 Reference Carried Forward

Since C# replay could not run, `scores.json` records Step 7 fixed-slice references:

- current `lag0.5 offset0`: stop p95 `12.9117`, stop overshoot p95 `3.773`, postStopJitter p95 `0.7063`, highSpeed p95 `27.962`
- `lag0.5 offset-4`: stop p95 `1.7897`, stop overshoot p95 `0.8514`, postStopJitter p95 `0.25`, highSpeed p95 `1.9388`
- `lag0 offset0`: stop p95 `13.3906`, stop overshoot p95 `3.273`, postStopJitter p95 `0.2795`, highSpeed p95 `28.4611`

## Working Conclusion

Direct C# chronological replay supports `target offset -4ms` as the next product candidate. The recommendation is **A-with-gate**: try `-4ms` behind a controlled validation build or setting, while keeping replay-fidelity caveats visible. The direct C# replay also shows a worse stop-overshoot tail for `-4ms` despite much better p95/jitter/high-speed metrics, so next validation must inspect those tail frames. `lag0` remains blocked for direct product predictor evaluation until lag compensation is exposed as a setting or generated as a separate POC model variant.
