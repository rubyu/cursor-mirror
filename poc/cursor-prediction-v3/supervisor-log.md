# Cursor Prediction v3 Supervisor Log

## 2026-05-01: Start

v3 begins because the current product predictor is strong on mean/p95 but may still be insufficient for visible high-speed motion, stop/settle behavior, and user-perceived tracking quality.

The supervisor will plan and review each phase. Experiment execution will be delegated to one sub-agent at a time when CPU/GPU measurement is involved.

Input traces available at repository root:

- `cursor-mirror-trace-20260501-000443.zip`
- `cursor-mirror-trace-20260501-091537.zip`

Initial product baseline:

- poll anchor;
- DWM-aware next-vblank horizon;
- last2 velocity extrapolation;
- gain `0.75`;
- safe fallback when DWM timing or timing intervals are invalid.

## Phase 1 Assignment

Phase 1 is assigned to measure and explain the current baseline before changing the model.

Scope:

- Work only under `poc/cursor-prediction-v3/phase-1 baseline-replay-and-error-anatomy/`.
- Use existing trace zip files as read-only inputs.
- Do not edit application source.
- Do not install or exercise real Windows hooks.
- Reproduce the v2 accepted baseline where possible.
- Build a richer metric breakdown for visible failure cases.

Required outputs:

- `report.md`
- `experiment-log.md`
- `scores.json`
- reusable scripts or notebooks used by the phase

Required metric slices:

- overall mean/p50/p90/p95/p99/max;
- speed bins;
- acceleration bins;
- turn-angle or direction-change bins if reconstructible;
- stop-entry and stop-settle windows;
- DWM horizon bins;
- poll interval jitter bins;
- hook/poll disagreement bins if both streams are available;
- per-segment chronological robustness.

Decision after Phase 1:

- identify the highest-value failure modes;
- choose whether Phase 2 should focus first on deterministic filters, stop correction, or learned oracle modeling.

## 2026-05-01: Phase 1 Review

Phase 1 completed successfully.

Accepted findings:

- The reconstructed v2 product baseline is good in the center but has a sharp visible tail: mean `1.348px`, p95 `5.258px`, p99 `26.993px`, max `537.956px`.
- The strongest failure drivers are high-speed motion, high acceleration, and hook/poll disagreement.
- Speed `1200+ px/s` has p95 `79.869px`.
- Hook/poll disagreement `>5px` has p95 `73.659px`.
- The v2 trace metadata requested `8ms` polling, but observed polling is closer to p50 `15.684ms`, p95 `23.212ms`, so input freshness and scheduler cadence are product risks.
- The older non-DWM trace confirms shorter fixed horizons are safer; fixed `4ms` outperforms `8/12/16ms`.

Phase 2 direction:

- Test deterministic candidates before learned models.
- Prefer adaptive prediction damping/horizon shortening under high-risk regimes rather than a full predictor replacement.
- Include alpha-beta or alpha-beta-gamma style filters, but reject them if p99 or low-speed behavior regresses.
- Include stop/settle-specific behavior because visible final alignment matters separately from moving prediction.
- Treat hook/poll disagreement as a possible gating feature, not as a replacement label.

## Phase 2 Assignment

Phase 2 tests deterministic, product-shaped candidates.

Scope:

- Work only under `poc/cursor-prediction-v3/phase-2 deterministic-risk-gates/`.
- Read Phase 1 scripts and results as references, but do not edit Phase 1.
- Use trace zip files as read-only inputs.
- Do not edit application source.
- Do not install or exercise real Windows hooks.

Required candidate families:

- baseline reproduction;
- gain grid and horizon shortening by speed/acceleration;
- hook/poll disagreement risk gate;
- poll-interval/jitter risk gate;
- stop-entry and stop-settle prediction decay;
- alpha-beta and alpha-beta-gamma style filters with bounded state;
- combinations of the above only if single-factor results justify them.

Required outputs:

- `report.md`
- `experiment-log.md`
- `scores.json`
- reproducible scripts/configs

Decision after Phase 2:

- select a deterministic candidate if it improves high-risk tails without low-risk regressions;
- otherwise move to a learned oracle phase to estimate the remaining achievable accuracy.

## 2026-05-01: Phase 2 Review

Phase 2 completed successfully.

Accepted findings:

- The Phase 1 product baseline was reproduced exactly on the v2 trace.
- No deterministic candidate cleared the product gate.
- The product baseline remains best on overall p99, high-speed p95/p99, and high-acceleration p95/p99.
- Simple damping and horizon shortening mostly undershoot legitimate fast motion.
- Stop-specific hold/decay reduces prediction in plausible places but still worsens p99 and creates visible regressions.
- Alpha-beta and alpha-beta-gamma smoothing are poor fits without a strong runtime oracle because smoothing adds lag in a cursor overlay.

Phase 3 direction:

