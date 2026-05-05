# Cursor Prediction POC v21 - Final Report

## Summary

v21 rebuilt the evaluation around the new May 4 MotionLab recordings and the changed scenario playback durations. The fixed `12000 ms` assumption is invalid for this dataset; scenario durations are `4000`, `6000`, `8000`, `10000`, and `12000` ms.

The final recommendation is to proceed with a product-integration experiment for:

```text
mlp_h32_event_safe_runtime_latch_cap0p35
```

This is not final product acceptance. It is the next integration candidate to test in the real application, behind a selectable prediction mode, using the Step 06 gate policy.

## Data And Evaluation

Step 01 audited ten root ZIP packages matching `cursor-mirror-motion-recording-20260504-19*.zip`.

- Total motion sample rows: `1,259,530`
- Total alignment rows: `4,182,303`
- Scenario durations: `4s`, `6s`, `8s`, `10s`, `12s`
- Packages: `10`
- Scenarios: `640`
- Required ZIP entries: present in every package

Step 02 defined deterministic file-level splits and balanced metric policies.

- `train`: four poll-delayed packages covering `4s`, `6s`, `8s`, `12s`
- `validation`: one `12s` poll-delayed package
- `test`: the only normal `4s` package
- `robustness`: four poll-delayed packages covering `6s`, `8s`, `10s`, `12s`

The evaluator uses `motion-trace-alignment.csv` as the primary row source, preserving `scenarioIndex`, actual `scenarioElapsedMilliseconds`, generated motion, movement phase, duration bucket, and quality bucket.

## Candidate Progression

Step 03 reran product, rule, event-safe, and asymmetric candidates on the duration-aware dataset.

- Asymmetric lead loss reduced futureLead but worsened normal visual tail, futureLag, returnMotion, and stationary jitter.
- The event-safe MLP family became the strongest direction.
- No candidate was product-ready at this stage.

Step 04 added sequence/event penalties and runtime guard variants.

- Best candidate: `mlp_h32_event_safe_seq_latch_cap0p35`
- Product objective: `3250.35`
- Best candidate objective: `1370.95`
- Robustness peakLead max: `3.000000` product -> `0.443` candidate
- Robustness OTR >1px: `0.0099` product -> `0.0000` candidate
- Robustness returnMotion max: `3.204` product -> `0.444` candidate

Step 05 reran the focused family across three seeds using the full available train split.

For `mlp_h32_event_safe_seq_latch_cap0p35`:

| seed | normal p95 | normal p99 | peakLead max | OTR | returnMotion max | futureLead p99 | legacy futureLag p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2105 | 0.936095 | 2.110199 | 0.285605 | 0.000000 | 0.439819 | 0.910184 | 0.031103 |
| 2205 | 0.933221 | 2.125413 | 0.466077 | 0.000000 | 0.476673 | 0.919499 | 0.030278 |
| 2305 | 0.932454 | 2.128778 | 0.137676 | 0.000000 | 0.446962 | 0.909869 | 0.019840 |

The legacy all-row futureLag gate failed, but Step 05 showed the failure is dominated by diagnostic train/validation row composition and nearest-rank behavior.

## Gate Correction

Step 06 separated diagnostic metrics from deployment gates.

Diagnostic-only metrics:

- all-row/train-validation futureLag;
- rowWeighted overall futureLag;
- robustness normal-moving futureLag.

Deployment gates:

- held-out normal visual p95/p99;
- held-out test normal-moving futureLag p95/p99 with subpixel tolerance;
- robustness stop-event peakLead, OTR, and returnMotion;
- overall futureLead p99;
- held-out stationary jitter p95.

`mlp_h32_event_safe_seq_latch_cap0p35` passed all Step 06 deployment gates in all three seeds.

Worst held-out futureLag deltas versus product:

- p95: `+0.006577 px`
- p99: `+0.014650 px`

Both are below the Step 06 subpixel tolerance.

## Runtime-only Correction

After Step 06, a review found oracle leakage in the earlier POC harness:

- future/reference target distance was present in the runtime feature vector;
- target speed was derived from reference interpolation;
- the post-model guard used `EventWindowLabel`, `StaticLabel`, and future target distance.

Those values are valid for training labels and metrics, but they are not available to the installed product at prediction time.

Step 07 corrected the experiment:

```text
old feature: f.TargetDistance / 8
new feature: f.RuntimeTargetDisplacementEstimate / 8

old speed: future/reference target speed / 3000
new speed: runtime v2 speed / 3000
```

The runtime latch/cap guard now uses only current and past runtime signals: v2/v12 speed, recentHigh, latestDelta, path efficiency, horizon, and runtime estimated target displacement. It does not read event labels, static labels, generated phase, or future target distance.

The corrected candidate is:

```text
mlp_h32_event_safe_runtime_latch_cap0p35
```

It passed all deployment gates across three seeds.

| seed | normal p95 | normal p99 | lag p95 | lag p99 | peakLead max | returnMotion max | futureLead p99 | jitter p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2105 | 0.934676 | 2.159667 | 0.936250 | 2.603144 | 0.132890 | 0.232992 | 0.908985 | 0.008294 |
| 2205 | 0.932202 | 2.132564 | 0.917919 | 2.548292 | 0.311208 | 0.403024 | 0.914915 | 0.007285 |
| 2305 | 0.936380 | 2.130964 | 0.933229 | 2.554548 | 0.162895 | 0.262812 | 0.910285 | 0.009897 |

Worst deltas versus product:

- normal visual p95: `-0.005027 px`
- normal visual p99: `-0.002061 px`
- held-out futureLag p95: `+0.004962 px`
- held-out futureLag p99: `+0.032144 px`
- robustness peakLead max: `-2.688792 px`
- robustness returnMotion max: `-2.800977 px`
- futureLead p99: `-0.037285 px`
- stationary jitter p95: `+0.009897 px`

## Decision

Proceed to a product-integration experiment for `mlp_h32_event_safe_runtime_latch_cap0p35`.

Recommended integration constraints:

- keep the current product predictor available as a selectable fallback;
- expose the new runtime-only candidate as a separate prediction model during testing;
- preserve the existing post-stop brake/guard behavior until in-product evidence says otherwise;
- rerun unit tests, release build, MotionLab captures, and Step 06 deployment gates after integration;
- do not replace the default product mode solely from POC evidence.

## Open Risks

- The learned model is still POC-trained, not generated through the product build pipeline.
- Runtime cost must be measured in the application path, not only in harness replay.
- UX feel must be checked manually because tiny subpixel metrics can still feel different under remote streaming.
- The robustness split is intentionally poll-delayed; it is useful for stress, but should not be treated as ordinary normal-use data.
