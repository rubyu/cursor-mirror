# Step 02 Notes - Balanced Evaluation Manifest

## Scope

This step defines the v21 evaluation manifest and scoring policy before model search. It does not train models, run CPU/GPU measurements, or extract large ZIP contents to disk.

The input audit is `../step-01-data-audit/audit.json`. The raw data are the root ZIP files matching `cursor-mirror-motion-recording-20260504-19*.zip`.

## Timing Contract

Fixed `12000 ms` scenario windows are invalid for v21. Scenario playback duration changed across the new packages, with observed scenario durations of `4000`, `6000`, `8000`, `10000`, and `12000` milliseconds.

The loader for step03 should treat these files as authoritative:

- `motion-metadata.json`: package-level `DurationMilliseconds`, `ScenarioCount`, `ScenarioDurationMilliseconds`, `SampleRateHz`, and hold metadata.
- `motion-samples.csv`: generated-motion rows with `elapsedMilliseconds`, `scenarioIndex`, `scenarioElapsedMilliseconds`, `x`, `y`, `velocityPixelsPerSecond`, `movementPhase`, and hold fields.
- `motion-trace-alignment.csv`: trace-aligned rows with `traceEvent`, `traceElapsedMicroseconds`, `generatedElapsedMilliseconds`, `scenarioIndex`, `scenarioElapsedMilliseconds`, `generatedX`, `generatedY`, `velocityPixelsPerSecond`, `movementPhase`, and hold fields.

The v21 real-trace evaluator should load runtime poll rows from `motion-trace-alignment.csv`, not from unannotated `trace.csv` alone. This attaches each real trace event to the generated position, movement phase, scenario index, actual elapsed-in-scenario value, and duration bucket. `trace.csv` remains useful for raw runtime details, but the alignment CSV is the primary row stream for scoring and split/bucket membership.

## Balanced Loader Shape

Each loaded evaluation row should carry these minimum dimensions:

- `packageId` and `file`
- `split`: `train`, `validation`, `test`, or `robustness`
- `qualityBucket`: `normal` or `poll-delayed`
- `durationBucket`: `4s`, `6s`, `8s`, `10s`, or `12s`
- `scenarioIndex`
- `scenarioElapsedMilliseconds`
- `generatedElapsedMilliseconds`
- `generatedX`, `generatedY`
- `movementPhase`
- `traceEvent`

Scenario IDs should be file-scoped, for example `cursor-mirror-motion-recording-20260504-195438.zip#scenario=17`. Do not group scenarios with the same numeric index across files unless the grouping also includes file and duration bucket.

Rows with `traceEvent` values that are not runtime prediction calls may still be useful for interpolation and diagnostics, but candidate scoring should define an explicit prediction-call filter. The manifest policy recommends using `traceEvent in ["poll", "runtimeSchedulerPoll"]` only after confirming the v21 recorder's event naming in step03.

## Split Design

The split is deterministic at file level. No package appears in more than one primary split.

The only normal package in the audit is `cursor-mirror-motion-recording-20260504-195438.zip`, a 4s package. It is reserved as `test` to keep at least one clean normal capture untouched by tuning.

Training uses four poll-delayed files spanning 4s, 6s, 8s, and 12s. That intentionally avoids letting the three 12s files dominate by row count. There is no 10s train file because the only 10s package is more valuable as a robustness holdout for the changed-duration issue.

Validation uses one 12s poll-delayed file. This is thin, but keeps a deterministic tuning holdout while preserving the requested robustness mix. Step03 should report this limitation and should not treat validation alone as proof of normal-quality behavior.

Robustness holds out a 6s, 8s, 10s, and severe 12s poll-delayed mix. This bucket is score-only for stress and should not feed model fitting or threshold selection unless a later step explicitly changes the policy.

## Aggregation Policy

Every metric should be emitted through five named aggregations:

- `rowWeighted`: every eligible row contributes equally. This preserves raw production exposure but is vulnerable to long-duration files dominating.
- `scenarioBalanced`: compute per file/scenario first, then average scenarios with equal weight inside each split.
- `fileBalanced`: compute per file first, then average files equally.
- `durationBucketBalanced`: compute per duration bucket first, then average `4s`, `6s`, `8s`, `10s`, and `12s` buckets equally when present.
- `qualityBucketBalanced`: compute per quality bucket first, then average normal and poll-delayed buckets according to the metric policy.

The model-search objective should use balanced aggregations as the primary ranking signal and row-weighted metrics as diagnostics. Tail safety dimensions remain the same family as v20: normal visual p95/p99, future lead/lag tails, peak lead, return motion, OTR >1px, and stationary jitter.

## Required v20 Evaluator Changes

The v20 evaluator reads `trace.csv` directly and treats each real package as one sequence. For v21, it needs to:

- Load packages from `split-manifest.json` instead of hard-coded `RealPackages`.
- Read `motion-metadata.json` for per-file duration and scenario count.
- Stream `motion-trace-alignment.csv` as the primary trace row source.
- Preserve `scenarioIndex`, `scenarioElapsedMilliseconds`, `generatedX/Y`, `movementPhase`, `durationBucket`, and `qualityBucket` on every row.
- Use `motion-samples.csv` as the generated-motion source for future targets and phase-aware event labeling.
- Replace single overall `SourceMetrics` with the five aggregation modes in `metric-policy.json`.
- Keep CPU/GPU timing serialized outside model training and outside this manifest step.
