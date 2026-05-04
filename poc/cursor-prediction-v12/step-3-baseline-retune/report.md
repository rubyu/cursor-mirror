# Step 3 Baseline Retune

## Scope

This step re-evaluates deterministic product-safe baselines on the clean POC 12 split manifest. It uses only CPU, runs sequentially, reads the source ZIP files directly, and writes only aggregate Markdown/JSON artifacts.

Anchor rows are clean `poll` and `runtimeSchedulerPoll` events. Predictor history is limited to clean causal `referencePoll` rows at or before each anchor.

## Source Summary

| pkg     | refresh | machine                   | reference | poll anchors | scheduler anchors | labels |
| ------- | ------- | ------------------------- | --------- | ------------ | ----------------- | ------ |
| m070055 | 30Hz    | 6cpu_3840x2160_1mon_30Hz  | 274099    | 94512        | 22683             | 468770 |
| m070211 | 30Hz    | 6cpu_3840x2160_1mon_30Hz  | 259597    | 95954        | 23029             | 475915 |
| m070248 | 60Hz    | 24cpu_2560x1440_1mon_60Hz | 258693    | 95907        | 45857             | 567050 |
| m070307 | 60Hz    | 32cpu_7680x1440_3mon_60Hz | 234959    | 95945        | 44768             | 562840 |

## Baseline Ranking

Selection metric: validation runtimeSchedulerPoll + v9_target lowest p95, then mean.

Selected baseline: `constant_position`.

Best non-constant prediction candidate: `least_squares_n12_gain100_cap24`.

Current product-equivalent baseline: `product_current_cv_gain100_cap12_24_hcap10_offset2`, validation runtimeScheduler/v9_target p95=10 px, mean=2.122 px.

| rank | model                           | family                  | product equiv | count | mean   | p95  | p99   | signed mean | lag rate |
| ---- | ------------------------------- | ----------------------- | ------------- | ----- | ------ | ---- | ----- | ----------- | -------- |
| 1    | constant_position               | constant_position       | no            | 21420 | 0.5851 | 2    | 8.25  | -1.9426     | 0.998416 |
| 2    | least_squares_n12_gain100_cap24 | least_squares           | no            | 21420 | 0.7896 | 2.5  | 7.75  | -1.3913     | 0.81943  |
| 3    | least_squares_n12_gain100_cap48 | least_squares           | no            | 21420 | 0.7896 | 2.5  | 7.75  | -1.3913     | 0.81943  |
| 4    | least_squares_n8_gain75_cap24   | least_squares           | no            | 21420 | 0.8079 | 2.5  | 8.5   | -1.5286     | 0.856917 |
| 5    | least_squares_n8_gain100_cap24  | least_squares           | no            | 21420 | 0.8901 | 2.75 | 9.25  | -1.3939     | 0.819958 |
| 6    | least_squares_n8_gain100_cap48  | least_squares           | no            | 21420 | 0.8904 | 2.75 | 9.25  | -1.3906     | 0.819958 |
| 7    | least_squares_n8_gain125_cap24  | least_squares           | no            | 21420 | 0.976  | 3    | 10    | -1.2599     | 0.787751 |
| 8    | least_squares_n5_gain100_cap24  | least_squares           | no            | 21420 | 1.259  | 4    | 14.25 | -1.4125     | 0.818902 |
| 9    | least_squares_n5_gain100_cap48  | least_squares           | no            | 21420 | 1.2691 | 4    | 14.25 | -1.3923     | 0.818902 |
| 10   | last2_cv_gain75_cap12           | last2_constant_velocity | no            | 21420 | 1.4418 | 5.75 | 12    | -1.5636     | 0.903907 |

## Selected Baseline Scores

