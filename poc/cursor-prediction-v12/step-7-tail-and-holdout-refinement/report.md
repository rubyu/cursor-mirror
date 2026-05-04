# Step 7 Tail and Holdout Refinement

## Scope

This step keeps the Step 5 selected gate `gate_s25_net0_eff35_ls12_g100_cap12_off-2` as the baseline and searches product-safe specialist guards for the remaining `>=2000 px/s`, `resume`, and 30Hz holdout tails. Inputs for product candidates remain causal: referencePoll history, v9 target horizon, scheduler/refresh context, history gap, speed, net displacement, path efficiency, and acceleration estimate.

No GPU, checkpoint, raw ZIP copy, or large intermediate file was used.

## Baseline vs Selected

No product-safe specialist guard passed all guardrails, so the selected product candidate remains the Step 5 baseline.

| rank | model                                     | guard ok | val mean | val p95 | val p99 | val >10  | val >=2000 p95 | val >=2000 p99 | val resume p95 | val resume p99 | 30Hz test p95 | 30Hz test p99 | objective |
| ---- | ----------------------------------------- | -------- | -------- | ------- | ------- | -------- | -------------- | -------------- | -------------- | -------------- | ------------- | ------------- | --------- |
| 1    | gate_s25_net0_eff35_ls12_g100_cap12_off-2 | yes      | 0.6735   | 2       | 7.5     | 0.007657 | 21.75          | 41             | 2.75           | 15.75          | 3             | 7             | 21.8192   |

## Safe Product Candidates

No specialist guard passed all guardrails. The baseline remains the safe product candidate.

## Near Misses

| rank | model                                                         | guard ok | val mean | val p95 | val p99 | val >10  | val >=2000 p95 | val >=2000 p99 | val resume p95 | val resume p99 | 30Hz test p95 | 30Hz test p99 | objective |
| ---- | ------------------------------------------------------------- | -------- | -------- | ------- | ------- | -------- | -------------- | -------------- | -------------- | -------------- | ------------- | ------------- | --------- |
| 1    | tailguard_spd2000_acc60k_net0_eff0_30Hz_ls8_g150_cap24_off4   | no       | 0.6772   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2772   |
| 2    | tailguard_spd2000_acc60k_net8_eff0_30Hz_ls8_g150_cap24_off4   | no       | 0.6772   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2772   |
| 3    | tailguard_spd2000_acc60k_net24_eff0_30Hz_ls8_g150_cap24_off4  | no       | 0.6772   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2772   |
| 4    | tailguard_spd2000_acc60k_net0_eff35_30Hz_ls8_g150_cap24_off4  | no       | 0.6772   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2772   |
| 5    | tailguard_spd2000_acc60k_net8_eff35_30Hz_ls8_g150_cap24_off4  | no       | 0.6772   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2772   |
| 6    | tailguard_spd2000_acc60k_net24_eff35_30Hz_ls8_g150_cap24_off4 | no       | 0.6772   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2772   |
| 7    | tailguard_spd2000_acc60k_net0_eff65_30Hz_ls8_g150_cap24_off4  | no       | 0.6772   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2772   |
| 8    | tailguard_spd2000_acc60k_net8_eff65_30Hz_ls8_g150_cap24_off4  | no       | 0.6772   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2772   |
| 9    | tailguard_spd2000_acc60k_net24_eff65_30Hz_ls8_g150_cap24_off4 | no       | 0.6772   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2772   |
| 10   | tailguard_spd2000_acc60k_net0_eff0_30Hz_ls8_g130_cap24_off4   | no       | 0.6767   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2776   |
| 11   | tailguard_spd2000_acc60k_net8_eff0_30Hz_ls8_g130_cap24_off4   | no       | 0.6767   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2776   |
| 12   | tailguard_spd2000_acc60k_net24_eff0_30Hz_ls8_g130_cap24_off4  | no       | 0.6767   | 2       | 7.75    | 0.008077 | 21.75          | 32             | 2.75           | 15.75          | 3             | 9             | 21.2776   |

## Validation Search Top

| rank | model                                                         | mean   | p95 | p99  | >10      | >=2000 p95 | >=2000 p99 | resume p95 | resume p99 | 30Hz p95 | 30Hz p99 | objective |
| ---- | ------------------------------------------------------------- | ------ | --- | ---- | -------- | ---------- | ---------- | ---------- | ---------- | -------- | -------- | --------- |
| 1    | tailguard_spd2000_acc60k_net0_eff0_30Hz_ls8_g150_cap24_off4   | 0.6772 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2772   |
| 2    | tailguard_spd2000_acc60k_net8_eff0_30Hz_ls8_g150_cap24_off4   | 0.6772 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2772   |
| 3    | tailguard_spd2000_acc60k_net24_eff0_30Hz_ls8_g150_cap24_off4  | 0.6772 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2772   |
| 4    | tailguard_spd2000_acc60k_net0_eff35_30Hz_ls8_g150_cap24_off4  | 0.6772 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2772   |
| 5    | tailguard_spd2000_acc60k_net8_eff35_30Hz_ls8_g150_cap24_off4  | 0.6772 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2772   |
| 6    | tailguard_spd2000_acc60k_net24_eff35_30Hz_ls8_g150_cap24_off4 | 0.6772 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2772   |
| 7    | tailguard_spd2000_acc60k_net0_eff65_30Hz_ls8_g150_cap24_off4  | 0.6772 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2772   |
| 8    | tailguard_spd2000_acc60k_net8_eff65_30Hz_ls8_g150_cap24_off4  | 0.6772 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2772   |
| 9    | tailguard_spd2000_acc60k_net24_eff65_30Hz_ls8_g150_cap24_off4 | 0.6772 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2772   |
| 10   | tailguard_spd2000_acc60k_net0_eff0_30Hz_ls8_g130_cap24_off4   | 0.6767 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2776   |
| 11   | tailguard_spd2000_acc60k_net8_eff0_30Hz_ls8_g130_cap24_off4   | 0.6767 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2776   |
| 12   | tailguard_spd2000_acc60k_net24_eff0_30Hz_ls8_g130_cap24_off4  | 0.6767 | 2   | 7.75 | 0.008077 | 21.75      | 32         | 2.75       | 15.75      | 3        | 9.75     | 21.2776   |

