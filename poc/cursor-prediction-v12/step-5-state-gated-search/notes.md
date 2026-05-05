# Step 5 Notes

## Rerun

```powershell
node poc\cursor-prediction-v12\scripts\run-step5-step6.js
```

## Product-Safe Rule

The gate does not use `movementPhase`, `holdIndex`, or any future label. It uses only causal referencePoll history and runtime timing/context available to the product.

## Objective

Selection uses p95, p99, >5px, >10px, signed lag, and lag-rate penalties. This intentionally avoids choosing a candidate that improves p95 while creating a bad tail or one-sided lag.
