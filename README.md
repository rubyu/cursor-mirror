# Cursor Mirror

Cursor Mirror is a small Windows tray application that mirrors the current Windows cursor as a transparent topmost overlay.

It is intended as a workaround for remote-control environments, such as Parsec, where the real Windows cursor may not be visible to the remote viewer.

## Features

- Mirrors the current Windows cursor image.
- Tracks cursor movement with a low-level `WH_MOUSE_LL` mouse hook.
- Draws a click-through, no-activate, always-on-top overlay.
- Aligns the overlay using the cursor hot spot.
- Runs from the notification area.
- Exits from the tray icon context menu.
- Builds with the C# compiler included with .NET Framework installations.

## Usage

Run:

```powershell
CursorMirror.exe
```

Cursor Mirror starts without showing a normal window. To quit, right-click the notification-area icon and choose `Exit`.

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
README.md
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

Package without running tests:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package.ps1 -SkipTests
```

## Specification

The developer specification is in [spec/README.md](spec/README.md).

## Runtime Notes

Cursor Mirror targets Windows desktop environments. Internally, it uses Win32 APIs such as `SetWindowsHookEx`, `GetCursorInfo`, `CopyIcon`, `GetIconInfo`, `DrawIconEx`, and `UpdateLayeredWindow`.

The initial implementation is designed around .NET Framework 4.x to avoid requiring a separate modern .NET runtime installation on common Windows systems.
