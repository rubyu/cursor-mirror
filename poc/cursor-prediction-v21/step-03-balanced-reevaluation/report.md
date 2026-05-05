# Step 03 Report - Balanced Reevaluation

## Summary

The v21 balanced reevaluation ran on the scenario-duration-aware manifest without using a fixed 12000 ms window. The harness evaluated 252180 joined `runtimeSchedulerPoll` rows across 10 packages and 640 `packageId#scenarioIndex` scenarios after a 1500 ms per-scenario warmup.

The v20 asymmetric-loss conclusion does not cleanly reproduce as a product-ready result on this new data. The asymmetric-lead MLP sharply reduces future lead, but it increases normal visual tail error, future lag, return motion, and stationary jitter. The sampled event-safe MLP has the best blended score in this compact run, but it is not product-ready from this step alone because it is sampled, not integrated into the runtime path, and needs repeatability/seed checks.

## Ranking

| rank | candidate | objective | normal visual p95 | normal visual p99 | peakLead max | OTR >1px | scenario futureLead p99 | scenario futureLag p95 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `mlp_h32_event_safe_sampled` | 1350.60 | 0.941 | 2.136 | 0.309 | 0.0000 | 0.992 | 0.898 |
| 2 | `rule_hybrid_latch_v5_300_high400_latest2p5` | 2622.11 | 0.941 | 2.162 | 2.750 | 0.0032 | 1.016 | 0.894 |
| 3 | `rule_hybrid_cap0p5_v2_150_high400_latest2p0` | 2708.47 | 0.941 | 2.162 | 2.750 | 0.0032 | 1.016 | 0.894 |
| 4 | `mlp_h32_asymmetric_lead_sampled` | 3221.23 | 1.115 | 2.716 | 0.351 | 0.0000 | 0.280 | 1.484 |
| 5 | `product_distilled_lag0_offset_minus4_brake` | 3250.35 | 0.941 | 2.162 | 3.375 | 0.0063 | 1.018 | 0.895 |

## Split Notes

| candidate | test normal p95 | test normal p99 | robustness peakLead max | robustness OTR >1px | robustness futureLead p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `mlp_h32_event_safe_sampled` | 0.941 | 2.136 | 0.309 | 0.0000 | 0.884 |
| `mlp_h32_asymmetric_lead_sampled` | 1.115 | 2.716 | 0.178 | 0.0000 | 0.145 |
| `product_distilled_lag0_offset_minus4_brake` | 0.941 | 2.162 | 3.000 | 0.0099 | 0.951 |

The asymmetric learned model is doing what the asymmetric term asks for: it cuts lead risk. The cost is not acceptable in this compact evidence set: test normal p95/p99 worsen, robustness future lag rises to 1.763 px p95, returnMotion max reaches 4.762 px, and stationary jitter rises relative to product/rules.

## Product Readiness

No candidate should be called product-ready from step03.

The sampled event-safe MLP is the most promising follow-up because it preserves the normal visual test tail while reducing stop-event risk in this harness. It still needs a stronger run before promotion: larger or stratified training, multiple seeds, validation-driven selection, runtime cost checks, and direct product integration review.

The two v20 rule candidates improve the product peakLead/OTR profile but still leave multi-pixel stop-event peaks. They are useful baselines, not sufficient final fixes.
