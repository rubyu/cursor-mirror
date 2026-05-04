# Step 07 Notes: Deep Rule/Event Search

Step 07 is an added CPU-only deep rule search. No distillation or product source changes were made.

The first unbounded grid was too slow, so the completed pass uses a bounded 300-spec search:

- 120 curated specs around the Step 06 high-signal v5/latestDelta latch family
- 180 coarse specs covering velocity windows, recentHigh, latestDelta, target distance, path efficiency, decel ratio, horizon range, action type, latch duration, cap/blend, and along-only suppression

Actions covered: snap-to-current, displacement cap, blend toward current, along-direction cap, and along-direction zero.

Fire diagnostics are reported by source/split/family for retained top candidates.
