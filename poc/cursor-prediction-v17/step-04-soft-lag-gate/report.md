# Step 04 - Soft Lag Gate

## Scope

Step 04 keeps the v16 selected MLP weights fixed and searches runtime-safe soft lag gates. The gate scales lag compensation as `lag = 0.5 * factor`, using only recent velocity/path/prediction-capacity signals available at runtime. CPU fixed inference only; no GPU learning was run.

## Inputs

- Dataset rows: 90621
- Runtime descriptor: `poc\cursor-prediction-v16\runtime\selected-candidate.json`
- Base model: `mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5`
- Slice counts: `{'all': 90621, 'stopApproach': 1994, 'hardStopApproach': 645, 'postStopHold': 14353, 'directionFlip': 19}`

## Candidate Ranking

| candidate | kind | all mean | all p95 | all p99 | stop p95 | stop p99 | stop signed | stop over p95 | stop over p99 | over >1 | over >2 | hard over p95 | post jitter p95 | balanced | overshoot | visual |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fixed_lag0p0 | fixed_lag | 0.5849 | 1.8916 | 4.5434 | 13.3899 | 29.4379 | -1.4397 | 3.273 | 5.288 | 0.209127 | 0.106319 | 3.4468 | 0.375 | 4.815147 | 7.760385 | 3.441705 |
| fixed_lag0p0625 | fixed_lag | 0.5997 | 1.8844 | 4.5398 | 13.3274 | 29.3757 | -1.3772 | 3.3355 | 5.3505 | 0.218154 | 0.110832 | 3.5093 | 0.4235 | 4.925512 | 7.906632 | 3.56075 |
| fixed_lag0p125 | fixed_lag | 0.6178 | 1.8792 | 4.4878 | 13.265 | 29.3135 | -1.3147 | 3.398 | 5.413 | 0.225677 | 0.117352 | 3.5718 | 0.4507 | 5.027347 | 8.054888 | 3.65874 |
| fixed_lag0p25 | fixed_lag | 0.6672 | 1.8792 | 4.4299 | 13.1527 | 29.1892 | -1.1897 | 3.523 | 5.538 | 0.247242 | 0.124875 | 3.6968 | 0.5245 | 5.238993 | 8.349692 | 3.87321 |
| fixed_lag0p375 | fixed_lag | 0.7262 | 1.8792 | 4.377 | 13.0352 | 29.0649 | -1.0647 | 3.648 | 5.663 | 0.269308 | 0.136409 | 3.8218 | 0.6374 | 5.473498 | 8.654123 | 4.11761 |
| soft_capacity_min0 | soft_lag_gate | 0.7748 | 1.8847 | 4.3421 | 13.1197 | 29.2395 | -1.0495 | 3.6294 | 5.5138 | 0.281846 | 0.141926 | 3.8679 | 0.7122 | 5.476623 | 8.643161 | 4.21325 |
| soft_capacity_min0125 | soft_lag_gate | 0.7748 | 1.8847 | 4.3421 | 13.1197 | 29.2395 | -1.0495 | 3.6294 | 5.5138 | 0.281846 | 0.141926 | 3.8679 | 0.7122 | 5.476623 | 8.643161 | 4.21325 |
| near_stop_zero_else_capacity | soft_lag_gate | 0.7748 | 1.8847 | 4.3421 | 13.1197 | 29.2395 | -1.0495 | 3.6294 | 5.5138 | 0.281846 | 0.141926 | 3.8679 | 0.7122 | 5.476623 | 8.643161 | 4.21325 |
| soft_base_min0 | soft_lag_gate | 0.7813 | 1.8916 | 4.3632 | 13.0707 | 29.2049 | -1.0713 | 3.6686 | 5.5996 | 0.269809 | 0.140923 | 3.8586 | 0.75 | 5.537956 | 8.685345 | 4.29159 |
| soft_base_min0125 | soft_lag_gate | 0.7813 | 1.8916 | 4.3632 | 13.0707 | 29.2049 | -1.0713 | 3.6686 | 5.5996 | 0.269809 | 0.140923 | 3.8586 | 0.75 | 5.537956 | 8.685345 | 4.29159 |
| gentle_capacity_50pct | soft_lag_gate | 0.7827 | 1.8911 | 4.3646 | 13.0525 | 29.0951 | -0.9946 | 3.6877 | 5.6397 | 0.292377 | 0.148445 | 3.923 | 0.7308 | 5.585773 | 8.809777 | 4.28901 |
| soft_hold_min0 | soft_lag_gate | 0.7797 | 1.8916 | 4.3629 | 13.0272 | 29.0637 | -0.9989 | 3.7251 | 5.6945 | 0.287362 | 0.147442 | 3.9204 | 0.719 | 5.623106 | 8.854567 | 4.30738 |
| soft_hold_min00625 | soft_lag_gate | 0.7797 | 1.8916 | 4.3629 | 13.0272 | 29.0637 | -0.9989 | 3.7251 | 5.6945 | 0.287362 | 0.147442 | 3.9204 | 0.719 | 5.623106 | 8.854567 | 4.30738 |
| movement_keep_hold_drop | soft_lag_gate | 0.7799 | 1.8916 | 4.3629 | 13.0272 | 29.0637 | -0.99 | 3.7251 | 5.6945 | 0.290371 | 0.147944 | 3.9263 | 0.719 | 5.626417 | 8.864025 | 4.30915 |
| gentle_hold_50pct | soft_lag_gate | 0.7852 | 1.8953 | 4.3629 | 12.9695 | 29.0021 | -0.9693 | 3.7339 | 5.7333 | 0.293882 | 0.151454 | 3.9234 | 0.7325 | 5.656424 | 8.898005 | 4.32618 |
| v16_selected_fixed_lag0p5 | fixed_lag | 0.7909 | 1.8975 | 4.3629 | 12.9103 | 29.0009 | -0.9397 | 3.773 | 5.788 | 0.2999 | 0.153962 | 3.9468 | 0.7563 | 5.725599 | 8.985436 | 4.37655 |
| soft_capacity_min0125_mild_clamp16ms | soft_lag_plus_mild_along_clamp | 0.8078 | 1.9209 | 5.5052 | 16.298 | 31.6076 | -1.7517 | 2.0879 | 3.5906 | 0.19659 | 0.058175 | 2.6233 | 0.7122 | 11.495971 | 9.498269 | 5.800025 |
| soft_base_min0125_mild_clamp16ms | soft_lag_plus_mild_along_clamp | 0.8145 | 1.9566 | 5.507 | 16.298 | 31.6076 | -1.7865 | 2.0929 | 3.5906 | 0.184052 | 0.058175 | 2.6195 | 0.75 | 11.508857 | 9.480928 | 5.861515 |

