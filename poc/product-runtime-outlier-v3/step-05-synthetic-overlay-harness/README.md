# Step 05 Synthetic Overlay Harness

POC-only runtime harness for measuring the real product `OverlayWindow` and `UpdateLayeredWindow` path without `GetCursorPos` or WGC.

The harness references `artifacts/bin/Release/CursorMirror.Core.dll`, runs on STA, creates an `OverlayWindow`, injects a synthetic `ICursorImageProvider` and synthetic `ICursorPoller` into `CursorMirrorController`, enables `ProductRuntimeOutlierRecorder`, and runs two sequential 60 Hz scenarios:

- `moving-every-frame`
- `hold-heavy-repeated-positions`

Run:

```powershell
.\run.ps1
```

Outputs are written under `out/` by default:

- `product-runtime-outlier-moving-every-frame.zip`
- `product-runtime-outlier-hold-heavy-repeated-positions.zip`
- `metrics.json`
- `report.md`
