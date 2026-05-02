# Cursor Prediction v7 Experiment Log

Append-only log for v7 setup, measurement, scoring, and recommendations.

## 2026-05-02 - Scaffold

Worker: Codex

Scope:

- Created the initial v7 POC scaffold under `poc/cursor-prediction-v7`.
- Inspected existing prediction POCs, calibrator spec, and calibrator output writer.
- Confirmed calibrator automation flags from `CalibratorRunOptions`.
- Confirmed calibrator packages contain `frames.csv` and `metrics.json`.
- Confirmed `frames.csv` includes `patternName`, `phaseName`, expected position, expected velocity, dark bounds, and `estimatedSeparationPixels`.

Actions not taken:

- Did not launch `CursorMirror.Calibrator.exe`.
- Did not run GPU training.
- Did not modify production source.

Next measurement:

```powershell
.\artifacts\bin\Release\CursorMirror.Calibrator.exe --auto-run --duration-seconds 30 --output .\poc\cursor-prediction-v7\runs\raw\current-default\calibration-current-default-001.zip --exit-after-run
```

Open notes:

- Current calibrator constructs `CursorMirrorSettings.Default()` in-process, so candidate measurements beyond the current default require a later controlled candidate-build mechanism.
- v7 scoring is designed to compare candidate packages once those builds exist.

## 2026-05-02 - Phase 1 Run 001 Scoring

Worker: Codex

Input package:

```text
poc/cursor-prediction-v7/runs/raw/current-default/calibration-current-default-001.zip
```

Scoring command:

```powershell
node .\poc\cursor-prediction-v7\scripts\score-calibration.js --baseline current-default --run current-default=.\poc\cursor-prediction-v7\runs\raw\current-default\calibration-current-default-001.zip --out .\poc\cursor-prediction-v7\runs\summaries\baseline-score.json
```

Result:

- Valid run 001 baseline package.
- Quality warnings: none.
- Frames: 938 total, 938 dark.
- Capture source: Windows Graphics Capture.
- Overall separation: mean `4.771 px`, p95 `12 px`, p99 `12 px`, max `44 px`.
- Weighted per-pattern visual score: `14.816 px`.
- Highest-risk pattern in this run: `linear-fast`, with p95 `32 px`, p99 `44 px`, max `44 px`.

Next action:

- Capture `current-default` run 002 with the same command shape before measuring candidates.

## 2026-05-02 - Phase 1 Runs 001+002 Baseline Scoring

Worker: Codex

Input packages:

```text
poc/cursor-prediction-v7/runs/raw/current-default/calibration-current-default-001.zip
poc/cursor-prediction-v7/runs/raw/current-default/calibration-current-default-002.zip
```

Scoring command:

```powershell
node .\poc\cursor-prediction-v7\scripts\score-calibration.js --baseline current-default --run current-default=.\poc\cursor-prediction-v7\runs\raw\current-default\calibration-current-default-001.zip --run current-default=.\poc\cursor-prediction-v7\runs\raw\current-default\calibration-current-default-002.zip --out .\poc\cursor-prediction-v7\runs\summaries\baseline-score.json
```

Result:

- Valid combined baseline summary.
- Quality warnings: none across both runs.
- Combined frames: 1,873 total, 1,873 dark.
- Combined weighted per-pattern visual score: `14.012 px`.
- Combined per-pattern `linear-fast`: mean `3.468 px`, p95 `14 px`, p99 `44 px`, max `47 px`.
- Run 001 `linear-fast`: p95 `32 px`, p99 `44 px`, max `44 px`.
- Run 002 `linear-fast`: p95 `12 px`, p99 `47 px`, max `47 px`.

Interpretation:

- The `linear-fast` tail is stable as a repeated high-end spike, with max `44-47 px` in both runs.
- The `linear-fast` p95 is not stable yet, moving from `32 px` to `12 px`; one more baseline run is useful before candidate knobs.

## 2026-05-02 - Phase 1 Runs 001+002+003 Baseline Scoring

Worker: Codex

Input packages:

```text
poc/cursor-prediction-v7/runs/raw/current-default/calibration-current-default-001.zip
poc/cursor-prediction-v7/runs/raw/current-default/calibration-current-default-002.zip
poc/cursor-prediction-v7/runs/raw/current-default/calibration-current-default-003.zip
```

Result:

