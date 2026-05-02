# Phase 1 Experiment Log

## Scope

Replayed the two root trace ZIPs directly from disk. No application source, tests, specs, build scripts, or root trace ZIPs were modified.

## Baseline Reconstruction

- Product-supported v2 path: poll rows are anchors; target timestamp is the selected next DWM vblank; prediction is rounded `current + (current - previous) * 0.75 * horizonTicks / deltaTicks`.
- DWM selection follows the source predictor: missing timing is invalid; stale/late `QpcVBlank` is advanced by refresh periods; nonpositive or `> 1.25x` refresh-period horizons fall back to hold/current.
- Default idle reset is 100 ms; invalid dt or idle gaps fall back to hold/current.
- Older traces without DWM timing are evaluated as compatibility fixed-horizon slices at 4, 8, 12, and 16 ms with the same 0.75 gain.
- Ground truth is timestamp interpolation over the merged recorded position stream. For v2 hook/poll disagreement, hook position is separately interpolated from hook/move rows.

## Inferred Schemas

### `cursor-mirror-trace-20260501-000443`

- Header fields: `sequence, stopwatchTicks, elapsedMicroseconds, x, y, event`
- Metadata: `{"ProductName":"Cursor Mirror トレースツール","ProductVersion":"v1.2.0-dev+20260430.4f700b2c43b6.dirty","CreatedUtc":"2026-04-30T15:04:54.2148992Z","SampleCount":15214,"DurationMicroseconds":500631525,"StopwatchFrequency":"10000000"}`
- Event counts: `{"move":15214}`
- Poll rows: 0; move rows: 15214; DWM poll rows: 0
- Move interval stats: count 15213, mean 32.885, p50 8.013, p90 16.092, p95 71.949, p99 496.177, max 15448.841 ms

### `cursor-mirror-trace-20260501-091537`

- Header fields: `sequence, stopwatchTicks, elapsedMicroseconds, x, y, event, hookX, hookY, cursorX, cursorY, hookMouseData, hookFlags, hookTimeMilliseconds, hookExtraInfo, dwmTimingAvailable, dwmRateRefreshNumerator, dwmRateRefreshDenominator, dwmQpcRefreshPeriod, dwmQpcVBlank, dwmRefreshCount, dwmQpcCompose, dwmFrame, dwmRefreshFrame, dwmFrameDisplayed, dwmQpcFrameDisplayed, dwmRefreshFrameDisplayed, dwmFrameComplete, dwmQpcFrameComplete, dwmFramePending, dwmQpcFramePending, dwmRefreshNextDisplayed, dwmRefreshNextPresented, dwmFramesDisplayed, dwmFramesDropped, dwmFramesMissed`
- Metadata: `{"TraceFormatVersion":2,"ProductName":"Cursor Mirror トレースツール","ProductVersion":"v1.2.0-dev+20260430.64acccfdb4fe.dirty","CreatedUtc":"2026-05-01T00:15:42.9280668Z","SampleCount":218146,"HookSampleCount":57704,"PollSampleCount":160442,"DwmTimingSampleCount":160442,"PollIntervalMilliseconds":8,"DurationMicroseconds":2524306478,"StopwatchFrequency":"10000000"}`
- Event counts: `{"move":57704,"poll":160442}`
- Poll rows: 160442; move rows: 57704; DWM poll rows: 160442
- Poll interval stats: count 160441, mean 15.733, p50 15.684, p90 20.890, p95 23.212, p99 28.089, max 70.593 ms
- Move interval stats: count 57703, mean 43.742, p50 8.008, p90 24.064, p95 96.158, p99 712.076, max 46720.644 ms

## Scenario Results

### `cursor-mirror-trace-20260501-000443` / `compat_fixed_4ms`

- Mode: `fixed_horizon`; fixed horizon: `4`; gain: `0.75`
- Anchors: 15214; evaluated: 15213; target misses: 1
- Status counts: `{"invalid_dt_or_idle_gap_fallback":656,"valid":14556,"warmup_hold":1}`
- Overall: count 15213, mean 2.084, p50 0.877, p90 4.484, p95 8.218, p99 21.100, max 264.362 px

Speed bins:
- `1200+`: count 4107, mean 5.174, p50 2.853, p90 11.890, p95 17.496, p99 31.749, max 264.362
- `700-1200`: count 1682, mean 1.600, p50 1.226, p90 3.012, p95 3.734, p99 6.274, max 74.548
- `300-700`: count 2831, mean 1.134, p50 0.844, p90 2.000, p95 2.500, p99 4.186, max 81.749
- `20-100`: count 1015, mean 0.580, p50 0.245, p90 0.743, p95 2.085, p99 9.539, max 14.062
- `0-20`: count 1309, mean 0.547, p50 0.444, p90 1.153, p95 2.015, p99 4.051, max 6.491
- `100-300`: count 4268, mean 0.761, p50 0.502, p90 1.120, p95 1.488, p99 3.416, max 38.413
- `unknown`: count 1, mean 1.123, p50 1.123, p90 1.123, p95 1.123, p99 1.123, max 1.123

