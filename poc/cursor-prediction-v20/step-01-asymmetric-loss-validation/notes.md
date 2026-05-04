# Step 01 Notes - Asymmetric Loss Validation

This step reuses the v19 high-accuracy search harness and changes only the training objective.

Loss variants:

- `eventSafe`: existing stop-window safe target baseline.
- `asymmetricLead`: normal shifted target plus an extra penalty on future-position lead.

Runtime features remain unchanged. Future cursor position and event labels are used only for training and evaluation.
