# Candidate gain-grid-085 Run 001 Report

## Validity

`gain-grid-085` run 001 is valid.

- Quality warnings: none.
- Frames: 830.
- Dark frames: 830.
- All expected motion patterns are present.

## Gain-Only Comparison

| candidate | runs | weighted score | delta vs baseline |
| --- | ---: | ---: | ---: |
| current-default | 3 | 19.769 px | baseline |
| gain-grid-075 | 2 | 13.084 px | -6.685 px |
| gain-grid-085 | 1 | 13.206 px | -6.563 px |
| gain-grid-090 | 2 | 13.350 px | -6.419 px |

Lower is better. `gain-grid-085` lands between 075 and 090 on aggregate score, but with only one run.

## Pattern Comparison

| candidate | linear-fast p95/p99/max | short-jitter p95/p99/max |
| --- | ---: | ---: |
| current-default | 12 / 44 / 47 | 11 / 12 / 12 |
| gain-grid-075 | 12 / 27 / 39 | 12 / 12 / 12 |
| gain-grid-085 | 18 / 29 / 29 | 12 / 12 / 12 |
| gain-grid-090 | 12 / 29 / 36 | 12 / 12 / 12 |

`gain-grid-085` improves `linear-fast` max versus 075, but worsens `linear-fast` p95 and does not fix the repeated `short-jitter` p95 miss.

## Recommendation

Repeat `gain-grid-075` as run 003 before exploring more gain points. It still has the best two-run weighted score, and `gain-grid-085` did not solve the jitter gate. If 075 run 003 remains clean enough, promote 075 to a robustness candidate; if not, try a lower gain such as `gain-grid-065`.
