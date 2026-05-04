# Cursor Prediction v15 - 60Hz Student Compression

## Intent

POC v15 compresses the v14 60Hz distilled student toward a C# runtime shape. It compares tiny MLP widths, activation choices, quantized output variants, ridge/FSMN linear variants, and package holdouts.

## Environment

- Device: `cuda`
- GPU: `NVIDIA GeForce RTX 5090`
- Torch: `2.11.0+cu128`
- CUDA: `12.8`

No raw ZIPs, expanded CSVs, feature caches, checkpoints, TensorBoard logs, or model weight binaries were written.

## Dataset

- Rows: 90621
- Packages: `{'m070248': 45855, 'm070307': 44766}`
- Splits: `{'test': 14174, 'validation': 14220, 'train': 62227}`

Only 60Hz rows are included.

## Teacher

Teacher: `teacher_gru_residual_h128`

| split | mean | p95 | p99 |
| --- | ---: | ---: | ---: |
| validation | 0.486 | 1.6658 | 5.0984 |
| test | 0.4898 | 1.8265 | 4.1877 |

## Student Ranking

| student | family | target | params | macs | val p95 | val p99 | test p95 | test p99 | teacher p95 | objective |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlp_fsmn_h8_hardtanh_teacher | tiny_mlp | teacher | 730 | 712 | 1.8653 | 5.5447 | 1.9528 | 4.4471 | 0.8071 | 3.9352 |
| mlp_fsmn_h8_hardtanh_teacher_q0p03125 | tiny_mlp | teacher | 730 | 712 | 1.8715 | 5.5417 | 1.9502 | 4.4563 | 0.8065 | 3.9407 |
| mlp_fsmn_h8_tanh_teacher_q0p125 | tiny_mlp | teacher | 730 | 712 | 1.875 | 5.5357 | 1.9445 | 4.405 | 0.8144 | 3.9458 |
| mlp_fsmn_h8_hardtanh_teacher_q0p0625 | tiny_mlp | teacher | 730 | 712 | 1.876 | 5.5447 | 1.9415 | 4.4523 | 0.8052 | 3.9459 |
| mlp_fsmn_h8_hardtanh_teacher_q0p125 | tiny_mlp | teacher | 730 | 712 | 1.8792 | 5.528 | 1.9741 | 4.4478 | 0.8055 | 3.9475 |
| mlp_fsmn_h8_tanh_teacher_q0p03125 | tiny_mlp | teacher | 730 | 712 | 1.8845 | 5.5126 | 1.9385 | 4.3839 | 0.8121 | 3.9492 |
| mlp_fsmn_h8_tanh_teacher_q0p0625 | tiny_mlp | teacher | 730 | 712 | 1.8802 | 5.5357 | 1.9385 | 4.3765 | 0.8135 | 3.9506 |
| mlp_fsmn_h8_tanh_teacher | tiny_mlp | teacher | 730 | 712 | 1.8886 | 5.5209 | 1.9427 | 4.384 | 0.8081 | 3.9554 |
| mlp_fsmn_h12_hardtanh_teacher_q0p125 | tiny_mlp | teacher | 1142 | 1116 | 1.7897 | 5.9099 | 1.8883 | 4.242 | 0.7623 | 4.1453 |
| mlp_fsmn_h12_hardtanh_teacher_q0p03125 | tiny_mlp | teacher | 1142 | 1116 | 1.812 | 5.9003 | 1.9068 | 4.2443 | 0.7588 | 4.1653 |
| mlp_fsmn_h12_hardtanh_teacher | tiny_mlp | teacher | 1142 | 1116 | 1.8125 | 5.8988 | 1.9063 | 4.2354 | 0.7545 | 4.1654 |
| mlp_fsmn_h12_hardtanh_teacher_q0p0625 | tiny_mlp | teacher | 1142 | 1116 | 1.8136 | 5.9242 | 1.9121 | 4.2376 | 0.7597 | 4.1728 |
| mlp_fsmn_h8_silu_teacher_q0p125 | tiny_mlp | teacher | 730 | 712 | 1.9245 | 6.7257 | 2 | 4.3782 | 0.7842 | 4.28 |
| mlp_fsmn_h8_silu_teacher_q0p03125 | tiny_mlp | teacher | 730 | 712 | 1.9378 | 6.7459 | 1.9697 | 4.3874 | 0.7794 | 4.2983 |
| mlp_fsmn_h8_silu_teacher_q0p0625 | tiny_mlp | teacher | 730 | 712 | 1.9375 | 6.7529 | 1.9863 | 4.3875 | 0.7742 | 4.2996 |
| mlp_fsmn_h12_tanh_teacher_q0p125 | tiny_mlp | teacher | 1142 | 1116 | 1.875 | 6.2253 | 2 | 4.3386 | 0.8103 | 4.3019 |

Selected runtime candidate: `mlp_fsmn_h12_hardtanh_teacher_q0p125`.

## Package Holdout

| heldout | teacher p95 | teacher p99 | best student | student p95 | student p99 | Step5 p95 | Step5 p99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| m070248 | 1.5817 | 4.2399 | mlp_fsmn_h8_hardtanh_teacher | 1.704 | 4.7978 | 2.1032 | 5.7807 |
| m070307 | 2.2599 | 5.7771 | mlp_fsmn_h8_tanh_teacher | 2.3328 | 6.3958 | 2.1649 | 5.7992 |

## Runtime Shape

- Candidate descriptor: `runtime-prototype/candidate.json`
- C# shape stub: `runtime-prototype/Distilled60HzPredictorShape.cs`

## Interpretation

The selected candidate is a 60Hz-only runtime-shape approximation. It should be treated as a prototype until generated C# inference is validated bit-for-bit and measured in the application loop. Tiny MLP remains the strongest compressed family; linear ridge/FSMN is simpler but loses too much p99.
