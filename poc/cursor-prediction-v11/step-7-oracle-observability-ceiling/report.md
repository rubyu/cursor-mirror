# Step 7 Oracle Observability Ceiling

## Intent

Step 7 estimates how close the current causal input can get to the best available replay candidates, and whether larger models are likely to help without additional telemetry. The evaluation contract remains the same as Steps 2-6: product poll anchors, causal referencePoll history, Step 1 split, and labels at anchor + horizon for 0, 8, 16.67, 25, 33.33, 50 ms.

## Oracle Metrics And Telemetry Proxies

Oracle rows are analysis-only. They either use the label directly, script/evaluation movement category, load id, or scenario-progress proxies.

| model                                       | load   | mean   | p95  | p99   | >10px    | p95 d vs S3 | p99 d vs S3 | >10 d vs S3 |
| ------------------------------------------- | ------ | ------ | ---- | ----- | -------- | ----------- | ----------- | ----------- |
| oracle_best_of_ls12_step3_step4_step5_step6 | normal | 1.5426 | 3.5  | 13.5  | 0.01337  | -0.5        | -3          | -0.002834   |
| oracle_best_of_ls12_step3_step4_step5_step6 | stress | 1.5716 | 4    | 12.75 | 0.014134 | -0.25       | -2.25       | -0.003967   |
| oracle_category_selector                    | normal | 1.8664 | 4    | 16.75 | 0.016038 | 0           | 0.25        | -0.000166   |
| oracle_category_selector                    | stress | 1.8804 | 4.25 | 15    | 0.01779  | 0           | 0           | -0.000311   |
| telemetry_proxy_category_load_horizon       | normal | 1.8594 | 4    | 16.5  | 0.015893 | 0           | 0           | -0.000311   |
| telemetry_proxy_category_load_horizon       | stress | 1.8808 | 4.25 | 15    | 0.018035 | 0           | 0           | -0.000066   |
| telemetry_proxy_category_progress_horizon   | normal | 1.8776 | 4    | 17    | 0.01636  | 0           | 0.5         | 0.000156    |
| telemetry_proxy_category_progress_horizon   | stress | 1.8865 | 4.25 | 15    | 0.017946 | 0           | 0           | -0.000155   |
| telemetry_proxy_warmup_scheduler_horizon    | normal | 1.8692 | 4    | 17    | 0.016338 | 0           | 0.5         | 0.000134    |
| telemetry_proxy_warmup_scheduler_horizon    | stress | 1.8857 | 4.25 | 15    | 0.018012 | 0           | 0           | -0.000089   |

## Product-Eligible Selector Metrics

Validation selected `causal_selector_stump_speedSpread_0p06079`. Guardrail passed: yes.

| model                                        | family                   | guard | objective | mean   | p95  | p99  | resume p95 | resume p99 |
| -------------------------------------------- | ------------------------ | ----- | --------- | ------ | ---- | ---- | ---------- | ---------- |
| causal_selector_stump_speedSpread_0p06079    | causal_stump_selector    | yes   | 55.8604   | 1.7862 | 4.75 | 20.5 | 24         | 60         |
| causal_selector_horizon_train_best           | causal_horizon_selector  | yes   | 55.9576   | 1.7869 | 4.75 | 20.5 | 23.75      | 60         |
| causal_selector_stump_ls12Speed_0            | causal_stump_selector    | yes   | 55.9634   | 1.7873 | 4.75 | 20.5 | 23.75      | 60         |
| causal_selector_constant_train_best          | causal_constant_selector | yes   | 55.9634   | 1.7879 | 4.75 | 20.5 | 23.75      | 60         |
| causal_selector_stump_horizon_0p5            | causal_stump_selector    | yes   | 55.9634   | 1.7879 | 4.75 | 20.5 | 23.75      | 60         |
| causal_selector_stump_horizon_0p6666         | causal_stump_selector    | yes   | 55.9634   | 1.7879 | 4.75 | 20.5 | 23.75      | 60         |
| causal_selector_stump_anchorGap_0p03562      | causal_stump_selector    | yes   | 55.9634   | 1.7879 | 4.75 | 20.5 | 23.75      | 60         |
| causal_selector_stump_anchorGap_0p05944      | causal_stump_selector    | yes   | 55.9634   | 1.7879 | 4.75 | 20.5 | 23.75      | 60         |
| causal_selector_stump_anchorGap_0p07538      | causal_stump_selector    | yes   | 55.9634   | 1.7879 | 4.75 | 20.5 | 23.75      | 60         |
| causal_selector_stump_schedulerDelay_0p00696 | causal_stump_selector    | yes   | 55.9634   | 1.7879 | 4.75 | 20.5 | 23.75      | 60         |

