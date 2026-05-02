# Evaluation Policy

v3 optimizes for visible cursor quality, not only average prediction error.

## Baseline

All candidates compare against the current product baseline:

- poll anchor;
- DWM next-vblank horizon when valid;
- last2 velocity extrapolation;
- gain `0.75`;
- fallback to current/hold position.

## Primary Metrics

The primary score is not a single mean value. A candidate must be judged across:

- overall mean;
- p95;
- p99;
- max;
- high-speed p95/p99;
- high-acceleration p95/p99;
- direction-change p95/p99;
- stop-settle residual error;
- low-speed regression count.

## Product Gate

A candidate is rejected if it creates a visible-tail regression unless it provides a clearly larger improvement in the exact user-visible failure mode it targets and can be guarded by a reliable runtime gate.

Default rejection triggers:

- worse overall p99;
- worse low-speed p95;
- more than a small number of `>5px` regressions in low-risk regions;
- any model that cannot fall back to the baseline on uncertain inputs;
- any runtime shape that requires allocations or unbounded history in the hot path.

## Preferred Model Shape

Prefer models in this order when scores are close:

1. deterministic O(1) filter;
2. deterministic piecewise or gated filter;
3. small linear residual model with explicit gate;
4. tiny MLP or sequence model only as an oracle or opt-in candidate.

## Stop Behavior

Stopping behavior is evaluated separately from moving prediction.

A good model should:

- reduce prediction quickly when speed collapses;
- converge to polled current position even without new hook movement;
- avoid overshoot after stops and direction changes;
- keep final visible offset bounded.

