# Step 03 Notes

- CPU fixed inference only.
- v16 selected MLP weights are unchanged.
- Product-safe variants use current/recent velocity, path efficiency, and prediction/capacity checks.
- Oracle diagnostic variants use future label speed and are not product implementation candidates.
- Step 4 should focus on product-safe variants that reduce stopApproach overshoot and postStopJitter without large all-split regression.
