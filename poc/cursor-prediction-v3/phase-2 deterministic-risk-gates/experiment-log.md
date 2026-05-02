# Phase 2 Experiment Log

## Scope

All work is contained in this phase directory. The root trace ZIPs and Phase 1 artifacts were read as inputs only.

## Baseline Formula

For each poll anchor with valid DWM timing, select the next DWM vblank, advancing stale vblank ticks by refresh periods. The product baseline predicts:

`prediction = round_half_away_from_zero(current + (current - previous) * 0.75 * horizonTicks / deltaTicks)`

Invalid timing, nonpositive deltas, and gaps over 100 ms fall back to hold/current. Ground truth is linear timestamp interpolation over the merged recorded position stream. Hook/poll disagreement is measured by interpolating hook move rows at the poll timestamp.

## Reproduced Phase 1 Baselines

### `cursor-mirror-trace-20260501-000443`

- Schema: `{"move":15214}`
- Move interval: count 15213, mean 32.885, p50 8.013, p90 16.092, p95 71.949, p99 496.177, max 15448.841 ms
- `compat_fixed_4ms`: count 15213, mean 2.084, p50 0.877, p90 4.484, p95 8.218, p99 21.100, max 264.362 px
- `compat_fixed_8ms`: count 15213, mean 4.022, p50 1.416, p90 8.707, p95 16.273, p99 42.050, max 500.264 px
- `compat_fixed_12ms`: count 15213, mean 6.128, p50 2.102, p90 13.762, p95 25.336, p99 65.185, max 766.845 px
- `compat_fixed_16ms`: count 15213, mean 8.423, p50 2.909, p90 19.141, p95 35.342, p99 88.526, max 1034.082 px

### `cursor-mirror-trace-20260501-091537`

- Schema: `{"move":57704,"poll":160442}`
- Poll interval: count 160441, mean 15.733, p50 15.684, p90 20.890, p95 23.212, p99 28.089, max 70.593 ms
- Move interval: count 57703, mean 43.742, p50 8.008, p90 24.064, p95 96.158, p99 712.076, max 46720.644 ms
- `product_poll_dwm_next_vblank`: count 160440, mean 1.348, p50 0.000, p90 1.741, p95 5.258, p99 26.993, max 537.956 px

## Candidate Formulas

- Gain grids multiply the last2 velocity term by a lower gain in high-speed and/or high-acceleration regimes.
- Horizon clamps keep the gain unchanged but reduce the effective lookahead used by the velocity term.
- Hook/poll gates reduce gain or horizon when interpolated hook position and poll position disagree by 2 px or 5 px.
- Poll gates use observed poll interval and configured-interval jitter. They are included because Phase 1 showed the configured 8 ms interval was effectively closer to 16 ms.
- Stop candidates reduce gain during the first 250 ms after a speed collapse from at least 100 px/s to below 20 px/s.
- Alpha-beta and alpha-beta-gamma filters keep O(1) state over the poll stream and predict from their filtered position/velocity/acceleration state to the DWM target. Velocity is clamped to 5000 px/s and acceleration to 250000 px/s^2.
- Combination candidates were restricted to the best-supported deterministic signals from Phase 1: motion regime plus hook/poll disagreement, with an optional horizon cap.

## Candidate Results

### `baseline_product`

Phase 1 product baseline: gain 0.75 and full DWM horizon.

Parameters: `{"gain":0.75}`

- `baseline_product`: mean 1.348, p95 5.258, p99 26.993, high-speed p95/p99 79.869/147.833, high-accel p95/p99 90.351/180.243, disagreement p95/p99 73.659/148.821, low-speed p95 0.298, regressions >1/>3/>5 0/0/0

Stop-settle: count 27009, mean 3.111, p50 0.000, p90 6.082, p95 13.975, p99 58.540, max 537.956 px
Low-speed regressions >1/>3/>5: 0/0/0

### `gain_speed_light`

