# Experiment Log

- Evaluated current DWM-aware last2 gain 0.75 and hold-current baselines.
- Evaluated fixed gain grid: 0, 0.25, 0.5, 0.625, 0.675, 0.7, 0.725, 0.75, 0.8, 1.
- Fitted train-session global gain, speed-binned gain, horizon-binned gain, and speed+horizon piecewise gain.
- Fitted simple alpha-beta constant-velocity smoother parameters on train sessions.
- Ran session cross-validation in both directions and contiguous first-70%/last-30% validation inside each session.
- Wrote `scores.json` and `report.md`.
