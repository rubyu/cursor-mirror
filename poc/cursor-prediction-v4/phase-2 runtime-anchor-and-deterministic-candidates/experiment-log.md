# Phase 2 Experiment Log

## Run

- script: `analyze_phase2.js`
- input: `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\cursor-mirror-trace-20260501-195819.zip`
- generated: `2026-05-01T11:22:38.937Z`
- elapsed: 10.787 sec
- rows: 975,443

The script reads `cursor-mirror-trace-20260501-195819.zip` directly and treats it as read-only. All outputs are written inside the Phase 2 directory.

## Reproduction

The Phase 1 baseline was reproduced with product `poll` anchors and linearly interpolated `referencePoll` target positions. The reproduced baseline is:

| slice | n | mean px | p95 px | p99 px | max px |
| --- | --- | --- | --- | --- | --- |
| overall | 99,622 | 1.695 | 6.771 | 36.245 | 682.467 |
| >=2000 px/s | 3,462 | 25.569 | 88.444 | 161.659 | 682.467 |
| >=100k px/s^2 | 3,765 | 21.013 | 84.600 | 165.261 | 682.467 |

This matches the Phase 1 headline: mean 1.695, p95 6.771, p99 36.245, max 682.467.

## Candidate Families

| family | count | candidates |
| --- | --- | --- |
| baseline | 2 | `product_baseline_dwm_last2_gain_0_75`, `hold_current_dwm_target` |
| dwm_horizon_gain_grid | 5 | `dwm_gain_0_50`, `dwm_gain_0_625`, `dwm_gain_0_875`, `dwm_horizon_grid_soft`, `dwm_horizon_grid_tail_damped` |
| fixed_horizon_alternative | 4 | `fixed_effective_horizon_4ms`, `fixed_effective_horizon_8ms`, `fixed_effective_horizon_12ms`, `fixed_effective_horizon_16ms` |
| poll_interval_gate | 3 | `poll_dt_gain_damping`, `poll_dt_horizon_cap`, `poll_dt_fallback_hold_ge67` |
| stop_guard | 2 | `product_stop_entry_hold_16ms`, `product_stop_settle_decay_250ms` |
| latest_hook_anchor | 2 | `latest_hook_hold_age16`, `latest_hook_anchor_poll_velocity_age16` |
| mixed_hook_poll_anchor | 2 | `mixed_hook_when_disagree_ge2_age16`, `mixed_hook_hold_when_disagree_ge8_age16` |
| hook_derived_velocity | 1 | `hook_velocity_latest2_age32` |
| combination | 1 | `combo_horizon_poll_stop_hook` |
| hypothetical_reference_input | 1 | `nonproduct_reference_latest_anchor_velocity` |
| hypothetical_future_oracle | 1 | `nonproduct_oracle_target_position` |

## Product-Feasible Candidate Results

| candidate | feasibility | mean | p50 | p90 | p95 | p99 | max | regress >1/>3/>5 | applied rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `product_baseline_dwm_last2_gain_0_75` | product_feasible | 1.695 | 0.000 | 2.348 | 6.771 | 36.245 | 682.467 | 0/0/0 | 0.9921 |
| `hold_current_dwm_target` | product_feasible | 2.444 | 0.000 | 2.828 | 10.000 | 57.057 | 522.433 | 8476/5443/4068 | 1.0000 |
| `dwm_gain_0_50` | product_feasible | 1.790 | 0.000 | 2.297 | 7.087 | 39.302 | 459.784 | 4598/2298/1456 | 0.9921 |
| `dwm_gain_0_625` | product_feasible | 1.716 | 0.000 | 2.286 | 6.795 | 36.631 | 551.669 | 2947/1140/658 | 0.9921 |
| `dwm_gain_0_875` | product_feasible | 1.725 | 0.000 | 2.450 | 6.862 | 36.449 | 813.278 | 2663/1096/651 | 0.9921 |
| `dwm_horizon_grid_soft` | product_feasible | 1.649 | 0.000 | 2.101 | 6.481 | 36.346 | 734.790 | 1704/595/305 | 0.7507 |
| `dwm_horizon_grid_tail_damped` | product_feasible | 1.699 | 0.000 | 2.173 | 6.690 | 36.151 | 473.203 | 2650/1167/680 | 0.9921 |
| `fixed_effective_horizon_4ms` | product_feasible | 2.148 | 0.000 | 3.000 | 8.764 | 45.691 | 461.093 | 7266/4135/2914 | 0.9921 |
| `fixed_effective_horizon_8ms` | product_feasible | 2.047 | 0.000 | 3.000 | 8.468 | 42.727 | 458.186 | 6671/3663/2508 | 0.9921 |
| `fixed_effective_horizon_12ms` | product_feasible | 2.257 | 0.000 | 3.360 | 9.384 | 46.919 | 687.279 | 7213/4206/3021 | 0.9921 |
| `fixed_effective_horizon_16ms` | product_feasible | 2.739 | 0.000 | 4.067 | 11.497 | 58.086 | 916.372 | 9031/5727/4306 | 0.9921 |
| `poll_dt_gain_damping` | product_feasible | 1.699 | 0.000 | 2.282 | 6.703 | 36.288 | 682.467 | 625/300/196 | 0.9921 |
| `poll_dt_horizon_cap` | product_feasible | 1.707 | 0.000 | 2.305 | 6.732 | 36.154 | 682.467 | 570/323/238 | 0.9921 |
| `poll_dt_fallback_hold_ge67` | product_feasible | 1.717 | 0.000 | 2.277 | 6.736 | 36.797 | 682.467 | 357/226/170 | 0.9556 |
| `product_stop_entry_hold_16ms` | product_feasible | 1.717 | 0.000 | 2.350 | 6.848 | 36.714 | 682.467 | 172/121/95 | 0.9844 |
| `product_stop_settle_decay_250ms` | product_feasible | 1.793 | 0.000 | 2.362 | 7.024 | 38.514 | 682.467 | 1904/1073/768 | 0.9844 |
| `latest_hook_hold_age16` | product_feasible | 2.268 | 0.000 | 2.236 | 9.220 | 53.600 | 522.433 | 7786/4980/3721 | 0.9944 |
| `latest_hook_anchor_poll_velocity_age16` | product_feasible | 1.808 | 0.000 | 2.771 | 7.489 | 37.612 | 868.933 | 6418/3309/2177 | 0.9942 |
| `mixed_hook_when_disagree_ge2_age16` | product_feasible | 1.603 | 0.000 | 2.236 | 6.385 | 34.200 | 682.467 | 278/198/160 | 0.9922 |
| `mixed_hook_hold_when_disagree_ge8_age16` | product_feasible | 1.629 | 0.000 | 2.263 | 6.539 | 34.957 | 682.467 | 133/103/88 | 0.9922 |
| `hook_velocity_latest2_age32` | product_feasible | 7.417 | 0.000 | 5.092 | 15.303 | 108.575 | 11,476.196 | 12058/7973/6353 | 0.9943 |
| `combo_horizon_poll_stop_hook` | product_feasible | 1.667 | 0.000 | 2.031 | 6.494 | 36.810 | 682.467 | 2852/1458/1001 | 0.7464 |