Acceleration bins:
- `60k+`: count 2718, mean 6.017, p50 3.174, p90 13.778, p95 20.547, p99 39.602, max 264.362
- `20k-60k`: count 3846, mean 1.830, p50 1.100, p90 3.648, p95 5.511, p99 14.129, max 74.548
- `5k-20k`: count 4580, mean 1.086, p50 0.700, p90 2.095, p95 3.041, p99 7.557, max 45.979
- `1k-5k`: count 1961, mean 0.940, p50 0.501, p90 1.790, p95 2.929, p99 9.763, max 81.749
- `0-1k`: count 2106, mean 0.707, p50 0.498, p90 1.488, p95 2.073, p99 4.301, max 32.996
- `unknown`: count 2, mean 1.120, p50 1.120, p90 1.122, p95 1.123, p99 1.123, max 1.123

Turn-angle bins:
- `135-180`: count 70, mean 4.930, p50 2.547, p90 9.476, p95 18.149, p99 39.680, max 43.203
- `0-15`: count 9826, mean 2.651, p50 1.111, p90 6.107, p95 10.593, p99 23.594, max 264.362
- `15-45`: count 2078, mean 1.380, p50 0.956, p90 2.429, p95 3.635, p99 10.530, max 78.421
- `90-135`: count 683, mean 0.804, p50 0.353, p90 1.120, p95 2.021, p99 12.074, max 38.413
- `45-90`: count 1059, mean 0.981, p50 0.502, p90 1.307, p95 1.983, p99 8.817, max 81.749
- `unknown`: count 1497, mean 0.569, p50 0.495, p90 1.103, p95 1.569, p99 4.040, max 15.457

Stop-entry windows:
- `post_67_133ms`: count 1511, mean 2.445, p50 1.025, p90 5.512, p95 10.070, p99 24.780, max 76.924
- `not_near_stop_entry`: count 9672, mean 2.378, p50 1.001, p90 5.269, p95 9.649, p99 22.279, max 264.362
- `post_33_67ms`: count 1177, mean 1.850, p50 0.750, p90 4.119, p95 6.522, p99 18.713, max 45.979
- `post_16_33ms`: count 825, mean 1.486, p50 0.700, p90 3.052, p95 5.219, p99 18.442, max 34.523
- `post_0_16ms`: count 1241, mean 0.923, p50 0.503, p90 1.989, p95 3.053, p99 6.654, max 35.584
- `pre_32_16ms`: count 420, mean 0.643, p50 0.504, p90 1.112, p95 1.482, p99 2.900, max 4.118
- `pre_16_0ms`: count 367, mean 0.527, p50 0.498, p90 1.092, p95 1.414, p99 2.174, max 4.000

Stop-settle windows:
- `not_in_stop_settle`: count 8196, mean 2.433, p50 0.999, p90 5.441, p95 10.016, p99 23.596, max 264.362
- `settle_67_133ms`: count 1982, mean 2.033, p50 0.807, p90 3.915, p95 7.962, p99 23.496, max 76.924
- `settle_33_67ms`: count 1345, mean 1.684, p50 0.707, p90 3.777, p95 5.943, p99 18.409, max 45.979
- `settle_133_250ms`: count 2141, mean 1.627, p50 0.820, p90 3.554, p95 5.811, p99 13.815, max 26.075
- `settle_16_33ms`: count 901, mean 1.406, p50 0.655, p90 2.892, p95 4.837, p99 16.288, max 34.523
- `settle_0_16ms`: count 648, mean 1.117, p50 0.510, p90 2.460, p95 3.744, p99 8.713, max 35.584

DWM horizon bins:
- `not_dwm`: count 15213, mean 2.084, p50 0.877, p90 4.484, p95 8.218, p99 21.100, max 264.362

Poll interval jitter bins:
- `unknown`: count 15213, mean 2.084, p50 0.877, p90 4.484, p95 8.218, p99 21.100, max 264.362

Hook/poll disagreement bins:
- `unknown`: count 15213, mean 2.084, p50 0.877, p90 4.484, p95 8.218, p99 21.100, max 264.362

Chronological robustness:
- `00-10%`: count 1521, mean 3.699, p50 0.889, p90 9.232, p95 18.249, p99 40.483, max 264.362 px
- `10-20%`: count 1521, mean 2.724, p50 0.987, p90 6.796, p95 11.233, p99 31.605, max 76.924 px
- `20-30%`: count 1521, mean 1.469, p50 0.716, p90 3.381, p95 5.123, p99 10.488, max 63.682 px
- `30-40%`: count 1522, mean 1.454, p50 0.889, p90 3.244, p95 4.855, p99 9.823, max 23.733 px
- `40-50%`: count 1521, mean 1.930, p50 0.728, p90 4.962, p95 8.990, p99 15.897, max 28.081 px
- `50-60%`: count 1521, mean 1.812, p50 0.945, p90 3.674, p95 6.879, p99 18.117, max 60.222 px
- `60-70%`: count 1522, mean 1.240, p50 0.707, p90 2.610, p95 4.257, p99 8.593, max 27.237 px
- `70-80%`: count 1521, mean 2.195, p50 0.715, p90 4.476, p95 9.114, p99 26.099, max 81.749 px
- `80-90%`: count 1521, mean 2.265, p50 1.000, p90 5.616, p95 9.614, p99 20.464, max 39.666 px
- `90-100%`: count 1522, mean 2.054, p50 1.003, p90 4.870, p95 8.600, p99 15.835, max 32.996 px

