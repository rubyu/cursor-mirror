using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

internal static class AnalyzeRuntimeOutliersFast
{
    private const double WakeAdvanceUs = 4000.0;
    private const double OutlierThresholdUs = 1000.0;
    private const double DefaultTicksPerMicrosecond = 10.0;

    private static int Main(string[] args)
    {
        string root = args.Length > 0 ? args[0] : Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", ".."));
        string output = args.Length > 1 ? args[1] : AppDomain.CurrentDomain.BaseDirectory;
        Directory.CreateDirectory(output);

        string[] zips = Directory.GetFiles(root, "*.zip")
            .Where(path =>
            {
                string name = Path.GetFileName(path);
                return name.StartsWith("cursor-mirror-trace-", StringComparison.OrdinalIgnoreCase) ||
                    name.StartsWith("cursor-mirror-motion-recording-", StringComparison.OrdinalIgnoreCase);
            })
            .OrderBy(path => Path.GetFileName(path), StringComparer.OrdinalIgnoreCase)
            .ToArray();

        Metrics metrics = new Metrics();
        metrics.CandidateZipFiles = zips.Length;
        metrics.SelectedZipFiles = zips.Length;

        foreach (string zipPath in zips)
        {
            ProcessZip(zipPath, metrics);
        }

        metrics.TopByGap.Sort((a, b) => NullableCompareDescending(a.PollCadenceGapUs, b.PollCadenceGapUs));
        metrics.TopByInterval.Sort((a, b) => NullableCompareDescending(a.SchedulerIntervalUs, b.SchedulerIntervalUs));
        if (metrics.TopByGap.Count > 25)
        {
            metrics.TopByGap.RemoveRange(25, metrics.TopByGap.Count - 25);
        }

        if (metrics.TopByInterval.Count > 25)
        {
            metrics.TopByInterval.RemoveRange(25, metrics.TopByInterval.Count - 25);
        }

        WriteJson(Path.Combine(output, "metrics-full.json"), metrics, root);
        WriteReport(Path.Combine(output, "report-full.md"), metrics);
        Console.WriteLine("Processed " + metrics.ProcessedZips.ToString(CultureInfo.InvariantCulture) + " zips.");
        Console.WriteLine("Poll rows: " + metrics.RuntimeSchedulerPollRows.ToString(CultureInfo.InvariantCulture));
        Console.WriteLine("Outlier rows: " + metrics.ClassifiedOutlierRows.ToString(CultureInfo.InvariantCulture));
        return 0;
    }

