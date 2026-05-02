## 11. Mouse Trace Tool

### 11.1 Purpose and Scope
- Cursor Mirror Trace Tool MUST be a separate Windows application from Cursor Mirror.
- The trace tool MUST record mouse movement samples for prediction research, diagnostics, and future tuning work.
- The trace tool MUST NOT be required for normal Cursor Mirror usage.
- The trace tool MUST NOT run automatically with Cursor Mirror.
- The trace tool MUST be explicitly launched by the user or developer.
- The trace tool MAY share hook wrappers, trace models, and package-writing code through `CursorMirror.Core`.

### 11.2 Application Shape
- The trace tool MUST be built as a separate executable.
- The trace tool MUST be included in the release package as `CursorMirror.TraceTool.exe`.
- The trace tool MUST provide a normal visible Windows window.
- The trace tool window MUST use the Cursor Mirror application icon rather than the default Windows Forms icon.
- The trace tool SHOULD use WinForms.
- The trace tool MUST NOT run as a hidden tray-resident application.
- The trace tool MUST use the same low-level hook wrapper pattern as Cursor Mirror where practical.
- The trace tool MUST install the low-level mouse hook only while recording is active.
- The trace tool MUST unhook when recording stops or the application exits.
- The trace tool SHOULD poll the current cursor position while recording, even when no low-level hook callback is being delivered.
- The trace tool SHOULD record a product-equivalent cursor polling stream and a separate high-precision reference cursor polling stream.
- The high-precision reference stream SHOULD target a shorter interval than the product-equivalent stream and MUST be clearly distinguishable in the trace data.
- The trace tool SHOULD record a DWM-synchronized runtime scheduler polling stream that mirrors Cursor Mirror's normal one-shot runtime scheduler.
- The runtime scheduler stream SHOULD decide its wake timing on a background thread and capture the cursor position on a dedicated STA message-pump thread, matching the main application's overlay runtime dispatch shape without sharing the trace tool's visible UI thread.
- The runtime scheduler background thread SHOULD use the same latency-sensitive priority as Cursor Mirror's normal runtime scheduler.
- The trace tool SHOULD record Desktop Window Manager timing information while recording when the operating system exposes it.

### 11.3 UI Requirements
- The main window MUST include:
  - `Start Recording`;
  - `Stop Recording`;
  - `Save`;
  - total sample count display;
  - hook movement sample count display;
  - cursor polling sample count display;
  - high-precision reference polling sample count display;
  - runtime scheduler polling sample count display;
  - runtime scheduler loop sample count display;
  - DWM timing available sample count display;
  - recording duration display;
  - status display;
  - `Exit`.
- Buttons MUST be disabled when their action is not valid for the current recording state.
- `Save` MUST use a standard save file dialog.
- `Exit` SHOULD close the application immediately when no unsaved samples exist.
- `Exit` SHOULD confirm when unsaved samples exist.
- UI text SHOULD be clear enough for users who are not comfortable with command-line tools.
- The main window SHOULD keep status labels readable without clipping or wrapping at the default dialog size in supported UI languages.
- The DWM timing display SHOULD show both available timing samples and the product-plus-runtime scheduler sample denominator.

### 11.4 Recording State Model
The trace tool MUST use an explicit state model with these states:

- `Idle`
- `Recording`
- `StoppedWithSamples`
- `Saved`

State rules:

- `Idle` MUST transition to `Recording` on `Start Recording`.
- `Recording` MUST transition to `StoppedWithSamples` on `Stop Recording` if one or more samples exist.
- `Recording` MUST transition to `Idle` on `Stop Recording` if no samples exist.
- `StoppedWithSamples` MUST transition to `Saved` after a successful save.
- `Saved` MAY transition to `Recording` on `Start Recording`.
- Starting a new recording after unsaved samples exist SHOULD confirm or clearly discard the previous session.
- Repeated stop and exit cleanup MUST be safe.

### 11.5 Captured Data
Each recorded sample MUST include:

- sequence number;
- high-resolution timestamp ticks;
- elapsed microseconds from the start of the session;
- `x` screen coordinate;
- `y` screen coordinate;
- event type.

The initial event types SHOULD include:

- `move` for low-level hook movement events;
- `poll` for product-equivalent periodic `GetCursorPos` samples;
- `referencePoll` for high-precision reference `GetCursorPos` samples;
- `runtimeSchedulerPoll` for DWM-synchronized runtime scheduler `GetCursorPos` samples;
- `runtimeSchedulerLoop` for DWM-synchronized runtime scheduler loop diagnostics, including iterations that do not request a cursor sample.

