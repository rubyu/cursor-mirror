# POC v18 Experiment Plan

## Goal

Find a product-safe brake or safety gate that reduces acute-stop overshoot relative to the real cursor's current position, without making normal movement or high-speed prediction visibly worse.

## Steps

1. Define current-position overshoot metrics and acute-stop slices.
2. Build a C# chronological replay baseline for current product and v17 candidates.
3. Search lightweight brake gates that only fire during acute-stop risk.
4. Validate selected brake against normal/high-speed/static side effects.

## Constraints

- Do not edit product source.
- Do not copy raw ZIP/CSV data.
- Keep generated artifacts compact.
- Remove `bin/`, `obj/`, `__pycache__`, and accidental heavy intermediates before final delivery.
