# Phase 7 Experiment Log

- Started: 2026-05-01T01:25:20Z
- Finished: 2026-05-01T01:25:20Z
- Runner: compiled C# hot-path code invoked by `run-phase7-runtime-microbenchmark.ps1`.
- Trace: `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\cursor-mirror-trace-20260501-091537.zip`
- The root trace zip was read in place; no trace data was copied into this folder.
- Timing was run serially with `200000` warmup predictions and `9` repeats of `2000000` predictions.
- GPU was not measured because Phase 7 is a CPU/runtime product-path check.
- Noise note: Windows scheduling, turbo/thermal behavior, and background filesystem sync can affect the tail. Use the repeat table in `scores.json` rather than a single p99 in isolation.

Outcome: product-shaped C# predictor meets the Phase 7 runtime and allocation targets on this run.
