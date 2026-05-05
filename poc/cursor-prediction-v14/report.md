# Cursor Prediction v14 - 60Hz Teacher Distillation

## Intent

POC 14 narrows the target to the latest 60Hz v9 data only. The goal is to treat a GPU-trained deep teacher as the accuracy target, then see how closely CPU-friendly students can approximate it.

## Environment

- Device: `cuda`
- GPU: `NVIDIA GeForce RTX 5090`
- Torch: `2.11.0+cu128`
- CUDA: `12.8`

No raw ZIPs, expanded CSVs, feature caches, checkpoints, TensorBoard logs, or model weight files were written.

## Dataset

- Rows: 90621
- Packages: `{'m070248': 45855, 'm070307': 44766}`
- Splits: `{'test': 14174, 'validation': 14220, 'train': 62227}`
- Phase: `{'moving': 70667, 'hold': 15720, 'resume': 4231, 'unknown': 3}`
- Speed bins: `{'1000-2000': 2843, '>=2000': 770, '0-25': 83314, '500-1000': 2996, '250-500': 120, '100-250': 217, '25-100': 361}`

Only 60Hz rows are used. 30Hz rows are intentionally excluded from this POC.

## Teacher Search

| teacher | family | val mean | val p95 | val p99 | test p95 | test p99 |
| --- | --- | --- | --- | --- | --- | --- |
| teacher_gru_residual_h128 | GRU | 0.4918 | 1.6927 | 5.1493 | 1.8302 | 4.0248 |
| teacher_transformer_residual_d96 | Transformer | 0.5008 | 1.6702 | 5.4194 | 1.8094 | 4.094 |
| teacher_tcn_residual_c96 | TCN | 0.5247 | 1.8415 | 5.8579 | 1.9337 | 4.362 |

Selected teacher: `teacher_gru_residual_h128`.

## Student Distillation

| student | family | target | val mean | val p95 | val p99 | test p95 | test p99 | teacher mean | teacher p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tiny_mlp_fsmn_teacher | tiny_mlp | teacher | 0.5323 | 1.8662 | 5.9313 | 1.9473 | 4.2647 | 0.2031 | 0.6171 |
| ridge_fsmn_label | ridge_fsmn | label | 0.6753 | 2.0356 | 7.3717 | 2.1117 | 5.0952 | 0.4137 | 1.195 |
| ridge_fsmn_teacher | ridge_fsmn | teacher | 0.6829 | 2.0472 | 7.424 | 2.107 | 5.0051 | 0.4169 | 1.1871 |
| ridge_dense_teacher | ridge_dense | teacher | 0.6857 | 2.0531 | 7.5858 | 2.1101 | 5.0199 | 0.4201 | 1.201 |
| ridge_scalar_teacher | ridge_scalar | teacher | 0.6781 | 2.0546 | 7.7093 | 2.1434 | 5.1605 | 0.4179 | 1.2458 |
| ridge_dense_label | ridge_dense | label | 0.6897 | 2.0671 | 7.779 | 2.1305 | 5.0768 | 0.4282 | 1.2108 |
| ridge_scalar_label | ridge_scalar | label | 0.6841 | 2.0676 | 7.8029 | 2.1715 | 5.0992 | 0.4274 | 1.2834 |

Selected student: `tiny_mlp_fsmn_teacher`.

## 60Hz Package Holdout

| heldout package | teacher p95 | teacher p99 | best student | student p95 | student p99 | Step5 p95 | Step5 p99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| m070248 | 1.6363 | 4.5522 | tiny_mlp_fsmn_teacher | 1.6678 | 4.7893 | 2.1032 | 5.7807 |
| m070307 | 2.0376 | 4.9726 | tiny_mlp_fsmn_teacher | 2.0564 | 5.1511 | 2.1649 | 5.7992 |

## Interpretation

The 60Hz-only deep teacher is learnable and at least one CPU-friendly student beats the Step 5 gate on the standard 60Hz split. Package holdout remains the promotion gate: regressions there should block direct product integration. The teacher itself is a clear upper-bound improvement over Step 5 in the 60Hz standard split.
