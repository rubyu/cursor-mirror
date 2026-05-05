# Step 6 ML / FSMN Search

## Scope

This step compares CPU-deployable FSMN-family ridge heads, a dense ridge residual, and a small MLP-like fixed tanh hidden layer. Training is in-memory CPU normal-equation solving on the train split only. No GPU, checkpoint, raw ZIP copy, or large intermediate file was used.

## Validation Ranking

| rank | model                       | family         | dim | ops | product | mean   | p95  | p99  | >10      | signed mean | objective |
| ---- | --------------------------- | -------------- | --- | --- | ------- | ------ | ---- | ---- | -------- | ----------- | --------- |
| 1    | VFSMNv2_k12_ridge           | VFSMNv2        | 54  | 240 | yes     | 0.7577 | 2.25 | 7.75 | 0.00733  | -1.242      | 5.2183    |
| 2    | ridge_residual_dense        | ridge_residual | 18  | 80  | yes     | 0.7463 | 2.25 | 7.75 | 0.00719  | -1.2701     | 5.2432    |
| 3    | CVFSMN_k8_ridge             | CVFSMN         | 24  | 112 | yes     | 0.7565 | 2.25 | 7.75 | 0.00733  | -1.2515     | 5.25      |
| 4    | small_mlp_tanh16_ridge_head | MLP            | 34  | 640 | no      | 0.7744 | 2.25 | 8    | 0.007143 | -1.2379     | 5.2866    |
| 5    | CVFSMNv2_k12_ridge          | CVFSMNv2       | 36  | 180 | yes     | 0.7627 | 2.25 | 8    | 0.00747  | -1.2294     | 5.3169    |
| 6    | VFSMN_k8_ridge              | VFSMN          | 24  | 152 | yes     | 0.7307 | 2.25 | 8    | 0.007657 | -1.5293     | 5.4383    |
| 7    | FSMN_k4_ridge               | FSMN           | 14  | 96  | yes     | 0.6679 | 2.25 | 8    | 0.008124 | -1.7683     | 5.5464    |
| 8    | CSFSMN_k8_ridge             | CSFSMN         | 14  | 76  | yes     | 0.725  | 2.5  | 8    | 0.00775  | -1.7043     | 5.7442    |

## Selected Model Split Scores

Selected model: `VFSMNv2_k12_ridge`

| split      | count | mean   | p95  | p99  | >5       | >10      | signed mean | lag rate |
| ---------- | ----- | ------ | ---- | ---- | -------- | -------- | ----------- | -------- |
| test       | 20999 | 0.7337 | 2.25 | 6.25 | 0.014382 | 0.005286 | -1.1829     | 0.790331 |
| train      | 93913 | 0.7395 | 2.25 | 6.75 | 0.016409 | 0.005952 | -1.3263     | 0.816139 |
| validation | 21419 | 0.7577 | 2.25 | 7.75 | 0.018395 | 0.00733  | -1.242      | 0.795034 |

## Holdout Signals

| holdout                           | kind    | train p95 | test p95 | delta p95 | train p99 | test p99 | delta p99 |
| --------------------------------- | ------- | --------- | -------- | --------- | --------- | -------- | --------- |
| machine:24cpu_2560x1440_1mon_60Hz | machine | 2.5       | 2        | -0.5      | 7.5       | 5.5      | -2        |
| machine:32cpu_7680x1440_3mon_60Hz | machine | 2.5       | 2.25     | -0.25     | 7.25      | 6.25     | -1        |
| machine:6cpu_3840x2160_1mon_30Hz  | machine | 2         | 2.75     | 0.75      | 6         | 8.75     | 2.75      |
| refresh:30Hz                      | refresh | 2         | 2.75     | 0.75      | 6         | 8.75     | 2.75      |
| refresh:60Hz                      | refresh | 2.75      | 2        | -0.75     | 8.75      | 6        | -2.75     |

## Refresh Breakdown

| split      | refresh | count | mean   | p95  | p99  | >10      | signed mean |
| ---------- | ------- | ----- | ------ | ---- | ---- | -------- | ----------- |
| test       | 30Hz    | 6825  | 0.8516 | 3    | 8.25 | 0.008352 | -1.1542     |
| test       | 60Hz    | 14174 | 0.6769 | 2    | 5    | 0.00381  | -1.199      |
| validation | 30Hz    | 7199  | 0.8573 | 2.75 | 8.25 | 0.007223 | -1.233      |
| validation | 60Hz    | 14220 | 0.7073 | 2    | 7.5  | 0.007384 | -1.2477     |

## Movement Phase Breakdown

