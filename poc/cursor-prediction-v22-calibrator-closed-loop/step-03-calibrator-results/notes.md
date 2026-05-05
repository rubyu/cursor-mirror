# Notes

- The first grid accidentally launched all Calibrator variants in parallel because `CursorMirror.Calibrator.exe` is built as `winexe` and PowerShell returned immediately. Those processes were stopped and the runner was fixed to use `Start-Process -Wait`.
- The completed grid ran variants sequentially against `lab-data/calibrator-verification-v22.zip`.
- Existing root capture packages were not used.
- The current visual metric still has a 12px hold/stationary floor.
- The capture cadence from Windows Graphics Capture was around 44ms p50 for each package, so sub-frame timing differences are not reliable from this pass.
- Product runtime telemetry shows prediction inference is not the dominant cost; overlay move/update dominates controller tick duration.
