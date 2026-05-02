# Candidate gain-090-dwmcap-8 Run 001 Report

## Validity

`gain-090-dwmcap-8` run 001 is valid.

- Quality warnings: none.
- Frames: 927.
- Dark frames: 927.
- All expected motion patterns are present.

## Candidate Comparison

| candidate | runs | weighted score | delta vs baseline |
| --- | ---: | ---: | ---: |
| current-default | 3 | 19.769 px | baseline |
| gain-grid-075 | 2 | 13.084 px | -6.685 px |
| gain-grid-090 | 2 | 13.350 px | -6.419 px |
| gain-090-dwmcap-8 | 1 | 13.449 px | -6.320 px |

Lower is better. The cap candidate is valid but currently trails both gain-only candidates.

## High-Risk Patterns

| pattern | baseline | gain-grid-075 | gain-grid-090 | gain-090-dwmcap-8 |
| --- | ---: | ---: | ---: | ---: |
| linear-fast p95/p99/max | 12 / 44 / 47 | 12 / 27 / 39 | 12 / 29 / 36 | 19 / 29 / 29 |
| rapid-reversal p95/p99/max | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |
| sine-sweep p95/p99/max | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |
| short-jitter p95/p99/max | 11 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |

## Recommendation

Do not repeat `gain-090-dwmcap-8` yet.

Next experiment: `gain-100-dwmcap-8`. This isolates the 8 ms DWM horizon cap from gain reduction. If default gain plus cap still misses `short-jitter` p95, drop the cap path and return to the best gain-only candidate for repeat/robustness work.
