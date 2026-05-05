# Cursor Prediction v10 Phase 8 Synthetic/Real Gap

Generated: 2026-05-03T09:38:00.201Z

## Distribution Snapshot

| feature | real phase7 | synthetic phase4 test recompute |
| --- | --- | --- |
| rows | 110945 | 172800 |
| speed p50/p95 | 0.000 / 4527.693 | 520.725 / 2129.086 |
| acceleration p50/p95 | 0.000 / 4562071.898 | 10260.780 / 255725.861 |
| curvature p50/p95 | 0.000 / 0.000 | 1.490 / 154.239 |
| history p50/p95 | 101.000 / 101.000 | 21.000 / 24.000 |
| LS-vs-CV disagreement p50/p95 | 1.453 / 36.000 | 4.008 / 28.635 |

## Findings

- **speed**: real p50 0.000 px/s and p90 707.107 px/s vs synthetic phase4-test p50 520.725 and p90 1604.640; real is dominated by near-stop rows with a small high-speed tail.
- **history/missingScenario**: real history is dense (p50 101.000, p95 101.000) and has no synthetic dropout scenarios; phase2 intentionally allocates rows equally across clean/10%/25% missing-history scenarios.
- **LS-vs-CV disagreement**: real p50/p95 disagreement 1.453 / 36.000 px vs synthetic phase4-test 4.008 / 28.635 px; real has a lower median but a clamp-heavy p95 tail, so disagreement alone did not separate safe LS adoption.
- **curvature/acceleration**: real curvature p95 0.000 deg and acceleration p95 4562071.898 px/s^2 differ from synthetic phase4-test p95 154.239 deg and 255725.861 px/s^2, making phase4's risk score thresholds poorly calibrated.
- **phase2 speed mix**: phase2 full artifact has 3.63% in 0-25 px/s vs real 87.93%; the generator overrepresents mid-speed scripted motion relative to the latest real traces.

## Why Phase4 Gates Failed on Real Trace

The phase4 strict/balanced thresholds were fitted against a synthetic mix with explicit missing-history scenarios, broad mid-speed coverage, and scripted high-curvature/high-acceleration segments. The two usable real traces are dense reference-poll sessions with no synthetic dropout label and a very different speed/disagreement mix. That means the synthetic risk score did not isolate real LS regressions: it advanced in regions where real raw LS still regressed, while falling back in many rows that synthetic considered risky for different reasons.