## Top Product-Feasible p99 Results

| candidate | feasibility | mean | p50 | p90 | p95 | p99 | max | regress >1/>3/>5 | applied rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mixed_hook_when_disagree_ge2_age16` | product_feasible | 1.603 | 0.000 | 2.236 | 6.385 | 34.200 | 682.467 | 278/198/160 | 0.9922 |
| `mixed_hook_hold_when_disagree_ge8_age16` | product_feasible | 1.629 | 0.000 | 2.263 | 6.539 | 34.957 | 682.467 | 133/103/88 | 0.9922 |
| `dwm_horizon_grid_tail_damped` | product_feasible | 1.699 | 0.000 | 2.173 | 6.690 | 36.151 | 473.203 | 2650/1167/680 | 0.9921 |
| `poll_dt_horizon_cap` | product_feasible | 1.707 | 0.000 | 2.305 | 6.732 | 36.154 | 682.467 | 570/323/238 | 0.9921 |
| `poll_dt_gain_damping` | product_feasible | 1.699 | 0.000 | 2.282 | 6.703 | 36.288 | 682.467 | 625/300/196 | 0.9921 |
| `dwm_horizon_grid_soft` | product_feasible | 1.649 | 0.000 | 2.101 | 6.481 | 36.346 | 734.790 | 1704/595/305 | 0.7507 |
| `dwm_gain_0_875` | product_feasible | 1.725 | 0.000 | 2.450 | 6.862 | 36.449 | 813.278 | 2663/1096/651 | 0.9921 |
| `dwm_gain_0_625` | product_feasible | 1.716 | 0.000 | 2.286 | 6.795 | 36.631 | 551.669 | 2947/1140/658 | 0.9921 |
| `product_stop_entry_hold_16ms` | product_feasible | 1.717 | 0.000 | 2.350 | 6.848 | 36.714 | 682.467 | 172/121/95 | 0.9844 |
| `poll_dt_fallback_hold_ge67` | product_feasible | 1.717 | 0.000 | 2.277 | 6.736 | 36.797 | 682.467 | 357/226/170 | 0.9556 |

## Non-Product Reference/Future Candidates

| candidate | feasibility | mean | p50 | p90 | p95 | p99 | max | regress >1/>3/>5 | applied rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `nonproduct_reference_latest_anchor_velocity` | non_product_referencePoll_runtime | 4.905 | 0.000 | 6.000 | 18.248 | 95.560 | 4,583.644 | 13364/9567/7463 | 0.9993 |
| `nonproduct_oracle_target_position` | non_product_future_information | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0/0/0 | 1.0000 |

## Hypothetical Scheduler/Input-Cadence Variants

| variant | n | mean | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| `nonproduct_reference_cadence_4ms_target_8ms` | 527,558 | 2.483 | 8.062 | 50.040 | 1,880.553 |
| `nonproduct_reference_cadence_4ms_target_16ms` | 527,556 | 5.173 | 18.494 | 107.158 | 3,847.049 |
| `nonproduct_reference_cadence_8ms_target_8ms` | 263,779 | 2.036 | 5.712 | 38.042 | 1,473.175 |
| `nonproduct_reference_cadence_8ms_target_16ms` | 263,778 | 4.218 | 13.581 | 83.044 | 2,147.136 |

These scheduler variants use dense `referencePoll` as synthetic runtime input and fixed future targets, so their scores are not product-feasible and not directly regression-comparable to product poll/DWM replay.

## Notes

- Product poll cadence remains a primary risk surface: p50/p95 intervals are 15.923 / 63.081 ms despite the requested 8 ms interval.
- The latest-hook and hook-velocity candidates are feasible from trace fields, but on this replay they rarely beat the poll anchor because most hook/poll disagreement is zero and hook samples are often stale relative to DWM target time.
- DWM horizon damping and fixed effective horizons can reduce some low-horizon overshoot, but they trade against fast-motion underprediction.
- Stop-settle guards help the post-stop low-error area but do not solve the pre-stop and high-speed tail that dominates p95/p99.
