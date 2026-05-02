# Step 5: Neural Models

This step evaluates whether a small MLP can improve Cursor Mirror cursor prediction beyond the Step 4 `constant-velocity-last2` recommendation.

The experiment is intentionally dependency-light:

- reads `cursor-mirror-trace-20260501-000443.zip` from the repo root;
- streams `trace.csv` from the zip without copying it into this directory;
- uses only Python standard library plus NumPy;
- trains CPU NumPy MLPs because GPU hardware is visible, but no GPU-backed ML runtime is installed.

After the initial Step 5 run, a local GPU-capable PyTorch environment was created with `uv`. See `gpu-environment.md` for the local environment details and recreation commands.

## Models

The runner evaluates these candidates on common feature-valid anchors:

- `hold-current`;
- `constant-velocity-last2`, gain `1.0`, no cap;
- `mlp-direct-h32x16`, predicting future displacement directly;
- `mlp-residual-last2-h32x16`, predicting a correction to the last2 prediction.

Features use only samples at or before anchor `i`: the last 5 movement intervals, current speed, previous speed, acceleration, turn cosine/sine, segment age, and aggregate history displacement/velocity.

Targets are interpolated at `anchor_time + horizon_ms`. Anchors are skipped when the target or history crosses a gap above `100ms`.

## Rerun

From the repo root:

```powershell
& "C:\Users\seigl\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" "poc\cursor-prediction\step-5 neural-models\run_neural_models.py"
```

Optional smaller run:

```powershell
& "C:\Users\seigl\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" "poc\cursor-prediction\step-5 neural-models\run_neural_models.py" --horizons-ms 8 16
```

Outputs are written under this directory only:

- `scores.json`
- `experiment-log.md`
- `report.md`

No commit is created by this step.
