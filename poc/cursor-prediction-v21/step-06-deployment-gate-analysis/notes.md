# Step 06 Notes - Deployment Gate Analysis

## Scope

This step writes only under `poc/cursor-prediction-v21/step-06-deployment-gate-analysis/`.

Read-only inputs:

- `poc/cursor-prediction-v21/step-05-multiseed-event-safe-validation/scores.json`
- Step05 harness and reports
- Step02 split manifest and metric policy
- v21 source code and repository-root recording ZIPs

## Why A Harness Was Needed

Step05 `scores.json` already contained the legacy futureLag p95 diagnosis and the held-out test normal-moving p95 values. It did not preserve held-out test normal-moving futureLag p99 for learned candidates, which is required for the step06 deployment gate.

The step06 harness was copied from step05 and localized. It keeps the same seeds and focused candidates, but adds `sliceAnalysis`:

- deployment slices: test normal visual p95/p99, test normal-moving futureLag p95/p99, robustness stop-event metrics, futureLead p99, and held-out stationary jitter.
- diagnostic slices: legacy futureLag p95, all-row futureLag, all-row futureLag by split, all-row futureLag by quality bucket, and normal-moving futureLag by split.

## Compute

- Command shape: `dotnet run --project ...Step06DeploymentGateAnalysis.csproj --no-restore`
- Runtime: 170120 ms.
- Execution: CPU-only serialized run.
- Rows evaluated: 252180.
- Seeds: `2105`, `2205`, `2305`.
- Runs: 15 learned candidate-seed evaluations plus product baseline.
- No expanded search and no retraining beyond reproducing the focused step05 candidates needed to compute the missing p99 deployment slice.

## Metric Correction

The old `overall.futureLag.p95` gate mixed normal-moving rows with all train/validation rows. Product receives a nearest-rank p95 of `0.000000` on that mixed diagnostic slice because at least 95% of included rows are zero-or-leading. The learned event-safe target leaves tiny lagging projections on more than 5% of train rows, so it fails the old gate at roughly `0.02-0.03 px` despite matching product on held-out moving rows.

Step06 keeps that metric as diagnostic. Deployment gating uses held-out test normal-moving futureLag p95/p99 against product with explicit subpixel tolerances.

## Cleanup

The harness produced `bin/` and `obj/` during build/run. They were removed before final delivery because they are generated build artifacts.
