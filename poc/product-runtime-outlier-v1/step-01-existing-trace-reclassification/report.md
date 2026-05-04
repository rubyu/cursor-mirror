# Step 01 Existing Trace Reclassification

## Summary

This step streams trace.csv from root trace and motion zip files without extracting or copying raw traces. It filters for runtimeSchedulerPoll rows before parsing metric fields.

The feedback formula is applied as:

- queuedLeadUs = runtimeSchedulerVBlankLeadMicroseconds + queueToDispatchUs
- estimatedWakeLateUs = 4000 - queuedLeadUs
- dispatcherLateUs = queueToDispatchUs

## Input Coverage

- Candidate root trace/motion zips: 47
- Selected zips for this pass: 2
- Processed zips with trace.csv: 2
- Runtime scheduler poll rows: 53760
- Classified outlier rows: 646
- Full corpus pending: True

## Classification Counts

| Classification | Count |
| --- | ---: |
| scheduler_wake_late | 196 |
| dispatcher_late | 401 |
| cursor_read_late | 0 |
| mixed | 1 |
| unknown | 48 |

## Distribution Highlights

| Metric | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: |
| pollCadenceGap | -1 | 532 | 923.43 | 38117 |
| queueToDispatch | 115 | 665 | 959 | 7112 |
| estimatedWakeLate | 1 | 46 | 382.41 | 38072 |
| cursorReadLatency | 4 | 81 | 116 | 3710 |

## Top Poll Cadence Gap Outliers

| Zip | Seq | gap us | interval us | vblank lead us | queue dispatch us | queued lead us | est wake late us | cursor read us | classification |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| cursor-mirror-motion-recording-20260504-195750.zip | 9463 | 38117 | 54783.9 | -34220 | 148 | -34072 | 38072 | 4 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-194657.zip | 5557 | 18242 | 34823.9 | -14712 | 320 | -14392 | 18392 | 88 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 65288 | 7008 | 23673.3 | -3114 | 7112 | 3998 | 2 | 5 | dispatcher_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 18561 | 6817 | 23464.5 | -3193 | 814 | -2379 | 6379 | 50 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 105134 | 6549 | 23215.7 | -2717 | 206 | -2511 | 6511 | 5 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 393717 | 6201 | 22775.6 | -2219 | 6218 | 3999 | 1 | 96 | dispatcher_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 200860 | 5842 | 22426.9 | -1859 | 776 | -1083 | 5083 | 85 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 250877 | 5541 | 22221.5 | -2263 | 494 | -1769 | 5769 | 4 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 272709 | 5327 | 21993.1 | -1432 | 226 | -1206 | 5206 | 4 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 55422 | 4962 | 21629.2 | -1249 | 165 | -1084 | 5084 | 4 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 157475 | 4756 | 21421.8 | -1127 | 5126 | 3999 | 1 | 5 | dispatcher_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 62019 | 4725 | 21394 | -831 | 641 | -190 | 4190 | 5 | scheduler_wake_late |

## Top Scheduler Interval Outliers

| Zip | Seq | interval us | gap us | est wake late us | dispatcher late us | classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| cursor-mirror-motion-recording-20260504-195750.zip | 9463 | 54783.9 | 38117 | 38072 | 148 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-194657.zip | 5557 | 34823.9 | 18242 | 18392 | 320 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 65288 | 23673.3 | 7008 | 2 | 7112 | dispatcher_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 18561 | 23464.5 | 6817 | 6379 | 814 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 105134 | 23215.7 | 6549 | 6511 | 206 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 393717 | 22775.6 | 6201 | 1 | 6218 | dispatcher_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 200860 | 22426.9 | 5842 | 5083 | 776 | scheduler_wake_late |
| cursor-mirror-motion-recording-20260504-195750.zip | 250877 | 22221.5 | 5541 | 5769 | 494 | scheduler_wake_late |

## Interpretation

The largest cadence gaps in this pass reclassify primarily as scheduler_wake_late, matching the feedback: the scheduler poll is already late relative to the 4 ms wake advance once queueToDispatchUs is folded into the queued lead. Smaller but still material outliers split between dispatcher delay and mixed cases where cursor read latency or dispatcher latency also crosses the 1 ms threshold.

When fullCorpusPending is true, this report is intentionally scoped to the selected zip list so the POC can complete without blocking on full root corpus parsing.

metrics.json contains the full top-25 lists and per-zip counts for follow-up slicing.
