# Phase 1 Experiment Log

## Run

- script: `analyze_phase1.js`
- input: `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\cursor-mirror-trace-20260501-195819.zip`
- generated: `2026-05-01T11:11:09.185Z`
- elapsed: 2.619 sec
- rows/sec: 372,458

The script reads the zip directly and does not extract or mutate the input trace. It parses `metadata.json`, then independently computes CSV counts, intervals, DWM horizons, label coverage, hook/poll disagreement, and prediction errors from `trace.csv`.

## Metadata Cross-Check

| item | metadata | CSV audit |
|---|---:|---:|
| trace format | 3 | 3 |
| total samples | 975,443 | 975,443 |
| hook samples | 51,541 | 51,541 |
| product polls | 99,624 | 99,624 |
| reference polls | 824,278 | 824,278 |

## Event Counts

| event | count |
| --- | --- |
| move | 51,541 |
| poll | 99,624 |
| referencePoll | 824,278 |

## Event Interval Stats

| event | n intervals | mean ms | p50 ms | p95 ms | max ms |
| --- | --- | --- | --- | --- | --- |
| move | 51,540 | 40.935 | 8.002 | 106.837 | 75,216.111 |
| poll | 99,623 | 21.182 | 15.923 | 63.081 | 149.838 |
| referencePoll | 824,277 | 2.560 | 2.000 | 2.001 | 97.056 |

## Baseline Scores

| model | n | mean px | p50 px | p90 px | p95 px | p99 px | max px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| product DWM last2 gain 0.75 | 99,622 | 1.695 | 0.000 | 2.348 | 6.771 | 36.245 | 682.467 |
| hold current at DWM target | 99,622 | 2.444 | 0.000 | 2.828 | 10.000 | 57.057 | 522.433 |
| fixed 8ms last2 gain 0.75 | 99,623 | 1.494 | 0.000 | 2.281 | 6.146 | 31.295 | 448.368 |
| fixed 16ms last2 gain 0.75 | 99,622 | 2.877 | 0.000 | 4.636 | 12.416 | 60.463 | 799.888 |

## Audit Metrics

| metric | mean | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| product poll interval ms | 21.182 | 15.923 | 63.081 | 77.656 | 149.838 |
| DWM horizon ms | 8.151 | 8.153 | 15.638 | 16.258 | 16.597 |
| reference target interval ms | 2.239 | 2.000 | 2.001 | 6.074 | 87.542 |
| hook/poll disagreement px | 0.239 | 0.000 | 0.000 | 3.606 | 235.053 |

## Fallback Counts

| reason | count |
| --- | --- |
| no_previous_poll | 1 |
| invalid_product_dt | 0 |
| idle_gap_over_100ms | 72 |
| invalid_dwm_timing | 713 |
| missing_reference_label | 2 |
| used_velocity_prediction | 98,837 |

## Speed bins

| bin | n | baseline mean | baseline p95 | baseline p99 | hold mean | hold p95 |
| --- | --- | --- | --- | --- | --- | --- |
| missing | 1 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| 0-25 px/s | 76,723 | 0.309 | 0.000 | 3.970 | 0.309 | 0.000 |
| 25-100 px/s | 5,102 | 0.768 | 2.478 | 6.913 | 0.671 | 3.000 |
| 100-250 px/s | 4,591 | 1.474 | 4.962 | 12.470 | 1.674 | 6.083 |
| 250-500 px/s | 3,668 | 2.615 | 8.730 | 21.275 | 3.478 | 11.705 |
| 500-1000 px/s | 3,254 | 4.610 | 14.631 | 34.344 | 6.414 | 21.095 |
| 1000-2000 px/s | 2,821 | 7.565 | 21.771 | 51.594 | 11.486 | 34.132 |
| >=2000 px/s | 3,462 | 25.569 | 88.444 | 161.659 | 41.199 | 155.088 |

## Acceleration bins

| bin | n | baseline mean | baseline p95 | baseline p99 | hold mean | hold p95 |
| --- | --- | --- | --- | --- | --- | --- |
| missing | 2 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| 0-1k px/s^2 | 72,371 | 0.118 | 0.000 | 1.549 | 0.119 | 0.000 |
| 1k-5k px/s^2 | 7,158 | 1.105 | 4.269 | 12.200 | 1.392 | 6.403 |
| 20k-50k px/s^2 | 4,609 | 5.613 | 21.632 | 59.533 | 8.328 | 35.023 |
| 5k-20k px/s^2 | 9,266 | 2.579 | 10.046 | 27.270 | 3.659 | 16.310 |
| 50k-100k px/s^2 | 2,451 | 9.606 | 40.346 | 87.925 | 14.912 | 68.922 |
| >=100k px/s^2 | 3,765 | 21.013 | 84.600 | 165.261 | 30.815 | 143.883 |

## Product poll interval bins

| bin | n | baseline mean | baseline p95 | baseline p99 | hold mean | hold p95 |
| --- | --- | --- | --- | --- | --- | --- |
| missing | 1 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| 17-33 ms | 14,869 | 1.583 | 6.363 | 32.474 | 2.329 | 9.849 |
| 0-10 ms | 16,251 | 2.103 | 7.635 | 44.701 | 2.322 | 9.434 |
| 10-17 ms | 52,306 | 1.431 | 5.914 | 30.117 | 2.425 | 10.000 |
| 33-67 ms | 12,456 | 1.904 | 7.963 | 43.853 | 2.372 | 9.220 |
| 67-100 ms | 3,667 | 3.302 | 14.952 | 69.421 | 3.888 | 16.616 |
| >=100 ms | 72 | 6.494 | 29.313 | 133.976 | 6.494 | 29.313 |

