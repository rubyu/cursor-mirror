# Step 6 Timing Alignment Search

## Intent

This step tests whether residual lag/tail can be explained by prediction-time alignment rather than model capacity. The evaluation contract remains unchanged from Steps 2-5: product poll anchors, causal referencePoll history, Step 1 scenario split, and labels at anchor + horizon for horizons 0, 8, 16.67, 25, 33.33, 50 ms. Candidates change the predictor's internal horizon only; labels stay fixed.

## Timing Objective And Guardrails

Validation selects the candidate. The objective weights p95/p99, >5px/>10px, resume-tail horizons, long-horizon signed lag, and offset magnitude. Guardrails reject product candidates whose validation p95/p99/>10px/resume tail regress beyond small tolerances versus Step 3 teacher, Step 4 selected, and Step 5 selected. Positive signed lead means prediction is ahead of the causal motion direction; negative means lagging.

## Candidate List

| model                                           | family                    | base  | product | selectable | offset | gain | description                                                                      |
| ----------------------------------------------- | ------------------------- | ----- | ------- | ---------- | ------ | ---- | -------------------------------------------------------------------------------- |
| ls12_baseline                                   | reference                 | ls12  | yes     | no         |        |      | Step 2 LS12 cap64 at contract horizon.                                           |
| step3_teacher_ridge_residual_segmented_horizon  | reference                 | step3 | yes     | no         |        |      | Step 3 teacher at contract horizon.                                              |
| step4_vfsmn_small_velocity                      | reference                 | step4 | yes     | no         |        |      | Step 4 selected VFSMN at contract horizon.                                       |
| step5_guarded_selected                          | reference                 | step5 | yes     | no         |        |      | Step 5 selected guarded mixture at contract horizon.                             |
| ls12_fixed_offset_m16p67ms                      | fixed_offset              | ls12  | yes     | yes        | -16.67 | 1    | ls12 with internal horizon = horizon + -16.67 ms.                                |
| ls12_fixed_offset_m12ms                         | fixed_offset              | ls12  | yes     | yes        | -12    | 1    | ls12 with internal horizon = horizon + -12 ms.                                   |
| ls12_fixed_offset_m8ms                          | fixed_offset              | ls12  | yes     | yes        | -8     | 1    | ls12 with internal horizon = horizon + -8 ms.                                    |
| ls12_fixed_offset_m4ms                          | fixed_offset              | ls12  | yes     | yes        | -4     | 1    | ls12 with internal horizon = horizon + -4 ms.                                    |
| ls12_fixed_offset_0ms                           | fixed_offset              | ls12  | yes     | no         | 0      | 1    | ls12 with internal horizon = horizon + 0 ms.                                     |
| ls12_fixed_offset_p4ms                          | fixed_offset              | ls12  | yes     | yes        | 4      | 1    | ls12 with internal horizon = horizon + 4 ms.                                     |
| ls12_fixed_offset_p8ms                          | fixed_offset              | ls12  | yes     | yes        | 8      | 1    | ls12 with internal horizon = horizon + 8 ms.                                     |
| ls12_fixed_offset_p12ms                         | fixed_offset              | ls12  | yes     | yes        | 12     | 1    | ls12 with internal horizon = horizon + 12 ms.                                    |
| ls12_fixed_offset_p16p67ms                      | fixed_offset              | ls12  | yes     | yes        | 16.67  | 1    | ls12 with internal horizon = horizon + 16.67 ms.                                 |
| step3_fixed_offset_m16p67ms                     | fixed_offset              | step3 | yes     | yes        | -16.67 | 1    | step3 with internal horizon = horizon + -16.67 ms.                               |
| step3_fixed_offset_m12ms                        | fixed_offset              | step3 | yes     | yes        | -12    | 1    | step3 with internal horizon = horizon + -12 ms.                                  |
| step3_fixed_offset_m8ms                         | fixed_offset              | step3 | yes     | yes        | -8     | 1    | step3 with internal horizon = horizon + -8 ms.                                   |
| step3_fixed_offset_m4ms                         | fixed_offset              | step3 | yes     | yes        | -4     | 1    | step3 with internal horizon = horizon + -4 ms.                                   |
| step3_fixed_offset_0ms                          | fixed_offset              | step3 | yes     | no         | 0      | 1    | step3 with internal horizon = horizon + 0 ms.                                    |
| step3_fixed_offset_p4ms                         | fixed_offset              | step3 | yes     | yes        | 4      | 1    | step3 with internal horizon = horizon + 4 ms.                                    |
| step3_fixed_offset_p8ms                         | fixed_offset              | step3 | yes     | yes        | 8      | 1    | step3 with internal horizon = horizon + 8 ms.                                    |
| step3_fixed_offset_p12ms                        | fixed_offset              | step3 | yes     | yes        | 12     | 1    | step3 with internal horizon = horizon + 12 ms.                                   |
| step3_fixed_offset_p16p67ms                     | fixed_offset              | step3 | yes     | yes        | 16.67  | 1    | step3 with internal horizon = horizon + 16.67 ms.                                |
| step4_fixed_offset_m16p67ms                     | fixed_offset              | step4 | yes     | yes        | -16.67 | 1    | step4 with internal horizon = horizon + -16.67 ms.                               |
| step4_fixed_offset_m12ms                        | fixed_offset              | step4 | yes     | yes        | -12    | 1    | step4 with internal horizon = horizon + -12 ms.                                  |
| step4_fixed_offset_m8ms                         | fixed_offset              | step4 | yes     | yes        | -8     | 1    | step4 with internal horizon = horizon + -8 ms.                                   |
| step4_fixed_offset_m4ms                         | fixed_offset              | step4 | yes     | yes        | -4     | 1    | step4 with internal horizon = horizon + -4 ms.                                   |
| step4_fixed_offset_0ms                          | fixed_offset              | step4 | yes     | no         | 0      | 1    | step4 with internal horizon = horizon + 0 ms.                                    |
| step4_fixed_offset_p4ms                         | fixed_offset              | step4 | yes     | yes        | 4      | 1    | step4 with internal horizon = horizon + 4 ms.                                    |
| step4_fixed_offset_p8ms                         | fixed_offset              | step4 | yes     | yes        | 8      | 1    | step4 with internal horizon = horizon + 8 ms.                                    |
| step4_fixed_offset_p12ms                        | fixed_offset              | step4 | yes     | yes        | 12     | 1    | step4 with internal horizon = horizon + 12 ms.                                   |
| step4_fixed_offset_p16p67ms                     | fixed_offset              | step4 | yes     | yes        | 16.67  | 1    | step4 with internal horizon = horizon + 16.67 ms.                                |
| step5_fixed_offset_m8ms                         | fixed_offset              | step5 | yes     | yes        | -8     | 1    | Step 5 guard with internal horizon = horizon + -8 ms.                            |
| step5_fixed_offset_m4ms                         | fixed_offset              | step5 | yes     | yes        | -4     | 1    | Step 5 guard with internal horizon = horizon + -4 ms.                            |
| step5_fixed_offset_0ms                          | fixed_offset              | step5 | yes     | no         | 0      | 1    | Step 5 guard with internal horizon = horizon + 0 ms.                             |
| step5_fixed_offset_p4ms                         | fixed_offset              | step5 | yes     | yes        | 4      | 1    | Step 5 guard with internal horizon = horizon + 4 ms.                             |
| step5_fixed_offset_p8ms                         | fixed_offset              | step5 | yes     | yes        | 8      | 1    | Step 5 guard with internal horizon = horizon + 8 ms.                             |
| step5_fixed_offset_p12ms                        | fixed_offset              | step5 | yes     | yes        | 12     | 1    | Step 5 guard with internal horizon = horizon + 12 ms.                            |
| ls12_gain_0p85                                  | fixed_gain                | ls12  | yes     | yes        | 0      | 0.85 | ls12 with internal horizon = horizon * 0.85.                                     |
| ls12_gain_0p95                                  | fixed_gain                | ls12  | yes     | yes        | 0      | 0.95 | ls12 with internal horizon = horizon * 0.95.                                     |
| ls12_gain_1                                     | fixed_gain                | ls12  | yes     | no         | 0      | 1    | ls12 with internal horizon = horizon * 1.                                        |
| ls12_gain_1p05                                  | fixed_gain                | ls12  | yes     | yes        | 0      | 1.05 | ls12 with internal horizon = horizon * 1.05.                                     |
| ls12_gain_1p15                                  | fixed_gain                | ls12  | yes     | yes        | 0      | 1.15 | ls12 with internal horizon = horizon * 1.15.                                     |
| step3_gain_0p85                                 | fixed_gain                | step3 | yes     | yes        | 0      | 0.85 | step3 with internal horizon = horizon * 0.85.                                    |
| step3_gain_0p95                                 | fixed_gain                | step3 | yes     | yes        | 0      | 0.95 | step3 with internal horizon = horizon * 0.95.                                    |
| step3_gain_1                                    | fixed_gain                | step3 | yes     | no         | 0      | 1    | step3 with internal horizon = horizon * 1.                                       |
| step3_gain_1p05                                 | fixed_gain                | step3 | yes     | yes        | 0      | 1.05 | step3 with internal horizon = horizon * 1.05.                                    |
| step3_gain_1p15                                 | fixed_gain                | step3 | yes     | yes        | 0      | 1.15 | step3 with internal horizon = horizon * 1.15.                                    |
| step4_gain_0p85                                 | fixed_gain                | step4 | yes     | yes        | 0      | 0.85 | step4 with internal horizon = horizon * 0.85.                                    |
| step4_gain_0p95                                 | fixed_gain                | step4 | yes     | yes        | 0      | 0.95 | step4 with internal horizon = horizon * 0.95.                                    |
| step4_gain_1                                    | fixed_gain                | step4 | yes     | no         | 0      | 1    | step4 with internal horizon = horizon * 1.                                       |
| step4_gain_1p05                                 | fixed_gain                | step4 | yes     | yes        | 0      | 1.05 | step4 with internal horizon = horizon * 1.05.                                    |
| step4_gain_1p15                                 | fixed_gain                | step4 | yes     | yes        | 0      | 1.15 | step4 with internal horizon = horizon * 1.15.                                    |
| step4_conditional_speed_t0p65_p4ms_h16p67       | causal_conditional_offset | step4 | yes     | yes        |        |      | step4 applies +4 ms when causal speed risk >= 0.65 and horizon >= 16.67.         |
| step4_conditional_speed_t0p65_p8ms_h25          | causal_conditional_offset | step4 | yes     | yes        |        |      | step4 applies +8 ms when causal speed risk >= 0.65 and horizon >= 25.            |
| step4_conditional_scheduler_t0p18_p4ms_h16p67   | causal_conditional_offset | step4 | yes     | yes        |        |      | step4 applies +4 ms when causal scheduler risk >= 0.18 and horizon >= 16.67.     |
| step4_conditional_disagreement_t4_p4ms_h16p67   | causal_conditional_offset | step4 | yes     | yes        |        |      | step4 applies +4 ms when causal disagreement risk >= 4 and horizon >= 16.67.     |
| step4_conditional_lagRisk_t1p2_p4ms_h25         | causal_conditional_offset | step4 | yes     | yes        |        |      | step4 applies +4 ms when causal lagRisk risk >= 1.2 and horizon >= 25.           |
| step3_conditional_lagRisk_t1p2_p4ms_h25         | causal_conditional_offset | step3 | yes     | yes        |        |      | step3 applies +4 ms when causal lagRisk risk >= 1.2 and horizon >= 25.           |
| step4_conditional_stillResumeRisk_t1p5_p8ms_h25 | causal_conditional_offset | step4 | yes     | yes        |        |      | step4 applies +8 ms when causal stillResumeRisk risk >= 1.5 and horizon >= 25.   |
| step5_conditional_lagRisk_t1p2_p4ms_h25         | causal_conditional_offset | step5 | yes     | yes        |        |      | step5 applies +4 ms when causal lagRisk risk >= 1.2 and horizon >= 25.           |
| analysis_stress_long_step4_plus8                | analysis_load_offset      | step4 | no      | no         |        |      | Analysis-only load-id offset: stress long horizons use +8 ms.                    |
| analysis_resume_step4_plus8                     | analysis_category_offset  | step4 | no      | no         |        |      | Analysis-only script-category offset: resume horizons >=16.67 use +8 ms.         |
| analysis_resume_step3_plus8                     | analysis_category_offset  | step3 | no      | no         |        |      | Analysis-only script-category offset on Step 3 teacher.                          |
| ls12_horizon_specific_offset_valbest            | horizon_specific_offset   | ls12  | yes     | yes        |        |      | ls12 horizon-specific offsets selected on validation with small regularization.  |
| step3_horizon_specific_offset_valbest           | horizon_specific_offset   | step3 | yes     | yes        |        |      | step3 horizon-specific offsets selected on validation with small regularization. |
| step4_horizon_specific_offset_valbest           | horizon_specific_offset   | step4 | yes     | yes        |        |      | step4 horizon-specific offsets selected on validation with small regularization. |

