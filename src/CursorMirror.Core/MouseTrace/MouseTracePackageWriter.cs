using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Runtime.Serialization.Json;
using System.Text;

namespace CursorMirror.MouseTrace
{
    public sealed class MouseTracePackageWriter
    {
        private static readonly Encoding Utf8NoBom = new UTF8Encoding(false);

        public void Write(string path, MouseTraceSnapshot snapshot)
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
                WriteTraceCsv(archive, snapshot);
                WriteMetadata(archive, snapshot);
            }
        }

        private static void WriteTraceCsv(ZipArchive archive, MouseTraceSnapshot snapshot)
        {
            ZipArchiveEntry entry = archive.CreateEntry("trace.csv", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            using (StreamWriter writer = new StreamWriter(stream, Utf8NoBom))
            {
                writer.WriteLine("sequence,stopwatchTicks,elapsedMicroseconds,x,y,event,hookX,hookY,cursorX,cursorY,hookMouseData,hookFlags,hookTimeMilliseconds,hookExtraInfo,dwmTimingAvailable,dwmRateRefreshNumerator,dwmRateRefreshDenominator,dwmQpcRefreshPeriod,dwmQpcVBlank,dwmRefreshCount,dwmQpcCompose,dwmFrame,dwmRefreshFrame,dwmFrameDisplayed,dwmQpcFrameDisplayed,dwmRefreshFrameDisplayed,dwmFrameComplete,dwmQpcFrameComplete,dwmFramePending,dwmQpcFramePending,dwmRefreshNextDisplayed,dwmRefreshNextPresented,dwmFramesDisplayed,dwmFramesDropped,dwmFramesMissed");
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
                    writer.WriteLine();
                }
            }
        }

        private static void WriteMetadata(ZipArchive archive, MouseTraceSnapshot snapshot)
        {
            MouseTraceMetadata metadata = new MouseTraceMetadata();
            metadata.TraceFormatVersion = 2;
            metadata.ProductName = LocalizedStrings.TraceToolTitle;
            metadata.ProductVersion = BuildVersion.InformationalVersion;
            metadata.CreatedUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            metadata.SampleCount = snapshot.Samples.Length;
            metadata.HookSampleCount = CountByEvent(snapshot, "move");
            metadata.PollSampleCount = CountByEvent(snapshot, "poll");
            metadata.DwmTimingSampleCount = CountDwmTimingSamples(snapshot);
            metadata.PollIntervalMilliseconds = snapshot.PollIntervalMilliseconds;
            metadata.DurationMicroseconds = snapshot.DurationMicroseconds;
            metadata.StopwatchFrequency = Stopwatch.Frequency.ToString(CultureInfo.InvariantCulture);

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
