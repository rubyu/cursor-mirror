# Step 4 FSMN Family Search

## Intent

This step searches CPU-deployable finite-memory residual models named as FSMN-family variants. The evaluation contract is unchanged from Steps 2/3: product `poll` anchor, causal `referencePoll` history, horizons 0, 8, 16.67, 25, 33.33, 50 ms, and Step 1 scenario split. Validation selects the best model; test is read once after selection.

Step 3 best, `ridge_residual_segmented_horizon`, is included as `step3_teacher_ridge_residual_segmented_horizon` and used as the comparison/teacher baseline.

## Data Split / Sources

| load id | zip                                                | label       |
| ------- | -------------------------------------------------- | ----------- |
| normal  | cursor-mirror-motion-recording-20260503-212556.zip | normal load |
| stress  | cursor-mirror-motion-recording-20260503-215632.zip | stress load |

Split is scenario-level and reused for normal/stress to avoid leakage through near-identical motion scripts.

| split      | scenario count | scenario indices                                                                                                                                                       |
| ---------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| train      | 44             | 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16, 17, 19, 20, 22, 25, 27, 28, 31, 33, 36, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 60, 62, 63 |
| validation | 10             | 1, 21, 24, 26, 30, 32, 35, 39, 53, 61                                                                                                                                  |
| test       | 10             | 0, 11, 12, 14, 18, 23, 29, 34, 37, 59                                                                                                                                  |

## CPU Feature Audit

Processor: `AMD Ryzen 9 9950X3D 16-Core Processor          `, logical CPUs: 32.

Detected: AVX=true, AVX2=true, FMA3=true, AVX-512F=true.

| profile         | lanes | available | unknown required | requires   |
| --------------- | ----- | --------- | ---------------- | ---------- |
| scalar_safe     | 1     | yes       | none             | none       |
| avx_fma         | 8     | yes       | none             | avx, fma3  |
| avx2_fma        | 8     | yes       | none             | avx2, fma3 |
| avx512f         | 16    | yes       | none             | avx512f    |
| avx512_accuracy | 16    | yes       | none             | avx512f    |

## Family Definitions

| family   | definition                                                                                    |
| -------- | --------------------------------------------------------------------------------------------- |
| FSMN     | Horizon-aware finite-memory residual over the Step 3 causal feature vector.                   |
| CSFSMN   | Context-sensitive FSMN segmented by horizon and scheduler-delay context.                      |
| VFSMN    | Velocity-focused FSMN using LS12/LS8/last2 velocity projections and speed.                    |
| VFSMNv2  | Velocity FSMN plus acceleration/history stability and a causal resume-tail guard.             |
| CVFSMN   | Compact convolutional-style finite-memory model using history aggregates and velocity memory. |
| CVFSMNv2 | Compact FSMN v2 with scheduler context, stability features, and guarded tail correction.      |

## CPU Profile / Model Designs

| model                       | family   | size     | product eligible | segment               | channels | taps |
| --------------------------- | -------- | -------- | ---------------- | --------------------- | -------- | ---- |
| FSMN_small_horizon          | FSMN     | small    | yes              | horizon               | 12       | 4    |
| FSMN_medium_horizon         | FSMN     | medium   | yes              | horizon               | 24       | 8    |
| CSFSMN_medium_sched         | CSFSMN   | medium   | yes              | horizonScheduler      | 24       | 8    |
| CSFSMN_large_sched_speed    | CSFSMN   | large    | yes              | horizonSchedulerSpeed | 32       | 12   |
| VFSMN_small_velocity        | VFSMN    | small    | yes              | horizon               | 16       | 6    |
| VFSMN_medium_velocity       | VFSMN    | medium   | yes              | horizonSpeed          | 24       | 8    |
| VFSMNv2_medium_guarded      | VFSMNv2  | medium   | yes              | horizonSpeed          | 24       | 10   |
| CVFSMN_small_compact        | CVFSMN   | small    | yes              | horizon               | 16       | 6    |
| CVFSMN_medium_compact_sched | CVFSMN   | medium   | yes              | horizonScheduler      | 24       | 8    |
| CVFSMNv2_medium_guarded     | CVFSMNv2 | medium   | yes              | horizonSchedulerSpeed | 32       | 12   |
| CVFSMNv2_large_guarded      | CVFSMNv2 | large    | yes              | horizonSchedulerSpeed | 48       | 16   |
| CSFSMN_loadaware_analysis   | CSFSMN   | analysis | no               | horizonLoad           | 24       | 8    |

