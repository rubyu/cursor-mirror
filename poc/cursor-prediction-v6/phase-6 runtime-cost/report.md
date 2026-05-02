# Phase 6 - Runtime Cost

## Setup

Benchmarked Phase 5 first-fold runtime specs over 27,738 dataset rows in dependency-free Node.js on Windows_NT 10.0.26200 x64, Node v24.14.0. Timing reports hot-path prediction only; training and JSON loading are outside the measured loop.

Node is a proxy, not the target runtime. Ridge specs allocate a temporary JS feature array in this benchmark; a C# implementation can avoid that with stack allocation or a reused buffer. Table specs allocate JS strings for keys; a C# implementation should use integer bin indices.

## Hot-Path Cost

| model | Phase 5 selected | median ns/pred | p95 ns/pred | median us/pred | params | allocation note | C# complexity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| current_dwm_aware_last2_gain_0_75 |  | 33.8 | 38.2 | 0.0338 | 1 | no per-prediction model allocation | already implemented |
| safe_ridge_residual_guarded | yes | 331.3 | 353.1 | 0.3313 | 156 | JS proxy allocates a temporary feature array; C# can use stackalloc or a reused buffer | moderate: ridge dot products |
| piecewise_residual_table |  | 376.2 | 390.8 | 0.3762 | 128 | no numeric feature vector; key construction in JS allocates strings, C# can use enum indices | low: table lookup |
| thresholded_piecewise_table |  | 345.7 | 358.6 | 0.3457 | 0 | no numeric feature vector; key construction in JS allocates strings, C# can use enum indices | low: table lookup plus active-cell guard |
| confidence_gated_ridge |  | 47.2 | 58.8 | 0.0472 | 156 | JS proxy allocates a temporary feature array; C# can use stackalloc or a reused buffer | moderate: ridge dot products plus simple gate |

## Safety Context From Phase 5

| model | delta mean | delta p95 | delta p99 | >1 worse | >3 worse | >5 worse |
| --- | --- | --- | --- | --- | --- | --- |
| current_dwm_aware_last2_gain_0_75 | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 |
| safe_ridge_residual_guarded | 0.081 | 0.005 | -0.027 | 0 | 0 | 0 |
| piecewise_residual_table | 0.008 | 0.062 | 0.090 | 33 | 0 | 0 |
| thresholded_piecewise_table | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 |
| confidence_gated_ridge | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 |

## Recommendation

The selected model by Phase 5 is `safe_ridge_residual_guarded`, with median 331.3 ns/prediction in this Node proxy and 156 runtime parameters.

Runtime cost is acceptable for a cursor prediction hot path, but the measured accuracy gain is tiny and mean error worsens. Runtime is not the blocker; confidence in the behavior is.
