# Phase 1 Baseline Runs 001-003 Report

## Validity

Runs 001, 002, and 003 scored successfully as `current-default`.

- Quality warnings: none.
- Total frames: 2,795.
- Dark frames: 2,795.
- All expected motion patterns are present.

## Aggregate Metrics

| metric | value |
| --- | ---: |
| combined mean separation | 4.962 px |
| combined p95 separation | 12 px |
| combined p99 separation | 12 px |
| combined max separation | 539 px |
| weighted per-pattern visual score | 19.769 px |

## Per-Run Variance

| run | frames | mean | p95 | p99 | max | weighted score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 001 | 938 | 4.771 | 12 | 12 | 44 | 14.816 |
| 002 | 935 | 4.698 | 12 | 12 | 47 | 13.867 |
| 003 | 922 | 5.425 | 12 | 12 | 539 | 19.303 |

## Pattern Failure

`linear-fast` is the stable model-facing failure:

| scope | mean | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: |
| run 001 | 4.242 | 32 | 44 | 44 |
| run 002 | 2.694 | 12 | 47 | 47 |
| run 003 | 3.164 | 12 | 35 | 35 |
| combined | 3.368 | 12 | 44 | 47 |

Run 003 also has one large `linear-slow` outlier: frame `0`, elapsed `343.673 ms`, separation `539 px`. Treat it as a startup/capture transient to track, not the first candidate target.

## Next Candidate

Measure `gain-grid-075` first:

- `PredictionEnabled = true`
- `PredictionGainPercent = 75`
- same DWM-aware predictor and default idle reset

Rationale: the repeatable failure is sparse fast-motion tail separation, and a 75% gain is the lowest-risk knob to test before larger model changes.
