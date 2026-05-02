# Candidate adaptive-fast-gain-075-v9-fast-first-jitter-only-bypass Run 001 Report

## Validity

`adaptive-fast-gain-075-v9-fast-first-jitter-only-bypass` run 001 is valid.

- Quality warnings: none.
- Frames: 537.
- Dark frames: 537.
- All expected motion patterns are present.

## Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v8 fast-priority latch | 1 | 14.281 | 28 / 40 / 40 | 10 / 12 / 12 | 12 / 12 / 12 |
| adaptive v9 fast-first bypass | 1 | 13.548 | 12 / 41 / 41 | 11 / 12 / 12 | 12 / 12 / 13 |

## Read

v9 recovered `linear-fast` p95 to `12 px`, matching v1 and baseline, but it did not recover v1's clean tail. The `linear-fast` p99/max is `41 / 41 px`; frame inspection found this is a single frame above `18 px`, not a broad distribution shift.

v9 kept `short-jitter` at baseline quality: `11 / 12 / 12`, worse than v8 p95 `10 px` but better than v1 p95 `12 px`.

v9 mostly kept the `linear-slow` cleanup: `12 / 12 / 13`, with only a `+1 px` max versus v8.

v9 is the best adaptive-family weighted score so far, but the one-frame `linear-fast` tail means it should be repeated before treating it as stable.

## Recommendation

Stop adding new latch variants for now. Do not create a v10 code candidate yet.

Next measurement: repeat the same candidate as `adaptive-fast-gain-075-v9-fast-first-jitter-only-bypass` run 002.

Decision rule:

- If run 002 keeps `short-jitter` at or below baseline p95 `11 px`, keeps `linear-slow` max near `12-13 px`, and `linear-fast` has at most isolated tail frames, promote v9 as the adaptive branch candidate.
- If run 002 repeats `linear-fast` p99/max above `30 px`, stop this adaptive latch branch and move to a different model family; more latch thresholds are likely just trading one edge case for another.
