# Candidate lsq-velocity-72ms-horizon-cap8-confidence-fallback Runs 001-002 Report

## Validity

`lsq-velocity-72ms-horizon-cap8-confidence-fallback` runs 001-002 are valid.

- Quality warnings: none.
- Run 001 frames/dark frames: 922 / 922.
- Run 002 frames/dark frames: 925 / 925.
- All expected motion patterns are present in both runs.

## Aggregate Comparison

| candidate | runs | weighted score | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-default | 3 | 19.769 | 12 / 44 / 47 | 11 / 12 / 12 | 12 / 12 / 539 |
| adaptive v1 | 1 | 18.411 | 12 / 18 / 18 | 12 / 12 / 12 | 12 / 15 / 539 |
| adaptive v8 fast-priority latch | 1 | 14.281 | 28 / 40 / 40 | 10 / 12 / 12 | 12 / 12 / 12 |
| adaptive v9 fast-first bypass | 2 | 19.881 | 17 / 41 / 41 | 12 / 12 / 12 | 12 / 12 / 539 |
| LSQ 72ms cap8 confidence fallback | 2 | 18.783 | 12 / 25 / 30 | 12 / 12 / 12 | 12 / 12 / 539 |

## LSQ Per-Run Stability

| run | linear-fast p95/p99/max | linear-fast frames >18 px | linear-fast frames >30 px | short-jitter p95/p99/max | linear-slow p95/p99/max | linear-slow frames >30 px |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 001 | 12 / 25 / 25 | 2 / 62 | 0 / 62 | 12 / 12 / 12 | 12 / 12 / 12 | 0 / 159 |
| 002 | 12 / 30 / 30 | 1 / 63 | 0 / 63 | 12 / 12 / 12 | 12 / 12 / 539 | 1 / 159 |

## Read

`linear-fast` is the strongest LSQ signal. The aggregate max stayed at `30 px`, meeting the run-002 stop threshold, and no `linear-fast` frame exceeded `30 px` in either run.

`short-jitter` stayed bounded at `12 / 12 / 12` in both runs. LSQ did not recover baseline p95 `11 px`, but it did not create any high-tail jitter frames.

`linear-slow` did not stay clean. Run 002 reintroduced one startup outlier at `539 px`, giving the aggregate `12 / 12 / 539`.

The LSQ family should continue, but this exact configuration should not be promoted because the slow-startup outlier is reproducible across families when stale predictor state leaks into the first slow sample.

## Recommendation

Next exact candidate: `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback`.

Base it on the current LSQ implementation, with these runtime-feasible changes using only cursor position/timestamp/DWM timing:

- Reset LSQ history when the newest cursor sample gap is `> 48 ms`.
- Reset LSQ history when instantaneous sample speed is `> 6000 px/s` or one-sample displacement is `> 240 px`.
- After reset, disable prediction until there are at least `6` fresh samples spanning at least `64 ms`.
- During the first `120 ms` after reset, cap prediction horizon to `2 ms`.
- If fitted speed is `< 450 px/s` or recent net displacement is `< 32 px`, cap prediction horizon to `2 ms`.
- Keep the `72 ms` LSQ window, `8 ms` normal horizon cap, existing confidence fallback, and existing jitter fallback.

Expected effect: preserve the stable `linear-fast` max `<= 30 px`, keep `short-jitter` bounded, and remove the run-002 `linear-slow` startup outlier by preventing stale velocity from being used during cold-start/transition frames.
