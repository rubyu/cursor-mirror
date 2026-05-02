# Candidate adaptive-fast-gain-075-v3 Run 001 Report

## Validity

`adaptive-fast-gain-075-v3` run 001 is valid.

- Quality warnings: none.
- Frames: 688.
- Dark frames: 688.
- All expected motion patterns are present.

## Adaptive Comparison

| candidate | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: |
| current-default | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v2 | 13.683 | 12 / 41 / 41 | 12 / 12 / 12 | 12 / 12 / 27 |
| adaptive v3 | 13.745 | 25 / 32 / 32 | 12 / 12 / 12 | 12 / 12 / 19 |

v3 controls slow motion like v2, but it does not recover v1's `linear-fast` win and it still misses the `short-jitter` p95 gate.

## Recommendation

Do not repeat v3 as-is.

Stop the v2/v3 threshold branch. If continuing adaptive work, return toward v1's fast-motion capture and add a more direct jitter exclusion instead of raising the fast threshold:

- use v1-like fast eligibility for `linear-fast`;
- exclude explicit small-oscillation/jitter regimes by motion-pattern/regime detection;
- keep the slow-motion/startup guard from v2/v3.
