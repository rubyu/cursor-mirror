# Cursor Prediction v9 Phase 3 ML Teachers

Generated: 2026-05-03T04:24:31Z

Device: `NVIDIA GeForce RTX 5090`  
Torch: `2.11.0+cu128`  
CUDA available: `True`

The dataset was built in memory from the two Format 9 trace ZIPs. No dataset
cache, checkpoint, or TensorBoard artifact was written.

## Best By Fold

| fold | candidate | family | role | mean | p95 | p99 | max | >1px regressions | >5px regressions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| train-session-1-eval-session-2 | mlp_seq16_residual | mlp | unguarded_residual | 9.137 | 42.221 | 107.929 | 496.104 | 6751 | 2923 |
| train-session-2-eval-session-1 | mlp_seq16_residual | mlp | unguarded_residual | 4.602 | 16.935 | 65.002 | 531.728 | 14707 | 3147 |

## train-session-1-eval-session-2

Train: `session-1`, eval: `session-2`

Failures: none

| candidate | family | role | mean | rmse | p95 | p99 | max | >1px reg | >5px reg | train sec | rows/sec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlp_seq16_residual | mlp | unguarded_residual | 9.137 | 23.169 | 42.221 | 107.929 | 496.104 | 6751 | 2923 | 0.446 | 21058704.0 |
| mlp_seq16_residual_guarded_tinf | mlp | guarded_residual | 9.137 | 23.169 | 42.221 | 107.929 | 496.104 | 6751 | 2923 | 0.446 | 21058704.0 |
| tcn_seq16_residual | tcn | unguarded_residual | 10.109 | 25.024 | 45.497 | 111.854 | 481.596 | 10905 | 3138 | 0.206 | 2518556.5 |
| tcn_seq16_residual_guarded_tinf | tcn | guarded_residual | 10.109 | 25.024 | 45.497 | 111.854 | 481.596 | 10905 | 3138 | 0.206 | 2518556.5 |
| cnn1d_seq16_residual | cnn1d | unguarded_residual | 10.628 | 25.974 | 48.075 | 118.548 | 491.163 | 6546 | 2949 | 0.292 | 10411075.6 |
| cnn1d_seq16_residual_guarded_tinf | cnn1d | guarded_residual | 10.628 | 25.974 | 48.075 | 118.548 | 491.163 | 6546 | 2949 | 0.292 | 10411075.6 |
| lstm_seq16_residual | lstm | unguarded_residual | 12.354 | 30.983 | 57.030 | 141.059 | 545.740 | 3721 | 1279 | 0.159 | 5533563.3 |
| lstm_seq16_residual_guarded_tinf | lstm | guarded_residual | 12.354 | 30.983 | 57.030 | 141.059 | 545.740 | 3721 | 1279 | 0.159 | 5533563.3 |
| fsmn_seq16_residual | fsmn | unguarded_residual | 12.411 | 30.918 | 58.668 | 140.495 | 552.037 | 2796 | 1112 | 0.139 | 7024432.7 |
| fsmn_seq16_residual_guarded_tinf | fsmn | guarded_residual | 12.411 | 30.918 | 58.668 | 140.495 | 552.037 | 2796 | 1112 | 0.139 | 7024432.7 |
## train-session-2-eval-session-1

Train: `session-2`, eval: `session-1`

Failures: none

| candidate | family | role | mean | rmse | p95 | p99 | max | >1px reg | >5px reg | train sec | rows/sec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlp_seq16_residual | mlp | unguarded_residual | 4.602 | 16.125 | 16.935 | 65.002 | 531.728 | 14707 | 3147 | 0.066 | 6681512.1 |
| mlp_seq16_residual_guarded_tinf | mlp | guarded_residual | 4.602 | 16.125 | 16.935 | 65.002 | 531.728 | 14707 | 3147 | 0.066 | 6681512.1 |
| tcn_seq16_residual | tcn | unguarded_residual | 5.043 | 17.428 | 19.583 | 67.796 | 565.051 | 18964 | 2242 | 0.153 | 6588340.6 |
| tcn_seq16_residual_guarded_tinf | tcn | guarded_residual | 5.043 | 17.428 | 19.583 | 67.796 | 565.051 | 18964 | 2242 | 0.153 | 6588340.6 |
| cnn1d_seq16_residual | cnn1d | unguarded_residual | 5.374 | 16.918 | 21.209 | 68.971 | 549.221 | 23550 | 2959 | 0.092 | 5638230.6 |
| cnn1d_seq16_residual_guarded_tinf | cnn1d | guarded_residual | 5.374 | 16.918 | 21.209 | 68.971 | 549.221 | 23550 | 2959 | 0.092 | 5638230.6 |
| gru_seq16_residual | gru | unguarded_residual | 5.363 | 18.363 | 21.822 | 67.488 | 566.238 | 14346 | 2027 | 0.133 | 5582646.3 |
| gru_seq16_residual_guarded_tinf | gru | guarded_residual | 5.363 | 18.363 | 21.822 | 67.488 | 566.238 | 14346 | 2027 | 0.133 | 5582646.3 |
| lstm_seq16_residual | lstm | unguarded_residual | 5.708 | 18.788 | 22.100 | 69.744 | 588.076 | 32955 | 2224 | 0.161 | 4235660.9 |
| lstm_seq16_residual_guarded_tinf | lstm | guarded_residual | 5.708 | 18.788 | 22.100 | 69.744 | 588.076 | 32955 | 2224 | 0.161 | 4235660.9 |

