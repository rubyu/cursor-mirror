## 14. Motion Lab and Load Generation

### Purpose

- Motion Lab exists to generate large, repeatable cursor-motion datasets for prediction-model research.
- Motion Lab MUST remain separate from the trace tool and calibrator so those tools keep their narrow purposes:
  - Trace Tool records real human input.
  - Calibrator measures rendered cursor alignment.
  - Motion Lab generates synthetic motion scripts and controlled stress conditions.
- Motion Lab output SHOULD be consumable by POC scripts, the calibrator, and future model-training tools.

### Motion Generation

- Motion Lab MUST be built as `CursorMirror.MotionLab.exe`.
- Motion Lab SHOULD be included in development and release packages while prediction research is active.
- Motion Lab SHOULD generate compact motion scripts rather than only precomputed per-frame data.
- A generated motion script MAY contain a single scenario or a scenario set.
- A generated scenario set MUST include:
  - schema version;
  - seed;
  - generation profile;
  - total duration;
  - scenario duration;
  - playback sample rate;
  - one or more scenarios.
- A generated motion scenario MUST include:
  - schema version;
  - seed;
  - bounds;
  - start point;
  - end point;
  - two to sixteen Bezier control points;
  - duration;
  - speed profile points;
  - optional hold segments;
  - sample-rate metadata for optional sampled exports.
- Generated control points MUST be clipped into the requested recording bounds.
- The first control point SHOULD be the current cursor position clipped into the recording bounds.
- The end point SHOULD be selected before intermediate control points so the whole curve is generated with known start and end constraints.
- Motion sampling MUST be deterministic for the same script.
- The sampler SHOULD support variable-speed motion by mapping elapsed time to curve progress through the speed profile rather than by assuming constant parameter velocity.
- Scenario-set sampling MUST evaluate the active scenario from the current elapsed time and MUST NOT require precomputing all playback frames.
- Scenario-set playback SHOULD chain each scenario start to the previous scenario end to avoid artificial jumps between scenarios.
- Motion Lab UI MUST treat `Scenarios` as the scenario count and `Scenario duration` as the per-scenario duration, with total duration shown as a derived read-only value.
- Motion Lab SHOULD allow fixed-seed generation for reproducibility and non-fixed seed generation for broad dataset capture.
- Scenario seeds MUST be derived by an independent seed-splitting algorithm rather than by adding a constant stride to the root seed.
- Speed profile points SHOULD include:
  - curve progress;
  - speed multiplier;
  - easing mode;
  - easing width.
- Hold segments SHOULD include:
  - curve progress;
  - hold duration;
  - resume easing duration.
- Hold segments MUST pause curve progress without changing the Bezier path.
- During a hold segment, sampled output MUST keep the same cursor position and MUST report zero velocity.
- After a hold segment, sampled output SHOULD ease back into motion when a resume easing duration is present.
- Sampled output SHOULD report movement-phase telemetry, including `moving`, `hold`, and `resume`.
- Sampled output SHOULD report the active hold index and phase elapsed time when hold or resume telemetry applies.
- Motion Lab MAY export sampled CSV rows for quick inspection, but the compact motion script is the canonical dataset description.
- Motion Lab MUST provide at least two generation profiles:
  - `balanced`, which preserves broad synthetic coverage for exploratory model search.
  - `real-trace-weighted`, which biases generated motion toward observed real-trace characteristics.
- The `real-trace-weighted` profile SHOULD increase near-stationary and very-low-speed coverage because recent real traces showed roughly 87.9% of samples in the 0-25 px/s range.
- The `real-trace-weighted` profile SHOULD generate explicit hold segments so synthetic data includes stopped-cursor history, not only slow continuous motion.
- The `real-trace-weighted` profile SHOULD keep history density closer to real traces and SHOULD NOT overrepresent missing-history conditions.
- The `real-trace-weighted` profile SHOULD use smoother curvature and acceleration distributions than the earlier synthetic phase-2 generator, with only occasional higher-speed or higher-acceleration segments.

### Play and Record

