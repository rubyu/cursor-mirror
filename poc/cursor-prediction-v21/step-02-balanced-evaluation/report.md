# Step 02 Report - Balanced Evaluation Manifest

## Summary

This step creates the v21 split manifest and metric policy for balanced evaluation. It uses the step01 audit of ten packages matching `cursor-mirror-motion-recording-20260504-19*.zip`.

No model training, model search, GPU measurement, or wholesale ZIP extraction was run.

## Manifest

The split unit is the package file. The manifest assigns every audited package to exactly one primary split:

| split | files | duration buckets | quality buckets | alignment rows |
| --- | ---: | --- | --- | ---: |
| train | 4 | 4s, 6s, 8s, 12s | poll-delayed | 1673498 |
| validation | 1 | 12s | poll-delayed | 567051 |
| test | 1 | 4s | normal | 252111 |
| robustness | 4 | 6s, 8s, 10s, 12s | poll-delayed | 1689643 |

The only normal file is `cursor-mirror-motion-recording-20260504-195438.zip`, and it is reserved for `test`. The `robustness` split keeps the requested 6/8/10/12s poll-delayed mix out of fitting and threshold selection.

## Balancing Strategy

Row-weighted metrics remain available, but they are diagnostics only for exposure-like views. The primary search objective should blend scenario-balanced, file-balanced, duration-bucket-balanced, and quality-bucket-balanced views so 12s packages and dense trace rows cannot dominate.

Each v21 evaluation row must preserve:

- `scenarioIndex`
- actual `scenarioElapsedMilliseconds`
- `generatedX` and `generatedY`
- `movementPhase`
- `durationBucket`
- `qualityBucket`
- file-level split metadata

The primary row source should be `motion-trace-alignment.csv`, with `motion-samples.csv` used as the generated-motion side table for targets, phase labels, and future/return event windows.

## Metric Policy

`metric-policy.json` defines five aggregations:

- `rowWeighted`
- `scenarioBalanced`
- `fileBalanced`
- `durationBucketBalanced`
- `qualityBucketBalanced`

The final objective dimensions are:

- normal visual p95 and p99
- futureLead p99
- futureLag p95
- peakLead max and p99
- returnMotion max and p99
- OTR >1px rate
- stationary jitter p95

## Exact v20 Evaluator Changes Needed For Step03

1. Replace hard-coded real package config with `split-manifest.json`.
2. Stop treating each real package as one unannotated sequence. Use `packageId#scenarioIndex` as the scenario identity for scenario-balanced metrics.
3. Read `motion-metadata.json` and remove any fixed `12000 ms` scenario-window constant.
4. Stream `motion-trace-alignment.csv` as the primary real-trace row source.
5. Attach `scenarioIndex`, `scenarioElapsedMilliseconds`, `generatedX/Y`, `movementPhase`, `durationBucket`, and `qualityBucket` to `DataRow`/`EvalRow`.
6. Use `motion-samples.csv` for generated-motion interpolation, phase-aware labels, future targets, and stop/return event windows.
7. Replace the single `OverallMetrics`/`SourceMetrics` ranking with the five aggregation modes from `metric-policy.json`.
8. Report train, validation, test, and robustness separately. Robustness is score-only.
9. Keep CPU/GPU measurement serialized and outside model training for this step.

## Validation

The harness under `harness/` validates the manifest against root ZIPs by opening ZIP entries directly and checking required entries, CSV headers, and `motion-metadata.json` values. It writes `manifest-check.json` without extracting large files.
