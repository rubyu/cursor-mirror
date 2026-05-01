## Appendix A. Test Coverage Checklist

### A.1 Overview
Appendix A provides a testing coverage map for this specification. Coverage is organized by scope, then by test family, and finally by method. Each test item refers to the relevant normative sections instead of restating all details inline.

This appendix is normative overall. Explanatory background may be explicitly labeled `Informative`.

Structure:
- A.2 Identifiers and Conventions
- A.3 Taxonomy and Notation
- A.4 Module-Level Tests
- A.5 Broader-Scope Tests

### A.2 Identifiers and Conventions
#### A.2.1 Format and Codes
This specification assigns a stable, semantic identifier to every test item in Appendix A using the format `COT-<S><F><M>-<n>`.

- Scope code `<S>`:
  - `M` = Module-level tests
  - `B` = Broader-scope tests

- Family code `<F>`:
  - `H` = Hook lifetime and event handling
  - `C` = Cursor capture and hot spot metadata
  - `O` = Overlay window behavior
  - `T` = Tray and application lifetime
  - `S` = Settings UI and persistence
  - `D` = DPI and multi-monitor coordinates
  - `L` = Mouse trace tooling
  - `P` = Packaging and runtime dependencies
  - `R` = Resource management and failure handling
  - `V` = Visual and remote-control validation

- Method code `<M>`:
  - `U` = Unit
  - `I` = Integration
  - `M` = Manual

- Counter `<n>`:
  - For each unique triple `<S,F,M>`, numbering starts at 1 and increments by 1 in document order.

#### A.2.2 Stability and Migration
- Identifiers MUST NOT be reused.
- Minor wording edits or reordering items MUST NOT change identifiers.
- Moving an item across scope or family REQUIRES minting a new identifier. The previous identifier is retired and MUST remain unused thereafter.
- Editorial and change-control rule: do not renumber existing items. Append new items at the end of the relevant `<S,F,M>` group and allocate the next counter value.

#### A.2.3 Usage Requirements
- Specification: Each item in Appendix A MUST start with its COT identifier in the canonical form:
  `COT-<S><F><M>-<n> - <concise item title>`
- Tests: Implementations MUST include the corresponding COT identifier in an adjacent comment so failures can be searched and traced to this specification.
- For compact formatting, implementers MAY wrap identifiers as `[COT-...]`. Both forms are equivalent for conformance.
- Each item SHOULD include a `Refs:` line naming the relevant normative sections.
- Item text MUST follow a simple template where applicable:
  - Success: expected successful behavior.
  - Failure: expected failure behavior and cleanup requirement.
  - Notes: assumptions and scope boundaries.

### A.3 Taxonomy and Notation
This section defines the scope and intent of each test family. Code definitions are centralized in Appendix A.2.

- H: Hook lifetime and event handling - Installation, callback behavior, pass-through semantics, and unhooking.
- C: Cursor capture and hot spot metadata - Cursor handle copying, bitmap conversion, hot spot extraction, and invalid-handle behavior.
- O: Overlay window behavior - Extended styles, topmost behavior, click-through behavior, no-activate behavior, drawing, movement, and opacity behavior.
- T: Tray and application lifetime - Tray icon creation, menu actions, startup, shutdown, settings entry points, and cleanup.
- S: Settings UI and persistence - Settings defaults, validation, persistence, reset, immediate application, and settings-window command behavior.
- D: DPI and multi-monitor coordinates - DPI awareness, virtual screen coordinates, negative coordinates, and scaling behavior.
- L: Mouse trace tooling - Trace session state, sample collection, UI state derivation, package writing, and manual trace capture.
- P: Packaging and runtime dependencies - Target runtime, artifact shape, and no-install expectations.
- R: Resource management and failure handling - Native handle disposal, exception containment, and cleanup under failure.
- V: Visual and remote-control validation - Human-observable alignment and target remote-control software behavior.

Headings follow `A.<scope>.<family>`. Within each family, items are grouped by method in the fixed order: Unit, Integration, Manual.

