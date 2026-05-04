# Step 03: Product Runtime Baseline

This step captures product runtime telemetry from the real product path through Calibrator:

`OverlayRuntimeThread` -> `CursorMirrorController.Tick` -> `OverlayWindow.Move` -> `OverlayWindow.UpdateLayer`

The Calibrator command used for this step writes two packages:

- calibration summary package;
- product runtime outlier telemetry package.

Raw display frames are not saved by the Calibrator package.
