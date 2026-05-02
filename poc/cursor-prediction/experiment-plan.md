# Cursor Prediction PoC Experiment Plan

## Goal
Cursor Mirror may reduce perceived overlay latency by predicting a short-future cursor position from recent low-level mouse hook samples. The goal of this PoC is to find a model that minimizes prediction error while remaining light enough for per-frame CPU execution in the Cursor Mirror process.

## Operating Rules
- Work is performed under `poc/`.
- Each experiment step uses a directory named `poc/cursor-prediction/step-N short-name/`.
- Each step records:
  - `README.md`
  - `experiment-log.md`
  - `report.md`
  - `scores.json`
  - reproducible scripts
- Scores are stored as JSON.
- Large trace files and captured zip files are not copied into `poc/`.
- The trace source is `cursor-mirror-trace-20260501-000443.zip` at the repository root.
- Normal experiments read trace data only; they do not install a Windows hook.
- CPU-heavy experiments and performance measurements are executed by only one worker at a time.
- Performance timing is treated as approximate because the CPU may be shared with other users and background processes.

## Step Roadmap

### Step 1: Data Audit and Baselines
Purpose:
- Verify trace integrity.
- Measure event interval distribution and idle gaps.
- Establish baseline prediction scores.

Models:
- Hold-current.
- Constant velocity from last two samples.
- Linear regression velocity over recent samples.
- EMA-smoothed velocity.

Outputs:
- Data quality report.
- Error tables by horizon and offset cap.
- Initial recommendation for the next step.

### Step 2: Adaptive Expert Selection
Purpose:
- Use Step 1 results to build a deterministic online selector.
- Select among cheap horizon/model candidates using recent prediction error.

Candidate design:
- Keep a small set of predictors.
- Track exponentially weighted error per candidate.
- Select the current lowest-score candidate.
- Limit maximum prediction offset.

Evaluation:
- Compare against the best fixed Step 1 model.
- Measure switching stability.
- Measure added CPU cost.

### Step 3: Low-Latency Implementation Shape
Purpose:
- Translate the best model into a Cursor Mirror-ready design.
- Minimize memory, allocations, branch complexity, and per-frame cost.

Evaluation:
- Estimate operations per frame.
- Define state struct/class shape.
- Identify tests needed before product integration.

### Step 4: Product Recommendation
Purpose:
- Decide whether predictive positioning should be implemented.
- Define default settings and UI controls if useful.

Possible outcomes:
- Do not implement prediction if hold-current is already optimal.
- Implement fixed horizon velocity prediction.
- Implement adaptive expert selection.
- Collect more traces if the single trace is not representative.

## Primary Score
The primary score is mean Euclidean prediction error in pixels over valid evaluation points.

Secondary scores:
- RMSE.
- p50, p90, p95, p99.
- Maximum error.
- Evaluation sample count.
- Predictions per second or average prediction time.
- Failure/skip count due to idle gaps or insufficient history.

## Product Constraints
- Prediction must not affect click-through, opacity, or cursor image capture.
- Prediction may move only the overlay display position.
- Prediction must have a configurable maximum offset.
- Prediction must be disableable.
- The model must be deterministic under unit test.
- The model must not require external model files.
