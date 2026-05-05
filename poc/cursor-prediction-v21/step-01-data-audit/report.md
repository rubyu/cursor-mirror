# Step 01 - Data Audit

## Summary

- Target pattern: `cursor-mirror-motion-recording-20260504-19*.zip`
- Packages audited: 10
- Total ZIP bytes: 239464828
- Total motion sample rows: 1259530
- Total alignment rows: 4182303
- Aggregate hold ratio: 0.208435

Fixed `12000 ms` scenario assumptions are invalid for v21. Later phases must use `motion-metadata.json` plus the observed `scenarioElapsedMilliseconds` ranges from `motion-samples.csv` and `motion-trace-alignment.csv`.

## Files And Durations

| file | zip MB | required entries | duration ms | scenarios | scenario duration ms | motion rows | alignment rows | bucket |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `cursor-mirror-motion-recording-20260504-191827.zip` | 30.88 | true | 768000 | 64 | 12000 | 184321 | 558923 | poll-delayed |
| `cursor-mirror-motion-recording-20260504-192020.zip` | 31.05 | true | 768000 | 64 | 12000 | 184321 | 567051 | poll-delayed |
| `cursor-mirror-motion-recording-20260504-192107.zip` | 28.58 | true | 768000 | 64 | 12000 | 184321 | 500785 | poll-delayed |
| `cursor-mirror-motion-recording-20260504-193433.zip` | 23.97 | true | 512000 | 64 | 8000 | 122881 | 443361 | poll-delayed |
| `cursor-mirror-motion-recording-20260504-193508.zip` | 17.63 | true | 384000 | 64 | 6000 | 92161 | 320451 | poll-delayed |
| `cursor-mirror-motion-recording-20260504-194149.zip` | 12.86 | true | 256000 | 64 | 4000 | 61441 | 239096 | poll-delayed |
| `cursor-mirror-motion-recording-20260504-194623.zip` | 27.48 | true | 640000 | 64 | 10000 | 153601 | 508234 | poll-delayed |
| `cursor-mirror-motion-recording-20260504-194657.zip` | 19.31 | true | 384000 | 64 | 6000 | 92161 | 362328 | poll-delayed |
| `cursor-mirror-motion-recording-20260504-195438.zip` | 13.46 | true | 256000 | 64 | 4000 | 61441 | 252111 | normal |
| `cursor-mirror-motion-recording-20260504-195750.zip` | 23.15 | true | 512000 | 64 | 8000 | 122881 | 429963 | poll-delayed |

## Metadata Timing

| file | product poll p95/max ms | reference poll p95/max ms | scheduler poll p95/max ms | scheduler loop p95/max ms | metadata warnings |
| --- | ---: | ---: | ---: | ---: | --- |
| `cursor-mirror-motion-recording-20260504-191827.zip` | 18.491/33.907 | 16.16/34.116 | 18.543/37.821 | 29.926/43.851 | reference_poll_interval_p95_exceeds_requested_interval |
| `cursor-mirror-motion-recording-20260504-192020.zip` | 17.379/31.611 | 13.46/33.456 | 18.964/35.81 | 33.143/47.808 | reference_poll_interval_p95_exceeds_requested_interval |
| `cursor-mirror-motion-recording-20260504-192107.zip` | 22.37/54.906 | 19.291/58.744 | 33.334/67.738 | 35.872/67.132 | product_poll_interval_p95_exceeds_requested_interval, reference_poll_interval_p95_exceeds_requested_interval |
| `cursor-mirror-motion-recording-20260504-193433.zip` | 13.162/42.121 | 10.57/35.972 | 17.119/34.939 | 23.787/36.968 | reference_poll_interval_p95_exceeds_requested_interval |
| `cursor-mirror-motion-recording-20260504-193508.zip` | 13.097/65.12 | 9.16/63.097 | 18.578/65.68 | 26.551/65.84 | reference_poll_interval_p95_exceeds_requested_interval |
| `cursor-mirror-motion-recording-20260504-194149.zip` | 9.391/67.593 | 6.152/61.024 | 18.139/62.593 | 23.307/63.229 | reference_poll_interval_p95_exceeds_requested_interval |
| `cursor-mirror-motion-recording-20260504-194623.zip` | 14.416/47.3 | 10.741/41.957 | 17.401/56.742 | 30.272/56.26 | reference_poll_interval_p95_exceeds_requested_interval |
| `cursor-mirror-motion-recording-20260504-194657.zip` | 10.496/26.448 | 7.933/22.141 | 17.084/34.909 | 21.066/35.078 | reference_poll_interval_p95_exceeds_requested_interval |
| `cursor-mirror-motion-recording-20260504-195438.zip` | 8.264/16.503 | 5.293/16.293 | 17.078/22.436 | 19.781/29.769 |  |
| `cursor-mirror-motion-recording-20260504-195750.zip` | 12.312/46.111 | 8.483/41.795 | 17.281/54.784 | 27.376/54.763 | reference_poll_interval_p95_exceeds_requested_interval |

