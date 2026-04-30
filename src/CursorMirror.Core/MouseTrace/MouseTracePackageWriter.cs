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
                writer.WriteLine("sequence,stopwatchTicks,elapsedMicroseconds,x,y,event");
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
                    writer.WriteLine();
                }
            }
        }

        private static void WriteMetadata(ZipArchive archive, MouseTraceSnapshot snapshot)
        {
            MouseTraceMetadata metadata = new MouseTraceMetadata();
            metadata.ProductName = LocalizedStrings.TraceToolTitle;
            metadata.ProductVersion = BuildVersion.InformationalVersion;
            metadata.CreatedUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            metadata.SampleCount = snapshot.Samples.Length;
            metadata.DurationMicroseconds = snapshot.DurationMicroseconds;
            metadata.StopwatchFrequency = Stopwatch.Frequency.ToString(CultureInfo.InvariantCulture);

            ZipArchiveEntry entry = archive.CreateEntry("metadata.json", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(MouseTraceMetadata));
                serializer.WriteObject(stream, metadata);
            }
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