Speed-only gain grid with conservative damping above 700 px/s.

Parameters: `{"gains":{"300+":0.7,"700+":0.6,"1200+":0.45}}`

- `gain_speed_light`: mean 1.609, p95 6.110, p99 33.103, high-speed p95/p99 100.451/188.879, high-accel p95/p99 115.198/210.674, disagreement p95/p99 91.746/182.704, low-speed p95 0.298, regressions >1/>3/>5 5751/3734/2735

Stop-settle: count 27009, mean 3.713, p50 0.000, p90 7.065, p95 16.865, p99 72.532, max 553.319 px
Low-speed regressions >1/>3/>5: 0/0/0

### `gain_speed_strong`

Speed-only gain grid with strong high-speed damping.

Parameters: `{"gains":{"300+":0.6,"700+":0.45,"1200+":0.3}}`

- `gain_speed_strong`: mean 1.788, p95 6.842, p99 37.350, high-speed p95/p99 113.968/214.176, high-accel p95/p99 128.084/237.071, disagreement p95/p99 103.282/201.556, low-speed p95 0.298, regressions >1/>3/>5 7441/5039/3726

Stop-settle: count 27009, mean 4.122, p50 0.000, p90 7.813, p95 19.222, p99 80.729, max 573.664 px
Low-speed regressions >1/>3/>5: 0/0/0

### `gain_accel_light`

Acceleration-only gain grid.

Parameters: `{"gains":{"5k+":0.65,"20k+":0.5,"60k+":0.35}}`

- `gain_accel_light`: mean 1.646, p95 6.129, p99 33.725, high-speed p95/p99 105.902/201.135, high-accel p95/p99 124.967/229.656, disagreement p95/p99 95.660/190.994, low-speed p95 0.298, regressions >1/>3/>5 5954/3507/2485

Stop-settle: count 27009, mean 3.833, p50 0.000, p90 7.116, p95 17.217, p99 74.703, max 566.593 px
Low-speed regressions >1/>3/>5: 0/0/0

### `gain_speed_accel_min`

Use the smaller of the speed and acceleration gain grids.

Parameters: `{"speed_gains":{"300+":0.65,"700+":0.5,"1200+":0.35},"accel_gains":{"5k+":0.65,"20k+":0.5,"60k+":0.35}}`

- `gain_speed_accel_min`: mean 1.732, p95 6.694, p99 35.914, high-speed p95/p99 109.757/207.230, high-accel p95/p99 124.967/229.656, disagreement p95/p99 99.269/195.769, low-speed p95 0.298, regressions >1/>3/>5 7359/4683/3448

Stop-settle: count 27009, mean 3.995, p50 0.000, p90 7.709, p95 18.541, p99 77.353, max 566.593 px
Low-speed regressions >1/>3/>5: 0/0/0

### `horizon_speed_cap`

Cap DWM horizon under high speed.

Parameters: `{"caps_ms":{"700+":8,"1200+":4}}`

- `horizon_speed_cap`: mean 1.754, p95 6.139, p99 36.693, high-speed p95/p99 114.882/220.855, high-accel p95/p99 131.158/247.631, disagreement p95/p99 104.201/210.344, low-speed p95 0.298, regressions >1/>3/>5 4843/3992/3202

Stop-settle: count 27009, mean 4.056, p50 0.000, p90 7.034, p95 18.404, p99 81.324, max 570.688 px
Low-speed regressions >1/>3/>5: 0/0/0

### `horizon_accel_cap`

Cap DWM horizon under high acceleration.

Parameters: `{"caps_ms":{"20k+":8,"60k+":4}}`

- `horizon_accel_cap`: mean 1.645, p95 5.769, p99 33.529, high-speed p95/p99 110.418/217.986, high-accel p95/p99 131.158/247.631, disagreement p95/p99 100.488/206.385, low-speed p95 0.298, regressions >1/>3/>5 3649/2759/2163

