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
  - `D` = DPI and multi-monitor coordinates
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
- O: Overlay window behavior - Extended styles, topmost behavior, click-through behavior, no-activate behavior, drawing, and movement.
- T: Tray and application lifetime - Tray icon creation, menu actions, startup, shutdown, and cleanup.
- D: DPI and multi-monitor coordinates - DPI awareness, virtual screen coordinates, negative coordinates, and scaling behavior.
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
  On an interactive Windows desktop, install the real `WH_MOUSE_LL` hook and verify that a mouse move produces one or more callbacks.
  Refs: Sections 4.2, 6.2.

- COT-BHI-2 - Real hook cleanup
  On an interactive Windows desktop, install and remove the hook, then verify that the process exits without leaving a hook-dependent background thread or window.
  Refs: Sections 4.2, 5.3.

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

#### A.5.T Tray and Application Lifetime
##### Integration
- COT-BTI-1 - Tray exit terminates process
  Start the application, invoke tray `Exit`, and verify process termination and tray icon removal.
  Refs: Sections 4.5, 5.3.

#### A.5.P Packaging and Runtime Dependencies
##### Integration
- COT-BPI-1 - Release artifact starts
  On a clean supported Windows environment, start the release artifact and verify normal tray startup.
  Refs: Section 5.1.

- COT-BPI-2 - No administrator requirement
  Start the release artifact as a standard user and verify that startup does not require elevation.
  Refs: Section 5.2.

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
