# Experiment Log

## 2026-05-04

- Started POC v18 with write scope limited to `poc/cursor-prediction-v18/`.
- Confirmed current product generated DistilledMLP source reports model id `mlp_fsmn_h8_hardtanh_label_q0p125_lag0` and `LagCompensationPixels = 0.0f`.
- Created Step 01 metric definition and Step 02 C# chronological replay baseline plan.
- Ran Step 02 C# chronological replay over m070248/m070307 with lag0 and lag0.5 variants.
- Current product direct equivalent (`lag0 offset -4ms`) is strong on current-position acute-stop metrics: fastThenNearZero current overshoot p99 0, max 1.989, `>2px` rate 0.
- Residual tail is a single one-frame-stop row where v2/target are zero but v5/v12 remain high and prediction emits about 2.15px from current.
- Next Step 03 should test narrow brake/snap gates for oneFrameStop/hardBrake without harming normalMove/highSpeed.

- User clarified that the visible failure is not a single-frame current-position overshoot but a stop-event sequence: mirror leads after stop, then returns.
- Redefined Step 03/04 around event-window overshoot: stop events use a 6-frame pre-window and 10-frame post-window, with peakLead/peakDistance/settle/returnMotion/overshootThenReturn as primary metrics.
- Ran Step 04 C# replay brake-gate search with event-level scoring. Best narrow candidate is `oneFrameStopSnap_v20_h400_td0p25`; it reduces event p99 but leaves the max postStopFirstFrames event, so broad adoption is not yet recommended.

- Ran Step 05 post-stop latch search: C# replay over 546 post-stop latch/decay/cap/direction-clamp candidates.
- Best event candidate is `postStopLatchN10_v20_h400_td0p25_rv100_rt0p5`, which drives event peakLead/peakDistance/returnMotion max to 0 on the detected windows, but fires on 2.88% overall and 22.2% of normalMove rows; treat as a validation candidate, not a final product change.

- Completed Step 06 latch fire-rate refinement from existing `latch-refinement-output.json` without re-running C# replay.
- Selected `baseLatchN10_v0_h400_td0p1_rv50_rt0p25`: event tail remains zero, overall fire is 2.768%, normalMove fire is 21.661%, and 99.464% of fired normalMove rows are followed by stop/near-stop within 10 frames.
- Adoption remains validation-flag only; product default needs live logging/product replay due to high normalMove fire label.
