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
record EvalRow(
    string PackageId,
    double ElapsedMs,
    double VisualError,
    double CurrentDistance,
    double CurrentSigned,
    double CurrentOvershoot,
    double SignedBase,
    double OvershootBase,
    double SignedTarget,
    double OvershootTarget,
    double V2,
    double V5,
    double V12,
    double TargetSpeed,
    double AccelDrop,
    double PathNet,
    double PathLength,
    double PathEfficiency,
    double CurrentDx,
    double CurrentDy,
    double ShiftedTargetDx,
    double ShiftedTargetDy,
    double Offset0TargetDx,
    double Offset0TargetDy,
    bool FastThenNearZero,
    bool HardBrake,
    bool StopAfterHighSpeed,
    bool OneFrameStop,
    bool PostStopFirstFrames,
    bool NormalMove,
    bool HighSpeed,
    bool StaticHold);

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: CurrentPositionHarness <config.json>");
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
                metrics = AllSummaries(rows),
                byPackage = rows.GroupBy(r => r.PackageId).ToDictionary(g => g.Key, g => AllSummaries(g.ToList())),
                acuteTailExamples = rows.Where(r => r.FastThenNearZero && r.CurrentOvershoot > 1.0).OrderByDescending(r => r.CurrentOvershoot).Take(16).Select(TailExample).ToArray(),
                objective = Objective(rows)
            };
        }

        var result = new
        {
            schemaVersion = "cursor-prediction-v18-step-02-current-position-baseline-single-lag/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            overlay = new
            {
                lagPx = config.LagPx,
                modelId = DistilledMlpPredictionModel.ModelId,
                lagConst = DistilledMlpPredictionModel.LagCompensationPixels,
                productSourceEdited = false
            },
            candidates
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
                if (TryInterpolate(recording.Refs, EffectiveElapsedUs(call, offsetMs), out var shiftedTarget) &&
                    TryInterpolate(recording.Refs, EffectiveElapsedUs(call, 0.0), out var offset0Target))
                {
                    var features = RuntimeFeatures(call, history);
                    all.Add(BuildEval(call, predicted, shiftedTarget, offset0Target, features));
                }
                history.Add(call);
                if (history.Count > 12) history.RemoveAt(0);
            }
        }
        return all;
    }

    static EvalRow BuildEval(CallPoint call, PointF predicted, (double X, double Y, double Vx, double Vy, double Speed) shiftedTarget, (double X, double Y, double Vx, double Vy, double Speed) offset0Target, (double V2, double V5, double V12, double DirX, double DirY, double PathNet, double PathLength, double PathEfficiency) f)
    {
        double currentDx = predicted.X - call.X;
        double currentDy = predicted.Y - call.Y;
        double currentDistance = Math.Sqrt(currentDx * currentDx + currentDy * currentDy);
        double currentSigned = currentDx * f.DirX + currentDy * f.DirY;
        double shiftedDx = shiftedTarget.X - call.X;
        double shiftedDy = shiftedTarget.Y - call.Y;
        double baseDx = offset0Target.X - call.X;
        double baseDy = offset0Target.Y - call.Y;
        double errX = predicted.X - shiftedTarget.X;
        double errY = predicted.Y - shiftedTarget.Y;
        double visualError = Math.Sqrt(errX * errX + errY * errY);
        double baseMag = Math.Sqrt(baseDx * baseDx + baseDy * baseDy);
        double shiftedMag = Math.Sqrt(shiftedDx * shiftedDx + shiftedDy * shiftedDy);
        double signedBase = baseMag > 1e-6 ? (errX * baseDx + errY * baseDy) / baseMag : 0.0;
        double signedTarget = shiftedMag > 1e-6 ? (errX * shiftedDx + errY * shiftedDy) / shiftedMag : 0.0;
        bool fastThenNearZero = f.V12 >= 500.0 && offset0Target.Speed <= 150.0;
        bool hardBrake = f.V12 >= 800.0 && f.V2 <= f.V12 * 0.35;
        bool stopAfterHighSpeed = f.V12 >= 1500.0 && offset0Target.Speed <= 150.0;
        bool oneFrameStop = f.V5 >= 500.0 && f.V2 <= 100.0;
        bool postStopFirstFrames = f.V12 >= 500.0 && f.V5 <= 250.0 && f.V2 <= 100.0;
        bool acute = fastThenNearZero || hardBrake || stopAfterHighSpeed || oneFrameStop || postStopFirstFrames;
        bool highSpeed = f.V12 >= 1800.0;
        bool staticHold = f.V12 <= 100.0 && offset0Target.Speed <= 25.0;
        bool normalMove = !acute && f.V12 >= 250.0 && f.V12 < 1800.0;
        return new EvalRow(
            call.PackageId,
            call.ElapsedUs / 1000.0,
            visualError,
            currentDistance,
            currentSigned,
            Math.Max(0.0, currentSigned),
            signedBase,
            Math.Max(0.0, signedBase),
            signedTarget,
            Math.Max(0.0, signedTarget),
            f.V2,
            f.V5,
            f.V12,
            offset0Target.Speed,
            f.V12 - f.V2,
            f.PathNet,
            f.PathLength,
            f.PathEfficiency,
            currentDx,
            currentDy,
            shiftedDx,
            shiftedDy,
            baseDx,
            baseDy,
            fastThenNearZero,
            hardBrake,
            stopAfterHighSpeed,
            oneFrameStop,
            postStopFirstFrames,
            normalMove,
            highSpeed,
            staticHold);
    }

    static object AllSummaries(List<EvalRow> rows)
    {
        return new
        {
            all = SliceSummary(rows),
            fastThenNearZero = SliceSummary(rows.Where(r => r.FastThenNearZero).ToList()),
            hardBrake = SliceSummary(rows.Where(r => r.HardBrake).ToList()),
            stopAfterHighSpeed = SliceSummary(rows.Where(r => r.StopAfterHighSpeed).ToList()),
            oneFrameStop = SliceSummary(rows.Where(r => r.OneFrameStop).ToList()),
            postStopFirstFrames = SliceSummary(rows.Where(r => r.PostStopFirstFrames).ToList()),
            normalMove = SliceSummary(rows.Where(r => r.NormalMove).ToList()),
            highSpeed = SliceSummary(rows.Where(r => r.HighSpeed).ToList()),
            staticHold = SliceSummary(rows.Where(r => r.StaticHold).ToList())
        };
    }

    static object SliceSummary(List<EvalRow> rows)
    {
        return new
        {
            count = rows.Count,
            visualError = Stat(rows.Select(r => r.VisualError).ToArray()),
            currentDistance = Stat(rows.Select(r => r.CurrentDistance).ToArray()),
            currentOvershoot = Overshoot(rows, r => r.CurrentOvershoot),
            offset0Overshoot = Overshoot(rows, r => r.OvershootBase),
            candidateTargetOvershoot = Overshoot(rows, r => r.OvershootTarget),
            currentSignedMean = rows.Count == 0 ? 0.0 : rows.Average(r => r.CurrentSigned),
            currentLeadRate = Rate(rows, r => r.CurrentSigned > 0.0),
            currentLagRate = Rate(rows, r => r.CurrentSigned < 0.0)
        };
    }

    static object Objective(List<EvalRow> rows)
    {
        dynamic fast = SliceSummary(rows.Where(r => r.FastThenNearZero).ToList());
        dynamic hard = SliceSummary(rows.Where(r => r.HardBrake).ToList());
        dynamic normal = SliceSummary(rows.Where(r => r.NormalMove).ToList());
        dynamic high = SliceSummary(rows.Where(r => r.HighSpeed).ToList());
        dynamic stat = SliceSummary(rows.Where(r => r.StaticHold).ToList());
        double acute = fast.currentOvershoot.p99 + fast.currentOvershoot.gt2 * 50.0 + hard.currentOvershoot.p99 + hard.currentDistance.p99 * 0.25;
        double side = normal.visualError.p95 + high.visualError.p95 + stat.currentDistance.p95;
        return new { acuteStopObjective = acute, sideEffectObjective = side, balancedObjective = acute + side * 0.2 };
    }

    static object TailExample(EvalRow r)
    {
        string slice = r.StopAfterHighSpeed ? "stopAfterHighSpeed" : r.OneFrameStop ? "oneFrameStop" : r.HardBrake ? "hardBrake" : r.PostStopFirstFrames ? "postStopFirstFrames" : "fastThenNearZero";
        return new
        {
            r.PackageId,
            elapsedMs = Math.Round(r.ElapsedMs, 3),
            slice,
            currentOvershoot = Math.Round(r.CurrentOvershoot, 4),
            currentDistance = Math.Round(r.CurrentDistance, 4),
            visualError = Math.Round(r.VisualError, 4),
            speeds = new { v2 = Math.Round(r.V2, 1), v5 = Math.Round(r.V5, 1), v12 = Math.Round(r.V12, 1), target = Math.Round(r.TargetSpeed, 1) },
            accelDrop = Math.Round(r.AccelDrop, 1),
            path = new { net = Math.Round(r.PathNet, 3), efficiency = Math.Round(r.PathEfficiency, 3) },
            predictedDxDy = new[] { Math.Round(r.CurrentDx, 4), Math.Round(r.CurrentDy, 4) },
            shiftedTargetDxDy = new[] { Math.Round(r.ShiftedTargetDx, 4), Math.Round(r.ShiftedTargetDy, 4) },
            offset0TargetDxDy = new[] { Math.Round(r.Offset0TargetDx, 4), Math.Round(r.Offset0TargetDy, 4) },
            offset0Overshoot = Math.Round(r.OvershootBase, 4),
            candidateTargetOvershoot = Math.Round(r.OvershootTarget, 4)
        };
    }

    static object Stat(double[] values)
    {
        Array.Sort(values);
        return new { mean = Mean(values), p95 = Percentile(values, 0.95), p99 = Percentile(values, 0.99), max = values.Length == 0 ? 0.0 : values[^1] };
    }

    static object Overshoot(List<EvalRow> rows, Func<EvalRow, double> selector)
    {
        var values = rows.Select(selector).ToArray();
        Array.Sort(values);
        return new
        {
            p95 = Percentile(values, 0.95),
            p99 = Percentile(values, 0.99),
            max = values.Length == 0 ? 0.0 : values[^1],
            gt0p5 = Rate(rows, r => selector(r) > 0.5),
            gt1 = Rate(rows, r => selector(r) > 1.0),
            gt2 = Rate(rows, r => selector(r) > 2.0),
            gt4 = Rate(rows, r => selector(r) > 4.0)
        };
    }

    static (double V2, double V5, double V12, double DirX, double DirY, double PathNet, double PathLength, double PathEfficiency) RuntimeFeatures(CallPoint call, List<CallPoint> history)
    {
        var v2 = VelocityWindow(call, history, 2);
        var v5 = VelocityWindow(call, history, 5);
        var v12 = VelocityWindow(call, history, 12);
        var path = BuildPath(call, history, 12);
        double dirX = v12.X;
        double dirY = v12.Y;
        double mag = Math.Sqrt(dirX * dirX + dirY * dirY);
        if (mag > 1e-6)
        {
            dirX /= mag;
            dirY /= mag;
        }
        else
        {
            dirX = 0;
            dirY = 0;
        }
        return (v2.Speed, v5.Speed, v12.Speed, dirX, dirY, path.Net, path.Path, path.Efficiency);
    }

    static (double X, double Y, double Speed) VelocityWindow(CallPoint call, List<CallPoint> history, int sampleCount)
    {
        if (history.Count == 0) return (0, 0, 0);
        int back = Math.Min(sampleCount - 1, history.Count);
        var oldest = history[history.Count - back];
        double dt = (call.ElapsedUs - oldest.ElapsedUs) / 1000000.0;
        if (dt <= 0) return (0, 0, 0);
        double vx = (call.X - oldest.X) / dt;
        double vy = (call.Y - oldest.Y) / dt;
        return (vx, vy, Math.Sqrt(vx * vx + vy * vy));
    }

    static (double Net, double Path, double Efficiency) BuildPath(CallPoint call, List<CallPoint> history, int sampleCount)
    {
        var points = new List<(double X, double Y)>();
        int take = Math.Min(sampleCount - 1, history.Count);
        for (int i = history.Count - take; i < history.Count; i++) points.Add((history[i].X, history[i].Y));
        points.Add((call.X, call.Y));
        if (points.Count < 2) return (0, 0, 0);
        double path = 0;
        for (int i = 1; i < points.Count; i++) path += Dist(points[i - 1].X, points[i - 1].Y, points[i].X, points[i].Y);
        double net = Dist(points[0].X, points[0].Y, call.X, call.Y);
        return (net, path, path > 1e-6 ? net / path : 0);
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
    static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    static double Mean(double[] values) => values.Length == 0 ? 0.0 : values.Average();
    static double Percentile(double[] values, double p)
    {
        Array.Sort(values);
        return values.Length == 0 ? 0.0 : values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)];
    }
    static string Fmt(double value) => (value < 0 ? "m" : "p") + Math.Abs(value).ToString("0.###", CultureInfo.InvariantCulture).Replace(".", "p");
}
