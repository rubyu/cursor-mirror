# Cursor Prediction v7

v7 is a fresh POC scaffold for choosing the best Cursor Mirror prediction model from explicit `CursorMirror.Calibrator` measurements.

Status: setup only. No calibrator run, GPU training, or production source edit has been performed for this scaffold.

## Measurement Contract

The decisive artifact for v7 is a calibrator zip produced by:

```powershell
.\artifacts\bin\Release\CursorMirror.Calibrator.exe --auto-run --duration-seconds 30 --output .\poc\cursor-prediction-v7\runs\raw\<candidate>\<run-id>.zip --exit-after-run
```

Each zip is expected to contain:

- `frames.csv`
- `metrics.json`

`frames.csv` is the per-frame source of truth for pattern-aware scoring. Required columns are:

```text
frameIndex,timestampTicks,elapsedMilliseconds,patternName,phaseName,expectedX,expectedY,expectedVelocityPixelsPerSecond,width,height,darkPixelCount,hasDarkPixels,darkBoundsX,darkBoundsY,darkBoundsWidth,darkBoundsHeight,estimatedSeparationPixels
```

`metrics.json` is used as a run-level cross-check and includes total frame counts, baseline dark bounds, aggregate separation, capture source, and `PatternSummaries`.

## Scoring Goal

Lower captured visual separation is better. v7 compares candidates by motion pattern, not only by one aggregate number.

Primary metric:

- Per-pattern `estimatedSeparationPixels` on dark frames from `frames.csv`.
- Report `mean`, `p50`, `p90`, `p95`, `p99`, and `max`.
- Candidate score is a weighted per-pattern objective: `0.50 * p95 + 0.35 * p99 + 0.15 * max`.
- Fast, reversal, sweep, and jitter patterns receive higher comparison weight because prior trace work showed tail risk there.

Promotion gates:

- No candidate should worsen any high-risk pattern p95 by more than `0.50 px` against the current default.
- No candidate should worsen any pattern max by more than `1.00 px`.
- A candidate must improve the weighted visual score by at least `5%` over repeated runs before it is worth production work.

## Layout

- `experiment-plan.md`: detailed phase plan.
- `experiment-log.md`: append-only experiment log.
- `initial-plan.json`: machine-readable plan seed.
- `schemas/`: JSON schemas for plan, calibrator package expectations, scores, and reports.
- `scripts/score-calibration.js`: dependency-free Node.js scorer for calibrator zip packages.
- `runs/raw/`: intended location for raw calibrator zip outputs.
- `runs/summaries/`: intended location for scorer output.

## Scorer

The scorer does not launch the calibrator or train a model. It reads completed calibrator zips and emits a normalized JSON comparison.

```powershell
node .\poc\cursor-prediction-v7\scripts\score-calibration.js --baseline current-default --run current-default=.\poc\cursor-prediction-v7\runs\raw\current-default\calibration-current-default-001.zip --out .\poc\cursor-prediction-v7\runs\summaries\baseline-score.json
```

For candidate comparison, pass multiple `--run candidate=path.zip` values. Repeated labels are treated as repeated measurements for that candidate.

## Proposed First Measurement

Use the existing Release calibrator if it matches the code under test:

```powershell
.\artifacts\bin\Release\CursorMirror.Calibrator.exe --auto-run --duration-seconds 30 --output .\poc\cursor-prediction-v7\runs\raw\current-default\calibration-current-default-001.zip --exit-after-run
```

This should capture about two full default motion-suite loops after warmup and establishes the current visual-separation baseline.
