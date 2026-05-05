# Experiment Log

## 2026-05-04

- Started POC v17 with write scope limited to `poc/cursor-prediction-v17/`.
- Created Step 01 and Step 02 scaffolding.
- Planned Step 01 as inventory-only and Step 02 as CPU-only fixed-runtime inference.
- Ran Step 01 inventory. Found 39 root ZIP inputs and existing v14-v16 POC artifacts.
- Ran Step 02 lightweight CPU analysis on 90,621 60Hz rows. Stop-approach slice has 1,994 rows; hard-stop slice has 645 rows.
- Baseline finding: v16 selected DistilledMLP lowers stop-approach Euclidean p95 versus Step5, but has higher stop-approach overshoot p95 and much higher post-stop residual prediction magnitude.
- Ran Step 03 CPU fixed-inference lag/deceleration ablation. Best practical candidate was `mlp_lag0p0_q0p125`; strong clamp/zero guards reduced overshoot but worsened stopApproach p95 too much.
- Ran Step 04 CPU soft-lag-gate search across 20 fixed/soft/clamp candidates. Recommendation remained `fixed_lag0p0`: disabling lag compensation beat all runtime soft gates on the balanced objective, overshoot, and visual-risk objectives.

## Step 05 - Product-Shape Validation (2026-05-04T05:06:05.122950+00:00)

- Ran CPU-only fixed inference with product-like stationary guard/gain/clamp around v16 DistilledMLP predictions.
- Recommendation: `product_lag0`.
- Key scores: all p95/p99 1.9566/4.5308, stop p95/p99 13.3899/29.4379, stop overshoot p95/p99 3.273/5.288, post-stop jitter p95/p99 0.2795/1.0078.
- Product caveat: full C# predictor replay was not compiled/run; POC mirrors product-side constants and branches on existing 60Hz rows.

## Step 06 - Timing Replay Validation (2026-05-04T05:14:07.604769+00:00)

- Ran CPU-only replay-equivalent lag/target-offset grid over 90621 base 60Hz rows.
- Selected `lag0p5_offsetm4p0ms`: lag 0.5 px, offset -4.0 ms.
- Key scores: all p95/p99 0.75/1.1524, stop p95/p99 1.793/2.719, stop signed -0.245, stop overshoot p95 0.8078, post-stop jitter p95 0.25, high-speed p95 1.9388.
- Full C# predictor replay remains pending; current run rebuilds shifted POC features/targets from source ZIPs.

## Step 07 - Offset Validity And Calibrator Check (2026-05-04T05:23:58.599429+00:00)

- Ran CPU-only fixed-slice lag/target-offset grid over 90620 offset-0 rows.
- Selected `lag0p5_offsetm4p0ms`: lag 0.5 px, offset -4.0 ms.
- Key scores: all p95 0.75, stop p95 1.7897, stop signed -0.2238, stop overshoot p95 0.8514, jitter p95 0.25, high-speed p95 1.9388.
- A/B/C conclusion: C - POC fixed-slice metrics strongly favor target-offset tuning, but product adoption should wait for C# replay or new timing-labelled measurement data..

## Step 08 - C# Chronological Replay (2026-05-04T05:31:00+00:00)

- Created a local C# replay harness under `step-08-csharp-chronological-replay/harness/` that links product predictor source and reads root ZIP `trace.csv` files in place.
- Confirmed product predictor has public model/offset/gain/horizon controls, but `lag0` is not directly switchable because generated `DistilledMlpPredictionModel.g.cs` bakes `LagCompensationPixels = 0.5f` as a `const`.
- Continued with full dotnet path `C:\Program Files\dotnet\dotnet.exe`; SDK 10.0.203 / MSBuild 18.3.3.
- Build succeeded after redirecting dotnet/NuGet user paths to Step8 local folders and retargeting the harness to `net10.0`.
- C# chronological replay succeeded for `lag0.5` offset 0/-2/-4 over 90,522 replay rows.
- Direct C# result supports `lag0.5 offset-4ms` on all p95 0.4171, stop p95 2.2742, post-stop jitter p95 0, and high-speed p95 0.4730.
- Caveat: C# direct stop-overshoot tail is worse at `-4ms` (p99 4.1280, >1px 0.0274, >2px 0.0193), so product validation must inspect visible tail cases.
- Updated conclusion to A-with-gate: `target offset -4ms` can advance as a guarded product candidate; `lag0` remains blocked by generated const lag compensation.

## Step 09 - C# Tail Guard Search (2026-05-04T05:55:00+00:00)

- Built and ran a Step9 C# harness over the same chronological ZIP replay, evaluating 23 static offset / lightweight guard candidates.
- Fixed the fractional-offset harness shape so integer offsets use product `ApplyPredictionTargetOffsetMilliseconds`, while fractional residuals shift target ticks only for diagnostic fine-grid evaluation.
- Baseline `offset -4ms` stop tail: `>1px=58`, `>2px=37`, `>4px=20` out of 1,933 stop rows.
- Tail cause: most top rows are timing-crossing cases where prediction is hold/zero but the `-4ms` effective target has crossed behind the cursor; runtime deceleration/stationary guards mostly do not fire.
- Selected `offset_m3p5` as the tail-objective candidate: stop p99 8.579, overshoot p99 2.038, `>2px=1.03%`, with tradeoff all p95 1.112 and post-stop jitter p95 0.901.
- Product guidance: do not add the tested guards; validate fractional `-3.5ms` if tail p99 is primary, otherwise keep integer `-4ms` as visual candidate and use tail rows for timing-data/retraining.

## Step 10 - C# Lag Overlay Grid (2026-05-04T06:05:00+00:00)

- Created a POC-only generated model overlay under `step-10-csharp-lag-overlay-grid/harness/Overlay/`.
- Built and ran four sequential C# replays with `LagCompensationPixels` patched to 0, 0.125, 0.25, and 0.5.
- Evaluated offsets `-4.5/-4.25/-4/-3.75/-3.5/-3.25/-3/-2/0`.
- Added metric semantics split: Euclidean visual error, offset0/base-direction overshoot, and candidate-target-direction overshoot.
- Key finding: `offset -4ms` has base-direction stop overshoot p99 4.128px but candidate-target overshoot p99 0px, confirming much of the Step9 tail is metric-frame crossing.
- Selected `lag0 offset-4ms` as best balanced/visual candidate: all p95 0.415, stop p95/p99 2.188/9.463, post p95 0, high p95 0.473.
- Product guidance: minimal change is target offset `-4ms`; if generated-model update is acceptable, also regenerate lag compensation to 0. Fractional `-3.5ms` remains a tail-oriented but non-minimal option.

## Product Reflection (2026-05-04)

- Updated the product `DistilledMlpPredictionModel.g.cs` to use `LagCompensationPixels = 0`.
- Added a visible DWM prediction target-offset control to the main settings window and demo startup UI.
- When `DistilledMLP` is selected from the default target offset, the UI switches the target offset to the validated `-4ms` recommendation.
- Updated localized strings, specs, and settings-window tests for the new target-offset control.

