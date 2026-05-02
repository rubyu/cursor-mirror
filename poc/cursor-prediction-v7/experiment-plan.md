# Cursor Prediction v7 Experiment Plan

## Objective

Find the best prediction model for Cursor Mirror by treating `CursorMirror.Calibrator` packages as the primary measurement source. Offline trace metrics can propose candidates, but v7 promotion depends on captured visual separation in calibrator output, broken down by motion pattern.

## Known Input Contract

The calibrator writes compressed zip packages containing `frames.csv` and `metrics.json`.

`frames.csv` provides per-frame:

- `patternName` and `phaseName`
- expected cursor position and expected velocity
- dark-pixel bounding box
- `estimatedSeparationPixels`

`metrics.json` provides:

- total and dark frame counts
- baseline dark bounds
- aggregate average, p95, and maximum separation
- capture source
- per-pattern summaries

## Candidate Search Ladder

1. Current default: production default in `CursorMirror.Calibrator`, using `CursorMirrorSettings.Default()`.
2. Production-knob variants: prediction gain and horizon candidates if exposed in a later controlled build.
3. Deterministic candidates from prior POCs: DWM-aware last-two-sample projections and guarded gain variants.
4. Distilled candidates: simple guarded residual models that can be represented cheaply in product code.
5. Teacher-only candidates: learned sequence models used to discover regimes, not to ship directly.
6. Regime gates: apply corrections only to motion regimes where calibrator visual separation improves without tail regressions.

No candidate is accepted from offline error metrics alone. Every candidate needs calibrator packages with enough per-pattern coverage.

## Phase Plan

### Phase 0: Scaffold and Contract Lock

Status: initial scaffold.

Deliverables:

- Document calibrator zip contract.
- Define v7 scoring objective.
- Create machine-readable initial plan.
- Create JSON schemas and scorer skeleton.

Exit criteria:

- `initial-plan.json` exists and is valid JSON.
- The scorer syntax checks without running a measurement.
- No production source changes.

### Phase 1: Current Default Baseline

Measure the existing Release calibrator with the current default predictor.

Planned runs:

- `current-default` run 001, 30 seconds
- `current-default` run 002, 30 seconds
- `current-default` run 003, 30 seconds

Metrics:

- Overall frame and dark-frame count.
- Per-pattern frame and dark-frame count.
- Per-pattern mean, p95, p99, and max separation.
- Quality warnings for missing patterns, low dark-frame coverage, or capture source mismatch.

Exit criteria:

- Every default motion pattern appears in every run.
- Each high-risk pattern has enough dark frames for p95/p99 to be meaningful.
- Repeated-run variance is documented.

### Phase 2: Baseline Scoring Report

Run `scripts/score-calibration.js` over Phase 1 packages.

Deliverables:

- `runs/summaries/baseline-score.json`
- report section summarizing stable and unstable patterns
- candidate acceptance thresholds adjusted only if the baseline shows unavoidable capture variance

Exit criteria:

- The scorer agrees with `metrics.json` frame counts and pattern summaries within expected rounding.
- The baseline result becomes the comparison anchor for later candidates.

### Phase 3: Candidate Definition

Define a small candidate set before any heavy search.

Candidate metadata to record:

- candidate id
- source commit or patch id
- predictor family
- runtime knobs
- expected risk pattern
- offline trace rationale
- exact build artifact path

Priority candidates:

- `current-default`
- `gain-grid-050`
- `gain-grid-075`
- `gain-grid-100`
- `safe-ridge-residual-guarded`
- `regime-gated-reversal`
- `teacher-regime-oracle`

Exit criteria:

- Each candidate has an explicit runtime implementation path or is marked `teacher-only`.
- No calibrator package is compared without a candidate id.

### Phase 4: Visual Measurement Loop

For each candidate, run the calibrator with the same duration, display, and environment.

Default command shape:

```powershell
.\artifacts\bin\Release\CursorMirror.Calibrator.exe --auto-run --duration-seconds 30 --output .\poc\cursor-prediction-v7\runs\raw\<candidate>\calibration-<candidate>-<index>.zip --exit-after-run
```

Rules:

- Use one active measurement worker.
- Do not run GPU training during calibrator capture.
- Keep the display, refresh rate, scaling, and cursor theme fixed.
- Record any user input cancellation or WGC failure in `experiment-log.md`.

Exit criteria:

- Each candidate has at least three comparable packages or is explicitly dropped.
- All raw packages remain unmodified.

### Phase 5: Model Search and Scoring

Use calibrator package scores as the objective.

Ranking:

1. Compare each candidate to `current-default` by pattern.
2. Reject candidates with visible tail regressions.
3. Prefer candidates that improve high-risk patterns without hurting holds and slow linear motion.
4. Use offline traces only to explain why a candidate behaves as observed.

Deliverables:

- `runs/summaries/candidate-score.json`
- pattern-delta tables
- rejected-candidate notes
- short list of product-worthy candidates

Exit criteria:

- Winner, no-change recommendation, or next-candidate recommendation is explicit.
- Any claimed improvement is backed by calibrator packages.

### Phase 6: Robustness Check

Repeat the winning candidate and baseline under at least one changed but controlled environment, if available.

Suggested axes:

- another refresh rate
- another display scale
- second package build after clean rebuild
- longer 60-second run

Exit criteria:

- Winner remains within gates across robustness runs, or the recommendation reverts to current default.

### Phase 7: Final Recommendation

Produce a final report with:

- measurement command history
- artifact list
- per-pattern tables
- accepted/rejected candidates
- implementation guidance
- open risks

Exit criteria:

- Recommendation is grounded in captured visual separation, not only offline prediction error.

## Quality Checks

- Validate every zip has `frames.csv` and `metrics.json`.
- Confirm required CSV columns.
- Confirm every default pattern appears:
  - `linear-slow`
  - `hold-right`
  - `linear-fast`
  - `hold-left`
  - `quadratic-ease-in`
  - `quadratic-ease-out`
  - `cubic-smoothstep`
  - `cubic-in-out`
  - `rapid-reversal`
  - `sine-sweep`
  - `short-jitter`
- Compare scorer frame counts to `metrics.json`.
- Keep raw package paths immutable once logged.

## Measurement Slot Policy

Only one experiment worker should capture calibrator measurements at a time. Heavy CPU/GPU work should not overlap with calibrator capture. This scaffold intentionally does not launch the calibrator or run training.
