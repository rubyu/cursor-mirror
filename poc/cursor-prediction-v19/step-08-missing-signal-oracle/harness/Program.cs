using System.Drawing;
using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using CursorMirror;
using CursorMirror.MotionLab;

record Config(string OutputPath, RealPackage[] RealPackages, SyntheticSet SyntheticSet, double CallRateHz, double RefreshMs, double[] PhaseOffsetsMs);
record RealPackage(string PackageId, string ZipPath, double WarmupMs, string Split, Window[] ExcludeMs);
record Window(double StartMs, double EndMs);
record SyntheticSet(string Id, string ScenarioPath, string MetadataPath);
record MetadataEnvelope(string SchemaVersion, ScenarioMeta[] Metadata);
record ScenarioMeta(int ScenarioIndex, string Family, double SpeedMultiplier, double StopDurationMs, double PhaseShift, double CurvePx, double NearZeroCreepMultiplier, string IntendedFailure);
record RefPoint(double ElapsedUs, double X, double Y);
record PollRow(string SequenceId, string Source, string Family, string Split, double ElapsedMs, double TrueX, double TrueY, double PollX, double PollY, double TargetX, double TargetY, double BaseDx, double BaseDy, double DirX, double DirY, double V2, double V3, double V5, double V8, double V12, double RecentHigh, double LatestDelta, double PathEfficiency, double TargetDistance, double HorizonMs, bool EventWindow, bool NormalMove, bool HighSpeed, bool StaticHold, ExtraSignals Signals);
record ExtraSignals(int DuplicateHoldRun, double LastRawMovementAgeMs, double SampleAgeMs, bool MissedPollBeforeStop, double TargetPhaseVsStopMs, bool TargetCrossesStopBoundary, bool NearZeroCreepAfterHigh, bool FutureStopWindowOracle);
record Candidate(string Id, string Family, string Signals, string Feasibility, string Action);
record EvalRow(string CandidateId, string SequenceId, string Source, string Family, string Split, double ElapsedMs, double VisualError, double CurrentDistance, double CurrentSigned, double CurrentDx, double CurrentDy, double DirX, double DirY, double V2, double V5, double V12, double RecentHigh, double TargetDistance, bool EventWindow, bool NormalMove, bool HighSpeed, bool StaticHold, bool Fired);
record StopEvent(string SequenceId, string Source, string Family, string Split, double StopElapsedMs, double PeakLeadPx, double PeakDistancePx, double ReturnMotionPx, bool OvershootThenReturn);

static class Program
{
    const long Frequency = 10_000_000L;

    static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var config = JsonSerializer.Deserialize<Config>(File.ReadAllText(args[0]), options)!;
        var rows = new List<PollRow>();
        rows.AddRange(BuildRealRows(config));
        rows.AddRange(BuildSyntheticRows(config, options));

        var candidates = BuildCandidates();
        var results = new Dictionary<string, object>();
        foreach (var candidate in candidates)
        {
            results[candidate.Id] = Evaluate(rows, candidate);
        }

