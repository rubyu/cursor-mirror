# Cursor Prediction v17

POC v17 investigates a runtime behavior observed after v16: the selected
DistilledMLP can lead the real cursor during rapid deceleration into near-stop
and can show small residual motion after the real cursor has stopped.

Result:

- The dominant fix is target-time alignment, not another deceleration guard.
- C# chronological replay selected `offset -4ms` as the visual candidate.
- A POC-only C# overlay selected `lag0 offset-4ms` as the best balanced/visual candidate.
- The generated model was therefore promoted toward zero lag compensation, while the product UI exposes target offset so `-4ms` can be validated without editing settings files.

Constraints:

- CPU/GPU measurement was run by one sub-agent at a time.
- No raw ZIP copies, expanded CSVs, checkpoints, tensor dumps, or large binaries.
- All v17 writes stay under `poc/cursor-prediction-v17/`.

Artifacts:

- `experiment-plan.md`
- `experiment-log.md`
- `step-01-data-inventory/`
- `step-02-overshoot-metrics/`
- `step-03-lag-and-deceleration-ablation/`
- `step-04-soft-lag-gate/`
- `step-05-product-shape-validation/`
- `step-06-timing-replay-validation/`
- `step-07-offset-validity-and-calibrator-check/`
- `step-08-csharp-chronological-replay/`
- `step-09-csharp-tail-guard-search/`
- `step-10-csharp-lag-overlay-grid/`
- `scripts/`
