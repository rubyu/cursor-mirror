# Cursor Prediction v9 Phase 9 Runtime Candidate

Generated: 2026-05-03T05:20:38Z

Candidate: `mlp_seq32_h256_128_64 + tiny-MLP gate m5 p>=0.90 speed<1000 clamp4`

No Calibrator run, checkpoint, cache, TensorBoard, or expanded dataset artifact
was written. The runtime model weights JSON and C# prototype source are under
`runtime-prototype/`.

GPU was used only for offline training/export. Product inference must use the
fixed weights on CPU; this phase gates integration on C# CPU throughput.

## Metrics

| split | mean | rmse | p95 | p99 | max | >1 | >3 | >5 | >10 | >20 | >50 | improved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| validation baseline | 11.701 | 33.213 | 57.315 | 155.185 | 614.649 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| validation candidate | 11.476 | 32.612 | 55.685 | 153.435 | 610.650 | 211 | 207 | 0 | 0 | 0 | 0 | 2105 |
| all rows baseline | 9.165 | 27.629 | 42.720 | 129.000 | 614.649 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| all rows teacher | 5.002 | 16.443 | 20.148 | 68.012 | 855.325 | 19002 | 6682 | 4087 | 2179 | 1129 | 388 | 35547 |
| all rows candidate | 8.972 | 27.070 | 41.000 | 126.333 | 610.650 | 289 | 282 | 0 | 0 | 0 | 0 | 5688 |

## Export

Model JSON bytes: `2309958`  
Teacher weights: `109378` floats  
Gate weights: `73` floats  
C# source files: `5`

## C# Verification

Samples: `128`  
Max teacher abs diff: `0.00001526`  
Max gate probability abs diff: `0.00000009`  
Max final abs diff: `0.00000095`  
Apply mismatches: `0`  
C# scalar throughput: `22160.6` rows/sec  
Vector hardware accelerated: `False`

## Decision

Proceed to src integration behind a feature flag and then run Calibrator. GPU is only for offline training; this candidate is fixed-weight CPU inference, the C# scalar prototype matches Python samples, measured CPU throughput is above the expected poll-rate budget, and replay metrics improve p95/p99 without >5px regressions.
