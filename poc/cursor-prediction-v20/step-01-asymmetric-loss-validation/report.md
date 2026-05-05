# Step 01 Report - Asymmetric Future-Lead Loss

## Summary

Asymmetric future-lead loss is useful, but not sufficient by itself.

It successfully lowers row-level future-lead error and lowers the overshoot-then-return rate for several learned models. However, the same models create larger event-tail peaks and much larger return motion on the Step04b abrupt-stop stress set. That means the idea should be kept as a training component, but it should not replace the current product model or v19 rule candidates alone.

## Data

- Real 60Hz traces: `m070248` train and `m070307` test.
- Synthetic coverage: v19 Step03 original abrupt-stop scenarios.
- Stress set: v19 Step04b revised abrupt-stop scenarios.
- Total rows: `118566`.
- Event-window rows: `5466`.
- Static rows: `73112`.

## Loss Definition

For a prediction at the display target time:

```text
signed_future_error = dot(predicted_position - future_position, direction)
lead_error = max(0, signed_future_error)
lag_error = max(0, -signed_future_error)
```

The asymmetric candidates add a weighted squared penalty on `signed_future_error`, using a much larger weight when the error is on the leading side.

## Key Results

| candidate | loss | Step04b peakLead max | OTR >1px | return max | futureLead p99 | normal futureLag p95 | real p95/p99 |
|---|---|---:|---:|---:|---:|---:|---:|
| product brake | event-safe baseline | 5.328 | 20.2% | 4.588 | 2.750 | 9.916 | 0.495 / 1.679 |
| v19 rule hybrid | event-safe baseline | 3.357 | 22.3% | 3.226 | 2.625 | 9.938 | 0.495 / 1.679 |
| MLP h32 event-safe | event-safe | 11.107 | 11.7% | 4.573 | 1.556 | 4.245 | 0.492 / 1.762 |
| MLP h64 event-safe | event-safe | 12.061 | 9.6% | 4.553 | 1.770 | 3.228 | 0.493 / 1.697 |
| MLP h32 asym lead32/event2/lag1 | asymmetric | 10.757 | 8.5% | 9.833 | 0.635 | 4.543 | 0.425 / 2.052 |
| MLP h32 asym lead16/event1/lag0.5 | asymmetric | 10.752 | 10.6% | 10.252 | 0.524 | 4.750 | 0.648 / 2.016 |
| MLP h32 asym lead16/event4/lag1 | asymmetric | 12.560 | 7.4% | 11.195 | 1.035 | 3.203 | 0.479 / 1.844 |

## Interpretation

The asymmetric loss does what it is asked to do at row level:

- `futureLead p99` improves from the product baseline's `2.750px` down to about `0.52-0.64px` in the strongest candidates.
- OTR rate improves from about `20.2%` down to `7-11%` in the learned candidates.

But it does not yet solve the event behavior:

- `peakLead max` is roughly `10-12px` in learned candidates, worse than the product baseline.
- `returnMotion max` rises to roughly `9.8-11.2px`, worse than the product baseline.
- Some candidates improve real-trace p95 while worsening real-trace p99, which is not safe for adoption.

This suggests the loss is reducing common leading rows while allowing rare, high-impact event tails. The next useful variant is not "more lead weight"; it is an event-sequence loss or constrained output action that caps tail risk while keeping the asymmetric row penalty.

## Recommendation

Keep asymmetric future-lead loss as a useful training term. Do not adopt any v20 Step 01 learned model as product logic.

Next experiments should combine:

- asymmetric future-lead row loss;
- explicit event-sequence penalties on peakLead and returnMotion;
- an output cap or lead-direction suppression guard;
- the new telemetry from v19 Step09 once fresh traces are available.
