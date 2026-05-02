# Step 4 Report: Final Prediction Recommendation

## Executive Summary

Cursor Mirror should implement a simple `constant-velocity-last2` predictor first:

```text
velocity = (current_position - previous_position) / dt
predicted_position = current_position + velocity * horizon_ms
```

Recommended first product posture:

| item | recommendation |
|---|---|
| Model | `constant-velocity-last2` |
| Gain | `1.0` |
| Normal offset cap | Disabled |
| Idle reset gap | `100ms` |
| Fixed fallback horizon | `8ms` |
| Automatic horizon | display frame period, clamped to `4-16ms` |
| UI rollout | opt-in toggle first |
| Advanced damping | hidden or experimental only |
| Neural network | not justified for first implementation |

The model is accurate enough at short horizons, extremely cheap, deterministic, and easy to test without real hooks.

## Evidence

Step 1 established the baseline ranking. On the latter 30% test split, `constant-velocity-last2` won every nonzero horizon. Its scores were:

| horizon ms | mean px | p95 px | p99 px | max px |
|---:|---:|---:|---:|---:|
| 4 | 1.698 | 6.472 | 12.892 | 48.518 |
| 8 | 3.367 | 12.602 | 25.549 | 97.036 |
| 12 | 5.481 | 22.410 | 43.655 | 152.802 |
| 16 | 7.809 | 31.851 | 62.940 | 208.772 |
| 24 | 14.038 | 58.578 | 111.837 | 319.592 |
| 32 | 21.698 | 91.212 | 175.096 | 445.738 |
| 48 | 40.789 | 173.675 | 334.807 | 720.628 |

Step 2 tested refinements. Damping improved mean error at 12ms and above, but it did not consistently improve p95/p99/max. Online expert selection worsened tails. Constant acceleration and EMA/blend approaches did not justify their extra behavior.

Step 3 translated the winner into an allocation-free implementation shape and ran a short synthetic microbenchmark:

| item | result |
|---|---:|
| iterations | 2,000,000 |
| elapsed | 43.2596ms |
| update+predict per second | 46,232,512.55 |
| ns per update+predict | 21.6298 |

The benchmark is noisy and synthetic, but it is enough to show the predictor itself is not the latency bottleneck.

## Model Choice

The selected model uses only the latest valid pair of movement samples.

State:

- latest `x`, `y`;
- latest timestamp in one monotonic millisecond timebase;
- latest `vx`, `vy`;
- flags for sample and velocity validity.

Update:

1. If this is the first sample, store it and hold exact position.
2. Compute `dt` from the previous sample.
3. If `dt <= 0` or `dt > 100ms`, store the sample and clear velocity.
4. Otherwise compute velocity from the last two positions.

Prediction:

1. If disabled, no velocity, or horizon <= 0, return the latest exact position.
2. Otherwise return `latest + velocity * horizon`.
3. Round once at overlay placement.

This keeps the hot path O(1), allocation-free, and deterministic.

## Horizon Policy

The feature is trying to compensate for display and remote-control latency, not to guess a user's intention far into the future. Long horizons increase visible tail risk.

Recommended initial modes:

| mode | behavior | use |
|---|---|---|
| Off | exact current hook position | baseline and user disable |
| Fixed8Ms | always predict 8ms ahead | first fallback and deterministic tests |
| DisplayFrame | estimate one display frame and clamp to 4-16ms | preferred once refresh estimation is implemented |

The 4-16ms clamp is based on the tested horizons. A 4ms lower bound avoids overprediction on high-refresh displays. A 16ms upper bound avoids the visibly larger tails observed at 24ms and above.

## Settings and UI

For the first product build, expose only the part a normal user can reason about:

- `PredictionEnabled` toggle;
- optional `PredictionHorizonMode` with `Fixed 8ms` and `Display frame`.

Do not expose gain, acceleration, model family, or offset caps in the normal settings UI. If an advanced or diagnostic mode is later added, damping can be tested behind a feature flag:

- 12-32ms: gain `0.875`;
- 48ms: gain `0.75`.

That should not be default behavior until more traces show tail improvement.

## Test Strategy

Unit tests should not install a real Windows hook. They should feed synthetic timestamps and positions into the predictor and controller fakes.

Core predictor tests:

- first sample returns exact position;
- two valid samples predict correct 4/8/16ms positions;
- `dt <= 0` clears velocity;
- `dt > 100ms` clears velocity;
- negative screen coordinates are preserved;
- horizon 0 returns exact position;
- reset clears velocity;
- optional failsafe cap is inactive by default.

Controller integration tests:

- synthetic move events update predictor state;
- overlay location uses predicted pointer minus hotspot;
- capture failure still moves the existing overlay when possible;
- opacity behavior remains independent;
- hook callback remains pass-through;
- tests use fakes and do not call `SetWindowsHookEx`.

## Implementation Plan

1. Add `CursorPositionPredictor` to `CursorMirror.Core`.
2. Add `CursorPredictionSettings` fields to `CursorMirrorSettings`, normalized with conservative bounds.
3. Add unit tests for predictor math and reset behavior.
4. Integrate prediction in `CursorMirrorController` before `OverlayPlacement.FromPointerAndHotSpot`.
5. Start with `Fixed8Ms`; add display-frame horizon once refresh-rate estimation is implemented.
6. Add settings UI toggle after the core predictor tests are stable.
7. Keep trace tooling available and collect more user/device traces before changing defaults.

## Risks

The current data set is one trace. That is enough to pick a simple first implementation, but not enough to prove a broad default-on policy.

Prediction can create visual overshoot around abrupt stops, turns, and clicks. Because Cursor Mirror does not affect real input targets, this is visual only, but it can still feel wrong. Button transitions may need exact-position sync if users notice overshoot during clicks.

True vsync synchronization is not guaranteed by the existing WinForms timer. Display-frame mode should be treated as estimated horizon compensation until a dedicated timing mechanism is validated.

## Final Recommendation

Proceed to implementation with `constant-velocity-last2`, gain `1.0`, no cap, reset on invalid or idle timing, and an opt-in user setting. Use fixed 8ms first, then add automatic display-frame horizon clamped to 4-16ms. Do not implement neural prediction or adaptive expert selection until multiple traces demonstrate a clear tail-safe advantage.
