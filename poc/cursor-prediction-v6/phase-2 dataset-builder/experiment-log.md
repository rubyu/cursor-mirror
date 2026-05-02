# Experiment Log

- Built one dataset row per scoreable `runtimeSelfSchedulerPoll` anchor.
- Recomputed target DWM next-vblank from anchor-time DWM fields.
- Interpolated `referencePoll` only at the target timestamp for labels.
- Added causal last2 velocity, last3 acceleration summary, scheduler timing fields, speed bins, horizon bins, and chronological blocks.
- Wrote `dataset.jsonl`, `scores.json`, and `report.md`.
