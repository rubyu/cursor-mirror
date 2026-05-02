## 6. Conformance and Testing

### 6.1 Deterministic Unit Tests
- Hook lifetime tests MUST cover inactive, activate, double activate, unhook, double unhook, and dispose paths.
- Coordinate calculation tests MUST cover hot spot alignment, negative coordinates, large cursor images, and monitor-edge positions.
- Cursor image conversion tests MUST cover successful image creation, invalid handle behavior, and resource disposal behavior.
- Movement translucency and idle-fade tests MUST cover default settings, disabled behavior, movement entry, movement continuation, idle exit, idle fade after a stopped pointer, movement recovery from idle fade, linear enter easing, linear exit easing, and zero-duration transitions.
- Predictive overlay positioning tests MUST cover default settings, disabled behavior, first sample behavior, valid constant-velocity prediction, invalid timestamps, idle reset, reset behavior, negative coordinates, and hot spot placement after prediction.
- Settings tests MUST cover defaults, validation, range clamping or rejection, serialization, deserialization, missing settings, corrupt settings, reset behavior, immediate application of changed values, and idle-fade setting persistence.
- Version freshness tests MUST cover stable up-to-date status, stable behind counts, development snapshot status, and invalid release-tag filtering without performing network access.
- Tray controller tests SHOULD cover exit command dispatch and cleanup idempotence.
- Settings UI controller tests SHOULD cover settings command dispatch, duplicate-window prevention, close-without-exit behavior, and settings-window exit dispatch.
- Window style tests SHOULD verify that the overlay sets the expected extended styles.

### 6.2 Windows API Boundary Tests
- Tests SHOULD isolate Windows API calls behind small interfaces where practical.
- Unit tests MUST use test doubles for hook installation, cursor capture, and overlay movement when direct Windows API calls would make the test nondeterministic.
- Automated tests run by normal developer commands or CI MUST NOT install global Windows hooks.
- Automated tests run by normal developer commands or CI MUST NOT depend on real pointer movement, real tray interaction, or an interactive desktop session.
- Predictive overlay positioning tests MUST use synthetic timestamps and movement samples for normal unit and CI coverage.
- DWM-synchronized runtime scheduler tests MUST use synthetic DWM timing inputs for normal unit and CI coverage.
- Normal unit and CI tests MUST NOT require a real DWM compositor timing query to succeed.
- Dedicated overlay runtime tests SHOULD isolate thread ownership and dispatch behavior without installing a real hook or requiring real pointer movement.
- Performance and latency comparisons for overlay runtime changes SHOULD be based on trace packages captured through the trace tool, with DWM timing, runtime scheduler timing, and reference polling streams enabled.
- Integration tests MAY exercise real Windows APIs.
- Integration tests that install a real low-level hook MUST be opt-in and MUST be excluded from normal CI unless the CI environment is explicitly known to support interactive desktop hooks.
- Opt-in interactive tests SHOULD require an explicit signal such as `CURSOR_MIRROR_RUN_INTERACTIVE_TESTS=1`.
- Integration tests MUST clean up hooks and tray icons even when assertions fail.
- UI automation tests SHOULD prefer controller-level or form-level seams that do not require a global hook.

### 6.3 Manual Validation
Manual validation MUST include:

- normal startup with no visible main window;
- tray icon appears;
- tray context menu shows the embedded version and either release freshness or an unknown update status;
- tray `Exit` terminates the process and removes the tray icon;
- cursor overlay follows pointer movement;
- overlay does not intercept clicks;
- overlay remains topmost over normal application windows;
- overlay aligns with the real cursor hot spot;
- predictive overlay positioning is enabled by default;
- disabling predictive overlay positioning in settings returns the overlay to exact pointer positioning;
- movement translucency is visible during pointer movement;
- movement translucency returns to normal opacity after the movement idle delay;
- idle fade reduces overlay opacity after the configured stopped-pointer delay and restores visibility on the next movement;
- movement translucency remains readable through the target remote-control environment at default settings;
- settings window opens from the tray icon and from the tray context menu;
- settings changes apply without restarting the application;
- settings persist after restart;
- settings `Close` does not terminate the process;
- settings `Exit Cursor Mirror` terminates the process and removes the tray icon;
- overlay tracking remains responsive while the settings window is open or being changed;
- overlay works on a multi-monitor layout when available;
- overlay works with at least one high-DPI scale factor when available;
- behavior through Parsec or the target remote-control environment.

### 6.4 Regression Artifacts
- If a visual alignment bug is fixed, the reproduction steps SHOULD be recorded in the relevant test or issue.
- If a cursor image conversion bug is fixed, a minimal fixture or synthetic test case SHOULD be added when practical.
- If a settings or movement-translucency regression is fixed, a deterministic unit test SHOULD be added at the controller or state-machine boundary.
- Manual Parsec validation results SHOULD record the Windows version, DPI settings, monitor count, and remote-control software version.

### 6.5 Test Identifiers in Tests
- Every test MUST include its COT identifier in the canonical form `[COT-<S><F><M>-<n>]` within an adjacent comment, to ensure searchability and traceability to this specification. See Appendix A.2.
- The COT identifier MUST appear at the end of the comment immediately preceding the test function or test method.

Examples:
- Single: `[COT-MHU-1]`
- Multiple: `[COT-MHU-1][COT-MOU-2]`
