# Cursor Mirror

Cursor Mirror is a tiny Windows tray app that renders a clean mirrored cursor overlay for remote-viewer apps where the real cursor may disappear.

## Why Cursor Mirror?

A common workaround for Parsec is to enable Windows **Mouse pointer trails** and set the trail length to the minimum.

That workaround can help, but it is still a compromise: the cursor is shown as a trail, can feel visually delayed, and does not look like a single crisp pointer.

Cursor Mirror is built specifically for this problem. It shows one mirrored cursor overlay, keeps it aligned with the real cursor hot spot, and uses prediction plus opacity controls to stay visible without getting in your way.

## Features

- Mirrors the actual Windows cursor, including custom cursor shapes.
- Optimized rendering and predictive positioning help reduce visible lag during fast cursor movement.
- Movement and idle opacity controls keep the cursor visible without making it distracting.

## Usage

Run:

```powershell
CursorMirror.exe
```

Cursor Mirror starts without showing a normal window. To quit, right-click the notification-area icon and choose `Exit`.

Right-click the notification-area icon to view the embedded version and best-effort update status. The update check uses GitHub Releases, ignores non-stable release tags, and falls back to an unknown status if the check cannot complete.

Left-click the notification-area icon, or choose `Settings` from the context menu, to adjust prediction, the prediction model (`ConstantVelocity` or `LeastSquares`), prediction gain, movement translucency, and idle fade. The settings window also includes an `Exit Cursor Mirror` command.

Settings are saved per user and restored on the next launch. If a settings file cannot be restored, Cursor Mirror shows a warning, uses defaults, and attempts to reset that settings file.

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
README.md
LICENSE
```

## Development

Build:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

Run tests:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

Build Release:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1 -Configuration Release
```

The release package also includes a diagnostic trace tool:

```text
CursorMirror.TraceTool.exe
```

The trace tool is a separate Windows app for collecting mouse movement samples. It starts and stops recording from buttons in its window and saves traces as compressed `.zip` packages containing `trace.csv` and `metadata.json`. Trace packages include hook movement samples, product-equivalent cursor polling, high-precision reference cursor polling, runtime scheduler samples, DWM timing when available, environment metadata, monitor metadata, and capture-quality statistics.

The package also includes a demo app:

```text
CursorMirror.Demo.exe
```

The demo app is a separate Windows app for recording demonstrations and comparing cursor visibility across tools. It can run fullscreen or at `640 x 480`, `1280 x 720`, and `1920 x 1080` presets, with `640 x 480` as the default, moves the real Windows cursor from the left edge along a deterministic path, and can show or hide its own Cursor Mirror overlay. Demo language, display mode, speed, overlay, and movement settings are saved per user and restored on the next launch. If demo settings cannot be restored, the demo shows a warning, uses defaults, and attempts to reset the demo settings file. When the built-in overlay is enabled, it uses the same prediction, movement-translucency, and idle-fade settings as the main app. If the main tray app is already running while the demo overlay is enabled, the demo warns before starting and can request the tray app to exit. If the user moves the mouse during the demo, it switches to Free mode and stops injecting cursor movement; Auto mode resumes from the left edge after 3 seconds without user input. Press any keyboard key while the demo is running to return to the startup view.

The package also includes a calibrator app:

```text
CursorMirror.Calibrator.exe
```

The calibrator runs a white full-screen measurement scene on the primary display, moves the real cursor through deterministic patterns, and captures frames with Windows Graphics Capture. After a run, use the Save button to write `frames.csv` plus `metrics.json` in a compressed calibration package; raw frames are not saved by default. For automation, pass an explicit output path, such as `--auto-run --duration-seconds 5 --output calibration.zip --exit-after-run`. During calibration, low-level mouse input is blocked so accidental mouse movement does not corrupt the run; pressing any keyboard key stops calibration and releases the mouse hook.

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

## Specification

The developer specification is in [spec/README.md](spec/README.md).

## Runtime Notes

Cursor Mirror targets Windows desktop environments. Internally, it uses Win32 APIs such as `SetWindowsHookEx`, `GetCursorInfo`, `CopyIcon`, `GetIconInfo`, `DrawIconEx`, and `UpdateLayeredWindow`.

The initial implementation is designed around .NET Framework 4.x to avoid requiring a separate modern .NET runtime installation on common Windows systems.

## License

Cursor Mirror is licensed under the MIT License. See [LICENSE](LICENSE).
