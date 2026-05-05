# Step 03 Report - Central-Weighted MLP

## Summary

Step 03 tests whether the MLP failed because the training distribution was dominated by outer hold-like target-correction buckets. It trains residual CV2 models with central/accepted/moving weighting.

| candidate | central visual p95 | central visual p99 | central stop lead p99 | overall visual p95 | jitter p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| cv2_static_guard | 2.395489 | 6.391241 | 1.703025 | 1.696106 | 0.000000 |
| residual_cv2_central_accepted_moving_h16_mse_static_guard | 4.090400 | 11.350160 | 3.085961 | 1.855936 | 0.000000 |
| residual_cv2_central_weight4_accepted_moving_h16_mse_static_guard | 4.220209 | 11.396686 | 3.160238 | 1.781951 | 0.000000 |
| residual_cv2_accepted_moving_h16_mse_static_guard | 4.281599 | 11.220018 | 2.994602 | 1.865267 | 0.000000 |
| residual_cv2_central_weight8_stop_weight4_h32_mse_static_guard | 4.378838 | 11.927237 | 1.505115 | 2.531587 | 0.000000 |
| residual_cv2_central_weight8_stop_weight4_h16_mse_static_guard | 4.399592 | 11.732305 | 2.331550 | 2.063635 | 0.000000 |
| residual_cv2_central_weight4_accepted_moving_h32_asym4_static_guard | 4.523618 | 13.283741 | 2.486043 | 2.439590 | 0.000000 |
| residual_cv2_central_weight8_stop_weight4_h64_mse_static_guard | 4.693909 | 12.817755 | 2.146045 | 2.279827 | 0.000000 |
| residual_cv2_central_weight4_accepted_moving_h32_mse_static_guard | 4.776513 | 12.316918 | 3.554234 | 2.092837 | 0.000000 |
| residual_cv2_accepted_moving_h64_mse_static_guard | 4.906062 | 13.379872 | 3.408016 | 2.420157 | 0.000000 |
| residual_cv2_accepted_moving_h32_mse_static_guard | 4.927996 | 13.471425 | 3.520828 | 1.943776 | 0.000000 |
| residual_cv2_central_weight8_stop_weight4_h64_asym4_static_guard | 4.957767 | 13.780055 | 2.034024 | 2.728421 | 0.000000 |
| residual_cv2_central_accepted_moving_h64_mse_static_guard | 4.966964 | 14.082177 | 3.269544 | 2.694483 | 0.000000 |
| residual_cv2_central_accepted_moving_h32_mse_static_guard | 4.967611 | 11.555226 | 3.384012 | 2.036225 | 0.000000 |
| residual_cv2_central_weight4_accepted_moving_h64_asym4_static_guard | 5.086306 | 12.719923 | 2.926804 | 2.292879 | 0.000000 |
| residual_cv2_central_weight8_stop_weight4_h32_asym4_static_guard | 5.229835 | 14.145273 | 1.193644 | 2.991273 | 0.000000 |
| residual_cv2_central_accepted_moving_h32_asym4_static_guard | 5.241116 | 13.898600 | 3.313787 | 2.398612 | 0.000000 |
| residual_cv2_accepted_moving_h32_asym4_static_guard | 5.255421 | 13.650750 | 2.876640 | 2.138946 | 0.000000 |
| residual_cv2_central_weight4_accepted_moving_h64_mse_static_guard | 5.329264 | 13.856953 | 3.354015 | 2.470993 | 0.000000 |
| residual_cv2_central_accepted_moving_h64_asym4_static_guard | 5.358623 | 13.121106 | 3.012708 | 2.709906 | 0.000000 |
| residual_cv2_accepted_moving_h64_asym4_static_guard | 5.561323 | 13.618346 | 2.271451 | 2.709056 | 0.000000 |

## Decision

If a central-weighted learned residual cannot beat `cv2_static_guard` on central visual p95, the next direction should be product-faithful timing/least-squares replay or sequence-level labels, not a larger feed-forward MLP alone.
