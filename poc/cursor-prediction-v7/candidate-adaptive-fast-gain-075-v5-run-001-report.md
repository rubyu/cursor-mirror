# Candidate adaptive-fast-gain-075-v5 Run 001 Report

## Validity

`adaptive-fast-gain-075-v5` run 001 is valid.

- Quality warnings: none.
- Frames: 728.
- Dark frames: 728.
- All expected motion patterns are present.

## Adaptive Comparison

| candidate | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: |
| current-default | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v2 | 13.683 | 12 / 41 / 41 | 12 / 12 / 12 | 12 / 12 / 27 |
| adaptive v3 | 13.745 | 25 / 32 / 32 | 12 / 12 / 12 | 12 / 12 / 19 |
| adaptive v4 | 20.392 | 12 / 53 / 53 | 12 / 12 / 12 | 12 / 16 / 539 |
| adaptive v5 | 19.262 | 12 / 35 / 35 | 12 / 12 / 12 | 12 / 13 / 539 |

v5 is valid, but it is not the desired blend. It is worse than v1 on `linear-fast`, still misses the `short-jitter` p95 gate, and brings back the `linear-slow` max outlier.

## Best Adaptive Parameter

Best fast-motion parameter remains v1 because it gives the strongest `linear-fast` result: `12 / 18 / 18`.

Best slow-motion cleanliness remains v2/v3, but those variants lose too much `linear-fast` benefit. None of v1-v5 restores baseline `short-jitter` p95 of `11`.

## Recommendation

Do not repeat v5.

Next experiment should not be another threshold-only variant. Use a code-level regime exclusion: keep v1-like fast eligibility, explicitly bypass the adaptive gain for short-jitter/small-oscillation regimes, and add the slow-motion/startup guard proven by v2/v3.
