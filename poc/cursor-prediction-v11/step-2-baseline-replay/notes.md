# Step 2 Notes

## Rerun

```powershell
node poc\cursor-prediction-v11\scripts\run-step2-baselines.js
```

## Evaluation Contract

- Anchor: product `poll` rows from `trace.csv`.
- History: only `referencePoll` rows with elapsed time <= anchor time.
- Label: interpolated `referencePoll` position at anchor + horizon.
- Horizons: 0, 8, 16.67, 25, 33.33, 50 ms.
- Split: scenario-level Step 1 train/validation/test.
- Sanity package: parser smoke only, not model selection.

## Leakage Notes

No future point is used by a predictor. The only future lookup is the label interpolation after the prediction is produced. Baselines that use `movementCategory` are marked non-product-eligible when the category is script-derived oracle information.

## Next Step

For Step 3, start with the best product-eligible validation model from `scores.json`, then add a small learned residual/gate and compare against the same validation/test score tables.
