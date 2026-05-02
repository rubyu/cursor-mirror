# Candidate adaptive-fast-gain-075 Run 001 Report

## Validity

`adaptive-fast-gain-075` run 001 is valid.

- Quality warnings: none.
- Frames: 879.
- Dark frames: 879.
- All expected motion patterns are present.

## Aggregate Comparison

| candidate | runs | weighted score | delta vs baseline |
| --- | ---: | ---: | ---: |
| current-default | 3 | 19.769 px | baseline |
| gain-grid-075 | 3 | 19.202 px | -0.567 px |
| gain-grid-085 | 1 | 13.206 px | -6.563 px |
| gain-grid-090 | 2 | 13.350 px | -6.419 px |
| adaptive-fast-gain-075 | 1 | 18.411 px | -1.358 px |

Lower is better. The adaptive raw score is dominated by a `linear-slow` max `539 px` transient, so pattern deltas are the useful read.

## Key Pattern Comparison

| candidate | linear-fast p95/p99/max | short-jitter p95/p99/max |
| --- | ---: | ---: |
| current-default | 12 / 44 / 47 | 11 / 12 / 12 |
| gain-grid-075 | 12 / 32 / 39 | 12 / 12 / 12 |
| gain-grid-090 | 12 / 29 / 36 | 12 / 12 / 12 |
| adaptive-fast-gain-075 | 12 / 18 / 18 | 12 / 12 / 12 |

The adaptive gate is clearly better than global gains on `linear-fast`, cutting p99/max to `18/18`. It still does not preserve the baseline `short-jitter` p95 of `11`.

## Recommendation

Continue the adaptive model family, but tighten the gate before repeating.

Next parameter tweak: `adaptive-fast-gain-075-v2` with a stricter fast-motion gate:

- higher velocity threshold for applying 75% gain;
- explicit exclusion for short-jitter or small-oscillation regimes;
- fallback to default gain outside high-confidence fast linear motion.

Goal: keep `linear-fast` near `12/18/18` while restoring `short-jitter` p95 to `11`.
