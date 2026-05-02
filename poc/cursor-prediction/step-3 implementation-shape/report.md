# Step 3 Report: Implementation Shape

## Summary

Use `constant-velocity-last2` as the product implementation baseline. The predictor should maintain only the latest sample and latest velocity, then answer prediction requests for a requested horizon. It should be deterministic, allocation-free after construction, and independent from Windows hooks so tests can feed synthetic clock/sample streams.

Recommended default model settings:

| setting | recommendation |
|---|---|
| model | `constant-velocity-last2` |
| gain | `1.0` |
| horizon | display-frame mode, clamped to the tested 8-16ms band; fallback 8ms |
| idle reset gap | 100ms |
| offset cap | disabled by default |
| optional damping | hidden/advanced only, not default |

## Proposed State

A minimal predictor can be a sealed class or small struct owned by `CursorMirrorController`.

```csharp
internal sealed class CursorPositionPredictor
{
    private bool _hasSample;
    private bool _hasVelocity;
    private double _lastX;
    private double _lastY;
    private long _lastTimestampMs;
    private double _velocityXPerMs;
    private double _velocityYPerMs;
}
```

Suggested configuration fields:

| field | default | reason |
|---|---:|---|
| `Enabled` | Step 4 decision | Product rollout choice, not a model concern. |
| `Gain` | `1.0` | Step 1 winner and Step 2 default recommendation. |
| `IdleGapMs` | `100` | Resets across pauses and trace gaps. |
| `MaxHorizonMs` | `16` | Keeps default use inside the best-evidenced horizon band. |
| `FallbackHorizonMs` | `8` | Conservative when display timing is unavailable. |
| `MaxOffsetPx` | `null` | Fixed caps worsened Step 1 accuracy. |
| `FailsafeMaxOffsetPx` | optional high value | Only for extreme corruption or timestamp bugs, disabled or high by default. |

Expected state size is roughly 64-80 bytes depending on runtime layout. The hot path should allocate 0 bytes per sample and 0 bytes per prediction.

## Update Flow

On every mouse move:

1. Convert the hook point to a numeric sample position.
2. Choose one timestamp timebase for the predictor.
3. Call `AddSample(timestampMs, x, y)`.
4. Determine the display horizon.
5. Call `Predict(horizonMs)`.
6. Use the predicted pointer only for `OverlayPlacement.FromPointerAndHotSpot`.
7. Preserve current capture, opacity, hook transfer, and dispatch behavior.

The state update is:

```text
if first sample:
    store position/time
    hasVelocity = false
else:
    dt = timestampMs - lastTimestampMs
    if 0 < dt <= idleGapMs:
        velocity = (position - lastPosition) / dt
        hasVelocity = true
    else:
        hasVelocity = false
    store position/time
```

Prediction is:

```text
if disabled or no velocity or horizon <= 0:
    return latest exact position
else:
    offset = velocity * horizon * gain
    return latest position + offset
```

If a failsafe cap exists, apply it after gain. The cap should clamp the prediction displacement from the latest exact pointer, not the final error. It should not be enabled as a normal accuracy control.

## Prediction API

Keep the API small and unit-testable:

```csharp
public void Reset();
public void AddSample(long timestampMs, int x, int y);
public PointF Predict(double horizonMs);
public Point PredictRounded(double horizonMs);
```

Implementation notes:

- `Predict` should not mutate state.
- `AddSample` should not call UI, capture, settings, or hook APIs.
- Rounding should be explicit. Use `PointF` internally and round once at the overlay boundary.
- If current codebase compatibility prefers `System.Drawing.Point`, a `PredictRounded` helper can round away from repeated conversions.

## Reset Behavior

Reset the predictor when:

- Cursor Mirror hides the overlay.
- Prediction is disabled or settings switch model/horizon mode.
- A sample arrives with `dt <= 0`.
- A sample arrives after `dt > IdleGapMs`.
- A non-move event should force an exact overlay sync, such as button down/up or wheel, if that event path starts moving the overlay.
- The controller is disposed.

For idle gaps, keep the current sample as the new latest position but clear velocity. This avoids extrapolating stale motion after a pause while allowing the next move to establish a fresh velocity.

## Timestamp Handling

Use a single monotonic millisecond source per predictor instance. The current app exposes `IClock.Milliseconds` through `Environment.TickCount`, and the low-level hook data also contains `MSLLHOOKSTRUCT.time`.

Preferred integration:

- Use the same `IClock` timebase for synthetic tests, controller updates, and prediction horizon calculations.
- Store timestamps as `long` milliseconds.
- Treat non-positive `dt` as invalid and clear velocity.
- Be aware that Windows tick counts can wrap. If using 32-bit hook time directly, handle wrap intentionally or convert through a monotonic abstraction.

