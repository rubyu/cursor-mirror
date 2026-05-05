# Cursor Prediction POC v22 - Calibrator Closed Loop

Goal: use Calibrator as the visual-error authority and recursively reduce visible mirror-cursor error toward zero.

This POC uses Calibrator as the primary measurement tool. It starts by generating a dedicated MotionLab verification package for Calibrator runs, then compares model and timing variants against that same package. Existing root capture packages are not scoring inputs.

## Working Rules

- Treat Calibrator visual error as the product-facing metric, but first estimate the measurement floor.
- Keep planned motion, observed input, visual capture, and product runtime telemetry conceptually separate.
- Do not use precomputed MotionLab sample rows for playback; use compact scenario definitions and samplers.
- Do not launch full-screen Calibrator runs from normal CI or unit tests.
- Do not use repository-root trace, motion-recording, or calibration capture packages as v22 scoring inputs.
- Record every phase with `report.md`, `notes.md`, and machine-readable JSON.

## Steps

0. `step-00-lab-data`
   - Generate `lab-data/calibrator-verification-v22.zip`.
   - Cover hold floor, constant motion, high-speed tails, abrupt stops, reversals, curves, and micro-adjustments.

1. `step-01-calibrator-audit`
   - Historical only: the old root calibration package audit is retained as context, not as a scoring input.

2. `step-02-runbook`
   - Define repeatable Calibrator commands using the generated verification package and product runtime telemetry.
   - Run the same full scenario set for each model/offset variant.

3. Later steps
   - Compare model/offset variants with the same MotionLab scenario package.
   - Use Calibrator failures to generate or select new MotionLab stress scenarios.
   - Accept only changes that improve visual tails without increasing stationary jitter.
