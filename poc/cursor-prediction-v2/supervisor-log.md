# Cursor Prediction v2 Supervisor Log

## 2026-05-01: Phase 1 Delegation
Phase 1 was delegated to sub-agent Laplace.

Scope:
- Work only under `poc/cursor-prediction-v2/phase-1 data-audit-timebase/`.
- Read the root trace package `cursor-mirror-trace-20260501-091537.zip`.
- Do not install or run a real Windows hook.
- Audit trace format v2 data, including hook movement samples, cursor polling samples, and DWM timing samples.

Supervision rule:
- CPU/GPU-heavy experiment work is run by one sub-agent at a time.
- The supervisor reviews each phase before assigning the next phase.

Expected decision after Phase 1:
- Whether poll samples are reliable enough to become the primary ground truth.
- Whether DWM timing is stable enough to define display-relative target horizons.
- Which chronological split boundaries should be used by Phase 2.

## 2026-05-01: Phase 1 Review
Phase 1 completed successfully.

Accepted findings:
- Poll rows are complete enough to use as the visible-position ground truth, but poll intervals are jittery enough that labels must be timestamp/interpolation based.
- DWM timing is available on every poll row and the refresh period is stable around `16.668ms`.
- Hook and nearest poll positions diverge materially during motion, so hook coordinates should be treated as features, not labels.
- The recommended chronological split with `1s` gaps is accepted for Phase 2.

Phase 2 direction:
- Use poll `elapsedMicroseconds` as the label clock.
- Evaluate fixed horizons `4`, `8`, `12`, `16`, and `24ms`.
- Evaluate display-relative horizons based on the next DWM vblank where constructible.
- Report all metrics on train/validation/test splits, with primary model selection driven by validation and final ranking on test.
- Start with deterministic baselines before deep learning.

## 2026-05-01: Phase 2 Review
Phase 2 completed successfully.

Accepted findings:
- Fixed `4ms` is the easiest target and produced very low error, but it is not the best product proxy for visible presentation timing.
- `dwm-next-vblank` is constructible and stable enough to use as the primary product target for the next phases.
- For `dwm-next-vblank` with poll anchors, the best validation baseline is `gained-last2-0.75`.
- `dwm-next-vblank-plus-one` is a useful stress target but too long/noisy to be the primary target.
- Hook-anchor baselines are materially worse than poll-anchor baselines, so hook-derived features should be investigated carefully rather than assumed helpful.

Phase 3 direction:
- Use `poll` anchors and `dwm-next-vblank` as the primary error-anatomy target.
- Keep fixed `16ms` and `24ms` as comparison slices.
- Analyze failures by speed, acceleration, turn angle, horizon length, time since hook, time since poll, idle restart, and DWM phase.
- Produce feature schema candidates for Phase 4 neural and non-neural model search.

## 2026-05-01: Phase 3 Review
Phase 3 completed successfully.

Accepted findings:
- The Phase 2 baseline reconstruction exactly matched the accepted product path.
- The dominant error drivers are high-speed motion, high acceleration, high-horizon targets, and recent hook activity during fast movement.
- Speed-only gain gating barely helps, so speed should be a feature rather than the whole model.
- A residual-over-baseline learning target is preferred because the deterministic baseline is already near exact for most low-risk anchors.

Phase 4 direction:
- Search for best accuracy on the primary `dwm-next-vblank` target.
- Use residual-over-`gained-last2-0.75` as the main learned target.
- Try minimal tabular, rich tabular, and small sequence models.
- Use CUDA if available, but keep the sweep bounded and reproducible.

## 2026-05-01: Phase 4 Review
Phase 4 completed successfully on CUDA (`NVIDIA GeForce RTX 5090`).

Accepted findings:
- Standalone neural models did not beat the deterministic baseline on validation mean.
- The best validation-supported accuracy result is a gated hybrid over `sequence-gru-residual-h32-huber`.
- Test results improved mean and p95 slightly, regressed p99 slightly, and left max unchanged.
- The practical signal is gating: keep the deterministic baseline for low-risk anchors and apply learned correction only to high-risk anchors.
- The temporary 60Hz-only restriction discussed during the run was withdrawn; the original best-accuracy-first plan remains active.

Phase 5 direction:
- Robustness-check the gated hybrid and best standalone GRU against the deterministic baseline.
- Focus on high-speed, high-acceleration, long-horizon, low-speed standing, and segment-wise temporal stability.
- Treat the gated hybrid as a candidate only if it avoids meaningful tail regressions.

## 2026-05-01: Phase 5 Review
Phase 5 completed successfully.

Accepted findings:
- The gated hybrid reproduces a tiny mean/p95 improvement but regresses p99 and has nontrivial small regressions.
- Standalone GRU remains unsuitable because it regresses the low-risk/low-speed bulk.
- The gated hybrid should not proceed as a deployable predictor.
- There is only one compatible v2 DWM trace, so temporal blocks are the available generalization proxy.

Phase 6 direction:
- Do not distill the GRU directly into product code.
- Distill the analysis insights: risk features, DWM next-vblank target construction, and conservative gating.
- Search for lightweight deterministic candidates such as piecewise gain tables, conservative risk gates, tiny linear residuals, or no-op recommendations.
- A Phase 6 candidate must preserve p99/max and low-speed behavior, even if it gives up small mean gains.

## 2026-05-01: Phase 6 Review
Phase 6 completed successfully.

Accepted findings:
- No lightweight correction beats `gained-last2-0.75` strongly enough to productize.
- Piecewise gain tables can move mean by a few thousandths of a pixel, but the gains are below material threshold and can regress p95 or create many small regressions.
- The simplest acceptable product candidate is `baseline + DWM-aware next-vblank horizon`.
- The useful product improvement is therefore horizon selection and instrumentation, not a learned correction.

Phase 7 direction:
- Microbenchmark the product-shaped predictor hot path.
- Confirm zero-allocation design and estimate operation count/state size.
- Define replay/numerical parity checks against the PoC formulas.
- Keep Phase 7 focused on the accepted baseline/DWM-horizon candidate.

## 2026-05-01: Phase 7 Review
Phase 7 completed successfully.

Accepted findings:
- Product-shaped C# predictor hot path meets the latency target by a wide margin.
- Allocation check reports zero bytes over two million predictions.
- Replay parity against the reference formula is exact for the checked poll predictions.
- Runtime risk is not the blocker; correctness, DWM horizon safety, and fallback behavior are the product concerns.

Phase 8 direction:
- Recommend implementing `baseline + DWM-aware next-vblank horizon` with gain `0.75`.
- Do not productize neural, GRU, gated hybrid, ridge, or gain-table corrections.
- Require instrumentation counters and replay/parity tests around DWM horizon construction.
