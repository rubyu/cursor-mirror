# Contributing

This document collects developer-facing notes for building, testing, packaging, releasing, and diagnosing Cursor Mirror.

## Development Environment

Cursor Mirror targets Windows desktop environments. The product is implemented with .NET Framework 4.x so release builds can run on many Windows systems without requiring a separate modern .NET runtime installation.

The runtime uses Win32 APIs including `SetWindowsHookEx`, `GetCursorInfo`, `CopyIcon`, `GetIconInfo`, `DrawIconEx`, and `UpdateLayeredWindow`.

## Build

Build the solution:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

Build Release:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1 -Configuration Release
```

## Test

Run tests:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

Tests should avoid installing live global hooks or depending on desktop state unless the test is explicitly isolated for manual or tool-driven validation.

## Packaging

Build a Release executable, run tests, and create a zip package:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package.ps1
```

Package artifacts are written to:

```text
artifacts\package\
```

The zip contains:

```text
CursorMirror.exe
CursorMirror.Core.dll
CursorMirror.TraceTool.exe
CursorMirror.Demo.exe
CursorMirror.Calibrator.exe
CursorMirror.MotionLab.exe
CursorMirror.LoadGen.exe
CursorMirror.KernelBench.exe
CursorMirror.KernelBench.Native.*.dll
README.md
CONTRIBUTING.md
LICENSE
```

Package without running tests:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package.ps1 -SkipTests
```

## Versioning

Builds embed version metadata at compile time.

- Stable release tags must use `vMAJOR.MINOR.PATCH`, such as `v0.1.0`.
- Stable binaries embed `vMAJOR.MINOR.PATCH+YYYYMMDD.SHA12` in `AssemblyInformationalVersion`.
- Development binaries embed `vMAJOR.MINOR.PATCH-dev+YYYYMMDD.SHA12`, with `.dirty` appended for uncommitted changes.
- `AssemblyVersion` and `AssemblyFileVersion` use `MAJOR.MINOR.PATCH.0`.

Release tags that do not match `vMAJOR.MINOR.PATCH` are rejected before packaging or publication.

The tray update check uses GitHub Releases, ignores non-stable release tags, and falls back to an unknown status if the check cannot complete.

## Diagnostic Tools

The release package includes these additional tools:

```text
CursorMirror.TraceTool.exe
CursorMirror.Demo.exe
CursorMirror.Calibrator.exe
CursorMirror.MotionLab.exe
CursorMirror.LoadGen.exe
CursorMirror.KernelBench.exe
```

### Trace Tool

`CursorMirror.TraceTool.exe` is a separate Windows app for collecting mouse movement samples.

It starts and stops recording from buttons in its window and saves traces as compressed `.zip` packages containing `trace.csv` and `metadata.json`.

Trace packages include hook movement samples, product-equivalent cursor polling, high-precision reference cursor polling, runtime scheduler samples, DWM timing when available, environment metadata, monitor metadata, and capture-quality statistics.

### Demo App

`CursorMirror.Demo.exe` is a separate Windows app for recording demonstrations and comparing cursor visibility across tools.

It can run fullscreen or at `640 x 480`, `1280 x 720`, and `1920 x 1080` presets, with `640 x 480` as the default. It moves the real Windows cursor from the left edge along a deterministic path and can show or hide its own Cursor Mirror overlay.

Demo language, display mode, speed, overlay, and movement settings are saved per user and restored on the next launch. If demo settings cannot be restored, the demo shows a warning, uses defaults, and attempts to reset the demo settings file.

When the built-in overlay is enabled, it uses the same prediction, movement-translucency, and idle-fade settings as the main app. If the main tray app is already running while the demo overlay is enabled, the demo warns before starting and can request the tray app to exit.

If the user moves the mouse during the demo, it switches to Free mode and stops injecting cursor movement. Auto mode resumes from the left edge after 3 seconds without user input. Press any keyboard key while the demo is running to return to the startup view.

### Calibrator

`CursorMirror.Calibrator.exe` runs a white full-screen measurement scene on the primary display, moves the real cursor through deterministic patterns, and captures frames with Windows Graphics Capture.

After a run, use the Save button to write `frames.csv` plus `metrics.json` in a compressed calibration package. Raw frames are not saved by default.

For automation, pass an explicit output path:

```powershell
CursorMirror.Calibrator.exe --auto-run --duration-seconds 5 --output calibration.zip --exit-after-run
```

During calibration, low-level mouse input is blocked so accidental mouse movement does not corrupt the run. Pressing any keyboard key stops calibration and releases the mouse hook.

### Motion Lab

`CursorMirror.MotionLab.exe` generates compact Bezier motion scripts for prediction research. It can preview a random bounded path, play it by moving the real Windows cursor, optionally start `CursorMirror.LoadGen.exe`, and save a `.zip` package containing `motion-script.json`, `motion-samples.csv`, and `metadata.json`.

`CursorMirror.LoadGen.exe` creates controlled CPU load in a separate process. It is intended for Motion Lab and scripted experiments, not for normal app use.

`CursorMirror.KernelBench.exe` reports CPU feature availability, including AVX, AVX2, FMA3, and AVX-512F, and writes scalar, CPU-friendly, and optional native SIMD benchmark results. Use `--out path.json` to save machine-readable output.

Native kernel DLLs are built by `scripts\build-native-kernels.ps1` when the MSVC x64 C++ toolchain is available. The main build invokes this script after building KernelBench. If the C++ toolchain is not installed, native kernels are skipped and KernelBench reports skip reasons in JSON.

## Settings Persistence

Settings are saved per user and restored on launch.

When settings cannot be restored, the app should show a warning, continue with defaults, and attempt to reset the affected settings file.

Settings writes should be resilient to incomplete saves. Write to a temporary file first, verify that the file can be read, then replace the active settings file. Keep a bounded number of backups when replacing an existing file.

## Specification

The developer specification is in [spec/README.md](spec/README.md).
