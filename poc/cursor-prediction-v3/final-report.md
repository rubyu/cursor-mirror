# Cursor Prediction v3 Final Report

## Final Decision

Collect more data before product integration.

The v3 PoC found a real learned-residual signal, and the best product-shaped candidate is light enough for C# implementation. However, the evidence is still based on one compatible poll+DWM product trace, and visible regression risk remains important for a cursor overlay.

Do not enable a new learned predictor by default yet.

## Best Candidates

### Best Accuracy/Safety Balance

`distilled_linear_score_exact_gate`

- test p99: `25.728px` versus baseline `29.282px`;
- p99 wins: `10/10` chronological v2 blocks and `5/5` held-out test blocks;
- low-speed p95: unchanged at `0.440px`;
- correction application rate: `6.91%`;
- visible `>5px` regressions: `16`;
- product shape: linear score gate, ridge residual, shrink `0.65`, no sigmoid needed.

### Safest Deployment Candidate

`p6_vector_cap_5`

- test p99: `27.111px` versus baseline `29.282px`;
- low-speed p95: unchanged at `0.440px`;
- visible `>5px` regressions: `0`;
- tradeoff: smaller p99 and high-risk improvements than the uncapped candidate.

## Phase Summary

| phase | result |
| --- | --- |
| Phase 1 | Replayed the current baseline and identified high-speed, high-acceleration, hook/poll disagreement, and poll cadence as dominant error drivers. |
| Phase 2 | Deterministic damping/gating did not beat the baseline; most variants undershot legitimate fast motion. |
| Phase 3 | Learned ridge residual found a real signal, improving test p99 from `29.282px` to `25.287px`, but with too many pointwise regressions. |
| Phase 4 | Conservative gating reduced `>5px` regressions from `317` to `16` while keeping p99 at `25.728px`. |
| Phase 5 | The logistic gate was distilled to a raw linear-score gate with identical replay behavior and no hot-path sigmoid. |
| Phase 6 | Chronological robustness inside the v2 trace is good, but independent trace coverage is insufficient for default-on productization. |

## Required Before Default-On

- At least 10 independent poll+DWM traces.
- Multiple machines, monitors, refresh rates, DPI scales, pointer devices, and workload conditions.
- Targeted high-speed flick, abrupt stop, reversal, drag, and low-speed precision traces.
- Stress traces with CPU load, compositor jitter, and hook/poll disagreement.
- Replay tests with fixed metric budgets for p99, low-speed p95, high-risk p95/p99, application rate, and pointwise regressions.
- No-allocation hot-path tests for any C# implementation.

## Product Recommendation

The current product baseline should remain the default.

If an experimental implementation is desired, add it behind an opt-in/research setting and start with the conservative capped shape. The implementation should always fall back to the current baseline when feature values are invalid, stale, or outside the trained range.

