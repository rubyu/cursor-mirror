# Step 1 Notes

## Rerun

```powershell
node poc\cursor-prediction-v11\scripts\audit-step1.js
```

The script reads the three repository-root ZIP files directly and regenerates this directory's Step 1 artifacts.

## Split

The proposed split is scenario-unit and hash-shuffled:

- Train: 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16, 17, 19, 20, 22, 25, 27, 28, 31, 33, 36, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 60, 62, 63
- Validation: 1, 21, 24, 26, 30, 32, 35, 39, 53, 61
- Test: 0, 11, 12, 14, 18, 23, 29, 34, 37, 59

Do not randomly split individual rows. That would leak neighboring time steps, the same control-point curve, and the same hold/resume interval into evaluation.

## Caveats

- The stress package's 90% / 32-thread load-generator setting is user-supplied context and does not appear inside the ZIP metadata.
- Normal and stress long recordings have different motion script seeds. Treat them as two load-condition corpora, not exact paired replays.
- The short sanity package has 8 scenarios. It is useful for quick parser sanity checks only, not Step 2 model selection.
- Runtime scheduler thread profile is unavailable in metadata, so scheduler health should be inferred from trace timing fields.

## Step 2 Handoff

Recommended next step: generate a compact manifest keyed by `sourceZip + scenarioIndex + sample/window index`, attach the split and categories from `scores.json`, then evaluate deterministic baselines before any learned model work.
