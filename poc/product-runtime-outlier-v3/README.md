# Product Runtime Outlier v3

This POC prepares the next product-runtime telemetry pass after v2 selected the cached HBITMAP/DC overlay path.

## Goal

Analyze `product-runtime-outlier-events.csv` packages for scheduler, controller, overlay, and coalescing-related runtime signals without requiring a new Calibrator measurement.

## Steps

| Step | Purpose | Output |
| --- | --- | --- |
| `step-01-telemetry-package-inventory` | Inventory captured product-runtime outlier zip packages and confirm metadata/event counts. | Package list and capture notes. |
| `step-02-runtime-metrics-analysis` | Run the analyzer over one or more existing packages. | `metrics.json` and `report.md`. |
| `step-03-coalescing-field-review` | Review any coalescing-related columns surfaced by newer telemetry packages. | Coalescing metric notes. |
| `step-04-final-summary` | Summarize selected observations and follow-up measurement plan. | Final report draft. |
| `step-05-synthetic-overlay-harness` | Measure real `OverlayWindow` / `UpdateLayeredWindow` using synthetic samples without `GetCursorPos` or WGC. | Runtime packages, metrics, and report. |

## Analyzer

The analyzer reads zip packages containing:

- `metadata.json`
- `product-runtime-outlier-events.csv`

It writes:

- JSON metrics with p50/p95/p99/max summaries.
- A markdown report in the v2 table style.
- Optional coalescing-related field summaries when matching CSV columns are present.

Run from the repository root:

```powershell
.\poc\product-runtime-outlier-v3\scripts\analyze_product_runtime_outlier_package.ps1 `
  -PackagePath .\poc\product-runtime-outlier-v2\step-06-final-selected-validation\product-runtime-outlier-release-final-selected.zip `
  -MetricsPath .\poc\product-runtime-outlier-v3\step-02-runtime-metrics-analysis\metrics.json `
  -ReportPath .\poc\product-runtime-outlier-v3\step-02-runtime-metrics-analysis\report.md
```

Multiple packages can be passed to `-PackagePath`; directories expand to `*.zip`.

## Measurement Note

This scaffold does not run `CursorMirror.Calibrator.exe`. It is intended for analysis of existing product-runtime outlier packages only.

The final v3 decision is summarized in `final-report.md`.
