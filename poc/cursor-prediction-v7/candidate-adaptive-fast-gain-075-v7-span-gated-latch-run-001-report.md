# Candidate adaptive-fast-gain-075-v7-span-gated-latch Run 001 Report

## Validity

`adaptive-fast-gain-075-v7-span-gated-latch` run 001 is valid.

- Quality warnings: none.
- Frames: 621.
- Dark frames: 621.
- All expected motion patterns are present.

## Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v6 oscillation latch | 1 | 15.825 | 36 / 59 / 59 | 12 / 12 / 12 | 12 / 12 / 12 |
| adaptive v7 span-gated latch | 1 | 13.681 | 21 / 32 / 32 | 12 / 12 / 12 | 12 / 12 / 12 |

## Read

v7 recovered most of the v6 `linear-fast` regression, improving from `36 / 59 / 59` to `21 / 32 / 32`, but it did not recover v1's fast-motion target of `12 / 18 / 18`.

v7 preserved the v6 `linear-slow` cleanup at `12 / 12 / 12`.

v7 did not improve `short-jitter`; it remains `12 / 12 / 12`, still missing baseline p95 by `+1 px`.

The weighted score is the best adaptive-family score so far, essentially tied with v2, but it is not product-ready because `linear-fast` is still worse than v1 and `short-jitter` is unchanged.

## Recommendation

Next candidate: `adaptive-fast-gain-075-v8-fast-priority-span-gated-latch`.

Base it on v7, but add a fast-linear priority override before the oscillation latch:

- Apply 75% fast gain when `expectedVelocityPixelsPerSecond >= 2400`.
- Require `0` direction reversals in the last `180 ms`.
- Require path efficiency over the last `160 ms` to be `>= 0.85`.
- Require either dominant-axis span `>= 650 px` or net displacement `>= 500 px`.
- Allow this override after `80 ms` of stable direction, even before the `> 900 px` span escape is reached.

Keep the v6/v7 slow-startup guard, but tighten the oscillation bypass:

- Bypass adaptive gain only when dominant-axis span `<= 380 px`.
- Require net displacement `<= 260 px`.
- Require `>= 2` direction reversals in `300 ms`.
- Require path efficiency `<= 0.55`.
- Latch bypass for `360 ms`.

Goal: preserve v7 `linear-slow` at `12 / 12 / 12`, recover `linear-fast` toward v1 `12 / 18 / 18`, and test whether a narrower small-span oscillation detector can move `short-jitter` p95 back to `11`.
