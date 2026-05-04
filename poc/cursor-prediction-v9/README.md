# Cursor Prediction v9

v9 treats cursor prediction as an explicit machine-learning research project.
The goal is to find the practical accuracy ceiling first, even if the best
model is too expensive to ship, then reduce the winning idea into a very fast
runtime candidate.

## Goals

- Minimize measured cursor separation on captured traces and Calibrator runs.
- Measure the model size and compute cost required to reach each accuracy tier.
- Try high-capacity sequence models before rejecting machine learning.
- Distill or approximate promising models into a product-shaped predictor.
- Keep all experiments causal: only past and current cursor data may be used.
- Keep raw trace and calibration packages out of git.

## Evaluation Sources

### Trace Data

Use root-level `cursor-mirror-trace-*.zip` packages as local-only inputs. These
packages are intentionally ignored by git. The training/evaluation policy is:

- build train/validation/test splits by recording session;
- preserve chronological order inside each session;
- never use future position fields as model inputs;
- evaluate missing-history robustness by masking parts of the recent history;
- report aggregate metrics and speed/regime breakdowns.

### Calibrator

Use `CursorMirror.Calibrator` as the promotion measurement because it exercises
the product runtime and capture path. A candidate that only wins offline trace
metrics is not product-ready until it also wins Calibrator scoring.

Promotion runs should use:

- `--product-runtime`;
- at least 30 seconds for final comparisons;
- repeated runs for the final two candidates;
- `poc/cursor-prediction-v7/scripts/score-calibration.js` or a v9 successor for
  package scoring.

## Metrics

The primary metric is estimated separation in pixels. Lower is better.

Required JSON outputs:

- `scores.json` for phase-level summaries;
- per-phase JSON reports for model families and parameter sweeps;
- Calibrator scoring JSON for promotion candidates.

Each score entry should include:

- model family and candidate id;
- train/evaluation sessions;
- mean, RMSE, p50, p90, p95, p99, and max separation;
- regression counts versus the current product baseline;
- speed-bin and motion-regime breakdowns;
- parameter count, approximate FLOPs, measured inference throughput, and latency;
- whether GPU, CPU, SIMD, or scalar inference was used.

## Model Families

Start broad, then narrow:

- Current product predictors: `ConstantVelocity` and `LeastSquares`.
- Classical filters: alpha-beta, alpha-beta-gamma, Kalman variants, and robust
  polynomial extrapolation.
- RFN: random feature networks, including random Fourier/RBF feature maps with
  ridge or logistic gating heads.
- MLP: residual predictors over fixed causal history windows.
- CNN: 1D temporal convolution over cursor history and timing features.
- FSMN: feedforward sequential memory networks with learned memory taps.
- TCN: dilated causal temporal convolution as a stronger CNN baseline.
- RNN: GRU/LSTM teacher models for accuracy ceiling checks.
- Mixture/gating: regime detector plus specialist predictors.
- Distillation: compact linear, piecewise-linear, lookup, or SIMD-friendly
  approximations of the best teacher.

## Product Constraints

The product candidate should ultimately satisfy both:

- very high accuracy in Calibrator and trace replay;
- very low per-frame CPU cost with no background training or model loading.

Large GPU models are allowed in early phases only to identify the accuracy
ceiling. They are not automatically product candidates.

## Experiment Control

Only one CPU/GPU measurement task should run at a time. Heavy jobs should avoid
unnecessary checkpoints, TensorBoard logs, cached feature dumps, or generated
datasets unless a file is explicitly part of the report. Keep raw data under
ignored paths such as `runs/raw/`.

