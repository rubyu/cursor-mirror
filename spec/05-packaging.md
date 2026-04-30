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
