# Step 06 - Timing Replay Validation

## Scope

Step 06 checks whether Step 5's `product_lag0` recommendation depends on product-shape post-processing, and quantifies timing alignment between the predicted future and the cursor position at the assumed reflection time. CPU fixed inference only; no GPU training was run.

## Replay Feasibility

Full C# predictor replay is pending because the current POC bundle does not preserve the exact product Predict call stream/state. Source ZIPs do provide enough reference history and target timestamps for Python replay-equivalent timing validation.

Available from current POC inputs:

- source ZIP trace/reference streams, `runtimeSchedulerPoll` anchors, DWM target/refresh ticks, reference cursor history, current latest reference position, scenario split/package metadata.

Missing for exact C# predictor replay:

- a row-stable mapping to every product `Predict` call with `CursorPollSample.Position` exactly as passed to C#;
- full predictor state evolution across all calls, including fallback/store ordering and resets;
- compiled harness wiring for the generated model without editing product source.

Therefore this step uses a Python replay-equivalent path: rebuild source-normalized MLP inputs and reference targets for each target offset, then apply product-like stationary/gain/clamp post-processing.

## Dataset

- Base rows: 90621
- Slice counts at selected candidate: `{'all': 90621, 'stopApproach': 2436, 'hardStopApproach': 795, 'postStopHold': 14555, 'directionFlip': 0}`
- Offset candidates: `[-4.0, -2.0, 0.0, 2.0, 4.0]`
- Lag candidates: `[0.0, 0.0625, 0.125, 0.25, 0.5]`

## Ranking

