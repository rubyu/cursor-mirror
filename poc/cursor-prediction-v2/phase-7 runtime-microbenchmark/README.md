# Phase 7 Runtime Microbenchmark

This folder contains the Phase 7 runtime microbenchmark for the accepted Cursor Prediction v2 candidate:

`baseline + DWM-aware next-vblank horizon`, using gained last2 velocity with gain `0.75`.

Run from the repository root:

```powershell
& "poc\cursor-prediction-v2\phase-7 runtime-microbenchmark\run-phase7-runtime-microbenchmark.ps1"
```

Optional trace override:

```powershell
& "poc\cursor-prediction-v2\phase-7 runtime-microbenchmark\run-phase7-runtime-microbenchmark.ps1" -TraceZip "cursor-mirror-trace-20260501-091537.zip"
```

Outputs:
- `scores.json`: machine-readable benchmark, replay parity, allocation, counter, and target results.
- `report.md`: concise runtime/product recommendation report.
- `experiment-log.md`: execution notes and reproducibility context.
- `RuntimeMicrobenchmark.cs`: compiled C# benchmark and reference implementation.
- `run-phase7-runtime-microbenchmark.ps1`: PowerShell wrapper that compiles and runs the C# source with `Add-Type`.

The runner reads the compatible root trace zip in place and does not copy trace data into this directory.
