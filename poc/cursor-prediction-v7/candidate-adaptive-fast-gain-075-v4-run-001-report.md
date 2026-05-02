# Candidate adaptive-fast-gain-075-v4 Run 001 Report

## Validity

`adaptive-fast-gain-075-v4` run 001 is valid.

- Quality warnings: none.
- Frames: 784.
- Dark frames: 784.
- All expected motion patterns are present.

## Adaptive Comparison

| candidate | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: |
| current-default | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v2 | 13.683 | 12 / 41 / 41 | 12 / 12 / 12 | 12 / 12 / 27 |
| adaptive v3 | 13.745 | 25 / 32 / 32 | 12 / 12 / 12 | 12 / 12 / 19 |
| adaptive v4 | 20.392 | 12 / 53 / 53 | 12 / 12 / 12 | 12 / 16 / 539 |

v4 is worse than baseline on `linear-fast` p99/max and brings back the slow-motion transient. It also keeps the `short-jitter` p95 miss.

## Best Parameter Read

Best adaptive setting for the core fast-motion target is still v1: `linear-fast` reaches `12 / 18 / 18`, much better than all global gains and later adaptive variants.

Best adaptive setting for slow-motion cleanliness is v3 or v2, but both lose too much `linear-fast` benefit. None of v1-v4 restores the baseline `short-jitter` p95 of `11`.

## Recommendation

Do not repeat v4.

Code-level jitter exclusion is warranted. The next useful experiment should keep v1-like fast eligibility and add a direct exclusion for short-jitter/small-oscillation regimes, plus the slow-motion/startup guard from v2/v3. More threshold-only tuning has not solved the tradeoff.
