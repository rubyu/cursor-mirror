using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Windows.Forms;

namespace CursorMirror.MouseTrace
{
    public sealed class MouseTracePackageWriter
    {
        public const int WarmupDurationMilliseconds = 500;
        private static readonly Encoding Utf8NoBom = new UTF8Encoding(false);

        public void Write(string path, MouseTraceSnapshot snapshot)
        {
            Write(path, snapshot, LocalizedStrings.TraceToolTitle);
        }

        public void Write(string path, MouseTraceSnapshot snapshot, string productName)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Output path must not be empty.", "path");
            }

            if (snapshot == null)
            {
                throw new ArgumentNullException("snapshot");
            }

            if (snapshot.Samples.Length == 0)
            {
                throw new InvalidOperationException("Cannot save an empty mouse trace.");
            }

            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            if (File.Exists(path))
            {
                File.Delete(path);
            }

            using (FileStream file = File.Open(path, FileMode.CreateNew, FileAccess.ReadWrite))
            using (ZipArchive archive = new ZipArchive(file, ZipArchiveMode.Create))
            {
                Write(archive, snapshot, productName);
            }
        }

        public void Write(ZipArchive archive, MouseTraceSnapshot snapshot)
        {
            Write(archive, snapshot, LocalizedStrings.TraceToolTitle);
        }

        public void Write(ZipArchive archive, MouseTraceSnapshot snapshot, string productName)
        {
            if (archive == null)
            {
                throw new ArgumentNullException("archive");
            }

            if (snapshot == null)
            {
                throw new ArgumentNullException("snapshot");
            }

            if (snapshot.Samples.Length == 0)
            {
                throw new InvalidOperationException("Cannot save an empty mouse trace.");
            }

            WriteTraceCsv(archive, snapshot);
            WriteMetadata(archive, snapshot, productName);
        }

        private static void WriteTraceCsv(ZipArchive archive, MouseTraceSnapshot snapshot)
        {
            ZipArchiveEntry entry = archive.CreateEntry("trace.csv", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            using (StreamWriter writer = new StreamWriter(stream, Utf8NoBom))
            {
                writer.WriteLine("sequence,stopwatchTicks,elapsedMicroseconds,x,y,event,hookX,hookY,cursorX,cursorY,hookMouseData,hookFlags,hookTimeMilliseconds,hookExtraInfo,dwmTimingAvailable,dwmRateRefreshNumerator,dwmRateRefreshDenominator,dwmQpcRefreshPeriod,dwmQpcVBlank,dwmRefreshCount,dwmQpcCompose,dwmFrame,dwmRefreshFrame,dwmFrameDisplayed,dwmQpcFrameDisplayed,dwmRefreshFrameDisplayed,dwmFrameComplete,dwmQpcFrameComplete,dwmFramePending,dwmQpcFramePending,dwmRefreshNextDisplayed,dwmRefreshNextPresented,dwmFramesDisplayed,dwmFramesDropped,dwmFramesMissed,runtimeSchedulerTimingUsable,runtimeSchedulerTargetVBlankTicks,runtimeSchedulerPlannedTickTicks,runtimeSchedulerActualTickTicks,runtimeSchedulerVBlankLeadMicroseconds,runtimeSchedulerQueuedTickTicks,runtimeSchedulerDispatchStartedTicks,runtimeSchedulerCursorReadStartedTicks,runtimeSchedulerCursorReadCompletedTicks,runtimeSchedulerSampleRecordedTicks,runtimeSchedulerLoopIteration,runtimeSchedulerLoopStartedTicks,runtimeSchedulerTimingReadStartedTicks,runtimeSchedulerTimingReadCompletedTicks,runtimeSchedulerDecisionCompletedTicks,runtimeSchedulerTickRequested,runtimeSchedulerSleepRequestedMilliseconds,runtimeSchedulerWaitMethod,runtimeSchedulerWaitTargetTicks,runtimeSchedulerSleepStartedTicks,runtimeSchedulerSleepCompletedTicks,warmupSample,predictionTargetTicks,presentReferenceTicks,schedulerProvenance,sampleRecordedToPredictionTargetMicroseconds,runtimeSchedulerMissing,runtimeSchedulerCursorReadLatencyMicroseconds,runtimeSchedulerDispatchToReadStartedMicroseconds,runtimeSchedulerQueueToDispatchMicroseconds,runtimeSchedulerReadCompletedToSampleRecordedMicroseconds,runtimeSchedulerDuplicateHoldRunLength,runtimeSchedulerLastMovementAgeMicroseconds,runtimeSchedulerPollCadenceGapMicroseconds,runtimeSchedulerMissedCadence,runtimeSchedulerSampleToTargetMicroseconds,runtimeSchedulerReadCompletedToTargetMicroseconds");
                RuntimeSchedulerDerivedTelemetryState runtimeTelemetry = new RuntimeSchedulerDerivedTelemetryState();
                foreach (MouseTraceEvent sample in snapshot.Samples)
                {
                    writer.Write(sample.Sequence.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.StopwatchTicks.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.ElapsedMicroseconds.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.X.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.Y.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(EscapeCsv(sample.EventType));
                    writer.Write(",");
                    WriteNullable(writer, sample.HookX);
                    writer.Write(",");
                    WriteNullable(writer, sample.HookY);
                    writer.Write(",");
                    WriteNullable(writer, sample.CursorX);
                    writer.Write(",");
                    WriteNullable(writer, sample.CursorY);
                    writer.Write(",");
                    WriteNullable(writer, sample.HookMouseData);
                    writer.Write(",");
                    WriteNullable(writer, sample.HookFlags);
                    writer.Write(",");
                    WriteNullable(writer, sample.HookTimeMilliseconds);
                    writer.Write(",");
                    WriteNullable(writer, sample.HookExtraInfo);
                    writer.Write(",");
                    writer.Write(sample.DwmTimingAvailable ? "true" : "false");
                    writer.Write(",");
                    if (sample.DwmTimingAvailable)
                    {
                        WriteDwmTiming(writer, sample.DwmTiming);
                    }
                    else
                    {
                        WriteEmptyDwmTiming(writer);
                    }
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerTimingUsable);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerTargetVBlankTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerPlannedTickTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerActualTickTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerVBlankLeadMicroseconds);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerQueuedTickTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerDispatchStartedTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerCursorReadStartedTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerCursorReadCompletedTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerSampleRecordedTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerLoopIteration);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerLoopStartedTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerTimingReadStartedTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerTimingReadCompletedTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerDecisionCompletedTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerTickRequested);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerSleepRequestedMilliseconds);
                    writer.Write(",");
                    writer.Write(EscapeCsv(sample.RuntimeSchedulerWaitMethod));
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerWaitTargetTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerSleepStartedTicks);
                    writer.Write(",");
                    WriteNullable(writer, sample.RuntimeSchedulerSleepCompletedTicks);
                    writer.Write(",");
                    writer.Write(IsWarmupSample(sample) ? "true" : "false");
                    writer.Write(",");
                    WriteNullable(writer, PredictionTargetTicks(sample));
                    writer.Write(",");
                    WriteNullable(writer, PresentReferenceTicks(sample));
                    writer.Write(",");
                    writer.Write(EscapeCsv(SchedulerProvenance(sample)));
                    writer.Write(",");
                    WriteNullable(writer, SampleRecordedToPredictionTargetMicroseconds(sample));
                    writer.Write(",");
                    writer.Write(IsRuntimeSchedulerMissing(sample) ? "true" : "false");
                    writer.Write(",");
                    WriteRuntimeSchedulerDerivedTelemetry(writer, runtimeTelemetry.Next(sample));
                    writer.WriteLine();
                }
            }
        }

        private static void WriteMetadata(ZipArchive archive, MouseTraceSnapshot snapshot, string productName)
        {
            MouseTraceMetadata metadata = new MouseTraceMetadata();
            metadata.TraceFormatVersion = 10;
            metadata.ProductName = string.IsNullOrWhiteSpace(productName) ? LocalizedStrings.TraceToolTitle : productName;
            metadata.ProductVersion = BuildVersion.InformationalVersion;
            metadata.CreatedUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            metadata.SampleCount = snapshot.Samples.Length;
            metadata.HookSampleCount = CountByEvent(snapshot, "move");
            metadata.PollSampleCount = CountByEvent(snapshot, "poll");
            metadata.ReferencePollSampleCount = CountByEvent(snapshot, "referencePoll");
            metadata.RuntimeSchedulerPollSampleCount = CountByEvent(snapshot, "runtimeSchedulerPoll");
            metadata.RuntimeSchedulerLoopSampleCount = CountByEvent(snapshot, "runtimeSchedulerLoop");
            metadata.DwmTimingSampleCount = CountDwmTimingSamples(snapshot);
            metadata.PollIntervalMilliseconds = snapshot.PollIntervalMilliseconds;
            metadata.ReferencePollIntervalMilliseconds = snapshot.ReferencePollIntervalMilliseconds;
            metadata.TimerResolutionMilliseconds = snapshot.TimerResolutionMilliseconds;
            metadata.TimerResolutionSucceeded = snapshot.TimerResolutionSucceeded;
            metadata.RuntimeSchedulerWakeAdvanceMilliseconds = snapshot.RuntimeSchedulerWakeAdvanceMilliseconds;
            metadata.RuntimeSchedulerFallbackIntervalMilliseconds = snapshot.RuntimeSchedulerFallbackIntervalMilliseconds;
            metadata.RuntimeSchedulerMaximumDwmSleepMilliseconds = snapshot.RuntimeSchedulerMaximumDwmSleepMilliseconds;
            metadata.RuntimeSchedulerCoalescedTickCount = snapshot.RuntimeSchedulerCoalescedTickCount;
            metadata.RuntimeSchedulerThreadProfile = snapshot.RuntimeSchedulerThreadProfile;
            metadata.RuntimeSchedulerCaptureThreadProfile = snapshot.RuntimeSchedulerCaptureThreadProfile;
            metadata.WarmupDurationMilliseconds = WarmupDurationMilliseconds;
            metadata.DurationMicroseconds = snapshot.DurationMicroseconds;
            metadata.StopwatchFrequency = Stopwatch.Frequency.ToString(CultureInfo.InvariantCulture);
            metadata.HookMoveIntervalStats = CalculateIntervalStats(snapshot, "move");
            metadata.ProductPollIntervalStats = CalculateIntervalStats(snapshot, "poll");
            metadata.ReferencePollIntervalStats = CalculateIntervalStats(snapshot, "referencePoll");
            metadata.RuntimeSchedulerPollIntervalStats = CalculateIntervalStats(snapshot, "runtimeSchedulerPoll");
            metadata.RuntimeSchedulerLoopIntervalStats = CalculateIntervalStats(snapshot, "runtimeSchedulerLoop");
            int dwmTimingEligibleSamples = metadata.PollSampleCount
                + metadata.RuntimeSchedulerPollSampleCount
                + metadata.RuntimeSchedulerLoopSampleCount;
            metadata.DwmTimingAvailabilityPercent = dwmTimingEligibleSamples == 0 ? 0 : (metadata.DwmTimingSampleCount * 100.0) / dwmTimingEligibleSamples;
            metadata.OperatingSystemVersion = Environment.OSVersion.VersionString;
            metadata.Is64BitOperatingSystem = Environment.Is64BitOperatingSystem;
            metadata.RuntimeVersion = Environment.Version.ToString();
            metadata.ProcessorCount = Environment.ProcessorCount;
            metadata.VirtualScreenX = SystemInformation.VirtualScreen.X;
            metadata.VirtualScreenY = SystemInformation.VirtualScreen.Y;
            metadata.VirtualScreenWidth = SystemInformation.VirtualScreen.Width;
            metadata.VirtualScreenHeight = SystemInformation.VirtualScreen.Height;
            PopulateDpi(metadata);
            metadata.Monitors = CollectMonitorMetadata();
            metadata.QualityWarnings = BuildQualityWarnings(metadata);

            ZipArchiveEntry entry = archive.CreateEntry("metadata.json", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(MouseTraceMetadata));
                serializer.WriteObject(stream, metadata);
            }
        }

        private static void WriteDwmTiming(StreamWriter writer, DwmTimingInfo timing)
        {
            writer.Write(timing.RateRefresh.Numerator.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.RateRefresh.Denominator.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.QpcRefreshPeriod.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.QpcVBlank.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.RefreshCount.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.QpcCompose.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.Frame.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.RefreshFrame.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.FrameDisplayed.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.QpcFrameDisplayed.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.RefreshFrameDisplayed.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.FrameComplete.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.QpcFrameComplete.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.FramePending.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.QpcFramePending.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.RefreshNextDisplayed.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.RefreshNextPresented.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.FramesDisplayed.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.FramesDropped.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(timing.FramesMissed.ToString(CultureInfo.InvariantCulture));
        }

        private static void WriteEmptyDwmTiming(StreamWriter writer)
        {
            for (int i = 0; i < 20; i++)
            {
                if (i > 0)
                {
                    writer.Write(",");
                }
            }
        }

        private static void WriteNullable(StreamWriter writer, int? value)
        {
            if (value.HasValue)
            {
                writer.Write(value.Value.ToString(CultureInfo.InvariantCulture));
            }
        }

        private static void WriteNullable(StreamWriter writer, uint? value)
        {
            if (value.HasValue)
            {
                writer.Write(value.Value.ToString(CultureInfo.InvariantCulture));
            }
        }

        private static void WriteNullable(StreamWriter writer, long? value)
        {
            if (value.HasValue)
            {
                writer.Write(value.Value.ToString(CultureInfo.InvariantCulture));
            }
        }

        private static void WriteNullable(StreamWriter writer, bool? value)
        {
            if (value.HasValue)
            {
                writer.Write(value.Value ? "true" : "false");
            }
        }

        private static bool IsWarmupSample(MouseTraceEvent sample)
        {
            return sample != null && sample.ElapsedMicroseconds >= 0 && sample.ElapsedMicroseconds <= WarmupDurationMilliseconds * 1000L;
        }

        private static long? PredictionTargetTicks(MouseTraceEvent sample)
        {
            if (sample == null)
            {
                return null;
            }

            if (sample.RuntimeSchedulerTargetVBlankTicks.HasValue)
            {
                return sample.RuntimeSchedulerTargetVBlankTicks.Value;
            }

            return sample.RuntimeSchedulerPlannedTickTicks;
        }

        private static long? PresentReferenceTicks(MouseTraceEvent sample)
        {
            if (sample == null)
            {
                return null;
            }

            if (sample.DwmTimingAvailable)
            {
                return sample.DwmTiming.QpcVBlank <= long.MaxValue ? (long)sample.DwmTiming.QpcVBlank : (long?)null;
            }

            return sample.RuntimeSchedulerTargetVBlankTicks;
        }

        private static string SchedulerProvenance(MouseTraceEvent sample)
        {
            if (sample == null || (!string.Equals(sample.EventType, "runtimeSchedulerPoll", StringComparison.Ordinal) && !string.Equals(sample.EventType, "runtimeSchedulerLoop", StringComparison.Ordinal)))
            {
                return "";
            }

            if (sample.RuntimeSchedulerTimingUsable.HasValue && sample.RuntimeSchedulerTimingUsable.Value && sample.RuntimeSchedulerTargetVBlankTicks.HasValue)
            {
                return "dwm";
            }

            if (sample.RuntimeSchedulerPlannedTickTicks.HasValue)
            {
                return "fallback";
            }

            return "missing";
        }

        private static long? SampleRecordedToPredictionTargetMicroseconds(MouseTraceEvent sample)
        {
            long? targetTicks = PredictionTargetTicks(sample);
            if (!targetTicks.HasValue)
            {
                return null;
            }

            long recordedTicks = sample.RuntimeSchedulerSampleRecordedTicks.HasValue
                ? sample.RuntimeSchedulerSampleRecordedTicks.Value
                : sample.StopwatchTicks;
            return MouseTraceSession.TicksToMicroseconds(recordedTicks - targetTicks.Value);
        }

        private static bool IsRuntimeSchedulerMissing(MouseTraceEvent sample)
        {
            return sample != null
                && (string.Equals(sample.EventType, "runtimeSchedulerPoll", StringComparison.Ordinal) || string.Equals(sample.EventType, "runtimeSchedulerLoop", StringComparison.Ordinal))
                && !sample.RuntimeSchedulerTargetVBlankTicks.HasValue
                && !sample.RuntimeSchedulerPlannedTickTicks.HasValue;
        }

        private static void WriteRuntimeSchedulerDerivedTelemetry(StreamWriter writer, RuntimeSchedulerDerivedTelemetry telemetry)
        {
            WriteNullable(writer, telemetry.CursorReadLatencyMicroseconds);
            writer.Write(",");
            WriteNullable(writer, telemetry.DispatchToReadStartedMicroseconds);
            writer.Write(",");
            WriteNullable(writer, telemetry.QueueToDispatchMicroseconds);
            writer.Write(",");
            WriteNullable(writer, telemetry.ReadCompletedToSampleRecordedMicroseconds);
            writer.Write(",");
            WriteNullable(writer, telemetry.DuplicateHoldRunLength);
            writer.Write(",");
            WriteNullable(writer, telemetry.LastMovementAgeMicroseconds);
            writer.Write(",");
            WriteNullable(writer, telemetry.PollCadenceGapMicroseconds);
            writer.Write(",");
            WriteNullable(writer, telemetry.MissedCadence);
            writer.Write(",");
            WriteNullable(writer, telemetry.SampleToTargetMicroseconds);
            writer.Write(",");
            WriteNullable(writer, telemetry.ReadCompletedToTargetMicroseconds);
        }

        private sealed class RuntimeSchedulerDerivedTelemetryState
        {
            private bool _hasPreviousPoll;
            private bool _hasLastMovement;
            private int _previousX;
            private int _previousY;
            private long _previousRecordedTicks;
            private long _lastMovementRecordedTicks;
            private int _duplicateHoldRunLength;

            public RuntimeSchedulerDerivedTelemetry Next(MouseTraceEvent sample)
            {
                RuntimeSchedulerDerivedTelemetry telemetry = new RuntimeSchedulerDerivedTelemetry();
                if (sample == null || !string.Equals(sample.EventType, "runtimeSchedulerPoll", StringComparison.Ordinal))
                {
                    return telemetry;
                }

                long recordedTicks = sample.RuntimeSchedulerSampleRecordedTicks.HasValue
                    ? sample.RuntimeSchedulerSampleRecordedTicks.Value
                    : sample.StopwatchTicks;
                long? targetTicks = PredictionTargetTicks(sample);

                telemetry.CursorReadLatencyMicroseconds = DeltaMicroseconds(
                    sample.RuntimeSchedulerCursorReadStartedTicks,
                    sample.RuntimeSchedulerCursorReadCompletedTicks);
                telemetry.DispatchToReadStartedMicroseconds = DeltaMicroseconds(
                    sample.RuntimeSchedulerDispatchStartedTicks,
                    sample.RuntimeSchedulerCursorReadStartedTicks);
                telemetry.QueueToDispatchMicroseconds = DeltaMicroseconds(
                    sample.RuntimeSchedulerQueuedTickTicks,
                    sample.RuntimeSchedulerDispatchStartedTicks);
                telemetry.ReadCompletedToSampleRecordedMicroseconds = DeltaMicroseconds(
                    sample.RuntimeSchedulerCursorReadCompletedTicks,
                    sample.RuntimeSchedulerSampleRecordedTicks);
                if (targetTicks.HasValue)
                {
                    telemetry.SampleToTargetMicroseconds = MouseTraceSession.TicksToMicroseconds(targetTicks.Value - recordedTicks);
                    if (sample.RuntimeSchedulerCursorReadCompletedTicks.HasValue)
                    {
                        telemetry.ReadCompletedToTargetMicroseconds = MouseTraceSession.TicksToMicroseconds(targetTicks.Value - sample.RuntimeSchedulerCursorReadCompletedTicks.Value);
                    }
                }

                bool moved = !_hasPreviousPoll || sample.X != _previousX || sample.Y != _previousY;
                if (moved)
                {
                    _duplicateHoldRunLength = 0;
                    _lastMovementRecordedTicks = recordedTicks;
                    _hasLastMovement = true;
                }
                else
                {
                    _duplicateHoldRunLength++;
                }

                telemetry.DuplicateHoldRunLength = _duplicateHoldRunLength;
                if (_hasLastMovement)
                {
                    telemetry.LastMovementAgeMicroseconds = MouseTraceSession.TicksToMicroseconds(recordedTicks - _lastMovementRecordedTicks);
                }

                if (_hasPreviousPoll)
                {
                    long intervalTicks = recordedTicks - _previousRecordedTicks;
                    long? expectedCadenceTicks = ExpectedRuntimeSchedulerCadenceTicks(sample);
                    if (expectedCadenceTicks.HasValue)
                    {
                        telemetry.PollCadenceGapMicroseconds = MouseTraceSession.TicksToMicroseconds(intervalTicks - expectedCadenceTicks.Value);
                        telemetry.MissedCadence = intervalTicks > expectedCadenceTicks.Value + (expectedCadenceTicks.Value / 2);
                    }
                }

                _previousX = sample.X;
                _previousY = sample.Y;
                _previousRecordedTicks = recordedTicks;
                _hasPreviousPoll = true;
                return telemetry;
            }

            private static long? ExpectedRuntimeSchedulerCadenceTicks(MouseTraceEvent sample)
            {
                if (sample.DwmTimingAvailable && sample.DwmTiming.QpcRefreshPeriod > 0 && sample.DwmTiming.QpcRefreshPeriod <= (ulong)long.MaxValue)
                {
                    return (long)sample.DwmTiming.QpcRefreshPeriod;
                }

                return null;
            }
        }

        private sealed class RuntimeSchedulerDerivedTelemetry
        {
            public long? CursorReadLatencyMicroseconds;
            public long? DispatchToReadStartedMicroseconds;
            public long? QueueToDispatchMicroseconds;
            public long? ReadCompletedToSampleRecordedMicroseconds;
            public int? DuplicateHoldRunLength;
            public long? LastMovementAgeMicroseconds;
            public long? PollCadenceGapMicroseconds;
            public bool? MissedCadence;
            public long? SampleToTargetMicroseconds;
            public long? ReadCompletedToTargetMicroseconds;
        }

        private static long? DeltaMicroseconds(long? startTicks, long? endTicks)
        {
            if (!startTicks.HasValue || !endTicks.HasValue)
            {
                return null;
            }

            return MouseTraceSession.TicksToMicroseconds(endTicks.Value - startTicks.Value);
        }

        private static int CountByEvent(MouseTraceSnapshot snapshot, string eventType)
        {
            int count = 0;
            foreach (MouseTraceEvent sample in snapshot.Samples)
            {
                if (string.Equals(sample.EventType, eventType, StringComparison.Ordinal))
                {
                    count++;
                }
            }

            return count;
        }

        private static int CountDwmTimingSamples(MouseTraceSnapshot snapshot)
        {
            int count = 0;
            foreach (MouseTraceEvent sample in snapshot.Samples)
            {
                if (sample.DwmTimingAvailable)
                {
                    count++;
                }
            }

            return count;
        }

        private static MouseTraceIntervalStats CalculateIntervalStats(MouseTraceSnapshot snapshot, string eventType)
        {
            List<double> intervals = new List<double>();
            long previousTicks = 0;
            bool hasPrevious = false;

            foreach (MouseTraceEvent sample in snapshot.Samples)
            {
                if (!string.Equals(sample.EventType, eventType, StringComparison.Ordinal))
                {
                    continue;
                }

                if (hasPrevious)
                {
                    double interval = ((sample.StopwatchTicks - previousTicks) * 1000.0) / Stopwatch.Frequency;
                    if (interval >= 0)
                    {
                        intervals.Add(interval);
                    }
                }

                previousTicks = sample.StopwatchTicks;
                hasPrevious = true;
            }

            MouseTraceIntervalStats stats = new MouseTraceIntervalStats();
            stats.Count = intervals.Count;
            if (intervals.Count == 0)
            {
                return stats;
            }

            intervals.Sort();
            double sum = 0;
            for (int i = 0; i < intervals.Count; i++)
            {
                sum += intervals[i];
            }

            stats.MeanMilliseconds = sum / intervals.Count;
            stats.P50Milliseconds = Percentile(intervals, 0.50);
            stats.P95Milliseconds = Percentile(intervals, 0.95);
            stats.MaxMilliseconds = intervals[intervals.Count - 1];
            return stats;
        }

        private static double Percentile(List<double> sortedValues, double percentile)
        {
            if (sortedValues.Count == 0)
            {
                return 0;
            }

            double index = (sortedValues.Count - 1) * percentile;
            int low = (int)Math.Floor(index);
            int high = (int)Math.Ceiling(index);
            if (low == high)
            {
                return sortedValues[low];
            }

            double fraction = index - low;
            return sortedValues[low] + ((sortedValues[high] - sortedValues[low]) * fraction);
        }

        private static void PopulateDpi(MouseTraceMetadata metadata)
        {
            try
            {
                using (Graphics graphics = Graphics.FromHwnd(IntPtr.Zero))
                {
                    metadata.SystemDpiX = graphics.DpiX;
                    metadata.SystemDpiY = graphics.DpiY;
                }
            }
            catch
            {
                metadata.SystemDpiX = 0;
                metadata.SystemDpiY = 0;
            }
        }

        private static MouseTraceMonitorMetadata[] CollectMonitorMetadata()
        {
            try
            {
                Screen[] screens = Screen.AllScreens;
                MouseTraceMonitorMetadata[] monitors = new MouseTraceMonitorMetadata[screens.Length];
                for (int i = 0; i < screens.Length; i++)
                {
                    Screen screen = screens[i];
                    MouseTraceMonitorMetadata monitor = new MouseTraceMonitorMetadata();
                    monitor.DeviceName = screen.DeviceName;
                    monitor.Primary = screen.Primary;
                    monitor.BitsPerPixel = screen.BitsPerPixel;
                    monitor.BoundsX = screen.Bounds.X;
                    monitor.BoundsY = screen.Bounds.Y;
                    monitor.BoundsWidth = screen.Bounds.Width;
                    monitor.BoundsHeight = screen.Bounds.Height;
                    monitor.WorkingAreaX = screen.WorkingArea.X;
                    monitor.WorkingAreaY = screen.WorkingArea.Y;
                    monitor.WorkingAreaWidth = screen.WorkingArea.Width;
                    monitor.WorkingAreaHeight = screen.WorkingArea.Height;
                    monitors[i] = monitor;
                }

                return monitors;
            }
            catch
            {
                return new MouseTraceMonitorMetadata[0];
            }
        }

        private static string[] BuildQualityWarnings(MouseTraceMetadata metadata)
        {
            List<string> warnings = new List<string>();
            if (metadata.PollSampleCount == 0)
            {
                warnings.Add("no_product_poll_samples");
            }

            if (metadata.ReferencePollSampleCount == 0)
            {
                warnings.Add("no_reference_poll_samples");
            }

            if (metadata.RuntimeSchedulerPollSampleCount == 0)
            {
                warnings.Add("no_runtime_scheduler_poll_samples");
            }

            if (metadata.PollIntervalMilliseconds > 0 && metadata.ProductPollIntervalStats != null && metadata.ProductPollIntervalStats.P95Milliseconds > metadata.PollIntervalMilliseconds * 2.5)
            {
                warnings.Add("product_poll_interval_p95_exceeds_requested_interval");
            }

            if (metadata.ReferencePollIntervalMilliseconds > 0 && metadata.ReferencePollIntervalStats != null && metadata.ReferencePollIntervalStats.P95Milliseconds > metadata.ReferencePollIntervalMilliseconds * 3.0)
            {
                warnings.Add("reference_poll_interval_p95_exceeds_requested_interval");
            }

            if (metadata.PollSampleCount
                + metadata.RuntimeSchedulerPollSampleCount
                + metadata.RuntimeSchedulerLoopSampleCount > 0
                && metadata.DwmTimingAvailabilityPercent < 90.0)
            {
                warnings.Add("dwm_timing_availability_below_90_percent");
            }

            return warnings.ToArray();
        }

        private static string EscapeCsv(string value)
        {
            if (value == null)
            {
                return "";
            }

            if (value.IndexOfAny(new[] { ',', '"', '\r', '\n' }) < 0)
            {
                return value;
            }

            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }
    }
}
