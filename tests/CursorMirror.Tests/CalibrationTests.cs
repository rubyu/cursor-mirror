using System.Collections.Generic;
using System.Drawing;

namespace CursorMirror.Tests
{
    internal static class CalibrationTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MCU-5", DarkPixelBoundsDetection);
            suite.Add("COT-MCU-6", CalibrationSummarySeparation);
            suite.Add("COT-MCU-7", CalibrationMotionPatternCoverage);
            suite.Add("COT-MCU-8", CalibrationPatternSummarySeparation);
        }

        // Dark pixel bounds detection [COT-MCU-5]
        private static void DarkPixelBoundsDetection()
        {
            byte[] pixels = WhiteBgra(10, 8);
            SetPixel(pixels, 10, 3, 2, 0, 0, 0);
            SetPixel(pixels, 10, 4, 4, 0, 0, 0);
            SetPixel(pixels, 10, 6, 5, 20, 20, 20);

            CalibrationFrameAnalysis analysis = CalibrationFrameAnalyzer.AnalyzeBgra(
                7,
                123,
                pixels,
                10,
                8,
                40,
                CalibrationFrameAnalyzer.DefaultDarkThreshold);

            TestAssert.True(analysis.HasDarkPixels, "dark pixels detected");
            TestAssert.Equal(3, analysis.DarkBoundsX, "bounds x");
            TestAssert.Equal(2, analysis.DarkBoundsY, "bounds y");
            TestAssert.Equal(4, analysis.DarkBoundsWidth, "bounds width");
            TestAssert.Equal(4, analysis.DarkBoundsHeight, "bounds height");
            TestAssert.Equal(3, analysis.DarkPixelCount, "dark pixel count");
        }

        // Calibration summary separation [COT-MCU-6]
        private static void CalibrationSummarySeparation()
        {
            List<CalibrationFrameAnalysis> frames = new List<CalibrationFrameAnalysis>();
            frames.Add(new CalibrationFrameAnalysis(0, 0, 100, 100, 12, true, 10, 10, 10, 20));
            frames.Add(new CalibrationFrameAnalysis(1, 1, 100, 100, 12, true, 10, 10, 15, 20));
            frames.Add(new CalibrationFrameAnalysis(2, 2, 100, 100, 12, true, 10, 10, 25, 22));

            CalibrationSummary summary = CalibrationRunAnalyzer.Summarize(frames, "test");

            TestAssert.Equal(3, summary.FrameCount, "frame count");
            TestAssert.Equal(3, summary.DarkFrameCount, "dark frame count");
            TestAssert.Equal(10, summary.BaselineDarkBoundsWidth, "baseline width");
            TestAssert.Equal(20, summary.BaselineDarkBoundsHeight, "baseline height");
            TestAssert.Equal(15.0, summary.MaximumEstimatedSeparationPixels, "maximum separation");
            TestAssert.Equal(15.0, summary.P95EstimatedSeparationPixels, "p95 separation");
        }

        // Calibration motion pattern coverage [COT-MCU-7]
        private static void CalibrationMotionPatternCoverage()
        {
            CalibrationMotionPatternSuite suite = CalibrationMotionPatternSuite.CreateDefault(new Rectangle(100, 200, 800, 300));
            string[] names = suite.GetPatternNames();

            TestAssert.True(Contains(names, "linear-slow"), "linear slow pattern");
            TestAssert.True(Contains(names, "linear-fast"), "linear fast pattern");
            TestAssert.True(Contains(names, "quadratic-ease-in"), "quadratic ease-in pattern");
            TestAssert.True(Contains(names, "quadratic-ease-out"), "quadratic ease-out pattern");
            TestAssert.True(Contains(names, "cubic-smoothstep"), "cubic smoothstep pattern");
            TestAssert.True(Contains(names, "cubic-in-out"), "cubic in-out pattern");
            TestAssert.True(Contains(names, "rapid-reversal"), "rapid reversal pattern");
            TestAssert.True(Contains(names, "sine-sweep"), "sine sweep pattern");
            TestAssert.True(Contains(names, "short-jitter"), "short jitter pattern");

            double maximumVelocity = 0;
            for (double elapsed = 0; elapsed < suite.TotalDurationMilliseconds; elapsed += 50)
            {
                CalibrationMotionSample sample = suite.GetSample(elapsed);
                TestAssert.Equal(350, sample.ExpectedY, "expected y");
                if (sample.VelocityPixelsPerSecond > maximumVelocity)
                {
                    maximumVelocity = sample.VelocityPixelsPerSecond;
                }
            }

            TestAssert.True(maximumVelocity > 1000, "fast speed range");
        }

        // Calibration pattern summary separation [COT-MCU-8]
        private static void CalibrationPatternSummarySeparation()
        {
            List<CalibrationFrameAnalysis> frames = new List<CalibrationFrameAnalysis>();
            frames.Add(new CalibrationFrameAnalysis(0, 0, 100, 100, 12, true, 10, 10, 10, 20).WithMotion(new CalibrationMotionSample(0, "linear-slow", "constant-speed", 10, 20, 100)));
            frames.Add(new CalibrationFrameAnalysis(1, 1, 100, 100, 12, true, 10, 10, 12, 20).WithMotion(new CalibrationMotionSample(16, "linear-slow", "constant-speed", 12, 20, 100)));
            frames.Add(new CalibrationFrameAnalysis(2, 2, 100, 100, 12, true, 10, 10, 25, 22).WithMotion(new CalibrationMotionSample(32, "rapid-reversal", "bidirectional", 25, 20, 1200)));

            CalibrationSummary summary = CalibrationRunAnalyzer.Summarize(frames, "test");

            TestAssert.True(summary.PatternSummaries != null, "pattern summaries");
            TestAssert.Equal(2, summary.PatternSummaries.Length, "pattern count");
            TestAssert.Equal("linear-slow", summary.PatternSummaries[0].PatternName, "first pattern");
            TestAssert.Equal(2, summary.PatternSummaries[0].FrameCount, "first pattern frame count");
            TestAssert.Equal(2.0, summary.PatternSummaries[0].MaximumEstimatedSeparationPixels, "first pattern maximum separation");
            TestAssert.Equal("rapid-reversal", summary.PatternSummaries[1].PatternName, "second pattern");
            TestAssert.Equal(15.0, summary.PatternSummaries[1].MaximumEstimatedSeparationPixels, "second pattern maximum separation");
        }

        private static byte[] WhiteBgra(int width, int height)
        {
            byte[] pixels = new byte[width * height * 4];
            for (int i = 0; i < pixels.Length; i += 4)
            {
                pixels[i] = 255;
                pixels[i + 1] = 255;
                pixels[i + 2] = 255;
                pixels[i + 3] = 255;
            }

            return pixels;
        }

        private static void SetPixel(byte[] pixels, int width, int x, int y, byte r, byte g, byte b)
        {
            int index = ((y * width) + x) * 4;
            pixels[index] = b;
            pixels[index + 1] = g;
            pixels[index + 2] = r;
            pixels[index + 3] = 255;
        }

        private static bool Contains(string[] values, string expected)
        {
            for (int i = 0; i < values.Length; i++)
            {
                if (values[i] == expected)
                {
                    return true;
                }
            }

            return false;
        }
    }
}
