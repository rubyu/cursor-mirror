# Experiment Plan

## Goal

Analyze and improve the case where the v16 DistilledMLP predicts past the real cursor during rapid deceleration toward a stop.

## Step 01 - Data Inventory

- Inventory v14-v16 POCs.
- Inventory available root MotionLab, MouseTrace, and calibration ZIPs.
- Inventory related Calibrator, MotionLab, MouseTrace, and analysis artifact locations.
- Do not copy raw data.

## Step 02 - Overshoot Metrics

- Define signed lead/lag and overshoot metrics.
- Use the v16 selected runtime descriptor as the first DistilledMLP baseline.
- Compare Step5 and DistilledMLP on 60Hz-only rows.
- Extract stop-approach, hard-stop, post-stop hold, and direction-flip slices.
- Write compact Markdown/JSON outputs only.

## Later Phases

- Step 03: candidate stop/deceleration gates and lag-compensation ablations.
- Step 04: runtime-shape parity for selected gate variants.
- Step 05: guarded product-candidate decision using standard split, package holdout, stop-approach overshoot, and runtime cost.

## Promotion Criteria Draft

- Stop-approach overshoot p95/p99 and overshoot rates improve versus v16 selected.
- Standard validation/test and package holdout p95/p99 do not regress meaningfully versus v16 selected or Step5.
- Post-stop jitter and direction-flip penalty do not worsen.
- Runtime remains allocation-free and implementable with fixed arrays plus simple scalar gates.
- C# parity target remains below 0.01 px before product integration.
