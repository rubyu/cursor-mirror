# Step 05 Report - Multi-seed Event-safe Validation

## Summary

The step04 focused candidate family is stable across three deterministic seeds when trained on the full manifest train split. The guarded event-safe candidates consistently beat product on normal visual p95/p99, robustness peakLead max, OTR >1px, robustness returnMotion max, and futureLead p99.

However, no learned candidate passes the futureLag gate. Product's rowWeighted `overall.futureLag.p95` is exactly `0.000000`; with the step05 epsilon set to `0.005 px`, the best guarded variants still land at `0.027 px` mean and about `0.031 px` worst.

## Product Baseline

| metric | product |
| --- | ---: |
| test normal visual p95 | 0.941407 |
| test normal visual p99 | 2.161728 |
| robustness peakLead max | 3.000000 |
| robustness OTR >1px | 0.009881 |
| robustness returnMotion max | 3.204001 |
| overall futureLead p99 | 0.952200 |
| overall futureLag p95 | 0.000000 |

## Mean/Worst Across Seeds

| candidate | pass seeds | objective mean | objective worst | normal p95 mean | normal p99 mean | peakLead worst | returnMotion worst | futureLead p99 mean | futureLag p95 mean | futureLag p95 worst |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `mlp_h32_event_safe_seq_latch_cap0p35_gain1p08` | 0/3 | 1354.56 | 1401.14 | 0.933814 | 2.120192 | 0.466077 | 0.476673 | 0.913108 | 0.027092 | 0.031120 |
| `mlp_h32_event_safe_seq_latch_cap0p25_gain1p08` | 0/3 | 1354.56 | 1401.14 | 0.933814 | 2.120192 | 0.466077 | 0.476673 | 0.913108 | 0.027092 | 0.031120 |
| `mlp_h32_event_safe_seq_latch_cap0p35` | 0/3 | 1354.57 | 1401.20 | 0.933923 | 2.121464 | 0.466077 | 0.476673 | 0.913184 | 0.027074 | 0.031103 |
| `mlp_h32_event_safe_seq_latch_cap0p35_productblend0p25` | 0/3 | 1354.59 | 1401.36 | 0.934209 | 2.121450 | 0.466077 | 0.476673 | 0.913267 | 0.027028 | 0.031065 |
| `mlp_h32_event_safe_fulltrain` | 0/3 | 1375.76 | 1436.82 | 0.933923 | 2.121464 | 0.466077 | 0.437222 | 0.913148 | 0.036748 | 0.038184 |

## Per-seed Gate Metrics

| seed | candidate | normal p95 | normal p99 | peakLead max | OTR >1px | returnMotion max | futureLead p99 | futureLag p95 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2105 | `mlp_h32_event_safe_fulltrain` | 0.936095 | 2.110199 | 0.285605 | 0.000000 | 0.403609 | 0.910184 | 0.035731 |
| 2105 | `mlp_h32_event_safe_seq_latch_cap0p35` | 0.936095 | 2.110199 | 0.285605 | 0.000000 | 0.439819 | 0.910184 | 0.031103 |
| 2105 | `mlp_h32_event_safe_seq_latch_cap0p35_gain1p08` | 0.935735 | 2.109603 | 0.285605 | 0.000000 | 0.439819 | 0.909598 | 0.031120 |
| 2105 | `mlp_h32_event_safe_seq_latch_cap0p25_gain1p08` | 0.935735 | 2.109603 | 0.285605 | 0.000000 | 0.439819 | 0.909598 | 0.031120 |
| 2105 | `mlp_h32_event_safe_seq_latch_cap0p35_productblend0p25` | 0.936218 | 2.112074 | 0.285605 | 0.000000 | 0.439819 | 0.910434 | 0.031065 |
| 2205 | `mlp_h32_event_safe_fulltrain` | 0.933221 | 2.125413 | 0.466077 | 0.000000 | 0.437222 | 0.919856 | 0.038184 |
| 2205 | `mlp_h32_event_safe_seq_latch_cap0p35` | 0.933221 | 2.125413 | 0.466077 | 0.000000 | 0.476673 | 0.919499 | 0.030278 |
| 2205 | `mlp_h32_event_safe_seq_latch_cap0p35_gain1p08` | 0.932843 | 2.122196 | 0.466077 | 0.000000 | 0.476673 | 0.919856 | 0.030315 |
| 2205 | `mlp_h32_event_safe_seq_latch_cap0p25_gain1p08` | 0.932843 | 2.122196 | 0.466077 | 0.000000 | 0.476673 | 0.919856 | 0.030315 |
| 2205 | `mlp_h32_event_safe_seq_latch_cap0p35_productblend0p25` | 0.934062 | 2.123496 | 0.466077 | 0.000000 | 0.476673 | 0.919499 | 0.030235 |
| 2305 | `mlp_h32_event_safe_fulltrain` | 0.932454 | 2.128778 | 0.137676 | 0.000000 | 0.433783 | 0.909405 | 0.036329 |
| 2305 | `mlp_h32_event_safe_seq_latch_cap0p35` | 0.932454 | 2.128778 | 0.137676 | 0.000000 | 0.446962 | 0.909869 | 0.019840 |
| 2305 | `mlp_h32_event_safe_seq_latch_cap0p35_gain1p08` | 0.932865 | 2.128778 | 0.137676 | 0.000000 | 0.446962 | 0.909869 | 0.019840 |
| 2305 | `mlp_h32_event_safe_seq_latch_cap0p25_gain1p08` | 0.932865 | 2.128778 | 0.137676 | 0.000000 | 0.446962 | 0.909869 | 0.019840 |
| 2305 | `mlp_h32_event_safe_seq_latch_cap0p35_productblend0p25` | 0.932347 | 2.128778 | 0.137676 | 0.000000 | 0.446962 | 0.909869 | 0.019784 |

## FutureLag Diagnosis

For the focused `cap0p35` guard, the rowWeighted `overall.futureLag.p95` comes mainly from the train diagnostic slice:

| seed | train p95 | validation p95 | robustness normal-moving p95 | test normal-moving p95 |
| ---: | ---: | ---: | ---: | ---: |
| 2105 | 0.029173 | 0.004565 | 0.949961 | 0.937865 |
| 2205 | 0.028287 | 0.001910 | 0.931475 | 0.889209 |
| 2305 | 0.019170 | 0.004656 | 0.934132 | 0.920543 |
| product | 0.000000 | 0.000000 | 0.935700 | 0.931288 |

This is not a `generatedX/generatedY` alignment issue in the loader: the future target and label come from trace/reference interpolation, while `generatedX/Y` are only retained as row metadata. It is also not an obvious practical visual regression on the held-out normal test tail; normal visual p95/p99 improve versus product in every seed.

The product zero is a nearest-rank/metric-slice artifact: the metric includes all train/validation rows, and product has at least 95% zero-or-leading signed future error there. The event-safe target intentionally suppresses stop/static displacement, leaving more than 5% tiny lagging projections in train rows. They are sub-pixel, but they are real under the metric definition.

## Conclusion

The event-safe sequence latch is stable, but it should not proceed directly to product integration because it misses the explicit futureLag gate in all three seeds. The next POC should separate deployment gates from train/validation diagnostics or add a targeted calibration that is selected on validation and measured on held-out normal motion, while preserving the stop-event robustness wins.
