## 4. Windows Integration

### 4.1 Process DPI Awareness
- The process SHOULD declare or set per-monitor DPI awareness before creating forms or windows.
- Coordinate calculations MUST use a single coordinate space. The preferred coordinate space is physical screen coordinates.
- The overlay position MUST align the cursor hot spot with the exact pointer position or the configured predicted display position.
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
- If a valid cursor image is already available and `GetCursorInfo` reports the same cursor handle, the implementation SHOULD skip redundant image capture for a short refresh interval.
- The implementation SHOULD periodically allow same-handle image refresh so animated cursors or handle-reused cursor changes are not permanently frozen.

### 4.4 Overlay Window
- The overlay window MUST be top-level and borderless.
- The overlay window MUST be always on top.
- The overlay window MUST be click-through.
- The overlay window MUST be no-activate.
- The overlay window MUST NOT appear in the taskbar.
- The overlay window SHOULD NOT appear in Alt+Tab.
- The overlay window MUST draw only the copied cursor image over a transparent background.
- The overlay window MUST move so that `overlay.Left + hotSpot.X == displayPointer.X` and `overlay.Top + hotSpot.Y == displayPointer.Y`, where `displayPointer` is the exact pointer or the configured predicted pointer.
- The overlay window MUST handle cursor images larger than the default arrow cursor.
- The overlay window SHOULD avoid visible flicker during rapid movement.
- The overlay window MUST support a configurable global opacity multiplier while preserving the copied cursor image's per-pixel alpha.
- Opacity changes MUST NOT affect click-through behavior, topmost behavior, no-activate behavior, or hot spot alignment.

Recommended extended window styles:

- `WS_EX_LAYERED`
- `WS_EX_TRANSPARENT`
- `WS_EX_NOACTIVATE`
- `WS_EX_TOOLWINDOW`

#### 4.4.1 Movement Translucency Mode
- Movement translucency mode MUST be enabled by default.
- When enabled, the overlay MUST transition from normal opacity to moving opacity when pointer movement begins.
- While pointer movement continues, the overlay MUST remain at moving opacity after the enter transition completes.
- After no pointer movement has been observed for the configured idle delay, the overlay MUST transition back to normal opacity.
- The enter and exit transitions MUST use linear easing.
- Overlay position updates MUST remain immediate; easing applies only to opacity.
- Normal opacity MUST be `100%`.
- The default moving opacity SHOULD be `70%`.
- The default fade duration SHOULD be `80ms`.
- The default idle delay SHOULD be `120ms`.
- Moving opacity MUST be configurable within `1%` to `100%`.
- Fade duration MUST be configurable within `0ms` to `300ms`.
- Idle delay MUST be configurable within `50ms` to `500ms`.
- Values outside supported ranges MUST be rejected or clamped consistently at the settings boundary.
- If fade duration is `0ms`, opacity changes MUST be immediate.
- If movement translucency mode is disabled, the overlay MUST remain at normal opacity.
- The implementation SHOULD apply the opacity multiplier through layered-window alpha, such as `BLENDFUNCTION.SourceConstantAlpha`, or an equivalent mechanism.

#### 4.4.1.1 Idle Fade Mode
- Idle fade mode MUST be enabled by default.
- Idle fade mode MUST be independent from movement translucency mode.
- After no pointer movement has been observed for the configured idle fade delay, the overlay MUST transition from its current opacity to the configured idle opacity.
- The idle fade transition MUST use the same linear easing behavior as movement translucency transitions.
- The default idle fade delay SHOULD be `3s`.
- The default idle opacity SHOULD be `0%`.
- Idle opacity MUST be configurable within `0%` to `99%`.
- Idle fade delay MUST be configurable within `0s` to `60s`.
- Any new pointer movement after idle fade starts MUST transition the overlay back toward the appropriate active opacity for the current movement-translucency settings.
- Values outside supported ranges MUST be rejected or clamped consistently at the settings boundary.

#### 4.4.2 Predictive Overlay Positioning
- Predictive overlay positioning MUST be enabled by default.
- The settings UI MUST allow the user to disable predictive overlay positioning.
- Prediction MUST affect only the displayed overlay position.
- Prediction MUST NOT move the real system cursor, cancel input, remap input, or change click targets.
- The low-level hook path SHOULD trigger cursor image refresh.
- The low-level hook path SHOULD NOT advance prediction or movement state from hook coordinates when a polling sample path is available.
- The polling path SHOULD drive normal movement-state updates and overlay position updates using `GetCursorPos`.
- The product runtime SHOULD keep a high-frequency latest-position sampler and let the DWM-synchronized runtime tick consume the newest fresh sample rather than performing the only cursor read after the tick has already reached the overlay runtime thread.
- When prediction is disabled, the overlay MUST use exact current pointer coordinates from polling, with the low-level hook path acting only as a fallback before polling has established a usable image and position.
- The default product prediction model SHOULD use the latest valid pair of polling samples with constant velocity:
  - `velocity = (currentPosition - previousPosition) / dt`;
  - `predictedPosition = currentPosition + velocity * horizonMs * gain`.