## Horizon-Specific Validation Choices

| base  | horizon | offset | score   | p95  | p99   | signed lead | lag rate |
| ----- | ------- | ------ | ------- | ---- | ----- | ----------- | -------- |
| ls12  | 0       | 4      | 8.7274  | 2.5  | 9.25  | 0.1242      | 0.359875 |
| ls12  | 8       | 8      | 14.2382 | 4    | 16.75 | -0.0044     | 0.408046 |
| ls12  | 16.67   | 4      | 14.9643 | 4    | 18.75 | -0.0025     | 0.410345 |
| ls12  | 25      | 4      | 18.3757 | 5    | 24    | 0.1242      | 0.401933 |
| ls12  | 33.33   | 4      | 21.8795 | 6    | 29.25 | -0.0027     | 0.415726 |
| ls12  | 50      | 4      | 30.7675 | 8.75 | 41.75 | -0.1432     | 0.44232  |
| step3 | 0       | 0      | 1.8418  | 0.5  | 2     | -0.0962     | 0.061338 |
| step3 | 8       | 8      | 12.7951 | 3.75 | 14.75 | 0.0078      | 0.355799 |
| step3 | 16.67   | 8      | 13.5129 | 4    | 15.75 | 0.1638      | 0.353762 |
| step3 | 25      | 8      | 17.2066 | 4.5  | 22.5  | 0.1608      | 0.382915 |
| step3 | 33.33   | 12     | 21.4354 | 5.75 | 28.5  | 0.2704      | 0.378265 |
| step3 | 50      | 12     | 29.1268 | 8    | 39    | -0.1203     | 0.444828 |
| step4 | 0       | 0      | 1.8701  | 0.5  | 2     | -0.1041     | 0.063741 |
| step4 | 8       | 8      | 12.7922 | 3.75 | 14.75 | 0.0186      | 0.353239 |
| step4 | 16.67   | 8      | 13.4943 | 4    | 15.75 | 0.1805      | 0.351254 |
| step4 | 25      | 8      | 17.1962 | 4.5  | 22.5  | 0.1701      | 0.380042 |
| step4 | 33.33   | 8      | 21.2926 | 5.5  | 28.25 | -0.1122     | 0.428527 |
| step4 | 50      | 12     | 29.0733 | 8    | 39    | -0.1142     | 0.443521 |

