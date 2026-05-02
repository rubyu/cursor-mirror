# Cursor Prediction v5 Final Report

## Summary

The new `runtimeSchedulerPoll` stream confirms the subjective improvement: scheduler-backed polling is a better runtime input than the old WinForms product-poll proxy. The current DWM-aware last2 predictor should remain the default for now.

| Metric | Value |
| --- | --- |
| scored runtime contexts | 55,621 |
| baseline mean / p95 / p99 | 1.707 / 5.165 / 31.061 px |
| hold mean / p95 / p99 | 1.573 / 3.211 / 34.514 px |
| best raw candidate | dwm_gain_0_575 |
| best raw p95 / p99 | 4.722 / 30.971 px |
| best raw >5px regressions | 103 |
| selected product candidate | runtime_baseline_dwm_last2_gain_0_75 |
| late scheduler dispatches | 7,535 |

## Recommendation

Do not change the default prediction model yet. The most important product change already happened: DWM-synchronized runtime scheduling. A raw gain tweak can shave a tiny amount from p99, but it adds visible regressions. The v5 data supports keeping `DwmAwareCursorPositionPredictor` as-is while collecting at least one more trace to confirm this behavior across sessions.

## Next Work

- Add UI/runtime diagnostics only if needed: runtime tick interval, scheduler lead, and late-dispatch count.
- If another trace shows the same late-dispatch tail, test a narrowly scoped late-dispatch damping rule.
- Avoid learned or neural predictors until multiple scheduler-backed traces are available; the remaining tail is now small enough that regression risk matters more than raw fit.
