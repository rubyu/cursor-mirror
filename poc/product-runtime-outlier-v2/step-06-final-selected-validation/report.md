# Step 06: Final Selected Validation

## Purpose

After adding cached GDI handle validation, rerun the selected HBITMAP cache variant to confirm the final product code still keeps the measured improvement and reports no update failures.

## Result

- events: `11541`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | baseline p95 us | final p95 us | baseline p99 us | final p99 us |
| --- | ---: | ---: | ---: | ---: |
| scheduler wake late | 2658.0 | 588.0 | 22821.0 | 1575.0 |
| controller tick total | 3896.3 | 1250.7 | 15884.9 | 1745.3 |
| move overlay | 3681.4 | 1212.0 | 7998.1 | 1685.1 |
| `UpdateLayer` | 4613.9 | 1171.3 | 11172.2 | 1607.4 |
| `GetHbitmap` | 1829.1 | 97.0 | 5302.8 | 183.3 |
| `UpdateLayeredWindow` | 2037.1 | 980.1 | 5568.8 | 1338.0 |

## Interpretation

The final code keeps the HBITMAP cache improvement and did not introduce telemetry drops or layered-window failures.
