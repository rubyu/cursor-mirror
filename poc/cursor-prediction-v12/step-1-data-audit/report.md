# Step 1 Data Audit

## Scope

This step audits the four v9 Motion Lab recordings supplied for POC 12. It reads the repository-root ZIP files directly and stores only small Markdown and JSON summaries under `poc/cursor-prediction-v12/`.

No training, GPU work, long benchmark, raw ZIP copy, or expanded CSV cache was performed.

## Package Metadata

| id      | zip                                                | trace fmt | motion fmt | cpu | screen    | refresh | DWM % | timer |
| ------- | -------------------------------------------------- | --------- | ---------- | --- | --------- | ------- | ----- | ----- |
| m070055 | cursor-mirror-motion-recording-20260504-070055.zip | 9         | 2          | 6   | 3840x2160 | 30Hz    | 100   | 1ms   |
| m070211 | cursor-mirror-motion-recording-20260504-070211.zip | 9         | 2          | 6   | 3840x2160 | 30Hz    | 100   | 1ms   |
| m070248 | cursor-mirror-motion-recording-20260504-070248.zip | 9         | 2          | 24  | 2560x1440 | 60Hz    | 100   | 1ms   |
| m070307 | cursor-mirror-motion-recording-20260504-070307.zip | 9         | 2          | 32  | 7680x1440 | 60Hz    | 100   | 1ms   |

All four packages are TraceFormatVersion 9 and MotionSampleFormatVersion 2. The set covers 3 machine fingerprints and 30Hz / 60Hz refresh buckets.

## Trace Audit

| id      | rows   | move   | poll  | reference | scheduler | external move | non-warm external | max nonwarm ms |
| ------- | ------ | ------ | ----- | --------- | --------- | ------------- | ----------------- | -------------- |
| m070055 | 544097 | 121909 | 96011 | 280092    | 23042     | 149           | 112               | 2461.235       |
| m070211 | 494249 | 92312  | 96014 | 259836    | 23043     | 0             | 0                 | n/a            |
| m070248 | 601297 | 154395 | 96006 | 259087    | 45904     | 33            | 1                 | 545.648        |
| m070307 | 550536 | 129730 | 96007 | 235204    | 44797     | 0             | 0                 | n/a            |

The MotionLab-generated mouse marker is `1129139532`. Rows where `event=move` and `hookExtraInfo` differs from that marker are treated as external user-input contamination.

## Motion Samples

| id      | rows   | moving | hold  | resume | velocity p95 | velocity max |
| ------- | ------ | ------ | ----- | ------ | ------------ | ------------ |
| m070055 | 184321 | 145573 | 30301 | 8447   | 460.875      | 23414.784    |
| m070211 | 184321 | 141882 | 33532 | 8907   | 429.865      | 57427.595    |
| m070248 | 184321 | 142429 | 33514 | 8378   | 313.473      | 9533.336     |
| m070307 | 184321 | 145039 | 30530 | 8752   | 265.36       | 7833.317     |

The v2 motion-sample fields `movementPhase`, `holdIndex`, and `phaseElapsedMilliseconds` are present in all packages, so later steps can evaluate hold/resume behavior without reconstructing phase labels from the script.

## Cleaning Candidate Check

| id      | proximity excluded | proximity % | drop scen0 excluded | drop scen0 % | final rule                                 |
| ------- | ------------------ | ----------- | ------------------- | ------------ | ------------------------------------------ |
| m070055 | 2640               | 0.4852      | 11231               | 2.0642       | drop-scenario-0-plus-contamination-windows |
| m070211 | 400                | 0.0809      | 9500                | 1.9221       | warmup-only                                |
| m070248 | 808                | 0.1344      | 11846               | 1.9701       | warmup-plus-contamination-windows          |
| m070307 | 480                | 0.0872      | 11807               | 2.1446       | warmup-only                                |

`m070055` has non-warmup external moves continuing into the first scenario, up to about 2461.235 ms. The final rule drops scenario 0 for that package rather than trusting a narrow local window. Other packages use warmup removal plus sparse contamination windows where needed.

## Consistency

- Trace rows match `metadata.json SampleCount` for all packages: yes.
- Required v9 trace fields are present for all packages: yes.
- Required v2 motion fields are present for all packages: yes.
- DWM timing availability is 100% for all packages: yes.
- 1 ms timer resolution succeeded for all packages: yes.

## Step 2 Handoff

Use the cleaning policy in `step-2-clean-split/split-manifest.json`. The later modeling scripts should load rows lazily from the source ZIP files and apply the manifest filters instead of materializing cleaned CSV files.