### A.4 Module-Level Tests
#### A.4.H Hook Lifetime and Event Handling
##### Unit
- COT-MHU-1 - Hook inactive and activate
  Verify that a newly created hook reports inactive state, successful activation reports active state, and activation calls the native hook installer once.
  Refs: Sections 3.1, 4.2.

- COT-MHU-2 - Double activate rejected
  Verify that activating an already active hook fails deterministically and does not install a second hook.
  Refs: Section 4.2.

- COT-MHU-3 - Unhook and double unhook
  Verify that unhook transitions to inactive state and that unhooking an inactive hook fails deterministically.
  Refs: Section 4.2.

- COT-MHU-4 - Dispose unhooks
  Verify that disposing an active hook calls the native unhook function once and leaves the hook inactive.
  Refs: Sections 3.4, 4.2.

- COT-MHU-5 - Mouse move pass-through
  Verify that `WM_MOUSEMOVE` produces an overlay update request and still returns pass-through behavior.
  Refs: Sections 3.2, 4.2.

- COT-MHU-6 - Non-move pass-through
  Verify that button, wheel, and unrelated events are passed through without cancellation.
  Refs: Section 4.2.

#### A.4.C Cursor Capture and Hot Spot Metadata
##### Unit
- COT-MCU-1 - Current cursor handle copied
  Verify that cursor capture copies the active cursor handle before drawing or converting it.
  Refs: Section 4.3.

- COT-MCU-2 - Hot spot extracted
  Verify that the hot spot returned by cursor metadata is preserved and exposed to coordinate calculation.
  Refs: Sections 4.3, 4.4.

- COT-MCU-3 - Invalid cursor capture is non-fatal
  Verify that cursor capture failure for one event does not terminate the controller.
  Refs: Section 3.4.

- COT-MCU-4 - Copied icon handle disposed
  Verify that copied icon handles and bitmap resources are disposed on both success and failure paths.
  Refs: Sections 4.3, 6.1.

#### A.4.O Overlay Window Behavior
##### Unit
- COT-MOU-1 - Extended styles
  Verify that the overlay sets `WS_EX_LAYERED`, `WS_EX_TRANSPARENT`, `WS_EX_NOACTIVATE`, and `WS_EX_TOOLWINDOW` or equivalent behavior.
  Refs: Section 4.4.

- COT-MOU-2 - Hot spot alignment calculation
  For pointer `(px, py)` and hot spot `(hx, hy)`, verify overlay position `(px - hx, py - hy)`.
  Refs: Section 4.4.

- COT-MOU-3 - Large cursor size
  Verify that overlay sizing is based on the captured cursor image and does not assume the default arrow size.
  Refs: Section 4.4.

- COT-MOU-4 - Topmost request
  Verify that overlay show or update paths request topmost behavior.
  Refs: Section 4.4.

- COT-MOU-5 - Movement translucency default enabled
  Verify that default settings enable movement translucency mode.
  Refs: Section 4.4.1.

- COT-MOU-6 - Movement translucency disabled
  Verify that disabling movement translucency keeps overlay opacity at normal opacity for movement and idle periods.
  Refs: Section 4.4.1.

- COT-MOU-7 - Movement enter transition
  Verify that the first movement after idle enters the moving state and begins a linear transition toward moving opacity.
  Refs: Section 4.4.1.

- COT-MOU-8 - Movement continuation
  Verify that repeated movement before the idle delay expires keeps the overlay in moving state and does not start an exit transition.
  Refs: Section 4.4.1.

- COT-MOU-9 - Idle exit transition
  Verify that the overlay starts returning to normal opacity only after no movement has been observed for the configured idle delay.
  Refs: Section 4.4.1.

- COT-MOU-10 - Linear easing
  Verify that enter and exit opacity transitions are linear between their start and target opacity values.
  Refs: Section 4.4.1.

