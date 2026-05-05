# Step 5 State-Gated Search

## Scope

This step searches product-safe state gates using `runtimeSchedulerPoll + v9_target` as the main evaluation contract. Candidate inputs are causal referencePoll history, v9 target horizon, scheduler provenance, refresh bucket, history gap, speed, and path stability. Motion phase is used only for analysis breakdowns.

No GPU, checkpoint, raw ZIP copy, or large intermediate file was used.

## Selected Gate

Selected model: `gate_s25_net0_eff35_ls12_g100_cap12_off-2`

Objective: p95 + 0.25*p99 + weighted >5/>10px + signed lag penalties

Candidates evaluated: 4320

## Validation Ranking

| rank | model                                     | count | mean   | p95 | p99 | >5       | >10      | signed mean | objective |
| ---- | ----------------------------------------- | ----- | ------ | --- | --- | -------- | -------- | ----------- | --------- |
| 1    | gate_s25_net0_eff35_ls12_g100_cap12_off-2 | 21419 | 0.6735 | 2   | 7.5 | 0.017741 | 0.007657 | -1.681      | 5.0766    |
| 2    | gate_s25_net0_eff35_ls12_g100_cap24_off-2 | 21419 | 0.6735 | 2   | 7.5 | 0.017741 | 0.007657 | -1.681      | 5.0766    |
| 3    | gate_s25_net0_eff35_ls12_g100_cap48_off-2 | 21419 | 0.6735 | 2   | 7.5 | 0.017741 | 0.007657 | -1.681      | 5.0766    |
| 4    | gate_s25_net0_eff0_ls12_g100_cap12_off-2  | 21419 | 0.6735 | 2   | 7.5 | 0.017741 | 0.007657 | -1.6812     | 5.0766    |
| 5    | gate_s25_net0_eff0_ls12_g100_cap24_off-2  | 21419 | 0.6735 | 2   | 7.5 | 0.017741 | 0.007657 | -1.6812     | 5.0766    |
| 6    | gate_s25_net0_eff0_ls12_g100_cap48_off-2  | 21419 | 0.6735 | 2   | 7.5 | 0.017741 | 0.007657 | -1.6812     | 5.0766    |
| 7    | gate_s25_net0_eff65_ls12_g100_cap12_off-2 | 21419 | 0.6731 | 2   | 7.5 | 0.017741 | 0.007657 | -1.6818     | 5.0768    |
| 8    | gate_s25_net0_eff65_ls12_g100_cap24_off-2 | 21419 | 0.6731 | 2   | 7.5 | 0.017741 | 0.007657 | -1.6818     | 5.0768    |
| 9    | gate_s25_net0_eff65_ls12_g100_cap48_off-2 | 21419 | 0.6731 | 2   | 7.5 | 0.017741 | 0.007657 | -1.6818     | 5.0768    |
| 10   | gate_s50_net0_eff35_ls12_g100_cap12_off-2 | 21419 | 0.6674 | 2   | 7.5 | 0.017741 | 0.007657 | -1.687      | 5.0794    |
| 11   | gate_s50_net0_eff35_ls12_g100_cap24_off-2 | 21419 | 0.6674 | 2   | 7.5 | 0.017741 | 0.007657 | -1.687      | 5.0794    |
| 12   | gate_s50_net0_eff35_ls12_g100_cap48_off-2 | 21419 | 0.6674 | 2   | 7.5 | 0.017741 | 0.007657 | -1.687      | 5.0794    |

## Baseline Comparison

| model                                     | val mean | val p95 | val p99 | val >5   | val >10  | val signed | test p95 | test p99 |
| ----------------------------------------- | -------- | ------- | ------- | -------- | -------- | ---------- | -------- | -------- |
| current_product_equivalent                | 2.1193   | 10      | 12      | 0.167935 | 0.050049 | -1.33      | 8.75     | 12       |
| least_squares_n12_gain100_cap24           | 0.7891   | 2.5     | 7.75    | 0.020169 | 0.007237 | -1.3866    | 2.5      | 6.5      |
| constant_position                         | 0.5847   | 2       | 8.25    | 0.018862 | 0.00831  | -1.9382    | 2.25     | 6.25     |
| gate_s25_net0_eff35_ls12_g100_cap12_off-2 | 0.6735   | 2       | 7.5     | 0.017741 | 0.007657 | -1.681     | 2.5      | 6        |