- Valid combined baseline summary; quality warnings: none.
- Combined frames: 2,795 total, 2,795 dark.
- Combined overall separation: mean `4.962 px`, p95 `12 px`, p99 `12 px`, max `539 px`.
- Combined weighted per-pattern visual score: `19.769 px`.
- Combined `linear-fast`: mean `3.368 px`, p95 `12 px`, p99 `44 px`, max `47 px`.
- Run 003 added one large first-frame post-warmup `linear-slow` outlier: `539 px` at elapsed `343.673 ms`.

Interpretation:

- `linear-fast` remains the stable model-facing pattern failure: sparse p99/max tail at `35-47 px` across runs.
- The `linear-slow` `539 px` max appears as a single startup/capture transient in run 003 and should be tracked separately from candidate model behavior.
- First candidate knob to measure next: `gain-grid-075`, meaning prediction enabled with `PredictionGainPercent = 75` and all other predictor behavior unchanged.

## 2026-05-02 - Candidate gain-grid-075 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- `gain-grid-075` weighted score: `13.563 px`.
- Delta: `-6.206 px` lower is better.
- `linear-fast`: p99 `44 -> 39 px`, max `47 -> 39 px`, score `28.450 -> 25.500 px`.
- `short-jitter`: p95 `11 -> 12 px`, score `11.500 -> 12.000 px`.

Interpretation:

- Repeat `gain-grid-075` once before dropping or promoting it.
- The weighted-score win is partly inflated by the baseline run-003 `linear-slow` transient, but `linear-fast` improved in the intended direction.
- The repeat should decide whether the `short-jitter` p95 regression is noise or a real gate failure.

## 2026-05-02 - Candidate gain-grid-075 Runs 001+002

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid two-run candidate summary; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- `gain-grid-075` weighted score: `13.084 px`.
- Delta: `-6.685 px` lower is better.
- Candidate run weighted scores: `13.563 px`, `12.753 px`.
- `linear-fast`: p99 `44 -> 27 px`, max `47 -> 39 px`, score `28.450 -> 21.300 px`.
- `short-jitter`: p95 `11 -> 12 px`, score `11.500 -> 12.000 px`.

Interpretation:

- Do not spend run 003 on `gain-grid-075` yet.
- Measure a gentler gain reduction next, preferably `gain-grid-090`, to see whether it keeps the `linear-fast` tail win without the `short-jitter` p95 regression.

## 2026-05-02 - Candidate gain-grid-090 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- `gain-grid-075` weighted score: `13.084 px` across 2 runs.
- `gain-grid-090` weighted score: `12.788 px` across 1 run.
- `gain-grid-090` vs baseline delta: `-6.981 px`.
- `linear-fast`: baseline p99/max `44/47`, `gain-grid-075` `27/39`, `gain-grid-090` `22/22`.
- `short-jitter`: baseline p95 `11`, both `gain-grid-075` and `gain-grid-090` p95 `12`.

Interpretation:

- `gain-grid-090` is the better gain candidate so far, but needs a repeat before moving to horizon changes.
- Next: measure `gain-grid-090` run 002. If the `short-jitter` p95 regression repeats, test a horizon candidate rather than more gain-only points.

## 2026-05-02 - Candidate gain-grid-090 Runs 001+002

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid two-run candidate summary; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- `gain-grid-075` weighted score: `13.084 px` across 2 runs.
- `gain-grid-090` weighted score: `13.350 px` across 2 runs.
- `gain-grid-090` run weighted scores: `12.788 px`, `14.137 px`.
- `gain-grid-090` `linear-fast`: p99/max `29/36 px` combined, versus baseline `44/47 px` and `gain-grid-075` `27/39 px`.
- `gain-grid-090` `short-jitter`: p95 `12 px`, still `+1 px` versus baseline.

Interpretation:

- `gain-grid-090` is valid but not clearly more stable than `gain-grid-075`.
- Stop gain-only search for now; both gain candidates repeat the `short-jitter` p95 miss.
- Next candidate: a horizon-capped gain combo, preferably `gain-090-horizon-cap-8ms`.

