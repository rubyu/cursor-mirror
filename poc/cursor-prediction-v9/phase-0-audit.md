# Cursor Prediction v9 Phase 0 Audit

Generated: 2026-05-03T04:09:54.694Z

This audit only reads existing root-level trace and calibration ZIP packages.
It does not run Calibrator, train models, or write extracted ZIP contents.

## Summary

- Trace ZIPs: 22
- Calibration ZIPs: 2
- Trace CSV rows: 10100605
- Trace metadata sample count: 10100605
- Calibration frame rows: 151
- Calibration metrics frame count: 151
- Trace format versions: 2, 3, 4, 5, 6, 7, 8, 9
- Calibration capture sources: Windows Graphics Capture
- Trace files with quality warnings: 20
- Calibration files with quality warnings: 0

## Trace Event Counts

| event | count |
| --- | --- |
| referencePoll | 6717637 |
| runtimeSchedulerLoop | 1106904 |
| poll | 1001195 |
| move | 577540 |
| runtimeSchedulerPoll | 414187 |
| schedulerExperiment | 227660 |
| runtimeSelfSchedulerLoop | 27742 |
| runtimeSelfSchedulerPoll | 27740 |

## Calibration Pattern Counts

| pattern | count |
| --- | --- |

## Trace Files

| file | csv rows | metadata samples | event kinds | quality warnings |
| --- | --- | --- | --- | --- |
| cursor-mirror-trace-20260501-000443.zip | 15214 | 15214 | 1 | none |
| cursor-mirror-trace-20260501-091537.zip | 218146 | 218146 | 2 | none |
| cursor-mirror-trace-20260501-195819.zip | 975443 | 975443 | 3 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260501-231621.zip | 695412 | 695412 | 4 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260501-235043.zip | 97393 | 97393 | 4 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-094201.zip | 2148627 | 2148627 | 4 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-114656.zip | 881847 | 881847 | 4 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-122134.zip | 804650 | 804650 | 4 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-124831.zip | 381305 | 381305 | 4 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-130828.zip | 348437 | 348437 | 4 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-132725.zip | 386180 | 386180 | 5 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-134341.zip | 361771 | 361771 | 5 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-145302.zip | 250521 | 250521 | 5 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-152600.zip | 288783 | 288783 | 5 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-153745.zip | 301295 | 301295 | 5 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-154732.zip | 346237 | 346237 | 5 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-161143.zip | 362181 | 362181 | 5 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-163258.zip | 263200 | 263200 | 6 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-165358.zip | 258622 | 258622 | 6 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-173150.zip | 246843 | 246843 | 6 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-175951.zip | 260359 | 260359 | 8 | product_poll_interval_p95_exceeds_requested_interval |
| cursor-mirror-trace-20260502-184947.zip | 208139 | 208139 | 8 | product_poll_interval_p95_exceeds_requested_interval |

## Calibration Files

| file | frame rows | metric frames | dark frames | quality warnings |
| --- | --- | --- | --- | --- |
| cursor-mirror-calibration-20260502-230553.zip | 82 | 82 | 82 | none |
| cursor-mirror-calibration-20260502-230713.zip | 69 | 69 | 69 | none |

## Reusable Inputs For v9

- Trace packages contain `metadata.json` and `trace.csv`; these are suitable for causal replay and offline teacher experiments.
- Calibration packages contain `frames.csv` and `metrics.json`; these are suitable for promotion scoring with the v7 scorer or a v9 successor.
- No extracted data or large dataset artifact was written by this audit.
