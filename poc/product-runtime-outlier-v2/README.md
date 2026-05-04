# Product Runtime Outlier v2

This POC tests overlay update optimizations after v1 identified `OverlayWindow.Move` and `UpdateLayer` as the product runtime hot path.

## Goal

Reduce product runtime overlay movement latency without increasing scheduler wake-late outliers, telemetry drops, or layered-window update failures.

## Steps

| Step | Purpose | Result |
| --- | --- | --- |
| `step-01-release-baseline` | Release baseline before overlay changes. | High `GetHbitmap` and `UpdateLayeredWindow` tails. |
| `step-02-hbitmap-cache` | Cache `MemoryDC` and `HBITMAP` while cursor image is unchanged. | Selected. Strongly reduces p95/p99/max. |
| `step-03-move-only-setwindowpos` | Move the layered window with `SetWindowPos(HWND_TOPMOST)` instead of per-move `UpdateLayeredWindow`. | Rejected. Move cost regressed. |
| `step-04-move-only-nozorder` | Move with `SetWindowPos(SWP_NOZORDER)` after initial topmost setup. | Rejected. Better than topmost move, still worse than HBITMAP cache. |
| `step-05-gdi-resource-stress` | Stress cached GDI resource replacement and disposal. | Passed. Final GDI object delta was `0`. |
| `step-06-final-selected-validation` | Re-measure final selected code after GDI handle validation. | Passed. `moveOverlay` p95 was `1212.0us`. |

## Selected Variant

Keep the HBITMAP/DC cache and do not use the move-only `SetWindowPos` path.
