# Cursor Prediction v12 Final Report

## Decision

Primary implementation candidate: `gate_s25_net0_eff35_ls12_g100_cap12_off-2`.

Use `runtimeSchedulerPoll + v9 target-derived horizon` as the runtime contract. Do not use a fixed 16.67 ms horizon for scheduler anchors; Step 4 shows scheduler rows are already close to the target vblank, with runtime scheduler target p50 around 3.87 ms at 30Hz and 3.9112 ms at 60Hz.

Step 7 specialist guards are not implementation candidates. The best specialist near-miss reduced the validation `>=2000 px/s` p99 from 41 px to 32 px, but it worsened 30Hz holdout test p99 from 7 px to 9 px.

ML/FSMN models are useful precision probes, but they are not the current product candidate. The best Step 6 probe, `VFSMNv2_k12_ridge`, had validation p95/p99 of 2.25/7.75 px, while the Step 5 gate stayed at 2/7.5 px and had a better product-safety shape.

## Data And Split

Input data:

- `cursor-mirror-motion-recording-20260504-070055.zip`
- `cursor-mirror-motion-recording-20260504-070211.zip`
- `cursor-mirror-motion-recording-20260504-070248.zip`
- `cursor-mirror-motion-recording-20260504-070307.zip`

All inputs are TraceFormatVersion 9 and MotionSampleFormatVersion 2. The set covers three machine fingerprints and both 30Hz and 60Hz refresh buckets.

Cleaning rules:

- Drop `warmupSample=true` trace rows.
- Drop motion samples before warmup.
- Treat `event=move` with `hookExtraInfo != 1129139532` as external input contamination.
- Drop rows inside +/- 250 ms contamination windows.
- Drop scenario 0 from `m070055`, because non-warmup external input continues into the first scenario.

Clean totals:

| item | rows |
| --- | ---: |
| clean trace rows | 2,177,260 |
| excluded trace rows | 12,919 |
| clean motion rows | 733,973 |
| excluded motion rows | 3,311 |

The base split is scenario-level 70/15/15: 44 train scenarios, 10 validation scenarios, and 10 test scenarios. Scenario-level splitting avoids leaking adjacent high-rate samples from the same generated curve into evaluation.

## Timing Contract

Step 4 found that fixed frame horizons are a poor fit for scheduler anchors:

| anchor | refresh | target p50 ms | target p95 ms |
| --- | --- | ---: | ---: |
| `runtimeSchedulerPoll` | 30Hz | 3.87 | 3.9103 |
| `runtimeSchedulerPoll` | 60Hz | 3.9112 | 3.9573 |

For runtime scheduler rows, `v9_target` and corrected-present horizons were equivalent in this data. Fixed 16.67 ms over-projects scheduler rows and worsens error.

## Model Results

Main comparison on `runtimeSchedulerPoll + v9_target`:

| model | validation mean | validation p95 | validation p99 | validation >10 | test p95 | test p99 | signed mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current product equivalent | 2.1193 | 10 | 12 | 0.050049 | 8.75 | 12 | -1.33 |
| constant position | 0.5847 | 2 | 8.25 | 0.00831 | 2.25 | 6.25 | -1.9382 |
| least squares n12 gain100 cap24 | 0.7891 | 2.5 | 7.75 | 0.007237 | 2.5 | 6.5 | -1.3866 |
| Step 5 gate | 0.6735 | 2 | 7.5 | 0.007657 | 2.5 | 6 | -1.681 |
| Step 6 `VFSMNv2_k12_ridge` | 0.7577 | 2.25 | 7.75 | 0.00733 | 2.25 | 6.25 | -1.242 |

The Step 5 gate is the best implementation tradeoff. Constant position has strong p95 numbers, but it behaves like a lagging floor during motion. The Step 5 gate preserves that floor for low-speed/unstable history and uses least-squares only when causal history is useful.

## Holdout Signals

Step 5 selected gate holdout:

| holdout | train p95 | test p95 | delta p95 | train p99 | test p99 | delta p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| machine:24cpu_2560x1440_1mon_60Hz | 2.5 | 2 | -0.5 | 7.25 | 5.75 | -1.5 |
| machine:32cpu_7680x1440_3mon_60Hz | 2.5 | 2 | -0.5 | 7.25 | 5.75 | -1.5 |
| machine:6cpu_3840x2160_1mon_30Hz | 2 | 3 | 1 | 5.75 | 8.75 | 3 |
| refresh:30Hz | 2 | 3 | 1 | 5.75 | 8.75 | 3 |
| refresh:60Hz | 3 | 2 | -1 | 8.75 | 5.75 | -3 |

30Hz remains the main holdout risk. Step 7 specialist guards were rejected specifically because the best high-speed improvement made 30Hz holdout p99 worse.

## Oracle Ceiling

Step 7 analysis-only oracle results:

| oracle | validation p95 | validation p99 | validation `>=2000 px/s` p95 | validation `>=2000 px/s` p99 | validation resume p95 | validation resume p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| phase/speed/refresh group oracle | 2 | 7.25 | 15.75 | 27.5 | 3.5 | 14.25 |
| per-row best lower bound | 1.5 | 4.75 | 13.5 | 26.25 | 2 | 9.5 |

These are not product candidates. The group oracle uses true motion phase and future speed bins. The per-row lower bound uses label error to pick the best model per row.

## Why Zero Error Is Not Reached

The remaining error is concentrated in high-speed and resume tails. With causal history only, the predictor cannot reliably distinguish future intent changes from similar-looking recent history. Even the impossible per-row oracle over the tested model pool leaves validation `>=2000 px/s` p99 at 26.25 px, which means the current model family and measurement contract do not contain enough information to drive error to zero.

There is also a 30Hz-specific holdout risk: aggressive specialists can reduce part of the high-speed tail, but they misfire on 30Hz enough to worsen p99. That is exactly the kind of regression this POC should reject.

## Next Work

Implementation track:

- Implement the Step 5 gate as the primary product candidate.
- Use runtime scheduler target-derived horizon for scheduler anchors.
- Keep fixed horizons only as diagnostic controls, not scheduler prediction inputs.
- Add counters for gate state, fallback reasons, high-speed rows, and 30Hz behavior so field traces can verify the same failure modes.

Experiment track:

- Collect more independent 30Hz traces and high-speed resume traces.
- Add causal features that can identify intent changes before label-time motion phase is known.
- Revisit specialist guards only if new causal features separate the 30Hz failure cases.
- Use oracle results as ceilings, not as product logic.
