using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Runtime.InteropServices;
using CursorMirror.MotionLab;
using CursorMirror.MouseTrace;

namespace CursorMirror.Tests
{
    internal static class MotionLabTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MNU-1", DeterministicBezierGeneration);
            suite.Add("COT-MNU-2", GenerationClipsToBounds);
            suite.Add("COT-MNU-3", SpeedProfileInfluencesSampling);
            suite.Add("COT-MNU-4", MotionPackageContents);
            suite.Add("COT-MNU-5", RealTraceWeightedGenerationProfile);
            suite.Add("COT-MNU-6", MotionPackageWithTraceContents);
            suite.Add("COT-MNU-7", ScenarioSetGenerationAndSampling);
            suite.Add("COT-MNU-8", ScenarioSetPackageContents);
            suite.Add("COT-MNU-9", ScenarioSetSeedSplittingIsDeterministic);
            suite.Add("COT-MNU-10", HoldSegmentsPauseSampling);
            suite.Add("COT-MNU-11", MotionSamplesIncludeTransitionTelemetry);
            suite.Add("COT-MNU-12", MotionLabInputBlockerAllowsOnlyGeneratedMouseInput);
        }

        // Scenario set generation and sampling [COT-MNU-7]
        private static void ScenarioSetGenerationAndSampling()
        {
            Rectangle bounds = new Rectangle(0, 0, 640, 480);
            MotionLabScenarioSet scenarioSet = MotionLabGenerator.GenerateScenarioSet(
                2468,
                bounds,
                new Point(100, 120),
                4,
                6,
                5,
                2000,
                240,
                MotionLabGenerationProfile.RealTraceWeighted);

            TestAssert.Equal(4, scenarioSet.Scenarios.Length, "scenario count");
            TestAssert.Equal(2000.0, scenarioSet.ScenarioDurationMilliseconds, "scenario duration");
            TestAssert.Equal(8000.0, scenarioSet.DurationMilliseconds, "total duration");
            MotionLabScenarioSetSampler sampler = new MotionLabScenarioSetSampler(scenarioSet);
            TestAssert.Equal(4, sampler.ScenarioCount, "sampler scenario count");
            TestAssert.Equal(0, sampler.GetSample(0).ScenarioIndex, "first scenario");
            TestAssert.Equal(2, sampler.GetSample(4500).ScenarioIndex, "middle scenario");
            TestAssert.Equal(3, sampler.GetSample(8000).ScenarioIndex, "final scenario");
        }

        // Scenario set package contents [COT-MNU-8]
        private static void ScenarioSetPackageContents()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "motion-scenarios.zip");
                MotionLabScenarioSet scenarioSet = MotionLabGenerator.GenerateScenarioSet(
                    1357,
                    new Rectangle(0, 0, 320, 240),
                    new Point(12, 34),
                    3,
                    5,
                    3,
                    3000,
                    60,
                    MotionLabGenerationProfile.Balanced);
                new MotionLabPackageWriter().Write(path, scenarioSet);

                using (FileStream stream = File.OpenRead(path))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    TestAssert.True(archive.GetEntry("motion-script.json") != null, "script entry");
                    TestAssert.True(archive.GetEntry("motion-samples.csv") != null, "samples entry");
                    TestAssert.True(archive.GetEntry("metadata.json") != null, "metadata entry");

                    string script;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("motion-script.json").Open()))
                    {
                        script = reader.ReadToEnd();
                    }

                    TestAssert.True(script.Contains("cursor-mirror-motion-scenarios"), "scenario set schema");
                    TestAssert.True(script.Contains("ScenarioDurationMilliseconds"), "scenario duration in script");
                    TestAssert.True(script.Contains("HoldSegments"), "hold segments in script");

                    string csv;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("motion-samples.csv").Open()))
                    {
                        csv = reader.ReadToEnd();
                    }

                    TestAssert.True(csv.Contains("scenarioIndex,scenarioElapsedMilliseconds"), "scenario sample csv header");

                    string metadata;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("metadata.json").Open()))
                    {
                        metadata = reader.ReadToEnd();
                    }

                    TestAssert.True(metadata.Contains("ScenarioDurationMilliseconds"), "scenario duration in metadata");
                    TestAssert.True(metadata.Contains("HoldSegmentCount"), "hold segment count in metadata");
                }
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Scenario set seed splitting is deterministic [COT-MNU-9]
        private static void ScenarioSetSeedSplittingIsDeterministic()
        {
            Rectangle bounds = new Rectangle(0, 0, 640, 480);
            MotionLabScenarioSet first = MotionLabGenerator.GenerateScenarioSet(
                777,
                bounds,
                new Point(100, 120),
                64,
                5,
                3,
                1000,
                120,
                MotionLabGenerationProfile.Balanced);
            MotionLabScenarioSet second = MotionLabGenerator.GenerateScenarioSet(
                777,
                bounds,
                new Point(100, 120),
                64,
                5,
                3,
                1000,
                120,
                MotionLabGenerationProfile.Balanced);

            HashSet<int> scenarioSeeds = new HashSet<int>();
            for (int i = 0; i < first.Scenarios.Length; i++)
            {
                TestAssert.True(scenarioSeeds.Add(first.Scenarios[i].Seed), "scenario seeds are distinct");
                TestAssert.Equal(first.Scenarios[i].Seed, second.Scenarios[i].Seed, "scenario seed deterministic");
                TestAssert.Equal(first.Scenarios[i].ControlPoints[1].X, second.Scenarios[i].ControlPoints[1].X, "scenario point deterministic");
                TestAssert.Equal(first.Scenarios[i].ControlPoints[1].Y, second.Scenarios[i].ControlPoints[1].Y, "scenario point deterministic");
            }
        }

        // Hold segments pause progress and resume motion [COT-MNU-10]
        private static void HoldSegmentsPauseSampling()
        {
            MotionLabScript script = new MotionLabScript();
            script.Bounds = new MotionLabBounds { X = 0, Y = 0, Width = 100, Height = 100 };
            script.DurationMilliseconds = 1000;
            script.SampleRateHz = 100;
            script.ControlPoints = new[] { new MotionLabPoint(0, 0), new MotionLabPoint(100, 0) };
            script.SpeedPoints = new MotionLabSpeedPoint[0];
            script.HoldSegments = new[]
            {
                new MotionLabHoldSegment { Progress = 0.5, DurationMilliseconds = 200, ResumeEasingMilliseconds = 100 }
            };

            MotionLabSampler sampler = new MotionLabSampler(script);
            MotionLabSample beforeHold = sampler.GetSample(350);
            MotionLabSample holdMiddle = sampler.GetSample(500);
            MotionLabSample resumeMiddle = sampler.GetSample(650);
            MotionLabSample afterResume = sampler.GetSample(700);

            TestAssert.True(beforeHold.X < 50.0, "motion has not reached hold before hold start");
            TestAssert.Equal(MotionLabMovementPhase.Moving, beforeHold.MovementPhase, "before hold phase");
            TestAssert.Equal(50.0, holdMiddle.X, "hold x");
            TestAssert.Equal(0.5, holdMiddle.Progress, "hold progress");
            TestAssert.Equal(0.0, holdMiddle.VelocityPixelsPerSecond, "hold velocity");
            TestAssert.Equal(MotionLabMovementPhase.Hold, holdMiddle.MovementPhase, "hold phase");
            TestAssert.Equal(0, holdMiddle.HoldIndex, "hold index");
            TestAssert.Equal(100.0, holdMiddle.PhaseElapsedMilliseconds, "hold phase elapsed");
            TestAssert.Equal(MotionLabMovementPhase.Resume, resumeMiddle.MovementPhase, "resume phase");
            TestAssert.Equal(0, resumeMiddle.HoldIndex, "resume hold index");
            TestAssert.Equal(50.0, resumeMiddle.PhaseElapsedMilliseconds, "resume phase elapsed");
            TestAssert.True(afterResume.X > 50.0, "motion resumes after hold");
        }

        // Motion samples include transition telemetry [COT-MNU-11]
        private static void MotionSamplesIncludeTransitionTelemetry()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "motion-scenarios.zip");
                MotionLabScenarioSet scenarioSet = MotionLabGenerator.GenerateScenarioSet(
                    1357,
                    new Rectangle(0, 0, 320, 240),
                    new Point(12, 34),
                    2,
                    5,
                    3,
                    3000,
                    60,
                    MotionLabGenerationProfile.RealTraceWeighted);
                new MotionLabPackageWriter().Write(path, scenarioSet);

                using (FileStream stream = File.OpenRead(path))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    string csv;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("motion-samples.csv").Open()))
                    {
                        csv = reader.ReadToEnd();
                    }

                    TestAssert.True(csv.Contains("movementPhase,holdIndex,phaseElapsedMilliseconds"), "transition telemetry header");

                    string metadata;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("metadata.json").Open()))
                    {
                        metadata = reader.ReadToEnd();
                    }

                    TestAssert.True(metadata.Contains("\"MotionSampleFormatVersion\":3"), "motion sample format version");
                }
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Motion Lab input blocker allows only generated mouse input [COT-MNU-12]
        private static void MotionLabInputBlockerAllowsOnlyGeneratedMouseInput()
        {
            FakeWindowsHookNativeMethods nativeMethods = new FakeWindowsHookNativeMethods();
            using (MotionLabInputBlocker blocker = new MotionLabInputBlocker(RealCursorDriver.MotionLabInjectionExtraInfo, nativeMethods))
            {
                blocker.Start();
                TestAssert.True(blocker.IsActive, "input blocker active");

                IntPtr generated = InvokeMouseHook(nativeMethods, RealCursorDriver.MotionLabInjectionExtraInfo);
                TestAssert.Equal(nativeMethods.NextResult, generated, "generated Motion Lab input passes through");
                TestAssert.Equal(1, nativeMethods.CallNextCallCount, "generated input calls next hook");

                IntPtr userInput = InvokeMouseHook(nativeMethods, IntPtr.Zero);
                TestAssert.Equal(new IntPtr(1), userInput, "user mouse input is cancelled");
                TestAssert.Equal(1, nativeMethods.CallNextCallCount, "cancelled user input does not call next hook");
            }

            TestAssert.Equal(1, nativeMethods.UnhookCallCount, "input blocker unhooked");
        }

        private static IntPtr InvokeMouseHook(FakeWindowsHookNativeMethods nativeMethods, IntPtr extraInfo)
        {
            LowLevelMouseHook.MSLLHOOKSTRUCT data = new LowLevelMouseHook.MSLLHOOKSTRUCT();
            data.pt.x = 100;
            data.pt.y = 200;
            data.dwExtraInfo = extraInfo;
            IntPtr dataPointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(LowLevelMouseHook.MSLLHOOKSTRUCT)));
            try
            {
                Marshal.StructureToPtr(data, dataPointer, false);
                return nativeMethods.Callback(WindowsHook.HC_ACTION, new IntPtr((int)LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE), dataPointer);
            }
            finally
            {
                Marshal.FreeHGlobal(dataPointer);
            }
        }

        // Real-trace weighted generation profile [COT-MNU-5]
        private static void RealTraceWeightedGenerationProfile()
        {
            Rectangle bounds = new Rectangle(0, 0, 800, 600);
            MotionLabScript script = MotionLabGenerator.Generate(
                9876,
                bounds,
                new Point(100, 200),
                8,
                8,
                12000,
                240,
                MotionLabGenerationProfile.RealTraceWeighted);

            TestAssert.Equal(MotionLabGenerationProfile.RealTraceWeighted, script.GenerationProfile, "generation profile");
            bool hasVerySlowPoint = false;
            for (int i = 0; i < script.SpeedPoints.Length; i++)
            {
                if (script.SpeedPoints[i].Multiplier <= 0.22)
                {
                    hasVerySlowPoint = true;
                    break;
                }
            }

            TestAssert.True(hasVerySlowPoint, "real-trace weighted profile includes very slow speed points");
            TestAssert.True(script.HoldSegments.Length > 0, "real-trace weighted profile includes hold segments");
            MotionLabScript second = MotionLabGenerator.Generate(
                9876,
                bounds,
                new Point(100, 200),
                8,
                8,
                12000,
                240,
                MotionLabGenerationProfile.RealTraceWeighted);
            TestAssert.Equal(script.HoldSegments.Length, second.HoldSegments.Length, "hold count deterministic");
            TestAssert.Equal(script.HoldSegments[0].Progress, second.HoldSegments[0].Progress, "hold progress deterministic");
            TestAssert.Equal(script.HoldSegments[0].DurationMilliseconds, second.HoldSegments[0].DurationMilliseconds, "hold duration deterministic");
        }

        // Motion package with trace contents [COT-MNU-6]
        private static void MotionPackageWithTraceContents()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "motion-recording.zip");
                MotionLabScript script = MotionLabGenerator.Generate(
                    88,
                    new Rectangle(0, 0, 320, 240),
                    new Point(12, 34),
                    5,
                    3,
                    500,
                    60,
                    MotionLabGenerationProfile.RealTraceWeighted);
                MouseTraceSession session = new MouseTraceSession();
                long startTicks = Stopwatch.GetTimestamp();
                session.Start(startTicks, 8, 2, 1, true);
                session.AddPoll(startTicks, new Point(12, 34), false, new DwmTimingInfo());
                session.AddReferencePoll(startTicks + 1, new Point(13, 35));
                session.Stop(startTicks + 2);

                new MotionLabPackageWriter().Write(path, script, session.Snapshot());

                using (FileStream stream = File.OpenRead(path))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    TestAssert.True(archive.GetEntry("motion-script.json") != null, "script entry");
                    TestAssert.True(archive.GetEntry("motion-samples.csv") != null, "samples entry");
                    TestAssert.True(archive.GetEntry("trace.csv") != null, "trace entry");
                    TestAssert.True(archive.GetEntry("motion-trace-alignment.csv") != null, "motion trace alignment entry");
                    TestAssert.True(archive.GetEntry("metadata.json") != null, "trace-compatible metadata entry");
                    TestAssert.True(archive.GetEntry("motion-metadata.json") != null, "motion metadata entry");

                    string metadata;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("metadata.json").Open()))
                    {
                        metadata = reader.ReadToEnd();
                    }

                    TestAssert.True(metadata.Contains("TraceFormatVersion"), "metadata is trace compatible");

                    string trace;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("trace.csv").Open()))
                    {
                        trace = reader.ReadToEnd();
                    }

                    TestAssert.True(trace.Contains("sequence,stopwatchTicks,elapsedMicroseconds"), "trace csv header");

                    string alignment;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("motion-trace-alignment.csv").Open()))
                    {
                        alignment = reader.ReadToEnd();
                    }

                    TestAssert.True(alignment.Contains("traceSequence,traceEvent,traceElapsedMicroseconds,generatedElapsedMilliseconds,scenarioIndex,scenarioElapsedMilliseconds,progress,generatedX,generatedY,velocityPixelsPerSecond,movementPhase,holdIndex,phaseElapsedMilliseconds"), "motion trace alignment header");
                    TestAssert.True(alignment.Contains(",poll,"), "motion trace alignment poll row");
                }
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Deterministic Bezier generation [COT-MNU-1]
        private static void DeterministicBezierGeneration()
        {
            Rectangle bounds = new Rectangle(100, 200, 600, 300);
            MotionLabScript first = MotionLabGenerator.Generate(1234, bounds, new Point(150, 250), 8, 6, 12000, 240);
            MotionLabScript second = MotionLabGenerator.Generate(1234, bounds, new Point(150, 250), 8, 6, 12000, 240);

            TestAssert.Equal(first.ControlPoints.Length, second.ControlPoints.Length, "control point count");
            TestAssert.Equal(first.SpeedPoints.Length, second.SpeedPoints.Length, "speed point count");
            for (int i = 0; i < first.ControlPoints.Length; i++)
            {
                TestAssert.Equal(first.ControlPoints[i].X, second.ControlPoints[i].X, "control point x");
                TestAssert.Equal(first.ControlPoints[i].Y, second.ControlPoints[i].Y, "control point y");
            }

            for (int i = 0; i < first.SpeedPoints.Length; i++)
            {
                TestAssert.Equal(first.SpeedPoints[i].Progress, second.SpeedPoints[i].Progress, "speed progress");
                TestAssert.Equal(first.SpeedPoints[i].Multiplier, second.SpeedPoints[i].Multiplier, "speed multiplier");
            }
        }

        // Generation clips to bounds [COT-MNU-2]
        private static void GenerationClipsToBounds()
        {
            Rectangle bounds = new Rectangle(10, 20, 100, 80);
            MotionLabScript script = MotionLabGenerator.Generate(4321, bounds, new Point(-100, 999), 16, 4, 1000, 120);

            TestAssert.Equal(10.0, script.ControlPoints[0].X, "start x clipped");
            TestAssert.Equal(100.0, script.ControlPoints[0].Y, "start y clipped");
            for (int i = 0; i < script.ControlPoints.Length; i++)
            {
                TestAssert.True(script.ControlPoints[i].X >= bounds.Left && script.ControlPoints[i].X <= bounds.Right, "control x in bounds");
                TestAssert.True(script.ControlPoints[i].Y >= bounds.Top && script.ControlPoints[i].Y <= bounds.Bottom, "control y in bounds");
            }
        }

        // Speed profile influences sampling [COT-MNU-3]
        private static void SpeedProfileInfluencesSampling()
        {
            MotionLabScript script = new MotionLabScript();
            script.Bounds = new MotionLabBounds { X = 0, Y = 0, Width = 100, Height = 100 };
            script.DurationMilliseconds = 1000;
            script.SampleRateHz = 100;
            script.ControlPoints = new[] { new MotionLabPoint(0, 0), new MotionLabPoint(100, 0) };
            script.SpeedPoints = new[]
            {
                new MotionLabSpeedPoint { Progress = 0.2, Multiplier = 3.0, Easing = "smoothstep", EasingWidth = 0.35 },
                new MotionLabSpeedPoint { Progress = 0.8, Multiplier = 0.35, Easing = "smoothstep", EasingWidth = 0.35 }
            };

            MotionLabSampler sampler = new MotionLabSampler(script);
            MotionLabSample middle = sampler.GetSample(500);

            TestAssert.True(middle.X > 55.0, "front-loaded speed advances progress");
            TestAssert.Equal(0.0, sampler.GetSample(0).X, "start x");
            TestAssert.Equal(100.0, sampler.GetSample(1000).X, "end x");
        }

        // Motion package contents [COT-MNU-4]
        private static void MotionPackageContents()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "motion.zip");
                MotionLabScript script = MotionLabGenerator.Generate(77, new Rectangle(0, 0, 320, 240), new Point(12, 34), 5, 3, 500, 60);
                new MotionLabPackageWriter().Write(path, script);

                using (FileStream stream = File.OpenRead(path))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    TestAssert.True(archive.GetEntry("motion-script.json") != null, "script entry");
                    TestAssert.True(archive.GetEntry("motion-samples.csv") != null, "samples entry");
                    TestAssert.True(archive.GetEntry("metadata.json") != null, "metadata entry");

                    ZipArchiveEntry samples = archive.GetEntry("motion-samples.csv");
                    string csv;
                    using (StreamReader reader = new StreamReader(samples.Open()))
                    {
                        csv = reader.ReadToEnd();
                    }

                    TestAssert.True(csv.Contains("sequence,elapsedMilliseconds,progress,x,y,velocityPixelsPerSecond"), "sample csv header");
                }
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        private static string NewTestDirectory()
        {
            string directory = Path.Combine(Path.GetTempPath(), "CursorMirrorTests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            return directory;
        }

        private static void DeleteDirectory(string directory)
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, true);
            }
        }
    }
}
