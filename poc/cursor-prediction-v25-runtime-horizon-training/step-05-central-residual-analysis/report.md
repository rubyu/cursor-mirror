# Step 05 Report - Central Residual Analysis

## Summary

This step asks what remains in the hard central target-correction buckets after the best simple predictor (`cv2`) is used.

## Candidate Metrics

| candidate | central visual p95 | central visual p99 | central lead p99 | central lag p99 |
| --- | ---: | ---: | ---: | ---: |
| hold | 6.313172 | 17.262677 | 0.000000 | 17.262677 |
| cv2 | 2.395489 | 6.391241 | 2.421011 | 5.746955 |
| cv12 | 4.126833 | 12.936236 | 2.870623 | 11.862127 |
| current_smooth_predictor | 6.422173 | 17.682184 | 0.136224 | 17.681627 |
| oracle_best_hold_cv2_cv12_smooth | 2.014395 | 6.086140 | 1.161090 | 5.788961 |

## CV2 By Bucket

| bucket | rows | visual p95 | visual p99 | lead p99 | lag p99 | label p95 | speed2 p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| -8.0 | 2400 | 1.980044 | 3.130030 | 1.483056 | 3.008996 | 3.162278 | 648.9 |
| -4.0 | 2400 | 2.293415 | 5.561649 | 2.682441 | 4.319503 | 5.385165 | 648.9 |
| 0.0 | 2400 | 2.747414 | 7.779963 | 2.680645 | 6.664437 | 7.499599 | 648.9 |
| 4.0 | 2400 | 2.747414 | 7.779963 | 2.680645 | 6.664437 | 7.499599 | 648.9 |
| 8.0 | 2400 | 2.747414 | 7.779963 | 2.680645 | 6.664437 | 7.499599 | 648.9 |

## Interpretation

If the oracle combination is much better than CV2, a deterministic gate may still help. If the oracle is not much better, the remaining error is likely tied to sample timing, label timing, or information that is not present in the short history features.
