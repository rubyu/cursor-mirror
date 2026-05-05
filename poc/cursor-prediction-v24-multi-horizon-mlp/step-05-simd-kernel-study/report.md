# Step 05 KernelBench Report

Generated from one short Release KernelBench run on 2026-05-05T03:59:49.7834405Z.

Command:

```powershell
artifacts\bin\Release\CursorMirror.KernelBench.exe --output poc\cursor-prediction-v24-multi-horizon-mlp\step-05-simd-kernel-study\kernelbench.json
```

## Scope

This benchmark is a dot-product proxy for comparing scalar, unrolled, and native SIMD kernel paths. It is not full MLP inference: it does not include the whole model graph, activation functions, two-output inference, model dispatch, allocation behavior, or product-frame integration costs.

This was a short single-runner measurement using the existing Release benchmark binary. It should be treated as directional only, not as a statistically complete latency report.

## CPU Features

| Feature | Available |
| --- | --- |
| AVX | yes |
| AVX2 | yes |
| AVX-512F | yes |
| Native CPUID | yes |
| Native AVX | yes |
| Native AVX2 | yes |
| Native FMA3 | yes |
| Native AVX-512F | yes |
| Managed Vector hardware acceleration | no |
| Managed Vector<float> count | 0 |

## Results

| Kernel | Kind | Iterations | Elapsed ms | Iterations/s | Vector width floats | Relative to managed scalar |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Scalar | managed | 20,000 | 29.349 | 681,463.511 | 1 | 1.00x |
| Unrolled4 | managed | 20,000 | 15.678 | 1,275,664.781 | 4 | 1.87x |
| NativeScalar | native | 20,000 | 15.152 | 1,319,975.184 | 1 | 1.94x |
| NativeAvx2Fma | native | 20,000 | 6.723 | 2,975,039.419 | 8 | 4.37x |
| NativeAvx512F | native | 20,000 | 3.238 | 6,176,843.016 | 16 | 9.06x |

No kernels were skipped in this run.

## Readout

Native AVX-512F was the fastest dot-product proxy path on this machine, followed by native AVX2/FMA. The unrolled managed path was close to native scalar and materially faster than the managed scalar baseline.

Because managed vector acceleration reported unavailable in this run, the practical managed comparison from this executable is scalar C# versus generated unrolled C#. Native SIMD remains promising for a larger model, but the production decision still needs a full MLP inference benchmark with startup-time CPU dispatch and no per-frame dynamic lookup or allocation.
