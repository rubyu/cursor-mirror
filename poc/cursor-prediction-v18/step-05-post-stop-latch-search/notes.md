# Step 05 Notes: Post-Stop Latch Search

This step extends the Step 04 C# chronological replay harness with POC-only post-stop gates. Product source files are referenced read-only and are not modified.

## Added Runtime-Safe Signal

The Step 04 max event was `postStopFirstFrames` with high pre-window motion but low v5/v12 on the stop row. Step 05 therefore uses a lightweight `recentHigh` scalar:

`recentHigh = max(v5, v8, v12, recent segment max over latest 6 samples)`

This is intended to approximate the event-window `preMax` using only runtime history.

## Candidate Families

- `postStopLatchN`: snap to current for N frames after stop onset.
- `postStopDecayN`: scale prediction displacement during the latch window, then return to normal.
- `postStopCurrentDistanceCap`: cap mirror-current distance during the latch window.
- `oneFramePlus_*`: Step 04 one-frame snap plus post-stop latch/decay.
- `postStopDirectionClamp`: clamp only the forward component along recent motion.

Primary metrics are event-window peakLead, peakDistance, returnMotion, settle frames, and overshootThenReturn rate. Row metrics are guardrails.
