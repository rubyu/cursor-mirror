# Step 01 Notes

Audited current product-equivalent chronological replay candidates:

- ConstantVelocity, default +2ms target offset
- LeastSquares, default +2ms target offset
- DistilledMLP lag0, recommended -4ms target offset, post-stop brake disabled
- DistilledMLP lag0, recommended -4ms target offset, product post-stop brake enabled

Metrics include normal visual MAE/RMSE/p95/p99, current-position event-window peakLead/peakDistance/returnMotion, overshoot-then-return rates, stationary jitter, and rough C# replay runtime.

No product source files were modified.
