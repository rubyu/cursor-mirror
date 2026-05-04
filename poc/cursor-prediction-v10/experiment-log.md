# Cursor Prediction v10 Experiment Log

## 2026-05-03 - Initial POC Setup

Started v10 as a compact synthetic MotionLab-style data experiment.

Initial decisions:

- Scope is limited to `poc/cursor-prediction-v10/`.
- CPU-only execution.
- Node.js standard library only.
- Store scripts and seeds as the canonical dataset.
- Do not write per-frame CSV, raw ZIP, dependency, cache, or checkpoint output.

Planned commands:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-pilot.js --count 500 --seed 10010
node poc\cursor-prediction-v10\scripts\run-v10-pilot.js --count 2000 --seed 10010
```

## 2026-05-03 17:04 JST - Pilot Run

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Commands:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-pilot.js --count 500 --seed 10010
node poc\cursor-prediction-v10\scripts\run-v10-pilot.js --count 2000 --seed 10010
```

500-script smoke result:

- generated 500 scripts;
- evaluated 192,000 rows;
- best candidate: `least_squares_w50_cap24`;
- best mean/p95/p99: 1.247 / 4.654 / 7.939 px;
- baseline mean/p95/p99: 3.205 / 16.707 / 26.534 px.

2,000-script pilot result:

- generated 2,000 scripts;
- evaluated 768,000 rows;
- best candidate: `least_squares_w50_cap24`;
- best mean/p95/p99: 1.209 / 4.599 / 7.731 px;
- current-baseline-equivalent mean/p95/p99: 3.099 / 16.382 / 26.273 px.

Judgment:

- The compact script-first data path is working.
- No large CSV or raw ZIP output was created.
- The next data increase should emphasize near-stop, acute-acceleration,
  missing-history, edge-proximity, and jitter distributions because those are
  the regimes most likely to expose unsafe p99/max behavior.

## 2026-05-03 17:12 JST - Phase 2 Distribution and Safe Gates

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase2.js --count 500 --seed 20020
```

Result:

- generated 500 scripts;
- evaluated 192000 rows;
- canonical script JSONL: `runs/scripts.synthetic.phase2.jsonl` (470.0 KB);
- `>=2000px/s` rows: 11820;
- best raw candidate: `least_squares_w50_cap36`, p95/p99/max 27.025 / 71.575 / 342.969 px, >5px regressions 15113;
- best safe gate: `safe_gate_blend_cv_ls_w50_cap24_ls0p5_g4`, p95/p99/max 38.425 / 80.375 / 345.843 px, >5px regressions 36.

Judgment:

- Phase 2 keeps the script JSONL as canonical data and avoids per-frame CSV or large intermediate artifacts.
- Safe gates reduce exposure in sparse, high-curvature, high-acceleration, and edge-proximate rows while preserving most of the raw model's improvement in coherent motion.
- Runtime: 3.42 seconds on CPU.

## 2026-05-03 17:12 JST - Phase 2 Distribution and Safe Gates

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase2.js --count 10000 --seed 20020
```

Result:

- generated 10000 scripts;
- evaluated 3840000 rows;
- canonical script JSONL: `runs/scripts.synthetic.phase2.jsonl` (9.22 MB);
- `>=2000px/s` rows: 230880;
- best raw candidate: `least_squares_w50_cap36`, p95/p99/max 25.925 / 67.125 / 682.352 px, >5px regressions 289965;
- best safe gate: `safe_gate_blend_cv_ls_w50_cap24_ls0p5_g3`, p95/p99/max 38.175 / 75.475 / 694.357 px, >5px regressions 914.

Judgment:

- Phase 2 keeps the script JSONL as canonical data and avoids per-frame CSV or large intermediate artifacts.
- Safe gates reduce exposure in sparse, high-curvature, high-acceleration, and edge-proximate rows while preserving most of the raw model's improvement in coherent motion.
- Runtime: 69.84 seconds on CPU.

