# Candidate gain-grid-075 Runs 001-002 Report

## Validity

`gain-grid-075` runs 001 and 002 are valid.

- Quality warnings: none.
- Candidate frames: 1,879.
- Candidate dark frames: 1,879.
- All expected motion patterns are present.

## Aggregate Delta

| candidate | runs | weighted score | delta vs baseline |
| --- | ---: | ---: | ---: |
| current-default baseline | 3 | 19.769 px | baseline |
| gain-grid-075 | 2 | 13.084 px | -6.685 px |

Lower is better. The aggregate delta is still partly inflated by the baseline run-003 `linear-slow` transient, so high-risk pattern deltas are more important than the headline score.

## Per-Run Variance

| run | frames | mean | p95 | p99 | max | weighted score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gain-grid-075 001 | 944 | 5.663 | 12 | 12 | 39 | 13.563 |
| gain-grid-075 002 | 935 | 5.647 | 12 | 12 | 27 | 12.753 |

## High-Risk Pattern Deltas

| pattern | baseline p95/p99/max | gain-grid-075 p95/p99/max | score delta |
| --- | ---: | ---: | ---: |
| linear-fast | 12 / 44 / 47 | 12 / 27 / 39 | -7.150 |
| rapid-reversal | 12 / 12 / 12 | 12 / 12 / 12 | 0.000 |
| sine-sweep | 12 / 12 / 12 | 12 / 12 / 12 | 0.000 |
| short-jitter | 11 / 12 / 12 | 12 / 12 / 12 | +0.500 |

## Recommendation

Do not take `gain-grid-075` run 003 yet. Test another gain first.

Recommended next candidate: `gain-grid-090`, if that build knob is available. It is the most useful next point because `gain-grid-075` repeatedly improves the `linear-fast` p99/max tail, but also repeatedly misses the `short-jitter` p95 gate by `+1 px`. A gentler gain reduction can test whether the fast-tail benefit survives without the jitter regression.
