using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

const string SchemaVersion = "cursor-prediction-v21-step-01-data-audit/1";

var root = FindRepoRoot(AppContext.BaseDirectory);
var outDir = Path.Combine(root, "poc", "cursor-prediction-v21", "step-01-data-audit");
for (var i = 0; i < args.Length; i++)
{
    if (args[i] == "--root" && i + 1 < args.Length)
    {
        root = Path.GetFullPath(args[++i]);
        outDir = Path.Combine(root, "poc", "cursor-prediction-v21", "step-01-data-audit");
    }
    else if (args[i] == "--out-dir" && i + 1 < args.Length)
    {
        outDir = Path.GetFullPath(args[++i]);
    }
    else if (args[i] is "--help" or "-h")
    {
        Console.WriteLine("Usage: dotnet run --project poc/cursor-prediction-v21/step-01-data-audit/harness/V21DataAudit.csproj -- [--root <repo>] [--out-dir <dir>]");
        return 0;
    }
}

Directory.CreateDirectory(outDir);
var zipPaths = Directory.GetFiles(root, "cursor-mirror-motion-recording-20260504-19*.zip")
    .OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase)
    .ToArray();

var packages = new List<PackageAudit>();
foreach (var zipPath in zipPaths)
{
    Console.Error.WriteLine($"Auditing {Path.GetFileName(zipPath)}");
    packages.Add(AuditPackage(root, zipPath));
}

var audit = BuildAudit(root, packages);
var jsonOptions = new JsonSerializerOptions { WriteIndented = true };
File.WriteAllText(Path.Combine(outDir, "audit.json"), JsonSerializer.Serialize(audit, jsonOptions) + Environment.NewLine, Encoding.UTF8);
File.WriteAllText(Path.Combine(outDir, "report.md"), BuildReport(audit), Encoding.UTF8);
Console.WriteLine(JsonSerializer.Serialize(new { packageCount = packages.Count, auditJson = Path.Combine(outDir, "audit.json"), report = Path.Combine(outDir, "report.md") }, jsonOptions));
return 0;

static string FindRepoRoot(string start)
{
    var dir = new DirectoryInfo(start);
    while (dir is not null)
    {
        if (Directory.Exists(Path.Combine(dir.FullName, ".git"))) return dir.FullName;
        dir = dir.Parent;
    }
    return Path.GetFullPath(Path.Combine(start, "..", "..", "..", ".."));
}