## 2026-05-03 17:29 JST - Phase 3 Learned Gates

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase3.js --limit-scripts 1000
```

Result:

- read 1000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script: train 700, validation 150, test 150;
- evaluated 384000 rows without writing per-frame CSV or feature files;
- selected `score_least_squares_w50_cap36_9` (monotonic_score) with `least_squares_w50_cap36`;
- test p95/p99/max 35.925 / 60.275 / 300.188 px;
- test regressions >5px 0, >10px 0;
- phase2 fixed safe gate on test: p95/p99/max 35.925 / 60.275 / 300.188 px, >5px 21, >10px 0;
- runtime: 30.21 seconds on CPU.

Judgment:

- The learned gate search kept `no_adoption_baseline_only` in the candidate set, so any selected learned gate must beat baseline-only under validation constraints.
- If test >10px regressions remain non-zero or >5px regressions stay materially above 100, the next phase should prioritize data/evaluation design before adding a heavier teacher.

## 2026-05-03 17:30 JST - Phase 3 Learned Gates

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase3.js
```

Result:

- read 10000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script: train 7000, validation 1500, test 1500;
- evaluated 3840000 rows without writing per-frame CSV or feature files;
- selected `no_adoption_baseline_only` (none) with `constant_velocity_last2_cap24`;
- test p95/p99/max 38.075 / 74.675 / 472.186 px;
- test regressions >5px 0, >10px 0;
- phase2 fixed safe gate on test: p95/p99/max 38.075 / 74.725 / 472.186 px, >5px 153, >10px 6;
- runtime: 269.30 seconds on CPU.

Judgment:

- The learned gate search kept `no_adoption_baseline_only` in the candidate set, so any selected learned gate must beat baseline-only under validation constraints.
- If test >10px regressions remain non-zero or >5px regressions stay materially above 100, the next phase should prioritize data/evaluation design before adding a heavier teacher.

## 2026-05-03 17:36 JST - Phase 3 Learned Gates

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase3.js --limit-scripts 1000
```

Result:

- read 1000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script: train 700, validation 150, test 150;
- evaluated 384000 rows without writing per-frame CSV or feature files;
- selected `score_least_squares_w50_cap24_1` (monotonic_score) with `least_squares_w50_cap24`;
- test p95/p99/max 35.925 / 60.275 / 300.188 px;
- test regressions >5px 0, >10px 0;
- phase2 fixed safe gate on test: p95/p99/max 35.925 / 60.275 / 300.188 px, >5px 21, >10px 0;
- runtime: 40.24 seconds on CPU.

Judgment:

- The learned gate search kept `no_adoption_baseline_only` in the candidate set, so any selected learned gate must beat baseline-only under validation constraints.
- If test >10px regressions remain non-zero or >5px regressions stay materially above 100, the next phase should prioritize data/evaluation design before adding a heavier teacher.

## 2026-05-03 17:39 JST - Phase 3 Learned Gates

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase3.js --limit-scripts 5000
```

Result:

- read 5000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script: train 3500, validation 750, test 750;
- evaluated 1920000 rows without writing per-frame CSV or feature files;
- selected `score_least_squares_w50_cap36_5` (monotonic_score) with `least_squares_w50_cap36`;
- test p95/p99/max 37.175 / 74.325 / 399.790 px;
- test regressions >5px 0, >10px 0;
- phase2 fixed safe gate on test: p95/p99/max 37.225 / 74.375 / 399.790 px, >5px 70, >10px 1;
- runtime: 116.42 seconds on CPU.

Judgment:

- The learned gate search kept `no_adoption_baseline_only` in the candidate set, so any selected learned gate must beat baseline-only under validation constraints.
- If test >10px regressions remain non-zero or >5px regressions stay materially above 100, the next phase should prioritize data/evaluation design before adding a heavier teacher.

## 2026-05-03 17:41 JST - Phase 3 Learned Gates

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase3.js --limit-scripts 5000
```

Result:

- read 5000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script: train 3500, validation 750, test 750;
- evaluated 1920000 rows without writing per-frame CSV or feature files;
- selected `score_least_squares_w50_cap36_5` (monotonic_score) with `least_squares_w50_cap36`;
- test p95/p99/max 37.175 / 74.325 / 399.790 px;
- test regressions >5px 0, >10px 0;
- phase2 fixed safe gate on test: p95/p99/max 37.225 / 74.375 / 399.790 px, >5px 70, >10px 1;
- runtime: 117.29 seconds on CPU.

Judgment:

- The learned gate search kept `no_adoption_baseline_only` in the candidate set, so any selected learned gate must beat baseline-only under validation constraints.
- If test >10px regressions remain non-zero or >5px regressions stay materially above 100, the next phase should prioritize data/evaluation design before adding a heavier teacher.

## 2026-05-03 17:50 JST - Phase 4 Pareto Frontier

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase4.js --limit-scripts 1000
```