- COT-MOU-11 - Zero-duration opacity transition
  Verify that a zero fade duration applies the target opacity immediately without division-by-zero or transient invalid values.
  Refs: Section 4.4.1.

- COT-MOU-12 - Opacity does not affect placement
  Verify that opacity changes do not alter overlay size or hot spot alignment calculations.
  Refs: Sections 4.4, 4.4.1.

- COT-MOU-13 - Prediction disabled exact positioning
  Verify that disabling predictive overlay positioning uses the exact pointer position before hot spot placement.
  Refs: Sections 4.4, 4.4.2.

- COT-MOU-14 - Prediction first sample exact positioning
  Verify that the first movement sample has no valid velocity and predicts the exact current pointer position.
  Refs: Section 4.4.2.

- COT-MOU-15 - Constant-velocity prediction
  Given two valid movement samples and a fixed horizon, verify that the predicted pointer follows the documented constant-velocity formula.
  Refs: Section 4.4.2.

- COT-MOU-16 - Prediction invalid timestamp reset
  Verify that zero or negative sample intervals clear velocity and fall back to exact pointer positioning.
  Refs: Section 4.4.2.

- COT-MOU-17 - Prediction idle reset
  Verify that a movement sample after the configured idle reset gap clears velocity and does not extrapolate stale motion.
  Refs: Section 4.4.2.

- COT-MOU-18 - Prediction reset paths
  Verify that hiding the overlay, disposing the controller, disabling prediction, or applying prediction-related settings clears prediction velocity.
  Refs: Section 4.4.2.

- COT-MOU-19 - Prediction then hot spot placement
  Verify that hot spot placement is applied after selecting the exact or predicted pointer position.
  Refs: Sections 4.4, 4.4.2.

- COT-MOU-20 - Polling moves overlay without cursor capture
  Verify that a polling tick moves the existing overlay image using the latest cursor position without recapturing the cursor image.
  Refs: Sections 4.3, 4.4, 4.4.2.

- COT-MOU-21 - Polling DWM next-vblank prediction
  Verify that polling samples with valid DWM timing use the next-vblank horizon and the documented prediction gain.
  Refs: Section 4.4.2.

- COT-MOU-22 - Polling missing DWM fallback
  Verify that missing DWM timing falls back to exact pointer positioning and increments the diagnostic counters.
  Refs: Section 4.4.2.

#### A.4.T Tray and Application Lifetime
##### Unit
- COT-MTU-1 - Tray icon created
  Verify that startup creates exactly one tray icon.
  Refs: Sections 2.3, 4.5.

- COT-MTU-2 - Exit command dispatch
  Verify that selecting `Exit` invokes application shutdown.
  Refs: Sections 2.3, 4.5, 5.3.

- COT-MTU-3 - Tray cleanup idempotence
  Verify that tray cleanup can run more than once without leaving the icon visible or throwing.
  Refs: Sections 4.5, 5.3.

- COT-MTU-4 - Localized user-visible strings
  Verify that user-visible commands and startup diagnostics are resolved through the localization boundary, with English as the default language.
  Refs: Section 2.3.

- COT-MTU-5 - Settings command dispatch
  Verify that the tray `Settings` command invokes the settings-window show path.
  Refs: Sections 2.3, 4.5.

- COT-MTU-6 - Tray primary activation dispatch
  Verify that primary-button activation of the tray icon invokes the settings-window show path.
  Refs: Sections 2.3, 4.5.

- COT-MTU-7 - Settings close does not exit
  Verify that closing the settings window does not invoke application shutdown.
  Refs: Section 4.5.1.

- COT-MTU-8 - Settings exit command dispatch
  Verify that `Exit Cursor Mirror` in the settings window invokes the same shutdown path as tray `Exit`.
  Refs: Sections 2.3, 4.5.1.

#### A.4.S Settings UI and Persistence
##### Unit
- COT-MSU-1 - Settings defaults
  Verify documented default settings: movement translucency enabled, predictive overlay positioning enabled, moving opacity `70%`, fade duration `80ms`, and idle delay `120ms`.
  Refs: Sections 4.4.1, 4.4.2, 4.5.1.

