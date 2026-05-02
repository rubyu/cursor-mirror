# Candidate gain-grid-090 Runs 001-002 Report

## Validity

`gain-grid-090` runs 001 and 002 are valid.

- Quality warnings: none.
- Candidate frames: 1,860.
- Candidate dark frames: 1,860.
- All expected motion patterns are present.

## Aggregate Comparison

| candidate | runs | weighted score | delta vs baseline |
| --- | ---: | ---: | ---: |
| current-default | 3 | 19.769 px | baseline |
| gain-grid-075 | 2 | 13.084 px | -6.685 px |
| gain-grid-090 | 2 | 13.350 px | -6.419 px |

Lower is better. `gain-grid-090` is valid, but after two runs it is not better than `gain-grid-075` on the weighted score.

## Per-Run Variance

| run | mean | p95 | p99 | max | weighted score | linear-fast p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gain-grid-090 001 | 5.008 | 12 | 12 | 36 | 12.788 | 12 / 22 / 22 |
| gain-grid-090 002 | 5.337 | 12 | 12 | 36 | 14.137 | 23 / 36 / 36 |

## High-Risk Pattern Comparison

| pattern | baseline | gain-grid-075 | gain-grid-090 |
| --- | ---: | ---: | ---: |
| linear-fast p95/p99/max | 12 / 44 / 47 | 12 / 27 / 39 | 12 / 29 / 36 |
| rapid-reversal p95/p99/max | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |
| sine-sweep p95/p99/max | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |
| short-jitter p95/p99/max | 11 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |

## Recommendation

Do not take `gain-grid-090` run 003 yet. It is good enough to show that gain-only changes reduce `linear-fast` tail risk, but not stable enough to select as the winner.

Next candidate: `gain-090-horizon-cap-8ms`, if available. Keep gain at 90% and cap the DWM projection horizon at 8 ms. This tests whether a horizon cap can preserve most of the `linear-fast` p99/max improvement while removing the repeated `short-jitter` p95 regression.
