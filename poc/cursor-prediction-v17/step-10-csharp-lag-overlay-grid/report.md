# Step 10 Report: C# Lag Overlay Grid

## Objective

Step 8/9 could not directly test `lag0` through the product predictor because the generated model bakes `LagCompensationPixels = 0.5f` as a `const`. Step 10 created a POC-only overlay of the generated model and evaluated lag constants against the same C# chronological replay.

## Execution

- Product source edited: no
- Predictor source: linked from product
- Generated model: copied to `harness/Overlay/DistilledMlpPredictionModel.g.cs`
- Lag constants evaluated: `0`, `0.125`, `0.25`, `0.5`
- Offsets evaluated: `-4.5`, `-4.25`, `-4`, `-3.75`, `-3.5`, `-3.25`, `-3`, `-2`, `0`
- Builds/runs: 4 sequential C# builds/runs
- Build result: success, nullable-context warnings only

## Metric Semantics

Step 10 records three views:

- Euclidean visual error: what the mirror cursor visually misses against the candidate target.
- Base-direction overshoot: signed error along the offset-0 direction, used in earlier steps.
- Candidate-target overshoot: signed error along the candidate shifted target direction.

These disagree around `offset -4ms`. For `lag0 offset-4`, base-direction stop overshoot p99 is `4.128px`, but candidate-target stop overshoot p99 is `0px`. That means much of the apparent Step9 tail is a timing-frame crossing artifact: the shifted target can be behind the current cursor while offset-0 direction still says “forward”.

## Results

| Candidate | all p95 | stop p95/p99 | base overshoot p99 / >2 | target overshoot p99 / >2 | post p95 | high p95 | balanced |
|---|---:|---:|---:|---:|---:|---:|---:|
| lag0 offset-4 | 0.415 | 2.188 / 9.463 | 4.128 / 0.0193 | 0.000 / 0.0000 | 0.000 | 0.473 | 7.167 |
| lag0.125 offset-4 | 0.416 | 2.267 / 9.463 | 4.128 / 0.0193 | 0.000 / 0.0000 | 0.000 | 0.473 | 7.245 |
| lag0.25 offset-4 | 0.417 | 2.274 / 9.463 | 4.128 / 0.0193 | 0.000 / 0.0000 | 0.000 | 0.473 | 7.253 |
| lag0.5 offset-4 | 0.417 | 2.274 / 9.463 | 4.128 / 0.0193 | 0.000 / 0.0000 | 0.000 | 0.473 | 7.253 |
| lag0.125 offset-3.5 | 1.052 | 3.340 / 8.227 | 1.923 / 0.0091 | 0.585 / 0.0011 | 0.627 | 1.463 | 8.239 |
| lag0 offset-3.5 | 1.075 | 3.281 / 8.352 | 2.000 / 0.0097 | 0.626 / 0.0011 | 0.625 | 1.502 | 8.258 |
| lag0 offset0 | 2.187 | 6.876 / 22.203 | 0.000 / 0.0005 | 0.000 / 0.0005 | 0.637 | 5.264 | 16.709 |

## Decision

Recommended product candidate: **offset -4ms, lag0 if regenerating the generated model is acceptable; otherwise offset -4ms with current lag0.5 remains acceptable**.

Why:

- `lag0 offset-4` is the best balanced and visual candidate in this grid.
- The improvement from lag0.5 to lag0 at `-4ms` is real but small: stop p95 `2.274 -> 2.188`, all p95 `0.417 -> 0.415`.
- The base-direction tail does not improve with lag changes, so changing lag is not the main tail fix.
- Candidate-target overshoot says `-4ms` is not actually leading past its own shifted target at p99.

Fractional offset:

- `-3.5ms` is still useful if base-direction tail p99 dominates acceptance.
- It worsens visual p95, post-stop jitter, and high-speed p95.
- It requires fractional target-offset support, so it is not the minimal product change.

## Next Step

Minimal body change:

1. Set DistilledMLP target offset to `-4ms` behind a setting/validation flag.
2. Keep current `lag0.5` if generated-model churn should be avoided.
3. If generated model update is acceptable, regenerate with `LagCompensationPixels = 0`.

Next experiment, if needed:

- validate the metric-frame crossing rows visually,
- add a candidate-target-direction overshoot metric to future reports,
- collect higher-fidelity target timing/session reset labels before retraining.
