# Cursor Prediction POC v26 - Guard-Free Model Search

## Goal

Find whether the cursor predictor can learn stop and abrupt-deceleration behavior directly, without relying on a product-side runtime guard.

The user-visible problem is that a learned predictor can look stable while moving, but overshoot the real cursor when motion suddenly decelerates to a stop. v26 treats that as a training and scoring problem instead of a runtime clamp problem.

## Rules

- Runtime features must use only current and past cursor samples.
- Future cursor positions are labels and metrics only.
- Candidate scoring must include braking-side lead and stationary jitter, not only aggregate visual error.
- Product-side static/stop guards are not allowed for learned candidates in this POC.
- CPU inference cost must remain visible in the score table.
- Large intermediate datasets and frequent checkpoints are intentionally not written.

## Steps

1. `step-01-guard-free-loss-search`
   - Reuses the v25 runtime-shaped horizon loader.
   - Trains direct and CV-residual MLPs with stop/brake/asymmetric lead losses.
   - Compares them with guard-free CV baselines, continuous soft-brake baselines, and the current generated SmoothPredictor.

## Current Finding

The first completed run did not produce a learned model that dominates the simple CV baselines.

The learned asymmetric/stop-weighted models can suppress braking-side lead, but they pay for it with global lag and worse visual p95. This matches the observed SmoothPredictor failure mode: safe braking can become conservative movement.

Next work should move from row-level labels to explicit sudden-stop scenario families and sequence-level visible error.
