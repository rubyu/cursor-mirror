# Candidate lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback-jitter-span320 Run 001 Report

## Validity

`lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback-jitter-span320` run 001 is valid.

- Quality warnings: none.
- Frames: 917.
- Dark frames: 917.
- All expected motion patterns are present.

## Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| LSQ 72ms cap8 coldstart reset, span380 | 2 | 12.229 | 12 / 16 / 17 | 12 / 12 / 12 | 12 / 12 / 12 |
| LSQ 72ms cap8 coldstart reset, span320 | 1 | 18.224 | 12 / 16 / 16 | 12 / 12 / 12 | 12 / 12 / 539 |

## Tail Inspection

| pattern | frames | frames >12 px | frames >18 px | frames >30 px | notes |
| --- | ---: | ---: | ---: | ---: | --- |
| linear-fast | 61 | 1 | 0 | 0 | high frame: `16 px` |
| short-jitter | 63 | 0 | 0 | 0 | no high-tail frames |
| linear-slow | 156 | 1 | 1 | 1 | startup outlier: `539 px` |

## Read

The span320 jitter tune did not improve `short-jitter`. It stayed at `12 / 12 / 12`, the same as the span380 coldstart-reset aggregate.

`linear-fast` stayed clean at `12 / 16 / 16`, so the LSQ fast-motion behavior remains good.

`linear-slow` regressed badly: the `539 px` startup outlier returned, driving the weighted score to `18.224 px`.

## Recommendation

Drop span320 and revert to the span380 coldstart-reset LSQ.

Do not try another jitter span value yet. The first narrower span produced no jitter p95 improvement and broke the slow-start stability that made coldstart-reset LSQ the best model.

Next exact candidate: `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` run 003, using the original jitter span `380 px`, as a final stability confirmation before promotion.
