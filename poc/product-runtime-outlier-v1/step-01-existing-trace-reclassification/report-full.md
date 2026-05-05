# Step 01 Existing Trace Reclassification - Full Corpus

## Input Coverage

- Candidate root trace/motion zips: 47
- Processed zips with trace.csv: 47
- Runtime scheduler poll rows: 1150239
- Classified outlier rows: 398260
- Full corpus pending: False

## Classification Counts

| Classification | Count |
| --- | ---: |
| scheduler_wake_late | 295972 |
| dispatcher_late | 24336 |
| cursor_read_late | 177 |
| mixed | 13668 |
| unknown | 64107 |

## Distribution Highlights

| Metric | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: |
| pollCadenceGap | 2.4 | 6728.2 | 168206.1 | 1178824.1 |
| queueToDispatch | 100.3 | 806.2 | 4538.9 | 66768.7 |
| estimatedWakeLate | 2 | 2863.8 | 3686.9 | 68056.5 |
| cursorReadLatency | 2.3 | 46 | 151.5 | 10294 |

## Top Poll Cadence Gap Outliers

| Zip | Seq | gap us | interval us | est wake late us | dispatcher late us | classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| cursor-mirror-trace-20260502-114656.zip | 548474 | 1178824.1 | 1195492 | 2057.8 | 29709.2 | mixed |
| cursor-mirror-trace-20260502-132725.zip | 265138 | 750252.9 | 766921.1 | 2097 | 236 | scheduler_wake_late |
| cursor-mirror-trace-20260502-132725.zip | 267759 | 634360.1 | 651028.1 | 3626.6 | 189.4 | scheduler_wake_late |
| cursor-mirror-trace-20260502-132725.zip | 189889 | 531169.1 | 547837.2 | 2576.4 | 181.6 | scheduler_wake_late |
| cursor-mirror-trace-20260502-132725.zip | 178469 | 501450.7 | 518118.8 | 3449.3 | 377.7 | scheduler_wake_late |
| cursor-mirror-trace-20260502-124831.zip | 357404 | 484568.7 | 501236.8 | 3988.8 | 505.2 | scheduler_wake_late |
| cursor-mirror-trace-20260502-132725.zip | 247011 | 483634 | 500302.1 | 2995.1 | 279.9 | scheduler_wake_late |
| cursor-mirror-trace-20260502-132725.zip | 353533 | 468831.2 | 485499.3 | 3779.3 | 769.7 | scheduler_wake_late |
| cursor-mirror-trace-20260502-132725.zip | 273133 | 467910.4 | 484578.4 | 3832.9 | 188.1 | scheduler_wake_late |
| cursor-mirror-trace-20260502-132725.zip | 205632 | 467749.4 | 484417.4 | 3844.4 | 304.6 | scheduler_wake_late |
| cursor-mirror-trace-20260502-132725.zip | 278363 | 467123.2 | 483791.3 | 3414.6 | 164.4 | scheduler_wake_late |
| cursor-mirror-trace-20260502-132725.zip | 287233 | 466993.7 | 483661.8 | 3672.6 | 306.4 | scheduler_wake_late |

## Interpretation

The full corpus preserves the main two-trace conclusion: the largest cadence gaps are scheduler wake-late rows, while many smaller outliers are dispatcher-late or mixed. Older traces contribute a very large number of scheduler interval outliers, which is consistent with the earlier Sleep(1) era comparison.
