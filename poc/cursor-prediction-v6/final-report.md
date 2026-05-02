# Cursor Prediction v6 Final Report

## Scope

v6 evaluated cursor prediction on the latest format-9 traces with self-scheduler data:

- `cursor-mirror-trace-20260502-175951.zip`
- `cursor-mirror-trace-20260502-184947.zip`

The evaluation policy was cross-session: train or tune on one session and evaluate on the other full session, in both directions. All model inputs were causal. Label positions, future reference fields, and target reference indices were excluded from features.

## Phase Summary

| phase | focus | key result |
| --- | --- | --- |
| Phase 1 | data audit | Both traces contain usable `runtimeSelfSchedulerPoll` and `referencePoll` streams. |
| Phase 2 | dataset | Built 27,738 causal rows across two sessions. |
| Phase 3 | deterministic baselines | Current `current_dwm_aware_last2_gain_0_75` remains the safest baseline. |
| Phase 4 | learned teacher | Guarded MLP improves p99 but creates many small regressions. |
| Phase 5 | distillation | `safe_ridge_residual_guarded` is safe but has tiny gains. |
| Phase 6 | runtime cost | Runtime is acceptable; model cost is not the blocker. |
| Phase 7 | deep teacher | Tiny TCN finds a stronger p99 signal, but still has too many small regressions. |
| Phase 8 | CUDA PyTorch teacher | CUDA MLP/GRU/TCN does not produce a product-worthy predictor. |

## Best Candidates

| candidate | role | mean delta | p95 delta | p99 delta | regressions |
| --- | --- | --- | --- | --- | --- |
| `current_dwm_aware_last2_gain_0_75` | product default | `0.000 px` | `0.000 px` | `0.000 px` | baseline |
| `safe_ridge_residual_guarded` | strict distilled candidate | `+0.081 px` | `+0.005 px` | `-0.027 px` | zero `>1/>3/>5 px` |
| `tiny_tcn_residual_guarded_seq8` | teacher-only | `+0.228 px` | `+0.070 px` | `-0.386 px` | `1,282 >1 px`, zero `>3/>5 px` |
| `cuda_gru_residual_seq8_h64_guarded` | CUDA guarded candidate | `+0.009 px` | `-0.031 px` | `+0.061 px` | zero `>1/>3/>5 px` |

## Recommendation

Do not replace the product predictor yet.

The current predictor is still the best default because the learned improvements concentrate in p99 while worsening mean or p95 behavior. The strict distilled candidate is safe in this two-session test, but the benefit is too small to justify extra complexity as a default. The deep teacher shows that there is a real p99 signal in longer causal history, but the small-regression profile is not clean enough for direct use.

CUDA PyTorch did not change this conclusion. Raw CUDA MLP/GRU/TCN teachers can improve mean and p95 in some folds, but they introduce `>5 px` regressions. Validation-guarded CUDA variants eliminate those regressions, but their aggregate p99 is slightly worse than the current baseline.

The next useful experiment is not a larger model by itself. It is a better confidence gate or regime detector that applies learned correction only when the model can prove a meaningful p99 benefit without creating visible small regressions. More trace diversity is also needed before promoting any learned model.

## Implementation Guidance

- Keep `current_dwm_aware_last2_gain_0_75` as the default product behavior.
- Optionally implement `safe_ridge_residual_guarded` only behind a diagnostic feature flag.
- Do not ship the deep teacher directly.
- Do not ship the CUDA teachers directly.
- If more work continues, focus on gated correction by movement regime, especially high-speed segments where p99 error is large.
