# Phase 4: Best-Accuracy Model Search

Runs a bounded PyTorch model search for the Phase 3 product target.

## Reproduce

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-4 best-accuracy-model-search/run-phase4-model-search.ps1"
```

The script reads the root trace zip and Phase 1 split metadata. It does not run hooks and does not copy the zip into this directory.

## Outputs

- `scores.json`: machine-readable metrics and selected model results.
- `report.md`: concise findings and Phase 5/6 recommendation.
- `experiment-log.md`: execution environment and timing.
- `run_phase4_model_search.py`: reproducible training/evaluation runner.
- `run-phase4-model-search.ps1`: PowerShell wrapper using the existing venv.