| anchor               | horizon              | split      | count | mean   | median | p95  | p99   | signed mean | lag rate |
| -------------------- | -------------------- | ---------- | ----- | ------ | ------ | ---- | ----- | ----------- | -------- |
| poll                 | fixed_16p67ms        | test       | 58274 | 2.3056 | 1.25   | 6.25 | 24.25 | -3.4398     | 0.998876 |
| poll                 | fixed_16p67ms        | validation | 59996 | 2.4084 | 1.25   | 8    | 26    | -3.3541     | 0.997929 |
| runtimeSchedulerPoll | fixed_16p67ms        | test       | 21004 | 2.0163 | 1      | 6    | 21    | -3.312      | 0.998024 |
| runtimeSchedulerPoll | fixed_16p67ms        | validation | 21420 | 2.0005 | 1      | 6.25 | 22.5  | -3.3006     | 0.998995 |
| poll                 | fixed_8ms            | test       | 58274 | 1.2394 | 0      | 4    | 13.75 | -1.8349     | 0.999604 |
| poll                 | fixed_8ms            | validation | 59996 | 1.3329 | 0      | 4.25 | 17    | -1.7045     | 0.999096 |
| runtimeSchedulerPoll | fixed_8ms            | test       | 21004 | 0.979  | 0      | 3.5  | 11    | -1.8968     | 0.999461 |
| runtimeSchedulerPoll | fixed_8ms            | validation | 21420 | 1.0094 | 0      | 3.5  | 14    | -1.9228     | 0.999465 |
| poll                 | v9_present_corrected | test       | 58274 | 1.8832 | 1      | 6    | 21    | -3.1831     | 0.999262 |
| poll                 | v9_present_corrected | validation | 59996 | 2.0107 | 0.75   | 7.25 | 22.75 | -3.0695     | 0.997636 |
| runtimeSchedulerPoll | v9_present_corrected | test       | 21004 | 0.5505 | 0      | 2.25 | 6.25  | -1.9509     | 0.999475 |
| runtimeSchedulerPoll | v9_present_corrected | validation | 21420 | 0.5851 | 0      | 2    | 8.25  | -1.9426     | 0.998416 |
| poll                 | v9_target            | test       | 58274 | 1.8832 | 1      | 6    | 21    | -3.1831     | 0.999262 |
| poll                 | v9_target            | validation | 59996 | 2.0107 | 0.75   | 7.25 | 22.75 | -3.0695     | 0.997636 |
| runtimeSchedulerPoll | v9_target            | test       | 21004 | 0.5505 | 0      | 2.25 | 6.25  | -1.9509     | 0.999475 |
| runtimeSchedulerPoll | v9_target            | validation | 21420 | 0.5851 | 0      | 2    | 8.25  | -1.9426     | 0.998416 |

## Holdout Signals

| holdout                           | kind    | train n | train p95 | test n | test p95 | test-train p95 |
| --------------------------------- | ------- | ------- | --------- | ------ | -------- | -------------- |
| machine:24cpu_2560x1440_1mon_60Hz | machine | 90480   | 2.75      | 45857  | 2        | -0.75          |
| machine:32cpu_7680x1440_3mon_60Hz | machine | 91569   | 2.75      | 44768  | 2        | -0.75          |
| machine:6cpu_3840x2160_1mon_30Hz  | machine | 90625   | 2         | 45712  | 3        | 1              |
| refresh:30Hz                      | refresh | 90625   | 2         | 45712  | 3        | 1              |
| refresh:60Hz                      | refresh | 45712   | 3         | 90625  | 2        | -1             |

Positive holdout deltas indicate a potential cross-machine or cross-refresh regression risk. These rows are diagnostic only; no model was trained in this step.

## Interpretation

- Runtime scheduler anchors have the most production-like timing, so the selected baseline is chosen there.
- The p95 winner is `constant_position`, which is useful as a low-horizon floor but is not a good stand-alone prediction strategy because its signed error is almost always lagging during motion.
- The best non-constant candidate is the better next implementation target.
- `v9_target` is the most relevant horizon mode for runtime scheduler rows because it uses the target vblank recorded by the runtime scheduler.
- Fixed horizons remain useful as controls, but they mix 30Hz and 60Hz assumptions and can over-project scheduler rows that are already close to vblank.