Stop-settle: count 27009, mean 3.854, p50 0.000, p90 6.708, p95 16.775, p99 76.259, max 570.688 px
Low-speed regressions >1/>3/>5: 0/0/0

### `horizon_speed_scale`

Scale the effective horizon down as speed rises.

Parameters: `{"scales":{"300+":0.8,"700+":0.6,"1200+":0.35}}`

- `horizon_speed_scale`: mean 1.829, p95 6.946, p99 38.339, high-speed p95/p99 116.789/219.654, high-accel p95/p99 132.361/242.647, disagreement p95/p99 106.438/206.199, low-speed p95 0.298, regressions >1/>3/>5 7515/5191/3885

Stop-settle: count 27009, mean 4.218, p50 0.000, p90 8.000, p95 19.683, p99 82.806, max 578.750 px
Low-speed regressions >1/>3/>5: 0/0/0

### `disagreement_hold_5px`

Hold/current when hook/poll disagreement is at least 5 px.

Parameters: `{"hold_threshold_px":5}`

- `disagreement_hold_5px`: mean 2.062, p95 6.031, p99 46.870, high-speed p95/p99 139.685/261.970, high-accel p95/p99 157.342/289.742, disagreement p95/p99 127.084/247.695, low-speed p95 0.298, regressions >1/>3/>5 5477/4842/4205

Stop-settle: count 27009, mean 4.794, p50 0.000, p90 7.241, p95 23.543, p99 98.334, max 614.363 px
Low-speed regressions >1/>3/>5: 0/0/0

### `disagreement_gain_grid`

Reduce gain when hook/poll disagreement indicates stale or split streams.

Parameters: `{"gains":{"2px+":0.45,"5px+":0.15}}`

- `disagreement_gain_grid`: mean 1.949, p95 7.039, p99 42.052, high-speed p95/p99 126.554/235.493, high-accel p95/p99 143.545/267.049, disagreement p95/p99 115.566/220.663, low-speed p95 0.298, regressions >1/>3/>5 7852/5322/4166

Stop-settle: count 27009, mean 4.501, p50 0.000, p90 8.125, p95 21.544, p99 90.323, max 594.012 px
Low-speed regressions >1/>3/>5: 0/0/0

### `disagreement_horizon_cap`

Cap horizon when hook/poll disagreement exceeds 5 px.

Parameters: `{"caps_ms":{"5px+":4}}`

- `disagreement_horizon_cap`: mean 1.739, p95 5.749, p99 37.105, high-speed p95/p99 114.882/220.855, high-accel p95/p99 131.158/247.631, disagreement p95/p99 104.201/210.344, low-speed p95 0.298, regressions >1/>3/>5 3999/3369/2796

Stop-settle: count 27009, mean 4.037, p50 0.000, p90 6.706, p95 18.636, p99 81.517, max 570.688 px
Low-speed regressions >1/>3/>5: 0/0/0

### `poll_interval_cap`

Cap horizon when observed poll cadence slips.

Parameters: `{"caps_ms":{"18ms+":8,"24ms+":4}}`

- `poll_interval_cap`: mean 1.413, p95 5.443, p99 28.189, high-speed p95/p99 84.832/161.372, high-accel p95/p99 99.360/193.068, disagreement p95/p99 79.051/160.287, low-speed p95 0.298, regressions >1/>3/>5 1514/838/549

Stop-settle: count 27009, mean 3.271, p50 0.000, p90 6.299, p95 14.818, p99 60.792, max 537.956 px
Low-speed regressions >1/>3/>5: 0/0/0

### `poll_jitter_gain`

Reduce gain when observed cadence diverges from the configured 8 ms interval.

Parameters: `{"gains":{"8ms_jitter+":0.6,"16ms_jitter+":0.45}}`

- `poll_jitter_gain`: mean 1.415, p95 5.567, p99 28.221, high-speed p95/p99 84.837/156.489, high-accel p95/p99 97.725/186.070, disagreement p95/p99 79.139/156.059, low-speed p95 0.298, regressions >1/>3/>5 2604/1026/579

