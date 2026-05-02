# Phase 4 Best-Accuracy Model Search

## Method
- Reconstructed the Phase 3 product dataset: poll anchors, `dwm-next-vblank` labels, chronological Phase 1 split, and `gained-last2-0.75` residual baseline.
- Kept model search on the primary product target, `dwm-next-vblank`, and treated fixed horizons as diagnostics/upper-bound analysis only.
- Built train-only normalization for each feature family and froze it for validation/test.
- Trained bounded PyTorch models on cuda: minimal residual MLP, richer residual MLPs, direct richer MLPs, and GRU sequence residual models.
- Selected learned models by validation mean Euclidean error on `dwm-next-vblank` only. Held-out test metrics were then computed once for the selected models and matching baselines.

## Best Model
- Best validation learned model: sequence-gru-residual-h32-huber; validation mean 0.644 px, p95 2.023 px.
- Best selected accuracy model: gated-sequence-gru-residual-h32-huber; test mean 0.940 px, p95 2.977 px, p99 19.228 px, max 465.342 px.
- Same-mask baseline: test mean 0.947 px, p95 3.005 px, p99 18.939 px, max 465.342 px.
- Delta vs baseline: mean -0.0071 px, p95 -0.0274 px, p99 0.2892 px, max 0.0000 px.
- Best standalone learned model on selected test reporting: sequence-gru-residual-h32-huber; mean 0.987 px vs same-mask baseline 0.947 px.

## Slice Findings
- Learned models can reduce the high-motion tail, but several configs regress the standing/low-speed bulk where the deterministic baseline is already nearly exact.
- The most useful validation signal came from high-speed/high-acceleration weighting and richer motion history, not from absolute screen coordinates alone.
- Gated hybrid support: yes; validation rule speed>=500_and_horizon>=12 mean 0.592 px vs same-mask baseline 0.597 px.
- Standalone neural models did not beat the deterministic baseline on validation mean; the useful accuracy result is the validation-selected gate that leaves low-risk anchors on the baseline and applies neural correction only to a high-risk slice.

## Fixed-Horizon Diagnostics
- Fixed 16.67ms and 33.33ms baselines were computed as frame-period diagnostics only. They were not used for primary model selection.
- Fixed 16.67ms test baseline: mean 1.739 px, p95 6.895 px.
- Fixed 33.33ms test baseline: mean 3.944 px, p95 16.410 px.
- Short fixed horizons can still be useful as diagnostics or upper-bound analysis, but Phase 4 product recommendations here are based on `dwm-next-vblank`.

## Recommendation
- Phase 5 robustness checks should take the best validation-supported gated hybrid and the best standalone learned model, then compare them on `dwm-next-vblank` plus high-speed/high-acceleration/high-horizon slices across additional traces/devices.
- Phase 6 distillation should target the gated correction behavior into a cheap residual/tabular form first; keep the GRU as an accuracy reference unless Phase 5 proves it is materially more robust.

See `scores.json` for full validation tables, selected test metrics, speed bins, high-acceleration/high-horizon slices, parameter counts, operation estimates, and timing.