Result:

- read 1000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script: train 700, validation 150, test 150;
- evaluated 384000 rows without writing per-frame CSV or feature files;
- strict: `phase4_0018_blend_base_blend_cv_ls_w50_cap24_ls0p5_adv0p25_nearby_random_13_t12p984497`, candidate `blend_base_blend_cv_ls_w50_cap24_ls0p5_adv0p25`, mean/p95/p99 9.274 / 34.625 / 60.175 px, >5/>10 0/0, advanced 53606;
- balanced: `phase4_0018_blend_base_blend_cv_ls_w50_cap24_ls0p5_adv0p25_nearby_random_13_t12p984497`, candidate `blend_base_blend_cv_ls_w50_cap24_ls0p5_adv0p25`, mean/p95/p99 9.274 / 34.625 / 60.175 px, >5/>10 0/0, advanced 53606;
- aggressive: `phase4_0018_blend_base_blend_cv_ls_w50_cap24_ls0p5_adv0p25_nearby_random_13_t12p984497`, candidate `blend_base_blend_cv_ls_w50_cap24_ls0p5_adv0p25`, mean/p95/p99 9.274 / 34.625 / 60.175 px, >5/>10 0/0, advanced 53606;
- noGo: `phase4_0041_least_squares_w50_cap36_nearby_random_1_t8p324457`, candidate `least_squares_w50_cap36`, mean/p95/p99 8.327 / 33.375 / 57.525 px, >5/>10 4876/2506, advanced 52508;
- runtime: 272.29 seconds on CPU.

Judgment:

- Strict remains the safest product-shaped result.
- Balanced/aggressive are useful as risk envelope references, but require an explicit product risk gate before adoption.

## 2026-05-03 17:57 JST - Phase 4 Pareto Frontier

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase4.js --limit-scripts 3000
```

Result:

- read 3000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script: train 2100, validation 450, test 450;
- evaluated 1152000 rows without writing per-frame CSV or feature files;
- strict: `phase4_0020_least_squares_w50_cap36_phase3_best_t1p806727`, candidate `least_squares_w50_cap36`, mean/p95/p99 11.966 / 38.725 / 77.825 px, >5/>10 0/0, advanced 20034;
- balanced: `phase4_0070_blend_base_least_squares_w50_cap36_adv0p75_phase3_best_t3p538744`, candidate `blend_base_least_squares_w50_cap36_adv0p75`, mean/p95/p99 11.941 / 38.575 / 77.575 px, >5/>10 30/0, advanced 61763;
- aggressive: `phase4_0061_blend_base_least_squares_w50_cap36_adv0p75_phase3_best_t4p720413`, candidate `blend_base_least_squares_w50_cap36_adv0p75`, mean/p95/p99 11.934 / 38.475 / 77.475 px, >5/>10 182/5, advanced 76812;
- noGo: `phase4_0037_least_squares_w50_cap36_phase3_best_t16p771158`, candidate `least_squares_w50_cap36`, mean/p95/p99 9.078 / 33.175 / 71.775 px, >5/>10 13483/5940, advanced 163524;
- runtime: 61.09 seconds on CPU.

Judgment:

- Strict remains the safest product-shaped result.
- Balanced/aggressive are useful as risk envelope references, but require an explicit product risk gate before adoption.

## 2026-05-03 17:59 JST - Phase 4 Pareto Frontier

Environment:

- Node.js: `v24.14.0`
- GPU used: no
- Dependency install: none

Command:

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase4.js --limit-scripts 3000
```

Result:

