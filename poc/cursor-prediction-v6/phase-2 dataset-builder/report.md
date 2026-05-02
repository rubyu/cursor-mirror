# Phase 2 - Dataset Builder

## Dataset

| session | rows | horizon mean | horizon p95 | speed p95 | ref nearest p95 | first 70% | last 30% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 175951 | 15,828 | 1.979 | 1.998 | 2,139.722 | 4.404 | 11,081 | 4,747 |
| 184947 | 11,910 | 1.985 | 1.998 | 6,012.731 | 0.987 | 8,338 | 3,572 |

Rows are written to `dataset.jsonl`. Each row includes anchor coordinates, prior anchor coordinates, causal velocity/acceleration summaries, DWM/scheduler timing fields visible at anchor time, and the interpolated future label.

## Cross-Validation Splits

| fold | train | eval |
| --- | --- | --- |
| train_175951_eval_184947 | 175951 | 184947 |
| train_184947_eval_175951 | 184947 | 175951 |

## Limitations

The label stream is an interpolated reference poll stream rather than hardware ground truth. It is dense enough for this POC, but reference interpolation error and any capture delay still bound how literally to read sub-pixel or very-low-pixel deltas.
