# Cursor Prediction v2 Experiment Plan

## Goal
Use the new trace package `cursor-mirror-trace-20260501-091537.zip` to search for the best short-horizon cursor prediction model, then reduce the model toward a lightweight implementation suitable for Cursor Mirror.

This v2 run differs from the first PoC because the trace contains both low-level hook movement samples and periodic `GetCursorPos` polling samples with DWM timing. The main question is no longer only "can the next hook position be predicted?" It is also "which clock and display-timing target should the overlay aim for, and what model minimizes visible error at that target?"

## Source Data
- Input trace: repository root `cursor-mirror-trace-20260501-091537.zip`
- Trace format: `2`
- Total samples: `218146`
- Hook movement samples: `57704`
- Cursor polling samples: `160442`
- DWM timing samples: `160442`
- Poll interval setting: `8ms`
- Duration: about `2524.3s`

The input zip MUST remain at the repository root and MUST NOT be copied into `poc/`.

## Operating Rules
- All v2 work is performed under `poc/cursor-prediction-v2/`.
- Each phase uses a directory named `phase-N short-name/`.
- Each phase records:
  - `README.md`
  - `experiment-log.md`
  - `report.md`
  - `scores.json`
  - reproducible scripts
- Scores and model-comparison outputs MUST be stored as JSON.
- Heavy generated arrays, checkpoints, and temporary outputs SHOULD be ignored by Git.
- Experiments read trace data only; they MUST NOT install a Windows hook.
- CPU timing measurements MUST run one at a time and be treated as approximate.
- GPU training MAY use NVIDIA CUDA when it materially helps model search.
- Product candidates MUST be evaluated for both accuracy and runtime shape.

## Primary Prediction Target
The primary target is the future visible cursor position at a short display-relative horizon.

The v2 analysis will compare at least three target definitions:
- `poll-time`: future `GetCursorPos` sample at fixed horizons such as 4, 8, 12, 16, and 24ms.
- `dwm-next-vblank`: cursor position at or near the next DWM vertical blank time.
- `dwm-plus-latency`: cursor position at a configurable offset after the latest DWM timing point, approximating overlay presentation latency.

The experiment MUST report when a target definition cannot be constructed reliably from the trace.

## Primary Score
Primary score:
- mean Euclidean prediction error in pixels on a held-out chronological test split.

Secondary scores:
- RMSE
- p50, p90, p95, p99
- maximum error
- error by speed bin
- error by acceleration/turning bin
- error by idle-gap distance
- error by event source
- valid sample count
- inference latency
- estimated per-frame CPU cost
- model parameter count
- required history length

For product-readiness, p95/p99 and stop/turn behavior are more important than a small mean-only improvement.

## Phase Roadmap

### Phase 1: Data Audit and Timebase Reconstruction
Purpose:
- Parse `trace.csv` and `metadata.json`.
- Validate monotonic sequence, stopwatch ticks, elapsed microseconds, event source counts, and DWM timing continuity.
- Compare hook positions and poll positions when both are near the same time.
- Reconstruct continuous cursor position over time from poll samples.
- Identify idle periods, recording pauses, duplicate positions, timer jitter, and DWM refresh cadence.

Outputs:
- data-quality report
- interval and jitter tables
- DWM timing summary
- recommended train/validation/test split boundaries

### Phase 2: Ground Truth and Baselines
Purpose:
- Define reliable future-position labels using interpolation over poll samples.
- Evaluate non-ML baselines against each target definition.

Baseline models:
- hold-current
- constant velocity from last two samples
- gain/damped constant velocity
- last-N linear regression
- acceleration from last three samples
- speed-gated last2
- simple Kalman/alpha-beta filter variants

Outputs:
- baseline `scores.json`
- target-definition comparison
- first decision on the most meaningful product target

### Phase 3: Feature Engineering and Error Anatomy
Purpose:
- Analyze where the best baseline fails.
- Build feature sets for ML models without future leakage.

