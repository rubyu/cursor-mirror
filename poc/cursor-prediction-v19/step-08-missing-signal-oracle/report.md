# Step 08 Report: Missing-Signal Oracle

## Summary

Step 08 did **not** identify a strong runtime-feasible missing signal.

The explicit poll-stream variant made the stress case harsher: stale/duplicated poll samples can create a large return tail when visual error is measured against the true cursor position rather than the stale observed sample. Under that replay, neither current signals nor the proposed extra signals drove OTR/returnMotion close to zero.

Best ranked candidate:

- `baseline_product_brake`
- signal: current product signals
- feasibility: runtime now
- Step04b peakLead max: 5.279 px
- OTR >1px: 28.41%
- returnMotion max: 28.583 px
- real holdout p95/p99: 0.495 / 1.679 px

Baseline product brake on explicit poll stream:

- Step04b peakLead max: 5.279 px
- OTR >1px: 28.41%
- returnMotion max: 28.583 px

## Ablation Results

| candidate | signal family | feasibility | Step04b peak | OTR >1px | return max | real p95/p99 | normal fire |
|---|---|---|---:|---:|---:|---:|---:|
| baseline_product_brake | current product signals | runtime now | 5.279 | 28.41% | 28.583 | 0.495/1.679 | 0% |
| plus_sample_age | sampleAge/stale latest | runtime if timestamp/age retained | 5.279 | 28.41% | 28.583 | 0.495/1.679 | 0% |
| plus_target_cross_boundary | target crosses true stop boundary | future-label oracle; needs proxy instrumentation | 5.279 | 28.41% | 28.583 | 0.495/1.679 | 0% |
| plus_phase | target phase vs stop onset | requires stop-boundary proxy | 5.279 | 28.41% | 28.583 | 0.495/1.679 | 0% |
| combined_oracle_cap0p5 | runtime feasible + targetCross + future stop window | oracle upper bound | 5.146 | 31.82% | 28.583 | 0.495/1.679 | 0.06% |
| current_signals_step07_best | v5/latestDelta/recentHigh | runtime now | 5.146 | 30.68% | 28.877 | 0.495/1.679 | 7.2% |
| plus_duplicate_hold | duplicateHoldRun | runtime now from cursor samples | 5.146 | 31.82% | 28.877 | 0.495/1.679 | 0% |
| plus_raw_input_age | lastRawMovementAge | requires raw input age instrumentation | 5.146 | 31.82% | 28.877 | 0.495/1.679 | 0% |
| combined_oracle | runtime feasible + targetCross + future stop window | oracle upper bound | 5.146 | 31.82% | 28.877 | 0.495/1.679 | 0.06% |
| combined_runtime_feasible | v5/latestDelta + duplicate/hold + sampleAge | runtime feasible with sample age field | 5.146 | 34.09% | 28.877 | 0.495/1.679 | 0.04% |

## Interpretation

The proposed signals are useful for diagnosis, but this oracle pass says they are not sufficient as simple runtime gates:

- duplicate/hold and raw-input-age gates fire too late or too sparsely
- sample age alone does not identify enough of the return tail
- target-cross/phase oracle rows do not align with the worst stale-poll return tail in this synthetic construction
- combined runtime-feasible signals do not improve the event objective
- combined oracle signals still leave the large return tail

The important new clue is that explicit stale poll/current truth separation can create much larger returnMotion than Step04b speed-point proxies. That means the next experiment should improve data generation/capture fidelity, not add another product rule yet.

## Decision

`continueToStep09`: false

No Step 09 was started. There is not enough evidence for a bounded product/tooling change candidate.

## Required Next Data

- observed poll position and true/reference cursor position at the same prediction call
- sample age of the latest cursor sample
- raw input age / last movement age
- duplicate sample run length
- missed-poll indicator or expected poll cadence gap
- DWM target phase relative to the actual stop boundary
