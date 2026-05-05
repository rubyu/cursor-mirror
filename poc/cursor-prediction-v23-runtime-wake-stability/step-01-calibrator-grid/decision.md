# Step 01 - Decision

## Result

The strongest scheduler result came from the product-default model path:

- Variant: `cv-plus2-setex-fine1000`
- Model: `ConstantVelocity`
- Target offset: `+2 ms`
- Scheduler: `SetWaitableTimerEx`, fine wait `1000 us`, yield threshold `250 us`

Compared with the old `lsq-baseline` scheduler run:

| metric | old baseline | selected runtime | change |
| --- | ---: | ---: | ---: |
| wake-late p95 | 801 us | 94 us | better |
| wake-late p99 | 2220 us | 1576 us | better |
| controller tick p95 | 1040.2 us | 974.5 us | slightly better |
| UpdateLayeredWindow p95 | 990.7 us | 923.8 us | slightly better |

The visual Calibrator score still has a nonzero stationary floor and low capture cadence, so it is useful mainly as a regression guard. In that guard, the selected runtime stayed within the same p95 visual band (`12 px`) as the baseline.

## Adopted Runtime Defaults

The product runtime now defaults to:

- Prefer `SetWaitableTimerEx` with zero tolerable delay, falling back to `SetWaitableTimer`.
- Use `1000 us` fine wait before the DWM-aligned target.
- Use `250 us` as the Sleep(0)-to-spin threshold.

The following variants remain Calibrator-only because the first grid did not justify product defaults:

- Deadline-near message deferral.
- MMCSS/thread latency profile promotion.

## Next Follow-Up

If lag remains visible, the next target should be tail reduction rather than p95: repeat the selected runtime under higher background load and inspect scheduler max/p99 outliers together with `UpdateLayeredWindow` spikes.