- Build a learned oracle/residual experiment.
- Keep the current product baseline as the anchor and learn only corrections or decisions around it.
- Use train/validation/test chronological splits to avoid future leakage.
- Focus first on proving whether a signal exists; productization and distillation come later.
- CPU-only bounded training is acceptable for this phase. Do not install dependencies or run uncontrolled sweeps.

## Phase 3 Assignment

Phase 3 estimates the accuracy ceiling of learned residuals and gates.

Scope:

- Work only under `poc/cursor-prediction-v3/phase-3 learned-oracle-residual/`.
- Read Phase 1 and Phase 2 outputs as references, but do not edit them.
- Use trace zip files as read-only inputs.
- Do not edit application source.
- Do not install dependencies.
- Do not install or exercise real Windows hooks.

Required model families:

- baseline reproduction;
- train-set linear/ridge residual models;
- small MLP residual model if available with local CPU tooling;
- classifier or gate that decides baseline vs corrected prediction;
- high-risk-only residual model for speed/acceleration/disagreement regions;
- oracle analyses that quantify achievable gain, clearly labeled as non-product if they use future-only information.

Required features:

- current speed and previous speed;
- acceleration magnitude;
- turn angle if reconstructible;
- DWM horizon;
- observed poll interval;
- poll jitter relative to configured interval;
- hook/poll disagreement;
- stop-settle elapsed time;
- recent motion regime features derivable from past samples only.

Required outputs:

- `report.md`
- `experiment-log.md`
- `scores.json`
- scripts/configs needed to reproduce the phase

Decision after Phase 3:

- If learned residuals produce a real, tail-safe improvement, move to distillation/lightweight product-shape search.
- If learned residuals improve only with tail regressions, diagnose feature gaps or collect/derive better labels.

## 2026-05-01: Phase 3 Review

Phase 3 completed successfully.

Accepted findings:

- The full v2 baseline was reproduced exactly.
- A product-feasible learned residual signal exists.
- The best Phase 3 product-feasible candidate is `ridge_residual_risk_gate_low_speed_guard`.
- On the chronological test split it improves p99 from `29.282px` to `25.287px`.
- High-speed p95 improves from `83.630px` to `64.977px`.
- High-acceleration p95 improves from `92.945px` to `76.101px`.
- Low-speed p95 remains flat at `0.440px`.
- The candidate is not ship-ready because pointwise regressions remain high: `>1px` `935`, `>3px` `488`, `>5px` `317`.
- The non-product oracle chooser reaches p99 `20.102px`, so additional headroom exists if the gate can predict when residual correction helps.

Phase 4 direction:

- Keep the ridge residual as the correction source.
- Focus on gate calibration, shrinkage, caps, and abstention behavior to reduce visible regressions.
- Optimize on validation with a product-shaped objective that penalizes p99 regressions and pointwise `>5px` regressions.
- Treat learned correction as opt-in/research unless the regression count drops sharply.

## Phase 4 Assignment

Phase 4 calibrates the learned residual into a safer product-shaped candidate.

Scope:

- Work only under `poc/cursor-prediction-v3/phase-4 residual-gate-calibration/`.
- Read earlier phase outputs/scripts as references, but do not edit them.
- Use trace zip files as read-only inputs.
- Do not edit application source.
- Do not install dependencies.
- Do not install or exercise real Windows hooks.

Required candidate families:

- Phase 3 best candidate reproduction;
- residual shrinkage factors;
- vector residual caps;
- per-axis or vector correction caps relative to baseline step length;
- low-speed, stop-settle, and stationary guards;
- logistic/confidence threshold gates;
- validation-selected gates that minimize a product-shaped objective;
- simple product-feasible uncertainty estimates.

Required objective:

- preserve or improve overall p99;
- preserve low-speed p95;
- reduce high-speed/high-acceleration p95 and p99;
- reduce pointwise regressions, especially `>5px`;
- prefer abstention over risky correction.

Required outputs:

- `report.md`
- `experiment-log.md`
- `scores.json`
- scripts/configs needed to reproduce the phase

Decision after Phase 4:

- If a gated residual becomes safe enough, move to lightweight distillation and C# product-shape feasibility.
- If it remains regression-heavy, move to targeted data collection / trace-design recommendations before productization.

## 2026-05-01: Phase 4 Review

Phase 4 completed successfully.

Accepted findings:

- Conservative abstention is effective.
- Best Phase 4 candidate: `phase4_logistic_p0_35_sh0_65_capinf`.
- Test p99 improves from baseline `29.282px` to `25.728px`.
- Phase 3's best p99 was slightly better at `25.287px`, but with far more regressions.
- `>5px` regressions drop from Phase 3's `317` to `16`.
- Correction is applied to only `6.91%` of test samples.
- Low-speed p95 remains preserved at `0.440px`.
- The remaining weakness is that high-speed p99 is not improved versus baseline in the selected conservative gate, while high-speed p95 still improves.

