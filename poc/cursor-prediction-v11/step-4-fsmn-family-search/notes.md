# Step 4 Notes

## Rerun

```powershell
$env:CURSOR_PREDICTION_CPU_FEATURES_JSON='{"avx":true,"avx2":true,"fma3":true,"avx512f":true}'
node poc\cursor-prediction-v11\scripts\run-step4-fsmn-family-search.js
```

## Causality

All product-eligible FSMN-family variants use the same causal Step 3 feature vector. The `CSFSMN_loadaware_analysis` candidate is marked non-product because it uses recording load id. Script-derived movement category is used only as an evaluation label, not as product input.

## CPU Audit Caveat

This run recorded AVX/AVX2/FMA/AVX-512F through a PowerShell .NET Intrinsics check passed via `CURSOR_PREDICTION_CPU_FEATURES_JSON`. If the override is omitted, the script falls back to `IsProcessorFeaturePresent`; in this sandbox that child-process fallback may be blocked, and FMA3 is otherwise unknown without native CPUID. Performance numbers are deployability estimates, not actual SIMD kernel timings, and should be treated as noisy because the machine is shared.

## Step 5 Guardrail

Do not advance a model solely on aggregate mean. Require normal/stress test p95 and p99 not to regress against `step3_teacher_ridge_residual_segmented_horizon`, with extra scrutiny on resume horizons 16.67-50 ms.