- read 3000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script: train 2100, validation 450, test 450;
- evaluated 1152000 rows without writing per-frame CSV or feature files;
- same-split phase3 selected gate: mean/p95/p99 11.971 / 38.775 / 77.875 px, >5/>10 0/0, advanced 14421;
- strict: `phase4_0020_least_squares_w50_cap36_phase3_best_t1p806727`, candidate `least_squares_w50_cap36`, mean/p95/p99 11.966 / 38.725 / 77.825 px, >5/>10 0/0, advanced 20034;
- balanced: `phase4_0070_blend_base_least_squares_w50_cap36_adv0p75_phase3_best_t3p538744`, candidate `blend_base_least_squares_w50_cap36_adv0p75`, mean/p95/p99 11.941 / 38.575 / 77.575 px, >5/>10 30/0, advanced 61763;
- aggressive: `phase4_0061_blend_base_least_squares_w50_cap36_adv0p75_phase3_best_t4p720413`, candidate `blend_base_least_squares_w50_cap36_adv0p75`, mean/p95/p99 11.934 / 38.475 / 77.475 px, >5/>10 182/5, advanced 76812;
- noGo: `phase4_0037_least_squares_w50_cap36_phase3_best_t16p771158`, candidate `least_squares_w50_cap36`, mean/p95/p99 9.078 / 33.175 / 71.775 px, >5/>10 13483/5940, advanced 163524;
- runtime: 64.47 seconds on CPU.

Judgment:

- Strict remains the safest product-shaped result.
- Balanced/aggressive are useful as risk envelope references, but require an explicit product risk gate before adoption.


## Phase 5 ML teacher probe (2026-05-03T09:09:03.375Z)

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase5.js --limit-scripts 100 --train-sample-rows 5000 --validation-sample-rows 5000
```

- read 100 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script seed 33003: train 70, validation 15, test 15;
- rows train/validation/test 26880/5760/5760;
- environment: Node v24.14.0; Python/torch unavailable; GPU not used; no checkpoints or feature caches written;
- best raw: `mlp_medium_ridge`, mean/p95/p99 9.738 / 36.925 / 63.575 px, >5/>10 11/0;
- strict: `mlp_small_ridge`, mean/p95/p99 10.411 / 39.225 / 66.625 px, >5/>10 0/0, advanced 1173;
- balanced: `mlp_small_ridge`, mean/p95/p99 10.411 / 39.225 / 66.625 px, >5/>10 0/0, advanced 1173;
- aggressive: `mlp_small_ridge`, mean/p95/p99 10.411 / 39.225 / 66.625 px, >5/>10 0/0, advanced 1173;
- judgment: Phase5 improves selected gated mean versus Phase4 but worsens tail percentiles, so it is not a clean replacement. FSMN-lite/CSFSMN-lite are the most product-shaped ML teachers if a CPU-only residual path is revisited.
- runtime: 1.34 seconds on CPU.


## Phase 5 ML teacher probe (2026-05-03T09:09:12.049Z)

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase5.js --limit-scripts 3000 --train-sample-rows 80000 --validation-sample-rows 120000
```

- read 3000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script seed 33003: train 2100, validation 450, test 450;
- rows train/validation/test 806400/172800/172800;
- environment: Node v24.14.0; Python/torch unavailable; GPU not used; no checkpoints or feature caches written;
- best raw: `csfsmn_lite_ridge`, mean/p95/p99 10.971 / 35.075 / 72.475 px, >5/>10 1002/197;
- strict: `linear_ridge_residual`, mean/p95/p99 11.877 / 38.775 / 77.975 px, >5/>10 0/0, advanced 43488;
- balanced: `linear_ridge_residual`, mean/p95/p99 11.877 / 38.775 / 77.975 px, >5/>10 0/0, advanced 43488;
- aggressive: `linear_ridge_residual`, mean/p95/p99 11.877 / 38.775 / 77.975 px, >5/>10 0/0, advanced 43488;
- judgment: LS/blend phase4 remains ahead under no-regression constraints. FSMN-lite/CSFSMN-lite are the most product-shaped ML teachers if a CPU-only residual path is revisited.
- runtime: 38.44 seconds on CPU.


