# Step 4 Timing Target Audit

## Scope

This step audits v9 timing columns and compares fixed horizons with target-derived horizons. It shares the Step 3 data pass and remains CPU-only.

## Timing By Anchor And Refresh

| anchor               | refresh | n      | target p50 ms | target p95 ms | raw present p50 ms | corrected present p50 ms | target-raw present p50 ms | recorded-target p50 us |
| -------------------- | ------- | ------ | ------------- | ------------- | ------------------ | ------------------------ | ------------------------- | ---------------------- |
| poll                 | 30Hz    | 190466 | 16.561        | 31.6715       | 16.484             | 16.561                   | 0                         | n/a                    |
| poll                 | 60Hz    | 191852 | 8.3342        | 15.8428       | 8.2587             | 8.3342                   | 0                         | n/a                    |
| runtimeSchedulerPoll | 30Hz    | 45712  | 3.87          | 3.9103        | -29.4436           | 3.87                     | 33.3332                   | -3870                  |
| runtimeSchedulerPoll | 60Hz    | 90625  | 3.9112        | 3.9573        | -12.7188           | 3.9112                   | 16.6669                   | -3910                  |

`presentReferenceTicks` is often the current or previous DWM vblank. The corrected-present mode advances it to a future vblank before deriving a prediction horizon.

## Selected Baseline Lag Audit

| horizon              | split      | refresh | count | mean   | p95  | signed mean | lag rate |
| -------------------- | ---------- | ------- | ----- | ------ | ---- | ----------- | -------- |
| fixed_16p67ms        | test       | 30Hz    | 6826  | 2.5429 | 6.5  | -3.9465     | 0.998638 |
| fixed_16p67ms        | test       | 60Hz    | 14178 | 1.7627 | 4.5  | -2.9509     | 0.997674 |
| fixed_16p67ms        | validation | 30Hz    | 7200  | 2.5085 | 8.75 | -3.2003     | 0.998721 |
| fixed_16p67ms        | validation | 60Hz    | 14220 | 1.7432 | 5    | -3.3655     | 0.999173 |
| fixed_8ms            | test       | 30Hz    | 6826  | 1.1454 | 4.75 | -2.557      | 1        |
| fixed_8ms            | test       | 60Hz    | 14178 | 0.8989 | 2.75 | -1.6682     | 0.999274 |
| fixed_8ms            | validation | 30Hz    | 7200  | 1.1958 | 4    | -2.1204     | 1        |
| fixed_8ms            | validation | 60Hz    | 14220 | 0.9151 | 2.75 | -1.8285     | 0.999209 |
| v9_present_corrected | test       | 30Hz    | 6826  | 0.6699 | 3    | -2.2261     | 0.99854  |
| v9_present_corrected | test       | 60Hz    | 14178 | 0.493  | 2    | -1.7963     | 1        |
| v9_present_corrected | validation | 30Hz    | 7200  | 0.7284 | 3    | -2.1869     | 0.998645 |
| v9_present_corrected | validation | 60Hz    | 14220 | 0.5126 | 2    | -1.7866     | 0.99827  |
| v9_target            | test       | 30Hz    | 6826  | 0.6699 | 3    | -2.2261     | 0.99854  |
| v9_target            | test       | 60Hz    | 14178 | 0.493  | 2    | -1.7963     | 1        |
| v9_target            | validation | 30Hz    | 7200  | 0.7284 | 3    | -2.1869     | 0.998645 |
| v9_target            | validation | 60Hz    | 14220 | 0.5126 | 2    | -1.7866     | 0.99827  |

Signed error is projected along instantaneous cursor motion. Negative signed mean means the prediction is behind the future cursor position; positive means it leads.

## Horizon Mode Comparison

| split      | horizon              | count | mean   | p95  | p99   | signed mean | lag rate |
| ---------- | -------------------- | ----- | ------ | ---- | ----- | ----------- | -------- |
| test       | fixed_16p67ms        | 21004 | 2.0163 | 6    | 21    | -3.312      | 0.998024 |
| test       | fixed_8ms            | 21004 | 0.979  | 3.5  | 11    | -1.8968     | 0.999461 |
| test       | v9_present_corrected | 21004 | 0.5505 | 2.25 | 6.25  | -1.9509     | 0.999475 |
| test       | v9_target            | 21004 | 0.5505 | 2.25 | 6.25  | -1.9509     | 0.999475 |
| train      | fixed_16p67ms        | 93912 | 1.9859 | 6.25 | 21.5  | -3.2845     | 0.999526 |
| train      | fixed_8ms            | 93912 | 1      | 4    | 12.75 | -2.1326     | 0.99908  |
| train      | v9_present_corrected | 93913 | 0.5655 | 2.5  | 7.25  | -2.1739     | 0.999474 |
| train      | v9_target            | 93913 | 0.5655 | 2.5  | 7.25  | -2.1739     | 0.999474 |
| validation | fixed_16p67ms        | 21420 | 2.0005 | 6.25 | 22.5  | -3.3006     | 0.998995 |
| validation | fixed_8ms            | 21420 | 1.0094 | 3.5  | 14    | -1.9228     | 0.999465 |
| validation | v9_present_corrected | 21420 | 0.5851 | 2    | 8.25  | -1.9426     | 0.998416 |
| validation | v9_target            | 21420 | 0.5851 | 2    | 8.25  | -1.9426     | 0.998416 |

## Non-Constant Prediction Candidate Horizon Comparison

| split      | horizon              | count | mean   | p95  | p99   | signed mean | lag rate |
| ---------- | -------------------- | ----- | ------ | ---- | ----- | ----------- | -------- |
| test       | fixed_16p67ms        | 21004 | 1.4756 | 3.5  | 14    | -0.6911     | 0.518775 |
| test       | fixed_8ms            | 21004 | 1.179  | 3.25 | 10.5  | -0.6074     | 0.624798 |
| test       | v9_present_corrected | 21004 | 0.7537 | 2.5  | 6.5   | -1.3702     | 0.832546 |
| test       | v9_target            | 21004 | 0.7537 | 2.5  | 6.5   | -1.3702     | 0.832546 |
| train      | fixed_16p67ms        | 93912 | 1.5404 | 4    | 15.75 | -0.594      | 0.545821 |
| train      | fixed_8ms            | 93912 | 1.2055 | 3.5  | 11.25 | -0.852      | 0.656065 |
| train      | v9_present_corrected | 93913 | 0.7633 | 2.5  | 7     | -1.5578     | 0.85596  |
| train      | v9_target            | 93913 | 0.7633 | 2.5  | 7     | -1.5578     | 0.85596  |
| validation | fixed_16p67ms        | 21420 | 1.5787 | 4.75 | 17    | -0.8159     | 0.542943 |
| validation | fixed_8ms            | 21420 | 1.2273 | 3.5  | 11.5  | -0.7419     | 0.672017 |
| validation | v9_present_corrected | 21420 | 0.7896 | 2.5  | 7.75  | -1.3913     | 0.81943  |
| validation | v9_target            | 21420 | 0.7896 | 2.5  | 7.75  | -1.3913     | 0.81943  |

## Conclusion

- Runtime scheduler target p50 by refresh: 30Hz=3.87 ms, 60Hz=3.9112 ms.
- Runtime scheduler sample-recorded-to-target p50: 30Hz=-3870 us, 60Hz=-3910 us.
- Selected validation runtimeScheduler p95: fixed16.67=6.25 px, v9Target=2 px, delta=-4.25 px.

The main timing lesson is that runtime scheduler rows are already near their target vblank. For those rows, a full fixed-frame horizon is not equivalent to the recorded prediction target.