For `move` samples, the trace SHOULD include:

- hook `x` and `y` screen coordinates;
- current `GetCursorPos` `x` and `y` screen coordinates when available;
- raw low-level hook `mouseData`;
- raw low-level hook `flags`;
- raw low-level hook timestamp;
- raw low-level hook extra information.

For `poll` samples, the trace SHOULD include:

- current `GetCursorPos` `x` and `y` screen coordinates.

For `referencePoll` samples, the trace SHOULD include:

- current `GetCursorPos` `x` and `y` screen coordinates;
- high-resolution timestamp ticks captured as close to the native cursor read as practical.

For `runtimeSchedulerPoll` samples, the trace SHOULD include:

- current `GetCursorPos` `x` and `y` screen coordinates captured on the dedicated runtime scheduler capture thread;
- whether DWM timing was usable for the scheduler decision;
- target vblank QPC ticks when available;
- planned tick QPC ticks when available;
- actual tick QPC ticks used as the runtime dispatch timestamp;
- queued tick QPC ticks captured before posting work to the dedicated runtime scheduler capture thread;
- dispatch-started QPC ticks captured at the beginning of the capture-thread callback;
- cursor-read-started and cursor-read-completed QPC ticks captured around the native cursor read;
- sample-recorded QPC ticks captured immediately before appending the trace sample;
- lead time from the actual tick to the target vblank in microseconds when available.

For `runtimeSchedulerLoop` samples, the trace SHOULD include:

- monotonically increasing scheduler loop iteration number;
- loop-started QPC ticks;
- timing-read-started and timing-read-completed QPC ticks around the DWM timing query;
- decision-completed QPC ticks after scheduler evaluation;
- whether the loop requested a runtime scheduler tick;
- requested sleep duration or fallback wait hint in milliseconds;
- wait method used for the scheduler wait, such as high-resolution waitable timer, normal waitable timer, or thread sleep fallback;
- absolute wait target QPC ticks used by the runtime scheduler loop;
- sleep-started and sleep-completed QPC ticks;
- whether DWM timing was usable for the scheduler decision;
- target vblank, planned tick, and vblank lead values when available.

The product-equivalent `poll` stream SHOULD remain the legacy model input proxy. The `runtimeSchedulerPoll` stream SHOULD be treated as the current trace runtime input proxy. The `referencePoll` stream SHOULD be treated as a higher-resolution reference stream for analysis and target reconstruction, not as product-available runtime input.

For samples where Desktop Window Manager timing is available, the trace SHOULD include:

- whether DWM timing was available;
- refresh rate numerator and denominator;
- refresh period in QPC ticks;
- last vertical blank QPC time;
- DWM refresh count;
- composition QPC time;
- DWM frame identifiers;
- displayed, completed, and pending frame QPC times;
- next displayed and next presented refresh counters;
- displayed, dropped, and missed frame counters.

Optional fields MAY include:

- monitor identifier;
- virtual-screen bounds;
- display-output identifier.

Trace metadata SHOULD include:

- trace format version;
- Cursor Mirror version and build metadata;
- requested product-equivalent polling interval;
- requested high-precision reference polling interval;
- requested runtime scheduler wake lead, maximum DWM sleep interval, and fallback interval;
- runtime scheduler and runtime scheduler capture-thread latency profile summaries, including whether managed priority and MMCSS were applied when observable; both SHOULD use no elevated managed priority and no MMCSS by default;
- requested high-resolution timer period and whether it was acquired;
- product-equivalent poll, reference poll, runtime scheduler poll, runtime scheduler loop, hook move, DWM timing sample counts, and coalesced runtime scheduler tick count;
- observed interval statistics for hook move, product-equivalent poll, reference poll, runtime scheduler poll, and runtime scheduler loop streams;
- DWM timing availability percentage;
- operating system, runtime, bitness, and processor-count metadata;
- virtual-screen bounds;
- monitor bounds, working area, primary flag, bits per pixel, and device name;
- system DPI values;
- quality warning identifiers for missing streams, low DWM availability, or unexpectedly coarse polling.

### 11.6 Output Package Format
- Trace output MUST be saved as a `.zip` package by default.
- The zip package MUST use the highest compression level exposed by the built-in compression API for the target runtime.
- The zip package MUST contain `trace.csv`.
- The zip package SHOULD contain `metadata.json`.
- The `trace.csv` file MUST be UTF-8 CSV.
- The first CSV row MUST be a header.
- Numeric values MUST use invariant culture.
- The default package filename SHOULD use the form `cursor-mirror-trace-YYYYMMDD-HHMMSS.zip`.
- Saving an empty trace MUST fail clearly or be disabled by UI state.

