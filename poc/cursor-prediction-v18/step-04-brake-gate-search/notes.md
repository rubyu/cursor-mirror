# Step 04 Notes: Event-Level Brake Gate Search

The search uses the Step 02 C# chronological replay baseline `lag0 offset -4ms` and applies POC-only brake gates in the harness. Product source files are not modified.

## Evaluated Gate Families

- `none`: baseline.
- `oneFrameStopSnap`: snap to current when the newest motion and target are near zero after recent movement.
- `nearZeroTargetSnap`: broader snap on near-zero target after recent movement.
- `hardBrakeCap`: cap predicted displacement magnitude during hard brake.
- `brakeGainScale`: scale predicted displacement during brake confidence.
- `postStopOneFrameLatch`: one-frame hold after stop detection.
- `alongOnlyBrake`: reduce only the forward component along recent motion.

## Ranking Objective

Primary ranking minimizes event-window `peakLead`, `peakDistance`, `returnMotion`, and overshoot-then-return rate. Normal-move and high-speed visual p95/p99 plus gate fire rate are guardrails.
