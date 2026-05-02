# Phase 5 Robustness and Generalization Checks

## Scope
- Product target: poll anchors / `dwm-next-vblank`.
- Baseline: `gained-last2-0.75`.
- Reconstructed candidates on the same sequence mask: deterministic baseline, `sequence-gru-residual-h32-huber`, and Phase 4 gated hybrid `speed>=500_and_horizon>=12`.
- Compatible trace coverage: one v2 DWM trace. The older trace `cursor-mirror-trace-20260501-000443.zip` is incompatible because it is missing dwmQpcRefreshPeriod, dwmQpcVBlank.

## Same-Mask Result
- Test baseline mean 0.947 px, p95 3.005 px, p99 18.939 px.
- Test standalone GRU mean 0.987 px, p95 3.005 px, p99 18.918 px.
- Test gated hybrid mean 0.940 px, p95 2.977 px, p99 19.228 px.
- Gated delta vs baseline on test: mean -0.0071 px, p95 -0.0274 px, p99 0.2892 px, max 0.0000 px.
- All evaluated anchors gated delta vs baseline: mean -0.0088 px, p95 -0.0033 px, p99 -0.3149 px.

## Robustness Findings
- Temporal stability is mixed: block deltas are small and sign-changing rather than a stable improvement across the trace.
- Low-speed/standing anchors remain baseline-favored; the gate mostly avoids them, but the standalone GRU regresses that bulk.
- Tail asymmetry is fragile: gated regressions over 1 px = 1105, over 5 px = 9, over 10 px = 0; improvements over 1 px = 1645, over 5 px = 23, over 10 px = 0.
- Phase 4 gate modifies 474 / 23787 test anchors (1.993%).
- Validation-only threshold grid selected `speed>=250_and_horizon>=4` with validation mean 0.584 px vs baseline 0.597 px; this is sensitivity analysis, not a test-selected replacement.

## Decision
- Proceed to Phase 6 as deployable GRU/gated predictor: no.
- Reason: The gated hybrid gain is small and fragile: mean/p95 improve slightly, but p99 or low-speed/tail behavior does not satisfy the Phase 5 decision rule.
- Phase 6 recommendation: Distill only the analysis insights and gate/risk features first; do not promote the GRU itself as the Phase 6 product candidate.

See `scores.json` for per-block metrics, risk slices, gate counts, threshold grid, and representative tail rows.
