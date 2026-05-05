using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using CursorMirror;

record Config(string OutputPath, int HorizonCapMs, PackageConfig[] Packages);
record PackageConfig(string PackageId, string ZipPath, double WarmupMs, Window[] ExcludeMs);
record Window(double StartMs, double EndMs);
record RefPoint(double ElapsedUs, double X, double Y);
record CallPoint(string PackageId, double ElapsedUs, double X, double Y, long SampleTicks, long TargetTicks, long RefreshTicks, long VBlankTicks, long Frequency, bool DwmAvailable);
record Velocity(double X, double Y, double Speed);
record PathStats(double Net, double Path, double Efficiency);
record Candidate(string Id, double OffsetMs, string Guard, double CapPx, double DynamicOffsetMs);
record EvalRow(
    string PackageId,
    double ElapsedMs,
    double Error,
    double Signed,
    double Overshoot,
    double Jitter,
    double RecentSpeed,
    double TargetSpeed,
    double V2,
    double V5,
    double V12,
    double AccelDrop,
    double PathNet,
    double PathLength,
    double PathEfficiency,
    double PredictionDx,
    double PredictionDy,
    double TargetDx,
    double TargetDy,
    double EffectiveTargetDx,
    double EffectiveTargetDy,
    bool RuntimeStationary,
    bool DecelLikely,
    bool Stop,
    bool HardStop,
    bool PostStop,
    bool HighSpeed,
    bool DirectionFlip);

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: TailGuardHarness <config.json>");
            return 2;
        }

        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        Config config = JsonSerializer.Deserialize<Config>(File.ReadAllText(args[0]), options)!;
        var recordings = config.Packages.Select(ReadRecording).ToArray();
        var candidates = BuildCandidates();
        var candidateScores = new Dictionary<string, object>();
        Dictionary<string, List<EvalRow>> rawByCandidate = new();

        foreach (var candidate in candidates)
        {
            var rows = EvaluateCandidate(recordings, candidate, config.HorizonCapMs);
            rawByCandidate[candidate.Id] = rows;
            candidateScores[candidate.Id] = new
            {
                candidate.Id,
                candidate.OffsetMs,
                candidate.Guard,
                candidate.CapPx,
                candidate.DynamicOffsetMs,
                rows = rows.Count,
                metrics = Summaries(rows),
                byPackage = rows.GroupBy(r => r.PackageId).ToDictionary(g => g.Key, g => Summaries(g.ToList())),
                objective = Objective(rows)
            };
        }

        string baselineId = "offset_m4";
        var baselineTailRows = rawByCandidate[baselineId]
            .Where(r => r.Stop && r.Overshoot > 1.0)
            .OrderByDescending(r => r.Overshoot)
            .ToList();
        var ranking = candidateScores
            .Select(kvp => new { id = kvp.Key, score = ((dynamic)kvp.Value).objective })
            .OrderBy(x => x.score.tailObjective)
            .ThenBy(x => x.score.visualObjective)
            .ToArray();

        var result = new
        {
            schemaVersion = "cursor-prediction-v17-step-09-csharp-tail-guard-search/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            harness = new
            {
                success = true,
                directProductPredictor = true,
                offsetImplementation = "Integer offset is applied through DwmAwareCursorPositionPredictor.ApplyPredictionTargetOffsetMilliseconds. Fractional residual offset is approximated by shifting targetVBlankTicks in ticks because product settings are integer milliseconds.",
                fidelity = "medium",
                lag0DirectlySwitchable = false
            },
            config = new { config.HorizonCapMs, PackageCount = config.Packages.Length },
            candidateCount = candidates.Length,
            candidates = candidateScores,
            ranking,
            selected = ranking.First().id,
            baselineTail = TailSummary(baselineTailRows),
            baselineTailExamples = baselineTailRows.Take(16).Select(TailExample).ToArray()
        };

        Directory.CreateDirectory(Path.GetDirectoryName(config.OutputPath)!);
        File.WriteAllText(config.OutputPath, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(config.OutputPath);
        return 0;
    }

    static Candidate[] BuildCandidates()
    {
        var list = new List<Candidate>();
        foreach (double offset in new[] { -6.0, -5.0, -4.75, -4.5, -4.25, -4.0, -3.75, -3.5, -3.25, -3.0, -2.5, -2.0 })
        {
            list.Add(new Candidate($"offset_{Fmt(offset)}", offset, "none", 0.0, 0.0));
        }

        foreach (double cap in new[] { 0.0, 0.5, 1.0, 1.5, 2.0 })
        {
            list.Add(new Candidate($"offset_m4_decel_lead_cap_{Fmt(cap)}px", -4.0, "decelLeadCap", cap, 0.0));
        }
        list.Add(new Candidate("offset_m4_near_stop_snap", -4.0, "nearStopSnap", 0.0, 0.0));
        list.Add(new Candidate("offset_m4_runtime_stationary_snap", -4.0, "runtimeStationarySnap", 0.0, 0.0));
        list.Add(new Candidate("offset_m4_decel_dynamic_m5", -4.0, "decelDynamicOffset", 0.0, -1.0));
        list.Add(new Candidate("offset_m4_decel_dynamic_m3", -4.0, "decelDynamicOffset", 0.0, 1.0));
        list.Add(new Candidate("offset_m4_decel_cap1_stationary_snap", -4.0, "decelLeadCapAndStationarySnap", 1.0, 0.0));
        list.Add(new Candidate("offset_m4_decel_cap0p5_stationary_snap", -4.0, "decelLeadCapAndStationarySnap", 0.5, 0.0));
        return list.ToArray();
    }

    static List<EvalRow> EvaluateCandidate((PackageConfig Package, List<RefPoint> Refs, List<CallPoint> Calls)[] recordings, Candidate candidate, int horizonCapMs)
    {
        var all = new List<EvalRow>(200000);
        foreach (var recording in recordings)
        {
            var predictor = new DwmAwareCursorPositionPredictor(100, 100, horizonCapMs);
            predictor.ApplyPredictionModel(CursorMirrorSettings.DwmPredictionModelDistilledMlp);
            predictor.ApplyPredictionTargetOffsetMilliseconds(0);
            predictor.ApplyHorizonCapMilliseconds(horizonCapMs);
            var counters = new CursorPredictionCounters();
            var history = new List<CallPoint>(16);
            foreach (var call in recording.Calls)
            {
                var features = RuntimeFeatures(call, history);
                double effectiveOffset = candidate.OffsetMs;
                if (candidate.Guard == "decelDynamicOffset" && features.DecelLikely)
                {
                    effectiveOffset += candidate.DynamicOffsetMs;
                }

                int internalOffsetMs = (int)Math.Round(effectiveOffset, MidpointRounding.AwayFromZero);
                internalOffsetMs = Math.Max(
                    CursorMirrorSettings.MinimumDwmPredictionTargetOffsetMilliseconds,
                    Math.Min(CursorMirrorSettings.MaximumDwmPredictionTargetOffsetMilliseconds, internalOffsetMs));
                double residualOffsetMs = effectiveOffset - internalOffsetMs;
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
                predicted = ApplyGuard(candidate, call, predicted, features);

                if (TryInterpolate(recording.Refs, EffectiveElapsedUs(call, effectiveOffset), out var target) &&
                    TryInterpolate(recording.Refs, EffectiveElapsedUs(call, 0.0), out var baseTarget))
                {
                    all.Add(BuildEval(call, predicted, target, baseTarget, features));
                }

                history.Add(call);
                if (history.Count > 12)
                {
                    history.RemoveAt(0);
                }
            }
        }
        return all;
    }

    static PointF ApplyGuard(Candidate candidate, CallPoint call, PointF predicted, (Velocity V2, Velocity V5, Velocity V12, PathStats Path, bool RuntimeStationary, bool NearStop, bool DecelLikely) f)
    {
        if ((candidate.Guard == "runtimeStationarySnap" || candidate.Guard == "decelLeadCapAndStationarySnap") && f.RuntimeStationary)
        {
            return new PointF((float)call.X, (float)call.Y);
        }
        if (candidate.Guard == "nearStopSnap" && f.NearStop)
        {
            return new PointF((float)call.X, (float)call.Y);
        }
        if ((candidate.Guard == "decelLeadCap" || candidate.Guard == "decelLeadCapAndStationarySnap") && f.DecelLikely)
        {
            double dirX = f.V12.X;
            double dirY = f.V12.Y;
            double mag = Math.Sqrt(dirX * dirX + dirY * dirY);
            if (mag > 1e-6)
            {
                dirX /= mag;
                dirY /= mag;
                double dx = predicted.X - call.X;
                double dy = predicted.Y - call.Y;
                double along = dx * dirX + dy * dirY;
                if (along > candidate.CapPx)
                {
                    double reduce = along - candidate.CapPx;
                    predicted = new PointF((float)(predicted.X - reduce * dirX), (float)(predicted.Y - reduce * dirY));
                }
            }
        }
        return predicted;
    }

    static EvalRow BuildEval(CallPoint call, PointF predicted, (double X, double Y, double Vx, double Vy, double Speed) target, (double X, double Y, double Vx, double Vy, double Speed) baseTarget, (Velocity V2, Velocity V5, Velocity V12, PathStats Path, bool RuntimeStationary, bool NearStop, bool DecelLikely) f)
    {
        double errX = predicted.X - target.X;
        double errY = predicted.Y - target.Y;
        double error = Math.Sqrt(errX * errX + errY * errY);
        double baseDx = baseTarget.X - call.X;
        double baseDy = baseTarget.Y - call.Y;
        double baseMag = Math.Sqrt(baseDx * baseDx + baseDy * baseDy);
        double signed = baseMag > 1e-6 ? (errX * baseDx + errY * baseDy) / baseMag : 0.0;
        double overshoot = Math.Max(0.0, signed);
        double pdx = predicted.X - call.X;
        double pdy = predicted.Y - call.Y;
        double jitter = Math.Sqrt(pdx * pdx + pdy * pdy);
        bool stop = f.V12.Speed >= 500.0 && (baseTarget.Speed <= 150.0 || (f.V12.Speed - baseTarget.Speed >= 500.0 && baseTarget.Speed <= f.V12.Speed * 0.45));
        bool hardStop = f.V12.Speed >= 1000.0 && baseTarget.Speed <= 100.0;
        bool postStop = f.V12.Speed <= 100.0 && baseTarget.Speed <= 25.0 && baseMag <= 1.0;
        bool highSpeed = f.V12.Speed >= 1800.0;
        double dot = f.V12.X * baseTarget.Vx + f.V12.Y * baseTarget.Vy;
        bool flip = f.V12.Speed >= 250.0 && baseTarget.Speed >= 100.0 && dot < -0.15 * f.V12.Speed * baseTarget.Speed;
        return new EvalRow(
            call.PackageId,
            call.ElapsedUs / 1000.0,
            error,
            signed,
            overshoot,
            jitter,
            f.V12.Speed,
            baseTarget.Speed,
            f.V2.Speed,
            f.V5.Speed,
            f.V12.Speed,
            f.V12.Speed - f.V2.Speed,
            f.Path.Net,
            f.Path.Path,
            f.Path.Efficiency,
            pdx,
            pdy,
            baseDx,
            baseDy,
            target.X - call.X,
            target.Y - call.Y,
            f.RuntimeStationary,
            f.DecelLikely,
            stop,
            hardStop,
            postStop,
            highSpeed,
            flip);
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
        var overs = rows.Select(r => r.Overshoot).OrderBy(v => v).ToArray();
        return new
        {
            count = rows.Count,
            mean = Mean(values),
            p95 = Percentile(values, 0.95),
            p99 = Percentile(values, 0.99),
            max = values.Length == 0 ? 0.0 : values[^1],
            signedMean = rows.Count == 0 ? 0.0 : rows.Average(r => r.Signed),
            leadRate = rows.Count == 0 ? 0.0 : rows.Count(r => r.Signed > 0.0) / (double)rows.Count,
            lagRate = rows.Count == 0 ? 0.0 : rows.Count(r => r.Signed < 0.0) / (double)rows.Count,
            overshootP95 = Percentile(overs, 0.95),
            overshootP99 = Percentile(overs, 0.99),
            overshootMax = overs.Length == 0 ? 0.0 : overs[^1],
            overshootGt0p5 = rows.Count == 0 ? 0.0 : rows.Count(r => r.Overshoot > 0.5) / (double)rows.Count,
            overshootGt1 = rows.Count == 0 ? 0.0 : rows.Count(r => r.Overshoot > 1.0) / (double)rows.Count,
            overshootGt2 = rows.Count == 0 ? 0.0 : rows.Count(r => r.Overshoot > 2.0) / (double)rows.Count,
            overshootGt4 = rows.Count == 0 ? 0.0 : rows.Count(r => r.Overshoot > 4.0) / (double)rows.Count
        };
    }

    static object Objective(List<EvalRow> rows)
    {
        var m = (dynamic)Summaries(rows);
        double visual = m.all.p95 * 0.25 + m.stopApproach.p95 + m.postStop.p95 + m.highSpeed.p95 * 0.2;
        double tail = m.stopApproach.p99 + m.stopApproach.overshootP99 * 1.5 + m.stopApproach.overshootGt2 * 50.0 + m.hardStopApproach.p99 * 0.25;
        return new { visualObjective = visual, tailObjective = tail };
    }

    static object TailSummary(List<EvalRow> rows)
    {
        return new
        {
            countGt1 = rows.Count,
            countGt2 = rows.Count(r => r.Overshoot > 2.0),
            countGt4 = rows.Count(r => r.Overshoot > 4.0),
            byPackage = rows.GroupBy(r => r.PackageId).ToDictionary(g => g.Key, g => g.Count()),
            byPhase = rows.GroupBy(Phase).ToDictionary(g => g.Key, g => g.Count()),
            speed = new
            {
                v2Median = Percentile(rows.Select(r => r.V2).OrderBy(v => v).ToArray(), 0.5),
                v12Median = Percentile(rows.Select(r => r.V12).OrderBy(v => v).ToArray(), 0.5),
                targetMedian = Percentile(rows.Select(r => r.TargetSpeed).OrderBy(v => v).ToArray(), 0.5),
                accelDropMedian = Percentile(rows.Select(r => r.AccelDrop).OrderBy(v => v).ToArray(), 0.5)
            }
        };
    }

    static object TailExample(EvalRow r)
    {
        return new
        {
            r.PackageId,
            elapsedMs = Math.Round(r.ElapsedMs, 3),
            phase = Phase(r),
            error = Math.Round(r.Error, 4),
            signed = Math.Round(r.Signed, 4),
            overshoot = Math.Round(r.Overshoot, 4),
            v2 = Math.Round(r.V2, 1),
            v5 = Math.Round(r.V5, 1),
            v12 = Math.Round(r.V12, 1),
            targetSpeed = Math.Round(r.TargetSpeed, 1),
            accelDrop = Math.Round(r.AccelDrop, 1),
            pathNet = Math.Round(r.PathNet, 3),
            pathEfficiency = Math.Round(r.PathEfficiency, 3),
            prediction = new[] { Math.Round(r.PredictionDx, 4), Math.Round(r.PredictionDy, 4) },
            offset0Target = new[] { Math.Round(r.TargetDx, 4), Math.Round(r.TargetDy, 4) },
            effectiveTarget = new[] { Math.Round(r.EffectiveTargetDx, 4), Math.Round(r.EffectiveTargetDy, 4) },
            r.RuntimeStationary,
            r.DecelLikely
        };
    }

    static string Phase(EvalRow r)
    {
        if (r.RuntimeStationary) return "runtimeStationary";
        if (r.DecelLikely && r.TargetSpeed <= 150.0) return "decelToStop";
        if (r.DecelLikely) return "runtimeDecel";
        if (r.HighSpeed) return "highSpeed";
        if (r.PostStop) return "postStop";
        return "other";
    }

    static (Velocity V2, Velocity V5, Velocity V12, PathStats Path, bool RuntimeStationary, bool NearStop, bool DecelLikely) RuntimeFeatures(CallPoint call, List<CallPoint> history)
    {
        Velocity v2 = VelocityWindow(call, history, 2);
        Velocity v5 = VelocityWindow(call, history, 5);
        Velocity v12 = VelocityWindow(call, history, 12);
        PathStats path = BuildPath(call, history, 12);
        bool stationary = v2.Speed <= 25.0 && v5.Speed <= 25.0 && v12.Speed <= 25.0 && path.Net <= 0.75 && path.Path <= 1.5;
        bool nearStop = v2.Speed <= 40.0 && v5.Speed <= 75.0 && path.Net <= 1.25 && path.Path <= 2.5;
        bool decelLikely = v12.Speed >= 500.0 && (v2.Speed <= 150.0 || v2.Speed <= v12.Speed * 0.35 || v5.Speed <= v12.Speed * 0.55);
        return (v2, v5, v12, path, stationary, nearStop, decelLikely);
    }

    static Velocity VelocityWindow(CallPoint call, List<CallPoint> history, int sampleCount)
    {
        if (history.Count == 0) return new Velocity(0, 0, 0);
        int back = Math.Min(sampleCount - 1, history.Count);
        CallPoint oldest = history[history.Count - back];
        double dt = (call.ElapsedUs - oldest.ElapsedUs) / 1000000.0;
        if (dt <= 0) return new Velocity(0, 0, 0);
        double vx = (call.X - oldest.X) / dt;
        double vy = (call.Y - oldest.Y) / dt;
        return new Velocity(vx, vy, Math.Sqrt(vx * vx + vy * vy));
    }

    static PathStats BuildPath(CallPoint call, List<CallPoint> history, int sampleCount)
    {
        var points = new List<(double X, double Y)>();
        int take = Math.Min(sampleCount - 1, history.Count);
        for (int i = history.Count - take; i < history.Count; i++)
        {
            points.Add((history[i].X, history[i].Y));
        }
        points.Add((call.X, call.Y));
        if (points.Count < 2) return new PathStats(0, 0, 0);
        double path = 0.0;
        for (int i = 1; i < points.Count; i++)
        {
            path += Dist(points[i - 1].X, points[i - 1].Y, points[i].X, points[i].Y);
        }
        double net = Dist(points[0].X, points[0].Y, call.X, call.Y);
        return new PathStats(net, path, path > 1e-6 ? net / path : 0.0);
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

    static double EffectiveElapsedUs(CallPoint call, double offsetMs)
    {
        double offsetTicks = offsetMs * call.Frequency / 1000.0;
        return call.ElapsedUs + ((call.TargetTicks + offsetTicks - call.SampleTicks) * 1000000.0 / call.Frequency);
    }

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
    static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    static double Mean(double[] values) => values.Length == 0 ? 0.0 : values.Average();
    static double Percentile(double[] values, double p) => values.Length == 0 ? 0.0 : values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)];
    static string Fmt(double value) => value < 0 ? "m" + Math.Abs(value).ToString("0.##", CultureInfo.InvariantCulture).Replace(".", "p") : "p" + value.ToString("0.##", CultureInfo.InvariantCulture).Replace(".", "p");
}
