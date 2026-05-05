# Step 01 - Runtime Wake Stability Calibrator Results

Input packages: 11. Closed-loop usable packages: 11.

## Overall

- Frames with motion context: 12859 / 12859
- Primary separation avg/p95/p99/max: 8.007 / 12 / 12 / 21 px
- All-package separation avg/p95/p99/max: 8.007 / 12 / 12 / 21 px
- Capture interval avg/p50/p95/max: 41.927 / 44.9340000000011 / 50.9919999999984 / 77.648000000001 ms
- Primary hold/stationary measurement floor p50/p95/max: 12 / 12 / 14 px
- Zero frames: 449
- Primary frames >12px: 37
- Primary frames >20px: 2

## Interpretation

- Stationary/hold rows have a nonzero measured separation floor. Treat small nonzero values as visual-estimator artifacts until the Calibrator detector is improved.
- The capture cadence is below 60 Hz for these packages. Use this audit for gross tail detection, not for proving small 1-4 ms improvements.
- There are >20px tail frames. These are the first closed-loop targets because they are above the likely measurement floor.

## Worst Pattern Groups

| pattern | count | avg | p95 | p99 | max | zeroRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scenario-006 | 1313 | 10.234 | 12 | 15 | 21 | 0.014 |
| scenario-005 | 1311 | 9.137 | 12 | 12 | 12 | 0.035 |
| scenario-007 | 1311 | 6.929 | 12 | 12 | 12 | 0.039 |
| scenario-009 | 1307 | 7.783 | 12 | 12 | 12 | 0.1 |
| scenario-008 | 1313 | 11.783 | 12 | 12 | 16 | 0.002 |
| scenario-001 | 1312 | 5.957 | 9 | 12 | 12 | 0.021 |
| scenario-000 | 1044 | 11.184 | 12 | 12 | 14 | 0.001 |
| scenario-002 | 1317 | 6.63 | 12 | 12 | 15 | 0.043 |
| scenario-004 | 1318 | 4.83 | 12 | 12 | 12 | 0.062 |
| scenario-003 | 1313 | 6.267 | 12 | 12 | 16 | 0.025 |

## Variant Groups

| variant | count | avg | p50 | p95 | p99 | max | zeroRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| lsq-setex-fine1000 | 1176 | 8.249 | 8 | 12 | 12 | 21 | 0.034 |
| lsq-setex | 1176 | 8.005 | 8 | 12 | 12 | 18 | 0.037 |
| lsq-setex-fine1000-deferral1000 | 1157 | 7.879 | 8 | 12 | 12 | 21 | 0.029 |
| lsq-setex-fine1000-mmcss | 1175 | 7.877 | 8 | 12 | 12 | 12 | 0.037 |
| lsq-setex-fine1000-deferral1000-mmcss | 1174 | 8.056 | 8 | 12 | 12 | 12 | 0.026 |
| lsq-fine2000 | 1175 | 8.161 | 8 | 12 | 12 | 14 | 0.024 |
| cv-plus2-setex-fine1000-deferral1000 | 1168 | 8.186 | 8 | 12 | 12 | 15 | 0.032 |
| cv-plus2-setex-fine1000 | 1170 | 7.948 | 8 | 12 | 12 | 19 | 0.046 |
| lsq-baseline | 1172 | 7.734 | 8 | 12 | 12 | 15 | 0.049 |
| lsq-fine1000 | 1175 | 8.118 | 8 | 12 | 12 | 16 | 0.031 |
| lsq-deferral1000 | 1141 | 7.857 | 8 | 12 | 12 | 19 | 0.039 |

## Packages

| variant | package | usable | frames | motion frames | avg | p95 | max | interval p50 | interval p95 | hold p95 | >12px |
| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cv-plus2-setex-fine1000 | cv-plus2-setex-fine1000\calibration.zip | True | 1170 | 1170 | 7.948 | 12 | 19 | 45.3139999999985 | 50.3769999999995 | 12 | 11 |
| cv-plus2-setex-fine1000-deferral1000 | cv-plus2-setex-fine1000-deferral1000\calibration.zip | True | 1168 | 1168 | 8.186 | 12 | 15 | 44.5120000000006 | 51.4000000000015 | 12 | 6 |
| lsq-baseline | lsq-baseline\calibration.zip | True | 1172 | 1172 | 7.734 | 12 | 15 | 45.0610000000015 | 50.9599999999991 | 12 | 3 |
| lsq-deferral1000 | lsq-deferral1000\calibration.zip | True | 1141 | 1141 | 7.857 | 12 | 19 | 45.8019999999997 | 52.4310000000005 | 12 | 5 |
| lsq-fine1000 | lsq-fine1000\calibration.zip | True | 1175 | 1175 | 8.118 | 12 | 16 | 44.6179999999995 | 51.0439999999944 | 12 | 1 |
| lsq-fine2000 | lsq-fine2000\calibration.zip | True | 1175 | 1175 | 8.161 | 12 | 14 | 44.8999999999996 | 50.9880000000048 | 12 | 1 |
| lsq-setex | lsq-setex\calibration.zip | True | 1176 | 1176 | 8.005 | 12 | 18 | 44.905999999999 | 50.5880000000034 | 12 | 3 |
| lsq-setex-fine1000 | lsq-setex-fine1000\calibration.zip | True | 1176 | 1176 | 8.249 | 12 | 21 | 44.598 | 50.8169999999955 | 12 | 4 |
| lsq-setex-fine1000-deferral1000 | lsq-setex-fine1000-deferral1000\calibration.zip | True | 1157 | 1157 | 7.879 | 12 | 21 | 44.9440000000031 | 51.2640000000001 | 12 | 3 |
| lsq-setex-fine1000-deferral1000-mmcss | lsq-setex-fine1000-deferral1000-mmcss\calibration.zip | True | 1174 | 1174 | 8.056 | 12 | 12 | 44.4579999999987 | 50.8160000000007 | 12 | 0 |
| lsq-setex-fine1000-mmcss | lsq-setex-fine1000-mmcss\calibration.zip | True | 1175 | 1175 | 7.877 | 12 | 12 | 45.1739999999991 | 50.7230000000018 | 12 | 0 |

## Next Loop

Run MotionLab-backed Calibrator captures for each candidate model/offset pair, always saving product runtime telemetry alongside visual metrics. Do not compare variants on packages whose capture cadence is too coarse unless the effect size is larger than the stationary measurement floor.
