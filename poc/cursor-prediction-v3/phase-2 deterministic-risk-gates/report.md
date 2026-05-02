# Phase 2 Report

## Recommendation

No deterministic candidate cleared the decision rule. The product baseline remains best on overall p99, high-speed p95/p99, and high-acceleration p95/p99. The deterministic gates mostly undershoot normal fast motion or react too broadly to stale-stream signals, so they should not ship as the next product step.

## Strongest Findings

- Hook/poll disagreement remains the cleanest deterministic risk signal: baseline disagreement >=5 px has p95/p99 73.659/148.821 px.
- Motion damping is the wrong deterministic default for this trace: the light speed gate worsens high-speed p95 from 79.869 px to 100.451 px.
- Stateful alpha-beta filters are a poor fit for this trace without an oracle gate; their smoothing tails are worse than the product baseline.

Top deterministic p99 results:
- `stop_entry_hold_33ms`: mean 1.387, p95 5.385, p99 27.857, high-speed p95/p99 82.194/157.810, high-accel p95/p99 94.356/187.437, disagreement p95/p99 74.907/157.215, low-speed p95 0.298, regressions >1/>3/>5 501/329/247
- `poll_interval_cap`: mean 1.413, p95 5.443, p99 28.189, high-speed p95/p99 84.832/161.372, high-accel p95/p99 99.360/193.068, disagreement p95/p99 79.051/160.287, low-speed p95 0.298, regressions >1/>3/>5 1514/838/549
- `poll_jitter_gain`: mean 1.415, p95 5.567, p99 28.221, high-speed p95/p99 84.837/156.489, high-accel p95/p99 97.725/186.070, disagreement p95/p99 79.139/156.059, low-speed p95 0.298, regressions >1/>3/>5 2604/1026/579
- `stop_settle_decay`: mean 1.430, p95 5.607, p99 28.731, high-speed p95/p99 85.369/162.205, high-accel p95/p99 100.791/190.708, disagreement p95/p99 78.605/160.814, low-speed p95 0.298, regressions >1/>3/>5 2304/1031/662
- `gain_speed_light`: mean 1.609, p95 6.110, p99 33.103, high-speed p95/p99 100.451/188.879, high-accel p95/p99 115.198/210.674, disagreement p95/p99 91.746/182.704, low-speed p95 0.298, regressions >1/>3/>5 5751/3734/2735
- `horizon_accel_cap`: mean 1.645, p95 5.769, p99 33.529, high-speed p95/p99 110.418/217.986, high-accel p95/p99 131.158/247.631, disagreement p95/p99 100.488/206.385, low-speed p95 0.298, regressions >1/>3/>5 3649/2759/2163

## Phase 3 Direction

Move to a learned oracle/residual phase rather than shipping a fixed deterministic gate as the main predictor. Feed it speed, acceleration, previous speed, DWM horizon, observed poll interval, configured-interval jitter, hook/poll disagreement, stop-settle elapsed time, and recent error/regime labels when available. Keep the product baseline as fallback and let the learned stage decide whether to damp, hold, or trust extrapolation.

## Artifacts

- `run_phase2.mjs`: reproducible evaluator.
- `scores.json`: machine-readable candidate metrics.
- `experiment-log.md`: formulas, parameters, full candidate summaries, and rejected options.