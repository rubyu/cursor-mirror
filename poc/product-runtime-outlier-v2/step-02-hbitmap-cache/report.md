# Step 02: HBITMAP Cache

## Change

`OverlayWindow` now keeps a reusable `MemoryDC` and `HBITMAP` for the current cursor bitmap. The cache is invalidated when the cursor image changes or the overlay window is disposed.

`GetDC` and `UpdateLayeredWindow` still run per update. This keeps the first implementation conservative and only removes the measured `Bitmap.GetHbitmap` / compatible-DC churn from the move path.

## Result

- events: `11538`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | baseline p95 us | cache p95 us | baseline p99 us | cache p99 us |
| --- | ---: | ---: | ---: | ---: |
| scheduler wake late | 2658.0 | 817.0 | 22821.0 | 2685.0 |
| controller tick total | 3896.3 | 1425.1 | 15884.9 | 2066.6 |
| move overlay | 3681.4 | 1383.9 | 7998.1 | 1948.0 |
| `UpdateLayer` | 4613.9 | 1330.9 | 11172.2 | 1886.8 |
| `GetHbitmap` | 1829.1 | 102.6 | 5302.8 | 185.9 |
| `UpdateLayeredWindow` | 2037.1 | 1084.2 | 5568.8 | 1534.8 |

## Interpretation

This variant is a clear win. It removes most of the `GetHbitmap` tail and also lowers the `UpdateLayeredWindow` tail, likely because less GDI churn occurs around the layered update.

Selected for product code.
