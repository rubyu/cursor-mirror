# Candidate adaptive-fast-gain-075-v8-fast-priority-span-gated-latch Run 001 Report

## Validity

`adaptive-fast-gain-075-v8-fast-priority-span-gated-latch` run 001 is valid.

- Quality warnings: none.
- Frames: 538.
- Dark frames: 538.
- All expected motion patterns are present.

## Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v7 span-gated latch | 1 | 13.681 | 21 / 32 / 32 | 12 / 12 / 12 | 12 / 12 / 12 |
| adaptive v8 fast-priority latch | 1 | 14.281 | 28 / 40 / 40 | 10 / 12 / 12 | 12 / 12 / 12 |

## Read

v8 did not recover `linear-fast`. It regressed from v7 `21 / 32 / 32` to `28 / 40 / 40`, and remains far from v1 `12 / 18 / 18`.

v8 did improve `short-jitter`: p95 moved from `12 px` to `10 px`, now better than the baseline p95 of `11 px`.

v8 preserved the v7/v6 `linear-slow` cleanup at `12 / 12 / 12`.

The branch is still useful because v8 proves the narrow oscillation bypass can help jitter, but the fast-priority override is still too late or too narrow for early `linear-fast`.

## Recommendation

Run one more targeted candidate, then stop this branch if fast motion does not recover.

Next candidate: `adaptive-fast-gain-075-v9-fast-first-jitter-only-bypass`.

Base it on v8, but make the fast-linear path win before slow/startup guard and before any oscillation latch:

- Fast-linear override applies 75% gain when `expectedVelocityPixelsPerSecond >= 2400`.
- Require `0` direction reversals in the last `140 ms`.
- Require stable dominant-axis direction for `64 ms`.
- Require path efficiency `>= 0.75` over the last `120 ms`.
- Require dominant-axis net displacement `>= 360 px` or span `>= 420 px`.
- When fast-linear override is true, ignore oscillation latch and slow/startup guard for that sample.

Keep the v8 jitter bypass:

- Bypass adaptive gain when span `<= 380 px`.
- Require net displacement `<= 260 px`.
- Require `>= 2` direction reversals in `300 ms`.
- Require path efficiency `<= 0.55`.
- Latch bypass for `360 ms`.

Goal: keep v8 `short-jitter` near `10 / 12 / 12`, keep `linear-slow` at `12 / 12 / 12`, and recover `linear-fast` toward v1 `12 / 18 / 18`.
