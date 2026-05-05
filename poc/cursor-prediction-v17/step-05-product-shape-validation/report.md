# Step 05 - Product-Shape Validation

## Scope

Step 05 validates whether the Step 4 `fixed_lag0p0` recommendation still holds when approximating the current product runtime shape. This run is CPU-only fixed inference and lightweight aggregation; no GPU training or model search was run.

## Product Runtime Read

Files read:

- `src/CursorMirror.Core/DwmAwareCursorPositionPredictor.cs`: DistilledMLP is evaluated only when refresh is 14.0-19.5 ms, horizon is positive, history has 15 prior samples, stationary guard does not fire, then `_gain` and a 48 px clamp are applied.
- `src/CursorMirror.Core/DistilledMlpPredictionModel.g.cs`: generated model id `mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5`, q0.125 output quantization, hardtanh h8 FSMN/MLP, generated lag compensation 0.5 px.
- `src/CursorMirror.Core/CursorMirrorSettings.cs`: default gain is 100%, default DistilledMLP target offset setting is 2 ms, prediction model default remains ConstantVelocity unless selected.
- `tests/CursorMirror.Tests/ControllerTests.cs`: controller tests exercise DistilledMLP moving output and stationary fallback.

Constants mirrored in this POC:

```json
{
  "modelId": "mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5",
  "sequenceLength": 16,
  "sequenceFeatureCount": 9,
  "scalarFeatureCount": 25,
  "hidden": 8,
  "quantizationStepPx": 0.125,
  "generatedLagCompensationPx": 0.5,
  "minimumRefreshMs": 14.0,
  "maximumRefreshMs": 19.5,
  "maximumPredictionPx": 48.0,
  "defaultPredictionGain": 1.0,
  "stepBaselineHorizonOffsetMs": -2.0,
  "stepBaselineMaximumPredictionPx": 12.0,
  "stepBaselineMinimumEfficiency": 0.35,
  "stepBaselineMinimumSpeedPxPerSecond": 25.0,
  "stationaryMaximumSpeedPxPerSecond": 25.0,
  "stationaryMaximumNetPx": 0.75,
  "stationaryMaximumPathPx": 1.5,
  "defaultDwmPredictionTargetOffsetMs": 2,
  "defaultDwmPredictionHorizonCapMs": 10
}
```

POC approximation caveat: the evaluation rows are already the v12/v14-v16 60Hz dataset rows, so history warmup and feature construction are inherited from the POC loader. The Step 5 post-processing mirrors the product-side guard/scale/clamp around those rows instead of replaying the full C# predictor state machine sample by sample.

## Dataset

- Rows: 90621
- Slice counts: `{'all': 90621, 'stopApproach': 1994, 'hardStopApproach': 645, 'postStopHold': 14353, 'directionFlip': 19}`
- Stationary rows caught by product guard: 19644 (0.216771)

## Ranking

| candidate | kind | all mean | all p95 | all p99 | stop p95 | stop p99 | stop signed | stop over p95 | stop over p99 | over >1 | over >2 | hard over p95 | post jitter p95 | flip penalty p95 | high speed p95 | balanced |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product_lag0_stop_snap_light | product_like_lag0_plus_light_stop_snap | 0.5629 | 2.0 | 4.5308 | 13.3899 | 29.4379 | -1.4397 | 3.273 | 5.288 | 0.209127 | 0.106319 | 3.4468 | 0.1768 | 25.2779 | 28.4611 | 5.130854 |
| product_lag0 | product_like_fixed_lag | 0.5683 | 1.9566 | 4.5308 | 13.3899 | 29.4379 | -1.4397 | 3.273 | 5.288 | 0.209127 | 0.106319 | 3.4468 | 0.2795 | 25.2779 | 28.4611 | 5.187339 |
| product_lag0p0625 | product_like_fixed_lag | 0.5831 | 1.9457 | 4.5371 | 13.3274 | 29.3757 | -1.3772 | 3.3355 | 5.3505 | 0.218154 | 0.110832 | 3.5093 | 0.3125 | 25.3404 | 28.3987 | 5.247164 |
| product_lag0p125 | product_like_fixed_lag | 0.6012 | 1.9405 | 4.4851 | 13.265 | 29.3135 | -1.3147 | 3.398 | 5.413 | 0.225677 | 0.117352 | 3.5718 | 0.375 | 25.4029 | 28.3363 | 5.32452 |
| current_product_like | product_like_fixed_lag | 0.7743 | 1.9764 | 4.3629 | 12.9103 | 29.0009 | -0.9397 | 3.773 | 5.788 | 0.2999 | 0.153962 | 3.9468 | 0.7083 | 25.7779 | 27.962 | 5.951372 |
| product_lag0p5_remove_lag_on_decel | product_like_lag0p5_remove_lag_on_decel | 0.7743 | 1.9764 | 4.3629 | 12.9103 | 29.0009 | -0.9397 | 3.773 | 5.788 | 0.2999 | 0.153962 | 3.9468 | 0.7083 | 25.7779 | 27.962 | 5.951372 |

