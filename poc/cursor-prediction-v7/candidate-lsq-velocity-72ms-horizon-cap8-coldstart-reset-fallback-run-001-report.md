# Candidate lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback Run 001 Report

## Validity

`lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` run 001 is valid.

- Quality warnings: none.
- Frames: 888.
- Dark frames: 888.
- All expected motion patterns are present.

## Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| LSQ 72ms cap8 confidence fallback | 2 | 18.783 | 12 / 25 / 30 | 12 / 12 / 12 | 12 / 12 / 539 |
| LSQ 72ms cap8 coldstart reset | 1 | 12.266 | 12 / 17 / 17 | 12 / 12 / 12 | 12 / 12 / 12 |

## Tail Inspection

| pattern | frames | frames >12 px | frames >18 px | frames >30 px | notes |
| --- | ---: | ---: | ---: | ---: | --- |
| linear-fast | 59 | 2 | 0 | 0 | high frames: `17 px`, `14 px` |
| short-jitter | 51 | 0 | 0 | 0 | no high-tail frames |
| linear-slow | 157 | 0 | 0 | 0 | startup outlier eliminated |

## Read

The coldstart reset LSQ is the best single-run score so far at `12.266 px`.

`linear-fast` improved versus the previous LSQ aggregate and v1: p95/p99/max is `12 / 17 / 17`, with no frames above `18 px`.

`linear-slow` stayed clean at `12 / 12 / 12`; the prior LSQ run-002 `539 px` startup outlier did not appear.

`short-jitter` stayed bounded at `12 / 12 / 12`. It still does not recover baseline p95 `11 px`, but it has no frames above `12 px`.

## Recommendation

Next exact measurement candidate: repeat `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` as run 002.

Decision rule:

- If run 002 keeps `linear-fast` max `<= 18 px`, `linear-slow` max `<= 18 px`, and `short-jitter` max `12 px`, promote this as the best POC v7 model family candidate.
- If run 002 is stable, the next tuning candidate should be `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback-jitter-span320`, narrowing only the jitter fallback span while preserving the coldstart reset and LSQ window.
- If run 002 reintroduces a `linear-slow` startup outlier, keep the LSQ family but tighten reset gating before touching jitter.