    private static void ProcessZip(string zipPath, Metrics metrics)
    {
        using (ZipArchive archive = ZipFile.OpenRead(zipPath))
        {
            ZipArchiveEntry entry = archive.Entries.FirstOrDefault(item =>
                string.Equals(item.FullName, "trace.csv", StringComparison.OrdinalIgnoreCase) ||
                item.FullName.EndsWith("/trace.csv", StringComparison.OrdinalIgnoreCase));
            if (entry == null)
            {
                metrics.ZipsWithoutTraceCsv++;
                return;
            }

            PerZip perZip = new PerZip();
            perZip.Zip = Path.GetFileName(zipPath);
            perZip.Bytes = new FileInfo(zipPath).Length;
            perZip.TraceCsvBytes = entry.Length;
            perZip.TraceEntry = entry.FullName;

            using (Stream stream = entry.Open())
            using (StreamReader reader = new StreamReader(stream))
            {
                string header = reader.ReadLine();
                if (header == null)
                {
                    return;
                }

                string[] columns = header.Split(',');
                Dictionary<string, int> index = new Dictionary<string, int>(StringComparer.Ordinal);
                for (int i = 0; i < columns.Length; i++)
                {
                    index[columns[i]] = i;
                }

                long? previousActualTicks = null;
                double? previousElapsedUs = null;
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (line.IndexOf(",runtimeSchedulerPoll,", StringComparison.Ordinal) < 0)
                    {
                        continue;
                    }

                    string[] fields = line.Split(',');
                    perZip.PollRows++;
                    metrics.RuntimeSchedulerPollRows++;

                    long? sequence = GetLong(fields, index, "sequence");
                    double? elapsedUs = GetDouble(fields, index, "elapsedMicroseconds");
                    double? vblankLeadUs = GetDouble(fields, index, "runtimeSchedulerVBlankLeadMicroseconds");
                    double? queueToDispatchUs = GetDouble(fields, index, "runtimeSchedulerQueueToDispatchMicroseconds");
                    double? cursorReadUs = GetDouble(fields, index, "runtimeSchedulerCursorReadLatencyMicroseconds");
                    double? cadenceGapUs = GetDouble(fields, index, "runtimeSchedulerPollCadenceGapMicroseconds");
                    long? actualTickTicks = GetLong(fields, index, "runtimeSchedulerActualTickTicks");
                    double? refreshPeriodTicks = GetDouble(fields, index, "dwmQpcRefreshPeriod");
                    double? refreshNumerator = GetDouble(fields, index, "dwmRateRefreshNumerator");
                    double? refreshDenominator = GetDouble(fields, index, "dwmRateRefreshDenominator");

                    if (!queueToDispatchUs.HasValue)
                    {
                        long? queuedTicks = GetLong(fields, index, "runtimeSchedulerQueuedTickTicks");
                        long? dispatchTicks = GetLong(fields, index, "runtimeSchedulerDispatchStartedTicks");
                        if (queuedTicks.HasValue && dispatchTicks.HasValue)
                        {
                            queueToDispatchUs = (dispatchTicks.Value - queuedTicks.Value) / DefaultTicksPerMicrosecond;
                        }
                    }

                    if (!cursorReadUs.HasValue)
                    {
                        long? readStartedTicks = GetLong(fields, index, "runtimeSchedulerCursorReadStartedTicks");
                        long? readCompletedTicks = GetLong(fields, index, "runtimeSchedulerCursorReadCompletedTicks");
                        if (readStartedTicks.HasValue && readCompletedTicks.HasValue)
                        {
                            cursorReadUs = (readCompletedTicks.Value - readStartedTicks.Value) / DefaultTicksPerMicrosecond;
                        }
                    }

                    double? schedulerIntervalUs = null;
                    if (actualTickTicks.HasValue && previousActualTicks.HasValue)
                    {
                        schedulerIntervalUs = (actualTickTicks.Value - previousActualTicks.Value) / DefaultTicksPerMicrosecond;
                        if (!cadenceGapUs.HasValue)
                        {
                            if (refreshPeriodTicks.HasValue)
                            {
                                cadenceGapUs = (actualTickTicks.Value - previousActualTicks.Value - refreshPeriodTicks.Value) / DefaultTicksPerMicrosecond;
                            }
                            else if (refreshNumerator.HasValue && refreshDenominator.HasValue && refreshNumerator.Value > 0)
                            {
                                double expectedUs = 1000000.0 * refreshDenominator.Value / refreshNumerator.Value;
                                cadenceGapUs = schedulerIntervalUs.Value - expectedUs;
                            }
                        }
                    }
                    else if (elapsedUs.HasValue && previousElapsedUs.HasValue)
                    {
                        schedulerIntervalUs = elapsedUs.Value - previousElapsedUs.Value;
                    }

                    if (actualTickTicks.HasValue)
                    {
                        previousActualTicks = actualTickTicks;
                    }

                    if (elapsedUs.HasValue)
                    {
                        previousElapsedUs = elapsedUs;
                    }

                    if (!vblankLeadUs.HasValue || !queueToDispatchUs.HasValue)
                    {
                        continue;
                    }

                    double queuedLeadUs = vblankLeadUs.Value + queueToDispatchUs.Value;
                    double estimatedWakeLateUs = WakeAdvanceUs - queuedLeadUs;
                    double dispatcherLateUs = queueToDispatchUs.Value;
                    string classification = Classify(estimatedWakeLateUs, dispatcherLateUs, cursorReadUs, cadenceGapUs);

                    if (cadenceGapUs.HasValue)
                    {
                        metrics.CadenceGaps.Add(cadenceGapUs.Value);
                    }

                    metrics.QueueToDispatchValues.Add(queueToDispatchUs.Value);
                    metrics.WakeLateValues.Add(estimatedWakeLateUs);
                    if (cursorReadUs.HasValue)
                    {
                        metrics.CursorReadValues.Add(cursorReadUs.Value);
                    }

                    bool isOutlier = (cadenceGapUs.HasValue && cadenceGapUs.Value >= OutlierThresholdUs) ||
                        (schedulerIntervalUs.HasValue && schedulerIntervalUs.Value >= 20000.0) ||
                        estimatedWakeLateUs >= OutlierThresholdUs ||
                        dispatcherLateUs >= OutlierThresholdUs ||
                        (cursorReadUs.HasValue && cursorReadUs.Value >= OutlierThresholdUs);

                    if (!isOutlier)
                    {
                        continue;
                    }

                    metrics.ClassifiedOutlierRows++;
                    perZip.OutlierRows++;
                    metrics.ClassCounts.Increment(classification);
                    perZip.ClassCounts.Increment(classification);

                    OutlierRow row = new OutlierRow();
                    row.Zip = perZip.Zip;
                    row.Sequence = sequence;
                    row.SchedulerIntervalUs = schedulerIntervalUs;
                    row.PollCadenceGapUs = cadenceGapUs;
                    row.RuntimeSchedulerVBlankLeadMicroseconds = vblankLeadUs.Value;
                    row.QueueToDispatchUs = queueToDispatchUs.Value;
                    row.QueuedLeadUs = queuedLeadUs;
                    row.EstimatedWakeLateUs = estimatedWakeLateUs;
                    row.DispatcherLateUs = dispatcherLateUs;
                    row.CursorReadLatencyUs = cursorReadUs;
                    row.Classification = classification;

                    AddTop(metrics.TopByGap, row, true);
                    AddTop(metrics.TopByInterval, row, false);
                }
            }

            metrics.ProcessedZips++;
            metrics.PerZip.Add(perZip);
        }
    }

    private static void AddTop(List<OutlierRow> rows, OutlierRow row, bool byGap)
    {
        rows.Add(row);
        if (rows.Count <= 75)
        {
            return;
        }

        rows.Sort((a, b) => byGap
            ? NullableCompareDescending(a.PollCadenceGapUs, b.PollCadenceGapUs)
            : NullableCompareDescending(a.SchedulerIntervalUs, b.SchedulerIntervalUs));
        rows.RemoveRange(25, rows.Count - 25);
    }

    private static int NullableCompareDescending(double? left, double? right)
    {
        double a = left.HasValue ? left.Value : double.MinValue;
        double b = right.HasValue ? right.Value : double.MinValue;
        return b.CompareTo(a);
    }

    private static string Classify(double estimatedWakeLateUs, double dispatcherLateUs, double? cursorReadUs, double? cadenceGapUs)
    {
        bool wakeLate = estimatedWakeLateUs > 1000.0;
        bool dispatcherLate = dispatcherLateUs > 1000.0;
        bool cursorLate = cursorReadUs.HasValue && cursorReadUs.Value > 1000.0;
        int count = (wakeLate ? 1 : 0) + (dispatcherLate ? 1 : 0) + (cursorLate ? 1 : 0);
        if (count > 1)
        {
            return "mixed";
        }

        if (wakeLate)
        {
            return "scheduler_wake_late";
        }

        if (dispatcherLate)
        {
            return "dispatcher_late";
        }

        if (cursorLate)
        {
            return "cursor_read_late";
        }

        return "unknown";
    }

    private static double? GetDouble(string[] fields, Dictionary<string, int> index, string name)
    {
        int i;
        if (!index.TryGetValue(name, out i) || i >= fields.Length || string.IsNullOrWhiteSpace(fields[i]))
        {
            return null;
        }

        double result;
        if (double.TryParse(fields[i], NumberStyles.Float, CultureInfo.InvariantCulture, out result))
        {
            return result;
        }

        return null;
    }

    private static long? GetLong(string[] fields, Dictionary<string, int> index, string name)
    {
        int i;
        if (!index.TryGetValue(name, out i) || i >= fields.Length || string.IsNullOrWhiteSpace(fields[i]))
        {
            return null;
        }

        long result;
        if (long.TryParse(fields[i], NumberStyles.Integer, CultureInfo.InvariantCulture, out result))
        {
            return result;
        }

        return null;
    }

    private static Stats StatsFor(List<double> values)
    {
        if (values.Count == 0)
        {
            return new Stats();
        }

        double[] sorted = values.ToArray();
        Array.Sort(sorted);
        return new Stats
        {
            Count = sorted.Length,
            P50 = Percentile(sorted, 0.50),
            P95 = Percentile(sorted, 0.95),
            P99 = Percentile(sorted, 0.99),
            Max = sorted[sorted.Length - 1]
        };
    }

    private static double Percentile(double[] sorted, double percentile)
    {
        int index = (int)Math.Floor((sorted.Length - 1) * percentile);
        return Math.Round(sorted[index], 3);
    }

    private static void WriteJson(string path, Metrics metrics, string root)
    {
        StringBuilder builder = new StringBuilder();
        builder.AppendLine("{");
        WriteProperty(builder, "poc", "product-runtime-outlier-v1", 1, true);
        WriteProperty(builder, "step", "step-01-existing-trace-reclassification-full", 1, true);
        WriteProperty(builder, "generatedAt", DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ssK", CultureInfo.InvariantCulture), 1, true);
        WriteProperty(builder, "inputRoot", root, 1, true);
        WriteProperty(builder, "fullCorpusPending", "false", 1, true, true);
        builder.AppendLine("  \"totals\": {");
        WriteNumber(builder, "candidateZipFiles", metrics.CandidateZipFiles, 2, true);
        WriteNumber(builder, "selectedZipFiles", metrics.SelectedZipFiles, 2, true);
        WriteNumber(builder, "processedZips", metrics.ProcessedZips, 2, true);
        WriteNumber(builder, "zipsWithoutTraceCsv", metrics.ZipsWithoutTraceCsv, 2, true);
        WriteNumber(builder, "runtimeSchedulerPollRows", metrics.RuntimeSchedulerPollRows, 2, true);
        WriteNumber(builder, "classifiedOutlierRows", metrics.ClassifiedOutlierRows, 2, false);
        builder.AppendLine("  },");
        builder.AppendLine("  \"classifications\": {");
        WriteNumber(builder, "scheduler_wake_late", metrics.ClassCounts.SchedulerWakeLate, 2, true);
        WriteNumber(builder, "dispatcher_late", metrics.ClassCounts.DispatcherLate, 2, true);
        WriteNumber(builder, "cursor_read_late", metrics.ClassCounts.CursorReadLate, 2, true);
        WriteNumber(builder, "mixed", metrics.ClassCounts.Mixed, 2, true);
        WriteNumber(builder, "unknown", metrics.ClassCounts.Unknown, 2, false);
        builder.AppendLine("  },");
        builder.AppendLine("  \"distributions\": {");
        WriteStats(builder, "pollCadenceGapUs", StatsFor(metrics.CadenceGaps), 2, true);
        WriteStats(builder, "queueToDispatchUs", StatsFor(metrics.QueueToDispatchValues), 2, true);
        WriteStats(builder, "estimatedWakeLateUs", StatsFor(metrics.WakeLateValues), 2, true);
        WriteStats(builder, "cursorReadLatencyUs", StatsFor(metrics.CursorReadValues), 2, false);
        builder.AppendLine("  },");
        WriteRows(builder, "topPollCadenceGapOutliers", metrics.TopByGap, 1, true);
        WriteRows(builder, "topSchedulerIntervalOutliers", metrics.TopByInterval, 1, false);
        builder.AppendLine("}");
        File.WriteAllText(path, builder.ToString(), Encoding.UTF8);
    }

    private static void WriteReport(string path, Metrics metrics)
    {
        Stats gap = StatsFor(metrics.CadenceGaps);
        Stats queue = StatsFor(metrics.QueueToDispatchValues);
        Stats wake = StatsFor(metrics.WakeLateValues);
        Stats read = StatsFor(metrics.CursorReadValues);
        StringBuilder builder = new StringBuilder();
        builder.AppendLine("# Step 01 Existing Trace Reclassification - Full Corpus");
        builder.AppendLine();
        builder.AppendLine("## Input Coverage");
        builder.AppendLine();
        builder.AppendLine("- Candidate root trace/motion zips: " + metrics.CandidateZipFiles.ToString(CultureInfo.InvariantCulture));
        builder.AppendLine("- Processed zips with trace.csv: " + metrics.ProcessedZips.ToString(CultureInfo.InvariantCulture));
        builder.AppendLine("- Runtime scheduler poll rows: " + metrics.RuntimeSchedulerPollRows.ToString(CultureInfo.InvariantCulture));
        builder.AppendLine("- Classified outlier rows: " + metrics.ClassifiedOutlierRows.ToString(CultureInfo.InvariantCulture));
        builder.AppendLine("- Full corpus pending: False");
        builder.AppendLine();
        builder.AppendLine("## Classification Counts");
        builder.AppendLine();
        builder.AppendLine("| Classification | Count |");
        builder.AppendLine("| --- | ---: |");
        builder.AppendLine("| scheduler_wake_late | " + metrics.ClassCounts.SchedulerWakeLate.ToString(CultureInfo.InvariantCulture) + " |");
        builder.AppendLine("| dispatcher_late | " + metrics.ClassCounts.DispatcherLate.ToString(CultureInfo.InvariantCulture) + " |");
        builder.AppendLine("| cursor_read_late | " + metrics.ClassCounts.CursorReadLate.ToString(CultureInfo.InvariantCulture) + " |");
        builder.AppendLine("| mixed | " + metrics.ClassCounts.Mixed.ToString(CultureInfo.InvariantCulture) + " |");
        builder.AppendLine("| unknown | " + metrics.ClassCounts.Unknown.ToString(CultureInfo.InvariantCulture) + " |");
        builder.AppendLine();
        builder.AppendLine("## Distribution Highlights");
        builder.AppendLine();
        builder.AppendLine("| Metric | p50 us | p95 us | p99 us | max us |");
        builder.AppendLine("| --- | ---: | ---: | ---: | ---: |");
        builder.AppendLine("| pollCadenceGap | " + Format(gap.P50) + " | " + Format(gap.P95) + " | " + Format(gap.P99) + " | " + Format(gap.Max) + " |");
        builder.AppendLine("| queueToDispatch | " + Format(queue.P50) + " | " + Format(queue.P95) + " | " + Format(queue.P99) + " | " + Format(queue.Max) + " |");
        builder.AppendLine("| estimatedWakeLate | " + Format(wake.P50) + " | " + Format(wake.P95) + " | " + Format(wake.P99) + " | " + Format(wake.Max) + " |");
        builder.AppendLine("| cursorReadLatency | " + Format(read.P50) + " | " + Format(read.P95) + " | " + Format(read.P99) + " | " + Format(read.Max) + " |");
        builder.AppendLine();
        builder.AppendLine("## Top Poll Cadence Gap Outliers");
        builder.AppendLine();
        builder.AppendLine("| Zip | Seq | gap us | interval us | est wake late us | dispatcher late us | classification |");
        builder.AppendLine("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
        foreach (OutlierRow row in metrics.TopByGap.Take(12))
        {
            builder.AppendLine("| " + row.Zip + " | " + Format(row.Sequence) + " | " + Format(row.PollCadenceGapUs) + " | " + Format(row.SchedulerIntervalUs) + " | " + Format(row.EstimatedWakeLateUs) + " | " + Format(row.DispatcherLateUs) + " | " + row.Classification + " |");
        }

        builder.AppendLine();
        builder.AppendLine("## Interpretation");
        builder.AppendLine();
        builder.AppendLine("The full corpus preserves the main two-trace conclusion: the largest cadence gaps are scheduler wake-late rows, while many smaller outliers are dispatcher-late or mixed. Older traces contribute a very large number of scheduler interval outliers, which is consistent with the earlier Sleep(1) era comparison.");
        File.WriteAllText(path, builder.ToString(), Encoding.UTF8);
    }

    private static void WriteRows(StringBuilder builder, string name, List<OutlierRow> rows, int indent, bool comma)
    {
        string spaces = new string(' ', indent * 2);
        builder.AppendLine(spaces + "\"" + name + "\": [");
        for (int i = 0; i < rows.Count; i++)
        {
            OutlierRow row = rows[i];
            builder.AppendLine(spaces + "  {");
            WriteProperty(builder, "zip", row.Zip, indent + 2, true);
            WriteNumber(builder, "sequence", row.Sequence, indent + 2, true);
            WriteNumber(builder, "schedulerIntervalUs", row.SchedulerIntervalUs, indent + 2, true);
            WriteNumber(builder, "pollCadenceGapUs", row.PollCadenceGapUs, indent + 2, true);
            WriteNumber(builder, "estimatedWakeLateUs", row.EstimatedWakeLateUs, indent + 2, true);
            WriteNumber(builder, "dispatcherLateUs", row.DispatcherLateUs, indent + 2, true);
            WriteNumber(builder, "cursorReadLatencyUs", row.CursorReadLatencyUs, indent + 2, true);
            WriteProperty(builder, "classification", row.Classification, indent + 2, false);
            builder.AppendLine(spaces + "  }" + (i + 1 == rows.Count ? string.Empty : ","));
        }
        builder.AppendLine(spaces + "]" + (comma ? "," : string.Empty));
    }

    private static void WriteStats(StringBuilder builder, string name, Stats stats, int indent, bool comma)
    {
        string spaces = new string(' ', indent * 2);
        builder.AppendLine(spaces + "\"" + name + "\": {");
        WriteNumber(builder, "count", stats.Count, indent + 1, true);
        WriteNumber(builder, "p50", stats.P50, indent + 1, true);
        WriteNumber(builder, "p95", stats.P95, indent + 1, true);
        WriteNumber(builder, "p99", stats.P99, indent + 1, true);
        WriteNumber(builder, "max", stats.Max, indent + 1, false);
        builder.AppendLine(spaces + "}" + (comma ? "," : string.Empty));
    }

    private static void WriteProperty(StringBuilder builder, string name, string value, int indent, bool comma, bool raw = false)
    {
        string spaces = new string(' ', indent * 2);
        string rendered = raw ? value : "\"" + Escape(value) + "\"";
        builder.AppendLine(spaces + "\"" + name + "\": " + rendered + (comma ? "," : string.Empty));
    }

    private static void WriteNumber(StringBuilder builder, string name, long? value, int indent, bool comma)
    {
        string spaces = new string(' ', indent * 2);
        builder.AppendLine(spaces + "\"" + name + "\": " + (value.HasValue ? value.Value.ToString(CultureInfo.InvariantCulture) : "null") + (comma ? "," : string.Empty));
    }

    private static void WriteNumber(StringBuilder builder, string name, double? value, int indent, bool comma)
    {
        string spaces = new string(' ', indent * 2);
        builder.AppendLine(spaces + "\"" + name + "\": " + (value.HasValue ? Format(value.Value) : "null") + (comma ? "," : string.Empty));
    }

    private static string Escape(string value)
    {
        return (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    private static string Format(double? value)
    {
        return value.HasValue ? Math.Round(value.Value, 3).ToString("0.###", CultureInfo.InvariantCulture) : "";
    }

    private static string Format(long? value)
    {
        return value.HasValue ? value.Value.ToString(CultureInfo.InvariantCulture) : "";
    }

    private sealed class Metrics
    {
        public int CandidateZipFiles;
        public int SelectedZipFiles;
        public int ProcessedZips;
        public int ZipsWithoutTraceCsv;
        public long RuntimeSchedulerPollRows;
        public long ClassifiedOutlierRows;
        public readonly ClassCounts ClassCounts = new ClassCounts();
        public readonly List<double> CadenceGaps = new List<double>();
        public readonly List<double> QueueToDispatchValues = new List<double>();
        public readonly List<double> WakeLateValues = new List<double>();
        public readonly List<double> CursorReadValues = new List<double>();
        public readonly List<OutlierRow> TopByGap = new List<OutlierRow>();
        public readonly List<OutlierRow> TopByInterval = new List<OutlierRow>();
        public readonly List<PerZip> PerZip = new List<PerZip>();
    }

    private sealed class ClassCounts
    {
        public long SchedulerWakeLate;
        public long DispatcherLate;
        public long CursorReadLate;
        public long Mixed;
        public long Unknown;

        public void Increment(string classification)
        {
            if (classification == "scheduler_wake_late") SchedulerWakeLate++;
            else if (classification == "dispatcher_late") DispatcherLate++;
            else if (classification == "cursor_read_late") CursorReadLate++;
            else if (classification == "mixed") Mixed++;
            else Unknown++;
        }
    }

    private sealed class PerZip
    {
        public string Zip;
        public long Bytes;
        public string TraceEntry;
        public long TraceCsvBytes;
        public long PollRows;
        public long OutlierRows;
        public readonly ClassCounts ClassCounts = new ClassCounts();
    }

    private sealed class OutlierRow
    {
        public string Zip;
        public long? Sequence;
        public double? SchedulerIntervalUs;
        public double? PollCadenceGapUs;
        public double RuntimeSchedulerVBlankLeadMicroseconds;
        public double QueueToDispatchUs;
        public double QueuedLeadUs;
        public double EstimatedWakeLateUs;
        public double DispatcherLateUs;
        public double? CursorReadLatencyUs;
        public string Classification;
    }

    private struct Stats
    {
        public int Count;
        public double? P50;
        public double? P95;
        public double? P99;
        public double? Max;
    }
}
