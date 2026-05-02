# Phase 8 - Torch CUDA Teacher

## Setup

CUDA PyTorch was used from the local venv. `torch.cuda.is_available()` returned `True`.

Device: `cuda`. Torch: `2.11.0+cu128`. CUDA runtime: `12.8`.

Dataset rows: 27,738 across sessions 175951: 15,828, 184947: 11,910.

The run kept tensors, features, and weights in memory only. It did not write checkpoints, torch.save outputs, cached feature matrices, TensorBoard logs, generated datasets, or compiler caches.

## Feature And Split Policy

Models used causal anchor-time inputs only: anchor position, last-two motion deltas/velocity/acceleration proxies, target horizon, DWM availability, scheduler lead, speed/horizon/lead bins, and an 8-step masked history ending at the current anchor for sequence models.

Excluded from model inputs: label coordinates except as training targets, future reference fields, target reference indices, reference nearest distance, source ZIP, and session ID. Session ID was used only to build the required cross-session split and causal same-session history.

Each direction fit on the first 70% chronological block of one session, selected caps on that session's last 30%, then evaluated the other full session.

## Held-Out Cross-Session Results

| fold | model | mean/rmse/p95/p99 | delta mean/rmse/p95/p99 | >1 worse | >3 worse | >5 worse | params | train sec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | current_dwm_aware_last2_gain_0_75 | 3.306 / 9.291 / 15.186 / 44.097 | 0.000 / 0.000 / 0.000 / 0.000 | 0 | 0 | 0 | 1 | 0.00 |
| train_175951_eval_184947 | cuda_mlp_residual_h128_h64_h32 | 2.741 / 9.801 / 14.118 / 49.855 | -0.565 / 0.510 / -1.068 / 5.757 | 911 | 460 | 279 | 16,930 | 1.37 |
| train_175951_eval_184947 | cuda_mlp_residual_h128_h64_h32_guarded | 3.290 / 9.296 / 15.155 / 44.222 | -0.016 / 0.005 / -0.031 / 0.125 | 0 | 0 | 0 | 16,930 | 1.37 |
| train_175951_eval_184947 | cuda_gru_residual_seq8_h64 | 2.745 / 9.751 / 14.060 / 49.680 | -0.561 / 0.460 / -1.125 / 5.582 | 878 | 447 | 262 | 28,258 | 1.24 |
| train_175951_eval_184947 | cuda_gru_residual_seq8_h64_guarded | 3.294 / 9.296 / 15.155 / 44.221 | -0.012 / 0.005 / -0.030 / 0.124 | 0 | 0 | 0 | 28,258 | 1.24 |
| train_175951_eval_184947 | cuda_tcn_residual_seq8_c32 | 2.764 / 9.730 / 13.806 / 49.467 | -0.543 / 0.439 / -1.380 / 5.369 | 872 | 421 | 242 | 28,866 | 1.90 |
| train_175951_eval_184947 | cuda_tcn_residual_seq8_c32_guarded | 3.289 / 9.296 / 15.154 / 44.222 | -0.017 / 0.005 / -0.032 / 0.124 | 0 | 0 | 0 | 28,866 | 1.90 |
| train_184947_eval_175951 | current_dwm_aware_last2_gain_0_75 | 1.285 / 7.262 / 5.251 / 20.866 | 0.000 / 0.000 / 0.000 / 0.000 | 0 | 0 | 0 | 1 | 0.00 |
| train_184947_eval_175951 | cuda_mlp_residual_h128_h64_h32 | 1.233 / 7.544 / 3.304 / 18.753 | -0.051 / 0.283 / -1.947 / -2.113 | 531 | 108 | 73 | 16,930 | 0.71 |
| train_184947_eval_175951 | cuda_mlp_residual_h128_h64_h32_guarded | 1.342 / 7.262 / 5.217 / 20.866 | 0.058 / 0.000 / -0.034 / 0.000 | 0 | 0 | 0 | 16,930 | 0.71 |
| train_184947_eval_175951 | cuda_gru_residual_seq8_h64 | 1.194 / 7.543 / 3.192 / 18.341 | -0.090 / 0.282 / -2.060 / -2.525 | 543 | 105 | 70 | 28,258 | 1.22 |
| train_184947_eval_175951 | cuda_gru_residual_seq8_h64_guarded | 1.314 / 7.263 / 5.219 / 20.863 | 0.029 / 0.002 / -0.032 / -0.003 | 0 | 0 | 0 | 28,258 | 1.22 |
| train_184947_eval_175951 | cuda_tcn_residual_seq8_c32 | 1.335 / 7.614 / 4.998 / 18.782 | 0.050 / 0.352 / -0.253 / -2.084 | 700 | 312 | 270 | 28,866 | 2.02 |
| train_184947_eval_175951 | cuda_tcn_residual_seq8_c32_guarded | 1.314 / 7.263 / 5.208 / 20.864 | 0.029 / 0.001 / -0.044 / -0.001 | 0 | 0 | 0 | 28,866 | 2.02 |

