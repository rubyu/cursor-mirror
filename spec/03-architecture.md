## 3. Runtime Architecture

### 3.1 Components
The implementation SHOULD use the following components:

- `Program`: Application entry point and process-wide initialization.
- `TrayController`: Notification-area icon, context menu, and shutdown command.
- `LowLevelMouseHook`: Thin wrapper around `SetWindowsHookEx(WH_MOUSE_LL)`, modeled after the CreviceApp hook structure.
- `CursorImageProvider`: Reads the current cursor handle and produces a copied image plus hot spot metadata.
- `OverlayWindow`: Displays the cursor image using a transparent, layered, click-through window.
- `CursorMirrorController`: Coordinates hook events, cursor capture, overlay image updates, and overlay movement.
- `CursorPositionPredictor`: Computes a display-only predicted pointer position from recent movement samples.
- `MovementOpacityController`: Computes movement-translucency state and linear opacity transitions from injected time and movement events.
- `CursorMirrorSettings`: Validated runtime settings and defaults.
- `SettingsStore`: Loads and saves user settings without requiring administrator privileges.
- `SettingsWindow`: Small WinForms settings surface opened from the tray icon and context menu.
- `SettingsController`: Applies settings changes to runtime services and routes close, reset, and exit commands.

### 3.2 Event Flow
The normal event flow is:

1. `Program` configures DPI awareness before creating any windows.
2. `Program` starts the WinForms message loop.
3. `TrayController` creates the tray icon and context menu.
4. `OverlayWindow` is created hidden or transparent.
5. `LowLevelMouseHook` installs a `WH_MOUSE_LL` hook.
6. Windows invokes the hook callback for mouse events.
7. On `WM_MOUSEMOVE`, `CursorMirrorController` reads the pointer position, records it in `CursorPositionPredictor`, updates movement opacity state, and updates the overlay at the configured exact or predicted display position.
8. The hook callback returns a pass-through hook result.
9. On tray `Settings` or primary tray icon activation, the settings window is shown or brought to the foreground.
10. On settings changes, the settings controller validates, persists, and applies the new values without restarting the application.
11. On tray `Exit` or settings-window exit, the controller unhooks, hides the overlay, disposes resources, removes the tray icon, and exits the message loop.

### 3.3 Threading and Message Pump
- The application MUST run a Windows message pump for the tray icon, overlay window, and hook lifetime.
- UI objects MUST be created and mutated on the UI thread.
- The low-level mouse hook callback MUST do minimal work.
- The hook callback MUST NOT perform blocking I/O.
- The hook callback MUST NOT show UI directly.
- If the hook callback is invoked off the UI thread, it MUST marshal overlay updates to the UI thread.
- Settings persistence MUST NOT run inside the low-level hook callback.
- Opacity transition calculations SHOULD be deterministic and testable with an injected clock or equivalent time source.
- Cursor prediction calculations SHOULD be deterministic and testable with injected timestamps and synthetic movement samples.
- Cursor prediction MUST NOT call Windows hook, cursor capture, settings persistence, or UI APIs directly.
- Implementations SHOULD coalesce redundant move events when the pointer coordinate and cursor handle have not changed.

### 3.4 Failure Policy
- Failure to install the low-level mouse hook is fatal for normal operation.
- Failure to capture a cursor image for a specific event MUST NOT terminate the application.
- If cursor capture fails for a specific event, the overlay SHOULD keep the previous valid image and update position when possible.
- Failure or reset of cursor prediction MUST fall back to exact pointer positioning.
- Failure to remove the tray icon during shutdown SHOULD be ignored after best-effort cleanup.
- Unexpected exceptions in the hook callback MUST be caught, logged when logging exists, and followed by pass-through behavior.
