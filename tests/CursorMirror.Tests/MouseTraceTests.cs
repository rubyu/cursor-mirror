using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Threading;
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
            suite.Add("COT-MLU-9", TraceHookAndPollSampleFields);
            suite.Add("COT-MLU-10", TraceDwmTimingFields);
            suite.Add("COT-MLU-11", TraceSampleCountBreakdown);
            suite.Add("COT-MLU-12", TraceReferencePollFields);
            suite.Add("COT-MLU-13", TraceMetadataIncludesCaptureQuality);
            suite.Add("COT-MLU-14", TraceRuntimeSchedulerPollFields);
            suite.Add("COT-MLU-15", TraceRuntimeSchedulerCoalescedTicks);
            suite.Add("COT-MLU-16", TraceRuntimeSchedulerDedicatedStaDispatcher);
            suite.Add("COT-MLU-17", TraceRuntimeSchedulerLoopFields);
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

        // Trace hook and poll sample fields [COT-MLU-9]
        private static void TraceHookAndPollSampleFields()
        {
            MouseTraceSession session = new MouseTraceSession();
            long start = 1000;
            session.Start(start, 8);

            session.AddHookMove(start + 10, new Point(10, 20), 30, 40, 50, new IntPtr(60), new Point(11, 21));
            session.AddPoll(start + 20, new Point(12, 22), false, new DwmTimingInfo());
            session.AddReferencePoll(start + 30, new Point(13, 23));
            MouseTraceSnapshot snapshot = session.Snapshot();

            TestAssert.Equal(8, snapshot.PollIntervalMilliseconds, "poll interval");
            TestAssert.Equal("move", snapshot.Samples[0].EventType, "hook event type");
            TestAssert.Equal(10, snapshot.Samples[0].HookX.Value, "hook x");
            TestAssert.Equal(20, snapshot.Samples[0].HookY.Value, "hook y");
            TestAssert.Equal(11, snapshot.Samples[0].CursorX.Value, "hook cursor x");
            TestAssert.Equal(21, snapshot.Samples[0].CursorY.Value, "hook cursor y");
            TestAssert.Equal((uint)30, snapshot.Samples[0].HookMouseData.Value, "hook mouseData");
            TestAssert.Equal((uint)40, snapshot.Samples[0].HookFlags.Value, "hook flags");
            TestAssert.Equal((uint)50, snapshot.Samples[0].HookTimeMilliseconds.Value, "hook time");
            TestAssert.Equal(60L, snapshot.Samples[0].HookExtraInfo.Value, "hook extra info");
            TestAssert.Equal("poll", snapshot.Samples[1].EventType, "poll event type");
            TestAssert.False(snapshot.Samples[1].HookX.HasValue, "poll hook x empty");
            TestAssert.Equal(12, snapshot.Samples[1].CursorX.Value, "poll cursor x");
            TestAssert.Equal(22, snapshot.Samples[1].CursorY.Value, "poll cursor y");
            TestAssert.Equal("referencePoll", snapshot.Samples[2].EventType, "reference poll event type");
            TestAssert.Equal(13, snapshot.Samples[2].CursorX.Value, "reference poll cursor x");
            TestAssert.Equal(23, snapshot.Samples[2].CursorY.Value, "reference poll cursor y");
        }

        // Trace DWM timing fields [COT-MLU-10]
        private static void TraceDwmTimingFields()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "trace.zip");
                MouseTraceSession session = new MouseTraceSession();
                long start = 1000;
                DwmTimingInfo timing = new DwmTimingInfo();
                timing.RateRefresh.Numerator = 60000;
                timing.RateRefresh.Denominator = 1001;
                timing.QpcRefreshPeriod = 166667;
                timing.QpcVBlank = 123456;
                timing.RefreshCount = 42;
                timing.QpcCompose = 123500;
                timing.Frame = 7;
                timing.RefreshFrame = 8;
                timing.FrameDisplayed = 9;
                timing.QpcFrameDisplayed = 123600;
                timing.RefreshFrameDisplayed = 10;
                timing.FrameComplete = 11;
                timing.QpcFrameComplete = 123700;
                timing.FramePending = 12;
                timing.QpcFramePending = 123800;
                timing.RefreshNextDisplayed = 13;
                timing.RefreshNextPresented = 14;
                timing.FramesDisplayed = 15;
                timing.FramesDropped = 16;
                timing.FramesMissed = 17;

                session.Start(start, 8, 2, 1, true, 2, 8, 2);
                session.AddPoll(start + 20, new Point(12, 22), true, timing);
                session.AddReferencePoll(start + 30, new Point(13, 23));
                session.Stop(start + 30);

                new MouseTracePackageWriter().Write(path, session.Snapshot());

                using (FileStream stream = File.OpenRead(path))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    string csv;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("trace.csv").Open()))
                    {
                        csv = reader.ReadToEnd();
                    }

                    string metadataJson;
                    using (StreamReader reader = new StreamReader(archive.GetEntry("metadata.json").Open()))
                    {
                        metadataJson = reader.ReadToEnd();
                    }

                    TestAssert.True(csv.Contains("dwmTimingAvailable,dwmRateRefreshNumerator"), "dwm header");
                    TestAssert.True(csv.Contains("runtimeSchedulerTimingUsable,runtimeSchedulerTargetVBlankTicks"), "runtime scheduler header");
                    TestAssert.True(csv.Contains("runtimeSchedulerLoopIteration,runtimeSchedulerLoopStartedTicks"), "runtime scheduler loop header");
                    TestAssert.True(csv.Contains("runtimeSchedulerWaitMethod,runtimeSchedulerWaitTargetTicks"), "runtime scheduler wait header");
                    TestAssert.True(csv.Contains(",poll,,,12,22,"), "poll row values");
                    TestAssert.True(csv.Contains("true,60000,1001,166667,123456,42,"), "dwm row values");
                    TestAssert.True(metadataJson.Contains("\"TraceFormatVersion\":7"), "metadata trace format version");
                    TestAssert.True(metadataJson.Contains("\"PollSampleCount\":1"), "metadata poll sample count");
                    TestAssert.True(metadataJson.Contains("\"ReferencePollSampleCount\":1"), "metadata reference poll sample count");
                    TestAssert.True(metadataJson.Contains("\"DwmTimingSampleCount\":1"), "metadata dwm timing sample count");
                    TestAssert.True(metadataJson.Contains("\"PollIntervalMilliseconds\":8"), "metadata poll interval");
                    TestAssert.True(metadataJson.Contains("\"ReferencePollIntervalMilliseconds\":2"), "metadata reference poll interval");
                    TestAssert.True(metadataJson.Contains("\"TimerResolutionMilliseconds\":1"), "metadata timer resolution");
                    TestAssert.True(metadataJson.Contains("\"TimerResolutionSucceeded\":true"), "metadata timer resolution result");
                }
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Trace sample count breakdown [COT-MLU-11]
        private static void TraceSampleCountBreakdown()
        {
            MouseTraceSession session = new MouseTraceSession();
            long start = 1000;
            session.Start(start, 8);

            session.AddHookMove(start + 10, new Point(10, 20), 0, 0, 10, IntPtr.Zero, new Point(10, 20));
            session.AddHookMove(start + 20, new Point(11, 21), 0, 0, 20, IntPtr.Zero, new Point(11, 21));
            session.AddPoll(start + 30, new Point(12, 22), true, new DwmTimingInfo());
            session.AddPoll(start + 40, new Point(13, 23), false, new DwmTimingInfo());
            session.AddReferencePoll(start + 50, new Point(14, 24));
            session.AddRuntimeSchedulerPoll(start + 60, new Point(15, 25), false, new DwmTimingInfo(), false, null, null, start + 60, null);
            session.AddRuntimeSchedulerLoop(start + 70, true, new DwmTimingInfo(), true, start + 80, start + 78, 1000, 1, start + 70, start + 71, start + 72, start + 73, false, 2, "testWait", start + 76, start + 74, start + 76);

            MouseTraceSampleCounts counts = session.GetSampleCounts();

            TestAssert.Equal(7, counts.TotalSamples, "total sample count");
            TestAssert.Equal(2, counts.HookMoveSamples, "hook move sample count");
            TestAssert.Equal(2, counts.CursorPollSamples, "cursor poll sample count");
            TestAssert.Equal(1, counts.ReferencePollSamples, "reference poll sample count");
            TestAssert.Equal(1, counts.RuntimeSchedulerPollSamples, "runtime scheduler poll sample count");
            TestAssert.Equal(1, counts.RuntimeSchedulerLoopSamples, "runtime scheduler loop sample count");
            TestAssert.Equal(2, counts.DwmTimingSamples, "dwm timing sample count");
        }

        // Trace reference poll fields [COT-MLU-12]
        private static void TraceReferencePollFields()
        {
            MouseTraceSession session = new MouseTraceSession();
            long start = 1000;
            session.Start(start, 8, 2, 1, true);

            session.AddReferencePoll(start + 10, new Point(100, 200));
            MouseTraceSnapshot snapshot = session.Snapshot();

            TestAssert.Equal(2, snapshot.ReferencePollIntervalMilliseconds, "reference poll interval");
            TestAssert.Equal(1, snapshot.TimerResolutionMilliseconds, "timer resolution");
            TestAssert.True(snapshot.TimerResolutionSucceeded, "timer resolution succeeded");
            TestAssert.Equal("referencePoll", snapshot.Samples[0].EventType, "reference poll event type");
            TestAssert.Equal(100, snapshot.Samples[0].X, "reference poll x");
            TestAssert.Equal(200, snapshot.Samples[0].Y, "reference poll y");
            TestAssert.Equal(100, snapshot.Samples[0].CursorX.Value, "reference poll cursor x");
            TestAssert.Equal(200, snapshot.Samples[0].CursorY.Value, "reference poll cursor y");
            TestAssert.False(snapshot.Samples[0].DwmTimingAvailable, "reference poll has no dwm timing");
        }

        // Trace metadata includes capture quality [COT-MLU-13]
        private static void TraceMetadataIncludesCaptureQuality()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "trace.zip");
                MouseTraceSession session = new MouseTraceSession();
                long start = 1000;
                long oneMillisecond = Stopwatch.Frequency / 1000;
                session.Start(start, 8, 2, 1, true, 2, 8, 2);
                session.AddHookMove(start + oneMillisecond, new Point(1, 1), 0, 0, 0, IntPtr.Zero, new Point(1, 1));
                session.AddHookMove(start + (2 * oneMillisecond), new Point(2, 2), 0, 0, 0, IntPtr.Zero, new Point(2, 2));
                session.AddPoll(start + (8 * oneMillisecond), new Point(3, 3), true, new DwmTimingInfo());
                session.AddPoll(start + (16 * oneMillisecond), new Point(4, 4), false, new DwmTimingInfo());
                session.AddReferencePoll(start + (2 * oneMillisecond), new Point(5, 5));
                session.AddReferencePoll(start + (4 * oneMillisecond), new Point(6, 6));
                session.AddRuntimeSchedulerPoll(start + (10 * oneMillisecond), new Point(7, 7), true, new DwmTimingInfo(), true, start + (20 * oneMillisecond), start + (18 * oneMillisecond), start + (10 * oneMillisecond), 10000);
                session.AddRuntimeSchedulerPoll(start + (18 * oneMillisecond), new Point(8, 8), false, new DwmTimingInfo(), false, null, null, start + (18 * oneMillisecond), null);
                session.AddRuntimeSchedulerLoop(start + (6 * oneMillisecond), true, new DwmTimingInfo(), true, start + (20 * oneMillisecond), start + (18 * oneMillisecond), 12000, 1, start + (6 * oneMillisecond), start + (6 * oneMillisecond), start + (6 * oneMillisecond) + 1, start + (6 * oneMillisecond) + 2, false, 2, "testWait", start + (8 * oneMillisecond), start + (6 * oneMillisecond) + 3, start + (8 * oneMillisecond));
                session.AddRuntimeSchedulerLoop(start + (8 * oneMillisecond), false, new DwmTimingInfo(), false, null, null, null, 2, start + (8 * oneMillisecond), start + (8 * oneMillisecond), start + (8 * oneMillisecond) + 1, start + (8 * oneMillisecond) + 2, true, 8, "testWait", start + (16 * oneMillisecond), start + (8 * oneMillisecond) + 3, start + (16 * oneMillisecond));
                session.AddRuntimeSchedulerCoalescedTick();
                session.Stop(start + (24 * oneMillisecond));

                new MouseTracePackageWriter().Write(path, session.Snapshot());

                using (FileStream stream = File.OpenRead(path))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                using (StreamReader reader = new StreamReader(archive.GetEntry("metadata.json").Open()))
                {
                    string metadataJson = reader.ReadToEnd();
                    TestAssert.True(metadataJson.Contains("\"HookMoveIntervalStats\""), "metadata hook interval stats");
                    TestAssert.True(metadataJson.Contains("\"ProductPollIntervalStats\""), "metadata product poll interval stats");
                    TestAssert.True(metadataJson.Contains("\"ReferencePollIntervalStats\""), "metadata reference poll interval stats");
                    TestAssert.True(metadataJson.Contains("\"RuntimeSchedulerPollIntervalStats\""), "metadata runtime scheduler poll interval stats");
                    TestAssert.True(metadataJson.Contains("\"RuntimeSchedulerLoopIntervalStats\""), "metadata runtime scheduler loop interval stats");
                    TestAssert.True(metadataJson.Contains("\"RuntimeSchedulerPollSampleCount\":2"), "metadata runtime scheduler poll sample count");
                    TestAssert.True(metadataJson.Contains("\"RuntimeSchedulerLoopSampleCount\":2"), "metadata runtime scheduler loop sample count");
                    TestAssert.True(metadataJson.Contains("\"RuntimeSchedulerCoalescedTickCount\":1"), "metadata runtime scheduler coalesced tick count");
                    TestAssert.True(metadataJson.Contains("\"RuntimeSchedulerWakeAdvanceMilliseconds\":2"), "metadata runtime scheduler wake advance");
                    TestAssert.True(metadataJson.Contains("\"RuntimeSchedulerFallbackIntervalMilliseconds\":8"), "metadata runtime scheduler fallback interval");
                    TestAssert.True(metadataJson.Contains("\"RuntimeSchedulerMaximumDwmSleepMilliseconds\":2"), "metadata runtime scheduler maximum DWM sleep");
                    TestAssert.True(metadataJson.Contains("\"DwmTimingAvailabilityPercent\":50"), "metadata dwm availability percent");
                    TestAssert.True(metadataJson.Contains("\"OperatingSystemVersion\""), "metadata os version");
                    TestAssert.True(metadataJson.Contains("\"Monitors\""), "metadata monitors");
                    TestAssert.True(metadataJson.Contains("\"QualityWarnings\""), "metadata quality warnings");
                }
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Trace runtime scheduler poll fields [COT-MLU-14]
        private static void TraceRuntimeSchedulerPollFields()
        {
            MouseTraceSession session = new MouseTraceSession();
            long start = 1000;
            DwmTimingInfo timing = new DwmTimingInfo();
            timing.QpcRefreshPeriod = 100;
            timing.QpcVBlank = 2000;
            session.Start(start, 8, 2, 1, true, 2, 8, 2);

            session.AddRuntimeSchedulerPoll(
                start + 10,
                new Point(100, 200),
                true,
                timing,
                true,
                2000,
                1800,
                start + 10,
                990,
                start + 1,
                start + 2,
                start + 3,
                start + 4,
                start + 5);
            MouseTraceSnapshot snapshot = session.Snapshot();

            TestAssert.Equal(2, snapshot.RuntimeSchedulerWakeAdvanceMilliseconds, "runtime scheduler wake advance");
            TestAssert.Equal(8, snapshot.RuntimeSchedulerFallbackIntervalMilliseconds, "runtime scheduler fallback interval");
            TestAssert.Equal(2, snapshot.RuntimeSchedulerMaximumDwmSleepMilliseconds, "runtime scheduler maximum DWM sleep");
            TestAssert.Equal("runtimeSchedulerPoll", snapshot.Samples[0].EventType, "runtime scheduler event type");
            TestAssert.Equal(100, snapshot.Samples[0].X, "runtime scheduler x");
            TestAssert.Equal(200, snapshot.Samples[0].Y, "runtime scheduler y");
            TestAssert.Equal(100, snapshot.Samples[0].CursorX.Value, "runtime scheduler cursor x");
            TestAssert.True(snapshot.Samples[0].RuntimeSchedulerTimingUsable.Value, "runtime scheduler timing usable");
            TestAssert.Equal(2000L, snapshot.Samples[0].RuntimeSchedulerTargetVBlankTicks.Value, "runtime scheduler target vblank");
            TestAssert.Equal(1800L, snapshot.Samples[0].RuntimeSchedulerPlannedTickTicks.Value, "runtime scheduler planned tick");
            TestAssert.Equal(start + 10, snapshot.Samples[0].RuntimeSchedulerActualTickTicks.Value, "runtime scheduler actual tick");
            TestAssert.Equal(990L, snapshot.Samples[0].RuntimeSchedulerVBlankLeadMicroseconds.Value, "runtime scheduler lead");
            TestAssert.Equal(start + 1, snapshot.Samples[0].RuntimeSchedulerQueuedTickTicks.Value, "runtime scheduler queued tick");
            TestAssert.Equal(start + 2, snapshot.Samples[0].RuntimeSchedulerDispatchStartedTicks.Value, "runtime scheduler dispatch start");
            TestAssert.Equal(start + 3, snapshot.Samples[0].RuntimeSchedulerCursorReadStartedTicks.Value, "runtime scheduler cursor read start");
            TestAssert.Equal(start + 4, snapshot.Samples[0].RuntimeSchedulerCursorReadCompletedTicks.Value, "runtime scheduler cursor read completed");
            TestAssert.Equal(start + 5, snapshot.Samples[0].RuntimeSchedulerSampleRecordedTicks.Value, "runtime scheduler sample recorded");
        }

        // Trace runtime scheduler coalesced ticks [COT-MLU-15]
        private static void TraceRuntimeSchedulerCoalescedTicks()
        {
            string directory = NewTestDirectory();
            try
            {
                string path = Path.Combine(directory, "trace.zip");
                MouseTraceSession session = new MouseTraceSession();
                long start = 1000;
                session.Start(start, 8, 2, 1, true, 2, 8, 2);
                session.AddRuntimeSchedulerCoalescedTick();
                session.AddRuntimeSchedulerCoalescedTick();
                session.AddRuntimeSchedulerPoll(start + 10, new Point(10, 20), false, new DwmTimingInfo(), false, null, null, start + 10, null);
                session.Stop(start + 20);

                new MouseTracePackageWriter().Write(path, session.Snapshot());

                using (FileStream stream = File.OpenRead(path))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                using (StreamReader reader = new StreamReader(archive.GetEntry("metadata.json").Open()))
                {
                    string metadataJson = reader.ReadToEnd();
                    TestAssert.True(metadataJson.Contains("\"RuntimeSchedulerCoalescedTickCount\":2"), "metadata runtime scheduler coalesced tick count");
                }
            }
            finally
            {
                DeleteDirectory(directory);
            }
        }

        // Trace runtime scheduler dedicated STA dispatcher [COT-MLU-16]
        private static void TraceRuntimeSchedulerDedicatedStaDispatcher()
        {
            using (StaMessageLoopDispatcher dispatcher = new StaMessageLoopDispatcher("CursorMirrorTestStaDispatcher"))
            {
                dispatcher.Start();
                ManualResetEvent completed = new ManualResetEvent(false);
                int testThreadId = System.Threading.Thread.CurrentThread.ManagedThreadId;
                int actionThreadId = 0;
                ApartmentState apartmentState = ApartmentState.Unknown;
                bool invokeRequiredFromAction = true;

                dispatcher.BeginInvoke(delegate
                {
                    actionThreadId = System.Threading.Thread.CurrentThread.ManagedThreadId;
                    apartmentState = System.Threading.Thread.CurrentThread.GetApartmentState();
                    invokeRequiredFromAction = dispatcher.InvokeRequired;
                    completed.Set();
                });

                TestAssert.True(completed.WaitOne(2000), "dispatcher action completed");
                TestAssert.True(actionThreadId != 0, "dispatcher action thread recorded");
                TestAssert.True(actionThreadId != testThreadId, "dispatcher action runs on a dedicated thread");
                TestAssert.Equal(ApartmentState.STA, apartmentState, "dispatcher thread apartment");
                TestAssert.False(invokeRequiredFromAction, "dispatcher reports no invoke required on its own thread");
                completed.Dispose();
            }
        }

        // Trace runtime scheduler loop fields [COT-MLU-17]
        private static void TraceRuntimeSchedulerLoopFields()
        {
            MouseTraceSession session = new MouseTraceSession();
            long start = 1000;
            DwmTimingInfo timing = new DwmTimingInfo();
            timing.QpcRefreshPeriod = 100;
            timing.QpcVBlank = 2000;
            session.Start(start, 8, 2, 1, true, 2, 8, 2);

            session.AddRuntimeSchedulerLoop(
                start + 10,
                true,
                timing,
                true,
                2000,
                1800,
                990,
                7,
                start + 10,
                start + 11,
                start + 12,
                start + 13,
                true,
                2,
                "testWait",
                start + 16,
                start + 14,
                start + 16);
            MouseTraceSnapshot snapshot = session.Snapshot();

            TestAssert.Equal("runtimeSchedulerLoop", snapshot.Samples[0].EventType, "runtime scheduler loop event type");
            TestAssert.True(snapshot.Samples[0].DwmTimingAvailable, "runtime scheduler loop DWM timing");
            TestAssert.True(snapshot.Samples[0].RuntimeSchedulerTimingUsable.Value, "runtime scheduler loop timing usable");
            TestAssert.Equal(2000L, snapshot.Samples[0].RuntimeSchedulerTargetVBlankTicks.Value, "runtime scheduler loop target vblank");
            TestAssert.Equal(1800L, snapshot.Samples[0].RuntimeSchedulerPlannedTickTicks.Value, "runtime scheduler loop planned tick");
            TestAssert.Equal(990L, snapshot.Samples[0].RuntimeSchedulerVBlankLeadMicroseconds.Value, "runtime scheduler loop lead");
            TestAssert.Equal(7L, snapshot.Samples[0].RuntimeSchedulerLoopIteration.Value, "runtime scheduler loop iteration");
            TestAssert.Equal(start + 10, snapshot.Samples[0].RuntimeSchedulerLoopStartedTicks.Value, "runtime scheduler loop started");
            TestAssert.Equal(start + 11, snapshot.Samples[0].RuntimeSchedulerTimingReadStartedTicks.Value, "runtime scheduler timing read started");
            TestAssert.Equal(start + 12, snapshot.Samples[0].RuntimeSchedulerTimingReadCompletedTicks.Value, "runtime scheduler timing read completed");
            TestAssert.Equal(start + 13, snapshot.Samples[0].RuntimeSchedulerDecisionCompletedTicks.Value, "runtime scheduler decision completed");
            TestAssert.True(snapshot.Samples[0].RuntimeSchedulerTickRequested.Value, "runtime scheduler tick requested");
            TestAssert.Equal(2, snapshot.Samples[0].RuntimeSchedulerSleepRequestedMilliseconds.Value, "runtime scheduler sleep requested");
            TestAssert.Equal("testWait", snapshot.Samples[0].RuntimeSchedulerWaitMethod, "runtime scheduler wait method");
            TestAssert.Equal(start + 16, snapshot.Samples[0].RuntimeSchedulerWaitTargetTicks.Value, "runtime scheduler wait target");
            TestAssert.Equal(start + 14, snapshot.Samples[0].RuntimeSchedulerSleepStartedTicks.Value, "runtime scheduler sleep started");
            TestAssert.Equal(start + 16, snapshot.Samples[0].RuntimeSchedulerSleepCompletedTicks.Value, "runtime scheduler sleep completed");
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
