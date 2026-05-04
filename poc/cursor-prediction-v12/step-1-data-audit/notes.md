# Step 1 Notes

## Rerun

```powershell
node poc\cursor-prediction-v12\scripts\audit-and-split.js
```

## Contamination Findings

- m070055: 149 external move rows, 112 after warmup, scenarios 0.
- m070248: 33 external move rows, 1 after warmup, scenarios 0.

The exclusion marker is intentionally strict: only `event=move` rows with `hookExtraInfo == 1129139532` are trusted as MotionLab-generated cursor motion. The trace can still contain poll/reference/scheduler rows around contamination, so the cleaning manifest drops nearby time windows as well.

## Why m070055 Drops Scenario 0

The `m070055` contamination is not limited to warmup. It continues into the first scenario and reaches 2461.235 ms. A narrow window would keep the rest of scenario 0, but the early recovery period could still contain position-history artifacts. Dropping one scenario from one package is cheaper and cleaner.

## Data Hygiene

No raw ZIP, expanded CSV, sample-level cache, checkpoint, or model artifact is written by this step. The script only emits JSON/Markdown summaries and a split manifest.
