# Step 01 Data Audit Notes

## Scope

This step audits only the ten root ZIP files matching `cursor-mirror-motion-recording-20260504-19*.zip`.

No training, model selection, GPU measurement, or runtime microbenchmarking is performed in this step. The harness reads ZIP entries directly and does not extract large CSVs to disk.

## Authoritative Timing Assumptions

The user changed scenario playback duration for v21. Fixed `12000 ms` scenario assumptions are invalid for this data generation round.

The audit therefore treats these fields as authoritative:

- `motion-metadata.json`: package-level `DurationMilliseconds`, `ScenarioCount`, `ScenarioDurationMilliseconds`, and `SampleRateHz`.
- `motion-samples.csv`: row-level `elapsedMilliseconds`, `scenarioIndex`, and `scenarioElapsedMilliseconds`.
- `motion-trace-alignment.csv`: row-level `generatedElapsedMilliseconds`, `scenarioIndex`, and `scenarioElapsedMilliseconds`.

If later phases need scenario windows, they should derive them from these values or from the observed per-scenario ranges in `audit.json`.

## Required Entries

The expected package entries are:

- `metadata.json`
- `motion-metadata.json`
- `motion-script.json`
- `motion-samples.csv`
- `motion-trace-alignment.csv`
- `trace.csv`

The harness checks presence and records compressed and uncompressed entry sizes. It streams `motion-samples.csv` and `motion-trace-alignment.csv` for detailed audit metrics. `trace.csv` is verified by entry metadata only in this step because the alignment CSV already exposes the trace-to-generation timing fields needed for split planning.

## Metrics

For each package, the harness records:

- File size and ZIP entry sizes.
- Product and generation metadata.
- Package duration, scenario count, scenario duration value, sample rate, hold duration, and hold segment count.
- Product poll, reference poll, hook movement, runtime scheduler poll, and runtime scheduler loop interval stats from `metadata.json`.
- Motion sample row count, elapsed range, sample interval distribution, scenario coverage, per-scenario elapsed ranges, phase counts, hold-row ratio, and speed distribution.
- Alignment row count, generated elapsed range, trace event counts, scenario coverage, and per-scenario elapsed ranges.
- Warnings for missing entries, missing required CSV columns, metadata/CSV duration drift, missing scenarios, and delayed poll/scheduler behavior.

The report also aggregates scenario duration values, sample counts, hold ratio, speed distribution, and recommended buckets across all ten packages.

## Split Guidance

Packages with large poll or scheduler delays should be kept visible as degraded or poll-delayed buckets. They may still be useful for robustness testing, but mixing them into the main training bucket without labels could hide timing regressions.