## Scenario Coverage

| file | motion scenario index range | motion scenario elapsed min/max ms | alignment scenario index range | alignment scenario elapsed min/max ms |
| --- | ---: | ---: | ---: | ---: |
| `cursor-mirror-motion-recording-20260504-191827.zip` | 0..63 | 0..12000 | 0..63 | 0.022..12000 |
| `cursor-mirror-motion-recording-20260504-192020.zip` | 0..63 | 0..12000 | 0..63 | 0.025..12000 |
| `cursor-mirror-motion-recording-20260504-192107.zip` | 0..63 | 0..12000 | 0..63 | 0.094..12000 |
| `cursor-mirror-motion-recording-20260504-193433.zip` | 0..63 | 0..8000 | 0..63 | 0.017..8000 |
| `cursor-mirror-motion-recording-20260504-193508.zip` | 0..63 | 0..6000 | 0..63 | 0.012..6000 |
| `cursor-mirror-motion-recording-20260504-194149.zip` | 0..63 | 0..4000 | 0..63 | 0..4000 |
| `cursor-mirror-motion-recording-20260504-194623.zip` | 0..63 | 0..10000 | 0..63 | 0.145..10000 |
| `cursor-mirror-motion-recording-20260504-194657.zip` | 0..63 | 0..6000 | 0..63 | 0.05..6000 |
| `cursor-mirror-motion-recording-20260504-195438.zip` | 0..63 | 0..4000 | 0..63 | 0.062..4000 |
| `cursor-mirror-motion-recording-20260504-195750.zip` | 0..63 | 0..8000 | 0..63 | 0..8000 |

## Hold And Speed

| file | hold ratio | speed p50/p95/p99/max px/s | sample interval p50/p95/max ms |
| --- | ---: | ---: | ---: |
| `cursor-mirror-motion-recording-20260504-191827.zip` | 0.242631 | 56.446/263.252/872.284/23755.348 | 4.167/4.167/4.167/4.167 |
| `cursor-mirror-motion-recording-20260504-192020.zip` | 0.213182 | 36.85/219.315/661.059/7603.454 | 4.167/4.167/4.167/4.167 |
| `cursor-mirror-motion-recording-20260504-192107.zip` | 0.22559 | 54.271/232.852/874.049/13612.629 | 4.167/4.167/4.167/4.167 |
| `cursor-mirror-motion-recording-20260504-193433.zip` | 0.186074 | 93.191/438.073/1573.211/6540.059 | 4.167/4.167/4.167/4.167 |
| `cursor-mirror-motion-recording-20260504-193508.zip` | 0.161999 | 135.573/561.064/2000.134/24602.65 | 4.167/4.167/4.167/4.167 |
| `cursor-mirror-motion-recording-20260504-194149.zip` | 0.239303 | 168.753/851.132/2796.409/12618.549 | 4.167/4.167/4.167/4.167 |
| `cursor-mirror-motion-recording-20260504-194623.zip` | 0.206372 | 52.341/238.805/824.514/14507.351 | 4.167/4.167/4.167/4.167 |
| `cursor-mirror-motion-recording-20260504-194657.zip` | 0.167956 | 109.722/516.658/1832.895/6032.932 | 4.167/4.167/4.167/4.167 |
| `cursor-mirror-motion-recording-20260504-195438.zip` | 0.227796 | 168.269/743.348/2267.351/8607.843 | 4.167/4.167/4.167/4.167 |
| `cursor-mirror-motion-recording-20260504-195750.zip` | 0.189297 | 62.958/269.607/1000.051/16951.343 | 4.167/4.167/4.167/4.167 |

