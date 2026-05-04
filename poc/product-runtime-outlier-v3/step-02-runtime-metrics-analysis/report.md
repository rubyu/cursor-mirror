# Product Runtime Outlier v3 Metrics

## Packages

| Package | events | dropped | scheduler | controller | overlay | update failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product-runtime-outlier-release-final-selected.zip | 11541 | 0 | 1802 | 1802 | 7937 | 0 |

## product-runtime-outlier-release-final-selected.zip

- events: `11541`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: |
| scheduler wake late | 0.0 | 588.0 | 1575.0 | 9072.0 |
| scheduler tick total | 620.4 | 1252.6 | 1749.0 | 11695.2 |
| scheduler wait | 16033.8 | 16579.5 | 17581.0 | 20854.2 |
| controller tick total | 617.3 | 1250.7 | 1745.3 | 11689.9 |
| controller poll | 10.3 | 23.4 | 31.2 | 661.9 |
| controller predict | 3.9 | 8.6 | 11.9 | 1343.2 |
| move overlay | 587.1 | 1212.0 | 1685.1 | 3039.2 |
| apply opacity | 2.2 | 7.0 | 248.1 | 9948.3 |
| `UpdateLayer` | 517.0 | 1171.3 | 1607.4 | 9943.3 |
| `GetHbitmap` | 0.0 | 97.0 | 183.3 | 593.5 |
| `UpdateLayeredWindow` | 411.4 | 980.1 | 1338.0 | 9836.6 |
| overlay move | 586.6 | 1213.3 | 1684.2 | 3037.8 |

### Coalescing Fields

No coalescing-related CSV columns were present.

