# Step 2 Notes

## Manifest Files

- `scores.json`: full Step 2 scores plus cleaning and split definitions.
- `split-manifest.json`: compact manifest intended for downstream model scripts.

## Leakage Rules

Do not sample-randomize rows across train/validation/test. The generated cursor path is temporally dense and scenario-local, so sample-level randomization would put nearly identical neighboring positions into different splits.

For machine and refresh holdouts, the holdout package/group is the test set. The non-holdout packages can still use the base scenario split internally for training/validation selection.

## Downstream Loader Contract

A downstream loader should:

1. Read source ZIP files from the repository root.
2. Apply per-package `dropScenarios`.
3. Drop warmup rows.
4. Drop rows inside per-package contamination windows.
5. Attach `baseScenarioSplit`, `machineKey`, and `refreshBucket` labels from the manifest.

This keeps POC 12 reproducible without storing large derived datasets in git.
