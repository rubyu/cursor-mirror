# Step 5 Tail-Aware Guarded Search

## Intent

Step 5 searches product-eligible tail-aware guards around the Step 3 teacher, Step 4 `VFSMN_small_velocity`, and LS12 baseline. The evaluation contract is unchanged: product poll anchors, causal referencePoll history only, Step 1 scenario split, and horizons 0, 8, 16.67, 25, 33.33, 50 ms. Validation chooses the guarded candidate; test is read after selection.

## Tail Objective

The validation objective weights p95/p99, >5px, >10px, worst normal/stress p95/p99, resume-only horizons 16.67-50 ms, and signed lag bias. Candidate guardrails reject validation tail regressions beyond small tolerances versus both `ridge_residual_segmented_horizon` and `VFSMN_small_velocity`. Mean improvement alone is not sufficient.

## Candidate List

| model                                                   | family                       | product eligible | selectable | uses scheduler delay | description                                                                 |
| ------------------------------------------------------- | ---------------------------- | ---------------- | ---------- | -------------------- | --------------------------------------------------------------------------- |
| ls12_baseline                                           | baseline                     | yes              | no         | yes                  | Step 2 least-squares velocity n12 cap64 baseline.                           |
| step3_teacher_ridge_residual_segmented_horizon          | step3_teacher                | yes              | no         | yes                  | Step 3 best ridge residual segmented by horizon.                            |
| step4_vfsmn_small_velocity                              | step4_vfsmn                  | yes              | no         | yes                  | Step 4 selected VFSMN small velocity model.                                 |
| no_scheduler_ridge_horizon_lambda0.1                    | no_scheduler_ridge           | yes              | yes        | no                   | Horizon ridge residual with schedulerDelay feature set to zero.             |
| no_scheduler_ridge_horizon_lambda1                      | no_scheduler_ridge           | yes              | yes        | no                   | Horizon ridge residual with schedulerDelay feature set to zero.             |
| no_scheduler_ridge_horizon_lambda3                      | no_scheduler_ridge           | yes              | yes        | no                   | Horizon ridge residual with schedulerDelay feature set to zero.             |
| no_scheduler_ridge_horizon_lambda10                     | no_scheduler_ridge           | yes              | yes        | no                   | Horizon ridge residual with schedulerDelay feature set to zero.             |
| no_scheduler_ridge_horizon_lambda30                     | no_scheduler_ridge           | yes              | yes        | no                   | Horizon ridge residual with schedulerDelay feature set to zero.             |
| no_scheduler_ridge_horizon_lambda100                    | no_scheduler_ridge           | yes              | yes        | no                   | Horizon ridge residual with schedulerDelay feature set to zero.             |
| guard_vfsmn_still_accel_disagree_t0.8_h16.67_to_teacher | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t0.8_h16.67_to_ls12    | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t0.8_h25_to_teacher    | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t0.8_h25_to_ls12       | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.1_h16.67_to_teacher | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.1_h16.67_to_ls12    | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.1_h25_to_teacher    | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.1_h25_to_ls12       | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.4_h16.67_to_teacher | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.4_h16.67_to_ls12    | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.4_h25_to_teacher    | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.4_h25_to_ls12       | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.7_h16.67_to_teacher | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.7_h16.67_to_ls12    | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.7_h25_to_teacher    | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_accel_disagree_t1.7_h25_to_ls12       | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t0.8_h16.67_to_teacher       | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t0.8_h16.67_to_ls12          | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t0.8_h25_to_teacher          | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t0.8_h25_to_ls12             | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.1_h16.67_to_teacher       | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.1_h16.67_to_ls12          | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.1_h25_to_teacher          | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.1_h25_to_ls12             | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.4_h16.67_to_teacher       | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.4_h16.67_to_ls12          | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.4_h25_to_teacher          | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.4_h25_to_ls12             | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.7_h16.67_to_teacher       | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.7_h16.67_to_ls12          | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.7_h25_to_teacher          | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_gap_projection_t1.7_h25_to_ls12             | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t0.8_h16.67_to_teacher      | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t0.8_h16.67_to_ls12         | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t0.8_h25_to_teacher         | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t0.8_h25_to_ls12            | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.1_h16.67_to_teacher      | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.1_h16.67_to_ls12         | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.1_h25_to_teacher         | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.1_h25_to_ls12            | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.4_h16.67_to_teacher      | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.4_h16.67_to_ls12         | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.4_h25_to_teacher         | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.4_h25_to_ls12            | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.7_h16.67_to_teacher      | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.7_h16.67_to_ls12         | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.7_h25_to_teacher         | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_still_to_motion_t1.7_h25_to_ls12            | tail_guarded_mixture         | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback on high causal resume-risk and long horizon. |
| guard_vfsmn_missing_scheduler_to_teacher                | missing_scheduler_guard      | yes              | yes        | yes                  | Fallback when scheduler delay is missing or implausibly large.              |
| guard_vfsmn_missing_scheduler_to_ls12                   | missing_scheduler_guard      | yes              | yes        | yes                  | Fallback when scheduler delay is missing or implausibly large.              |
| clip_vfsmn_residual_cap2                                | residual_clip_guard          | yes              | yes        | yes                  | Clip Step 4 VFSMN residual relative to LS12.                                |
| clip_teacher_residual_cap2                              | residual_clip_guard          | yes              | yes        | yes                  | Clip Step 3 teacher residual relative to LS12.                              |
| clip_vfsmn_residual_cap4                                | residual_clip_guard          | yes              | yes        | yes                  | Clip Step 4 VFSMN residual relative to LS12.                                |
| clip_teacher_residual_cap4                              | residual_clip_guard          | yes              | yes        | yes                  | Clip Step 3 teacher residual relative to LS12.                              |
| clip_vfsmn_residual_cap8                                | residual_clip_guard          | yes              | yes        | yes                  | Clip Step 4 VFSMN residual relative to LS12.                                |
| clip_teacher_residual_cap8                              | residual_clip_guard          | yes              | yes        | yes                  | Clip Step 3 teacher residual relative to LS12.                              |
| clip_vfsmn_residual_cap16                               | residual_clip_guard          | yes              | yes        | yes                  | Clip Step 4 VFSMN residual relative to LS12.                                |
| clip_teacher_residual_cap16                             | residual_clip_guard          | yes              | yes        | yes                  | Clip Step 3 teacher residual relative to LS12.                              |
| guard_vfsmn_still_accel_disagree_t1.1_to_no_scheduler   | no_scheduler_guarded_mixture | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback to scheduler-free ridge on high causal risk. |
| guard_vfsmn_still_accel_disagree_t1.4_to_no_scheduler   | no_scheduler_guarded_mixture | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback to scheduler-free ridge on high causal risk. |
| guard_vfsmn_gap_projection_t1.1_to_no_scheduler         | no_scheduler_guarded_mixture | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback to scheduler-free ridge on high causal risk. |
| guard_vfsmn_gap_projection_t1.4_to_no_scheduler         | no_scheduler_guarded_mixture | yes              | yes        | yes                  | Default Step 4 VFSMN; fallback to scheduler-free ridge on high causal risk. |
| oracle_resume_category_to_teacher                       | oracle_analysis              | no               | no         | yes                  | Analysis-only: uses script category=resume to fallback to Step 3 teacher.   |
| oracle_resume_category_to_ls12                          | oracle_analysis              | no               | no         | yes                  | Analysis-only: uses script category=resume to fallback to LS12.             |
| oracle_best_of_ls12_teacher_vfsmn                       | oracle_analysis              | no               | no         | yes                  | Analysis-only: picks the lowest-error prediction using the label.           |

