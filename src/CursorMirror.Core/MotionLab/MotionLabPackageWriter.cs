using System;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using CursorMirror.MouseTrace;

namespace CursorMirror.MotionLab
{
    public sealed class MotionLabPackageWriter
    {
        private static readonly Encoding Utf8NoBom = new UTF8Encoding(false);

        public void Write(string path, MotionLabScript script)
        {
            WriteInternal(path, script, null);
        }

        public void Write(string path, MotionLabScenarioSet scenarioSet)
        {
            WriteInternal(path, scenarioSet, null);
        }

        public void Write(string path, MotionLabScript script, MouseTraceSnapshot traceSnapshot)
        {
            if (traceSnapshot == null)
            {
                throw new ArgumentNullException("traceSnapshot");
            }

            WriteInternal(path, script, traceSnapshot);
        }

        public void Write(string path, MotionLabScenarioSet scenarioSet, MouseTraceSnapshot traceSnapshot)
        {
            if (traceSnapshot == null)
            {
                throw new ArgumentNullException("traceSnapshot");
            }

            WriteInternal(path, scenarioSet, traceSnapshot);
        }

        private void WriteInternal(string path, MotionLabScript script, MouseTraceSnapshot traceSnapshot)
        {
            WriteInternal(path, script, null, traceSnapshot);
        }

        private void WriteInternal(string path, MotionLabScenarioSet scenarioSet, MouseTraceSnapshot traceSnapshot)
        {
            WriteInternal(path, null, scenarioSet, traceSnapshot);
        }

        private void WriteInternal(string path, MotionLabScript script, MotionLabScenarioSet scenarioSet, MouseTraceSnapshot traceSnapshot)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Output path must not be empty.", "path");
            }