Stop-settle: count 27009, mean 3.271, p50 0.000, p90 6.363, p95 14.632, p99 61.675, max 537.956 px
Low-speed regressions >1/>3/>5: 0/0/0

### `stop_entry_hold_33ms`

Hold/current for the first 33 ms after stop entry.

Parameters: `{"hold_stop_settle_ms":33}`

- `stop_entry_hold_33ms`: mean 1.387, p95 5.385, p99 27.857, high-speed p95/p99 82.194/157.810, high-accel p95/p99 94.356/187.437, disagreement p95/p99 74.907/157.215, low-speed p95 0.298, regressions >1/>3/>5 501/329/247

Stop-settle: count 27009, mean 3.342, p50 0.000, p90 6.461, p95 15.192, p99 60.916, max 537.956 px
Low-speed regressions >1/>3/>5: 0/0/0

### `stop_settle_decay`

Gradually restore gain during the first 250 ms after stop entry.

Parameters: `{"gains":{"0-16":0,"16-33":0.15,"33-67":0.35,"67-133":0.55,"133-250":0.65}}`

- `stop_settle_decay`: mean 1.430, p95 5.607, p99 28.731, high-speed p95/p99 85.369/162.205, high-accel p95/p99 100.791/190.708, disagreement p95/p99 78.605/160.814, low-speed p95 0.298, regressions >1/>3/>5 2304/1031/662

Stop-settle: count 27009, mean 3.602, p50 0.000, p90 7.071, p95 16.462, p99 67.265, max 537.956 px
Low-speed regressions >1/>3/>5: 0/0/0

### `combo_speed_accel_disagreement`

Combine strongest single-factor tail gates: motion gain grid plus hook/poll disagreement gain.

Parameters: `{"speed_gains":{"300+":0.65,"700+":0.5,"1200+":0.35},"accel_gains":{"5k+":0.65,"20k+":0.5,"60k+":0.35},"disagreement_gains":{"2px+":0.45,"5px+":0.15}}`

- `combo_speed_accel_disagreement`: mean 1.957, p95 7.157, p99 41.686, high-speed p95/p99 126.554/235.493, high-accel p95/p99 143.545/267.049, disagreement p95/p99 115.566/220.663, low-speed p95 0.298, regressions >1/>3/>5 8773/5696/4446

Stop-settle: count 27009, mean 4.516, p50 0.000, p90 8.288, p95 21.549, p99 89.945, max 594.012 px
Low-speed regressions >1/>3/>5: 0/0/0

### `combo_motion_horizon_disagreement`

Combine motion gain grid, high-risk horizon caps, and hook/poll disagreement gain.

Parameters: `{"speed_gains":{"300+":0.65,"700+":0.5,"1200+":0.35},"accel_gains":{"5k+":0.65,"20k+":0.5,"60k+":0.35},"caps_ms":{"speed1200+":4,"accel60k+":4,"disagreement5px+":4},"disagreement_gains":{"2px+":0.45,"5px+":0.15}}`

- `combo_motion_horizon_disagreement`: mean 2.081, p95 7.586, p99 44.625, high-speed p95/p99 135.337/254.297, high-accel p95/p99 151.194/281.833, disagreement p95/p99 122.188/237.442, low-speed p95 0.298, regressions >1/>3/>5 8960/6101/4899

Stop-settle: count 27009, mean 4.801, p50 0.000, p90 8.878, p95 23.250, p99 94.775, max 605.178 px
Low-speed regressions >1/>3/>5: 0/0/0

### `alpha_beta_085_020`

Alpha-beta filter with alpha 0.85 and beta 0.2.

Parameters: `{"alpha":0.85,"beta":0.2}`

