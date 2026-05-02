# Phase 7 - Deep Teacher

## Setup

GPU detected (NVIDIA GeForce RTX 5090, 32607 MiB), but training used CPU-only dependency-free Node.js.

Python/PyTorch check: plain python was not found on PATH. UV no-download probe: uv could not find a local interpreter with downloads disabled. PyTorch/CUDA was not checked because no local Python interpreter was available

The script used only Node.js standard-library APIs. Models were trained on the first 70% chronological block of the train session, selected on the last 30% block of that same session, then evaluated on the other full session.

Runtime was kept to one Node process. Timings below are approximate CPU training timings on the shared workstation.

## Prior Phase Context

| phase | selected / finding | summary |
| --- | --- | --- |
| Phase 3 | current_dwm_aware_last2_gain_0_75 | Deterministic variants did not materially beat the current baseline under the visible-regression guard. |
| Phase 4 | mlp_residual_guarded_h32 | guarded learned teacher p99 delta -0.422 px; >1/>3/>5 worse 3,353/1,392/0. |
| Phase 5 | safe_ridge_residual_guarded | strict distilled candidate p99 delta -0.027 px, mean delta 0.081 px, zero >1/>3/>5 regressions. |
| Phase 6 | runtime acceptable | Runtime proxy was acceptable; confidence/accuracy remained the blocker. |

## Dataset And Features

Dataset rows: 27,738 across sessions 175951: 15,828, 184947: 11,910.

Included causal scalar features: anchor position, previous two anchor positions through deltas/masks, dt and previous dt, current velocity, previous velocity, derived acceleration offsets, target horizon, DWM availability, scheduler lead, speed/horizon/lead bins.

Included causal sequence features for the TCN: 8-step masked history ending at the current anchor, with age, dt, relative position, step deltas, and step velocity/speed. Training included 25.0% missing-history augmentation by masking older history steps.

Excluded from features: label coordinates, target reference indices, reference interval, reference nearest distance, source ZIP, session ID, and any future reference-poll fields.

## Held-Out Cross-Session Results

| fold | model | held-out mean/rmse/p95/p99 | delta mean/rmse/p95/p99 | >1px worse | >3px worse | >5px worse |
| --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | current_dwm_aware_last2_gain_0_75 | 3.306 / 9.291 / 15.186 / 44.097 | 0.000 / 0.000 / 0.000 / 0.000 | 0 | 0 | 0 |
| train_175951_eval_184947 | deep_mlp_residual_h64_h32 | 4.260 / 12.699 / 19.159 / 58.370 | 0.954 / 3.409 / 3.973 / 14.273 | 1,955 | 887 | 566 |
| train_175951_eval_184947 | deep_mlp_residual_guarded_h64_h32 | 3.353 / 9.291 / 15.239 / 44.034 | 0.046 / 0.001 / 0.053 / -0.064 | 0 | 0 | 0 |
| train_175951_eval_184947 | tiny_tcn_residual_seq8 | 4.196 / 12.111 / 19.354 / 53.670 | 0.890 / 2.820 / 4.168 / 9.573 | 2,049 | 818 | 531 |
| train_175951_eval_184947 | tiny_tcn_residual_guarded_seq8 | 3.357 / 9.291 / 15.166 / 44.142 | 0.051 / -0.000 / -0.020 / 0.044 | 0 | 0 | 0 |
| train_184947_eval_175951 | current_dwm_aware_last2_gain_0_75 | 1.285 / 7.262 / 5.251 / 20.866 | 0.000 / 0.000 / 0.000 / 0.000 | 0 | 0 | 0 |
| train_184947_eval_175951 | deep_mlp_residual_h64_h32 | 5.428 / 17.790 / 60.275 / 71.817 | 4.143 / 10.529 / 55.024 / 50.951 | 3,440 | 1,487 | 1,153 |
| train_184947_eval_175951 | deep_mlp_residual_guarded_h64_h32 | 2.031 / 7.421 / 6.397 / 20.299 | 0.746 / 0.159 / 1.146 / -0.567 | 3,359 | 1,332 | 0 |
| train_184947_eval_175951 | tiny_tcn_residual_seq8 | 9.532 / 26.093 / 71.163 / 115.139 | 8.247 / 18.831 / 65.912 / 94.273 | 4,838 | 3,355 | 2,973 |
| train_184947_eval_175951 | tiny_tcn_residual_guarded_seq8 | 1.690 / 7.289 / 5.412 / 20.050 | 0.405 / 0.027 / 0.161 / -0.816 | 1,282 | 0 | 0 |

## Aggregate