## Reference target interval bins

| bin | n | baseline mean | baseline p95 | baseline p99 | hold mean | hold p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 0-2.1 ms | 98,244 | 1.682 | 6.746 | 35.685 | 2.423 | 10.000 |
| 2.1-4 ms | 293 | 0.892 | 4.854 | 14.891 | 1.480 | 7.080 |
| 4-8 ms | 160 | 6.371 | 39.483 | 104.353 | 6.803 | 44.620 |
| 8-16 ms | 248 | 1.743 | 6.119 | 36.701 | 3.060 | 13.891 |
| 16-50 ms | 625 | 2.801 | 9.029 | 48.833 | 4.562 | 14.170 |
| >=50 ms | 52 | 3.464 | 9.424 | 78.149 | 4.669 | 26.151 |

## Reference target nearest-coverage bins

| bin | n | baseline mean | baseline p95 | baseline p99 | hold mean | hold p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.5-1 ms | 49,332 | 1.727 | 6.636 | 37.918 | 2.458 | 9.899 |
| 0.25-0.5 ms | 24,664 | 1.623 | 6.617 | 33.330 | 2.394 | 10.000 |
| 0-0.25 ms | 24,803 | 1.661 | 7.065 | 34.997 | 2.414 | 10.296 |
| 2-4 ms | 290 | 2.866 | 12.287 | 68.461 | 3.541 | 13.821 |
| 1-2 ms | 294 | 4.088 | 10.601 | 55.539 | 4.790 | 16.201 |
| >=4 ms | 239 | 1.740 | 6.501 | 13.209 | 3.537 | 7.654 |

## DWM horizon bins

| bin | n | baseline mean | baseline p95 | baseline p99 | hold mean | hold p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 8-12 ms | 24,443 | 1.722 | 7.153 | 34.243 | 2.870 | 12.530 |
| 4-8 ms | 24,075 | 1.553 | 6.557 | 33.943 | 2.068 | 8.544 |
| 12-16.7 ms | 26,324 | 2.645 | 11.338 | 56.646 | 4.125 | 19.387 |
| 0-4 ms | 24,067 | 0.818 | 2.934 | 17.109 | 0.616 | 1.000 |
| invalid_dwm | 713 | 0.117 | 0.000 | 1.563 | 0.117 | 0.000 |

## Hook/poll disagreement bins

| bin | n | baseline mean | baseline p95 | baseline p99 | hold mean | hold p95 |
| --- | --- | --- | --- | --- | --- | --- |
| no_prior_hook | 21 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| 0-0.5 px | 97,662 | 1.452 | 5.673 | 30.488 | 2.113 | 8.062 |
| 0.5-2 px | 524 | 1.441 | 3.644 | 7.483 | 1.691 | 4.051 |
| 2-8 px | 731 | 4.438 | 11.283 | 18.930 | 6.094 | 14.442 |
| 8-32 px | 509 | 19.938 | 56.445 | 97.770 | 26.339 | 63.815 |
| >=32 px | 175 | 73.669 | 212.847 | 320.169 | 104.644 | 288.968 |

## Stop windows

| bin | n | baseline mean | baseline p95 | baseline p99 | hold mean | hold p95 |
| --- | --- | --- | --- | --- | --- | --- |
| not_near_stop | 38,332 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| pre_stop_0_16ms | 22,716 | 6.499 | 28.565 | 87.138 | 9.874 | 47.455 |
| stop_entry_0_16ms | 5,946 | 3.139 | 13.205 | 52.878 | 3.182 | 11.705 |
| stop_settle_16_50ms | 5,944 | 0.412 | 0.939 | 7.195 | 0.038 | 0.000 |
| stop_settle_50_150ms | 11,328 | 0.012 | 0.000 | 0.117 | 0.000 | 0.000 |
| post_stop_150_500ms | 15,356 | 0.001 | 0.000 | 0.000 | 0.001 | 0.000 |

## Chronological blocks

| bin | n | baseline mean | baseline p95 | baseline p99 | hold mean | hold p95 |
| --- | --- | --- | --- | --- | --- | --- |
| block_01 | 13,134 | 2.297 | 9.298 | 51.409 | 3.276 | 14.212 |
| block_02 | 12,362 | 1.246 | 5.800 | 20.508 | 1.833 | 10.000 |
| block_03 | 11,588 | 1.218 | 5.179 | 25.914 | 1.868 | 8.062 |
| block_04 | 10,724 | 1.490 | 5.161 | 35.262 | 2.038 | 6.708 |
| block_05 | 9,864 | 2.466 | 10.630 | 49.824 | 3.483 | 16.000 |
| block_06 | 9,380 | 1.464 | 4.562 | 37.708 | 2.238 | 6.003 |
| block_07 | 8,938 | 1.365 | 4.956 | 29.144 | 2.012 | 7.071 |
| block_08 | 8,798 | 1.413 | 5.002 | 27.755 | 1.891 | 6.708 |
| block_09 | 7,679 | 2.311 | 10.643 | 46.310 | 3.341 | 17.003 |
| block_10 | 7,155 | 1.787 | 6.927 | 39.909 | 2.605 | 8.000 |

