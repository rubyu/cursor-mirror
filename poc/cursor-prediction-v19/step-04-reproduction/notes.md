# Step 04 Notes: Reproduction Replay

Step 04 ran product-equivalent C# replay over the Step 03 MotionLab abrupt-stop scenario set:

- `C:/Users/seigl/OneDrive/my/ドキュメント/projects/cursor/poc/cursor-prediction-v19/step-03-motionlab-abrupt-stop-scenarios/abrupt-stop-scenarios.json`
- scenarios: 24
- call rate: 60 Hz
- DWM phase offsets: 0, 4.1666667, 8.3333333, 12.5

Compared candidates:

- ConstantVelocity, default +2ms target offset
- LeastSquares, default +2ms target offset
- DistilledMLP lag0, target offset -4ms, no post-stop brake
- DistilledMLP lag0, target offset -4ms, current product post-stop brake

Result: the original Step 03 scenario set did not produce detected stop events under the Step 01 event-window definition. It showed broad current-position lead in row metrics, but it was too slow/gentle to satisfy recent-high plus near-zero stop-onset criteria.

This triggered Step 04b generator revision.