## Warnings And Split Buckets

- `normal`: cursor-mirror-motion-recording-20260504-195438.zip
- `poll-delayed`: cursor-mirror-motion-recording-20260504-191827.zip, cursor-mirror-motion-recording-20260504-192020.zip, cursor-mirror-motion-recording-20260504-192107.zip, cursor-mirror-motion-recording-20260504-193433.zip, cursor-mirror-motion-recording-20260504-193508.zip, cursor-mirror-motion-recording-20260504-194149.zip, cursor-mirror-motion-recording-20260504-194623.zip, cursor-mirror-motion-recording-20260504-194657.zip, cursor-mirror-motion-recording-20260504-195750.zip

### cursor-mirror-motion-recording-20260504-191827.zip
- poll/scheduler delay: reference poll p95 16.16 ms exceeds expected interval 2 ms
- poll/scheduler delay: metadata quality warning reference_poll_interval_p95_exceeds_requested_interval

### cursor-mirror-motion-recording-20260504-192020.zip
- poll/scheduler delay: reference poll p95 13.46 ms exceeds expected interval 2 ms
- poll/scheduler delay: runtime scheduler loop p95 33.143 ms exceeds 30 ms
- poll/scheduler delay: runtime scheduler loop max 47.808 ms exceeds 45 ms
- poll/scheduler delay: metadata quality warning reference_poll_interval_p95_exceeds_requested_interval

### cursor-mirror-motion-recording-20260504-192107.zip
- poll/scheduler delay: product poll p95 22.37 ms exceeds expected interval 8 ms
- poll/scheduler delay: reference poll p95 19.291 ms exceeds expected interval 2 ms
- poll/scheduler delay: runtime scheduler poll p95 33.334 ms exceeds 25 ms
- poll/scheduler delay: runtime scheduler loop p95 35.872 ms exceeds 30 ms
- poll/scheduler delay: runtime scheduler loop max 67.132 ms exceeds 45 ms
- poll/scheduler delay: metadata quality warning product_poll_interval_p95_exceeds_requested_interval
- poll/scheduler delay: metadata quality warning reference_poll_interval_p95_exceeds_requested_interval

### cursor-mirror-motion-recording-20260504-193433.zip
- poll/scheduler delay: reference poll p95 10.57 ms exceeds expected interval 2 ms
- poll/scheduler delay: metadata quality warning reference_poll_interval_p95_exceeds_requested_interval

### cursor-mirror-motion-recording-20260504-193508.zip
- poll/scheduler delay: reference poll p95 9.16 ms exceeds expected interval 2 ms
- poll/scheduler delay: runtime scheduler loop max 65.84 ms exceeds 45 ms
- poll/scheduler delay: metadata quality warning reference_poll_interval_p95_exceeds_requested_interval

### cursor-mirror-motion-recording-20260504-194149.zip
- poll/scheduler delay: runtime scheduler loop max 63.229 ms exceeds 45 ms
- poll/scheduler delay: metadata quality warning reference_poll_interval_p95_exceeds_requested_interval

### cursor-mirror-motion-recording-20260504-194623.zip
- poll/scheduler delay: reference poll p95 10.741 ms exceeds expected interval 2 ms
- poll/scheduler delay: runtime scheduler loop p95 30.272 ms exceeds 30 ms
- poll/scheduler delay: runtime scheduler loop max 56.26 ms exceeds 45 ms
- poll/scheduler delay: metadata quality warning reference_poll_interval_p95_exceeds_requested_interval

### cursor-mirror-motion-recording-20260504-194657.zip
- poll/scheduler delay: metadata quality warning reference_poll_interval_p95_exceeds_requested_interval

### cursor-mirror-motion-recording-20260504-195750.zip
- poll/scheduler delay: reference poll p95 8.483 ms exceeds expected interval 2 ms
- poll/scheduler delay: runtime scheduler loop max 54.763 ms exceeds 45 ms
- poll/scheduler delay: metadata quality warning reference_poll_interval_p95_exceeds_requested_interval

## Recommendations

- Use `audit.json` per-scenario elapsed ranges to build v21 split manifests.
- Keep poll-delayed packages labeled as degraded/robustness data until a later phase proves they improve generalization.
- Do not run training from a loader that hard-codes `12000 ms` per scenario.
