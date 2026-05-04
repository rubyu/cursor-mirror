# Step 06 Report: High-Accuracy Model Search

## Summary

Step 06 found that the compact learned MLP/FSMN-like candidates are not ready: they reduced some OTR rates but created larger Step04b peakLead tails than the product baseline. The best result came from a simple runtime-safe rule hybrid.

Best candidate:

- `rule_hybrid_latch_v5_300_high400_latest2p5`
- Step04b peakLead max: 3.357 px (37% lower than product-brake baseline)
- Step04b returnMotion max: 3.226 px (29.7% lower)
- Step04b OTR >1px: 22.34%
- real holdout p95/p99: 0.495 / 1.679 px

## Candidate Ranking

| candidate | Step04b peakLead max | Step04b OTR >1px | Step04b return max | real holdout p95/p99 | real jitter p95 | objective |
|---|---:|---:|---:|---:|---:|---:|
| rule_hybrid_latch_v5_300_high400_latest2p5 | 3.357 | 22.34% | 3.226 | 0.495/1.679 | 0 | 7243.8 |
| rule_hybrid_cap0p5_v2_150_high400_latest2p0 | 4.512 | 18.09% | 3.046 | 0.495/1.679 | 0 | 7883.6 |
| rule_hybrid_latch_v2_150_high400_latest2p0 | 4.512 | 18.09% | 3.369 | 0.495/1.679 | 0 | 8044.8 |
| rule_hybrid_latch_v2_50_high600_latest0p75 | 5.146 | 17.02% | 3.262 | 0.495/1.679 | 0 | 8518.2 |
| rule_hybrid_cap0p5_v2_50_high600_latest0p75 | 5.146 | 17.02% | 3.262 | 0.495/1.679 | 0 | 8518.2 |
| product_distilled_lag0_offset_minus4_brake | 5.328 | 20.21% | 4.588 | 0.495/1.679 | 0 | 9682.7 |
| mlp_temporal_h32_event_safe | 11.531 | 12.77% | 4.824 | 0.488/1.841 | 0.221 | 15269.5 |
| mlp_temporal_h64_event_safe | 10.824 | 18.09% | 5.164 | 0.555/1.793 | 0.289 | 15273.3 |
| fsmn_mlp_h32_event_safe | 11.094 | 15.96% | 7.32 | 0.499/1.789 | 0.197 | 16399.6 |

## Interpretation

The event-weighted MLP/FSMN-like models are too blunt in this compact run. They learn to suppress some stop-window overshoot but also make larger peak tails on Step04b stress. That suggests the high-accuracy path needs either a stronger teacher/event sequence loss or more realistic abrupt-stop training data before distillation.

The rule hybrid is more promising immediately. It uses only runtime-safe signals:

- recentHigh >= 400 px/s
- v5 <= 300 px/s
- latestDelta <= 2.5 px
- a short latch over the existing product DistilledMLP output

It does not worsen the latest real holdout metrics in this replay, but it still leaves peakLead max above 3 px and OTR >1px above 20%, so it is not a final product fix.

## Step 07 Decision

`continueToStep07`: false

Do not proceed to lightweight/distillation yet. The best candidate improves the stress tail, but not clearly enough to justify product-shape distillation under the current gate.

## Next

- Expand rule search around v5/latestDelta latch conditions and include fire-rate diagnostics.
- Add event-sequence training with explicit peakLead/returnMotion loss, not just row-safe labels.
- Gather or synthesize more realistic “stale latest sample / missed poll before stop” traces, because Step04b shows those are the leak dimensions.