## Aggregate

| model | delta mean | delta rmse | delta p95 | delta p99 | total >1 worse | total >3 worse | total >5 worse | product relevance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current_dwm_aware_last2_gain_0_75 | 0.000 | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 | passes required zero >5px and small-regression screen in this two-session test |
| cuda_gru_residual_seq8_h64_guarded | 0.009 | 0.004 | -0.031 | 0.061 | 0 | 0 | 0 | passes required zero >5px and small-regression screen in this two-session test |
| cuda_tcn_residual_seq8_c32_guarded | 0.006 | 0.003 | -0.038 | 0.061 | 0 | 0 | 0 | passes required zero >5px and small-regression screen in this two-session test |
| cuda_mlp_residual_h128_h64_h32_guarded | 0.021 | 0.003 | -0.033 | 0.062 | 0 | 0 | 0 | passes required zero >5px and small-regression screen in this two-session test |
| cuda_gru_residual_seq8_h64 | -0.326 | 0.371 | -1.593 | 1.528 | 1,421 | 552 | 332 | teacher-only / not directly shippable because held-out >5px regressions occur |
| cuda_mlp_residual_h128_h64_h32 | -0.308 | 0.396 | -1.507 | 1.822 | 1,442 | 568 | 352 | teacher-only / not directly shippable because held-out >5px regressions occur |
| cuda_tcn_residual_seq8_c32 | -0.246 | 0.396 | -0.816 | 1.643 | 1,572 | 733 | 512 | teacher-only / not directly shippable because held-out >5px regressions occur |

## Validation-Selected Caps

| fold | guarded model | cap px | validation delta mean/p95/p99 | validation >1 worse | validation >3 worse | validation >5 worse |
| --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | cuda_mlp_residual_h128_h64_h32_guarded | 0.125 | 0.017 / -0.071 / -0.008 | 0 | 0 | 0 |
| train_175951_eval_184947 | cuda_gru_residual_seq8_h64_guarded | 0.125 | 0.011 / -0.065 / -0.002 | 0 | 0 | 0 |
| train_175951_eval_184947 | cuda_tcn_residual_seq8_c32_guarded | 0.125 | 0.022 / -0.071 / -0.010 | 0 | 0 | 0 |
| train_184947_eval_175951 | cuda_mlp_residual_h128_h64_h32_guarded | 0.125 | 0.005 / 0.120 / 0.125 | 0 | 0 | 0 |
| train_184947_eval_175951 | cuda_gru_residual_seq8_h64_guarded | 0.125 | -0.017 / 0.121 / 0.087 | 0 | 0 | 0 |
| train_184947_eval_175951 | cuda_tcn_residual_seq8_c32_guarded | 0.125 | -0.009 / 0.117 / 0.108 | 0 | 0 | 0 |

## Phase 7 Comparison

| source | model | mean delta p99 | total >1 worse | total >3 worse | total >5 worse |
| --- | --- | --- | --- | --- | --- |
| Phase 7 best | tiny_tcn_residual_guarded_seq8 | -0.386 | 1,282 | 0 | 0 |
| Phase 8 selected | current_dwm_aware_last2_gain_0_75 | 0.000 | 0 | 0 | 0 |

## Training Cost