## 2026-05-03 - Candidate gain-090-dwmcap-8 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- `gain-grid-075` weighted score: `13.084 px` across 2 runs.
- `gain-grid-090` weighted score: `13.350 px` across 2 runs.
- `gain-090-dwmcap-8` weighted score: `13.449 px` across 1 run.
- `gain-090-dwmcap-8` `linear-fast`: p95/p99/max `19/29/29 px`, versus baseline `12/44/47`, `gain-grid-075` `12/27/39`, and `gain-grid-090` `12/29/36`.
- `gain-090-dwmcap-8` `short-jitter`: p95 `12 px`, still `+1 px` versus baseline.

Interpretation:

- Do not repeat `gain-090-dwmcap-8` yet.
- The 8 ms cap improves `linear-fast` max versus gain-only, but worsens `linear-fast` p95 and does not fix `short-jitter`.
- Next experiment: measure `gain-100-dwmcap-8` to isolate whether the p95 jitter miss comes from gain reduction or from the DWM horizon cap.

## 2026-05-03 - Candidate gain-100-dwmcap-8 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- `gain-grid-075` weighted score: `13.084 px` across 2 runs.
- `gain-grid-090` weighted score: `13.350 px` across 2 runs.
- `gain-090-dwmcap-8` weighted score: `13.449 px` across 1 run.
- `gain-100-dwmcap-8` weighted score: `13.177 px` across 1 run.
- `gain-100-dwmcap-8` `linear-fast`: p95/p99/max `12/33/33 px`, versus baseline `12/44/47`.
- `gain-100-dwmcap-8` `short-jitter`: p95 `12 px`, still `+1 px` versus baseline.

Interpretation:

- The `short-jitter` p95 miss is not caused by gain reduction alone; it appears with full gain plus the 8 ms DWM cap too.
- The cap path is not the fix for jitter. It improves `linear-fast` max but does not beat the best gain-only candidate on weighted score or p99.
- Next experiment: measure `gain-grid-085` as an intermediate gain-only point, or repeat `gain-grid-075` if only existing knobs are available.

## 2026-05-03 - Candidate gain-grid-085 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- `gain-grid-075` weighted score: `13.084 px` across 2 runs.
- `gain-grid-085` weighted score: `13.206 px` across 1 run.
- `gain-grid-090` weighted score: `13.350 px` across 2 runs.
- `gain-grid-085` `linear-fast`: p95/p99/max `18/29/29 px`, versus 075 `12/27/39` and 090 `12/29/36`.
- `gain-grid-085` `short-jitter`: p95 `12 px`, still `+1 px` versus baseline.

Interpretation:

- `gain-grid-085` does not dominate the gain-only candidates: it improves max versus 075 but regresses `linear-fast` p95 and keeps the jitter p95 miss.
- Next experiment: repeat `gain-grid-075` run 003 to test the current best two-run score for robustness before trying lower gain values.

## 2026-05-03 - Candidate gain-grid-075 Runs 001+002+003

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid three-run candidate summary; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- `gain-grid-075` weighted score: `19.202 px` across 3 runs.
- Raw delta: `-0.567 px` lower is better.
- `gain-grid-075` `linear-fast`: p95/p99/max `12/32/39 px`, versus baseline `12/44/47 px`.
- `gain-grid-075` `short-jitter`: p95 `12 px`, still `+1 px` versus baseline.
- Run 003 added one large `linear-slow` outlier: frame `1`, elapsed `397.279 ms`, separation `539 px`.

Interpretation:

- `gain-grid-075` is not a product candidate for a near-zero target.
- It reduces the repeated `linear-fast` tail, but leaves visible p99/max separation and repeats the `short-jitter` p95 regression.
- Near-zero needs another model family: a motion-regime gate or adaptive predictor, not a global gain knob.

## 2026-05-03 - Candidate adaptive-fast-gain-075 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- `adaptive-fast-gain-075` weighted score: `18.411 px` across 1 run.
- Raw delta: `-1.358 px` lower is better.
- `adaptive-fast-gain-075` `linear-fast`: p95/p99/max `12/18/18 px`, versus baseline `12/44/47` and global `gain-grid-075` `12/32/39`.
- `adaptive-fast-gain-075` `short-jitter`: p95 `12 px`, still `+1 px` versus baseline.
- Run 001 has a large `linear-slow` outlier: max `539 px`, similar to prior startup/capture transients.

Interpretation:

- The adaptive gate is the strongest model-family signal so far for `linear-fast`.
- It is not product-ready because it still misses the `short-jitter` p95 gate and the raw score is dominated by a `linear-slow` transient.
- Next parameter tweak: make the fast gate stricter, e.g. `adaptive-fast-gain-075-v2` with a higher velocity threshold and/or explicit exclusion for `short-jitter`/small-oscillation regimes.

