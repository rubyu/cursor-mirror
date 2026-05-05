# Step 4 Notes

## Rerun

```powershell
node poc\cursor-prediction-v12\scripts\run-step3-step4.js
```

## Target Semantics

- `predictionTargetTicks`: runtime scheduler target when available.
- `presentReferenceTicks`: DWM `QpcVBlank`; often current or previous vblank.
- `v9_target`: use `predictionTargetTicks` when present, otherwise advance `presentReferenceTicks` or DWM vblank to the next future vblank.
- `v9_present_corrected`: advance `presentReferenceTicks` to the next future vblank.

Raw `presentReferenceTicks` is audited but not used directly as a prediction label when it is in the past.

## Bias Sign

Signed error is `dot(prediction - label, motionDirection)`. Negative values are lag; positive values are lead. This is more useful than x/y signed error because the generated motion is not axis-aligned.
