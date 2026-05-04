# Cursor Prediction v10 Phase 2 Regression Anatomy

Generated: 2026-05-03T08:12:55.220Z

Raw candidate analyzed: `least_squares_w50_cap36` against `constant_velocity_last2_cap24`.

## Where Regressions Concentrate

| dimension | bucket | rows | >5px | >5 rate | >10px | mean delta |
| --- | --- | --- | --- | --- | --- | --- |
| speed | 500-1000 | 949968 | 113761 | 0.1198 | 49552 | -3.469 |
| speed | >=2000 | 230880 | 27197 | 0.1178 | 14837 | -10.007 |
| speed | 1000-2000 | 697764 | 75077 | 0.1076 | 33570 | -8.390 |
| speed | 250-500 | 794808 | 58114 | 0.0731 | 16843 | -1.323 |
| speed | 100-250 | 601296 | 13818 | 0.0230 | 3040 | -0.486 |
| speed | 25-100 | 425712 | 1860 | 0.0044 | 379 | -0.128 |
| horizon | 8.33 | 960000 | 86832 | 0.0905 | 32100 | -0.848 |
| horizon | 16.67 | 960000 | 77675 | 0.0809 | 31876 | -2.963 |
| horizon | 25 | 960000 | 66748 | 0.0695 | 28403 | -4.206 |
| horizon | 33.33 | 960000 | 58710 | 0.0612 | 25882 | -5.382 |
| missing | clean | 1280000 | 106326 | 0.0831 | 45387 | -3.670 |
| missing | missing_10pct | 1280000 | 96613 | 0.0755 | 39182 | -3.355 |
| missing | missing_25pct | 1280000 | 87026 | 0.0680 | 33692 | -3.024 |
| tag | jitter | 1610496 | 210874 | 0.1309 | 83576 | -7.801 |
| tag | high_speed | 2836992 | 248033 | 0.0874 | 107279 | -3.545 |
| tag | loop_or_reversal | 1169280 | 93601 | 0.0800 | 38182 | -3.319 |
| tag | acute_acceleration | 2368128 | 187434 | 0.0791 | 76260 | -3.246 |
| tag | edge_proximity | 2025600 | 159169 | 0.0786 | 66725 | -3.416 |
| tag | endpoint_stress | 978432 | 75634 | 0.0773 | 30052 | -3.291 |
| edge | >=64 | 3420360 | 262891 | 0.0769 | 107512 | -3.366 |
| edge | 8-24 | 87744 | 6184 | 0.0705 | 2649 | -3.313 |
| edge | 0-8 | 23748 | 1590 | 0.0670 | 527 | -4.302 |
| edge | 24-64 | 308148 | 19300 | 0.0626 | 7573 | -3.108 |
| curvature | 10-30 | 303976 | 67616 | 0.2224 | 26187 | -2.898 |
| curvature | 30-60 | 291060 | 49272 | 0.1693 | 19212 | -5.565 |
| curvature | >=60 | 818228 | 59977 | 0.0733 | 25746 | -11.405 |
| curvature | 0-10 | 2426736 | 113100 | 0.0466 | 47116 | -0.425 |
| accel | 8000-20000 | 265476 | 54154 | 0.2040 | 11013 | 0.395 |
| accel | >=20000 | 1498160 | 223085 | 0.1489 | 104550 | -8.282 |
| accel | 2000-8000 | 342124 | 10576 | 0.0309 | 2188 | -0.414 |
| accel | 0-2000 | 1734240 | 2150 | 0.0012 | 510 | -0.241 |
| history | >=13 | 3589740 | 275856 | 0.0768 | 112994 | -3.423 |
| history | 6-12 | 248220 | 14058 | 0.0566 | 5238 | -2.307 |
| history | 3-5 | 1912 | 51 | 0.0267 | 29 | -0.674 |
| history | 1-2 | 128 | 0 | 0.0000 | 0 | 0.017 |

## Better Regions

| tag | rows | >3px improvements | >3 rate | mean delta |
| --- | --- | --- | --- | --- |
| jitter | 1610496 | 994178 | 0.6173 | -7.801 |
| high_speed | 2836992 | 896151 | 0.3159 | -3.545 |
| edge_proximity | 2025600 | 620018 | 0.3061 | -3.416 |
| loop_or_reversal | 1169280 | 357809 | 0.3060 | -3.319 |
| acute_acceleration | 2368128 | 708177 | 0.2990 | -3.246 |
| near_stop | 1888512 | 564367 | 0.2988 | -3.390 |

The raw model is strongest in smooth, high-speed spans where recent motion remains coherent. Regressions cluster when recent samples imply sharp acceleration or curvature, sparse/missing history, and edge-clamped motion. Those are exactly the conditions used by the safe gates to fall back to the current baseline.
