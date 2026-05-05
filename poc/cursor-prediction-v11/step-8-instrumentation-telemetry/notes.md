# Step 8 Notes

## Scope

This step intentionally changes data observability instead of selecting a new predictor. Step 7 made near-zero error implausible from the old causal fields alone, so new data must be collected before another fair model search.

## Product Eligibility

The Motion Lab `movementPhase`, `holdIndex`, and `phaseElapsedMilliseconds` fields are generated-data labels. They are analysis-only until a product-shaped runtime feature, such as transition age inferred from cursor history, is implemented.

The trace `predictionTargetTicks`, `presentReferenceTicks`, `schedulerProvenance`, and `sampleRecordedToPredictionTargetMicroseconds` fields are closer to product runtime observability because they are derived from scheduler/DWM timing paths.

## Rerun

```powershell
scripts\test.ps1 -Configuration Debug
```

Then rebuild a package and collect fresh Motion Lab normal/stress recordings before the next scoring phase.
