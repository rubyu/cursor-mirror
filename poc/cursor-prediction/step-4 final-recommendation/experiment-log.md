# Experiment Log

## 2026-05-01 Step 4

### Goal

Step 4 is the supervisory consolidation pass. The goal is to choose a product-ready prediction strategy from the earlier experiments, identify what should ship first, and document what should remain experimental.

### Inputs Reviewed

- Step 1 baseline search and `scores.json`
- Step 2 adaptive refinement search and `scores.json`
- Step 3 implementation-shape report and `scores.json`
- Current Cursor Mirror controller, timer, settings, hook, and test structure reviewed during supervision

No new CPU-heavy search was run in this step.

### Decision Rationale

The final selected model is `constant-velocity-last2`, gain `1.0`, no normal offset cap.

This is the strongest first implementation because it won the Step 1 model search at every nonzero tested horizon on the latter 30% test split, and Step 2 did not find an adaptive method that clearly improved visible quality. The small mean improvements from damping at longer horizons are not enough to offset p95/p99/max regressions and additional settings complexity.

The product decision is slightly stricter than "lowest mean error." Cursor Mirror displays a visible cursor. A rare large overshoot is more noticeable and more user-hostile than a small average improvement is helpful. This is why online expert selection and long-horizon damping are not recommended as defaults.

### Supervisor Adjustment After Step 3

Step 3 recommended a display-frame horizon clamped to 8-16ms. The final recommendation adjusts that to:

- fixed fallback: 8ms;
- automatic display-frame mode: estimated frame period clamped to 4-16ms.

Reason: Step 1 directly evaluated 4ms and found low error, so high-refresh displays should not be forced to overpredict to 8ms. The conservative 8ms fallback remains useful when refresh timing is unknown or unreliable.

### Rejected Directions

Neural-network prediction is not recommended for the first product implementation. The trace does not show a need for model-file loading, training infrastructure, vector math, or online learning. A neural model would add failure modes before there is evidence it can beat last2 on p95/p99/max.

Online expert selection is rejected for now. It was evaluated without future leakage, but the EWMA selector reacted to past regime performance and worsened tail errors around stops and turns.

Fixed offset caps are rejected as normal accuracy controls. Step 1 showed caps clipped legitimate fast movement. A very high failsafe cap may be considered only to guard timestamp bugs or corrupted input.

### Outcome

Implement the O(1) predictor first, behind an opt-in setting or experimental setting. Keep the first integration deterministic and fully unit-testable without installing a real Windows hook. Collect more traces before making the feature default-on or adding adaptive behavior.