## Phase 6 strict distillation (2026-05-03T09:18:27.472Z)

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase6.js --limit-scripts 3000
```

- read 3000 scripts from `runs/scripts.synthetic.phase2.jsonl`;
- split by script seed 33003: train 2100, validation 450, test 450;
- rows train/validation/test 806400/172800/172800; advanced train/validation/test 112049/23549/20034;
- phase4 strict: `phase4_0020_least_squares_w50_cap36_phase3_best_t1p806727`, mean/p95/p99/max 11.966 / 38.725 / 77.825 / 694.357 px, >5/>10 vs CV 0/0;
- strict: `bucket_disagreement_gain_offset_scale0p5_cap4`, mean/p95/p99 11.955 / 38.725 / 77.825 px, deltas -0.01 / 0 / 0, >5/>10 vs phase4 0/0, warnings none;
- balanced: `bucket_disagreement_gain_offset_scale1_cap4`, mean/p95/p99 11.954 / 38.725 / 77.825 px, deltas -0.012 / 0 / 0, >5/>10 vs phase4 0/0, warnings has_>5px_regressions_vs_cv_baseline;
- judgment: do_not_productize_synthetic_gain_too_small_or_tail_risky. The strict gate itself remains safe, but residual productization should wait for real trace validation unless the strict candidate shows meaningful tail-neutral gains.
- runtime: 20.04 seconds on CPU; no GPU, checkpoints, caches, raw zips, node_modules, or per-frame CSVs.


## Phase 7 real trace (2026-05-03T09:28:12.701Z)

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase7-real-trace.js --zip-limit 6
```

- input ZIPs: `cursor-mirror-trace-20260502-184947.zip`, `cursor-mirror-trace-20260502-175951.zip`, `cursor-mirror-trace-20260502-173150.zip`, `cursor-mirror-trace-20260502-165358.zip`, `cursor-mirror-trace-20260502-163258.zip`, `cursor-mirror-trace-20260502-161143.zip`;
- rows: 110945 from 2 nonempty / 6 selected sessions;
- baseline `constant_velocity_last2_cap24`: mean/p95/p99/max 17.136 / 84.025 / 240.025 / 962.266 px;
- raw `least_squares_w50_cap36`: mean delta -1.121 px, >5/>10 15575/10866;
- phase4 strict: mean delta 0.496 px, >5/>10 3428/2085, advanced 60372;
- phase4 balanced: mean delta 0.093 px, >5/>10 5492/3297, advanced 77135;
- synthetic direction: strict not same, balanced not same;
- recommendation: `fix_synthetic_distribution_before_calibrator`;
- phase6 omitted: phase6 artifacts report coefficient samples only; full trained residual heads/checkpoint are intentionally not written, so exact real-trace replay is not reproducible from existing outputs;
- runtime: 2.24 seconds on CPU; no GPU, ZIP extraction, per-frame CSV, raw copy, node_modules, cache, or checkpoint.


## Phase 8 real gate (2026-05-03T09:38:00.201Z)

```powershell
node poc\cursor-prediction-v10\scripts\run-v10-phase8-real-gate.js --zip-limit 6
```

- input ZIPs: `cursor-mirror-trace-20260502-184947.zip`, `cursor-mirror-trace-20260502-175951.zip`, `cursor-mirror-trace-20260502-173150.zip`, `cursor-mirror-trace-20260502-165358.zip`, `cursor-mirror-trace-20260502-163258.zip`, `cursor-mirror-trace-20260502-161143.zip`;
- rows: 110945 from 2 nonempty / 6 selected sessions;
- cross-session selected aggregate: mean/p95/p99 16.946 / 83.625 / 239.725 px, >5/>10 0/0, mean delta -0.190 px, advanced 30944;
- selected gates: cursor-mirror-trace-20260502-184947.zip_to_cursor-mirror-trace-20260502-175951.zip => real_tree_blend_cv_ls_w50_cap36_ls0p25_1; cursor-mirror-trace-20260502-175951.zip_to_cursor-mirror-trace-20260502-184947.zip => real_tree_blend_cv_ls_w50_cap36_ls0p25_1;
- synthetic gap primary finding: real p50 0.000 px/s and p90 707.107 px/s vs synthetic phase4-test p50 520.725 and p90 1604.640; real is dominated by near-stop rows with a small high-speed tail.;
- recommendation: `proceed_to_calibrator_with_real_gate_as_safety_anchor`;
- runtime: 57.05 seconds on CPU; no GPU, ZIP extraction, raw CSV copy, per-frame CSV, cache, checkpoint, or node_modules.
