# Product Runtime Sampler Validation

## Purpose

This POC validates the CPU and visible cursor-separation impact of replacing the high-frequency cursor sampler's tight `Thread.Sleep(0)` loop with a blocking wait.

The previous Calibrator path was not sufficient for this validation because it used a direct `CursorPoller` and timer-driven `Tick()` loop. The Calibrator now defaults to `ProductRuntime`, which exercises the same product overlay runtime path as the main app:

- `OverlayRuntimeThread`
- `HighFrequencyCursorPoller`
- DWM-synchronized runtime scheduler
- `CursorMirrorController`

The old Calibrator path remains available as `SimpleTimer` for diagnostics only.

## Variants

All score runs used `CursorMirror.Calibrator.exe --runtime-mode ProductRuntime --duration-seconds 60`.

| Variant | Description | Decision |
| --- | --- | --- |
| `old-sleep0` | Previous sampler wait loop. Uses `Thread.Sleep(0)` for sub-2ms waits and burns CPU. | Rejected. CPU is too high. |
| `fixed-blocking-2ms` | Blocking wait with the previous 2ms sampler interval. | Rejected. P95 is stable, but max separation can regress. |
| `fixed-blocking-1ms` | Blocking wait with a 1ms sampler interval. | Accepted. Keeps CPU low while removing large separation outliers. |

## Results

Lower score is better. `Average` can move slightly because the measurement is sensitive to frame alignment and capture jitter. For product UX, P95 and maximum outliers are more important than tiny average changes, because visible failures are dominated by tail latency.

| Variant | Runs | Mean Average | Mean P95 | Max of Maximum |
| --- | ---: | ---: | ---: | ---: |
| `old-sleep0` | 2 | 6.845 | 12.000 | 94.000 |
| `fixed-blocking-2ms` | 2 | 7.060 | 12.000 | 132.000 |
| `fixed-blocking-1ms` | 2 | 7.523 | 12.000 | 12.000 |

CPU check for `fixed-blocking-1ms`:

- 5 second process CPU delta: `0.062s`
- Approximate one-core usage: `1.25%`

For reference, the old `Sleep(0)` loop previously measured approximately one full busy core over the same kind of process sample.

## Decision

Adopt only the `fixed-blocking-1ms` logic:

- `HighFrequencyCursorPoller.DefaultIntervalMilliseconds = 1`
- Waits use `HighResolutionWaitTimer` when available.
- Fallback waits block for at least 1ms for positive remaining time.
- No runtime switch for sampler wait strategy is kept in product code.

The rejected variants are retained only in this POC record. They must not remain as product logic.

## Follow-Up Notes

The accepted variant intentionally prioritizes stable tail behavior and low CPU over the lowest measured average separation. If future calibration work improves the scoring model, it should continue to report average, P95, and maximum separately rather than compressing them into a single score.
