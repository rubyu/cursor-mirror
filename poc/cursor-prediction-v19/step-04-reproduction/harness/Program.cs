using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using CursorMirror;
using CursorMirror.MotionLab;

record Config(string ScenarioPath, string MetadataPath, string OutputPath, double CallRateHz, double RefreshMs, double[] PhaseOffsetsMs);
record Candidate(string Id, int Model, int OffsetMs, bool PostStopBrake, int HorizonCapMs, string RuntimeShape);
record ScenarioMeta(int ScenarioIndex, string Family, double SpeedMultiplier, double StopDurationMs, double PhaseShift, double CurvePx, double NearZeroCreepMultiplier, string IntendedFailure);
record MetadataEnvelope(string SchemaVersion, ScenarioMeta[] Metadata);
record CallPoint(string ScenarioId, int ScenarioIndex, string Family, double PhaseOffsetMs, double ElapsedMs, double X, double Y, string MovementPhase, double SamplerSpeed, long SampleTicks, long TargetTicks, long RefreshTicks, long Frequency, bool DwmAvailable);
record Features(double V2, double V3, double V5, double V8, double V12, double RecentHigh, double LatestDelta, double DirX, double DirY, double PathNet, double PathLength, double PathEfficiency);
record EvalRow(string CandidateId, string ScenarioId, int ScenarioIndex, string Family, double PhaseOffsetMs, double ElapsedMs, string MovementPhase, bool DwmAvailable, double VisualError, double VisualSqError, double CurrentDistance, double CurrentSigned, double CurrentOvershoot, double CurrentDx, double CurrentDy, double DirX, double DirY, double V2, double V5, double V8, double V12, double RecentHigh, double LatestDelta, double PathEfficiency, double TargetDistance, bool FastThenNearZero, bool HardBrake, bool StopAfterHighSpeed, bool OneFrameStop, bool PostStopFirstFrames, bool NormalMove, bool HighSpeed, bool StaticHold);
record StopEventSummary(string ScenarioId, int ScenarioIndex, string Family, double PhaseOffsetMs, double StopElapsedMs, string Phase, string SpeedBand, string DecelBand, bool DwmAvailable, double PreMaxSpeed, double V2AtStop, double V5AtStop, double V8AtStop, double V12AtStop, double RecentHighAtStop, double LatestDeltaAtStop, double PathEfficiencyAtStop, double TargetDistanceAtStop, double PeakLeadPx, double PeakDistancePx, int PeakFrame, double ReturnMotionPx, bool OvershootThenReturn);

static class Program
{
    const long Frequency = 10_000_000L;

