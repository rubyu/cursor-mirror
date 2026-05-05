using System.Collections.Generic;
using System.Diagnostics;
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
record Candidate(string Id, int Model, int OffsetMs, bool PostStopBrake, int HorizonCapMs, string RuntimeShape);
record Features(double V2, double V3, double V5, double V8, double V12, double RecentHigh, double LatestDelta, double DirX, double DirY, double PathNet, double PathLength, double PathEfficiency);
record EvalRow(string CandidateId, string PackageId, double ElapsedMs, bool DwmAvailable, double VisualError, double VisualSqError, double CurrentDistance, double CurrentSigned, double CurrentOvershoot, double CurrentDx, double CurrentDy, double DirX, double DirY, double V2, double V5, double V8, double V12, double RecentHigh, double LatestDelta, double PathEfficiency, double TargetDistance, bool FastThenNearZero, bool HardBrake, bool StopAfterHighSpeed, bool OneFrameStop, bool PostStopFirstFrames, bool NormalMove, bool HighSpeed, bool StaticHold);
record StopEventSummary(string PackageId, double StopElapsedMs, string Phase, string SpeedBand, string DecelBand, bool DwmAvailable, double PreMaxSpeed, double V2AtStop, double V5AtStop, double V8AtStop, double V12AtStop, double RecentHighAtStop, double LatestDeltaAtStop, double PathEfficiencyAtStop, double TargetDistanceAtStop, double PeakLeadPx, double PeakDistancePx, int PeakFrame, double ReturnMotionPx, bool OvershootThenReturn);

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        var config = JsonSerializer.Deserialize<Config>(File.ReadAllText(args[0]), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        var recordings = config.Packages.Select(ReadRecording).ToArray();
        var candidates = BuildCandidates(config.HorizonCapMs);
        var results = new Dictionary<string, object>();
        foreach (var candidate in candidates)
        {
            var sw = Stopwatch.StartNew();
            var rows = Evaluate(recordings, candidate);
            sw.Stop();
            results[candidate.Id] = new
            {
                candidate,
                rows = rows.Count,
                elapsedMs = sw.Elapsed.TotalMilliseconds,
                runtimeEstimate = RuntimeEstimate(candidate, rows.Count, sw.Elapsed.TotalMilliseconds),
                overallMetrics = OverallMetrics(rows),
                rowSlices = AllSummaries(rows),
                eventMetrics = EventSummaries(rows),
                failureSignatures = FailureSignatures(rows),
            };
        }

        var ranking = results.Select(kvp => new
        {
            id = kvp.Key,
            score = Score((dynamic)kvp.Value)
        }).OrderBy(x => x.score.totalObjective).ToArray();

        var output = new
        {
            schemaVersion = "cursor-prediction-v19-step-01-baseline-audit/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            inputs = config.Packages.Select(p => new
            {
                p.PackageId,
                p.ZipPath,
                exists = File.Exists(p.ZipPath),
                bytes = File.Exists(p.ZipPath) ? new FileInfo(p.ZipPath).Length : 0,
                p.WarmupMs,
                p.ExcludeMs
            }).ToArray(),
            productState = new
            {
                distilledMlpModelId = DistilledMlpPredictionModel.ModelId,
                distilledMlpLagCompensationPixels = DistilledMlpPredictionModel.LagCompensationPixels,
                recommendedDistilledMlpOffsetMs = CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds,
                defaultTargetOffsetMs = CursorMirrorSettings.DefaultDwmPredictionTargetOffsetMilliseconds,
                postStopBrake = new
                {
                    latchFrames = 10,
                    startVelocity2Max = 0.0,
                    startTargetMaxPx = 0.1,
                    recentHighMin = 400.0,
                    releaseVelocity2Min = 50.0,
                    releaseTargetMinPx = 0.25
                }
            },
            datasetSummary = new
            {
                packages = recordings.Select(r => new { r.Package.PackageId, refs = r.Refs.Count, calls = r.Calls.Count }).ToArray(),
                totalCalls = recordings.Sum(r => r.Calls.Count),
                totalRefs = recordings.Sum(r => r.Refs.Count)
            },
            candidates = results,
            ranking
        };

        Directory.CreateDirectory(Path.GetDirectoryName(config.OutputPath)!);
        File.WriteAllText(config.OutputPath, JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(config.OutputPath);
        return 0;
    }

    static Candidate[] BuildCandidates(int configHorizonCapMs) => new[]
    {
        new Candidate("constant_velocity_default_offset2", CursorMirrorSettings.DwmPredictionModelConstantVelocity, CursorMirrorSettings.DefaultDwmPredictionTargetOffsetMilliseconds, false, CursorMirrorSettings.DefaultDwmPredictionHorizonCapMilliseconds, "product ConstantVelocity, default +2ms target offset, 10ms cap"),
        new Candidate("least_squares_default_offset2", CursorMirrorSettings.DwmPredictionModelLeastSquares, CursorMirrorSettings.DefaultDwmPredictionTargetOffsetMilliseconds, false, CursorMirrorSettings.DefaultDwmPredictionHorizonCapMilliseconds, "product LeastSquares, default +2ms target offset"),
        new Candidate("distilled_mlp_lag0_offset_minus4", CursorMirrorSettings.DwmPredictionModelDistilledMlp, CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds, false, configHorizonCapMs, "DistilledMLP lag0, -4ms target offset, post-stop brake disabled"),
        new Candidate("distilled_mlp_lag0_offset_minus4_post_stop_brake", CursorMirrorSettings.DwmPredictionModelDistilledMlp, CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds, true, configHorizonCapMs, "DistilledMLP lag0, -4ms target offset, product post-stop brake enabled")
    };

    static List<EvalRow> Evaluate((PackageConfig Package, List<RefPoint> Refs, List<CallPoint> Calls)[] recordings, Candidate candidate)
    {
        var all = new List<EvalRow>(200000);
        foreach (var recording in recordings)
        {
            var predictor = new DwmAwareCursorPositionPredictor(100, 100, candidate.HorizonCapMs);
            predictor.ApplyPredictionModel(candidate.Model);
            predictor.ApplyPredictionTargetOffsetMilliseconds(candidate.OffsetMs);
            predictor.ApplyDistilledMlpPostStopBrakeEnabled(candidate.PostStopBrake);
            var counters = new CursorPredictionCounters();
            var history = new List<CallPoint>(16);
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
                if (TryInterpolate(recording.Refs, EffectiveElapsedUs(call, candidate.OffsetMs), out var modelTarget) &&
                    TryInterpolate(recording.Refs, EffectiveElapsedUs(call, 0.0), out var offset0Target))
                {
                    var f = RuntimeFeatures(call, history);
                    all.Add(BuildEval(candidate.Id, call, predicted, modelTarget, offset0Target, f));
                }
                history.Add(call);
                if (history.Count > 12) history.RemoveAt(0);
            }
        }
        return all;
    }

    static EvalRow BuildEval(string candidateId, CallPoint call, PointF predicted, (double X, double Y, double Vx, double Vy, double Speed) target, (double X, double Y, double Vx, double Vy, double Speed) offset0Target, Features f)
    {
        double currentDx = predicted.X - call.X;
        double currentDy = predicted.Y - call.Y;
        double currentDistance = Math.Sqrt(currentDx * currentDx + currentDy * currentDy);
        double currentSigned = currentDx * f.DirX + currentDy * f.DirY;
        double errX = predicted.X - target.X;
        double errY = predicted.Y - target.Y;
        double visualError = Math.Sqrt(errX * errX + errY * errY);
        bool fastThenNearZero = f.V12 >= 500 && offset0Target.Speed <= 150;
        bool hardBrake = f.V12 >= 800 && f.V2 <= f.V12 * 0.35;
        bool stopAfterHighSpeed = f.V12 >= 1500 && offset0Target.Speed <= 150;
        bool oneFrameStop = f.V5 >= 500 && f.V2 <= 100;
        bool postStopFirstFrames = f.V12 >= 500 && f.V5 <= 250 && f.V2 <= 100;
        bool acute = fastThenNearZero || hardBrake || stopAfterHighSpeed || oneFrameStop || postStopFirstFrames;
        bool highSpeed = f.V12 >= 1800;
        bool staticHold = f.V12 <= 100 && offset0Target.Speed <= 25;
        bool normalMove = !acute && f.V12 >= 250 && f.V12 < 1800;
        return new EvalRow(candidateId, call.PackageId, call.ElapsedUs / 1000.0, call.DwmAvailable, visualError, visualError * visualError, currentDistance, currentSigned, Math.Max(0, currentSigned), currentDx, currentDy, f.DirX, f.DirY, f.V2, f.V5, f.V8, f.V12, f.RecentHigh, f.LatestDelta, f.PathEfficiency, Dist(call.X, call.Y, target.X, target.Y), fastThenNearZero, hardBrake, stopAfterHighSpeed, oneFrameStop, postStopFirstFrames, normalMove, highSpeed, staticHold);
    }

    static object OverallMetrics(List<EvalRow> rows)
    {
        var visual = rows.Select(r => r.VisualError).ToArray();
        return new
        {
            count = rows.Count,
            mae = visual.Length == 0 ? 0 : visual.Average(),
            rmse = visual.Length == 0 ? 0 : Math.Sqrt(rows.Average(r => r.VisualSqError)),
            visual = Stat(visual),
            currentDistance = Stat(rows.Select(r => r.CurrentDistance).ToArray()),
            stationaryJitter = Stat(rows.Where(r => r.StaticHold).Select(r => r.CurrentDistance).ToArray())
        };
    }

    static object AllSummaries(List<EvalRow> rows) => new
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

    static object SliceSummary(List<EvalRow> rows) => new
    {
        count = rows.Count,
        mae = rows.Count == 0 ? 0 : rows.Average(r => r.VisualError),
        rmse = rows.Count == 0 ? 0 : Math.Sqrt(rows.Average(r => r.VisualSqError)),
        visualError = Stat(rows.Select(r => r.VisualError).ToArray()),
        currentDistance = Stat(rows.Select(r => r.CurrentDistance).ToArray()),
        currentOvershoot = Overshoot(rows.Select(r => r.CurrentOvershoot).ToArray()),
        signedMean = rows.Count == 0 ? 0 : rows.Average(r => r.CurrentSigned),
        leadRate = Rate(rows, r => r.CurrentSigned > 0),
        lagRate = Rate(rows, r => r.CurrentSigned < 0)
    };

    static object EventSummaries(List<EvalRow> rows)
    {
        var events = BuildStopEvents(rows, 6, 10).ToList();
        return new
        {
            preFrames = 6,
            postFrames = 10,
            count = events.Count,
            peakLead = Stat(events.Select(e => e.PeakLeadPx).ToArray()),
            peakDistance = Stat(events.Select(e => e.PeakDistancePx).ToArray()),
            returnMotion = Stat(events.Select(e => e.ReturnMotionPx).ToArray()),
            overshootThenReturnRateGt0p5 = EventRate(events, e => e.PeakLeadPx > 0.5 && e.OvershootThenReturn),
            overshootThenReturnRateGt1 = EventRate(events, e => e.PeakLeadPx > 1.0 && e.OvershootThenReturn),
            overshootThenReturnRateGt2 = EventRate(events, e => e.PeakLeadPx > 2.0 && e.OvershootThenReturn),
            leadGt0p5 = EventRate(events, e => e.PeakLeadPx > 0.5),
            leadGt1 = EventRate(events, e => e.PeakLeadPx > 1.0),
            leadGt2 = EventRate(events, e => e.PeakLeadPx > 2.0),
            byPhase = events.GroupBy(e => e.Phase).ToDictionary(g => g.Key, g => g.Count()),
            byPackage = events.GroupBy(e => e.PackageId).ToDictionary(g => g.Key, g => g.Count()),
            bySpeedBand = events.GroupBy(e => e.SpeedBand).ToDictionary(g => g.Key, g => g.Count()),
            examples = events.OrderByDescending(e => e.PeakLeadPx).ThenByDescending(e => e.ReturnMotionPx).Take(12).ToArray()
        };
    }

    static IEnumerable<StopEventSummary> BuildStopEvents(List<EvalRow> rows, int preFrames, int postFrames)
    {
        foreach (var packageRows in rows.GroupBy(r => r.PackageId))
        {
            var ordered = packageRows.OrderBy(r => r.ElapsedMs).ToList();
            for (int i = preFrames; i < ordered.Count - 1; i++)
            {
                var r = ordered[i];
                bool nearStop = r.V2 <= 100.0 && r.TargetDistance <= 0.75;
                bool prevNearStop = ordered[i - 1].V2 <= 100.0 && ordered[i - 1].TargetDistance <= 0.75;
                var preWindow = ordered.Skip(Math.Max(0, i - preFrames)).Take(preFrames).ToList();
                double preMax = preWindow.Max(x => Math.Max(x.V5, x.V12));
                if (!nearStop || prevNearStop || preMax < 500.0) continue;

                var dirRow = preWindow.OrderByDescending(x => x.V12).First();
                double dirX = dirRow.DirX, dirY = dirRow.DirY;
                if (Math.Sqrt(dirX * dirX + dirY * dirY) <= 1e-6) { dirX = r.DirX; dirY = r.DirY; }

                var window = ordered.Skip(i).Take(postFrames + 1).ToList();
                var leads = window.Select(w => w.CurrentDx * dirX + w.CurrentDy * dirY).ToArray();
                double peakLead = Math.Max(0.0, leads.Length == 0 ? 0.0 : leads.Max());
                int peakFrame = leads.Length == 0 ? 0 : Array.IndexOf(leads, leads.Max());
                double peakDistance = window.Count == 0 ? 0.0 : window.Max(w => w.CurrentDistance);
                double minDistanceAfterPeak = window.Skip(peakFrame).Select(w => w.CurrentDistance).DefaultIfEmpty(peakDistance).Min();
                double returnMotion = Math.Max(0.0, peakDistance - minDistanceAfterPeak);
                bool returned = peakLead > 0.5 && window.Skip(peakFrame).Any(w => w.CurrentDistance < 1.0) && returnMotion > 0.5;
                string phase = r.OneFrameStop ? "oneFrameStop" : r.HardBrake ? "hardBrake" : r.PostStopFirstFrames ? "postStopFirstFrames" : r.StopAfterHighSpeed ? "stopAfterHighSpeed" : "fastThenNearZero";
                yield return new StopEventSummary(
                    r.PackageId,
                    r.ElapsedMs,
                    phase,
                    SpeedBand(preMax),
                    DecelBand(preMax, r.V2),
                    r.DwmAvailable,
                    preMax,
                    r.V2,
                    r.V5,
                    r.V8,
                    r.V12,
                    r.RecentHigh,
                    r.LatestDelta,
                    r.PathEfficiency,
                    r.TargetDistance,
                    peakLead,
                    peakDistance,
                    peakFrame,
                    returnMotion,
                    returned);
                i += 2;
            }
        }
    }

    static object FailureSignatures(List<EvalRow> rows)
    {
        var events = BuildStopEvents(rows, 6, 10).Where(e => e.PeakLeadPx > 0.5 || e.OvershootThenReturn).ToList();
        return new
        {
            count = events.Count,
            byPhase = events.GroupBy(e => e.Phase).ToDictionary(g => g.Key, g => SignatureStats(g.ToList())),
            bySpeedBand = events.GroupBy(e => e.SpeedBand).ToDictionary(g => g.Key, g => SignatureStats(g.ToList())),
            byDecelBand = events.GroupBy(e => e.DecelBand).ToDictionary(g => g.Key, g => SignatureStats(g.ToList())),
            byDwmAvailable = events.GroupBy(e => e.DwmAvailable ? "dwm" : "noDwm").ToDictionary(g => g.Key, g => SignatureStats(g.ToList())),
            top = events.OrderByDescending(e => e.PeakLeadPx).ThenByDescending(e => e.ReturnMotionPx).Take(20).ToArray()
        };
    }

    static object SignatureStats(List<StopEventSummary> events) => new
    {
        count = events.Count,
        peakLead = Stat(events.Select(e => e.PeakLeadPx).ToArray()),
        returnMotion = Stat(events.Select(e => e.ReturnMotionPx).ToArray()),
        otrGt1 = EventRate(events, e => e.PeakLeadPx > 1.0 && e.OvershootThenReturn)
    };

    static object RuntimeEstimate(Candidate candidate, int rows, double elapsedMs)
    {
        double usPerPrediction = rows == 0 ? 0 : elapsedMs * 1000.0 / rows;
        int estimatedMacs = candidate.Model == CursorMirrorSettings.DwmPredictionModelDistilledMlp ? DistilledMlpPredictionModel.EstimatedMacs : 0;
        return new { elapsedMs, predictions = rows, usPerPrediction, estimatedMacs, cpuOnly = true, allocationFreeRuntimeShape = true };
    }

    static object Score(dynamic result)
    {
        dynamic evt = result.eventMetrics;
        dynamic overall = result.overallMetrics;
        double objective = evt.peakLead.max * 1000 + evt.returnMotion.max * 500 + evt.overshootThenReturnRateGt1 * 10000 + overall.visual.p95;
        return new { totalObjective = objective, eventPeakLeadMax = evt.peakLead.max, visualP95 = overall.visual.p95 };
    }

    static string SpeedBand(double speed) => speed >= 1800 ? "veryHigh" : speed >= 1000 ? "high" : speed >= 600 ? "medium" : "low";
    static string DecelBand(double preMax, double v2) { double ratio = preMax <= 1e-6 ? 1.0 : v2 / preMax; return ratio <= 0.05 ? "fullStop" : ratio <= 0.2 ? "hardBrake" : ratio <= 0.5 ? "mediumBrake" : "soft"; }

    static Features RuntimeFeatures(CallPoint call, List<CallPoint> history)
    {
        var v2 = VelocityWindow(call, history, 2);
        var v3 = VelocityWindow(call, history, 3);
        var v5 = VelocityWindow(call, history, 5);
        var v8 = VelocityWindow(call, history, 8);
        var v12 = VelocityWindow(call, history, 12);
        var path = BuildPath(call, history, 12);
        double recentSegmentMax = RecentSegmentMax(call, history, 6);
        double latestDelta = history.Count == 0 ? 0.0 : Dist(history[^1].X, history[^1].Y, call.X, call.Y);
        double recentHigh = Math.Max(Math.Max(v5.Speed, v8.Speed), Math.Max(v12.Speed, recentSegmentMax));
        double dirX = v12.X, dirY = v12.Y, mag = Math.Sqrt(dirX * dirX + dirY * dirY);
        if (mag > 1e-6) { dirX /= mag; dirY /= mag; } else { dirX = 0; dirY = 0; }
        return new Features(v2.Speed, v3.Speed, v5.Speed, v8.Speed, v12.Speed, recentHigh, latestDelta, dirX, dirY, path.Net, path.Path, path.Efficiency);
    }

    static (double X, double Y, double Speed) VelocityWindow(CallPoint call, List<CallPoint> history, int sampleCount) { if (history.Count == 0) return (0, 0, 0); int back = Math.Min(sampleCount - 1, history.Count); var oldest = history[history.Count - back]; double dt = (call.ElapsedUs - oldest.ElapsedUs) / 1000000.0; if (dt <= 0) return (0, 0, 0); double vx = (call.X - oldest.X) / dt, vy = (call.Y - oldest.Y) / dt; return (vx, vy, Math.Sqrt(vx * vx + vy * vy)); }
    static (double Net, double Path, double Efficiency) BuildPath(CallPoint call, List<CallPoint> history, int sampleCount) { var pts = new List<(double X, double Y)>(); int take = Math.Min(sampleCount - 1, history.Count); for (int i = history.Count - take; i < history.Count; i++) pts.Add((history[i].X, history[i].Y)); pts.Add((call.X, call.Y)); if (pts.Count < 2) return (0, 0, 0); double path = 0; for (int i = 1; i < pts.Count; i++) path += Dist(pts[i - 1].X, pts[i - 1].Y, pts[i].X, pts[i].Y); double net = Dist(pts[0].X, pts[0].Y, call.X, call.Y); return (net, path, path > 1e-6 ? net / path : 0); }
    static double RecentSegmentMax(CallPoint call, List<CallPoint> history, int sampleCount) { var pts = new List<CallPoint>(); int take = Math.Min(sampleCount - 1, history.Count); for (int i = history.Count - take; i < history.Count; i++) pts.Add(history[i]); pts.Add(call); double max = 0; for (int i = 1; i < pts.Count; i++) { double dt = (pts[i].ElapsedUs - pts[i - 1].ElapsedUs) / 1000000.0; if (dt <= 0) continue; double vx = (pts[i].X - pts[i - 1].X) / dt, vy = (pts[i].Y - pts[i - 1].Y) / dt; max = Math.Max(max, Math.Sqrt(vx * vx + vy * vy)); } return max; }

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
            double x = GetDouble(fields, index, "cursorX", double.NaN), y = GetDouble(fields, index, "cursorY", double.NaN);
            if (double.IsNaN(x) || double.IsNaN(y)) { x = GetDouble(fields, index, "x", double.NaN); y = GetDouble(fields, index, "y", double.NaN); }
            if (double.IsNaN(x) || double.IsNaN(y)) continue;
            if (evt == "referencePoll" || evt == "cursorPoll" || evt == "rawInput") refs.Add(new RefPoint(elapsedUs, x, y));
            else if (evt == "runtimeSchedulerPoll")
            {
                long sampleTicks = GetLong(fields, index, "runtimeSchedulerSampleRecordedTicks", 0); if (sampleTicks <= 0) sampleTicks = GetLong(fields, index, "stopwatchTicks", 0);
                long targetTicks = GetLong(fields, index, "predictionTargetTicks", 0); if (targetTicks <= 0) targetTicks = GetLong(fields, index, "presentReferenceTicks", 0);
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
    static bool TryInterpolate(List<RefPoint> refs, double elapsedUs, out (double X, double Y, double Vx, double Vy, double Speed) result) { result = default; if (refs.Count < 2 || elapsedUs < refs[0].ElapsedUs || elapsedUs > refs[^1].ElapsedUs) return false; int lo = 0, hi = refs.Count - 1; while (lo + 1 < hi) { int mid = (lo + hi) / 2; if (refs[mid].ElapsedUs <= elapsedUs) lo = mid; else hi = mid; } var a = refs[lo]; var b = refs[Math.Min(lo + 1, refs.Count - 1)]; double span = Math.Max(1, b.ElapsedUs - a.ElapsedUs); double t = Math.Clamp((elapsedUs - a.ElapsedUs) / span, 0, 1); double x = a.X + (b.X - a.X) * t, y = a.Y + (b.Y - a.Y) * t; double vx = (b.X - a.X) * 1000000.0 / span, vy = (b.Y - a.Y) * 1000000.0 / span; result = (x, y, vx, vy, Math.Sqrt(vx * vx + vy * vy)); return true; }
    static object Stat(double[] values) { Array.Sort(values); return new { mean = values.Length == 0 ? 0 : values.Average(), p50 = Percentile(values, 0.50), p95 = Percentile(values, 0.95), p99 = Percentile(values, 0.99), max = values.Length == 0 ? 0 : values[^1] }; }
    static object Overshoot(double[] values) { Array.Sort(values); return new { p95 = Percentile(values, 0.95), p99 = Percentile(values, 0.99), max = values.Length == 0 ? 0 : values[^1], gt0p5 = values.Length == 0 ? 0 : values.Count(v => v > 0.5) / (double)values.Length, gt1 = values.Length == 0 ? 0 : values.Count(v => v > 1) / (double)values.Length, gt2 = values.Length == 0 ? 0 : values.Count(v => v > 2) / (double)values.Length, gt4 = values.Length == 0 ? 0 : values.Count(v => v > 4) / (double)values.Length }; }
    static double EventRate(List<StopEventSummary> events, Func<StopEventSummary, bool> pred) => events.Count == 0 ? 0 : events.Count(pred) / (double)events.Count;
    static double Rate(List<EvalRow> rows, Func<EvalRow, bool> pred) => rows.Count == 0 ? 0 : rows.Count(pred) / (double)rows.Count;
    static double Percentile(double[] values, double p) { Array.Sort(values); return values.Length == 0 ? 0 : values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)]; }
    static IEnumerable<string> ParseCsvLine(string line) { var fields = new List<string>(); bool quoted = false; int start = 0; for (int i = 0; i < line.Length; i++) { if (line[i] == '"') quoted = !quoted; else if (line[i] == ',' && !quoted) { fields.Add(Unquote(line[start..i])); start = i + 1; } } fields.Add(Unquote(line[start..])); return fields; }
    static string Unquote(string value) => value.Length >= 2 && value[0] == '"' && value[^1] == '"' ? value[1..^1].Replace("\"\"", "\"") : value;
    static string Get(List<string> fields, Dictionary<string, int> index, string name) => index.TryGetValue(name, out int i) && i < fields.Count ? fields[i] : "";
    static double GetDouble(List<string> fields, Dictionary<string, int> index, string name, double fallback = 0) => double.TryParse(Get(fields, index, name), NumberStyles.Float, CultureInfo.InvariantCulture, out double v) ? v : fallback;
    static long GetLong(List<string> fields, Dictionary<string, int> index, string name, long fallback) => long.TryParse(Get(fields, index, name), NumberStyles.Integer, CultureInfo.InvariantCulture, out long v) ? v : fallback;
    static bool IsExcluded(double elapsedMs, Window[] windows) => windows != null && windows.Any(w => elapsedMs >= w.StartMs && elapsedMs < w.EndMs);
    static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
}
