# Cursor Prediction v10 POC

v10 investigates whether MotionLab-style synthetic scripts can produce a
better cursor predictor, then checks the best synthetic candidates against real
TraceTool captures.

The main synthetic dataset is a deterministic Bezier motion script plus its
seed, not a pre-expanded per-frame CSV. Real trace phases read root-level
`cursor-mirror-trace-*.zip` packages in place without extraction.

## Purpose

- Generate many repeatable cursor motion scripts with controlled stress cases.
- Keep the canonical dataset small enough to review, diff, and regenerate.
- Evaluate causal baseline predictors by sampling scripts on demand in memory.
- Measure missing-history robustness without writing large derived datasets.
- Keep this POC CPU-only and dependency-free.

## Data Policy

The canonical synthetic artifacts are:

- `runs/scripts.synthetic.jsonl`
- `runs/scripts.synthetic.phase2.jsonl`

Each JSONL row is one `cursor-mirror-motion-script/1` object containing the
seed, bounds, duration, Bezier control points, speed profile, sampling metadata,
and condition tags. Evaluation samples are generated in memory and discarded.

The POC intentionally does not write raw ZIP packages, frame-level CSV files,
feature caches, checkpoints, `node_modules`, or ML framework outputs.

## Reproduction

From the repository root:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-pilot.js --count 2000 --seed 10010
node poc\cursor-prediction-v10\scripts\run-v10-phase2.js --count 10000 --seed 20020
node poc\cursor-prediction-v10\scripts\run-v10-phase3.js --limit-scripts 5000 --train-sample-rows 100000 --monotonic-trials 20
node poc\cursor-prediction-v10\scripts\run-v10-phase4.js --limit-scripts 3000
node poc\cursor-prediction-v10\scripts\run-v10-phase5.js --limit-scripts 3000 --train-sample-rows 80000 --validation-sample-rows 120000
node poc\cursor-prediction-v10\scripts\run-v10-phase6.js --limit-scripts 3000
node poc\cursor-prediction-v10\scripts\run-v10-phase7-real-trace.js --zip-limit 6
node poc\cursor-prediction-v10\scripts\run-v10-phase8-real-gate.js --zip-limit 6
```

Optional smoke run:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-pilot.js --count 500 --seed 10010
```

Outputs:

- `scores.json`
- phase-specific `phase-*.json` and `phase-*.md` reports
- `final-report.md`
- compact script JSONL files under `runs/`

## Phase Structure

- Phase 0: define and generate the compact synthetic script dataset.
- Phase 1: evaluate causal CPU-only baseline predictors.
- Phase 2: increase high-speed/stress coverage and test classical safe gates.
- Phase 3: learn CPU-light gates over synthetic data.
- Phase 4: map the synthetic strict/balanced/aggressive Pareto frontier.
- Phase 5: test CPU-only ML/FSMN-lite teachers.
- Phase 6: distill residuals inside the strict synthetic gate.
- Phase 7: replay synthetic candidates on real TraceTool captures.
- Phase 8: retune a real-trace gate and explain the synthetic/real gap.

## Current Conclusion

Synthetic-only gates did not transfer cleanly to real traces. The best
real-trace cross-session candidate is
`real_tree_blend_cv_ls_w50_cap36_ls0p25_1`: it keeps `>5px` and `>10px`
regressions at zero on the two usable real sessions while improving mean error
by about `0.19 px`.

This is not yet enough evidence for product integration. The next step is to
collect more real traces with `runtimeSelfSchedulerPoll` anchors and update the
synthetic generator to match the real near-stop, dense-history, and
acceleration/curvature distributions.
