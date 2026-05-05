# Cursor Prediction v10 Interim Report

Generated: 2026-05-03

## Summary

v10 started as a synthetic MotionLab-style data project and then checked the
best synthetic candidates against real TraceTool captures.

The most important result is that synthetic-only gates did not transfer cleanly
to real traces. A real-trace retuned tree gate did find a small safe
improvement, but the evidence is limited to two usable sessions.

## Data

- Synthetic pilot: 2,000 scripts, 768,000 evaluated rows.
- Synthetic stress set: 10,000 scripts, 3,840,000 evaluated rows.
- Real trace replay: 6 latest trace packages read, 2 usable sessions,
  110,945 evaluated rows.
- No per-frame CSV, raw ZIP copies, dependency installs, checkpoints, or cache
  outputs were written by v10.

## Key Results

### Synthetic Baselines

Phase 1 showed that `least_squares_w50_cap24` was much stronger than the
current baseline on synthetic scripts:

- current baseline mean/p95/p99: `3.099 / 16.382 / 26.273 px`
- LS mean/p95/p99: `1.209 / 4.599 / 7.731 px`
- LS regression vs baseline: `>5px = 978`

This made LS useful as a teacher candidate but not safe as a direct product
candidate.

### Synthetic Stress And Gates

Phase 2 increased high-speed and stress coverage:

- rows with `>=2000 px/s`: `230,880`
- raw `least_squares_w50_cap36` mean/p95/p99: `7.569 / 25.925 / 67.125 px`
- raw LS regression: `>5px = 289,965`, `>10px = 118,261`

Phase 3 and 4 found synthetic gates that could keep large synthetic regressions
at zero while producing small improvements. Phase 4 strict:

- mean/p95/p99: `11.966 / 38.725 / 77.825 px`
- regression: `>5px = 0`, `>10px = 0`

### ML/FSMN Teachers

Phase 5 tried CPU-only learned teachers, including FSMN-lite style models.
The best raw teacher was `csfsmn_lite_ridge`:

- mean/p95/p99: `10.971 / 35.075 / 72.475 px`
- regression: `>5px = 1002`, `>10px = 197`

Gating made learned teachers safe, but did not improve the tail enough to beat
the synthetic strict gate cleanly.

Phase 6 residual distillation inside the strict gate was effectively at the
noise floor:

- best strict mean delta vs phase4 strict: `-0.0103 px`
- p95/p99/max delta: `0 / 0 / 0`
- regression vs phase4 and CV: `>5px = 0`, `>10px = 0`

### Real Trace Replay

Phase 7 showed the synthetic gate did not transfer:

- baseline mean/p95/p99: `17.136 / 84.025 / 240.025 px`
- raw LS mean delta: `-1.121 px`, but `>5px = 15,575`, `>10px = 10,866`
- synthetic strict gate mean delta: `+0.496 px`, with `>5px = 3,428`,
  `>10px = 2,085`

Phase 8 retuned a simple real-trace tree gate:

- best gate: `real_tree_blend_cv_ls_w50_cap36_ls0p25_1`
- candidate: `blend_cv_ls_w50_cap36_ls0p25`
- cross-session mean/p95/p99: `16.946 / 83.625 / 239.725 px`
- regression: `>5px = 0`, `>10px = 0`
- mean delta vs baseline: `-0.190 px`
- advanced/fallback uses: `30,944 / 80,001`

This is the best current product-shaped signal, but the evidence is too thin
for product integration.

## Synthetic/Real Gap

The main mismatch is distributional:

- real trace is dominated by near-stop rows: `0-25 px/s` is about `87.9%`;
  synthetic phase2 is about `3.6%`.
- real trace history is dense: history p50/p95 are about `101 / 101`;
  synthetic phase4-test is about `21 / 24`.
- real curvature and acceleration statistics are very different:
  real curvature p95 is `0`, while synthetic phase4-test curvature p95 is
  `154.239`.

This explains why synthetic risk thresholds selected the wrong regions on real
trace replay.

## Recommendation

Do not productize the synthetic v10 gates yet.

The next productive step is more real data, not a larger synthetic-only model:

1. Collect more TraceTool sessions that include `runtimeSelfSchedulerPoll`
   anchors.
2. Rebalance MotionLab synthetic generation to match real near-stop and dense
   history distributions.
3. Re-run real-trace cross-session gate tuning.
4. Only after real-trace results are stable, move the best real gate into a
   Calibrator A/B run.

For now, `real_tree_blend_cv_ls_w50_cap36_ls0p25_1` is the safety anchor for the
next experiment, not a product candidate.
