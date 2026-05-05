# Product Runtime Telemetry Summary

Input packages: 3.

| variant | controller | updateLayer | tick p95 us | predict p95 us | move p95 us | ULW p95 us | wake-late p95 us | wake-late max us | vblank lead p50 us | message wake avg | fine spin p95 | latest move age p95 us | skipped moves |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| constantvelocity-displayoffset0-50s | 3002 | 3123 | 968.1 | 5.8 | 933.3 | 915.9 | 2 | 13965 | 4000 | 3.407 | 307 | 0 | 0 |
| smoothpredictor-displayoffset0-50s | 3003 | 2950 | 1253.3 | 35 | 1186.7 | 1175.1 | 12 | 17715 | 4000 | 3.399 | 296 | 0 | 0 |
| tworegime-smoothpredictor-displayoffset0-50s | 3002 | 3083 | 1118.8 | 47.8 | 1046.4 | 1029.1 | 6 | 13674 | 4000 | 3.414 | 295 | 0 | 0 |
