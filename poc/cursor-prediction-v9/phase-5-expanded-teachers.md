# Cursor Prediction v9 Phase 5 Expanded Teachers

Generated: 2026-05-03T04:44:38Z

Device: `NVIDIA GeForce RTX 5090`  
Torch: `2.11.0+cu128`  
CUDA available: `True`

Training used each train session's first 70%, selected early-stopped weights on
the trailing 30%, and evaluated on the other session. Fixed common gates used
the same rule in both folds. No Calibrator run, checkpoint, cache, TensorBoard,
or large dataset artifact was written.

## Headline Evaluation

| role | candidate | mean | rmse | p95 | p99 | max | >1px reg | >5px reg | >1px improved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | product-baseline | 9.165 | 27.629 | 42.720 | 129.000 | 614.649 | 0 | 0 | 0 |
| best eval teacher | mlp_seq32_h256_128_64 | 7.097 | 20.018 | 28.237 | 88.705 | 521.477 | 33359 | 11463 | 31941 |
| validation objective teacher | fsmn_seq32_c64 | 7.014 | 21.244 | 31.834 | 97.023 | 557.072 | 15077 | 5312 | 33382 |
| strict common gate | rfn_seq32_rff768_ridge01__common-r8-cos075-base4-or-eff09 | 9.103 | 27.602 | 42.637 | 129.000 | 614.649 | 1759 | 403 | 3553 |
| balanced common gate | rfn_seq32_rff768_ridge01__common-r8-cos075-base8-or-eff09 | 9.097 | 27.602 | 42.637 | 129.000 | 614.649 | 1768 | 404 | 3722 |
| balanced non-RFN gate | tcn_seq32_c64__common-r8-cos075-base8-or-eff09 | 8.946 | 27.535 | 42.418 | 128.996 | 614.649 | 3078 | 540 | 9073 |

## Best Teacher Runtime

Best teacher: `mlp_seq32_h256_128_64`  
Params: `109378`  
Train sec total: `0.351`  
GPU eval rows/sec: `15356050.4`  
PyTorch CPU rows/sec sample mean: `818962.5`  
C# SIMD estimate rows/sec: `826233.8` to `826233.8`

Best balanced fixed gate: `rfn_seq32_rff768_ridge01__common-r8-cos075-base8-or-eff09`  
Gate GPU rows/sec follows the same teacher inference cost plus a small scalar
mask; estimate: `137993.1` rows/sec before mask.

Best non-RFN balanced fixed gate: `tcn_seq32_c64__common-r8-cos075-base8-or-eff09`.

## Teacher Ranking

| teacher | family | seq | p95 | p99 | mean | >5px reg | params | train sec | GPU rows/sec | CPU rows/sec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlp_seq32_h256_128_64 | mlp | 32 | 28.237 | 88.705 | 7.097 | 11463 | 109378 | 0.351 | 15356050.4 | 818962.5 |
| mlp_seq32_h128_64_32 | mlp | 32 | 28.479 | 86.155 | 7.144 | 13061 | 44450 | 0.630 | 7888360.4 | 1573107.1 |
| mlp_seq16_h256_128_64 | mlp | 16 | 28.532 | 88.933 | 6.969 | 11951 | 76610 | 0.500 | 12623620.5 | 1206298.6 |
| transformer_seq32_d64_h4_l1 | transformer | 32 | 28.829 | 88.592 | 6.473 | 5365 | 43394 | 3.146 | 2578434.4 | 24068.6 |
| mlp_seq16_h128_64_32 | mlp | 16 | 28.926 | 86.986 | 6.779 | 10126 | 28066 | 0.979 | 10416279.4 | 1939659.3 |
| tcn_seq32_c64 | tcn | 32 | 29.502 | 88.712 | 6.593 | 5888 | 57282 | 1.397 | 1937246.3 | 30038.5 |
| gru_seq32_h80 | gru | 32 | 30.140 | 93.860 | 6.756 | 5782 | 30434 | 1.462 | 3126750.8 | 37733.5 |
| fsmn_seq32_c64 | fsmn | 32 | 31.834 | 97.023 | 7.014 | 5312 | 12930 | 0.949 | 5150261.8 | 55924.9 |
| cnn_seq32_c64 | cnn | 32 | 38.607 | 115.381 | 9.294 | 13311 | 41794 | 0.997 | 4756248.1 | 87689.1 |
| rfn_seq32_rff768_ridge01 | rfn | 32 | 109.037 | 173.190 | 23.772 | 41061 | 205824 | 1.227 | 137993.1 | 133144.1 |

## Fixed Common Gate Ranking

| teacher | gate | p95 | p99 | mean | >1px reg | >5px reg | >1px improved | GPU rows/sec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rfn_seq32_rff768_ridge01 | common-r8-cos075-base8-or-eff09 | 42.637 | 129.000 | 9.097 | 1768 | 404 | 3722 | 137993.1 |
| rfn_seq32_rff768_ridge01 | common-r8-cos075-base4-or-eff09 | 42.637 | 129.000 | 9.103 | 1759 | 403 | 3553 | 137993.1 |
| rfn_seq32_rff768_ridge01 | common-r8-cos05-base8-or-eff09 | 42.637 | 129.000 | 9.107 | 2314 | 515 | 3996 | 137993.1 |
| rfn_seq32_rff768_ridge01 | common-r8-cos05-base4-or-eff09 | 42.637 | 129.000 | 9.112 | 2301 | 513 | 3825 | 137993.1 |
| tcn_seq32_c64 | common-r8-cos075-base8-or-eff09 | 42.418 | 128.996 | 8.946 | 3078 | 540 | 9073 | 1937246.3 |
| tcn_seq32_c64 | common-r8-cos075-base4-or-eff09 | 42.418 | 128.996 | 8.954 | 3066 | 538 | 8813 | 1937246.3 |
| tcn_seq32_c64 | common-r8-cos05-base8-or-eff09 | 42.402 | 128.996 | 8.944 | 3515 | 582 | 9570 | 1937246.3 |
| mlp_seq16_h256_128_64 | common-r8-cos075-base8-or-eff09 | 42.579 | 128.996 | 8.974 | 3010 | 567 | 8239 | 12623620.5 |
| tcn_seq32_c64 | common-r8-cos05-base4-or-eff09 | 42.402 | 128.996 | 8.952 | 3503 | 580 | 9310 | 1937246.3 |
| mlp_seq16_h256_128_64 | common-r8-cos075-base4-or-eff09 | 42.579 | 128.996 | 8.982 | 3001 | 567 | 8003 | 12623620.5 |
| rfn_seq32_rff768_ridge01 | common-r8-cos025-base8-or-eff09 | 42.637 | 129.000 | 9.115 | 2699 | 584 | 4109 | 137993.1 |
| rfn_seq32_rff768_ridge01 | common-r8-cos025-base4-or-eff09 | 42.637 | 129.000 | 9.121 | 2685 | 582 | 3938 | 137993.1 |
