# Step 1 Data Audit

## Scope

This audit only reads the source ZIP files in the repository root and writes small derived summaries under `poc/cursor-prediction-v11/`. No training, GPU work, long benchmark, or raw ZIP copy was performed.

## Package Structure

All audited packages use the same five-entry layout: `motion-script.json`, `motion-samples.csv`, `trace.csv`, `metadata.json`, and `motion-metadata.json`.

| id     | zip                                                | entries | trace rows | scenarios | holds | hold ms  | warnings                                                                                                     |
| ------ | -------------------------------------------------- | ------- | ---------- | --------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------ |
| normal | cursor-mirror-motion-recording-20260503-212556.zip | 5       | 571320     | 64        | 326   | 139351.7 | reference_poll_interval_p95_exceeds_requested_interval                                                       |
| stress | cursor-mirror-motion-recording-20260503-215632.zip | 5       | 544571     | 64        | 320   | 137235.1 | product_poll_interval_p95_exceeds_requested_interval; reference_poll_interval_p95_exceeds_requested_interval |
| sanity | cursor-mirror-motion-recording-20260503-212102.zip | 5       | 94580      | 8         | 44    | 15757.3  | none                                                                                                         |

The short sanity package is structurally valid but has 8 scenarios and is excluded from the 64-scenario split policy.

## Metadata Summary

| id     | duration s | trace rows | hook   | poll  | reference | product p95 ms | ref p95 ms | sched loop p95 ms |
| ------ | ---------- | ---------- | ------ | ----- | --------- | -------------- | ---------- | ----------------- |
| normal | 768.068    | 571320     | 137685 | 96007 | 246757    | 16.336         | 15.874     | 27.549            |
| stress | 768.484    | 544571     | 127497 | 96037 | 236420    | 22.541         | 14.878     | 37.167            |

Both long packages have 768 s duration, 64 scenarios, 240 Hz motion samples, 8 ms product poll target, 2 ms reference poll target, timer resolution 1 ms, DWM timing availability 100%, and 3-monitor 7680x1440 virtual screen metadata.

## Motion Script Summary

| id     | seed       | scenarios | control pts | speed pts | holds | hold ms  | resume ms |
| ------ | ---------- | --------- | ----------- | --------- | ----- | -------- | --------- |
| normal | 1730702171 | 64        | 512         | 512       | 326   | 139351.7 | 36653.3   |
| stress | 693303690  | 64        | 512         | 512       | 320   | 137235.1 | 35420.4   |

Each long recording has 64 scenarios, each scenario is 12 s, and each scenario has 8 control points plus 8 speed points. Hold/resume intervals are present throughout both scripts. The normal and stress recordings were generated with different top-level seeds, so they are comparable load-condition corpora rather than exact paired trajectories.

## Motion Samples

| id     | rows   | rows-expected | moving | hold  | resume | velocity p95 | velocity max |
| ------ | ------ | ------------- | ------ | ----- | ------ | ------------ | ------------ |
| normal | 184321 | 0             | 142086 | 33454 | 8781   | 240.434      | 47908.769    |
| stress | 184321 | 0             | 142890 | 32927 | 8504   | 263.32       | 23141.368    |

The motion sample row counts match the expected sample-rate grid. Category counts are derived from the script timing model rather than velocity thresholding, so hold and resume labels remain stable at hold boundaries.

## Trace Summary

| id     | rows   | rows-metadata | move   | poll  | reference | scheduler | delay p95 ms | delay max ms |
| ------ | ------ | ------------- | ------ | ----- | --------- | --------- | ------------ | ------------ |
| normal | 571320 | 0             | 137685 | 96007 | 246757    | 45435     | 1.26         | 10.273       |
| stress | 544571 | 0             | 127497 | 96037 | 236420    | 42308     | 1.444        | 26.594       |

Trace row counts match `metadata.json SampleCount` for all audited packages. The scheduler delay metric is computed from `runtimeSchedulerActualTickTicks - runtimeSchedulerPlannedTickTicks` using `StopwatchFrequency`.

## Normal vs Stress

| metric                 | normal | stress | delta  | delta % |
| ---------------------- | ------ | ------ | ------ | ------- |
| trace rows             | 571320 | 544571 | -26749 | -4.682  |
| hook samples           | 137685 | 127497 | -10188 | -7.399  |
| product poll p95 ms    | 16.336 | 22.541 | 6.204  | 37.977  |
| reference poll p95 ms  | 15.874 | 14.878 | -0.995 | -6.269  |
| hook move p95 ms       | 23.013 | 28.532 | 5.519  | 23.981  |
| scheduler poll p95 ms  | 18.235 | 33.342 | 15.107 | 82.844  |
| scheduler loop p95 ms  | 27.549 | 37.167 | 9.618  | 34.911  |
| scheduler delay p95 ms | 1.26   | 1.444  | 0.184  | 14.603  |
| scheduler delay max ms | 10.273 | 26.594 | 16.321 | 158.873 |

The stress run shows the expected scheduler/poll degradation: product poll p95 rises from 16.336 ms to 22.541 ms, scheduler loop p95 rises from 27.549 ms to 37.167 ms, and stress adds `product_poll_interval_p95_exceeds_requested_interval`. Reference poll warning exists in both long runs.

## Split Proposal

Use scenario-unit split with stable hash shuffle over scenario indices 0..63.

- Train (44): 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16, 17, 19, 20, 22, 25, 27, 28, 31, 33, 36, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 60, 62, 63
- Validation (10): 1, 21, 24, 26, 30, 32, 35, 39, 53, 61
- Test (10): 0, 11, 12, 14, 18, 23, 29, 34, 37, 59

Apply the same index buckets to the normal and stress long recordings. This prevents sample-level leakage from adjacent 4.167 ms rows and keeps each 12 s Bezier path, speed profile, hold timing, and resume timing in exactly one bucket.

## Category Definitions

- `moving`: script time outside hold and resume intervals.
- `hold`: script-derived hold interval `[holdStartMs, holdEndMs]` after MotionLabSampler timing normalization.
- `resume`: first `ResumeEasingMilliseconds` after a hold, clipped before the next hold or scenario end.
- `stress`: all rows from `cursor-mirror-motion-recording-20260503-215632.zip`; the load-generator setting is supplied by experiment context, not embedded in metadata.
- `schedulerDelay`: rows with scheduler planned/actual ticks; `delayMs = (actual - planned) / StopwatchFrequency * 1000`. Suggested bins are `<=1 ms`, `1-4 ms`, `4-8 ms`, and `>8 ms`.

## Risks And Mitigations

- Stress condition metadata is not self-contained. Preserve source ZIP name and experiment note in downstream manifests.
- Product/reference poll p95 warnings mean Step 2 should stratify results by load condition and scheduler delay rather than aggregate only.
- Scenario order is continuous because each generated scenario starts from the previous scenario end point. Scenario-level split still prevents within-scenario leakage, but reports should mention that train/validation/test are not independent user sessions.

## Step 2 Recommendation

Build a lightweight dataset manifest from these summaries: one row per trace/motion sample window with source package, scenario split, movement category, load condition, and scheduler-delay bin. Then run deterministic baseline replay on the train split and report validation/test separately by `moving`, `hold`, `resume`, `normal`, `stress`, and scheduler-delay bin.
