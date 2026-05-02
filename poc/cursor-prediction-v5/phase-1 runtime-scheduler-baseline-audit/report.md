# Phase 1 - Runtime Scheduler Baseline Audit

## Purpose

This phase audits `cursor-mirror-trace-20260501-231621.zip`, the first trace with `runtimeSchedulerPoll`, and replays the current product-shaped DWM predictor on that stream.

## Data Shape

| Metric | Value |
| --- | --- |
| trace format | 4 |
| runtimeSchedulerPoll rows | 55,621 |
| referencePoll rows | 539,058 |
| legacy poll rows | 68,478 |
| scored runtime contexts | 55,621 |
| DWM availability | 100.0% |

## Runtime Cadence

| Metric | mean | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| runtime interval ms | 21.334 | 16.601 | 33.725 | 218.586 | 1,281.598 |
| scheduler lead us | -132.922 | 1,293.000 | 1,868.000 | 1,930.000 | 1,974.000 |
| actual minus planned us | 2,132.922 | 707.000 | 13,675.800 | 24,364.240 | 91,565.500 |
| reference target interval ms | 2.193 | 2.000 | 2.001 | 3.148 | 1,260.000 |

Late scheduler dispatches, where the UI-thread capture landed after the scheduler's intended target vblank, occurred in `7,535` runtime samples. The product predictor target was recomputed like the application does, so late dispatches generally target the following vblank instead of the already-missed one.

## Baseline Replay

| Model | n | mean | p50 | p90 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| runtime baseline gain 0.75 | 55,621 | 1.707 | 0.000 | 1.691 | 5.165 | 31.061 | 892.338 |
| hold current | 55,621 | 1.573 | 0.000 | 0.349 | 3.211 | 34.514 | 917.401 |

## Notes

- The runtime scheduler stream materially improves the center and tail versus the v4 legacy product-poll baseline.
- The remaining tail is concentrated in late-dispatch and high-speed/high-acceleration slices, so the next phase focuses on conservative deterministic adjustments around gain and effective horizon.
