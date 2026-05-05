# Phase 5 Runtime Shape

Feature contract: 12 history taps, 7 sequence channels, 103 normalized causal features.

| teacher               | family           | params | bytes f32 | MACs/pred | CPU  | SIMD notes                                                         |
| --------------------- | ---------------- | ------ | --------- | --------- | ---- | ------------------------------------------------------------------ |
| linear_ridge_residual | linear_ridge     | 208    | 832       | 206       | high | excellent contiguous dot products                                  |
| fsmn_lite_ridge       | FSMN-lite        | 110    | 440       | 150       | high | excellent fixed tap reductions plus dot products                   |
| csfsmn_lite_ridge     | CSFSMN-lite      | 134    | 536       | 186       | high | excellent compact memory state and shared taps                     |
| tcn_small_ridge       | 1D-CNN/TCN-small | 142    | 568       | 420       | high | good fixed kernels over short history                              |
| rfn_rbf_48_ridge      | RFN/RBF-ridge    | 182    | 728       | 2196      | high | good random projection plus sin/cos                                |
| mlp_small_ridge       | MLP-small        | 150    | 600       | 1492      | high | fair dense hidden layer; batch SIMD recommended                    |
| mlp_medium_ridge      | MLP-medium       | 214    | 856       | 2900      | high | fair larger dense hidden layer; still CPU-only viable at 64 hidden |

## Product candidate order

| teacher               | family           | strict mean | >5/>10 | params | MACs/pred | CPU  |
| --------------------- | ---------------- | ----------- | ------ | ------ | --------- | ---- |
| linear_ridge_residual | linear_ridge     | 11.877      | 0/0    | 208    | 206       | high |
| fsmn_lite_ridge       | FSMN-lite        | 11.878      | 0/0    | 110    | 150       | high |
| tcn_small_ridge       | 1D-CNN/TCN-small | 11.880      | 1/0    | 142    | 420       | high |
| rfn_rbf_48_ridge      | RFN/RBF-ridge    | 11.896      | 2/0    | 182    | 2196      | high |
| mlp_small_ridge       | MLP-small        | 11.896      | 0/0    | 150    | 1492      | high |
| mlp_medium_ridge      | MLP-medium       | 11.899      | 0/0    | 214    | 2900      | high |
| csfsmn_lite_ridge     | CSFSMN-lite      | 11.979      | 0/0    | 134    | 186       | high |

All product candidates are described as CPU-only. GPU was not used for training or evaluation in this run.
