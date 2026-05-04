using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

const string SchemaVersion = "cursor-prediction-v21-step-02-manifest-check/1";

var root = FindRepoRoot(AppContext.BaseDirectory);
var outDir = Path.Combine(root, "poc", "cursor-prediction-v21", "step-02-balanced-evaluation");
for (var i = 0; i < args.Length; i++)
{
    if (args[i] == "--root" && i + 1 < args.Length)
    {
        root = Path.GetFullPath(args[++i]);
        outDir = Path.Combine(root, "poc", "cursor-prediction-v21", "step-02-balanced-evaluation");
    }
    else if (args[i] == "--out-dir" && i + 1 < args.Length)
    {
        outDir = Path.GetFullPath(args[++i]);
    }
}

Directory.CreateDirectory(outDir);
var manifestPath = Path.Combine(outDir, "split-manifest.json");
var manifest = JsonNode.Parse(File.ReadAllText(manifestPath))!.AsObject();
var requiredEntries = manifest["requiredZipEntries"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray();
var sampleColumns = manifest["loaderRequiredColumns"]!["motion-samples.csv"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray();
var alignmentColumns = manifest["loaderRequiredColumns"]!["motion-trace-alignment.csv"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray();
var availableZips = Directory.GetFiles(root, manifest["targetPattern"]!.GetValue<string>())
    .Select(Path.GetFileName)
    .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
    .ToArray();

var packageChecks = new List<object>();
foreach (var package in manifest["packages"]!.AsArray().Select(n => n!.AsObject()))
{
    packageChecks.Add(CheckPackage(root, package, requiredEntries, sampleColumns, alignmentColumns));
}

var duplicatePackageIds = manifest["packages"]!.AsArray()
    .Select(n => n!["packageId"]!.GetValue<string>())
    .GroupBy(x => x, StringComparer.OrdinalIgnoreCase)
    .Where(g => g.Count() > 1)
    .Select(g => g.Key)
    .ToArray();
var duplicateFiles = manifest["packages"]!.AsArray()
    .Select(n => n!["file"]!.GetValue<string>())
    .GroupBy(x => x, StringComparer.OrdinalIgnoreCase)
    .Where(g => g.Count() > 1)
    .Select(g => g.Key)
    .ToArray();
var missingFromManifest = availableZips.Except(manifest["packages"]!.AsArray().Select(n => n!["file"]!.GetValue<string>()), StringComparer.OrdinalIgnoreCase).ToArray();
var errors = packageChecks.SelectMany(c => ((JsonElement)JsonSerializer.SerializeToElement(c)).GetProperty("errors").EnumerateArray().Select(e => e.GetString()!))
    .Concat(duplicatePackageIds.Select(id => $"duplicate packageId: {id}"))
    .Concat(duplicateFiles.Select(file => $"duplicate file: {file}"))
    .Concat(missingFromManifest.Select(file => $"available ZIP missing from manifest: {file}"))
    .ToArray();

var output = new
{
    schemaVersion = SchemaVersion,
    generatedAtUtc = DateTimeOffset.UtcNow,
    root,
    manifest = Path.GetRelativePath(root, manifestPath).Replace('\\', '/'),
    availableZipCount = availableZips.Length,
    manifestPackageCount = manifest["packages"]!.AsArray().Count,
    duplicatePackageIds,
    duplicateFiles,
    missingFromManifest,
    constraints = new
    {
        rawCsvExtractedToDisk = false,
        modelTrainingRun = false,
        cpuGpuMeasurementRun = false
    },
    packages = packageChecks,
    ok = errors.Length == 0,
    errors
};

var jsonOptions = new JsonSerializerOptions { WriteIndented = true };
File.WriteAllText(Path.Combine(outDir, "manifest-check.json"), JsonSerializer.Serialize(output, jsonOptions) + Environment.NewLine, Encoding.UTF8);
Console.WriteLine(Path.Combine(outDir, "manifest-check.json"));
return errors.Length == 0 ? 0 : 1;

static object CheckPackage(string root, JsonObject package, string[] requiredEntries, string[] sampleColumns, string[] alignmentColumns)
{
    var errors = new List<string>();
    var warnings = new List<string>();
    var file = package["file"]!.GetValue<string>();
    var path = Path.Combine(root, package["path"]!.GetValue<string>().Replace('/', Path.DirectorySeparatorChar));
    if (!File.Exists(path))
    {
        errors.Add($"missing ZIP: {file}");
        return new { file, exists = false, errors, warnings };
    }

    using var archive = ZipFile.OpenRead(path);
    var entryMap = archive.Entries.ToDictionary(e => e.FullName, StringComparer.OrdinalIgnoreCase);
    foreach (var required in requiredEntries)
    {
        if (!entryMap.ContainsKey(required)) errors.Add($"{file}: missing required entry {required}");
    }

    var motionMetadata = ReadJson(entryMap.GetValueOrDefault("motion-metadata.json"));
    CompareNumber(package, motionMetadata, "scenarioDurationMilliseconds", "ScenarioDurationMilliseconds", file, errors);
    CompareNumber(package, motionMetadata, "durationMilliseconds", "DurationMilliseconds", file, errors);
    CompareNumber(package, motionMetadata, "scenarioCount", "ScenarioCount", file, errors);

    CheckCsvHeader(file, "motion-samples.csv", entryMap.GetValueOrDefault("motion-samples.csv"), sampleColumns, errors);
    CheckCsvHeader(file, "motion-trace-alignment.csv", entryMap.GetValueOrDefault("motion-trace-alignment.csv"), alignmentColumns, errors);

    var entrySizes = archive.Entries
        .OrderBy(e => e.FullName, StringComparer.OrdinalIgnoreCase)
        .Select(e => new { name = e.FullName, uncompressedBytes = e.Length, compressedBytes = e.CompressedLength })
        .ToArray();

    return new
    {
        file,
        packageId = package["packageId"]!.GetValue<string>(),
        split = package["split"]!.GetValue<string>(),
        qualityBucket = package["qualityBucket"]!.GetValue<string>(),
        durationBucket = package["durationBucket"]!.GetValue<string>(),
        exists = true,
        requiredEntriesPresent = requiredEntries.All(entryMap.ContainsKey),
        entrySizes,
        errors,
        warnings
    };
}

static JsonObject? ReadJson(ZipArchiveEntry? entry)
{
    if (entry is null) return null;
    using var stream = entry.Open();
    using var doc = JsonDocument.Parse(stream);
    return JsonNode.Parse(doc.RootElement.GetRawText()) as JsonObject;
}

static void CompareNumber(JsonObject package, JsonObject? metadata, string manifestName, string metadataName, string file, List<string> errors)
{
    if (metadata is null)
    {
        errors.Add($"{file}: motion-metadata.json unavailable");
        return;
    }

    var expected = package[manifestName]!.GetValue<double>();
    var actual = metadata[metadataName]!.GetValue<double>();
    if (Math.Abs(expected - actual) > 0.001)
    {
        errors.Add($"{file}: manifest {manifestName}={expected} but metadata {metadataName}={actual}");
    }
}

static void CheckCsvHeader(string file, string entryName, ZipArchiveEntry? entry, string[] requiredColumns, List<string> errors)
{
    if (entry is null) return;
    using var reader = new StreamReader(entry.Open());
    var header = reader.ReadLine();
    if (string.IsNullOrWhiteSpace(header))
    {
        errors.Add($"{file}: {entryName} has no header");
        return;
    }

    var columns = header.Split(',').Select(c => c.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
    foreach (var column in requiredColumns)
    {
        if (!columns.Contains(column)) errors.Add($"{file}: {entryName} missing column {column}");
    }
}

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
