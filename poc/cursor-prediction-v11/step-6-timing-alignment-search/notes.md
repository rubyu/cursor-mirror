# Step 6 Notes

## Rerun

```powershell
node poc\cursor-prediction-v11\scripts\run-step6-timing-alignment-search.js
```

## Causality

Product-eligible candidates use only causal history, product poll timing, scheduler-delay bins, and predictions available at the anchor. Load-id and script movement-category offset candidates are analysis-only and are not selectable.

## Offset Semantics

The target label remains anchor + requested horizon. A candidate only changes the internal horizon passed into the predictor. Negative internal horizons are clamped to 0 ms; positive offsets may extend to 66.67 ms for the 50 ms horizon.

## Selection

Validation chooses the candidate and test is read afterward. Tail guardrails are intentionally conservative because timing offsets can reduce lag while increasing resume p99.

Selected candidate: `step4_gain_1p15`.
