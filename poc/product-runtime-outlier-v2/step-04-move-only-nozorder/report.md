# Step 04: Move-Only SetWindowPos(SWP_NOZORDER)

## Change

The move-only variant was adjusted to avoid z-order changes after the initial topmost setup:

```text
SetWindowPos(..., SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
```

This change was tested and then reverted.

## Result

- events: `9741`
- dropped events: `0`
- `UpdateLayeredWindow` failures: `0`

| Metric | HBITMAP cache p95 us | no-zorder p95 us | HBITMAP cache p99 us | no-zorder p99 us |
| --- | ---: | ---: | ---: | ---: |
| controller tick total | 1425.1 | 2925.9 | 2066.6 | 3771.9 |
| move overlay | 1383.9 | 2902.3 | 1948.0 | 3701.1 |
| `UpdateLayer` | 1330.9 | 571.9 | 1886.8 | 1018.7 |
| `UpdateLayeredWindow` | 1084.2 | 296.1 | 1534.8 | 423.4 |

## Interpretation

Avoiding z-order changes improved the move-only variant, but it remained worse than the HBITMAP cache. For this overlay window, moving the layered window is not cheaper than updating the cached layered bitmap.

Rejected.
