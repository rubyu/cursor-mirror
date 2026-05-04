# Step 8 Instrumentation Telemetry

## Intent

Step 7 showed that the current causal input does not let a product-eligible selector approach the oracle best-of headroom. Step 8 therefore shifts from larger-model search to instrumentation: add fields that make timing, warm-up, scheduler provenance, and hold/resume transitions explicit in newly collected packages.

## Implemented Telemetry

### Trace CSV

Trace packages now use `TraceFormatVersion = 9` and append derived fields to `trace.csv`:

| field | purpose |
| ----- | ------- |
| `warmupSample` | Separates the initial recording window from steady-state samples. |
| `predictionTargetTicks` | Exposes the runtime scheduler target or planned tick used as the prediction-time target. |
| `presentReferenceTicks` | Exposes a DWM/present-side reference tick when available. |
| `schedulerProvenance` | Distinguishes `dwm`, `fallback`, and `missing` scheduler paths. |
| `sampleRecordedToPredictionTargetMicroseconds` | Measures how late or early the recorded sample is relative to the prediction target. |
| `runtimeSchedulerMissing` | Marks runtime scheduler rows with no target/planned timing. |

Trace metadata now includes `WarmupDurationMilliseconds`.

### Motion Samples

Motion Lab sampled output now uses `MotionSampleFormatVersion = 2` and appends transition fields:

| field | purpose |
| ----- | ------- |
| `movementPhase` | Labels generated samples as `moving`, `hold`, or `resume`. |
| `holdIndex` | Identifies the active hold segment when applicable. |
| `phaseElapsedMilliseconds` | Gives causal transition age within the current generated phase. |

These fields are analysis telemetry for generated Motion Lab data. They are not product runtime inputs by themselves, but they let the next POC decide which product-shaped transition features are worth implementing.

## Verification

`scripts\test.ps1 -Configuration Debug` passed after the instrumentation change:

| metric | value |
| ------ | ----- |
| total tests | 133 |
| failed tests | 0 |

New or updated coverage:

- `COT-MLU-20`: verifies trace derived telemetry fields and warm-up metadata.
- `COT-MNU-10`: verifies hold/resume phase telemetry in the sampler.
- `COT-MNU-11`: verifies Motion Lab sampled CSV transition telemetry and motion sample format metadata.

## Next Dataset

The next data collection should use the rebuilt Motion Lab package and produce at least:

- one normal-load `Play and Record` package;
- one stress-load `Play and Record` package with the same stress settings as the previous 90% / 32-thread run;
- enough scenarios to keep the scenario-level 70/15/15 train/validation/test split.

Step 9 should rerun the Step 3-7 evaluation using the new fields, with special attention to whether transition age and prediction target timing reduce resume-tail ambiguity.
