# Cursor Prediction v10 Experiment Plan

## Phase 0 - Dataset Spec

Purpose: define the compact synthetic data contract and generate the first pilot
without writing per-frame CSV data.

Dataset rules:

- schema: `cursor-mirror-motion-script/1`;
- 2,000 scripts for the pilot;
- deterministic PRNG from a root seed plus per-script seed;
- 2-12 second duration;
- 2-16 Bezier control points clipped to bounds;
- 0-32 speed profile points;
- mixed bounds: 640x480, 1280x720, and 1920x1080;
- condition tags for speed changes, near-stop regions, acute acceleration,
  edge proximity, missing history, and jitter.

Outputs:

- `runs/scripts.synthetic.jsonl`
- `phase-0-dataset.json`
- `phase-0-dataset.md`

## Phase 1 - Baseline

Purpose: establish a CPU-only causal baseline score from on-demand script
sampling.

Candidates:

- hold-last;
- constant-velocity-last2;
- least-squares-window with multiple history windows;
- simple alpha-beta style predictors.

Evaluation:

- horizons: 8.33 ms, 16.67 ms, 25 ms, and 33.33 ms;
- missing-history scenarios: clean, 10% masked history, 25% masked history;
- metrics: mean, RMSE, p50, p90, p95, p99, max;
- breakdowns by horizon, speed bin, and missing-history scenario;
- regression counts versus the current-baseline equivalent.

Outputs:

- `phase-1-baselines.json`
- `phase-1-baselines.md`
- `scores.json`

## Phase 2 - Stress Distribution And Classical Sweep

Purpose: broaden the deterministic CPU-only search before using ML and make
synthetic stress cases visible.

Candidates:

- least-squares variants;
- alpha-beta variants;
- CV/LS blends;
- clipped and regime-gated variants.

Result: raw LS improved mean and tail on synthetic data but produced too many
large regressions. It remained a teacher candidate, not a product candidate.

## Phase 3 - Learned Gate

Purpose: learn a tiny CPU-only gate that chooses when an advanced predictor can
replace the current baseline.

Result: a monotonic score gate achieved zero `>5px` and zero `>10px`
regressions on the synthetic test split, but only produced a small improvement.

## Phase 4 - Synthetic Pareto Frontier

Purpose: map strict, balanced, aggressive, and no-go tradeoffs for synthetic
gates.

Result: strict stayed safe; balanced/aggressive gained slightly more mean
improvement by allowing small regression counts. This was useful for analysis
but not enough for product promotion.

## Phase 5 - ML/FSMN Teacher

Purpose: estimate the offline accuracy ceiling from compact script-generated
samples while keeping scripts as the canonical dataset.

Candidates:

- small MLP residual teacher;
- causal CNN/TCN-style teacher when practical;
- FSMN-lite and CSFSMN-lite;
- RFN/random feature ridge models;
- linear residual teacher.

Rules:

- no checkpoints unless a later phase explicitly requests them;
- no frame-level dataset dumps.

Result: raw learned teachers improved some synthetic metrics but were unsafe.
Gated teachers were safe but did not cleanly beat the synthetic strict gate.

## Phase 6 - Strict-Gate Distillation

Purpose: improve only the rows where the strict synthetic gate already advances.

Result: strict residual distillation improved mean by only about `0.01 px`,
with no p95/p99/max gain. The synthetic strict gate was effectively at the
noise floor.

## Phase 7 - Real Trace Replay

Purpose: replay synthetic candidates on real TraceTool captures before any
Calibrator promotion.

Result: the synthetic strict/balanced gates did not transfer to real trace. Raw
LS improved mean but caused many large regressions.

## Phase 8 - Real Gate And Synthetic Gap

Purpose: retune the gate on real traces and identify why synthetic gates failed.

Result: `real_tree_blend_cv_ls_w50_cap36_ls0p25_1` improved real-trace mean by
about `0.19 px` with zero `>5px` and zero `>10px` regressions, but only two
usable sessions were available.

## Runtime Follow-Up

Measurements:

- scalar JavaScript/C# reference cost;
- managed SIMD feasibility;
- native SIMD feasibility where available;
- memory footprint and branch behavior;
- quality under missing-history masks.

## Calibrator Promotion

Purpose: promote only a candidate that survives real product-runtime evidence.

Requirements:

- fixed deterministic runtime behavior;
- CPU-only inference;
- no ML runtime dependency;
- matched Calibrator comparison against the current product baseline;
- regression policy covering p95, p99, max, and large per-row failures.

Current status: do not promote yet. Collect more real traces first, then rerun
real cross-session gate tuning and only then move to Calibrator.
