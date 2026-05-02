# Phase 2 Ground Truth and Baselines

## Method
- Loaded trace.csv directly from the repository-root zip; the zip was not copied.
- Used poll elapsedMicroseconds as the visible-position label clock.
- Constructed future labels by linear timestamp interpolation between poll samples.
- Applied the Phase 1 chronological train/validation/test split with 1s gaps.
- Evaluated poll, hook move, and hook current-cursor anchor sets against fixed horizons and DWM-relative targets.

## Validation-First Results
- Overall validation winner: poll / fixed-4ms / gained-last2-0.875; validation mean 0.260 px, p95 0.943 px; test mean 0.428 px, p95 1.660 px.
- Best fixed-horizon baseline: poll / fixed-4ms / gained-last2-0.875; validation mean 0.260 px; test mean 0.428 px.
- Best dwm-next-vblank: poll / gained-last2-0.75; validation mean 0.597 px, p95 1.936 px; test mean 0.947 px, p95 3.002 px.
- Best dwm-next-vblank-plus-one: poll / gained-last2-0.75; validation mean 1.945 px; test mean 3.117 px.
- Best hook-move baseline: fixed-4ms / hold-current; validation mean 1.853 px. Best hook-cursor baseline: fixed-4ms / gained-last2-1.125; validation mean 3.031 px.

## Target Definition Quality
- Fixed horizons are fully deterministic and valid wherever the interpolated poll target remains inside the split.
- dwm-next-vblank is reliable for this trace because every poll row carries DWM timing and unique vblank timestamps are monotonic after conversion to elapsed microseconds.
- For poll anchors, dwm-next-vblank validation labels have count 23638, horizon p50 8.874 ms, and horizon p95 26.084 ms.
- dwm-next-vblank-plus-one is also constructible, but it asks a longer horizon and has larger error; keep it as a stress target rather than the primary Phase 3 target.

## Recommendation for Phase 3
Use dwm-next-vblank as the Phase 3 product target, with fixed 16ms/24ms retained as comparison slices. It is display-relative, has stable construction from the complete DWM timing stream, and its validation/test error is close enough to fixed-horizon baselines to be the more meaningful Cursor Mirror target.

Recommended baseline to carry forward: poll anchors with gained-last2-0.75 for dwm-next-vblank.

## Notes and Limits
- Hook anchors were evaluated as feature/anchor streams only; all labels come from interpolated poll positions.
- Alpha-beta/Kalman-like filters were deferred. The deterministic grid already covers hold, last2 gain/damping, last-N linear regression, and capped last3 acceleration without introducing online state across split boundaries.
- Metrics include train, validation, and held-out test splits plus speed bins (0-500, 500-1500, 1500-3000, 3000+ px/s) in scores.json.
