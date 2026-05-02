# Candidate gain-grid-090 Run 001 Report

## Validity

`gain-grid-090` run 001 is valid.

- Quality warnings: none.
- Frames: 932.
- Dark frames: 932.
- All expected motion patterns are present.

## Candidate Comparison

| candidate | runs | weighted score | delta vs baseline |
| --- | ---: | ---: | ---: |
| current-default | 3 | 19.769 px | baseline |
| gain-grid-075 | 2 | 13.084 px | -6.685 px |
| gain-grid-090 | 1 | 12.788 px | -6.981 px |

Lower is better. `gain-grid-090` is currently slightly better than `gain-grid-075`, but has only one run.

## High-Risk Patterns

| pattern | baseline | gain-grid-075 | gain-grid-090 |
| --- | ---: | ---: | ---: |
| linear-fast p95/p99/max | 12 / 44 / 47 | 12 / 27 / 39 | 12 / 22 / 22 |
| rapid-reversal p95/p99/max | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |
| sine-sweep p95/p99/max | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |
| short-jitter p95/p99/max | 11 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |

## Recommendation

Measure `gain-grid-090` run 002 next. It improves the `linear-fast` p99/max tail more than `gain-grid-075`, but it still shows the same `short-jitter` p95 regression. If run 002 repeats that jitter miss, move to a horizon candidate instead of continuing gain-only search.
