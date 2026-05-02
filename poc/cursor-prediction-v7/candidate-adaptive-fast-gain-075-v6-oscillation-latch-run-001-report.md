# Candidate adaptive-fast-gain-075-v6-oscillation-latch Run 001 Report

## Validity

`adaptive-fast-gain-075-v6-oscillation-latch` run 001 is valid.

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
| adaptive v6 latch | 15.825 | 36 / 59 / 59 | 12 / 12 / 12 | 12 / 12 / 12 |

## Read

The oscillation latch helped one thing clearly: `linear-slow` is clean at `12 / 12 / 12`, the best slow-motion result so far.

It did not help the actual jitter gate: `short-jitter` remains `12 / 12 / 12` instead of baseline `11 / 12 / 12`.

It also damaged the main fast-motion target: `linear-fast` is worse than baseline, at `36 / 59 / 59`.

## Recommendation

Do not repeat v6 as-is.

Next candidate: `adaptive-fast-gain-075-v7-span-gated-latch`.

Parameters:

- Keep v1 fast eligibility for applying 75% gain.
- Keep v6 slow/startup guard.
- Oscillation bypass applies only when recent dominant-axis span is `<= 450 px`.
- Require `>= 2` direction reversals in `250 ms`.
- Require path efficiency `<= 0.55`.
- Latch bypass for `300 ms`.
- Do not let the oscillation latch suppress adaptive gain when recent span is `> 900 px` or net displacement is `> 700 px`.

Goal: preserve v1 `linear-fast` near `12 / 18 / 18`, keep v6 `linear-slow` cleanup, and finally restore `short-jitter` p95 to `11`.
