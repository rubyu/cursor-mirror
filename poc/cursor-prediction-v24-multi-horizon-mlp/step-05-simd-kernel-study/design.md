# Step 05 Design - SIMD Kernel Study

## Purpose

SIMD should be evaluated only after Step 03/04 show that a larger model materially improves accuracy. The current model is small enough that native acceleration would add packaging complexity before it proves value.

## Baseline

Current `SmoothPredictor`:

- 25 inputs;
- 32 hidden `tanh` units;
- 2 outputs;
- about 864 MAC-like operations;
- no per-call array allocation in normal scalar C# evaluation.

This should remain the reference until a larger model wins.

## Candidate Runtime Paths

### Generated Scalar C#

Default first path. It is easiest to ship, test, and fall back.

### Generated Unrolled C#

Useful if hidden size grows moderately. The generator can emit fixed loops or unrolled blocks to reduce loop overhead while staying pure C#.

### `System.Numerics`

Worth testing if the project can add the needed references cleanly and if the runtime actually vectorizes the dot products on the target framework.

### Native AVX2/FMA

Most practical native path if model size justifies native code. KernelBench already has pieces for CPU feature reporting and DLL loading.

### Native AVX-512F

Must be tested because some target machines support it, but it should not be assumed as the only fast path. Frequency effects and packaging complexity must be measured.

## Measurement Rules

- Microbenchmarks are timing measurements and must run as single-runner jobs.
- Report p50/p95/p99 and outliers, not only average time.
- Include scalar fallback in every report.
- Pinning and native dispatch overhead must be outside the per-frame hot path.

## ABI Direction If Native Is Needed

The existing dot-product ABI is not enough for product inference. A future MLP ABI should accept a preallocated input pointer and return two floats without per-call allocation or dynamic lookup. CPU dispatch should occur once at startup.
