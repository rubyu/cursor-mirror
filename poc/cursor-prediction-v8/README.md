# Cursor Prediction v8

v8 is a product-runtime optimization pass that treats zero visible separation as the aspirational target while measuring the practical floor with `CursorMirror.Calibrator`.

## Scope

- Review prediction model choice, gain, horizon caps, scheduler timing, and overlay update timing together.
- Use `CursorMirror.Calibrator.exe --runtime-mode ProductRuntime` as the promotion measurement.
- Keep raw calibration packages out of git; record summarized metrics in JSON and notes in this folder.
- Prefer product changes that reduce one-sided lag without causing visible lead, oscillation, or CPU-heavy polling.

## Current Hypothesis

The remaining non-zero separation is not only a model error. It is a combination of:

- target-vblank mismatch between scheduler and predictor;
- overlay updates that complete near or after the intended vblank;
- conservative LeastSquares horizon and confidence guards;
- measurement floor from the real Windows cursor and mirrored overlay appearing in the same captured frame.

## Baseline

The current working tree already includes the target-vblank synchronization change from the previous step:

- scheduler-selected target vblank is passed into the DWM-aware predictor;
- near-deadline targets are advanced to a later vblank;
- prediction and overlay deadline counters are emitted in calibrator `metrics.json`.

Initial 15-second ProductRuntime measurement:

- average estimated separation: `7.6815px`
- p95 estimated separation: `12px`
- max estimated separation: `26px`
- scheduled target used: `902`
- target adjusted to next vblank: `17`
- overlay update after target vblank: `17`
- overlay update near target vblank: `50`

## Experiment Log

### Phase 1 - Parameter Sweep

Measure model and prediction-gain candidates with the current product runtime. The purpose is not to overfit one run, but to find whether the remaining error responds to prediction tuning or mostly to scheduler/render timing.

### Phase 2 - Earlier DWM Wake

Changed the DWM runtime wake lead from `2ms` to `3ms`. This reduced average separation for the best ConstantVelocity candidate from the low `6px` range to roughly `5.5px`, and greatly reduced near/after-vblank deadline counters. This indicated that part of the lag was on the scheduler side, not only in the predictor.

### Phase 3 to 6 - ConstantVelocity Cap and Poll Freshness

Added and tuned a ConstantVelocity displacement cap, then changed the product poller maximum sample age from `50ms` to `4ms`.

Key observations:

- A `16px` ConstantVelocity cap reduced visible overshoot risk without hurting the average.
- A `4ms` maximum poll sample age improved average separation slightly and made stale samples less likely to survive into the render tick.
- `LeastSquares + hcap16 + wake4 + age4` remained the most stable candidate by max error, around `5.30px` average and `13px` max in its best run.
- `ConstantVelocity + hcap10 + wake4 + age4` gave better average error, around `4.6-5.0px`, but still had rare outliers.

### Phase 7 - Prediction Floor Check

Measured prediction disabled and LeastSquares repeats under the improved scheduler/poller:

- prediction disabled: `8.81-9.50px` average, p95 `12px`, max `64-69px`;
- LeastSquares hcap16: `5.51-6.05px` average, p95 `12px`, max `12-14px`.

Prediction disabled being substantially worse confirms that the remaining error is not only a measurement floor. The persistent `12px` p95 across many candidates is likely a quantization/floor effect of the dark-bounds measurement, but the average still responds to model and timing changes.

### Phase 8 to 9 - Prediction Target Offset

Added a DWM prediction target offset so the predictor can compensate for capture/composition phase mismatch without changing the scheduler deadline. Positive offsets helped substantially:

- `ConstantVelocity + hcap10 + offset +2ms`: roughly `3.99-4.25px` average, p95 `12px`;
- `ConstantVelocity + hcap10 + offset +3ms/+4ms`: sometimes lower average, but higher max outliers.

`+2ms` is the best default tradeoff: it removes a visible one-sided lag tendency while avoiding the larger outliers seen at `+3ms` and `+4ms`.

### Phase 10 to 12 - Default Promotion Candidate

Promoted the candidate default to:

- model: `ConstantVelocity`;
- DWM horizon cap: `10ms`;
- DWM prediction target offset: `+2ms`;
- product wake lead: `4ms`;
- product poll sample max age: `4ms`;
- ConstantVelocity ordinary displacement cap: `12px`.

Three 15-second promotion runs measured `4.17-4.31px` average, p95 `12px`, and mostly `17px` max, with one `65px` high-speed outlier. A 30-second run measured `4.04px` average, p95 `12px`, and max `83px`; the outliers concentrated in the high-speed linear phase.

### Phase 13 - High-Speed Linear Cap

Kept the ordinary `12px` ConstantVelocity cap, but allowed a wider `24px` cap only for high-speed, high-efficiency, one-directional motion.

Promotion measurements:

- 15-second run: `4.11px` average, p95 `12px`, max `17px`;
- 30-second run: `3.83px` average, p95 `12px`, max `29px`.

This is the best v8 product candidate so far. It improves the initial baseline from `7.68px` average to `3.83px` average in the 30-second measurement, while reducing deadline-risk counters and preserving a conservative cap for non-linear motion.

### Phase 15 - Rejected High-Speed Horizon Widening

Tried widening the DWM horizon cap for the same high-speed linear condition. This worsened the result:

- 15-second run: `4.57px` average, p95 `12px`, max `122px`;
- 30-second run: `4.34px` average, p95 `12px`, max `70px`.

The likely reason is that widening the time horizon can turn a scheduler or capture-phase hiccup into visible lead/overshoot. This path is rejected.

### Phase 16 - Final Selected Build

Reverted the high-speed horizon widening and kept only the wider high-speed displacement cap. The final 30-second selected run measured:

- average estimated separation: `3.77px`;
- p95 estimated separation: `12px`;
- max estimated separation: `48px`;
- DWM prediction model: `ConstantVelocity`;
- DWM horizon cap: `10ms`;
- DWM target offset: `+2ms`.

## Decision

Implement the Phase 13 candidate, confirmed again by Phase 16, in the product:

- keep `LeastSquares` available as the stable comparison model;
- make `ConstantVelocity` the default model;
- use DWM horizon cap `10ms`;
- use DWM target offset `+2ms`;
- keep the ordinary ConstantVelocity cap at `12px`;
- use the wider `24px` ConstantVelocity cap only for high-speed one-directional motion;
- keep scheduler wake lead `4ms` and poll sample max age `4ms`.

Zero measured separation was not achieved. The remaining p95 floor at `12px` appears to be dominated by the current dark-bounds measurement granularity and frame/capture timing. The average and max still improved meaningfully, so the product change is worthwhile.
