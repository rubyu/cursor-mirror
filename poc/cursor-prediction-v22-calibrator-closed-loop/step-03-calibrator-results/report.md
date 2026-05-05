# Step 03 - Generated Lab Calibrator Results

Input packages: 7. Closed-loop usable packages: 7.

## Overall

- Frames with motion context: 8218 / 8218
- Primary separation avg/p95/p99/max: 8.652 / 12 / 12 / 23 px
- All-package separation avg/p95/p99/max: 8.652 / 12 / 12 / 23 px
- Capture interval avg/p50/p95/max: 41.745 / 44.5229999999992 / 52.0239999999976 / 72.3799999999974 ms
- Primary hold/stationary measurement floor p50/p95/max: 12 / 12 / 12 px
- Zero frames: 404
- Primary frames >12px: 23
- Primary frames >20px: 2

## Interpretation

- Stationary/hold rows have a nonzero measured separation floor. Treat small nonzero values as visual-estimator artifacts until the Calibrator detector is improved.
- The capture cadence is below 60 Hz for these packages. Use this audit for gross tail detection, not for proving small 1-4 ms improvements.
- There are >20px tail frames. These are the first closed-loop targets because they are above the likely measurement floor.

## Worst Pattern Groups

| pattern | count | avg | p95 | p99 | max | zeroRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scenario-000 | 669 | 11.07 | 12 | 12 | 17 | 0.001 |
| scenario-001 | 840 | 7.182 | 12 | 12 | 12 | 0.019 |
| scenario-002 | 838 | 7.654 | 12 | 12 | 12 | 0.061 |
| scenario-003 | 839 | 7.596 | 12 | 12 | 14 | 0.051 |
| scenario-004 | 839 | 6.385 | 12 | 12 | 12 | 0.1 |
| scenario-005 | 839 | 9.226 | 12 | 12 | 12 | 0.05 |
| scenario-006 | 838 | 10.284 | 12 | 15 | 23 | 0.014 |
| scenario-007 | 839 | 7.741 | 12 | 12 | 12 | 0.063 |
| scenario-008 | 840 | 11.771 | 12 | 12 | 14 | 0.002 |
| scenario-009 | 837 | 8.102 | 12 | 12 | 12 | 0.119 |

## Variant Groups

| variant | count | avg | p50 | p95 | p99 | max | zeroRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| constant-velocity-offset-0 | 1174 | 8.097 | 8 | 12 | 12 | 15 | 0.037 |
| constant-velocity-offset-minus2 | 1172 | 8.183 | 8 | 12 | 12 | 23 | 0.044 |
| constant-velocity-offset-plus2 | 1175 | 8.006 | 8 | 12 | 12 | 17 | 0.038 |
| distilled-mlp-offset-minus4 | 1174 | 8.853 | 12 | 12 | 12 | 19 | 0.101 |
| least-squares-offset-0 | 1174 | 7.662 | 8 | 12 | 12 | 18 | 0.045 |
| runtime-event-safe-mlp-offset-minus2 | 1176 | 9.93 | 12 | 12 | 12 | 17 | 0.039 |
| runtime-event-safe-mlp-offset-minus4 | 1173 | 9.834 | 12 | 12 | 12 | 19 | 0.041 |

## Packages

| variant | package | usable | frames | motion frames | avg | p95 | max | interval p50 | interval p95 | hold p95 | >12px |
| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| constant-velocity-offset-0 | constant-velocity-offset-0\calibration.zip | True | 1174 | 1174 | 8.097 | 12 | 15 | 44.1959999999999 | 51.9619999999995 | 12 | 3 |
| constant-velocity-offset-minus2 | constant-velocity-offset-minus2\calibration.zip | True | 1172 | 1172 | 8.183 | 12 | 23 | 44.7750000000015 | 52.1510000000053 | 12 | 5 |
| constant-velocity-offset-plus2 | constant-velocity-offset-plus2\calibration.zip | True | 1175 | 1175 | 8.006 | 12 | 17 | 44.4300000000003 | 52.1990000000005 | 12 | 8 |
| distilled-mlp-offset-minus4 | distilled-mlp-offset-minus4\calibration.zip | True | 1174 | 1174 | 8.853 | 12 | 19 | 44.3730000000005 | 52.0690000000031 | 12 | 1 |
| least-squares-offset-0 | least-squares-offset-0\calibration.zip | True | 1174 | 1174 | 7.662 | 12 | 18 | 44.9969999999994 | 51.8300000000017 | 12 | 1 |
| runtime-event-safe-mlp-offset-minus2 | runtime-event-safe-mlp-offset-minus2\calibration.zip | True | 1176 | 1176 | 9.93 | 12 | 17 | 44.9120000000003 | 51.6510000000017 | 12 | 3 |
| runtime-event-safe-mlp-offset-minus4 | runtime-event-safe-mlp-offset-minus4\calibration.zip | True | 1173 | 1173 | 9.834 | 12 | 19 | 44.1429999999964 | 52.3810000000012 | 12 | 2 |

## Next Loop

Run MotionLab-backed Calibrator captures for each candidate model/offset pair, always saving product runtime telemetry alongside visual metrics. Do not compare variants on packages whose capture cadence is too coarse unless the effect size is larger than the stationary measurement floor.