- COT-MSU-2 - Moving opacity validation
  Verify that moving opacity values outside `1%` to `100%` are rejected or clamped consistently at the settings boundary.
  Refs: Section 4.4.1.

- COT-MSU-3 - Timing validation
  Verify that fade duration and idle delay values outside their documented ranges are rejected or clamped consistently at the settings boundary.
  Refs: Section 4.4.1.

- COT-MSU-4 - Settings serialization round trip
  Verify that settings saved to the structured settings format load back to equivalent runtime settings.
  Refs: Section 5.5.

- COT-MSU-5 - Missing settings fallback
  Verify that missing settings load documented defaults without preventing startup.
  Refs: Section 5.5.

- COT-MSU-6 - Corrupt settings fallback
  Verify that corrupt settings load documented defaults without preventing startup.
  Refs: Section 5.5.

- COT-MSU-7 - Settings reset
  Verify that the settings reset command restores documented defaults.
  Refs: Section 4.5.1.

- COT-MSU-8 - Immediate settings application
  Verify that settings changes are applied to runtime services without requiring application restart.
  Refs: Sections 3.2, 4.5.1.

- COT-MSU-9 - Prediction setting persistence
  Verify that predictive overlay positioning can be disabled, saved, loaded, reset to default enabled, and applied immediately.
  Refs: Sections 2.3, 4.4.2, 4.5.1, 5.5.

#### A.4.D DPI and Multi-Monitor Coordinates
##### Unit
- COT-MDU-1 - Negative coordinates
  Verify that coordinate calculation accepts negative `X` and `Y` values without clamping.
  Refs: Section 4.6.

- COT-MDU-2 - Monitor-edge coordinates
  Verify that overlay placement is not clamped to the primary monitor.
  Refs: Sections 4.4, 4.6.

- COT-MDU-3 - DPI coordinate-space consistency
  Verify that controller calculations use one coordinate-space abstraction and do not mix logical and physical units.
  Refs: Section 4.1.

#### A.4.P Packaging and Runtime Dependencies
##### Unit
- COT-MPU-1 - Informational version shape
  Verify that the embedded informational version follows the stable or development snapshot form.
  Refs: Sections 10.1, 10.3, 10.4.

- COT-MPU-2 - Numeric assembly version shape
  Verify that the embedded assembly and file versions use the numeric `MAJOR.MINOR.PATCH.0` form required by .NET metadata.
  Refs: Section 10.3.

#### A.4.L Mouse Trace Tooling
##### Unit
- COT-MLU-1 - Trace session starts empty
  Verify that a newly created trace session is idle, has no samples, and has zero elapsed duration.
  Refs: Sections 11.4, 11.5.

- COT-MLU-2 - Trace session start and stop transitions
  Verify `Idle`, `Recording`, `StoppedWithSamples`, and `Saved` transitions without installing a real hook.
  Refs: Sections 11.4, 11.8.

- COT-MLU-3 - Trace tool button enabled states
  Verify that Start, Stop, Save, and Exit enabled states match the current trace state.
  Refs: Section 11.3.

- COT-MLU-4 - Trace sample append increments count
  Verify that appending movement samples increments sequence and sample count and preserves coordinates.
  Refs: Section 11.5.

- COT-MLU-5 - Trace elapsed duration formatting
  Verify that recording duration is formatted consistently for display.
  Refs: Section 11.3.

- COT-MLU-6 - Trace zip package contents
  Verify that saving a trace writes a zip package containing `trace.csv` and `metadata.json`, and that the CSV contains the expected header and rows.
  Refs: Section 11.6.

- COT-MLU-7 - Empty trace save rejected
  Verify that saving an empty trace fails clearly at the trace writer boundary.
  Refs: Section 11.6.

- COT-MLU-8 - Repeated stop cleanup
  Verify that stopping an already stopped trace session is safe and leaves the session in a valid state.
  Refs: Sections 11.4, 11.7.

