# Phase 2: Deterministic Risk Gates

This phase tests product-shaped deterministic candidates against the Phase 1 baseline.

## Goal

Reduce visible tail errors while preserving the strong low-risk behavior of the current product baseline.

## Required Baseline

Reproduce the Phase 1 product baseline:

- poll anchor;
- DWM-aware next-vblank horizon;
- last2 velocity extrapolation;
- gain `0.75`;
- hold/current fallback for invalid timing.

## Candidate Families

Evaluate bounded, deterministic variants:

- speed-aware gain and horizon shortening;
- acceleration-aware gain and horizon shortening;
- hook/poll disagreement gating;
- poll interval or jitter gating;
- stop-entry and stop-settle decay toward hold/current;
- alpha-beta filter;
- alpha-beta-gamma filter;
- carefully justified combinations.

## Required Scoring

Every candidate must report:

- overall mean/p50/p90/p95/p99/max;
- high-speed p95/p99;
- high-acceleration p95/p99;
- hook/poll-disagreement p95/p99;
- stop-settle residual metrics;
- low-speed regression counts;
- number of samples regressed by more than `1px`, `3px`, and `5px` versus baseline.

## Product Gate

A candidate should not be recommended if it worsens overall p99 or low-speed p95 unless the regression is explicitly gated away by a reliable runtime signal.

