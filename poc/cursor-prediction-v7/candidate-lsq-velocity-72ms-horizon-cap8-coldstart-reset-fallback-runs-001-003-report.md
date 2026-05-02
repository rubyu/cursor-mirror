# Candidate lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback Runs 001-003 Report

## Validity

`lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` runs 001-003 are valid.

- Quality warnings: none.
- Run 001 frames/dark frames: 888 / 888.
- Run 002 frames/dark frames: 850 / 850.
- Run 003 frames/dark frames: 922 / 922.
- All expected motion patterns are present in all three runs.

## Aggregate Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| LSQ 72ms cap8 confidence fallback | 2 | 18.783 | 12 / 25 / 30 | 12 / 12 / 12 | 12 / 12 / 539 |
| LSQ coldstart reset, span320 | 1 | 18.224 | 12 / 16 / 16 | 12 / 12 / 12 | 12 / 12 / 539 |
| LSQ coldstart reset, span380 | 3 | 12.378 | 12 / 17 / 24 | 12 / 12 / 12 | 12 / 12 / 12 |

## Coldstart-Reset Per-Run Stability

| run | linear-fast p95/p99/max | linear-fast frames >18 px | short-jitter p95/p99/max | short-jitter frames >12 px | linear-slow p95/p99/max | linear-slow frames >18 px |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 001 | 12 / 17 / 17 | 0 / 59 | 12 / 12 / 12 | 0 / 51 | 12 / 12 / 12 | 0 / 157 |
| 002 | 12 / 16 / 16 | 0 / 56 | 12 / 12 / 12 | 0 / 54 | 12 / 12 / 12 | 0 / 155 |
| 003 | 12 / 24 / 24 | 1 / 61 | 12 / 12 / 12 | 0 / 63 | 12 / 12 / 12 | 0 / 162 |

## Read

Coldstart-reset LSQ span380 remains the best current POC v7 model after three runs.

`linear-fast` is stable enough for this POC: aggregate p95/p99/max is `12 / 17 / 24`, with only one frame above `18 px` across runs 001-003 and no frames above `30 px`. This is far better than baseline `12 / 44 / 47` and previous LSQ `12 / 25 / 30`.

`linear-slow` is the strongest result: all three runs are `12 / 12 / 12`, with no startup outlier and no frames above `18 px`.

`short-jitter` is bounded but not improved beyond `12 / 12 / 12`. It misses baseline p95 `11 px`, but it also has no frames above `12 px`.

The span320 jitter tune did not help jitter and reintroduced the slow-startup outlier, so the span380 configuration should remain the promoted LSQ candidate.

## Decision

Promote `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` as the current best POC v7 model.

Stop further POC v7 model-family search for now. Do not continue with another new family unless the product requirement explicitly prioritizes recovering the `short-jitter` p95 from `12 px` to `11 px` over preserving the clean `linear-fast` and `linear-slow` behavior.

Recommended next step: prepare a product integration plan for this LSQ coldstart-reset predictor, including runtime counters for resets, fallback reasons, fitted speed, and predicted horizon, then validate with a normal product-side measurement pass.