## Validation Selection

Selected: `guard_vfsmn_still_to_motion_t1.4_h25_to_teacher`. Guardrail passed: yes.

| model                                                   | family               | guard | objective | mean   | p95  | p99   | resume p95 | resume p99 | >10px    |
| ------------------------------------------------------- | -------------------- | ----- | --------- | ------ | ---- | ----- | ---------- | ---------- | -------- |
| guard_vfsmn_still_to_motion_t1.4_h25_to_teacher         | tail_guarded_mixture | yes   | 71.0822   | 1.8064 | 4.75 | 20    | 24.25      | 62.25      | 0.021084 |
| guard_vfsmn_still_accel_disagree_t1.4_h16.67_to_teacher | tail_guarded_mixture | yes   | 71.0825   | 1.8082 | 4.75 | 20    | 24.25      | 62.25      | 0.021067 |
| guard_vfsmn_still_to_motion_t1.4_h16.67_to_teacher      | tail_guarded_mixture | yes   | 71.0834   | 1.8094 | 4.75 | 20    | 24.25      | 62.25      | 0.021078 |
| guard_vfsmn_still_to_motion_t1.1_h25_to_teacher         | tail_guarded_mixture | yes   | 71.0842   | 1.8069 | 4.75 | 20    | 24.25      | 62.25      | 0.021084 |
| guard_vfsmn_still_to_motion_t1.1_h16.67_to_teacher      | tail_guarded_mixture | yes   | 71.0857   | 1.8099 | 4.75 | 20    | 24.25      | 62.25      | 0.021078 |
| guard_vfsmn_gap_projection_t0.8_h16.67_to_teacher       | tail_guarded_mixture | yes   | 71.1529   | 1.8005 | 4.75 | 20    | 24.25      | 62.5       | 0.021045 |
| guard_vfsmn_still_accel_disagree_t1.4_h25_to_teacher    | tail_guarded_mixture | yes   | 71.1705   | 1.8054 | 4.75 | 20.25 | 24.25      | 62.25      | 0.021084 |
| guard_vfsmn_still_accel_disagree_t1.1_h16.67_to_teacher | tail_guarded_mixture | yes   | 71.1772   | 1.8138 | 4.75 | 20    | 24.25      | 62.5       | 0.021056 |
| guard_vfsmn_still_accel_disagree_t0.8_h16.67_to_teacher | tail_guarded_mixture | yes   | 71.1788   | 1.8132 | 4.75 | 20    | 24.25      | 62.5       | 0.021062 |
| guard_vfsmn_still_to_motion_t0.8_h16.67_to_teacher      | tail_guarded_mixture | yes   | 71.1797   | 1.8131 | 4.75 | 20    | 24.25      | 62.5       | 0.021078 |