## Validation Selection

| rank | model                                          | family        | count  | mean px | p95 px | p99 px |
| ---- | ---------------------------------------------- | ------------- | ------ | ------- | ------ | ------ |
| 1    | VFSMN_small_velocity                           | VFSMN         | 179994 | 1.788   | 4.75   | 19.875 |
| 2    | FSMN_small_horizon                             | FSMN          | 179994 | 1.788   | 4.75   | 20.125 |
| 3    | VFSMN_medium_velocity                          | VFSMN         | 179994 | 1.805   | 4.75   | 20     |
| 4    | FSMN_medium_horizon                            | FSMN          | 179994 | 1.817   | 4.875  | 19.875 |
| 5    | step3_teacher_ridge_residual_segmented_horizon | step3_teacher | 179994 | 1.817   | 4.875  | 19.875 |
| 6    | CSFSMN_medium_sched                            | CSFSMN        | 179994 | 1.824   | 4.875  | 20     |
| 7    | CSFSMN_large_sched_speed                       | CSFSMN        | 179994 | 1.871   | 4.875  | 20.25  |
| 8    | CVFSMN_small_compact                           | CVFSMN        | 179994 | 1.872   | 5      | 21.5   |
| 9    | CVFSMN_medium_compact_sched                    | CVFSMN        | 179994 | 1.882   | 5      | 21.5   |
| 10   | VFSMNv2_medium_guarded                         | VFSMNv2       | 179994 | 1.89    | 5      | 21     |

Selected for test comparison: `VFSMN_small_velocity`.

## Delta Vs Step 3 Teacher

| split      | load   | teacher p95 | candidate p95 | p95 delta | teacher p99 | candidate p99 | p99 delta | >5px delta | >10px delta |
| ---------- | ------ | ----------- | ------------- | --------- | ----------- | ------------- | --------- | ---------- | ----------- |
| validation | normal | 5           | 5             | 0         | 23.25       | 23.25         | 0         | -0.00043   | 0.00006     |
| validation | stress | 4.75        | 4.5           | -0.25     | 16.5        | 16.5          | 0         | -0.00152   | 0           |
| test       | normal | 4           | 4             | 0         | 16.5        | 16.5          | 0         | -0.00028   | -0.00013    |
| test       | stress | 4.25        | 4.25          | 0         | 15          | 15            | 0         | 0.0002     | -0.00007    |

## Test Horizon Breakdown

| load   | horizon ms | teacher p95 | candidate p95 | p95 delta | teacher p99 | candidate p99 | p99 delta |
| ------ | ---------- | ----------- | ------------- | --------- | ----------- | ------------- | --------- |
| normal | 0          | 0.5         | 0.5           | 0         | 1.75        | 1.75          | 0         |
| normal | 8          | 2.5         | 2.5           | 0         | 9.5         | 9.5           | 0         |
| normal | 16.67      | 2.75        | 2.75          | 0         | 13.25       | 13.25         | 0         |
| normal | 25         | 4           | 3.75          | -0.25     | 18.5        | 18.25         | -0.25     |
| normal | 33.33      | 4.5         | 4.5           | 0         | 24.25       | 24.25         | 0         |
| normal | 50         | 6.5         | 6.5           | 0         | 35.5        | 35.25         | -0.25     |
| stress | 0          | 0.5         | 0.5           | 0         | 1.75        | 1.75          | 0         |
| stress | 8          | 3           | 3             | 0         | 9           | 9             | 0         |
| stress | 16.67      | 3.25        | 3.25          | 0         | 11.5        | 11.5          | 0         |
| stress | 25         | 4.25        | 4.25          | 0         | 14.75       | 15            | 0.25      |
| stress | 33.33      | 5           | 5             | 0         | 18          | 18            | 0         |
| stress | 50         | 7.25        | 7.25          | 0         | 26.25       | 26.25         | 0         |

## Movement Category / Horizon Breakdown

