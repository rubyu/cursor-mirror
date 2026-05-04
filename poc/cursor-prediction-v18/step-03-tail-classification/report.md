# Step 03 Report: Event-Window Tail Classification

## Baseline

Baseline is `lag0 offset -4ms` from the Step 02 C# chronological replay.

| candidate | events | peakLead p99 | peakLead max | peakDistance p99 | return max | OTR >1 | window fire | overall fire |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 623 | 1.517 | 2.441 | 1.754 | 2.491 | 1.124% | 0% | 0% |

## Representative Event Tail

| package | stop ms | phase | peak frame | preMax | v2 | v5 | v12 | target | peakLead | peakDist | return | OTR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m070307 | 527283.573 | postStopFirstFrames | 8 | 961.8 | 0 | 152.9 | 504.5 | 0 | 2.441 | 2.491 | 2.491 | yes |
| m070307 | 695969.43 | oneFrameStop | 0 | 1502.6 | 0 | 874.3 | 876.6 | 0 | 1.988 | 2.151 | 2.151 | yes |
| m070307 | 695781.306 | fastThenNearZero | 10 | 546 | 0 | 365.3 | 265.6 | 0 | 1.971 | 2.151 | 0 | no |
| m070307 | 696252.153 | fastThenNearZero | 0 | 887.4 | 0 | 122.5 | 170 | 0 | 1.937 | 2.465 | 2.465 | yes |
| m070307 | 696197.962 | fastThenNearZero | 3 | 1242.9 | 0 | 200 | 434.6 | 0 | 1.795 | 2.465 | 2.465 | yes |

## Interpretation

The earlier Step 02 per-row metric understated the visual issue because it measured each row independently. In the largest tail, the peak is not the initial stop row: the event reaches `2.441px` lead at `peakFrame 8`, then returns by about `2.491px`. That sequence matches the user report more closely than a single-frame current-position overshoot.

The tail is sparse but real: p95 is still zero, while p99/max expose the problem. The largest case is classified as `postStopFirstFrames`; the one-frame-stop residual is important but not the only failure mode.