- Motion Lab real cursor playback MUST be exposed as `Play and Record`.
- `Play and Record` MUST move the real Windows cursor and record the resulting trace in the same run.
- `Play and Record` MUST move the real Windows cursor through the shared `RealCursorDriver` SendInput path, not by calling `SetCursorPos`.
- Motion Lab injected cursor movement MUST use a Motion Lab-specific marker so trace analysis can distinguish generated input from user input.
- During `Play and Record`, Motion Lab MUST block user mouse input with a low-level mouse hook so external movement, button, and wheel input do not contaminate generated datasets.
- The input blocker MUST allow Motion Lab-generated mouse input identified by the Motion Lab injection marker.
- The input blocker MUST be active only while `Play and Record` is running and MUST be removed when recording stops, completes, fails, or the application exits.
- Motion Lab SHOULD provide a keyboard stop path such as `Esc` while mouse input is blocked.
- `Play and Record` cursor movement MUST be driven by a dedicated playback thread or equivalent scheduler, not by a WinForms UI timer.
- The playback scheduler SHOULD use the script playback sample rate and high-resolution waits where available.
- `Play and Record` MUST NOT require or expose a separate "record while playing" checkbox while this is the only supported real-playback mode.
- Motion preview MAY remain available as a non-recording preview, but preview MUST NOT move the real Windows cursor.
- Before `Play and Record` starts moving the cursor, Motion Lab SHOULD ask for the output `.zip` path so the recorded package can be written as soon as playback ends or is stopped.
- A `Play and Record` package MUST contain:
  - `motion-script.json`;
  - `motion-samples.csv`;
  - `trace.csv`;
  - `motion-trace-alignment.csv`;
  - trace-compatible `metadata.json`;
  - `motion-metadata.json`.
- The trace-compatible `metadata.json` MUST use the same schema as Trace Tool packages so existing POC scripts can analyze Motion Lab output without a special parser.
- `motion-metadata.json` MUST contain Motion Lab-specific fields such as seed, generation profile, bounds, control-point count, speed-point count, hold count, hold duration, duration, and sample-rate metadata.
- Motion Lab metadata SHOULD include a motion sample format version.
- `motion-samples.csv` for scenario-set packages MUST include scenario index and scenario-local elapsed time.
- `motion-samples.csv` SHOULD include movement phase, active hold index, and phase elapsed time so prediction POCs can distinguish hold/resume transitions without reconstructing the script.
- `motion-trace-alignment.csv` SHOULD align each recorded trace row to the generated Motion Lab sample at the same elapsed time and SHOULD include generated target position, scenario index, scenario-local elapsed time, movement phase, active hold index, and phase elapsed time.
- Script-only save MAY remain available for lightweight review and MUST NOT move the real Windows cursor.

### Load Generation

- CPU-load simulation MUST be provided by a separate process, not by the main product process.
- The load generator MUST be built as `CursorMirror.LoadGen.exe`.
- Load generation SHOULD support:
  - duration;
  - worker count;
  - approximate load percentage;
  - optional burst and idle intervals.
- Load generator runs MUST be explicitly requested by the user or by command-line arguments.
- Motion Lab MAY start and stop the load generator as a child process for controlled dataset capture.

### Product Runtime Constraints

- Cursor Mirror MUST NOT require GPU inference in the installed product.
- Cursor Mirror MUST NOT require a machine-learning runtime in the installed product.
- Prediction models promoted to the product MUST have a CPU-only inference path.
- CPU-only acceleration MAY use scalar loops or managed SIMD.

### Packaging

- Development packages SHOULD include:
  - `CursorMirror.MotionLab.exe`;
  - `CursorMirror.LoadGen.exe`.
- Release packages MAY include these tools while the prediction system remains experimental.
- Diagnostic packages created by Motion Lab MUST be `.zip` packages and SHOULD contain:
  - `motion-script.json`;
  - `motion-samples.csv`;
  - `metadata.json`.
- `Play and Record` packages created by Motion Lab MUST additionally contain `trace.csv` and MUST reserve `metadata.json` for trace-compatible metadata.
- `Play and Record` packages created by Motion Lab MUST additionally contain `motion-trace-alignment.csv` for generated-target and trace-row alignment.
- `Play and Record` packages MUST store Motion Lab-specific metadata as `motion-metadata.json`.

### Testing

- Unit tests MUST cover deterministic Bezier script generation, bounds clipping, deterministic sampling, speed-profile influence, hold-segment pause behavior, motion-sample transition telemetry, Play and Record input blocking, and package readability.
- Unit tests MUST NOT require actual mouse movement, real CPU stress, real AVX-512 execution, or Windows Graphics Capture.
- Manual validation SHOULD cover Motion Lab GUI startup, script generation, script-only save flow, `Play and Record` save flow, and optional load generator launch.
