# Phase 10 - CPU-only product integration and Calibrator check

## Goal

Move the Phase 9 runtime candidate into the product as a non-default
experimental model, then check whether the Calibrator can confirm the replay
gain under the real overlay runtime.

## Product constraints

- The installed application must not use GPU inference.
- The installed application must not download or load a machine-learning
  runtime.
- The model is fixed-weight CPU code embedded in the application.
- GPU use remains limited to offline POC training and export.
- SIMD is allowed as a future CPU-only optimization, but the first product
  integration uses scalar loops with preallocated buffers.

## Implementation

- Added `ExperimentalMLP` as a selectable, non-default prediction model.
- Kept `ConstantVelocity` as the default model.
- Kept `LeastSquares` available for comparison.
- Embedded the Phase 9 teacher and gate weights as generated C# arrays.
- Reused per-predictor buffers for teacher input, hidden layers, and gate input.
- Added early CPU guards before teacher evaluation:
  - skip when the latest two-sample speed is at least `1000 px/s`;
  - skip when the recent 72 ms path net speed is at least `1000 px/s`.
- Added diagnostic counters for skip/evaluate/reject/apply decisions.

## Verification

- `scripts/test.ps1`: 119 passed, 0 failed.
- `scripts/build.ps1 -Configuration Release`: passed.
- Calibrator was run with the product runtime and Windows Graphics Capture.

## Calibrator runs

| Candidate | Frames | Score | Mean | P95 | P99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `constant-velocity` | 696 | 14.10 | 3.756 | 12 | 12 | 26 |
| `experimental-mlp` | 696 | 22.50 | 3.718 | 12 | 12 | 82 |
| `experimental-mlp-speedguard` | 696 | 21.30 | 3.728 | 12 | 12 | 74 |
| `experimental-mlp-pathguard` | 696 | 20.85 | 3.779 | 12 | 12 | 71 |
| `constant-velocity-rerun` | 697 | 23.10 | 4.263 | 12 | 12 | 86 |
| `experimental-mlp-counters` | 696 | 23.25 | 3.993 | 12 | 12 | 87 |

The high max values appeared in the `linear-fast` phase for both
`ExperimentalMLP` and a later `ConstantVelocity` rerun, so this Calibrator batch
does not prove an ExperimentalMLP-specific regression. It also does not prove a
stable win.

## Diagnostic counters

For `experimental-mlp-counters`:

- skipped by latest speed: `1151`;
- skipped by path speed: `137`;
- teacher/gate evaluations: `510`;
- gate rejections: `453`;
- applied corrections: `57`.

## Decision

Keep `ExperimentalMLP` available as a non-default experimental option, but do
not promote it to the default model. The offline replay gain is real, and the
CPU-only implementation is feasible, but Calibrator results are too noisy and
too close to call. The next useful work is either a matched multi-candidate
Calibrator mode or a much cheaper product-shaped approximation that can be
evaluated on every low-speed frame with less timing risk.