static PackageAudit AuditPackage(string root, string zipPath)
{
    var requiredEntries = new[]
    {
        "metadata.json",
        "motion-metadata.json",
        "motion-script.json",
        "motion-samples.csv",
        "motion-trace-alignment.csv",
        "trace.csv",
    };

    using var archive = ZipFile.OpenRead(zipPath);
    var entryMap = archive.Entries.ToDictionary(e => e.FullName, StringComparer.OrdinalIgnoreCase);
    var warnings = new List<string>();
    foreach (var name in requiredEntries)
    {
        if (!entryMap.ContainsKey(name)) warnings.Add($"missing required entry: {name}");
    }

    var metadata = ReadJson(entryMap.GetValueOrDefault("metadata.json"));
    var motionMetadata = ReadJson(entryMap.GetValueOrDefault("motion-metadata.json"));
    var motionSamples = entryMap.TryGetValue("motion-samples.csv", out var motionEntry)
        ? AuditMotionSamples(motionEntry, warnings)
        : CsvAudit.Empty();
    var alignment = entryMap.TryGetValue("motion-trace-alignment.csv", out var alignmentEntry)
        ? AuditAlignment(alignmentEntry, warnings)
        : CsvAudit.Empty();

    var motionDurationMs = GetDouble(motionMetadata, "DurationMilliseconds");
    var scenarioCount = GetInt(motionMetadata, "ScenarioCount");
    var scenarioDurationMs = GetDouble(motionMetadata, "ScenarioDurationMilliseconds");
    var sampleRateHz = GetDouble(motionMetadata, "SampleRateHz");
    var expectedSamples = motionDurationMs.HasValue && sampleRateHz.HasValue
        ? (long?)Math.Round(motionDurationMs.Value * sampleRateHz.Value / 1000.0)
        : null;

    if (expectedSamples.HasValue && motionSamples.RowCount > 0)
    {
        var diff = Math.Abs(motionSamples.RowCount - expectedSamples.Value);
        if (diff > Math.Max(2, expectedSamples.Value * 0.002))
        {
            warnings.Add($"motion sample count differs from metadata duration*sampleRate by {diff} rows");
        }
    }

    if (motionDurationMs.HasValue && motionSamples.ElapsedMilliseconds.Max.HasValue)
    {
        var drift = Math.Abs(motionSamples.ElapsedMilliseconds.Max.Value - motionDurationMs.Value);
        if (drift > 50) warnings.Add($"motion-samples elapsed max differs from metadata duration by {Round(drift)} ms");
    }

    if (motionDurationMs.HasValue && alignment.GeneratedElapsedMilliseconds.Max.HasValue)
    {
        var drift = Math.Abs(alignment.GeneratedElapsedMilliseconds.Max.Value - motionDurationMs.Value);
        if (drift > 50) warnings.Add($"alignment generated elapsed max differs from metadata duration by {Round(drift)} ms");
    }

    if (scenarioCount.HasValue && motionSamples.Scenarios.Count > 0)
    {
        var missing = Enumerable.Range(0, scenarioCount.Value).Where(i => !motionSamples.Scenarios.ContainsKey(i)).ToArray();
        if (missing.Length > 0) warnings.Add($"motion-samples missing scenarios: {string.Join(",", missing)}");
    }

    if (scenarioCount.HasValue && alignment.Scenarios.Count > 0)
    {
        var missing = Enumerable.Range(0, scenarioCount.Value).Where(i => !alignment.Scenarios.ContainsKey(i)).ToArray();
        if (missing.Length > 0) warnings.Add($"alignment missing scenarios: {string.Join(",", missing)}");
    }

    var delayReasons = DelayReasons(metadata);
    warnings.AddRange(delayReasons.Select(reason => $"poll/scheduler delay: {reason}"));
    var recommendedBucket = delayReasons.Count == 0 ? "normal" : "poll-delayed";

    return new PackageAudit
    {
        File = Path.GetFileName(zipPath),
        Path = Path.GetRelativePath(root, zipPath).Replace('\\', '/'),
        Bytes = new FileInfo(zipPath).Length,
        Entries = archive.Entries.OrderBy(e => e.FullName, StringComparer.OrdinalIgnoreCase)
            .Select(e => new EntryAudit(e.FullName, e.Length, e.CompressedLength, requiredEntries.Contains(e.FullName, StringComparer.OrdinalIgnoreCase)))
            .ToList(),
        RequiredEntriesPresent = requiredEntries.All(entryMap.ContainsKey),
        Metadata = metadata,
        MotionMetadata = motionMetadata,
        MotionSamples = motionSamples,
        Alignment = alignment,
        ExpectedMotionSampleCountFromMetadata = expectedSamples,
        DelayReasons = delayReasons,
        RecommendedSplitBucket = recommendedBucket,
        Warnings = warnings.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
    };
}

static JsonObject? ReadJson(ZipArchiveEntry? entry)
{
    if (entry is null) return null;
    using var stream = entry.Open();
    using var doc = JsonDocument.Parse(stream);
    return JsonNode.Parse(doc.RootElement.GetRawText()) as JsonObject;
}

static CsvAudit AuditMotionSamples(ZipArchiveEntry entry, List<string> warnings)
{
    var audit = new CsvAudit();
    StreamCsv(entry, (header, column) =>
    {
        RequireColumns("motion-samples.csv", column, warnings, "elapsedMilliseconds", "scenarioIndex", "scenarioElapsedMilliseconds", "velocityPixelsPerSecond", "movementPhase", "holdIndex");
        audit.Header = header;
    }, row =>
    {
        audit.RowCount++;
        var elapsed = row.GetDouble("elapsedMilliseconds");
        var scenarioIndex = row.GetInt("scenarioIndex");
        var scenarioElapsed = row.GetDouble("scenarioElapsedMilliseconds");
        var velocity = row.GetDouble("velocityPixelsPerSecond");
        var phase = row.GetString("movementPhase") ?? "";
        var holdIndex = row.GetInt("holdIndex");

        audit.ElapsedMilliseconds.Add(elapsed);
        audit.ScenarioElapsedMilliseconds.Add(scenarioElapsed);
        audit.SpeedPixelsPerSecond.Add(velocity);
        audit.SampleIntervalMilliseconds.AddDelta(elapsed);
        audit.AddScenario(scenarioIndex, scenarioElapsed);
        audit.AddPhase(phase);

        if ((holdIndex.HasValue && holdIndex.Value >= 0) || phase.Contains("hold", StringComparison.OrdinalIgnoreCase))
        {
            audit.HoldRows++;
        }

        if (velocity.HasValue)
        {
            var bucket = velocity.Value switch
            {
                < 1 => "stationary_lt_1",
                < 100 => "slow_1_100",
                < 500 => "medium_100_500",
                < 1000 => "fast_500_1000",
                _ => "very_fast_gte_1000",
            };
            audit.AddSpeedBucket(bucket);
        }
    });
    audit.Finish();
    return audit;
}

