# Cursor Prediction v4 Phase 3 Report

## Decision

No default-on predictor change should be implemented from v4.

The Phase 2 product-feasible candidates do not satisfy the decision rule: a default-on candidate must improve p99 and high-risk slices without meaningful low-speed or pointwise visible regressions. The closest candidate, `mixed_hook_when_disagree_ge2_age16`, improves p99 by `2.045px` but creates too many visible regressions: `160` overall `>5px` regressions, including `15` in the low-speed slice.

The current product predictor should remain the default while the next PoC/product work focuses on runtime cadence, anchor instrumentation, hook/poll fusion evidence, and replay test infrastructure.

## Evidence Base

v4 used the first trace with dense `referencePoll` samples:

| trace property | value |
| --- | ---: |
| trace format | `3` |
| total CSV rows | `975,443` |
| duration | `2,110.246s` |
| hook moves | `51,541` |
| product polls | `99,624` |
| reference polls | `824,278` |
| product poll p50 / p95 | `15.923ms` / `63.081ms` |
| reference poll p50 / p95 | `2.000ms` / `2.001ms` |
| DWM timing availability | `100%` |

Reference label quality is good for the scored anchors. Phase 1 found `98,244 / 99,622` target labels bracketed by `referencePoll` samples within `0-2.1ms`, and error did not concentrate in poor reference-coverage bins. That makes the tail more credible than in earlier traces where the label stream and runtime stream were less clearly separated.

## Baseline

The v4 product baseline is `product_baseline_dwm_last2_gain_0_75`: last-two product poll velocity, gain `0.75`, projected to the actual DWM target when valid.

| model | mean px | p95 px | p99 px | max px |
| --- | ---: | ---: | ---: | ---: |
| product baseline | `1.695` | `6.771` | `36.245` | `682.467` |
| hold current at DWM target | `2.444` | `10.000` | `57.057` | `522.433` |
| fixed 8ms last2 gain 0.75 | `1.494` | `6.146` | `31.295` | `448.368` |
| fixed 16ms last2 gain 0.75 | `2.877` | `12.416` | `60.463` | `799.888` |

The baseline still beats hold-current on mean, p95, and p99. Fixed `8ms` looks easier than the real product/DWM replay, which is important: the actual product run is not behaving like an 8ms steady sampler.

## Risk Slices

The dominant tail slices are still runtime freshness and hard motion regimes:

| slice | n | baseline p95 px | baseline p99 px |
| --- | ---: | ---: | ---: |
| speed `>=2000px/s` | `3,462` | `88.444` | `161.659` |
| acceleration `>=100k px/s^2` | `3,765` | `84.600` | `165.261` |
| hook/poll disagreement `8-32px` | `509` | `56.445` | `97.770` |
| hook/poll disagreement `>=32px` | `175` | `212.847` | `320.169` |
| stop `pre_stop_0_16ms` | `22,716` | `28.565` | `87.138` |
| stop `stop_entry_0_16ms` | `5,946` | `13.205` | `52.878` |
| DWM horizon `12-16.7ms` | `26,324` | `11.338` | `56.646` |
| product poll interval `67-100ms` | `3,667` | `14.952` | `69.421` |

These are not primarily reference-label problems. They are where product anchors are stale, motion changes quickly, or prediction is projected into longer/irregular horizons.

## Candidate Result

The best product-feasible candidate was `mixed_hook_when_disagree_ge2_age16`.

| metric | baseline | candidate | delta |
| --- | ---: | ---: | ---: |
| mean px | `1.695` | `1.603` | `-0.092` |
| p95 px | `6.771` | `6.385` | `-0.386` |
| p99 px | `36.245` | `34.200` | `-2.045` |
| max px | `682.467` | `682.467` | `0.000` |
| overall `>5px` regressions | `0` | `160` | `+160` |
| low-speed `>5px` regressions | `0` | `15` | `+15` |

High-risk slices improve, but not cleanly:

| slice | baseline p95 / p99 | candidate p95 / p99 | candidate `>5px` regressions |
| --- | ---: | ---: | ---: |
| speed `>=2000px/s` | `88.444` / `161.659` | `84.396` / `154.380` | `103` |
| acceleration `>=100k px/s^2` | `84.600` / `165.261` | `80.526` / `158.389` | `82` |
| low speed `<=25px/s` | `0.000` / `3.970` | `0.000` / `3.326` | `15` |

This is a useful diagnostic signal for hook/poll fusion, but not a ship-ready rule.

## v4 Compared With v3

v3 concluded: do not enable a new predictor by default yet. It had a promising learned residual candidate, `distilled_linear_score_exact_gate`, improving test p99 from `29.282px` to `25.728px`, with low-speed p95 unchanged and `16` visible `>5px` regressions. v3 still required more independent traces before product integration.

v4 reinforces the no-default-on decision, but for a sharper reason:

- v3's labels and runtime anchors were less cleanly separated; v4's `referencePoll` gives a better ground-truth stream.
- v4 shows the baseline p99 as `36.245px` against dense labels, and confirms that reference coverage is not the main bottleneck.
- v4 exposes product poll cadence as a major product issue: requested `8ms`, observed p50/p95 about `15.923ms`/`63.081ms`.
- v4 deterministic candidates do not clear the regression guard; the best p99 candidate still creates `160` visible `>5px` regressions.
- v4 makes learned residuals less urgent until runtime anchor timing is fixed or at least instrumented, because a learned model would likely absorb stale-anchor and cadence artifacts.

In short: v3 said "promising predictor, not enough deployment evidence." v4 says "better labels now show the next bottleneck is runtime freshness, so fix measurement and cadence before predictor complexity."

## Product Recommendation

Do not change the default predictor.

Do not implement the Phase 2 mixed hook/poll candidate as default-on. It may be worth preserving as an offline replay experiment or opt-in diagnostic variant after instrumentation exists, but it should not be productized from this single trace.

The near-term product work should be instrumentation-first:

1. TraceTool changes: record every field required to replay the exact runtime anchor decision, not just input/output positions.
2. Runtime timer/cadence changes: measure and improve actual poll wakeups, especially under load and near DWM composition.
3. Hook/poll fusion instrumentation: record hook age and disagreement at each product poll, including whether a hook sample would have been eligible for prediction.
4. Replay tests: add fixed budgets for p99, high-risk slices, low-speed regressions, and pointwise visible regressions.
5. Learned residual timing: defer until cadence and anchor behavior are stable across multiple traces.
6. More traces: collect after instrumentation, not before, so the next dataset can explain why a candidate helped or hurt.

## Suggested Acceptance Gates For v4.1

A future candidate should clear all of these before default-on consideration:

| gate | requirement |
| --- | --- |
| overall p99 | improves versus current product baseline |
| high-speed p95/p99 | improves without large pointwise losses |
| high-acceleration p95/p99 | improves without large pointwise losses |
| low-speed p95 | unchanged or better |
| low-speed `>5px` regressions | zero, or explicitly justified and manually inspected |
| overall `>5px` regressions | materially lower than the Phase 2 mixed-hook candidate |
| replay coverage | multiple independent traces, not one session |
| runtime feasibility | allocation-free hot path, deterministic fallback on stale/invalid inputs |

## Conclusion

v4 should close with no predictor implementation. The strongest evidence-backed next move is to make the runtime observable and make the poll cadence honest. Once the product can explain anchor freshness and cadence at replay time, hook/poll fusion and learned residuals become much safer to evaluate.
