# Cursor Prediction v6

v6 evaluates the two latest format-9 self-scheduler traces:

- `cursor-mirror-trace-20260502-175951.zip`
- `cursor-mirror-trace-20260502-184947.zip`

## Reproduction

```powershell
node poc\cursor-prediction-v6\analyze_v6.js
```

The script uses only Node.js standard-library modules and reads the trace ZIP files directly.

## Phase Layout

- `phase-1 data-audit/`: trace metadata, ZIP manifest, event counts, cadence audit.
- `phase-2 dataset-builder/`: causal feature dataset and split definition.
- `phase-3 deterministic-baselines/`: cross-session deterministic baseline scores.
- `phase-4 learned-teacher/`: dependency-free learned residual teachers.
- `phase-5 distillation/`: product-shaped distilled residual candidates.
- `phase-6 runtime-cost/`: hot-path runtime proxy benchmarks.
- `phase-7 deep-teacher/`: stronger teacher models with sequence history.
- `phase-8 torch-cuda-teacher/`: CUDA PyTorch MLP, GRU, and TCN teachers.

## Final Result

Recommended product default: keep `current_dwm_aware_last2_gain_0_75`.

Best strict distilled candidate: `safe_ridge_residual_guarded`.

Best deep teacher: `tiny_tcn_residual_guarded_seq8`.

The learned models reveal a modest p99-error signal, but not a clean default product change. The best distilled candidate improves average p99 by only `0.027 px` while worsening mean error by `0.081 px`. The best deep teacher improves average p99 by `0.386 px`, but introduces `1,282` held-out `>1 px` regressions. Runtime cost is acceptable; confidence and small-regression control are the blockers.

CUDA PyTorch did not change the recommendation. Raw CUDA MLP/GRU/TCN models improved mean and p95 in some folds but introduced `>5 px` regressions. Guarded CUDA variants removed visible regressions but did not improve aggregate p99.
