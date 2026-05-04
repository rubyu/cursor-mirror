# Cursor Prediction POC v20

Goal: validate whether an asymmetric future-lead loss can reduce abrupt-stop overshoot/return before collecting new telemetry.

The core idea is to penalize predictions that pass the future cursor position in the recent movement direction more heavily than predictions that remain behind it.

```text
signed_future_error = dot(predicted_position - future_position, direction)
lead_error = max(0, signed_future_error)
lag_error = max(0, -signed_future_error)
```

The experiment uses existing real 60Hz traces plus v19 MotionLab stress scenarios.
