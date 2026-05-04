using System;

namespace CursorMirror
{
    internal sealed class ExperimentalMlpPredictionModel
    {
        public const int SequenceLength = 32;
        public const int SequenceFeatureCount = 8;
        public const int ContextFeatureCount = 9;
        public const int TeacherInputCount = SequenceLength * SequenceFeatureCount + ContextFeatureCount;

        private const float OutputScalePixels = 50.0f;
        private const float GateProbabilityThreshold = 0.90f;
        private const float ApplySpeedMaximumPixelsPerSecond = 1000.0f;
        private const float ResidualClampPixels = 4.0f;

        private readonly float[] _normalizedTeacherInput = new float[TeacherInputCount];
        private readonly float[] _teacherHidden0 = new float[256];
        private readonly float[] _teacherHidden1 = new float[128];
        private readonly float[] _teacherHidden2 = new float[64];
        private readonly float[] _gateInput = new float[7];
        private readonly float[] _normalizedGateInput = new float[7];
        private readonly float[] _gateHidden0 = new float[8];

        public bool TryEvaluate(
            float[] teacherInput,
            float alphaBetaCorrectionX,
            float alphaBetaCorrectionY,
            float baselineDisplacementPixels,
            float pathEfficiency,
            float normalizedSpeed,
            float horizonMilliseconds,
            out float correctionX,
            out float correctionY,
            out float gateProbability)
        {
            correctionX = 0.0f;
            correctionY = 0.0f;
            gateProbability = 0.0f;
            if (teacherInput == null || teacherInput.Length != TeacherInputCount)
            {
                return false;
            }

            float teacherX;
            float teacherY;
            EvaluateTeacher(teacherInput, out teacherX, out teacherY);
            if (!IsFinite(teacherX) || !IsFinite(teacherY))
            {
                return false;
            }

            FillGateInput(
                teacherX,
                teacherY,
                alphaBetaCorrectionX,
                alphaBetaCorrectionY,
                baselineDisplacementPixels,
                pathEfficiency,
                normalizedSpeed,
                horizonMilliseconds);

            gateProbability = EvaluateGate(_gateInput);
            if (!IsFinite(gateProbability) ||
                gateProbability < GateProbabilityThreshold ||
                normalizedSpeed * 5000.0f >= ApplySpeedMaximumPixelsPerSecond)
            {
                return false;
            }

            correctionX = teacherX;
            correctionY = teacherY;
            Clamp(ref correctionX, ref correctionY, ResidualClampPixels);
            return true;
        }

        private void EvaluateTeacher(float[] input, out float residualX, out float residualY)
        {
            for (int i = 0; i < _normalizedTeacherInput.Length; i++)
            {
                _normalizedTeacherInput[i] = (input[i] - ExperimentalMlpPredictionWeights.TeacherMean[i]) /
                    SafeStd(ExperimentalMlpPredictionWeights.TeacherStd[i]);
            }

            LinearRelu(
                _normalizedTeacherInput,
                ExperimentalMlpPredictionWeights.TeacherW0,
                ExperimentalMlpPredictionWeights.TeacherB0,
                _teacherHidden0,
                265,
                256);
            LinearRelu(
                _teacherHidden0,
                ExperimentalMlpPredictionWeights.TeacherW1,
                ExperimentalMlpPredictionWeights.TeacherB1,
                _teacherHidden1,
                256,
                128);
            LinearRelu(
                _teacherHidden1,
                ExperimentalMlpPredictionWeights.TeacherW2,
                ExperimentalMlpPredictionWeights.TeacherB2,
                _teacherHidden2,
                128,
                64);

            residualX = LinearOne(_teacherHidden2, ExperimentalMlpPredictionWeights.TeacherW3, ExperimentalMlpPredictionWeights.TeacherB3[0], 64, 0) * OutputScalePixels;
            residualY = LinearOne(_teacherHidden2, ExperimentalMlpPredictionWeights.TeacherW3, ExperimentalMlpPredictionWeights.TeacherB3[1], 64, 1) * OutputScalePixels;
        }

        private void FillGateInput(
            float residualX,
            float residualY,
            float alphaBetaCorrectionX,
            float alphaBetaCorrectionY,
            float baselineDisplacementPixels,
            float pathEfficiency,
            float normalizedSpeed,
            float horizonMilliseconds)
        {
            float residualMagnitude = Magnitude(residualX, residualY);
            float alphaBetaMagnitude = Magnitude(alphaBetaCorrectionX, alphaBetaCorrectionY);
            float cosine = -1.0f;
            if (residualMagnitude >= 0.0001f && alphaBetaMagnitude >= 0.5f)
            {
                cosine = (residualX * alphaBetaCorrectionX + residualY * alphaBetaCorrectionY) /
                    Math.Max(residualMagnitude * alphaBetaMagnitude, 0.000001f);
                if (cosine > 1.0f)
                {
                    cosine = 1.0f;
                }
                else if (cosine < -1.0f)
                {
                    cosine = -1.0f;
                }
            }

            _gateInput[0] = residualMagnitude;
            _gateInput[1] = cosine;
            _gateInput[2] = alphaBetaMagnitude;
            _gateInput[3] = baselineDisplacementPixels;
            _gateInput[4] = Math.Max(0.0f, Math.Min(1.0f, pathEfficiency));
            _gateInput[5] = normalizedSpeed;
            _gateInput[6] = horizonMilliseconds;
        }

        private float EvaluateGate(float[] input)
        {
            for (int i = 0; i < _normalizedGateInput.Length; i++)
            {
                _normalizedGateInput[i] = (input[i] - ExperimentalMlpPredictionWeights.GateMean[i]) /
                    SafeStd(ExperimentalMlpPredictionWeights.GateStd[i]);
            }

            LinearRelu(
                _normalizedGateInput,
                ExperimentalMlpPredictionWeights.GateW0,
                ExperimentalMlpPredictionWeights.GateB0,
                _gateHidden0,
                7,
                8);
            float logit = LinearOne(_gateHidden0, ExperimentalMlpPredictionWeights.GateW1, ExperimentalMlpPredictionWeights.GateB1[0], 8, 0);
            return Sigmoid(logit);
        }

        private static void LinearRelu(float[] input, float[] weights, float[] bias, float[] output, int inputSize, int outputSize)
        {
            for (int o = 0; o < outputSize; o++)
            {
                float sum = bias[o];
                int offset = o * inputSize;
                for (int i = 0; i < inputSize; i++)
                {
                    sum += weights[offset + i] * input[i];
                }

                output[o] = sum > 0.0f ? sum : 0.0f;
            }
        }

        private static float LinearOne(float[] input, float[] weights, float bias, int inputSize, int outputIndex)
        {
            float sum = bias;
            int offset = outputIndex * inputSize;
            for (int i = 0; i < inputSize; i++)
            {
                sum += weights[offset + i] * input[i];
            }

            return sum;
        }

        private static float Sigmoid(float value)
        {
            if (value >= 0.0f)
            {
                float z = (float)Math.Exp(-value);
                return 1.0f / (1.0f + z);
            }

            float negativeZ = (float)Math.Exp(value);
            return negativeZ / (1.0f + negativeZ);
        }

        private static void Clamp(ref float x, ref float y, float cap)
        {
            float magnitude = Magnitude(x, y);
            if (magnitude <= cap || magnitude <= 0.000001f)
            {
                return;
            }

            float scale = cap / magnitude;
            x *= scale;
            y *= scale;
        }

        private static float Magnitude(float x, float y)
        {
            return (float)Math.Sqrt(x * x + y * y);
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
