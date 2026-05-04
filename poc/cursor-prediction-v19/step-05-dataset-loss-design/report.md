# Step 05 Report: Dataset and Loss Design

## Basis

Step 04b reproduced the abrupt-stop overshoot/return leak in product-equivalent C# replay:

- Product-brake peakLead max: 5.328 px
- Product-brake OTR >1px: 24.24%
- No-brake OTR >1px: 30.3%

## Dataset Plan

- Include latest real 60Hz cursor trace ZIPs as the primary timing anchor.
- Include Step 03 original MotionLab set as non-reproducing coverage.
- Include Step 04b revised MotionLab set as positive abrupt-stop reproduction.
- Add calibrator/load-generator data when format-compatible.
- Split by file/session/scenario id, not by row.
- Reserve full synthetic families for test to measure generalization.

## Loss Plan

- Normal movement: Huber/MAE on shifted visual target.
- Stop events: peakLead hinge penalty over post-stop windows.
- Return behavior: returnMotion penalty after overshoot peak.
- Static/hold: stationary jitter penalty.
- Guardrail: signed-lag and high-speed p95/p99 penalties to avoid making normal cursor motion feel late.

## Runtime Boundary

Event-window labels and future current positions are allowed for training/evaluation only. Runtime candidates must remain CPU-only and use only recent samples, horizon, velocity windows, path efficiency, and small branch/state features.
