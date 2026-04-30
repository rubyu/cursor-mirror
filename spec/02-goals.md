## 2. Goals and Non-Goals

### 2.1 Goals
- Cursor Mirror MUST make the current Windows cursor visible to remote-control software that fails to capture or transmit the hardware/system cursor.
- Cursor Mirror MUST run as a tray-resident Windows desktop application.
- Cursor Mirror MUST display a copied cursor image at the same screen position as the real cursor.
- Cursor Mirror MUST track pointer movement using a low-level mouse hook based on the CreviceApp `WH_MOUSE_LL` pattern.
- Cursor Mirror MUST keep mouse input fully available to the underlying desktop and applications.
- Cursor Mirror MUST provide a small settings UI for user-adjustable visual behavior.
- Cursor Mirror SHOULD require no additional runtime installation on common supported Windows installations.
- Cursor Mirror SHOULD be small, quiet, and predictable.

### 2.2 Non-Goals
- Cursor Mirror is not a cursor theme manager.
- Cursor Mirror is not a screen recorder or remote-control application.
- Cursor Mirror does not hide, replace, or modify the real system cursor.
- Cursor Mirror does not intercept, remap, or cancel user input.
- Cursor Mirror does not implement gesture recognition.

### 2.3 User-Visible Product Shape
- The application MUST start without showing a normal window.
- The application MUST show a notification-area icon while running.
- The tray icon SHOULD open the settings window on primary-button activation.
- The tray context menu MUST include an `Exit` command.
- The tray context menu MUST include a `Settings` command.
- The settings window MUST include an exit command equivalent to the tray `Exit` command.
- The application MAY include an `About` command.
- The application MAY include a `Pause` command, but pause/resume is not required for the initial implementation.
- The application SHOULD avoid notification balloons during normal successful startup.
- Fatal startup failures SHOULD be reported with a simple message box before the process exits.
- User-visible strings SHOULD be resolved through a localization boundary rather than being scattered as inline literals.
- The default user-visible language MUST be English. Additional UI cultures MAY be supported.
