# Candidate gain-grid-075 Run 001 Report

## Validity

`gain-grid-075` run 001 is valid.

- Quality warnings: none.
- Frames: 944.
- Dark frames: 944.
- All expected motion patterns are present.

## Weighted Score Delta

| candidate | weighted score | delta vs baseline |
| --- | ---: | ---: |
| current-default baseline 001-003 | 19.769 px | baseline |
| gain-grid-075 run 001 | 13.563 px | -6.206 px |

Lower is better. The aggregate win is real in the scorer, but inflated by the baseline run-003 `linear-slow` transient outlier.

## High-Risk Pattern Deltas

| pattern | baseline p95/p99/max | gain-grid-075 p95/p99/max | score delta |
| --- | ---: | ---: | ---: |
| linear-fast | 12 / 44 / 47 | 12 / 39 / 39 | -2.950 |
| rapid-reversal | 12 / 12 / 12 | 12 / 12 / 12 | 0.000 |
| sine-sweep | 12 / 12 / 12 | 12 / 12 / 12 | 0.000 |
| short-jitter | 11 / 12 / 12 | 12 / 12 / 12 | +0.500 |

## Recommendation

Repeat `gain-grid-075` once. Do not promote it yet.

Rationale: it improves the stable `linear-fast` p99/max failure, but it also worsens `short-jitter` p95 by `+1 px`. A second run should decide whether that is noise or a real gate failure.
