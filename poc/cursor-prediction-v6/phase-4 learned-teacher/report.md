# Phase 4 - Learned Teacher

## Setup

GPU detected (NVIDIA GeForce RTX 5090, 32607 MiB), but training used CPU-only dependency-free Node.js.

The script used only Node.js standard-library APIs. Models were trained on the first 70% chronological block of the train session, selected on the last 30% block of that same session, then evaluated on the other full session.

## Dataset And Features

Dataset rows: 27,738 across sessions 175951: 15,828, 184947: 11,910.

Included causal features: anchor position, previous two anchor positions through deltas/masks, dt and previous dt, current velocity, previous velocity, derived acceleration offsets, target horizon, DWM availability, scheduler lead, speed/horizon/lead bins.

Excluded from features: label coordinates, target reference indices, reference interval, reference nearest distance, source ZIP, session ID, and any future reference-poll fields.

## Held-Out Cross-Session Results

| fold | model | held-out mean/p95/p99 | delta mean/p95/p99 | >1px worse | >3px worse | >5px worse |
| --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | current_dwm_aware_last2_gain_0_75 | 3.306 / 15.186 / 44.097 | 0.000 / 0.000 / 0.000 | 0 | 0 | 0 |
| train_175951_eval_184947 | ridge_direct | 3.769 / 17.340 / 45.051 | 0.463 / 2.154 / 0.954 | 1,790 | 705 | 367 |
| train_175951_eval_184947 | ridge_residual | 3.771 / 17.345 / 45.049 | 0.465 / 2.159 / 0.952 | 1,791 | 706 | 368 |
| train_175951_eval_184947 | ridge_residual_guarded | 3.380 / 15.264 / 44.086 | 0.074 / 0.078 / -0.011 | 0 | 0 | 0 |
| train_175951_eval_184947 | mlp_direct_h32 | 4.200 / 19.189 / 52.722 | 0.894 / 4.003 / 8.624 | 2,573 | 884 | 526 |
| train_175951_eval_184947 | mlp_residual_h32 | 4.152 / 19.283 / 53.474 | 0.846 / 4.097 / 9.377 | 2,332 | 856 | 525 |
| train_175951_eval_184947 | mlp_residual_guarded_h32 | 3.397 / 15.200 / 44.104 | 0.091 / 0.014 / 0.007 | 0 | 0 | 0 |
| train_184947_eval_175951 | current_dwm_aware_last2_gain_0_75 | 1.285 / 5.251 / 20.866 | 0.000 / 0.000 / 0.000 | 0 | 0 | 0 |
| train_184947_eval_175951 | ridge_direct | 3.286 / 29.516 / 43.228 | 2.002 / 24.265 / 22.362 | 1,252 | 907 | 812 |
| train_184947_eval_175951 | ridge_residual | 3.278 / 29.529 / 42.955 | 1.994 / 24.278 / 22.089 | 1,243 | 906 | 812 |
| train_184947_eval_175951 | ridge_residual_guarded | 1.488 / 5.268 / 20.642 | 0.203 / 0.017 / -0.223 | 392 | 0 | 0 |
| train_184947_eval_175951 | mlp_direct_h32 | 6.287 / 40.810 / 127.744 | 5.002 / 35.559 / 106.878 | 4,093 | 1,405 | 1,075 |
| train_184947_eval_175951 | mlp_residual_h32 | 8.456 / 110.466 / 137.827 | 7.171 / 105.215 / 116.961 | 2,961 | 1,363 | 1,016 |
| train_184947_eval_175951 | mlp_residual_guarded_h32 | 1.999 / 6.432 / 20.014 | 0.714 / 1.181 / -0.851 | 3,353 | 1,392 | 0 |

## Aggregate

| model | mean delta mean | mean delta p95 | mean delta p99 | total >1px worse | total >3px worse | total >5px worse |
| --- | --- | --- | --- | --- | --- | --- |
| mlp_residual_guarded_h32 | 0.403 | 0.597 | -0.422 | 3,353 | 1,392 | 0 |
| ridge_residual_guarded | 0.139 | 0.048 | -0.117 | 392 | 0 | 0 |
| current_dwm_aware_last2_gain_0_75 | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 |
| ridge_direct | 1.232 | 13.210 | 11.658 | 3,042 | 1,612 | 1,179 |
| ridge_residual | 1.229 | 13.218 | 11.521 | 3,034 | 1,612 | 1,180 |
| mlp_residual_h32 | 4.009 | 54.656 | 63.169 | 5,293 | 2,219 | 1,541 |
| mlp_direct_h32 | 2.948 | 19.781 | 57.751 | 6,666 | 2,289 | 1,601 |

## Overfitting Check

| fold | model checked | fit mean/p99 | validation mean/p99 | held-out mean/p99 | held-out >5px worse |
| --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | mlp_residual_guarded_h32 | 1.087 / 14.582 | 2.146 / 32.525 | 3.397 / 44.104 | 0 |
| train_184947_eval_175951 | mlp_residual_guarded_h32 | 3.310 / 37.735 | 4.534 / 47.537 | 1.999 / 20.014 | 0 |

## Speed-Bin Breakdown For Best Learned Model

| fold | speed bin | n | mean | p95 | p99 | >5px worse |
| --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | >=2000 px/s | 2,238 | 12.582 | 43.935 | 80.536 | 0 |
| train_175951_eval_184947 | 0-25 px/s | 4,480 | 0.371 | 0.250 | 1.941 | 0 |
| train_175951_eval_184947 | 100-250 px/s | 964 | 0.740 | 2.997 | 6.712 | 0 |
| train_175951_eval_184947 | 1000-2000 px/s | 1,433 | 4.151 | 14.281 | 22.946 | 0 |
| train_175951_eval_184947 | 25-100 px/s | 677 | 0.362 | 1.095 | 2.570 | 0 |
| train_175951_eval_184947 | 250-500 px/s | 911 | 1.218 | 4.540 | 9.976 | 0 |
| train_175951_eval_184947 | 500-1000 px/s | 1,207 | 2.172 | 7.707 | 12.617 | 0 |
| train_184947_eval_175951 | >=2000 px/s | 872 | 12.741 | 39.714 | 97.310 | 0 |
| train_184947_eval_175951 | 0-25 px/s | 9,323 | 0.921 | 4.500 | 4.500 | 0 |
| train_184947_eval_175951 | 100-250 px/s | 1,346 | 1.255 | 4.383 | 5.419 | 0 |
| train_184947_eval_175951 | 1000-2000 px/s | 991 | 4.512 | 10.913 | 17.216 | 0 |
| train_184947_eval_175951 | 25-100 px/s | 1,315 | 0.817 | 4.380 | 4.622 | 0 |
| train_184947_eval_175951 | 250-500 px/s | 996 | 2.108 | 4.859 | 12.186 | 0 |
| train_184947_eval_175951 | 500-1000 px/s | 985 | 2.653 | 7.092 | 13.684 | 0 |

## Recommendation

Selected by the conservative rule: `mlp_residual_guarded_h32`.

`mlp_residual_guarded_h32` clears the zero >5 px held-out regression guard and improves average held-out p99 by -0.422 px. This is enough promise to justify a small distillation follow-up, but the gain is modest and should be retested on more traces.
