# Experiment Log

- 2026-05-02T10:50:03.488Z: Created Phase 7 deep-teacher experiment under `phase-7 deep-teacher/`.
- Inspected local tooling. `python` was not on PATH; `uv run --no-python-downloads python --version` did not find an interpreter, so PyTorch/CUDA could not be used without downloading or installing dependencies. `nvidia-smi` did show a local NVIDIA GPU, but this run stayed CPU-only.
- Inspected `phase-2 dataset-builder/dataset.jsonl`: 27,738 rows, fields include causal anchor history, dt/previous dt, velocity, speed, acceleration summary, DWM and scheduler timing bins.
- Read Phase 3/4/5/6 reports and score files for context.
- Confirmed dataset has enough history for scalar last2 velocity/acceleration-style features and constructed an 8-step causal history tensor for sequence experiments.
- Built causal feature vectors without label/reference future fields. Sequence history uses only anchors at or before the current row.
- Trained a stronger two-hidden-layer residual MLP and a small causal TCN residual teacher. Guarded variants selected correction caps on validation.
- Added missing-history augmentation to the TCN by masking older history steps for 25.0% of fit rows.
- For each fold, fit on train-session first 70%, selected hyperparameters/correction cap on train-session last 30%, then evaluated the full held-out session.
- Wrote `scores.json`, `report.md`, and this log.
