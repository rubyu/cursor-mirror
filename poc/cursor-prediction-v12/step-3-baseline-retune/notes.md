# Step 3 Notes

## Rerun

```powershell
node poc\cursor-prediction-v12\scripts\run-step3-step4.js
```

## Evaluation Contract

- Manifest: `poc/cursor-prediction-v12/step-2-clean-split/split-manifest.json`.
- Anchors: clean `poll` and `runtimeSchedulerPoll`.
- History: clean causal `referencePoll` rows only.
- Labels: clean interpolated `referencePoll` positions at the selected horizon target.
- Label interpolation is rejected when the surrounding reference gap exceeds 60000 us.

## Product Approximation

`product_current_cv_gain100_cap12_24_hcap10_offset2` approximates the current production ConstantVelocity default. It intentionally keeps the +2 ms target offset and 10 ms DWM horizon cap so Step 4 can quantify whether that offset is helping or creating one-sided lead/lag.

## Split Hygiene

Rows are not sample-randomized. Split labels come from scenario indices in the Step 2 manifest. Holdout reports group packages by machine fingerprint and refresh bucket.
