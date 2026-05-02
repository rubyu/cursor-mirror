# Candidate lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback Runs 001-002 Report

## Validity

`lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` runs 001-002 are valid.

- Quality warnings: none.
- Run 001 frames/dark frames: 888 / 888.
- Run 002 frames/dark frames: 850 / 850.
- All expected motion patterns are present in both runs.

## Aggregate Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| LSQ 72ms cap8 confidence fallback | 2 | 18.783 | 12 / 25 / 30 | 12 / 12 / 12 | 12 / 12 / 539 |
| LSQ 72ms cap8 coldstart reset | 2 | 12.229 | 12 / 16 / 17 | 12 / 12 / 12 | 12 / 12 / 12 |

## Coldstart-Reset Per-Run Stability

| run | linear-fast p95/p99/max | linear-fast frames >18 px | short-jitter p95/p99/max | short-jitter frames >12 px | linear-slow p95/p99/max | linear-slow frames >18 px |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 001 | 12 / 17 / 17 | 0 / 59 | 12 / 12 / 12 | 0 / 51 | 12 / 12 / 12 | 0 / 157 |
| 002 | 12 / 16 / 16 | 0 / 56 | 12 / 12 / 12 | 0 / 54 | 12 / 12 / 12 | 0 / 155 |

## Read

Coldstart-reset LSQ is the best current POC v7 model.

The `linear-fast` tail is stable and better than adaptive v1: aggregate p95/p99/max is `12 / 16 / 17`, with no frames above `18 px` across runs 001-002.

The `linear-slow` startup outlier stayed fixed. Both runs are `12 / 12 / 12`, with no frames above `18 px`.

`short-jitter` is safe but not fully optimized. It stays bounded at `12 / 12 / 12`, with no frames above `12 px`, but still misses the baseline p95 of `11 px`.

## Recommendation

Promote `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` as the best current model family candidate.

Next exact candidate: `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback-jitter-span320`.

Change only the jitter fallback:

- Keep the 72ms LSQ window.
- Keep the 8ms normal horizon cap.
- Keep all coldstart reset rules.
- Keep the same confidence fallback.
- Narrow the jitter fallback dominant-axis span threshold from `380 px` to `320 px`.
- Keep the jitter reversal requirement and bypass duration unchanged.

Stop/tuning rule:

- Continue if `linear-fast` remains at or below `12 / 18 / 18`, `linear-slow` remains `12 / 12 / 12`, and `short-jitter` improves toward baseline p95 `11 px`.
- Drop the jitter tune immediately if it reintroduces `linear-fast` tail above `18 px` or any `linear-slow` startup outlier.
