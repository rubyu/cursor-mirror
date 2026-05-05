# Step 06 Report - Candidate Gate

## Summary

Step 06 trains a small classifier to choose among hold, CV2, CV12, and the current SmoothPredictor instead of directly regressing a new displacement.

| candidate | central visual p95 | central visual p99 | central lead p99 | central lag p99 | overall visual p95 | MACs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| oracle_best_hold_cv2_cv12_smooth | 2.014395 | 6.086140 | 1.161090 | 5.788961 | 1.408000 | 0 |
| cv2 | 2.395489 | 6.391241 | 2.421011 | 5.746955 | 1.696106 | 2 |
| gate_class_balanced_central4_h0 | 3.220971 | 9.698919 | 2.450647 | 9.486788 | 1.968215 | 100 |
| gate_class_balanced_central4_h32 | 3.259722 | 7.680050 | 2.461409 | 7.124392 | 1.907366 | 928 |
| gate_uniform_h32 | 3.467725 | 10.049876 | 2.461409 | 9.219544 | 1.980582 | 928 |
| gate_class_balanced_central4_h16 | 3.599860 | 10.054738 | 2.355618 | 10.054574 | 2.193747 | 464 |
| gate_central8_accepted2_h0 | 3.605551 | 9.022396 | 2.332918 | 8.834824 | 2.000000 | 100 |
| gate_central4_h16 | 3.636804 | 11.704700 | 2.260584 | 11.430000 | 2.000000 | 464 |
| gate_central8_accepted2_h16 | 3.684243 | 10.770330 | 2.229008 | 10.310877 | 2.000000 | 464 |
| gate_central4_h32 | 3.703418 | 10.372000 | 2.169173 | 10.248915 | 2.000000 | 928 |
| gate_central4_h0 | 3.954664 | 10.049876 | 1.716026 | 9.848009 | 2.000000 | 100 |
| gate_uniform_h0 | 4.000000 | 9.678000 | 2.023731 | 9.418648 | 2.000000 | 100 |
| gate_central8_accepted2_h32 | 4.000000 | 10.670208 | 1.887139 | 10.652195 | 2.053237 | 928 |
| gate_uniform_h16 | 4.123106 | 11.401754 | 2.576912 | 10.964528 | 2.000000 | 464 |
| cv12 | 4.126833 | 12.936236 | 2.870623 | 11.862127 | 1.687676 | 2 |
| hold | 6.313172 | 17.262677 | 0.000000 | 17.262677 | 3.605551 | 2 |
| current_smooth_predictor | 6.422173 | 17.682184 | 0.136224 | 17.681627 | 3.574788 | 2 |

## Decision

The gate must beat CV2 on central visual p95 without worsening p99/tail metrics enough to be visible. If it cannot approach the oracle, the remaining gain is unlikely to come from a simple candidate selector.