Avoid mixing `DateTime.UtcNow`, `Environment.TickCount`, and hook `time` in one predictor. Mixed timebases can create fake idle gaps or negative intervals.

## Display-Frame Horizon

The prediction horizon should represent "how far ahead the overlay display needs to be," not a model constant.

Recommended modes:

| mode | behavior | status |
|---|---|---|
| `DisplayFrame` | Use the estimated next display-frame interval, clamp to 8-16ms. | Preferred product shape. |
| `Fixed8Ms` | Always predict 8ms ahead. | Conservative fallback and likely sweet spot. |
| `Fixed16Ms` | Predict 16ms ahead. | Useful for 60Hz/full-frame testing, higher tail risk. |
| `Off` | Exact current pointer. | Required for comparison and user disable. |

The existing app is event-driven rather than vsync-driven, so initial integration can use `Fixed8Ms` or a simple refresh-rate estimate. If a UI timer/render tick is later introduced, call `Predict` at render time with `targetDisplayTimeMs - latestSampleTimeMs`, clamped to the supported range.

Do not predict beyond 16ms by default. Step 1 showed 24ms+ horizons still improve over hold-current, but p95/p99 become visibly large.

## Settings and UI Candidates

Minimum internal settings:

```csharp
public bool PredictionEnabled { get; set; }
public int PredictionHorizonMilliseconds { get; set; }
public int PredictionIdleResetMilliseconds { get; set; }
public bool PredictionExperimentalDampingEnabled { get; set; }
public int? PredictionFailsafeMaxOffsetPixels { get; set; }
```

Suggested user-facing posture:

- Step 4 should decide whether prediction ships as default-on, default-off, or experimental.
- If exposed in UI, start with one toggle: "Predict cursor position".
- Avoid exposing gain, cap, or model family in normal settings.
- If an advanced panel exists, expose horizon mode before exposing damping.
- Keep offset cap hidden unless it is a diagnostic or safety setting.

## Tests Without Real Windows Hooks

Add tests around the predictor class directly:

| test | expected result |
|---|---|
| First sample | prediction returns current position; no velocity extrapolation. |
| Two samples at 8ms apart | 8/12/16ms predictions match constant-velocity math. |
| Zero or negative `dt` | velocity is cleared; prediction holds current. |
| Idle gap over 100ms | velocity is cleared; next valid pair reestablishes it. |
| Horizon 0 | returns current position. |
| Disabled prediction | returns current position even with velocity. |
| Optional cap disabled | fast movement is not clipped. |
| Optional failsafe cap enabled | displacement length is bounded only when configured. |
| Hide/reset path | next prediction holds current until two fresh samples exist. |
| Synthetic `IClock` stream | controller integration can be tested without installing a hook. |

Controller-level tests can use existing fake overlay presenters:

- Feed two synthetic move events through `UpdateAt` or a new test-only sample method.
- Verify overlay placement receives the predicted point minus the hotspot.
- Verify cursor capture and opacity behavior still occur exactly once per update.
- Verify non-move events do not install hooks and do not require native input.

## Edge Cases

- Multi-monitor and negative coordinates: keep `double` internally and allow negative x/y; round only at placement.
- Fast movement: no fixed cap by default; fast motion was part of the trace and caps hurt accuracy.
- Long pauses: clear velocity at the idle threshold.
- Duplicate timestamps: clear velocity to avoid divide-by-zero and stale extrapolation.
- Clock wrap: handle at the timestamp abstraction boundary.
- Cursor bitmap capture failure: move existing overlay with predicted/exact point if `_hasLastImage` is true, preserving current behavior.
- Settings changes: normalize settings and reset predictor when prediction-related settings change.
- DPI and hotspot: predict the pointer position, then apply existing hotspot placement. Do not predict window top-left directly.
- Drag/click/wheel: prediction must not alter event transfer or click target. Consider exact-position sync on button transitions if visual overshoot during clicks is noticeable.
- Trace representativeness: one trace is not enough to justify complex adaptation. Keep feature telemetry or trace tooling available for broader validation.

## Operation Count Estimate

Typical valid sample update:

- 1 timestamp subtraction
- 2 interval comparisons
- 2 position subtractions
- 2 floating-point divisions
- field stores

Typical prediction:

- 1 horizon/gain multiply per axis or precombined scalar
- 2 velocity multiplications
- 2 additions
- optional rounding

Optional cap adds a squared length, comparison, square root only when over cap, and two more multiplications. Because Step 1 caps worsened accuracy, leave this off the normal path.

## Final Implementation Recommendation

Implement the simple predictor first and wire it behind a setting or feature flag. Use last2/gain 1.0/no cap as the default model. Use 8ms as the conservative fallback horizon and clamp display-frame estimates to 8-16ms. Keep damping and offset caps out of the normal UI until more traces show they improve visible behavior without worse tails.
