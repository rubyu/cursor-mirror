## 13. Calibrator Application

### 13.1 Purpose and Scope
- The calibrator application is a separate Windows app for measuring visible cursor overlay separation on a controlled screen.
- The calibrator MUST be built as `CursorMirror.Calibrator.exe`.
- The calibrator MUST be included in the release package.
- The calibrator is intended for controlled latency and visual-separation measurement, not for normal Cursor Mirror use.

### 13.2 Capture Scene
- Calibration MUST run on the primary display in a full-screen white or near-white scene.
- The calibration scene SHOULD avoid black UI text or other dark elements while frames are being captured.
- The calibrator MUST move the real Windows cursor through deterministic movement patterns.
- The movement suite MUST be defined as compact motion segments rather than a precomputed per-frame table.
- Movement samples MUST be evaluated from the current elapsed time during calibration.
- The default movement suite SHOULD include multiple speed ranges and at least linear, quadratic easing, cubic easing, rapid reversal, sinusoidal sweep, short jitter, and stationary hold patterns.
- The calibrator MUST run a Cursor Mirror overlay in-process for measurement unless a later specification defines another explicit comparison mode.
- The calibrator MUST support runtime modes for the measured overlay.
- The default runtime mode MUST be `ProductRuntime`, which uses the same product overlay runtime path as the main application, including the high-frequency cursor sampler and DWM-synchronized runtime scheduler.
- The existing direct timer-driven measurement path MUST remain available as `SimpleTimer` for diagnostic comparison.
- The interactive UI MUST allow selecting the runtime mode before calibration starts and MUST disable that selector while calibration is running.
- Measurement SHOULD ignore a short startup warm-up period. The `ProductRuntime` warm-up MAY be longer than the `SimpleTimer` warm-up because it starts the product overlay runtime thread and sampler.
- The calibrator MUST use Windows Graphics Capture for frame acquisition when supported by the operating system.
- The calibrator MUST capture the real Windows cursor in the captured frames when the operating system exposes that option.

### 13.3 Input Safety
- During calibration, the calibrator MUST install a low-level mouse hook that blocks user-generated mouse input.
- Mouse input injected by the calibrator itself MUST be allowed through.
- Real cursor movement MUST use the shared `RealCursorDriver` SendInput path with the calibrator-specific injection marker.
- The calibrator MUST NOT maintain a separate cursor movement implementation from Motion Lab or the demo app.
- Pressing any keyboard key during calibration MUST stop calibration and release the mouse hook.
- Calibration shutdown MUST release the mouse hook even when capture startup or saving fails.

### 13.4 Output
- The calibrator MUST NOT save raw captured frames by default.
- The calibrator MUST NOT write a calibration package automatically during normal interactive use.
- After an interactive calibration run stops, the calibrator MUST keep the captured measurements in memory and enable an explicit Save command.
- The interactive Save command SHOULD use a standard save-file dialog with a timestamped default filename.
- The calibrator MAY support an explicit command-line output path for automation. When that output path is provided, an auto-run calibration MAY save to that path without showing the save-file dialog.
- The calibrator MAY support command-line prediction setting overrides for controlled experiments, including prediction enabled state, prediction model, prediction gain, prediction horizon, DWM prediction horizon cap, DWM prediction target offset, DWM adaptive gain parameters, DWM adaptive reversal cooldown, DWM adaptive oscillation suppression, and prediction idle reset.
- Command-line prediction model names SHOULD accept the same external model names as the UI: `ConstantVelocity`, `LeastSquares`, `ExperimentalMLP`, and `DistilledMLP`.
- The calibrator MAY support command-line runtime mode overrides. Runtime mode names SHOULD accept `ProductRuntime` and `SimpleTimer`.
- Command-line prediction setting overrides MUST be normalized through the same settings bounds as normal Cursor Mirror settings.
- The calibrator MUST save a compressed `.zip` package containing `frames.csv` and `metrics.json` only after an explicit user save command or an explicit command-line output path.
- The frame CSV SHOULD include per-frame motion pattern name, phase name, expected position, expected velocity, dark-pixel bounding boxes, and estimated separation values.
- The metrics JSON SHOULD include frame count, dark-frame count, baseline dark bounds, average estimated separation, p95 estimated separation, maximum estimated separation, capture source, runtime mode, per-pattern separation summaries, active experimental prediction timing settings, and product prediction diagnostic counters when a Cursor Mirror overlay runtime is measured.
- Dark-pixel analysis SHOULD use a documented threshold and SHOULD operate in memory before writing aggregate results.

### 13.5 Testing
- Normal CI MUST NOT launch the calibrator, install real hooks, capture the real display, or move the real cursor.
- Unit tests MUST cover dark-pixel bounding-box detection, calibration run summary calculations, motion pattern coverage, and per-pattern summary calculations.
- Manual validation SHOULD cover full-screen startup on the primary display, WGC frame capture, keyboard cancellation, mouse input blocking, the save-dialog flow, explicit command-line output, package creation, and readability of `frames.csv` and `metrics.json`.
