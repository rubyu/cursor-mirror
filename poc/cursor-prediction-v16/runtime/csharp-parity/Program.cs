using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace CursorMirror.Poc;

internal static class Program
{
    private const int SampleCount = 512;

    public static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("Usage: CSharpParity <selected-candidate.json> [results.json]");
            return 2;
        }

        string descriptorPath = Path.GetFullPath(args[0]);
        string? resultPath = args.Length >= 2 ? Path.GetFullPath(args[1]) : null;
        using JsonDocument document = JsonDocument.Parse(File.ReadAllText(descriptorPath));
        RuntimeDescriptor descriptor = RuntimeDescriptor.FromJson(document.RootElement);

        List<float> errors = [];
        float maxError = 0f;
        for (int i = 0; i < SampleCount; i++)
        {
            float[] scalar = CreateScalar(i);
            float[] sequence = CreateSequence(i);
            (float gx, float gy) = Distilled60HzPredictor.PredictFromNormalizedSourceFeatures(scalar, sequence);
            (float rx, float ry) = descriptor.PredictFromNormalizedSourceFeatures(scalar, sequence);
            float error = MathF.Sqrt(((gx - rx) * (gx - rx)) + ((gy - ry) * (gy - ry)));
            errors.Add(error);
            if (error > maxError)
            {
                maxError = error;
            }
        }

        errors.Sort();
        float p99 = Percentile(errors, 0.99f);
        bool passed = maxError < 0.01f;
        string json = $$"""
        {
          "method": "csharp_generated_source_vs_json_descriptor",
          "csharpCompileRun": "{{(passed ? "passed" : "failed")}}",
          "sampleCount": {{SampleCount}},
          "maxErrorPx": {{Format(maxError)}},
          "p99ErrorPx": {{Format(p99)}},
          "targetMaxErrorPx": 0.01,
          "passed": {{passed.ToString().ToLowerInvariant()}},
          "runtime": "{{Escape(System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription)}}",
          "descriptorPath": "{{Escape(descriptorPath)}}"
        }
        """;

        if (resultPath is not null)
        {
            string? directory = Path.GetDirectoryName(resultPath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }
            File.WriteAllText(resultPath, json + Environment.NewLine);
        }

        Console.WriteLine(json);
        return passed ? 0 : 1;
    }

    private static float[] CreateScalar(int sample)
    {
        float[] scalar = new float[Distilled60HzPredictor.ScalarFeatureCount];
        for (int i = 0; i < scalar.Length; i++)
        {
            scalar[i] = DeterministicValue(sample, i, 1.4f);
        }

        if (sample % 5 == 0)
        {
            Array.Clear(scalar);
        }
        else if (sample % 5 == 1)
        {
            scalar[17] = 2.5f;
            scalar[18] = 0f;
        }
        else if (sample % 5 == 2)
        {
            scalar[17] = -2.5f;
            scalar[18] = 1.25f;
        }
        else if (sample % 5 == 3)
        {
            scalar[17] = 0.25f * DeterministicValue(sample, 17, 1f);
            scalar[18] = 0.25f * DeterministicValue(sample, 18, 1f);
        }

        return scalar;
    }

    private static float[] CreateSequence(int sample)
    {
        int length = Distilled60HzPredictor.SequenceLength * Distilled60HzPredictor.SequenceFeatureCount;
        float[] sequence = new float[length];
        for (int t = 0; t < Distilled60HzPredictor.SequenceLength; t++)
        {
            for (int d = 0; d < Distilled60HzPredictor.SequenceFeatureCount; d++)
            {
                int index = (t * Distilled60HzPredictor.SequenceFeatureCount) + d;
                float phase = sample * 0.071f + t * 0.19f + d * 0.37f;
                sequence[index] = MathF.Sin(phase) * 0.9f + MathF.Cos(phase * 0.43f) * 0.35f;
            }
        }

        if (sample % 7 == 0)
        {
            Array.Clear(sequence);
        }

        return sequence;
    }

    private static float DeterministicValue(int sample, int index, float scale)
    {
        float phase = (sample + 1) * 0.113f + (index + 3) * 0.271f;
        return scale * (MathF.Sin(phase) + 0.5f * MathF.Cos(phase * 1.7f));
    }

    private static float Percentile(IReadOnlyList<float> sorted, float percentile)
    {
        if (sorted.Count == 0)
        {
            return 0f;
        }

        float position = (sorted.Count - 1) * percentile;
        int lo = (int)MathF.Floor(position);
        int hi = Math.Min(sorted.Count - 1, lo + 1);
        float mix = position - lo;
        return sorted[lo] + ((sorted[hi] - sorted[lo]) * mix);
    }

    private static string Format(float value)
    {
        return value.ToString("0.#########", CultureInfo.InvariantCulture);
    }

    private static string Escape(string value)
    {
        return value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal);
    }

    private sealed class RuntimeDescriptor
    {
        private readonly float[] _featureMean;
        private readonly float[] _featureStd;
        private readonly float[] _targetScale;
        private readonly float[] _sourceScalarMean;
        private readonly float[] _sourceScalarStd;
        private readonly float[] _w0;
        private readonly float[] _b0;
        private readonly float[] _w1;
        private readonly float[] _b1;
        private readonly float[] _w2;
        private readonly float[] _b2;
        private readonly float _quantizationStep;
        private readonly float _lagCompensationPx;

        private RuntimeDescriptor(
            float[] featureMean,
            float[] featureStd,
            float[] targetScale,
            float[] sourceScalarMean,
            float[] sourceScalarStd,
            float[] w0,
            float[] b0,
            float[] w1,
            float[] b1,
            float[] w2,
            float[] b2,
            float quantizationStep,
            float lagCompensationPx)
        {
            _featureMean = featureMean;
            _featureStd = featureStd;
            _targetScale = targetScale;
            _sourceScalarMean = sourceScalarMean;
            _sourceScalarStd = sourceScalarStd;
            _w0 = w0;
            _b0 = b0;
            _w1 = w1;
            _b1 = b1;
            _w2 = w2;
            _b2 = b2;
            _quantizationStep = quantizationStep;
            _lagCompensationPx = lagCompensationPx;
        }

        public static RuntimeDescriptor FromJson(JsonElement root)
        {
            JsonElement runtime = root.GetProperty("runtime");
            JsonElement source = root.GetProperty("sourceNormalization");
            JsonElement layers = runtime.GetProperty("layers");
            JsonElement inputHidden = layers.GetProperty("inputHidden");
            JsonElement hiddenHidden = layers.GetProperty("hiddenHidden");
            JsonElement hiddenOutput = layers.GetProperty("hiddenOutput");
            return new RuntimeDescriptor(
                ReadVector(runtime.GetProperty("featureMean")),
                ReadVector(runtime.GetProperty("featureStd")),
                ReadVector(runtime.GetProperty("targetScale")),
                ReadVector(source.GetProperty("scalarMean")),
                ReadVector(source.GetProperty("scalarStd")),
                ReadMatrixRows(inputHidden.GetProperty("weights")),
                ReadVector(inputHidden.GetProperty("bias")),
                ReadMatrixRows(hiddenHidden.GetProperty("weights")),
                ReadVector(hiddenHidden.GetProperty("bias")),
                ReadMatrixRows(hiddenOutput.GetProperty("weights")),
                ReadVector(hiddenOutput.GetProperty("bias")),
                runtime.GetProperty("quantizationStep").GetSingle(),
                runtime.GetProperty("lagCompensationPx").GetSingle());
        }

        public (float dx, float dy) PredictFromNormalizedSourceFeatures(ReadOnlySpan<float> scalar, ReadOnlySpan<float> seqFlat)
        {
            Span<float> features = stackalloc float[Distilled60HzPredictor.FeatureCount];
            BuildFsmnFeatures(scalar, seqFlat, features);
            for (int i = 0; i < features.Length; i++)
            {
                features[i] = (features[i] - _featureMean[i]) / _featureStd[i];
            }

            Span<float> h0 = stackalloc float[Distilled60HzPredictor.Hidden];
            Span<float> h1 = stackalloc float[Distilled60HzPredictor.Hidden];
            Dense(features, _w0, _b0, h0, Distilled60HzPredictor.FeatureCount, Distilled60HzPredictor.Hidden);
            HardTanh(h0);
            Dense(h0, _w1, _b1, h1, Distilled60HzPredictor.Hidden, Distilled60HzPredictor.Hidden);
            HardTanh(h1);

            float dx = _b2[0];
            float dy = _b2[1];
            for (int i = 0; i < Distilled60HzPredictor.Hidden; i++)
            {
                dx += h1[i] * _w2[i];
                dy += h1[i] * _w2[Distilled60HzPredictor.Hidden + i];
            }

            dx *= _targetScale[0];
            dy *= _targetScale[1];
            dx = Quantize(dx);
            dy = Quantize(dy);
            ApplyLagCompensation(scalar, ref dx, ref dy);
            return (dx, dy);
        }

        private void BuildFsmnFeatures(ReadOnlySpan<float> scalar, ReadOnlySpan<float> seqFlat, Span<float> dst)
        {
            int o = 0;
            for (int i = 0; i < Distilled60HzPredictor.ScalarFeatureCount; i++)
            {
                dst[o++] = scalar[i];
            }

            int last = (Distilled60HzPredictor.SequenceLength - 1) * Distilled60HzPredictor.SequenceFeatureCount;
            for (int d = 0; d < Distilled60HzPredictor.SequenceFeatureCount; d++)
            {
                dst[o++] = seqFlat[last + d];
            }

            AddDecay(seqFlat, dst, ref o, 2f);
            AddDecay(seqFlat, dst, ref o, 4f);
            AddDecay(seqFlat, dst, ref o, 8f);
            AddMean(seqFlat, dst, ref o, 4);
            AddMean(seqFlat, dst, ref o, 8);
        }

        private static void AddDecay(ReadOnlySpan<float> seqFlat, Span<float> dst, ref int offset, float decay)
        {
            Span<float> sums = stackalloc float[Distilled60HzPredictor.SequenceFeatureCount];
            float total = 0f;
            for (int t = 0; t < Distilled60HzPredictor.SequenceLength; t++)
            {
                float w = MathF.Exp(-(Distilled60HzPredictor.SequenceLength - 1 - t) / decay);
                total += w;
                int baseIndex = t * Distilled60HzPredictor.SequenceFeatureCount;
                for (int d = 0; d < Distilled60HzPredictor.SequenceFeatureCount; d++)
                {
                    sums[d] += w * seqFlat[baseIndex + d];
                }
            }

            for (int d = 0; d < Distilled60HzPredictor.SequenceFeatureCount; d++)
            {
                dst[offset++] = sums[d] / total;
            }
        }

        private static void AddMean(ReadOnlySpan<float> seqFlat, Span<float> dst, ref int offset, int count)
        {
            int start = Distilled60HzPredictor.SequenceLength - count;
            for (int d = 0; d < Distilled60HzPredictor.SequenceFeatureCount; d++)
            {
                float sum = 0f;
                for (int t = start; t < Distilled60HzPredictor.SequenceLength; t++)
                {
                    sum += seqFlat[(t * Distilled60HzPredictor.SequenceFeatureCount) + d];
                }
                dst[offset++] = sum / count;
            }
        }

        private static void Dense(ReadOnlySpan<float> input, ReadOnlySpan<float> weights, ReadOnlySpan<float> bias, Span<float> output, int inputCount, int outputCount)
        {
            for (int o = 0; o < outputCount; o++)
            {
                float value = bias[o];
                int row = o * inputCount;
                for (int i = 0; i < inputCount; i++)
                {
                    value += input[i] * weights[row + i];
                }
                output[o] = value;
            }
        }

        private static void HardTanh(Span<float> values)
        {
            for (int i = 0; i < values.Length; i++)
            {
                values[i] = MathF.Max(-1f, MathF.Min(1f, values[i]));
            }
        }

        private float Quantize(float value)
        {
            return _quantizationStep <= 0f ? value : MathF.Round(value / _quantizationStep) * _quantizationStep;
        }

        private void ApplyLagCompensation(ReadOnlySpan<float> scalar, ref float dx, ref float dy)
        {
            if (_lagCompensationPx <= 0f)
            {
                return;
            }

            float rawDx = (scalar[17] * _sourceScalarStd[17]) + _sourceScalarMean[17];
            float rawDy = (scalar[18] * _sourceScalarStd[18]) + _sourceScalarMean[18];
            float mag = MathF.Sqrt((rawDx * rawDx) + (rawDy * rawDy));
            if (mag <= 1e-6f)
            {
                return;
            }

            dx += _lagCompensationPx * rawDx / mag;
            dy += _lagCompensationPx * rawDy / mag;
        }

        private static float[] ReadVector(JsonElement element)
        {
            float[] values = new float[element.GetArrayLength()];
            int i = 0;
            foreach (JsonElement item in element.EnumerateArray())
            {
                values[i++] = item.GetSingle();
            }
            return values;
        }

        private static float[] ReadMatrixRows(JsonElement element)
        {
            List<float> values = [];
            foreach (JsonElement row in element.EnumerateArray())
            {
                foreach (JsonElement item in row.EnumerateArray())
                {
                    values.Add(item.GetSingle());
                }
            }
            return values.ToArray();
        }
    }
}
