# Step 02 - Calibrator Closed-Loop Runbook

## Purpose

Run MotionLab-backed Calibrator measurements with comparable scenario context and product runtime telemetry. This turns visual error into the deciding metric while preserving enough timing data to separate model error from runtime/rendering error.

## Required Inputs

- The generated verification package: `poc/cursor-prediction-v22-calibrator-closed-loop/lab-data/calibrator-verification-v22.zip`.
- A Release build of:
  - `artifacts/bin/Release/CursorMirror.Calibrator.exe`
  - `artifacts/bin/Release/CursorMirror.Core.dll`

## First Variant Grid

Start with a full-package grid so every candidate sees the same 50 second verification scenario set:

| model | target offset ms | duration | purpose |
| --- | ---: | ---: | --- |
| ConstantVelocity | 2 | 50s | current default comparison |
| ConstantVelocity | 0 | 50s | check whether +2ms is visibly late |
| ConstantVelocity | -2 | 50s | test earlier presentation target |
| LeastSquares | 0 | 50s | classical baseline comparison |
| DistilledMLP | -4 | 50s | learned model with known stop-risk behavior |
| RuntimeEventSafeMLP | -4 | 50s | current learned candidate recommendation |
| RuntimeEventSafeMLP | -2 | 50s | less aggressive learned timing |

Shorter runs are only smoke tests. Scoring runs use the whole package.

## Required Outputs Per Variant

- `calibration.zip`
- `product-runtime.zip`
- parsed `scores.json`
- per-package and per-pattern report

The visual package and product runtime package must share the same variant name.

## Acceptance Direction

A candidate is interesting only if it improves visible tail metrics above the known Calibrator floor:

- primary max > 20px must decrease first;
- primary p99 should not increase;
- hold/stationary floor must not increase beyond the current `12px` estimator floor;
- capture cadence must be similar enough that the comparison is meaningful.

## Current Step 01 Constraints

Historical Calibrator captures were around 24fps, not 60Hz. They remain useful context for the detector floor, but v22 scoring now comes from newly generated Lab-package Calibrator runs only.
