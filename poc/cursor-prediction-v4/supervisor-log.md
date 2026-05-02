# Cursor Prediction v4 Supervisor Log

## 2026-05-01: Start

v4 begins after collecting `cursor-mirror-trace-20260501-195819.zip`, the first trace with high-precision `referencePoll` samples.

Initial metadata observed by inspection:

- trace format: `3`;
- total samples: `975443`;
- hook moves: `51541`;
- product polls: `99624`;
- reference polls: `824278`;
- DWM timing samples: `99624`;
- DWM timing availability: `100%`;
- product poll p50/p95: about `15.92ms` / `63.08ms`;
- reference poll p50/p95: about `2.00ms` / `2.00ms`;
- quality warning: `product_poll_interval_p95_exceeds_requested_interval`.

The high-precision stream should improve label quality. The product poll stream remains intentionally coarse because it represents what the app can actually use.

## Phase 1 Assignment

Phase 1 audits the v4 trace and replays the product baseline using `referencePoll` as ground truth.

Scope:

- Work only under `poc/cursor-prediction-v4/phase-1 reference-baseline-audit/`.
- Use `cursor-mirror-trace-20260501-195819.zip` as read-only input.
- Do not edit application source.
- Do not install or exercise real Windows hooks.

Required outputs:

- `report.md`;
- `experiment-log.md`;
- `scores.json`;
- reproducible scripts/configs.

Required analysis:

- parse metadata and verify trace format `3`;
- compute event counts and interval stats independently from CSV;
- evaluate the current product baseline with target positions interpolated from `referencePoll`;
- compare against hold-current and fixed-horizon compatibility baselines;
- break errors down by speed, acceleration, product poll interval, reference poll interval, DWM horizon, hook/poll disagreement, and stop/settle windows.

Decision after Phase 1:

- determine whether model error or product poll cadence dominates;
- decide whether Phase 2 should prioritize scheduler/input cadence, deterministic model changes, or learned residuals.

## 2026-05-01: Phase 1 Review

Phase 1 completed successfully.

Accepted findings:

- Product baseline using `referencePoll` labels: mean `1.695px`, p95 `6.771px`, p99 `36.245px`, max `682.467px`.
- Hold-current is worse: mean `2.444px`, p95 `10.000px`, p99 `57.057px`.
- Fixed `8ms` appears easier than the real DWM target distribution: p99 `31.295px`.
- Reference-label quality is good for scored anchors: `98,244 / 99,622` targets are bracketed by `referencePoll` samples within `0-2.1ms`.
- The dominant error drivers are high speed, high acceleration, product poll interval irregularity, DWM horizon, hook/poll disagreement, and stop-entry overshoot.
- Product poll cadence is a real product-risk signal: p50 around `15.923ms`, p95 around `63.081ms` despite requested `8ms`.

Phase 2 direction:

- First test product-shaped deterministic alternatives that do not require future data.
- Include runtime anchor alternatives using product poll, latest hook, and mixed poll/hook anchors.
- Include DWM horizon/gain alternatives and stop-entry guards.
- Treat high-precision `referencePoll` only as labels, not as runtime input.
- Learned residuals should wait until Phase 2 clarifies the best runtime anchor.

## Phase 2 Assignment

Phase 2 evaluates product-shaped deterministic candidates on the v4 trace.

Scope:

- Work only under `poc/cursor-prediction-v4/phase-2 runtime-anchor-and-deterministic-candidates/`.
- Read Phase 1 outputs/scripts as references, but do not edit them.
- Use `cursor-mirror-trace-20260501-195819.zip` as read-only input.
- Do not edit application source.
- Do not install dependencies.
- Do not install or exercise real Windows hooks.

Required candidate families:

- baseline reproduction;
- fixed horizons and DWM horizon gain grids;
- product-poll interval gates;
- stop-entry and stop-settle guards;
- latest-hook anchor where available;
- mixed hook/poll anchor rules;
- prediction using latest product poll plus latest hook-derived velocity if feasible;
- candidates that model a scheduler improvement, clearly marked as hypothetical if they use inputs unavailable in the current product runtime.

Required outputs:

- `report.md`;
- `experiment-log.md`;
- `scores.json`;
- reproducible scripts/configs.

Decision after Phase 2:

- choose whether an implementation change should target timer/poll cadence, hook/poll fusion, model tuning, or learned residuals.

## 2026-05-01: Phase 2 Review

Phase 2 completed successfully.

Accepted findings:

- The Phase 1 baseline was reproduced exactly.
- No product-feasible deterministic candidate clears the decision rule.
- Best product-feasible p99 candidate: `mixed_hook_when_disagree_ge2_age16`, p95 `6.385px`, p99 `34.200px`.
- That candidate creates unacceptable regressions: `160` `>5px` regressions, including `15` low-speed `>5px` regressions.
- Pure hook velocity is unsafe on this trace.
- Poll interval and DWM horizon gates are useful diagnostics but do not sufficiently improve p99 without visible regressions.
- The main remaining issue is runtime input freshness/cadence and anchor selection, not a simple deterministic gain tweak.

Phase 3 direction:

- Close v4 with a recommendation rather than run learned residuals immediately.
- The learned residual phase should wait until runtime anchor/cadence evidence improves.
- Recommend trace/tool/runtime changes needed for the next data round.

## Phase 3 Assignment

Phase 3 writes the final v4 recommendation.

Scope:

- Work only under `poc/cursor-prediction-v4/phase-3 final-recommendation/`.
- Read Phase 1 and Phase 2 outputs as references, but do not edit them.
- Do not edit application source.
- Do not install dependencies.
- Do not install or exercise real Windows hooks.

Required outputs:

- `report.md`;
- `final-recommendation.md`;
- `scores.json`;
- any summary script/config if used.

Required content:

- compare v4 results against v3 conclusions;
- identify what the new `referencePoll` data changed;
- decide whether to implement a predictor change now;
- recommend what to collect or change next;
- specify whether product work should target TraceTool, runtime timer/cadence, hook/poll fusion, learned residuals, or test/replay infrastructure.

## 2026-05-01: Phase 3 Review

Phase 3 completed successfully.

Accepted final decision:

- Do not implement a default-on predictor change now.
- Keep `product_baseline_dwm_last2_gain_0_75` as the default.
- Best product-feasible candidate `mixed_hook_when_disagree_ge2_age16` improves p99 from `36.245px` to `34.200px`, but fails the visible-regression guard with `160` overall `>5px` regressions and `15` low-speed `>5px` regressions.
- The new `referencePoll` stream makes label quality credible and shifts the immediate blocker toward runtime anchor/cadence freshness.

Next work:

- Add predictor-anchor instrumentation to TraceTool/runtime.
- Measure and improve actual runtime poll cadence.
- Instrument hook age and hook/poll disagreement before productizing hook/poll fusion.
- Add replay regression budgets.
- Defer learned residuals until runtime anchors stabilize across multiple traces.
