using System.Drawing;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class CursorPositionPredictorTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MOU-14", FirstSampleExactPositioning);
            suite.Add("COT-MOU-15", ConstantVelocityPrediction);
            suite.Add("COT-MOU-16", InvalidTimestampReset);
            suite.Add("COT-MOU-17", IdleReset);
        }

        // Prediction first sample exact positioning [COT-MOU-14]
        private static void FirstSampleExactPositioning()
        {
            CursorPositionPredictor predictor = new CursorPositionPredictor(100);

            predictor.AddSample(100, new Point(10, 20));

            TestAssert.False(predictor.HasVelocity, "first sample must not establish velocity");
            TestAssert.Equal(new Point(10, 20), predictor.PredictRounded(8), "first sample prediction");
        }

        // Constant-velocity prediction [COT-MOU-15]
        private static void ConstantVelocityPrediction()
        {
            CursorPositionPredictor predictor = new CursorPositionPredictor(100);

            predictor.AddSample(0, new Point(-10, 5));
            predictor.AddSample(10, new Point(10, 15));

            TestAssert.True(predictor.HasVelocity, "valid pair must establish velocity");
            TestAssert.Equal(new Point(20, 20), predictor.PredictRounded(5), "5ms prediction");
            TestAssert.Equal(new Point(26, 23), predictor.PredictRounded(8), "8ms prediction");
        }

        // Prediction invalid timestamp reset [COT-MOU-16]
        private static void InvalidTimestampReset()
        {
            CursorPositionPredictor predictor = new CursorPositionPredictor(100);

            predictor.AddSample(10, new Point(0, 0));
            predictor.AddSample(10, new Point(50, 50));

            TestAssert.False(predictor.HasVelocity, "duplicate timestamp must clear velocity");
            TestAssert.Equal(new Point(50, 50), predictor.PredictRounded(8), "duplicate timestamp prediction");

            predictor.AddSample(9, new Point(80, 80));

            TestAssert.False(predictor.HasVelocity, "negative interval must clear velocity");
            TestAssert.Equal(new Point(80, 80), predictor.PredictRounded(8), "negative interval prediction");
        }

        // Prediction idle reset [COT-MOU-17]
        private static void IdleReset()
        {
            CursorPositionPredictor predictor = new CursorPositionPredictor(100);

            predictor.AddSample(0, new Point(0, 0));
            predictor.AddSample(10, new Point(20, 0));
            predictor.AddSample(111, new Point(100, 100));

            TestAssert.False(predictor.HasVelocity, "idle gap must clear velocity");
            TestAssert.Equal(new Point(100, 100), predictor.PredictRounded(8), "idle reset prediction");
        }
    }
}
