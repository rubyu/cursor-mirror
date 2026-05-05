# Step 05: GDI Resource Stress

## Purpose

The selected HBITMAP cache keeps a memory DC and HBITMAP across frames. This step verifies that repeated cursor image replacement, movement, opacity updates, hide/show, and disposal do not leak GDI objects in the current process.

## Method

`OverlayGdiStress.exe` runs `OverlayWindow` on an STA thread and performs:

- repeated `ShowCursor` calls with newly generated cursor bitmaps;
- multiple `Move` calls per bitmap;
- periodic opacity updates;
- periodic hide/show churn;
- final `Dispose` and forced GC.

The harness records `GetGuiResources(..., GR_GDIOBJECTS)` before, at peak, and after disposal.

## Command

```powershell
.\poc\product-runtime-outlier-v2\step-05-gdi-resource-stress\run_gdi_stress.ps1 -Configuration Release
```

## Result

| Metric | Value |
| --- | ---: |
| iterations | 250 |
| moves per image | 24 |
| GDI objects before stress | 20 |
| GDI objects peak | 28 |
| GDI objects after dispose | 20 |
| final delta | 0 |
| allowed final delta | 8 |
| elapsed ms | 1142 |

The stress test passed. The first WinForms/GDI initialization pass is treated as warmup, so the measured `before` count is taken after initialization resources settle.
