const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const candidatePath = path.join(root, "poc", "cursor-prediction-v16", "runtime", "selected-candidate.json");
const outputPath = path.join(root, "src", "CursorMirror.Core", "DistilledMlpPredictionModel.g.cs");
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
const runtime = candidate.runtime;
const source = candidate.sourceNormalization;
const layers = runtime.layers;

function flatten(matrix) {
  return matrix.flat();
}

function formatFloat(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`non-finite value: ${value}`);
  }
  if (Object.is(value, -0)) {
    value = 0;
  }
  const text = Math.abs(value) === 0 ? "0" : value.toPrecision(9).replace(/\.?0+($|e)/, "$1");
  return `${text}f`;
}

function array(name, values) {
  return `        private static readonly float[] ${name} = new float[] { ${values.map(formatFloat).join(", ")} };\n`;
}

const csharp = `// Generated from poc/cursor-prediction-v16/runtime/selected-candidate.json.
// Model: ${candidate.modelId}
using System;

namespace CursorMirror
{
    internal sealed class DistilledMlpPredictionModel
    {
        public const string ModelId = "${candidate.modelId}";
        public const int ScalarFeatureCount = ${source.scalarFeatureCount};
        public const int SequenceLength = ${source.sequenceLength};
        public const int SequenceFeatureCount = ${source.sequenceFeatureCount};
        public const int FeatureCount = ${runtime.featureMean.length};
        public const int Hidden = ${runtime.hidden};
        public const float QuantizationStep = ${formatFloat(runtime.quantizationStep)};
        public const float LagCompensationPixels = ${formatFloat(runtime.lagCompensationPx)};
        public const int EstimatedMacs = ${candidate.cost.estimatedMacs};
        public const int ParameterCount = ${candidate.cost.parameterCount};

${array("SourceScalarMean", source.scalarMean)}${array("SourceScalarStd", source.scalarStd)}${array("SourceSequenceMean", source.sequenceMean)}${array("SourceSequenceStd", source.sequenceStd)}${array("FeatureMean", runtime.featureMean)}${array("FeatureStd", runtime.featureStd)}${array("TargetScale", runtime.targetScale)}${array("W0", flatten(layers.inputHidden.weights))}${array("B0", layers.inputHidden.bias)}${array("W1", flatten(layers.hiddenHidden.weights))}${array("B1", layers.hiddenHidden.bias)}${array("W2", flatten(layers.hiddenOutput.weights))}${array("B2", layers.hiddenOutput.bias)}
        private readonly float[] _normalizedScalar = new float[ScalarFeatureCount];
        private readonly float[] _normalizedSequence = new float[SequenceLength * SequenceFeatureCount];
        private readonly float[] _features = new float[FeatureCount];
        private readonly float[] _hidden0 = new float[Hidden];
        private readonly float[] _hidden1 = new float[Hidden];
        private readonly float[] _decaySums = new float[SequenceFeatureCount];

        public bool TryEvaluate(float[] scalar, float[] sequence, out float dx, out float dy)
        {
            dx = 0.0f;
            dy = 0.0f;
            if (scalar == null || sequence == null ||
                scalar.Length != ScalarFeatureCount ||
                sequence.Length != SequenceLength * SequenceFeatureCount)
            {
                return false;
            }

            for (int i = 0; i < ScalarFeatureCount; i++)
            {
                _normalizedScalar[i] = (scalar[i] - SourceScalarMean[i]) / SafeStd(SourceScalarStd[i]);
            }

            for (int row = 0; row < SequenceLength; row++)
            {
                int rowOffset = row * SequenceFeatureCount;
                for (int d = 0; d < SequenceFeatureCount; d++)
                {
                    int index = rowOffset + d;
                    _normalizedSequence[index] = (sequence[index] - SourceSequenceMean[d]) / SafeStd(SourceSequenceStd[d]);
                }
            }

            EvaluateNormalized(_normalizedScalar, _normalizedSequence, out dx, out dy);
            return IsFinite(dx) && IsFinite(dy);
        }

        private void EvaluateNormalized(float[] scalar, float[] sequence, out float dx, out float dy)
        {
            BuildFsmnFeatures(scalar, sequence, _features);
            for (int i = 0; i < FeatureCount; i++)
            {
                _features[i] = (_features[i] - FeatureMean[i]) / SafeStd(FeatureStd[i]);
            }

            Dense(_features, W0, B0, _hidden0, FeatureCount, Hidden);
            HardTanh(_hidden0);
            Dense(_hidden0, W1, B1, _hidden1, Hidden, Hidden);
            HardTanh(_hidden1);

            dx = B2[0];
            dy = B2[1];
            for (int i = 0; i < Hidden; i++)
            {
                dx += _hidden1[i] * W2[i];
                dy += _hidden1[i] * W2[Hidden + i];
            }

            dx *= TargetScale[0];
            dy *= TargetScale[1];
            dx = Quantize(dx);
            dy = Quantize(dy);
            ApplyLagCompensation(scalar, ref dx, ref dy);
        }

        private void BuildFsmnFeatures(float[] scalar, float[] sequence, float[] destination)
        {
            int offset = 0;
            for (int i = 0; i < ScalarFeatureCount; i++)
            {
                destination[offset++] = scalar[i];
            }

            int last = (SequenceLength - 1) * SequenceFeatureCount;
            for (int d = 0; d < SequenceFeatureCount; d++)
            {
                destination[offset++] = sequence[last + d];
            }

            AddDecay(sequence, destination, ref offset, 2.0f);
            AddDecay(sequence, destination, ref offset, 4.0f);
            AddDecay(sequence, destination, ref offset, 8.0f);
            AddMean(sequence, destination, ref offset, 4);
            AddMean(sequence, destination, ref offset, 8);
        }

        private void AddDecay(float[] sequence, float[] destination, ref int offset, float decay)
        {
            float total = 0.0f;
            for (int d = 0; d < SequenceFeatureCount; d++)
            {
                _decaySums[d] = 0.0f;
            }

            for (int row = 0; row < SequenceLength; row++)
            {
                float weight = (float)Math.Exp(-(SequenceLength - 1 - row) / decay);
                total += weight;
                int rowOffset = row * SequenceFeatureCount;
                for (int d = 0; d < SequenceFeatureCount; d++)
                {
                    _decaySums[d] += weight * sequence[rowOffset + d];
                }
            }

            for (int d = 0; d < SequenceFeatureCount; d++)
            {
                destination[offset++] = _decaySums[d] / total;
            }
        }

        private static void AddMean(float[] sequence, float[] destination, ref int offset, int count)
        {
            int start = SequenceLength - count;
            for (int d = 0; d < SequenceFeatureCount; d++)
            {
                float sum = 0.0f;
                for (int row = start; row < SequenceLength; row++)
                {
                    sum += sequence[(row * SequenceFeatureCount) + d];
                }

                destination[offset++] = sum / count;
            }
        }

        private static void Dense(float[] input, float[] weights, float[] bias, float[] output, int inputCount, int outputCount)
        {
            for (int row = 0; row < outputCount; row++)
            {
                float value = bias[row];
                int weightOffset = row * inputCount;
                for (int i = 0; i < inputCount; i++)
                {
                    value += input[i] * weights[weightOffset + i];
                }

                output[row] = value;
            }
        }

        private static void HardTanh(float[] values)
        {
            for (int i = 0; i < values.Length; i++)
            {
                if (values[i] > 1.0f)
                {
                    values[i] = 1.0f;
                }
                else if (values[i] < -1.0f)
                {
                    values[i] = -1.0f;
                }
            }
        }

        private static float Quantize(float value)
        {
            return (float)Math.Round(value / QuantizationStep) * QuantizationStep;
        }

        private static void ApplyLagCompensation(float[] normalizedScalar, ref float dx, ref float dy)
        {
            float rawDx = (normalizedScalar[17] * SafeStd(SourceScalarStd[17])) + SourceScalarMean[17];
            float rawDy = (normalizedScalar[18] * SafeStd(SourceScalarStd[18])) + SourceScalarMean[18];
            float magnitude = (float)Math.Sqrt(rawDx * rawDx + rawDy * rawDy);
            if (magnitude <= 0.000001f)
            {
                return;
            }

            dx += LagCompensationPixels * rawDx / magnitude;
            dy += LagCompensationPixels * rawDy / magnitude;
        }

        private static float SafeStd(float value)
        {
            return Math.Abs(value) < 0.000001f ? 1.0f : value;
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }
    }
}
`;

fs.writeFileSync(outputPath, csharp, "ascii");
console.log(outputPath);