## Step 3 / 4 / 5 / 6 Comparison

| baseline                                       | load   | base mean | cand mean | mean d | base p95 | cand p95 | p95 d | base p99 | cand p99 | p99 d | signed d | lag d     |
| ---------------------------------------------- | ------ | --------- | --------- | ------ | -------- | -------- | ----- | -------- | -------- | ----- | -------- | --------- |
| step3_teacher_ridge_residual_segmented_horizon | normal | 1.8457    | 1.928     | 0.0823 | 4        | 4        | 0     | 16.5     | 17       | 0.5   | 0.4416   | -0.054568 |
| step3_teacher_ridge_residual_segmented_horizon | stress | 1.8665    | 1.9246    | 0.0581 | 4.25     | 4.25     | 0     | 15       | 15       | 0     | 0.3598   | -0.043094 |
| step4_vfsmn_small_velocity                     | normal | 1.8251    | 1.928     | 0.1029 | 4        | 4        | 0     | 16.5     | 17       | 0.5   | 0.4176   | -0.05     |
| step4_vfsmn_small_velocity                     | stress | 1.8492    | 1.9246    | 0.0754 | 4.25     | 4.25     | 0     | 15       | 15       | 0     | 0.3463   | -0.040239 |
| step5_guarded_selected                         | normal | 1.8364    | 1.928     | 0.0916 | 4        | 4        | 0     | 16.5     | 17       | 0.5   | 0.4311   | -0.052378 |
| step5_guarded_selected                         | stress | 1.8616    | 1.9246    | 0.063  | 4.25     | 4.25     | 0     | 15       | 15       | 0     | 0.3544   | -0.042348 |
| step6_timing_gain_1p15                         | normal | 1.8667    | 1.928     | 0.0613 | 4        | 4        | 0     | 17       | 17       | 0     | 0.1012   | -0.005799 |
| step6_timing_gain_1p15                         | stress | 1.8833    | 1.9246    | 0.0413 | 4.25     | 4.25     | 0     | 15       | 15       | 0     | 0.0516   | 0.007802  |

## Resume / Hold / Moving Breakdown

| load   | horizon | category | count | mean   | p95   | p99   | >10px    | signed lead |
| ------ | ------- | -------- | ----- | ------ | ----- | ----- | -------- | ----------- |
| normal | 0       | moving   | 12119 | 0.3105 | 1     | 1.75  | 0.000743 | -0.0416     |
| normal | 8       | moving   | 12119 | 1.2906 | 2.25  | 6.25  | 0.006931 | 0.0949      |
| normal | 16.67   | moving   | 12119 | 1.716  | 2.75  | 7.75  | 0.007591 | 0.4008      |
| normal | 25      | moving   | 12119 | 2.2327 | 3.5   | 11.25 | 0.011387 | 0.5548      |
| normal | 33.33   | moving   | 12119 | 2.6657 | 4.25  | 13    | 0.014193 | 0.6594      |
| normal | 50      | moving   | 12119 | 3.4005 | 6     | 19    | 0.020629 | 0.9651      |
| normal | 0       | hold     | 2121  | 0.1097 | 0.5   | 1.75  | 0.001414 | -0.1815     |
| normal | 8       | hold     | 2121  | 0.7201 | 2.5   | 14    | 0.014144 | 0.8368      |
| normal | 16.67   | hold     | 2121  | 0.9507 | 3.5   | 19.25 | 0.020273 | 2.2067      |
| normal | 25      | hold     | 2121  | 1.2429 | 4.75  | 27.25 | 0.030646 | 3.8547      |
| normal | 33.33   | hold     | 2121  | 1.5381 | 6.25  | 32.75 | 0.035832 | 6.3813      |
| normal | 50      | hold     | 2121  | 2.0595 | 9.5   | 41.5  | 0.048562 | 10.8483     |
| normal | 0       | resume   | 756   | 0.309  | 1     | 2.75  | 0.003968 | -0.4514     |
| normal | 8       | resume   | 756   | 2.241  | 8.5   | 42.75 | 0.044974 | -2.4199     |
| normal | 16.67   | resume   | 756   | 2.6257 | 12.25 | 39.75 | 0.054233 | -3.5087     |
| normal | 25      | resume   | 756   | 4.0535 | 20.75 | 46.5  | 0.083333 | -5.4963     |
| normal | 33.33   | resume   | 756   | 5.7786 | 29    | 64.5  | 0.119048 | -7.5611     |
| normal | 50      | resume   | 756   | 9.6742 | 48.25 | 104.5 | 0.199735 | -11.5792    |
| stress | 0       | moving   | 11874 | 0.3006 | 1     | 1.75  | 0.000505 | -0.0634     |
| stress | 8       | moving   | 11874 | 1.2709 | 2.75  | 8.25  | 0.008085 | -0.0324     |
| stress | 16.67   | moving   | 11874 | 1.5173 | 3     | 10.5  | 0.011033 | 0.1015      |
| stress | 25      | moving   | 11874 | 1.8586 | 4     | 14    | 0.017517 | 0.2039      |
| stress | 33.33   | moving   | 11874 | 2.2616 | 4.75  | 16.5  | 0.02316  | 0.2714      |
| stress | 50      | moving   | 11874 | 3.1564 | 6.75  | 26.5  | 0.033855 | 0.4086      |
| stress | 0       | hold     | 2450  | 0.2784 | 1     | 2.25  | 0.001633 | -0.0938     |
| stress | 8       | hold     | 2450  | 1.8477 | 3.75  | 12.25 | 0.013061 | -0.4466     |
| stress | 16.67   | hold     | 2450  | 2.5159 | 4.5   | 13.75 | 0.017551 | -0.501      |
| stress | 25      | hold     | 2450  | 3.4739 | 6.5   | 17    | 0.030204 | -0.4743     |
| stress | 33.33   | hold     | 2450  | 4.17   | 8.5   | 19    | 0.045714 | -0.4466     |
| stress | 50      | hold     | 2450  | 5.952  | 12.25 | 29.5  | 0.058776 | -0.5606     |
| stress | 0       | resume   | 675   | 0.2274 | 0.75  | 1.5   | 0        | -0.0387     |
| stress | 8       | resume   | 675   | 0.9747 | 2.5   | 6.75  | 0.004444 | 0.2828      |
| stress | 16.67   | resume   | 675   | 1.1759 | 3     | 10.75 | 0.011852 | 0.3005      |
| stress | 25      | resume   | 675   | 1.5057 | 4.25  | 15    | 0.017778 | 0.2953      |
| stress | 33.33   | resume   | 675   | 1.8114 | 5.5   | 15.5  | 0.026667 | 0.456       |
| stress | 50      | resume   | 675   | 2.3655 | 7     | 22.25 | 0.038519 | 0.473       |

