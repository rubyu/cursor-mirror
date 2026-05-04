# Step 01: Release Baseline

## Command

```powershell
.\artifacts\bin\Release\CursorMirror.Calibrator.exe --auto-run --exit-after-run --product-runtime --duration-seconds 30 --output .\poc\product-runtime-outlier-v2\step-01-release-baseline\calibration-release-baseline.zip --product-runtime-outlier-output .\poc\product-runtime-outlier-v2\step-01-release-baseline\product-runtime-outlier-release-baseline.zip
```

## Result

- events: `10591`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: |
| scheduler wake late | 1.0 | 2658.0 | 22821.0 | 301283.0 |
| controller tick total | 841.5 | 3896.3 | 15884.9 | 178748.7 |
| move overlay | 809.9 | 3681.4 | 7998.1 | 155602.2 |
| `UpdateLayer` | 753.8 | 4613.9 | 11172.2 | 155596.5 |
| `GetHbitmap` | 186.1 | 1829.1 | 5302.8 | 19779.6 |
| `UpdateLayeredWindow` | 417.9 | 2037.1 | 5568.8 | 144536.9 |

## Interpretation

Release reproduces the v1 conclusion: product tick cost is dominated by overlay movement, and per-move `UpdateLayer` has a large tail.
