# Cursor Prediction v13 - Strict Holdout

## Intent

This follow-up retrains `transformer_residual_d96` with each machine/refresh holdout completely removed from training. It checks whether the POC 13 deep result survives a stricter cross-machine and cross-refresh split.

## Environment

- Device: `cuda`
- GPU: `NVIDIA GeForce RTX 5090`
- Torch: `2.11.0+cu128`

No checkpoints, expanded CSVs, feature caches, or model weights were written.

## Fold Results

| holdout | test packages | deep mean | deep p95 | deep p99 | step5 p95 | step5 p99 | delta p95 | delta p99 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| machine:24cpu_2560x1440_1mon_60Hz | m070248 | 0.4475 | 1.5746 | 4.1713 | 2.1032 | 5.7807 | -0.5286 | -1.6094 |
| machine:32cpu_7680x1440_3mon_60Hz | m070307 | 0.557 | 2.0033 | 4.6894 | 2.1649 | 5.7992 | -0.1616 | -1.1098 |
| machine:6cpu_3840x2160_1mon_30Hz | m070055,m070211 | 0.9227 | 3.1578 | 9.4776 | 3.0256 | 8.7909 | 0.1322 | 0.6867 |
| refresh:30Hz | m070055,m070211 | 0.9125 | 2.8953 | 9.9153 | 3.0256 | 8.7909 | -0.1303 | 1.1244 |
| refresh:60Hz | m070248,m070307 | 0.8456 | 2.9797 | 6.4854 | 2.1269 | 5.7868 | 0.8528 | 0.6986 |

## Interpretation

Negative deltas mean the strict deep model beat the Step 5 gate on the held-out package group. Positive deltas are regressions and should block product promotion until explained.