### `cursor-mirror-trace-20260501-000443` / `compat_fixed_8ms`

- Mode: `fixed_horizon`; fixed horizon: `8`; gain: `0.75`
- Anchors: 15214; evaluated: 15213; target misses: 1
- Status counts: `{"invalid_dt_or_idle_gap_fallback":656,"valid":14556,"warmup_hold":1}`
- Overall: count 15213, mean 4.022, p50 1.416, p90 8.707, p95 16.273, p99 42.050, max 500.264 px

Speed bins:
- `1200+`: count 4107, mean 10.095, p50 5.543, p90 23.442, p95 34.462, p99 62.523, max 500.264
- `700-1200`: count 1682, mean 3.067, p50 2.260, p90 5.831, p95 7.270, p99 12.166, max 149.309
- `300-700`: count 2831, mean 2.166, p50 1.437, p90 3.686, p95 4.990, p99 8.688, max 163.498
- `20-100`: count 1015, mean 1.161, p50 0.491, p90 1.443, p95 4.172, p99 19.015, max 28.722
- `0-20`: count 1309, mean 1.097, p50 0.887, p90 2.284, p95 4.034, p99 8.128, max 12.982
- `100-300`: count 4268, mean 1.365, p50 1.000, p90 2.004, p95 2.716, p99 6.089, max 76.826
- `unknown`: count 1, mean 2.440, p50 2.440, p90 2.440, p95 2.440, p99 2.440, max 2.440

Acceleration bins:
- `60k+`: count 2718, mean 11.707, p50 6.135, p90 27.262, p95 40.251, p99 74.342, max 500.264
- `20k-60k`: count 3846, mean 3.524, p50 2.031, p90 7.172, p95 11.030, p99 27.530, max 149.309
- `5k-20k`: count 4580, mean 2.062, p50 1.121, p90 4.127, p95 6.020, p99 15.317, max 87.071
- `1k-5k`: count 1961, mean 1.820, p50 1.000, p90 3.571, p95 5.813, p99 19.408, max 163.498
- `0-1k`: count 2106, mean 1.330, p50 0.991, p90 2.852, p95 4.143, p99 8.590, max 65.992
- `unknown`: count 2, mean 2.337, p50 2.337, p90 2.420, p95 2.430, p99 2.438, max 2.440

Turn-angle bins:
- `135-180`: count 70, mean 9.867, p50 5.003, p90 19.017, p95 36.356, p99 79.391, max 86.405
- `0-15`: count 9826, mean 5.118, p50 2.106, p90 12.171, p95 20.920, p99 46.578, max 500.264
- `15-45`: count 2078, mean 2.634, p50 1.416, p90 4.533, p95 7.320, p99 20.512, max 156.842
- `90-135`: count 683, mean 1.717, p50 1.000, p90 2.237, p95 4.069, p99 24.187, max 76.826
- `45-90`: count 1059, mean 1.848, p50 1.000, p90 2.239, p95 3.655, p99 18.104, max 163.498
- `unknown`: count 1497, mean 1.073, p50 0.979, p90 2.012, p95 3.023, p99 8.540, max 31.056

Stop-entry windows:
- `post_67_133ms`: count 1511, mean 4.755, p50 1.999, p90 10.918, p95 19.634, p99 48.230, max 153.848
- `not_near_stop_entry`: count 9672, mean 4.580, p50 1.836, p90 10.382, p95 19.060, p99 43.630, max 500.264
- `post_33_67ms`: count 1177, mean 3.610, p50 1.414, p90 8.098, p95 13.592, p99 37.468, max 87.071
- `post_16_33ms`: count 825, mean 2.832, p50 1.101, p90 6.006, p95 10.393, p99 37.489, max 69.186
- `post_0_16ms`: count 1241, mean 1.756, p50 1.000, p90 3.996, p95 6.140, p99 13.989, max 72.217
- `pre_32_16ms`: count 420, mean 1.091, p50 1.000, p90 2.001, p95 3.003, p99 5.576, max 8.086
- `pre_16_0ms`: count 367, mean 1.327, p50 1.000, p90 2.233, p95 2.828, p99 3.870, max 8.000

Stop-settle windows:
- `not_in_stop_settle`: count 8196, mean 4.695, p50 1.659, p90 10.629, p95 19.786, p99 46.104, max 500.264
- `settle_67_133ms`: count 1982, mean 3.933, p50 1.415, p90 7.490, p95 15.864, p99 46.646, max 153.848
- `settle_33_67ms`: count 1345, mean 3.283, p50 1.399, p90 7.319, p95 11.810, p99 35.541, max 87.071
- `settle_133_250ms`: count 2141, mean 3.153, p50 1.414, p90 7.107, p95 11.535, p99 27.217, max 51.949
- `settle_16_33ms`: count 901, mean 2.676, p50 1.049, p90 5.553, p95 9.492, p99 33.468, max 69.186
- `settle_0_16ms`: count 648, mean 2.070, p50 1.000, p90 4.534, p95 8.033, p99 16.715, max 72.217

