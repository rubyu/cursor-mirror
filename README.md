# Cursor Mirror

<p align="center">
  <img src="https://raw.githubusercontent.com/rubyu/cursor-mirror/main/assets/icons/icon.jpg" alt="Cursor Mirror icon" width="160">
</p>

Cursor Mirror is a small Windows tray application that mirrors the current Windows cursor as a transparent topmost overlay.

It is intended as a workaround for remote-control environments, such as Parsec, where the real Windows cursor may not be visible to the remote viewer.

## Features

- Mirrors the current Windows cursor image.
- Tracks cursor movement with a low-level `WH_MOUSE_LL` mouse hook.
- Draws a click-through, no-activate, always-on-top overlay.
- Aligns the overlay using the cursor hot spot.
- Makes the mirrored cursor translucent while movement is active.
- Provides a small settings window from the notification-area icon.
- Includes a demo app for recording or validating cursor visibility by moving the real cursor.
- Runs from the notification area.
- Exits from the tray icon context menu.
- Builds with the C# compiler included with .NET Framework installations.

## Usage

Run:

```powershell
CursorMirror.exe
```

Cursor Mirror starts without showing a normal window. To quit, right-click the notification-area icon and choose `Exit`.

Left-click the notification-area icon, or choose `Settings` from the context menu, to adjust movement translucency. The settings window also includes an `Exit Cursor Mirror` command.

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

The trace tool is a separate Windows app for collecting mouse movement samples. It starts and stops recording from buttons in its window and saves traces as compressed `.zip` packages containing `trace.csv` and `metadata.json`. Trace packages include hook movement samples, product-equivalent cursor polling, high-precision reference cursor polling, DWM timing when available, environment metadata, monitor metadata, and capture-quality statistics.

The package also includes a demo app:

```text
CursorMirror.Demo.exe
```

The demo app is a separate Windows app for recording demonstrations and comparing cursor visibility across tools. It can run fullscreen or at `640 x 480`, `1280 x 720`, and `1920 x 1080` presets, with `640 x 480` as the default, moves the real Windows cursor from the left edge along a deterministic path, and can show or hide its own Cursor Mirror overlay. Demo language, display mode, speed, overlay, and movement settings are saved per user and restored on the next launch. If demo settings cannot be restored, the demo shows a warning, uses defaults, and attempts to reset the demo settings file. When the built-in overlay is enabled, it uses the same prediction and movement-translucency settings as the main app. If the main tray app is already running while the demo overlay is enabled, the demo warns before starting and can request the tray app to exit. If the user moves the mouse during the demo, it switches to Free mode and stops injecting cursor movement; Auto mode resumes from the left edge after 3 seconds without user input.

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