Phase 5 direction:

- Convert the Phase 4 candidate into an explicit lightweight product shape.
- Extract coefficients, feature normalization, and gate formula.
- Estimate hot-path operation count and state size.
- Test whether a simpler distilled formula can match the gated candidate.
- Define regression-budget tests that would be required before app integration.
- Decide whether this should be opt-in, default-on, or research-only pending more traces.

## Phase 5 Assignment

Phase 5 studies product-shape feasibility and distillation.

Scope:

- Work only under `poc/cursor-prediction-v3/phase-5 product-shape-distillation/`.
- Read earlier phase outputs/scripts as references, but do not edit them.
- Use trace zip files as read-only inputs.
- Do not edit application source.
- Do not install dependencies.
- Do not install or exercise real Windows hooks.

Required work:

- reproduce the Phase 4 best candidate;
- extract all model coefficients, normalizers, gates, thresholds, and caps needed for a C# implementation;
- estimate hot-path state, operations, allocations, and branch structure;
- test distilled alternatives such as fewer features, linear score gates, piecewise gates, and coefficient pruning;
- compare against baseline and Phase 4 best;
- propose unit/replay tests needed for implementation;
- recommend default-on, opt-in, or research-only.

Required outputs:

- `report.md`
- `experiment-log.md`
- `scores.json`
- `model-spec.json`
- scripts/configs needed to reproduce the phase

Decision after Phase 5:

- If the product shape is light and still robust, prepare a final v3 recommendation.
- If the product shape is too fragile or trace-dependent, recommend additional trace collection before implementation.

## 2026-05-01: Phase 5 Review

Phase 5 completed successfully.

Accepted findings:

- The Phase 4 logistic gate can be represented as a raw linear-score comparison, avoiding hot-path sigmoid/exp.
- Best product-shaped candidate: `distilled_linear_score_exact_gate`.
- It exactly preserves the Phase 4 selected candidate's replay behavior.
- Test p99 remains `25.728px` versus baseline `29.282px`.
- `>5px` regressions remain `16`.
- Correction application rate is `6.91%`.
- Estimated hot path is small enough for product code, but still uses many features and only one compatible product trace.
- A simpler `core6` candidate improves p99 slightly more (`25.398px`) but increases `>5px` regressions to `70`, so it is rejected as less safe.

Phase 6 direction:

- Perform final robustness and regression-budget analysis before recommendation.
- Inspect the remaining `>5px` regressions.
- Test stricter gate/shrink/cap variants that may trade some improvement for lower visible-regression risk.
- Produce the v3 final recommendation: implement now, opt-in only, research-only, or collect more data first.

## Phase 6 Assignment

Phase 6 performs final robustness and regression-budget analysis.

Scope:

- Work only under `poc/cursor-prediction-v3/phase-6 robustness-and-final-recommendation/`.
- Read earlier phase outputs/scripts as references, but do not edit them.
- Use trace zip files as read-only inputs.
- Do not edit application source.
- Do not install dependencies.
- Do not install or exercise real Windows hooks.

Required work:

- reproduce the baseline and Phase 5 best product-shaped candidate;
- evaluate chronological block robustness across the whole v2 trace where possible;
- inspect all `>5px` regressions from the selected candidate;
- test stricter deployment variants such as higher linear-score thresholds, lower shrink, vector caps, relative caps, and combinations;
- identify whether a near-zero-regression candidate still preserves meaningful p99 or high-risk p95 improvement;
- summarize what additional traces are needed if implementation should wait;
- write a final v3 recommendation.

Required outputs:

- `report.md`
- `experiment-log.md`
- `scores.json`
- `final-recommendation.md`
- scripts/configs needed to reproduce the phase

Decision after Phase 6:

- End v3 with a clear product recommendation.

## 2026-05-01: Phase 6 Review

Phase 6 completed successfully.

Accepted findings:

- `distilled_linear_score_exact_gate` improves held-out p99 from `29.282px` to `25.728px`.
- It wins p99 in `10/10` chronological blocks across the v2 product trace and `5/5` held-out test blocks.
- It still leaves `16` visible `>5px` regressions.
- The safest strict variant is `p6_vector_cap_5`, with `0` `>5px` regressions and p99 `27.111px` versus baseline `29.282px`.
- `p6_vector_cap_5` preserves low-speed p95 at `0.440px`, but trades away larger high-risk improvements.
- Evidence is limited to one compatible poll+DWM product trace; the older trace is useful only for fixed-horizon compatibility.

Final v3 decision:

- Do not implement default-on from the current evidence.
- Treat the candidate as research/opt-in only after independent trace replay confirms the conservative shape.
- Prefer collecting more poll+DWM traces before product integration.
- If implementation proceeds experimentally, start from the conservative capped shape and enforce replay/regression-budget tests.