## 2026-05-03 - Candidate adaptive-fast-gain-075-v2 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px` across 1 run.
- Adaptive v2 weighted score: `13.683 px` across 1 run.
- Adaptive v1 `linear-fast`: p95/p99/max `12/18/18 px`.
- Adaptive v2 `linear-fast`: p95/p99/max `12/41/41 px`.
- Adaptive v1 `short-jitter`: p95 `12 px`.
- Adaptive v2 `short-jitter`: p95 `12 px`.
- Adaptive v2 avoids the v1 `linear-slow` `539 px` transient; v2 `linear-slow` max is `27 px`.

Interpretation:

- v2 is cleaner overall, but over-tightened the fast gate and lost the main `linear-fast` benefit.
- Do not repeat v2 as-is.
- Next: tune a midpoint gate, e.g. `adaptive-fast-gain-075-v3`, between v1 and v2 thresholds while preserving the explicit jitter/small-oscillation exclusion.

## 2026-05-03 - Candidate adaptive-fast-gain-075-v3 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Adaptive v2 weighted score: `13.683 px`.
- Adaptive v3 weighted score: `13.745 px`.
- Adaptive v1 `linear-fast`: p95/p99/max `12/18/18 px`.
- Adaptive v2 `linear-fast`: p95/p99/max `12/41/41 px`.
- Adaptive v3 `linear-fast`: p95/p99/max `25/32/32 px`.
- Adaptive v3 `short-jitter`: p95 `12 px`, still `+1 px` versus baseline.
- Adaptive v3 `linear-slow`: max `19 px`, so the slow-motion transient is controlled.

Interpretation:

- Do not repeat v3 as-is.
- v3 controls slow motion, but it worsens `linear-fast` p95 and does not fix `short-jitter`.
- Stop this v2/v3 threshold branch; if continuing adaptive work, return to v1's fast capture and add a direct pattern/regime exclusion for jitter rather than raising the fast threshold.

## 2026-05-03 - Candidate adaptive-fast-gain-075-v4 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Adaptive v2 weighted score: `13.683 px`.
- Adaptive v3 weighted score: `13.745 px`.
- Adaptive v4 weighted score: `20.392 px`.
- Adaptive v4 `linear-fast`: p95/p99/max `12/53/53 px`, worse than baseline `12/44/47 px`.
- Adaptive v4 `short-jitter`: p95 `12 px`, still `+1 px` versus baseline.
- Adaptive v4 `linear-slow`: max `539 px`, so the slow-motion transient is back.

Interpretation:

- Do not repeat v4.
- Best adaptive parameter so far remains v1 for the core `linear-fast` target, but v1 is not product-ready because it misses jitter p95 and has slow transient risk.
- Code-level jitter/regime exclusion is warranted if the adaptive family continues.

## 2026-05-03 - Candidate adaptive-fast-gain-075-v5 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- Adaptive v1/v2/v3/v4/v5 weighted scores: `18.411`, `13.683`, `13.745`, `20.392`, `19.262 px`.
- Adaptive v5 `linear-fast`: p95/p99/max `12/35/35 px`.
- Adaptive v5 `short-jitter`: p95/p99/max `12/12/12 px`.
- Adaptive v5 `linear-slow`: p95/p99/max `12/13/539 px`.

Interpretation:

- Do not repeat v5.
- Best adaptive fast-motion parameter remains v1: `linear-fast` `12/18/18`.
- Best slow-motion-clean adaptive settings remain v2/v3, but they lose fast-motion benefit.
- Code-level jitter/regime exclusion is warranted; threshold-only variants v2-v5 have not produced the needed combination.

## 2026-05-03 - Candidate adaptive-fast-gain-075-v6-oscillation-latch Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- Adaptive v1-v6 weighted scores: `18.411`, `13.683`, `13.745`, `20.392`, `19.262`, `15.825 px`.
- Adaptive v6 `linear-fast`: p95/p99/max `36/59/59 px`, worse than baseline `12/44/47 px`.
- Adaptive v6 `short-jitter`: p95/p99/max `12/12/12 px`, still `+1 px` versus baseline p95.
- Adaptive v6 `linear-slow`: p95/p99/max `12/12/12 px`, best slow-motion cleanup so far.

