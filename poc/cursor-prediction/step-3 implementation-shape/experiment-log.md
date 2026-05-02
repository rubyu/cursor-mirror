# Experiment Log

## 2026-05-01 Step 3

### Goal

Step 3 is an implementation-shape pass, not a new model-selection pass. Step 1 showed `constant-velocity-last2` with no cap was best for every nonzero horizon on the latter 30% split. Step 2 showed damping can improve longer-horizon mean error, but does not clearly dominate p95/p99/max, and online expert selection worsens tail behavior.

The goal here is to turn that result into a design Cursor Mirror can implement and test with low risk.

### Inputs Reviewed

- `poc/cursor-prediction/experiment-plan.md`
- `poc/cursor-prediction/supervisor-log.md`
- Step 1 report and score summaries
- Step 2 report, experiment log, and score summaries
- Current controller, settings, clock, hook, overlay presenter, and test fake shapes under `src/` and `tests/`

Production files were read only. No production source, specs, README, git state, trace zip contents, or other step directories were edited.

### Decision Rationale

The selected model is `constant-velocity-last2`:

```text
velocity = (current_position - previous_position) / (current_time_ms - previous_time_ms)
prediction = current_position + velocity * horizon_ms
```

The implementation should store the most recent position, timestamp, and velocity. It should not store sample history arrays, candidate score buffers, or pending prediction error queues. The update and prediction surfaces can be deterministic pure state transitions, which makes them easy to unit test with synthetic samples.

This design matches the product constraints better than the alternatives:

- It is O(1) for both sample updates and prediction calls.
- It needs a small fixed state object or struct.
- It has no allocation on the hook or render hot path.
- It has no asynchronous scoring or delayed target bookkeeping.
- It can be reset cheaply across idle gaps, hide/show transitions, settings changes, and invalid timestamps.

### Assumptions

- The prediction point moves only the overlay display location. It must not affect the real OS pointer, click-through behavior, opacity policy, or cursor bitmap capture.
- The predictor receives timestamps from a single monotonic millisecond timebase. `Environment.TickCount` and `MSLLHOOKSTRUCT.time` are both millisecond-ish Windows time sources, but the product implementation should avoid mixing timebases within one predictor instance.
- One trace is enough to choose an implementation shape, not enough to prove a broad shipping default. Step 4 should decide final rollout posture.
- A 100ms idle gap threshold remains a reasonable initial reset policy because Step 1 found p50 interval near 8ms, p90 near 16ms, and many long idle gaps.

### Observations

The existing controller is already close to a testable integration point. It takes `IClock`, dispatches hook updates to UI code, and has fake overlay presenters in tests. Prediction can be added behind a small class and tested by calling `AddSample` and `Predict` directly.

Current overlay movement is event-driven: mouse move events call `UpdateAt(pointer)`, then the overlay is shown or moved to `OverlayPlacement.FromPointerAndHotSpot(pointer, hotSpot)`. A predictor can sit before placement and provide a predicted pointer for display while preserving exact pointer data for all other behavior.

The model should work with either an event-driven update path or a later frame/timer-driven display path. Event-driven integration can use a fixed conservative horizon such as 8ms. Frame-driven integration can compute a horizon from the next display frame and clamp it into the tested 8-16ms product band.

### Rejected Alternatives

Fixed prediction offset caps remain rejected as default behavior. Step 1 showed caps of 16/32/64px worsened accuracy because they clipped legitimate fast movement. A cap may still exist as a high failsafe guard, but it should be disabled by default or set high enough that normal fast motion is not clipped.

Horizon-dependent gain is not the default. Step 2 found gain 0.875 improves mean at 12-32ms and gain 0.75 improves 48ms mean, but p95/p99/max do not improve consistently. It should be a feature flag or advanced setting only.

Constant acceleration is not the default. It adds a third-sample dependency and can produce large long-horizon tails unless clamped. The short-horizon gain was too small to justify the extra behavior.

EMA and velocity blend are not default candidates. They add smoothing delay and did not beat the last2 baseline.

Online expert selection is rejected for this product pass. It needs more state and delayed error bookkeeping, and the Step 2 EWMA selector worsened p99/max. For a visible cursor overlay, those spikes matter.

### Microbenchmark

I added `run_microbenchmark.ps1` as a small synthetic timing probe. It compiles a tiny .NET predictor struct and loops over deterministic sample updates plus predictions. It does not read the trace, write output files, or install hooks.

One local run:

| item | value |
|---|---:|
| iterations | 2,000,000 |
| warmup iterations | 100,000 |
| horizon | 12ms |
| elapsed | 43.2596ms |
| update+predict per second | 46,232,512.55 |
| ns per update+predict | 21.6298 |

This is a noisy single-agent measurement. It is useful only as a sanity check that the proposed hot path is tiny relative to normal UI frame budgets.

### Step 3 Outcome

Proceed with an implementation shaped around a single `CursorPredictionModel` or `CursorPositionPredictor` class. Keep the model fixed and boring by default: last2 velocity, gain 1.0, no cap, reset on invalid timing. Make settings and tests explicit so later Step 4 product decisions can choose whether the feature is hidden, experimental, or user-visible.
