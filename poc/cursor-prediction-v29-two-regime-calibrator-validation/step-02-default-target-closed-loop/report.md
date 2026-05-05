# Step 02 - TwoRegimeSmoothPredictor Default Target Calibrator Closed Loop

Input packages: 3. Closed-loop usable packages: 3.

## Overall

- Frames with motion context: 3438 / 3438
- Primary separation avg/p95/p99/max: 4.431 / 12 / 12 / 17 px
- All-package separation avg/p95/p99/max: 4.431 / 12 / 12 / 17 px
- Capture interval avg/p50/p95/max: 42.795 / 44.7650000000003 / 52.887999999999 / 75.489999999998 ms
- Primary hold/stationary measurement floor p50/p95/max: 12 / 12 / 12 px
- Zero frames: 816
- Primary frames >12px: 12
- Primary frames >20px: 0

## Interpretation

- Stationary/hold rows have a nonzero measured separation floor. Treat small nonzero values as visual-estimator artifacts until the Calibrator detector is improved.
- The capture cadence is below 60 Hz for these packages. Use this audit for gross tail detection, not for proving small 1-4 ms improvements.

## Worst Pattern Groups

| pattern | count | avg | p95 | p99 | max | zeroRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scenario-006 | 350 | 5.463 | 12 | 13 | 17 | 0.143 |
| scenario-005 | 347 | 3.167 | 7 | 8 | 8 | 0.305 |
| scenario-007 | 351 | 4.738 | 12 | 12 | 12 | 0.219 |
| scenario-009 | 357 | 3.571 | 12 | 12 | 13 | 0.339 |
| scenario-008 | 355 | 8.749 | 12 | 13 | 14 | 0.039 |
| scenario-001 | 346 | 2.633 | 7 | 7 | 7 | 0.338 |
| scenario-000 | 282 | 6.199 | 12 | 12 | 12 | 0.124 |
| scenario-002 | 348 | 4.359 | 12 | 12 | 12 | 0.276 |
| scenario-004 | 351 | 2.826 | 7 | 8 | 8 | 0.274 |
| scenario-003 | 351 | 2.883 | 7 | 8 | 12 | 0.296 |

## Variant Groups

| variant | count | avg | p50 | p95 | p99 | max | zeroRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tworegime-smoothpredictor-displayoffset0-50s | 1133 | 4.512 | 3 | 12 | 12 | 14 | 0.201 |
| smoothpredictor-displayoffset0-50s | 1162 | 4.382 | 3 | 12 | 12 | 17 | 0.327 |
| constantvelocity-displayoffset0-50s | 1143 | 4.402 | 3 | 12 | 12 | 14 | 0.182 |

## Packages

| variant | package | usable | frames | motion frames | avg | p95 | max | interval p50 | interval p95 | hold p95 | >12px |
| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| constantvelocity-displayoffset0-50s | constantvelocity-displayoffset0-50s\calibration.zip | True | 1143 | 1143 | 4.402 | 12 | 14 | 44.640999999996 | 53.2229999999981 | 12 | 5 |
| smoothpredictor-displayoffset0-50s | smoothpredictor-displayoffset0-50s\calibration.zip | True | 1162 | 1162 | 4.382 | 12 | 17 | 44.2659999999996 | 52.2480000000069 | 12 | 2 |
| tworegime-smoothpredictor-displayoffset0-50s | tworegime-smoothpredictor-displayoffset0-50s\calibration.zip | True | 1133 | 1133 | 4.512 | 12 | 14 | 45.2609999999986 | 53.8900000000001 | 12 | 5 |

## Next Loop

Run MotionLab-backed Calibrator captures for each candidate model/offset pair, always saving product runtime telemetry alongside visual metrics. Do not compare variants on packages whose capture cadence is too coarse unless the effect size is larger than the stationary measurement floor.