## Analysis-Only Oracle Ceiling

| rank | model                                 | analysis only | val mean | val p95 | val p99 | val >10  | val >=2000 p95 | val >=2000 p99 | val resume p95 | val resume p99 | 30Hz test p95 | 30Hz test p99 | objective |
| ---- | ------------------------------------- | ------------- | -------- | ------- | ------- | -------- | -------------- | -------------- | -------------- | -------------- | ------------- | ------------- | --------- |
| 1    | oracle_phase_speed_refresh_group_best | yes      | 0.6637   | 2       | 7.25    | 0.007003 | 15.75          | 27.5           | 3.5            | 14.25          | 2.75          | 7.25          | 17.8244   |
| 2    | oracle_per_row_best_pool_lower_bound  | yes      | 0.3382   | 1.5     | 4.75    | 0.003782 | 13.5           | 26.25          | 2              | 9.5            | 1.75          | 4             | 13.9313   |

## Oracle Tail Groups

| group                 | selected oracle model       | count | mean    | p95   | p99   | >10      |
| --------------------- | --------------------------- | ----- | ------- | ----- | ----- | -------- |
| hold|>=2000|30Hz      | oracle_ls8_g150_cap48_off4  | 9     | 4.3658  | 8     | 8     | 0        |
| hold|>=2000|60Hz      | oracle_ls8_g150_cap48_off4  | 6     | 11.1909 | 25    | 25    | 0.333333 |
| moving|>=2000|30Hz    | oracle_ls12_g150_cap48_off4 | 97    | 2.366   | 4.75  | 26.25 | 0.010309 |
| moving|>=2000|60Hz    | oracle_ls12_g150_cap24_off4 | 77    | 4.8335  | 15.75 | 27.5  | 0.142857 |
| resume|>=2000|30Hz    | oracle_ls12_g150_cap24_off4 | 2     | 6.9506  | 10    | 10    | 0.5      |
| resume|>=2000|60Hz    | oracle_ls12_g150_cap24_off4 | 13    | 12.6966 | 38    | 38    | 0.384615 |
| resume|0-25|30Hz      | base_gate_step5_selected    | 332   | 0.2287  | 1     | 6     | 0        |
| resume|0-25|60Hz      | base_gate_step5_selected    | 521   | 0.5588  | 2     | 9.5   | 0.009597 |
| resume|100-250|60Hz   | oracle_ls8_g150_cap12_off4  | 2     | 11.9153 | 14.25 | 14.25 | 0.5      |
| resume|1000-2000|30Hz | oracle_ls8_g150_cap12_off4  | 7     | 0.942   | 1.5   | 1.5   | 0        |
| resume|1000-2000|60Hz | oracle_ls8_g150_cap48_off4  | 12    | 5.8036  | 24.75 | 24.75 | 0.166667 |
| resume|25-100|30Hz    | oracle_ls8_g100_cap12_off-2 | 1     | 0.2159  | 0     | 0     | 0        |
| resume|25-100|60Hz    | oracle_ls12_g100_cap12_off0 | 9     | 4.1248  | 13    | 13    | 0.111111 |
| resume|250-500|30Hz   | oracle_ls12_g150_cap12_off4 | 3     | 0.89    | 1     | 1     | 0        |
| resume|250-500|60Hz   | oracle_ls12_g150_cap12_off4 | 2     | 5.2494  | 9.75  | 9.75  | 0        |
| resume|500-1000|30Hz  | oracle_ls12_g150_cap12_off4 | 6     | 2.0773  | 7.75  | 7.75  | 0        |
| resume|500-1000|60Hz  | oracle_ls12_g150_cap12_off4 | 19    | 1.3614  | 7.25  | 7.25  | 0        |

## Interpretation

- The guard search is intentionally conservative: if a tail specialist improves high-speed rows but worsens overall p99, >10px rate, or 30Hz holdout, it is not a product candidate.
- The group oracle uses true motion phase and future speed bin, so it is a ceiling probe rather than an implementation candidate.
- The per-row oracle lower bound uses label error to pick the best model per row; it is impossible in product but useful for judging whether the model pool itself can approach zero error.
