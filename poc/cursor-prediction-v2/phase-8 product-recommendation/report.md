# Phase 8 Product Recommendation

## Decision
Implement `baseline + DWM-aware next-vblank horizon` as the next Cursor Mirror prediction model.

Recommended model:
- anchor stream: current cursor polling position;
- horizon: next DWM vertical blank when available and valid;
- predictor: last2 velocity extrapolation;
- gain: `0.75`;
- fallback: hold current or current fixed-horizon behavior when DWM horizon is invalid, late, stale, or unavailable;
- learned correction: not productized.

## Why This Candidate Wins
The v2 trace made two things clear.

First, the best product-shaped improvement is not a larger model. It is selecting a better display-relative prediction horizon. DWM timing was available for every poll sample in the v2 trace, and the refresh period was stable around `16.668ms`.

Second, the deterministic baseline is already extremely strong for the low-risk bulk. Neural and gated models found a small high-risk correction signal, but they did not clear the robustness bar. The gated GRU improved mean and p95 slightly, but regressed p99 and created nontrivial small regressions. For a visible cursor overlay, tail regressions matter more than a tiny mean improvement.

## Evidence Summary
Phase 2 selected `poll / dwm-next-vblank / gained-last2-0.75` as the best product-relevant deterministic baseline:

- validation mean: about `0.597px`;
- validation p95: about `1.936px`;
- test mean: about `0.947px`;
- test p95: about `3.002px`.

Phase 4 found that standalone neural models did not beat the deterministic baseline on validation mean. The best learned result was a gated GRU hybrid.

Phase 5 rejected that gated hybrid for productization:

- test mean improved from about `0.947px` to `0.940px`;
- test p95 improved from about `3.005px` to `2.977px`;
- test p99 regressed from about `18.939px` to `19.228px`;
- `1105` test samples regressed by more than `1px`;
- `9` test samples regressed by more than `5px`.

Phase 6 found no lightweight correction strong enough to productize. Piecewise gain tables and conservative gates moved the mean by only a few thousandths of a pixel and did not offer a compelling tail-safety win.

Phase 7 showed the accepted predictor is cheap enough:

- best repeat mean: `0.023827us` per prediction;
- best repeat p99: `0.033594us` per prediction;
- worst repeat p99: `0.039266us` per prediction;
- allocation: `0` bytes over `2,000,000` predictions;
- replay parity max coordinate difference: `0px`.

## Product Shape
The implementation should keep a tiny state object:

```text
last poll X/Y
last poll timestamp
last valid DWM timing
stopwatch frequency
diagnostic counters
```

The prediction hot path should:

1. update last2 velocity from current and previous poll positions;
2. compute horizon to the next DWM vblank;
3. reject invalid, negative, stale, or too-long horizons;
4. return `current + velocity * 0.75 * horizon`;
5. fall back to hold-current or the existing exact/current behavior when required.

## Required Instrumentation
Add counters for:

- `invalid_dwm_horizon`;
- `late_dwm_horizon`;
- `horizon_over_1_25x_refresh_period`;
- `fallback_to_hold`;
- `prediction_reset_due_to_invalid_dt_or_idle_gap`.

These counters should be visible in debug logs or future trace output so additional traces can explain fallback behavior.

## Tests To Add
Unit tests:

- next-vblank horizon calculation;
- invalid and late DWM horizon fallback;
- horizon over `1.25x` refresh-period fallback;
- idle gap and invalid `dt` reset;
- gain `0.75` prediction math;
- zero-allocation predictor path if practical;
- numerical parity on a small embedded replay fixture.

Integration or manual tests:

- run Cursor Mirror with DWM-aware prediction enabled;
- verify no crash when DWM timing is unavailable;
- verify overlay remains click-through and no-activate;
- verify visible alignment through Parsec during normal and fast cursor movement.

## Non-Recommendations
Do not productize these from the current evidence:

- standalone MLP;
- standalone GRU;
- gated GRU hybrid;
- ridge residual correction;
- piecewise gain table;
- speed-only or speed-horizon correction gate.

They remain useful research references, but the current single compatible v2 trace is not enough to justify their tail risk.

## Next Implementation Tasks
1. Add a DWM timing provider for the Cursor Mirror runtime path.
2. Add a DWM-aware horizon calculator with explicit fallback rules.
3. Update the predictor from fixed horizon to dynamic horizon + gain `0.75`.
4. Add settings or hidden diagnostics only if needed; prediction should remain disableable from GUI.
5. Extend the trace tool to keep collecting compatible v2 data and counters.
6. Add tests from this recommendation before enabling the new model by default.
