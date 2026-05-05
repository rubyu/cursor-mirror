# Experiment Log

## 2026-05-04

- Created v19 workspace under `poc/cursor-prediction-v19/`.
- Ran Step 01 C# chronological baseline audit over `m070248` and `m070307`.
- Audited ConstantVelocity, LeastSquares, DistilledMLP lag0/-4ms, and DistilledMLP lag0/-4ms with product post-stop brake.
- Step 01 result: product post-stop brake drives detected event-window peakLead/returnMotion to zero on the latest 60Hz replay pair.
- Created Step 02 failure signature classification from Step 01 output without re-running replay.
- Step 02 result: no-brake DistilledMLP leak is mixed phase (`postStopFirstFrames`, `oneFrameStop`, `fastThenNearZero`) and mostly full-stop/high-efficiency approach; Step 03 should add synthetic abrupt-stop coverage.
- Generated Step 03 POC-local MotionLab abrupt-stop scenario set with 24 parameterized scenarios covering speed, stop duration, near-zero creep, curved approach, phase shifts, and dropout proxy families.
- Step 04 should verify reproduction on those scenarios before training or changing product runtime.


## Step 04 - Reproduction

- Ran C# product-equivalent replay over Step 03 MotionLab abrupt-stop scenarios.
- Result: original Step 03 set produced zero detected stop events; no event-window leak reproduced.
- Revised generator in Step 04b with high-speed, narrow-decel, phase, stale/missed-poll, near-zero-creep, and curved families.
- Step 04b result: no-brake and current product post-stop brake both reproduce abrupt-stop event-window overshoot/return.
- Product-brake revised metrics: peakLead max 5.328 px, OTR >1px 24.24%, returnMotion max 4.828 px.

## Step 05 - Dataset/Loss Design

- Created design-only dataset/loss plan using real 60Hz traces plus Step 03 coverage and Step 04b positive abrupt-stop families.
- No GPU training run in this step.


## Step 06 - High-Accuracy Model Search

- Built CPU-only C# training/evaluation dataset from real 60Hz traces, Step03 coverage scenarios, and Step04b positive stress scenarios.
- Dataset rows: 118566; train 60382, validation 7468, test 50716.
- Tried MLP temporal, larger MLP temporal, FSMN-like MLP, product baseline, and runtime rule hybrids.
- Best: rule_hybrid_latch_v5_300_high400_latest2p5; Step04b peakLead max 3.357 px, OTR >1px 22.34%, return max 3.226 px, real holdout p95 0.495 px.
- Product-brake baseline: peakLead max 5.328 px, OTR >1px 20.21%, return max 4.588 px.
- continueToStep07=false; no distillation step started.


## Step 07 - Deep Rule/Event Search

- Ran CPU-only deep rule/event search over 300 runtime-safe rule specs.
- Best: curated_snap_v5_v450_h400_ld2p5_td99_r0p75_n4_c0_b0; Step04b peakLead max 3.357 px, OTR >1px 21.28%, return max 3.19 px, real holdout p95 0.495 px.
- Current product brake baseline: peakLead max 5.328 px, OTR >1px 20.21%, return max 4.588 px.
- continueToStep08=false; no distillation or product integration started.


## Step 08 - Missing-Signal Oracle

- Built explicit poll-stream synthetic replay separating true cursor position from observed poll position.
- Evaluated current signals, duplicate/hold, raw input age, sample age, target-cross-boundary, phase, combined runtime-feasible, and oracle candidates.
- Best ranked candidate: baseline_product_brake; peak 5.279 px, OTR >1px 28.41%, return 28.583 px.
- No strong runtime-feasible signal found; continueToStep09=false.
- Wrote interim v19 summary with blocker and required data capture.


## Step 09 - Telemetry Instrumentation

- Implemented bounded instrumentation only; predictor behavior was not changed.
- Added trace format version 10 derived runtime scheduler telemetry: read/dispatch/queue/sample latencies, duplicate/hold run length, last movement age, cadence gap, missed-cadence flag, and target phase deltas.
- Added MotionLab Play and Record `motion-trace-alignment.csv` with generated true cursor position and scenario phase aligned to each recorded trace row.
- Updated specs and tests for the new package fields.
- Ran `.\scripts\test.ps1 -Configuration Debug`: build passed; 139 tests passed, 0 failed.
- Stop here until new real/MotionLab traces are captured with the new telemetry.
