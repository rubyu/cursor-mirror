# Step 5 Experiment Log: Neural Models

## Goal

Test whether a small multilayer perceptron can beat the Step 4 `constant-velocity-last2` recommendation for Cursor Mirror cursor prediction.

Primary concern: not just lower mean error, but speed-dependent behavior and tail safety (`p95`, `p99`, `max`).

## Runtime Availability

Observed runtime:

| item | result |
|---|---|
| Python | `3.12.13` bundled Codex runtime |
| NumPy | `2.3.5` |
| sklearn | not installed |
| torch | not installed |
| tensorflow | not installed |
| onnxruntime | not installed |
| GPU | NVIDIA GeForce RTX 5090 visible through `nvidia-smi` |
| Driver | `576.88` |
| CUDA reported by nvidia-smi | `12.9` |

Conclusion: GPU hardware exists, but no installed ML runtime can use it from this Python environment. The experiment therefore uses CPU NumPy. No network install was attempted.

## Data And Split

Trace source: repo-root `cursor-mirror-trace-20260501-000443.zip`, entry `trace.csv`.

The script streams the zip entry and does not extract or copy it into this step directory.

Data policy:

- samples: `15214`;
- idle gap threshold: `100ms`;
- gap-split segments: `657`;
- train/test split: first `70%` of sample indices for training, latter `30%` for test;
- validation: final `20%` slice inside the training region for early stopping;
- feature-valid anchors: `12513`.

The Step 5 neural and baseline rows use a common feature-valid anchor mask so that MLP and baseline numbers are directly comparable. This means the recomputed Step 5 baseline can differ from Step 1's broader all-valid-history baseline.

## Feature Design

At anchor `i`, features use only samples `<= i`.

Feature groups:

- last 5 intervals of `dt`, `dx`, `dy`, `vx`, `vy`;
- current and previous speed;
- acceleration from the last two interval velocities;
- turn cosine and sine;
- segment age in milliseconds and samples;
- total displacement over the history window;
- average history velocity.

Rejected feature alternatives:

- future-aware smoothing or centered windows, because they leak target-side information;
- large history windows, because most gap-split segments are short and this would drop too many anchors;
- model grids with many widths/depths, because Step 5 is a bounded PoC and the CPU is shared.

## Model Design

MLP candidates:

| model | target | hidden sizes | parameters | multiply-adds per prediction |
|---|---|---:|---:|---:|
| `mlp-direct-h32x16` | future displacement | `32,16` | `1778` | `1728` |
| `mlp-residual-last2-h32x16` | correction to last2 | `32,16` | `1778` | `1728` |

Training:

- deterministic seed: `20260501`;
- feature standardization from train-fit only;
- target standardization from train-fit only;
- full-batch Adam;
- max epochs: `250`;
- patience: `25`;
- learning rate: `0.003`;
- L2: `1e-4`.

Training stayed bounded: total script time was about `7.45s`, with individual model fits under `1s` each.

## Observations

Aggregate common-anchor results favored the MLPs at all tested horizons. The residual MLP was best at `4/8/12/16ms`; the direct MLP was best at `24ms`.

However, speed-bin analysis showed the reason for caution:

- high-speed `3000+ px/s` errors improved materially;
- low-speed `0-500 px/s` bins regressed for neural models;
- some neural max errors were worse than `constant-velocity-last2`, even when mean/p95/p99 improved.

This is promising for a future speed-gated hybrid, but not enough to replace Step 4's simple default.

## Rejected Alternatives

- Installing PyTorch/TensorFlow/ONNX Runtime: rejected because the task explicitly avoided network installs unless authorized.
- Using GPU through custom CUDA code: rejected as far outside the scope and risk profile of this PoC.
- Training a large grid: rejected to keep runtime bounded and avoid overfitting one trace.
- Producing a learned default recommendation from one trace: rejected because the product decision needs tail safety across users/devices.

## Files Produced

- `run_neural_models.py`
- `scores.json`
- `README.md`
- `experiment-log.md`
- `report.md`

No git state was changed.
