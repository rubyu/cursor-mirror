# Step 04 Report: Original MotionLab Reproduction Attempt

## Result

The first replay did **not** reproduce the event-window abrupt-stop leak.

- no-brake reproduction: false
- product-brake reproduction: false
- detected stop events: 0 for all candidates

| candidate | events | visual p95/p99 | peakLead p95/p99/max | OTR >1px | return p99/max | jitter p95/p99 |
|---|---:|---:|---:|---:|---:|---:|
| constant_velocity_default_offset2 | 0 | 1.831/2.263 | 0/0/0 | 0% | 0/0 | 0.998/1.095 |
| least_squares_default_offset2 | 0 | 2.886/3.483 | 0/0/0 | 0% | 0/0 | 0.565/0.611 |
| distilled_mlp_lag0_offset_minus4 | 0 | 1.213/1.701 | 0/0/0 | 0% | 0/0 | 1.529/1.931 |
| distilled_mlp_lag0_offset_minus4_post_stop_brake | 0 | 1.213/1.701 | 0/0/0 | 0% | 0/0 | 1.529/1.931 |

## Interpretation

The Step 03 scenarios encoded holds and abrupt-stop intent, but the path lengths and 3.6s durations made the 60Hz runtime sequence too gentle. The Step 01 event detector never observed the required high-speed-to-near-zero transition. This is a generator issue, not proof that the product is safe on synthetic abrupt stops.

## Follow-up

Step 04b revises the generator with shorter/faster paths, 1-3 frame deceleration proxies, DWM phase crossing, stale/missed-poll proxies, near-zero last velocity, and curved approaches.