        var ranking = results.Select(kvp => new { id = kvp.Key, score = Score((dynamic)kvp.Value) }).OrderBy(x => x.score.totalObjective).ToArray();
        var baseline = (dynamic)results["baseline_product_brake"];
        var best = (dynamic)results[ranking[0].id];
        var output = new
        {
            schemaVersion = "cursor-prediction-v19-step-08-missing-signal-oracle/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            inputs = new
            {
                realPackages = config.RealPackages.Select(p => new { p.PackageId, p.ZipPath, exists = File.Exists(p.ZipPath), p.Split }).ToArray(),
                syntheticSet = new { config.SyntheticSet.Id, config.SyntheticSet.ScenarioPath, exists = File.Exists(config.SyntheticSet.ScenarioPath) },
                config.CallRateHz,
                config.RefreshMs,
                config.PhaseOffsetsMs
            },
            datasetSummary = new
            {
                rows = rows.Count,
                bySource = rows.GroupBy(r => r.Source).ToDictionary(g => g.Key, g => g.Count()),
                eventRows = rows.Count(r => r.EventWindow),
                explicitSignalRows = new
                {
                    duplicateHold = rows.Count(r => r.Signals.DuplicateHoldRun > 0),
                    rawMovementAge = rows.Count(r => r.Signals.LastRawMovementAgeMs >= 16),
                    sampleAge = rows.Count(r => r.Signals.SampleAgeMs >= 8),
                    missedPollBeforeStop = rows.Count(r => r.Signals.MissedPollBeforeStop),
                    targetCrossesStopBoundary = rows.Count(r => r.Signals.TargetCrossesStopBoundary),
                    nearZeroCreepAfterHigh = rows.Count(r => r.Signals.NearZeroCreepAfterHigh)
                }
            },
            signalFeasibility = new
            {
                runtimeFeasibleNow = new[] { "duplicate/hold run from observed cursor samples", "sample age if poll timestamp is exposed", "DWM horizon/phase proxy" },
                requiresInstrumentation = new[] { "last raw movement age", "missed poll before stop", "explicit stale latest sample age", "target-vs-stop-boundary proxy from MotionLab/TraceTool" },
                futureLabelOracleOnly = new[] { "true target crosses true stop boundary", "future stop window oracle" }
            },
            candidates = results,
            ranking,
            selected = ranking[0],
            conclusion = new
            {
                strongRuntimeFeasibleSignalFound = StrongRuntimeFeasible(best, baseline),
                continueToStep09 = StrongRuntimeFeasible(best, baseline),
                blocker = "Runtime-feasible current/duplicate/sample-age signals improve return tail only partially; true target-crosses-stop-boundary oracle is the diagnostic upper bound."
            }
        };

        Directory.CreateDirectory(Path.GetDirectoryName(config.OutputPath)!);
        File.WriteAllText(config.OutputPath, JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(config.OutputPath);
        return 0;
    }

    static Candidate[] BuildCandidates() => new[]
    {
        new Candidate("baseline_product_brake", "baseline", "current product signals", "runtime now", "none"),
        new Candidate("current_signals_step07_best", "current", "v5/latestDelta/recentHigh", "runtime now", "snap"),
        new Candidate("plus_duplicate_hold", "ablation", "duplicateHoldRun", "runtime now from cursor samples", "snap"),
        new Candidate("plus_raw_input_age", "ablation", "lastRawMovementAge", "requires raw input age instrumentation", "snap"),
        new Candidate("plus_sample_age", "ablation", "sampleAge/stale latest", "runtime if timestamp/age retained", "snap"),
        new Candidate("plus_target_cross_boundary", "oracle", "target crosses true stop boundary", "future-label oracle; needs proxy instrumentation", "snap"),
        new Candidate("plus_phase", "ablation", "target phase vs stop onset", "requires stop-boundary proxy", "snap"),
        new Candidate("combined_runtime_feasible", "combined", "v5/latestDelta + duplicate/hold + sampleAge", "runtime feasible with sample age field", "snap"),
        new Candidate("combined_oracle", "combined", "runtime feasible + targetCross + future stop window", "oracle upper bound", "snap"),
        new Candidate("combined_oracle_cap0p5", "combined", "runtime feasible + targetCross + future stop window", "oracle upper bound", "cap0p5")
    };

