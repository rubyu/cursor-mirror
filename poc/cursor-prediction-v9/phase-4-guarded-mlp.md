# Cursor Prediction v9 Phase 4 Guarded MLP

Generated: 2026-05-03T04:34:55Z

Device: `NVIDIA GeForce RTX 5090`  
Torch: `2.11.0+cu128`  
CUDA available: `True`

The MLP teacher was trained on the first 70% of each train session, the guard
was selected on the trailing 30%, and the selected guard was evaluated on the
other session. No Calibrator run, dataset cache, checkpoint, or TensorBoard
artifact was written.

## train-session-1-eval-session-2

Train split: `44316` train rows, `18994` validation rows. Eval: `47639` rows.

Model train sec: `0.385`, estimated eval rows/sec: `14426474.5`.

### Selected Evaluation

| role | candidate | mean | rmse | p95 | p99 | max | >1px reg | >5px reg | >1px improved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | product-baseline | 13.957 | 34.152 | 65.847 | 155.872 | 573.080 | 0 | 0 | 0 |
| unguarded | mlp-unguarded | 9.141 | 22.930 | 41.952 | 105.664 | 452.620 | 7122 | 3251 | 18933 |
| strict | speed-thresholds-strict | 13.956 | 34.152 | 65.847 | 155.872 | 573.080 | 0 | 0 | 17 |
| balanced | path-residual-le-16px-base-le-4px-eff-ge-0.9 | 13.396 | 33.813 | 64.938 | 155.563 | 573.080 | 3121 | 783 | 7025 |

### Selected On Validation

| objective | candidate | p95 | p99 | >1px reg | >5px reg | >1px improved | score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| strict | speed-thresholds-strict | 34.234 | 150.013 | 0 | 0 | 1 | 86.74 |
| balanced | path-residual-le-16px-base-le-4px-eff-ge-0.9 | 33.000 | 149.792 | 1885 | 499 | 1685 | 120.29 |
## train-session-2-eval-session-1

Train split: `33344` train rows, `14295` validation rows. Eval: `63310` rows.

Model train sec: `0.062`, estimated eval rows/sec: `17116232.9`.

### Selected Evaluation

| role | candidate | mean | rmse | p95 | p99 | max | >1px reg | >5px reg | >1px improved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | product-baseline | 5.560 | 21.449 | 24.000 | 88.541 | 614.649 | 0 | 0 | 0 |
| unguarded | mlp-unguarded | 6.651 | 18.546 | 29.521 | 69.564 | 520.094 | 18547 | 9755 | 13203 |
| strict | speed-thresholds-strict | 5.557 | 21.449 | 24.000 | 88.541 | 614.649 | 5 | 0 | 72 |
| balanced | agreement-cos05-residual-le-24px | 4.909 | 20.865 | 20.363 | 86.626 | 614.649 | 3254 | 1424 | 8975 |

### Selected On Validation

| objective | candidate | p95 | p99 | >1px reg | >5px reg | >1px improved | score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| strict | speed-thresholds-strict | 76.894 | 161.659 | 0 | 0 | 14 | 133.46 |
| balanced | agreement-cos05-residual-le-24px | 75.098 | 159.444 | 1463 | 712 | 3305 | 174.64 |