| candidate | lag | offset ms | all mean | all p95 | all p99 | stop p95 | stop p99 | stop signed | stop lead | stop lag | stop over p95 | over >1 | post jitter p95 | high speed p95 | objective |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| lag0p5_offsetm4p0ms | 0.5 | -4.0 | 0.2545 | 0.75 | 1.1524 | 1.793 | 2.719 | -0.245 | 0.372742 | 0.609195 | 0.8078 | 0.036535 | 0.25 | 1.9388 | 1.467374 |
| lag0p25_offsetm4p0ms | 0.25 | -4.0 | 0.2544 | 0.75 | 1.1319 | 1.793 | 2.719 | -0.2453 | 0.372742 | 0.609195 | 0.8078 | 0.036535 | 0.25 | 1.9388 | 1.467479 |
| lag0p125_offsetm4p0ms | 0.125 | -4.0 | 0.2543 | 0.75 | 1.1319 | 1.793 | 2.719 | -0.2454 | 0.372742 | 0.609195 | 0.8078 | 0.036535 | 0.25 | 1.9388 | 1.467514 |
| lag0p0625_offsetm4p0ms | 0.0625 | -4.0 | 0.2543 | 0.75 | 1.1319 | 1.793 | 2.719 | -0.2455 | 0.372742 | 0.609195 | 0.8078 | 0.036535 | 0.25 | 1.9388 | 1.467549 |
| lag0p0_offsetm4p0ms | 0.0 | -4.0 | 0.2543 | 0.75 | 1.1319 | 1.793 | 2.719 | -0.2456 | 0.372742 | 0.609195 | 0.8078 | 0.036535 | 0.25 | 1.9388 | 1.467584 |
| lag0p0_offsetm2p0ms | 0.0 | -2.0 | 0.4498 | 1.625 | 3.5838 | 4.8139 | 19.8422 | -0.7047 | 0.552459 | 0.429508 | 1.6881 | 0.096721 | 0.25 | 15.9809 | 2.863989 |
| lag0p0625_offsetm2p0ms | 0.0625 | -2.0 | 0.4533 | 1.5765 | 3.5385 | 4.7545 | 19.7802 | -0.6443 | 0.603279 | 0.396721 | 1.7506 | 0.101093 | 0.2457 | 15.9858 | 2.92383 |
| lag0p125_offsetm2p0ms | 0.125 | -2.0 | 0.461 | 1.5438 | 3.4936 | 4.7011 | 19.7181 | -0.5839 | 0.642623 | 0.355191 | 1.8131 | 0.106011 | 0.2795 | 15.9908 | 3.003659 |
| lag0p25_offsetm2p0ms | 0.25 | -2.0 | 0.4938 | 1.4848 | 3.3909 | 4.5951 | 19.5941 | -0.463 | 0.701639 | 0.298361 | 1.9381 | 0.119126 | 0.375 | 16.0008 | 3.176055 |
| lag0p5_offsetm2p0ms | 0.5 | -2.0 | 0.6012 | 1.3975 | 3.2489 | 4.4151 | 19.3459 | -0.2214 | 0.762295 | 0.237705 | 2.1881 | 0.187978 | 0.6204 | 16.0208 | 3.596432 |
| lag0p0_offset0p0ms | 0.0 | 0.0 | 0.5683 | 1.9566 | 4.5308 | 13.3899 | 29.4379 | -1.4397 | 0.563691 | 0.42678 | 3.273 | 0.209127 | 0.2795 | 28.4611 | 5.503284 |
| lag0p0625_offset0p0ms | 0.0625 | 0.0 | 0.5831 | 1.9457 | 4.5371 | 13.3274 | 29.3757 | -1.3772 | 0.587763 | 0.412237 | 3.3355 | 0.218154 | 0.3125 | 28.3987 | 5.537934 |
| lag0p125_offset0p0ms | 0.125 | 0.0 | 0.6012 | 1.9405 | 4.4851 | 13.265 | 29.3135 | -1.3147 | 0.624373 | 0.374122 | 3.398 | 0.225677 | 0.375 | 28.3363 | 5.607725 |
| lag0p25_offset0p0ms | 0.25 | 0.0 | 0.6506 | 1.927 | 4.4262 | 13.1527 | 29.1892 | -1.1897 | 0.674524 | 0.324975 | 3.523 | 0.247242 | 0.489 | 28.2116 | 5.799872 |
| lag0p5_offset0p0ms | 0.5 | 0.0 | 0.7743 | 1.9764 | 4.3629 | 12.9103 | 29.0009 | -0.9397 | 0.703611 | 0.296389 | 3.773 | 0.2999 | 0.7083 | 27.962 | 6.209437 |
| lag0p125_offset2p0ms | 0.125 | 2.0 | 0.7995 | 2.1855 | 5.8501 | 19.3589 | 37.0575 | -2.2729 | 0.607575 | 0.391899 | 4.3779 | 0.295634 | 0.4605 | 31.7934 | 11.660489 |
| lag0p0625_offset2p0ms | 0.0625 | 2.0 | 0.7815 | 2.1854 | 5.8804 | 19.4206 | 36.9963 | -2.3354 | 0.582851 | 0.417149 | 4.3154 | 0.286691 | 0.4193 | 31.8559 | 11.68381 |
| lag0p0_offset2p0ms | 0.0 | 2.0 | 0.7666 | 2.183 | 5.9125 | 19.4824 | 36.9751 | -2.3979 | 0.56444 | 0.4303 | 4.2529 | 0.280379 | 0.375 | 31.9183 | 11.695086 |

## Offset Winners

| offset ms | winner | lag | stop signed | stop over p95 | post jitter p95 | all p95 | high speed p95 | objective |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| -4.0 | lag0p5_offsetm4p0ms | 0.5 | -0.245 | 0.8078 | 0.25 | 0.75 | 1.9388 | 1.467374 |
| -2.0 | lag0p0_offsetm2p0ms | 0.0 | -0.7047 | 1.6881 | 0.25 | 1.625 | 15.9809 | 2.863989 |
| +0.0 | lag0p0_offset0p0ms | 0.0 | -1.4397 | 3.273 | 0.2795 | 1.9566 | 28.4611 | 5.503284 |
| +2.0 | lag0p125_offset2p0ms | 0.125 | -2.2729 | 4.3779 | 0.4605 | 2.1855 | 31.7934 | 11.660489 |
| +4.0 | lag0p25_offset4p0ms | 0.25 | -3.4252 | 4.734 | 0.6374 | 2.7556 | 32.9068 | 17.57627 |

## Package Breakdown

