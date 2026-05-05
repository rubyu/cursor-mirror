# Step 06 Notes: High-Accuracy Model Search

This step used a compact CPU-only search because Python/GPU setup was unavailable without network dependency download. Product source was not modified.

Dataset sources:

- latest real 60Hz traces from Step 01
- Step 03 original MotionLab abrupt-stop coverage
- Step 04b revised positive abrupt-stop stress scenarios

Split policy is file/scenario-level:

- real: m070248 train, m070307 test
- synthetic: deterministic scenario/family train/validation/test split

Training labels:

- normal shifted-target dx/dy for regular motion
- event-window safe dx/dy = 0 for stop windows
- static safe dx/dy = 0 for stationary rows

Runtime features stay current/past only: recent velocity windows, latest delta, path efficiency, horizon, and product baseline output for rule hybrids.