            if (script == null && scenarioSet == null)
            {
                throw new ArgumentNullException("script");
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
                if (scenarioSet == null)
                {
                    WriteScript(archive, script);
                    WriteSamples(archive, script);
                }
                else
                {
                    WriteScenarioSet(archive, scenarioSet);
                    WriteScenarioSetSamples(archive, scenarioSet);
                }

                if (traceSnapshot == null)
                {
                    WriteMetadata(archive, script, scenarioSet, "metadata.json");
                }
                else
                {
                    new MouseTracePackageWriter().Write(archive, traceSnapshot, "Cursor Mirror Motion Lab");
                    WriteTraceAlignment(archive, script, scenarioSet, traceSnapshot);
                    WriteMetadata(archive, script, scenarioSet, "motion-metadata.json");
                }
            }
        }

        public static string DefaultFileName()
        {
            return "cursor-mirror-motion-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".zip";
        }

        public static string DefaultRecordedFileName()
        {
            return "cursor-mirror-motion-recording-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".zip";
        }

        private static void WriteScript(ZipArchive archive, MotionLabScript script)
        {
            ZipArchiveEntry entry = archive.CreateEntry("motion-script.json", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(MotionLabScript));
                serializer.WriteObject(stream, script);
            }
        }

        private static void WriteScenarioSet(ZipArchive archive, MotionLabScenarioSet scenarioSet)
        {
            ZipArchiveEntry entry = archive.CreateEntry("motion-script.json", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(MotionLabScenarioSet));
                serializer.WriteObject(stream, scenarioSet);
            }
        }

        private static void WriteSamples(ZipArchive archive, MotionLabScript script)
        {
            ZipArchiveEntry entry = archive.CreateEntry("motion-samples.csv", CompressionLevel.Optimal);
            MotionLabSampler sampler = new MotionLabSampler(script);
            int sampleRate = Math.Max(1, script.SampleRateHz);
            double interval = 1000.0 / sampleRate;
            int sampleCount = Math.Max(1, (int)Math.Ceiling(script.DurationMilliseconds / interval) + 1);
            using (Stream stream = entry.Open())
            using (StreamWriter writer = new StreamWriter(stream, Utf8NoBom))
            {
                writer.WriteLine("sequence,elapsedMilliseconds,progress,x,y,velocityPixelsPerSecond,movementPhase,holdIndex,phaseElapsedMilliseconds");
                for (int i = 0; i < sampleCount; i++)
                {
                    double elapsed = Math.Min(script.DurationMilliseconds, i * interval);
                    MotionLabSample sample = sampler.GetSample(elapsed);
                    writer.Write(i.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.ElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.Progress.ToString("0.######", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.X.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.Y.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.VelocityPixelsPerSecond.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.MovementPhase);
                    writer.Write(",");
                    writer.Write(sample.HoldIndex.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.PhaseElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.WriteLine();
                }
            }
        }

        private static void WriteScenarioSetSamples(ZipArchive archive, MotionLabScenarioSet scenarioSet)
        {
            ZipArchiveEntry entry = archive.CreateEntry("motion-samples.csv", CompressionLevel.Optimal);
            MotionLabScenarioSetSampler sampler = new MotionLabScenarioSetSampler(scenarioSet);
            int sampleRate = Math.Max(1, scenarioSet.SampleRateHz);
            double interval = 1000.0 / sampleRate;
            int sampleCount = Math.Max(1, (int)Math.Ceiling(sampler.TotalDurationMilliseconds / interval) + 1);
            using (Stream stream = entry.Open())
            using (StreamWriter writer = new StreamWriter(stream, Utf8NoBom))
            {
                writer.WriteLine("sequence,elapsedMilliseconds,scenarioIndex,scenarioElapsedMilliseconds,progress,x,y,velocityPixelsPerSecond,movementPhase,holdIndex,phaseElapsedMilliseconds");
                for (int i = 0; i < sampleCount; i++)
                {
                    double elapsed = Math.Min(sampler.TotalDurationMilliseconds, i * interval);
                    MotionLabScenarioSetSample sample = sampler.GetSample(elapsed);
                    writer.Write(i.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.ElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.ScenarioIndex.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.ScenarioElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.Progress.ToString("0.######", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.X.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.Y.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.VelocityPixelsPerSecond.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.MovementPhase);
                    writer.Write(",");
                    writer.Write(sample.HoldIndex.ToString(CultureInfo.InvariantCulture));
                    writer.Write(",");
                    writer.Write(sample.PhaseElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
                    writer.WriteLine();
                }
            }
        }

        private static void WriteMetadata(ZipArchive archive, MotionLabScript script, MotionLabScenarioSet scenarioSet, string entryName)
        {
            MotionLabMetadata metadata = new MotionLabMetadata();
            metadata.MotionSampleFormatVersion = 3;
            metadata.ProductName = "Cursor Mirror Motion Lab";
            metadata.ProductVersion = BuildVersion.InformationalVersion;
            metadata.CreatedUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            if (scenarioSet == null)
            {
                metadata.GenerationProfile = script.GenerationProfile;
                metadata.Seed = script.Seed;
                metadata.ScenarioCount = 1;
                metadata.ControlPointCount = script.ControlPoints == null ? 0 : script.ControlPoints.Length;
                metadata.SpeedPointCount = script.SpeedPoints == null ? 0 : script.SpeedPoints.Length;
                metadata.HoldSegmentCount = CountHoldSegments(script);
                metadata.HoldDurationMilliseconds = SumHoldDuration(script);
                metadata.DurationMilliseconds = script.DurationMilliseconds;
                metadata.ScenarioDurationMilliseconds = script.DurationMilliseconds;
                metadata.SampleRateHz = script.SampleRateHz;
            }
            else
            {
                metadata.GenerationProfile = scenarioSet.GenerationProfile;
                metadata.Seed = scenarioSet.Seed;
                metadata.ScenarioCount = scenarioSet.Scenarios == null ? 0 : scenarioSet.Scenarios.Length;
                metadata.ControlPointCount = CountControlPoints(scenarioSet);
                metadata.SpeedPointCount = CountSpeedPoints(scenarioSet);
                metadata.HoldSegmentCount = CountHoldSegments(scenarioSet);
                metadata.HoldDurationMilliseconds = SumHoldDuration(scenarioSet);
                metadata.DurationMilliseconds = scenarioSet.DurationMilliseconds;
                metadata.ScenarioDurationMilliseconds = scenarioSet.ScenarioDurationMilliseconds;
                metadata.SampleRateHz = scenarioSet.SampleRateHz;
            }

            ZipArchiveEntry entry = archive.CreateEntry(entryName, CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(MotionLabMetadata));
                serializer.WriteObject(stream, metadata);
            }
        }

        private static void WriteTraceAlignment(ZipArchive archive, MotionLabScript script, MotionLabScenarioSet scenarioSet, MouseTraceSnapshot traceSnapshot)
        {
            if (traceSnapshot == null)
            {
                return;
            }

            ZipArchiveEntry entry = archive.CreateEntry("motion-trace-alignment.csv", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            using (StreamWriter writer = new StreamWriter(stream, Utf8NoBom))
            {
                writer.WriteLine("traceSequence,traceEvent,traceElapsedMicroseconds,generatedElapsedMilliseconds,scenarioIndex,scenarioElapsedMilliseconds,progress,generatedX,generatedY,velocityPixelsPerSecond,movementPhase,holdIndex,phaseElapsedMilliseconds");
                if (scenarioSet == null)
                {
                    WriteScriptTraceAlignmentRows(writer, script, traceSnapshot);
                }
                else
                {
                    WriteScenarioSetTraceAlignmentRows(writer, scenarioSet, traceSnapshot);
                }
            }
        }

        private static void WriteScriptTraceAlignmentRows(StreamWriter writer, MotionLabScript script, MouseTraceSnapshot traceSnapshot)
        {
            MotionLabSampler sampler = new MotionLabSampler(script);
            foreach (MouseTraceEvent traceSample in traceSnapshot.Samples)
            {
                double elapsedMilliseconds = Math.Max(0.0, traceSample.ElapsedMicroseconds / 1000.0);
                MotionLabSample sample = sampler.GetSample(elapsedMilliseconds);
                WriteTraceAlignmentPrefix(writer, traceSample, sample.ElapsedMilliseconds, 0, sample.ElapsedMilliseconds);
                WriteTraceAlignmentSample(writer, sample.Progress, sample.X, sample.Y, sample.VelocityPixelsPerSecond, sample.MovementPhase, sample.HoldIndex, sample.PhaseElapsedMilliseconds);
            }
        }

        private static void WriteScenarioSetTraceAlignmentRows(StreamWriter writer, MotionLabScenarioSet scenarioSet, MouseTraceSnapshot traceSnapshot)
        {
            MotionLabScenarioSetSampler sampler = new MotionLabScenarioSetSampler(scenarioSet);
            foreach (MouseTraceEvent traceSample in traceSnapshot.Samples)
            {
                double elapsedMilliseconds = Math.Max(0.0, traceSample.ElapsedMicroseconds / 1000.0);
                MotionLabScenarioSetSample sample = sampler.GetSample(elapsedMilliseconds);
                WriteTraceAlignmentPrefix(writer, traceSample, sample.ElapsedMilliseconds, sample.ScenarioIndex, sample.ScenarioElapsedMilliseconds);
                WriteTraceAlignmentSample(writer, sample.Progress, sample.X, sample.Y, sample.VelocityPixelsPerSecond, sample.MovementPhase, sample.HoldIndex, sample.PhaseElapsedMilliseconds);
            }
        }

        private static void WriteTraceAlignmentPrefix(StreamWriter writer, MouseTraceEvent traceSample, double generatedElapsedMilliseconds, int scenarioIndex, double scenarioElapsedMilliseconds)
        {
            writer.Write(traceSample.Sequence.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(EscapeCsv(traceSample.EventType));
            writer.Write(",");
            writer.Write(traceSample.ElapsedMicroseconds.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(generatedElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(scenarioIndex.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(scenarioElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
            writer.Write(",");
        }

        private static void WriteTraceAlignmentSample(
            StreamWriter writer,
            double progress,
            double x,
            double y,
            double velocityPixelsPerSecond,
            string movementPhase,
            int holdIndex,
            double phaseElapsedMilliseconds)
        {
            writer.Write(progress.ToString("0.######", CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(x.ToString("0.###", CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(y.ToString("0.###", CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(velocityPixelsPerSecond.ToString("0.###", CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(EscapeCsv(movementPhase));
            writer.Write(",");
            writer.Write(holdIndex.ToString(CultureInfo.InvariantCulture));
            writer.Write(",");
            writer.Write(phaseElapsedMilliseconds.ToString("0.###", CultureInfo.InvariantCulture));
            writer.WriteLine();
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

        [DataContract]
        private sealed class MotionLabMetadata
        {
            [DataMember(Order = 1)]
            public int MotionSampleFormatVersion { get; set; }

            [DataMember(Order = 2)]
            public string ProductName { get; set; }

            [DataMember(Order = 3)]
            public string ProductVersion { get; set; }

            [DataMember(Order = 4)]
            public string CreatedUtc { get; set; }

            [DataMember(Order = 5)]
            public string GenerationProfile { get; set; }

            [DataMember(Order = 6)]
            public int Seed { get; set; }

            [DataMember(Order = 7)]
            public int ScenarioCount { get; set; }

            [DataMember(Order = 8)]
            public int ControlPointCount { get; set; }

            [DataMember(Order = 9)]
            public int SpeedPointCount { get; set; }

            [DataMember(Order = 10)]
            public int HoldSegmentCount { get; set; }

            [DataMember(Order = 11)]
            public double HoldDurationMilliseconds { get; set; }

            [DataMember(Order = 12)]
            public double DurationMilliseconds { get; set; }

            [DataMember(Order = 13)]
            public double ScenarioDurationMilliseconds { get; set; }

            [DataMember(Order = 14)]
            public int SampleRateHz { get; set; }
        }

        private static int CountControlPoints(MotionLabScenarioSet scenarioSet)
        {
            int count = 0;
            MotionLabScript[] scenarios = scenarioSet.Scenarios ?? new MotionLabScript[0];
            for (int i = 0; i < scenarios.Length; i++)
            {
                MotionLabScript scenario = scenarios[i];
                count += scenario == null || scenario.ControlPoints == null ? 0 : scenario.ControlPoints.Length;
            }

            return count;
        }

        private static int CountSpeedPoints(MotionLabScenarioSet scenarioSet)
        {
            int count = 0;
            MotionLabScript[] scenarios = scenarioSet.Scenarios ?? new MotionLabScript[0];
            for (int i = 0; i < scenarios.Length; i++)
            {
                MotionLabScript scenario = scenarios[i];
                count += scenario == null || scenario.SpeedPoints == null ? 0 : scenario.SpeedPoints.Length;
            }

            return count;
        }

        private static int CountHoldSegments(MotionLabScript script)
        {
            return script == null || script.HoldSegments == null ? 0 : script.HoldSegments.Length;
        }

        private static int CountHoldSegments(MotionLabScenarioSet scenarioSet)
        {
            int count = 0;
            MotionLabScript[] scenarios = scenarioSet.Scenarios ?? new MotionLabScript[0];
            for (int i = 0; i < scenarios.Length; i++)
            {
                count += CountHoldSegments(scenarios[i]);
            }

            return count;
        }

        private static double SumHoldDuration(MotionLabScript script)
        {
            double total = 0;
            MotionLabHoldSegment[] holds = script == null ? null : script.HoldSegments;
            if (holds == null)
            {
                return 0;
            }

            for (int i = 0; i < holds.Length; i++)
            {
                if (holds[i] != null)
                {
                    total += Math.Max(0.0, holds[i].DurationMilliseconds);
                }
            }

            return total;
        }

        private static double SumHoldDuration(MotionLabScenarioSet scenarioSet)
        {
            double total = 0;
            MotionLabScript[] scenarios = scenarioSet.Scenarios ?? new MotionLabScript[0];
            for (int i = 0; i < scenarios.Length; i++)
            {
                total += SumHoldDuration(scenarios[i]);
            }

            return total;
        }
    }
}
