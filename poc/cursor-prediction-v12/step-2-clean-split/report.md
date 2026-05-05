# Step 2 Clean Split

## Scope

This step defines the reusable cleaning and split manifest for POC 12. It does not train a model; it makes later model evaluation deterministic and leak-resistant.

## Cleaning Policy

- Drop trace rows with `warmupSample=true`.
- Drop motion-sample rows before `WarmupDurationMilliseconds`.
- Treat `event=move` with `hookExtraInfo != 1129139532` as external input contamination.
- Drop all rows inside +/- 250 ms contamination windows.
- Drop scenario 0 from `m070055`.

## Base Scenario Split

The base split is scenario-unit and uses the same stable shuffle as earlier POCs:

- Train (44): 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16, 17, 19, 20, 22, 25, 27, 28, 31, 33, 36, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 60, 62, 63
- Validation (10): 1, 21, 24, 26, 30, 32, 35, 39, 53, 61
- Test (10): 0, 11, 12, 14, 18, 23, 29, 34, 37, 59

Scenario-level splitting avoids leaking adjacent 4.167 ms rows from the same generated curve into evaluation.

## Package Assignments

| pkg     | refresh | dropped | clean scenarios | train motion | val motion | test motion |
| ------- | ------- | ------- | --------------- | ------------ | ---------- | ----------- |
| m070055 | 30Hz    | 0       | 63              | 126721       | 28800      | 25920       |
| m070211 | 30Hz    | none    | 64              | 126721       | 28800      | 28680       |
| m070248 | 60Hz    | none    | 64              | 126721       | 28800      | 28609       |
| m070307 | 60Hz    | none    | 64              | 126721       | 28800      | 28680       |

## Holdout Evaluation Manifests

| holdout                           | train packages            | test packages    | train motion rows | test motion rows |
| --------------------------------- | ------------------------- | ---------------- | ----------------- | ---------------- |
| machine:24cpu_2560x1440_1mon_60Hz | m070055, m070211, m070307 | m070248          | 549843            | 184130           |
| machine:32cpu_7680x1440_3mon_60Hz | m070055, m070211, m070248 | m070307          | 549772            | 184201           |
| machine:6cpu_3840x2160_1mon_30Hz  | m070248, m070307          | m070055, m070211 | 368331            | 365642           |
| refresh:30Hz                      | m070248, m070307          | m070055, m070211 | 368331            | 365642           |
| refresh:60Hz                      | m070055, m070211          | m070248, m070307 | 365642            | 368331           |

Machine holdout is keyed by the observable runtime fingerprint: CPU count, virtual screen size, monitor count, and refresh bucket. Refresh holdout separates 30Hz from 60Hz packages.

## Totals

- Clean trace rows: 2177260
- Excluded trace rows: 12919
- Clean motion rows: 733973
- Excluded motion rows: 3311

## Next Experiment

Step 3 should re-run deterministic product baselines on this exact manifest, then check whether v9 timing targets reduce the one-sided lag bias before re-opening heavier model search.
