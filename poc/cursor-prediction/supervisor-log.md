# Supervisor Log

## Step 1 Review
Step 1 used `cursor-mirror-trace-20260501-000443.zip` and evaluated baseline predictors over short horizons. The trace contained 15,214 movement samples over about 500 seconds. The sampling distribution had a p50 interval near 8ms and p90 near 16ms, with many idle gaps. A 100ms idle-gap threshold was used to avoid evaluating across long pauses.

The strongest result was simple: `constant-velocity-last2` with no offset cap won every non-zero horizon on the latter 30% test split. Fixed offset caps worsened mean and tail errors, likely because they clipped legitimate fast movement. EMA and regression smoothing lagged behind last2.

Important Step 1 test-split scores for `constant-velocity-last2`, cap none:

| horizon ms | mean px | p95 px | p99 px |
|---:|---:|---:|---:|
| 4 | 1.698 | 6.472 | 12.892 |
| 8 | 3.367 | 12.602 | 25.549 |
| 12 | 5.481 | 22.410 | 43.655 |
| 16 | 7.809 | 31.851 | 62.940 |
| 24 | 14.038 | 58.578 | 111.837 |
| 32 | 21.698 | 91.212 | 175.096 |
| 48 | 40.789 | 173.675 | 334.807 |

Product intuition after Step 1:
- Prediction is probably useful at 8-16ms horizons.
- 24ms and above may need tail guards, but fixed caps are not the right guard.
- A product implementation should prefer O(1), allocation-free predictors.
- More complex adaptive selection must beat last2 by a meaningful margin to justify complexity.

## Step 2 Plan
Step 2 tests refinements around the Step 1 winner:

- last2 gain/damping grid;
- constant acceleration last3;
- last2/EMA velocity blends;
- online expert selection without future leakage.

Decision threshold:
- If a refinement improves mean by less than about 2% or worsens p95/p99, prefer `constant-velocity-last2`.
- If online expert selection improves only some horizons but adds meaningful state and delayed score bookkeeping, prefer fixed last2 unless the target product horizon benefits clearly.
- Tail behavior matters. A model with lower mean but worse p99 is not preferred for the visible cursor overlay.

## Step 2 Review
Step 2 confirmed that most extra intelligence is not paying for itself yet. The strongest fixed family is still based on `constant-velocity-last2`. Damping the velocity by a fixed gain helps mean error at longer horizons, but it does not dominate the baseline across p95/p99/max.

Best test-split rows by horizon:

| horizon ms | selected model | mean px | p95 px | p99 px | supervisory read |
|---:|---|---:|---:|---:|---|
| 4 | last3 acceleration, accel cap 4px | 1.697 | 6.319 | 12.650 | Too small a gain over last2 to justify an extra sample dependency. |
| 8 | last2 gain 1.0 | 3.367 | 12.602 | 25.549 | Keep baseline. This is likely the product sweet spot. |
| 12 | last2 gain 0.875 | 5.412 | 22.957 | 44.331 | Mean improves, but p95/p99 regress slightly. Optional only. |
| 16 | last2 gain 0.875 | 7.639 | 32.268 | 61.856 | Mean and p99 improve, p95 worsens slightly. Optional only. |
| 24 | last2 gain 0.875 | 13.392 | 57.456 | 115.193 | Mean/p95 improve, p99 worsens. Needs caution. |
| 32 | last2 gain 0.875 | 20.388 | 89.459 | 175.338 | Mean/p95 improve, p99 is flat-to-worse. Needs caution. |
| 48 | last2 gain 0.75 | 36.884 | 166.869 | 336.313 | Long horizon remains visually risky. |

The online expert selector is rejected for now. It was implemented without future leakage, but EWMA error cannot anticipate a stop, turn, or speed change. It sometimes selected the recently good expert just before the regime changed, raising p99 and max error. That failure mode matters more for a cursor overlay than a small mean improvement would.

Implementation direction after Step 2:

- Default model: `constant-velocity-last2`, gain 1.0.
- Product horizon target: start at one frame ahead, roughly 8-16ms depending on display timing.
- Optional advanced setting: horizon-dependent damping, disabled by default until more traces prove it is stable.
- Safety rule: reset the predictor across idle gaps and invalid intervals; avoid hard low caps that clip legitimate fast motion.
- Next step: design an allocation-free predictor shape that can run every render tick and can be tested without installing a real Windows hook.

## Step 3 Review
Step 3 translated the selected model into a product implementation shape. The proposed predictor keeps only the latest position, timestamp, and latest velocity. It is deterministic and can be tested with synthetic samples without installing a real `WH_MOUSE_LL` hook.

