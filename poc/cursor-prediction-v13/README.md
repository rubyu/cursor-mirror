# Cursor Prediction v13

GPU deep-learning capacity probe for the v9, input-blocked Motion Lab dataset.

Artifacts:

- `report.md`: human-readable experiment report.
- `scores.json`: machine-readable metrics.
- `strict-holdout-report.md`: strict retrain-with-held-out-machine/refresh report.
- `strict-holdout-scores.json`: machine-readable strict holdout metrics.
- `notes.md`: rerun command and artifact policy.
- `scripts/run-deep-learning-gpu.py`: reproducible script.
- `scripts/run-strict-holdout-gpu.py`: strict holdout retraining script.
- `scripts/normalize-report.js`: report normalization helper.

The experiment uses POC 12's cleaning and split manifest. No raw ZIPs, expanded CSVs, model checkpoints, or feature caches are stored here.
