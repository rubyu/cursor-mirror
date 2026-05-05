# Step 05 Report: Post-Stop Latch Search

## Result

Selected candidate: `postStopLatchN10_v20_h400_td0p25_rv100_rt0p5`.

| candidate | events | peakLead p99 | peakLead max | peakDistance max | return max | OTR >1 | overall fire | normal fire |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 623 | 1.517 | 2.441 | 2.491 | 2.491 | 1.124% | 0% | 0% |
| step04_oneFrameStopSnap_v20_h400_td0p25 | 623 | 0 | 2.441 | 2.491 | 2.491 | 0.321% | 1.84% | 15.51% |
| postStopLatchN10_v20_h400_td0p25_rv100_rt0p5 | 623 | 0 | 0 | 0 | 0 | 0% | 2.88% | 22.21% |
| oneFramePlus_postStopLatchN_N6_td0p25 | 623 | 0 | 0 | 0 | 0 | 0% | 3% | 24.27% |
| postStopCurrentDistanceCapN10_cap0_v20_h400_td0p25 | 623 | 0 | 0 | 0 | 0 | 0% | 3.2% | 24.3% |
| postStopDecayN12_s0_v20_h400_td0p25 | 623 | 0 | 1.775 | 1.811 | 1.811 | 0.161% | 3.51% | 24.3% |
| postStopDirectionClampN10_cap0p25_h600 | 623 | 0.246 | 1.937 | 2.465 | 2.465 | 0.321% | 2.44% | 20.44% |

## Guardrails

| candidate | normal p95 | normal p99 | high p95 | static jitter p95 | false resume rows |
| --- | --- | --- | --- | --- | --- |
| none | 1.72 | 7.368 | 1.928 | 0 | 0 |
| step04_oneFrameStopSnap_v20_h400_td0p25 | 1.72 | 7.368 | 1.928 | 0 | 0 |
| postStopLatchN10_v20_h400_td0p25_rv100_rt0p5 | 1.714 | 7.368 | 1.928 | 0 | 0 |
| oneFramePlus_postStopLatchN_N6_td0p25 | 1.714 | 7.368 | 1.928 | 0 | 0 |
| postStopCurrentDistanceCapN10_cap0_v20_h400_td0p25 | 1.714 | 7.368 | 1.928 | 0 | 0 |
| postStopDecayN12_s0_v20_h400_td0p25 | 1.714 | 7.368 | 1.928 | 0 | 0 |
| postStopDirectionClampN10_cap0p25_h600 | 1.714 | 7.368 | 1.928 | 0 | 0 |

## Interpretation

The strict 10-frame post-stop latch removes the detected event-window tail in this replay: peakLead, peakDistance, returnMotion, and overshoot-then-return rate all become zero for the Step 03 event set. This directly addresses the user-visible sequence: overshoot after stop followed by a return.

The important caveat is fire rate. `postStopLatchN10_v20_h400_td0p25_rv100_rt0p5` fires on `2.88%` of all rows and `22.21%` of rows classified as normalMove. Normal/high-speed visual p95 did not regress here, but that many normalMove firings means this should not be shipped blindly.

Compared with Step 04 one-frame snap, the latch is the first candidate to remove the max event. Decay and direction-only clamp are gentler, but leave max tail around 1.4-2.0px. Current-distance cap with cap 0 behaves like snap and has similar caution.

## Product Decision

Best POC candidate for the next validation is:

`postStopLatchN10_v20_h400_td0p25_rv100_rt0p5`

Runtime shape:

- stop onset: `v2 <= 20px/s`
- target displacement: `<= 0.25px`
- recent high speed: `>= 400px/s`, where recent high includes a latest-6-sample segment max
- action: snap prediction to current for up to 10 frames
- release: immediately when `v2 > 100px/s` or target displacement `> 0.5px`

Recommendation: do not put this directly into product as final behavior yet. It is a strong candidate behind a flag or in a product-side replay harness, because it eliminates the event tail but fires broadly enough that user-visible delay risk needs direct validation.
