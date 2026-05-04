# Step 06 Notes: Latch Fire-Rate Refinement

This step summarizes the existing C# replay output only. The C# replay was not re-run while producing these notes.

## Goal

Step 05 eliminated event-window overshoot/return tail, but its best latch fired on 2.88% overall and 22.21% of normalMove rows. Step 06 searched around that latch to reduce fire rate while keeping event max <= 0.5px where possible.

## Added Refinement Signals

- tighter target displacement thresholds: 0.1/0.25/0.5 px
- tighter v2 thresholds: 0/10/20/50 px/s
- release thresholds: v2 50/100/150 and target 0.25/0.5/0.75/1.0 px
- sustained stop frames: 1/2/3
- latest current delta thresholds for target+current zero
- path efficiency filters
- distance cap variants

## Interpretation Rule

normalMove fire is classified by whether a stop/near-stop follows within 10 frames. This is not an oracle used by the gate; it is diagnostic only.
