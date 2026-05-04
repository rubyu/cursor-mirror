# Cursor Prediction v9 Phase 1 Dataset

Generated: 2026-05-03T04:16:55.574Z

No dataset rows were written to disk; rows were built in memory only.

## Policy

- Anchor stream: `runtimeSelfSchedulerPoll`
- History stream: `referencePoll at or before anchor time`
- Label stream: `referencePoll interpolated at anchor time + fixed horizon`
- Horizons: 4, 8, 12, 16.67 ms
- Causal inputs only: true

## Sessions

| session | zip | reference polls | anchors | dataset rows | anchor p50 ms | anchor p95 ms | reference p95 ms | quality warnings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| session-1 | cursor-mirror-trace-20260502-175951.zip | 122812 | 15829 | 63310 | 16.668 | 16.969 | 2.001 | product_poll_interval_p95_exceeds_requested_interval |
| session-2 | cursor-mirror-trace-20260502-184947.zip | 97907 | 11911 | 47639 | 16.668 | 16.777 | 2.001 | product_poll_interval_p95_exceeds_requested_interval |
