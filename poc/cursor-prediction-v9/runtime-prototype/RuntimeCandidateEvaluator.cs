using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;

namespace CursorPredictionV9RuntimePrototype
{
    public struct Evaluation
    {
        public float TeacherX;
        public float TeacherY;
        public float GateProbability;
        public bool Apply;
        public float FinalX;
        public float FinalY;
    }

    public static class RuntimeCandidateEvaluator
    {
        public static Evaluation Evaluate(float[] tab, float[] gateFeatures)
        {
            float[] h1 = new float[256];
            float[] h2 = new float[128];
            float[] h3 = new float[64];
            float[] normalizedTab = new float[Phase9RuntimeWeights.TeacherMean.Length];
            for (int i = 0; i < normalizedTab.Length; i++)
            {
                normalizedTab[i] = (tab[i] - Phase9RuntimeWeights.TeacherMean[i]) / Phase9RuntimeWeights.TeacherStd[i];
            }
            LinearRelu(normalizedTab, Phase9RuntimeWeights.TeacherW0, Phase9RuntimeWeights.TeacherB0, h1, 265, 256);
            LinearRelu(h1, Phase9RuntimeWeights.TeacherW1, Phase9RuntimeWeights.TeacherB1, h2, 256, 128);
            LinearRelu(h2, Phase9RuntimeWeights.TeacherW2, Phase9RuntimeWeights.TeacherB2, h3, 128, 64);
            float teacherXNorm = LinearOne(h3, Phase9RuntimeWeights.TeacherW3, Phase9RuntimeWeights.TeacherB3[0], 64, 0);
            float teacherYNorm = LinearOne(h3, Phase9RuntimeWeights.TeacherW3, Phase9RuntimeWeights.TeacherB3[1], 64, 1);
            float teacherX = teacherXNorm * 50.0f;
            float teacherY = teacherYNorm * 50.0f;

            float[] gateInput = new float[7];
            for (int i = 0; i < gateInput.Length; i++)
            {
                gateInput[i] = (gateFeatures[i] - Phase9RuntimeWeights.GateMean[i]) / Phase9RuntimeWeights.GateStd[i];
            }
            float[] gateHidden = new float[8];
            LinearRelu(gateInput, Phase9RuntimeWeights.GateW0, Phase9RuntimeWeights.GateB0, gateHidden, 7, 8);
            float logit = LinearOne(gateHidden, Phase9RuntimeWeights.GateW1, Phase9RuntimeWeights.GateB1[0], 8, 0);
            float probability = Sigmoid(logit);
            bool apply = probability >= 0.90f && gateFeatures[5] * 5000.0f < 1000.0f;
            float finalX = 0.0f;
            float finalY = 0.0f;
            if (apply)
            {
                finalX = teacherX;
                finalY = teacherY;
                Clamp(ref finalX, ref finalY, 4.0f);
            }
            return new Evaluation
            {
                TeacherX = teacherX,
                TeacherY = teacherY,
                GateProbability = probability,
                Apply = apply,
                FinalX = finalX,
                FinalY = finalY,
            };
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

        private static float Sigmoid(float x)
        {
            if (x >= 0)
            {
                float z = (float)Math.Exp(-x);
                return 1.0f / (1.0f + z);
            }
            else
            {
                float z = (float)Math.Exp(x);
                return z / (1.0f + z);
            }
        }

        private static void Clamp(ref float x, ref float y, float cap)
        {
            float mag = (float)Math.Sqrt(x * x + y * y);
            if (mag > cap && mag > 1e-6f)
            {
                float scale = cap / mag;
                x *= scale;
                y *= scale;
            }
        }
    }

    public static class PrototypeRunner
    {
        public static void Run(string outputPath)
        {
            int count = Phase9RuntimeSamples.SampleCount;
            double maxTeacherDiff = 0.0;
            double maxGateDiff = 0.0;
            double maxFinalDiff = 0.0;
            int applyMismatches = 0;
            for (int s = 0; s < count; s++)
            {
                Evaluation e = RuntimeCandidateEvaluator.Evaluate(Phase9RuntimeSamples.GetTab(s), Phase9RuntimeSamples.GetGateFeatures(s));
                double teacherDiff = Math.Max(Math.Abs(e.TeacherX - Phase9RuntimeSamples.ExpectedTeacher[2 * s]), Math.Abs(e.TeacherY - Phase9RuntimeSamples.ExpectedTeacher[2 * s + 1]));
                double gateDiff = Math.Abs(e.GateProbability - Phase9RuntimeSamples.ExpectedGateProbability[s]);
                double finalDiff = Math.Max(Math.Abs(e.FinalX - Phase9RuntimeSamples.ExpectedFinal[2 * s]), Math.Abs(e.FinalY - Phase9RuntimeSamples.ExpectedFinal[2 * s + 1]));
                if (e.Apply != Phase9RuntimeSamples.ExpectedApply[s]) applyMismatches++;
                if (teacherDiff > maxTeacherDiff) maxTeacherDiff = teacherDiff;
                if (gateDiff > maxGateDiff) maxGateDiff = gateDiff;
                if (finalDiff > maxFinalDiff) maxFinalDiff = finalDiff;
            }

            int repeats = 1;
            long evaluations = 0;
            double elapsed = 0.0;
            Evaluation sink = default(Evaluation);
            do
            {
                Stopwatch sw = Stopwatch.StartNew();
                for (int r = 0; r < repeats; r++)
                {
                    for (int s = 0; s < count; s++)
                    {
                        sink = RuntimeCandidateEvaluator.Evaluate(Phase9RuntimeSamples.GetTab(s), Phase9RuntimeSamples.GetGateFeatures(s));
                    }
                }
                sw.Stop();
                evaluations = (long)repeats * count;
                elapsed = sw.Elapsed.TotalSeconds;
                repeats *= 2;
            }
            while (elapsed < 0.35 && evaluations < 8192);

            double rowsPerSec = evaluations / elapsed;
            string json = "{" +
                "\"sampleCount\":" + count.ToString(CultureInfo.InvariantCulture) + "," +
                "\"maxTeacherAbsDiff\":" + maxTeacherDiff.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"maxGateProbabilityAbsDiff\":" + maxGateDiff.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"maxFinalAbsDiff\":" + maxFinalDiff.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"applyMismatches\":" + applyMismatches.ToString(CultureInfo.InvariantCulture) + "," +
                "\"throughputEvaluations\":" + evaluations.ToString(CultureInfo.InvariantCulture) + "," +
                "\"throughputSeconds\":" + elapsed.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"rowsPerSecond\":" + rowsPerSec.ToString("R", CultureInfo.InvariantCulture) + "," +
                "\"vectorHardwareAccelerated\":false," +
                "\"sink\":" + sink.FinalX.ToString("R", CultureInfo.InvariantCulture) +
                "}";
            File.WriteAllText(outputPath, json);
        }
    }
}
