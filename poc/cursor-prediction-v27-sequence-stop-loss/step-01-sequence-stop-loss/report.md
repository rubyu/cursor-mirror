# Step 01 Report - Sequence Stop Loss

## Summary

This step uses procedural sudden-stop scenarios and sequence-level metrics. The goal is to avoid selecting a model that only improves row-level error while still visibly passing the real cursor during abrupt deceleration.

## Dataset

- train sequences: 260
- validation sequences: 80
- test sequences: 100
- feature rows: 322880
- horizons per runtime sample: 5

## Best Test Candidates By Sequence Visual Error

| candidate | sequence visual p95 | overshoot max p95 | overshoot duration p95 ms | jitter p95 | row visual p95 | MACs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| direct_sequence_stop_h64 | 36.588033 | 12.763918 | 182.658769 | 1.303230 | 14.022263 | 1728 |
| direct_row_mse_h32 | 36.643263 | 13.038369 | 383.040881 | 2.488996 | 14.148623 | 864 |
| residual_cv2_sequence_stop_h64 | 36.921923 | 12.477466 | 233.531179 | 2.305568 | 13.756554 | 1730 |
| residual_cv2_row_mse_h32 | 37.373644 | 13.773512 | 316.638599 | 2.604307 | 14.256259 | 866 |
| residual_cv2_sequence_stop_h32 | 38.031223 | 12.462885 | 232.988720 | 1.599418 | 14.008058 | 866 |
| direct_sequence_stop_h32 | 40.457611 | 13.079574 | 250.025220 | 1.131132 | 14.206802 | 864 |
| constant_velocity_v12 | 42.672711 | 18.962726 | 299.946610 | 14.820247 | 16.185689 | 2 |
| constant_velocity_v3 | 44.670490 | 16.838330 | 250.296628 | 2.983421 | 16.118974 | 2 |
| current_smooth_predictor | 44.859180 | 0.616060 | 0.000000 | 0.818744 | 31.828337 | 864 |
| soft_brake_cv2_gamma2.2 | 54.808658 | 13.073879 | 233.772623 | 0.064788 | 18.231517 | 14 |

## Best Test Candidates By Overshoot

| candidate | overshoot max p95 | sequence visual p95 | normal visual p95 | recovery p95 ms | row visual p95 | MACs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current_smooth_predictor | 0.616060 | 44.859180 | 44.859180 | 55.228315 | 31.828337 | 864 |
| residual_cv2_sequence_stop_h32 | 12.462885 | 38.031223 | 38.031223 | 71.292995 | 14.008058 | 866 |
| residual_cv2_sequence_stop_h64 | 12.477466 | 36.921923 | 36.921923 | 79.969711 | 13.756554 | 1730 |
| direct_sequence_stop_h64 | 12.763918 | 36.588033 | 36.588033 | 65.897626 | 14.022263 | 1728 |
| direct_row_mse_h32 | 13.038369 | 36.643263 | 36.643263 | 97.057306 | 14.148623 | 864 |
| soft_brake_cv2_gamma2.2 | 13.073879 | 54.808658 | 54.808658 | 61.656725 | 18.231517 | 14 |
| direct_sequence_stop_h32 | 13.079574 | 40.457611 | 40.457611 | 67.086461 | 14.206802 | 864 |
| soft_brake_cv2_gamma1.4 | 13.770862 | 54.808658 | 54.808658 | 61.656725 | 18.223578 | 14 |
| residual_cv2_row_mse_h32 | 13.773512 | 37.373644 | 37.373644 | 163.814065 | 14.256259 | 866 |
| constant_velocity_v2 | 13.900880 | 54.808658 | 54.808658 | 66.925936 | 18.233223 | 2 |

## Interpretation

A candidate is promising only if it stays near the best visual candidates while also materially reducing overshoot max and duration. A pure overshoot winner that makes sequence visual p95 much worse is the same failure mode as the conservative SmoothPredictor behavior.
