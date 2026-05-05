# v22 Experiment Plan

## Objective

Find the best practical predictor and runtime settings under Calibrator-observed visual error. The aspirational target is zero visible error. The first concrete objective is to create a controlled Calibrator scenario package so every variant is evaluated against the same motion, display capture, and product runtime path.

## Phase 0 - Verification Lab Data

Inputs:

- primary display bounds
- compact MotionLab scenario definitions

Outputs:

- `lab-data/calibrator-verification-v22.zip`
- `lab-data/calibrator-verification-v22.manifest.json`
- `lab-data/calibrator-verification-v22.summary.md`

Rules:

- Do not use existing repository-root capture packages as scoring inputs.
- Generate targeted scenarios for constant motion, high-speed tails, abrupt stops, reversals, curves, holds, and micro-adjustments.
- Keep the package compact enough to run within Calibrator's 60 second cap.

## Phase 1 - Calibrator Measurement

Decision:

- If stationary/hold p50 or p95 is nonzero, treat it as measurement floor or estimator artifact until a better visual detector is implemented.
- If high-speed tails dominate, prioritize prediction target/model tuning.
- If capture cadence is much slower than 60 Hz, do not use the package to judge small 1-4 ms changes.

## Phase 2 - Closed-Loop Runbook

Create repeatable commands for:

- generated MotionLab package-backed Calibrator runs
- model variants
- target offset variants
- optional product runtime telemetry packages

The runbook must distinguish commands that are safe to run unattended from commands that move the real cursor and block mouse input.

## Phase 3 - Recursive Improvement Loop

For each iteration:

1. Select a MotionLab scenario package and model/settings variant.
2. Run Calibrator and product runtime telemetry.
3. Analyze visual error, telemetry timing, and scenario/phase breakdown.
4. Classify failure mode.
5. Change exactly one major hypothesis.
6. Repeat until visual error is at measurement floor or no tested change improves the Pareto frontier.
