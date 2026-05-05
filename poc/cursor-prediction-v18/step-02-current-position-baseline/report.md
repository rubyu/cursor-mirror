# Step 02 Report: Current-Position Baseline

## Objective

Step 02 establishes a C# chronological replay baseline using current-position overshoot as the primary acute-stop metric.

The current product generated model is already `lag0`, so the main baseline is:

- `current_product_direct = lag0 + target offset -4ms`

Compared against:

- `lag0 offset0`
- `lag0.5 offset0`
- `lag0.5 offset-4`
- `lag0 offset-3.5`

## Build/Run

- C# harness build/run succeeded with `C:\Program Files\dotnet\dotnet.exe`.
- Product source edited: no
- Raw ZIP copied: no
- Replay rows: `90,522`

Build warning: nullable-context annotation warning only.

## Results

| Candidate | fast current overshoot p99/max | >1 / >2 | current distance p99 | shifted visual p95 | normal visual p95 | high visual p95 |
|---|---:|---:|---:|---:|---:|---:|
| current product direct: lag0 offset-4 | 0.000 / 1.989 | 0.0005 / 0.0000 | 0.000 | 2.126 | 1.720 | 1.928 |
| lag0 offset-3.5 | 2.462 / 3.448 | 0.0478 / 0.0291 | 3.457 | 3.275 | 2.918 | 3.529 |
| lag0 offset0 | 2.990 / 4.358 | 0.1241 / 0.0478 | 3.363 | 7.075 | 8.314 | 10.243 |
| lag0.5 offset-4 | 0.000 / 2.489 | 0.0005 / 0.0005 | 0.000 | 2.126 | 1.729 | 1.928 |
| lag0.5 offset0 | 3.490 / 4.858 | 0.1916 / 0.0779 | 3.802 | 6.659 | 7.890 | 10.742 |

## Tail Example

For current product direct, only one `fastThenNearZero` row exceeds 1px current-position overshoot:

| package | elapsed ms | slice | current overshoot | current distance | v2/v5/v12/target | predicted dx/dy | shifted target dx/dy |
|---|---:|---|---:|---:|---:|---:|---:|
| m070307 | 695969.430 | oneFrameStop | 1.989 | 2.151 | 0 / 874 / 877 / 0 | -1.750 / -1.250 | 0 / 0 |

This row is a true current-position issue: the cursor is already stopped under v2 and target speed, but the predictor still emits about 2px displacement.

## Interpretation

The v18 current-position metric changes the v17 story:

- `lag0 offset-4` is much safer than offset0 variants for acute-stop current-position overshoot.
- Fractional `-3.5ms`, which helped v17 base-direction tail, is worse for the user-visible current-position criterion.
- `lag0.5 offset-4` is close, but has a small `>2px` acute-stop tail that lag0 removes.

So the current product candidate is already strong on v18's primary metric. The remaining problem is narrow: a one-frame-stop residual displacement.

## Next Brake Candidates

Recommended Step 03 candidates:

1. oneFrameStop hard snap: if `v2 <= 100`, `v5 >= 500`, and shifted/offset0 target distance is near zero, return current position.
2. hardBrake displacement cap: if `v12 >= 800` and `v2 <= 0.35*v12`, cap displacement to `0.5px`.
3. fastThenNearZero current safety gate: if recent speed was high and target displacement is `<=0.75px`, zero prediction.
4. brake confidence gain scale: scale displacement by `v2/v5/v12` only in acute-stop slices.
5. postStopFirstFrames hold latch: hold for 1-2 frames after a detected stop unless movement resumes.
6. along-only clamp: remove forward component along recent motion while preserving perpendicular correction.