- COT-MLU-9 - Trace hook and poll sample fields
  Verify that hook movement samples and periodic cursor-position poll samples preserve their source-specific fields.
  Refs: Section 11.5.

- COT-MLU-10 - Trace DWM timing fields
  Verify that samples with DWM timing available are written with DWM timing fields and reflected in metadata counts.
  Refs: Sections 11.5, 11.6.

- COT-MLU-11 - Trace sample count breakdown
  Verify that total, hook movement, cursor polling, and DWM timing sample counts are reported separately.
  Refs: Sections 11.3, 11.5.

#### A.4.R Resource Management and Failure Handling
##### Unit
- COT-MRU-1 - Hook callback exception containment
  Verify that an exception during event processing is contained and input remains pass-through.
  Refs: Sections 3.3, 3.4.

- COT-MRU-2 - Startup failure cleanup
  Verify that startup failure after tray creation removes the tray icon and unhooks any installed hook.
  Refs: Sections 3.4, 5.3.

- COT-MRU-3 - Shutdown order
  Verify that shutdown unhooks before disposing the overlay window.
  Refs: Section 5.3.

### A.5 Broader-Scope Tests
#### A.5.H Hook Lifetime and Event Handling
##### Integration
- COT-BHI-1 - Real low-level hook install
  In an explicitly opt-in interactive test run, install the real `WH_MOUSE_LL` hook and verify that a mouse move produces one or more callbacks. This test MUST NOT run in normal CI or default developer test commands.
  Refs: Sections 4.2, 6.2.

- COT-BHI-2 - Real hook cleanup
  In an explicitly opt-in interactive test run, install and remove the hook, then verify that the process exits without leaving a hook-dependent background thread or window. This test MUST NOT run in normal CI or default developer test commands.
  Refs: Sections 4.2, 5.3, 6.2.

#### A.5.O Overlay Window Behavior
##### Integration
- COT-BOI-1 - Click-through behavior
  With the overlay visible, click a test window underneath and verify that the underlying window receives the click.
  Refs: Section 4.4.

- COT-BOI-2 - No-activate behavior
  With another window focused, show and move the overlay and verify that focus remains on the original window.
  Refs: Section 4.4.

- COT-BOI-3 - Topmost behavior
  Show the overlay over a normal top-level window and verify that the overlay remains visible above it.
  Refs: Section 4.4.

- COT-BOI-4 - Layered opacity application
  With the overlay visible, apply a non-100% opacity setting and verify that the overlay remains visible, click-through, no-activate, and topmost.
  Refs: Sections 4.4, 4.4.1.

#### A.5.T Tray and Application Lifetime
##### Integration
- COT-BTI-1 - Tray exit terminates process
  Start the application, invoke tray `Exit`, and verify process termination and tray icon removal.
  Refs: Sections 4.5, 5.3.

- COT-BTI-2 - Tray primary activation opens settings
  Start the application, activate the tray icon with the primary button, and verify that the settings window appears.
  Refs: Sections 2.3, 4.5.

- COT-BTI-3 - Tray context settings opens settings
  Start the application, invoke tray `Settings`, and verify that the settings window appears.
  Refs: Sections 2.3, 4.5.

- COT-BTI-4 - Settings exit terminates process
  Start the application, open settings, invoke `Exit Cursor Mirror`, and verify process termination and tray icon removal.
  Refs: Sections 4.5.1, 5.3.

#### A.5.S Settings UI and Persistence
##### Integration
- COT-BSI-1 - Settings controls apply immediately
  Change movement translucency settings through the settings UI and verify that the runtime controller observes the new values without restarting.
  Refs: Sections 3.2, 4.5.1.

- COT-BSI-2 - Settings persist after restart
  Change settings, terminate normally, restart the application, and verify that the changed settings are restored.
  Refs: Sections 4.5.1, 5.5.

