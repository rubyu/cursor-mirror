# Experiment Log

- Loaded format v4 trace from C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\cursor-mirror-trace-20260501-231621.zip.
- Parsed 695,412 CSV rows.
- Treated runtimeSchedulerPoll as runtime input and referencePoll as target reconstruction.
- Scored 55,621 runtime contexts.
- Recomputed DWM next-vblank targets from runtime sample timestamps to match DwmAwareCursorPositionPredictor rather than using the scheduler's possibly missed planned vblank.
- Wrote scores.json and report.md.
