# Step 03 Plan - Teacher Model Search

## Purpose

Before optimizing runtime cost, v24 should learn how much accuracy is theoretically available from higher-capacity models. These models are teachers; they are not product candidates by default.

## Model Families

### Horizon-Conditioned MLP

Input includes the runtime feature vector plus requested horizon. Output is one `dx/dy` pair.

This is the closest extension of the current `SmoothPredictor` and is the first model to train.

### Multi-Head Multi-Horizon MLP

Input is the runtime feature vector. Output contains `dx/dy` for every horizon bucket.

This tests whether shared representation plus multiple labels stabilizes the model and improves target correction robustness.

### FSMN-Like Temporal Model

Use fixed memory blocks over the recent runtime feature sequence, but keep inference CPU-friendly. Candidate families:

- compact FSMN;
- CSFSMN-style compact shifted memory;
- VFSMN-style variable memory only if the runtime shape can be exported predictably.

These are allowed as teacher candidates first. Product adoption requires distillation or a very small exported runtime.

### Ensemble Teacher

Train multiple seeds or related model sizes and average predictions for offline scoring. If the ensemble wins, distill it into a single runtime model instead of shipping the ensemble directly.

### Online Adaptation Candidate

Allowed only as a bounded experiment:

- no unbounded state growth;
- deterministic reset behavior on idle, scenario change, or invalid timestamps;
- stationary jitter and stop overshoot must be protected by hard gates.

## Loss Terms

Use a combined loss rather than a plain row MSE:

- row displacement MSE;
- asymmetric lead-side penalty;
- event peak-lead hinge;
- return-motion proxy for stop windows;
- jitter penalty for static rows;
- normal-motion lag guard with a subpixel tolerance.

v20 showed asymmetric lead loss is useful but unsafe alone. In v24 it should be one term inside a sequence/event-safe objective.

## Training Execution

- GPU may be used for teacher search, but only one GPU runner at a time.
- Save only final selected weights and compact metrics. Do not save frequent checkpoints unless a run is long enough to justify one final recovery checkpoint.
- CPU model evaluation may be parallelized only when it is not a timing measurement.

## Promotion Criteria

A teacher is interesting only if it improves at least one of these without worsening the others:

- target-correction sweep p95/p99;
- abrupt-stop peak lead and return motion;
- stationary jitter;
- held-out normal 60 Hz visual p95/p99.

A runtime candidate must additionally have a clear scalar C# or SIMD execution plan.
