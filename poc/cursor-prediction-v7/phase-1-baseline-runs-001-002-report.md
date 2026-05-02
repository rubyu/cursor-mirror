# Phase 1 Baseline Runs 001-002 Report

## Artifacts

Input packages:

```text
poc/cursor-prediction-v7/runs/raw/current-default/calibration-current-default-001.zip
poc/cursor-prediction-v7/runs/raw/current-default/calibration-current-default-002.zip
```

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/baseline-score.json
```

## Validity

Runs 001 and 002 are valid current-default baseline measurements.

- Quality warnings: none.
- Both packages contain `frames.csv` and `metrics.json`.
- Required CSV columns are present in both packages.
- All expected default motion patterns are present in both packages.
- CSV-derived frame counts match `metrics.json`.
- Capture source: `Windows Graphics Capture`.

## Aggregate Metrics

| metric | value |
| --- | ---: |
| run count | 2 |
| total frames | 1,873 |
| dark frames | 1,873 |
| combined mean separation | 4.735 px |
| combined overall p95 separation | 12 px |
| combined overall p99 separation | 12 px |
| combined max separation | 47 px |
| combined weighted per-pattern visual score | 14.012 px |

## Per-Run Variance

| run | frames | mean | p95 | p99 | max | weighted pattern score | quality warnings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 001 | 938 | 4.771 | 12 | 12 | 44 | 14.816 | none |
| 002 | 935 | 4.698 | 12 | 12 | 47 | 13.867 | none |

Overall behavior is close across the two runs: frame counts differ by 3, mean separation differs by `0.072 px`, p95 and p99 are both `12 px`, and max differs by `3 px`.

## Linear-Fast Tail

| scope | frames | mean | p95 | p99 | max | score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| run 001 | 62 | 4.242 | 32 | 44 | 44 | 38.000 |
| run 002 | 62 | 2.694 | 12 | 47 | 47 | 29.500 |
| combined | 124 | 3.468 | 14 | 44 | 47 | 29.450 |

The `linear-fast` tail is stable as a repeated high-end spike: both runs produced a `44-47 px` maximum. It is not stable in exact percentile shape yet: p95 dropped from `32 px` in run 001 to `12 px` in run 002 while p99 remained high. This suggests the high-separation event is sparse but repeatable.

## Pattern Summary

| pattern | frames | mean | p95 | p99 | max | score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| linear-slow | 323 | 6.523 | 12 | 12 | 25 | 13.950 |
| hold-right | 48 | 10.375 | 12 | 12 | 12 | 12.000 |
| linear-fast | 124 | 3.468 | 14 | 44 | 47 | 29.450 |
| hold-left | 48 | 9.104 | 12 | 12 | 12 | 12.000 |
| quadratic-ease-in | 225 | 6.031 | 12 | 13 | 14 | 12.650 |
| quadratic-ease-out | 223 | 2.695 | 12 | 12 | 12 | 12.000 |
| cubic-smoothstep | 266 | 5.786 | 12 | 12 | 12 | 12.000 |
| cubic-in-out | 186 | 4.441 | 12 | 12 | 12 | 12.000 |
| rapid-reversal | 127 | 2.606 | 12 | 12 | 12 | 12.000 |
| sine-sweep | 176 | 2.403 | 12 | 12 | 12 | 12.000 |
| short-jitter | 127 | 2.512 | 11 | 12 | 12 | 11.500 |

## Recommendation

Take `current-default` run 003 before candidate knobs. Two runs are clean enough to trust the measurement path, but the `linear-fast` p95 variance is still too large to set a stable candidate gate. Run 003 should determine whether candidate comparisons should target `linear-fast` p99/max only or also use p95 as a reliable gate.