DWM horizon bins:
- `not_dwm`: count 15213, mean 4.022, p50 1.416, p90 8.707, p95 16.273, p99 42.050, max 500.264

Poll interval jitter bins:
- `unknown`: count 15213, mean 4.022, p50 1.416, p90 8.707, p95 16.273, p99 42.050, max 500.264

Hook/poll disagreement bins:
- `unknown`: count 15213, mean 4.022, p50 1.416, p90 8.707, p95 16.273, p99 42.050, max 500.264

Chronological robustness:
- `00-10%`: count 1521, mean 7.143, p50 1.436, p90 18.775, p95 36.677, p99 74.028, max 500.264 px
- `10-20%`: count 1521, mean 5.222, p50 1.416, p90 13.171, p95 22.040, p99 62.229, max 153.848 px
- `20-30%`: count 1521, mean 2.824, p50 1.408, p90 6.649, p95 9.939, p99 20.760, max 127.725 px
- `30-40%`: count 1522, mean 2.779, p50 1.419, p90 6.267, p95 9.280, p99 18.729, max 47.465 px
- `40-50%`: count 1521, mean 3.771, p50 1.414, p90 9.050, p95 18.020, p99 31.938, max 58.265 px
- `50-60%`: count 1521, mean 3.519, p50 1.418, p90 7.244, p95 13.889, p99 35.980, max 102.869 px
- `60-70%`: count 1522, mean 2.353, p50 1.204, p90 5.102, p95 8.273, p99 17.299, max 54.473 px
- `70-80%`: count 1521, mean 4.280, p50 1.412, p90 8.673, p95 18.277, p99 51.830, max 163.498 px
- `80-90%`: count 1521, mean 4.374, p50 1.803, p90 10.764, p95 18.908, p99 40.013, max 67.983 px
- `90-100%`: count 1522, mean 3.959, p50 1.829, p90 9.600, p95 16.436, p99 31.727, max 65.992 px

### `cursor-mirror-trace-20260501-000443` / `compat_fixed_12ms`

- Mode: `fixed_horizon`; fixed horizon: `12`; gain: `0.75`
- Anchors: 15214; evaluated: 15213; target misses: 1
- Status counts: `{"invalid_dt_or_idle_gap_fallback":656,"valid":14556,"warmup_hold":1}`
- Overall: count 15213, mean 6.128, p50 2.102, p90 13.762, p95 25.336, p99 65.185, max 766.845 px

Speed bins:
- `1200+`: count 4107, mean 15.420, p50 8.373, p90 36.157, p95 52.640, p99 95.435, max 766.845
- `700-1200`: count 1682, mean 4.705, p50 3.451, p90 9.401, p95 12.132, p99 21.100, max 226.737
- `300-700`: count 2831, mean 3.284, p50 2.217, p90 5.977, p95 7.979, p99 14.800, max 256.571
- `20-100`: count 1015, mean 1.869, p50 0.779, p90 2.047, p95 6.735, p99 28.266, max 58.447
- `0-20`: count 1309, mean 1.811, p50 1.000, p90 4.090, p95 6.199, p99 15.057, max 34.343
- `unknown`: count 1, mean 4.478, p50 4.478, p90 4.478, p95 4.478, p99 4.478, max 4.478
- `100-300`: count 4268, mean 1.971, p50 1.118, p90 3.024, p95 4.054, p99 10.875, max 125.734

Acceleration bins:
- `60k+`: count 2718, mean 18.177, p50 9.608, p90 43.234, p95 63.719, p99 113.477, max 766.845
- `20k-60k`: count 3846, mean 5.293, p50 2.887, p90 11.143, p95 17.074, p99 39.921, max 226.737
- `1k-5k`: count 1961, mean 2.741, p50 1.120, p90 5.103, p95 9.252, p99 30.196, max 256.571
- `5k-20k`: count 4580, mean 3.019, p50 1.582, p90 6.157, p95 9.043, p99 22.990, max 123.703
- `0-1k`: count 2106, mean 2.020, p50 1.003, p90 4.104, p95 6.896, p99 16.182, max 97.285
- `unknown`: count 2, mean 3.691, p50 3.691, p90 4.321, p95 4.400, p99 4.463, max 4.478

Turn-angle bins:
- `135-180`: count 70, mean 15.566, p50 8.332, p90 27.968, p95 61.339, p99 121.384, max 123.703
- `0-15`: count 9826, mean 7.764, p50 3.000, p90 18.921, p95 31.914, p99 71.150, max 766.845
- `15-45`: count 2078, mean 4.079, p50 2.114, p90 7.855, p95 12.402, p99 34.864, max 252.907
- `90-135`: count 683, mean 2.557, p50 1.034, p90 3.613, p95 6.726, p99 44.227, max 114.422
- `45-90`: count 1059, mean 2.820, p50 1.120, p90 3.623, p95 6.429, p99 30.945, max 256.571
- `unknown`: count 1497, mean 1.761, p50 1.016, p90 3.165, p95 5.461, p99 16.661, max 73.290

