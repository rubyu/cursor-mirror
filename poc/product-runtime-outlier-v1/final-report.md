# Product Runtime Outlier v1: Final Report

## What Was Tested

This POC validated the feedback in `feedback-from-pro.txt` by combining:

1. existing trace reclassification;
2. new product runtime telemetry;
3. a short automated Calibrator run through the real product runtime path.

## Existing Trace Reclassification

Step 01 first processed the two latest high-value motion recordings, then reran the same classification over the full root trace corpus with the C# streaming analyzer.

Full-corpus results:

- root trace/motion zips: 47
- runtime scheduler poll rows: 1,150,239
- classified outlier rows: 398,260
- `scheduler_wake_late`: 295,972
- `dispatcher_late`: 24,336
- `cursor_read_late`: 177
- `mixed`: 13,668
- `unknown`: 64,107

The latest two-trace focused pass still matters because it corresponds to the current runtime design:

- runtime scheduler poll rows: 53,760
- classified outlier rows: 646
- `scheduler_wake_late`: 196
- `dispatcher_late`: 401

The largest current-design outliers matched the feedback:

- max poll cadence gap `38.117ms`: `scheduler_wake_late`
- next max gap `18.242ms`: `scheduler_wake_late`
- rows with `queueToDispatchUs` around `6-7ms`: `dispatcher_late`

This confirms that old trace outliers are not one single phenomenon.

## Product Runtime Instrumentation

The POC added a disabled-by-default product runtime recorder:

- fixed in-memory ring buffer;
- no runtime disk writes;
- explicit snapshot/package writer;
- Calibrator CLI option:
  - `--product-runtime-outlier-output <zip>`

It records:

- scheduler wake lateness and message activity;
- controller tick phases;
- overlay operation phases;
- `UpdateLayer` internals including `Bitmap.GetHbitmap` and `UpdateLayeredWindow`.

## Product Runtime Baseline

Short Debug capture:

- scheduler events: 178
- controller events: 178
- overlay events: 778
- dropped events: 0
- `UpdateLayeredWindow` failures: 0

Key timings:

| Metric | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: |
| scheduler wake late | 1.0 | 2408.0 | 18519.0 | 23201.0 |
| controller tick total | 955.4 | 3679.3 | 5272.0 | 14038.7 |
| prediction | 5.8 | 14.0 | 466.0 | 844.7 |
| overlay move | 871.7 | 3249.9 | 5223.2 | 13974.8 |
| `UpdateLayer` | 802.8 | 3088.2 | 4692.6 | 13958.1 |
| `Bitmap.GetHbitmap` | 218.2 | 846.0 | 2046.4 | 11433.8 |
| `UpdateLayeredWindow` | 330.6 | 1041.7 | 1653.3 | 2703.6 |

## Conclusion

The feedback is validated.

Existing trace outliers include both scheduler wake-late and trace dispatcher-late rows. The largest rows are scheduler wake-late, while many smaller outliers are dispatcher-late.

Direct product telemetry also shows a separate product-only bottleneck: the controller tick is mostly overlay movement, and overlay movement is mostly `UpdateLayer`. In this run, `Bitmap.GetHbitmap` has the worst long tail inside `UpdateLayer`.

Prediction is not the current hot path. SIMD or ML inference work is not the next best optimization target for this issue.

## Recommended Next POC

Run `product-runtime-outlier-v2` focused on overlay update variants:

1. baseline: current per-move `UpdateLayer`;
2. cache HBITMAP / memory DC while cursor bitmap is unchanged;
3. move-only path using `SetWindowPos` or a layered-window move variant when content and alpha are unchanged;
4. compare Debug and Release captures;
5. run under load using the existing load generator.

Primary success metric:

- reduce `overlay move` and `UpdateLayer` p95/p99/max without increasing scheduler wake-late or Calibrator error.
