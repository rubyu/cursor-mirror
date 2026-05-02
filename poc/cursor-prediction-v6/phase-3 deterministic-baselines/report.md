# Phase 3 - Deterministic Baselines

## Cross-Session Results

| fold | split | baseline | baseline mean/p95/p99 | selected | selected mean/p95/p99 | delta mean/p95/p99 | >5px worse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | 175951 -> 184947 | current_dwm_aware_last2_gain_0_75 | 3.306 / 15.186 / 44.097 | current_dwm_aware_last2_gain_0_75 | 3.306 / 15.186 / 44.097 | 0.000 / 0.000 / 0.000 | 0 |
| train_184947_eval_175951 | 184947 -> 175951 | current_dwm_aware_last2_gain_0_75 | 1.285 / 5.251 / 20.866 | gain_0_675 | 1.247 / 5.087 / 20.012 | -0.037 / -0.165 / -0.854 | 0 |

## Best Candidate So Far

No non-current deterministic candidate improved average cross-session p99 while keeping zero >5 px regressions, so the recommended candidate is the current baseline.

Best raw non-current p99 candidate: `gain_0_8`, mean p99 delta -0.296 px with 1 total >5 px regressions.

Best zero-regression non-current candidate: `none`.

## Honest Read

The gains are small. The current DWM-aware last2 gain 0.75 baseline is already strong on these self-scheduler anchors. Retuned fixed gains can shave a little p99 in one fold, but the cross-session aggregate adds at least one visible regression. Stateful alpha-beta smoothing was feasible to test, but it did not clear the zero-regression guard.