## Validation Selection

Selected: `step4_gain_1p15`. Guardrail passed: yes.

| model                                         | family                    | base  | guard | objective | mean   | p95  | p99   | resume p95 | long signed | long lag |
| --------------------------------------------- | ------------------------- | ----- | ----- | --------- | ------ | ---- | ----- | ---------- | ----------- | -------- |
| step4_gain_1p15                               | fixed_gain                | step4 | yes   | 75.4556   | 1.7879 | 4.75 | 20.5  | 23.75      | -0.4187     | 0.473546 |
| step3_gain_1p15                               | fixed_gain                | step3 | yes   | 75.8185   | 1.823  | 4.75 | 20.5  | 24         | -0.4335     | 0.47567  |
| step4_fixed_offset_p4ms                       | fixed_offset              | step4 | yes   | 75.8742   | 1.8368 | 4.75 | 20.5  | 23.75      | -0.5547     | 0.490143 |
| step5_fixed_offset_p4ms                       | fixed_offset              | step5 | yes   | 76.1966   | 1.8579 | 4.75 | 20.5  | 24         | -0.5599     | 0.492076 |
| step3_fixed_offset_p4ms                       | fixed_offset              | step3 | yes   | 76.2484   | 1.8698 | 4.75 | 20.5  | 24         | -0.5705     | 0.492877 |
| step4_gain_1p05                               | fixed_gain                | step4 | yes   | 76.8698   | 1.7839 | 4.75 | 20.25 | 24         | -0.7789     | 0.524486 |
| step3_gain_1p05                               | fixed_gain                | step3 | yes   | 77.3061   | 1.8128 | 4.75 | 20.25 | 24.25      | -0.7948     | 0.52682  |
| step4_conditional_disagreement_t4_p4ms_h16p67 | causal_conditional_offset | step4 | yes   | 77.3844   | 1.7895 | 4.75 | 20.5  | 24         | -0.8582     | 0.548781 |
| step4_conditional_speed_t0p65_p8ms_h25        | causal_conditional_offset | step4 | yes   | 77.4712   | 1.8043 | 4.75 | 20.5  | 24.25      | -0.7761     | 0.534779 |
| step4_conditional_lagRisk_t1p2_p4ms_h25       | causal_conditional_offset | step4 | yes   | 77.5805   | 1.7894 | 4.75 | 20.5  | 24         | -0.8396     | 0.542947 |

