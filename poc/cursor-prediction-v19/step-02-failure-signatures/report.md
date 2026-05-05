# Step 02 Report: Failure Signatures

## Scope

This step classifies the remaining abrupt-stop leak in `distilled_mlp_lag0_offset_minus4`. The current product brake is included as a reference and eliminates these detected windows on the audited pair.

## Top No-Brake Event Failures

| package | stop ms | phase | speed | decel | preMax | v2 | recentHigh | peakLead | peakDist | return | OTR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m070307 | 527283.573 | postStopFirstFrames | medium | fullStop | 961.8 | 0 | 1562 | 2.441 | 2.491 | 2.491 | yes |
| m070307 | 695969.43 | oneFrameStop | high | fullStop | 1502.6 | 0 | 2099.1 | 1.988 | 2.151 | 2.151 | yes |
| m070307 | 695781.306 | fastThenNearZero | low | fullStop | 546 | 0 | 849.6 | 1.971 | 2.151 | 0 | no |
| m070307 | 696252.153 | fastThenNearZero | medium | fullStop | 887.4 | 0 | 438.7 | 1.937 | 2.465 | 2.465 | yes |
| m070307 | 696197.962 | fastThenNearZero | high | fullStop | 1242.9 | 0 | 645.8 | 1.795 | 2.465 | 2.465 | yes |
| m070307 | 696033.04 | oneFrameStop | high | fullStop | 1460.8 | 0 | 4058.3 | 1.78 | 2.465 | 0 | no |
| m070307 | 684146.587 | oneFrameStop | high | fullStop | 1347.8 | 61.6 | 2216.5 | 1.517 | 1.754 | 1.754 | yes |
| m070307 | 635892.738 | fastThenNearZero | low | fullStop | 524.8 | 0 | 1001.1 | 1.13 | 1.179 | 1.179 | yes |

## Classification

- Phase is mixed: `postStopFirstFrames`, `oneFrameStop`, and `fastThenNearZero` all appear near the top.
- Deceleration is mostly `fullStop`; the issue is a time-window failure after rapid deceleration, not just a single bad frame.
- Path efficiency is high in representative rows, so these are clean approach-to-stop events rather than jittery path reversals.
- Speed bands range from low/medium to high/veryHigh; a robust fix cannot depend only on a very-high-speed threshold.
- DWM timing is available in the top examples from these traces, so the leak is not explained by missing DWM alone.

## Implication

The existing post-stop brake’s 10-frame latch matches the detected leak family on these traces. The remaining research risk is reproduction coverage: if the user still sees overshoot live, the missing case likely differs in phase/timing, data density, curved approach, near-zero creep, load/no-load scheduling, or stop duration. Step 03 should therefore add synthetic abrupt-stop scenarios rather than only tuning this trace pair.