Interpretation:

- The oscillation latch helped slow/startup behavior, but it did not fix jitter and it badly hurt `linear-fast`.
- Do not repeat v6 as-is.
- Next experiment: split the latch from fast eligibility. Use v1 fast eligibility for `linear-fast`, keep the v6 slow/startup guard, and add a pattern/regime-specific small-span oscillation bypass that cannot latch during sustained high-span constant-speed motion.

## 2026-05-03 - Candidate adaptive-fast-gain-075-v7-span-gated-latch Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Adaptive v6 weighted score: `15.825 px`.
- Adaptive v7 weighted score: `13.681 px`.
- Adaptive v7 `linear-fast`: p95/p99/max `21/32/32 px`, better than v6 `36/59/59 px` but still worse than v1 `12/18/18 px`.
- Adaptive v7 `short-jitter`: p95/p99/max `12/12/12 px`, unchanged from v1/v6 and still `+1 px` versus baseline p95.
- Adaptive v7 `linear-slow`: p95/p99/max `12/12/12 px`, preserving the v6 slow-motion cleanup.

Interpretation:

- v7 is the best adaptive-family weighted score so far, but it only partially recovered `linear-fast`.
- The span gate helped prevent the v6 fast-motion collapse, but the latch/guard still appears too eager during early straight-line fast motion.
- Next experiment: `adaptive-fast-gain-075-v8-fast-priority-span-gated-latch`. Add a fast-linear override before the oscillation latch: `expectedVelocityPixelsPerSecond >= 2400`, `0` reversals in `180 ms`, path efficiency `>= 0.85` over `160 ms`, and either span `>= 650 px` or net displacement `>= 500 px`, active after `80 ms` stable direction. Keep slow/startup guard; tighten oscillation bypass to span `<= 380 px`, net displacement `<= 260 px`, `>= 2` reversals in `300 ms`, path efficiency `<= 0.55`, and `360 ms` bypass latch.

## 2026-05-03 - Candidate adaptive-fast-gain-075-v8-fast-priority-span-gated-latch Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Adaptive v7 weighted score: `13.681 px`.
- Adaptive v8 weighted score: `14.281 px`.
- Adaptive v8 `linear-fast`: p95/p99/max `28/40/40 px`, worse than v7 `21/32/32 px` and not recovered to v1 `12/18/18 px`.
- Adaptive v8 `short-jitter`: p95/p99/max `10/12/12 px`, improved versus v1/v7 `12/12/12 px` and better than baseline p95 `11 px`.
- Adaptive v8 `linear-slow`: p95/p99/max `12/12/12 px`, preserving the v7 slow-motion cleanup.

Interpretation:

- Fast-priority did not recover `linear-fast`; the override is likely still too late or too narrow.
- The tighter jitter bypass did help `short-jitter`, so the branch has one more useful test.
- Next experiment: `adaptive-fast-gain-075-v9-fast-first-jitter-only-bypass`. Keep v8 jitter bypass, but let fast-linear override win before slow/startup guard and before any oscillation latch: velocity `>= 2400`, `0` reversals in `140 ms`, stable dominant-axis direction `64 ms`, path efficiency `>= 0.75` over `120 ms`, and net displacement `>= 360 px` or span `>= 420 px`. If v9 does not recover `linear-fast` toward v1, stop this latch branch.

## 2026-05-03 - Candidate adaptive-fast-gain-075-v9-fast-first-jitter-only-bypass Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Adaptive v8 weighted score: `14.281 px`.
- Adaptive v9 weighted score: `13.548 px`.
- Adaptive v9 `linear-fast`: p95/p99/max `12/41/41 px`, p95 recovered to v1/baseline but tail not recovered to v1 `12/18/18 px`.
- Adaptive v9 `short-jitter`: p95/p99/max `11/12/12 px`, matching baseline p95 and better than v1 p95 `12 px`.
- Adaptive v9 `linear-slow`: p95/p99/max `12/12/13 px`, preserving almost all of the v8 slow-motion cleanup.
- Frame inspection found only one `linear-fast` frame above `18 px`, so the tail is isolated in run 001.

Interpretation:

- v9 is the best adaptive-family weighted score so far and combines recovered `linear-fast` p95 with baseline-level `short-jitter`.
- The remaining risk is `linear-fast` p99/max stability, not the main distribution.
- Stop adding new latch variants for now; repeat v9 as run 002. If run 002 repeats `linear-fast` p99/max above `30 px`, stop this adaptive latch branch and move to another model family.

