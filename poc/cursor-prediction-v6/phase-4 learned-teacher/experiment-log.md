# Experiment Log

- 2026-05-02T10:22:50.848Z: Created Phase 4 learned-teacher experiment under `phase-4 learned-teacher/`.
- Inspected `phase-2 dataset-builder/dataset.jsonl`: 27,738 rows, fields include causal anchor history, dt/previous dt, velocity, speed, acceleration summary, DWM and scheduler timing bins.
- Confirmed dataset has enough history for last2 velocity and last3 acceleration-style causal summaries. Only the first two rows per session have null history masks.
- Checked GPU availability with `nvidia-smi`; an NVIDIA GPU was visible, but no CUDA-capable ML dependency was used. Training ran in dependency-free Node.js on CPU.
- Built causal feature vectors without label/reference future fields.
- Trained ridge direct, ridge residual, guarded ridge residual, direct MLP, residual MLP, and guarded residual MLP.
- For each fold, fit on train-session first 70%, selected hyperparameters/correction cap on train-session last 30%, then evaluated the full held-out session.
- Wrote `scores.json`, `report.md`, and this log.