static CsvAudit AuditAlignment(ZipArchiveEntry entry, List<string> warnings)
{
    var audit = new CsvAudit();
    StreamCsv(entry, (header, column) =>
    {
        RequireColumns("motion-trace-alignment.csv", column, warnings, "traceEvent", "traceElapsedMicroseconds", "generatedElapsedMilliseconds", "scenarioIndex", "scenarioElapsedMilliseconds");
        audit.Header = header;
    }, row =>
    {
        audit.RowCount++;
        var generatedElapsed = row.GetDouble("generatedElapsedMilliseconds");
        var scenarioIndex = row.GetInt("scenarioIndex");
        var scenarioElapsed = row.GetDouble("scenarioElapsedMilliseconds");
        audit.GeneratedElapsedMilliseconds.Add(generatedElapsed);
        audit.ScenarioElapsedMilliseconds.Add(scenarioElapsed);
        audit.GeneratedIntervalMilliseconds.AddDelta(generatedElapsed);
        audit.AddScenario(scenarioIndex, scenarioElapsed);
        var traceEvent = row.GetString("traceEvent") ?? "";
        audit.AddTraceEvent(traceEvent);
    });
    audit.Finish();
    return audit;
}

static void StreamCsv(ZipArchiveEntry entry, Action<string[], Dictionary<string, int>> onHeader, Action<CsvRow> onRow)
{
    using var stream = entry.Open();
    using var reader = new StreamReader(stream, Encoding.UTF8, true, 1 << 16);
    var headerLine = reader.ReadLine();
    if (headerLine is null) return;
    headerLine = headerLine.TrimStart('\uFEFF');
    var header = headerLine.Split(',');
    var column = header.Select((name, index) => new { name, index }).ToDictionary(x => x.name, x => x.index, StringComparer.OrdinalIgnoreCase);
    onHeader(header, column);

    string? line;
    while ((line = reader.ReadLine()) is not null)
    {
        if (line.Length == 0) continue;
        var values = line.Split(',');
        onRow(new CsvRow(values, column));
    }
}

static void RequireColumns(string file, Dictionary<string, int> column, List<string> warnings, params string[] required)
{
    foreach (var name in required)
    {
        if (!column.ContainsKey(name)) warnings.Add($"{file} missing required column: {name}");
    }
}