| candidate | package | stop p95 | stop p99 | signed mean | lead rate | lag rate | overshoot p95 | overshoot >1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| lag0p5_offset0p0ms | m070248 | 12.655 | 28.4056 | -1.0652 | 0.659361 | 0.340639 | 3.5986 | 0.283105 |
| lag0p5_offset0p0ms | m070307 | 13.9386 | 28.9869 | -0.7867 | 0.757508 | 0.242492 | 4.3027 | 0.320356 |
| lag0p0_offset0p0ms | m070248 | 13.146 | 28.9041 | -1.5652 | 0.525114 | 0.46484 | 3.0986 | 0.187215 |
| lag0p0_offset0p0ms | m070307 | 14.4282 | 29.4205 | -1.2867 | 0.610679 | 0.380423 | 3.8027 | 0.235818 |
| lag0p5_offsetm4p0ms | m070248 | 1.6677 | 2.7088 | -0.2772 | 0.310319 | 0.672606 | 0.7705 | 0.033408 |
| lag0p5_offsetm4p0ms | m070307 | 1.9089 | 2.7039 | -0.2051 | 0.449954 | 0.530762 | 0.8259 | 0.040404 |
| lag0p0625_offset0p0ms | m070248 | 13.0846 | 28.8417 | -1.5027 | 0.546119 | 0.453881 | 3.1611 | 0.194521 |
| lag0p0625_offset0p0ms | m070307 | 14.367 | 29.3583 | -1.2242 | 0.638487 | 0.361513 | 3.8652 | 0.246941 |
| lag0p125_offset0p0ms | m070248 | 13.0232 | 28.7794 | -1.4402 | 0.578082 | 0.421918 | 3.2236 | 0.203653 |
| lag0p125_offset0p0ms | m070307 | 14.3057 | 29.2962 | -1.1617 | 0.680756 | 0.315907 | 3.9277 | 0.252503 |

## Recommendation

Recommended candidate: `lag0p5_offsetm4p0ms`.

- Lag px: `0.5`
- Target offset ms: `-4.0`
- Summary: `{'allMean': 0.2545, 'allP95': 0.75, 'allP99': 1.1524, 'allSignedMean': -0.1052, 'allLeadRate': 0.318996, 'allLagRate': 0.536018, 'stopP95': 1.793, 'stopP99': 2.719, 'stopSignedMean': -0.245, 'stopLeadRate': 0.372742, 'stopLagRate': 0.609195, 'stopOvershootP95': 0.8078, 'stopOvershootP99': 1.876, 'stopOvershootGt1': 0.036535, 'stopOvershootGt2': 0.008621, 'hardStopOvershootP95': 0.7777, 'hardStopOvershootP99': 2.0202, 'postStopJitterP95': 0.25, 'postStopJitterP99': 0.5, 'directionFlipPenaltyP95': None, 'directionFlipPenaltyP99': None, 'directionFlipRows': 0, 'highSpeedRows': 152, 'highSpeedP95': 1.9388, 'highSpeedP99': 2.4102}`

## Interpretation

At the same target timing (offset 0 ms), lag0 reduces stop overshoot p95 from 3.773 to 3.273 and post-stop jitter p95 from 0.7083 to 0.2795, but shifts stop signed mean from -0.9397 to -1.4397 and raises lagRate to 0.42678. The grid best by objective is lag0p5_offsetm4p0ms with stop signed -0.245 and stop overshoot p95 0.8078. This indicates that the user's lag-only feeling is not caused only by the Step 5 post-processing approximation; it is the expected tradeoff when removing the generated 0.5 px lead offset from current weights.

## Decision

Target offset tuning has measurable value: the objective winner uses offset -4.0 ms. However, because this is replay-equivalent rather than full C# replay, treat offset changes as a candidate for a product harness before adoption. Lag compensation should not simply be restored to 0.5 px, because it reintroduces stop overshoot and post-stop jitter.

## Next Steps

- Build a minimal C# predictor replay harness that reads ZIP trace rows and calls DwmAwareCursorPositionPredictor in chronological order.
- Generate lag0 runtime JSON/C# and run parity plus manual visual review.
- Retrain/distill a no-lag or timing-aware target if the lag0 candidate feels too delayed in the C# harness.
- Capture one new trace with explicit mirror-present timestamp or render-apply timing if the target offset ambiguity remains.
