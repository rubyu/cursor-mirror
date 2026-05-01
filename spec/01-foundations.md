## 1. Foundations and Conventions

### 1.1 Scope and Normativity
- Audience: implementers, maintainers, and test authors.
- Normativity: Normative by default. Non-normative content is explicitly labeled `Informative`.
- Labeling policy: Chapter-level (`##`) headings add `(Informative)` only for non-normative sections. Normative sections are unlabeled by default. Subsections (`###`) MAY clarify normativity inline when needed.
- Sources of truth:
  - This specification is authoritative for runtime behavior, Windows API interaction, packaging constraints, and failure conditions.
  - Test identifiers are canonical in Appendix A.
  - Product documentation and README files MAY describe user-facing behavior, but they MUST NOT contradict this specification.

### 1.2 Vocabulary Style
- Component names such as `LowLevelMouseHook`, `CursorImageProvider`, `OverlayWindow`, and `TrayController` MUST be displayed in monospace format.
- Windows constants and messages such as `WH_MOUSE_LL`, `WM_MOUSEMOVE`, `WS_EX_TRANSPARENT`, and `WS_EX_NOACTIVATE` MUST be displayed in monospace format.
- Smart quotation marks MUST NOT be used for defined terms. Authors MUST use monospace format for defined identifiers.
- Unicode arrows MUST NOT be used. ASCII arrows (`A -> B`) SHOULD be used in their place.
- Prose MUST reference sections and appendices using the forms `See Section X.Y` and `See Appendix A.4`. Abbreviations such as `Sec.` or section-sign symbols MUST NOT be used.
- Authors SHOULD employ plain English and MUST avoid idiomatic expressions, metaphors, or colloquial language.
- Native API failures SHOULD identify the API name and the Win32 error code when available.
- When a parenthetical reference occurs at the end of a sentence, the period MUST appear after the closing parenthesis.
- The standard prefixes for notes are `Note:` and `Notes:`. The trailing colon MUST always be included.

### 1.3 Terminology and Definitions
This document uses `Cursor Mirror` as the product name. Code identifiers, project names, namespaces, and executable names use `CursorMirror`.

Core entities:
- Low-level mouse hook: A `WH_MOUSE_LL` hook installed with `SetWindowsHookEx`.
- Hook callback: The function invoked by Windows for low-level mouse events.
- Overlay window: A borderless, layered, transparent, click-through top-level window that displays the copied cursor image.
- Cursor image: The bitmap representation copied from the current system cursor handle.
- Cursor hot spot: The cursor-relative point that Windows treats as the actual pointer coordinate.
- Pointer position: The screen coordinate reported by the hook data or `GetCursorPos`.
- Display pointer position: The exact pointer position or the predicted pointer position selected for overlay display.
- Prediction horizon: The amount of time, in milliseconds, that predictive overlay positioning extrapolates beyond the latest movement sample.
- Tray controller: The component that owns the notification-area icon and context menu.

Coordinate terms:
- Screen coordinate: A physical desktop coordinate in the virtual screen coordinate space.
- Virtual screen: The bounding rectangle covering all monitors, including monitors with negative coordinates.
- DPI awareness: The process-level setting that determines how Windows virtualizes coordinates and window sizes.

Behavior terms:
- Click-through: The overlay MUST NOT receive or block mouse input intended for the underlying application.
- No-activate: The overlay MUST NOT take focus when shown or moved.
- Pass-through hook result: The hook callback calls `CallNextHookEx` and does not cancel the input event.
