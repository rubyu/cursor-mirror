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

Cursor Mirror starts in the notification area without showing a normal window.

Right-click the notification-area icon to view the installed version, check for updates, open settings, or quit.

Left-click the notification-area icon, or choose `Settings` from the context menu, to tune cursor prediction, opacity while moving, and idle fade. The settings window also includes an `Exit Cursor Mirror` command.

Settings are saved per user and restored on the next launch. If settings cannot be loaded, Cursor Mirror shows a warning and starts with defaults.

## Included Tools

The release package also includes a demo app for recording comparison videos. It can move the real Windows cursor in a controlled scene and optionally show Cursor Mirror for side-by-side visibility checks.

The package also includes diagnostic tools for collecting cursor movement traces and measuring cursor alignment in a controlled full-screen scene.

## Development

For build, test, packaging, release, and diagnostic-tool details, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Runtime Notes

Cursor Mirror targets Windows desktop environments and is packaged to run without requiring a separate modern .NET runtime in typical Windows environments.

## License

Cursor Mirror is licensed under the MIT License. See [LICENSE](LICENSE).