## Package Stop-Approach Breakdown

| candidate | package | stop p95 | stop p99 | signed mean | overshoot p95 | overshoot p99 | overshoot >1 | overshoot >2 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v16_selected_fixed_lag0p5 | m070248 | 12.655 | 28.4056 | -1.0652 | 3.5986 | 5.4417 | 0.283105 | 0.140639 |
| v16_selected_fixed_lag0p5 | m070307 | 13.9386 | 28.9869 | -0.7867 | 4.3027 | 5.9474 | 0.320356 | 0.170189 |
| fixed_lag0p0 | m070248 | 13.146 | 28.9041 | -1.5652 | 3.0986 | 4.9417 | 0.187215 | 0.097717 |
| fixed_lag0p0 | m070307 | 14.4282 | 29.4205 | -1.2867 | 3.8027 | 5.4474 | 0.235818 | 0.116796 |

## Recommendation

Recommended Step 4 candidate: `fixed_lag0p0`.

- Formula: `factor = 0.000`
- Runtime notes: `{'kind': 'fixed_lag', 'formula': 'factor = 0.000', 'clamp': None, 'productSafe': True, 'state': 'stateless', 'allocationRisk': 'none; scalar arithmetic and fixed arrays only', 'extraBranchesEstimate': 0}`
- Summary: `{'allMean': 0.5849, 'allP95': 1.8916, 'allP99': 4.5434, 'stopP95': 13.3899, 'stopP99': 29.4379, 'stopSignedMean': -1.4397, 'stopOvershootP95': 3.273, 'stopOvershootP99': 5.288, 'stopOvershootGt1': 0.209127, 'stopOvershootGt2': 0.106319, 'hardStopP95': 16.5429, 'hardStopP99': 28.7619, 'hardStopSignedMean': -1.9299, 'hardStopOvershootP95': 3.4468, 'hardStopOvershootP99': 5.7633, 'hardStopOvershootGt1': 0.234109, 'hardStopOvershootGt2': 0.128682, 'postStopJitterP95': 0.375, 'postStopJitterP99': 1.1319, 'directionFlipPenaltyP95': 25.2779, 'directionFlipRows': 19}`

## Interpretation

fixed_lag0p0 is recommended. Versus v16 fixed lag0.5, stop overshoot p95 changes -0.5px and post-stop jitter p95 changes -0.3813px. Versus lag0, stop p95 changes 0.0px and stop p99 changes 0.0px.

## Product Implementation Sketch

The selected candidate disables lag compensation:

```csharp
const float lagFactor = 0f;
// Keep the MLP output and q0.125 output quantization, but do not add the lag-direction offset.
// prediction += lagDirection * (0.5f * lagFactor);
```

This is allocation-free, stateless, and removes the v16 `lag0.5` branch entirely. If a nonzero fallback is desired for visual tuning, `fixed_lag0p0625` is the nearest low-risk alternative, but it had worse overshoot and jitter than `lag0` in this run.
