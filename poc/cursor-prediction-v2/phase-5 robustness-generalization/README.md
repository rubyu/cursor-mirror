# Phase 5: Robustness and Generalization Checks

Reconstructs the Phase 4 selected candidates for the primary product target:
poll anchors / `dwm-next-vblank`.

## Reproduce

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-5 robustness-generalization/run-phase5-robustness.ps1"
```

The script streams the root trace zips in place, reads Phase 1 split metadata,
and imports Phase 4 model/data helpers. It does not run hooks and does not copy
trace zips into `poc`.

## Outputs

- `scores.json`: machine-readable robustness metrics.
- `report.md`: concise decision report.
- `experiment-log.md`: runtime and reproducibility notes.
- `run_phase5_robustness.py`: reproducible Python runner.
- `run-phase5-robustness.ps1`: wrapper using the existing venv.