## Package Breakdown

| candidate | package | stop p95 | stop p99 | signed mean | overshoot p95 | overshoot p99 | overshoot >1 | overshoot >2 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current_product_like | m070248 | 12.655 | 28.4056 | -1.0652 | 3.5986 | 5.4417 | 0.283105 | 0.140639 |
| current_product_like | m070307 | 13.9386 | 28.9869 | -0.7867 | 4.3027 | 5.9474 | 0.320356 | 0.170189 |
| product_lag0 | m070248 | 13.146 | 28.9041 | -1.5652 | 3.0986 | 4.9417 | 0.187215 | 0.097717 |
| product_lag0 | m070307 | 14.4282 | 29.4205 | -1.2867 | 3.8027 | 5.4474 | 0.235818 | 0.116796 |
| product_lag0p0625 | m070248 | 13.0846 | 28.8417 | -1.5027 | 3.1611 | 5.0042 | 0.194521 | 0.10137 |
| product_lag0p0625 | m070307 | 14.367 | 29.3583 | -1.2242 | 3.8652 | 5.5099 | 0.246941 | 0.122358 |
| product_lag0p125 | m070248 | 13.0232 | 28.7794 | -1.4402 | 3.2236 | 5.0667 | 0.203653 | 0.110502 |
| product_lag0p125 | m070307 | 14.3057 | 29.2962 | -1.1617 | 3.9277 | 5.5724 | 0.252503 | 0.125695 |

## Recommendation

Recommended product-shape candidate: `product_lag0`.

- Runtime formula: `generated MLP q0.125 + lag 0.0px + gain1.0 + stationary fallback + clamp48`
- Runtime notes: `{'kind': 'product_like_fixed_lag', 'formula': 'generated MLP q0.125 + lag 0.0px + gain1.0 + stationary fallback + clamp48', 'productSafe': True, 'state': 'stateless', 'allocationRisk': 'none; fixed generated arrays already exist, added logic is scalar/branch only', 'extraBranchesEstimate': 2}`
- Summary: `{'allMean': 0.5683, 'allP95': 1.9566, 'allP99': 4.5308, 'stopP95': 13.3899, 'stopP99': 29.4379, 'stopSignedMean': -1.4397, 'stopOvershootP95': 3.273, 'stopOvershootP99': 5.288, 'stopOvershootGt1': 0.209127, 'stopOvershootGt2': 0.106319, 'hardStopP95': 16.5429, 'hardStopP99': 28.7619, 'hardStopSignedMean': -1.9299, 'hardStopOvershootP95': 3.4468, 'hardStopOvershootP99': 5.7633, 'hardStopOvershootGt1': 0.234109, 'hardStopOvershootGt2': 0.128682, 'postStopJitterP95': 0.2795, 'postStopJitterP99': 1.0078, 'directionFlipPenaltyP95': 25.2779, 'directionFlipPenaltyP99': 31.2559, 'directionFlipRows': 19, 'highSpeedRows': 152, 'highSpeedP95': 28.4611, 'highSpeedP99': 40.7673}`

Optional visual-risk variant: `product_lag0_stop_snap_light`. It is useful if post-stop jitter is prioritized above absolute simplicity, but it adds a small near-stop branch and did not improve stop-approach overshoot versus `product_lag0`.

## Visual Interpretation

Stationary jitter: product_lag0 postStopJitter p95/p99 is 0.2795/1.0078 versus current_product_like 0.7083/1.4988; removing lag directly lowers visible post-stop motion. Deceleration overshoot: product_lag0 stop overshoot p95/p99 is 3.273/5.288 versus current 3.773/5.788. Always-lag risk: product_lag0 stop signed mean is -1.4397, more negative than current -0.9397, so it can look slightly behind during stop approach even as it avoids leading past the real cursor. High-speed degradation: product_lag0 highSpeed p95/p99 is 28.4611/40.7673 versus current 27.962/40.2679; this is the main guardrail for not making fast movement feel worse.

## Adoption Decision

`product_lag0` is the product reflection candidate: it preserves product-like guard/gain/clamp behavior, removes only generated lag compensation, and improves the two visual-risk metrics targeted by v17 without a large all-slice regression.

## Next Steps

- Generate a lag0 variant of the runtime JSON/C# and run parity against the Python descriptor.
- Replay a small C# predictor harness over the same 60Hz traces to verify target offset, horizon cap, and fallback ordering exactly.
- If lag0 still feels too delayed, train or distill a no-lag target instead of adding a post-hoc lag offset.
- Add a minimal deceleration-aware output head or runtime confidence only if lag0 fails visual review on fast movement.
