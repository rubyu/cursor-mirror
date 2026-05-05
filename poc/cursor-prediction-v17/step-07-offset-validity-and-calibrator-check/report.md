# Step 07 - Offset Validity And Calibrator Check

## Scope

Step 07 rechecks the Step 6 target-offset result using fixed offset-0 rows and fixed offset-0 slice masks. This prevents `stopApproach`, `hardStop`, `postStop`, `highSpeed`, and `directionFlip` row counts from moving with the candidate offset. CPU-only fixed inference; no model training.

## Fixed Slice Setup

- Rows: 90620
- Fixed slice counts: `{'all': 90620, 'stopApproach': 1993, 'hardStopApproach': 645, 'postStopHold': 14353, 'directionFlip': 19}`
- Lag grid: `[0.0, 0.0625, 0.125, 0.25, 0.5]`
- Offset grid: `[-4.0, -2.0, 0.0, 2.0, 4.0]`
- Ranking objective prioritizes validation/test stop metrics over train/all metrics.

## Ranking

| candidate | lag | offset ms | all p95 | stop p95 | stop signed | stop over p95 | jitter p95 | high speed p95 | val stop p95 | test stop p95 | objective |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| lag0p5_offsetm4p0ms | 0.5 | -4.0 | 0.75 | 1.7897 | -0.2238 | 0.8514 | 0.25 | 1.9388 | 1.7897 | 1.5929 | 1.518962 |
| lag0p25_offsetm4p0ms | 0.25 | -4.0 | 0.75 | 1.7897 | -0.2242 | 0.8514 | 0.25 | 1.9388 | 1.7897 | 1.5929 | 1.519102 |
| lag0p125_offsetm4p0ms | 0.125 | -4.0 | 0.75 | 1.7897 | -0.2244 | 0.8514 | 0.25 | 1.9388 | 1.7897 | 1.5929 | 1.519172 |
| lag0p0625_offsetm4p0ms | 0.0625 | -4.0 | 0.75 | 1.7897 | -0.2245 | 0.8514 | 0.25 | 1.9388 | 1.7897 | 1.5929 | 1.519207 |
| lag0p0_offsetm4p0ms | 0.0 | -4.0 | 0.75 | 1.7897 | -0.2246 | 0.8514 | 0.25 | 1.9388 | 1.7897 | 1.5929 | 1.519242 |
| lag0p0_offsetm2p0ms | 0.0 | -2.0 | 1.625 | 13.2917 | -1.8512 | 1.4474 | 0.25 | 15.9809 | 16.7204 | 14.8489 | 8.436552 |
| lag0p0625_offsetm2p0ms | 0.0625 | -2.0 | 1.5766 | 13.2296 | -1.7903 | 1.5099 | 0.2577 | 15.9858 | 16.6581 | 14.7867 | 8.44377 |
| lag0p125_offsetm2p0ms | 0.125 | -2.0 | 1.5438 | 13.1676 | -1.7295 | 1.5724 | 0.2838 | 15.9908 | 16.5958 | 14.7245 | 8.461577 |
| lag0p25_offsetm2p0ms | 0.25 | -2.0 | 1.4849 | 13.0436 | -1.6078 | 1.6974 | 0.375 | 16.0008 | 16.4711 | 14.6001 | 8.517538 |
| lag0p5_offsetm2p0ms | 0.5 | -2.0 | 1.3976 | 12.7956 | -1.3644 | 1.9474 | 0.625 | 16.0208 | 16.2219 | 14.3514 | 8.690867 |
| lag0p0_offset0p0ms | 0.0 | 0.0 | 1.9566 | 13.3906 | -1.4405 | 3.273 | 0.2795 | 28.4611 | 18.8321 | 13.466 | 10.255843 |
| lag0p0625_offset0p0ms | 0.0625 | 0.0 | 1.947 | 13.3282 | -1.378 | 3.3355 | 0.3125 | 28.3987 | 18.7697 | 13.4038 | 10.280548 |
| lag0p125_offset0p0ms | 0.125 | 0.0 | 1.9405 | 13.2658 | -1.3155 | 3.398 | 0.375 | 28.3363 | 18.7072 | 13.3416 | 10.318626 |
| lag0p25_offset0p0ms | 0.25 | 0.0 | 1.9276 | 13.153 | -1.1905 | 3.523 | 0.4884 | 28.2116 | 18.5822 | 13.2172 | 10.394852 |
| lag0p5_offset0p0ms | 0.5 | 0.0 | 1.9764 | 12.9117 | -0.9405 | 3.773 | 0.7063 | 27.962 | 18.3323 | 12.9684 | 10.551907 |
| lag0p125_offset2p0ms | 0.125 | 2.0 | 2.185 | 14.0223 | -1.3701 | 4.3426 | 0.4858 | 31.7934 | 20.0232 | 13.6213 | 13.996179 |
| lag0p0625_offset2p0ms | 0.0625 | 2.0 | 2.1855 | 14.0848 | -1.4326 | 4.2801 | 0.4361 | 31.8559 | 20.0063 | 13.6823 | 13.996914 |
| lag0p0_offset2p0ms | 0.0 | 2.0 | 2.183 | 14.1472 | -1.4951 | 4.2176 | 0.3953 | 31.9183 | 19.9895 | 13.7434 | 13.997865 |

