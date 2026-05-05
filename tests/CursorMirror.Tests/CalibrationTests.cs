using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using CursorMirror.Calibrator;
using CursorMirror.MotionLab;

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
            suite.Add("COT-MCU-9", CalibrationRuntimeModeParsing);
            suite.Add("COT-MCU-10", RealCursorDriverMarkersAreDistinct);
            suite.Add("COT-MCU-11", MotionLabCalibrationMotionSourceLoadsPackage);
            suite.Add("COT-MCU-12", CalibrationPackageIncludesMotionLabContext);
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
            TestAssert.True(summary.PhaseSummaries != null, "phase summaries");
            TestAssert.Equal(2, summary.PhaseSummaries.Length, "phase count");
            TestAssert.Equal("linear-slow", summary.PatternSummaries[0].PatternName, "first pattern");
            TestAssert.Equal(2, summary.PatternSummaries[0].FrameCount, "first pattern frame count");
            TestAssert.Equal(2.0, summary.PatternSummaries[0].MaximumEstimatedSeparationPixels, "first pattern maximum separation");
            TestAssert.Equal("rapid-reversal", summary.PatternSummaries[1].PatternName, "second pattern");
            TestAssert.Equal(15.0, summary.PatternSummaries[1].MaximumEstimatedSeparationPixels, "second pattern maximum separation");
        }

        // Real cursor driver marker separation [COT-MCU-10]
        private static void RealCursorDriverMarkersAreDistinct()
        {
            TestAssert.False(RealCursorDriver.CalibratorInjectionExtraInfo == IntPtr.Zero, "calibrator marker");
            TestAssert.False(RealCursorDriver.DemoInjectionExtraInfo == IntPtr.Zero, "demo marker");
            TestAssert.False(RealCursorDriver.MotionLabInjectionExtraInfo == IntPtr.Zero, "motion lab marker");
            TestAssert.False(RealCursorDriver.CalibratorInjectionExtraInfo == RealCursorDriver.DemoInjectionExtraInfo, "calibrator/demo marker distinct");
            TestAssert.False(RealCursorDriver.CalibratorInjectionExtraInfo == RealCursorDriver.MotionLabInjectionExtraInfo, "calibrator/motion lab marker distinct");
            TestAssert.False(RealCursorDriver.DemoInjectionExtraInfo == RealCursorDriver.MotionLabInjectionExtraInfo, "demo/motion lab marker distinct");
        }

        // MotionLab package-backed calibration source [COT-MCU-11]
        private static void MotionLabCalibrationMotionSourceLoadsPackage()
        {
            string path = Path.Combine(Path.GetTempPath(), "cursor-mirror-motionlab-calibration-" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                MotionLabScenarioSet scenarioSet = MotionLabGenerator.GenerateScenarioSet(
                    2468,
                    new Rectangle(100, 200, 320, 240),
                    new Point(120, 220),
                    2,
                    4,
                    3,
                    600,
                    60,
                    MotionLabGenerationProfile.RealTraceWeighted);
                new MotionLabPackageWriter().Write(path, scenarioSet);

                MotionLabCalibrationMotionSource source = MotionLabCalibrationMotionSource.LoadPackage(path);
                CalibrationMotionSample first = source.GetSample(0);
                CalibrationMotionSample second = source.GetSample(700);

                TestAssert.Equal("motion-lab", source.SourceName, "source name");
                TestAssert.Equal(MotionLabGenerationProfile.RealTraceWeighted, source.GenerationProfile, "generation profile");
                TestAssert.Equal(2, source.ScenarioCount, "scenario count");
                TestAssert.True(source.TotalDurationMilliseconds >= 1200, "total duration");
                TestAssert.Equal("scenario-000", first.PatternName, "first scenario pattern");
                TestAssert.Equal(0, first.ScenarioIndex, "first scenario index");
                TestAssert.Equal("scenario-001", second.PatternName, "second scenario pattern");
                TestAssert.Equal(1, second.ScenarioIndex, "second scenario index");
                TestAssert.Equal("motion-lab", first.MotionSourceName, "sample source name");
                TestAssert.True(first.ExpectedX >= 100 && first.ExpectedX <= 420, "expected x within bounds");
            }
            finally
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
        }

        // Calibration packages include MotionLab alignment context [COT-MCU-12]
        private static void CalibrationPackageIncludesMotionLabContext()
        {
            string path = Path.Combine(Path.GetTempPath(), "cursor-mirror-calibration-context-" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                List<CalibrationFrameAnalysis> frames = new List<CalibrationFrameAnalysis>();
                frames.Add(new CalibrationFrameAnalysis(0, 0, 100, 100, 12, true, 10, 10, 10, 20).WithMotion(new CalibrationMotionSample(
                    0,
                    "scenario-000",
                    MotionLabMovementPhase.Hold,
                    10,
                    20,
                    0,
                    "motion-lab",
                    MotionLabGenerationProfile.RealTraceWeighted,
                    0,
                    0,
                    0.25,
                    2,
                    100)));

                CalibrationSummary summary = CalibrationRunAnalyzer.Summarize(frames, "test");
                summary.MotionSourceName = "motion-lab";
                summary.MotionGenerationProfile = MotionLabGenerationProfile.RealTraceWeighted;
                summary.MotionScenarioCount = 1;
                summary.MotionDurationMilliseconds = 600;
                new CalibrationPackageWriter().Write(path, frames, summary);

                using (FileStream file = File.OpenRead(path))
                using (ZipArchive archive = new ZipArchive(file, ZipArchiveMode.Read))
                {
                    string framesCsv;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("frames.csv").Open()))
                    {
                        framesCsv = reader.ReadToEnd();
                    }

                    string metricsJson;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("metrics.json").Open()))
                    {
                        metricsJson = reader.ReadToEnd();
                    }

                    TestAssert.True(framesCsv.Contains("motionSourceName,generationProfile,patternName,phaseName,scenarioIndex"), "MotionLab frame header");
                    TestAssert.True(framesCsv.Contains("motion-lab,real-trace-weighted,scenario-000,hold,0"), "MotionLab frame row");
                    TestAssert.True(metricsJson.Contains("\"MotionSourceName\":\"motion-lab\""), "summary motion source");
                    TestAssert.True(metricsJson.Contains("\"MotionScenarioCount\":1"), "summary scenario count");
                    TestAssert.True(metricsJson.Contains("\"PhaseSummaries\""), "summary phase groups");
                }
            }
            finally
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
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

        // Calibration runtime mode parsing and normalization [COT-MCU-9]
        private static void CalibrationRuntimeModeParsing()
        {
            int runtimeMode;

            TestAssert.Equal(CalibrationRuntimeMode.ProductRuntime, CalibrationRuntimeMode.Default, "default runtime mode");
            TestAssert.True(CalibrationRuntimeMode.TryParse("ProductRuntime", out runtimeMode), "product runtime parse");
            TestAssert.Equal(CalibrationRuntimeMode.ProductRuntime, runtimeMode, "product runtime value");
            TestAssert.True(CalibrationRuntimeMode.TryParse("simple-timer", out runtimeMode), "simple timer parse");
            TestAssert.Equal(CalibrationRuntimeMode.SimpleTimer, runtimeMode, "simple timer value");
            TestAssert.Equal(CalibrationRuntimeMode.ProductRuntime, CalibrationRuntimeMode.Normalize(999), "unknown runtime mode normalizes to product");
            TestAssert.Equal("ProductRuntime", CalibrationRuntimeMode.ToExternalName(CalibrationRuntimeMode.ProductRuntime), "product runtime external name");
            TestAssert.Equal("SimpleTimer", CalibrationRuntimeMode.ToExternalName(CalibrationRuntimeMode.SimpleTimer), "simple timer external name");

            CalibratorRunOptions defaultOptions = CalibratorRunOptions.FromArguments(new string[0]);
            TestAssert.Equal(CalibrationRuntimeMode.ProductRuntime, defaultOptions.RuntimeMode, "default options runtime mode");

            CalibratorRunOptions simpleOptions = CalibratorRunOptions.FromArguments(new[] { "--runtime-mode", "SimpleTimer" });
            TestAssert.Equal(CalibrationRuntimeMode.SimpleTimer, simpleOptions.RuntimeMode, "runtime mode option");

            CalibratorRunOptions productOptions = CalibratorRunOptions.FromArguments(new[] { "--simple-runtime", "--product-runtime" });
            TestAssert.Equal(CalibrationRuntimeMode.ProductRuntime, productOptions.RuntimeMode, "product runtime switch");

            CalibratorRunOptions predictionOptions = CalibratorRunOptions.FromArguments(new[] { "--dwm-target-offset-ms", "3" });
            TestAssert.Equal(3, predictionOptions.DwmPredictionTargetOffsetMilliseconds.Value, "DWM prediction target offset option");

            CalibratorRunOptions runtimeEventSafeOptions = CalibratorRunOptions.FromArguments(new[] { "--dwm-prediction-model", "RuntimeEventSafeMLP" });
            TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelRuntimeEventSafeMlp, runtimeEventSafeOptions.DwmPredictionModel.Value, "runtime event-safe MLP prediction model option");

            CalibratorRunOptions outlierOptions = CalibratorRunOptions.FromArguments(new[] { "--product-runtime-outlier-output", "product-runtime.zip" });
            TestAssert.Equal("product-runtime.zip", outlierOptions.ProductRuntimeOutlierOutputPath, "product runtime outlier output option");

            CalibratorRunOptions noDisplayCaptureOptions = CalibratorRunOptions.FromArguments(new[] { "--no-display-capture" });
            TestAssert.True(noDisplayCaptureOptions.DisableDisplayCapture, "no display capture option");

            CalibratorRunOptions motionPackageOptions = CalibratorRunOptions.FromArguments(new[] { "--motion-package", "motion.zip" });
            TestAssert.Equal("motion.zip", motionPackageOptions.MotionPackagePath, "motion package option");

            CalibratorRunOptions runtimeSchedulerOptions = CalibratorRunOptions.FromArguments(new[]
            {
                "--runtime-wake-advance-ms", "3",
                "--runtime-fine-wait-us", "1000",
                "--runtime-yield-threshold-us", "250",
                "--runtime-deadline-message-deferral-us", "750",
                "--runtime-set-waitable-timer-ex",
                "--runtime-thread-latency-profile"
            });
            TestAssert.Equal(3, runtimeSchedulerOptions.RuntimeWakeAdvanceMilliseconds.Value, "runtime wake advance option");
            TestAssert.Equal(1000, runtimeSchedulerOptions.RuntimeFineWaitAdvanceMicroseconds.Value, "runtime fine wait option");
            TestAssert.Equal(250, runtimeSchedulerOptions.RuntimeFineWaitYieldThresholdMicroseconds.Value, "runtime yield threshold option");
            TestAssert.Equal(750, runtimeSchedulerOptions.RuntimeDeadlineMessageDeferralMicroseconds.Value, "runtime deadline message deferral option");
            TestAssert.True(runtimeSchedulerOptions.RuntimePreferSetWaitableTimerEx.Value, "runtime set waitable timer ex option");
            TestAssert.True(runtimeSchedulerOptions.RuntimeUseThreadLatencyProfile.Value, "runtime thread latency profile option");
        }
    }
}
