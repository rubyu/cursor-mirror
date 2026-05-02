# Phase 6 Distillation and Lightweight Model Design

## Scope
- Product target: poll anchors / `dwm-next-vblank`.
- Accepted baseline: `gained-last2-0.75`.
- Phase 4/5 GRU is treated only as an insight source; it is not deployed or used by this runner.
- Trace data is read from the root zip in place: `C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor\cursor-mirror-trace-20260501-091537.zip`.

## Baseline
- Test mean 0.947 px, RMSE 7.088 px, p95 3.002 px, p99 18.921 px, max 465.342 px.

## Ranked Lightweight Candidates
| Rank | Candidate | Accepted | Test mean delta | Test p95 delta | Test p99 delta | Test max delta | >1px reg / imp |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | `gained-last2-0.75` | yes | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0 / 0 |
| 2 | `gain-table-speed_x_horizon` | no | -0.0048 | 0.0176 | -0.6065 | 0.0000 | 282 / 337 |
| 3 | `gain-table-acceleration` | no | -0.0023 | -0.0219 | -0.2382 | 0.0000 | 275 / 337 |
| 4 | `conservative-speedxhorizon` | no | -0.0053 | -0.0219 | -0.1707 | 0.0000 | 189 / 248 |
| 5 | `conservative-risk-gated-speedxhorizon` | no | -0.0014 | 0.0526 | -0.1707 | 0.0000 | 73 / 92 |
| 6 | `gained-last2-0.875` | no | -0.0023 | 0.0012 | -0.1698 | 0.0000 | 411 / 461 |
| 7 | `gain-table-speed` | no | -0.0048 | -0.0280 | 0.0000 | 0.0000 | 125 / 174 |
| 8 | `ridge-linear-residual` | no | 0.0710 | 0.0131 | 0.2875 | -0.0070 | 8 / 0 |
| 9 | `gain-table-horizon` | no | 0.0028 | 0.0571 | 0.2893 | 0.0000 | 294 / 320 |
| 10 | `gained-last2-1` | no | 0.0421 | 0.1398 | 1.4763 | 0.0000 | 684 / 653 |

## Findings
- Fixed gain variants around the accepted gain do not beat the baseline strongly enough on tail risk.
- Train-selected piecewise gain tables can move mean error, but the validation/test tails remain fragile once p99/max and regression counts are considered.
- Conservative gates usually collapse toward a no-op fallback because the validation p99/max guard rejects most corrective bins.
- The ridge residual reference is cheap compared with the GRU, but it is not robust enough to productize from this single trace.
- DWM next-vblank horizon construction remains the most useful product-shaped improvement; fixed 16/24/33.33ms diagnostics are less representative of the display-relative target.

## Product Recommendation
Simplest acceptable candidate: `baseline + DWM-aware next-vblank horizon (gained-last2-0.75)`.

No lightweight correction in this Phase 6 search beats `gained-last2-0.75` strongly enough to productize. The recommended product path is baseline velocity extrapolation with DWM-aware next-vblank horizon selection, plus instrumentation to keep collecting compatible traces.

## C# Implementation Sketch
```csharp
struct PredictorState
{
    public double LastPollX, LastPollY;
    public long LastPollQpc;
    public double StopwatchFrequency;
}

PointD PredictNextVBlank(PredictorState s, double x, double y, long nowQpc, long nextVblankQpc)
{
    double dtSec = Math.Max(1e-6, (nowQpc - s.LastPollQpc) / s.StopwatchFrequency);
    double horizonSec = Math.Max(0.0, (nextVblankQpc - nowQpc) / s.StopwatchFrequency);
    double vx = (x - s.LastPollX) / dtSec;
    double vy = (y - s.LastPollY) / dtSec;
    const double gain = 0.75;
    return new PointD(x + vx * gain * horizonSec, y + vy * gain * horizonSec);
}
```

State is two positions, one timestamp, and the stopwatch frequency. The hot path has no heap allocation and only a small fixed number of floating point operations.

## Phase 7 Microbenchmark Targets
- Prediction hot path: p50 under 0.5 us and p99 under 2 us per call in managed C#.
- Zero allocations per prediction after warmup.
- End-to-end poll-to-prediction budget under 50 us p99, including DWM horizon lookup.
- Validate numerical parity against this runner within 0.01 px on replayed trace rows.
- Add counters for invalid/late DWM horizons, horizon over 1.25x refresh period, and fallback-to-hold behavior.

See `scores.json` for split metrics, speed bins, risk slices, regression counts, selected gain tables, and fixed-horizon diagnostics.
