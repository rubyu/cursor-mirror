# Step 03: Product Runtime Baseline

## Summary

This step enabled the product runtime outlier recorder through Calibrator and captured the real product hot path:

`OverlayRuntimeThread` -> `CursorMirrorController.Tick` -> `OverlayWindow.Move` -> `OverlayWindow.UpdateLayer`

Command:

```powershell
.\artifacts\bin\Debug\CursorMirror.Calibrator.exe --auto-run --exit-after-run --product-runtime --duration-seconds 3 --output .\poc\product-runtime-outlier-v1\step-03-product-runtime-baseline\calibration-debug.zip --product-runtime-outlier-output .\poc\product-runtime-outlier-v1\step-03-product-runtime-baseline\product-runtime-outlier-debug.zip
```

Generated:

- `calibration-debug.zip`
- `product-runtime-outlier-debug.zip`
- `metrics.json`

## Capture Size

- product telemetry events: 1,134
- scheduler events: 178
- controller events: 178
- overlay events: 778
- dropped events: 0
- `UpdateLayeredWindow` failures: 0

## Product Runtime Timing

| Metric | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: |
| scheduler wake late | 1.0 | 2408.0 | 18519.0 | 23201.0 |
| scheduler tick duration | 956.7 | 3683.6 | 5278.4 | 14052.2 |
| controller tick total | 955.4 | 3679.3 | 5272.0 | 14038.7 |
| prediction | 5.8 | 14.0 | 466.0 | 844.7 |
| overlay move | 871.7 | 3249.9 | 5223.2 | 13974.8 |
| apply opacity | 3.0 | 694.2 | 1263.7 | 1757.6 |
| `UpdateLayer` | 802.8 | 3088.2 | 4692.6 | 13958.1 |
| `Bitmap.GetHbitmap` | 218.2 | 846.0 | 2046.4 | 11433.8 |
| `UpdateLayeredWindow` | 330.6 | 1041.7 | 1653.3 | 2703.6 |

## Interpretation

The product-path measurement changes the priority order.

Prediction is not the hot path here. Its p50 is `5.8us`, p95 is `14us`, and max is below `1ms` in this short run.

The dominant product tick cost is overlay movement. `controller tick total` and `overlay move` nearly match, and `overlay move` is dominated by `UpdateLayer`.

Within `UpdateLayer`, `Bitmap.GetHbitmap` is the largest long-tail contributor in this run. `UpdateLayeredWindow` is still material but its max is much lower than the total `UpdateLayer` max.

The scheduler also still has real wake-late outliers on the product path: p95 `2.4ms`, p99 `18.5ms`, max `23.2ms`. Because processed messages before tick are p95/p99 `1`, this short capture does not show message-pump backlog as the main cause. Longer captures under load should still verify that.

## Consequence

The feedback's warning is validated in two ways:

1. Existing trace outliers can be scheduler-late or trace-dispatcher-late, and must be separated.
2. Product hot-path cost was not visible in those traces. Direct product telemetry shows `OverlayWindow.Move` / `UpdateLayer` is a major contributor to product tick time.

The next implementation experiment should focus on move-only overlay optimization and HBITMAP/DC caching before further ML/SIMD work.
