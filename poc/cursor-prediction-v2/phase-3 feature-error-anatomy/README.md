# Phase 3: Feature Engineering and Error Anatomy

This phase reconstructs the accepted Phase 2 product baseline and analyzes where it fails.

## Reproduce

From the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-3 feature-error-anatomy/run-phase3-feature-error-anatomy.ps1"
~~~

The script uses PowerShell plus .NET built-ins only. It reads:

- cursor-mirror-trace-20260501-091537.zip
- poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json
- poc/cursor-prediction-v2/phase-2 ground-truth-baselines/scores.json

## Outputs

- scores.json: baseline reconstruction, error anatomy bins, top failure clusters, representative high-error samples, gating analysis, leakage rules, and Phase 4 feature schemas.
- report.md: concise findings and Phase 4 recommendation.
- experiment-log.md: execution details.
- run-phase3-feature-error-anatomy.ps1: reproducible analysis runner.
