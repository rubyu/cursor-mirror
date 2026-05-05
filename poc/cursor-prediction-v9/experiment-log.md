# Cursor Prediction v9 Experiment Log

## 2026-05-03 - Start

Started v9 as a machine-learning project focused on accuracy ceiling first and
runtime feasibility second.

Initial constraints:

- CPU/GPU measurement jobs are serialized.
- Raw trace and calibration ZIP files stay out of git.
- Large generated datasets and checkpoints are avoided unless explicitly needed.
- Calibrator remains the final product-runtime judge.

Initial local observations:

- `uv` is available.
- `python` is not on PATH directly, so v9 should use `uv`-managed Python.
- NVIDIA GPU is available through the installed driver.
- Existing v6 CUDA teacher experiments did not produce a product-ready model,
  but they used only two trace sessions and a limited model family set.
- Existing v8 product runtime tuning reduced Calibrator average separation to
  the low single-digit pixel range, but did not reach zero.

Supervisor action:

- Assigned Phase 0 audit to a sub-agent.
- Scope is limited to `poc/cursor-prediction-v9/`.
- No model training, Calibrator run, or CPU/GPU measurement is allowed in Phase 0.

Phase 0 result:

- Trace ZIPs: 22.
- Calibration ZIPs: 2.
- Trace CSV rows: 10,100,605.
- Format 9 traces available: `cursor-mirror-trace-20260502-175951.zip`
  and `cursor-mirror-trace-20260502-184947.zip`.
- Root calibration packages are short and do not include pattern columns, so
  Calibrator promotion should create fresh v9 run packages.

Next action:

- Assigned Phase 1/2 to the same sub-agent.
- Scope remains `poc/cursor-prediction-v9/`.
- The run is limited to causal dataset construction and classical baselines on
  the two Format 9 traces.

Phase 1/2 result:

- Built causal rows in memory only.
- `session-1`: 63,310 rows.
- `session-2`: 47,639 rows.
- Anchor stream: `runtimeSelfSchedulerPoll`.
- Label stream: interpolated `referencePoll` at 4, 8, 12, and 16.67 ms.
- Best classical family: alpha-beta.
- Best fold results improved p95 versus the product-shaped ConstantVelocity
  baseline, but had many per-row regressions.

Interpretation:

- Alpha-beta contains a useful signal, especially for p95 reduction.
- It is not safe enough as a direct runtime replacement.
- The next experiment should treat alpha-beta as either a regime-gated
  specialist or teacher signal for residual ML models.

Next action:

- Assigned Phase 3 ML teacher search to the sub-agent.
- Required families: RFN, MLP, CNN, FSMN, TCN, and GRU.
- Existing v6 GPU Python environment should be reused.
- No checkpoint, cache, TensorBoard, or large dataset output should be written.

Phase 3 result:

- Runtime: 21.429 seconds.
- Device: NVIDIA GeForce RTX 5090.
- Tried RFN, MLP, CNN1D, FSMN, TCN, GRU, and LSTM.
- Best candidate: `mlp_seq16_residual`.
- Aggregate baseline mean/p95avg/p99avg: 9.165 / 44.924 / 122.206 px.
- Aggregate MLP mean/p95avg/p99avg: 6.549 / 29.578 / 86.466 px.
- MLP max also improved from 614.649 px to 531.728 px.
- However, MLP still produced 21,458 rows worse than baseline by more than 1 px
  and 6,070 rows worse by more than 5 px.

Interpretation:

- A compact MLP teacher has a meaningful accuracy signal.
- Direct adoption is unsafe because localized regressions are too common.
- The next phase should validation-tune a guard that applies the teacher only
  when the predicted residual is likely to help.

Phase 4 result:

- Runtime: 9.124 seconds.
- Strict guard: zero `>5px` regressions, but almost no accuracy gain.
- Balanced guard: aggregate mean improved from 9.165 px to 8.553 px.
- Balanced guard: average p95 improved from 44.924 px to 42.651 px.
- Balanced guard: average p99 improved from 122.206 px to 121.094 px.
- Balanced guard: `>5px` regressions dropped from unguarded MLP's 13,006 to
  2,207.

Interpretation:

- Guarding works, but the selected gate differs by fold.
- A common fixed rule needs to be tested before considering runtime
  implementation.

Phase 5 result:

- Runtime: 40.449 seconds.
- Best teacher: `mlp_seq32_h256_128_64`.
- Best teacher metrics: mean 7.097 px, p95 28.237 px, p99 88.705 px.
- Best teacher cost: 109,378 parameters, 15.36M GPU rows/sec, 818,963 CPU
  rows/sec in PyTorch CPU sample.
- Best validation-objective teacher: `fsmn_seq32_c64`; less accurate ceiling
  than MLP but fewer `>5px` regressions.
- Best product-feasible non-RFN fixed gate:
  `tcn_seq32_c64__common-r8-cos075-base8-or-eff09`.
