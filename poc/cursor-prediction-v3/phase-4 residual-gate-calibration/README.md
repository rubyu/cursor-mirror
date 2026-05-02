# Phase 4: Residual Gate Calibration

This phase tries to make the Phase 3 learned residual safer.

## Goal

Keep the high-risk improvements from the learned residual while sharply reducing visible pointwise regressions.

## Candidate Families

Evaluate:

- Phase 3 best candidate reproduction;
- residual shrinkage factors;
- vector residual caps;
- correction caps relative to baseline step length;
- low-speed guard;
- stop-settle and stationary guards;
- logistic or confidence threshold gates;
- validation-selected product-objective gates;
- uncertainty estimates that can abstain to the baseline.

## Required Metrics

Report each candidate against the baseline and Phase 3 best:

- overall mean/p50/p90/p95/p99/max;
- high-speed p95/p99;
- high-acceleration p95/p99;
- hook/poll disagreement p95/p99;
- stop-settle p95/p99;
- low-speed p95;
- regression counts `>1px`, `>3px`, `>5px`;
- correction application rate.

## Product Bias

Prefer abstaining to baseline over applying a risky correction. A smaller improvement with much fewer visible regressions is more valuable than a larger mean improvement with tail risk.

