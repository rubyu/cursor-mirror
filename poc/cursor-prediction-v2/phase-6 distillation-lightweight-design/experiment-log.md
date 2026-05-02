# Phase 6 Experiment Log

- Started: 2026-05-01T01:17:37Z
- Finished: 2026-05-01T01:17:42Z
- Python: `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\poc\cursor-prediction\step-5 neural-models\.venv\Scripts\python.exe`
- NumPy: `2.4.3`
- Read root trace zip in place; did not copy trace data into PoC.
- Reconstructed Phase 1 chronological train/validation/test split and the poll / `dwm-next-vblank` label path.
- Evaluated fixed gains, train-selected piecewise gain tables, conservative validation-gated tables, and a NumPy ridge residual reference.
- Selected decision from validation/test p99, max, low-risk preservation, and regression counts rather than mean alone.

Outcome: `baseline + DWM-aware next-vblank horizon (gained-last2-0.75)` remains the recommended product candidate; no correction passed strongly enough for productization.
