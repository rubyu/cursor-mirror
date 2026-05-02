# Cursor Prediction v3

This PoC investigates whether Cursor Mirror can improve visible cursor tracking beyond the current product baseline.

## Goal

Find a predictor that improves the user-visible failure cases without sacrificing the reliable low-risk behavior of the current model.

The current baseline is:

- poll-anchored cursor position;
- DWM-aware next-vblank horizon when valid;
- last-two-sample velocity extrapolation;
- gain `0.75`;
- safe fallback to hold/current position.

## Success Criteria

A candidate can move toward productization only if it satisfies all of the following against the baseline:

- overall mean error is not worse;
- overall p95 error is not worse;
- overall p99 error is not worse;
- high-speed p95/p99 error improves materially;
- stop/settle residual error improves materially;
- low-speed and fine-control regions do not regress;
- the runtime shape can be reduced to a lightweight, allocation-free or near allocation-free C# implementation.

## Phase Rules

- Experiments must run under `poc/cursor-prediction-v3/`.
- Each phase gets its own directory named `phase-N short-name/`.
- Each phase must produce `report.md`, `experiment-log.md`, `scores.json`, and any reproducibility files needed to rerun it.
- Scores must be written as JSON, not only as prose.
- Heavy CPU/GPU experiment work must be run by only one sub-agent at a time.
- Real Windows hooks must not be installed or exercised by tests or PoC scripts.
- Trace zip files in the repository root are input data only and must not be modified.
- The app source tree must not be edited by PoC phases unless the supervisor explicitly starts a product implementation phase.

## Primary Questions

1. Which visible failure modes remain after the v2 DWM-aware baseline?
2. Are the failures dominated by high speed, acceleration, stopping, direction changes, poll jitter, DWM horizon variation, or hook/poll disagreement?
3. Can deterministic filters improve those failures without tail regressions?
4. Is there a learned oracle that demonstrates a meaningful accuracy ceiling?
5. Can any learned or complex behavior be distilled into a product-safe lightweight model?

