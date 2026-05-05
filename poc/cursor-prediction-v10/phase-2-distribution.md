# Cursor Prediction v10 Phase 2 Distribution

Generated: 2026-05-03T08:12:55.220Z

Canonical data: `runs/scripts.synthetic.phase2.jsonl` (9.22 MB). No per-frame CSV, raw ZIP, dependency directory, checkpoint, or cache output was written.

## Policy

- Script count: 10000
- Root seed: `20020`
- GPU used: no
- Evaluation rows: 3840000
- Anchors per script: 32
- History window: 200 ms

## Script Tags

| tag | scripts |
| --- | --- |
| high_speed | 7388 |
| acute_acceleration | 6167 |
| edge_proximity | 5275 |
| near_stop | 4918 |
| missing_history | 4483 |
| jitter | 4194 |
| loop_or_reversal | 3045 |
| endpoint_stress | 2548 |
| smooth_reference | 74 |

## Evaluation Speed Mix

| speed bin | rows |
| --- | --- |
| 0-25 | 139572 |
| 25-100 | 425712 |
| 100-250 | 601296 |
| 250-500 | 794808 |
| 500-1000 | 949968 |
| 1000-2000 | 697764 |
| >=2000 | 230880 |

Phase 2 intentionally thickens high-speed, acute acceleration, near-stop, missing-history, jitter, and edge-proximity cases. The `>=2000px/s` bin now has 230880 evaluated rows, well above the phase 1 count of 132.
