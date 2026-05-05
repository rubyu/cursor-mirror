# Step 01 Report: Metric Definition

v18 changes the primary evaluation anchor from shifted target to current real cursor position.

The main user-facing metric is `currentOvershootPx`: predicted mirror displacement ahead of the current real cursor in the recent motion direction. This is paired with `currentDistancePx`, because at a true stop any visible mirror displacement from the real cursor can matter.

The report keeps three signed frames separate:

| Frame | Meaning | Use |
|---|---|---|
| current-position | predicted position vs current real cursor, along recent motion | primary acute-stop user-visible overshoot |
| offset0 direction | candidate target error projected on offset-0 target direction | compatibility with v17 tail metric |
| candidate target direction | candidate target error projected on shifted target direction | checks whether the predictor leads past its own target |

Acute-stop slices are intentionally redundant at first: `fastThenNearZero`, `hardBrake`, `stopAfterHighSpeed`, `oneFrameStop`, and `postStopFirstFrames`. Step 02 will show which slices have enough support and which tail rows dominate.

The acceptance rule is strict: improve acute-stop current-position p99/max/tail rows while keeping normal movement and high-speed p95 from regressing materially.
