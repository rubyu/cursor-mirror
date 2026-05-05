# Step 7 Notes

## Rerun

```powershell
node poc\cursor-prediction-v12\scripts\run-step7-tail-and-holdout.js
```

## Search Shape

- Stage A explores speed threshold, refresh branch, and every requested LS specialist parameter tuple.
- Stage B expands the best Stage A tuples with acceleration, path efficiency, and net displacement thresholds.
- The selected Step 5 gate remains the fallback for every row that does not satisfy the specialist guard.

## Product Safety

Product candidates do not use `movementPhase`, future speed bins, or labels. Those are reserved for analysis-only oracle scoring.

## Main Result

Selected candidate: `gate_s25_net0_eff35_ls12_g100_cap12_off-2`

The safe choice is whichever model passes validation/test overall guardrails and does not worsen `refresh:30Hz` holdout p95/p99. If no specialist passes, the Step 5 selected gate remains selected.
