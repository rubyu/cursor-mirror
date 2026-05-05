using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using CursorMirror;

record Config(string OutputPath, int HorizonCapMs, int[] OffsetsMs, PackageConfig[] Packages);
record PackageConfig(string PackageId, string ZipPath, double WarmupMs, Window[] ExcludeMs);
record Window(double StartMs, double EndMs);
record RefPoint(double ElapsedUs, double X, double Y);
record CallPoint(string PackageId, double ElapsedUs, double X, double Y, long SampleTicks, long TargetTicks, long RefreshTicks, long VBlankTicks, long Frequency, bool DwmAvailable);
record SampleEval(string PackageId, double Error, double Signed, double Overshoot, double Jitter, double FlipPenalty, double RecentSpeed, double TargetSpeed, bool Stop, bool HardStop, bool PostStop, bool DirectionFlip, bool HighSpeed);

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: CursorReplayHarness <config.json>");
            return 2;
        }

        Config config = JsonSerializer.Deserialize<Config>(File.ReadAllText(args[0]), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        var recordings = config.Packages.Select(ReadRecording).ToArray();
        var candidates = new Dictionary<string, object>();
        foreach (int offsetMs in config.OffsetsMs)
        {
            string id = $"csharp_lag0p5_offset{FormatOffset(offsetMs)}ms";
            candidates[id] = EvaluateCandidate(recordings, offsetMs, config.HorizonCapMs);
        }

        var result = new
        {
            schemaVersion = "cursor-prediction-v17-step-08-csharp-harness-direct/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            harness = new
            {
                success = true,
                directProductPredictor = true,
                fidelity = "medium",
                fidelityNotes = "Uses runtimeSchedulerPoll rows from trace.csv as chronological calls, CursorPollSample.Position from cursorX/cursorY, runtimeSchedulerSampleRecordedTicks as sample timestamp, predictionTargetTicks/dwmQpcRefreshPeriod as scheduler timing. Controller-level reset boundaries beyond idle gaps are not present.",
                lag0DirectlySwitchable = false,
                lag0Blocker = "DistilledMlpPredictionModel.g.cs exposes LagCompensationPixels as public const float 0.5f and ApplyLagCompensation is private; DwmAwareCursorPositionPredictor has public offset/gain/model settings but no runtime lag setting."
            },
            config = new { config.HorizonCapMs, config.OffsetsMs, PackageCount = config.Packages.Length },
            candidates
        };

        Directory.CreateDirectory(Path.GetDirectoryName(config.OutputPath)!);
        File.WriteAllText(config.OutputPath, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(config.OutputPath);
        return 0;
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
            if (evt.Length == 0)
            {
                continue;
            }

            double elapsedUs = GetDouble(fields, index, "elapsedMicroseconds");
            double elapsedMs = elapsedUs / 1000.0;
            if (elapsedMs < package.WarmupMs || IsExcluded(elapsedMs, package.ExcludeMs))
            {
                continue;
            }

            double x = GetDouble(fields, index, "cursorX", double.NaN);
            double y = GetDouble(fields, index, "cursorY", double.NaN);
            if (double.IsNaN(x) || double.IsNaN(y))
            {
                x = GetDouble(fields, index, "x", double.NaN);
                y = GetDouble(fields, index, "y", double.NaN);
            }
            if (double.IsNaN(x) || double.IsNaN(y))
            {
                continue;
            }

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
                if (sampleTicks > 0 && targetTicks > 0 && refreshTicks > 0)
                {
                    calls.Add(new CallPoint(package.PackageId, elapsedUs, x, y, sampleTicks, targetTicks, refreshTicks, vblankTicks, frequency, dwm));
                }
            }
        }
        refs.Sort((a, b) => a.ElapsedUs.CompareTo(b.ElapsedUs));
        calls.Sort((a, b) => a.SampleTicks.CompareTo(b.SampleTicks));
        return (package, refs, calls);
    }

    static object EvaluateCandidate((PackageConfig Package, List<RefPoint> Refs, List<CallPoint> Calls)[] recordings, int offsetMs, int horizonCapMs)
    {
        var all = new List<SampleEval>(200000);
        var byPackage = new Dictionary<string, List<SampleEval>>();
        foreach (var recording in recordings)
        {
            var predictor = new DwmAwareCursorPositionPredictor(100, 100, horizonCapMs);
            predictor.ApplyPredictionModel(CursorMirrorSettings.DwmPredictionModelDistilledMlp);
            predictor.ApplyPredictionTargetOffsetMilliseconds(offsetMs);
            predictor.ApplyHorizonCapMilliseconds(horizonCapMs);
            var counters = new CursorPredictionCounters();
            var history = new List<CallPoint>(16);
            var packageEvals = new List<SampleEval>(recording.Calls.Count);
            foreach (var call in recording.Calls)
            {
                var sample = new CursorPollSample
                {
                    Position = new Point((int)Math.Round(call.X), (int)Math.Round(call.Y)),
                    TimestampTicks = call.SampleTicks,
                    StopwatchFrequency = call.Frequency,
                    DwmTimingAvailable = call.DwmAvailable,
                    DwmVBlankTicks = call.VBlankTicks,
                    DwmRefreshPeriodTicks = call.RefreshTicks
                };
                PointF predicted = predictor.Predict(sample, counters, call.TargetTicks, call.RefreshTicks);
                if (TryInterpolate(recording.Refs, EffectiveElapsedUs(call, offsetMs), out var target) &&
                    TryInterpolate(recording.Refs, EffectiveElapsedUs(call, 0), out var baseTarget))
                {
                    var eval = BuildEval(call, predicted, target, baseTarget, history);
                    all.Add(eval);
                    packageEvals.Add(eval);
                }

                history.Add(call);
                if (history.Count > 12)
                {
                    history.RemoveAt(0);
                }
            }
            byPackage[recording.Package.PackageId] = packageEvals;
        }

        return new
        {
            lagPx = 0.5,
            targetOffsetMs = offsetMs,
            horizonCapMs,
            rows = all.Count,
            metrics = Summaries(all),
            byPackage = byPackage.ToDictionary(p => p.Key, p => Summaries(p.Value))
        };
    }

    static SampleEval BuildEval(CallPoint call, PointF predicted, (double X, double Y, double Vx, double Vy, double Speed) target, (double X, double Y, double Vx, double Vy, double Speed) baseTarget, List<CallPoint> history)
    {
        double errX = predicted.X - target.X;
        double errY = predicted.Y - target.Y;
        double error = Math.Sqrt(errX * errX + errY * errY);
        double baseDx = baseTarget.X - call.X;
        double baseDy = baseTarget.Y - call.Y;
        double baseMag = Math.Sqrt(baseDx * baseDx + baseDy * baseDy);
        double signed = baseMag > 1e-6 ? (errX * baseDx + errY * baseDy) / baseMag : 0.0;
        double overshoot = Math.Max(0.0, signed);
        double jitter = Math.Sqrt((predicted.X - call.X) * (predicted.X - call.X) + (predicted.Y - call.Y) * (predicted.Y - call.Y));
        var recent = RecentVelocity(call, history);
        double recentSpeed = recent.Speed;
        double targetSpeed = baseTarget.Speed;
        bool stop = recentSpeed >= 500.0 && (targetSpeed <= 150.0 || (recentSpeed - targetSpeed >= 500.0 && targetSpeed <= recentSpeed * 0.45));
        bool hardStop = recentSpeed >= 1000.0 && targetSpeed <= 100.0;
        bool postStop = recentSpeed <= 100.0 && targetSpeed <= 25.0 && baseMag <= 1.0;
        bool highSpeed = recentSpeed >= 1800.0;
        double dot = recent.X * baseTarget.Vx + recent.Y * baseTarget.Vy;
        bool flip = recentSpeed >= 250.0 && targetSpeed >= 100.0 && dot < -0.15 * recentSpeed * targetSpeed;
        double flipPenalty = flip ? error : 0.0;
        return new SampleEval(call.PackageId, error, signed, overshoot, jitter, flipPenalty, recentSpeed, targetSpeed, stop, hardStop, postStop, flip, highSpeed);
    }

    static object Summaries(List<SampleEval> evals)
    {
        return new
        {
            all = Summary(evals),
            stopApproach = Summary(evals.Where(e => e.Stop)),
            hardStopApproach = Summary(evals.Where(e => e.HardStop)),
            postStop = Summary(evals.Where(e => e.PostStop), e => e.Jitter),
            highSpeed = Summary(evals.Where(e => e.HighSpeed)),
            directionFlipPenalty = Summary(evals.Where(e => e.DirectionFlip), e => e.FlipPenalty)
        };
    }

    static object Summary(IEnumerable<SampleEval> source, Func<SampleEval, double>? value = null)
    {
        value ??= e => e.Error;
        var rows = source.ToList();
        var values = rows.Select(value).OrderBy(v => v).ToArray();
        var overs = rows.Select(e => e.Overshoot).OrderBy(v => v).ToArray();
        return new
        {
            count = rows.Count,
            mean = Mean(values),
            p95 = Percentile(values, 0.95),
            p99 = Percentile(values, 0.99),
            signedMean = rows.Count == 0 ? 0.0 : rows.Average(e => e.Signed),
            leadRate = rows.Count == 0 ? 0.0 : rows.Count(e => e.Signed > 0.0) / (double)rows.Count,
            lagRate = rows.Count == 0 ? 0.0 : rows.Count(e => e.Signed < 0.0) / (double)rows.Count,
            overshootP95 = Percentile(overs, 0.95),
            overshootP99 = Percentile(overs, 0.99),
            overshootGt1 = rows.Count == 0 ? 0.0 : rows.Count(e => e.Overshoot > 1.0) / (double)rows.Count,
            overshootGt2 = rows.Count == 0 ? 0.0 : rows.Count(e => e.Overshoot > 2.0) / (double)rows.Count
        };
    }

    static (double X, double Y, double Speed) RecentVelocity(CallPoint call, List<CallPoint> history)
    {
        if (history.Count == 0)
        {
            return (0, 0, 0);
        }
        var oldest = history[0];
        double dt = (call.ElapsedUs - oldest.ElapsedUs) / 1000000.0;
        if (dt <= 0)
        {
            return (0, 0, 0);
        }
        double vx = (call.X - oldest.X) / dt;
        double vy = (call.Y - oldest.Y) / dt;
        return (vx, vy, Math.Sqrt(vx * vx + vy * vy));
    }

    static double EffectiveElapsedUs(CallPoint call, int offsetMs)
    {
        double offsetTicks = offsetMs * call.Frequency / 1000.0;
        return call.ElapsedUs + ((call.TargetTicks + offsetTicks - call.SampleTicks) * 1000000.0 / call.Frequency);
    }

    static bool TryInterpolate(List<RefPoint> refs, double elapsedUs, out (double X, double Y, double Vx, double Vy, double Speed) result)
    {
        result = default;
        if (refs.Count < 2 || elapsedUs < refs[0].ElapsedUs || elapsedUs > refs[^1].ElapsedUs)
        {
            return false;
        }
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
    static double Mean(double[] values) => values.Length == 0 ? 0.0 : values.Average();
    static double Percentile(double[] values, double p) => values.Length == 0 ? 0.0 : values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)];
    static string FormatOffset(int ms) => ms < 0 ? $"m{Math.Abs(ms)}" : $"p{ms}";
}