## 2026-05-03 - Candidate adaptive-fast-gain-075-v9-fast-first-jitter-only-bypass Run 002

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- V9 aggregate over runs 001-002: weighted score `19.881 px`.
- Baseline aggregate: weighted score `19.769 px`.
- V9 aggregate `linear-fast`: p95/p99/max `17/41/41 px`.
- V9 aggregate `short-jitter`: p95/p99/max `12/12/12 px`.
- V9 aggregate `linear-slow`: p95/p99/max `12/12/539 px`.
- V9 run 001 `linear-fast`: p95/p99/max `12/41/41 px`; 1 of 40 frames above `18 px`, 1 above `30 px`.
- V9 run 002 `linear-fast`: p95/p99/max `21/33/33 px`; 3 of 55 frames above `18 px`, 1 above `30 px`.
- V9 run 002 reintroduced the `linear-slow` `539 px` startup outlier.

Interpretation:

- The `linear-fast` tail is reproducible and wider in run 002.
- The `short-jitter` gain from v8 did not persist in v9 aggregate.
- The `linear-slow` cleanup did not persist in run 002.
- Stop this adaptive latch / fast-first bypass branch. Do not create a v10 threshold variant; move to a different model family.

## 2026-05-03 - Candidate lsq-velocity-72ms-horizon-cap8-confidence-fallback Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- LSQ weighted score: `12.692 px`, best single-run score so far.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Adaptive v8 weighted score: `14.281 px`.
- Adaptive v9 aggregate weighted score: `19.881 px`.
- LSQ `linear-fast`: p95/p99/max `12/25/25 px`; 2 of 62 frames above `18 px`, none above `30 px`.
- LSQ `short-jitter`: p95/p99/max `12/12/12 px`; no frames above `18 px`.
- LSQ `linear-slow`: p95/p99/max `12/12/12 px`; no frames above `18 px`.

Interpretation:

- LSQ substantially reduces the `linear-fast` tail versus baseline, v8, and v9 aggregate while keeping the tail below `30 px`.
- LSQ fixes `linear-slow` in run 001.
- LSQ does not recover baseline `short-jitter` p95 `11 px`, but it keeps jitter bounded at `12 px`.
- Continue this model family, but repeat run 002 before tuning because v9 also looked promising on run 001 and failed on run 002. If run 002 is stable, tune jitter fallback span next.

