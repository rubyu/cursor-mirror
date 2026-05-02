# Candidate gain-100-dwmcap-8 Run 001 Report

## Validity

`gain-100-dwmcap-8` run 001 is valid.

- Quality warnings: none.
- Frames: 922.
- Dark frames: 922.
- All expected motion patterns are present.

## Candidate Comparison

| candidate | runs | weighted score | delta vs baseline |
| --- | ---: | ---: | ---: |
| current-default | 3 | 19.769 px | baseline |
| gain-grid-075 | 2 | 13.084 px | -6.685 px |
| gain-grid-090 | 2 | 13.350 px | -6.419 px |
| gain-090-dwmcap-8 | 1 | 13.449 px | -6.320 px |
| gain-100-dwmcap-8 | 1 | 13.177 px | -6.592 px |

Lower is better. Full gain plus 8 ms cap is better than `gain-090-dwmcap-8`, but still not better than `gain-grid-075`.

## Cap vs Gain Isolation

| candidate | linear-fast p95/p99/max | short-jitter p95/p99/max |
| --- | ---: | ---: |
| current-default | 12 / 44 / 47 | 11 / 12 / 12 |
| gain-grid-075 | 12 / 27 / 39 | 12 / 12 / 12 |
| gain-grid-090 | 12 / 29 / 36 | 12 / 12 / 12 |
| gain-090-dwmcap-8 | 19 / 29 / 29 | 12 / 12 / 12 |
| gain-100-dwmcap-8 | 12 / 33 / 33 | 12 / 12 / 12 |

The `short-jitter` p95 miss remains at full gain when the 8 ms DWM cap is enabled. That means gain reduction is not the sole cause. The cap does reduce `linear-fast` max, but it does not recover the jitter gate.

## Recommendation

Do not continue the DWM-cap path as the primary fix.

Next experiment: `gain-grid-085`, if available. It directly probes the gain-only tradeoff between `gain-grid-075` and `gain-grid-090`. If only existing candidates can be repeated, repeat `gain-grid-075` because it still has the best two-run weighted score.