Stop-entry windows:
- `not_near_stop_entry`: count 9672, mean 6.965, p50 2.506, p90 16.348, p95 29.092, p99 67.859, max 766.845
- `post_67_133ms`: count 1511, mean 7.041, p50 2.599, p90 15.779, p95 28.156, p99 73.351, max 230.772
- `post_33_67ms`: count 1177, mean 5.686, p50 2.077, p90 13.206, p95 21.903, p99 64.350, max 121.576
- `post_16_33ms`: count 825, mean 4.468, p50 1.602, p90 9.944, p95 16.468, p99 58.445, max 105.713
- `post_0_16ms`: count 1241, mean 2.985, p50 1.414, p90 6.370, p95 11.768, p99 27.785, max 125.977
- `pre_32_16ms`: count 420, mean 1.533, p50 1.000, p90 2.523, p95 4.730, p99 12.175, max 19.355
- `pre_16_0ms`: count 367, mean 1.346, p50 1.000, p90 2.503, p95 4.013, p99 7.505, max 12.008

Stop-settle windows:
- `not_in_stop_settle`: count 8196, mean 7.140, p50 2.492, p90 17.100, p95 29.884, p99 72.472, max 766.845
- `settle_67_133ms`: count 1982, mean 5.783, p50 2.027, p90 11.980, p95 23.295, p99 67.637, max 230.772
- `settle_33_67ms`: count 1345, mean 5.121, p50 1.775, p90 11.985, p95 19.645, p99 58.923, max 121.576
- `settle_133_250ms`: count 2141, mean 4.795, p50 2.059, p90 10.624, p95 17.698, p99 46.481, max 78.923
- `settle_16_33ms`: count 901, mean 4.192, p50 1.524, p90 9.229, p95 14.798, p99 56.961, max 105.713
- `settle_0_16ms`: count 648, mean 3.565, p50 1.353, p90 8.173, p95 14.284, p99 34.356, max 125.977

DWM horizon bins:
- `not_dwm`: count 15213, mean 6.128, p50 2.102, p90 13.762, p95 25.336, p99 65.185, max 766.845

Poll interval jitter bins:
- `unknown`: count 15213, mean 6.128, p50 2.102, p90 13.762, p95 25.336, p99 65.185, max 766.845

Hook/poll disagreement bins:
- `unknown`: count 15213, mean 6.128, p50 2.102, p90 13.762, p95 25.336, p99 65.185, max 766.845

Chronological robustness:
- `00-10%`: count 1521, mean 11.066, p50 2.236, p90 29.158, p95 57.289, p99 116.343, max 766.845 px
- `10-20%`: count 1521, mean 7.958, p50 2.067, p90 20.937, p95 33.698, p99 92.567, max 230.772 px
- `20-30%`: count 1521, mean 4.228, p50 1.983, p90 9.953, p95 14.857, p99 31.029, max 193.741 px
- `30-40%`: count 1522, mean 4.094, p50 2.065, p90 9.693, p95 14.773, p99 27.611, max 72.922 px
- `40-50%`: count 1521, mean 5.779, p50 2.023, p90 15.893, p95 26.742, p99 49.296, max 95.499 px
- `50-60%`: count 1521, mean 5.419, p50 2.240, p90 11.179, p95 22.102, p99 55.365, max 133.853 px
- `60-70%`: count 1522, mean 3.548, p50 1.806, p90 8.008, p95 12.748, p99 26.483, max 87.802 px
- `70-80%`: count 1521, mean 6.557, p50 1.992, p90 14.624, p95 27.518, p99 78.965, max 256.571 px
- `80-90%`: count 1521, mean 6.637, p50 2.517, p90 16.624, p95 28.657, p99 60.570, max 108.654 px
- `90-100%`: count 1522, mean 5.998, p50 2.497, p90 14.997, p95 24.651, p99 48.870, max 97.285 px

### `cursor-mirror-trace-20260501-000443` / `compat_fixed_16ms`

- Mode: `fixed_horizon`; fixed horizon: `16`; gain: `0.75`
- Anchors: 15214; evaluated: 15213; target misses: 1
- Status counts: `{"invalid_dt_or_idle_gap_fallback":656,"valid":14556,"warmup_hold":1}`
- Overall: count 15213, mean 8.423, p50 2.909, p90 19.141, p95 35.342, p99 88.526, max 1034.082 px