static List<string> DelayReasons(JsonObject? metadata)
{
    var reasons = new List<string>();
    var pollInterval = GetDouble(metadata, "PollIntervalMilliseconds");
    var referenceInterval = GetDouble(metadata, "ReferencePollIntervalMilliseconds");
    var productP95 = GetNestedDouble(metadata, "ProductPollIntervalStats", "P95Milliseconds");
    var referenceP95 = GetNestedDouble(metadata, "ReferencePollIntervalStats", "P95Milliseconds");
    var schedulerPollP95 = GetNestedDouble(metadata, "RuntimeSchedulerPollIntervalStats", "P95Milliseconds");
    var schedulerLoopP95 = GetNestedDouble(metadata, "RuntimeSchedulerLoopIntervalStats", "P95Milliseconds");
    var schedulerLoopMax = GetNestedDouble(metadata, "RuntimeSchedulerLoopIntervalStats", "MaxMilliseconds");

    if (pollInterval.HasValue && productP95.HasValue && productP95.Value > Math.Max(20, pollInterval.Value * 2.5))
    {
        reasons.Add($"product poll p95 {Round(productP95.Value)} ms exceeds expected interval {Round(pollInterval.Value)} ms");
    }

    if (referenceInterval.HasValue && referenceP95.HasValue && referenceP95.Value > Math.Max(8, referenceInterval.Value * 4))
    {
        reasons.Add($"reference poll p95 {Round(referenceP95.Value)} ms exceeds expected interval {Round(referenceInterval.Value)} ms");
    }

    if (schedulerPollP95.HasValue && schedulerPollP95.Value > 25)
    {
        reasons.Add($"runtime scheduler poll p95 {Round(schedulerPollP95.Value)} ms exceeds 25 ms");
    }

    if (schedulerLoopP95.HasValue && schedulerLoopP95.Value > 30)
    {
        reasons.Add($"runtime scheduler loop p95 {Round(schedulerLoopP95.Value)} ms exceeds 30 ms");
    }

    if (schedulerLoopMax.HasValue && schedulerLoopMax.Value > 45)
    {
        reasons.Add($"runtime scheduler loop max {Round(schedulerLoopMax.Value)} ms exceeds 45 ms");
    }

    if (metadata?["QualityWarnings"] is JsonArray qualityWarnings)
    {
        foreach (var warning in qualityWarnings.Select(x => x?.GetValue<string>()).Where(x => !string.IsNullOrWhiteSpace(x)))
        {
            if (warning!.Contains("poll", StringComparison.OrdinalIgnoreCase) || warning.Contains("scheduler", StringComparison.OrdinalIgnoreCase))
            {
                reasons.Add($"metadata quality warning {warning}");
            }
        }
    }

    return reasons.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
}

static object BuildAudit(string root, List<PackageAudit> packages)
{
    var uniqueScenarioDurations = packages
        .Select(p => GetDouble(p.MotionMetadata, "ScenarioDurationMilliseconds"))
        .Where(x => x.HasValue)
        .Select(x => Round(x!.Value))
        .Distinct()
        .Order()
        .ToArray();

    var aggregateSpeed = new StatsAccumulator();
    var aggregateMotionIntervals = new StatsAccumulator();
    long totalMotionRows = 0;
    long totalHoldRows = 0;
    var aggregateBuckets = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
    var aggregatePhases = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
    foreach (var package in packages)
    {
        totalMotionRows += package.MotionSamples.RowCount;
        totalHoldRows += package.MotionSamples.HoldRows;
        aggregateSpeed.Merge(package.MotionSamples.SpeedPixelsPerSecond);
        aggregateMotionIntervals.Merge(package.MotionSamples.SampleIntervalMilliseconds);
        MergeCounts(aggregateBuckets, package.MotionSamples.SpeedBuckets);
        MergeCounts(aggregatePhases, package.MotionSamples.PhaseCounts);
    }
    aggregateSpeed.Finish();
    aggregateMotionIntervals.Finish();

    return new
    {
        schemaVersion = SchemaVersion,
        generatedAtUtc = DateTimeOffset.UtcNow.ToString("O"),
        root,
        constraints = new
        {
            rawCsvExtractedToDisk = false,
            modelTrainingRun = false,
            cpuGpuMeasurementRun = false,
        },
        targetPattern = "cursor-mirror-motion-recording-20260504-19*.zip",
        packageCount = packages.Count,
        fixed12000msAssumptionValid = false,
        timingPolicy = "Do not derive scenario windows from a fixed 12000 ms constant. Use metadata and row-level elapsed values.",
        aggregate = new
        {
            totalZipBytes = packages.Sum(p => p.Bytes),
            totalMotionSampleRows = totalMotionRows,
            totalAlignmentRows = packages.Sum(p => p.Alignment.RowCount),
            uniqueScenarioDurationMilliseconds = uniqueScenarioDurations,
            sampleIntervalMilliseconds = aggregateMotionIntervals.ToSummary(),
            holdRows = totalHoldRows,
            holdRatio = totalMotionRows == 0 ? (double?)null : Round((double)totalHoldRows / totalMotionRows, 6),
            speedPixelsPerSecond = aggregateSpeed.ToSummary(),
            speedBuckets = aggregateBuckets.OrderBy(kv => kv.Key).ToDictionary(),
            phaseCounts = aggregatePhases.OrderBy(kv => kv.Key).ToDictionary(),
            recommendedSplitBuckets = packages.GroupBy(p => p.RecommendedSplitBucket).OrderBy(g => g.Key).ToDictionary(g => g.Key, g => g.Select(p => p.File).ToArray()),
        },
        packages = packages.Select(p => p.ToJsonObject()).ToArray(),
    };
}

