using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Runtime.Serialization.Json;
using System.Text;

namespace CursorMirror.Calibrator
{
    public sealed class CalibrationPackageWriter
    {
        private static readonly Encoding Utf8NoBom = new UTF8Encoding(false);

        public static string DefaultFileName()
        {
            return "cursor-mirror-calibration-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".zip";
        }

        public void Write(string path, IList<CalibrationFrameAnalysis> frames, CalibrationSummary summary)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Output path must not be empty.", "path");
            }

            if (frames == null)
            {
                throw new ArgumentNullException("frames");
            }

            if (summary == null)
            {
                throw new ArgumentNullException("summary");
            }

            if (frames.Count == 0)
            {
                throw new InvalidOperationException("Cannot save an empty calibration run.");
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
                WriteFrames(archive, frames, summary);
                WriteSummary(archive, summary);
            }
        }

        private static void WriteFrames(ZipArchive archive, IList<CalibrationFrameAnalysis> frames, CalibrationSummary summary)
        {
            ZipArchiveEntry entry = archive.CreateEntry("frames.csv", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            using (StreamWriter writer = new StreamWriter(stream, Utf8NoBom))
            {
                writer.WriteLine("frameIndex,timestampTicks,elapsedMilliseconds,motionSourceName,generationProfile,patternName,phaseName,scenarioIndex,scenarioElapsedMilliseconds,progress,holdIndex,phaseElapsedMilliseconds,expectedX,expectedY,expectedVelocityPixelsPerSecond,width,height,darkPixelCount,hasDarkPixels,darkBoundsX,darkBoundsY,darkBoundsWidth,darkBoundsHeight,estimatedSeparationPixels");
                for (int i = 0; i < frames.Count; i++)
                {
                    CalibrationFrameAnalysis frame = frames[i];
                    int separation = 0;
                    if (frame.HasDarkPixels)
                    {
                        separation = Math.Max(
                            Math.Max(0, frame.DarkBoundsWidth - summary.BaselineDarkBoundsWidth),
                            Math.Max(0, frame.DarkBoundsHeight - summary.BaselineDarkBoundsHeight));
                    }

                    writer.Write(frame.FrameIndex.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.TimestampTicks.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.ElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    WriteCsvString(writer, frame.MotionSourceName);
                    writer.Write(",");
                    WriteCsvString(writer, frame.GenerationProfile);
                    writer.Write(",");
                    WriteCsvString(writer, frame.PatternName);
                    writer.Write(",");
                    WriteCsvString(writer, frame.PhaseName);
                    writer.Write(",");
                    writer.Write(frame.ScenarioIndex.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.ScenarioElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.Progress.ToString("0.######", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.HoldIndex.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.PhaseElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.ExpectedX.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.ExpectedY.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.ExpectedVelocityPixelsPerSecond.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.Width.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.Height.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.DarkPixelCount.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.HasDarkPixels ? "true" : "false");
                    writer.Write(",");
                    writer.Write(frame.DarkBoundsX.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.DarkBoundsY.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.DarkBoundsWidth.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(frame.DarkBoundsHeight.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(separation.ToString(CultureInfo.InvariantCulture));
                    writer.WriteLine();
                }
            }
        }

        private static void WriteCsvString(StreamWriter writer, string value)
        {
            string text = value ?? string.Empty;
            if (text.IndexOfAny(new[] { ',', '"', '\r', '\n' }) >= 0)
            {
                writer.Write("\"");
                writer.Write(text.Replace("\"", "\"\""));
                writer.Write("\"");
            }
            else
            {
                writer.Write(text);
            }
        }

        private static void WriteSummary(ZipArchive archive, CalibrationSummary summary)
        {
            ZipArchiveEntry entry = archive.CreateEntry("metrics.json", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(CalibrationSummary));
                serializer.WriteObject(stream, summary);
            }
        }
    }
}