Speed bins:
- `1200+`: count 4107, mean 21.229, p50 11.308, p90 50.302, p95 72.812, p99 133.844, max 1034.082
- `700-1200`: count 1682, mean 6.574, p50 4.791, p90 13.022, p95 17.352, p99 28.905, max 304.167
- `300-700`: count 2831, mean 4.428, p50 2.982, p90 8.258, p95 11.475, p99 21.901, max 352.293
- `20-100`: count 1015, mean 2.483, p50 1.000, p90 2.996, p95 9.661, p99 37.836, max 88.366
- `0-20`: count 1309, mean 2.555, p50 1.032, p90 5.819, p95 9.174, p99 23.076, max 56.924
- `unknown`: count 1, mean 6.421, p50 6.421, p90 6.421, p95 6.421, p99 6.421, max 6.421
- `100-300`: count 4268, mean 2.692, p50 1.484, p90 4.074, p95 5.640, p99 16.612, max 175.430

Acceleration bins:
- `60k+`: count 2718, mean 25.232, p50 13.673, p90 60.522, p95 86.050, p99 158.586, max 1034.082
- `20k-60k`: count 3846, mean 7.209, p50 3.805, p90 15.529, p95 23.070, p99 53.917, max 304.167
- `5k-20k`: count 4580, mean 4.090, p50 2.229, p90 8.514, p95 12.843, p99 31.083, max 171.406
- `1k-5k`: count 1961, mean 3.702, p50 1.414, p90 7.059, p95 12.483, p99 39.726, max 352.053
- `0-1k`: count 2106, mean 2.770, p50 1.336, p90 5.757, p95 9.486, p99 23.087, max 130.086
- `unknown`: count 2, mean 5.436, p50 5.436, p90 6.224, p95 6.323, p99 6.402, max 6.421

Turn-angle bins:
- `135-180`: count 70, mean 21.267, p50 10.273, p90 39.485, p95 87.223, p99 157.669, max 171.406
- `0-15`: count 9826, mean 10.654, p50 4.007, p90 26.195, p95 44.602, p99 97.236, max 1034.082
- `15-45`: count 2078, mean 5.623, p50 2.831, p90 10.807, p95 17.536, p99 49.326, max 352.293
- `90-135`: count 683, mean 3.530, p50 1.414, p90 5.039, p95 9.903, p99 58.227, max 152.021
- `45-90`: count 1059, mean 3.947, p50 1.548, p90 4.979, p95 9.174, p99 47.431, max 352.053
- `unknown`: count 1497, mean 2.465, p50 1.204, p90 4.468, p95 7.981, p99 25.573, max 114.428

Stop-entry windows:
- `post_67_133ms`: count 1511, mean 9.600, p50 3.283, p90 22.537, p95 40.520, p99 100.849, max 307.697
- `not_near_stop_entry`: count 9672, mean 9.539, p50 3.165, p90 22.727, p95 40.161, p99 93.611, max 1034.082
- `post_33_67ms`: count 1177, mean 7.949, p50 2.939, p90 18.318, p95 29.702, p99 86.083, max 176.930
- `post_16_33ms`: count 825, mean 6.202, p50 2.234, p90 13.751, p95 21.993, p99 78.369, max 142.392
- `post_0_16ms`: count 1241, mean 4.271, p50 1.997, p90 9.073, p95 17.202, p99 39.924, max 180.763
- `pre_32_16ms`: count 420, mean 2.200, p50 1.414, p90 3.608, p95 7.254, p99 18.463, max 31.703
- `pre_16_0ms`: count 367, mean 1.831, p50 1.409, p90 3.608, p95 5.000, p99 11.006, max 15.026

Stop-settle windows:
- `not_in_stop_settle`: count 8196, mean 9.787, p50 3.159, p90 23.814, p95 41.913, p99 98.796, max 1034.082
- `settle_67_133ms`: count 1982, mean 7.872, p50 2.808, p90 16.327, p95 32.695, p99 92.697, max 307.697
- `settle_33_67ms`: count 1345, mean 7.159, p50 2.246, p90 17.130, p95 27.200, p99 82.846, max 176.930
- `settle_133_250ms`: count 2141, mean 6.597, p50 2.829, p90 14.825, p95 25.367, p99 67.883, max 104.897
- `settle_16_33ms`: count 901, mean 5.822, p50 2.138, p90 12.972, p95 20.325, p99 74.856, max 142.392
- `settle_0_16ms`: count 648, mean 5.133, p50 1.999, p90 12.000, p95 20.065, p99 53.444, max 180.763

DWM horizon bins:
- `not_dwm`: count 15213, mean 8.423, p50 2.909, p90 19.141, p95 35.342, p99 88.526, max 1034.082

Poll interval jitter bins:
- `unknown`: count 15213, mean 8.423, p50 2.909, p90 19.141, p95 35.342, p99 88.526, max 1034.082

Hook/poll disagreement bins:
- `unknown`: count 15213, mean 8.423, p50 2.909, p90 19.141, p95 35.342, p99 88.526, max 1034.082

