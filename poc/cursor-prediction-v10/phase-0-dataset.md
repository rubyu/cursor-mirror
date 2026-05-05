# Cursor Prediction v10 Phase 0 Dataset

Generated: 2026-05-03T08:04:12.280Z

The canonical dataset is `runs/scripts.synthetic.jsonl`. No per-frame CSV,
raw ZIP, dependency directory, checkpoint, or cache output was written.

## Policy

- Script schema: `cursor-mirror-motion-script/1`
- Root seed: `10010`
- Script count: 2000
- On-demand sampling only: true
- Anchors per script: 32
- History window: 200 ms
- Horizons: 8.33, 16.67, 25, 33.33 ms

## Bounds Mix

| bounds | scripts |
| --- | --- |
| 1280x720 | 696 |
| 1920x1080 | 625 |
| 640x480 | 679 |

## Condition Tags

| tag | scripts |
| --- | --- |
| near_stop | 689 |
| edge_proximity | 644 |
| acute_acceleration | 582 |
| missing_history | 538 |
| jitter | 538 |
| loop_or_reversal | 406 |
| smooth_reference | 298 |

## Numeric Summary

| field | mean | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| duration ms | 6986.554 | 7011.069 | 11504.335 | 11997.570 |
| control points | 9.101 | 9.000 | 16.000 | 16.000 |
| speed points | 2.276 | 2.000 | 6.000 | 17.000 |