## 2026-05-03 - Candidate lsq-velocity-72ms-horizon-cap8-confidence-fallback Run 002

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- LSQ aggregate over runs 001-002: weighted score `18.783 px`.
- Baseline aggregate: weighted score `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Adaptive v8 weighted score: `14.281 px`.
- Adaptive v9 aggregate weighted score: `19.881 px`.
- LSQ aggregate `linear-fast`: p95/p99/max `12/25/30 px`.
- LSQ aggregate `short-jitter`: p95/p99/max `12/12/12 px`.
- LSQ aggregate `linear-slow`: p95/p99/max `12/12/539 px`.
- LSQ run 001 `linear-fast`: p95/p99/max `12/25/25 px`; 2 of 62 frames above `18 px`, none above `30 px`.
- LSQ run 002 `linear-fast`: p95/p99/max `12/30/30 px`; 1 of 63 frames above `18 px`, none above `30 px`.
- LSQ run 002 reintroduced one `linear-slow` startup outlier at `539 px`.

Interpretation:

- `linear-fast` max stayed within the `<= 30 px` target over runs 001-002, so LSQ remains promising for the fast-tail problem.
- `short-jitter` stayed bounded but did not improve to baseline p95 `11 px`.
- `linear-slow` did not stay clean because run 002 reintroduced the startup outlier.
- Continue LSQ, but do not tune jitter yet. Next candidate should add a runtime cold-start/stale-history reset and slow-start horizon cap: `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback`.

## 2026-05-03 - Candidate lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Coldstart-reset LSQ weighted score: `12.266 px`, best single-run score so far.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Previous LSQ aggregate weighted score: `18.783 px`.
- Coldstart-reset LSQ `linear-fast`: p95/p99/max `12/17/17 px`; 2 of 59 frames above `12 px`, none above `18 px`.
- Coldstart-reset LSQ `short-jitter`: p95/p99/max `12/12/12 px`; no frames above `12 px`.
- Coldstart-reset LSQ `linear-slow`: p95/p99/max `12/12/12 px`; no frames above `12 px`.

Interpretation:

- The coldstart reset removed the previous LSQ `linear-slow` startup outlier in run 001.
- `linear-fast` is now cleaner than adaptive v1's tail and previous LSQ aggregate.
- `short-jitter` is bounded but still not at baseline p95 `11 px`.
- Repeat this same candidate as run 002 before tuning jitter. If stable, next tuning candidate should be `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback-jitter-span320`.

## 2026-05-03 - Candidate lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback Run 002

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Coldstart-reset LSQ aggregate over runs 001-002: weighted score `12.229 px`, best current POC v7 candidate.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Previous LSQ aggregate weighted score: `18.783 px`.
- Coldstart-reset LSQ aggregate `linear-fast`: p95/p99/max `12/16/17 px`.
- Coldstart-reset LSQ aggregate `short-jitter`: p95/p99/max `12/12/12 px`.
- Coldstart-reset LSQ aggregate `linear-slow`: p95/p99/max `12/12/12 px`.
- Runs 001-002 had no `linear-fast` frames above `18 px`, no `linear-slow` frames above `18 px`, and no `short-jitter` frames above `12 px`.

Interpretation:

- Coldstart-reset LSQ is stable over two runs and should be promoted as the best current model family candidate.
- `linear-fast` is now cleaner than adaptive v1's tail.
- `linear-slow` startup outlier stayed fixed.
- `short-jitter` remains bounded but still misses baseline p95 `11 px`.
- Next exact candidate: `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback-jitter-span320`, changing only the jitter fallback dominant-axis span threshold from `380 px` to `320 px`.

## 2026-05-03 - Candidate lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback-jitter-span320 Run 001

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Span320 LSQ weighted score: `18.224 px`.
- Coldstart-reset span380 LSQ aggregate weighted score: `12.229 px`.
- Span320 LSQ `linear-fast`: p95/p99/max `12/16/16 px`; 1 of 61 frames above `12 px`, none above `18 px`.
- Span320 LSQ `short-jitter`: p95/p99/max `12/12/12 px`; no frames above `12 px`.
- Span320 LSQ `linear-slow`: p95/p99/max `12/12/539 px`; one startup outlier at `539 px`.

Interpretation:

- Span320 did not improve `short-jitter` p95 versus span380.
- `linear-fast` remained clean, but `linear-slow` startup stability regressed.
- Drop span320 and revert to the span380 coldstart-reset LSQ. Do not try another jitter span value yet; next exact candidate should be `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` run 003 as a final stability confirmation.

## 2026-05-03 - Candidate lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback Run 003

Worker: Codex

Score output:

```text
poc/cursor-prediction-v7/runs/summaries/candidate-score.json
```

Result:

- Valid candidate run; quality warnings: none.
- Coldstart-reset LSQ aggregate over runs 001-003: weighted score `12.378 px`, best current POC v7 candidate.
- Baseline weighted score: `19.769 px`.
- Adaptive v1 weighted score: `18.411 px`.
- Previous LSQ aggregate weighted score: `18.783 px`.
- Span320 LSQ weighted score: `18.224 px`.
- Coldstart-reset LSQ aggregate `linear-fast`: p95/p99/max `12/17/24 px`.
- Coldstart-reset LSQ aggregate `short-jitter`: p95/p99/max `12/12/12 px`.
- Coldstart-reset LSQ aggregate `linear-slow`: p95/p99/max `12/12/12 px`.
- Runs 001-003 had one `linear-fast` frame above `18 px` total, no `linear-fast` frames above `30 px`, no `linear-slow` frames above `18 px`, and no `short-jitter` frames above `12 px`.

Interpretation:

- Coldstart-reset LSQ span380 remains the best current model after three runs.
- `linear-slow` startup outlier stayed fixed.
- `linear-fast` tail is bounded well below baseline and previous LSQ.
- `short-jitter` remains bounded but not improved to baseline p95 `11 px`.
- Stop further POC v7 model-family search for now and promote `lsq-velocity-72ms-horizon-cap8-coldstart-reset-fallback` as the current best candidate. Continue with a new family only if recovering the last `1 px` of `short-jitter` p95 is worth risking the clean fast/slow behavior.