- `alpha_beta_085_020`: mean 2.290, p95 10.226, p99 42.137, high-speed p95/p99 120.910/237.109, high-accel p95/p99 137.560/266.272, disagreement p95/p99 107.276/218.853, low-speed p95 1.451, regressions >1/>3/>5 18647/11276/7797

Stop-settle: count 27009, mean 5.740, p50 1.000, p90 12.784, p95 24.619, p99 83.592, max 605.179 px
Low-speed regressions >1/>3/>5: 5958/3192/2023

### `alpha_beta_070_120`

Alpha-beta filter with alpha 0.7 and beta 0.12.

Parameters: `{"alpha":0.7,"beta":0.12}`

- `alpha_beta_070_120`: mean 3.207, p95 15.297, p99 57.884, high-speed p95/p99 152.225/300.194, high-accel p95/p99 173.849/320.940, disagreement p95/p99 134.184/268.021, low-speed p95 3.162, regressions >1/>3/>5 26261/17710/13225

Stop-settle: count 27009, mean 8.436, p50 1.512, p90 20.396, p95 36.376, p99 106.470, max 679.124 px
Low-speed regressions >1/>3/>5: 9554/5829/4029

### `alpha_beta_055_080`

Alpha-beta filter with alpha 0.55 and beta 0.08.

Parameters: `{"alpha":0.55,"beta":0.08}`

- `alpha_beta_055_080`: mean 4.493, p95 22.472, p99 78.703, high-speed p95/p99 193.439/385.039, high-accel p95/p99 218.653/405.760, disagreement p95/p99 175.194/337.189, low-speed p95 5.385, regressions >1/>3/>5 32713/23738/18671

Stop-settle: count 27009, mean 12.269, p50 2.828, p90 31.307, p95 54.173, p99 140.170, max 785.464 px
Low-speed regressions >1/>3/>5: 12854/8460/6245

### `alpha_beta_gamma_080_180_020`

Alpha-beta-gamma filter with alpha 0.8, beta 0.18, gamma 0.02.

Parameters: `{"alpha":0.8,"beta":0.18,"gamma":0.02}`

- `alpha_beta_gamma_080_180_020`: mean 4.543, p95 23.646, p99 83.635, high-speed p95/p99 128.353/238.972, high-accel p95/p99 144.009/267.775, disagreement p95/p99 117.442/219.332, low-speed p95 8.062, regressions >1/>3/>5 34795/24340/18809

Stop-settle: count 27009, mean 13.329, p50 3.162, p90 37.170, p95 65.736, p99 136.233, max 627.382 px
Low-speed regressions >1/>3/>5: 17419/11410/8486

### `alpha_beta_gamma_065_120_010`

Alpha-beta-gamma filter with alpha 0.65, beta 0.12, gamma 0.01.

Parameters: `{"alpha":0.65,"beta":0.12,"gamma":0.01}`

- `alpha_beta_gamma_065_120_010`: mean 7.104, p95 38.470, p99 125.107, high-speed p95/p99 166.277/303.289, high-accel p95/p99 185.505/320.512, disagreement p95/p99 154.560/276.760, low-speed p95 15.297, regressions >1/>3/>5 44445/32967/26532

Stop-settle: count 27009, mean 20.893, p50 5.099, p90 63.567, p95 104.974, p99 182.425, max 715.140 px
Low-speed regressions >1/>3/>5: 23509/16164/12431

## Rejected Options

- Alpha-beta and alpha-beta-gamma filters were rejected because smoothing introduced large low-speed and overall tail regressions on this trace.
- Poll interval/jitter gates were rejected because the signal was too broad: the common effective cadence already differs from configured 8 ms, so cadence gating catches too much normal behavior or too little tail behavior depending on threshold.
- Stop-only decay was rejected as a primary direction because stop windows are mixed with resumption/settle behavior; holding briefly helps some individual samples but worsens enough others that aggregate p99 regresses.
- Strong motion damping was rejected because it undershoots steady fast movement; on this trace it worsens high-speed and high-acceleration p95/p99 rather than improving them.