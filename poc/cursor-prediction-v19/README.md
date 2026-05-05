# Cursor Prediction POC v19

Goal: robustly solve abrupt deceleration/stop overshoot where the mirror cursor passes the real cursor and then returns.

## Current Status

- Step 01 baseline audit is complete on the latest v18 60Hz replay pair.
- Step 02 failure signature classification is complete for the no-brake DistilledMLP leak.
- Step 03 generated a POC-local parameterized MotionLab abrupt-stop scenario set.
- Current product-equivalent DistilledMLP lag0/-4ms with post-stop brake eliminates detected stop-event tail on this replay pair.

## Current Recommendation

Keep the product post-stop brake as validation/safety candidate, but do not stop the investigation. The live user report means v19 should next add parameterized abrupt-stop MotionLab scenarios and verify reproduction outside the two latest real recordings.

## Next Step

Step 04: verify reproduction by running product-equivalent predictors against the Step 03 scenario set; revise the generator if overshoot-then-return is not reproduced.


## Step 04-05 Update

Step 04 showed the original Step 03 scenarios were too gentle: zero stop events were detected by the Step 01 event-window predicate. Step 04b revised the generator and reproduced the leak in product-equivalent C# replay, including with current product post-stop brake enabled.

Current Step 04b product-brake stress score: peakLead max 5.328 px, OTR >1px 24.24%, returnMotion max 4.828 px.

Step 05 is a design-only dataset/loss plan. Next work should train/search against real 60Hz traces plus the revised abrupt-stop positive family, with file/scenario-level holdouts.


## Step 06 Update

Step 06 ran a compact CPU-only high-accuracy search. The learned MLP/FSMN-like candidates were not acceptable on Step04b peak tails. The best candidate was `rule_hybrid_latch_v5_300_high400_latest2p5`, lowering Step04b peakLead max from 5.328 px to 3.357 px with no replayed real-holdout p95 regression, but the residual tail is still too high. Step 07 distillation was not started.


## Step 07 Update

Step 07 ran a CPU-only deep runtime-rule search. Best candidate `curated_snap_v5_v450_h400_ld2p5_td99_r0p75_n4_c0_b0` slightly improves Step 06 and product brake, but OTR remains 21.28% and return max remains 3.19 px. Step 08 was not started.


## Step 08 Update

Step 08 tested explicit poll-stream and missing-signal oracle candidates. No runtime-feasible signal solved the leak; even oracle-style target-cross/phase signals did not collapse the explicit stale-poll return tail. See `interim-summary.md` for the current blocker and required data capture.


## Step 09 Update

Step 09 implemented the bounded telemetry path needed for the next capture. Trace packages now emit format version 10 with explicit runtime scheduler latency, duplicate/hold, last-movement-age, cadence-gap, missed-cadence, and target-phase derived columns. MotionLab Play and Record packages now include `motion-trace-alignment.csv` so recorded trace rows can be aligned to generated true cursor position and scenario phase.

No predictor behavior was changed. Debug build and normal tests passed: 139 passed, 0 failed. Next work requires new real/MotionLab captures with the new schema before more model or rule training.
