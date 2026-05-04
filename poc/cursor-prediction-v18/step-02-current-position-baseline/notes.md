# Step 02 Notes: Current-Position Baseline

## Product State

Current product generated DistilledMLP source already reports:

- model id: `mlp_fsmn_h8_hardtanh_label_q0p125_lag0`
- `LagCompensationPixels = 0.0f`

Therefore `lag0 offset -4ms` in this harness is recorded as the current-product-direct equivalent for DistilledMLP weights/lag. Product source was not edited.

## Harness

- C# chronological replay.
- Product predictor source linked read-only.
- Generated model copied to a POC-local overlay only to compare `lag0.5`.
- Source ZIPs read in place.

Candidates:

- `current_product_direct`: lag0 offset -4
- `product_lag0_offset0`
- `product_lag0_offsetm3p5`
- `overlay_lag0p5_offset0`
- `overlay_lag0p5_offsetm4`

## Slice Counts

- replay rows: `90522`
- `fastThenNearZero`: `1926`
- `hardBrake`: `334`
- `stopAfterHighSpeed`: `7`
- `oneFrameStop`: `406`
- `postStopFirstFrames`: `271`
- `normalMove`: `2657`
- `highSpeed`: `13`
- `staticHold`: `60646`

## Key Current-Position Scores

| Candidate | fast current overshoot p99/max | >1 / >2 | current distance p99 | shifted visual p95 | normal visual p95 | high visual p95 |
|---|---:|---:|---:|---:|---:|---:|
| current product direct: lag0 offset-4 | 0.000 / 1.989 | 0.0005 / 0.0000 | 0.000 | 2.126 | 1.720 | 1.928 |
| lag0 offset-3.5 | 2.462 / 3.448 | 0.0478 / 0.0291 | 3.457 | 3.275 | 2.918 | 3.529 |
| lag0 offset0 | 2.990 / 4.358 | 0.1241 / 0.0478 | 3.363 | 7.075 | 8.314 | 10.243 |
| lag0.5 offset-4 | 0.000 / 2.489 | 0.0005 / 0.0005 | 0.000 | 2.126 | 1.729 | 1.928 |
| lag0.5 offset0 | 3.490 / 4.858 | 0.1916 / 0.0779 | 3.802 | 6.659 | 7.890 | 10.742 |

## Tail Row

Current product direct has one `fastThenNearZero` current-position overshoot row above 1px:

| package | elapsed ms | slice | current overshoot | current distance | speeds v2/v5/v12/target | predicted dx/dy | shifted target dx/dy |
|---|---:|---|---:|---:|---:|---:|---:|
| m070307 | 695969.430 | oneFrameStop | 1.989 | 2.151 | 0 / 874 / 877 / 0 | -1.750 / -1.250 | 0 / 0 |

Interpretation: the residual is a one-frame-stop displacement after the target/current position is already stationary. This is a good target for a very narrow brake gate.
