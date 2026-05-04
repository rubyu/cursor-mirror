# Step 01 Notes: Current-Position Overshoot Metrics

## Primary User-Visible Quantity

The user sees the mirror cursor relative to the real cursor's current position. Therefore v18 treats the current sample position as the primary anchor.

For every replay row:

- `currentDx/currentDy = predictedPosition - currentCursorPosition`
- `currentDistancePx = hypot(currentDx, currentDy)`
- `recentDirection = normalized v12 runtime motion`
- `currentSignedAlongRecentPx = dot(currentDx/currentDy, recentDirection)`
- `currentOvershootPx = max(0, currentSignedAlongRecentPx)`

Positive current-position signed error means the mirror is ahead of the current real cursor in the recent movement direction.

## Direction Frames

v18 keeps three direction frames separate:

- `currentPosition`: prediction relative to current real cursor position, projected along recent runtime motion.
- `offset0Direction`: prediction error to candidate target, projected on the offset-0 target direction. This matches much of v17.
- `candidateTargetDirection`: prediction error to candidate target, projected on the candidate shifted target direction.

These can disagree. For example, a prediction can have zero candidate-target overshoot while still being ahead of the real cursor current position.

## Acute-Stop Slices

Initial slices:

- `fastThenNearZero`: `v12 >= 500 px/s` and offset-0 target speed `<= 150 px/s`.
- `hardBrake`: `v12 >= 800 px/s` and `v2 <= 0.35 * v12`.
- `stopAfterHighSpeed`: `v12 >= 1500 px/s` and offset-0 target speed `<= 150 px/s`.
- `oneFrameStop`: `v5 >= 500 px/s` and `v2 <= 100 px/s`.
- `postStopFirstFrames`: `v12 >= 500 px/s`, `v5 <= 250 px/s`, `v2 <= 100 px/s`.

Side-effect slices:

- `normalMove`: not acute stop, `v12` in `250..1800 px/s`.
- `highSpeed`: `v12 >= 1800 px/s`.
- `staticHold`: `v12 <= 100 px/s`, target speed `<= 25 px/s`.

## Required Metrics

For each candidate and slice:

- Euclidean shifted-target visual error: mean, p95, p99, max.
- Current-position distance: mean, p95, p99, max.
- Current-position overshoot: p95, p99, max, rates `>0.5`, `>1`, `>2`, `>4px`.
- Offset-0 direction overshoot and candidate-target direction overshoot with the same p/rate metrics.
- Signed mean and lead/lag rate for current-position direction.

## Adoption Rule

A brake candidate must reduce acute-stop current-position p99/max/tail rates without materially worsening normalMove/highSpeed p95 or staticHold jitter.
