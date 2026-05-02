# Candidate adaptive-fast-gain-075-v2 Run 001 Report

## Validity

`adaptive-fast-gain-075-v2` run 001 is valid.

- Quality warnings: none.
- Frames: 769.
- Dark frames: 769.
- All expected motion patterns are present.

## Adaptive Comparison

| candidate | runs | weighted score | delta vs baseline |
| --- | ---: | ---: | ---: |
| current-default | 3 | 19.769 px | baseline |
| adaptive-fast-gain-075 | 1 | 18.411 px | -1.358 px |
| adaptive-fast-gain-075-v2 | 1 | 13.683 px | -6.086 px |

Lower is better. v2 removes the large slow-motion transient that hurt v1, but it also loses most of v1's fast-motion benefit.

## Key Pattern Comparison

| candidate | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: |
| current-default | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v2 | 12 / 41 / 41 | 12 / 12 / 12 | 12 / 12 / 27 |

v1 proves the adaptive family can strongly reduce `linear-fast`. v2 proves the stricter gate can avoid the slow-motion transient, but it barely improves `linear-fast` versus baseline and still does not restore the `short-jitter` p95 of `11`.

## Recommendation

Do not repeat v2 as-is, and do not stop the adaptive family.

Next parameter tweak: `adaptive-fast-gain-075-v3`, a midpoint gate between v1 and v2:

- keep the explicit short-jitter/small-oscillation exclusion from v2;
- lower the fast-motion threshold enough to re-capture the v1 `linear-fast` benefit;
- keep the slow-motion exclusion that prevented the `539 px` transient.