## Delta Vs Step 3 Teacher

| split      | load   | teacher mean | candidate mean | mean delta | teacher p95 | candidate p95 | p95 delta | teacher p99 | candidate p99 | p99 delta | >10px delta |
| ---------- | ------ | ------------ | -------------- | ---------- | ----------- | ------------- | --------- | ----------- | ------------- | --------- | ----------- |
| validation | normal | 1.9286       | 1.9226         | -0.006     | 5           | 5             | 0         | 23.25       | 23.25         | 0         | 0.000089    |
| validation | stress | 1.7044       | 1.6901         | -0.0143    | 4.75        | 4.75          | 0         | 16.5        | 16.5          | 0         | 0.000011    |
| test       | normal | 1.8457       | 1.8364         | -0.0093    | 4           | 4             | 0         | 16.5        | 16.5          | 0         | -0.000022   |
| test       | stress | 1.8665       | 1.8616         | -0.0049    | 4.25        | 4.25          | 0         | 15          | 15            | 0         | -0.000066   |

## Delta Vs Step 4 Selected

| split      | load   | step4 mean | candidate mean | mean delta | step4 p95 | candidate p95 | p95 delta | step4 p99 | candidate p99 | p99 delta | >10px delta |
| ---------- | ------ | ---------- | -------------- | ---------- | --------- | ------------- | --------- | --------- | ------------- | --------- | ----------- |
| validation | normal | 1.9035     | 1.9226         | 0.0191     | 5         | 5             | 0         | 23.25     | 23.25         | 0         | 0.000033    |
| validation | stress | 1.6722     | 1.6901         | 0.0179     | 4.5       | 4.75          | 0.25      | 16.5      | 16.5          | 0         | 0.000011    |
| test       | normal | 1.8251     | 1.8364         | 0.0113     | 4         | 4             | 0         | 16.5      | 16.5          | 0         | 0.000111    |
| test       | stress | 1.8492     | 1.8616         | 0.0124     | 4.25      | 4.25          | 0         | 15        | 15            | 0         | 0           |

## Test Horizon Breakdown Vs Step 3

