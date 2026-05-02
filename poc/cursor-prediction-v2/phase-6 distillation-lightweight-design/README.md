# Phase 6 Distillation and Lightweight Model Design

This folder contains the Phase 6 lightweight distillation experiment for Cursor Mirror prediction.

Run from the repository root:

```powershell
& "poc\cursor-prediction\step-5 neural-models\.venv\Scripts\python.exe" "poc\cursor-prediction-v2\phase-6 distillation-lightweight-design\run_phase6_distillation.py"
```

Or use the wrapper:

```powershell
& "poc\cursor-prediction-v2\phase-6 distillation-lightweight-design\run-phase6-distillation.ps1"
```

Outputs:
- `scores.json`: machine-readable metrics, candidate ranking, selected tables, and implementation cost estimates.
- `report.md`: concise product recommendation and implementation sketch.
- `experiment-log.md`: execution notes and reproducibility context.

The runner reads the compatible root trace zip in place and does not copy trace data into this directory.
