# Phase 6 Report

## Strongest Finding

The Phase 5 best candidate reproduces the expected test gain (p99 25.728 vs baseline 29.282) and wins p99 in 10/10 chronological blocks inside the v2 product trace. That is still not default-on evidence because it is one compatible product trace and the selected gate leaves 16 visible >5px regressions on the held-out test slice.

## Reproduction

- Baseline test: mean 1.367, p95 5.099, p99 29.282, max 312.923.
- Phase 5 best from this run: mean 1.216, p95 4.226, p99 25.728, >5px regressions 16, applied 6.91%.
- Phase 5 summary object matched candidate id `distilled_linear_score_exact_gate` with p99 25.728 and 16 >5px regressions.

## Block Robustness

Within the one v2 product trace, the candidate wins consistently on p99: 10/10 chronological all-row blocks and 5/5 held-out test blocks. The limitation is external robustness, not intra-trace block consistency.

## Regression Anatomy

All 16 selected-candidate >5px regressions are listed below. The dominant tags are high_speed=16, hook_poll_disagreement_5px_plus=14, poll_jitter_4ms_plus=13, correction_overshoot=11.

| row | time ms | speed | accel | disagreement | DWM horizon | stop-settle | baseline err | candidate err | correction | causes |
| ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | --- |
| 155330 | 2442965.2 | 4206.1 | 98989 | 21.572 | 14.666 | settle_33_67ms | 0.000 | 15.894 | (-15.830, -1.432) | hook_poll_disagreement_5px_plus, high_speed, high_acceleration, stop_settle, long_dwm_horizon, low_baseline_error_visible_introduction, correction_overshoot, poll_jitter_4ms_plus |
| 151718 | 2385758.6 | 3616.7 | 931 | 7.489 | 16.309 | not_in_stop_settle | 3.477 | 14.565 | (-10.277, 5.515) | hook_poll_disagreement_5px_plus, high_speed, long_dwm_horizon, correction_wrong_direction, correction_overshoot, poll_jitter_4ms_plus |
| 156650 | 2463732.8 | 3454.1 | 118513 | 17.829 | 15.516 | settle_16_33ms | 1.511 | 12.322 | (-11.981, -6.297) | hook_poll_disagreement_5px_plus, high_speed, high_acceleration, stop_settle, long_dwm_horizon, low_baseline_error_visible_introduction, correction_overshoot, poll_jitter_4ms_plus |
| 153110 | 2407731.1 | 4134.5 | 63942 | 16.835 | 12.422 | not_in_stop_settle | 2.000 | 12.613 | (-0.763, 10.590) | hook_poll_disagreement_5px_plus, high_speed, high_acceleration, long_dwm_horizon, low_baseline_error_visible_introduction, correction_wrong_direction, correction_overshoot |
| 158735 | 2497156.7 | 3835.6 | 131403 | 11.319 | 11.192 | settle_33_67ms | 2.000 | 11.948 | (11.815, 3.775) | hook_poll_disagreement_5px_plus, high_speed, high_acceleration, stop_settle, low_baseline_error_visible_introduction, correction_overshoot, poll_jitter_4ms_plus |
| 143180 | 2250747.9 | 5263.3 | 3172 | 23.016 | 15.419 | not_in_stop_settle | 5.385 | 14.443 | (-16.714, 6.449) | hook_poll_disagreement_5px_plus, high_speed, long_dwm_horizon, correction_overshoot, poll_jitter_4ms_plus |
| 158572 | 2494534.3 | 3258.5 | 76324 | 9.630 | 0.046 | not_in_stop_settle | 0.000 | 8.198 | (-7.112, -4.077) | hook_poll_disagreement_5px_plus, high_speed, high_acceleration, low_baseline_error_visible_introduction, correction_exceeds_baseline_step, correction_overshoot, poll_jitter_4ms_plus |
| 159980 | 2517069.9 | 2182.8 | 24825 | 7.359 | 16.369 | not_in_stop_settle | 22.563 | 29.668 | (-7.695, -3.201) | hook_poll_disagreement_5px_plus, high_speed, long_dwm_horizon, correction_wrong_direction |
| 136646 | 2147162.8 | 2164.4 | 106789 | 8.976 | 8.319 | settle_16_33ms | 1.491 | 8.304 | (-6.342, -2.706) | hook_poll_disagreement_5px_plus, high_speed, high_acceleration, stop_settle, low_baseline_error_visible_introduction, correction_wrong_direction, correction_overshoot, poll_jitter_4ms_plus |
| 149076 | 2344126.5 | 3416.2 | 49919 | 10.000 | 11.557 | settle_133_250ms | 5.121 | 11.410 | (-9.792, 4.099) | hook_poll_disagreement_5px_plus, high_speed, stop_settle, correction_overshoot, poll_jitter_4ms_plus |
| 158392 | 2491490.5 | 2049.2 | 50144 | 14.195 | 10.237 | settle_33_67ms | 11.286 | 17.546 | (6.689, -0.320) | hook_poll_disagreement_5px_plus, high_speed, stop_settle, correction_wrong_direction, poll_jitter_4ms_plus |
| 158732 | 2497113.9 | 2151.9 | 95868 | 9.960 | 4.017 | settle_133_250ms | 6.708 | 12.490 | (5.222, 2.482) | hook_poll_disagreement_5px_plus, high_speed, high_acceleration, stop_settle, correction_wrong_direction, poll_jitter_4ms_plus |
| 146621 | 2305251.1 | 2486.5 | 21829 | 5.240 | 0.303 | not_in_stop_settle | 0.111 | 5.829 | (5.866, -0.230) | hook_poll_disagreement_5px_plus, high_speed, low_baseline_error_visible_introduction, correction_exceeds_baseline_step, correction_overshoot, poll_jitter_4ms_plus |
| 160371 | 2523205.4 | 1830.1 | 83701 | 4.713 | 14.758 | not_in_stop_settle | 3.162 | 8.741 | (-4.026, -4.152) | high_speed, high_acceleration, long_dwm_horizon, correction_wrong_direction |
| 145049 | 2280500.6 | 1708.2 | 32908 | 3.564 | 15.281 | not_in_stop_settle | 8.674 | 14.053 | (-5.174, 1.513) | high_speed, long_dwm_horizon, correction_wrong_direction, poll_jitter_4ms_plus |
| 134798 | 2117903.1 | 1995.8 | 29683 | 7.694 | 15.457 | not_in_stop_settle | 2.000 | 7.345 | (-7.277, -1.000) | hook_poll_disagreement_5px_plus, high_speed, long_dwm_horizon, low_baseline_error_visible_introduction, correction_overshoot, poll_jitter_4ms_plus |