    static object Evaluate(List<PollRow> rows, Candidate candidate)
    {
        var eval = new List<EvalRow>(rows.Count);
        int fires = 0;
        foreach (var group in rows.GroupBy(r => r.SequenceId))
        {
            int latch = 0;
            foreach (var row in group.OrderBy(r => r.ElapsedMs))
            {
                bool start = ShouldFire(row, candidate);
                bool release = row.V2 > 180 || row.LatestDelta > 3.5 || row.TargetDistance > 3.5;
                if (start) latch = Math.Max(latch, candidate.Id.Contains("phase") ? 6 : 4);
                if (release) latch = 0;
                bool fired = latch > 0;
                double dx = row.BaseDx;
                double dy = row.BaseDy;
                if (fired)
                {
                    fires++;
                    if (candidate.Action == "cap0p5") Cap(ref dx, ref dy, 0.5);
                    else { dx = 0; dy = 0; }
                    latch--;
                }
                eval.Add(BuildEval(candidate.Id, row, dx, dy, fired));
            }
        }
        var events = BuildEvents(eval).ToArray();
        return new
        {
            candidate,
            rows = eval.Count,
            overall = Overall(eval),
            step04bStress = Metrics(eval.Where(r => r.Source == "step04b_explicit_poll_stream").ToList()),
            realHoldout = Metrics(eval.Where(r => r.Source == "real" && r.Split == "test").ToList()),
            events = EventMetrics(events),
            fireDiagnostics = FireDiagnostics(eval, fires),
            tailRows = events.OrderByDescending(e => e.PeakLeadPx).Take(10).ToArray()
        };
    }

    static bool ShouldFire(PollRow row, Candidate c)
    {
        if (c.Id == "baseline_product_brake") return false;
        bool current = row.RecentHigh >= 400 && row.V5 <= 450 && row.LatestDelta <= 2.5;
        bool duplicate = row.Signals.DuplicateHoldRun >= 1 && row.RecentHigh >= 400;
        bool rawAge = row.Signals.LastRawMovementAgeMs >= 16 && row.RecentHigh >= 400;
        bool sampleAge = row.Signals.SampleAgeMs >= 8 && row.RecentHigh >= 400;
        bool cross = row.Signals.TargetCrossesStopBoundary && row.RecentHigh >= 400;
        bool phase = Math.Abs(row.Signals.TargetPhaseVsStopMs) <= 12 && row.Signals.TargetPhaseVsStopMs >= -4 && row.RecentHigh >= 400;
        return c.Id switch
        {
            "current_signals_step07_best" => current,
            "plus_duplicate_hold" => current && duplicate,
            "plus_raw_input_age" => current && rawAge,
            "plus_sample_age" => current && sampleAge,
            "plus_target_cross_boundary" => cross,
            "plus_phase" => phase,
            "combined_runtime_feasible" => current && (duplicate || sampleAge || row.Signals.NearZeroCreepAfterHigh),
            "combined_oracle" => (current && (duplicate || sampleAge)) || cross || row.Signals.FutureStopWindowOracle,
            "combined_oracle_cap0p5" => (current && (duplicate || sampleAge)) || cross || row.Signals.FutureStopWindowOracle,
            _ => false
        };
    }

    static EvalRow BuildEval(string id, PollRow r, double dx, double dy, bool fired)
    {
        double visual = Dist(r.PollX + dx, r.PollY + dy, r.TargetX, r.TargetY);
        double cdx = r.PollX + dx - r.TrueX;
        double cdy = r.PollY + dy - r.TrueY;
        double dist = Math.Sqrt(cdx * cdx + cdy * cdy);
        double signed = cdx * r.DirX + cdy * r.DirY;
        return new EvalRow(id, r.SequenceId, r.Source, r.Family, r.Split, r.ElapsedMs, visual, dist, signed, cdx, cdy, r.DirX, r.DirY, r.V2, r.V5, r.V12, r.RecentHigh, r.TargetDistance, r.EventWindow, r.NormalMove, r.HighSpeed, r.StaticHold, fired);
    }

