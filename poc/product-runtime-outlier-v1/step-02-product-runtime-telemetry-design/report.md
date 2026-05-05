# Step 02: Product Runtime Telemetry Design

## Decision

Add a product-specific runtime outlier recorder instead of extending `MouseTraceEvent`.

The existing trace schema records the trace tool's proxy runtime scheduler. It does not directly measure the product path:

`OverlayRuntimeThread.RunSelfScheduledMessageLoop` -> `CursorMirrorController.Tick` -> `OverlayWindow.Move` -> `OverlayWindow.UpdateLayer`

This POC therefore needs a disabled-by-default product recorder with fixed-size ring buffers and explicit snapshot/export.

## Hot Paths

### `src/CursorMirror.Core/OverlayRuntimeThread.cs`

Instrument:

- `RunSelfScheduledMessageLoop`
- `WaitUntilWithMessagePump`
- `WaitForTicksOrMessage`
- `WaitForTicksWithMessageTimeout`
- `ProcessPendingMessages`
- `FineWaitUntil`

Capture:

- loop iteration;
- DWM timing read duration;
- scheduler decision duration;
- planned wake ticks;
- wait start/end;
- coarse wait end;
- fine wait start/end;
- wait return reason;
- message wake count while waiting;
- processed message count before tick;
- processed message dispatch duration before tick;
- tick start/end;
- `wakeLateUs = tickStarted - plannedWake`.

### `src/CursorMirror.Core/CursorMirrorController.cs`

Instrument:

- `Tick(long targetVBlankTicks, long refreshPeriodTicks)`
- `PollAndMove`
- `MoveOverlay`
- `ApplyOpacity`
- cursor image update path:
  - `QueueCursorImageUpdate`
  - `SafeUpdateCursorImageAt`
  - `UpdateCursorImageAt`

Capture:

- total tick duration;
- GC collection counts before/after;
- cursor poll sample duration;
- stale sample branch;
- target selection duration;
- prediction duration;
- overlay move duration;
- opacity duration;
- overlay completion lead/miss relative to target VBlank.

### `src/CursorMirror.Core/OverlayWindow.cs`

Instrument:

- `ShowCursor`
- `Move`
- `SetOpacity`
- `UpdateLayer`

Capture:

- whether move used `UpdateLayer` or move-only path;
- bitmap dimensions;
- alpha;
- `GetDC`;
- `CreateCompatibleDC`;
- `Bitmap.GetHbitmap`;
- `SelectObject`;
- `UpdateLayeredWindow`;
- cleanup;
- total duration;
- `UpdateLayeredWindow` success and `Marshal.GetLastWin32Error()`.

## Proposed Product Recorder

Add a dedicated namespace:

`CursorMirror.ProductRuntimeTelemetry`

Files:

- `ProductRuntimeOutlierRecorder.cs`
- `ProductRuntimeOutlierEvent.cs`
- `ProductRuntimeOutlierSnapshot.cs`
- `ProductRuntimeOutlierPackageWriter.cs`

Use small event structs/classes with primitive tick fields and enum codes. Convert enum codes to strings only when exporting.

## Low-Overhead Rules

- Disabled by default.
- A disabled recorder must be a single cheap branch.
- No disk writes while recording.
- No per-event string formatting.
- No `BeginInvoke` from instrumentation.
- No locks on the overlay hot path.
- Fixed ring capacity with dropped-event counters.
- Snapshot/export happens outside the measured hot path.

Suggested default capacities:

- scheduler events: 16,384
- controller tick events: 16,384
- overlay events: 16,384

## Enablement

POC enablement can be internal first:

- constructor injection for tests;
- static process-wide recorder for product runtime;
- optional environment variable:
  - `CURSOR_MIRROR_PRODUCT_RUNTIME_OUTLIER_V1=1`
  - `CURSOR_MIRROR_PRODUCT_RUNTIME_OUTLIER_PATH=...`

For automated measurement, add a non-interactive app or Calibrator path later:

`CursorMirror.Calibrator.exe --auto-run --exit-after-run --product-runtime --duration-seconds 10 --output calibration.zip --product-runtime-outlier-output product-runtime.zip`

## Test Strategy

Unit tests should not require a real Windows hook or real overlay window.

Tests:

- disabled recorder does not allocate meaningful records;
- ring buffer overwrites oldest records and reports dropped count;
- snapshot copies records safely;
- package writer produces zip with `metadata.json` and CSV files;
- controller timing works with `FakeOverlayPresenter`, `FakeCursorPoller`, `FakeCursorImageProvider`, `FakeClock`;
- scheduler helper math computes `wakeLateUs`, VBlank lead, and message duration correctly.

Real GDI/WinForms `OverlayWindow.UpdateLayer` timing is integration-only. It should be captured by product runtime telemetry during Calibrator runs, not by unit tests.

## Risks

- Instrumentation can perturb the scheduling tail if it allocates or posts messages.
- Snapshot/export must not run on the overlay STA while measuring.
- `Marshal.GetLastWin32Error()` must be captured immediately after `UpdateLayeredWindow`.
- Existing trace data cannot prove product overlay cost; it can only motivate what to measure next.

## Next Step

Implement the product recorder in a disabled-by-default state, wire it into the product hot path, then use Calibrator product runtime auto-run to capture a baseline package.
