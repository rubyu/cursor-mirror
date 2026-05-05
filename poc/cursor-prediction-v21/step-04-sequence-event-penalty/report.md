# Step 04 Report - Sequence/Event Penalty

## Summary

The step04 CPU run evaluated 11 candidates on the same v21 manifest-aware balanced metrics as step03. The best objective was `mlp_h32_event_safe_seq_latch_cap0p35` at `1370.95`, slightly ahead of the unguarded step03-style event-safe baseline at `1389.44` and far ahead of product at `3250.35`.

The new event-safe sequence latch preserved the normal visual test tail and suppressed stop-event risk, but it still adds a small measured futureLag tail relative to product. No learned candidate is product-ready from this step.

## Ranking

| rank | candidate | objective | test normal p95 | test normal p99 | robustness peakLead max | robustness returnMotion max | robustness OTR >1px | overall futureLead p99 | overall futureLag p95 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `mlp_h32_event_safe_seq_latch_cap0p35` | 1370.95 | 0.934 | 2.139 | 0.443 | 0.444 | 0.0000 | 0.921 | 0.011 |
| 2 | `mlp_h32_event_safe_sampled` | 1389.44 | 0.935 | 2.139 | 0.443 | 0.436 | 0.0000 | 0.922 | 0.021 |
| 3 | `mlp_h32_event_returnmotion_proxy` | 2093.98 | 0.947 | 2.155 | 0.310 | 2.138 | 0.0000 | 0.835 | 0.037 |
| 4 | `mlp_h32_stop_safety_target_cap` | 2141.71 | 0.956 | 2.176 | 0.181 | 2.391 | 0.0000 | 0.714 | 0.078 |
| 5 | `rule_hybrid_latch_v5_300_high400_latest2p5` | 2622.11 | 0.941 | 2.162 | 2.750 | 3.026 | 0.0040 | 0.951 | 0.000 |
| 6 | `mlp_h32_event_peaklead_hinge_stoprows` | 2647.23 | 0.948 | 2.236 | 0.466 | 3.422 | 0.0000 | 0.670 | 0.074 |
| 7 | `rule_hybrid_cap0p5_v2_150_high400_latest2p0` | 2708.47 | 0.941 | 2.162 | 2.750 | 3.026 | 0.0040 | 0.951 | 0.000 |
| 8 | `product_distilled_lag0_offset_minus4_brake` | 3250.35 | 0.941 | 2.162 | 3.000 | 3.204 | 0.0099 | 0.952 | 0.000 |
| 9 | `mlp_h32_asym_seq_latch_blend0p50_cap0p45` | 3477.44 | 1.089 | 2.711 | 0.236 | 5.051 | 0.0000 | 0.349 | 0.149 |
| 10 | `mlp_h32_asymmetric_lead_sampled` | 3602.27 | 1.094 | 2.711 | 0.426 | 5.036 | 0.0000 | 0.141 | 0.251 |
| 11 | `mlp_h32_asym_lagguard_jitter` | 4290.37 | 0.954 | 2.305 | 3.113 | 3.069 | 0.0237 | 1.059 | 0.091 |

## Product Comparison Gates

The best learned candidate beats product on test normal p95/p99, robustness peakLead max, robustness OTR, robustness returnMotion max, and overall futureLead p99. It does not beat product on overall futureLag p95 (`0.011` vs product `0.000`).

The two rule-hybrid baselines beat product on the configured comparison gates, but they still leave large absolute stop-event peaks (`2.750 px`) and returnMotion (`3.026 px`). They remain reference baselines rather than product-ready fixes.

## Findings

- The event-safe family is still the strongest direction. A simple sequence latch/cap on top of it improves objective slightly and keeps robustness returnMotion under `0.5 px`.
- ReturnMotion and stop-safety proxy losses reduce peakLead further, but they increase returnMotion and normal lag enough to lose to the event-safe baseline.
- Asymmetric-lead remains the wrong shape for this objective: it cuts futureLead sharply, but normal visual p95/p99, returnMotion, and futureLag regress.
- The lag-guard+jitter asymmetric variant did not recover the asymmetric baseline; it worsened objective and OTR.

## Product Readiness

No candidate is product-ready from step04. The best learned result is promising, but it is a single-seed sampled harness result and misses the futureLag comparison gate against product.

## Recommended Next Experiment

Run a focused event-safe follow-up with multiple seeds and a larger stratified cap that oversamples normal moving rows, stop-event rows, and static rows separately. Keep the sequence latch/cap as a runtime guard candidate, but add an explicit normal-moving lag calibration term or validation-selected blend so the event-safe model does not trade stop safety for even a small futureLag tail.
