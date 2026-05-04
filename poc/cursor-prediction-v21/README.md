# Cursor Prediction POC v21

Goal: audit the new May 4 MotionLab recordings, rebuild scenario-duration-aware evaluation, and decide whether the latest event-safe predictor family is ready for a product-integration experiment.

v21 starts from the ten repository-root packages matching `cursor-mirror-motion-recording-20260504-19*.zip`. The first phase validates the data shape, timing metadata, scenario coverage, and delay characteristics introduced by the changed playback duration settings. Later phases use the audit output to build clean split buckets, rerun balanced evaluation, and test event/sequence-safe candidates.

## Final Result

`mlp_h32_event_safe_runtime_latch_cap0p35` is the recommended next product-integration experiment.

It is not automatically accepted as final product logic. It passed the v21 deployment gate across three seeds after correcting both the legacy futureLag diagnostic and the oracle leakage found in the earlier guard experiment:

- normal visual p95/p99 improved versus product in all seeds;
- robustness peakLead, OTR, and returnMotion improved strongly versus product;
- futureLead p99 improved versus product;
- held-out normal-moving futureLag p95/p99 stayed within subpixel deployment tolerance;
- the old all-row/train-validation futureLag p95 failure remains as a diagnostic artifact, not a deployment blocker;
- the final candidate uses runtime-only features and runtime-only guard decisions.

The next step should integrate this candidate behind an explicit selectable prediction mode, then rerun in-product tests and MotionLab captures with the Step 06 gate policy.

## Phases

1. **Step 01 - Data audit**
   - Read each target ZIP in place.
   - Verify required entries.
   - Treat `motion-metadata.json`, `motion-samples.csv`, and `motion-trace-alignment.csv` scenario elapsed values as authoritative.
   - Compute file, duration, sample, scenario, hold, speed, and timing-delay metrics.
   - Recommend split buckets, especially normal versus degraded or poll-delayed captures.

2. **Step 02 - Clean split planning**
   - Use `step-01-data-audit/audit.json` to define train/validation/test package and scenario buckets.
   - Preserve delayed captures as explicit robustness/evaluation buckets instead of mixing them blindly into training.

3. **Step 03 - Baseline replay**
   - Run deterministic baselines on the accepted split.
   - Do not assume a fixed scenario duration; use elapsed fields from the data.

4. **Step 04 - Sequence/event penalty**
   - Test event-safe, asymmetric, stop-event, and runtime guard variants.
   - Find that event-safe sequence latch/cap is the strongest direction.

5. **Step 05 - Multi-seed event-safe validation**
   - Validate the event-safe sequence latch/cap family across three seeds.
   - Confirm stable normal visual and stop-event robustness wins.
   - Identify that the legacy all-row futureLag gate is too diagnostic-heavy for deployment.

6. **Step 06 - Deployment gate analysis**
   - Separate diagnostic futureLag metrics from product-integration gates.
   - Reassess held-out deployment slices.

7. **Step 07 - Runtime-only correction**
   - Remove future/reference target distance from runtime features.
   - Remove oracle labels from runtime guard decisions.
   - Confirm `mlp_h32_event_safe_runtime_latch_cap0p35` still passes deployment gates across three seeds.

## Key Artifacts

- `step-01-data-audit/report.md`
- `step-02-balanced-evaluation/split-manifest.json`
- `step-02-balanced-evaluation/metric-policy.json`
- `step-03-balanced-reevaluation/report.md`
- `step-04-sequence-event-penalty/report.md`
- `step-05-multiseed-event-safe-validation/report.md`
- `step-06-deployment-gate-analysis/gate-policy.json`
- `step-06-deployment-gate-analysis/report.md`
- `step-07-runtime-only-correction/report.md`
