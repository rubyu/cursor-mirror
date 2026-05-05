# Step 02 Report - Central Bucket Diagnostics

## Summary

Step 01 showed that the hard region is the central target-correction bucket range around `-8..+8ms`. This diagnostic searches simple deployable combinations of the two constant-velocity windows before spending more time on larger learned models.

## Best Overall

| candidate | visual p95 | visual p99 | stop lead p99 | jitter p95 | central visual p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| switch_highspeed_cv2_threshold500_static_guard | 1.571674 | 3.889550 | 0.913356 | 0.000000 | 2.656305 |
| switch_speed500_horizon6_cv2_static_guard | 1.581390 | 4.136852 | 0.928416 | 0.000000 | 2.802462 |
| switch_speed500_horizon8_cv2_static_guard | 1.601000 | 4.540720 | 0.938386 | 0.000000 | 3.184021 |
| switch_speed500_horizon10_cv2_static_guard | 1.601000 | 4.540720 | 0.938386 | 0.000000 | 3.184021 |
| choose_max_norm_static_guard | 1.622917 | 4.229923 | 1.282417 | 0.000000 | 2.780014 |
| switch_highspeed_cv2_threshold1000_static_guard | 1.638818 | 5.014724 | 0.957506 | 0.000000 | 3.508754 |
| blend_cv2_0.40_cv12_0.60_static_guard | 1.649817 | 4.779886 | 1.062584 | 0.000000 | 3.237431 |
| blend_cv2_0.50_cv12_0.50_static_guard | 1.651915 | 4.505232 | 1.059077 | 0.000000 | 3.023182 |
| blend_cv2_0.45_cv12_0.55_static_guard | 1.652410 | 4.722576 | 1.066271 | 0.000000 | 3.173814 |
| switch_highspeed_cv2_threshold250_static_guard | 1.654186 | 3.659000 | 0.892619 | 0.000000 | 2.447384 |
| switch_speed1000_horizon6_cv2_static_guard | 1.657070 | 5.174619 | 0.974541 | 0.000000 | 3.614233 |
| switch_highspeed_cv2_threshold1500_static_guard | 1.658247 | 5.512858 | 0.982699 | 0.000000 | 3.677761 |

## Best Central Bucket

| candidate | central visual p95 | central visual p99 | central stop lead p99 | overall visual p95 |
| --- | ---: | ---: | ---: | ---: |
| cv2_static_guard | 2.395489 | 6.391241 | 1.703025 | 1.696106 |
| blend_cv2_1.00_cv12_0.00_static_guard | 2.395489 | 6.391241 | 1.703025 | 1.696106 |
| cv2_cap48_static_guard | 2.395489 | 6.391241 | 1.703025 | 1.696106 |
| cv2_cap24_static_guard | 2.402801 | 6.633274 | 1.703025 | 1.696119 |
| cv2_cap16_static_guard | 2.402801 | 6.837841 | 1.703025 | 1.696106 |
| cv2_cap12_static_guard | 2.410064 | 7.967192 | 1.703025 | 1.698171 |
| blend_cv2_0.95_cv12_0.05_static_guard | 2.411927 | 6.764880 | 1.726349 | 1.682414 |
| blend_cv2_0.90_cv12_0.10_static_guard | 2.439600 | 6.983336 | 1.687185 | 1.669370 |
| switch_highspeed_cv2_threshold250_static_guard | 2.447384 | 6.433358 | 1.574100 | 1.654186 |
| cv2_cap8_static_guard | 2.455188 | 9.729333 | 1.703025 | 1.705938 |
| blend_cv2_0.85_cv12_0.15_static_guard | 2.457192 | 7.266926 | 1.707586 | 1.669370 |
| blend_cv2_0.80_cv12_0.20_static_guard | 2.502986 | 7.567363 | 1.748612 | 1.673733 |

## Decision

If simple CV-window composition improves the central buckets, the product path should favor an explicit deterministic predictor before adding a larger MLP. If it does not, the next learned-model run needs central-bucket weighting and a sequence-level stop/overshoot loss.
