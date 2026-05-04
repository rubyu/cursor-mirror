# Phase 5 ML Teacher Probe

Generated: 2026-05-03T09:09:12.049Z

Canonical input: `runs/scripts.synthetic.phase2.jsonl`  
Scripts: 3000; split seed 33003; train/validation/test scripts 2100/450/450.  
Rows: train/validation/test 806400/172800/172800.  
Environment: Node v24.14.0; Python/torch unavailable on PATH; GPU not used.

The probe uses causal history only and learns residual dx/dy over `constant_velocity_last2_cap24`. No checkpoints, per-frame CSVs, feature caches, zips, or dependency folders were written.

## Selected gated teachers

| bucket     | teacher               | mean   | p95    | p99    | >5/>10 | advanced/fallback | threshold | scale |
| ---------- | --------------------- | ------ | ------ | ------ | ------ | ----------------- | --------- | ----- |
| strict     | linear_ridge_residual | 11.877 | 38.775 | 77.975 | 0/0    | 43488/129312      | 2.710709  | 0.25  |
| balanced   | linear_ridge_residual | 11.877 | 38.775 | 77.975 | 0/0    | 43488/129312      | 2.710709  | 0.25  |
| aggressive | linear_ridge_residual | 11.877 | 38.775 | 77.975 | 0/0    | 43488/129312      | 2.710709  | 0.25  |

## Raw and strict results

| teacher               | family           | raw mean | raw p95 | raw >5/>10 | strict mean | strict p95 | strict >5/>10 | params | MACs |
| --------------------- | ---------------- | -------- | ------- | ---------- | ----------- | ---------- | ------------- | ------ | ---- |
| linear_ridge_residual | linear_ridge     | 11.046   | 35.325  | 1143/238   | 11.877      | 38.775     | 0/0           | 208    | 206  |
| fsmn_lite_ridge       | FSMN-lite        | 11.067   | 35.425  | 1075/231   | 11.878      | 38.775     | 0/0           | 110    | 150  |
| csfsmn_lite_ridge     | CSFSMN-lite      | 10.971   | 35.075  | 1002/197   | 11.979      | 38.775     | 0/0           | 134    | 186  |
| tcn_small_ridge       | 1D-CNN/TCN-small | 11.305   | 36.425  | 1166/134   | 11.880      | 38.775     | 1/0           | 142    | 420  |
| rfn_rbf_48_ridge      | RFN/RBF-ridge    | 11.009   | 35.175  | 941/165    | 11.896      | 38.725     | 2/0           | 182    | 2196 |
| mlp_small_ridge       | MLP-small        | 11.050   | 35.425  | 1018/212   | 11.896      | 38.775     | 0/0           | 150    | 1492 |
| mlp_medium_ridge      | MLP-medium       | 11.009   | 35.175  | 995/215    | 11.899      | 38.725     | 0/0           | 214    | 2900 |

Best raw teacher: `csfsmn_lite_ridge` (CSFSMN-lite), test mean/p95/p99 10.971 / 35.075 / 72.475 px, >5/>10 1002/197.

## Phase 4 comparison

| bucket     | phase4 mean | phase5 mean | mean delta | phase4 p95 | phase5 p95 | p95 delta | phase4 p99 | phase5 p99 | p99 delta | phase5 >5/>10 |
| ---------- | ----------- | ----------- | ---------- | ---------- | ---------- | --------- | ---------- | ---------- | --------- | ------------- |
| strict     | 11.966      | 11.877      | -0.089     | 38.725     | 38.775     | 0.050     | 77.825     | 77.975     | 0.150     | 0/0           |
| balanced   | 11.941      | 11.877      | -0.063     | 38.575     | 38.775     | 0.200     | 77.575     | 77.975     | 0.400     | 0/0           |
| aggressive | 11.934      | 11.877      | -0.056     | 38.475     | 38.775     | 0.300     | 77.475     | 77.975     | 0.500     | 0/0           |

Negative deltas are improvements. Phase5 improves mean in the selected gated buckets, but p95/p99 move worse than Phase4, so it is not a clean frontier replacement under the same safety framing.

## Product read

FSMN-lite and CSFSMN-lite are the closest CPU-only product shapes: small fixed tap reductions, tiny ridge heads, no recurrent state, and easy SIMD dot products. RFN/RBF is also viable but has random projection cost and less interpretability. The MLP variants are useful as accuracy probes, but the random hidden transforms do not justify productization from this run.

Next step: keep the phase4 strict gate as the product baseline, then run a targeted residual teacher only on rows where the gate already advances, with distillation against LS/blend residuals and an explicit per-bucket no-regression loss.
