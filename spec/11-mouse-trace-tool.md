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
- The trace tool SHOULD use WinForms.
- The trace tool MUST NOT run as a hidden tray-resident application.
- The trace tool MUST use the same low-level hook wrapper pattern as Cursor Mirror where practical.
- The trace tool MUST install the low-level mouse hook only while recording is active.
- The trace tool MUST unhook when recording stops or the application exits.
- The trace tool SHOULD poll the current cursor position while recording, even when no low-level hook callback is being delivered.
- The trace tool SHOULD record Desktop Window Manager timing information while recording when the operating system exposes it.

### 11.3 UI Requirements
- The main window MUST include:
  - `Start Recording`;
  - `Stop Recording`;
  - `Save`;
  - total sample count display;
  - hook movement sample count display;
  - cursor polling sample count display;
  - DWM timing available sample count display;
  - recording duration display;
  - status display;
  - `Exit`.
- Buttons MUST be disabled when their action is not valid for the current recording state.
- `Save` MUST use a standard save file dialog.
- `Exit` SHOULD close the application immediately when no unsaved samples exist.
- `Exit` SHOULD confirm when unsaved samples exist.
- UI text SHOULD be clear enough for users who are not comfortable with command-line tools.
- The DWM timing display SHOULD show both available timing samples and the cursor polling sample denominator.

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
- `poll` for periodic `GetCursorPos` samples.

For `move` samples, the trace SHOULD include:

- hook `x` and `y` screen coordinates;
- current `GetCursorPos` `x` and `y` screen coordinates when available;
- raw low-level hook `mouseData`;
- raw low-level hook `flags`;
- raw low-level hook timestamp;
- raw low-level hook extra information.

For `poll` samples, the trace SHOULD include:

- current `GetCursorPos` `x` and `y` screen coordinates.

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

Example `trace.csv` header:

```csv
sequence,stopwatchTicks,elapsedMicroseconds,x,y,event,hookX,hookY,cursorX,cursorY,hookMouseData,hookFlags,hookTimeMilliseconds,hookExtraInfo,dwmTimingAvailable,dwmRateRefreshNumerator,dwmRateRefreshDenominator,dwmQpcRefreshPeriod,dwmQpcVBlank,dwmRefreshCount,dwmQpcCompose,dwmFrame,dwmRefreshFrame,dwmFrameDisplayed,dwmQpcFrameDisplayed,dwmRefreshFrameDisplayed,dwmFrameComplete,dwmQpcFrameComplete,dwmFramePending,dwmQpcFramePending,dwmRefreshNextDisplayed,dwmRefreshNextPresented,dwmFramesDisplayed,dwmFramesDropped,dwmFramesMissed
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
- DWM timing capture failure MUST NOT stop recording.
- UI updates SHOULD be throttled, for example to `10Hz` to `30Hz`.
- Recording MUST store samples in memory until saved.
- The tool SHOULD cap in-memory samples or warn when a large recording is running.
- The tool MUST tolerate `Stop Recording` and `Exit` being invoked repeatedly.
- The trace tool MUST NOT be launched by normal CI.
- Unit tests MUST NOT install the real low-level mouse hook.

### 11.8 Testing
- Normal CI MUST NOT launch the trace tool or install a real Windows hook.
- Unit tests MUST cover trace session state transitions, button enabled state derivation, total and per-source sample counting, duration formatting, output package writing, and empty-save behavior.
- Manual validation MUST cover visible-window startup, real hook recording, start/stop/save behavior, unsaved exit confirmation, real hook cleanup, and saved package readability.
