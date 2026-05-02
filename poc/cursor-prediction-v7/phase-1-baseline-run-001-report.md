# Phase 1 Baseline Run 001 Report

## Artifact

Input package:

```text
poc/cursor-prediction-v7/runs/raw/current-default/calibration-current-default-001.zip
```

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/baseline-score.json
```

## Validity

Run 001 is valid for the Phase 1 baseline set.

- Quality warnings: none.
- Required package entries were present: `frames.csv`, `metrics.json`.
- Required CSV columns were present.
- All expected default motion patterns were present.
- CSV-derived frame counts matched `metrics.json`.
- Capture source: `Windows Graphics Capture`.

This is a valid first baseline run, not a complete baseline by itself. The v7 plan still calls for repeated current-default measurements before candidate promotion or rejection.

## Summary Metrics

| metric | value |
| --- | ---: |
| total frames | 938 |
| dark frames | 938 |
| overall mean separation | 4.771 px |
| overall p50 separation | 0 px |
| overall p90 separation | 12 px |
| overall p95 separation | 12 px |
| overall p99 separation | 12 px |
| overall max separation | 44 px |
| weighted per-pattern visual score | 14.816 px |

## Per-Pattern Metrics

| pattern | frames | mean | p95 | p99 | max | score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| linear-slow | 162 | 6.543 | 12 | 12 | 25 | 13.950 |
| hold-right | 24 | 10.167 | 12 | 12 | 12 | 12.000 |
| linear-fast | 62 | 4.242 | 32 | 44 | 44 | 38.000 |
| hold-left | 24 | 9.333 | 12 | 12 | 12 | 12.000 |
| quadratic-ease-in | 112 | 5.750 | 12 | 13 | 14 | 12.650 |
| quadratic-ease-out | 111 | 2.703 | 12 | 12 | 12 | 12.000 |
| cubic-smoothstep | 132 | 5.606 | 12 | 12 | 12 | 12.000 |
| cubic-in-out | 94 | 4.819 | 12 | 12 | 12 | 12.000 |
| rapid-reversal | 63 | 2.698 | 12 | 12 | 12 | 12.000 |
| sine-sweep | 90 | 2.500 | 11 | 12 | 12 | 11.500 |
| short-jitter | 64 | 2.375 | 10 | 12 | 12 | 11.000 |

## Interpretation

The current-default baseline mostly sits at a `12 px` tail separation ceiling across patterns, but `linear-fast` produced a distinct outlier cluster: p95 `32 px`, p99 `44 px`, and max `44 px`. That makes `linear-fast` the first pattern to watch in repeated baseline runs and later candidate comparisons.

Recommended next step: capture `current-default` run 002 before testing candidate builds, so the baseline variance is known.
