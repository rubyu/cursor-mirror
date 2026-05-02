# Cursor Mirror Prediction PoC Step 3

## Purpose

Step 3 answers how the winning prediction model should be shaped for product implementation. Steps 1 and 2 already selected the model family:

- Default model: `constant-velocity-last2`.
- Default gain: `1.0`.
- Default offset cap: none.
- Optional advanced/experimental variant: horizon-dependent damping for longer horizons only.

This step does not run another grid search. It translates the model into an implementation design that is O(1), allocation-free on the hot path, deterministic, and testable with synthetic samples rather than real Windows hooks.

## Files

| file | purpose |
|---|---|
| `README.md` | This rerun and artifact guide. |
| `experiment-log.md` | Reviewable rationale, assumptions, observations, and rejected alternatives. |
| `report.md` | Product-ready implementation design. |
| `scores.json` | Machine-readable summary of model choice, cost, defaults, risk flags, and timing. |
| `run_microbenchmark.ps1` | Optional synthetic microbenchmark for the proposed state/update/predict shape. |

## Rerun

The only runnable script in this step is a short synthetic microbenchmark. It does not read the trace zip and does not install Windows hooks.

```powershell
Set-Location "C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor"
& "poc/cursor-prediction/step-3 implementation-shape/run_microbenchmark.ps1"
```

Optional parameters:

```powershell
& "poc/cursor-prediction/step-3 implementation-shape/run_microbenchmark.ps1" `
  -Iterations 2000000 `
  -WarmupIterations 100000 `
  -HorizonMs 12 `
  -IdleGapMs 100
```

Timing is intentionally labeled noisy. It measures a synthetic `AddSample` plus `Predict` loop in local .NET code and should not be treated as a production benchmark.

## Recommendation

Implement `constant-velocity-last2` first. Feed it hook samples with monotonic millisecond timestamps, reset velocity across idle gaps or invalid intervals, and ask it for the overlay display point at the chosen display-frame horizon. Keep prediction displacement caps disabled by default because fixed caps worsened Step 1 accuracy; retain only a high failsafe guard if product safety requires one.