Chronological robustness:
- `00-10%`: count 1521, mean 15.264, p50 3.001, p90 39.760, p95 81.397, p99 164.350, max 1034.082 px
- `10-20%`: count 1521, mean 10.981, p50 2.857, p90 28.896, p95 46.175, p99 125.079, max 307.697 px
- `20-30%`: count 1521, mean 5.753, p50 2.365, p90 14.142, p95 20.583, p99 44.282, max 261.455 px
- `30-40%`: count 1522, mean 5.572, p50 2.826, p90 13.412, p95 21.241, p99 38.141, max 98.391 px
- `40-50%`: count 1521, mean 7.992, p50 2.767, p90 22.222, p95 37.677, p99 71.195, max 133.918 px
- `50-60%`: count 1521, mean 7.498, p50 3.061, p90 15.500, p95 30.574, p99 77.455, max 134.003 px
- `60-70%`: count 1522, mean 4.823, p50 2.239, p90 11.024, p95 17.218, p99 37.525, max 121.159 px
- `70-80%`: count 1521, mean 9.083, p50 2.785, p90 21.189, p95 39.235, p99 110.903, max 352.053 px
- `80-90%`: count 1521, mean 9.077, p50 3.252, p90 22.612, p95 40.001, p99 81.607, max 150.613 px
- `90-100%`: count 1522, mean 8.194, p50 3.163, p90 21.252, p95 35.241, p99 66.124, max 130.086 px

### `cursor-mirror-trace-20260501-091537` / `product_poll_dwm_next_vblank`

- Mode: `dwm_next_vblank`; fixed horizon: `null`; gain: `0.75`
- Anchors: 160442; evaluated: 160440; target misses: 2
- Status counts: `{"late_advanced":39993,"valid":120446,"warmup_hold":1}`
- Overall: count 160440, mean 1.348, p50 0.000, p90 1.741, p95 5.258, p99 26.993, max 537.956 px

Speed bins:
- `1200+`: count 6189, mean 20.712, p50 10.440, p90 50.447, p95 79.869, p99 147.833, max 512.642
- `700-1200`: count 3059, mean 6.564, p50 4.357, p90 14.939, p95 19.933, p99 34.003, max 79.133
- `300-700`: count 5611, mean 3.908, p50 2.347, p90 8.628, p95 12.967, p99 24.983, max 72.343
- `100-300`: count 7715, mean 1.835, p50 1.020, p90 4.000, p95 6.033, p99 12.363, max 61.421
- `20-100`: count 9044, mean 0.744, p50 0.556, p90 1.420, p95 2.236, p99 5.074, max 32.894
- `0-20`: count 128821, mean 0.195, p50 0.000, p90 0.000, p95 0.298, p99 1.940, max 537.956
- `unknown`: count 1, mean 0.000, p50 0.000, p90 0.000, p95 0.000, p99 0.000, max 0.000

Acceleration bins:
- `60k+`: count 4342, mean 22.924, p50 9.166, p90 61.301, p95 90.351, p99 180.243, max 512.642
- `20k-60k`: count 5889, mean 7.837, p50 3.606, p90 19.131, p95 28.639, p99 60.296, max 259.269
- `5k-20k`: count 12248, mean 3.045, p50 1.070, p90 7.436, p95 12.000, p99 25.999, max 226.091
- `1k-5k`: count 13187, mean 1.336, p50 0.615, p90 2.917, p95 5.000, p99 13.939, max 247.653
- `0-1k`: count 124772, mean 0.125, p50 0.000, p90 0.000, p95 0.268, p99 1.927, max 537.956
- `unknown`: count 2, mean 0.000, p50 0.000, p90 0.000, p95 0.000, p99 0.000, max 0.000

Turn-angle bins:
- `0-15`: count 18227, mean 8.393, p50 2.560, p90 19.573, p95 34.890, p99 95.059, max 512.642
- `15-45`: count 3952, mean 3.772, p50 1.429, p90 8.626, p95 14.651, p99 33.385, max 181.472
- `135-180`: count 32, mean 3.738, p50 1.662, p90 7.907, p95 11.401, p99 22.852, max 26.577
- `45-90`: count 1803, mean 1.725, p50 1.000, p90 3.238, p95 6.067, p99 15.021, max 155.524
- `90-135`: count 833, mean 1.297, p50 1.000, p90 2.000, p95 3.610, p99 14.281, max 53.263
- `unknown`: count 135593, mean 0.325, p50 0.000, p90 0.000, p95 1.000, p99 4.401, max 537.956

Stop-entry windows:
- `post_0_16ms`: count 3170, mean 4.611, p50 0.000, p90 7.126, p95 20.939, p99 88.454, max 484.567
- `pre_16_0ms`: count 1424, mean 4.124, p50 1.007, p90 8.944, p95 20.083, p99 48.239, max 135.484
- `pre_32_16ms`: count 2100, mean 4.606, p50 1.414, p90 9.439, p95 18.385, p99 58.068, max 230.669
- `post_16_33ms`: count 2384, mean 2.362, p50 0.000, p90 4.432, p95 9.544, p99 43.141, max 211.787
- `post_33_67ms`: count 3674, mean 1.932, p50 0.000, p90 3.606, p95 8.259, p99 36.184, max 239.756
- `post_67_133ms`: count 6340, mean 1.815, p50 0.000, p90 2.957, p95 7.816, p99 34.780, max 309.271
- `not_near_stop_entry`: count 141348, mean 1.145, p50 0.000, p90 1.319, p95 4.246, p99 23.421, max 537.956

