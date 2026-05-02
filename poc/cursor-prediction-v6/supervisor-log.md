# Supervisor Log

- Created v6 POC under `poc/cursor-prediction-v6/`.
- Kept all writes inside the v6 POC folder.
- Used `runtimeSelfSchedulerPoll` as anchor stream and `referencePoll` as label stream.
- Produced phase reports and JSON scores for audit, dataset build, and deterministic baselines.
- Best current deterministic candidate: `current_dwm_aware_last2_gain_0_75`.
- Added learned-teacher, distillation, runtime-cost, and deep-teacher phases.
- Phase 4 found guarded learned teachers can improve p99 but create many small regressions.
- Phase 5 found `safe_ridge_residual_guarded` is mechanically safe in the two-session cross-check, but the win is tiny: average p99 delta `-0.027 px`, mean delta `+0.081 px`, zero `>1/>3/>5 px` regressions.
- Phase 6 found runtime cost is acceptable: current baseline median `33.8 ns/pred`, `safe_ridge_residual_guarded` median `331.3 ns/pred`.
- Phase 7 found `tiny_tcn_residual_guarded_seq8` gives a stronger p99 teacher signal: average p99 delta `-0.386 px`, but with `1,282` held-out `>1 px` regressions, so it is teacher-only.
- Installed CUDA PyTorch in a POC-local venv after user approval for dependency downloads: `torch 2.11.0+cu128`, CUDA runtime `12.8`, RTX 5090 visible.
- Phase 8 used CUDA PyTorch without checkpoints, model saves, generated datasets, or large intermediate files. Only final script/report/score/log files were written.
- Phase 8 tested CUDA residual MLP, GRU, and TCN teachers. Raw models introduced `>5 px` regressions; guarded variants had zero `>1/>3/>5 px` regressions but worsened aggregate p99 by about `+0.061 px`.
- Final supervisor recommendation: keep the current predictor as the product default. Treat learned predictors as diagnostic/teacher material until more trace diversity and a better small-regression gate are available.
