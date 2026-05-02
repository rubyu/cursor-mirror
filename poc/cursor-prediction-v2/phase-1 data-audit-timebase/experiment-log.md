# Phase 1 Experiment Log

## 2026-05-01 09:31:24 +09:00
- Created Phase 1 directory.
- Read `metadata.json` and `trace.csv` directly from repository-root zip: `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\cursor-mirror-trace-20260501-091537.zip`.
- Python was not available via `python`, `python3`, or `py`; used dependency-free PowerShell/.NET instead.
- Computed row/event counts, sequence and time monotonicity, elapsed-vs-stopwatch consistency, duplicate positions, idle gaps, poll/hook interval distributions, DWM timing availability/cadence/continuity, hook-vs-nearest-poll deltas, and chronological split boundaries.
- Wrote `scores.json` and `report.md`.
