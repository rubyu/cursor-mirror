# Experiment Log

## Step

- POC: product-runtime-outlier-v1
- Step: 01 existing trace reclassification
- Generated: 2026-05-04T23:54:58+09:00

## Actions

- Read feedback-from-pro.txt at repo root for the classification formula and prior interpretation.
- Enumerated root cursor-mirror-trace-*.zip and cursor-mirror-motion-recording-*.zip files.
- Selected zips for this run: cursor-mirror-motion-recording-20260504-194657.zip, cursor-mirror-motion-recording-20260504-195750.zip
- Streamed each archive's trace.csv entry with System.IO.Compression.ZipFile.
- Filtered lines using ,runtimeSchedulerPoll, before splitting CSV fields.
- Did not extract archives and did not copy raw trace content into the POC directory.
- Wrote metrics.json and report.md from the analyzer.
- Reran the full root corpus with `AnalyzeRuntimeOutliersFast.cs` after the PowerShell full-corpus run timed out.
- Wrote full-corpus artifacts to `metrics-full.json` and `report-full.md`.

## Classification Rule

- scheduler_wake_late: only estimated wake lateness exceeds 1000 us.
- dispatcher_late: only queue-to-dispatch lateness exceeds 1000 us.
- cursor_read_late: only cursor read latency exceeds 1000 us.
- mixed: more than one lateness signal exceeds 1000 us.
- unknown: cadence/interval outlier remains but none of the available lateness signals crosses 1000 us, or required fields are absent.

## Notes

- Older root trace zips lack runtimeSchedulerPollCadenceGapMicroseconds; for those rows the analyzer derives cadence gap from consecutive actual scheduler tick ticks and DWM refresh period when possible.
- The script intentionally keeps raw trace zips at the repository root and only writes derived artifacts inside this step directory.
- `metrics.json` / `report.md` are the focused two-trace pass.
- `metrics-full.json` / `report-full.md` are the full-corpus pass over 47 zip files.