## Delta Vs Step 3 Teacher

| split      | load   | base mean | cand mean | mean d  | base p95 | cand p95 | p95 d | base p99 | cand p99 | p99 d | signed d | lag d     |
| ---------- | ------ | --------- | --------- | ------- | -------- | -------- | ----- | -------- | -------- | ----- | -------- | --------- |
| validation | normal | 1.9286    | 1.8996    | -0.029  | 5        | 5        | 0     | 23.25    | 23.5     | 0.25  | 0.3743   | -0.058588 |
| validation | stress | 1.7044    | 1.6761    | -0.0283 | 4.75     | 4.5      | -0.25 | 16.5     | 16.75    | 0.25  | 0.2942   | -0.037499 |
| test       | normal | 1.8457    | 1.8667    | 0.021   | 4        | 4        | 0     | 16.5     | 17       | 0.5   | 0.3404   | -0.048769 |
| test       | stress | 1.8665    | 1.8833    | 0.0168  | 4.25     | 4.25     | 0     | 15       | 15       | 0     | 0.3082   | -0.050896 |

## Delta Vs Step 4 Selected

| split      | load   | base mean | cand mean | mean d  | base p95 | cand p95 | p95 d | base p99 | cand p99 | p99 d | signed d | lag d     |
| ---------- | ------ | --------- | --------- | ------- | -------- | -------- | ----- | -------- | -------- | ----- | -------- | --------- |
| validation | normal | 1.9035    | 1.8996    | -0.0039 | 5        | 5        | 0     | 23.25    | 23.5     | 0.25  | 0.3694   | -0.056171 |
| validation | stress | 1.6722    | 1.6761    | 0.0039  | 4.5      | 4.5      | 0     | 16.5     | 16.75    | 0.25  | 0.2794   | -0.038187 |
| test       | normal | 1.8251    | 1.8667    | 0.0416  | 4        | 4        | 0     | 16.5     | 17       | 0.5   | 0.3164   | -0.044201 |
| test       | stress | 1.8492    | 1.8833    | 0.0341  | 4.25     | 4.25     | 0     | 15       | 15       | 0     | 0.2947   | -0.048041 |

