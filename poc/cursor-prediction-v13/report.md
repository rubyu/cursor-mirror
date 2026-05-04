# Cursor Prediction v13 - GPU Deep Learning Capacity Probe

## Intent

This POC tests whether the v9 dataset can be learned by deeper models. The purpose is precision discovery, not immediate product integration. Inputs remain causal: runtimeSchedulerPoll/v9 target timing and causal referencePoll history.

## Environment

- Device: `cuda`
- Torch: `2.11.0+cu128`
- CUDA: `12.8`
- GPU: `NVIDIA GeForce RTX 5090`
- GPU used: `true`

No checkpoints, expanded CSVs, feature caches, TensorBoard logs, or model weight files were written.

## Dataset

- Rows: 136331
- Scalar dim: 25
- Sequence: [16,9]
- Splits: `{"validation":21419,"train":93913,"test":20999}`
- Refresh: `{"30Hz":45710,"60Hz":90621}`
- Phase: `{"moving":106302,"hold":23644,"resume":6377,"unknown":8}`

Cleaning and split policy are inherited from POC 12. Contaminated user-input windows and `m070055` scenario 0 are excluded.

## Validation Ranking

| model | family | objective | val mean | val p95 | val p99 | test p95 | test p99 | >=2000 p99 | 30Hz holdout p99 d |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| transformer_residual_d96 | Transformer | 3.334 | 0.478 | 1.6323 | 5.319 | 1.7989 | 4.7691 | 28.9415 | 0.5152 |
| gru_residual_h128 | GRU | 3.4497 | 0.4881 | 1.6991 | 5.6128 | 1.8079 | 4.5519 | 29.3047 | 0.3966 |
| transformer_residual_weighted_d96 | Transformer | 3.6054 | 0.5117 | 1.7339 | 5.5568 | 1.85 | 4.8971 | 27.9596 | 0.9555 |
| tcn_residual_c96 | TCN | 3.6449 | 0.51 | 1.775 | 5.7026 | 1.9078 | 5.1231 | 31.0722 | 0.6461 |
| gru_residual_weighted_h128 | GRU | 3.6489 | 0.5445 | 1.8048 | 5.8165 | 1.8334 | 4.6925 | 28.2396 | 0.6684 |
| lstm_residual_h128 | LSTM | 3.7207 | 0.5134 | 1.7708 | 5.8598 | 1.8907 | 4.6749 | 32.3163 | 0.8252 |
| mlp_residual_h256 | MLP | 3.7878 | 0.5196 | 1.7366 | 6.416 | 1.8053 | 4.9518 | 29.5696 | 0.5802 |
| mlp_direct_h320 | MLP | 3.8439 | 0.5186 | 1.7762 | 6.111 | 1.8739 | 4.9327 | 29.2546 | 0.9891 |
| tcn_residual_weighted_c96 | TCN | 3.8518 | 0.5739 | 1.8335 | 5.9538 | 1.9376 | 5.123 | 25.3587 | 1.0363 |
| mlp_residual_weighted_h256 | MLP | 4.0203 | 0.5653 | 1.8718 | 6.2749 | 1.8762 | 5.0811 | 25.9562 | 1.1629 |
| step5_gate | baseline | 5.3382 | 0.6735 | 2.2361 | 7.6598 | 2.5034 | 6.0003 | 34.7664 | 3.0041 |
| constant_position | baseline | 5.6272 | 0.5847 | 2.2361 | 8.3507 | 2.4555 | 6.404 | 37.4943 | 3.2751 |

## Selected Model

Selected model: `transformer_residual_d96`.

| split | mean | p95 | p99 | >10 | signed mean | lag rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| train | 0.3664 | 1.45 | 2.8345 | 0.0014 | -0.6108 | 0.7135 |
| validation | 0.478 | 1.6323 | 5.319 | 0.0051 | -0.6502 | 0.6978 |
| test | 0.493 | 1.7989 | 4.7691 | 0.0038 | -0.635 | 0.7094 |

## Holdout

30Hz holdout delta for the selected model: p95 -0.2955, p99 0.5152.

## Strict Holdout Follow-Up

`strict-holdout-report.md` retrains the selected Transformer with each machine or refresh bucket completely removed from training. The result is mixed: the model beats Step 5 on the two held-out 60Hz machines, but 30Hz and refresh-only strict holdouts still show p99 regressions.

| strict holdout | deep p95 | deep p99 | Step 5 p95 | Step 5 p99 | delta p95 | delta p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| machine:24cpu_2560x1440_1mon_60Hz | 1.5746 | 4.1713 | 2.1032 | 5.7807 | -0.5286 | -1.6094 |
| machine:32cpu_7680x1440_3mon_60Hz | 2.0033 | 4.6894 | 2.1649 | 5.7992 | -0.1616 | -1.1098 |
| machine:6cpu_3840x2160_1mon_30Hz | 3.1578 | 9.4776 | 3.0256 | 8.7909 | 0.1322 | 0.6867 |
| refresh:30Hz | 2.8953 | 9.9153 | 3.0256 | 8.7909 | -0.1303 | 1.1244 |
| refresh:60Hz | 2.9797 | 6.4854 | 2.1269 | 5.7868 | 0.8528 | 0.6986 |

## Comparison To POC 12

The POC 12 Step 5 gate was the prior product-safe candidate. POC 13 shows that the dataset is learnable by a high-capacity causal model: the selected deep model improves validation p95/p99 and test p95/p99 over the Step 5 gate. Product integration is still a separate CPU/SIMD/distillation problem.

## Interpretation

A deep model matched or improved the Step 5 validation p95/p99 under the strict objective. However, strict refresh holdouts still have p99 regressions, so this is evidence that the data is learnable, not evidence that the deep model is product-ready.