- The DWM-aware prediction gain SHOULD be `0.75`.
- The fixed-horizon fallback prediction gain MAY remain `1.0` for compatibility.
- The predictor MUST use a single monotonic timebase for each predictor instance.
- The predictor MUST treat non-positive `dt` as invalid and fall back to exact pointer positioning until a new valid movement pair is available.
- The predictor MUST reset velocity across idle gaps.
- The default prediction idle reset gap SHOULD be `100ms`.
- The prediction hot path SHOULD be `O(1)` and allocation-free after construction.
- The normal prediction path MUST NOT apply a low fixed offset cap.
- A failsafe offset cap MAY be implemented for corrupted input or timestamp bugs, but it MUST be disabled by default or set high enough that normal fast movement is not clipped.
- The default fixed prediction horizon SHOULD be `8ms`.
- If DWM timing is available, Cursor Mirror SHOULD choose a next-vblank prediction horizon from DWM composition timing.
- If DWM timing is available, Cursor Mirror SHOULD schedule its normal runtime polling and overlay movement tick near the upcoming DWM vblank instead of relying only on a general-purpose UI timer.
- The DWM-synchronized runtime scheduler SHOULD wake slightly before the target vblank, then dispatch `GetCursorPos` polling and overlay movement onto the dedicated overlay runtime thread.
- The scheduler SHOULD cap DWM-timed sleeps to a short cadence, default `2ms`, so it re-checks compositor timing frequently instead of sleeping through multiple frames.
- The scheduler SHOULD use a high-resolution waitable timer for short DWM-timed waits when the operating system supports it, falling back to a normal waitable timer or `Thread.Sleep` when unavailable.
- The normal overlay hot path SHOULD avoid dispatching through the tray or settings UI thread.
- The overlay runtime thread SHOULD own the overlay window, cursor polling, prediction, opacity updates, and layered-window movement.
- The scheduler SHOULD request a `1ms` timer resolution while active and release that request during shutdown.
- The high-frequency latest-position sampler SHOULD also request a `1ms` timer resolution while active and release that request during shutdown.
- Runtime scheduler and latest-position sampler threads SHOULD use a priority appropriate for latency-sensitive cursor display work without requiring administrator privileges.
- The scheduler MUST avoid overlapping queued runtime ticks.
- After the scheduler requests a tick for a target vblank, it MUST keep that target pending until the target vblank time has passed rather than advancing to a later vblank early.
- The controller MUST ignore stale or out-of-order poll samples and SHOULD expose a diagnostic counter for ignored stale samples.
- If DWM timing is unavailable or invalid, the scheduler MUST fall back to a documented high-resolution interval loop.
- Invalid, late, stale, or excessive DWM horizons MUST fall back to exact pointer positioning or a documented fixed-horizon fallback.
- The implementation SHOULD expose diagnostic counters for invalid DWM horizon, late DWM horizon, excessive horizon, fallback-to-hold, and prediction reset due to invalid `dt` or idle gaps.
- The overlay MUST apply hot spot placement after choosing the exact or predicted pointer position.
- Prediction reset MUST occur when the overlay is hidden, the controller is disposed, prediction is disabled, or prediction-related settings change.
- Cursor capture failure MUST preserve current fallback behavior: if the previous image is still available, the overlay SHOULD move using the current exact or predicted display position.

### 4.5 Tray Resident Application
- The application MUST create one notification-area icon.
- The tray icon MUST remain available until shutdown begins.
- Primary-button activation of the tray icon SHOULD show the settings window.
- The tray context menu MUST provide `Settings`.
- The tray context menu MUST show the embedded application version.
- The tray context menu SHOULD show release freshness when GitHub Releases can be reached:
  - up to date when the current stable package version matches the latest stable release tag;
  - the number of newer stable releases when the current stable package version is behind;
  - development build status when the current package version is a development snapshot;
  - unknown status when the update check fails or no stable release data is available.
- The update check MUST NOT block the tray menu from opening.
- The update check MUST ignore release tags that do not match `vMAJOR.MINOR.PATCH`.
- The tray context menu MUST provide `Exit`.
- Selecting `Settings` MUST show the settings window or bring the existing settings window to the foreground.
- Selecting `Exit` MUST unhook and dispose resources before process termination.
- Closing hidden forms or disposing the tray controller MUST remove the notification-area icon.

#### 4.5.1 Settings Window
- The settings window MUST be a small utility UI, not a primary application workspace.
- The settings window MUST use the Cursor Mirror application icon rather than the default Windows Forms icon.
- The settings window MUST provide a control for enabling or disabling movement translucency mode.
- The settings window MUST provide a control for enabling or disabling predictive overlay positioning.
- The settings window MUST provide controls for moving opacity, fade duration, and idle delay.
- When movement translucency mode is disabled in the settings window, moving opacity, fade duration, and idle delay controls MUST be disabled visually and functionally.
- The settings window MUST provide controls for idle fade enablement, idle opacity, and idle fade delay.
- When idle fade mode is disabled in the settings window, idle opacity and idle fade delay controls MUST be disabled visually and functionally.
- Settings controls MUST expose values in user-understandable units: percent for opacity, milliseconds for short movement timing, and seconds for long idle-fade timing.
- The settings window MUST provide `Reset`, `Close`, and `Exit Cursor Mirror` commands.
- The `Reset` command MUST restore documented default settings.
- The `Close` command MUST close or hide the settings window without shutting down Cursor Mirror.
- The `Exit Cursor Mirror` command MUST use the same shutdown path as tray `Exit`.
- The `Exit Cursor Mirror` command SHOULD NOT require a confirmation dialog.
- Settings changes SHOULD apply immediately.
- Opening settings repeatedly MUST NOT create multiple independent settings windows.
- The settings window MUST remain operable while the overlay is visible.
- The overlay MUST NOT intercept input intended for the settings window.

### 4.6 Multi-Monitor Coordinates
- Cursor Mirror MUST work when the primary monitor is not the leftmost or topmost monitor.
- Cursor Mirror MUST accept negative `X` and `Y` screen coordinates.
- Cursor Mirror MUST keep the overlay visible at monitor boundaries when the cursor is partially outside the virtual screen.
- Cursor Mirror SHOULD not clamp the overlay to a single monitor.
