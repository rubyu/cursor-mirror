# Cursor Prediction v7 Report

## Scope

Summarize the calibrator packages, candidate builds, and scoring command used for this report.

## Artifacts

| candidate | run | package | duration | notes |
| --- | --- | --- | --- | --- |
| current-default | 001 | pending | 30s | baseline planned |

## Score Summary

| candidate | visual score | delta vs baseline | gate result |
| --- | --- | --- | --- |
| current-default | pending | baseline | pending |

## Pattern Deltas

| pattern | candidate | p95 delta | p99 delta | max delta | note |
| --- | --- | --- | --- | --- |
| linear-fast | pending | pending | pending | pending | pending |
| rapid-reversal | pending | pending | pending | pending | pending |
| sine-sweep | pending | pending | pending | pending | pending |
| short-jitter | pending | pending | pending | pending | pending |

## Recommendation

Pending measurement.

## Risks

- Candidate builds beyond `current-default` need an explicit mechanism before measurement.
- Per-pattern p99 requires enough dark frames per pattern.
- Capture environment changes can dominate small model differences.