## Package Breakdown

| candidate | package | stop p95 | stop p99 | signed mean | overshoot p95 | overshoot >1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| lag0p5_offset0p0ms | m070248 | 12.6556 | 28.4162 | -1.067 | 3.6005 | 0.284278 |
| lag0p5_offset0p0ms | m070307 | 13.8634 | 28.9869 | -0.7866 | 4.3027 | 0.320356 |
| lag0p0_offset0p0ms | m070248 | 13.1472 | 28.9147 | -1.567 | 3.1005 | 0.187386 |
| lag0p0_offset0p0ms | m070307 | 14.3524 | 29.4205 | -1.2866 | 3.8027 | 0.235818 |
| lag0p5_offsetm4p0ms | m070248 | 1.6348 | 2.7308 | -0.2523 | 0.8603 | 0.036563 |
| lag0p5_offsetm4p0ms | m070307 | 1.9039 | 2.6927 | -0.1891 | 0.8391 | 0.043382 |
| lag0p0_offsetm4p0ms | m070248 | 1.6348 | 2.7308 | -0.2523 | 0.8603 | 0.036563 |
| lag0p0_offsetm4p0ms | m070307 | 1.9039 | 2.6927 | -0.1908 | 0.8391 | 0.043382 |
| lag0p5_offsetm2p0ms | m070248 | 12.5532 | 25.2926 | -1.5027 | 1.6448 | 0.127057 |
| lag0p5_offsetm2p0ms | m070307 | 13.2114 | 28.9585 | -1.1962 | 2.1774 | 0.160178 |

## Offset Sensitivity

Per-ms deltas from neighboring 2 ms steps. Negative `perMsStopP95` means moving later improves stop p95; positive means it worsens.

| lag | offset step | all p95 / ms | stop p95 / ms | stop overshoot p95 / ms | jitter p95 / ms |
| ---: | --- | ---: | ---: | ---: | ---: |
| 0.0 | -4.0 -> -2.0 | 0.4375 | 5.751 | 0.298 | 0.0 |
| 0.0 | -2.0 -> 0.0 | 0.1658 | 0.04945 | 0.9128 | 0.01475 |
| 0.0 | 0.0 -> 2.0 | 0.1132 | 0.3783 | 0.4723 | 0.0579 |
| 0.0 | 2.0 -> 4.0 | 0.2735 | 2.00425 | 0.0903 | 0.0277 |
| 0.0625 | -4.0 -> -2.0 | 0.4133 | 5.71995 | 0.32925 | 0.00385 |
| 0.0625 | -2.0 -> 0.0 | 0.1852 | 0.0493 | 0.9128 | 0.0274 |
| 0.0625 | 0.0 -> 2.0 | 0.11925 | 0.3783 | 0.4723 | 0.0618 |
| 0.0625 | 2.0 -> 4.0 | 0.26325 | 2.0042 | 0.0903 | 0.0343 |
| 0.125 | -4.0 -> -2.0 | 0.3969 | 5.68895 | 0.3605 | 0.0169 |
| 0.125 | -2.0 -> 0.0 | 0.19835 | 0.0491 | 0.9128 | 0.0456 |
| 0.125 | 0.0 -> 2.0 | 0.12225 | 0.37825 | 0.4723 | 0.0554 |
| 0.125 | 2.0 -> 4.0 | 0.27825 | 2.0042 | 0.0903 | 0.02225 |
| 0.25 | -4.0 -> -2.0 | 0.36745 | 5.62695 | 0.423 | 0.0625 |
| 0.25 | -2.0 -> 0.0 | 0.22135 | 0.0547 | 0.9128 | 0.0567 |
| 0.25 | 0.0 -> 2.0 | 0.1479 | 0.3722 | 0.4723 | 0.0466 |
| 0.25 | 2.0 -> 4.0 | 0.2661 | 2.00415 | 0.0903 | 0.0279 |
| 0.5 | -4.0 -> -2.0 | 0.3238 | 5.50295 | 0.548 | 0.1875 |
| 0.5 | -2.0 -> 0.0 | 0.2894 | 0.05805 | 0.9128 | 0.04065 |
| 0.5 | 0.0 -> 2.0 | 0.16425 | 0.368 | 0.4723 | 0.04415 |
| 0.5 | 2.0 -> 4.0 | 0.2705 | 2.004 | 0.0903 | 0.04465 |