## History Ambiguity

Nearest-neighbor analysis uses sampled train references and sampled validation queries in causal feature space, constrained to the same requested horizon. Future divergence compares target displacement vectors, not absolute screen position.

| segment    | queries | dist median | dist p90 | future div p90 | future div p95 | close gt10 | close gt25 | close oracle differs |
| ---------- | ------- | ----------- | -------- | -------------- | -------------- | ---------- | ---------- | -------------------- |
| overall    | 5000    | 0.1165      | 0.5382   | 8.2462         | 12.6491        | 0.028      | 0.0016     | 0.364                |
| resumeTail | 2500    | 0.0714      | 0.6326   | 22.8035        | 42.19          | 0.0768     | 0.0224     | 0.5264               |

## Telemetry Priority

1. Prediction target timestamp and present/compositor timestamp: Step 6 showed signed lag is movable, but tail can regress without knowing the actual presentation target.
2. Explicit hold/resume transition telemetry: resume-tail ambiguity remains high, and category/proxy oracles show headroom that causal history selectors do not reach.
3. Warm-up/missing scheduler marker: tiny missing-scheduler buckets create extreme outliers and should be separable before learning.
4. Causal transition-age features: time since last hold/resume-like state is the product-shaped version of the analysis-only movement category proxy.
5. Runtime scheduler/poll gap provenance: scheduler delay is useful only if its meaning is stable across normal/stress and warm-up.

## Zero-Error Feasibility

Current candidate diversity has real headroom: oracle best-of reaches normal p95 3.5px / p99 13.5px and stress p95 4px / p99 12.75px, but this oracle uses the label. Product-eligible causal selectors do not close that gap. Resume-tail nearest-neighbor collisions show close causal histories with future divergence >10px at rate 0.0768 and oracle-best mismatch rate 0.5264. Near-zero error is therefore not plausible from the current inputs alone; larger models may overfit selectors unless the runtime records transition/timing telemetry that makes those collisions separable.

## Step 8 Recommendation

Step 8 should prioritize instrumentation over larger model search: add explicit prediction target/present timestamps, hold/resume transition age, warm-up/missing scheduler markers, and scheduler provenance to MotionLab/TraceTool, then rerun Steps 3-7 with those causal fields.
