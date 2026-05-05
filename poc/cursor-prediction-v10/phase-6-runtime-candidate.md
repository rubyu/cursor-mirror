# Phase 6 Runtime Candidate

Product decision: do_not_productize_synthetic_gain_too_small_or_tail_risky

Candidate: `bucket_disagreement_gain_offset_scale0p5_cap4` (scalar_gain_offset_per_horizon_speed)  
Residual cap: 4 px; scale 0.5.  
Runtime shape: 112 float parameters, about 1 MACs per advanced prediction, CPU viability high.  
Test delta vs phase4 strict: mean/p90/p95/p99/max -0.01 / 0 / 0 / 0 / 0 px.  
Regressions vs phase4 >5/>10: 0/0.  
Regressions vs CV >5/>10: 0/0.

Integration remains CPU-only: reuse the phase4 strict gate unchanged, compute the compact residual features only for advanced rows, add a clipped residual to `least_squares_w50_cap36`, and keep `constant_velocity_last2_cap24` unchanged for fallback rows.
