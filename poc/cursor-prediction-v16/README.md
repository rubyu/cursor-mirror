# Cursor Prediction v16

Runtime-ready distillation POC for the latest 60Hz-only cursor prediction data path.

Artifacts:

- `scripts/run-runtime-ready-distillation-gpu.py`: reproducible experiment script.
- `scores.json`: machine-readable metrics and selected-candidate metadata.
- `report.md`: human-readable summary and adoption decision.
- `notes.md`: run command and caveats.
- `runtime/selected-candidate.json`: concrete runtime weights and normalization.
- `runtime/Distilled60HzPredictor.g.cs`: generated C# prototype source.
- `runtime/candidates/`: exported candidate descriptors for the shortlist.
- `runtime/csharp-parity/`: C# compile/run parity harness and result.

Artifact policy: no raw ZIP copies, expanded CSVs, checkpoints, tensor dumps, feature caches, TensorBoard logs, or large binaries.
