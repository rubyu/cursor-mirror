# Phase 8 Product Recommendation

This phase summarizes the v2 cursor-prediction experiments and turns the findings into a Cursor Mirror product recommendation.

The recommended product direction is:

- use DWM timing to choose a display-relative next-vblank prediction horizon;
- use the deterministic last2 velocity predictor with gain `0.75`;
- do not productize learned corrections from this trace;
- keep collecting compatible v2 traces before revisiting neural or gated corrections.

See `report.md` for the full recommendation and `scores.json` for machine-readable decisions.