static string BuildReport(dynamic audit)
{
    var node = JsonSerializer.SerializeToNode(audit)!.AsObject();
    var packages = node["packages"]!.AsArray();
    var sb = new StringBuilder();
    sb.AppendLine("# Step 01 - Data Audit");
    sb.AppendLine();
    sb.AppendLine("## Summary");
    sb.AppendLine();
    sb.AppendLine($"- Target pattern: `{node["targetPattern"]!.GetValue<string>()}`");
    sb.AppendLine($"- Packages audited: {node["packageCount"]!.GetValue<int>()}");
    sb.AppendLine($"- Total ZIP bytes: {node["aggregate"]!["totalZipBytes"]}");
    sb.AppendLine($"- Total motion sample rows: {node["aggregate"]!["totalMotionSampleRows"]}");
    sb.AppendLine($"- Total alignment rows: {node["aggregate"]!["totalAlignmentRows"]}");
    sb.AppendLine($"- Aggregate hold ratio: {node["aggregate"]!["holdRatio"]}");
    sb.AppendLine();
    sb.AppendLine("Fixed `12000 ms` scenario assumptions are invalid for v21. Later phases must use `motion-metadata.json` plus the observed `scenarioElapsedMilliseconds` ranges from `motion-samples.csv` and `motion-trace-alignment.csv`.");
    sb.AppendLine();

    sb.AppendLine("## Files And Durations");
    sb.AppendLine();
    sb.AppendLine("| file | zip MB | required entries | duration ms | scenarios | scenario duration ms | motion rows | alignment rows | bucket |");
    sb.AppendLine("| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |");
    foreach (var pkg in packages)
    {
        var motionMetadata = pkg!["motionMetadata"]!;
        sb.AppendLine($"| `{pkg["file"]!.GetValue<string>()}` | {Round(pkg["bytes"]!.GetValue<long>() / 1024.0 / 1024.0, 2)} | {pkg["requiredEntriesPresent"]} | {motionMetadata["DurationMilliseconds"]} | {motionMetadata["ScenarioCount"]} | {motionMetadata["ScenarioDurationMilliseconds"]} | {pkg["motionSamples"]!["rowCount"]} | {pkg["alignment"]!["rowCount"]} | {pkg["recommendedSplitBucket"]} |");
    }
    sb.AppendLine();

    sb.AppendLine("## Metadata Timing");
    sb.AppendLine();
    sb.AppendLine("| file | product poll p95/max ms | reference poll p95/max ms | scheduler poll p95/max ms | scheduler loop p95/max ms | metadata warnings |");
    sb.AppendLine("| --- | ---: | ---: | ---: | ---: | --- |");
    foreach (var pkg in packages)
    {
        var metadata = pkg!["metadata"]!;
        sb.AppendLine($"| `{pkg["file"]!.GetValue<string>()}` | {NestedPair(metadata, "ProductPollIntervalStats")} | {NestedPair(metadata, "ReferencePollIntervalStats")} | {NestedPair(metadata, "RuntimeSchedulerPollIntervalStats")} | {NestedPair(metadata, "RuntimeSchedulerLoopIntervalStats")} | {JsonArrayInline(metadata["QualityWarnings"])} |");
    }
    sb.AppendLine();

    sb.AppendLine("## Scenario Coverage");
    sb.AppendLine();
    sb.AppendLine("| file | motion scenario index range | motion scenario elapsed min/max ms | alignment scenario index range | alignment scenario elapsed min/max ms |");
    sb.AppendLine("| --- | ---: | ---: | ---: | ---: |");
    foreach (var pkg in packages)
    {
        var ms = pkg!["motionSamples"]!;
        var al = pkg["alignment"]!;
        sb.AppendLine($"| `{pkg["file"]!.GetValue<string>()}` | {RangeText(ms["scenarioIndexMin"], ms["scenarioIndexMax"])} | {RangeText(ms["scenarioElapsedMilliseconds"]!["min"], ms["scenarioElapsedMilliseconds"]!["max"])} | {RangeText(al["scenarioIndexMin"], al["scenarioIndexMax"])} | {RangeText(al["scenarioElapsedMilliseconds"]!["min"], al["scenarioElapsedMilliseconds"]!["max"])} |");
    }
    sb.AppendLine();

    sb.AppendLine("## Hold And Speed");
    sb.AppendLine();
    sb.AppendLine("| file | hold ratio | speed p50/p95/p99/max px/s | sample interval p50/p95/max ms |");
    sb.AppendLine("| --- | ---: | ---: | ---: |");
    foreach (var pkg in packages)
    {
        var ms = pkg!["motionSamples"]!;
        sb.AppendLine($"| `{pkg["file"]!.GetValue<string>()}` | {ms["holdRatio"]} | {StatsTuple(ms["speedPixelsPerSecond"]!)} | {StatsTuple(ms["sampleIntervalMilliseconds"]!)} |");
    }
    sb.AppendLine();

    sb.AppendLine("## Warnings And Split Buckets");
    sb.AppendLine();
    var buckets = node["aggregate"]!["recommendedSplitBuckets"]!.AsObject();
    foreach (var bucket in buckets)
    {
        sb.AppendLine($"- `{bucket.Key}`: {JsonArrayInline(bucket.Value)}");
    }
    sb.AppendLine();
    foreach (var pkg in packages)
    {
        var warnings = pkg!["warnings"]!.AsArray();
        if (warnings.Count == 0) continue;
        sb.AppendLine($"### {pkg["file"]!.GetValue<string>()}");
        foreach (var warning in warnings)
        {
            sb.AppendLine($"- {warning!.GetValue<string>()}");
        }
        sb.AppendLine();
    }

    sb.AppendLine("## Recommendations");
    sb.AppendLine();
    sb.AppendLine("- Use `audit.json` per-scenario elapsed ranges to build v21 split manifests.");
    sb.AppendLine("- Keep poll-delayed packages labeled as degraded/robustness data until a later phase proves they improve generalization.");
    sb.AppendLine("- Do not run training from a loader that hard-codes `12000 ms` per scenario.");
    return sb.ToString();
}

