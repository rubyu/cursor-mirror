# Experiment Log

- Loaded format v4 trace from C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\cursor-mirror-trace-20260501-235043.zip.
- Parsed 97,393 CSV rows.
- Treated runtimeSchedulerPoll as runtime input and referencePoll as target reconstruction.
- Scored 8,514 runtime contexts.
- Recomputed DWM next-vblank targets from runtime sample timestamps to match DwmAwareCursorPositionPredictor rather than using the scheduler's possibly missed planned vblank.
- Wrote scores.json and report.md.