The lightweight synthetic benchmark ran 2,000,000 update+predict iterations in 43.2596ms, about 21.63ns per update+predict. This is noisy and not a product benchmark, but it confirms the predictor is much smaller than the UI, capture, and window movement costs.

Accepted Step 3 conclusions:

- `constant-velocity-last2`, gain 1.0, no cap is the first implementation target.
- Prediction should modify only the displayed overlay position, never the real cursor or input behavior.
- Reset on first sample, invalid `dt`, idle gap, hide, dispose, and prediction-related settings changes.
- Tests should use synthetic clocks and fake presenters, not real hooks.

Supervisor adjustment:

- Use fixed 8ms as the fallback horizon.
- For automatic display-frame mode, clamp the estimated frame period to 4-16ms rather than 8-16ms. Step 1 evaluated 4ms directly, and high-refresh displays should not be forced into unnecessary overprediction.

## Step 4 Final Recommendation
The PoC is ready to feed implementation. The final recommendation is:

- implement an O(1), allocation-free `CursorPositionPredictor`;
- use `constant-velocity-last2`, gain 1.0, no normal offset cap;
- reset velocity on invalid or idle timing, with `100ms` as the initial idle threshold;
- ship prediction as opt-in first, not default-on, because the current evidence comes from one trace;
- start with a deterministic fixed 8ms horizon, then add automatic display-frame horizon clamped to 4-16ms;
- do not implement neural prediction, online expert selection, or normal offset caps until multiple traces show a clear tail-safe improvement.

## Step 5 Neural Model Review
Step 5 was added after the user requested MLP/deep-learning evaluation. The machine has an NVIDIA GeForce RTX 5090 visible through `nvidia-smi`, with driver 576.88 and CUDA 12.9 reported. However, the available Python environment has NumPy but not PyTorch, TensorFlow, scikit-learn, or ONNX Runtime. This means GPU hardware exists, but the current local ML runtime cannot use it directly. Step 5 therefore used CPU NumPy and did not attempt network installs.

The experiment trained two small MLPs using only past samples:

- `mlp-direct-h32x16`, predicting future displacement directly;
- `mlp-residual-last2-h32x16`, predicting a correction to the last2 baseline.

Both used train-only standardization, deterministic seed, train-first-70% / test-latter-30% split, and the 100ms gap rule. The comparison used a common feature-valid anchor mask, so the Step 5 `last2` numbers are directly comparable to the MLP rows but not identical to Step 1's broader baseline.

Important common-anchor test results:

| horizon ms | last2 mean | best neural mean | last2 p95 | best neural p95 | last2 p99 | best neural p99 | max read |
|---:|---:|---:|---:|---:|---:|---:|---|
| 4 | 1.700 | 1.615 | 6.449 | 5.388 | 12.457 | 10.485 | Neural max worsened. |
| 8 | 3.367 | 3.098 | 12.562 | 10.173 | 24.834 | 19.723 | Neural max worsened. |
| 12 | 5.434 | 4.747 | 22.124 | 17.323 | 41.935 | 32.405 | Neural max worsened. |
| 16 | 7.719 | 6.865 | 31.667 | 25.973 | 61.288 | 47.378 | Neural max roughly improved. |
| 24 | 13.829 | 12.686 | 57.906 | 46.277 | 107.597 | 86.549 | Neural max worsened. |

Speed-bin analysis explains the mixed result. At 8ms in the 3000+ px/s bin, residual MLP mean improved from 10.983px to 8.473px and p95 improved from 27.149px to 22.280px. At 16ms in the same bin, mean improved from 26.180px to 20.115px and p95 from 66.451px to 51.538px. This directly supports the user's observation that high-speed movement is where the simple model is weakest.

The same neural models regress low-speed bins. At 8ms in the 0-500 px/s bin, residual MLP mean worsened from 1.138px to 1.507px and p95 from 2.782px to 3.758px. At 16ms, mean worsened from 2.291px to 2.966px and p95 from 5.851px to 7.324px.

Supervisor conclusion:

- MLPs are useful enough to keep investigating.
- Do not replace `constant-velocity-last2` as the product default from one trace.
- The promising next design is speed-gated hybrid prediction: keep last2 at low speed, switch to a learned residual or direct correction only above a speed threshold.
- GPU can be used only after installing a CUDA-capable ML runtime or adding a dedicated GPU inference/training backend; current NumPy-only PoC is CPU-bound.
