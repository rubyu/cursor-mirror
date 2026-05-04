# Step 2 Baseline Replay

## Scope

This step evaluates deterministic, causal baselines only. It reads the normal and stress Motion Lab ZIP files from the repository root, keeps all work on CPU, does not use GPU, and writes only aggregate Markdown/JSON artifacts.

The prediction anchor is each product `poll` event. Input history is limited to `referencePoll` rows at or before the anchor time. Future referencePoll interpolation is used only as the evaluation label.

## Sources And Splits

| load   | zip                                                | trace rows | reference rows | poll anchors | sched rows | val anchors | test anchors |
| ------ | -------------------------------------------------- | ---------- | -------------- | ------------ | ---------- | ----------- | ------------ |
| normal | cursor-mirror-motion-recording-20260503-212556.zip | 571320     | 246757         | 96007        | 45435      | 14999       | 14996        |
| stress | cursor-mirror-motion-recording-20260503-215632.zip | 544571     | 236420         | 96037        | 42308      | 15000       | 14999        |

The Step 1 scenario split is reused without sample randomization. The 8-scenario sanity ZIP is parser smoke only and is excluded from model selection.

## Baselines

| id                                | family                     | product eligible | description                                                                                   |
| --------------------------------- | -------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| constant_position                 | hold_last                  | yes              | Hold the most recent causal referencePoll position.                                           |
| last2_velocity_raw                | last_two_constant_velocity | yes              | Constant velocity from the last two referencePoll observations, uncapped.                     |
| last2_velocity_cap64              | last_two_constant_velocity | yes              | Constant velocity from the last two referencePoll observations, capped to 64 px displacement. |
| least_squares_velocity_n3_cap64   | least_squares_velocity     | yes              | Linear least-squares velocity over the last 3 referencePoll samples.                          |
| least_squares_velocity_n5_cap64   | least_squares_velocity     | yes              | Linear least-squares velocity over the last 5 referencePoll samples.                          |
| least_squares_velocity_n8_cap64   | least_squares_velocity     | yes              | Linear least-squares velocity over the last 8 referencePoll samples.                          |
| least_squares_velocity_n12_cap64  | least_squares_velocity     | yes              | Linear least-squares velocity over the last 12 referencePoll samples.                         |
| constant_acceleration_last3_cap96 | constant_acceleration      | yes              | Velocity and acceleration from the last three causal referencePoll samples.                   |
| alpha_beta_light_n12_cap64        | alpha_beta                 | yes              | Light alpha-beta tracker over the last 12 referencePoll samples.                              |
| gated_speed_constant_or_ls8       | simple_speed_gate          | yes              | Causal speed gate: constant position below 25 px/s, LS n8 otherwise.                          |
| gated_category_oracle             | script_category_gate       | no               | Offline oracle gate: hold uses constant position, resume uses last2 cap64, moving uses LS n8. |

## Validation Overall Best

| load segment | best product model               | mean px | p95 px | best incl oracle                 | oracle/all p95 |
| ------------ | -------------------------------- | ------- | ------ | -------------------------------- | -------------- |
| normal       | least_squares_velocity_n12_cap64 | 2.1     | 5.25   | least_squares_velocity_n12_cap64 | 5.25           |
| stress       | least_squares_velocity_n12_cap64 | 1.877   | 5      | least_squares_velocity_n12_cap64 | 5              |

## Product Candidate Ranking

| rank | model                            | validation count | mean px | weighted p95 px |
| ---- | -------------------------------- | ---------------- | ------- | --------------- |
| 1    | least_squares_velocity_n12_cap64 | 179994           | 1.988   | 5.125           |
| 2    | constant_position                | 179994           | 2.642   | 7.625           |
| 3    | least_squares_velocity_n8_cap64  | 179994           | 2.457   | 8               |
| 4    | gated_speed_constant_or_ls8      | 179994           | 2.673   | 8               |
| 5    | least_squares_velocity_n5_cap64  | 179994           | 3.908   | 15.625          |
| 6    | least_squares_velocity_n3_cap64  | 179994           | 7.547   | 34              |

Primary Step 3 candidate from this run: `least_squares_velocity_n12_cap64`.

## Primary Candidate Scores

