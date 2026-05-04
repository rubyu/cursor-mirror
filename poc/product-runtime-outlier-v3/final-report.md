# Product Runtime Outlier v3: Final Report

## Summary

This phase investigated Variant C and the remaining overlay update cost after the v2 HBITMAP/DC cache.

The strongest product change is to call `UpdateLayeredWindow` with `hdcDst = NULL` and create the reusable memory DC with `CreateCompatibleDC(NULL)`. Microsoft documents that a NULL `hdcDst` uses the default palette, and `CreateCompatibleDC(NULL)` creates a memory DC compatible with the application's current screen. This removes the per-update `GetDC(NULL)` / `ReleaseDC` cost.

The second selected change is to skip overlay moves when the computed overlay location is unchanged. The hold-heavy synthetic scenario reduced `UpdateLayer` calls from 360 possible frames to 30 real updates, with 330 skipped moves and no failures.

The latest-only hook coalescing is implemented and instrumented, but the local desktop environment did not produce a hook backlog large enough to show a measurable coalescing reduction. It is still a low-risk guard against message queue pressure.

## Measurements

### Synthetic Overlay Harness

The synthetic harness uses real `OverlayWindow`, real `CursorMirrorController`, real `ProductRuntimeOutlierRecorder`, a synthetic cursor image provider, and a synthetic poller. It does not depend on `GetCursorPos` or WGC, which are unreliable in this execution environment.

| Variant | Scenario | `UpdateLayer` count | skipped moves | `UpdateLayer` p95 us | `UpdateLayeredWindow` p95 us | failures |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| cached HBITMAP/DC + per-frame `GetDC` | moving every frame | 360 | 0 | 3224.2 | 1082.7 | 0 |
| cached HBITMAP/DC + per-frame `GetDC` | hold-heavy | 30 | 330 | 3597.3 | 1193.8 | 0 |
| `hdcDst = NULL` | moving every frame | 360 | 0 | 1054.1 | 1032.3 | 0 |
| `hdcDst = NULL` | hold-heavy | 30 | 330 | 1029.8 | 1021.5 | 0 |

### Product Runtime Telemetry-Only Calibrator

`--no-display-capture` was added for product-runtime telemetry capture without WGC. This confirms the new coalescing fields are emitted. In this local environment, `GetCursorPos` fails, so this mode is useful for scheduler and hook telemetry but not for measuring real overlay image movement.

| Field | p95 | p99 | max |
| --- | ---: | ---: | ---: |
| `mouseMoveEventsReceived` | 1 | 2 | 2 |
| `mouseMoveEventsCoalesced` | 0 | 0 | 0 |
| `mouseMovePostsQueued` | 1 | 2 | 2 |
| `mouseMoveCallbacksProcessed` | 1 | 2 | 2 |
| `latestMouseMoveAgeMicroseconds` | 12187 | 15044 | 27446 |

## Decisions

Adopt:

- hook mouse-move latest-only queueing in `OverlayRuntimeThread`;
- product runtime telemetry fields for hook coalescing and overlay move skips;
- same-location overlay move skip in `CursorMirrorController`;
- `UpdateLayeredWindow(..., hdcDst: IntPtr.Zero, ...)` and `CreateCompatibleDC(IntPtr.Zero)`;
- Calibrator `--no-display-capture` for product-runtime telemetry-only diagnostics;
- synthetic overlay harness for display-independent product overlay measurements.

Reject or defer:

- `SetWindowPos` move-only remains rejected from v2;
- rendering alternatives such as DirectComposition/Direct2D are deferred because the NULL destination DC path gives a large improvement with much lower implementation risk;
- sync timing changes are deferred until WGC-based or external capture can measure visible latency directly. The synthetic harness can measure call cost, but not presentation timing.

## Verification

- Release build passed.
- Release tests passed: `Total: 145, Failed: 0`.
- GDI stress passed: final GDI delta `0`.
- Synthetic overlay harness passed with zero `UpdateLayeredWindow` failures.

## Remaining Bottleneck

After the selected changes, the remaining per-update cost is mostly inside `UpdateLayeredWindow` itself. `GetHbitmap` is no longer on the movement hot path, and `GetDC(NULL)` is removed from the per-frame update path.

