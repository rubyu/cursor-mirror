# Step 5 Report: Neural Model Evaluation

## Summary

The NumPy MLPs found a real signal in this trace. On common feature-valid test anchors, neural models improved aggregate mean, RMSE, p95, and p99 at every tested horizon.

But they are not a clean replacement for Step 4's `constant-velocity-last2` default. The wins concentrate at high speed, while low-speed bins often regress and some max errors get worse. The recommendation remains: keep `constant-velocity-last2` as the default; consider a future speed-gated hybrid only after more traces.

## Overall Test Results

All rows below use the Step 5 common feature-valid test anchor mask.

| horizon | model | mean | RMSE | p50 | p90 | p95 | p99 | max |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 4 | last2 | 1.700 | 3.025 | 0.916 | 4.073 | 6.449 | 12.457 | 29.079 |
| 4 | direct MLP | 1.636 | 2.514 | 1.083 | 3.416 | 5.146 | 9.531 | 30.707 |
| 4 | residual MLP | 1.615 | 2.670 | 0.966 | 3.475 | 5.388 | 10.485 | 37.330 |
| 8 | last2 | 3.367 | 5.938 | 1.826 | 8.121 | 12.562 | 24.834 | 49.793 |
| 8 | direct MLP | 3.259 | 5.221 | 1.983 | 7.112 | 10.705 | 19.723 | 56.781 |
| 8 | residual MLP | 3.098 | 5.022 | 1.898 | 6.738 | 10.173 | 20.026 | 60.830 |
| 12 | last2 | 5.434 | 9.801 | 2.519 | 13.561 | 22.124 | 41.935 | 72.692 |
| 12 | direct MLP | 5.098 | 8.281 | 3.034 | 11.340 | 17.610 | 33.021 | 86.907 |
| 12 | residual MLP | 4.747 | 7.969 | 2.706 | 10.851 | 17.323 | 32.405 | 78.990 |
| 16 | last2 | 7.719 | 14.090 | 3.529 | 19.454 | 31.667 | 61.288 | 104.566 |
| 16 | direct MLP | 7.036 | 11.417 | 4.058 | 16.055 | 24.115 | 45.322 | 99.270 |
| 16 | residual MLP | 6.865 | 11.727 | 3.706 | 15.395 | 25.973 | 47.378 | 102.915 |
| 24 | last2 | 13.829 | 25.656 | 5.772 | 35.577 | 57.906 | 107.597 | 199.479 |
| 24 | direct MLP | 12.686 | 21.042 | 7.068 | 29.468 | 46.277 | 86.549 | 212.954 |
| 24 | residual MLP | 13.363 | 23.893 | 6.412 | 31.975 | 52.751 | 102.576 | 210.342 |

Compared with Step 1's broader last2 baseline, the Step 5 common-anchor baseline has lower max values because anchors now require 5 valid history intervals. This common mask is the right comparison for MLP-vs-baseline, but it should not be read as a replacement for the Step 1 production baseline table.

## Speed-Dependent Behavior

At `8ms`, the residual MLP improves high speed substantially:

| speed bin | last2 mean | residual MLP mean | last2 p95 | residual MLP p95 |
|---|---:|---:|---:|---:|
| 0-500 | 1.138 | 1.507 | 2.782 | 3.758 |
| 500-1500 | 2.477 | 2.374 | 5.436 | 5.244 |
| 1500-3000 | 4.188 | 3.936 | 10.469 | 9.575 |
| 3000+ | 10.983 | 8.473 | 27.149 | 22.280 |

At `16ms`, the same pattern holds, with a bigger high-speed mean win and continued low-speed regression:

| speed bin | last2 mean | residual MLP mean | last2 p95 | residual MLP p95 |
|---|---:|---:|---:|---:|
| 0-500 | 2.291 | 2.966 | 5.851 | 7.324 |
| 500-1500 | 5.259 | 4.958 | 13.718 | 12.331 |
| 1500-3000 | 10.153 | 8.932 | 26.337 | 24.020 |
| 3000+ | 26.180 | 20.115 | 66.451 | 51.538 |

At `24ms`, the direct MLP is strongest at high speed:

| speed bin | last2 mean | direct MLP mean | last2 p95 | direct MLP p95 |
|---|---:|---:|---:|---:|
| 0-500 | 3.773 | 6.046 | 10.247 | 15.572 |
| 500-1500 | 9.074 | 9.367 | 23.395 | 23.517 |
| 1500-3000 | 18.820 | 16.816 | 48.325 | 45.559 |
| 3000+ | 47.353 | 34.420 | 115.323 | 86.716 |

The neural model is learning a useful speed-conditioned correction, but the low-speed regression matters because low-speed anchors are common and last2 is already precise there.

## Tail Behavior

Aggregate p99 improved for the best neural model at every tested horizon:

| horizon | last2 p99 | best neural p99 |
|---:|---:|---:|
| 4 | 12.457 | 9.531 |
| 8 | 24.834 | 19.723 |
| 12 | 41.935 | 32.405 |
| 16 | 61.288 | 45.322 |
| 24 | 107.597 | 86.549 |

Max error is less clean:

- at `4ms`, direct MLP max was `30.707px` vs last2 `29.079px`;
- at `8ms`, both MLPs worsened max vs last2;
- at `12ms`, both MLPs worsened max vs last2;
- at `16ms`, direct MLP improved max slightly and residual MLP improved slightly;
- at `24ms`, both MLPs worsened max vs last2.

For Cursor Mirror, p95/p99 improvements are valuable, but worse isolated overshoots are risky because visible cursor prediction failures are most noticeable at abrupt stops and turns.

## Cost

Each MLP has `1778` parameters and about `1728` multiply-adds per prediction. Batched NumPy inference measured millions of predictions per second locally, but that timing is not the same as per-event UI latency in production.

Training was cheap for this trace: the whole script completed in about `7.45s`, and each model fit took less than `1s`.

Implementation cost is still meaningfully higher than last2:

- feature extraction and standardization;
- one model per horizon or a multi-horizon redesign;
- model serialization/versioning;
- validation policy;
- more tests around reset gaps, low-speed behavior, and out-of-distribution traces.

## Recommendation

Do not replace the Step 4 default with an MLP from this single-trace result.

The best next neural experiment is a speed-gated hybrid: use last2 for low-speed anchors and use a learned residual/direct correction only above a speed threshold, then validate on multiple traces. Until that clears p95/p99/max without low-speed regression, `constant-velocity-last2`, gain `1.0`, no cap, remains the right product default.
