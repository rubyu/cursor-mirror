# Product Runtime Telemetry Summary

Input packages: 3.

| variant | controller | updateLayer | tick p95 us | predict p95 us | move p95 us | ULW p95 us | wake-late p95 us | wake-late max us | vblank lead p50 us | message wake avg | fine spin p95 | latest move age p95 us | skipped moves |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| constantvelocity-offset0-50s | 3003 | 2997 | 1053.3 | 6.2 | 1017.9 | 1011.6 | 57 | 9313 | 4000 | 3.468 | 308 | 0 | 0 |
| smoothpredictor-offset0-50s | 3003 | 2964 | 802.8 | 22.3 | 765.5 | 757.3 | 2 | 9997 | 4000 | 3.339 | 296 | 0 | 0 |
| tworegime-smoothpredictor-offset0-50s | 3001 | 3054 | 996.8 | 42.9 | 907.4 | 898.1 | 6 | 7018 | 4000 | 3.474 | 295 | 0 | 0 |
