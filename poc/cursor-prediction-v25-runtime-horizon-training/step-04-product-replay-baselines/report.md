# Step 04 Report - Product Replay Baselines

## Summary

This step replays deterministic product-shaped baselines with more faithful runtime history. It compares feature-derived CV2 against product-style CV caps and a product-inspired LeastSquares replay.

## Best Overall

| candidate | visual p95 | visual p99 | stop lead p99 | central visual p95 |
| --- | ---: | ---: | ---: | ---: |
| feature_cv2_static_guard | 1.696106 | 3.605551 | 1.035991 | 2.395489 |
| product_cv_uncapped_static_guard | 1.696106 | 3.605551 | 1.035991 | 2.395489 |
| product_cv_cap24_static_guard | 1.696119 | 3.618418 | 1.035991 | 2.402801 |
| product_cv_cap12_static_guard | 1.698171 | 3.665793 | 1.035991 | 2.410064 |
| least_squares_or_cv2_static_guard | 2.847576 | 5.524742 | 0.269442 | 4.302879 |
| least_squares_static_guard | 2.887702 | 5.535780 | 0.267467 | 4.309922 |

## Best Central

| candidate | central visual p95 | central visual p99 | central stop lead p99 | overall visual p95 |
| --- | ---: | ---: | ---: | ---: |
| feature_cv2_static_guard | 2.395489 | 6.391241 | 1.703025 | 1.696106 |
| product_cv_uncapped_static_guard | 2.395489 | 6.391241 | 1.703025 | 1.696106 |
| product_cv_cap24_static_guard | 2.402801 | 6.633274 | 1.703025 | 1.696119 |
| product_cv_cap12_static_guard | 2.410064 | 7.967192 | 1.703025 | 1.698171 |
| least_squares_or_cv2_static_guard | 4.302879 | 10.330022 | 0.844498 | 2.847576 |
| least_squares_static_guard | 4.309922 | 10.945097 | 0.842688 | 2.887702 |

## Decision

If LeastSquares replay does not improve central buckets, the current evidence favors CV2-like short-window prediction plus scheduler/timing work over a larger MLP.
