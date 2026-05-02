# Final Recommendation

Recommendation: **collect more data first**.

Do not implement default-on from the current evidence. The Phase 5 best candidate is light and real, and it wins each chronological block inside the v2 product trace, but that is still one compatible product trace and the selected gate's visible-regression budget is too high.

## Strongest Finding

The selected candidate improves held-out p99 from 29.282 px to 25.728 px and wins p99 in 10/10 chronological v2 blocks, but it has 16 >5px regressions and no independent product trace validation.

## Safest Candidate

Safest bounded-grid candidate: `p6_vector_cap_5`. It reduces visible regressions to 0 >5px cases while keeping p99 at 27.111 px and preserving low-speed p95 at 0.440 px. The tradeoff is capped correction magnitude: weaker p99/high-risk improvement than the Phase 5 best, and no >5px pointwise improvements.

## Product Direction

Collect more data first, then consider an opt-in/research implementation with replay tests and explicit UI affordances if the same conservative shape survives independent traces. Default-on needs independent chronological wins, no low-speed regression, p99 improvement, and a near-zero visible-regression budget.