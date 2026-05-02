# Phase 1: Data Audit and Timebase Reconstruction

This directory contains the Phase 1 audit for `cursor-mirror-trace-20260501-091537.zip`. The zip is read in place from the repository root; it is not copied here.

## Reproduce

From the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-1 data-audit-timebase/run-phase1-audit.ps1"
~~~

The script uses PowerShell plus .NET built-ins only. Python was not available in this workspace at execution time.

## Outputs

- `scores.json`: machine-readable audit metrics.
- `report.md`: concise findings and split recommendation.
- `experiment-log.md`: execution log.
- `run-phase1-audit.ps1`: reproducible audit script.