    static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: Step04ReproductionHarness <config.json>");
            return 2;
        }

        var jsonOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var config = JsonSerializer.Deserialize<Config>(File.ReadAllText(args[0]), jsonOptions)!;
        var scenarioSet = JsonSerializer.Deserialize<MotionLabScenarioSet>(File.ReadAllText(config.ScenarioPath), jsonOptions)!;
        var metadata = File.Exists(config.MetadataPath)
            ? JsonSerializer.Deserialize<MetadataEnvelope>(File.ReadAllText(config.MetadataPath), jsonOptions)!.Metadata.ToDictionary(m => m.ScenarioIndex)
            : new Dictionary<int, ScenarioMeta>();

        var candidates = BuildCandidates();
        var candidateResults = new Dictionary<string, object>();
        foreach (var candidate in candidates)
        {
            var sw = Stopwatch.StartNew();
            var rows = Evaluate(scenarioSet, metadata, config, candidate);
            sw.Stop();
            var events = BuildStopEvents(rows, 6, 10).ToArray();
            candidateResults[candidate.Id] = CandidateResult(candidate, rows, events, sw.Elapsed.TotalMilliseconds);
        }

        var ranking = candidateResults.Select(kvp => new
        {
            id = kvp.Key,
            score = Score((dynamic)kvp.Value)
        }).OrderBy(x => x.score.totalObjective).ToArray();

        var noBrake = (dynamic)candidateResults["distilled_mlp_lag0_offset_minus4"];
        var brake = (dynamic)candidateResults["distilled_mlp_lag0_offset_minus4_post_stop_brake"];
        var output = new
        {
            schemaVersion = "cursor-prediction-v19-step-04-reproduction/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            inputs = new
            {
                config.ScenarioPath,
                scenarioPathExists = File.Exists(config.ScenarioPath),
                scenarioBytes = File.Exists(config.ScenarioPath) ? new FileInfo(config.ScenarioPath).Length : 0,
                config.MetadataPath,
                metadataPathExists = File.Exists(config.MetadataPath),
                scenarioCount = scenarioSet.Scenarios?.Length ?? 0,
                scenarioSet.GenerationProfile,
                scenarioSet.DurationMilliseconds,
                scenarioSet.ScenarioDurationMilliseconds,
                scenarioSet.SampleRateHz,
                config.CallRateHz,
                config.RefreshMs,
                config.PhaseOffsetsMs
            },
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
            candidates = candidateResults,
            ranking,
            reproduction = new
            {
                noBrakeReproducesLeak = Reproduces((dynamic)noBrake),
                productBrakeReproducesLeak = Reproduces((dynamic)brake),
                noBrakeCriterion = "peakLead max > 0.5 px or overshootThenReturn >1px rate > 0",
                productBrakeCriterion = "same criterion; true means the current product brake leaks on this scenario set",
                proceedToDatasetLossDesign = Reproduces((dynamic)noBrake) || Reproduces((dynamic)brake)
            }
        };

        Directory.CreateDirectory(Path.GetDirectoryName(config.OutputPath)!);
        File.WriteAllText(config.OutputPath, JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(config.OutputPath);
        return 0;
    }

    static Candidate[] BuildCandidates() => new[]
    {
        new Candidate("constant_velocity_default_offset2", CursorMirrorSettings.DwmPredictionModelConstantVelocity, CursorMirrorSettings.DefaultDwmPredictionTargetOffsetMilliseconds, false, CursorMirrorSettings.DefaultDwmPredictionHorizonCapMilliseconds, "product ConstantVelocity, default +2ms target offset, 10ms cap"),
        new Candidate("least_squares_default_offset2", CursorMirrorSettings.DwmPredictionModelLeastSquares, CursorMirrorSettings.DefaultDwmPredictionTargetOffsetMilliseconds, false, CursorMirrorSettings.DefaultDwmPredictionHorizonCapMilliseconds, "product LeastSquares, default +2ms target offset"),
        new Candidate("distilled_mlp_lag0_offset_minus4", CursorMirrorSettings.DwmPredictionModelDistilledMlp, CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds, false, 0, "DistilledMLP lag0, -4ms target offset, post-stop brake disabled"),
        new Candidate("distilled_mlp_lag0_offset_minus4_post_stop_brake", CursorMirrorSettings.DwmPredictionModelDistilledMlp, CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds, true, 0, "DistilledMLP lag0, -4ms target offset, product post-stop brake enabled")
    };

    static List<EvalRow> Evaluate(MotionLabScenarioSet set, Dictionary<int, ScenarioMeta> metadata, Config config, Candidate candidate)
    {
        var rows = new List<EvalRow>();
        var scenarios = set.Scenarios ?? Array.Empty<MotionLabScript>();
        double callStepMs = 1000.0 / Math.Max(1.0, config.CallRateHz);
        long refreshTicks = ToTicks(config.RefreshMs);
        for (int scenarioIndex = 0; scenarioIndex < scenarios.Length; scenarioIndex++)
        {
            var scenario = scenarios[scenarioIndex] ?? new MotionLabScript();
            var sampler = new MotionLabSampler(scenario);
            var meta = metadata.TryGetValue(scenarioIndex, out var found)
                ? found
                : new ScenarioMeta(scenarioIndex, "unknown", 0, 0, 0, 0, 0, string.Empty);
            foreach (double phaseOffsetMs in config.PhaseOffsetsMs)
            {
                var predictor = new DwmAwareCursorPositionPredictor(100, 100, candidate.HorizonCapMs);
                predictor.ApplyPredictionModel(candidate.Model);
                predictor.ApplyPredictionTargetOffsetMilliseconds(candidate.OffsetMs);
                predictor.ApplyDistilledMlpPostStopBrakeEnabled(candidate.PostStopBrake);
                var counters = new CursorPredictionCounters();
                var history = new List<CallPoint>(16);
                for (double elapsedMs = 0; elapsedMs <= scenario.DurationMilliseconds + 0.001; elapsedMs += callStepMs)
                {
                    var samplePoint = sampler.GetSample(elapsedMs);
                    long sampleTicks = ToTicks(elapsedMs);
                    long targetTicks = ToTicks(NextVBlankMs(elapsedMs, config.RefreshMs, phaseOffsetMs));
                    var call = new CallPoint(
                        ScenarioId(scenarioIndex, meta.Family, phaseOffsetMs),
                        scenarioIndex,
                        meta.Family,
                        phaseOffsetMs,
                        elapsedMs,
                        samplePoint.X,
                        samplePoint.Y,
                        samplePoint.MovementPhase,
                        samplePoint.VelocityPixelsPerSecond,
                        sampleTicks,
                        targetTicks,
                        refreshTicks,
                        Frequency,
                        true);
                    var poll = new CursorPollSample
                    {
                        Position = new Point((int)Math.Round(call.X), (int)Math.Round(call.Y)),
                        TimestampTicks = call.SampleTicks,
                        StopwatchFrequency = call.Frequency,
                        DwmTimingAvailable = call.DwmAvailable,
                        DwmVBlankTicks = call.TargetTicks,
                        DwmRefreshPeriodTicks = call.RefreshTicks
                    };
                    PointF predicted = predictor.Predict(poll, counters, call.TargetTicks, call.RefreshTicks);
                    double targetMs = EffectiveTargetElapsedMs(call, candidate.OffsetMs);
                    var target = SampleWithDerivative(sampler, targetMs);
                    var offset0Target = SampleWithDerivative(sampler, EffectiveTargetElapsedMs(call, 0.0));
                    var f = RuntimeFeatures(call, history);
                    rows.Add(BuildEval(candidate.Id, call, predicted, target, offset0Target, f));
                    history.Add(call);
                    if (history.Count > 12) history.RemoveAt(0);
                }
            }
        }
        return rows;
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
        bool staticHold = string.Equals(call.MovementPhase, MotionLabMovementPhase.Hold, StringComparison.Ordinal) || (f.V12 <= 100 && offset0Target.Speed <= 25);
        bool normalMove = !acute && f.V12 >= 250 && f.V12 < 1800;
        return new EvalRow(candidateId, call.ScenarioId, call.ScenarioIndex, call.Family, call.PhaseOffsetMs, call.ElapsedMs, call.MovementPhase, call.DwmAvailable, visualError, visualError * visualError, currentDistance, currentSigned, Math.Max(0, currentSigned), currentDx, currentDy, f.DirX, f.DirY, f.V2, f.V5, f.V8, f.V12, f.RecentHigh, f.LatestDelta, f.PathEfficiency, Dist(call.X, call.Y, target.X, target.Y), fastThenNearZero, hardBrake, stopAfterHighSpeed, oneFrameStop, postStopFirstFrames, normalMove, highSpeed, staticHold);
    }

    static object CandidateResult(Candidate candidate, List<EvalRow> rows, StopEventSummary[] events, double elapsedMs) => new
    {
        candidate,
        rows = rows.Count,
        elapsedMs,
        runtimeEstimate = RuntimeEstimate(candidate, rows.Count, elapsedMs),
        overallMetrics = OverallMetrics(rows),
        rowSlices = AllSummaries(rows),
        eventMetrics = EventMetrics(events),
        failureSignatures = FailureSignatures(events, rows),
        tailRows = TailRows(events)
    };

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
        staticHold = SliceSummary(rows.Where(r => r.StaticHold).ToList()),
        byFamily = rows.GroupBy(r => r.Family).OrderBy(g => g.Key).ToDictionary(g => g.Key, g => SliceSummary(g.ToList())),
        byPhaseOffset = rows.GroupBy(r => r.PhaseOffsetMs).OrderBy(g => g.Key).ToDictionary(g => FormatMs(g.Key), g => SliceSummary(g.ToList()))
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

    static object EventMetrics(StopEventSummary[] events) => new
    {
        preFrames = 6,
        postFrames = 10,
        count = events.Length,
        peakLead = Stat(events.Select(e => e.PeakLeadPx).ToArray()),
        peakDistance = Stat(events.Select(e => e.PeakDistancePx).ToArray()),
        returnMotion = Stat(events.Select(e => e.ReturnMotionPx).ToArray()),
        overshootThenReturnRateGt0p5 = EventRate(events, e => e.PeakLeadPx > 0.5 && e.OvershootThenReturn),
        overshootThenReturnRateGt1 = EventRate(events, e => e.PeakLeadPx > 1.0 && e.OvershootThenReturn),
        overshootThenReturnRateGt2 = EventRate(events, e => e.PeakLeadPx > 2.0 && e.OvershootThenReturn),
        leadGt0p5 = EventRate(events, e => e.PeakLeadPx > 0.5),
        leadGt1 = EventRate(events, e => e.PeakLeadPx > 1.0),
        leadGt2 = EventRate(events, e => e.PeakLeadPx > 2.0),
        byPhase = events.GroupBy(e => e.Phase).OrderBy(g => g.Key).ToDictionary(g => g.Key, g => g.Count()),
        byFamily = events.GroupBy(e => e.Family).OrderBy(g => g.Key).ToDictionary(g => g.Key, g => new
        {
            count = g.Count(),
            peakLead = Stat(g.Select(e => e.PeakLeadPx).ToArray()),
            returnMotion = Stat(g.Select(e => e.ReturnMotionPx).ToArray()),
            overshootThenReturnRateGt1 = EventRate(g, e => e.PeakLeadPx > 1.0 && e.OvershootThenReturn)
        }),
        byPhaseOffset = events.GroupBy(e => e.PhaseOffsetMs).OrderBy(g => g.Key).ToDictionary(g => FormatMs(g.Key), g => new
        {
            count = g.Count(),
            peakLead = Stat(g.Select(e => e.PeakLeadPx).ToArray()),
            returnMotion = Stat(g.Select(e => e.ReturnMotionPx).ToArray()),
            overshootThenReturnRateGt1 = EventRate(g, e => e.PeakLeadPx > 1.0 && e.OvershootThenReturn)
        })
    };

    static IEnumerable<StopEventSummary> BuildStopEvents(List<EvalRow> rows, int preFrames, int postFrames)
    {
        foreach (var group in rows.GroupBy(r => r.ScenarioId))
        {
            var ordered = group.OrderBy(r => r.ElapsedMs).ToArray();
            bool inStop = false;
            for (int i = preFrames; i < ordered.Length - postFrames; i++)
            {
                var row = ordered[i];
                bool stopOnset = row.RecentHigh >= 400 && row.V2 <= 100 && row.TargetDistance <= 0.75;
                if (!stopOnset)
                {
                    if (row.V2 > 150 || row.TargetDistance > 1.0) inStop = false;
                    continue;
                }

                if (inStop) continue;
                inStop = true;
                var window = ordered.Skip(i).Take(postFrames + 1).ToArray();
                double peakLead = window.Max(r => r.CurrentOvershoot);
                double peakDistance = window.Max(r => r.CurrentDistance);
                int peakFrame = Array.FindIndex(window, r => Math.Abs(r.CurrentOvershoot - peakLead) < 1e-9);
                if (peakFrame < 0) peakFrame = 0;
                double afterMin = window.Skip(peakFrame).Select(r => r.CurrentDistance).DefaultIfEmpty(window[peakFrame].CurrentDistance).Min();
                double returnMotion = Math.Max(0, peakDistance - afterMin);
                bool returned = peakLead > 0.5 && afterMin <= Math.Min(1.0, peakDistance * 0.7);
                yield return new StopEventSummary(
                    row.ScenarioId,
                    row.ScenarioIndex,
                    row.Family,
                    row.PhaseOffsetMs,
                    row.ElapsedMs,
                    PhaseName(row),
                    SpeedBand(row.RecentHigh),
                    DecelBand(row.V2, row.V12),
                    row.DwmAvailable,
                    ordered.Skip(Math.Max(0, i - preFrames)).Take(preFrames + 1).Max(r => r.V12),
                    row.V2,
                    row.V5,
                    row.V8,
                    row.V12,
                    row.RecentHigh,
                    row.LatestDelta,
                    row.PathEfficiency,
                    row.TargetDistance,
                    peakLead,
                    peakDistance,
                    peakFrame,
                    returnMotion,
                    returned);
            }
        }
    }

    static object FailureSignatures(StopEventSummary[] events, List<EvalRow> rows)
    {
        var leaking = events.Where(e => e.PeakLeadPx > 0.5 || (e.PeakLeadPx > 1.0 && e.OvershootThenReturn)).ToArray();
        return new
        {
            leakingEventCount = leaking.Length,
            leakingFamilies = leaking.GroupBy(e => e.Family).OrderByDescending(g => g.Count()).ToDictionary(g => g.Key, g => g.Count()),
            leakingPhaseOffsets = leaking.GroupBy(e => e.PhaseOffsetMs).OrderByDescending(g => g.Count()).ToDictionary(g => FormatMs(g.Key), g => g.Count()),
            leakingSpeedBands = leaking.GroupBy(e => e.SpeedBand).OrderByDescending(g => g.Count()).ToDictionary(g => g.Key, g => g.Count()),
            leakingDecelBands = leaking.GroupBy(e => e.DecelBand).OrderByDescending(g => g.Count()).ToDictionary(g => g.Key, g => g.Count()),
            highTailFamilies = events.Where(e => e.PeakLeadPx > 1.0).GroupBy(e => e.Family).OrderByDescending(g => g.Count()).ToDictionary(g => g.Key, g => new { count = g.Count(), maxPeakLead = g.Max(e => e.PeakLeadPx) }),
            rowHighSpeedTail = rows.Where(r => r.HighSpeed).Select(r => r.VisualError).DefaultIfEmpty(0).Max()
        };
    }

    static object[] TailRows(StopEventSummary[] events) => events
        .OrderByDescending(e => e.PeakLeadPx)
        .ThenByDescending(e => e.ReturnMotionPx)
        .Take(12)
        .Select(e => new
        {
            e.ScenarioIndex,
            e.Family,
            e.PhaseOffsetMs,
            e.StopElapsedMs,
            e.Phase,
            e.SpeedBand,
            e.DecelBand,
            e.PreMaxSpeed,
            e.V2AtStop,
            e.V5AtStop,
            e.V12AtStop,
            e.TargetDistanceAtStop,
            e.PathEfficiencyAtStop,
            e.PeakFrame,
            e.PeakLeadPx,
            e.PeakDistancePx,
            e.ReturnMotionPx,
            e.OvershootThenReturn
        })
        .ToArray();

    static object RuntimeEstimate(Candidate candidate, int rows, double elapsedMs) => new
    {
        predictions = rows,
        elapsedMs,
        microsecondsPerPrediction = rows <= 0 ? 0 : elapsedMs * 1000.0 / rows,
        notes = candidate.RuntimeShape
    };

    static object Score(dynamic result)
    {
        var eventMetrics = (dynamic)result.eventMetrics;
        var overall = (dynamic)result.overallMetrics;
        double peakLeadP99 = eventMetrics.peakLead.p99;
        double peakLeadMax = eventMetrics.peakLead.max;
        double otrGt1 = eventMetrics.overshootThenReturnRateGt1;
        double visualP95 = overall.visual.p95;
        return new
        {
            totalObjective = peakLeadP99 * 20.0 + peakLeadMax * 5.0 + otrGt1 * 100.0 + visualP95,
            peakLeadP99,
            peakLeadMax,
            overshootThenReturnRateGt1 = otrGt1,
            visualP95
        };
    }

    static bool Reproduces(dynamic result)
    {
        var e = (dynamic)result.eventMetrics;
        return e.peakLead.max > 0.5 || e.overshootThenReturnRateGt1 > 0.0;
    }

    static Features RuntimeFeatures(CallPoint call, List<CallPoint> history)
    {
        double v2 = SpeedOver(call, history, 2);
        double v3 = SpeedOver(call, history, 3);
        double v5 = SpeedOver(call, history, 5);
        double v8 = SpeedOver(call, history, 8);
        double v12 = SpeedOver(call, history, 12);
        var recent = history.Concat(new[] { call }).TakeLast(12).ToArray();
        double recentHigh = 0;
        for (int i = 1; i < recent.Length; i++)
        {
            double dt = (recent[i].ElapsedMs - recent[i - 1].ElapsedMs) / 1000.0;
            if (dt > 0)
            {
                recentHigh = Math.Max(recentHigh, Dist(recent[i - 1].X, recent[i - 1].Y, recent[i].X, recent[i].Y) / dt);
            }
        }

        double latestDelta = recent.Length >= 2 ? Dist(recent[^2].X, recent[^2].Y, call.X, call.Y) : 0;
        double dirX = 1;
        double dirY = 0;
        double pathNet = 0;
        double pathLength = 0;
        if (recent.Length >= 2)
        {
            double dx = recent[^1].X - recent[0].X;
            double dy = recent[^1].Y - recent[0].Y;
            pathNet = Math.Sqrt(dx * dx + dy * dy);
            if (pathNet > 1e-6)
            {
                dirX = dx / pathNet;
                dirY = dy / pathNet;
            }
            for (int i = 1; i < recent.Length; i++)
            {
                pathLength += Dist(recent[i - 1].X, recent[i - 1].Y, recent[i].X, recent[i].Y);
            }
        }

        double efficiency = pathLength > 1e-6 ? pathNet / pathLength : 1.0;
        return new Features(v2, v3, v5, v8, v12, recentHigh, latestDelta, dirX, dirY, pathNet, pathLength, Math.Max(0, Math.Min(1, efficiency)));
    }

    static double SpeedOver(CallPoint call, List<CallPoint> history, int frames)
    {
        if (history.Count == 0) return 0;
        int index = Math.Max(0, history.Count - frames);
        var old = history[index];
        double dt = (call.ElapsedMs - old.ElapsedMs) / 1000.0;
        return dt <= 0 ? 0 : Dist(old.X, old.Y, call.X, call.Y) / dt;
    }

    static (double X, double Y, double Vx, double Vy, double Speed) SampleWithDerivative(MotionLabSampler sampler, double elapsedMs)
    {
        var s = sampler.GetSample(elapsedMs);
        var before = sampler.GetSample(elapsedMs - 1.0);
        var after = sampler.GetSample(elapsedMs + 1.0);
        double vx = (after.X - before.X) / 0.002;
        double vy = (after.Y - before.Y) / 0.002;
        return (s.X, s.Y, vx, vy, Math.Sqrt(vx * vx + vy * vy));
    }

    static double NextVBlankMs(double elapsedMs, double refreshMs, double phaseOffsetMs)
    {
        double n = Math.Floor((elapsedMs - phaseOffsetMs) / refreshMs) + 1.0;
        double target = (n * refreshMs) + phaseOffsetMs;
        if (target <= elapsedMs + 0.001) target += refreshMs;
        return target;
    }

    static double EffectiveTargetElapsedMs(CallPoint call, double offsetMs)
    {
        return ((call.TargetTicks - call.SampleTicks) * 1000.0 / call.Frequency) + call.ElapsedMs + offsetMs;
    }

    static long ToTicks(double ms) => (long)Math.Round(ms * Frequency / 1000.0);

    static object Stat(double[] source)
    {
        if (source.Length == 0)
        {
            return new { count = 0, mean = 0.0, p50 = 0.0, p95 = 0.0, p99 = 0.0, max = 0.0 };
        }

        var values = source.OrderBy(v => v).ToArray();
        return new
        {
            count = values.Length,
            mean = values.Average(),
            p50 = Percentile(values, 0.50),
            p95 = Percentile(values, 0.95),
            p99 = Percentile(values, 0.99),
            max = values[^1]
        };
    }

    static object Overshoot(double[] values) => new
    {
        count = values.Length,
        stats = Stat(values),
        rateGt0p5 = values.Length == 0 ? 0 : values.Count(v => v > 0.5) / (double)values.Length,
        rateGt1 = values.Length == 0 ? 0 : values.Count(v => v > 1.0) / (double)values.Length,
        rateGt2 = values.Length == 0 ? 0 : values.Count(v => v > 2.0) / (double)values.Length,
        rateGt4 = values.Length == 0 ? 0 : values.Count(v => v > 4.0) / (double)values.Length
    };

    static double Percentile(double[] sorted, double p)
    {
        if (sorted.Length == 0) return 0;
        double index = (sorted.Length - 1) * p;
        int left = (int)Math.Floor(index);
        int right = (int)Math.Ceiling(index);
        if (left == right) return sorted[left];
        return sorted[left] + ((sorted[right] - sorted[left]) * (index - left));
    }

    static double Rate<T>(IEnumerable<T> rows, Func<T, bool> predicate)
    {
        int total = 0;
        int hit = 0;
        foreach (var row in rows)
        {
            total++;
            if (predicate(row)) hit++;
        }
        return total == 0 ? 0 : hit / (double)total;
    }

    static double EventRate(IEnumerable<StopEventSummary> events, Func<StopEventSummary, bool> predicate) => Rate(events, predicate);

    static string PhaseName(EvalRow row)
    {
        if (row.PostStopFirstFrames) return "postStopFirstFrames";
        if (row.OneFrameStop) return "oneFrameStop";
        if (row.StopAfterHighSpeed) return "stopAfterHighSpeed";
        if (row.HardBrake) return "hardBrake";
        if (row.FastThenNearZero) return "fastThenNearZero";
        return "stopApproach";
    }

    static string SpeedBand(double speed)
    {
        if (speed >= 3000) return "veryHigh";
        if (speed >= 1800) return "high";
        if (speed >= 800) return "medium";
        return "low";
    }

    static string DecelBand(double v2, double v12)
    {
        if (v12 <= 1) return "unknown";
        double ratio = v2 / v12;
        if (ratio <= 0.05) return "fullStop";
        if (ratio <= 0.20) return "hard";
        if (ratio <= 0.50) return "medium";
        return "soft";
    }

    static string ScenarioId(int scenarioIndex, string family, double phaseOffsetMs) => $"{scenarioIndex:D2}:{family}:phase{FormatMs(phaseOffsetMs)}";

    static string FormatMs(double value) => value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture).Replace("-", "m").Replace(".", "p");

    static double Dist(double x0, double y0, double x1, double y1)
    {
        double dx = x1 - x0;
        double dy = y1 - y0;
        return Math.Sqrt(dx * dx + dy * dy);
    }
}
