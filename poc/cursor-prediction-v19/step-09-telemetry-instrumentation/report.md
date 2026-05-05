# Step 09 Report - Telemetry Instrumentation

Step 09 converted the Step 08 blocker into a bounded capture/tooling change. No predictor behavior was changed.

## What Changed

- Trace packages now emit trace format version 10.
- Runtime scheduler poll rows now expose explicit derived telemetry for cursor-read latency, dispatch latency, queue latency, sample-record latency, duplicate/hold run length, last movement age, cadence gap, missed-cadence flag, and target phase deltas.
- MotionLab Play and Record packages now include `motion-trace-alignment.csv`, aligning each recorded trace row to the generated true cursor position and MotionLab phase at the same elapsed time.
- MotionLab motion sample format version is now 3.

## Why This Addresses the Blocker

Step 08 could not determine whether the abrupt-stop leak was caused by stale latest samples, duplicate/hold samples, missed poll cadence, or target phase crossing the stop boundary because those signals were partly implicit or unavailable in existing captures.

The new trace columns make the runtime scheduler sample stream analyzable without replay-only proxies. The new MotionLab alignment table makes synthetic true position and phase available beside observed trace rows without copying large raw dumps.

## Backward Compatibility

Existing readers should continue to work if they tolerate extra CSV columns. Existing package entries remain in place:

- `trace.csv`
- `metadata.json`
- `motion-script.json`
- `motion-samples.csv`
- `motion-metadata.json` for Play and Record packages

New consumers can branch on `TraceFormatVersion = 10` and `MotionSampleFormatVersion = 3`.

## Tests

Command:

```powershell
.\scripts\test.ps1 -Configuration Debug
```

Result:

- Debug build: passed
- Normal tests: 139 passed, 0 failed

Updated coverage:

- `COT-MLU-20` verifies the derived runtime scheduler telemetry columns and duplicate/hold/cadence values.
- `COT-MNU-6` verifies MotionLab trace packages include `motion-trace-alignment.csv`.
- `COT-MNU-11` verifies MotionLab sample format version 3.

## Adoption Decision

Adopt this as instrumentation only. Do not promote any new predictor rule from v19 yet.

The next required action is to capture new real traces and MotionLab Play and Record traces using this schema, then rerun Step 08-style analysis against the new fields.