| split      | load   | horizon ms | category | count | mean px | p95 px | p99 px | >5px    | >10px   |
| ---------- | ------ | ---------- | -------- | ----- | ------- | ------ | ------ | ------- | ------- |
| test       | normal | 0          | hold     | 2121  | 0.068   | 0      | 1      | 0.00283 | 0.00141 |
| test       | normal | 0          | moving   | 12119 | 0.13    | 0.5    | 1.75   | 0.00182 | 0.00074 |
| test       | normal | 0          | resume   | 756   | 0.248   | 1      | 2.5    | 0.00529 | 0.00397 |
| test       | normal | 8          | hold     | 2121  | 0.677   | 2.25   | 14.25  | 0.02923 | 0.01462 |
| test       | normal | 8          | moving   | 12119 | 1.244   | 2.25   | 6.25   | 0.01403 | 0.00685 |
| test       | normal | 8          | resume   | 756   | 2.221   | 7.5    | 43     | 0.0873  | 0.04365 |
| test       | normal | 16.67      | hold     | 2121  | 0.866   | 3      | 17.25  | 0.03489 | 0.01933 |
| test       | normal | 16.67      | moving   | 12119 | 1.646   | 2.5    | 7.25   | 0.01634 | 0.00767 |
| test       | normal | 16.67      | resume   | 756   | 2.701   | 13.5   | 40.5   | 0.10185 | 0.05423 |
| test       | normal | 25         | hold     | 2121  | 1.105   | 3.75   | 24.75  | 0.0429  | 0.02829 |
| test       | normal | 25         | moving   | 12119 | 2.14    | 3.25   | 10.75  | 0.02376 | 0.01089 |
| test       | normal | 25         | resume   | 756   | 4.209   | 21.5   | 48.5   | 0.17989 | 0.09259 |
| test       | normal | 33.33      | hold     | 2121  | 1.369   | 5.5    | 30.75  | 0.05375 | 0.03348 |
| test       | normal | 33.33      | moving   | 12119 | 2.556   | 4      | 13.5   | 0.03218 | 0.01444 |
| test       | normal | 33.33      | resume   | 756   | 5.986   | 31.25  | 71.75  | 0.24735 | 0.12302 |
| test       | normal | 50         | hold     | 2121  | 1.819   | 8      | 38.25  | 0.06836 | 0.04526 |
| test       | normal | 50         | moving   | 12119 | 3.223   | 5.25   | 19.25  | 0.06387 | 0.02104 |
| test       | normal | 50         | resume   | 756   | 9.929   | 48.5   | 109    | 0.36773 | 0.20767 |
| test       | stress | 0          | hold     | 2450  | 0.139   | 0.5    | 2      | 0.00449 | 0.00163 |
| test       | stress | 0          | moving   | 11874 | 0.117   | 0.5    | 1.75   | 0.0011  | 0.00051 |
| test       | stress | 0          | resume   | 675   | 0.1     | 0.25   | 1.5    | 0.00148 | 0       |
| test       | stress | 8          | hold     | 2450  | 1.792   | 3.75   | 12.5   | 0.03469 | 0.01347 |
| test       | stress | 8          | moving   | 11874 | 1.225   | 3      | 8.25   | 0.02173 | 0.00825 |
| test       | stress | 8          | resume   | 675   | 0.943   | 2.5    | 6.5    | 0.01778 | 0.00444 |
| test       | stress | 16.67      | hold     | 2450  | 2.452   | 4.75   | 13.25  | 0.04857 | 0.01714 |
| test       | stress | 16.67      | moving   | 11874 | 1.491   | 3.25   | 11     | 0.02594 | 0.01171 |
| test       | stress | 16.67      | resume   | 675   | 1.159   | 3      | 11.75  | 0.03259 | 0.01037 |
| test       | stress | 25         | hold     | 2450  | 3.386   | 6.25   | 17.25  | 0.06653 | 0.02939 |
| test       | stress | 25         | moving   | 11874 | 1.816   | 4      | 14.5   | 0.03638 | 0.01777 |
| test       | stress | 25         | resume   | 675   | 1.486   | 4      | 16.25  | 0.04    | 0.01926 |
| test       | stress | 33.33      | hold     | 2450  | 4.129   | 8.75   | 18.5   | 0.07796 | 0.04122 |
| test       | stress | 33.33      | moving   | 11874 | 2.201   | 4.5    | 17.5   | 0.04657 | 0.02459 |
| test       | stress | 33.33      | resume   | 675   | 1.762   | 5.5    | 16.5   | 0.0563  | 0.0237  |
| test       | stress | 50         | hold     | 2450  | 5.813   | 12.5   | 27.75  | 0.1098  | 0.06327 |
| test       | stress | 50         | moving   | 11874 | 3.069   | 6.5    | 26.5   | 0.09037 | 0.03386 |
| test       | stress | 50         | resume   | 675   | 2.342   | 8      | 21.25  | 0.08444 | 0.04296 |
| validation | normal | 0          | hold     | 3258  | 0.059   | 0      | 1      | 0.00092 | 0.00092 |
| validation | normal | 0          | moving   | 11021 | 0.191   | 1      | 2.5    | 0.00272 | 0.00109 |
| validation | normal | 0          | resume   | 720   | 0.293   | 0.5    | 6.5    | 0.01528 | 0.00694 |
| validation | normal | 8          | hold     | 3258  | 0.736   | 2      | 15.75  | 0.02855 | 0.0175  |
| validation | normal | 8          | moving   | 11021 | 1.681   | 4      | 13.25  | 0.03267 | 0.01379 |
| validation | normal | 8          | resume   | 720   | 2.501   | 9.75   | 37.75  | 0.11389 | 0.05    |
| validation | normal | 16.67      | hold     | 3258  | 0.856   | 2.5    | 20.25  | 0.02885 | 0.02026 |
| validation | normal | 16.67      | moving   | 11021 | 1.788   | 3.75   | 13.75  | 0.03203 | 0.01488 |
| validation | normal | 16.67      | resume   | 720   | 3.167   | 15.5   | 36     | 0.14028 | 0.08333 |
| validation | normal | 25         | hold     | 3258  | 1.039   | 3      | 25     | 0.03622 | 0.02548 |
| validation | normal | 25         | moving   | 11021 | 2.219   | 4.5    | 17.5   | 0.04464 | 0.02033 |
| validation | normal | 25         | resume   | 720   | 4.83    | 26     | 42     | 0.20694 | 0.11528 |
| validation | normal | 33.33      | hold     | 3258  | 1.282   | 3.75   | 33.5   | 0.0399  | 0.02947 |
| validation | normal | 33.33      | moving   | 11021 | 2.575   | 6      | 23     | 0.07549 | 0.02468 |
| validation | normal | 33.33      | resume   | 720   | 7.335   | 38.25  | 74.5   | 0.27639 | 0.175   |
| validation | normal | 50         | hold     | 3258  | 1.675   | 5.5    | 44     | 0.05556 | 0.03223 |
| validation | normal | 50         | moving   | 11021 | 3.43    | 7      | 32.5   | 0.10698 | 0.03521 |
| validation | normal | 50         | resume   | 720   | 12.333  | 57     | 119    | 0.44306 | 0.24306 |
| validation | stress | 0          | hold     | 3329  | 0.167   | 0.5    | 3.25   | 0.00601 | 0.0021  |
| validation | stress | 0          | moving   | 10998 | 0.119   | 0.5    | 1.75   | 0.00082 | 0.00046 |
| validation | stress | 0          | resume   | 673   | 0.119   | 0.25   | 1.75   | 0.00149 | 0       |
| validation | stress | 8          | hold     | 3329  | 1.354   | 5.5    | 15.5   | 0.05527 | 0.02643 |
| validation | stress | 8          | moving   | 10998 | 1.393   | 3.75   | 7.5    | 0.02555 | 0.00818 |
| validation | stress | 8          | resume   | 673   | 1.748   | 8.75   | 29.25  | 0.07875 | 0.04458 |
| validation | stress | 16.67      | hold     | 3329  | 1.583   | 6.25   | 20     | 0.06458 | 0.02794 |
| validation | stress | 16.67      | moving   | 10998 | 1.521   | 3.5    | 9      | 0.02246 | 0.009   |
| validation | stress | 16.67      | resume   | 673   | 1.693   | 6.75   | 27.5   | 0.06984 | 0.03269 |
| validation | stress | 25         | hold     | 3329  | 1.988   | 8.25   | 25.5   | 0.08261 | 0.04115 |
| validation | stress | 25         | moving   | 10998 | 1.711   | 4      | 10     | 0.02473 | 0.01046 |
| validation | stress | 25         | resume   | 673   | 2.246   | 9      | 43     | 0.08321 | 0.04755 |
| validation | stress | 33.33      | hold     | 3329  | 2.48    | 11.5   | 33.25  | 0.09823 | 0.06038 |
| validation | stress | 33.33      | moving   | 10998 | 1.996   | 4.25   | 12     | 0.03228 | 0.01291 |
| validation | stress | 33.33      | resume   | 673   | 2.67    | 11.5   | 43.5   | 0.09658 | 0.05349 |
| validation | stress | 50         | hold     | 3329  | 3.514   | 15.5   | 45     | 0.13968 | 0.08291 |
| validation | stress | 50         | moving   | 10998 | 2.84    | 6.25   | 22.25  | 0.09929 | 0.02355 |
| validation | stress | 50         | resume   | 673   | 3.764   | 17.5   | 67.75  | 0.1471  | 0.07727 |

