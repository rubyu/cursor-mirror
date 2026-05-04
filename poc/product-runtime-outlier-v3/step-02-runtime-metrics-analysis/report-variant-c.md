# Product Runtime Outlier v3 Metrics

## Packages

| Package | events | dropped | scheduler | controller | overlay | update failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product-runtime-outlier-variant-c.zip | 2444 | 0 | 601 | 601 | 1242 | 0 |

## product-runtime-outlier-variant-c.zip

- events: `2444`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: |
| scheduler wake late | 0.0 | 235.0 | 571.0 | 990.0 |
| scheduler tick total | 8.7 | 33.7 | 98.8 | 3704.6 |
| scheduler wait | 16649.0 | 16858.1 | 17212.2 | 17626.6 |
| controller tick total | 6.6 | 29.9 | 89.5 | 3170.8 |
| controller poll | 2.5 | 24.6 | 76.5 | 1257.6 |
| controller predict | 0.0 | 0.0 | 0.0 | 0.0 |
| move overlay | 0.0 | 0.0 | 0.0 | 0.0 |
| apply opacity | 1.5 | 3.9 | 11.6 | 1497.6 |
| `UpdateLayer` |  |  |  |  |
| `GetHbitmap` |  |  |  |  |
| `UpdateLayeredWindow` |  |  |  |  |
| overlay move |  |  |  |  |

### Coalescing Fields

| Field | count | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| `mouseMoveEventsReceived` | 2444 | 0.0 | 1.0 | 2.0 | 2.0 |
| `mouseMoveEventsCoalesced` | 2444 | 0.0 | 0.0 | 0.0 | 0.0 |
| `mouseMovePostsQueued` | 2444 | 0.0 | 1.0 | 2.0 | 2.0 |
| `mouseMoveCallbacksProcessed` | 2444 | 0.0 | 1.0 | 2.0 | 2.0 |
| `latestMouseMoveAgeMicroseconds` | 2444 | 0.0 | 12187.0 | 15044.0 | 27446.0 |
| `overlayMoveSkipped` | 2444 | 0.0 | 0.0 | 0.0 | 0.0 |