- COT-BSI-3 - Settings close keeps process running
  Open settings, invoke `Close`, and verify that the process and tray icon remain active.
  Refs: Section 4.5.1.

- COT-BSI-4 - Duplicate settings open focuses existing window
  Open settings twice and verify that only one settings window exists and the existing window is brought forward.
  Refs: Section 4.5.1.

- COT-BSI-5 - Settings reset restores defaults
  Change settings through the UI, invoke `Reset`, and verify that controls and runtime settings return to documented defaults.
  Refs: Sections 4.4.1, 4.5.1.

- COT-BSI-6 - Prediction toggle applies immediately
  Change predictive overlay positioning through the settings UI and verify that the runtime controller observes the new value without restarting.
  Refs: Sections 4.4.2, 4.5.1.

#### A.5.P Packaging and Runtime Dependencies
##### Integration
- COT-BPI-1 - Release artifact starts
  On a clean supported Windows environment, start the release artifact and verify normal tray startup.
  Refs: Section 5.1.

- COT-BPI-2 - No administrator requirement
  Start the release artifact as a standard user and verify that startup does not require elevation.
  Refs: Section 5.2.

#### A.5.L Mouse Trace Tooling
##### Integration
- COT-BLI-1 - Trace tool starts as visible window
  Start the trace tool and verify that it opens a normal visible window without starting Cursor Mirror.
  Refs: Sections 11.1, 11.2.

- COT-BLI-2 - Trace package save dialog writes zip
  Record or inject a trace session, save through the UI, and verify that a zip package is written.
  Refs: Sections 11.3, 11.6.

##### Manual
- COT-BLM-1 - Manual trace capture session
  In an explicitly launched trace tool session, start recording, move the mouse, stop recording, save, and verify that the package can be opened and contains movement samples.
  Refs: Sections 11.2, 11.6, 11.8.

- COT-BLM-2 - Manual trace hook cleanup
  Start and stop recording, then exit the trace tool and verify that no hook-dependent process or visible window remains.
  Refs: Sections 11.2, 11.7, 11.8.

#### A.5.V Visual and Remote-Control Validation
##### Manual
- COT-BVM-1 - Local visual alignment
  Verify that the overlay image is visually aligned with the real cursor hot spot on the local desktop.
  Refs: Sections 4.3, 4.4, 6.3.

- COT-BVM-2 - Parsec visibility
  Verify through Parsec that the copied cursor overlay is visible when the real cursor is not visible or not transmitted correctly.
  Refs: Sections 2.1, 6.3.

- COT-BVM-3 - Multi-monitor manual pass
  Verify pointer tracking across monitors, including a layout with negative virtual-screen coordinates when available.
  Refs: Sections 4.6, 6.3.

- COT-BVM-4 - High-DPI manual pass
  Verify cursor alignment at a non-100% DPI scale factor when available.
  Refs: Sections 4.1, 6.3.

- COT-BVM-5 - Click-through manual pass
  Verify that clicking while the overlay is visible interacts with the application underneath, not the overlay.
  Refs: Sections 4.4, 6.3.

- COT-BVM-6 - Movement translucency manual pass
  Verify that the overlay becomes translucent while moving, returns to normal opacity after idle, and does not visibly lag behind the real cursor.
  Refs: Sections 4.4.1, 6.3.

- COT-BVM-7 - Parsec translucency visibility
  Verify through Parsec that the default moving opacity remains visible enough to solve the missing-cursor problem.
  Refs: Sections 2.1, 4.4.1, 6.3.

- COT-BVM-8 - Settings UI manual pass
  Verify that the settings window is readable, does not overlap incoherently at common DPI scales, and provides clear `Close` and `Exit Cursor Mirror` behavior.
  Refs: Sections 4.5.1, 6.3.

- COT-BVM-9 - Prediction settings manual pass
  Verify that predictive overlay positioning is enabled by default, can be disabled from the settings window, and returns to exact pointer positioning when disabled.
  Refs: Sections 2.3, 4.4.2, 4.5.1, 6.3.
