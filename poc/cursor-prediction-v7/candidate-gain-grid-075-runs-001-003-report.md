# Candidate gain-grid-075 Runs 001-003 Report

## Validity

`gain-grid-075` runs 001, 002, and 003 are valid.

- Quality warnings: none.
- Candidate frames: 2,687.
- Candidate dark frames: 2,687.
- All expected motion patterns are present.

## Aggregate Comparison

| candidate | runs | weighted score | delta vs baseline |
| --- | ---: | ---: | ---: |
| current-default | 3 | 19.769 px | baseline |
| gain-grid-075 | 3 | 19.202 px | -0.567 px |
| gain-grid-085 | 1 | 13.206 px | -6.563 px |
| gain-grid-090 | 2 | 13.350 px | -6.419 px |
| gain-100-dwmcap-8 | 1 | 13.177 px | -6.592 px |

Lower is better. The raw `gain-grid-075` score is pulled up by one `linear-slow` outlier in run 003: frame `1`, elapsed `397.279 ms`, separation `539 px`.

## gain-grid-075 Per-Run Variance

| run | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | max |
| --- | ---: | ---: | ---: | ---: |
| 001 | 13.563 | 12 / 39 / 39 | 12 / 12 / 12 | 39 |
| 002 | 12.753 | 12 / 27 / 27 | 12 / 12 / 12 | 27 |
| 003 | 19.076 | 12 / 32 / 32 | 12 / 12 / 12 | 539 |

## Product Read

`gain-grid-075` is not product-ready for a near-zero visual-separation target.

It improves the stable `linear-fast` tail from baseline `12 / 44 / 47` to `12 / 32 / 39` p95/p99/max, but it still leaves a visible tail and repeats the `short-jitter` p95 regression from `11` to `12`.

## Recommendation

Stop global gain-only search as the main path. Next experiment should use another model family, preferably a motion-regime gate:

- keep the current/default behavior for `short-jitter` and low-amplitude regimes;
- apply a reduced-gain or guarded correction only in fast linear/high-confidence motion;
- score it against the same calibrator pattern gates.

This is the most direct route toward near-zero without trading away jitter behavior.
