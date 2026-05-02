# Experiment Log

- 2026-05-02T10:31:43.617Z: Created Phase 5 distillation experiment under `phase-5 distillation/`.
- Read `phase-2 dataset-builder/dataset.jsonl` with 27,738 rows.
- Reused Phase 4 fold policy: fit first 70% of one session, select last 30%, evaluate cross-session in both directions.
- Trained safe capped ridge residual candidates.
- Trained piecewise residual tables keyed by speed, acceleration/turning proxy, and scheduler lead flags.
- Trained thresholded table variants with validation-enabled cells only.
- Trained confidence-gated ridge variants.
- Applied stricter selection: zero >5px, prefer zero >3px, p95 delta <= +0.05 px, p99 improvement across held-out folds.
- Wrote `scores.json`, `report.md`, and this log.