Stop-settle windows:
- `settle_133_250ms`: count 11744, mean 4.119, p50 0.000, p90 8.684, p95 19.451, p99 74.053, max 537.956
- `settle_67_133ms`: count 7608, mean 2.439, p50 0.000, p90 4.186, p95 10.851, p99 47.477, max 312.923
- `settle_16_33ms`: count 2491, mean 2.429, p50 0.000, p90 4.472, p95 10.019, p99 50.257, max 211.787
- `settle_33_67ms`: count 4059, mean 2.144, p50 0.000, p90 4.431, p95 9.522, p99 38.318, max 239.756
- `settle_0_16ms`: count 1107, mean 2.129, p50 0.000, p90 2.991, p95 7.703, p99 35.280, max 328.360
- `not_in_stop_settle`: count 133431, mean 0.991, p50 0.000, p90 1.075, p95 3.606, p99 20.132, max 442.614

DWM horizon bins:
- `16-21ms`: count 5879, mean 2.124, p50 0.000, p90 2.241, p95 7.282, p99 42.860, max 328.360
- `12-16ms`: count 38586, mean 1.850, p50 0.000, p90 2.351, p95 7.279, p99 37.425, max 537.956
- `8-12ms`: count 38961, mean 1.534, p50 0.000, p90 2.087, p95 6.316, p99 31.146, max 512.642
- `4-8ms`: count 38505, mean 1.175, p50 0.000, p90 1.623, p95 5.135, p99 24.296, max 224.614
- `2-4ms`: count 19273, mean 0.930, p50 0.000, p90 1.228, p95 3.706, p99 17.476, max 269.214
- `0-2ms`: count 19236, mean 0.492, p50 0.000, p90 0.574, p95 1.714, p99 10.193, max 128.252

Poll interval jitter bins:
- `<=0.5ms`: count 2240, mean 1.955, p50 0.000, p90 3.276, p95 8.322, p99 33.297, max 218.534
- `0.5-1ms`: count 2394, mean 1.732, p50 0.000, p90 2.828, p95 7.499, p99 28.288, max 278.914
- `1-2ms`: count 9034, mean 1.359, p50 0.000, p90 1.852, p95 5.283, p99 25.395, max 269.214
- `4ms+`: count 130377, mean 1.319, p50 0.000, p90 1.705, p95 5.202, p99 26.495, max 512.642
- `2-4ms`: count 16394, mean 1.434, p50 0.000, p90 1.414, p95 4.810, p99 30.160, max 537.956
- `unknown`: count 1, mean 0.000, p50 0.000, p90 0.000, p95 0.000, p99 0.000, max 0.000

Hook/poll disagreement bins:
- `5px+`: count 8139, mean 18.966, p50 10.000, p90 45.182, p95 73.659, p99 148.821, max 537.956
- `2-5px`: count 9046, mean 2.992, p50 1.683, p90 7.482, p95 10.549, p99 20.042, max 75.528
- `1-2px`: count 11849, mean 1.080, p50 0.000, p90 3.126, p95 4.519, p99 9.064, max 95.021
- `0-1px`: count 88224, mean 0.227, p50 0.000, p90 1.000, p95 1.174, p99 3.000, max 77.524
- `unknown`: count 16, mean 0.029, p50 0.000, p90 0.000, p95 0.114, p99 0.389, max 0.457
- `0px`: count 43166, mean 0.047, p50 0.000, p90 0.000, p95 0.000, p99 1.048, max 22.883

Chronological robustness:
- `00-10%`: count 16044, mean 1.833, p50 0.000, p90 2.646, p95 7.530, p99 38.281, max 328.360 px
- `10-20%`: count 16044, mean 1.596, p50 0.000, p90 2.000, p95 6.264, p99 29.009, max 537.956 px
- `20-30%`: count 16044, mean 1.172, p50 0.000, p90 1.084, p95 4.045, p99 25.676, max 273.372 px
- `30-40%`: count 16044, mean 1.437, p50 0.000, p90 2.236, p95 6.746, p99 28.801, max 205.174 px
- `40-50%`: count 16044, mean 1.210, p50 0.000, p90 1.644, p95 4.680, p99 25.317, max 344.392 px
- `50-60%`: count 16044, mean 1.087, p50 0.000, p90 1.997, p95 4.830, p99 19.061, max 182.890 px
- `60-70%`: count 16044, mean 1.595, p50 0.000, p90 2.118, p95 6.225, p99 30.566, max 442.614 px
- `70-80%`: count 16044, mean 0.915, p50 0.000, p90 1.000, p95 2.827, p99 19.599, max 484.567 px
- `80-90%`: count 16044, mean 1.113, p50 0.000, p90 1.515, p95 4.552, p99 22.621, max 209.478 px
- `90-100%`: count 16044, mean 1.521, p50 0.000, p90 1.623, p95 5.099, p99 37.582, max 312.923 px