    static IEnumerable<PollRow> BuildRealRows(Config config)
    {
        foreach (var package in config.RealPackages)
        {
            var rec = ReadRecording(package);
            var predictor = ProductPredictor();
            var counters = new CursorPredictionCounters();
            var history = new List<(double Ms, double X, double Y)>();
            foreach (var call in rec.Calls)
            {
                var poll = new CursorPollSample { Position = new Point((int)Math.Round(call.X), (int)Math.Round(call.Y)), TimestampTicks = call.SampleTicks, StopwatchFrequency = call.Frequency, DwmTimingAvailable = call.Dwm, DwmVBlankTicks = call.TargetTicks, DwmRefreshPeriodTicks = call.RefreshTicks };
                var pred = predictor.Predict(poll, counters, call.TargetTicks, call.RefreshTicks);
                if (!TryInterpolate(rec.Refs, call.ElapsedMs * 1000.0 + ((call.TargetTicks - call.SampleTicks) * 1000000.0 / call.Frequency) - 4000.0, out var target)) continue;
                var f = FeaturesFrom(call.ElapsedMs, call.X, call.Y, history, target.X, target.Y, 0, "real");
                bool evt = f.RecentHigh >= 500 && f.V2 <= 100 && f.TargetDistance <= 0.75;
                yield return MakeRow(call.SequenceId, "real", call.Family, package.Split, call.ElapsedMs, call.X, call.Y, call.X, call.Y, target.X, target.Y, pred.X - call.X, pred.Y - call.Y, f, evt, ExtraNone());
                history.Add((call.ElapsedMs, call.X, call.Y));
                if (history.Count > 12) history.RemoveAt(0);
            }
        }
    }

    static IEnumerable<PollRow> BuildSyntheticRows(Config config, JsonSerializerOptions options)
    {
        var set = JsonSerializer.Deserialize<MotionLabScenarioSet>(File.ReadAllText(config.SyntheticSet.ScenarioPath), options)!;
        var metadata = JsonSerializer.Deserialize<MetadataEnvelope>(File.ReadAllText(config.SyntheticSet.MetadataPath), options)!.Metadata.ToDictionary(m => m.ScenarioIndex);
        long refreshTicks = ToTicks(config.RefreshMs);
        double step = 1000.0 / config.CallRateHz;
        for (int i = 0; i < set.Scenarios.Length; i++)
        {
            var scenario = set.Scenarios[i];
            var sampler = new MotionLabSampler(scenario);
            string family = metadata.TryGetValue(i, out var meta) ? meta.Family : "unknown";
            double stopOnset = DetectStopOnset(sampler, scenario.DurationMilliseconds);
            foreach (double phase in config.PhaseOffsetsMs)
            {
                var predictor = ProductPredictor();
                var counters = new CursorPredictionCounters();
                var history = new List<(double Ms, double X, double Y)>();
                var trueHistory = new List<(double Ms, double X, double Y)>();
                int holdRun = 0;
                double lastMoveMs = 0;
                double lastPollX = double.NaN, lastPollY = double.NaN;
                for (double t = 0; t <= scenario.DurationMilliseconds + 0.001; t += step)
                {
                    var truth = sampler.GetSample(t);
                    double pollX = truth.X, pollY = truth.Y;
                    double sampleAge = 0;
                    bool missed = false;
                    bool staleFamily = family.Contains("stale") || family.Contains("missed");
                    if (staleFamily && t >= stopOnset - step && t <= stopOnset + (2 * step) && !double.IsNaN(lastPollX))
                    {
                        pollX = lastPollX;
                        pollY = lastPollY;
                        sampleAge = family.Contains("missed") ? step * 2 : step;
                        missed = family.Contains("missed");
                    }
                    double latestDelta = double.IsNaN(lastPollX) ? 0 : Dist(lastPollX, lastPollY, pollX, pollY);
                    holdRun = latestDelta <= 0.05 ? holdRun + 1 : 0;
                    if (latestDelta > 0.25) lastMoveMs = t;
                    long sampleTicks = ToTicks(t);
                    long targetTicks = ToTicks(NextVBlankMs(t, config.RefreshMs, phase));
                    var poll = new CursorPollSample { Position = new Point((int)Math.Round(pollX), (int)Math.Round(pollY)), TimestampTicks = sampleTicks, StopwatchFrequency = Frequency, DwmTimingAvailable = true, DwmVBlankTicks = targetTicks, DwmRefreshPeriodTicks = refreshTicks };
                    var pred = predictor.Predict(poll, counters, targetTicks, refreshTicks);
                    double targetMs = t + ((targetTicks - sampleTicks) * 1000.0 / Frequency) - 4.0;
                    var target = sampler.GetSample(targetMs);
                    var f = FeaturesFrom(t, pollX, pollY, history, target.X, target.Y, target.VelocityPixelsPerSecond, family);
                    bool cross = t < stopOnset && targetMs >= stopOnset;
                    bool eventWindow = t >= stopOnset && t <= stopOnset + 10 * step;
                    var signals = new ExtraSignals(holdRun, Math.Max(0, t - lastMoveMs), sampleAge, missed && t <= stopOnset + step, targetMs - stopOnset, cross, family.Contains("creep") && f.RecentHigh >= 400, eventWindow);
                    yield return MakeRow($"{config.SyntheticSet.Id}:{i:D2}:{family}:phase{FormatMs(phase)}", "step04b_explicit_poll_stream", family, SyntheticSplit(family, i), t, truth.X, truth.Y, pollX, pollY, target.X, target.Y, pred.X - pollX, pred.Y - pollY, f, eventWindow, signals);
                    history.Add((t, pollX, pollY));
                    trueHistory.Add((t, truth.X, truth.Y));
                    if (history.Count > 12) history.RemoveAt(0);
                    lastPollX = pollX; lastPollY = pollY;
                }
            }
        }
    }