## Delta Vs Step 5 Selected

| split      | load   | base mean | cand mean | mean d | base p95 | cand p95 | p95 d | base p99 | cand p99 | p99 d | signed d | lag d     |
| ---------- | ------ | --------- | --------- | ------ | -------- | -------- | ----- | -------- | -------- | ----- | -------- | --------- |
| validation | normal | 1.9226    | 1.8996    | -0.023 | 5        | 5        | 0     | 23.25    | 23.5     | 0.25  | 0.3728   | -0.057765 |
| validation | stress | 1.6901    | 1.6761    | -0.014 | 4.75     | 4.5      | -0.25 | 16.5     | 16.75    | 0.25  | 0.2807   | -0.036938 |
| test       | normal | 1.8364    | 1.8667    | 0.0303 | 4        | 4        | 0     | 16.5     | 17       | 0.5   | 0.3299   | -0.046579 |
| test       | stress | 1.8616    | 1.8833    | 0.0217 | 4.25     | 4.25     | 0     | 15       | 15       | 0     | 0.3028   | -0.05015  |

## Test Horizon Breakdown Vs Step 3

| load   | horizon | base p95 | cand p95 | p95 d | base p99 | cand p99 | p99 d | base signed | cand signed | signed d | cand lag |
| ------ | ------- | -------- | -------- | ----- | -------- | -------- | ----- | ----------- | ----------- | -------- | -------- |
| normal | 0       | 0.5      | 0.5      | 0     | 1.75     | 1.75     | 0     | -0.0837     | -0.0907     | -0.007   | 0.050688 |
| normal | 8       | 2.5      | 2.5      | 0     | 9.5      | 9.75     | 0.25  | -0.0936     | 0.033       | 0.1266   | 0.268836 |
| normal | 16.67   | 2.75     | 2.75     | 0     | 13.25    | 12.5     | -0.75 | -0.0058     | 0.2425      | 0.2483   | 0.310638 |
| normal | 25      | 4        | 3.75     | -0.25 | 18.5     | 18       | -0.5  | -0.1034     | 0.3102      | 0.4136   | 0.347559 |
| normal | 33.33   | 4.5      | 4.5      | 0     | 24.25    | 24.5     | 0.25  | -0.1261     | 0.376       | 0.5021   | 0.348686 |
| normal | 50      | 6.5      | 6.5      | 0     | 35.5     | 37       | 1.5   | -0.1822     | 0.5759      | 0.7581   | 0.342553 |
| stress | 0       | 0.5      | 0.5      | 0     | 1.75     | 1.75     | 0     | -0.0595     | -0.0637     | -0.0042  | 0.043113 |
| stress | 8       | 3        | 3        | 0     | 9        | 9        | 0     | -0.146      | -0.0489     | 0.0971   | 0.270101 |
| stress | 16.67   | 3.25     | 3.25     | 0     | 11.5     | 11.25    | -0.25 | -0.2135     | -0.0033     | 0.2102   | 0.308063 |
| stress | 25      | 4.25     | 4.25     | 0     | 14.75    | 14.5     | -0.25 | -0.3255     | 0.0461      | 0.3716   | 0.345801 |
| stress | 33.33   | 5        | 5        | 0     | 18       | 17.25    | -0.75 | -0.3939     | 0.0871      | 0.481    | 0.355655 |
| stress | 50      | 7.25     | 7.25     | 0     | 26.25    | 27       | 0.75  | -0.5618     | 0.1314      | 0.6932   | 0.379955 |