- That fixed gate has only 540 `>5px` regressions, but p95/p99 improvements are
  small.

Interpretation:

- The accuracy ceiling improved materially, but direct teacher use is unsafe.
- Fixed common gates are too conservative.
- Next phase should learn a compact confidence gate from a small causal feature
  set and keep the teacher as a residual proposal.

Phase 6 result:

- Runtime: 56.026 seconds.
- Best teacher alone: `mlp_seq32_h256_128_64`, p95 26.996 px, p99 84.363 px.
- Best teacher alone still had 11,033 `>5px` regressions.
- Learned strict gate: mean 8.833 px, p95 40.870 px, p99 122.036 px,
  276 `>5px` regressions.
- Learned balanced gate: mean 8.706 px, p95 40.591 px, p99 122.324 px,
  339 `>5px` regressions.
- The learned balanced gate had a max outlier of 760.167 px.

Interpretation:

- Learned gating improves over fixed gating.
- The max outlier means this is not yet ready for Calibrator promotion.
- Next phase should include max and large-regression penalties in the gate
  objective.

Phase 7 result:

- Runtime: 290.899 seconds.
- Max-safe candidate: `tcn_seq32_c64`.
- Metrics: mean 9.100 px, p95 42.190 px, p99 127.690 px, max 606.649 px.
- Regressions: 81 `>1px`, 77 `>5px`, zero `>10px`, zero `>20px`, zero
  `>50px`.
- Improved rows: 1,087.

Interpretation:

- Large regressions can be eliminated with max-safe selection and clamping.
- The remaining p95 gain is small.
- Gate shape still differs across folds, so product-readiness needs a single
  common gate evaluation.

Phase 8 result:

- Runtime: 20.639 seconds.
- Product-shaped candidate:
  `mlp_seq32_h256_128_64__tiny-mlp__m5__p09__speed-lt-1000__clamp4`.
- Candidate spec: MLP seq32 teacher, tiny-MLP gate, margin 5 px, probability
  threshold 0.90, apply only under 1000 px/s, residual clamp 4 px.
- Metrics: mean 8.957 px, p95 40.804 px, p99 126.570 px, max 610.660 px.
- Regressions: 337 `>1px`, 327 `>3px`, zero `>5px`, zero `>10px`, zero
  `>20px`, zero `>50px`.
- Improved rows: 6,224.
- Estimated C# SIMD lower-bound throughput: 826,234 rows/sec for the teacher;
  gate overhead is small.

Interpretation:

- A product-shaped candidate now exists.
- It is not ready to become the default, but it is worth implementing behind a
  feature flag or experimental model option and measuring with Calibrator.

Phase 9 result:

- Exported fixed runtime candidate weights and a C# prototype evaluator.
- GPU was used only for offline training/export.
- Product inference constraint: fixed weights on CPU only.
- C# scalar prototype matched Python samples:
  - max teacher diff: 0.00001526;
  - max gate probability diff: 0.00000009;
  - max final diff: 0.00000095;
  - apply mismatches: 0.
- C# scalar throughput: 22,160.6 rows/sec.
- Vector acceleration was not available in the prototype environment.
- Replay candidate metrics: mean 8.972 px, p95 41.000 px, p99 126.333 px,
  max 610.650 px, zero `>5px` regressions.

Interpretation:

- The runtime candidate is CPU-feasible as an experimental model option.
- Next step: integrate it into `src/` behind a non-default model selection and
  measure with Calibrator.

Phase 10 result:

- Integrated the fixed-weight candidate as `ExperimentalMLP`.
- Runtime inference remains CPU-only and does not depend on GPU or an ML
  framework.
- `ConstantVelocity` remains the default model.
- Added early speed guards so high-speed motion skips teacher evaluation.
- Added Calibrator-visible counters for ExperimentalMLP skip/evaluate/apply
  decisions.
- `scripts/test.ps1`: 119 passed, 0 failed.
- Release build passed.

Calibrator findings:

- Initial `ConstantVelocity`: score 14.10 px, mean 3.756 px, p95 12 px, max
  26 px.
- `ExperimentalMLP` after speed/path guards: score 20.85 px, mean 3.779 px,
  p95 12 px, max 71 px.
- A later `ConstantVelocity` rerun: score 23.10 px, mean 4.263 px, p95 12 px,
  max 86 px.
- Counter-enabled `ExperimentalMLP`: score 23.25 px, mean 3.993 px, p95 12 px,
  max 87 px; skipped 1,151 samples by latest speed, 137 by path speed,
  evaluated 510 samples, rejected 453, applied 57.

Interpretation:

- The Calibrator batch is noisy enough that it does not prove an
  ExperimentalMLP-specific regression.
- It also does not prove a stable win over `ConstantVelocity`.
- Keep `ExperimentalMLP` as a non-default experimental option only.
- The next productive step is a matched multi-candidate Calibrator mode or a
  cheaper low-speed approximation with lower timing risk.