    static PollRow MakeRow(string seq, string source, string family, string split, double ms, double trueX, double trueY, double pollX, double pollY, double targetX, double targetY, double baseDx, double baseDy, (double V2, double V3, double V5, double V8, double V12, double RecentHigh, double LatestDelta, double DirX, double DirY, double PathEfficiency, double TargetDistance, double HorizonMs) f, bool eventWindow, ExtraSignals signals)
    {
        bool high = f.V12 >= 1800;
        bool stat = f.V12 <= 100 && f.TargetDistance <= 0.75;
        bool normal = !eventWindow && f.V12 >= 250 && f.V12 < 1800;
        return new PollRow(seq, source, family, split, ms, trueX, trueY, pollX, pollY, targetX, targetY, baseDx, baseDy, f.DirX, f.DirY, f.V2, f.V3, f.V5, f.V8, f.V12, f.RecentHigh, f.LatestDelta, f.PathEfficiency, f.TargetDistance, f.HorizonMs, eventWindow, normal, high, stat, signals);
    }

    static (double V2, double V3, double V5, double V8, double V12, double RecentHigh, double LatestDelta, double DirX, double DirY, double PathEfficiency, double TargetDistance, double HorizonMs) FeaturesFrom(double ms, double x, double y, List<(double Ms, double X, double Y)> hist, double tx, double ty, double samplerSpeed, string family)
    {
        double Speed(int n)
        {
            if (hist.Count == 0) return 0;
            var old = hist[Math.Max(0, hist.Count - n + 1)];
            double dt = (ms - old.Ms) / 1000.0;
            return dt <= 0 ? 0 : Dist(old.X, old.Y, x, y) / dt;
        }
        var pts = hist.TakeLast(11).Concat(new[] { (Ms: ms, X: x, Y: y) }).ToArray();
        double path = 0;
        for (int i = 1; i < pts.Length; i++) path += Dist(pts[i - 1].X, pts[i - 1].Y, pts[i].X, pts[i].Y);
        double net = pts.Length > 1 ? Dist(pts[0].X, pts[0].Y, x, y) : 0;
        double dirX = 1, dirY = 0;
        if (net > 1e-6) { dirX = (x - pts[0].X) / net; dirY = (y - pts[0].Y) / net; }
        double latest = hist.Count == 0 ? 0 : Dist(hist[^1].X, hist[^1].Y, x, y);
        double v2 = Speed(2), v3 = Speed(3), v5 = Speed(5), v8 = Speed(8), v12 = Speed(12);
        double recent = Math.Max(Math.Max(v5, v8), Math.Max(v12, samplerSpeed));
        return (v2, v3, v5, v8, v12, recent, latest, dirX, dirY, path > 1e-6 ? net / path : 1, Dist(x, y, tx, ty), 0);
    }

