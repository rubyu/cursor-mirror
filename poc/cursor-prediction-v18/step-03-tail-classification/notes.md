# Step 03 Notes: Event-Window Tail Classification

This step supersedes the earlier single-row tail classification. The user-visible issue is an event: after a fast or medium movement stops, the mirror can continue forward, peak ahead of the real cursor, and then return.

## Stop Event Definition

- Candidate row is near stop: `v2 <= 100 px/s` and target displacement `<= 0.75 px`.
- Previous row in the same package is not near stop.
- The previous 6 rows contain recent motion: max `v12 >= 500 px/s`.
- Event window: 6 frames before stop and 10 frames after stop.
- Motion direction: direction of the highest-`v12` row in the pre-window.

## Primary Event Metrics

- `peakLeadPx`: maximum mirror-current displacement along the pre-stop direction in the post-stop window.
- `peakDistancePx`: maximum Euclidean mirror-current distance in the post-stop window.
- `settleFrames0p5` / `settleFrames1p0`: frames after peak until current distance drops below the threshold.
- `returnMotionPx`: peak distance minus the smallest later distance in the window.
- `overshootThenReturnRate`: event rate where peak lead exceeds a threshold and the later frames return toward current.

Per-row current overshoot is retained as a secondary guardrail only.
