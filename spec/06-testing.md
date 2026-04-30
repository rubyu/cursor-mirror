## 6. Conformance and Testing

### 6.1 Deterministic Unit Tests
- Hook lifetime tests MUST cover inactive, activate, double activate, unhook, double unhook, and dispose paths.
- Coordinate calculation tests MUST cover hot spot alignment, negative coordinates, large cursor images, and monitor-edge positions.
- Cursor image conversion tests MUST cover successful image creation, invalid handle behavior, and resource disposal behavior.
- Tray controller tests SHOULD cover exit command dispatch and cleanup idempotence.
- Window style tests SHOULD verify that the overlay sets the expected extended styles.

### 6.2 Windows API Boundary Tests
- Tests SHOULD isolate Windows API calls behind small interfaces where practical.
- Unit tests MUST use test doubles for hook installation, cursor capture, and overlay movement when direct Windows API calls would make the test nondeterministic.
- Integration tests MAY exercise real Windows APIs.
- Integration tests that install a real low-level hook MUST be excluded from normal CI unless the CI environment is explicitly known to support interactive desktop hooks.
- Integration tests MUST clean up hooks and tray icons even when assertions fail.

### 6.3 Manual Validation
Manual validation MUST include:

- normal startup with no visible main window;
- tray icon appears;
- tray `Exit` terminates the process and removes the tray icon;
- cursor overlay follows pointer movement;
- overlay does not intercept clicks;
- overlay remains topmost over normal application windows;
- overlay aligns with the real cursor hot spot;
- overlay works on a multi-monitor layout when available;
- overlay works with at least one high-DPI scale factor when available;
- behavior through Parsec or the target remote-control environment.

### 6.4 Regression Artifacts
- If a visual alignment bug is fixed, the reproduction steps SHOULD be recorded in the relevant test or issue.
- If a cursor image conversion bug is fixed, a minimal fixture or synthetic test case SHOULD be added when practical.
- Manual Parsec validation results SHOULD record the Windows version, DPI settings, monitor count, and remote-control software version.

### 6.5 Test Identifiers in Tests
- Every test MUST include its COT identifier in the canonical form `[COT-<S><F><M>-<n>]` within an adjacent comment, to ensure searchability and traceability to this specification. See Appendix A.2.
- The COT identifier MUST appear at the end of the comment immediately preceding the test function or test method.

Examples:
- Single: `[COT-MHU-1]`
- Multiple: `[COT-MHU-1][COT-MOU-2]`
