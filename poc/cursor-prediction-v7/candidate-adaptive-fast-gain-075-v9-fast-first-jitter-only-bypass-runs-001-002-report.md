# Candidate adaptive-fast-gain-075-v9-fast-first-jitter-only-bypass Runs 001-002 Report

## Validity

`adaptive-fast-gain-075-v9-fast-first-jitter-only-bypass` runs 001-002 are valid.

- Quality warnings: none.
- Run 001 frames/dark frames: 537 / 537.
- Run 002 frames/dark frames: 845 / 845.
- All expected motion patterns are present in both runs.

## Aggregate Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v8 fast-priority latch | 1 | 14.281 | 28 / 40 / 40 | 10 / 12 / 12 | 12 / 12 / 12 |
| adaptive v9 fast-first bypass | 2 | 19.881 | 17 / 41 / 41 | 12 / 12 / 12 | 12 / 12 / 539 |

## V9 Per-Run Stability

| run | linear-fast p95/p99/max | linear-fast frames >18 px | linear-fast frames >30 px | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| 001 | 12 / 41 / 41 | 1 / 40 | 1 / 40 | 11 / 12 / 12 | 12 / 12 / 13 |
| 002 | 21 / 33 / 33 | 3 / 55 | 1 / 55 | 12 / 12 / 12 | 12 / 12 / 539 |

## Read

The `linear-fast` tail is reproducible. Run 001 had one frame above `18 px`; run 002 had three frames above `18 px`, including one above `30 px`. The run 002 `linear-fast` p95 also rose to `21 px`, so the issue is no longer just a single isolated outlier.

`short-jitter` did not remain improved. The v9 aggregate is `12 / 12 / 12`, matching v1 and missing baseline p95 `11 px`.

`linear-slow` did not remain cleaned up. Run 002 reintroduced the `539 px` startup outlier, and the v9 aggregate is back to `12 / 12 / 539`.

The aggregate weighted score regressed to `19.881 px`, slightly worse than the baseline aggregate `19.769 px`.

## Decision

Stop this adaptive latch / fast-first bypass branch.

Do not create a v10 threshold variant. The branch is now trading among the same three failures:

- v8 fixed `short-jitter` but hurt `linear-fast`.
- v9 recovered `linear-fast` p95 in run 001, but the fast tail reproduced in run 002.
- v9 also lost the `linear-slow` cleanup and did not keep the jitter improvement.

Next work should move to a different model family rather than adding more latch thresholds.
