# Step 3 Notes

## Rerun

```powershell
node poc\cursor-prediction-v11\scripts\run-step3-learned-gates.js
```

## Causality

All product-eligible predictors use only fields available at the product poll anchor: prior referencePoll samples, causal scheduler delay from the latest scheduler poll, current horizon, and current position. The label is used only after prediction for loss computation.

## Product Eligibility

- Product-eligible: `ls12_baseline`, `causal_speed_gate`, `ridge_residual_linear`, `ridge_residual_segmented_horizon`, `piecewise_speed_horizon_residual`.
- Non-product oracle: `oracle_category_gate`, because it uses script-derived hold/resume/moving category.

The residual models include scheduler delay. That is product-eligible only if the runtime exports the latest scheduler timing sample to the predictor at anchor time; otherwise train a no-scheduler variant in Step 4.

## Tiny MLP

No dependency-based MLP was run in this step. A small piecewise residual model was used instead because it is deterministic, CPU-light, and avoids introducing a training framework before the FSMN/MLP search stage.

## Selection Protocol

Ridge coefficients and piecewise residual means are fit on train scenarios only. Ridge lambda and causal gate thresholds are selected on validation. Test is evaluated after selection and is not used for choosing coefficients or thresholds.
