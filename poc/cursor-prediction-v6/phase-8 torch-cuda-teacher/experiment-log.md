# Phase 8 Experiment Log

- Created `run_torch_cuda_teacher.py` under `phase-8 torch-cuda-teacher/`.
- Launched with local venv Python: `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\poc\cursor-prediction-v6\.venv-gpu\Scripts\python.exe`.
- Confirmed CUDA: `True`, device `cuda`, torch `2.11.0+cu128`, CUDA `12.8`.
- Used dataset `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\poc\cursor-prediction-v6\phase-2 dataset-builder\dataset.jsonl` and prior Phase 7 score context.
- Trained residual MLP, GRU, and causal Conv1D/TCN variants on both cross-session directions.
- Used missing-history augmentation for sequence models at 0.30 rate, masking up to 3 older history steps.
- Selected guarded caps only on validation blocks: 0.125, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.5 px.
- Wrote final compact artifacts only: `scores.json`, `report.md`, and `experiment-log.md`.
- Total elapsed seconds: 15.63.
