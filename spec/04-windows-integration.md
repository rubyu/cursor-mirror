## 4. Windows Integration

### 4.1 Process DPI Awareness
- The process SHOULD declare or set per-monitor DPI awareness before creating forms or windows.
- Coordinate calculations MUST use a single coordinate space. The preferred coordinate space is physical screen coordinates.
- The overlay position MUST align the cursor hot spot with the pointer position.
- Tests and manual validation MUST cover at least one non-100% scale setting when available.

### 4.2 Low-Level Mouse Hook
- Cursor Mirror MUST install a `WH_MOUSE_LL` hook using `SetWindowsHookEx`.
- The hook implementation SHOULD be structurally similar to CreviceApp's `WindowsHook` and `LowLevelMouseHook` wrappers:
  - hold the managed callback delegate strongly for the hook lifetime;
  - expose activation state;
  - reject double activation;
  - reject double unhook;
  - call `UnhookWindowsHookEx` on disposal;
  - call `CallNextHookEx` for pass-through events.
- The hook callback MUST handle `WM_MOUSEMOVE`.
- The hook callback MAY ignore button, wheel, and non-client events for overlay update purposes.
- The hook callback MUST NOT cancel low-level mouse events.
- The hook callback MUST call `CallNextHookEx` for every event unless Windows requires a different return path for invalid hook codes.
- The hook callback MUST tolerate negative coordinates from the virtual screen.

### 4.3 Cursor Capture
- Cursor Mirror MUST read the current cursor using Windows cursor APIs rather than drawing a fixed cursor asset.
- The implementation SHOULD use `GetCursorInfo` to obtain the active cursor handle.
- The implementation MUST copy the cursor handle before drawing or converting it.
- The implementation SHOULD use `CopyIcon`, `GetIconInfo`, and `DrawIconEx` or equivalent Windows APIs.
- The implementation MUST dispose copied icon handles and bitmap resources.
- The implementation MUST extract and apply hot spot metadata.
- The implementation SHOULD support color cursors and monochrome cursors.
- The implementation SHOULD support animated cursor frames to the extent that `GetCursorInfo` exposes the current cursor handle.

### 4.4 Overlay Window
- The overlay window MUST be top-level and borderless.
- The overlay window MUST be always on top.
- The overlay window MUST be click-through.
- The overlay window MUST be no-activate.
- The overlay window MUST NOT appear in the taskbar.
- The overlay window SHOULD NOT appear in Alt+Tab.
- The overlay window MUST draw only the copied cursor image over a transparent background.
- The overlay window MUST move so that `overlay.Left + hotSpot.X == pointer.X` and `overlay.Top + hotSpot.Y == pointer.Y`.
- The overlay window MUST handle cursor images larger than the default arrow cursor.
- The overlay window SHOULD avoid visible flicker during rapid movement.

Recommended extended window styles:

- `WS_EX_LAYERED`
- `WS_EX_TRANSPARENT`
- `WS_EX_NOACTIVATE`
- `WS_EX_TOOLWINDOW`

### 4.5 Tray Resident Application
- The application MUST create one notification-area icon.
- The tray icon MUST remain available until shutdown begins.
- The tray context menu MUST provide `Exit`.
- Selecting `Exit` MUST unhook and dispose resources before process termination.
- Closing hidden forms or disposing the tray controller MUST remove the notification-area icon.

### 4.6 Multi-Monitor Coordinates
- Cursor Mirror MUST work when the primary monitor is not the leftmost or topmost monitor.
- Cursor Mirror MUST accept negative `X` and `Y` screen coordinates.
- Cursor Mirror MUST keep the overlay visible at monitor boundaries when the cursor is partially outside the virtual screen.
- Cursor Mirror SHOULD not clamp the overlay to a single monitor.
