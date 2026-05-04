# Step 07 Report - Runtime-only Oracle-leakage Correction

## Summary

Oracle leakage was confirmed in the step06 harness, but the corrected runtime-only rerun does not overturn the step06 deployment-gate conclusion.

The focused corrected candidate `mlp_h32_event_safe_runtime_latch_cap0p35` passes the step06 deployment gate in all three seeds. The legacy mixed-slice `overall.futureLag.p95` still fails, as in step06, and remains diagnostic rather than a deployment gate.

## Runtime-only Changes

The future/reference target distance is now separated from runtime features:

- `DataRow.FutureTargetDistance` is allowed only for training labels and evaluation metrics.
- `Features.RuntimeTargetDisplacementEstimate` is allowed for model input and runtime guard logic.

Exact feature change:

```text
old: f.TargetDistance / 8
new: f.RuntimeTargetDisplacementEstimate / 8
```

The previous target-speed feature was also corrected:

```text
old: f.SamplerSpeed / 3000 from future/reference interpolation
new: f.RuntimeSpeedEstimate / 3000 from current/past v2 speed
```

Runtime guard decisions no longer read `EventWindowLabel`, `StaticLabel`, `MovementPhase`, generated movement phase/velocity, or future target distance. The corrected latch uses current/past runtime signals: v2/v12/recentHigh/latestDelta/path efficiency/horizon/runtime estimated target displacement.

## Product Reference

| metric | product |
| --- | ---: |
| test normal visual p95 | 0.941407 |
| test normal visual p99 | 2.161728 |
| test normal-moving futureLag p95 | 0.931288 |
| test normal-moving futureLag p99 | 2.571000 |
| robustness peakLead max | 3.000000 |
| robustness OTR >1px rate | 0.009881 |
| robustness returnMotion max | 3.204001 |
| overall futureLead p99 | 0.952200 |
| held-out stationary jitter p95 | 0.000000 |

## Corrected Candidate Result

`mlp_h32_event_safe_runtime_latch_cap0p35` passes all deployment gates across seeds.

| seed | normal p95 | normal p99 | lag p95 | lag p99 | peakLead max | returnMotion max | futureLead p99 | jitter p95 | pass |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2105 | 0.934676 | 2.159667 | 0.936250 | 2.603144 | 0.132890 | 0.232992 | 0.908985 | 0.008294 | yes |
| 2205 | 0.932202 | 2.132564 | 0.917919 | 2.548292 | 0.311208 | 0.403024 | 0.914915 | 0.007285 | yes |
| 2305 | 0.936380 | 2.130964 | 0.933229 | 2.554548 | 0.162895 | 0.262812 | 0.910285 | 0.009897 | yes |

Worst deltas versus product:

| metric | worst delta |
| --- | ---: |
| test normal visual p95 | -0.005027 |
| test normal visual p99 | -0.002061 |
| test normal-moving futureLag p95 | +0.004962 |
| test normal-moving futureLag p99 | +0.032144 |
| robustness peakLead max | -2.688792 |
| robustness returnMotion max | -2.800977 |
| overall futureLead p99 | -0.037285 |
| held-out stationary jitter p95 | +0.009897 |

The futureLag p95/p99 regressions remain within the step06 subpixel tolerance, and stationary jitter remains within the `+0.05 px` allowance.

## Candidate Family

All runtime-only latch/cap variants evaluated here produced the same aggregate gate result:

| candidate | pass seeds | objective mean | objective worst | normal p95 mean | deployment lag p95 mean | peakLead worst | returnMotion worst |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `mlp_h32_event_safe_runtime_latch_cap0p35` | 3/3 | 1261.169 | 1319.168 | 0.934420 | 0.929133 | 0.311208 | 0.403024 |
| `mlp_h32_event_safe_runtime_latch_cap0p35_gain1p08` | 3/3 | 1261.169 | 1319.168 | 0.934420 | 0.929133 | 0.311208 | 0.403024 |
| `mlp_h32_event_safe_runtime_latch_cap0p25_gain1p08` | 3/3 | 1261.169 | 1319.168 | 0.934420 | 0.929133 | 0.311208 | 0.403024 |
| `mlp_h32_event_safe_runtime_latch_cap0p35_productblend0p25` | 3/3 | 1261.169 | 1319.168 | 0.934420 | 0.929133 | 0.311208 | 0.403024 |
| `mlp_h32_event_safe_runtime_features_fulltrain` | 3/3 | 1290.019 | 1347.246 | 0.934420 | 0.929133 | 0.311208 | 0.421536 |

The gain and product-blend variants were cheap to evaluate, but under the corrected runtime guard they did not improve the gate result. The plain `cap0p35` shape remains the cleanest candidate.

## Oracle Comparison

Step06 `mlp_h32_event_safe_seq_latch_cap0p35` used oracle guard inputs and passed all three seeds. Step07 `mlp_h32_event_safe_runtime_latch_cap0p35` removes those inputs and still passes all three seeds.

| metric | step06 cap0p35 worst | step07 runtime cap0p35 worst |
| --- | ---: | ---: |
| normal p95 | 0.936095 | 0.936380 |
| normal p99 | 2.128778 | 2.159667 |
| lag p95 | 0.937865 | 0.936250 |
| lag p99 | 2.585650 | 2.603144 |
| peakLead max | 0.466077 | 0.311208 |
| returnMotion max | 0.476673 | 0.403024 |
| futureLead p99 | 0.919499 | 0.914915 |
| jitter p95 | 0.016346 | 0.009897 |

The leakage mattered to correctness of the experiment design, but it did not invalidate the deployment-gate pass for this candidate family.

## Recommendation

Proceed with a product-integration experiment for `mlp_h32_event_safe_runtime_latch_cap0p35`, not the old step06 oracle-guard candidate. The next experiment should port the corrected runtime-only feature vector and guard into product-shaped code, then measure in-product latency/UX and verify the guard decision counters on live runtime traces.