The trace format version for the fields below MUST be `8`.

Example `trace.csv` header:

```csv
sequence,stopwatchTicks,elapsedMicroseconds,x,y,event,hookX,hookY,cursorX,cursorY,hookMouseData,hookFlags,hookTimeMilliseconds,hookExtraInfo,dwmTimingAvailable,dwmRateRefreshNumerator,dwmRateRefreshDenominator,dwmQpcRefreshPeriod,dwmQpcVBlank,dwmRefreshCount,dwmQpcCompose,dwmFrame,dwmRefreshFrame,dwmFrameDisplayed,dwmQpcFrameDisplayed,dwmRefreshFrameDisplayed,dwmFrameComplete,dwmQpcFrameComplete,dwmFramePending,dwmQpcFramePending,dwmRefreshNextDisplayed,dwmRefreshNextPresented,dwmFramesDisplayed,dwmFramesDropped,dwmFramesMissed,runtimeSchedulerTimingUsable,runtimeSchedulerTargetVBlankTicks,runtimeSchedulerPlannedTickTicks,runtimeSchedulerActualTickTicks,runtimeSchedulerVBlankLeadMicroseconds,runtimeSchedulerQueuedTickTicks,runtimeSchedulerDispatchStartedTicks,runtimeSchedulerCursorReadStartedTicks,runtimeSchedulerCursorReadCompletedTicks,runtimeSchedulerSampleRecordedTicks,runtimeSchedulerLoopIteration,runtimeSchedulerLoopStartedTicks,runtimeSchedulerTimingReadStartedTicks,runtimeSchedulerTimingReadCompletedTicks,runtimeSchedulerDecisionCompletedTicks,runtimeSchedulerTickRequested,runtimeSchedulerSleepRequestedMilliseconds,runtimeSchedulerWaitMethod,runtimeSchedulerWaitTargetTicks,runtimeSchedulerSleepStartedTicks,runtimeSchedulerSleepCompletedTicks
```

Example package:

```text
cursor-mirror-trace-20260430-153012.zip
  trace.csv
  metadata.json
```

### 11.7 Performance and Safety
- The hook callback MUST do minimal work.
- File I/O MUST NOT occur inside the hook callback.
- Periodic cursor-position polling SHOULD avoid blocking work and SHOULD stop when recording stops.
- High-precision reference polling SHOULD run only while recording is active.
- High-precision reference polling SHOULD use bounded work per sample and SHOULD stop promptly when recording stops or the tool exits.
- Runtime scheduler polling SHOULD run only while recording is active.
- Runtime scheduler loop diagnostics SHOULD run only while recording is active and SHOULD include loop iterations that do not request cursor capture.
- Runtime scheduler loop diagnostics SHOULD record the absolute wait target used by the current one-shot loop and SHOULD distinguish waitable-timer waits that include final fine-wait alignment.
- Runtime scheduler polling MUST avoid overlapping queued capture-thread callbacks.
- Runtime scheduler polling SHOULD count scheduler ticks that are coalesced because a previous capture-thread callback is still pending.
- Runtime scheduler polling SHOULD stop promptly when recording stops or the tool exits.
- If the tool requests a shorter Windows timer period for recording quality, it MUST release that request when recording stops or the tool exits.
- DWM timing capture failure MUST NOT stop recording.
- UI updates SHOULD be throttled, for example to `10Hz` to `30Hz`.
- Recording MUST store samples in memory until saved.
- The tool SHOULD cap in-memory samples or warn when a large recording is running.
- The tool MUST tolerate `Stop Recording` and `Exit` being invoked repeatedly.
- The trace tool MUST NOT be launched by normal CI.
- Unit tests MUST NOT install the real low-level mouse hook.

### 11.8 Testing
- Normal CI MUST NOT launch the trace tool or install a real Windows hook.
- Unit tests MUST cover trace session state transitions, button enabled state derivation, total and per-source sample counting, duration formatting, output package writing, reference polling sample fields, runtime scheduler polling split timing fields, runtime scheduler loop timing fields, runtime scheduler coalesced tick metadata, dedicated STA dispatch behavior, metadata quality fields, and empty-save behavior.
- Unit tests SHOULD cover runtime scheduler latency profile metadata without requiring real priority elevation or MMCSS activation.
- Manual validation MUST cover visible-window startup, real hook recording, start/stop/save behavior, unsaved exit confirmation, real hook cleanup, and saved package readability.