    static IEnumerable<StopEvent> BuildEvents(List<EvalRow> rows)
    {
        foreach (var g in rows.GroupBy(r => r.SequenceId))
        {
            var ordered = g.OrderBy(r => r.ElapsedMs).ToArray();
            for (int i = 1; i < ordered.Length - 2; i++)
            {
                if (!ordered[i].EventWindow || ordered[i - 1].EventWindow) continue;
                var pre = ordered.Skip(Math.Max(0, i - 6)).Take(6).OrderByDescending(r => r.V12).FirstOrDefault() ?? ordered[i];
                var window = ordered.Skip(i).Take(11).ToArray();
                var leads = window.Select(r => r.CurrentDx * pre.DirX + r.CurrentDy * pre.DirY).ToArray();
                double peak = Math.Max(0, leads.Max());
                int peakFrame = Array.IndexOf(leads, leads.Max());
                double peakDist = window.Max(r => r.CurrentDistance);
                double minAfter = window.Skip(Math.Max(0, peakFrame)).Select(r => r.CurrentDistance).DefaultIfEmpty(peakDist).Min();
                double ret = Math.Max(0, peakDist - minAfter);
                yield return new StopEvent(ordered[i].SequenceId, ordered[i].Source, ordered[i].Family, ordered[i].Split, ordered[i].ElapsedMs, peak, peakDist, ret, peak > 0.5 && ret > 0.5 && minAfter < 1.0);
            }
        }
    }

    static object Metrics(List<EvalRow> rows)
    {
        var events = BuildEvents(rows).ToArray();
        return new { overall = Overall(rows), events = EventMetrics(events), normalMove = Slice(rows.Where(r => r.NormalMove).ToList()), highSpeed = Slice(rows.Where(r => r.HighSpeed).ToList()) };
    }

    static object Overall(List<EvalRow> rows) => new { count = rows.Count, visual = Stat(rows.Select(r => r.VisualError).ToArray()), stationaryJitter = Stat(rows.Where(r => r.StaticHold).Select(r => r.CurrentDistance).ToArray()) };
    static object Slice(List<EvalRow> rows) => new { count = rows.Count, visual = Stat(rows.Select(r => r.VisualError).ToArray()), signedMean = rows.Count == 0 ? 0 : rows.Average(r => r.CurrentSigned) };
    static object EventMetrics(StopEvent[] e) => new { count = e.Length, peakLead = Stat(e.Select(x => x.PeakLeadPx).ToArray()), peakDistance = Stat(e.Select(x => x.PeakDistancePx).ToArray()), returnMotion = Stat(e.Select(x => x.ReturnMotionPx).ToArray()), overshootThenReturnRateGt1 = e.Length == 0 ? 0 : e.Count(x => x.PeakLeadPx > 1 && x.OvershootThenReturn) / (double)e.Length, overshootThenReturnRateGt2 = e.Length == 0 ? 0 : e.Count(x => x.PeakLeadPx > 2 && x.OvershootThenReturn) / (double)e.Length };
    static object FireDiagnostics(List<EvalRow> rows, int fires) => new { totalFires = fires, totalFireRate = fires / (double)Math.Max(1, rows.Count), stopWindowFireRate = rows.Count(r => r.EventWindow && r.Fired) / (double)Math.Max(1, rows.Count(r => r.EventWindow)), normalMoveFireRate = rows.Count(r => r.NormalMove && r.Fired) / (double)Math.Max(1, rows.Count(r => r.NormalMove)), bySource = rows.GroupBy(r => r.Source).ToDictionary(g => g.Key, g => new { fireRate = g.Count(r => r.Fired) / (double)g.Count(), normalMoveFireRate = g.Count(r => r.NormalMove && r.Fired) / (double)Math.Max(1, g.Count(r => r.NormalMove)), stopWindowFireRate = g.Count(r => r.EventWindow && r.Fired) / (double)Math.Max(1, g.Count(r => r.EventWindow)) }) };
    static object Score(dynamic r) { double peak = r.step04bStress.events.peakLead.max, ret = r.step04bStress.events.returnMotion.max, otr = r.step04bStress.events.overshootThenReturnRateGt1, p95 = r.realHoldout.overall.visual.p95, p99 = r.realHoldout.overall.visual.p99, nf = r.fireDiagnostics.normalMoveFireRate; return new { totalObjective = peak * 700 + ret * 1600 + otr * 30000 + p95 * 140 + p99 * 40 + nf * 4000, step04bPeakLeadMax = peak, step04bOtrGt1 = otr, step04bReturnMax = ret, realHoldoutP95 = p95, realHoldoutP99 = p99, normalMoveFireRate = nf }; }
    static bool StrongRuntimeFeasible(dynamic best, dynamic baseline) => best.candidate.Feasibility.ToString().Contains("runtime") && best.step04bStress.events.returnMotion.max < baseline.step04bStress.events.returnMotion.max * 0.35 && best.step04bStress.events.overshootThenReturnRateGt1 < 0.05 && best.realHoldout.overall.visual.p95 <= baseline.realHoldout.overall.visual.p95 * 1.15;