## Calibrator / Measurement Check

Calibration ZIPs contain aggregate frame separation metrics, but not enough metadata to score lag/offset candidates.

Found calibration ZIPs: 2. Candidate-specific proxy available: `False`.

Missing for candidate scoring: `['no candidate prediction id or runtime setting per frame', 'no mapping from calibration frame timestamp to POC row/ref history', 'no true cursor and mirror cursor positions as separate coordinates, only estimated separation/bounds']`.

## Product Interpretation

A negative target offset shortens the predicted horizon: offset -4 ms evaluates/predicts a cursor position 4 ms earlier than the offset-0 target. This is directionally consistent with reducing overshoot, but it does not directly explain a pure lag feeling unless the product is currently predicting for a later time than the mirror is actually displayed. CursorMirrorSettings defaults DwmPredictionTargetOffsetMilliseconds to +2 ms, while DistilledMLP tests often use 0 ms; moving toward -4 ms would be a meaningful behavior change and should be confirmed in C# replay/present-timing data.

## Conclusion

C - POC fixed-slice metrics strongly favor target-offset tuning, but product adoption should wait for C# replay or new timing-labelled measurement data.

Selected recommendation for now: `lag0p5_offsetm4p0ms`.

- Summary: `{'allMean': 0.2544, 'allP95': 0.75, 'allP99': 1.1524, 'allSignedMean': -0.1042, 'allLeadRate': 0.316014, 'allLagRate': 0.53111, 'stopP95': 1.7897, 'stopP99': 2.7009, 'stopSignedMean': -0.2238, 'stopLeadRate': 0.390868, 'stopLagRate': 0.590065, 'stopOvershootP95': 0.8514, 'stopOvershootP99': 1.8692, 'stopOvershootGt1': 0.039639, 'stopOvershootGt2': 0.00853, 'hardStopOvershootP95': 0.7893, 'hardStopOvershootP99': 2.0502, 'postStopJitterP95': 0.25, 'postStopJitterP99': 0.5, 'directionFlipPenaltyP95': 0.4771, 'directionFlipPenaltyP99': 0.5954, 'directionFlipRows': 19, 'highSpeedRows': 152, 'highSpeedP95': 1.9388, 'highSpeedP99': 2.4102}`
- Validation/test: `{'validation': {'rows': 14220, 'allP95': 0.75, 'allP99': 1.0753, 'stopRows': 354, 'stopP95': 1.7897, 'stopP99': 2.4717, 'stopSignedMean': -0.1767, 'stopOvershootP95': 0.7893, 'postStopJitterP95': 0.25}, 'test': {'rows': 14174, 'allP95': 0.75, 'allP99': 1.125, 'stopRows': 289, 'stopP95': 1.5929, 'stopP99': 2.4662, 'stopSignedMean': -0.1332, 'stopOvershootP95': 0.8116, 'postStopJitterP95': 0.1768}}`

## Next Steps

- Build C# chronological replay harness and evaluate offset -4/-2/0 with current lag0.5 and lag0.
- Capture measurement data that records product candidate id, true cursor coordinate, mirror coordinate, display/present timestamp, and source trace row id.
- If C# replay confirms -4 ms, test a product-side DwmPredictionTargetOffsetMilliseconds candidate before changing model weights.
- If replay rejects offset tuning, keep lag0 as runtime candidate and retrain a timing-aware no-lag model.
