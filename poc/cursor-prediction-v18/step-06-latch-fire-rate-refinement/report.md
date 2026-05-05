# Step 06 Report: Latch Fire-Rate Refinement

## Selected

Selected candidate: `baseLatchN10_v0_h400_td0p1_rv50_rt0p25`.

| candidate | peakLead p99 | peakLead max | peakDist max | return max | OTR >1 | overall fire | normal fire | normal fire stop-soon |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 1.517 | 2.441 | 2.491 | 2.491 | 1.124% | 0% | 0% | 0% |
| step04_oneFrameStopSnap_v20_h400_td0p25 | 0 | 2.441 | 2.491 | 2.491 | 0.321% | 1.845% | 15.505% | 99.438% |
| step05_best_latchN10_v20_h400_td0p25 | 0 | 0 | 0 | 0 | 0% | 2.882% | 22.213% | 99.477% |
| baseLatchN10_v0_h400_td0p1_rv50_rt0p25 | 0 | 0 | 0 | 0 | 0% | 2.768% | 21.661% | 99.464% |
| sustainedStopN10_c2_h400_td0p25 | 1.117 | 1.988 | 2.465 | 2.465 | 0.803% | 1.791% | 14.082% | 99.794% |
| targetAndCurrentZeroN10_ld0p25_h400_td0p25 | 0 | 0 | 0 | 0 | 0% | 2.882% | 22.213% | 99.477% |
| distanceCapN10_cap0p25_ld0p25_h400 | 0.226 | 0.245 | 0.25 | 0.25 | 0% | 2.882% | 22.213% | 99.477% |

## Guardrails

| candidate | normal p95 | normal p99 | high p95 | static jitter p95 | false resume rows |
| --- | --- | --- | --- | --- | --- |
| none | 1.72 | 7.368 | 1.928 | 0 | 0 |
| step04_oneFrameStopSnap_v20_h400_td0p25 | 1.72 | 7.368 | 1.928 | 0 | 0 |
| step05_best_latchN10_v20_h400_td0p25 | 1.714 | 7.368 | 1.928 | 0 | 0 |
| baseLatchN10_v0_h400_td0p1_rv50_rt0p25 | 1.714 | 7.368 | 1.928 | 0 | 0 |
| sustainedStopN10_c2_h400_td0p25 | 1.714 | 7.368 | 1.928 | 0 | 0 |
| targetAndCurrentZeroN10_ld0p25_h400_td0p25 | 1.714 | 7.368 | 1.928 | 0 | 0 |
| distanceCapN10_cap0p25_ld0p25_h400 | 1.714 | 7.368 | 1.928 | 0 | 0 |

## NormalMove Fire Classification

The selected candidate still fires on `21.661%` of normalMove rows. However, `99.464%` of those fired normalMove rows are followed by stop/near-stop within 10 frames. In other words, most of the apparent normalMove fire looks like stop-prep/hold behavior under this replay definition, not ordinary continuous movement.

That lowers concern, but it does not eliminate it. The slice label and the user-visible experience can diverge, so product-side live logging or a validation flag is still needed before broad rollout.

## Tradeoff

The selected candidate preserves the Step 05 zero-tail result:

- event `peakLead p99/max = 0/0px`
- event `peakDistance max = 0px`
- event `returnMotion max = 0px`
- `overshootThenReturn >1px = 0%`

Fire rate improves only slightly versus Step 05 best:

- Step 05 best overall fire: `2.882%`
- Step 06 selected overall fire: `2.768%`
- Step 05 best normalMove fire: `22.213%`
- Step 06 selected normalMove fire: `21.661%`

Low-fire candidates below 5% normalMove fire exist, but they leave the max event tail around the Step 04/Step 05 failure level. Under the current available runtime signals, keeping event max <= 0.5px appears to require a latch that still fires in many rows labeled normalMove.

## Product Decision

Do not put this directly into product as default behavior. The best next candidate is `baseLatchN10_v0_h400_td0p1_rv50_rt0p25` behind a validation flag or product-side chronological replay:

- stop onset: `v2 <= 0px/s`
- target displacement: `<= 0.1px`
- recentHigh: `>= 400px/s`
- action: snap to current for up to 10 frames
- release: `v2 > 50px/s` or target displacement `> 0.25px`

Next validation should log actual trigger rows, stop-soon classification, release reason, and mirror/current positions in the user environment.
