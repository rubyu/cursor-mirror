# Step 9 Notes: C# Tail Guard Search

## Scope

- Continued from Step 8 C# chronological replay.
- Product source was read/linked only; no product file was edited.
- CPU-only, sequential C# harness runs.
- Source ZIPs were read in place. No expanded CSV was copied.

## Harness

- Project: `harness/TailGuardHarness.csproj`
- Output: `csharp-tail-guard-output.json`
- Scores: `scores.json`
- Target framework: `net10.0`, matching the installed SDK/reference packs.
- Build succeeded with nullable-context warnings only.

Offset implementation:

- Integer offset is applied through `DwmAwareCursorPositionPredictor.ApplyPredictionTargetOffsetMilliseconds`.
- Fractional residual offset is approximated by shifting `targetVBlankTicks` in ticks.
- This keeps product source unchanged, but fractional offsets require product support before shipping.

## Candidate Families

- Static offset grid: `-6, -5, -4.75, -4.5, -4.25, -4, -3.75, -3.5, -3.25, -3, -2.5, -2ms`
- Lightweight guards at `-4ms`:
  - deceleration lead cap at `0/0.5/1/1.5/2px`
  - near-stop snap
  - runtime stationary snap
  - decel dynamic offset to `-5ms` or `-3ms`
  - cap + stationary snap combinations

All guards use runtime scalar/history features only; no future label is used by guard decisions.

## Tail Findings

Baseline `offset -4ms` stop tail:

- stop rows: `1933`
- overshoot `>1px`: `58`
- overshoot `>2px`: `37`
- overshoot `>4px`: `20`
- by package: `m070248=29`, `m070307=29`
- by phase: mostly `other=56`, only `decelToStop=2`
- median speeds inside `>1px` tail:
  - `v2=1232 px/s`
  - `v12=724 px/s`
  - `targetSpeed=0 px/s`

Interpretation: most top tail rows are not caught by the runtime deceleration/stationary predicates. They are timing-crossing rows where the effective `-4ms` target has moved behind the current cursor while the offset-0 direction still points forward. Top examples often have prediction displacement `[0, 0]`, so the tail is not primarily large MLP output amplitude.

## Key Scores

| Candidate | all p95/p99 | stop p95/p99/max | stop overshoot p99/max | >1 / >2 / >4 | post p95 | high p95 |
|---|---:|---:|---:|---:|---:|---:|
| offset -4 | 0.417 / 1.564 | 2.188 / 9.554 / 36.070 | 4.110 / 30.012 | 0.030 / 0.019 / 0.010 | 0.000 | 1.928 |
| offset -3.5 | 1.112 / 2.396 | 3.234 / 8.579 / 25.159 | 2.038 / 20.674 | 0.023 / 0.010 / 0.006 | 0.901 | 3.072 |
| offset -3 | 1.154 / 2.485 | 3.305 / 12.506 / 30.159 | 1.218 / 10.674 | 0.013 / 0.004 / 0.002 | 0.924 | 3.072 |
| offset -4 + dynamic -5 on decel | 0.418 / 1.562 | 2.000 / 8.200 / 36.070 | 4.123 / 30.012 | 0.037 / 0.022 / 0.011 | 0.000 | 1.928 |

## Recommendation

Selected candidate: `offset_m3p5`.

Reason: it is the best tail-objective candidate and cuts stop overshoot p99 roughly in half versus `-4ms`. Caveat: it worsens the visual/p95 profile and requires fractional offset support.

If product implementation must remain integer-only, do not add the tested guards. Keep `-4ms` as the visual candidate and use Step 9 tail rows as the next retraining/timing-data target.
