## 3. Runtime Architecture

### 3.1 Components
The implementation SHOULD use the following components:

- `Program`: Application entry point and process-wide initialization.
- `TrayController`: Notification-area icon, context menu, and shutdown command.
- `OverlayRuntimeThread`: Dedicated STA message-pump thread that owns the overlay window, controller, cursor polling, and DWM-synchronized runtime scheduler.
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
4. `OverlayRuntimeThread` starts a dedicated STA thread and message pump.
5. `OverlayWindow`, `CursorMirrorController`, cursor polling, and the DWM-synchronized runtime scheduler are created on the overlay runtime thread.
6. `LowLevelMouseHook` installs a `WH_MOUSE_LL` hook.
7. Windows invokes the hook callback for mouse events.
8. On `WM_MOUSEMOVE`, the hook callback posts the event to the overlay runtime thread and returns a pass-through hook result.
9. On the overlay runtime thread, `CursorMirrorController` reads the pointer position, records it in `CursorPositionPredictor`, updates movement opacity state, and updates the overlay at the configured exact or predicted display position.
10. On tray `Settings` or primary tray icon activation, the settings window is shown or brought to the foreground on the tray UI thread.
11. On settings changes, the settings controller validates, persists, and posts the new settings to the overlay runtime thread without restarting the application.
12. On tray `Exit` or settings-window exit, the application unhooks first, stops the overlay runtime thread, disposes resources, removes the tray icon, and exits the message loops.

### 3.3 Threading and Message Pump
- The application MUST run a Windows message pump for the tray icon, overlay window, and hook lifetime.
- The tray and settings UI MAY run on the main UI thread.
- The overlay window, overlay controller, cursor polling, and DWM-synchronized runtime scheduler SHOULD run on a dedicated STA overlay runtime thread.
- Overlay UI objects MUST be created and mutated on the overlay runtime thread.
- Tray and settings UI objects MUST be created and mutated on their owning UI thread.
- The low-level mouse hook callback MUST do minimal work.
- The hook callback MUST NOT perform blocking I/O.
- The hook callback MUST NOT show UI directly.
- If the hook callback is invoked off the overlay runtime thread, it MUST marshal overlay updates to the overlay runtime thread.
- Settings changes MUST be persisted outside the overlay hot path and then marshaled to the overlay runtime thread.
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
