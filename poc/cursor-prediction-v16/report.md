# Cursor Prediction v16 - Runtime-Ready Distillation

## Intent

POC v16 turns the v15 60Hz student-compression work into runtime-ready artifacts. The experiment keeps the v14/v15 60Hz-only data path, trains a GRU teacher, searches tiny FSMN-feature MLPs and linear FSMN/ridge students, exports real weights, and checks generated-runtime parity.

## Environment

- Device: `cuda`
- GPU: `NVIDIA GeForce RTX 5090`
- Torch: `2.11.0+cu128`
- CUDA: `12.8`
- Execution: `single-process sequential GPU/CPU training; no concurrent heavy experiments`

No raw ZIPs, expanded CSVs, checkpoints, tensor dumps, TensorBoard logs, feature caches, or large binaries were written.

## Dataset

- Rows: 90621
- Packages: `{'m070248': 45855, 'm070307': 44766}`
- Splits: `{'test': 14174, 'validation': 14220, 'train': 62227}`
- Refresh: `{'60Hz': 90621}`

Only 60Hz rows are included.

## Teacher

Teacher: `teacher_gru_residual_h128`

| split | mean | p95 | p99 | signed mean |
| --- | ---: | ---: | ---: | ---: |
| validation | 0.4877 | 1.7107 | 5.1538 | -1.0871 |
| test | 0.4873 | 1.8619 | 4.078 | -0.9781 |

## Candidate Ranking

| candidate | family | target | params | macs | val p95 | val p99 | val signed | test p95 | test p99 | holdout p95 | holdout p99 | teacher p95 | objective |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mlp_fsmn_h8_tanh_teacher_q0p0625_lag0p375 | tiny_mlp_fsmn | teacher | 730 | 712 | 1.8168 | 5.3658 | -1.0493 | 1.9212 | 4.1595 | n/a | n/a | 0.8827 | 4.3531 |
| mlp_fsmn_h8_tanh_teacher_q0p0625_lag0p5 | tiny_mlp_fsmn | teacher | 730 | 712 | 1.8425 | 5.3372 | -0.9543 | 1.9375 | 4.16 | n/a | n/a | 0.993 | 4.3535 |
| mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5 | tiny_mlp_fsmn | label | 730 | 712 | 1.7843 | 5.2377 | -0.8994 | 1.9795 | 4.1232 | 2.125 | 4.5451 | 1.0734 | 4.3553 |
| mlp_fsmn_h8_tanh_teacher_q0p125_lag0p5 | tiny_mlp_fsmn | teacher | 730 | 712 | 1.8432 | 5.3461 | -0.9584 | 1.9133 | 4.1638 | n/a | n/a | 0.9966 | 4.3574 |
| mlp_fsmn_h8_tanh_teacher_q0p03125_lag0p375 | tiny_mlp_fsmn | teacher | 730 | 712 | 1.8201 | 5.3864 | -1.0492 | 1.9096 | 4.1498 | n/a | n/a | 0.8882 | 4.3622 |
| mlp_fsmn_h8_tanh_teacher_q0p03125_lag0p5 | tiny_mlp_fsmn | teacher | 730 | 712 | 1.8412 | 5.3731 | -0.9542 | 1.9327 | 4.1851 | n/a | n/a | 0.9944 | 4.3623 |
| mlp_fsmn_h8_hardtanh_teacher_q0p125_lag0p5 | tiny_mlp_fsmn | teacher | 730 | 712 | 1.8029 | 5.5017 | -0.9335 | 1.9404 | 4.1274 | n/a | n/a | 1.0315 | 4.3635 |
| mlp_fsmn_h8_hardtanh_teacher_q0p0625_lag0p5 | tiny_mlp_fsmn | teacher | 730 | 712 | 1.802 | 5.5098 | -0.9349 | 1.9375 | 4.131 | n/a | n/a | 1.0264 | 4.3638 |
| mlp_fsmn_h8_hardtanh_label_q0p03125_lag0p5 | tiny_mlp_fsmn | label | 730 | 712 | 1.7996 | 5.2034 | -0.8997 | 1.9674 | 4.101 | 2.1181 | 4.5409 | 1.0684 | 4.3644 |
| mlp_fsmn_h8_tanh_teacher_q0p125_lag0p375 | tiny_mlp_fsmn | teacher | 730 | 712 | 1.8231 | 5.3952 | -1.0534 | 1.8917 | 4.1447 | n/a | n/a | 0.8828 | 4.3669 |
| mlp_fsmn_h8_hardtanh_blend75teacher25label_q0p125_lag0p375 | tiny_mlp_fsmn | blend75teacher25label | 730 | 712 | 1.8381 | 5.3442 | -1.0431 | 1.9764 | 4.1583 | n/a | n/a | 0.9731 | 4.3669 |
| mlp_fsmn_h8_hardtanh_label_q0p03125_lag0p125 | tiny_mlp_fsmn | label | 730 | 712 | 1.8113 | 5.325 | -1.1847 | 1.932 | 4.2038 | n/a | n/a | 0.7882 | 4.3712 |
| mlp_fsmn_h8_hardtanh_blend75teacher25label_q0p125_lag0p25 | tiny_mlp_fsmn | blend75teacher25label | 730 | 712 | 1.8324 | 5.3114 | -1.1381 | 1.9764 | 4.1508 | n/a | n/a | 0.8738 | 4.373 |
| mlp_fsmn_h8_hardtanh_blend75teacher25label_q0p03125_lag0p25 | tiny_mlp_fsmn | blend75teacher25label | 730 | 712 | 1.8321 | 5.3147 | -1.1366 | 1.9678 | 4.1697 | n/a | n/a | 0.876 | 4.3734 |
| mlp_fsmn_h8_hardtanh_label_q0p0625_lag0p125 | tiny_mlp_fsmn | label | 730 | 712 | 1.8125 | 5.3445 | -1.184 | 1.9375 | 4.2118 | n/a | n/a | 0.7926 | 4.3778 |
| mlp_fsmn_h8_hardtanh_teacher_q0p03125_lag0p375 | tiny_mlp_fsmn | teacher | 730 | 712 | 1.7934 | 5.5292 | -1.03 | 1.9172 | 4.1871 | n/a | n/a | 0.9208 | 4.3792 |
| mlp_fsmn_h8_hardtanh_label_q0p125_lag0p375 | tiny_mlp_fsmn | label | 730 | 712 | 1.7784 | 5.2094 | -0.9944 | 1.9477 | 4.127 | 2.1104 | 4.6037 | 0.9669 | 4.3828 |
| mlp_fsmn_h8_hardtanh_label_q0p03125_lag0p375 | tiny_mlp_fsmn | label | 730 | 712 | 1.7856 | 5.1952 | -0.9947 | 1.9413 | 4.1473 | 2.0972 | 4.6011 | 0.9587 | 4.3829 |

