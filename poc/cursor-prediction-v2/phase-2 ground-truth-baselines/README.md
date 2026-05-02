# Phase 2: Ground Truth and Baselines

This phase evaluates deterministic cursor prediction baselines against labels built from timestamp interpolation over poll samples.

## Reproduce

From the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-2 ground-truth-baselines/run-phase2-baselines.ps1"
~~~

The script uses PowerShell plus .NET built-ins only. It reads:

- cursor-mirror-trace-20260501-091537.zip
- poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json

## Outputs

- scores.json: machine-readable target quality, model metrics, speed-bin segments, and validation-selected winners.
- report.md: concise experiment findings and Phase 3 recommendation.
- experiment-log.md: execution details.
- run-phase2-baselines.ps1: reproducible loader, label construction, and baseline evaluator.
