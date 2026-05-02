# Phase 2: Runtime Anchor And Deterministic Candidates

This phase evaluates deterministic predictors using the v4 trace.

## Goal

Determine whether Cursor Mirror should improve its runtime input anchor, its prediction model, or both.

## Constraints

- `referencePoll` is ground truth only.
- Product-feasible candidates may use product `poll`, low-level hook rows, DWM timing, and past/current values.
- Any use of dense `referencePoll` as runtime input must be labeled hypothetical/non-product.

## Candidate Families

- current product baseline;
- DWM/fixed horizon gain grids;
- poll interval gates;
- stop-entry/settle guards;
- latest-hook anchor;
- mixed hook/poll anchor;
- hook-derived velocity;
- hypothetical scheduler/input-cadence variants.

## Required Scoring

Report overall and sliced metrics:

- mean/p50/p90/p95/p99/max;
- high-speed and high-acceleration;
- product poll interval bins;
- DWM horizon bins;
- hook/poll disagreement;
- stop windows;
- chronological blocks;
- regression counts versus baseline.

