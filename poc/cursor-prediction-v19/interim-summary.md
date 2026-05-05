# v19 Interim Summary

v19 has now reproduced and analyzed the abrupt stop overshoot/return leak through Step 08.

## Current State

- Step04b reproduced the leak in product-equivalent replay.
- Step06/07 rule searches improved peakLead and return tail partially, but OTR stayed above 20%.
- Step08 explicit poll-stream/oracle replay did not find a runtime-feasible missing signal that solves the leak.

## Best Practical Candidate So Far

The best product-shaped idea remains the Step07/Step06 v5/latestDelta snap-latch family:

- peakLead max around 3.36px on Step04b stress
- OTR still around 21-22%
- real holdout p95/p99 unchanged in replay

This is not sufficient for product adoption.

## Blocker

The remaining failure appears to depend on poll-stream fidelity: whether the predictor sees a stale/duplicated/latest sample while the real cursor has already stopped or moved differently. Current logs/scenarios do not expose enough first-class state to design a robust runtime gate.

## Next Required Work

Do not modify the product predictor yet. First add or collect data with:

- observed poll position vs reference/true current position at prediction time
- sample age and raw input age
- duplicate/hold run length
- missed-poll/cadence gap
- DWM target phase relative to stop boundary

Then rerun v19 Step08-style oracle and Step07-style search on those traces.
