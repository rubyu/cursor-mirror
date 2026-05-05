# Step 07 Report: Deep Rule/Event Search

## Summary

The deep rule/event search found a slightly better version of the Step 06 rule family, but it did **not** find a product-shaped candidate strong enough to justify Step 08.

Best candidate:

- `curated_snap_v5_v450_h400_ld2p5_td99_r0p75_n4_c0_b0`
- Step04b peakLead max: 3.357 px
- Step04b OTR >1px: 21.28%
- Step04b returnMotion max: 3.19 px
- real holdout p95/p99: 0.495 / 1.679 px
- normalMove fire rate: 2.85%
- total fire rate: 2.39%

Compared with current product brake:

- peakLead max: 5.328 -> 3.357 px
- OTR >1px: 20.21% -> 21.28%
- returnMotion max: 4.588 -> 3.19 px

Compared with Step 06 best:

- peakLead max: 3.357 -> 3.357 px
- OTR >1px: 22.34% -> 21.28%
- returnMotion max: 3.226 -> 3.19 px

## Ranking

| candidate | Step04b peakLead max | OTR >1px | return max | real p95/p99 | normal fire | total fire | objective |
|---|---:|---:|---:|---:|---:|---:|---:|
| curated_snap_v5_v450_h400_ld2p5_td99_r0p75_n4_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 2.85% | 2.39% | 12359.9 |
| curated_snap_v5_v450_h400_ld2p5_td99_r0p75_n6_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 2.85% | 2.81% | 12361.6 |
| curated_snap_v5_v450_h400_ld2p5_td99_r0p75_n8_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 2.85% | 3.16% | 12363.1 |
| curated_snap_v5_v450_h400_ld2p5_td99_r0p75_n10_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 2.85% | 3.48% | 12364.3 |
| curated_snap_v5_v450_h400_ld2p5_td99_r0p75_n12_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 2.85% | 3.76% | 12365.4 |
| curated_snap_v5_v450_h400_ld3p5_td99_r0p75_n4_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 4.67% | 2.72% | 12424.9 |
| curated_snap_v5_v450_h400_ld3p5_td99_r0p75_n6_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 4.73% | 3.25% | 12429.2 |
| curated_snap_v5_v450_h400_ld3p5_td99_r0p75_n8_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 4.73% | 3.71% | 12431.1 |
| curated_snap_v5_v450_h400_ld3p5_td99_r0p75_n10_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 4.73% | 4.13% | 12432.7 |
| curated_snap_v5_v450_h400_ld3p5_td99_r0p75_n12_c0_b0 | 3.357 | 21.28% | 3.19 | 0.495/1.679 | 4.73% | 4.52% | 12434.3 |
| curated_snap_v5_v300_h400_ld2p5_td99_r0p75_n4_c0_b0 | 3.357 | 22.34% | 3.226 | 0.495/1.679 | 1.57% | 1.92% | 12628.8 |
| curated_snap_v5_v300_h400_ld2p5_td99_r0p75_n6_c0_b0 | 3.357 | 22.34% | 3.226 | 0.495/1.679 | 1.57% | 2.34% | 12630.5 |

## Fire Diagnostics

For the selected candidate:

- total fire rate: 2.39%
- stop-window fire rate: 34.5%
- normalMove fire rate: 2.85%

The rule fires often enough near stop windows to reduce return tail, but it still misses enough Step04b leak windows that OTR remains above 20%. This suggests the remaining tail is not fully observable from the current v2/v5/latestDelta gate alone.

## Decision

`continueToStep08`: false

Do not start Step 08. Step 07 improves Step 06 only marginally and does not drive OTR or returnMotion close enough to zero.

## Next

- Add exact runtime signal logging around stop onset: duplicate sample count, last raw input age, scheduler-vs-DWM phase, and whether target crosses the stop boundary.
- Revisit the synthetic generator with explicit stale/duplicate poll streams rather than speed-point proxies.
- If training resumes, use event-sequence losses over peak/return directly rather than row-safe labels.
