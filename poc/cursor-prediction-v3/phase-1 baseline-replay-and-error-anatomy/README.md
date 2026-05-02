# Phase 1: Baseline Replay And Error Anatomy

This phase reconstructs the current product baseline and breaks its errors down by motion regime.

## Inputs

- `../../../cursor-mirror-trace-20260501-000443.zip`
- `../../../cursor-mirror-trace-20260501-091537.zip`

## Required Outputs

- `report.md`
- `experiment-log.md`
- `scores.json`
- scripts required to reproduce the phase

## Baseline

Use the v2 product baseline where trace data supports it:

- anchor: poll sample position;
- target: display-relative next DWM vblank position by timestamp interpolation;
- prediction: current position plus last2 velocity times `0.75 * horizon`;
- fallback: hold/current position for invalid, negative, stale, or excessive horizons.

If a trace lacks DWM timing, evaluate fixed horizons `4`, `8`, `12`, and `16ms` as compatibility slices.