| model                            | split      | load   | horizon ms | count | mean px | median px | p95 px | >5px    | >10px   |
| -------------------------------- | ---------- | ------ | ---------- | ----- | ------- | --------- | ------ | ------- | ------- |
| least_squares_velocity_n12_cap64 | validation | normal | 0          | 14999 | 0.941   | 0.5       | 2.5    | 0.01847 | 0.00953 |
| least_squares_velocity_n12_cap64 | validation | normal | 16.67      | 14999 | 1.753   | 1         | 4      | 0.03887 | 0.02107 |
| least_squares_velocity_n12_cap64 | validation | normal | 33.33      | 14999 | 2.601   | 1.25      | 6.25   | 0.07414 | 0.03387 |
| least_squares_velocity_n12_cap64 | validation | normal | 50         | 14999 | 3.524   | 1.75      | 9.25   | 0.11774 | 0.0476  |
| least_squares_velocity_n12_cap64 | validation | stress | 0          | 15000 | 0.798   | 0.25      | 2.25   | 0.01567 | 0.00653 |
| least_squares_velocity_n12_cap64 | validation | stress | 16.67      | 15000 | 1.629   | 1         | 3.75   | 0.03527 | 0.01713 |
| least_squares_velocity_n12_cap64 | validation | stress | 33.33      | 15000 | 2.265   | 1.25      | 5.25   | 0.05767 | 0.0266  |
| least_squares_velocity_n12_cap64 | validation | stress | 50         | 15000 | 3.136   | 1.75      | 7.75   | 0.12367 | 0.03873 |
| least_squares_velocity_n12_cap64 | test       | normal | 0          | 14996 | 0.672   | 0.25      | 1.5    | 0.0116  | 0.0062  |
| least_squares_velocity_n12_cap64 | test       | normal | 16.67      | 14996 | 1.696   | 1         | 3      | 0.02654 | 0.01374 |
| least_squares_velocity_n12_cap64 | test       | normal | 33.33      | 14996 | 2.669   | 1.5       | 5      | 0.05288 | 0.02401 |
| least_squares_velocity_n12_cap64 | test       | normal | 50         | 14996 | 3.542   | 2         | 7.25   | 0.1095  | 0.03668 |
| least_squares_velocity_n12_cap64 | test       | stress | 0          | 14999 | 0.716   | 0.25      | 1.75   | 0.01027 | 0.00433 |
| least_squares_velocity_n12_cap64 | test       | stress | 16.67      | 14999 | 1.76    | 1         | 3.5    | 0.03307 | 0.0146  |
| least_squares_velocity_n12_cap64 | test       | stress | 33.33      | 14999 | 2.658   | 1.75      | 5.5    | 0.06067 | 0.02854 |
| least_squares_velocity_n12_cap64 | test       | stress | 50         | 14999 | 3.734   | 2         | 8      | 0.13081 | 0.0408  |

## Category Breakdown For Primary Candidate

| model                            | split      | load   | category | count | mean px | p95 px | max px   |
| -------------------------------- | ---------- | ------ | -------- | ----- | ------- | ------ | -------- |
| least_squares_velocity_n12_cap64 | validation | normal | moving   | 66126 | 2.135   | 4.708  | 129.362  |
| least_squares_velocity_n12_cap64 | validation | normal | hold     | 19548 | 1.269   | 3.792  | 149.515  |
| least_squares_velocity_n12_cap64 | validation | normal | resume   | 4320  | 5.33    | 25.208 | 175.521  |
| least_squares_velocity_n12_cap64 | test       | normal | moving   | 72714 | 1.994   | 3.542  | 1034.302 |
| least_squares_velocity_n12_cap64 | test       | normal | hold     | 12726 | 1.272   | 5.625  | 73.171   |
| least_squares_velocity_n12_cap64 | test       | normal | resume   | 4536  | 4.381   | 20.5   | 182.293  |
| least_squares_velocity_n12_cap64 | validation | stress | moving   | 65988 | 1.815   | 4.125  | 121.435  |
| least_squares_velocity_n12_cap64 | validation | stress | hold     | 19974 | 2.018   | 8.292  | 118.707  |
| least_squares_velocity_n12_cap64 | validation | stress | resume   | 4038  | 2.192   | 10.042 | 84.533   |
| least_squares_velocity_n12_cap64 | test       | stress | moving   | 71244 | 1.94    | 4.083  | 151.283  |
| least_squares_velocity_n12_cap64 | test       | stress | hold     | 14700 | 2.9     | 6.708  | 954.894  |
| least_squares_velocity_n12_cap64 | test       | stress | resume   | 4050  | 1.6     | 4.833  | 45.379   |

## Observations

- Constant position is a strong baseline for hold and near-zero horizons.
- Velocity extrapolation is necessary for moving/resume categories, but raw last-two velocity has larger outlier risk.
- Stress must stay separate from normal: scheduler delay max and poll jitter are larger under stress, and aggregate-only reporting hides that difference.
- The category oracle is included only as an offline ceiling; product-candidate ranking excludes it.

## Step 3 Recommendation

Use `least_squares_velocity_n12_cap64` as the first product-safe teacher/baseline target, then test a compact FSMN or tiny MLP that takes causal speed, recent LS velocity residuals, movement-state proxies, horizon, and scheduler-delay bin. Keep the Step 1 scenario split fixed.
