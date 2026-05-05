# Step 01 - TwoRegimeSmoothPredictor Calibrator Closed Loop

Input packages: 3. Closed-loop usable packages: 3.

## Overall

- Frames with motion context: 3105 / 3105
- Primary separation avg/p95/p99/max: 4.649 / 12 / 12 / 15 px
- All-package separation avg/p95/p99/max: 4.649 / 12 / 12 / 15 px
- Capture interval avg/p50/p95/max: 47.333 / 47.1790000000001 / 62.3389999999999 / 82.8079999999973 ms
- Primary hold/stationary measurement floor p50/p95/max: 12 / 12 / 14 px
- Zero frames: 806
- Primary frames >12px: 8
- Primary frames >20px: 0

## Interpretation

- Stationary/hold rows have a nonzero measured separation floor. Treat small nonzero values as visual-estimator artifacts until the Calibrator detector is improved.
- The capture cadence is below 60 Hz for these packages. Use this audit for gross tail detection, not for proving small 1-4 ms improvements.

## Worst Pattern Groups

| pattern | count | avg | p95 | p99 | max | zeroRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scenario-006 | 319 | 5.784 | 12 | 13 | 15 | 0.11 |
| scenario-005 | 315 | 3.337 | 7 | 7 | 8 | 0.317 |
| scenario-007 | 318 | 4.425 | 12 | 12 | 12 | 0.352 |
| scenario-009 | 312 | 3.936 | 12 | 12 | 12 | 0.333 |
| scenario-008 | 322 | 8.748 | 12 | 13 | 14 | 0.043 |
| scenario-001 | 314 | 3.328 | 7 | 7 | 7 | 0.385 |
| scenario-000 | 247 | 6.668 | 12 | 12 | 12 | 0.17 |
| scenario-002 | 321 | 4.383 | 12 | 12 | 12 | 0.352 |
| scenario-004 | 319 | 2.687 | 7 | 8 | 8 | 0.317 |
| scenario-003 | 318 | 3.557 | 7 | 10 | 12 | 0.201 |

## Variant Groups

| variant | count | avg | p50 | p95 | p99 | max | zeroRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tworegime-smoothpredictor-offset0-50s | 1072 | 4.765 | 3 | 12 | 12 | 14 | 0.222 |
| smoothpredictor-offset0-50s | 1068 | 4.391 | 3 | 12 | 12 | 12 | 0.351 |
| constantvelocity-offset0-50s | 965 | 4.805 | 3 | 12 | 12 | 15 | 0.2 |

## Packages

| variant | package | usable | frames | motion frames | avg | p95 | max | interval p50 | interval p95 | hold p95 | >12px |
| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| constantvelocity-offset0-50s | constantvelocity-offset0-50s\calibration.zip | True | 965 | 965 | 4.805 | 12 | 15 | 48.6659999999993 | 64.0540000000001 | 12 | 3 |
| smoothpredictor-offset0-50s | smoothpredictor-offset0-50s\calibration.zip | True | 1068 | 1068 | 4.391 | 12 | 12 | 46.2010000000009 | 61.5040000000008 | 12 | 0 |
| tworegime-smoothpredictor-offset0-50s | tworegime-smoothpredictor-offset0-50s\calibration.zip | True | 1072 | 1072 | 4.765 | 12 | 14 | 46.3379999999997 | 60.3169999999991 | 12 | 5 |

## Next Loop

Run MotionLab-backed Calibrator captures for each candidate model/offset pair, always saving product runtime telemetry alongside visual metrics. Do not compare variants on packages whose capture cadence is too coarse unless the effect size is larger than the stationary measurement floor.
