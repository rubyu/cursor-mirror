# Step 5 Notes

## Rerun

```powershell
node poc\cursor-prediction-v11\scripts\run-step5-tail-aware-guarded-search.js
```

## Causality

Product-eligible candidates use causal referencePoll history, model outputs, product poll timing, and scheduler-delay feature only when the candidate is marked as using scheduler delay. Script movement category is used for evaluation labels only. `oracle_*` candidates are analysis-only and are not selectable.

## Tail Objective

The objective is validation-only and prioritizes p95/p99, >5px/>10px, resume horizons 16.67-50 ms, worst normal/stress load tails, and signed lag tendency. Guardrails compare against both Step 3 teacher and Step 4 selected so a candidate that improves mean but worsens tail is not considered a clean advance.

## Missing Scheduler

The normal recording still has a tiny missing-scheduler bucket with very large errors. Because the count is tiny, this should be treated as warm-up/trace alignment risk rather than a learned-model win until the recorder/runtime path explains why scheduler timing is absent.

## Outcome

Selected candidate: `guard_vfsmn_still_to_motion_t1.4_h25_to_teacher`. Guardrail passed: yes.