## Stricter Deployment Variants

The safest candidate found is `p6_vector_cap_5`: p99 27.111 vs baseline 29.282, high-risk average p95 64.385 vs baseline 66.343, low-speed p95 0.440 vs baseline 0.440, 0 >5px regressions, and 6.91% application rate.
It keeps smaller but real high-risk gains: high-speed p95 80.464 vs 83.630, high-accel p95 91.393 vs 92.945, disagreement p95 69.308 vs 69.641, stop-settle p95 16.374 vs 19.158.
A zero >5px regression variant exists: `p6_vector_cap_5`, but it gives p99 27.111 and removes large >5px improvements as well as large regressions.

## Coverage Gaps

- Only one trace contains poll+DWM rows, so product candidate robustness is trace-dependent.
- The second root trace provides only move events, useful for fixed-horizon compatibility baselines but not for poll+DWM candidate replay.
- No independent holdout trace from another day, device, refresh rate, DPI scale, app workload, or pointer device is available.
- Hook/poll disagreement and stop-settle rows exist, but rare visible failures cluster in these tails and need repeat coverage.
- No real Windows hook installation or production hot-path integration was exercised in this phase.

Needed before default-on:

- At least 10 independent poll+DWM traces across multiple machines, monitors, refresh rates, DPI scales, and pointer devices.
- Targeted high-speed flick, abrupt stop, direction reversal, drag, and low-speed precision traces.
- Traces with known hook/poll disagreement stress, including CPU load and compositor timing jitter.
- Longer sessions with application workload changes, idle gaps, window focus changes, and mixed polling cadence.
- A locked replay suite that preserves raw hook, poll, cursor, DWM timing, and target interpolation inputs.