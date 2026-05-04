# Cursor Prediction v9 Phase 6 Confidence Gate

Generated: 2026-05-03T04:51:37Z

Device: `NVIDIA GeForce RTX 5090`  
Torch: `2.11.0+cu128`  
CUDA available: `True`

Teachers were trained on first 70% of the train session. Logistic, tiny-MLP,
and shallow threshold-tree gates were trained or selected on the trailing 30%
validation split and evaluated on the other session. No Calibrator run,
checkpoint, cache, TensorBoard, or large dataset artifact was written.

## Headline Evaluation

| role | candidate | mean | rmse | p95 | p99 | max | >1px reg | >3px reg | >5px reg | >1px improved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | product-baseline | 9.165 | 27.629 | 42.720 | 129.000 | 614.649 | 0 | 0 | 0 | 0 |
| best teacher alone | mlp_seq32_h256_128_64 | 6.865 | 19.565 | 26.996 | 84.363 | 631.383 | 31537 | 17286 | 11033 | 31511 |
| best fixed gate | tcn_seq32_c64 | 8.951 | 27.536 | 42.475 | 128.996 | 614.649 | 2969 | 1289 | 534 | 8776 |
| learned strict | mlp_seq32_h256_128_64 | 8.833 | 26.512 | 40.870 | 122.036 | 631.383 | 933 | 401 | 276 | 2611 |
| learned balanced | tcn_seq32_c64 | 8.706 | 26.306 | 40.591 | 122.324 | 760.167 | 1215 | 475 | 339 | 3759 |

## Teacher/Gate Summary

| teacher | alone p95 | alone p99 | alone >5 | strict p95 | strict >5 | balanced p95 | balanced >5 | params | GPU rows/sec | CPU rows/sec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlp_seq32_h256_128_64 | 26.996 | 84.363 | 11033 | 40.870 | 276 | 34.785 | 648 | 109378 | 11042228.6 | 1266378.8 |
| fsmn_seq32_c64 | 29.714 | 89.482 | 5681 | 41.280 | 262 | 39.609 | 843 | 12930 | 5483593.6 | 54526.6 |
| tcn_seq32_c64 | 29.628 | 89.464 | 5777 | 40.591 | 339 | 40.591 | 339 | 57282 | 2666383.1 | 27085.7 |

## Selected Gates

| role | teacher | selected gates by fold | p95 | >5px reg |
| --- | --- | --- | --- | --- |
| strict | mlp_seq32_h256_128_64 | mlp_seq32_h256_128_64__tree__tree-r4-cos075-base8-or-eff09 / mlp_seq32_h256_128_64__tiny-mlp__m3__p09 | 40.870 | 276 |
| balanced | tcn_seq32_c64 | tcn_seq32_c64__tree__tree-r4-cos075-base4-or-eff00 / tcn_seq32_c64__tiny-mlp__m5__p09 | 40.591 | 339 |
| fixed | tcn_seq32_c64 | tcn_seq32_c64__fixed__common-r8-cos075-base8-or-eff09 / tcn_seq32_c64__fixed__common-r8-cos075-base4-or-eff09 | 42.475 | 534 |

Best learned balanced teacher runtime: `tcn_seq32_c64` params `57282`,
GPU `2666383.1` rows/sec, PyTorch CPU
`27085.7` rows/sec, C# SIMD teacher
estimate `43337.1` to
`56375.2` rows/sec.

Gate CPU estimates are lightweight. Strict: `[{'estimatedOpsPerSample': 20, 'estimatedCSharpRowsPerSecLow': 20000000.0, 'estimatedCSharpRowsPerSecHigh': 80000000.0}, {'estimatedOpsPerSample': 76, 'estimatedCSharpRowsPerSecLow': 3000000.0, 'estimatedCSharpRowsPerSecHigh': 12000000.0}]`.
Balanced: `[{'estimatedOpsPerSample': 20, 'estimatedCSharpRowsPerSecLow': 20000000.0, 'estimatedCSharpRowsPerSecHigh': 80000000.0}, {'estimatedOpsPerSample': 76, 'estimatedCSharpRowsPerSecLow': 3000000.0, 'estimatedCSharpRowsPerSecHigh': 12000000.0}]`.
