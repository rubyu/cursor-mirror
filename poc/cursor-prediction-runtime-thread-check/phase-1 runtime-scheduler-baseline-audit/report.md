# Phase 1 - Runtime Scheduler Baseline Audit

## Purpose

This phase audits `cursor-mirror-trace-20260501-231621.zip`, the first trace with `runtimeSchedulerPoll`, and replays the current product-shaped DWM predictor on that stream.

## Data Shape

| Metric | Value |
| --- | --- |
| trace format | 4 |
| runtimeSchedulerPoll rows | 8,514 |
| referencePoll rows | 71,476 |
| legacy poll rows | 9,074 |
| scored runtime contexts | 8,514 |
| DWM availability | 100.0% |

## Runtime Cadence

| Metric | mean | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| runtime interval ms | 16.789 | 16.529 | 18.447 | 21.872 | 51.259 |
| scheduler lead us | 1,155.947 | 1,360.000 | 1,883.000 | 1,932.000 | 1,961.000 |
| actual minus planned us | 844.054 | 640.200 | 1,990.975 | 3,342.572 | 9,244.700 |
| reference target interval ms | 2.003 | 2.000 | 2.000 | 2.000 | 5.413 |

Late scheduler dispatches, where the UI-thread capture landed after the scheduler's intended target vblank, occurred in `388` runtime samples. The product predictor target was recomputed like the application does, so late dispatches generally target the following vblank instead of the already-missed one.

## Baseline Replay

| Model | n | mean | p50 | p90 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| runtime baseline gain 0.75 | 8,514 | 1.428 | 0.008 | 2.716 | 6.410 | 22.973 | 139.855 |
| hold current | 8,514 | 1.404 | 0.000 | 1.000 | 5.000 | 31.849 | 265.062 |

## Notes

- The runtime scheduler stream materially improves the center and tail versus the v4 legacy product-poll baseline.
- The remaining tail is concentrated in late-dispatch and high-speed/high-acceleration slices, so the next phase focuses on conservative deterministic adjustments around gain and effective horizon.
