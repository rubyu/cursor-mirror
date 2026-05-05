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
| controller tick total | 359 | 514.1 | 1084.7 | 1183.2 | 3779.9 |
| controller move overlay | 359 | 508.6 | 1066.7 | 1172.1 | 1549.8 |
| overlay move | 359 | 506.9 | 1063.0 | 1159.8 | 1547.2 |
| `UpdateLayer` | 360 | 503.5 | 1054.1 | 1163.8 | 2029.6 |
| `GetDC` | 0 |  |  |  |  |
| `GetHbitmap` | 1 | 181.3 | 181.3 | 181.3 | 181.3 |
| `UpdateLayeredWindow` | 360 | 492.9 | 1032.3 | 1126.9 | 1524.4 |

## hold-heavy-repeated-positions

- package: `product-runtime-outlier-hold-heavy-repeated-positions.zip`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | count | p50 us | p95 us | p99 us | max us |
| --- | ---: | ---: | ---: | ---: | ---: |
| controller tick total | 359 | 16.4 | 609.7 | 902.5 | 1263.2 |
| controller move overlay | 181 | 0.1 | 770.6 | 1038.8 | 1247.7 |
| overlay move | 29 | 692.4 | 1037.8 | 1102.9 | 1242.7 |
| `UpdateLayer` | 30 | 675.0 | 1029.8 | 1093.9 | 1236.0 |
| `GetDC` | 0 |  |  |  |  |
| `GetHbitmap` | 1 | 51.4 | 51.4 | 51.4 | 51.4 |
| `UpdateLayeredWindow` | 30 | 670.7 | 1021.5 | 1074.5 | 1210.1 |