| split      | phase  | count | mean   | p95  | p99  | >10      | signed mean |
| ---------- | ------ | ----- | ------ | ---- | ---- | -------- | ----------- |
| test       | hold   | 3251  | 0.3898 | 1.5  | 7.5  | 0.00646  | -3.7525     |
| test       | moving | 16786 | 0.7989 | 2.25 | 5.75 | 0.004587 | -1.0485     |
| test       | resume | 962   | 0.7588 | 2.75 | 12.5 | 0.013514 | -2.6388     |
| validation | hold   | 3241  | 0.4618 | 1.75 | 8.5  | 0.008022 | -2.3362     |
| validation | moving | 17249 | 0.8069 | 2.25 | 7.25 | 0.006551 | -1.0779     |
| validation | resume | 929   | 0.8762 | 3.5  | 15   | 0.019376 | -4.3368     |

## Speed Bin Breakdown

| split      | speed     | count | mean   | p95   | p99   | >10      | signed mean |
| ---------- | --------- | ----- | ------ | ----- | ----- | -------- | ----------- |
| test       | >=2000    | 218   | 4.6981 | 17    | 32.5  | 0.105505 | -3.552      |
| test       | 0-25      | 19096 | 0.6449 | 2     | 5     | 0.003561 | n/a         |
| test       | 100-250   | 58    | 3.2522 | 13.25 | 39.25 | 0.068966 | -2.562      |
| test       | 1000-2000 | 690   | 1.3498 | 2.75  | 14.75 | 0.013043 | -1.0946     |
| test       | 25-100    | 74    | 1.3831 | 5     | 15.5  | 0.027027 | -0.9662     |
| test       | 250-500   | 69    | 1.3565 | 4.75  | 20.25 | 0.014493 | -0.9355     |
| test       | 500-1000  | 794   | 0.9468 | 2.75  | 8.25  | 0.005038 | -0.5502     |
| validation | >=2000    | 204   | 4.8543 | 20.75 | 36.75 | 0.127451 | -4.3713     |
| validation | 0-25      | 19526 | 0.6631 | 2     | 6.25  | 0.005019 | n/a         |
| validation | 100-250   | 56    | 3.4018 | 7.75  | 91.75 | 0.035714 | 0.1161      |
| validation | 1000-2000 | 634   | 1.5    | 2.5   | 19.25 | 0.022082 | -1.205      |
| validation | 25-100    | 127   | 1.3555 | 4.75  | 11.75 | 0.023622 | -0.5461     |
| validation | 250-500   | 94    | 1.636  | 6.5   | 25    | 0.031915 | -1.181      |
| validation | 500-1000  | 778   | 1.059  | 3     | 13.25 | 0.014139 | -0.6704     |

## CPU Implementation Notes

| model                       | family         | dim | ops | product | SIMD                                    |
| --------------------------- | -------------- | --- | --- | ------- | --------------------------------------- |
| ridge_residual_dense        | ridge_residual | 18  | 80  | yes     | good AVX2/AVX-512 dot-product candidate |
| FSMN_k4_ridge               | FSMN           | 14  | 96  | yes     | small scalar or SIMD both acceptable    |
| CSFSMN_k8_ridge             | CSFSMN         | 14  | 76  | yes     | small scalar or SIMD both acceptable    |
| VFSMN_k8_ridge              | VFSMN          | 24  | 152 | yes     | good AVX2/AVX-512 dot-product candidate |
| VFSMNv2_k12_ridge           | VFSMNv2        | 54  | 240 | yes     | good AVX2/AVX-512 dot-product candidate |
| CVFSMN_k8_ridge             | CVFSMN         | 24  | 112 | yes     | good AVX2/AVX-512 dot-product candidate |
| CVFSMNv2_k12_ridge          | CVFSMNv2       | 36  | 180 | yes     | good AVX2/AVX-512 dot-product candidate |
| small_mlp_tanh16_ridge_head | MLP            | 34  | 640 | no      | good AVX2/AVX-512 dot-product candidate |

## Broken / Weak Candidates

| model                       | family   | mean   | p95  | p99 | >10      | objective |
| --------------------------- | -------- | ------ | ---- | --- | -------- | --------- |
| CSFSMN_k8_ridge             | CSFSMN   | 0.725  | 2.5  | 8   | 0.00775  | 5.7442    |
| FSMN_k4_ridge               | FSMN     | 0.6679 | 2.25 | 8   | 0.008124 | 5.5464    |
| VFSMN_k8_ridge              | VFSMN    | 0.7307 | 2.25 | 8   | 0.007657 | 5.4383    |
| CVFSMNv2_k12_ridge          | CVFSMNv2 | 0.7627 | 2.25 | 8   | 0.00747  | 5.3169    |
| small_mlp_tanh16_ridge_head | MLP      | 0.7744 | 2.25 | 8   | 0.007143 | 5.2866    |

## Interpretation

- These ML/FSMN candidates are precision probes first and product candidates second.
- A candidate that only wins validation p95 but worsens p99, >10px, lag, or 30Hz holdout should not be promoted.
- The MLP-like candidate is intentionally marked non-preferred for product because it is harder to reason about and less directly SIMD-friendly than the ridge/FSMN family.
