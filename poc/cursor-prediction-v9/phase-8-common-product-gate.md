# Cursor Prediction v9 Phase 8 Common Product Gate

Generated: 2026-05-03T05:09:07Z

Device: `NVIDIA GeForce RTX 5090`  
Torch: `2.11.0+cu128`  
CUDA available: `True`

The selected gate specification is common across both folds. Teacher and gate
weights are still trained per fold, but family, gate type, margin, probability
threshold, apply condition, and clamp are fixed. No Calibrator run, checkpoint,
cache, TensorBoard, or large dataset artifact was written.

## Headline Evaluation

| role | candidate | mean | rmse | p95 | p99 | max | >1 | >3 | >5 | >10 | >20 | >50 | improved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | product-baseline | 9.165 | 27.629 | 42.720 | 129.000 | 614.649 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| teacher-alone | mlp_seq32_h256_128_64 | 6.879 | 19.126 | 27.290 | 84.573 | 667.815 | 32418 | 18737 | 11638 | 4490 | 1624 | 467 | 32094 |
| phase7 fold-specific | tcn_seq32_c64 | 9.100 | 27.437 | 42.190 | 127.690 | 606.649 | 81 | 77 | 77 | 0 | 0 | 0 | 1087 |
| common max-safe | fsmn_seq32_c64__tiny-mlp__m1__p09__speed-lt-1000__clamp4 | 9.058 | 27.379 | 42.099 | 127.676 | 610.661 | 209 | 188 | 0 | 0 | 0 | 0 | 3261 |
| common balanced | mlp_seq32_h256_128_64__tiny-mlp__m5__p09__speed-lt-1000__clamp4 | 8.957 | 27.109 | 40.804 | 126.570 | 610.660 | 337 | 327 | 0 | 0 | 0 | 0 | 6224 |
| product-candidate | mlp_seq32_h256_128_64__tiny-mlp__m5__p09__speed-lt-1000__clamp4 | 8.957 | 27.109 | 40.804 | 126.570 | 610.660 | 337 | 327 | 0 | 0 | 0 | 0 | 6224 |

## Teacher Summary

| teacher | alone p95 | alone p99 | alone >20 | maxsafe p95 | maxsafe >20 | balanced p95 | balanced >20 | params | GPU rows/s | CPU rows/s | C# SIMD low |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlp_seq32_h256_128_64 | 27.290 | 84.573 | 1624 | 42.297 | 0 | 40.804 | 0 | 109378 | 12180017.8 | 1605991.4 | 826233.8 |
| fsmn_seq32_c64 | 28.884 | 86.069 | 1507 | 42.099 | 0 | 41.491 | 0 | 12930 | 6571795.8 | 80506.0 | 128809.6 |
| tcn_seq32_c64 | 32.176 | 96.175 | 1400 | 42.190 | 0 | 42.190 | 0 | 57282 | 2721839.9 | 44380.4 | 56375.2 |

## Decision

Product-shaped candidate exists: `mlp_seq32_h256_128_64__tiny-mlp__m5__p09__speed-lt-1000__clamp4` on `mlp_seq32_h256_128_64`. It satisfies p95/p99 improvement, max <= baseline, >20/>50 regression = 0, and C# SIMD low estimate >= 40k rows/sec.
