# Step 10 Notes: C# Lag Overlay Grid

## Scope

- Product source was not edited.
- The harness links product `DwmAwareCursorPositionPredictor` and product support classes.
- The generated `DistilledMlpPredictionModel.g.cs` is copied into `harness/Overlay/` and only `LagCompensationPixels` is patched before each build/run.
- CPU-only sequential C# replay.

## Overlay Method

For each lag value, the Step10 runner:

1. Copies `src/CursorMirror.Core/DistilledMlpPredictionModel.g.cs`.
2. Replaces `public const float LagCompensationPixels = ...f;`.
3. Builds `LagOverlayHarness.csproj`.
4. Runs the same chronological replay grid.

Lag values:

- `0`
- `0.125`
- `0.25`
- `0.5`

Offset values:

- `-4.5`
- `-4.25`
- `-4`
- `-3.75`
- `-3.5`
- `-3.25`
- `-3`
- `-2`
- `0`

## Metric Semantics

Three interpretations are recorded:

- Euclidean visual error: predicted absolute position vs candidate effective target.
- Base-direction overshoot: signed error projected onto the offset-0 direction. This matches earlier Step8/9 semantics.
- Candidate-target overshoot: signed error projected onto the candidate shifted target direction.

The important conflict: at `offset -4ms`, stop overshoot base p99 is `4.128px`, but candidate-target overshoot p99 is `0px`. This confirms much of the Step9 `-4ms` tail is a metric-frame crossing effect: the shifted target has moved behind the cursor, while the offset-0 direction still points forward.

## Key Scores

| Candidate | all p95 | stop p95/p99 | base overshoot p99 / >2 | target overshoot p99 / >2 | post p95 | high p95 | balanced |
|---|---:|---:|---:|---:|---:|---:|---:|
| lag0 offset-4 | 0.415 | 2.188 / 9.463 | 4.128 / 0.0193 | 0.000 / 0.0000 | 0.000 | 0.473 | 7.167 |
| lag0.5 offset-4 | 0.417 | 2.274 / 9.463 | 4.128 / 0.0193 | 0.000 / 0.0000 | 0.000 | 0.473 | 7.253 |
| lag0.125 offset-3.5 | 1.052 | 3.340 / 8.227 | 1.923 / 0.0091 | 0.585 / 0.0011 | 0.627 | 1.463 | 8.239 |
| lag0 offset-3.5 | 1.075 | 3.281 / 8.352 | 2.000 / 0.0097 | 0.626 / 0.0011 | 0.625 | 1.502 | 8.258 |
| lag0.5 offset-3.5 | 1.112 | 3.308 / 8.442 | 2.038 / 0.0102 | 0.463 / 0.0005 | 0.901 | 1.406 | 8.595 |
| lag0 offset0 | 2.187 | 6.876 / 22.203 | 0.000 / 0.0005 | 0.000 / 0.0005 | 0.637 | 5.264 | 16.709 |

## Interpretation

- Lag reduction has a small but consistent benefit at `offset -4ms`; `lag0 offset-4` is the best balanced and best visual candidate.
- Lag does not solve the base-direction tail by itself; `offset -4` has the same base overshoot p99 across lag settings because the tail is dominated by timing/crossing semantics.
- Fractional `-3.5ms` reduces the base-direction tail substantially, but worsens visual p95, post-stop jitter, and high-speed p95.
- Candidate-target overshoot shows `offset -4ms` is not actually leading past its own shifted target at p99; the earlier tail metric was intentionally conservative but not purely visual.

## Working Recommendation

If the product change must be minimal and integer-only:

- Use `offset -4ms`.
- Consider regenerating the model with `LagCompensationPixels = 0` if a generated-model update is acceptable.

If fractional offset support is acceptable and tail p99 dominates:

- Evaluate `lag0.125 offset -3.5ms` or `lag0 offset -3.5ms` in a validation build.

Do not prioritize `lag0` alone at offset `0ms`; it remains much worse than offset tuning.
