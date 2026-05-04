# Step 09 Notes - Telemetry Instrumentation

Date: 2026-05-04

Purpose: implement the data-capture path needed after Step 08 showed that the current runtime-observable signals were insufficient to explain the remaining abrupt-stop overshoot/return leak.

## Existing Coverage Found

- Observed product poll position already exists in `trace.csv` as `poll` rows with `cursorX/cursorY`.
- Reference/high-precision poll position already exists as `referencePoll` rows.
- Runtime-scheduler observed position already exists as `runtimeSchedulerPoll` rows captured on the dedicated scheduler capture thread.
- Runtime-scheduler tick fields already include queued, dispatch-started, cursor-read-started, cursor-read-completed, and sample-recorded ticks.
- DWM target timing already exists as `runtimeSchedulerTargetVBlankTicks`, `runtimeSchedulerPlannedTickTicks`, `runtimeSchedulerVBlankLeadMicroseconds`, and DWM timing fields.
- MotionLab already writes generated truth to `motion-samples.csv`, including scenario index for scenario-set packages and phase/hold telemetry.

## Gaps Before This Step

- Duplicate/hold run length was only derivable offline and not exposed as a first-class trace column.
- Last movement age, cadence gap, missed-cadence flag, read latency, and target phase deltas were not emitted as explicit package columns.
- MotionLab Play and Record packages contained `motion-samples.csv` and `trace.csv`, but did not include a compact row-level alignment table between recorded trace rows and generated true cursor position/phase.

## Implemented Changes

- Added trace format version 10 derived runtime scheduler fields in `MouseTracePackageWriter`.
- Added `motion-trace-alignment.csv` to MotionLab packages that include a trace snapshot.
- Updated MotionLab motion sample format version to 3.
- Updated specs 11 and 14.
- Added/updated tests for the new trace fields and MotionLab alignment package entry.

## New Trace Fields

- `runtimeSchedulerCursorReadLatencyMicroseconds`
- `runtimeSchedulerDispatchToReadStartedMicroseconds`
- `runtimeSchedulerQueueToDispatchMicroseconds`
- `runtimeSchedulerReadCompletedToSampleRecordedMicroseconds`
- `runtimeSchedulerDuplicateHoldRunLength`
- `runtimeSchedulerLastMovementAgeMicroseconds`
- `runtimeSchedulerPollCadenceGapMicroseconds`
- `runtimeSchedulerMissedCadence`
- `runtimeSchedulerSampleToTargetMicroseconds`
- `runtimeSchedulerReadCompletedToTargetMicroseconds`

## MotionLab Alignment

New Play and Record packages include:

- `motion-trace-alignment.csv`

Columns:

- `traceSequence`
- `traceEvent`
- `traceElapsedMicroseconds`
- `generatedElapsedMilliseconds`
- `scenarioIndex`
- `scenarioElapsedMilliseconds`
- `progress`
- `generatedX`
- `generatedY`
- `velocityPixelsPerSecond`
- `movementPhase`
- `holdIndex`
- `phaseElapsedMilliseconds`

## Verification

- Ran `.\scripts\test.ps1 -Configuration Debug`.
- Result: Debug build succeeded and 139 tests passed.

## Remaining Need

A new real TraceTool/MotionLab Play and Record capture is required. Existing ZIPs cannot contain these new explicit columns or the MotionLab trace-alignment table.
