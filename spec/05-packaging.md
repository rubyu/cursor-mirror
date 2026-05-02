## 5. Packaging and Runtime Dependencies

### 5.1 Target Runtime
- The initial implementation SHOULD target `.NET Framework 4.8` to reduce the chance that users need to install an additional runtime on common Windows 10 and Windows 11 systems.
- The implementation MAY later add a modern .NET self-contained build.
- If multiple build flavors exist, the documentation MUST clearly identify which artifact requires no separate .NET installation and which artifact depends on an installed runtime.

### 5.2 Build Outputs
- The default release artifact SHOULD be a single executable when practical.
- The release artifact SHOULD NOT require installation.
- The release artifact SHOULD NOT require administrator privileges.
- The application MUST NOT require a background service.
- The release package MAY include a README and license file.
- The release package MUST include `CursorMirror.exe`.
- The release package MUST include `CursorMirror.Core.dll` when any packaged auxiliary executable depends on it.
- The release package MUST include `CursorMirror.TraceTool.exe`.
- The release package MUST include `CursorMirror.Demo.exe`.
- The release package MUST include `CursorMirror.Calibrator.exe`.

### 5.3 Startup and Shutdown
- Startup MUST create the tray icon before installing the hook or immediately after successful hook installation.
- Startup failure after tray icon creation MUST remove the tray icon before exit.
- Shutdown MUST unhook before disposing the overlay window.
- Shutdown MUST be safe when invoked from the tray menu.
- Shutdown SHOULD be idempotent.

### 5.4 Version Information
- Release builds SHOULD include product name, file version, and product version metadata.
- The tray `About` command, if present, SHOULD display the product version.
- Version metadata MUST NOT affect runtime behavior.
- Build and release version semantics MUST follow Section 10.

### 5.5 User Settings Persistence
- User settings SHOULD be stored under the current user's application data directory.
- User settings MUST NOT require administrator privileges to read or write.
- Settings persistence SHOULD use a structured format such as JSON.
- Missing settings MUST fall back to documented defaults.
- Corrupt or unreadable settings MUST fall back to documented defaults without preventing startup.
- When settings restoration fails, the application MUST warn the user with a dialog and SHOULD reset the settings file to the defaults that are being used.
- Missing settings files MUST be treated as first-run defaults and MUST NOT show a restoration-failure warning.

### 5.6 Durable Settings Writes
- Settings writes MUST NOT overwrite the active settings file directly.
- Settings writes MUST first serialize the new settings to a temporary file in the same directory as the active settings file.
- Before replacing the active settings file, the implementation MUST read the temporary file back through the same deserialization and normalization path used for normal startup.
- If temporary-file validation fails, the active settings file MUST remain unchanged.
- When replacing an existing settings file, the previous file MUST be retained as a timestamped backup before or during replacement.
- Replacement SHOULD use an atomic same-volume operation such as `File.Replace` when available.
- If atomic replacement is not available, replacement MUST use same-directory rename or move operations and SHOULD attempt to restore the previous file if the final replacement step fails.
- The implementation MUST retain only the newest `5` backups per settings file and remove older backups after a successful save.
- Temporary files left by interrupted saves MAY be removed on a later successful save.