## Test Category Breakdown

| load   | horizon | category | count | mean   | p95   | p99   | signed lead | lag rate |
| ------ | ------- | -------- | ----- | ------ | ----- | ----- | ----------- | -------- |
| normal | 0       | moving   | 12119 | 0.1301 | 0.5   | 1.75  | -0.0735     | 0.045076 |
| normal | 8       | moving   | 12119 | 1.2719 | 2.25  | 6.25  | 0.1009      | 0.264288 |
| normal | 16.67   | moving   | 12119 | 1.6847 | 2.5   | 7.75  | 0.3268      | 0.302656 |
| normal | 25      | moving   | 12119 | 2.185  | 3.25  | 11.25 | 0.4256      | 0.340891 |
| normal | 33.33   | moving   | 12119 | 2.6073 | 4     | 13    | 0.4961      | 0.342635 |
| normal | 50      | moving   | 12119 | 3.3196 | 5.75  | 19    | 0.7251      | 0.338342 |
| normal | 0       | hold     | 2121  | 0.0684 | 0     | 1     | -0.2835     | 0.110656 |
| normal | 8       | hold     | 2121  | 0.7027 | 2.25  | 14    | 0.8033      | 0.196721 |
| normal | 16.67   | hold     | 2121  | 0.9231 | 3.25  | 19.25 | 2.1069      | 0.180328 |
| normal | 25      | hold     | 2121  | 1.2136 | 4.5   | 27.25 | 3.711       | 0.135246 |
| normal | 33.33   | hold     | 2121  | 1.5078 | 6.25  | 32.75 | 6.2114      | 0.110656 |
| normal | 50      | hold     | 2121  | 2.02   | 9.5   | 41.5  | 10.614      | 0.053279 |
| normal | 0       | resume   | 756   | 0.2484 | 1     | 2.5   | -0.3681     | 0.143836 |
| normal | 8       | resume   | 756   | 2.2168 | 8.5   | 42.75 | -2.3425     | 0.445205 |
| normal | 16.67   | resume   | 756   | 2.613  | 12.25 | 39.75 | -3.4673     | 0.623288 |
| normal | 25      | resume   | 756   | 4.0506 | 21    | 46.5  | -5.4781     | 0.695205 |
| normal | 33.33   | resume   | 756   | 5.7767 | 29.5  | 64.5  | -7.5644     | 0.702055 |
| normal | 50      | resume   | 756   | 9.685  | 48    | 104.5 | -11.6227    | 0.691781 |
| stress | 0       | moving   | 11874 | 0.1171 | 0.5   | 1.75  | -0.0601     | 0.039621 |
| stress | 8       | moving   | 11874 | 1.2465 | 3     | 8.25  | -0.003      | 0.263692 |
| stress | 16.67   | moving   | 11874 | 1.51   | 3     | 10.5  | 0.0724      | 0.301014 |
| stress | 25      | moving   | 11874 | 1.8443 | 4     | 14    | 0.1359      | 0.340095 |
| stress | 33.33   | moving   | 11874 | 2.2384 | 4.5   | 16.5  | 0.1789      | 0.348749 |
| stress | 50      | moving   | 11874 | 3.1342 | 6.75  | 26.5  | 0.2617      | 0.373766 |
| stress | 0       | hold     | 2450  | 0.1389 | 0.5   | 2     | -0.0894     | 0.061881 |
| stress | 8       | hold     | 2450  | 1.8283 | 3.75  | 12.25 | -0.4206     | 0.320957 |
| stress | 16.67   | hold     | 2450  | 2.5161 | 4.75  | 13.75 | -0.5365     | 0.357261 |
| stress | 25      | hold     | 2450  | 3.4731 | 6.5   | 17.25 | -0.5503     | 0.382013 |
| stress | 33.33   | hold     | 2450  | 4.1739 | 8.5   | 19    | -0.5477     | 0.406766 |
| stress | 50      | hold     | 2450  | 5.9544 | 12.25 | 29.5  | -0.7187     | 0.417492 |
| stress | 0       | resume   | 675   | 0.0999 | 0.25  | 1.5   | -0.049      | 0.052632 |
| stress | 8       | resume   | 675   | 0.9647 | 2.5   | 6.75  | 0.2963      | 0.226006 |
| stress | 16.67   | resume   | 675   | 1.1839 | 3     | 10.75 | 0.2646      | 0.28483  |
| stress | 25      | resume   | 675   | 1.5191 | 4.25  | 15    | 0.2265      | 0.340557 |
| stress | 33.33   | resume   | 675   | 1.8123 | 5.5   | 15.5  | 0.367       | 0.321981 |
| stress | 50      | resume   | 675   | 2.3667 | 7.25  | 22.25 | 0.3378      | 0.380805 |

