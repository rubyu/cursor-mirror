using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using CursorMirror;

record Config(string OutputPath, double LagPx, int HorizonCapMs, double[] OffsetsMs, PackageConfig[] Packages);
record PackageConfig(string PackageId, string ZipPath, double WarmupMs, Window[] ExcludeMs);
record Window(double StartMs, double EndMs);
record RefPoint(double ElapsedUs, double X, double Y);
record CallPoint(string PackageId, double ElapsedUs, double X, double Y, long SampleTicks, long TargetTicks, long RefreshTicks, long VBlankTicks, long Frequency, bool DwmAvailable);
record EvalRow(string PackageId, double Error, double SignedBase, double OvershootBase, double SignedTarget, double OvershootTarget, double Jitter, double RecentSpeed, double TargetSpeed, bool Stop, bool HardStop, bool PostStop, bool HighSpeed);

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: LagOverlayHarness <config.json>");
            return 2;
        }

        var config = JsonSerializer.Deserialize<Config>(File.ReadAllText(args[0]), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        var recordings = config.Packages.Select(ReadRecording).ToArray();
        var candidates = new Dictionary<string, object>();
        foreach (double offset in config.OffsetsMs)
        {
            var rows = Evaluate(recordings, offset, config.HorizonCapMs);
            string id = $"lag{Fmt(config.LagPx)}_offset{Fmt(offset)}";
            candidates[id] = new
            {
                id,
                lagPx = config.LagPx,
                offsetMs = offset,
                rows = rows.Count,
                metrics = Summaries(rows),
                byPackage = rows.GroupBy(r => r.PackageId).ToDictionary(g => g.Key, g => Summaries(g.ToList())),
                objective = Objective(rows)
            };
        }

        var ranking = candidates
            .Select(kvp => new { id = kvp.Key, score = ((dynamic)kvp.Value).objective })
            .OrderBy(x => x.score.balancedObjective)
            .ToArray();
        var result = new
        {
            schemaVersion = "cursor-prediction-v17-step-10-lag-overlay-single-lag/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            overlay = new
            {
                lagPx = config.LagPx,
                modelId = DistilledMlpPredictionModel.ModelId,
                lagConst = DistilledMlpPredictionModel.LagCompensationPixels,
                method = "POC harness compiles an overlay copy of DistilledMlpPredictionModel.g.cs with LagCompensationPixels replaced before build. Product source is not edited."
            },
            config = new { config.HorizonCapMs, config.OffsetsMs },
            candidates,
            ranking
        };
        Directory.CreateDirectory(Path.GetDirectoryName(config.OutputPath)!);
        File.WriteAllText(config.OutputPath, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(config.OutputPath);
        return 0;
    }

    static List<EvalRow> Evaluate((PackageConfig Package, List<RefPoint> Refs, List<CallPoint> Calls)[] recordings, double offsetMs, int horizonCapMs)
    {
        var all = new List<EvalRow>(200000);
        foreach (var recording in recordings)
        {
            var predictor = new DwmAwareCursorPositionPredictor(100, 100, horizonCapMs);
            predictor.ApplyPredictionModel(CursorMirrorSettings.DwmPredictionModelDistilledMlp);
            predictor.ApplyHorizonCapMilliseconds(horizonCapMs);
            var counters = new CursorPredictionCounters();
            var history = new List<CallPoint>(16);
            foreach (var call in recording.Calls)
            {
                int internalOffsetMs = (int)Math.Round(offsetMs, MidpointRounding.AwayFromZero);
                internalOffsetMs = Math.Max(CursorMirrorSettings.MinimumDwmPredictionTargetOffsetMilliseconds, Math.Min(CursorMirrorSettings.MaximumDwmPredictionTargetOffsetMilliseconds, internalOffsetMs));
                double residualOffsetMs = offsetMs - internalOffsetMs;
                predictor.ApplyPredictionTargetOffsetMilliseconds(internalOffsetMs);
                long shiftedTargetTicks = call.TargetTicks + (long)Math.Round(residualOffsetMs * call.Frequency / 1000.0);
                var sample = new CursorPollSample
                {
                    Position = new Point((int)Math.Round(call.X), (int)Math.Round(call.Y)),
                    TimestampTicks = call.SampleTicks,
                    StopwatchFrequency = call.Frequency,
                    DwmTimingAvailable = call.DwmAvailable,
                    DwmVBlankTicks = call.VBlankTicks,
                    DwmRefreshPeriodTicks = call.RefreshTicks
                };
                PointF predicted = predictor.Predict(sample, counters, shiftedTargetTicks, call.RefreshTicks);
                if (TryInterpolate(recording.Refs, EffectiveElapsedUs(call, offsetMs), out var target) &&
                    TryInterpolate(recording.Refs, EffectiveElapsedUs(call, 0.0), out var baseTarget))
                {
                    all.Add(BuildEval(call, predicted, target, baseTarget, RecentVelocity(call, history)));
                }
                history.Add(call);
                if (history.Count > 12) history.RemoveAt(0);
            }
        }
        return all;
    }

    static EvalRow BuildEval(CallPoint call, PointF predicted, (double X, double Y, double Vx, double Vy, double Speed) target, (double X, double Y, double Vx, double Vy, double Speed) baseTarget, (double X, double Y, double Speed) recent)
    {
        double errX = predicted.X - target.X;
        double errY = predicted.Y - target.Y;
        double error = Math.Sqrt(errX * errX + errY * errY);
        double baseDx = baseTarget.X - call.X;
        double baseDy = baseTarget.Y - call.Y;
        double targetDx = target.X - call.X;
        double targetDy = target.Y - call.Y;
        double baseMag = Math.Sqrt(baseDx * baseDx + baseDy * baseDy);
        double targetMag = Math.Sqrt(targetDx * targetDx + targetDy * targetDy);
        double signedBase = baseMag > 1e-6 ? (errX * baseDx + errY * baseDy) / baseMag : 0.0;
        double signedTarget = targetMag > 1e-6 ? (errX * targetDx + errY * targetDy) / targetMag : 0.0;
        double pdx = predicted.X - call.X;
        double pdy = predicted.Y - call.Y;
        double jitter = Math.Sqrt(pdx * pdx + pdy * pdy);
        bool stop = recent.Speed >= 500.0 && (baseTarget.Speed <= 150.0 || (recent.Speed - baseTarget.Speed >= 500.0 && baseTarget.Speed <= recent.Speed * 0.45));
        bool hardStop = recent.Speed >= 1000.0 && baseTarget.Speed <= 100.0;
        bool postStop = recent.Speed <= 100.0 && baseTarget.Speed <= 25.0 && baseMag <= 1.0;
        bool highSpeed = recent.Speed >= 1800.0;
        return new EvalRow(call.PackageId, error, signedBase, Math.Max(0, signedBase), signedTarget, Math.Max(0, signedTarget), jitter, recent.Speed, baseTarget.Speed, stop, hardStop, postStop, highSpeed);
    }

    static object Summaries(List<EvalRow> rows)
    {
        return new
        {
            all = Summary(rows),
            stopApproach = Summary(rows.Where(r => r.Stop).ToList()),
            hardStopApproach = Summary(rows.Where(r => r.HardStop).ToList()),
            postStop = Summary(rows.Where(r => r.PostStop).ToList(), r => r.Jitter),
            highSpeed = Summary(rows.Where(r => r.HighSpeed).ToList())
        };
    }

    static object Summary(List<EvalRow> rows, Func<EvalRow, double>? value = null)
    {
        value ??= r => r.Error;
        var values = rows.Select(value).OrderBy(v => v).ToArray();
        var oversBase = rows.Select(r => r.OvershootBase).OrderBy(v => v).ToArray();
        var oversTarget = rows.Select(r => r.OvershootTarget).OrderBy(v => v).ToArray();
        return new
        {
            count = rows.Count,
            mean = Mean(values),
            p95 = Percentile(values, 0.95),
            p99 = Percentile(values, 0.99),
            max = values.Length == 0 ? 0.0 : values[^1],
            signedBaseMean = rows.Count == 0 ? 0.0 : rows.Average(r => r.SignedBase),
            signedTargetMean = rows.Count == 0 ? 0.0 : rows.Average(r => r.SignedTarget),
            leadRateBase = rows.Count == 0 ? 0.0 : rows.Count(r => r.SignedBase > 0.0) / (double)rows.Count,
            lagRateBase = rows.Count == 0 ? 0.0 : rows.Count(r => r.SignedBase < 0.0) / (double)rows.Count,
            leadRateTarget = rows.Count == 0 ? 0.0 : rows.Count(r => r.SignedTarget > 0.0) / (double)rows.Count,
            lagRateTarget = rows.Count == 0 ? 0.0 : rows.Count(r => r.SignedTarget < 0.0) / (double)rows.Count,
            overshootBaseP95 = Percentile(oversBase, 0.95),
            overshootBaseP99 = Percentile(oversBase, 0.99),
            overshootBaseMax = oversBase.Length == 0 ? 0.0 : oversBase[^1],
            overshootTargetP95 = Percentile(oversTarget, 0.95),
            overshootTargetP99 = Percentile(oversTarget, 0.99),
            overshootTargetMax = oversTarget.Length == 0 ? 0.0 : oversTarget[^1],
            overshootBaseGt0p5 = Rate(rows, r => r.OvershootBase > 0.5),
            overshootBaseGt1 = Rate(rows, r => r.OvershootBase > 1.0),
            overshootBaseGt2 = Rate(rows, r => r.OvershootBase > 2.0),
            overshootBaseGt4 = Rate(rows, r => r.OvershootBase > 4.0),
            overshootTargetGt1 = Rate(rows, r => r.OvershootTarget > 1.0),
            overshootTargetGt2 = Rate(rows, r => r.OvershootTarget > 2.0)
        };
    }

    static object Objective(List<EvalRow> rows)
    {
        dynamic m = Summaries(rows);
        double visual = m.all.p95 * 0.25 + m.stopApproach.p95 + m.postStop.p95 + m.highSpeed.p95 * 0.2;
        double tail = m.stopApproach.p99 + m.stopApproach.overshootBaseP99 * 1.5 + m.stopApproach.overshootBaseGt2 * 50.0 + m.hardStopApproach.p99 * 0.25;
        double balanced = visual + tail * 0.25;
        return new { visualObjective = visual, tailObjective = tail, balancedObjective = balanced };
    }

    static (PackageConfig Package, List<RefPoint> Refs, List<CallPoint> Calls) ReadRecording(PackageConfig package)
    {
        using var archive = ZipFile.OpenRead(package.ZipPath);
        var entry = archive.GetEntry("trace.csv") ?? throw new FileNotFoundException("trace.csv", package.ZipPath);
        using var stream = entry.Open();
        using var reader = new StreamReader(stream);
        string[] header = ParseCsvLine(reader.ReadLine() ?? throw new InvalidDataException("missing header")).ToArray();
        var index = header.Select((name, i) => (name, i)).ToDictionary(p => p.name, p => p.i);
        var refs = new List<RefPoint>(120000);
        var calls = new List<CallPoint>(120000);
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            var fields = ParseCsvLine(line).ToList();
            string evt = Get(fields, index, "event");
            if (evt.Length == 0) continue;
            double elapsedUs = GetDouble(fields, index, "elapsedMicroseconds");
            double elapsedMs = elapsedUs / 1000.0;
            if (elapsedMs < package.WarmupMs || IsExcluded(elapsedMs, package.ExcludeMs)) continue;
            double x = GetDouble(fields, index, "cursorX", double.NaN);
            double y = GetDouble(fields, index, "cursorY", double.NaN);
            if (double.IsNaN(x) || double.IsNaN(y))
            {
                x = GetDouble(fields, index, "x", double.NaN);
                y = GetDouble(fields, index, "y", double.NaN);
            }
            if (double.IsNaN(x) || double.IsNaN(y)) continue;
            if (evt == "referencePoll" || evt == "cursorPoll" || evt == "rawInput")
            {
                refs.Add(new RefPoint(elapsedUs, x, y));
            }
            else if (evt == "runtimeSchedulerPoll")
            {
                long sampleTicks = GetLong(fields, index, "runtimeSchedulerSampleRecordedTicks", 0);
                if (sampleTicks <= 0) sampleTicks = GetLong(fields, index, "stopwatchTicks", 0);
                long targetTicks = GetLong(fields, index, "predictionTargetTicks", 0);
                if (targetTicks <= 0) targetTicks = GetLong(fields, index, "presentReferenceTicks", 0);
                long refreshTicks = GetLong(fields, index, "dwmQpcRefreshPeriod", 0);
                long vblankTicks = GetLong(fields, index, "dwmQpcVBlank", 0);
                long frequency = GetLong(fields, index, "stopwatchFrequency", 10000000);
                bool dwm = Get(fields, index, "dwmTimingAvailable").Equals("true", StringComparison.OrdinalIgnoreCase);
                if (sampleTicks > 0 && targetTicks > 0 && refreshTicks > 0) calls.Add(new CallPoint(package.PackageId, elapsedUs, x, y, sampleTicks, targetTicks, refreshTicks, vblankTicks, frequency, dwm));
            }
        }
        refs.Sort((a, b) => a.ElapsedUs.CompareTo(b.ElapsedUs));
        calls.Sort((a, b) => a.SampleTicks.CompareTo(b.SampleTicks));
        return (package, refs, calls);
    }

    static (double X, double Y, double Speed) RecentVelocity(CallPoint call, List<CallPoint> history)
    {
        if (history.Count == 0) return (0, 0, 0);
        var oldest = history[0];
        double dt = (call.ElapsedUs - oldest.ElapsedUs) / 1000000.0;
        if (dt <= 0) return (0, 0, 0);
        double vx = (call.X - oldest.X) / dt;
        double vy = (call.Y - oldest.Y) / dt;
        return (vx, vy, Math.Sqrt(vx * vx + vy * vy));
    }

    static double EffectiveElapsedUs(CallPoint call, double offsetMs) => call.ElapsedUs + ((call.TargetTicks + (offsetMs * call.Frequency / 1000.0) - call.SampleTicks) * 1000000.0 / call.Frequency);

    static bool TryInterpolate(List<RefPoint> refs, double elapsedUs, out (double X, double Y, double Vx, double Vy, double Speed) result)
    {
        result = default;
        if (refs.Count < 2 || elapsedUs < refs[0].ElapsedUs || elapsedUs > refs[^1].ElapsedUs) return false;
        int lo = 0, hi = refs.Count - 1;
        while (lo + 1 < hi)
        {
            int mid = (lo + hi) / 2;
            if (refs[mid].ElapsedUs <= elapsedUs) lo = mid; else hi = mid;
        }
        var a = refs[lo];
        var b = refs[Math.Min(lo + 1, refs.Count - 1)];
        double span = Math.Max(1.0, b.ElapsedUs - a.ElapsedUs);
        double t = Math.Clamp((elapsedUs - a.ElapsedUs) / span, 0.0, 1.0);
        double x = a.X + (b.X - a.X) * t;
        double y = a.Y + (b.Y - a.Y) * t;
        double vx = (b.X - a.X) * 1000000.0 / span;
        double vy = (b.Y - a.Y) * 1000000.0 / span;
        result = (x, y, vx, vy, Math.Sqrt(vx * vx + vy * vy));
        return true;
    }

    static IEnumerable<string> ParseCsvLine(string line)
    {
        var fields = new List<string>();
        bool quoted = false;
        int start = 0;
        for (int i = 0; i < line.Length; i++)
        {
            if (line[i] == '"') quoted = !quoted;
            else if (line[i] == ',' && !quoted)
            {
                fields.Add(Unquote(line[start..i]));
                start = i + 1;
            }
        }
        fields.Add(Unquote(line[start..]));
        return fields;
    }

    static string Unquote(string value) => value.Length >= 2 && value[0] == '"' && value[^1] == '"' ? value[1..^1].Replace("\"\"", "\"") : value;
    static string Get(List<string> fields, Dictionary<string, int> index, string name) => index.TryGetValue(name, out int i) && i < fields.Count ? fields[i] : "";
    static double GetDouble(List<string> fields, Dictionary<string, int> index, string name, double fallback = 0.0) => double.TryParse(Get(fields, index, name), NumberStyles.Float, CultureInfo.InvariantCulture, out double v) ? v : fallback;
    static long GetLong(List<string> fields, Dictionary<string, int> index, string name, long fallback) => long.TryParse(Get(fields, index, name), NumberStyles.Integer, CultureInfo.InvariantCulture, out long v) ? v : fallback;
    static bool IsExcluded(double elapsedMs, Window[] windows) => windows != null && windows.Any(w => elapsedMs >= w.StartMs && elapsedMs < w.EndMs);
    static double Rate(List<EvalRow> rows, Func<EvalRow, bool> pred) => rows.Count == 0 ? 0.0 : rows.Count(pred) / (double)rows.Count;
    static double Mean(double[] values) => values.Length == 0 ? 0.0 : values.Average();
    static double Percentile(double[] values, double p) => values.Length == 0 ? 0.0 : values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)];
    static string Fmt(double value) => (value < 0 ? "m" : "p") + Math.Abs(value).ToString("0.###", CultureInfo.InvariantCulture).Replace(".", "p");
}
