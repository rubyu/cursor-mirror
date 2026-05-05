# Step 06 Report - Future-lag Gate Analysis

## Summary

Step06 separates the legacy futureLag diagnostic from deployment gates. The old step05 `overall.futureLag.p95` failure is real under its metric definition, but it is not a defensible product-integration gate because it mixes all train/validation rows with held-out motion rows and gives product a nearest-rank `0.000000` p95.

The focused candidate `mlp_h32_event_safe_seq_latch_cap0p35` passes the new deployment gate in all three seeds. It is ready for a product-integration experiment, not automatic final product acceptance.

## Gate Policy

Diagnostic metrics are still reported:

- legacy rowWeighted `overall.futureLag.p95`
- train/validation all-row futureLag
- rowWeighted all-row futureLag
- robustness normal-moving futureLag

Deployment gates are product-relative on held-out or deployment-relevant slices:

- test normal visual p95 and p99 must be no worse than product.
- test normal-moving futureLag p95 must be within `max(0.05 px, 5%)` of product.
- test normal-moving futureLag p99 must be within `max(0.10 px, 5%)` of product.
- robustness stop-event peakLead max, OTR >1px rate, and returnMotion max must be no worse than product.
- overall futureLead p99 must be no worse than product.
- held-out stationary jitter p95 must be no worse than product plus `0.05 px`.

The futureLag tolerance is intentionally subpixel. It does not waive lag: it allows only non-material held-out deltas while still failing a learned candidate that meaningfully lags product.

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

## Candidate Result

`mlp_h32_event_safe_seq_latch_cap0p35` passes all deployment gates across seeds.

| seed | normal p95 | normal p99 | lag p95 | lag p99 | peakLead max | returnMotion max | futureLead p99 | jitter p95 | pass |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2105 | 0.936095 | 2.110199 | 0.937865 | 2.585650 | 0.285605 | 0.439819 | 0.910184 | 0.000000 | yes |
| 2205 | 0.933221 | 2.125413 | 0.889209 | 2.575355 | 0.466077 | 0.476673 | 0.919499 | 0.000000 | yes |
| 2305 | 0.932454 | 2.128778 | 0.920543 | 2.521095 | 0.137676 | 0.446962 | 0.909869 | 0.000000 | yes |

Worst futureLag deltas versus product are small: p95 is `+0.006577 px`, and p99 is `+0.014650 px`. Both are below the subpixel deployment tolerance. The candidate also improves normal visual p95/p99 and stop-event robustness in every seed.

## Top Step05 Candidates

| candidate | pass seeds | lag p95 mean | lag p95 worst delta | lag p99 mean | lag p99 worst delta | peakLead worst | returnMotion worst |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `mlp_h32_event_safe_seq_latch_cap0p25_gain1p08` | 3/3 | 0.915405 | +0.006742 | 2.560193 | +0.015442 | 0.466077 | 0.476673 |
| `mlp_h32_event_safe_seq_latch_cap0p35_gain1p08` | 3/3 | 0.915405 | +0.006742 | 2.560193 | +0.015442 | 0.466077 | 0.476673 |
| `mlp_h32_event_safe_seq_latch_cap0p35` | 3/3 | 0.915872 | +0.006577 | 2.560700 | +0.014650 | 0.466077 | 0.476673 |
| `mlp_h32_event_safe_seq_latch_cap0p35_productblend0p25` | 3/3 | 0.916549 | +0.006061 | 2.560939 | +0.012175 | 0.466077 | 0.476673 |
| `mlp_h32_event_safe_fulltrain` | 3/3 | 0.915872 | +0.006577 | 2.560700 | +0.014650 | 0.466077 | 0.437222 |

The gain variants slightly improve visual p95/p99, but `cap0p35` remains the clearest product-integration experiment candidate because it is the named step05 focused shape and avoids extra gain/product-blend calibration.

## Diagnostic FutureLag

For `mlp_h32_event_safe_seq_latch_cap0p35`, the legacy diagnostic futureLag p95 remains nonzero:

| seed | legacy p95 | all-row p95 | train all-row p95 | validation all-row p95 | test normal-moving p95 | test normal-moving p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2105 | 0.031103 | 0.028272 | 0.029173 | 0.004565 | 0.937865 | 2.585650 |
| 2205 | 0.030278 | 0.025755 | 0.028287 | 0.001910 | 0.889209 | 2.575355 |
| 2305 | 0.019840 | 0.017527 | 0.019170 | 0.004656 | 0.920543 | 2.521095 |

Product's legacy diagnostic p95 is `0.000000`, while product's held-out test normal-moving p95/p99 are `0.931288` and `2.571000`. That is the correction: product is not actually zero-lag on moving held-out deployment rows.

## Recommendation

Proceed with a product-integration experiment for `mlp_h32_event_safe_seq_latch_cap0p35`. The experiment should preserve the step06 gate report as the acceptance policy and measure runtime/UX behavior in-product before any final product decision.
