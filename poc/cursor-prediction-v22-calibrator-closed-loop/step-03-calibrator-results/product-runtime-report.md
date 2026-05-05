# Product Runtime Telemetry Summary

Input packages: 7.

| variant | controller | updateLayer | tick p95 us | predict p95 us | move p95 us | ULW p95 us | ULW max us | wake-late p95 us | latest move age p95 us | skipped moves |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| constant-velocity-offset-0 | 3002 | 2987 | 926.7 | 6.5 | 883.7 | 876.4 | 2481.2 | 395 | 0 | 0 |
| constant-velocity-offset-minus2 | 3001 | 2927 | 1038.8 | 7.2 | 996.3 | 986.2 | 3139.6 | 557 | 0 | 0 |
| constant-velocity-offset-plus2 | 3001 | 3022 | 796.8 | 5.5 | 768.4 | 760.1 | 2004.7 | 447 | 0 | 0 |
| distilled-mlp-offset-minus4 | 3002 | 2873 | 842.9 | 29.1 | 792.8 | 791.2 | 2642.9 | 390 | 0 | 0 |
| least-squares-offset-0 | 3002 | 2655 | 926.2 | 10.7 | 883.2 | 898.4 | 2465.8 | 531 | 0 | 0 |
| runtime-event-safe-mlp-offset-minus2 | 3002 | 2735 | 1017.1 | 28.8 | 947.1 | 948.6 | 2922.2 | 572 | 0 | 0 |
| runtime-event-safe-mlp-offset-minus4 | 3002 | 2663 | 908.5 | 24 | 863.1 | 877 | 2224 | 505 | 0 | 0 |