| load   | horizon | teacher p95 | candidate p95 | p95 delta | teacher p99 | candidate p99 | p99 delta | signed lead mean | lag rate |
| ------ | ------- | ----------- | ------------- | --------- | ----------- | ------------- | --------- | ---------------- | -------- |
| normal | 0       | 0.5         | 0.5           | 0         | 1.75        | 1.75          | 0         | -0.0907          | 0.050688 |
| normal | 8       | 2.5         | 2.5           | 0         | 9.5         | 9.5           | 0         | -0.0781          | 0.282603 |
| normal | 16.67   | 2.75        | 2.75          | 0         | 13.25       | 13.25         | 0         | 0.0124           | 0.346308 |
| normal | 25      | 4           | 4             | 0         | 18.5        | 18.5          | 0         | -0.0908          | 0.410763 |
| normal | 33.33   | 4.5         | 4.5           | 0         | 24.25       | 24.25         | 0         | -0.1142          | 0.423905 |
| normal | 50      | 6.5         | 6.5           | 0         | 35.5        | 35.5          | 0         | -0.1708          | 0.434168 |
| stress | 0       | 0.5         | 0.5           | 0         | 1.75        | 1.75          | 0         | -0.0637          | 0.043113 |
| stress | 8       | 3           | 3             | 0         | 9           | 9             | 0         | -0.1478          | 0.281971 |
| stress | 16.67   | 3.25        | 3.25          | 0         | 11.5        | 11.5          | 0         | -0.2068          | 0.360134 |
| stress | 25      | 4.25        | 4.25          | 0         | 14.75       | 14.75         | 0         | -0.3149          | 0.402352 |
| stress | 33.33   | 5           | 5             | 0         | 18          | 18            | 0         | -0.3831          | 0.446137 |
| stress | 50      | 7.25        | 7.25          | 0         | 26.25       | 26.25         | 0         | -0.5516          | 0.469877 |

## Test Movement Category Breakdown

| load   | horizon | category | count | mean    | p95   | p99   | >10px    | signed lead mean |
| ------ | ------- | -------- | ----- | ------- | ----- | ----- | -------- | ---------------- |
| normal | 0       | moving   | 12119 | 0.1301  | 0.5   | 1.75  | 0.000743 | -0.0735          |
| normal | 8       | moving   | 12119 | 1.2444  | 2.25  | 6.25  | 0.006849 | 0.0025           |
| normal | 16.67   | moving   | 12119 | 1.6457  | 2.5   | 7.25  | 0.007674 | 0.1195           |
| normal | 25      | moving   | 12119 | 2.1453  | 3.25  | 10.75 | 0.010975 | 0.0641           |
| normal | 33.33   | moving   | 12119 | 2.5593  | 4     | 13.5  | 0.014605 | 0.0525           |
| normal | 50      | moving   | 12119 | 3.223   | 5.5   | 19.5  | 0.021124 | 0.0375           |
| normal | 0       | hold     | 2121  | 0.0684  | 0     | 1     | 0.001414 | -0.2835          |
| normal | 8       | hold     | 2121  | 0.6767  | 2.25  | 14.25 | 0.014616 | 0.4676           |
| normal | 16.67   | hold     | 2121  | 0.8663  | 3     | 17.25 | 0.019331 | 1.4768           |
| normal | 25      | hold     | 2121  | 1.1875  | 3.75  | 24.75 | 0.028289 | 2.6329           |
| normal | 33.33   | hold     | 2121  | 1.4875  | 5.5   | 30.75 | 0.033946 | 4.9017           |
| normal | 50      | hold     | 2121  | 1.9835  | 8.25  | 38.25 | 0.046205 | 8.8344           |
| normal | 0       | resume   | 756   | 0.2484  | 1     | 2.5   | 0.003968 | -0.3681          |
| normal | 8       | resume   | 756   | 2.2211  | 7.5   | 43    | 0.043651 | -2.5916          |
| normal | 16.67   | resume   | 756   | 2.7005  | 13.5  | 40.5  | 0.054233 | -3.9456          |
| normal | 25      | resume   | 756   | 4.2506  | 21.5  | 47.25 | 0.093915 | -6.3202          |
| normal | 33.33   | resume   | 756   | 6.0413  | 31.5  | 71.75 | 0.123016 | -8.5631          |
| normal | 50      | resume   | 756   | 10.0099 | 48.75 | 109.5 | 0.210317 | -13.012          |
| stress | 0       | moving   | 11874 | 0.1171  | 0.5   | 1.75  | 0.000505 | -0.0601          |
| stress | 8       | moving   | 11874 | 1.225   | 3     | 8.25  | 0.008253 | -0.1014          |
| stress | 16.67   | moving   | 11874 | 1.4907  | 3.25  | 11    | 0.011706 | -0.1296          |
| stress | 25      | moving   | 11874 | 1.8267  | 4     | 14.5  | 0.01777  | -0.2222          |
| stress | 33.33   | moving   | 11874 | 2.2211  | 4.5   | 17.5  | 0.024676 | -0.2808          |
| stress | 50      | moving   | 11874 | 3.0965  | 6.5   | 26.5  | 0.033855 | -0.4067          |
| stress | 0       | hold     | 2450  | 0.1389  | 0.5   | 2     | 0.001633 | -0.0894          |
| stress | 8       | hold     | 2450  | 1.7918  | 3.75  | 12.5  | 0.013469 | -0.5219          |
| stress | 16.67   | hold     | 2450  | 2.4519  | 4.75  | 13.25 | 0.017143 | -0.7458          |
| stress | 25      | hold     | 2450  | 3.4239  | 6.25  | 17.25 | 0.029388 | -0.9244          |
| stress | 33.33   | hold     | 2450  | 4.1758  | 8.75  | 18.5  | 0.040816 | -1.0763          |
| stress | 50      | hold     | 2450  | 5.8694  | 12.5  | 27.75 | 0.063673 | -1.4807          |
| stress | 0       | resume   | 675   | 0.0999  | 0.25  | 1.5   | 0        | -0.049           |
| stress | 8       | resume   | 675   | 0.9434  | 2.5   | 6.5   | 0.004444 | 0.1928           |
| stress | 16.67   | resume   | 675   | 1.1588  | 3     | 11.75 | 0.01037  | 0.0496           |
| stress | 25      | resume   | 675   | 1.5068  | 4.25  | 15.75 | 0.019259 | -0.1485          |
| stress | 33.33   | resume   | 675   | 1.7989  | 5.5   | 16    | 0.023704 | -0.1259          |
| stress | 50      | resume   | 675   | 2.3858  | 8     | 21.25 | 0.041481 | -0.3824          |

