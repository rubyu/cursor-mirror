# Cursor Prediction POC v7 Final Report

## Decision

The current best model is `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback`.

This model should be promoted as the next integration candidate. It replaces fragile adaptive-gain switching with a short-window least-squares velocity fit, guarded by confidence checks and cold-start history reset.

## Best Aggregate Score

| Candidate | Runs | Weighted | linear-fast p95/p99/max | short-jitter p95/p99/max | linear-slow p95/p99/max |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 3 | 19.769 | 12/44/47 | 11/12/12 | 12/12/539 |
| adaptive v1 | 1 | 18.411 | 12/18/18 | 12/12/12 | 12/15/539 |
| previous LSQ | 2 | 18.783 | 12/25/30 | 12/12/12 | 12/12/539 |
| coldstart LSQ span320 | 1 | 18.224 | 12/16/16 | 12/12/12 | 12/12/539 |
| coldstart LSQ span380 | 3 | 12.378 | 12/17/24 | 12/12/12 | 12/12/12 |

## Model Shape

- Fit velocity from the last `72 ms` of cursor samples.
- Use DWM timing with an explicit `8 ms` horizon cap.
- Require enough fresh samples and a high-efficiency path before predicting.
- Reset history on discontinuities: sample gaps, implausible speed spikes, or large one-sample displacement.
- Use a short low-horizon period after reset to avoid startup overshoot.
- Fall back to exact cursor position for low-confidence or oscillatory motion.

## Interpretation

The adaptive-gain latch branch improved individual patterns but did not converge. It traded failures between `linear-fast`, `short-jitter`, and `linear-slow`.

The coldstart-reset LSQ model is stable across three runs:

- `linear-fast` has only one frame above `18 px` and none above `30 px`.
- `linear-slow` stays clean with no `539 px` startup outlier.
- `short-jitter` remains bounded at `12/12/12`, but does not recover the baseline p95 of `11`.

## Recommendation

Stop POC v7 model-family search here and integrate `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` as the next product candidate.

Further work should focus on product integration and real-feel validation. A new model family should be opened only if recovering the last `1 px` of `short-jitter` p95 becomes more important than preserving the clean fast/slow behavior.