Selected candidate: `mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5`.

## Package Holdout

| heldout | teacher p95 | teacher p99 | selected p95 | selected p99 | best candidate | best p95 | best p99 | Step5 p95 | Step5 p99 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m070248 | 1.6417 | 4.6354 | 1.6849 | 4.5397 | mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5 | 1.6849 | 4.5397 | 2.1032 | 5.7807 |
| m070307 | 2.0089 | 5.1396 | 2.125 | 4.5451 | mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5 | 2.125 | 4.5451 | 2.1649 | 5.7992 |

## Runtime Artifacts

- Selected descriptor: `runtime/selected-candidate.json`
- Generated C#: `runtime/Distilled60HzPredictor.g.cs`
- Exported shortlist: `runtime/candidates/`

The selected descriptor includes source feature normalization, FSMN feature normalization, target scale, layer weights/biases, activation, quantization step, lag compensation, and metadata.

## Parity

- Method: `csharp_generated_source_vs_json_descriptor`
- Max error: 0.0 px
- p99 error: 0.0 px
- Target: < 0.01 px
- C# compile/run: `passed`
- C# sample count: 512
- C# runtime: `.NET 10.0.7`

The generated C# source was compiled and executed against an independent JSON-descriptor evaluator.

## Adoption Decision

Adopt as a product-integration candidate for guarded 60Hz runtime testing, not as product code yet. The strongest deployable shape is a hardtanh tiny MLP over FSMN-style causal features. It exports real arrays and passes both generated-shape parity and real C# compile/run parity; app-loop latency measurement and product feature-input integration remain open.
