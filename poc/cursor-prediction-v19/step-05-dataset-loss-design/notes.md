# Step 05 Notes: Dataset and Loss Design

Step 05 is design-only. No GPU training was run.

Because Step 04b reproduced the leak, the next dataset should mix real 60Hz traces with synthetic abrupt-stop positives. Splits must be file/session/scenario-level to avoid leakage.

Training losses can use future labels and event-window labels, but runtime candidates must only use current/past samples and DWM target timing.
