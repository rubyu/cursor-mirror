using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using CursorMirror.MouseTrace;

namespace CursorMirror.Tests
{
    internal static class MouseTraceTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MLU-1", TraceSessionStartsEmpty);
            suite.Add("COT-MLU-2", TraceSessionStartAndStopTransitions);
            suite.Add("COT-MLU-3", TraceToolButtonEnabledStates);
            suite.Add("COT-MLU-4", TraceSampleAppendIncrementsCount);
            suite.Add("COT-MLU-5", TraceElapsedDurationFormatting);
            suite.Add("COT-MLU-6", TraceZipPackageContents);
            suite.Add("COT-MLU-7", EmptyTraceSaveRejected);
            suite.Add("COT-MLU-8", RepeatedStopCleanup);
        }

        // Trace session starts empty [COT-MLU-1]
        private static void TraceSessionStartsEmpty()
        {
            MouseTraceSession session = new MouseTraceSession();

            TestAssert.Equal(MouseTraceState.Idle, session.State, "initial state");
            TestAssert.Equal(0, session.SampleCount, "initial sample count");
            TestAssert.Equal(0L, session.ElapsedMicroseconds, "initial elapsed");
        }

        // Trace session start and stop transitions [COT-MLU-2]
        private static void TraceSessionStartAndStopTransitions()
        {
            MouseTraceSession session = new MouseTraceSession();
            long start = 1000;

            session.Start(start);
            TestAssert.Equal(MouseTraceState.Recording, session.State, "recording state");
            session.AddMove(start + Stopwatch.Frequency, new Point(10, 20));
            session.Stop(start + (2 * Stopwatch.Frequency));
            TestAssert.Equal(MouseTraceState.StoppedWithSamples, session.State, "stopped with samples state");
            session.MarkSaved();
            TestAssert.Equal(MouseTraceState.Saved, session.State, "saved state");
            session.Start(start + (3 * Stopwatch.Frequency));
            TestAssert.Equal(MouseTraceState.Recording, session.State, "restart recording state");
            TestAssert.Equal(0, session.SampleCount, "restart clears samples");
        }

        // Trace tool button enabled states [COT-MLU-3]
        private static void TraceToolButtonEnabledStates()
        {
            MouseTraceUiState idle = MouseTraceUiState.FromState(MouseTraceState.Idle);
            MouseTraceUiState recording = MouseTraceUiState.FromState(MouseTraceState.Recording);
            MouseTraceUiState stopped = MouseTraceUiState.FromState(MouseTraceState.StoppedWithSamples);
            MouseTraceUiState saved = MouseTraceUiState.FromState(MouseTraceState.Saved);

            TestAssert.True(idle.StartEnabled, "idle start enabled");
            TestAssert.False(idle.StopEnabled, "idle stop disabled");
            TestAssert.False(idle.SaveEnabled, "idle save disabled");
            TestAssert.False(recording.StartEnabled, "recording start disabled");
            TestAssert.True(recording.StopEnabled, "recording stop enabled");
            TestAssert.False(recording.SaveEnabled, "recording save disabled");
            TestAssert.True(stopped.StartEnabled, "stopped start enabled");
            TestAssert.True(stopped.SaveEnabled, "stopped save enabled");
            TestAssert.True(saved.StartEnabled, "saved start enabled");
            TestAssert.False(saved.SaveEnabled, "saved save disabled");
        }

        // Trace sample append increments count [COT-MLU-4]
        private static void TraceSampleAppendIncrementsCount()
        {
            MouseTraceSession session = new MouseTraceSession();
            long start = 1000;
            session.Start(start);

            session.AddMove(start + Stopwatch.Frequency, new Point(10, 20));
            session.AddMove(start + (2 * Stopwatch.Frequency), new Point(30, 40));
            MouseTraceSnapshot snapshot = session.Snapshot();

            TestAssert.Equal(2, session.SampleCount, "sample count");
            TestAssert.Equal(0L, snapshot.Samples[0].Sequence, "first sequence");
            TestAssert.Equal(1L, snapshot.Samples[1].Sequence, "second sequence");
            TestAssert.Equal(10, snapshot.Samples[0].X, "first x");
            TestAssert.Equal(40, snapshot.Samples[1].Y, "second y");
            TestAssert.Equal("move", snapshot.Samples[0].EventType, "event type");
        }

        // Trace elapsed duration formatting [COT-MLU-5]
        private static void TraceElapsedDurationFormatting()
        {
            TestAssert.Equal("00:00:00.000", MouseTraceFormat.FormatDuration(0), "zero duration");
            TestAssert.Equal("00:00:01.234", MouseTraceFormat.FormatDuration(1234567), "short duration");
            TestAssert.Equal("01:02:03.456", MouseTraceFormat.FormatDuration(3723456000), "long duration");
        }

        // Trace zip package contents [COT-MLU-6]
        private static void TraceZipPackageContents()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "trace.zip");
                MouseTraceSession session = new MouseTraceSession();
                long start = 1000;
                session.Start(start);
                session.AddMove(start + Stopwatch.Frequency, new Point(10, 20));
                session.AddMove(start + (2 * Stopwatch.Frequency), new Point(30, 40));
                session.Stop(start + (3 * Stopwatch.Frequency));

                new MouseTracePackageWriter().Write(path, session.Snapshot());

                using (FileStream stream = File.OpenRead(path))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    ZipArchiveEntry trace = archive.GetEntry("trace.csv");
                    ZipArchiveEntry metadata = archive.GetEntry("metadata.json");
                    TestAssert.True(trace != null, "trace entry exists");
                    TestAssert.True(metadata != null, "metadata entry exists");

                    string csv;
                    using (StreamReader reader = new StreamReader(trace.Open()))
                    {
                        csv = reader.ReadToEnd();
                    }

                    TestAssert.True(csv.Contains("sequence,stopwatchTicks,elapsedMicroseconds,x,y,event"), "csv header");
                    TestAssert.True(csv.Contains(",10,20,move"), "csv first row");
                    TestAssert.True(csv.Contains(",30,40,move"), "csv second row");
                }
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Empty trace save rejected [COT-MLU-7]
        private static void EmptyTraceSaveRejected()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "empty.zip");
                MouseTraceSession session = new MouseTraceSession();

                TestAssert.Throws<InvalidOperationException>(
                    delegate { new MouseTracePackageWriter().Write(path, session.Snapshot()); },
                    "empty trace save must fail");
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Repeated stop cleanup [COT-MLU-8]
        private static void RepeatedStopCleanup()
        {
            MouseTraceSession session = new MouseTraceSession();
            long start = 1000;
            session.Start(start);
            session.AddMove(start + 10, new Point(1, 2));
            session.Stop(start + 20);
            session.Stop(start + 30);

            TestAssert.Equal(MouseTraceState.StoppedWithSamples, session.State, "repeated stop state");
            TestAssert.Equal(1, session.SampleCount, "repeated stop sample count");
        }

        private static string NewTestDirectory()
        {
            string directory = Path.Combine(Environment.CurrentDirectory, "artifacts", "test-mouse-traces", Guid.NewGuid().ToString("N"));
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
