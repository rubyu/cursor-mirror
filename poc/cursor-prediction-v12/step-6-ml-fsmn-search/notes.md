# Step 6 Notes

## Rerun

```powershell
node poc\cursor-prediction-v12\scripts\run-step5-step6.js
```

## Training

Training is limited to the `train` split and happens entirely in memory. The script writes only aggregate scores and reports. No model checkpoint is persisted.

## Family Mapping

- FSMN: explicit finite-memory velocity projections.
- CSFSMN: compact shared memory summaries.
- VFSMN/VFSMNv2: horizon-conditioned memory projections.
- CVFSMN/CVFSMNv2: compact variable summaries with path and context features.
- MLP: fixed tanh hidden layer with ridge head, used as a small nonlinear precision probe.
