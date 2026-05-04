# Synthetic Overlay Harness Report

POC-only harness using real `OverlayWindow` / `UpdateLayeredWindow` with synthetic cursor images and synthetic poll samples. It does not call `GetCursorPos` and does not use WGC.

| Scenario | frames | events | controller | overlay | `UpdateLayer` | skipped moves | failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| moving-every-frame | 360 | 1440 | 359 | 1081 | 360 | 0 | 0 |
| hold-heavy-repeated-positions | 360 | 780 | 359 | 421 | 30 | 330 | 0 |

## moving-every-frame

- package: `product-runtime-outlier-moving-every-frame.zip`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | count | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: | ---: |
| controller tick total | 359 | 1872.1 | 3283.0 | 3510.6 | 4372.0 |
| controller move overlay | 359 | 1856.8 | 3228.8 | 3502.5 | 4358.0 |
| overlay move | 359 | 1855.4 | 3227.6 | 3500.5 | 4355.0 |
| `UpdateLayer` | 360 | 1852.1 | 3224.2 | 3495.1 | 4349.3 |
| `GetDC` | 360 | 1188.6 | 2258.7 | 2515.8 | 3032.3 |
| `GetHbitmap` | 1 | 325.9 | 325.9 | 325.9 | 325.9 |
| `UpdateLayeredWindow` | 360 | 579.6 | 1082.7 | 1290.1 | 1436.0 |

## hold-heavy-repeated-positions

- package: `product-runtime-outlier-hold-heavy-repeated-positions.zip`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | count | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: | ---: |
| controller tick total | 359 | 14.8 | 2657.3 | 3515.0 | 3697.5 |
| controller move overlay | 184 | 0.1 | 3093.0 | 3607.3 | 3683.4 |
| overlay move | 29 | 2767.5 | 3604.6 | 3617.2 | 3680.1 |
| `UpdateLayer` | 30 | 2693.5 | 3597.3 | 3607.1 | 3673.8 |
| `GetDC` | 30 | 1743.3 | 2540.6 | 2553.3 | 2569.3 |
| `GetHbitmap` | 1 | 79.7 | 79.7 | 79.7 | 79.7 |
| `UpdateLayeredWindow` | 30 | 816.9 | 1193.8 | 1262.4 | 1304.1 |