static string NestedPair(JsonNode? node, string name)
{
    var p95 = GetNestedDouble(node as JsonObject, name, "P95Milliseconds");
    var max = GetNestedDouble(node as JsonObject, name, "MaxMilliseconds");
    return $"{RoundNullable(p95)}/{RoundNullable(max)}";
}

static string StatsTuple(JsonNode node)
{
    return $"{node["p50"]}/{node["p95"]}/{node["p99"]}/{node["max"]}";
}

static string RangeText(JsonNode? min, JsonNode? max)
{
    return $"{min ?? "null"}..{max ?? "null"}";
}

static string JsonArrayInline(JsonNode? node)
{
    if (node is null) return "";
    if (node is JsonArray arr) return arr.Count == 0 ? "" : string.Join(", ", arr.Select(x => x?.ToJsonString()).Select(x => x?.Trim('"')));
    return node.ToJsonString();
}

static void MergeCounts(Dictionary<string, long> target, IReadOnlyDictionary<string, long> source)
{
    foreach (var (key, value) in source)
    {
        target[key] = target.TryGetValue(key, out var current) ? current + value : value;
    }
}

static double? GetDouble(JsonObject? obj, string name)
{
    if (obj is null || !obj.TryGetPropertyValue(name, out var node) || node is null) return null;
    return node is JsonValue valueNode && valueNode.TryGetValue<double>(out var value) ? value : null;
}

static int? GetInt(JsonObject? obj, string name)
{
    if (obj is null || !obj.TryGetPropertyValue(name, out var node) || node is null) return null;
    return node is JsonValue valueNode && valueNode.TryGetValue<int>(out var value) ? value : null;
}

static double? GetNestedDouble(JsonObject? obj, string objectName, string valueName)
{
    if (obj is null || obj[objectName] is not JsonObject nested) return null;
    return GetDouble(nested, valueName);
}

static double Round(double value, int digits = 3) => AuditMath.Round(value, digits);

static double? RoundNullable(double? value, int digits = 3) => AuditMath.RoundNullable(value, digits);

sealed record CsvRow(string[] Values, Dictionary<string, int> Column)
{
    public string? GetString(string name)
    {
        return Column.TryGetValue(name, out var index) && index >= 0 && index < Values.Length ? Values[index] : null;
    }

