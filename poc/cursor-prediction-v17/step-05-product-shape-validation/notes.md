# Step 05 Notes

- CPU-only fixed inference and lightweight aggregation.
- No product source files were edited.
- Product code read:
  - `src/CursorMirror.Core/DwmAwareCursorPositionPredictor.cs`
  - `src/CursorMirror.Core/DistilledMlpPredictionModel.g.cs`
  - `src/CursorMirror.Core/CursorMirrorSettings.cs`
  - `tests/CursorMirror.Tests/ControllerTests.cs`
- Product-like candidates include current lag0.5, lag0, lag0.0625, lag0.125, plus two light product-safe diagnostics.
- Full C# state-machine replay is still pending; this step uses the existing 60Hz POC row construction and mirrors product-side post-processing.
