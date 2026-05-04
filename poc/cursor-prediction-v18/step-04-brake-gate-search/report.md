# Step 04 Report: Event-Level Brake Gate Search

## Top Result

Selected candidate: `oneFrameStopSnap_v20_h400_td0p25`.

| candidate | events | peakLead p99 | peakLead max | peakDistance p99 | return max | OTR >1 | window fire | overall fire |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 623 | 1.517 | 2.441 | 1.754 | 2.491 | 1.124% | 0% | 0% |
| oneFrameStopSnap_v20_h400_td0p25 | 623 | 0.041 | 2.441 | 0.395 | 2.491 | 0.642% | 21.55% | 1.06% |
| hardBrakeCap_h800_cap0p5 | 623 | 1.117 | 2.441 | 1.179 | 2.491 | 0.963% | 6.26% | 0.37% |
| postStopOneFrameLatch_td0p5 | 623 | 1.117 | 2.441 | 1.179 | 2.491 | 0.963% | 20.46% | 0.99% |
| nearZeroTargetSnap_h400_td0p25 | 623 | 0.226 | 2.441 | 0.395 | 2.491 | 0.642% | 39.4% | 3% |

## Guardrails

| candidate | normal visual p95 | high visual p95 | post-stop jitter p95 | acute row max |
| --- | --- | --- | --- | --- |
| none | 1.72 | 1.928 | 0 | 1.989 |
| oneFrameStopSnap_v20_h400_td0p25 | 1.72 | 1.928 | 0 | 0 |
| hardBrakeCap_h800_cap0p5 | 1.72 | 1.928 | 0 | 0.462 |
| postStopOneFrameLatch_td0p5 | 1.72 | 1.928 | 0 | 0 |
| nearZeroTargetSnap_h400_td0p25 | 1.72 | 1.928 | 0 | 0.222 |

## Interpretation

`oneFrameStopSnap_v20_h400_td0p25` sharply reduces event p99: baseline peakLead p99 is `1.517px`, selected p99 is `0.041px`. It also reduces overshoot-then-return >1px rate from `1.124%` to `0.642%`.

However, the max event remains `2.441px`, because the worst tail is classified as `postStopFirstFrames`, not the narrow one-frame stop case. Broad gates such as `nearZeroTargetSnap` are not attractive because they fire much more often, including normal/high-speed slices.

## Adoption Decision

Do not ship a broad brake gate from this step. The best small branch to validate next is `oneFrameStopSnap_v20_h400_td0p25`: snap to current only when `v2 == 0`, target displacement `<= 0.25px`, and recent speed `>= 400 px/s`. It is allocation-free and leaves row-level normal/high-speed p95 unchanged in this replay, but it is not a complete fix because the largest post-stop return tail remains.