    public double? GetDouble(string name)
    {
        var value = GetString(name);
        if (string.IsNullOrWhiteSpace(value)) return null;
        return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    public int? GetInt(string name)
    {
        var value = GetString(name);
        if (string.IsNullOrWhiteSpace(value)) return null;
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }
}

sealed class PackageAudit
{
    public required string File { get; init; }
    public required string Path { get; init; }
    public required long Bytes { get; init; }
    public required List<EntryAudit> Entries { get; init; }
    public required bool RequiredEntriesPresent { get; init; }
    public JsonObject? Metadata { get; init; }
    public JsonObject? MotionMetadata { get; init; }
    public required CsvAudit MotionSamples { get; init; }
    public required CsvAudit Alignment { get; init; }
    public long? ExpectedMotionSampleCountFromMetadata { get; init; }
    public required List<string> DelayReasons { get; init; }
    public required string RecommendedSplitBucket { get; init; }
    public required List<string> Warnings { get; init; }

    public object ToJsonObject() => new
    {
        file = File,
        path = Path,
        bytes = Bytes,
        entries = Entries,
        requiredEntriesPresent = RequiredEntriesPresent,
        metadata = Metadata,
        motionMetadata = MotionMetadata,
        expectedMotionSampleCountFromMetadata = ExpectedMotionSampleCountFromMetadata,
        motionSamples = MotionSamples.ToJsonObject(includeTraceEvents: false),
        alignment = Alignment.ToJsonObject(includeTraceEvents: true),
        delayReasons = DelayReasons,
        recommendedSplitBucket = RecommendedSplitBucket,
        warnings = Warnings,
    };
}

sealed record EntryAudit(string Name, long UncompressedBytes, long CompressedBytes, bool Required);

sealed class CsvAudit
{
    public string[] Header { get; set; } = Array.Empty<string>();
    public long RowCount { get; set; }
    public long HoldRows { get; set; }
    public StatsAccumulator ElapsedMilliseconds { get; } = new();
    public StatsAccumulator GeneratedElapsedMilliseconds { get; } = new();
    public StatsAccumulator ScenarioElapsedMilliseconds { get; } = new();
    public DeltaStatsAccumulator SampleIntervalMilliseconds { get; } = new();
    public DeltaStatsAccumulator GeneratedIntervalMilliseconds { get; } = new();
    public StatsAccumulator SpeedPixelsPerSecond { get; } = new();
    public Dictionary<int, ScenarioAudit> Scenarios { get; } = new();
    public Dictionary<string, long> PhaseCounts { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, long> TraceEventCounts { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, long> SpeedBuckets { get; } = new(StringComparer.OrdinalIgnoreCase);

    public static CsvAudit Empty() => new();

    public void AddScenario(int? scenarioIndex, double? scenarioElapsed)
    {
        if (!scenarioIndex.HasValue) return;
        if (!Scenarios.TryGetValue(scenarioIndex.Value, out var stats))
        {
            stats = new ScenarioAudit(scenarioIndex.Value);
            Scenarios[scenarioIndex.Value] = stats;
        }
        stats.Add(scenarioElapsed);
    }

    public void AddPhase(string phase)
    {
        if (string.IsNullOrWhiteSpace(phase)) phase = "(blank)";
        PhaseCounts[phase] = PhaseCounts.TryGetValue(phase, out var current) ? current + 1 : 1;
    }

    public void AddTraceEvent(string traceEvent)
    {
        if (string.IsNullOrWhiteSpace(traceEvent)) traceEvent = "(blank)";
        TraceEventCounts[traceEvent] = TraceEventCounts.TryGetValue(traceEvent, out var current) ? current + 1 : 1;
    }

    public void AddSpeedBucket(string bucket)
    {
        SpeedBuckets[bucket] = SpeedBuckets.TryGetValue(bucket, out var current) ? current + 1 : 1;
    }

    public void Finish()
    {
        ElapsedMilliseconds.Finish();
        GeneratedElapsedMilliseconds.Finish();
        ScenarioElapsedMilliseconds.Finish();
        SampleIntervalMilliseconds.Finish();
        GeneratedIntervalMilliseconds.Finish();
        SpeedPixelsPerSecond.Finish();
    }

    public object ToJsonObject(bool includeTraceEvents)
    {
        var scenarioIndexes = Scenarios.Keys.OrderBy(x => x).ToArray();
        var obj = new Dictionary<string, object?>
        {
            ["header"] = Header,
            ["rowCount"] = RowCount,
            ["elapsedMilliseconds"] = ElapsedMilliseconds.ToSummary(),
            ["generatedElapsedMilliseconds"] = GeneratedElapsedMilliseconds.ToSummary(),
            ["scenarioIndexMin"] = scenarioIndexes.Length == 0 ? null : scenarioIndexes.First(),
            ["scenarioIndexMax"] = scenarioIndexes.Length == 0 ? null : scenarioIndexes.Last(),
            ["scenarioCountCovered"] = scenarioIndexes.Length,
            ["scenarioIndexes"] = scenarioIndexes,
            ["scenarioElapsedMilliseconds"] = ScenarioElapsedMilliseconds.ToSummary(),
            ["sampleIntervalMilliseconds"] = SampleIntervalMilliseconds.ToSummary(),
            ["generatedIntervalMilliseconds"] = GeneratedIntervalMilliseconds.ToSummary(),
            ["perScenario"] = Scenarios.OrderBy(kv => kv.Key).Select(kv => kv.Value.ToJsonObject()).ToArray(),
            ["phaseCounts"] = PhaseCounts.OrderBy(kv => kv.Key).ToDictionary(kv => kv.Key, kv => kv.Value),
            ["holdRows"] = HoldRows,
            ["holdRatio"] = RowCount == 0 ? null : AuditMath.Round((double)HoldRows / RowCount, 6),
            ["speedPixelsPerSecond"] = SpeedPixelsPerSecond.ToSummary(),
            ["speedBuckets"] = SpeedBuckets.OrderBy(kv => kv.Key).ToDictionary(kv => kv.Key, kv => kv.Value),
        };

        if (includeTraceEvents)
        {
            obj["traceEventCounts"] = TraceEventCounts.OrderBy(kv => kv.Key).ToDictionary(kv => kv.Key, kv => kv.Value);
        }

        return obj;
    }
}

sealed class ScenarioAudit(int index)
{
    private readonly StatsAccumulator _elapsed = new();

    public void Add(double? scenarioElapsed)
    {
        _elapsed.Add(scenarioElapsed);
    }

    public object ToJsonObject() => new
    {
        scenarioIndex = index,
        rowCount = _elapsed.Count,
        scenarioElapsedMilliseconds = _elapsed.ToSummary(),
    };
}

class StatsAccumulator
{
    protected readonly List<double> Values = new();
    public long Count => Values.Count;
    public double? Min { get; private set; }
    public double? Max { get; private set; }
    private double _sum;

    public virtual void Add(double? value)
    {
        if (!value.HasValue || !double.IsFinite(value.Value)) return;
        Values.Add(value.Value);
        _sum += value.Value;
        Min = !Min.HasValue ? value.Value : Math.Min(Min.Value, value.Value);
        Max = !Max.HasValue ? value.Value : Math.Max(Max.Value, value.Value);
    }

    public void Merge(StatsAccumulator other)
    {
        foreach (var value in other.Values) Add(value);
    }

    public void Finish()
    {
        Values.Sort();
    }

    public object ToSummary() => new
    {
        count = Values.Count,
        mean = Values.Count == 0 ? null : AuditMath.RoundNullable(_sum / Values.Count),
        min = AuditMath.RoundNullable(Min),
        p50 = Percentile(0.50),
        p90 = Percentile(0.90),
        p95 = Percentile(0.95),
        p99 = Percentile(0.99),
        max = AuditMath.RoundNullable(Max),
    };

    protected double? Percentile(double p)
    {
        if (Values.Count == 0) return null;
        if (Values.Count == 1) return AuditMath.Round(Values[0]);
        var rank = (Values.Count - 1) * p;
        var lo = (int)Math.Floor(rank);
        var hi = (int)Math.Ceiling(rank);
        if (lo == hi) return AuditMath.Round(Values[lo]);
        var value = Values[lo] * (hi - rank) + Values[hi] * (rank - lo);
        return AuditMath.Round(value);
    }
}

sealed class DeltaStatsAccumulator : StatsAccumulator
{
    private double? _previous;

    public void AddDelta(double? value)
    {
        if (value.HasValue && _previous.HasValue) Add(value.Value - _previous.Value);
        if (value.HasValue) _previous = value.Value;
    }
}

static class AuditMath
{
    public static double Round(double value, int digits = 3) => Math.Round(value, digits, MidpointRounding.AwayFromZero);

    public static double? RoundNullable(double? value, int digits = 3) => value.HasValue ? Round(value.Value, digits) : null;
}
