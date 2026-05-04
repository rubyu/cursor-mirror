# Step 9 Report: C# Tail Guard Search

## Objective

Step 8 showed `target offset -4ms` is very strong in C# chronological replay, but it still leaves a stop-overshoot tail. Step 9 analyzed those tail frames and searched for a product-shaped fix using only static/fine offset changes and lightweight runtime guards.

## Execution

- Built and ran `TailGuardHarness.csproj` with `C:\Program Files\dotnet\dotnet.exe`.
- Build succeeded. Only nullable-context warnings were emitted.
- Replay rows: `90,522`
- Stop rows for the `-4ms` baseline: `1,933`
- Candidate count: `23`

The harness applies integer offsets through the product predictor API. Fractional offsets are approximated by shifting the scheduler target ticks by the fractional residual, because the current product setting is integer milliseconds.

## Tail Analysis

For baseline `offset -4ms`:

- stop overshoot `>1px`: `58` rows
- stop overshoot `>2px`: `37` rows
- stop overshoot `>4px`: `20` rows
- split by package: `m070248=29`, `m070307=29`
- phase classifier: `other=56`, `decelToStop=2`

Representative top tail rows:

| package | elapsed ms | phase | overshoot | v2/v12 | target speed | prediction dx/dy | effective target dx/dy |
|---|---:|---|---:|---:|---:|---:|---:|
| m070307 | 563753.601 | other | 30.012 | 8267 / 978 | 152.8 | 0.000 / 0.000 | -35.370 / 7.074 |
| m070307 | 582705.180 | other | 27.689 | 1792 / 934 | 0.0 | 0.000 / 0.000 | 27.689 / -5.738 |
| m070307 | 168070.454 | other | 14.496 | 1557 / 1030 | 0.0 | 0.000 / 0.000 | -14.496 / 2.749 |
| m070248 | 551991.870 | other | 13.271 | 2230 / 803 | 163.2 | 0.000 / 0.000 | -10.608 / -8.160 |
| m070307 | 661228.325 | other | 11.884 | 1218 / 579 | 0.0 | 0.000 / 0.000 | -11.884 / 3.654 |

Main finding: the worst tail is mostly not an MLP over-amplitude problem. The predictor often outputs hold/zero, but the `-4ms` effective target has crossed behind the cursor while the offset-0 motion direction still points forward. That makes the signed-along-motion metric count the hold as overshoot. The tested deceleration/stationary predicates miss these rows because most are not classified as runtime deceleration or stationary.

## Candidate Results

| Candidate | all p95/p99 | stop p95/p99/max | overshoot p99/max | >1 / >2 / >4 | post p95 | high p95 |
|---|---:|---:|---:|---:|---:|---:|
| offset -4 | 0.417 / 1.564 | 2.188 / 9.554 / 36.070 | 4.110 / 30.012 | 0.030 / 0.019 / 0.010 | 0.000 | 1.928 |
| offset -3.5 | 1.112 / 2.396 | 3.234 / 8.579 / 25.159 | 2.038 / 20.674 | 0.023 / 0.010 / 0.006 | 0.901 | 3.072 |
| offset -3 | 1.154 / 2.485 | 3.305 / 12.506 / 30.159 | 1.218 / 10.674 | 0.013 / 0.004 / 0.002 | 0.924 | 3.072 |
| offset -4 + dynamic -5 on decel | 0.418 / 1.562 | 2.000 / 8.200 / 36.070 | 4.123 / 30.012 | 0.037 / 0.022 / 0.011 | 0.000 | 1.928 |

## Decision

Recommended Step 9 candidate: `offset_m3p5`.

This is the best tail-objective candidate. It reduces stop p99 and roughly halves overshoot p99 versus `-4ms`, and it reduces the `>2px` tail rate from `1.91%` to `1.03%`.

Tradeoff: it worsens the visual profile: all p95 rises from `0.417` to `1.112`, post-stop jitter p95 from `0` to `0.901`, and high-speed p95 from `1.928` to `3.072`. Also, `-3.5ms` is not directly expressible with the current integer product setting.

## Product Guidance

Do not add the tested runtime guards. They do not target the dominant tail cause.

If tail p99 is the primary acceptance criterion, test fractional `-3.5ms` in a validation build. If product changes must stay minimal and integer-only, keep `-4ms` as the visual candidate and use the tail rows for the next retraining/timing-data step.

Next needed work is not another simple deceleration guard. The likely next useful experiments are:

- add fractional target-offset support or scheduler tick adjustment for validation,
- collect explicit controller reset/session and target timing labels to raise replay fidelity,
- retrain or calibrate with these timing-crossing tail rows emphasized.