| fold | model | params | epochs | seconds | early stop | reason |
| --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | cuda_mlp_residual_h128_h64_h32 | 16,930 | 38 / 72 | 1.37 | yes | Validation loss did not improve for 12 epochs. |
| train_175951_eval_184947 | cuda_mlp_residual_h128_h64_h32_guarded | 16,930 | 38 / 72 | 1.37 | yes | Validation loss did not improve for 12 epochs. |
| train_175951_eval_184947 | cuda_gru_residual_seq8_h64 | 28,258 | 21 / 72 | 1.24 | yes | Validation loss did not improve for 12 epochs. |
| train_175951_eval_184947 | cuda_gru_residual_seq8_h64_guarded | 28,258 | 21 / 72 | 1.24 | yes | Validation loss did not improve for 12 epochs. |
| train_175951_eval_184947 | cuda_tcn_residual_seq8_c32 | 28,866 | 19 / 72 | 1.90 | yes | Validation loss did not improve for 12 epochs. |
| train_175951_eval_184947 | cuda_tcn_residual_seq8_c32_guarded | 28,866 | 19 / 72 | 1.90 | yes | Validation loss did not improve for 12 epochs. |
| train_184947_eval_175951 | cuda_mlp_residual_h128_h64_h32 | 16,930 | 28 / 72 | 0.71 | yes | Validation loss did not improve for 12 epochs. |
| train_184947_eval_175951 | cuda_mlp_residual_h128_h64_h32_guarded | 16,930 | 28 / 72 | 0.71 | yes | Validation loss did not improve for 12 epochs. |
| train_184947_eval_175951 | cuda_gru_residual_seq8_h64 | 28,258 | 26 / 72 | 1.22 | yes | Validation loss did not improve for 12 epochs. |
| train_184947_eval_175951 | cuda_gru_residual_seq8_h64_guarded | 28,258 | 26 / 72 | 1.22 | yes | Validation loss did not improve for 12 epochs. |
| train_184947_eval_175951 | cuda_tcn_residual_seq8_c32 | 28,866 | 27 / 72 | 2.02 | yes | Validation loss did not improve for 12 epochs. |
| train_184947_eval_175951 | cuda_tcn_residual_seq8_c32_guarded | 28,866 | 27 / 72 | 2.02 | yes | Validation loss did not improve for 12 epochs. |

## Speed-Bin Breakdown For Best CUDA Teacher

| fold | speed bin | n | mean | p95 | p99 | >1 worse | >3 worse | >5 worse |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | 0-25 px/s | 4,480 | 0.242 | 0.125 | 1.979 | 0 | 0 | 0 |
| train_175951_eval_184947 | 25-100 px/s | 677 | 0.232 | 0.994 | 2.741 | 0 | 0 | 0 |
| train_175951_eval_184947 | 100-250 px/s | 964 | 0.661 | 2.995 | 6.944 | 0 | 0 | 0 |
| train_175951_eval_184947 | 250-500 px/s | 911 | 1.121 | 4.766 | 10.312 | 0 | 0 | 0 |
| train_175951_eval_184947 | 500-1000 px/s | 1,207 | 2.084 | 8.014 | 12.938 | 0 | 0 | 0 |
| train_175951_eval_184947 | 1000-2000 px/s | 1,433 | 4.062 | 14.494 | 23.005 | 0 | 0 | 0 |
| train_175951_eval_184947 | >=2000 px/s | 2,238 | 12.511 | 43.864 | 80.708 | 0 | 0 | 0 |
| train_184947_eval_175951 | 0-25 px/s | 9,323 | 0.217 | 0.125 | 1.075 | 0 | 0 | 0 |
| train_184947_eval_175951 | 25-100 px/s | 1,315 | 0.246 | 0.936 | 2.116 | 0 | 0 | 0 |
| train_184947_eval_175951 | 100-250 px/s | 1,346 | 0.551 | 1.940 | 4.938 | 0 | 0 | 0 |
| train_184947_eval_175951 | 250-500 px/s | 996 | 1.465 | 3.988 | 11.516 | 0 | 0 | 0 |
| train_184947_eval_175951 | 500-1000 px/s | 985 | 2.061 | 6.934 | 15.288 | 0 | 0 | 0 |
| train_184947_eval_175951 | 1000-2000 px/s | 991 | 3.710 | 11.299 | 17.943 | 0 | 0 | 0 |
| train_184947_eval_175951 | >=2000 px/s | 872 | 12.096 | 40.592 | 92.972 | 0 | 0 | 0 |

## Recommendation

Category: `no material change`.

No CUDA model cleared the zero >5px plus p99-improvement screen.
