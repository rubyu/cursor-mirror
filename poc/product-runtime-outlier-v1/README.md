# Product Runtime Outlier v1

This POC validates the scheduler-period-outlier feedback from `feedback-from-pro.txt`.

The goal is not to tune the prediction model. The goal is to separate these latency sources:

- runtime scheduler wake lateness;
- trace capture dispatcher lateness;
- product `OverlayRuntimeThread` message-pump interference;
- `CursorMirrorController.Tick()` phase cost;
- `OverlayWindow.Move()` / `UpdateLayer()` GDI and layered-window cost.

Raw trace ZIP files are read in place from the repository root. They are not copied into this POC.

## Steps

| Step | Purpose | Output |
| --- | --- | --- |
| `step-01-existing-trace-reclassification` | Reclassify existing trace outliers using the feedback formulas. | `metrics.json`, `report.md`, `experiment-log.md` |
| `step-02-product-runtime-telemetry-design` | Define low-overhead product instrumentation points. | `report.md` |
| `step-03-product-runtime-baseline` | Measure the product runtime path directly after instrumentation. | planned |
| `step-04-hot-path-phase-breakdown` | Split tick, prediction, move, opacity, and layer update costs. | planned |
| `step-05-scheduler-variant-tests` | Compare wait/fine-wait scheduler variants. | planned |
| `step-06-overlay-update-variant-tests` | Compare move-only and cached-layer update variants. | planned |
| `step-07-final-recommendation` | Decide which mitigation should be productized. | planned |

## Current Hypotheses

1. The largest existing trace outliers are mostly scheduler wake-late events, not ML inference or cursor reads.
2. Some large rows are trace capture dispatcher-late events and must not be attributed to the product scheduler.
3. Existing trace telemetry does not directly measure product `OverlayRuntimeThread + OverlayWindow.UpdateLayer`.
4. Product-side message processing and per-move GDI/HBITMAP work may add latency that existing trace packages cannot see.

## Success Criteria

- Produce a reproducible outlier classification over existing trace packages.
- Add a concrete product telemetry design that can be enabled without high disk write volume.
- Identify the next product change by measured evidence, not by assumption.
