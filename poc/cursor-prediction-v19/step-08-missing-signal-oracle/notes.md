# Step 08 Notes: Missing-Signal Oracle

Step 08 tested explicit poll-stream signals before any product or TraceTool changes.

The synthetic replay differs from Step04b by separating:

- true cursor position used for visual/current error
- observed poll position fed into the product predictor
- explicit duplicate/hold run length
- last raw movement age
- sample/stale age
- missed poll before stop
- target phase relative to detected stop onset
- target-crosses-stop-boundary oracle
- future stop-window oracle

No product predictor code was modified.
