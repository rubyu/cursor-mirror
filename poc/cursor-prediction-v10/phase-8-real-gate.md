# Cursor Prediction v10 Phase 8 Real Gate

Generated: 2026-05-03T09:38:00.201Z

Input ZIPs: `cursor-mirror-trace-20260502-184947.zip`, `cursor-mirror-trace-20260502-175951.zip`, `cursor-mirror-trace-20260502-173150.zip`, `cursor-mirror-trace-20260502-165358.zip`, `cursor-mirror-trace-20260502-163258.zip`, `cursor-mirror-trace-20260502-161143.zip`. GPU used: no. Dependencies: Node.js standard library only. ZIPs were read in place; no extraction, raw CSV copy, per-frame CSV, cache, checkpoint, or node_modules output was written.

## Sessions

| session | zip | reference polls | anchors | rows | quality warnings |
| --- | --- | --- | --- | --- | --- |
| session_1 | cursor-mirror-trace-20260502-184947.zip | 97907 | 11911 | 47636 | product_poll_interval_p95_exceeds_requested_interval |
| session_2 | cursor-mirror-trace-20260502-175951.zip | 122812 | 15829 | 63309 | product_poll_interval_p95_exceeds_requested_interval |
| session_3 | cursor-mirror-trace-20260502-173150.zip | 133611 | 0 | 0 | product_poll_interval_p95_exceeds_requested_interval |
| session_4 | cursor-mirror-trace-20260502-165358.zip | 141143 | 0 | 0 | product_poll_interval_p95_exceeds_requested_interval |
| session_5 | cursor-mirror-trace-20260502-163258.zip | 88345 | 0 | 0 | product_poll_interval_p95_exceeds_requested_interval |
| session_6 | cursor-mirror-trace-20260502-161143.zip | 144258 | 0 | 0 | product_poll_interval_p95_exceeds_requested_interval |

## Cross-session Real Gate

| split | train/val/test rows | selected gate | family | candidate | test mean | test p95 | test p99 | test >5/>10 | test mean delta | advanced/fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cursor-mirror-trace-20260502-184947.zip_to_cursor-mirror-trace-20260502-175951.zip | 33345/14291/63309 | real_tree_blend_cv_ls_w50_cap36_ls0p25_1 | tree | blend_cv_ls_w50_cap36_ls0p25 | 9.876 | 43.875 | 161.025 | 0/0 | -0.189 | 16769/46540 |
| cursor-mirror-trace-20260502-175951.zip_to_cursor-mirror-trace-20260502-184947.zip | 44316/18993/47636 | real_tree_blend_cv_ls_w50_cap36_ls0p25_1 | tree | blend_cv_ls_w50_cap36_ls0p25 | 26.343 | 127.575 | 291.075 | 0/0 | -0.190 | 14175/33461 |

Selected aggregate: mean/p95/p99 16.946 / 83.625 / 239.725 px; regressions >5/>10 0/0; mean delta -0.190 px; advanced/fallback 30944/80001.

## Chronological Split

Rows train/validation/test: 77661/16642/16642. Selected `real_tree_blend_cv_ls_w50_cap36_ls0p25_1` (tree, candidate blend_cv_ls_w50_cap36_ls0p25) with test mean/p95/p99 30.377 / 140.275 / 277.725 px, >5/>10 0/0, mean delta -0.167 px.

## Judgment

Recommendation: `proceed_to_calibrator_with_real_gate_as_safety_anchor`.
