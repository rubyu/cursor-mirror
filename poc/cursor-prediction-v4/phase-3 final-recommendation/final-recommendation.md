# Cursor Prediction v4 Final Recommendation

## Final Recommendation

Do not implement a default-on predictor change now.

Keep the current product baseline, `product_baseline_dwm_last2_gain_0_75`, as the default. The best product-feasible v4 candidate, `mixed_hook_when_disagree_ge2_age16`, improves overall p99 from `36.245px` to `34.200px`, but it creates `160` pointwise `>5px` regressions, including `15` low-speed `>5px` regressions. That fails the v4 decision rule for a visible cursor overlay.

The next work should target runtime input freshness and measurement, not a new predictor. In priority order:

1. Add TraceTool/runtime instrumentation for poll cadence, hook age, hook/poll disagreement, DWM target horizon, and the exact anchor chosen by the predictor.
2. Fix or characterize product poll cadence. The trace requested `8ms` polls, but actual product poll cadence was p50 `15.923ms` and p95 `63.081ms`.
3. Build hook/poll fusion instrumentation and replay tests before attempting hook-backed prediction.
4. Run learned residual timing only after runtime anchors are cleaner and repeatable.
5. Collect more traces after instrumentation, covering high-speed flicks, stops, reversals, drag, low-speed precision, compositor jitter, CPU load, DPI/monitor variants, and pointer-device variants.

## Top Metrics

| item | value |
| --- | ---: |
| scored product polls | `99,622` |
| product poll p50 / p95 | `15.923ms` / `63.081ms` |
| reference target p50 / p95 | `2.000ms` / `2.001ms` |
| baseline mean / p95 / p99 / max | `1.695px` / `6.771px` / `36.245px` / `682.467px` |
| best product-feasible candidate | `mixed_hook_when_disagree_ge2_age16` |
| best candidate p95 / p99 | `6.385px` / `34.200px` |
| best candidate pointwise `>5px` regressions | `160` overall, `15` low-speed |
| high-speed baseline p95 / p99 | `88.444px` / `161.659px` |
| high-speed best candidate p95 / p99 | `84.396px` / `154.380px` |
| hook/poll disagreement `>=32px` baseline p95 / p99 | `212.847px` / `320.169px` |

## What Changed From v3

v3 found a learned-residual signal but still recommended against default-on product integration because it had only one compatible product trace and visible regression risk remained. v4 changes the evidence base: `referencePoll` gives higher-quality labels, so we can separate label quality from product runtime input quality.

With `referencePoll`, the conclusion becomes more concrete. The current blocker is not mostly label noise or a missing deterministic gain tweak. The tail is dominated by stale/irregular product polling, high-speed/high-acceleration motion, DWM horizon variation, stop-entry overshoot, and sparse but severe hook/poll disagreement. That makes learned residual work premature until the product runtime anchor is measured and improved.

## Next Concrete Steps

1. Extend TraceTool output with predictor-anchor diagnostics: poll timestamp, latest hook timestamp, hook age, hook/poll distance, DWM horizon, chosen anchor source, chosen velocity source, and fallback reason.
2. Add runtime cadence experiments that measure actual wakeup intervals under load and near composition time.
3. Add replay budgets for overall p99, high-speed p95/p99, high-acceleration p95/p99, low-speed p95, low-speed regressions, and pointwise `>5px` regressions.
4. Re-run deterministic hook/poll fusion only after instrumentation confirms hook freshness and anchor choice.
5. Run v4.1 learned residual experiments only after the runtime cadence/anchor story is stable across multiple traces.