Candidate features:
- recent positions and deltas
- recent velocity, acceleration, jerk
- speed and direction changes
- elapsed time gaps
- hook-vs-poll delta
- time since last hook event
- time since last poll event
- DWM refresh period and phase
- normalized target horizon

Outputs:
- error segmentation report
- feature ablation plan
- candidate feature schemas

### Phase 4: Best-Accuracy Model Search
Purpose:
- Find the strongest model without worrying yet about product complexity.

Candidate models:
- gradient boosted trees if a local package is available
- random forest or extra-trees style regressors where feasible
- PyTorch MLP residual models
- PyTorch temporal convolution models
- small GRU/LSTM sequence models
- transformer-lite sequence model only if simpler models plateau
- mixture-of-experts or speed-gated neural hybrid

Training:
- Prefer GPU for neural model training.
- Keep chronological train/validation/test splits.
- Avoid leakage across adjacent windows by using split gaps.
- Compare direct position prediction and residual-over-last2 prediction.

Outputs:
- best-accuracy model leaderboard
- model checkpoints only when useful
- `scores.json` with full metrics

### Phase 5: Robustness and Generalization Checks
Purpose:
- Ensure the best model is not merely exploiting one easy segment.

Checks:
- segment-wise cross validation over time
- high-speed movements
- low-speed precise movements
- abrupt stop and reversal segments
- long idle restart behavior
- DWM timing discontinuities
- outlier and max-error review

Outputs:
- robustness report
- failure case gallery as JSON rows
- recommendation on whether the model is safe enough to simplify

### Phase 6: Distillation and Lightweight Model Design
Purpose:
- Reduce the strongest model into something product-shaped.

Candidate reductions:
- speed-gated last2 plus learned gain table
- piecewise linear correction by speed and horizon
- tiny MLP with fixed weights embedded in source
- quantized tiny MLP
- lookup table for gain/damping
- alpha-beta model with auto-tuned parameters

Outputs:
- distilled model leaderboard
- parameter count and operation estimate
- C# implementation sketch

### Phase 7: Runtime Microbenchmark
Purpose:
- Measure approximate CPU cost of the best lightweight candidates.

Measurements:
- single-sample inference latency
- batch throughput for sanity only
- allocations per prediction where measurable
- warm vs cold timing
- comparison with existing last2 predictor

Rules:
- Run timing measurements serially.
- Treat results as approximate due to shared CPU and background load.
- GPU timings are not product-relevant unless the model is only used offline.

Outputs:
- runtime `scores.json`
- implementation recommendation

### Phase 8: Product Recommendation
Purpose:
- Decide what should go into Cursor Mirror.

Possible outcomes:
- keep current last2 predictor
- use DWM-aware dynamic horizon with current predictor
- add speed-gated damping
- add tiny residual model behind a setting
- collect more traces before productizing neural prediction

Outputs:
- final report
- ranked recommendation
- implementation tasks and tests

## Phase Expansion Rule
Additional phases SHOULD be inserted whenever an experiment reveals a promising signal or a concerning failure mode. Examples:
- DWM phase turns out to explain large errors.
- Hook-vs-poll divergence needs separate modeling.
- A neural model improves high-speed motion but regresses precision movement.
- A tiny distilled model nearly matches the full model.

## Initial Execution Plan
1. Create Phase 1 data loader and audit scripts.
2. Produce `phase-1 data-audit-timebase/scores.json` and report.
3. Use Phase 1 findings to lock the label construction for Phase 2.
4. Run deterministic baselines before training deep models.
5. Start GPU neural search only after the baseline target is stable.

## Current Hypotheses
- Poll samples are likely the best ground truth for visible cursor position because they continue when hooks do not fire.
- DWM timing may help choose the prediction horizon more than it helps raw position prediction.
- The strongest product improvement may come from dynamic horizon selection plus a simple predictor, not from a large model.
- Deep models may still be valuable as an oracle to discover speed/turn/phase correction patterns that can later be distilled.
