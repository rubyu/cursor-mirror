# Cursor Prediction v9 Phase 7 Max-Safe Gate

Generated: 2026-05-03T05:02:26Z

Device: `NVIDIA GeForce RTX 5090`  
Torch: `2.11.0+cu128`  
CUDA available: `True`

This phase adds max-safe objectives, residual clamp variants, and high-speed /
low-efficiency fallback variants. No Calibrator run, checkpoint, cache,
TensorBoard, or large dataset artifact was written.

## Headline Evaluation

| role | candidate | mean | rmse | p95 | p99 | max | >1 | >3 | >5 | >10 | >20 | >50 | improved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | product-baseline | 9.165 | 27.629 | 42.720 | 129.000 | 614.649 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| teacher alone | mlp_seq32_h256_128_64 | 7.114 | 19.197 | 28.060 | 85.407 | 541.922 | 33239 | 19286 | 12877 | 5288 | 1762 | 484 | 31893 |
| phase6-equivalent | tcn_seq32_c64 | 8.678 | 26.648 | 40.264 | 122.293 | 918.637 | 504 | 465 | 435 | 376 | 258 | 106 | 2837 |
| strict | tcn_seq32_c64 | 9.157 | 27.579 | 42.702 | 128.799 | 592.152 | 8 | 6 | 5 | 5 | 4 | 0 | 67 |
| balanced | fsmn_seq32_c64 | 9.009 | 26.639 | 42.297 | 125.002 | 573.080 | 113 | 109 | 106 | 87 | 66 | 29 | 562 |
| max-safe | tcn_seq32_c64 | 9.100 | 27.437 | 42.190 | 127.690 | 606.649 | 81 | 77 | 77 | 0 | 0 | 0 | 1087 |

## Teacher Summary

| teacher | alone p95 | alone >20 | phase6 p95 | phase6 >20 | balanced p95 | balanced >20 | maxsafe p95 | maxsafe >20 | params | GPU rows/s | CPU rows/s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlp_seq32_h256_128_64 | 28.060 | 1762 | 34.785 | 323 | 42.190 | 0 | 42.653 | 5 | 109378 | 15959751.4 | 1585526.0 |
| fsmn_seq32_c64 | 29.122 | 1521 | 40.112 | 257 | 42.297 | 66 | 42.379 | 0 | 12930 | 7509086.1 | 76850.4 |
| tcn_seq32_c64 | 31.202 | 1565 | 40.264 | 258 | 41.758 | 0 | 42.190 | 0 | 57282 | 2841509.2 | 42293.3 |

## Selected Gates

| role | teacher | selected gates by fold | p95 | max | >20 | >50 |
| --- | --- | --- | --- | --- | --- | --- |
| phase6 | tcn_seq32_c64 | tcn_seq32_c64__tiny-mlp__tiny-mlp-m0-p095__all__noclamp / tcn_seq32_c64__tiny-mlp__tiny-mlp-m5-p09__all__noclamp | 40.264 | 918.637 | 258 | 106 |
| strict | tcn_seq32_c64 | tcn_seq32_c64__tiny-mlp__tiny-mlp-m0-p095-maxsafe__speed-lt-1000__noclamp / tcn_seq32_c64__logistic__logistic-m0-p095-maxsafe__speed-lt-2000__clamp24 | 42.702 | 592.152 | 4 | 0 |
| balanced | fsmn_seq32_c64 | fsmn_seq32_c64__logistic__logistic-m1-p095-maxsafe__speed-lt-1000__clamp8 / fsmn_seq32_c64__tiny-mlp__tiny-mlp-m0-p095__all__noclamp | 42.297 | 573.080 | 66 | 29 |
| max-safe | tcn_seq32_c64 | tcn_seq32_c64__tiny-mlp__tiny-mlp-m5-p095-maxsafe__speed-lt-1000__clamp4 / tcn_seq32_c64__tiny-mlp__tiny-mlp-m5-p095-maxsafe__eff-ge-075__clamp8 | 42.190 | 606.649 | 0 | 0 |

Best max-safe runtime candidate: `tcn_seq32_c64` params `57282`,
GPU `2841509.2` rows/sec, PyTorch CPU
`42293.3` rows/sec, C# SIMD teacher
estimate `56375.2` to
`56375.2` rows/sec. Gate overhead is
threshold-tree/logistic/tiny-MLP scale: roughly 20 to 76 scalar ops per sample
plus an optional residual clamp.
