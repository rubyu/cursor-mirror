# Cursor Prediction v4

v4 repeats the prediction PoC using the first trace that contains both:

- product-equivalent `poll` samples;
- high-precision `referencePoll` samples.

The main change from v3 is label construction. v3 used the recorded stream to interpolate future target positions. v4 treats `referencePoll` as the higher-resolution reference stream and treats product-equivalent `poll` as the runtime input proxy.

## Input Trace

- `../../cursor-mirror-trace-20260501-195819.zip`

## Baseline

The baseline remains the current product model:

- anchor: product-equivalent `poll`;
- target time: DWM next-vblank when valid;
- ground truth: interpolated `referencePoll` position at target time;
- predictor: last2 velocity over product-equivalent `poll`;
- gain: `0.75`;
- fallback: hold/current poll position when timing is invalid.

## Success Criteria

A candidate is interesting only if it improves high-risk visual error without making low-speed or near-zero baseline-error cases visibly worse.

Report:

- overall mean/p50/p90/p95/p99/max;
- speed and acceleration slices;
- poll interval and DWM horizon slices;
- hook/poll disagreement slices;
- referencePoll coverage and interval quality;
- regression counts versus the baseline.

## Phase Rules

- Work under `poc/cursor-prediction-v4/`.
- Each phase gets a `phase-N short-name/` folder.
- Each phase writes `report.md`, `experiment-log.md`, `scores.json`, and reproducible scripts/configs.
- Real Windows hooks must not be installed or exercised by PoC scripts.
- The root trace zip is read-only input.

