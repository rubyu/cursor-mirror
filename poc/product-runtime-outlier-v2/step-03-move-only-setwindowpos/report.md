# Step 03: Move-Only SetWindowPos(HWND_TOPMOST)

## Change

After the cursor image is shown, normal movement was changed to move the layered window with `SetWindowPos(HWND_TOPMOST)` instead of calling `UpdateLayeredWindow` each frame.

This change was tested and then reverted.

## Result

- events: `9734`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | HBITMAP cache p95 us | move-only p95 us | HBITMAP cache p99 us | move-only p99 us |
| --- | ---: | ---: | ---: | ---: |
| controller tick total | 1425.1 | 3309.0 | 2066.6 | 4191.3 |
| move overlay | 1383.9 | 3271.6 | 1948.0 | 4106.9 |
| `UpdateLayer` | 1330.9 | 549.0 | 1886.8 | 969.1 |
| `UpdateLayeredWindow` | 1084.2 | 269.2 | 1534.8 | 410.7 |

## Interpretation

The layered update count dropped, but the move operation itself became expensive. Reasserting topmost z-order on every frame appears too costly.

Rejected.
