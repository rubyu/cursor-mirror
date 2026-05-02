# Cursor Mirror Developer Specification

This document set defines the normative specification for Cursor Mirror, including overlay behavior, Windows integration, packaging constraints, conformance requirements, and the test contract. This document is not a user guide.

The key words `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are to be interpreted as described in BCP 14 (RFC 2119 and RFC 8174) when, and only when, they appear in all capitals.

## Table of Contents

- 1. Foundations and Conventions - [01-foundations.md](01-foundations.md)
  - 1.1 Scope and Normativity
  - 1.2 Vocabulary Style
  - 1.3 Terminology and Definitions
- 2. Goals and Non-Goals - [02-goals.md](02-goals.md)
  - 2.1 Goals
  - 2.2 Non-Goals
  - 2.3 User-Visible Product Shape
- 3. Runtime Architecture - [03-architecture.md](03-architecture.md)
  - 3.1 Components
  - 3.2 Event Flow
  - 3.3 Threading and Message Pump
  - 3.4 Failure Policy
- 4. Windows Integration - [04-windows-integration.md](04-windows-integration.md)
  - 4.1 Process DPI Awareness
  - 4.2 Low-Level Mouse Hook
  - 4.3 Cursor Capture
  - 4.4 Overlay Window
  - 4.4.1 Movement Translucency Mode
  - 4.4.2 Predictive Overlay Positioning
  - 4.5 Tray Resident Application
  - 4.5.1 Settings Window
  - 4.6 Multi-Monitor Coordinates
- 5. Packaging and Runtime Dependencies - [05-packaging.md](05-packaging.md)
  - 5.1 Target Runtime
  - 5.2 Build Outputs
  - 5.3 Startup and Shutdown
  - 5.4 Version Information
  - 5.5 User Settings Persistence
- 6. Conformance and Testing - [06-testing.md](06-testing.md)
  - 6.1 Deterministic Unit Tests
  - 6.2 Windows API Boundary Tests
  - 6.3 Manual Validation
  - 6.4 Regression Artifacts
  - 6.5 Test Identifiers in Tests
- 10. Versioning and Release Semantics - [10-versioning.md](10-versioning.md)
  - 10.1 Version String Forms
  - 10.2 Branch and Tag Rules
  - 10.3 .NET Assembly Metadata
  - 10.4 Build-Time Embedding
  - 10.5 Package Naming
  - 10.6 Informative Examples
- 11. Mouse Trace Tool - [11-mouse-trace-tool.md](11-mouse-trace-tool.md)
  - 11.1 Purpose and Scope
  - 11.2 Application Shape
  - 11.3 UI Requirements
  - 11.4 Recording State Model
  - 11.5 Captured Data
  - 11.6 Output Package Format
  - 11.7 Performance and Safety
  - 11.8 Testing
- 12. Demo Application - [12-demo-app.md](12-demo-app.md)
  - 12.1 Purpose and Scope
  - 12.2 Application Shape
  - 12.3 Startup Controls
  - 12.4 Demo Scene
  - 12.5 Real Cursor Driving and Free Mode
  - 12.6 Safety
  - 12.7 Main Application Shutdown Request
  - 12.8 Testing
- 13. Calibrator Application - [13-calibrator.md](13-calibrator.md)
  - 13.1 Purpose and Scope
  - 13.2 Capture Scene
  - 13.3 Input Safety
  - 13.4 Output
  - 13.5 Testing
- Appendix A. Test Coverage Checklist - [A-test-coverage.md](A-test-coverage.md)
  - A.1 Overview
  - A.2 Identifiers and Conventions
  - A.3 Taxonomy and Notation
  - A.4 Module-Level Tests
  - A.5 Broader-Scope Tests

## Open Decisions

- Whether the first implementation target is `.NET Framework 4.8` only, or whether a self-contained modern .NET build is also required.
- Whether the application includes a pause/resume tray command in addition to exit.
- Whether cursor capture is performed on every `WM_MOUSEMOVE` event or only when the cursor handle changes.