## Scheduler Delay Bins

| load   | scheduler bin | count  | mean     | p95  | p99   | >10px    | signed lead mean |
| ------ | ------------- | ------ | -------- | ---- | ----- | -------- | ---------------- |
| normal | missing       | 6      | 382.7636 | 1028 | 1028  | 0.5      |                  |
| normal | 1-4ms         | 32514  | 2.0753   | 5.25 | 21.5  | 0.02402  | -0.5541          |
| normal | <=1ms         | 542681 | 1.7387   | 4.5  | 19    | 0.020093 | -0.4355          |
| normal | 4-8ms         | 792    | 1.9878   | 5.5  | 37.5  | 0.02904  | 0.0959           |
| normal | >8ms          | 24     | 1.2003   | 3    | 3     | 0        | 0.3148           |
| stress | missing       | 6      | 0.0258   | 0    | 0     | 0        |                  |
| stress | 1-4ms         | 36828  | 1.9266   | 5.25 | 21.5  | 0.025606 | -0.9292          |
| stress | <=1ms         | 534794 | 1.8197   | 4.75 | 18.25 | 0.020956 | -0.6198          |
| stress | 4-8ms         | 4272   | 1.9245   | 6.75 | 18    | 0.029026 | -0.9504          |
| stress | >8ms          | 294    | 1.5679   | 4.5  | 7.75  | 0        | -1.0438          |

## Signed Lag / Lead Bias

Positive signed lead means prediction is ahead of causal motion direction; negative means lagging behind. Rows below are test moving segments.

