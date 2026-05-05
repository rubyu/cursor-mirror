# Step 7 Notes

## Rerun

```powershell
node poc\cursor-prediction-v11\scripts\run-step7-oracle-observability-ceiling.js
```

## Product Eligibility

Product-eligible selectors use causal feature vectors derived from referencePoll history and product poll timing. Analysis-only selectors use label-best choices, script/evaluation movement category, load id, or scenario progress proxies and are excluded from validation selection.

## Sampling

Selector training uses a deterministic reservoir sample capped at 90000 train examples. History ambiguity uses capped nearest-neighbor samples to avoid writing per-frame caches or running a heavy benchmark.

Selected product selector: `causal_selector_stump_speedSpread_0p06079`.
