# Step 04b Report: Revised Generator Reproduces Leak

## Result

The revised generator **does reproduce** abrupt-stop overshoot/return in the product-equivalent C# path.

- no-brake reproduction: true
- product-brake reproduction: true
- revised scenarios: 24
- DWM phase offsets: 0, 4.1666667, 8.3333333, 12.5

| candidate | events | visual p95/p99 | peakLead p95/p99/max | OTR >1px | return p99/max | jitter p95/p99 |
|---|---:|---:|---:|---:|---:|---:|
| constant_velocity_default_offset2 | 50 | 9.185/20.938 | 10.156/10.652/11.128 | 18% | 9.697/9.697 | 1.95/7.316 |
| least_squares_default_offset2 | 50 | 13.557/25.115 | 8.154/10.181/10.653 | 18% | 6.826/6.826 | 6.253/9.633 |
| distilled_mlp_lag0_offset_minus4 | 66 | 9.103/16.832 | 5.176/5.296/5.328 | 30.3% | 5.1/5.149 | 4.934/5.218 |
| distilled_mlp_lag0_offset_minus4_post_stop_brake | 66 | 9.103/16.832 | 4.938/5.296/5.328 | 24.24% | 4.672/4.828 | 2.783/3.598 |

## Key Finding

The current product post-stop brake reduces overshoot-then-return rate versus no-brake DistilledMLP, but it does **not** eliminate the revised synthetic leak:

- no-brake DistilledMLP OTR >1px: 30.3%
- product-brake DistilledMLP OTR >1px: 24.24%
- product-brake peakLead max: 5.328 px
- product-brake returnMotion max: 4.828 px

## Failure Shape

The leak is provoked by the dimensions the Step 03 set lacked: much higher pre-stop speed, very narrow deceleration, and near-zero/stale/missed-poll stop proxies. These can bypass or shorten the effective product brake protection because stop intent is not always an exact zero-current-delta plus tiny target-distance frame.

## Decision

Proceed to Step 05 dataset/loss design using this revised generator as an abrupt-stop synthetic family. The generator is still a stress test, not a final training distribution; it should be mixed with real 60Hz traces and guarded against leakage by file/scenario-level splits.
