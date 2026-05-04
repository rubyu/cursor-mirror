# Step 8 Report: C# Chronological Replay

## Objective

Step 7 made `target offset -4ms` look much better, but that result was still a Python replay-equivalent fixed-slice evaluation. Step 8 attempted to move closer to product reality by creating a C# chronological replay harness around the current `DwmAwareCursorPositionPredictor`.

## What Was Built

Created a small harness project:

- `harness/CursorReplayHarness.csproj`
- `harness/Program.cs`
- `replay-config.json`
- `scripts/run-step-08-csharp-chronological-replay.py`

The harness links product source files into a local POC executable and reads the original ZIP traces in place. It is designed to evaluate:

- `lag0.5 + offset 0ms`
- `lag0.5 + offset -2ms`
- `lag0.5 + offset -4ms`

It reconstructs chronological calls from `runtimeSchedulerPoll` rows and uses `predictionTargetTicks` plus `dwmQpcRefreshPeriod` as the product scheduler timing input.

## Product Integration Findings

`DwmAwareCursorPositionPredictor` is public and has enough API surface for a POC harness to instantiate and call it directly. Target offset is product-switchable through `ApplyPredictionTargetOffsetMilliseconds(int)`.

`lag0` is not product-switchable. The generated DistilledMLP source has:

- model id `mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5`
- `QuantizationStep = 0.125f`
- `LagCompensationPixels = 0.5f`
- private `ApplyLagCompensation(...)`

So direct C# evaluation of `lag0` needs a POC-only generated source variant or a real product/runtime setting change.

## Execution Result

The C# harness was built and run with the full .NET path:

- dotnet path: `C:\Program Files\dotnet\dotnet.exe`
- SDK: `10.0.203`
- MSBuild: `18.3.3+c23858a6d`
- Host runtime: `10.0.7`
- build: succeeded
- build warnings: two nullable annotation context warnings in `Program.cs`
- run: succeeded
- output: `csharp-harness-output.json`

The project had to target `net10.0` because the environment has .NET 10 SDK/reference packs, not `net8.0` packs. Dotnet user/config paths were redirected to Step 8 local folders to avoid sandbox-denied AppData access.

## Quantitative Reference

Direct C# chronological replay results:

| Candidate | rows | all p95 | stop p95 | stop overshoot p95/p99 | stop >1px / >2px | postStopJitter p95 | highSpeed p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| C# lag0.5 offset0 | 90522 | 1.9244 | 6.5783 | 0.0000 / 0.0000 | 0.0016 / 0.0000 | 1.0744 | 4.7716 |
| C# lag0.5 offset-2 | 90522 | 1.4170 | 4.3229 | 0.0000 / 0.3804 | 0.0021 / 0.0000 | 0.9461 | 1.3705 |
| C# lag0.5 offset-4 | 90522 | 0.4171 | 2.2742 | 0.0000 / 4.1280 | 0.0274 / 0.0193 | 0.0000 | 0.4730 |

Step 7 fixed-slice references:

| Candidate | all p95 | stop p95 | stop overshoot p95 | stop >1px | stop >2px | postStopJitter p95 | highSpeed p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| lag0.5 offset0 | 1.9764 | 12.9117 | 3.7730 | 0.300552 | 0.154039 | 0.7063 | 27.9620 |
| lag0.5 offset-2 | 1.3976 | 12.7956 | 1.9474 | 0.141997 | 0.047667 | 0.6250 | 16.0208 |
| lag0.5 offset-4 | 0.7500 | 1.7897 | 0.8514 | 0.039639 | 0.008530 | 0.2500 | 1.9388 |
| lag0 offset0 | 1.9566 | 13.3906 | 3.2730 | 0.209232 | 0.106372 | 0.2795 | 28.4611 |
| lag0 offset-4 | 0.7500 | 1.7897 | 0.8514 | 0.039639 | 0.008530 | 0.2500 | 1.9388 |

Interpretation:

- `offset -4ms` is still the best POC candidate by a large margin.
- `lag0 offset0` helps stationary jitter and overshoot versus current `lag0.5 offset0`, but stop p95 and high-speed p95 do not improve.
- The lag choice matters less once offset is `-4ms` in the fixed-slice POC metric.

## Adoption Decision

Conclusion: **A-with-gate**.

`target offset -4ms` can move forward as the product candidate for a controlled validation build or guarded setting. It wins in the direct C# chronological replay on all p95, stop p95, post-stop jitter, and high-speed p95, and it also wins in the Step 7 fixed-slice POC metrics. The caveats are replay fidelity and a C# direct stop-overshoot tail: p95 is still zero, but p99 / >1px / >2px are higher at `-4ms`, so product validation must inspect the visible tail cases rather than only p95.

`lag0` is still not directly validated in C# because current generated product source does not expose lag compensation as a runtime setting.

## Next Step

To reproduce:

```powershell
& "C:\Program Files\dotnet\dotnet.exe" run --project poc/cursor-prediction-v17/step-08-csharp-chronological-replay/harness/CursorReplayHarness.csproj -- poc/cursor-prediction-v17/step-08-csharp-chronological-replay/replay-config.json
```

If lag0 must be part of Step 9, generate a POC-only `DistilledMlpPredictionModel` variant with `LagCompensationPixels = 0.0f`, or change the product integration shape so lag compensation can be selected without editing generated weights.