| load   | horizon | signed count | mean signed lead | mean abs | lag rate | lead rate |
| ------ | ------- | ------------ | ---------------- | -------- | -------- | --------- |
| normal | 0       | 7454         | -0.0735          | 0.0978   | 0.045076 | 0.003756  |
| normal | 8       | 7454         | 0.0025           | 1.0999   | 0.277972 | 0.495036  |
| normal | 16.67   | 7454         | 0.1195           | 1.2968   | 0.33861  | 0.507781  |
| normal | 25      | 7454         | 0.0641           | 1.6151   | 0.405957 | 0.458412  |
| normal | 33.33   | 7454         | 0.0525           | 1.9659   | 0.421116 | 0.461363  |
| normal | 50      | 7454         | 0.0375           | 2.4863   | 0.432922 | 0.452911  |
| stress | 0       | 7395         | -0.0601          | 0.0843   | 0.039621 | 0.004462  |
| stress | 8       | 7395         | -0.1014          | 1.0268   | 0.274104 | 0.473428  |
| stress | 16.67   | 7395         | -0.1296          | 1.2489   | 0.350913 | 0.464909  |
| stress | 25      | 7395         | -0.2222          | 1.4923   | 0.395808 | 0.467884  |
| stress | 33.33   | 7395         | -0.2808          | 1.8334   | 0.440027 | 0.43881   |
| stress | 50      | 7395         | -0.4067          | 2.5379   | 0.460311 | 0.422718  |

## No-Scheduler-Delay Ablation

| model                                | objective | guard | mean   | p95  | p99   | resume p95 | resume p99 | >10px    |
| ------------------------------------ | --------- | ----- | ------ | ---- | ----- | ---------- | ---------- | -------- |
| no_scheduler_ridge_horizon_lambda0.1 | 71.1829   | yes   | 1.8166 | 4.75 | 20    | 24.25      | 62.5       | 0.021045 |
| no_scheduler_ridge_horizon_lambda1   | 71.2357   | yes   | 1.8178 | 4.75 | 20    | 24.25      | 62.5       | 0.02109  |
| no_scheduler_ridge_horizon_lambda10  | 71.3899   | yes   | 1.8316 | 4.75 | 20.25 | 24.5       | 62         | 0.02114  |
| no_scheduler_ridge_horizon_lambda3   | 74.5508   | no    | 1.8212 | 4.75 | 20    | 24.75      | 62.25      | 0.021095 |
| no_scheduler_ridge_horizon_lambda30  | 74.6277   | no    | 1.8497 | 4.75 | 20.5  | 24.75      | 61.75      | 0.021373 |
| no_scheduler_ridge_horizon_lambda100 | 76.3051   | no    | 1.8752 | 5    | 21    | 24.75      | 61.75      | 0.021956 |

## Missing Scheduler Investigation

| model                                           | load   | count | mean     | p95     | p99     | max       | >10px |
| ----------------------------------------------- | ------ | ----- | -------- | ------- | ------- | --------- | ----- |
| ls12_baseline                                   | normal | 6     | 382.7711 | 1028.25 | 1028.25 | 1028.2549 | 0.5   |
| step3_teacher_ridge_residual_segmented_horizon  | normal | 6     | 382.7713 | 1028    | 1028    | 1028.2033 | 0.5   |
| step4_vfsmn_small_velocity                      | normal | 6     | 382.7686 | 1028    | 1028    | 1028.2288 | 0.5   |
| guard_vfsmn_still_to_motion_t1.4_h25_to_teacher | normal | 6     | 382.7636 | 1028    | 1028    | 1028.2033 | 0.5   |
| ls12_baseline                                   | stress | 6     | 0        | 0       | 0       | 0         | 0     |
| step3_teacher_ridge_residual_segmented_horizon  | stress | 6     | 0.0344   | 0       | 0       | 0.0542    | 0     |
| step4_vfsmn_small_velocity                      | stress | 6     | 0.0195   | 0       | 0       | 0.0421    | 0     |
| guard_vfsmn_still_to_motion_t1.4_h25_to_teacher | stress | 6     | 0.0258   | 0       | 0       | 0.0542    | 0     |

## Interpretation

`guard_vfsmn_still_to_motion_t1.4_h25_to_teacher` passed validation guardrails and did not regress aggregate test p95/p99 versus the Step 3 teacher, but it did not materially improve tail. The guard mostly trades away part of Step 4's mean gain to avoid known resume-tail regressions. The remaining p99 failures are dominated by causal ambiguity in resume windows: the available history/stability/scheduler features can flag some risk, but not enough to choose the best fallback consistently. The analysis-only oracle best-of model shows tail headroom, so the limiting factor is the causal selector signal, not the three base predictors alone.

## Step 6 Recommendation

Step 6 should not treat the guarded mixture as a final replacement. Keep Step 3 teacher as the safety reference, carry the selected guard as a fallback design, and collect/emit explicit resume transition, warm-up, and scheduler-missing telemetry so a causal selector can target the oracle headroom.
