# Product Runtime Outlier v2: Final Report

## Summary

The selected optimization is the HBITMAP/DC cache in `OverlayWindow`.

The initial hypothesis was that per-frame `Bitmap.GetHbitmap` and GDI object churn were major contributors to overlay movement latency. Release telemetry supports that: caching the current cursor image's `MemoryDC` and `HBITMAP` reduces `moveOverlay` p95 from `3681.4us` to `1212.0us`, p99 from `7998.1us` to `1685.1us`, and max from `155602.2us` to `3039.2us` in the final selected run.

Move-only variants were tested but rejected. They reduce `UpdateLayeredWindow` calls, but `SetWindowPos` is slower than the cached `UpdateLayeredWindow` path in this scenario.

## Comparison

| Variant | move p50 us | move p95 us | move p99 us | move max us | update failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 809.9 | 3681.4 | 7998.1 | 155602.2 | 0 |
| HBITMAP cache initial | 458.9 | 1383.9 | 1948.0 | 3914.3 | 0 |
| move-only topmost | 1488.0 | 3271.6 | 4106.9 | 14319.4 | 0 |
| move-only no-zorder | 1344.3 | 2902.3 | 3701.1 | 5618.3 | 0 |
| final selected HBITMAP cache | 587.1 | 1212.0 | 1685.1 | 3039.2 | 0 |

## Selected Product Change

`OverlayWindow` now:

- invalidates the cached GDI resources when the cursor bitmap changes;
- keeps the selected HBITMAP in a reusable memory DC while the bitmap is current;
- disposes selected resources in the correct order on bitmap replacement and form disposal;
- keeps per-update screen DC acquisition and `UpdateLayeredWindow`, because that path is faster than move-only `SetWindowPos` in the measurements.

## Verification

- Release build passed.
- Release test suite passed: `Total: 144, Failed: 0`.
- Calibrator product-runtime capture passed for all variants.
- GDI replacement/disposal stress passed: final GDI object delta was `0`.
- No telemetry drops.
- No `UpdateLayeredWindow` failures.

## Next Ideas

Further improvements should focus on the remaining `UpdateLayeredWindow` cost rather than ML inference. Candidate follow-ups:

- reduce opacity updates when alpha is unchanged across a frame;
- inspect whether cursor image refresh frequency can be lowered without stale cursor shapes;
- run a longer loaded capture to see whether the HBITMAP cache still holds under CPU pressure.
