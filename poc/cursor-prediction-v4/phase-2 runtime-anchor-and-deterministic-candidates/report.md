# Phase 2 Report

## Recommendation

No product-feasible candidate clears the decision rule. The lowest product-feasible p99 is `mixed_hook_when_disagree_ge2_age16` at 34.200 px, but it fails at least one high-risk or regression guard.

Keep the Phase 1 product baseline as the product-feasible default for now. Deterministic gates are useful diagnostics, but this trace does not justify shipping a fixed gate as the main predictor.

## Strongest Findings

- Baseline reproduction matched Phase 1: mean 1.695, p95 6.771, p99 36.245, max 682.467 px.
- The hardest product-feasible slices remain fast and abrupt motion: baseline >=2000 px/s p95/p99 88.444/161.659 px and >=100k px/s^2 p95/p99 84.600/165.261 px.
- Hook-derived runtime inputs are feasible but not a clean win on this trace; stale hook age and sparse disagreement limit their value.
- The best hypothetical insight is cadence/input freshness, but only as a non-comparable bound: `nonproduct_reference_cadence_8ms_target_8ms` reaches p95 5.712 and p99 38.042 using dense referencePoll anchors and a fixed target. At product poll times, `nonproduct_reference_latest_anchor_velocity` is worse, with p99 95.560, so reference input alone is not enough.

## Phase 3 Direction

Prioritize runtime anchor/cadence instrumentation before learned residuals. Capture hook age, latest hook position, poll interval, DWM horizon, and product-vs-hook disagreement in product replay tests, then validate whether a fresher anchor near compose time reduces the high-speed/high-accel tail across multiple traces. A learned residual should be gated behind that cleaner runtime anchor story.
