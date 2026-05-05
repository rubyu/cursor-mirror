# Step 01 Report - Gated Stop-Safe Blend

## Summary

This step tests a two-regime predictor: a normal-tracking predictor is blended with a stop-safe predictor using either a rule gate or a learned oracle-approximation gate.

## Dataset

- train sequences: 260
- validation sequences: 80
- test sequences: 100
- feature rows: 322880

## Best Test Candidates By Sequence Visual Error

| candidate | sequence visual p95 | overshoot max p95 | overshoot duration p95 ms | jitter p95 | safe ratio | row visual p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal_direct_sequence_stop_h64 | 36.990163 | 11.694030 | 249.639027 | 1.650574 | 0.000000 | 14.036125 |
| learned_gate_normal_to_smooth_hard0.65 | 36.990163 | 11.694030 | 149.922150 | 1.045002 | 0.209507 | 14.540090 |
| learned_gate_normal_to_safe_hard0.65 | 36.990163 | 11.694030 | 249.639027 | 1.523787 | 0.154397 | 13.971665 |
| rule_gate_normal_to_smooth_conservative | 37.011819 | 10.711499 | 133.542335 | 1.025108 | 0.125592 | 14.068785 |
| rule_gate_normal_to_smooth_aggressive | 37.065958 | 9.104569 | 133.434998 | 0.806114 | 0.222987 | 14.207114 |
| learned_gate_normal_to_safe_hard0.5 | 37.242837 | 11.694030 | 249.639027 | 1.523787 | 0.255042 | 13.962571 |
| learned_gate_normal_to_smooth_soft | 37.782334 | 10.142728 | 50.508340 | 0.737601 | 0.345300 | 14.761067 |
| learned_gate_normal_to_safe_soft | 37.974322 | 11.182281 | 249.639027 | 1.501298 | 0.485199 | 13.956815 |
| safe_direct_sequence_stop_h64 | 38.183696 | 10.314976 | 249.639027 | 1.480676 | 1.000000 | 14.088082 |
| learned_gate_normal_to_safe_hard0.35 | 38.183696 | 10.314976 | 249.639027 | 1.480676 | 0.809302 | 13.932429 |
| learned_gate_normal_to_smooth_hard0.35 | 42.368085 | 11.694030 | 132.922994 | 0.818744 | 0.287941 | 15.653277 |
| learned_gate_normal_to_smooth_hard0.5 | 42.368085 | 11.694030 | 132.922994 | 0.818744 | 0.245768 | 14.945396 |

## Best Test Candidates By Overshoot

| candidate | overshoot max p95 | sequence visual p95 | overshoot duration p95 ms | jitter p95 | safe ratio | row visual p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current_smooth_predictor | 0.616060 | 44.859180 | 0.000000 | 0.818744 | 1.000000 | 31.828337 |
| rule_gate_normal_to_smooth_aggressive | 9.104569 | 37.065958 | 133.434998 | 0.806114 | 0.222987 | 14.207114 |
| learned_gate_normal_to_smooth_soft | 10.142728 | 37.782334 | 50.508340 | 0.737601 | 0.345300 | 14.761067 |
| safe_direct_sequence_stop_h64 | 10.314976 | 38.183696 | 249.639027 | 1.480676 | 1.000000 | 14.088082 |
| learned_gate_normal_to_safe_hard0.35 | 10.314976 | 38.183696 | 249.639027 | 1.480676 | 0.809302 | 13.932429 |
| rule_gate_normal_to_smooth_conservative | 10.711499 | 37.011819 | 133.542335 | 1.025108 | 0.125592 | 14.068785 |
| learned_gate_normal_to_safe_soft | 11.182281 | 37.974322 | 249.639027 | 1.501298 | 0.485199 | 13.956815 |
| normal_direct_sequence_stop_h64 | 11.694030 | 36.990163 | 249.639027 | 1.650574 | 0.000000 | 14.036125 |
| learned_gate_normal_to_smooth_hard0.65 | 11.694030 | 36.990163 | 149.922150 | 1.045002 | 0.209507 | 14.540090 |
| learned_gate_normal_to_safe_hard0.65 | 11.694030 | 36.990163 | 249.639027 | 1.523787 | 0.154397 | 13.971665 |
| learned_gate_normal_to_safe_hard0.5 | 11.694030 | 37.242837 | 249.639027 | 1.523787 | 0.255042 | 13.962571 |
| learned_gate_normal_to_smooth_hard0.35 | 11.694030 | 42.368085 | 132.922994 | 0.818744 | 0.287941 | 15.653277 |

## Interpretation

The important sign is whether a gated blend can reduce overshoot without moving all normal rows into the conservative stop-safe regime. A high safe ratio with poor visual p95 means the gate has collapsed into SmoothPredictor-like behavior.