## Signed Lag / Lead Bias

| load   | horizon | signed count | mean signed | mean abs | lag rate | lead rate |
| ------ | ------- | ------------ | ----------- | -------- | -------- | --------- |
| normal | 0       | 7454         | -0.0735     | 0.0978   | 0.045076 | 0.003756  |
| normal | 8       | 7454         | 0.1009      | 1.1373   | 0.264288 | 0.530722  |
| normal | 16.67   | 7454         | 0.3268      | 1.3507   | 0.302656 | 0.550979  |
| normal | 25      | 7454         | 0.4256      | 1.6843   | 0.340891 | 0.539979  |
| normal | 33.33   | 7454         | 0.4961      | 2.0467   | 0.342635 | 0.538905  |
| normal | 50      | 7454         | 0.7251      | 2.6521   | 0.338342 | 0.557016  |
| stress | 0       | 7395         | -0.0601     | 0.0843   | 0.039621 | 0.004462  |
| stress | 8       | 7395         | -0.003      | 1.059    | 0.263692 | 0.506964  |
| stress | 16.67   | 7395         | 0.0724      | 1.2859   | 0.301014 | 0.518729  |
| stress | 25      | 7395         | 0.1359      | 1.5529   | 0.340095 | 0.543475  |
| stress | 33.33   | 7395         | 0.1789      | 1.9006   | 0.348749 | 0.518053  |
| stress | 50      | 7395         | 0.2617      | 2.654    | 0.373766 | 0.531575  |

## Interpretation

`step4_gain_1p15` was validation-selected, but test shows tail regression in normal. Timing offset alone is not production-safe; it can move signed bias while increasing tail risk.

## Step 7 Recommendation

Step 7 should prioritize additional causal observability: explicit prediction-target timestamp, present/compositor timestamp, hold/resume transition markers, and missing-scheduler/warm-up flags. Keep Step 3/5 as safety references until timing telemetry can disambiguate model error from display-time offset.
