# Phase 1 - Data Audit

## Scope

Inputs were read directly from the two requested format-9 trace ZIPs. The ZIP files were not modified.

| session | zip | format | csv rows | self anchors | reference rows | self p50 ms | self p95 ms | ref p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 175951 | cursor-mirror-trace-20260502-175951.zip | 9 | 260,359 | 15,829 | 122,812 | 16.668 | 16.969 | 2.001 |
| 184947 | cursor-mirror-trace-20260502-184947.zip | 9 | 208,139 | 11,911 | 97,907 | 16.668 | 16.777 | 2.001 |

## Anchor And Label Policy

- Anchor stream: `runtimeSelfSchedulerPoll`.
- Label stream: `referencePoll`.
- Target timestamp: DWM next-vblank recomputed from the anchor sample timestamp and DWM timing fields, matching the current DWM-aware predictor shape.
- Label position: linear interpolation between the adjacent `referencePoll` samples at the target timestamp.
- Feature policy: dataset rows only use anchor-time-or-earlier fields. Future reference data is used only to construct labels.

## Notes

Both traces report 100% DWM timing availability. The self-scheduler cadence is close to one refresh interval at the median and p95, while `referencePoll` remains dense enough for interpolation. The audit keeps legacy `poll`, `runtimeSchedulerPoll`, and scheduler experiment streams out of the dataset except for event-count context.