| model | mean delta mean | mean delta rmse | mean delta p95 | mean delta p99 | total >1px worse | total >3px worse | total >5px worse | product relevance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tiny_tcn_residual_guarded_seq8 | 0.228 | 0.014 | 0.070 | -0.386 | 1,282 | 0 | 0 | teacher-only unless distilled/gated; zero >5px but broad small regressions remain |
| deep_mlp_residual_guarded_h64_h32 | 0.396 | 0.080 | 0.600 | -0.315 | 3,359 | 1,332 | 0 | teacher-only unless distilled/gated; zero >5px but broad small regressions remain |
| current_dwm_aware_last2_gain_0_75 | 0.000 | 0.000 | 0.000 | 0.000 | 0 | 0 | 0 | passes required zero >5px and small-regression screen in this two-session test |
| deep_mlp_residual_h64_h32 | 2.549 | 6.969 | 29.498 | 32.612 | 5,395 | 2,374 | 1,719 | teacher-only / not directly shippable because held-out >5px regressions occur |
| tiny_tcn_residual_seq8 | 4.568 | 10.826 | 35.040 | 51.923 | 6,887 | 4,173 | 3,504 | teacher-only / not directly shippable because held-out >5px regressions occur |

## Training Cost

| fold | model | params | epochs | seconds | early stop |
| --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | deep_mlp_residual_h64_h32 | 5,282 | 70 / 70 | 12.38 |  |
| train_175951_eval_184947 | deep_mlp_residual_guarded_h64_h32 | 5,282 | 70 / 70 | 12.38 |  |
| train_175951_eval_184947 | tiny_tcn_residual_seq8 | 3,154 | 55 / 55 | 15.31 |  |
| train_175951_eval_184947 | tiny_tcn_residual_guarded_seq8 | 3,154 | 55 / 55 | 15.31 |  |
| train_184947_eval_175951 | deep_mlp_residual_h64_h32 | 5,282 | 70 / 70 | 11.59 |  |
| train_184947_eval_175951 | deep_mlp_residual_guarded_h64_h32 | 5,282 | 70 / 70 | 11.59 |  |
| train_184947_eval_175951 | tiny_tcn_residual_seq8 | 3,154 | 55 / 55 | 22.52 |  |
| train_184947_eval_175951 | tiny_tcn_residual_guarded_seq8 | 3,154 | 55 / 55 | 22.52 |  |

## Overfitting Check

| fold | model checked | fit mean/p99 | validation mean/p99 | held-out mean/p99 | held-out >5px worse |
| --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | tiny_tcn_residual_guarded_seq8 | 1.053 / 14.479 | 2.076 / 32.403 | 3.357 / 44.142 | 0 |
| train_184947_eval_175951 | tiny_tcn_residual_guarded_seq8 | 3.230 / 39.958 | 4.279 / 48.236 | 1.690 / 20.050 | 0 |

## Speed-Bin Breakdown For Best Deep Teacher

| fold | speed bin | n | mean | p95 | p99 | >1 worse | >3 worse | >5 worse |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| train_175951_eval_184947 | >=2000 px/s | 2,238 | 12.580 | 43.860 | 80.704 | 0 | 0 | 0 |
| train_175951_eval_184947 | 0-25 px/s | 4,480 | 0.308 | 0.125 | 1.959 | 0 | 0 | 0 |
| train_175951_eval_184947 | 100-250 px/s | 964 | 0.703 | 2.978 | 7.066 | 0 | 0 | 0 |
| train_175951_eval_184947 | 1000-2000 px/s | 1,433 | 4.127 | 14.269 | 22.913 | 0 | 0 | 0 |
| train_175951_eval_184947 | 25-100 px/s | 677 | 0.290 | 1.007 | 2.771 | 0 | 0 | 0 |
| train_175951_eval_184947 | 250-500 px/s | 911 | 1.182 | 4.706 | 10.299 | 0 | 0 | 0 |
| train_175951_eval_184947 | 500-1000 px/s | 1,207 | 2.145 | 7.852 | 12.750 | 0 | 0 | 0 |
| train_184947_eval_175951 | >=2000 px/s | 872 | 12.290 | 40.482 | 93.823 | 0 | 0 | 0 |
| train_184947_eval_175951 | 0-25 px/s | 9,323 | 0.631 | 1.000 | 1.477 | 1,282 | 0 | 0 |
| train_184947_eval_175951 | 100-250 px/s | 1,346 | 0.906 | 2.054 | 4.708 | 0 | 0 | 0 |
| train_184947_eval_175951 | 1000-2000 px/s | 991 | 4.000 | 10.784 | 17.592 | 0 | 0 | 0 |
| train_184947_eval_175951 | 25-100 px/s | 1,315 | 0.679 | 1.178 | 2.413 | 0 | 0 | 0 |
| train_184947_eval_175951 | 250-500 px/s | 996 | 1.757 | 3.892 | 11.715 | 0 | 0 | 0 |
| train_184947_eval_175951 | 500-1000 px/s | 985 | 2.351 | 6.635 | 14.457 | 0 | 0 | 0 |

## Recommendation

Selected by the Phase 7 rule: `tiny_tcn_residual_guarded_seq8`.

`tiny_tcn_residual_guarded_seq8` clears the required zero >5 px guard and shows a material p99 signal, but its >1/>3 px regressions make it teacher-only rather than directly shippable.

Deep learning does reveal a p99 teacher signal worth distilling, but only if the small-regression profile is acceptable.
