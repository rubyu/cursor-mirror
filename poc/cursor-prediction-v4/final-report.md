# Cursor Prediction v4 Final Report

## Final Decision

Do not implement a default-on predictor change now.

Keep the current product baseline, `product_baseline_dwm_last2_gain_0_75`, as the default. v4 used the new high-precision `referencePoll` stream as ground truth and found that the current blocker is runtime input freshness, not label quality.

## Key Metrics

| item | value |
| --- | ---: |
| scored product polls | `99,622` |
| product poll p50 / p95 | `15.923ms` / `63.081ms` |
| reference target p50 / p95 | `2.000ms` / `2.001ms` |
| baseline mean / p95 / p99 / max | `1.695px` / `6.771px` / `36.245px` / `682.467px` |
| best product-feasible candidate | `mixed_hook_when_disagree_ge2_age16` |
| best candidate p95 / p99 | `6.385px` / `34.200px` |
| best candidate visible regressions | `160` overall `>5px`, `15` low-speed `>5px` |

## What v4 Changed

v3 found a promising learned-residual signal but could not justify default-on integration. v4 changes the evidence base because `referencePoll` separates ground truth from product input.

The new trace shows:

- `referencePoll` labels are dense enough for evaluation;
- product `poll` cadence is much worse than requested;
- simple deterministic hook/poll fusion improves p99 a little but creates visible regressions;
- learned residuals should wait until runtime anchor freshness is better measured and more stable.

## Product Recommendation

Do not change the default predictor yet.

The next product work should be instrumentation-first:

1. record product poll timestamp, actual poll interval, and DWM target horizon;
2. record latest hook timestamp, hook age, hook position, and hook/poll disagreement;
3. record chosen predictor anchor source, velocity source, and fallback reason;
4. measure actual runtime wakeup intervals under load;
5. add replay budgets for p99, high-speed/high-acceleration tails, low-speed p95, and pointwise `>5px` regressions;
6. collect more traces after those fields exist.

## Learned Models

Do not start productizing learned residuals from v4 yet. A learned model would currently learn around stale/irregular runtime anchors. Run v4.1 learned-residual experiments only after cadence and anchor behavior are stable across multiple instrumented traces.

