using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace CursorMirror.KernelBench
{
    internal static class Program
    {
        private const int PfAvxInstructionsAvailable = 39;
        private const int PfAvx2InstructionsAvailable = 40;
        private const int PfAvx512FInstructionsAvailable = 41;

        private const uint NativeFeatureAvx = 1u << 0;
        private const uint NativeFeatureAvx2 = 1u << 1;
        private const uint NativeFeatureFma3 = 1u << 2;
        private const uint NativeFeatureAvx512F = 1u << 3;

        private static int Main(string[] args)
        {
            string outputPath = ParseOutputPath(args);
            string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            FeatureReport features = FeatureReport.Collect(baseDirectory);
            BenchmarkResult scalar = BenchmarkScalar();
            BenchmarkResult unrolled = BenchmarkUnrolled4();
            BenchmarkResult[] nativeResults = BenchmarkNativeKernels(features, baseDirectory);
            string json = BuildJson(features, new[] { scalar, unrolled }, nativeResults);
            Console.WriteLine(json);
            if (!string.IsNullOrWhiteSpace(outputPath))
            {
                string directory = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                File.WriteAllText(outputPath, json + Environment.NewLine, new UTF8Encoding(false));
            }

            return 0;
        }

        private static BenchmarkResult BenchmarkScalar()
        {
            float[] input = BuildInput(4096);
            float[] weights = BuildWeights(4096);
            int iterations = 20000;
            Stopwatch stopwatch = Stopwatch.StartNew();
            float sink = 0;
            for (int iteration = 0; iteration < iterations; iteration++)
            {
                sink += DotScalar(input, weights);
            }

            stopwatch.Stop();
            return BenchmarkResult.CompletedManaged("Scalar", iterations, stopwatch.Elapsed.TotalMilliseconds, sink, 1);
        }

        private static BenchmarkResult BenchmarkUnrolled4()
        {
            float[] input = BuildInput(4096);
            float[] weights = BuildWeights(4096);
            int iterations = 20000;
            Stopwatch stopwatch = Stopwatch.StartNew();
            float sink = 0;
            for (int iteration = 0; iteration < iterations; iteration++)
            {
                sink += DotUnrolled4(input, weights);
            }

            stopwatch.Stop();
            return BenchmarkResult.CompletedManaged("Unrolled4", iterations, stopwatch.Elapsed.TotalMilliseconds, sink, 4);
        }

        private static BenchmarkResult[] BenchmarkNativeKernels(FeatureReport features, string baseDirectory)
        {
            NativeKernelSpec[] specs = new[]
            {
                new NativeKernelSpec("NativeScalar", "CursorMirror.KernelBench.Native.Scalar.dll", true, null),
                new NativeKernelSpec(
                    "NativeAvx2Fma",
                    "CursorMirror.KernelBench.Native.Avx2Fma.dll",
                    features.NativeFeatureReportAvailable && features.NativeAvx2 && features.NativeFma3,
                    BuildNativeSkipReason(features, "AVX2/FMA3", features.NativeAvx2 && features.NativeFma3)),
                new NativeKernelSpec(
                    "NativeAvx512F",
                    "CursorMirror.KernelBench.Native.Avx512F.dll",
                    features.NativeFeatureReportAvailable && features.NativeAvx512F,
                    BuildNativeSkipReason(features, "AVX-512F", features.NativeAvx512F))
            };

            BenchmarkResult[] results = new BenchmarkResult[specs.Length];
            for (int i = 0; i < specs.Length; i++)
            {
                results[i] = BenchmarkNativeKernel(specs[i], baseDirectory);
            }

            return results;
        }

        private static string BuildNativeSkipReason(FeatureReport features, string name, bool supported)
        {
            if (supported)
            {
                return null;
            }

            if (!features.NativeFeatureReportAvailable)
            {
                return "native CPU feature report is unavailable";
            }

            return name + " is not available";
        }

        private static BenchmarkResult BenchmarkNativeKernel(NativeKernelSpec spec, string baseDirectory)
        {
            string path = Path.Combine(baseDirectory, spec.DllName);
            if (!File.Exists(path))
            {
                return BenchmarkResult.SkippedNative(spec.Name, spec.DllName, "native DLL was not built");
            }

            if (!spec.IsSupported)
            {
                return BenchmarkResult.SkippedNative(spec.Name, spec.DllName, spec.SkipReason);
            }

            try
            {
                return RunNativeBenchmark(spec, path);
            }
            catch (Exception ex)
            {
                return BenchmarkResult.SkippedNative(spec.Name, spec.DllName, "native benchmark failed: " + ex.Message);
            }
        }

        private static BenchmarkResult RunNativeBenchmark(NativeKernelSpec spec, string path)
        {
            NativeModule module = null;
            GCHandle inputHandle = default(GCHandle);
            GCHandle weightsHandle = default(GCHandle);
            try
            {
                module = NativeModule.Load(path);
                NativeIntDelegate abi = module.GetDelegate<NativeIntDelegate>("CursorMirrorNativeKernelAbi");
                if (abi() != 1)
                {
                    throw new InvalidOperationException("unsupported native kernel ABI");
                }

                NativeIntDelegate width = module.GetDelegate<NativeIntDelegate>("CursorMirrorNativeKernelVectorWidthFloats");
                NativeDotDelegate dot = module.GetDelegate<NativeDotDelegate>("CursorMirrorDotNative");

                float[] input = BuildInput(4096);
                float[] weights = BuildWeights(4096);
                inputHandle = GCHandle.Alloc(input, GCHandleType.Pinned);
                weightsHandle = GCHandle.Alloc(weights, GCHandleType.Pinned);

                IntPtr inputPointer = inputHandle.AddrOfPinnedObject();
                IntPtr weightsPointer = weightsHandle.AddrOfPinnedObject();
                dot(inputPointer, weightsPointer, input.Length, 100);

                int iterations = 20000;
                Stopwatch stopwatch = Stopwatch.StartNew();
                float sink = dot(inputPointer, weightsPointer, input.Length, iterations);
                stopwatch.Stop();

                return BenchmarkResult.CompletedNative(spec.Name, spec.DllName, iterations, stopwatch.Elapsed.TotalMilliseconds, sink, width());
            }
            finally
            {
                if (inputHandle.IsAllocated)
                {
                    inputHandle.Free();
                }

                if (weightsHandle.IsAllocated)
                {
                    weightsHandle.Free();
                }

                if (module != null)
                {
                    module.Dispose();
                }
            }
        }

        private static float DotScalar(float[] input, float[] weights)
        {
            float sum = 0;
            for (int i = 0; i < input.Length; i++)
            {
                sum += input[i] * weights[i];
            }

            return sum;
        }

        private static float DotUnrolled4(float[] input, float[] weights)
        {
            float s0 = 0;
            float s1 = 0;
            float s2 = 0;
            float s3 = 0;
            int i = 0;
            for (; i <= input.Length - 4; i += 4)
            {
                s0 += input[i] * weights[i];
                s1 += input[i + 1] * weights[i + 1];
                s2 += input[i + 2] * weights[i + 2];
                s3 += input[i + 3] * weights[i + 3];
            }

            float scalar = s0 + s1 + s2 + s3;
            for (; i < input.Length; i++)
            {
                scalar += input[i] * weights[i];
            }

            return scalar;
        }

        private static float[] BuildInput(int count)
        {
            float[] values = new float[count];
            for (int i = 0; i < values.Length; i++)
            {
                values[i] = (float)Math.Sin(i * 0.017);
            }

            return values;
        }

        private static float[] BuildWeights(int count)
        {
            float[] values = new float[count];
            for (int i = 0; i < values.Length; i++)
            {
                values[i] = (float)Math.Cos(i * 0.013);
            }

            return values;
        }

        private static string BuildJson(FeatureReport features, BenchmarkResult[] managedResults, BenchmarkResult[] nativeResults)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append("{");
            AppendProperty(builder, "schemaVersion", "cursor-mirror-kernelbench/1");
            builder.Append(",");
            AppendProperty(builder, "generatedUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
            builder.Append(",\"features\":{");
            AppendProperty(builder, "avx", features.Avx);
            builder.Append(",");
            AppendProperty(builder, "avx2", features.Avx2);
            builder.Append(",");
            AppendProperty(builder, "avx512f", features.Avx512F);
            builder.Append(",");
            AppendProperty(builder, "nativeCpuIdAvailable", features.NativeFeatureReportAvailable);
            builder.Append(",");
            AppendProperty(builder, "nativeAvx", features.NativeAvx);
            builder.Append(",");
            AppendProperty(builder, "nativeAvx2", features.NativeAvx2);
            builder.Append(",");
            AppendProperty(builder, "nativeFma3", features.NativeFma3);
            builder.Append(",");
            AppendProperty(builder, "nativeAvx512f", features.NativeAvx512F);
            builder.Append(",");
            AppendProperty(builder, "managedVectorHardwareAccelerated", false);
            builder.Append(",");
            AppendProperty(builder, "managedVectorFloatCount", 0);
            builder.Append("},\"benchmarks\":[");

            bool first = true;
            AppendBenchmarks(builder, managedResults, ref first);
            AppendBenchmarks(builder, nativeResults, ref first);

            builder.Append("]}");
            return builder.ToString();
        }

        private static void AppendBenchmarks(StringBuilder builder, BenchmarkResult[] results, ref bool first)
        {
            for (int i = 0; i < results.Length; i++)
            {
                if (!first)
                {
                    builder.Append(",");
                }

                AppendBenchmark(builder, results[i]);
                first = false;
            }
        }

        private static void AppendBenchmark(StringBuilder builder, BenchmarkResult result)
        {
            builder.Append("{");
            AppendProperty(builder, "name", result.Name);
            builder.Append(",");
            AppendProperty(builder, "kind", result.Kind);
            builder.Append(",");
            AppendProperty(builder, "skipped", result.Skipped);
            if (!string.IsNullOrEmpty(result.DllName))
            {
                builder.Append(",");
                AppendProperty(builder, "dll", result.DllName);
            }

            if (result.Skipped)
            {
                builder.Append(",");
                AppendProperty(builder, "skipReason", result.SkipReason);
                builder.Append("}");
                return;
            }

            builder.Append(",");
            AppendProperty(builder, "iterations", result.Iterations);
            builder.Append(",");
            AppendProperty(builder, "elapsedMilliseconds", result.ElapsedMilliseconds);
            builder.Append(",");
            AppendProperty(builder, "iterationsPerSecond", result.IterationsPerSecond);
            builder.Append(",");
            AppendProperty(builder, "vectorWidthFloats", result.VectorWidthFloats);
            builder.Append(",");
            AppendProperty(builder, "sink", result.Sink);
            builder.Append("}");
        }

        private static void AppendProperty(StringBuilder builder, string name, string value)
        {
            builder.Append("\"");
            builder.Append(Escape(name));
            builder.Append("\":\"");
            builder.Append(Escape(value));
            builder.Append("\"");
        }

        private static void AppendProperty(StringBuilder builder, string name, bool value)
        {
            builder.Append("\"");
            builder.Append(Escape(name));
            builder.Append("\":");
            builder.Append(value ? "true" : "false");
        }

        private static void AppendProperty(StringBuilder builder, string name, int value)
        {
            builder.Append("\"");
            builder.Append(Escape(name));
            builder.Append("\":");
            builder.Append(value.ToString(CultureInfo.InvariantCulture));
        }

        private static void AppendProperty(StringBuilder builder, string name, double value)
        {
            builder.Append("\"");
            builder.Append(Escape(name));
            builder.Append("\":");
            builder.Append(value.ToString("0.###", CultureInfo.InvariantCulture));
        }

        private static void AppendProperty(StringBuilder builder, string name, float value)
        {
            builder.Append("\"");
            builder.Append(Escape(name));
            builder.Append("\":");
            builder.Append(value.ToString("0.###", CultureInfo.InvariantCulture));
        }

        private static string Escape(string value)
        {
            return (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static string ParseOutputPath(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                string argument = (args[i] ?? string.Empty).Trim().ToLowerInvariant();
                if ((argument == "--out" || argument == "--output") && i + 1 < args.Length)
                {
                    return args[i + 1];
                }
            }

            return null;
        }

        [DllImport("kernel32.dll")]
        private static extern bool IsProcessorFeaturePresent(int processorFeature);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibrary(string fileName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool FreeLibrary(IntPtr module);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true, ExactSpelling = true)]
        private static extern IntPtr GetProcAddress(IntPtr module, string procName);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int NativeIntDelegate();

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate uint NativeFeatureMaskDelegate();

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate float NativeDotDelegate(IntPtr input, IntPtr weights, int count, int iterations);

        private sealed class FeatureReport
        {
            public bool Avx;
            public bool Avx2;
            public bool Avx512F;
            public bool NativeFeatureReportAvailable;
            public bool NativeAvx;
            public bool NativeAvx2;
            public bool NativeFma3;
            public bool NativeAvx512F;

            public static FeatureReport Collect(string baseDirectory)
            {
                FeatureReport report = new FeatureReport();
                report.Avx = IsProcessorFeaturePresent(PfAvxInstructionsAvailable);
                report.Avx2 = IsProcessorFeaturePresent(PfAvx2InstructionsAvailable);
                report.Avx512F = IsProcessorFeaturePresent(PfAvx512FInstructionsAvailable);
                report.TryReadNativeFeatureReport(baseDirectory);
                return report;
            }

            private void TryReadNativeFeatureReport(string baseDirectory)
            {
                string path = Path.Combine(baseDirectory, "CursorMirror.KernelBench.Native.Scalar.dll");
                if (!File.Exists(path))
                {
                    return;
                }

                try
                {
                    using (NativeModule module = NativeModule.Load(path))
                    {
                        NativeIntDelegate abi = module.GetDelegate<NativeIntDelegate>("CursorMirrorNativeKernelAbi");
                        if (abi() != 1)
                        {
                            return;
                        }

                        NativeFeatureMaskDelegate featureMask = module.GetDelegate<NativeFeatureMaskDelegate>("CursorMirrorNativeCpuFeatureMask");
                        uint mask = featureMask();
                        NativeFeatureReportAvailable = true;
                        NativeAvx = (mask & NativeFeatureAvx) != 0;
                        NativeAvx2 = (mask & NativeFeatureAvx2) != 0;
                        NativeFma3 = (mask & NativeFeatureFma3) != 0;
                        NativeAvx512F = (mask & NativeFeatureAvx512F) != 0;
                    }
                }
                catch
                {
                    NativeFeatureReportAvailable = false;
                }
            }
        }

        private sealed class NativeKernelSpec
        {
            public NativeKernelSpec(string name, string dllName, bool isSupported, string skipReason)
            {
                Name = name;
                DllName = dllName;
                IsSupported = isSupported;
                SkipReason = skipReason;
            }

            public readonly string Name;
            public readonly string DllName;
            public readonly bool IsSupported;
            public readonly string SkipReason;
        }

        private sealed class BenchmarkResult
        {
            private BenchmarkResult(string name, string kind, string dllName, bool skipped, string skipReason, int iterations, double elapsedMilliseconds, float sink, int vectorWidthFloats)
            {
                Name = name;
                Kind = kind;
                DllName = dllName;
                Skipped = skipped;
                SkipReason = skipReason;
                Iterations = iterations;
                ElapsedMilliseconds = elapsedMilliseconds;
                Sink = sink;
                VectorWidthFloats = vectorWidthFloats;
                IterationsPerSecond = elapsedMilliseconds <= 0 ? 0 : iterations * 1000.0 / elapsedMilliseconds;
            }

            public static BenchmarkResult CompletedManaged(string name, int iterations, double elapsedMilliseconds, float sink, int vectorWidthFloats)
            {
                return new BenchmarkResult(name, "managed", null, false, null, iterations, elapsedMilliseconds, sink, vectorWidthFloats);
            }

            public static BenchmarkResult CompletedNative(string name, string dllName, int iterations, double elapsedMilliseconds, float sink, int vectorWidthFloats)
            {
                return new BenchmarkResult(name, "native", dllName, false, null, iterations, elapsedMilliseconds, sink, vectorWidthFloats);
            }

            public static BenchmarkResult SkippedNative(string name, string dllName, string reason)
            {
                return new BenchmarkResult(name, "native", dllName, true, reason, 0, 0, 0, 0);
            }

            public readonly string Name;
            public readonly string Kind;
            public readonly string DllName;
            public readonly bool Skipped;
            public readonly string SkipReason;
            public readonly int Iterations;
            public readonly double ElapsedMilliseconds;
            public readonly double IterationsPerSecond;
            public readonly float Sink;
            public readonly int VectorWidthFloats;
        }

        private sealed class NativeModule : IDisposable
        {
            private IntPtr handle;

            private NativeModule(IntPtr handle)
            {
                this.handle = handle;
            }

            public static NativeModule Load(string path)
            {
                IntPtr module = LoadLibrary(path);
                if (module == IntPtr.Zero)
                {
                    throw new InvalidOperationException("LoadLibrary failed with error " + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
                }

                return new NativeModule(module);
            }

            public T GetDelegate<T>(string procName) where T : class
            {
                IntPtr proc = GetProcAddress(handle, procName);
                if (proc == IntPtr.Zero)
                {
                    throw new InvalidOperationException("GetProcAddress failed for " + procName);
                }

                return Marshal.GetDelegateForFunctionPointer(proc, typeof(T)) as T;
            }

            public void Dispose()
            {
                if (handle != IntPtr.Zero)
                {
                    FreeLibrary(handle);
                    handle = IntPtr.Zero;
                }
            }
        }
    }
}
