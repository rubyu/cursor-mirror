# Step 01 - Calibrator Audit

Input packages: 4. Closed-loop usable packages: 2.

## Overall

- Frames with motion context: 1616 / 1767
- Primary separation avg/p95/p99/max: 3.096 / 12 / 12 / 78 px
- All-package separation avg/p95/p99/max: 7.114 / 12 / 12 / 3805 px
- Capture interval avg/p50/p95/max: 42.07 / 44.1100000000006 / 52.2350000000006 / 66.4000000000005 ms
- Primary hold/stationary measurement floor p50/p95/max: 12 / 12 / 12 px
- Zero frames: 1119
- Primary frames >12px: 8
- Primary frames >20px: 2

## Interpretation

- Stationary/hold rows have a nonzero measured separation floor. Treat small nonzero values as visual-estimator artifacts until the Calibrator detector is improved.
- The capture cadence is below 60 Hz for these packages. Use this audit for gross tail detection, not for proving small 1-4 ms improvements.
- There are >20px tail frames. These are the first closed-loop targets because they are above the likely measurement floor.
- Some legacy packages lack motion context or cadence data. They remain in the archive inventory but are excluded from primary closed-loop scoring.

## Worst Pattern Groups

| pattern | count | avg | p95 | p99 | max | zeroRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| linear-slow | 252 | 2.964 | 9 | 12 | 12 | 0.603 |
| hold-right | 39 | 8.333 | 12 | 12 | 12 | 0.231 |
| linear-fast | 109 | 4.055 | 12 | 75 | 78 | 0.761 |
| hold-left | 42 | 6.762 | 12 | 12 | 12 | 0.429 |
| quadratic-ease-in | 199 | 4.442 | 12 | 13 | 13 | 0.573 |
| quadratic-ease-out | 173 | 1.838 | 10 | 12 | 12 | 0.775 |
| cubic-smoothstep | 200 | 3.905 | 12 | 12 | 12 | 0.585 |
| cubic-in-out | 143 | 3.517 | 12 | 12 | 12 | 0.636 |
| rapid-reversal | 143 | 1.685 | 12 | 12 | 12 | 0.832 |
| sine-sweep | 199 | 1.191 | 11 | 12 | 12 | 0.864 |
| short-jitter | 117 | 2.06 | 12 | 12 | 12 | 0.786 |

## Packages

| package | usable | frames | motion frames | avg | p95 | max | interval p50 | interval p95 | hold p95 | >12px |
| --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cursor-mirror-calibration-20260502-230553.zip | False | 82 | 0 | 84.683 | 12 | 3805 | 0 | 0 | 0 | 2 |
| cursor-mirror-calibration-20260502-230713.zip | False | 69 | 0 | 9.029 | 12 | 16 | 0 | 0 | 0 | 1 |
| cursor-mirror-calibration-20260505-075120.zip | True | 216 | 216 | 2.917 | 12 | 17 | 44.223 | 50.7450000000008 | 12 | 2 |
| cursor-mirror-calibration-20260505-075624.zip | True | 1400 | 1400 | 3.124 | 12 | 78 | 44.107 | 52.3399999999965 | 12 | 6 |

## Next Loop

Run MotionLab-backed Calibrator captures for each candidate model/offset pair, always saving product runtime telemetry alongside visual metrics. Do not compare variants on packages whose capture cadence is too coarse unless the effect size is larger than the stationary measurement floor.