## Scheduler Delay Breakdown

| load   | scheduler bin | count  | mean px | p95 px | p99 px | >10px   |
| ------ | ------------- | ------ | ------- | ------ | ------ | ------- |
| normal | <=1ms         | 542681 | 1.728   | 4.5    | 19     | 0.02009 |
| normal | >8ms          | 24     | 1.245   | 3      | 3.25   | 0       |
| normal | 1-4ms         | 32514  | 2.059   | 5.25   | 21.5   | 0.02384 |
| normal | 4-8ms         | 792    | 1.956   | 5.5    | 37.5   | 0.02904 |
| normal | missing       | 6      | 382.769 | 1028   | 1028   | 0.5     |
| stress | <=1ms         | 534794 | 1.806   | 4.75   | 18.25  | 0.02097 |
| stress | >8ms          | 294    | 1.572   | 4.5    | 8.25   | 0       |
| stress | 1-4ms         | 36828  | 1.908   | 5.25   | 21.5   | 0.02552 |
| stress | 4-8ms         | 4272   | 1.904   | 6.75   | 18     | 0.02973 |
| stress | missing       | 6      | 0.02    | 0      | 0      | 0       |

## Resume Tail Regression Check

| split      | load   | horizon ms | category | count | teacher p95 | candidate p95 | p95 delta | teacher p99 | candidate p99 | p99 delta |
| ---------- | ------ | ---------- | -------- | ----- | ----------- | ------------- | --------- | ----------- | ------------- | --------- |
| test       | normal | 25         | hold     | 2121  | 3.5         | 3.75          | 0.25      | 23.5        | 24.75         | 1.25      |
| validation | normal | 0          | moving   | 11021 | 0.75        | 1             | 0.25      | 2.5         | 2.5           | 0         |
| test       | stress | 50         | resume   | 675   | 7.75        | 8             | 0.25      | 21.25       | 21.25         | 0         |
| validation | normal | 8          | moving   | 11021 | 3.75        | 4             | 0.25      | 13.5        | 13.25         | -0.25     |
| test       | normal | 25         | resume   | 756   | 21.5        | 21.5          | 0         | 47.5        | 48.5          | 1         |
| test       | stress | 16.67      | resume   | 675   | 3           | 3             | 0         | 11.25       | 11.75         | 0.5       |
| test       | stress | 33.33      | resume   | 675   | 5.5         | 5.5           | 0         | 16          | 16.5          | 0.5       |
| validation | normal | 16.67      | moving   | 11021 | 3.75        | 3.75          | 0         | 13.5        | 13.75         | 0.25      |
| test       | stress | 8          | hold     | 2450  | 3.75        | 3.75          | 0         | 12.25       | 12.5          | 0.25      |
| validation | stress | 25         | hold     | 3329  | 8.25        | 8.25          | 0         | 25.25       | 25.5          | 0.25      |
| validation | normal | 16.67      | hold     | 3258  | 2.5         | 2.5           | 0         | 20          | 20.25         | 0.25      |
| validation | normal | 33.33      | hold     | 3258  | 3.75        | 3.75          | 0         | 33.25       | 33.5          | 0.25      |

## Deployability Estimate For Selected Model

| profile         | available | dim | segments | params | MACs | vector ops | lane utilization |
| --------------- | --------- | --- | -------- | ------ | ---- | ---------- | ---------------- |
| scalar_safe     | yes       | 14  | 6        | 168    | 28   | 28         | 1                |
| avx_fma         | yes       | 14  | 6        | 168    | 28   | 4          | 0.875            |
| avx2_fma        | yes       | 14  | 6        | 168    | 28   | 4          | 0.875            |
| avx512f         | yes       | 14  | 6        | 168    | 28   | 2          | 0.875            |
| avx512_accuracy | yes       | 14  | 6        | 168    | 28   | 2          | 0.875            |

## Step 5 Recommendation

Carry `VFSMN_small_velocity` forward only as a design reference if its test tail is no worse than the Step 3 teacher. If it does not beat the teacher, keep `ridge_residual_segmented_horizon` as the production-safe teacher and use Step 5 to search a guarded VFSMNv2/CVFSMNv2 with explicit resume-tail loss. Missing ingredients toward near-zero error are: stronger resume-state inference from causal history, tail-aware loss/selection, and a no-scheduler-delay ablation for runtimes that cannot expose scheduler timing to the predictor.