    static DwmAwareCursorPositionPredictor ProductPredictor() { var p = new DwmAwareCursorPositionPredictor(100, 100, 0); p.ApplyPredictionModel(CursorMirrorSettings.DwmPredictionModelDistilledMlp); p.ApplyPredictionTargetOffsetMilliseconds(CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds); p.ApplyDistilledMlpPostStopBrakeEnabled(true); return p; }
    static double DetectStopOnset(MotionLabSampler sampler, double duration) { double prior = 0; for (double t = 0; t <= duration; t += 1) { var s = sampler.GetSample(t); prior = Math.Max(prior, s.VelocityPixelsPerSecond); if (prior >= 700 && s.VelocityPixelsPerSecond <= 120) return t; } return duration * 0.65; }
    static string SyntheticSplit(string family, int i) => family.Contains("curved") || family.Contains("missed") ? "test" : family.Contains("stale") || family.Contains("phase") ? "validation" : i % 3 == 0 ? "validation" : "train";
    static ExtraSignals ExtraNone() => new(0, 0, 0, false, 9999, false, false, false);
    static void Cap(ref double dx, ref double dy, double cap) { double mag = Math.Sqrt(dx * dx + dy * dy); if (mag > cap && mag > 1e-9) { dx *= cap / mag; dy *= cap / mag; } }
    static object Stat(double[] values) { Array.Sort(values); return new { count = values.Length, mean = values.Length == 0 ? 0 : values.Average(), p50 = Percentile(values, .5), p95 = Percentile(values, .95), p99 = Percentile(values, .99), max = values.Length == 0 ? 0 : values[^1] }; }
    static double Percentile(double[] values, double p) => values.Length == 0 ? 0 : values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)];
    static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    static double NextVBlankMs(double elapsedMs, double refreshMs, double phaseMs) { double n = Math.Floor((elapsedMs - phaseMs) / refreshMs) + 1; double target = n * refreshMs + phaseMs; return target <= elapsedMs + 0.001 ? target + refreshMs : target; }
    static long ToTicks(double ms) => (long)Math.Round(ms * Frequency / 1000.0);
    static string FormatMs(double v) => v.ToString("0.###", CultureInfo.InvariantCulture).Replace("-", "m").Replace(".", "p");

    record RealCall(string SequenceId, string Family, double ElapsedMs, double X, double Y, long SampleTicks, long TargetTicks, long RefreshTicks, long Frequency, bool Dwm);
    static (List<RefPoint> Refs, List<RealCall> Calls) ReadRecording(RealPackage package)
    {
        using var archive = ZipFile.OpenRead(package.ZipPath);
        using var reader = new StreamReader((archive.GetEntry("trace.csv") ?? throw new FileNotFoundException("trace.csv")).Open());
        var header = ParseCsvLine(reader.ReadLine() ?? "").ToArray();
        var index = header.Select((name, i) => (name, i)).ToDictionary(x => x.name, x => x.i);
        var refs = new List<RefPoint>(); var calls = new List<RealCall>(); string? line;
        while ((line = reader.ReadLine()) != null)
        {
            var f = ParseCsvLine(line).ToList(); string evt = Get(f, index, "event"); double us = GetDouble(f, index, "elapsedMicroseconds"); double ms = us / 1000.0;
            if (ms < package.WarmupMs || (package.ExcludeMs ?? Array.Empty<Window>()).Any(w => ms >= w.StartMs && ms < w.EndMs)) continue;
            double x = GetDouble(f, index, "cursorX", double.NaN), y = GetDouble(f, index, "cursorY", double.NaN);
            if (double.IsNaN(x) || double.IsNaN(y)) { x = GetDouble(f, index, "x", double.NaN); y = GetDouble(f, index, "y", double.NaN); }
            if (double.IsNaN(x) || double.IsNaN(y)) continue;
            if (evt == "referencePoll" || evt == "cursorPoll" || evt == "rawInput") refs.Add(new RefPoint(us, x, y));
            else if (evt == "runtimeSchedulerPoll")
            {
                long st = GetLong(f, index, "runtimeSchedulerSampleRecordedTicks", 0); if (st <= 0) st = GetLong(f, index, "stopwatchTicks", 0);
                long tt = GetLong(f, index, "predictionTargetTicks", 0); if (tt <= 0) tt = GetLong(f, index, "presentReferenceTicks", 0);
                long rt = GetLong(f, index, "dwmQpcRefreshPeriod", 0); long fq = GetLong(f, index, "stopwatchFrequency", 10000000);
                bool dwm = Get(f, index, "dwmTimingAvailable").Equals("true", StringComparison.OrdinalIgnoreCase);
                if (st > 0 && tt > 0 && rt > 0) calls.Add(new RealCall(package.PackageId, package.PackageId, ms, x, y, st, tt, rt, fq, dwm));
            }
        }
        refs.Sort((a, b) => a.ElapsedUs.CompareTo(b.ElapsedUs)); calls.Sort((a, b) => a.SampleTicks.CompareTo(b.SampleTicks)); return (refs, calls);
    }
    static bool TryInterpolate(List<RefPoint> refs, double us, out (double X, double Y) result) { result = default; if (refs.Count < 2 || us < refs[0].ElapsedUs || us > refs[^1].ElapsedUs) return false; int lo = 0, hi = refs.Count - 1; while (lo + 1 < hi) { int mid = (lo + hi) / 2; if (refs[mid].ElapsedUs <= us) lo = mid; else hi = mid; } var a = refs[lo]; var b = refs[Math.Min(lo + 1, refs.Count - 1)]; double span = Math.Max(1, b.ElapsedUs - a.ElapsedUs); double t = Math.Clamp((us - a.ElapsedUs) / span, 0, 1); result = (a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t); return true; }
    static IEnumerable<string> ParseCsvLine(string line) { var fields = new List<string>(); bool quoted = false; int start = 0; for (int i = 0; i < line.Length; i++) { if (line[i] == '"') quoted = !quoted; else if (line[i] == ',' && !quoted) { fields.Add(Unquote(line[start..i])); start = i + 1; } } fields.Add(Unquote(line[start..])); return fields; }
    static string Unquote(string value) => value.Length >= 2 && value[0] == '"' && value[^1] == '"' ? value[1..^1].Replace("\"\"", "\"") : value;
    static string Get(List<string> fields, Dictionary<string, int> index, string name) => index.TryGetValue(name, out int i) && i < fields.Count ? fields[i] : "";
    static double GetDouble(List<string> fields, Dictionary<string, int> index, string name, double fallback = 0) => double.TryParse(Get(fields, index, name), NumberStyles.Float, CultureInfo.InvariantCulture, out double v) ? v : fallback;
    static long GetLong(List<string> fields, Dictionary<string, int> index, string name, long fallback) => long.TryParse(Get(fields, index, name), NumberStyles.Integer, CultureInfo.InvariantCulture, out long v) ? v : fallback;
}
