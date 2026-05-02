# Phase 3: Learned Oracle Residual

This phase tests whether learned residuals or gates can improve on the current product baseline.

## Goal

Estimate whether there is a real learnable signal beyond the DWM-aware last2 baseline.

This phase is allowed to use heavier offline models than the product can ship, but every result must distinguish between:

- product-feasible inputs available at runtime;
- oracle-only inputs that use future information or labels.

## Required Baseline

Reproduce the Phase 1 and Phase 2 product baseline:

- poll anchor;
- DWM-aware next-vblank horizon;
- last2 velocity extrapolation;
- gain `0.75`;
- hold/current fallback for invalid timing.

## Candidate Families

Evaluate:

- linear or ridge residual over the baseline;
- small MLP residual if local CPU tooling supports it;
- high-risk-only residuals;
- learned gates choosing baseline vs correction;
- oracle upper-bound analyses, clearly marked as non-product.

## Required Scoring

Report all metrics against the baseline:

- overall mean/p50/p90/p95/p99/max;
- high-speed p95/p99;
- high-acceleration p95/p99;
- hook/poll disagreement p95/p99;
- stop-settle metrics;
- low-speed p95;
- regression counts `>1px`, `>3px`, `>5px`.

## Product Gate

A learned candidate must not worsen overall p99, low-speed p95, or create meaningful low-risk regressions. If it improves only high-risk regions, it must include a reliable gate that preserves the baseline elsewhere.

