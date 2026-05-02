# Candidate lsq-velocity-72ms-horizon-cap8-confidence-fallback Run 001 Report

## Validity

`lsq-velocity-72ms-horizon-cap8-confidence-fallback` run 001 is valid.

- Quality warnings: none.
- Frames: 922.
- Dark frames: 922.
- All expected motion patterns are present.

## Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v8 fast-priority latch | 1 | 14.281 | 28 / 40 / 40 | 10 / 12 / 12 | 12 / 12 / 12 |
| adaptive v9 fast-first bypass | 2 | 19.881 | 17 / 41 / 41 | 12 / 12 / 12 | 12 / 12 / 539 |
| LSQ 72ms cap8 confidence fallback | 1 | 12.692 | 12 / 25 / 25 | 12 / 12 / 12 | 12 / 12 / 12 |

## Tail Inspection

| pattern | frames | frames >18 px | frames >30 px | notes |
| --- | ---: | ---: | ---: | --- |
| linear-fast | 62 | 2 | 0 | high frames: `23 px`, `25 px` |
| short-jitter | 64 | 0 | 0 | no high-tail frames |
| linear-slow | 159 | 0 | 0 | startup outlier eliminated |

## Read

The LSQ candidate is the best single-run score so far at `12.692 px`.

It reduced the `linear-fast` tail substantially versus baseline, v8, and v9 aggregate. The tail is not as clean as adaptive v1's `18 px` max, but LSQ has only two `linear-fast` frames above `18 px` and none above `30 px`.

It did not improve `short-jitter` p95 to baseline `11 px`; it matches adaptive v1 and v9 aggregate at `12 / 12 / 12`. It also did not create any `short-jitter` high-tail frames.

It fixed `linear-slow` in this run: `12 / 12 / 12`, with no frames above `18 px`.

## Recommendation

Continue the LSQ model family, but repeat before tuning.

Next exact measurement candidate: `lsq-velocity-72ms-horizon-cap8-confidence-fallback` run 002.

Decision rule:

- Continue/tune LSQ if run 002 keeps weighted score near `13 px`, `linear-fast` max below `30 px`, `linear-slow` max below `30 px`, and `short-jitter` max at `12 px`.
- If run 002 repeats a `linear-slow` startup outlier or `linear-fast` max above `30 px`, stop this LSQ configuration and try a more conservative acceleration-limited predictor.
- If run 002 is stable, the next tuning candidate should target jitter only, for example `lsq-velocity-72ms-horizon-cap8-confidence-fallback-jitter-span320`, lowering the jitter fallback span from `380 px` to `320 px` while leaving the LSQ window and horizon cap unchanged.