## Holdout Signals

| holdout                           | kind    | train p95 | test p95 | delta p95 | train p99 | test p99 | delta p99 |
| --------------------------------- | ------- | --------- | -------- | --------- | --------- | -------- | --------- |
| machine:24cpu_2560x1440_1mon_60Hz | machine | 2.5       | 2        | -0.5      | 7.25      | 5.75     | -1.5      |
| machine:32cpu_7680x1440_3mon_60Hz | machine | 2.5       | 2        | -0.5      | 7.25      | 5.75     | -1.5      |
| machine:6cpu_3840x2160_1mon_30Hz  | machine | 2         | 3        | 1         | 5.75      | 8.75     | 3         |
| refresh:30Hz                      | refresh | 2         | 3        | 1         | 5.75      | 8.75     | 3         |
| refresh:60Hz                      | refresh | 3         | 2        | -1        | 8.75      | 5.75     | -3        |

## Movement Phase Breakdown

| split      | phase  | count | mean   | p95  | p99   | signed mean |
| ---------- | ------ | ----- | ------ | ---- | ----- | ----------- |
| test       | hold   | 3251  | 0.2767 | 0.75 | 4.75  | -4.8763     |
| test       | moving | 16786 | 0.7023 | 2.5  | 5.75  | -1.5154     |
| test       | resume | 962   | 0.72   | 2.75 | 12.5  | -3.3741     |
| validation | hold   | 3241  | 0.2855 | 1    | 5.5   | -3.0999     |
| validation | moving | 17249 | 0.7375 | 2.5  | 7.5   | -1.499      |
| validation | resume | 929   | 0.8383 | 2.75 | 15.75 | -4.9789     |

## Speed Bin Breakdown

| split      | speed     | count | mean   | p95   | p99   | >10      |
| ---------- | --------- | ----- | ------ | ----- | ----- | -------- |
| test       | >=2000    | 218   | 5.404  | 17.75 | 33.25 | 0.123853 |
| test       | 0-25      | 19096 | 0.5184 | 2     | 4.75  | 0.003194 |
| test       | 100-250   | 58    | 3.7397 | 15.75 | 44.25 | 0.086207 |
| test       | 1000-2000 | 690   | 1.549  | 3.25  | 18.5  | 0.013043 |
| test       | 25-100    | 74    | 1.3367 | 4.75  | 16.75 | 0.027027 |
| test       | 250-500   | 69    | 1.5506 | 4.5   | 22.75 | 0.028986 |
| test       | 500-1000  | 794   | 1.0217 | 3.5   | 10.75 | 0.011335 |
| validation | >=2000    | 204   | 5.7339 | 21.75 | 41    | 0.142157 |
| validation | 0-25      | 19526 | 0.5512 | 2     | 5.75  | 0.005121 |
| validation | 100-250   | 56    | 3.3556 | 3.75  | 94.75 | 0.035714 |
| validation | 1000-2000 | 634   | 1.6984 | 2.75  | 20.25 | 0.022082 |
| validation | 25-100    | 127   | 1.1912 | 4     | 14    | 0.023622 |
| validation | 250-500   | 94    | 1.8514 | 7.5   | 25.25 | 0.021277 |
| validation | 500-1000  | 778   | 1.1604 | 2.5   | 16.75 | 0.017995 |

## Interpretation

- The gate explicitly keeps constant-position behavior for low-speed or unstable history and switches to least-squares only when the causal path looks useful.
- The selected gate should be compared against `least_squares_n12_gain100_cap24` rather than against `constant_position` alone, because the latter wins low-horizon p95 but leaves a strong lag signature during motion.
- 30Hz holdout deltas remain important because Step 3 showed 30Hz as the likely cross-refresh weak spot.
