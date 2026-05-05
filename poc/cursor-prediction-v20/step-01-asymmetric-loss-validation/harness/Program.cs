using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using CursorMirror;
using CursorMirror.MotionLab;

record Config(string OutputPath, string WeightsPath, RealPackage[] RealPackages, SyntheticSet[] SyntheticSets, double CallRateHz, double RefreshMs, double[] PhaseOffsetsMs, int MaxEpochs, double LearningRate, int Seed);
record RealPackage(string PackageId, string ZipPath, double WarmupMs, string Split, Window[] ExcludeMs);
record Window(double StartMs, double EndMs);
record SyntheticSet(string Id, string ScenarioPath, string MetadataPath, string Role);
record ScenarioMeta(int ScenarioIndex, string Family, double SpeedMultiplier, double StopDurationMs, double PhaseShift, double CurvePx, double NearZeroCreepMultiplier, string IntendedFailure);
record MetadataEnvelope(string SchemaVersion, ScenarioMeta[] Metadata);
record RefPoint(double ElapsedUs, double X, double Y);
record CallPoint(string SequenceId, string Source, string Family, string Split, double PhaseOffsetMs, double ElapsedMs, double X, double Y, string MovementPhase, long SampleTicks, long TargetTicks, long RefreshTicks, long Frequency, bool DwmAvailable);
record Features(double Dx2, double Dy2, double V2, double Dx3, double Dy3, double V3, double Dx5, double Dy5, double V5, double Dx8, double Dy8, double V8, double Dx12, double Dy12, double V12, double RecentHigh, double LatestDelta, double DirX, double DirY, double PathNet, double PathLength, double PathEfficiency, double HorizonMs, double TargetDistance, double SamplerSpeed);
record DataRow(string SequenceId, string Source, string Family, string Split, double ElapsedMs, string MovementPhase, Features F, double LabelDx, double LabelDy, double SafeDx, double SafeDy, bool EventWindowLabel, bool StaticLabel, double BaseDx, double BaseDy);
record CandidateSpec(
    string Id,
    string Family,
    string FeatureKind,
    int Hidden,
    string TrainingTarget,
    string RuntimeShape,
    string LossKind = "eventSafe",
    double LeadWeight = 0,
    double EventLeadMultiplier = 1,
    double LagWeight = 1,
    double EventWeight = 12,
    double StaticWeight = 2.5);
record EvalRow(string CandidateId, string SequenceId, string Source, string Family, string Split, double ElapsedMs, string MovementPhase, double VisualError, double VisualSqError, double FutureLead, double FutureLag, double FutureSignedError, double CurrentDistance, double CurrentSigned, double CurrentOvershoot, double CurrentDx, double CurrentDy, double DirX, double DirY, double V2, double V5, double V8, double V12, double RecentHigh, double LatestDelta, double PathEfficiency, double TargetDistance, bool FastThenNearZero, bool HardBrake, bool StopAfterHighSpeed, bool OneFrameStop, bool PostStopFirstFrames, bool NormalMove, bool HighSpeed, bool StaticHold);
record StopEventSummary(string SequenceId, string Source, string Family, string Split, double StopElapsedMs, string Phase, string SpeedBand, string DecelBand, double PreMaxSpeed, double V2AtStop, double V5AtStop, double V12AtStop, double TargetDistanceAtStop, double PeakLeadPx, double PeakDistancePx, int PeakFrame, double ReturnMotionPx, bool OvershootThenReturn);

static class Program
{
    const long Frequency = 10_000_000L;

    static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        var jsonOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var config = JsonSerializer.Deserialize<Config>(File.ReadAllText(args[0]), jsonOptions)!;
        var swAll = Stopwatch.StartNew();
        var rows = new List<DataRow>();
        rows.AddRange(BuildRealRows(config));
        rows.AddRange(BuildSyntheticRows(config));
        MarkEventWindows(rows);

        var trainRows = rows.Where(r => r.Split == "train").ToArray();
        var specs = GenerateModelSpecs().ToArray();

        var candidates = new Dictionary<string, object>();
        var trainedModels = new Dictionary<string, TrainedMlp>();
        foreach (var spec in specs)
        {
            var model = TrainMlp(spec, trainRows, config);
            trainedModels[spec.Id] = model;
            candidates[spec.Id] = EvaluateCandidate(rows, spec, r => model.Model.Predict(model.Normalizer.Transform(FeatureVector(r, spec.FeatureKind))), model.TrainingTrace, model.RuntimeCost);
        }

        candidates["product_distilled_lag0_offset_minus4_brake"] = EvaluateCandidate(
            rows,
            new CandidateSpec("product_distilled_lag0_offset_minus4_brake", "Product", "baseline", 0, "none", "current product DistilledMLP lag0 -4ms with post-stop brake"),
            r => new[] { r.BaseDx, r.BaseDy },
            Array.Empty<object>(),
            new { estimatedMacs = DistilledMlpPredictionModel.EstimatedMacs, parameters = 0, branches = "current product" });

        candidates["rule_hybrid_latch_v2_50_high600_latest0p75"] = EvaluateRuleHybrid(
            rows,
            "rule_hybrid_latch_v2_50_high600_latest0p75",
            "product baseline plus runtime latch snap: recentHigh>=600, v2<=50, latestDelta<=0.75, release v2>100/latestDelta>1.25");
        candidates["rule_hybrid_cap0p5_v2_50_high600_latest0p75"] = EvaluateRuleHybrid(
            rows,
            "rule_hybrid_cap0p5_v2_50_high600_latest0p75",
            "product baseline plus runtime latch distance cap 0.5px: recentHigh>=600, v2<=50, latestDelta<=0.75",
            capPx: 0.5);
        candidates["rule_hybrid_latch_v2_150_high400_latest2p0"] = EvaluateRuleHybrid(
            rows,
            "rule_hybrid_latch_v2_150_high400_latest2p0",
            "broader runtime latch snap: recentHigh>=400, v2<=150, latestDelta<=2.0, release v2>180/latestDelta>2.5",
            highMin: 400,
            v2Max: 150,
            latestMax: 2.0,
            releaseV2: 180,
            releaseLatest: 2.5);
        candidates["rule_hybrid_cap0p5_v2_150_high400_latest2p0"] = EvaluateRuleHybrid(
            rows,
            "rule_hybrid_cap0p5_v2_150_high400_latest2p0",
            "broader runtime latch with 0.5px cap: recentHigh>=400, v2<=150, latestDelta<=2.0",
            highMin: 400,
            v2Max: 150,
            latestMax: 2.0,
            releaseV2: 180,
            releaseLatest: 2.5,
            capPx: 0.5);
        candidates["rule_hybrid_latch_v5_300_high400_latest2p5"] = EvaluateRuleHybrid(
            rows,
            "rule_hybrid_latch_v5_300_high400_latest2p5",
            "post-stop tail latch snap: recentHigh>=400, v5<=300, latestDelta<=2.5, release v2>180/latestDelta>3.0",
            highMin: 400,
            v2Max: 300,
            latestMax: 2.5,
            useV5ForStart: true,
            releaseV2: 180,
            releaseLatest: 3.0);

        var ranking = candidates.Select(kvp => new { id = kvp.Key, score = Score((dynamic)kvp.Value) })
            .OrderBy(x => x.score.totalObjective)
            .ToArray();
        var bestModelId = ranking.First(x => trainedModels.ContainsKey(x.id)).id;
        WriteWeights(config.WeightsPath, specs.First(s => s.Id == bestModelId), trainedModels[bestModelId]);

        var output = new
        {
            schemaVersion = "cursor-prediction-v20-step-01-asymmetric-loss-validation/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            environment = new
            {
                runtime = ".NET " + Environment.Version,
                gpu = "not used; CPU-only C# asymmetric-loss validation",
                elapsedMs = swAll.Elapsed.TotalMilliseconds
            },
            inputs = new
            {
                realPackages = config.RealPackages.Select(p => new { p.PackageId, p.ZipPath, exists = File.Exists(p.ZipPath), p.Split, p.WarmupMs }).ToArray(),
                syntheticSets = config.SyntheticSets.Select(s => new { s.Id, s.ScenarioPath, exists = File.Exists(s.ScenarioPath), s.Role }).ToArray(),
                callRateHz = config.CallRateHz,
                phaseOffsetsMs = config.PhaseOffsetsMs
            },
            datasetSummary = DatasetSummary(rows),
            splitPolicy = new
            {
                unit = "real file/package and synthetic scenario/family",
                real = "m070248 train, m070307 test",
                synthetic = "scenario/family deterministic split: train/validation/test; full families held out where possible",
                note = "Compact representative CPU run comparing event-safe loss with asymmetric future-lead penalties on the same splits."
            },
            trainingSemantics = new
            {
                runtimeFeatures = new[] { "recent position/timestamp windows", "DWM horizon", "recent velocity windows", "path efficiency", "latest delta" },
                trainingLabels = new[] { "shifted visual target dx/dy", "event-window safe dx/dy=0 for the baseline loss", "future cursor position at target time" },
                asymmetricLeadDefinition = "lead=max(0,dot(predictedFutureError, recentDirection)); lag=max(0,-dot(predictedFutureError, recentDirection))",
                eventPenalties = new[] { "futureLead", "peakLead", "OTR >1px", "returnMotion", "stationary jitter", "normal-move signed lag guard" },
                futureLabelsOnlyForTraining = true,
                directionVariants = new[] { "runtime recent motion direction via v12/path direction; near-zero fallback is target-current or +X" }
            },
            candidates,
            ranking,
            selected = ranking[0],
            continueToStep07 = ClearlyImproves((dynamic)candidates[ranking[0].id], (dynamic)candidates["product_distilled_lag0_offset_minus4_brake"])
        };
        Directory.CreateDirectory(Path.GetDirectoryName(config.OutputPath)!);
        File.WriteAllText(config.OutputPath, JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(config.OutputPath);
        return 0;
    }

    static IEnumerable<DataRow> BuildRealRows(Config config)
    {
        foreach (var package in config.RealPackages)
        {
            var recording = ReadRecording(package);
            var predictor = ProductPredictor();
            var counters = new CursorPredictionCounters();
            var history = new List<CallPoint>();
            foreach (var call in recording.Calls)
            {
                var poll = Poll(call);
                var predicted = predictor.Predict(poll, counters, call.TargetTicks, call.RefreshTicks);
                if (!TryInterpolate(recording.Refs, EffectiveElapsedUs(call, CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds), out var target)) continue;
                var f = RuntimeFeatures(call, history, target);
                yield return new DataRow(call.SequenceId, call.Source, call.Family, call.Split, call.ElapsedMs, call.MovementPhase, f, target.X - call.X, target.Y - call.Y, 0, 0, false, false, predicted.X - call.X, predicted.Y - call.Y);
                history.Add(call);
                if (history.Count > 12) history.RemoveAt(0);
            }
        }
    }

    static IEnumerable<DataRow> BuildSyntheticRows(Config config)
    {
        foreach (var setConfig in config.SyntheticSets)
        {
            var jsonOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            var set = JsonSerializer.Deserialize<MotionLabScenarioSet>(File.ReadAllText(setConfig.ScenarioPath), jsonOptions)!;
            var metadata = File.Exists(setConfig.MetadataPath)
                ? JsonSerializer.Deserialize<MetadataEnvelope>(File.ReadAllText(setConfig.MetadataPath), jsonOptions)!.Metadata.ToDictionary(m => m.ScenarioIndex)
                : new Dictionary<int, ScenarioMeta>();
            var scenarios = set.Scenarios ?? Array.Empty<MotionLabScript>();
            double stepMs = 1000.0 / config.CallRateHz;
            long refreshTicks = ToTicks(config.RefreshMs);
            for (int i = 0; i < scenarios.Length; i++)
            {
                var scenario = scenarios[i] ?? new MotionLabScript();
                var sampler = new MotionLabSampler(scenario);
                string family = metadata.TryGetValue(i, out var meta) ? meta.Family : "unknown";
                string split = SyntheticSplit(setConfig.Id, family, i);
                foreach (double phase in config.PhaseOffsetsMs)
                {
                    var predictor = ProductPredictor();
                    var counters = new CursorPredictionCounters();
                    var history = new List<CallPoint>();
                    for (double elapsedMs = 0; elapsedMs <= scenario.DurationMilliseconds + 0.001; elapsedMs += stepMs)
                    {
                        var sample = sampler.GetSample(elapsedMs);
                        var call = new CallPoint(
                            $"{setConfig.Id}:{i:D2}:{family}:phase{FormatMs(phase)}",
                            setConfig.Id,
                            family,
                            split,
                            phase,
                            elapsedMs,
                            sample.X,
                            sample.Y,
                            sample.MovementPhase,
                            ToTicks(elapsedMs),
                            ToTicks(NextVBlankMs(elapsedMs, config.RefreshMs, phase)),
                            refreshTicks,
                            Frequency,
                            true);
                        var poll = Poll(call);
                        var predicted = predictor.Predict(poll, counters, call.TargetTicks, call.RefreshTicks);
                        var target = SampleWithDerivative(sampler, EffectiveTargetElapsedMs(call, CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds));
                        var f = RuntimeFeatures(call, history, target);
                        yield return new DataRow(call.SequenceId, call.Source, call.Family, call.Split, call.ElapsedMs, call.MovementPhase, f, target.X - call.X, target.Y - call.Y, 0, 0, false, false, predicted.X - call.X, predicted.Y - call.Y);
                        history.Add(call);
                        if (history.Count > 12) history.RemoveAt(0);
                    }
                }
            }
        }
    }

    static void MarkEventWindows(List<DataRow> rows)
    {
        for (int g = 0; g < rows.Count; g++) { }
        foreach (var group in rows.GroupBy(r => r.SequenceId))
        {
            var ordered = group.OrderBy(r => r.ElapsedMs).ToArray();
            var marks = new bool[ordered.Length];
            for (int i = 6; i < ordered.Length - 1; i++)
            {
                bool nearStop = ordered[i].F.V2 <= 100 && ordered[i].F.TargetDistance <= 0.75;
                bool prevNear = ordered[i - 1].F.V2 <= 100 && ordered[i - 1].F.TargetDistance <= 0.75;
                double preMax = ordered.Skip(Math.Max(0, i - 6)).Take(6).Max(r => Math.Max(r.F.V5, r.F.V12));
                if (nearStop && !prevNear && preMax >= 500)
                {
                    for (int j = i; j < Math.Min(ordered.Length, i + 11); j++) marks[j] = true;
                }
            }
            for (int i = 0; i < ordered.Length; i++)
            {
                bool stat = ordered[i].MovementPhase == MotionLabMovementPhase.Hold || (ordered[i].F.V12 <= 100 && ordered[i].F.TargetDistance <= 0.75);
                if (marks[i] || stat)
                {
                    int idx = rows.IndexOf(ordered[i]);
                    rows[idx] = ordered[i] with
                    {
                        SafeDx = 0,
                        SafeDy = 0,
                        EventWindowLabel = marks[i],
                        StaticLabel = stat
                    };
                }
            }
        }
    }

    static TrainedMlp TrainMlp(CandidateSpec spec, DataRow[] trainRows, Config config)
    {
        var xRaw = trainRows.Select(r => FeatureVector(r, spec.FeatureKind)).ToArray();
        var norm = Normalizer.Fit(xRaw);
        var x = xRaw.Select(norm.Transform).ToArray();
        var model = new MlpModel(x[0].Length, spec.Hidden, new Random(config.Seed + spec.Hidden + spec.FeatureKind.Length));
        var trace = new List<object>();
        int n = x.Length;
        double lr = config.LearningRate;
        for (int epoch = 1; epoch <= config.MaxEpochs; epoch++)
        {
            model.ZeroGrad();
            double loss = 0;
            for (int i = 0; i < n; i++)
            {
                var row = trainRows[i];
                bool eventSafe = spec.LossKind == "eventSafe";
                double tx = eventSafe && (row.EventWindowLabel || row.StaticLabel) ? row.SafeDx : row.LabelDx;
                double ty = eventSafe && (row.EventWindowLabel || row.StaticLabel) ? row.SafeDy : row.LabelDy;
                double eventWeight = row.EventWindowLabel ? spec.EventWeight : 0.0;
                double staticWeight = row.StaticLabel ? spec.StaticWeight : 0.0;
                double w = 1.0 + eventWeight + staticWeight + (row.Source == "step04b_revised" ? 1.5 : 0.0);
                var pred = model.Forward(x[i]);
                double ex = pred[0] - tx;
                double ey = pred[1] - ty;
                double gx = 2 * w * ex / n;
                double gy = 2 * w * ey / n;
                double rowLoss = w * (ex * ex + ey * ey);
                if (spec.LossKind == "asymmetricLead")
                {
                    double futureEx = pred[0] - row.LabelDx;
                    double futureEy = pred[1] - row.LabelDy;
                    double projection = (futureEx * row.F.DirX) + (futureEy * row.F.DirY);
                    double leadWeight = spec.LeadWeight * (row.EventWindowLabel ? spec.EventLeadMultiplier : 1.0);
                    if (row.Source == "step04b_revised")
                    {
                        leadWeight *= 1.5;
                    }

                    double signedWeight = projection > 0.0 ? leadWeight : spec.LagWeight;
                    if (signedWeight > 0.0)
                    {
                        rowLoss += signedWeight * projection * projection;
                        gx += 2 * signedWeight * projection * row.F.DirX / n;
                        gy += 2 * signedWeight * projection * row.F.DirY / n;
                    }
                }

                loss += rowLoss;
                model.Backward(x[i], new[] { gx, gy });
            }
            model.AdamStep(lr, epoch);
            if (epoch == 1 || epoch % 35 == 0 || epoch == config.MaxEpochs)
            {
                trace.Add(new { epoch, loss = loss / n });
            }
        }
        return new TrainedMlp(model, norm, trace.ToArray(), new { estimatedMacs = model.EstimatedMacs, parameters = model.ParameterCount, branches = "none", inputFeatures = model.Input, hidden = model.Hidden });
    }

    static object EvaluateCandidate(List<DataRow> rows, CandidateSpec spec, Func<DataRow, double[]> predict, object[] trace, object runtimeCost)
    {
        var eval = rows.Select(r =>
        {
            var p = predict(r);
            return BuildEval(spec.Id, r, p[0], p[1]);
        }).ToList();
        var events = BuildStopEvents(eval, 6, 10).ToArray();
        return new
        {
            candidate = spec,
            rows = eval.Count,
            trainingTrace = trace,
            runtimeCost,
            overallMetrics = OverallMetrics(eval),
            bySource = eval.GroupBy(r => r.Source).ToDictionary(g => g.Key, g => SourceMetrics(g.ToList())),
            bySplit = eval.GroupBy(r => r.Split).ToDictionary(g => g.Key, g => SourceMetrics(g.ToList())),
            step04bStress = SourceMetrics(eval.Where(r => r.Source == "step04b_revised").ToList()),
            realHoldout = SourceMetrics(eval.Where(r => r.Source == "real" && r.Split == "test").ToList()),
            eventMetrics = EventMetrics(events),
            tailRows = events.OrderByDescending(e => e.PeakLeadPx).Take(12).ToArray()
        };
    }

    static IEnumerable<CandidateSpec> GenerateModelSpecs()
    {
        yield return new CandidateSpec(
            "mlp_temporal_h32_event_safe",
            "MLP",
            "temporal",
            32,
            "event-safe shifted target",
            "one hidden tanh MLP, dense temporal windows, CPU-distillable",
            "eventSafe");
        yield return new CandidateSpec(
            "mlp_temporal_h64_event_safe",
            "MLP",
            "temporal",
            64,
            "event-safe shifted target",
            "one hidden tanh MLP, larger high-accuracy search shape",
            "eventSafe");
        yield return new CandidateSpec(
            "fsmn_mlp_h32_event_safe",
            "FSMN-like",
            "fsmn",
            32,
            "event-safe shifted target",
            "engineered memory averages plus tanh MLP",
            "eventSafe");

        foreach (double lead in new[] { 2.0, 4.0, 8.0, 16.0, 32.0 })
        {
            foreach (double eventMultiplier in new[] { 1.0, 2.0, 4.0 })
            {
                foreach (double lag in new[] { 0.25, 0.5, 1.0 })
                {
                    yield return new CandidateSpec(
                        $"mlp_temporal_h32_asym_lead{Slug(lead)}_event{Slug(eventMultiplier)}_lag{Slug(lag)}",
                        "MLP",
                        "temporal",
                        32,
                        $"future-lead asymmetric loss lead={lead}, eventMultiplier={eventMultiplier}, lag={lag}",
                        "one hidden tanh MLP, asymmetric future-lead penalty, CPU-distillable",
                        "asymmetricLead",
                        lead,
                        eventMultiplier,
                        lag,
                        1.5,
                        2.0);
                }
            }
        }

        foreach (double lead in new[] { 8.0, 16.0, 32.0 })
        {
            foreach (double eventMultiplier in new[] { 2.0, 4.0 })
            {
                yield return new CandidateSpec(
                    $"fsmn_h32_asym_lead{Slug(lead)}_event{Slug(eventMultiplier)}",
                    "FSMN-like",
                    "fsmn",
                    32,
                    $"FSMN-like future-lead asymmetric loss lead={lead}, eventMultiplier={eventMultiplier}",
                    "engineered memory averages plus tanh MLP with asymmetric future-lead penalty",
                    "asymmetricLead",
                    lead,
                    eventMultiplier,
                    0.5,
                    1.5,
                    2.0);
            }
        }
    }

    static object EvaluateRuleHybrid(
        List<DataRow> rows,
        string id,
        string shape,
        double capPx = 0.0,
        double highMin = 600,
        double v2Max = 50,
        double latestMax = 0.75,
        bool useV5ForStart = false,
        double releaseV2 = 100,
        double releaseLatest = 1.25)
    {
        var spec = new CandidateSpec(id, "RuleHybrid", "runtime-state", 0, "none", shape);
        var preds = new Dictionary<DataRow, double[]>();
        foreach (var group in rows.GroupBy(r => r.SequenceId))
        {
            int latch = 0;
            foreach (var row in group.OrderBy(r => r.ElapsedMs))
            {
                double startVelocity = useV5ForStart ? row.F.V5 : row.F.V2;
                bool start = row.F.RecentHigh >= highMin && startVelocity <= v2Max && row.F.LatestDelta <= latestMax;
                bool release = row.F.V2 > releaseV2 || row.F.LatestDelta > releaseLatest;
                if (start) latch = 10;
                if (release) latch = 0;
                double dx = row.BaseDx;
                double dy = row.BaseDy;
                if (latch > 0)
                {
                    if (capPx <= 0)
                    {
                        dx = 0;
                        dy = 0;
                    }
                    else
                    {
                        double mag = Math.Sqrt(dx * dx + dy * dy);
                        if (mag > capPx && mag > 1e-9)
                        {
                            dx *= capPx / mag;
                            dy *= capPx / mag;
                        }
                    }
                    latch--;
                }
                preds[row] = new[] { dx, dy };
            }
        }
        return EvaluateCandidate(rows, spec, r => preds[r], Array.Empty<object>(), new { estimatedMacs = DistilledMlpPredictionModel.EstimatedMacs, parameters = 0, branches = "2 start branches, 2 release branches, 1 latch counter", allocationFree = true, highMin, v2Max, latestMax, releaseV2, releaseLatest, capPx, useV5ForStart });
    }

    static EvalRow BuildEval(string id, DataRow r, double dx, double dy)
    {
        double visualX = dx - r.LabelDx;
        double visualY = dy - r.LabelDy;
        double visual = Math.Sqrt(visualX * visualX + visualY * visualY);
        double futureSignedError = (visualX * r.F.DirX) + (visualY * r.F.DirY);
        double futureLead = Math.Max(0, futureSignedError);
        double futureLag = Math.Max(0, -futureSignedError);
        double dist = Math.Sqrt(dx * dx + dy * dy);
        double signed = dx * r.F.DirX + dy * r.F.DirY;
        bool fast = r.F.V12 >= 500 && r.F.TargetDistance <= 0.75;
        bool hard = r.F.V12 >= 800 && r.F.V2 <= r.F.V12 * 0.35;
        bool afterHigh = r.F.V12 >= 1500 && r.F.TargetDistance <= 0.75;
        bool one = r.F.V5 >= 500 && r.F.V2 <= 100;
        bool post = r.F.V12 >= 500 && r.F.V5 <= 250 && r.F.V2 <= 100;
        bool acute = fast || hard || afterHigh || one || post;
        bool high = r.F.V12 >= 1800;
        bool stat = r.MovementPhase == MotionLabMovementPhase.Hold || (r.F.V12 <= 100 && r.F.TargetDistance <= 0.75);
        bool normal = !acute && r.F.V12 >= 250 && r.F.V12 < 1800;
        return new EvalRow(id, r.SequenceId, r.Source, r.Family, r.Split, r.ElapsedMs, r.MovementPhase, visual, visual * visual, futureLead, futureLag, futureSignedError, dist, signed, Math.Max(0, signed), dx, dy, r.F.DirX, r.F.DirY, r.F.V2, r.F.V5, r.F.V8, r.F.V12, r.F.RecentHigh, r.F.LatestDelta, r.F.PathEfficiency, r.F.TargetDistance, fast, hard, afterHigh, one, post, normal, high, stat);
    }

    static object OverallMetrics(List<EvalRow> rows) => new
    {
        count = rows.Count,
        mae = rows.Count == 0 ? 0 : rows.Average(r => r.VisualError),
        rmse = rows.Count == 0 ? 0 : Math.Sqrt(rows.Average(r => r.VisualSqError)),
        visual = Stat(rows.Select(r => r.VisualError).ToArray()),
        futureLead = Stat(rows.Select(r => r.FutureLead).ToArray()),
        futureLag = Stat(rows.Select(r => r.FutureLag).ToArray()),
        futureSignedError = Stat(rows.Select(r => r.FutureSignedError).ToArray()),
        stationaryJitter = Stat(rows.Where(r => r.StaticHold).Select(r => r.CurrentDistance).ToArray())
    };

    static object SourceMetrics(List<EvalRow> rows)
    {
        var events = BuildStopEvents(rows, 6, 10).ToArray();
        return new
        {
            overall = OverallMetrics(rows),
            normalMove = Slice(rows.Where(r => r.NormalMove).ToList()),
            highSpeed = Slice(rows.Where(r => r.HighSpeed).ToList()),
            staticHold = Slice(rows.Where(r => r.StaticHold).ToList()),
            events = EventMetrics(events)
        };
    }

    static object Slice(List<EvalRow> rows) => new
    {
        count = rows.Count,
        visual = Stat(rows.Select(r => r.VisualError).ToArray()),
        futureLead = Stat(rows.Select(r => r.FutureLead).ToArray()),
        futureLag = Stat(rows.Select(r => r.FutureLag).ToArray()),
        currentDistance = Stat(rows.Select(r => r.CurrentDistance).ToArray()),
        overshoot = Overshoot(rows.Select(r => r.CurrentOvershoot).ToArray()),
        signedMean = rows.Count == 0 ? 0 : rows.Average(r => r.CurrentSigned)
    };

    static object EventMetrics(StopEventSummary[] events) => new
    {
        count = events.Length,
        peakLead = Stat(events.Select(e => e.PeakLeadPx).ToArray()),
        peakDistance = Stat(events.Select(e => e.PeakDistancePx).ToArray()),
        returnMotion = Stat(events.Select(e => e.ReturnMotionPx).ToArray()),
        overshootThenReturnRateGt0p5 = EventRate(events, e => e.PeakLeadPx > 0.5 && e.OvershootThenReturn),
        overshootThenReturnRateGt1 = EventRate(events, e => e.PeakLeadPx > 1.0 && e.OvershootThenReturn),
        overshootThenReturnRateGt2 = EventRate(events, e => e.PeakLeadPx > 2.0 && e.OvershootThenReturn),
        bySource = events.GroupBy(e => e.Source).ToDictionary(g => g.Key, g => g.Count()),
        byFamily = events.GroupBy(e => e.Family).ToDictionary(g => g.Key, g => g.Count())
    };

    static IEnumerable<StopEventSummary> BuildStopEvents(List<EvalRow> rows, int preFrames, int postFrames)
    {
        foreach (var group in rows.GroupBy(r => r.SequenceId))
        {
            var ordered = group.OrderBy(r => r.ElapsedMs).ToArray();
            for (int i = preFrames; i < ordered.Length - 1; i++)
            {
                var r = ordered[i];
                bool nearStop = r.V2 <= 100 && r.TargetDistance <= 0.75;
                bool prevNear = ordered[i - 1].V2 <= 100 && ordered[i - 1].TargetDistance <= 0.75;
                double preMax = ordered.Skip(Math.Max(0, i - preFrames)).Take(preFrames).Max(x => Math.Max(x.V5, x.V12));
                if (!nearStop || prevNear || preMax < 500) continue;
                var dirRow = ordered.Skip(Math.Max(0, i - preFrames)).Take(preFrames).OrderByDescending(x => x.V12).First();
                double dirX = dirRow.DirX, dirY = dirRow.DirY;
                var window = ordered.Skip(i).Take(postFrames + 1).ToArray();
                var leads = window.Select(w => w.CurrentDx * dirX + w.CurrentDy * dirY).ToArray();
                double peakLead = Math.Max(0, leads.Length == 0 ? 0 : leads.Max());
                int peakFrame = leads.Length == 0 ? 0 : Array.IndexOf(leads, leads.Max());
                double peakDistance = window.Length == 0 ? 0 : window.Max(w => w.CurrentDistance);
                double afterMin = window.Skip(peakFrame).Select(w => w.CurrentDistance).DefaultIfEmpty(peakDistance).Min();
                double ret = Math.Max(0, peakDistance - afterMin);
                bool returned = peakLead > 0.5 && window.Skip(peakFrame).Any(w => w.CurrentDistance < 1.0) && ret > 0.5;
                yield return new StopEventSummary(r.SequenceId, r.Source, r.Family, r.Split, r.ElapsedMs, PhaseName(r), SpeedBand(preMax), DecelBand(preMax, r.V2), preMax, r.V2, r.V5, r.V12, r.TargetDistance, peakLead, peakDistance, peakFrame, ret, returned);
                i += 2;
            }
        }
    }

    static double[] FeatureVector(DataRow r, string kind)
    {
        var f = r.F;
        var baseFeatures = new List<double>
        {
            f.HorizonMs / 16.67,
            f.Dx2 / 8, f.Dy2 / 8, f.V2 / 2000,
            f.Dx3 / 8, f.Dy3 / 8, f.V3 / 2000,
            f.Dx5 / 8, f.Dy5 / 8, f.V5 / 2000,
            f.Dx8 / 8, f.Dy8 / 8, f.V8 / 2000,
            f.Dx12 / 8, f.Dy12 / 8, f.V12 / 2000,
            f.RecentHigh / 3000, f.LatestDelta / 8, f.PathNet / 80, f.PathLength / 100, f.PathEfficiency,
            f.TargetDistance / 8, f.SamplerSpeed / 3000,
            f.DirX, f.DirY
        };
        if (kind == "fsmn")
        {
            baseFeatures.AddRange(new[]
            {
                (0.55 * f.Dx2 + 0.30 * f.Dx5 + 0.15 * f.Dx12) / 8,
                (0.55 * f.Dy2 + 0.30 * f.Dy5 + 0.15 * f.Dy12) / 8,
                (0.25 * f.Dx2 + 0.35 * f.Dx5 + 0.40 * f.Dx12) / 8,
                (0.25 * f.Dy2 + 0.35 * f.Dy5 + 0.40 * f.Dy12) / 8,
                SafeRatio(f.V2, f.V12),
                SafeRatio(f.V5, f.V12),
                SafeRatio(f.LatestDelta * 60.0, f.RecentHigh),
                Math.Max(0, Math.Min(1, (600 - f.V2) / 600.0)) * Math.Max(0, Math.Min(1, (f.RecentHigh - 400) / 1600.0))
            });
        }
        return baseFeatures.ToArray();
    }

    static Features RuntimeFeatures(CallPoint call, List<CallPoint> history, (double X, double Y, double Vx, double Vy, double Speed) target)
    {
        var v2 = VelocityWindow(call, history, 2);
        var v3 = VelocityWindow(call, history, 3);
        var v5 = VelocityWindow(call, history, 5);
        var v8 = VelocityWindow(call, history, 8);
        var v12 = VelocityWindow(call, history, 12);
        var path = BuildPath(call, history, 12);
        double recentSegmentMax = RecentSegmentMax(call, history, 6);
        double latestDelta = history.Count == 0 ? 0 : Dist(history[^1].X, history[^1].Y, call.X, call.Y);
        double recentHigh = Math.Max(Math.Max(v5.Speed, v8.Speed), Math.Max(v12.Speed, recentSegmentMax));
        double dirX = v12.Dx, dirY = v12.Dy, mag = Math.Sqrt(dirX * dirX + dirY * dirY);
        if (mag > 1e-6) { dirX /= mag; dirY /= mag; } else { dirX = 1; dirY = 0; }
        double horizonMs = (call.TargetTicks - call.SampleTicks) * 1000.0 / call.Frequency + CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds;
        return new Features(v2.Dx, v2.Dy, v2.Speed, v3.Dx, v3.Dy, v3.Speed, v5.Dx, v5.Dy, v5.Speed, v8.Dx, v8.Dy, v8.Speed, v12.Dx, v12.Dy, v12.Speed, recentHigh, latestDelta, dirX, dirY, path.Net, path.Path, path.Efficiency, horizonMs, Dist(call.X, call.Y, target.X, target.Y), call.Source == "real" ? 0 : target.Speed);
    }

    static (double Dx, double Dy, double Speed) VelocityWindow(CallPoint call, List<CallPoint> history, int sampleCount)
    {
        if (history.Count == 0) return (0, 0, 0);
        int back = Math.Min(sampleCount - 1, history.Count);
        var oldest = history[history.Count - back];
        double dt = (call.ElapsedMs - oldest.ElapsedMs) / 1000.0;
        if (dt <= 0) return (0, 0, 0);
        double vx = (call.X - oldest.X) / dt, vy = (call.Y - oldest.Y) / dt;
        double horizonSec = Math.Max(0, (call.TargetTicks - call.SampleTicks) / (double)call.Frequency + CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds / 1000.0);
        return (vx * horizonSec, vy * horizonSec, Math.Sqrt(vx * vx + vy * vy));
    }

    static (double Net, double Path, double Efficiency) BuildPath(CallPoint call, List<CallPoint> history, int sampleCount)
    {
        var pts = new List<(double X, double Y)>();
        int take = Math.Min(sampleCount - 1, history.Count);
        for (int i = history.Count - take; i < history.Count; i++) pts.Add((history[i].X, history[i].Y));
        pts.Add((call.X, call.Y));
        if (pts.Count < 2) return (0, 0, 0);
        double path = 0;
        for (int i = 1; i < pts.Count; i++) path += Dist(pts[i - 1].X, pts[i - 1].Y, pts[i].X, pts[i].Y);
        double net = Dist(pts[0].X, pts[0].Y, call.X, call.Y);
        return (net, path, path > 1e-6 ? net / path : 0);
    }

    static double RecentSegmentMax(CallPoint call, List<CallPoint> history, int sampleCount)
    {
        var pts = new List<CallPoint>();
        int take = Math.Min(sampleCount - 1, history.Count);
        for (int i = history.Count - take; i < history.Count; i++) pts.Add(history[i]);
        pts.Add(call);
        double max = 0;
        for (int i = 1; i < pts.Count; i++)
        {
            double dt = (pts[i].ElapsedMs - pts[i - 1].ElapsedMs) / 1000.0;
            if (dt <= 0) continue;
            max = Math.Max(max, Dist(pts[i - 1].X, pts[i - 1].Y, pts[i].X, pts[i].Y) / dt);
        }
        return max;
    }

    static DwmAwareCursorPositionPredictor ProductPredictor()
    {
        var predictor = new DwmAwareCursorPositionPredictor(100, 100, 0);
        predictor.ApplyPredictionModel(CursorMirrorSettings.DwmPredictionModelDistilledMlp);
        predictor.ApplyPredictionTargetOffsetMilliseconds(CursorMirrorSettings.RecommendedDistilledMlpPredictionTargetOffsetMilliseconds);
        predictor.ApplyDistilledMlpPostStopBrakeEnabled(true);
        return predictor;
    }

    static CursorPollSample Poll(CallPoint call) => new()
    {
        Position = new Point((int)Math.Round(call.X), (int)Math.Round(call.Y)),
        TimestampTicks = call.SampleTicks,
        StopwatchFrequency = call.Frequency,
        DwmTimingAvailable = call.DwmAvailable,
        DwmVBlankTicks = call.TargetTicks,
        DwmRefreshPeriodTicks = call.RefreshTicks
    };

    static string SyntheticSplit(string setId, string family, int scenarioIndex)
    {
        if (setId == "step04b_revised")
        {
            if (family.Contains("curved") || family.Contains("missed")) return "test";
            if (family.Contains("stale") || family.Contains("phase")) return "validation";
            return scenarioIndex % 3 == 0 ? "validation" : "train";
        }
        return scenarioIndex % 5 == 0 ? "test" : scenarioIndex % 5 == 1 ? "validation" : "train";
    }

    static (RealPackage Package, List<RefPoint> Refs, List<CallPoint> Calls) ReadRecording(RealPackage package)
    {
        using var archive = ZipFile.OpenRead(package.ZipPath);
        var entry = archive.GetEntry("trace.csv") ?? throw new FileNotFoundException("trace.csv", package.ZipPath);
        using var reader = new StreamReader(entry.Open());
        string[] header = ParseCsvLine(reader.ReadLine() ?? throw new InvalidDataException("missing header")).ToArray();
        var index = header.Select((name, i) => (name, i)).ToDictionary(p => p.name, p => p.i);
        var refs = new List<RefPoint>();
        var calls = new List<CallPoint>();
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            var fields = ParseCsvLine(line).ToList();
            string evt = Get(fields, index, "event");
            double elapsedUs = GetDouble(fields, index, "elapsedMicroseconds");
            double elapsedMs = elapsedUs / 1000.0;
            if (elapsedMs < package.WarmupMs || IsExcluded(elapsedMs, package.ExcludeMs)) continue;
            double x = GetDouble(fields, index, "cursorX", double.NaN);
            double y = GetDouble(fields, index, "cursorY", double.NaN);
            if (double.IsNaN(x) || double.IsNaN(y)) { x = GetDouble(fields, index, "x", double.NaN); y = GetDouble(fields, index, "y", double.NaN); }
            if (double.IsNaN(x) || double.IsNaN(y)) continue;
            if (evt == "referencePoll" || evt == "cursorPoll" || evt == "rawInput") refs.Add(new RefPoint(elapsedUs, x, y));
            else if (evt == "runtimeSchedulerPoll")
            {
                long sampleTicks = GetLong(fields, index, "runtimeSchedulerSampleRecordedTicks", 0); if (sampleTicks <= 0) sampleTicks = GetLong(fields, index, "stopwatchTicks", 0);
                long targetTicks = GetLong(fields, index, "predictionTargetTicks", 0); if (targetTicks <= 0) targetTicks = GetLong(fields, index, "presentReferenceTicks", 0);
                long refreshTicks = GetLong(fields, index, "dwmQpcRefreshPeriod", 0);
                long frequency = GetLong(fields, index, "stopwatchFrequency", 10000000);
                bool dwm = Get(fields, index, "dwmTimingAvailable").Equals("true", StringComparison.OrdinalIgnoreCase);
                if (sampleTicks > 0 && targetTicks > 0 && refreshTicks > 0)
                {
                    calls.Add(new CallPoint(package.PackageId, "real", package.PackageId, package.Split, 0, elapsedMs, x, y, "real", sampleTicks, targetTicks, refreshTicks, frequency, dwm));
                }
            }
        }
        refs.Sort((a, b) => a.ElapsedUs.CompareTo(b.ElapsedUs));
        calls.Sort((a, b) => a.SampleTicks.CompareTo(b.SampleTicks));
        return (package, refs, calls);
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
        var a = refs[lo]; var b = refs[Math.Min(lo + 1, refs.Count - 1)];
        double span = Math.Max(1, b.ElapsedUs - a.ElapsedUs);
        double t = Math.Clamp((elapsedUs - a.ElapsedUs) / span, 0, 1);
        double x = a.X + (b.X - a.X) * t, y = a.Y + (b.Y - a.Y) * t;
        double vx = (b.X - a.X) * 1000000.0 / span, vy = (b.Y - a.Y) * 1000000.0 / span;
        result = (x, y, vx, vy, Math.Sqrt(vx * vx + vy * vy));
        return true;
    }

    static (double X, double Y, double Vx, double Vy, double Speed) SampleWithDerivative(MotionLabSampler sampler, double elapsedMs)
    {
        var s = sampler.GetSample(elapsedMs);
        var before = sampler.GetSample(elapsedMs - 1);
        var after = sampler.GetSample(elapsedMs + 1);
        double vx = (after.X - before.X) / 0.002, vy = (after.Y - before.Y) / 0.002;
        return (s.X, s.Y, vx, vy, Math.Sqrt(vx * vx + vy * vy));
    }

    static double EffectiveElapsedUs(CallPoint call, double offsetMs) => (call.ElapsedMs * 1000.0) + ((call.TargetTicks + (offsetMs * call.Frequency / 1000.0) - call.SampleTicks) * 1000000.0 / call.Frequency);
    static double EffectiveTargetElapsedMs(CallPoint call, double offsetMs) => call.ElapsedMs + ((call.TargetTicks - call.SampleTicks) * 1000.0 / call.Frequency) + offsetMs;
    static double NextVBlankMs(double elapsedMs, double refreshMs, double phaseMs) { double n = Math.Floor((elapsedMs - phaseMs) / refreshMs) + 1; double target = n * refreshMs + phaseMs; return target <= elapsedMs + 0.001 ? target + refreshMs : target; }
    static long ToTicks(double ms) => (long)Math.Round(ms * Frequency / 1000.0);
    static bool IsExcluded(double elapsedMs, Window[] windows) => windows != null && windows.Any(w => elapsedMs >= w.StartMs && elapsedMs < w.EndMs);
    static IEnumerable<string> ParseCsvLine(string line) { var fields = new List<string>(); bool quoted = false; int start = 0; for (int i = 0; i < line.Length; i++) { if (line[i] == '"') quoted = !quoted; else if (line[i] == ',' && !quoted) { fields.Add(Unquote(line[start..i])); start = i + 1; } } fields.Add(Unquote(line[start..])); return fields; }
    static string Unquote(string value) => value.Length >= 2 && value[0] == '"' && value[^1] == '"' ? value[1..^1].Replace("\"\"", "\"") : value;
    static string Get(List<string> fields, Dictionary<string, int> index, string name) => index.TryGetValue(name, out int i) && i < fields.Count ? fields[i] : "";
    static double GetDouble(List<string> fields, Dictionary<string, int> index, string name, double fallback = 0) => double.TryParse(Get(fields, index, name), NumberStyles.Float, CultureInfo.InvariantCulture, out double v) ? v : fallback;
    static long GetLong(List<string> fields, Dictionary<string, int> index, string name, long fallback) => long.TryParse(Get(fields, index, name), NumberStyles.Integer, CultureInfo.InvariantCulture, out long v) ? v : fallback;
    static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    static double SafeRatio(double a, double b) => Math.Abs(b) <= 1e-9 ? 0 : a / b;
    static string FormatMs(double v) => v.ToString("0.###", CultureInfo.InvariantCulture).Replace("-", "m").Replace(".", "p");
    static string Slug(double value) => value.ToString("0.###", CultureInfo.InvariantCulture).Replace("-", "m").Replace(".", "p");
    static string PhaseName(EvalRow r) => r.PostStopFirstFrames ? "postStopFirstFrames" : r.OneFrameStop ? "oneFrameStop" : r.StopAfterHighSpeed ? "stopAfterHighSpeed" : r.HardBrake ? "hardBrake" : "fastThenNearZero";
    static string SpeedBand(double s) => s >= 3000 ? "veryHigh" : s >= 1800 ? "high" : s >= 800 ? "medium" : "low";
    static string DecelBand(double pre, double v2) { double ratio = pre <= 1e-6 ? 1 : v2 / pre; return ratio <= 0.05 ? "fullStop" : ratio <= 0.2 ? "hardBrake" : ratio <= 0.5 ? "mediumBrake" : "soft"; }
    static object DatasetSummary(List<DataRow> rows) => new { rows = rows.Count, bySource = rows.GroupBy(r => r.Source).ToDictionary(g => g.Key, g => g.Count()), bySplit = rows.GroupBy(r => r.Split).ToDictionary(g => g.Key, g => g.Count()), eventWindowRows = rows.Count(r => r.EventWindowLabel), staticRows = rows.Count(r => r.StaticLabel) };
    static object Stat(double[] values) { Array.Sort(values); return new { count = values.Length, mean = values.Length == 0 ? 0 : values.Average(), p50 = Percentile(values, .5), p95 = Percentile(values, .95), p99 = Percentile(values, .99), max = values.Length == 0 ? 0 : values[^1] }; }
    static object Overshoot(double[] values) => new { stats = Stat(values), gt0p5 = values.Length == 0 ? 0 : values.Count(v => v > .5) / (double)values.Length, gt1 = values.Length == 0 ? 0 : values.Count(v => v > 1) / (double)values.Length, gt2 = values.Length == 0 ? 0 : values.Count(v => v > 2) / (double)values.Length, gt4 = values.Length == 0 ? 0 : values.Count(v => v > 4) / (double)values.Length };
    static double Percentile(double[] values, double p) => values.Length == 0 ? 0 : values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)];
    static double EventRate(IEnumerable<StopEventSummary> events, Func<StopEventSummary, bool> pred) { int total = 0, hit = 0; foreach (var e in events) { total++; if (pred(e)) hit++; } return total == 0 ? 0 : hit / (double)total; }
    static object Score(dynamic r)
    {
        double stressPeak = r.step04bStress.events.peakLead.max;
        double stressOtr = r.step04bStress.events.overshootThenReturnRateGt1;
        double stressReturn = r.step04bStress.events.returnMotion.max;
        double stressFutureLead = r.step04bStress.overall.futureLead.p99;
        double normalFutureLag = r.step04bStress.normalMove.futureLag.p95;
        double realP95 = r.realHoldout.overall.visual.p95;
        double realP99 = r.realHoldout.overall.visual.p99;
        double realJitter = r.realHoldout.overall.stationaryJitter.p95;
        double total = stressPeak * 1000 + stressReturn * 500 + stressOtr * 12000 + stressFutureLead * 700 + normalFutureLag * 150 + realP95 * 80 + realP99 * 20 + realJitter * 50;
        return new { totalObjective = total, step04bPeakLeadMax = stressPeak, step04bOtrGt1 = stressOtr, step04bReturnMax = stressReturn, step04bFutureLeadP99 = stressFutureLead, step04bNormalFutureLagP95 = normalFutureLag, realHoldoutVisualP95 = realP95, realHoldoutVisualP99 = realP99, realHoldoutJitterP95 = realJitter };
    }
    static bool ClearlyImproves(dynamic best, dynamic baseline) => best.step04bStress.events.peakLead.max < baseline.step04bStress.events.peakLead.max * 0.5 && best.realHoldout.overall.visual.p95 <= baseline.realHoldout.overall.visual.p95 * 1.25;

    static void WriteWeights(string path, CandidateSpec spec, TrainedMlp trained)
    {
        var payload = new { schemaVersion = "cursor-prediction-v20-step01-asymmetric-loss-compact-mlp/1", spec, normalization = trained.Normalizer, weights = trained.Model.Export(), runtime = trained.RuntimeCost };
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }));
    }
}

sealed class Normalizer
{
    public double[] Mean { get; set; }
    public double[] Std { get; set; }
    public static Normalizer Fit(double[][] x)
    {
        int d = x[0].Length;
        var mean = new double[d];
        var std = new double[d];
        for (int j = 0; j < d; j++)
        {
            mean[j] = x.Average(r => r[j]);
            std[j] = Math.Max(0.05, Math.Sqrt(x.Average(r => (r[j] - mean[j]) * (r[j] - mean[j]))));
        }
        return new Normalizer { Mean = mean, Std = std };
    }
    public double[] Transform(double[] x)
    {
        var y = new double[x.Length];
        for (int i = 0; i < x.Length; i++) y[i] = (x[i] - Mean[i]) / Std[i];
        return y;
    }
}

sealed record TrainedMlp(MlpModel Model, Normalizer Normalizer, object[] TrainingTrace, object RuntimeCost);

sealed class MlpModel
{
    public readonly int Input;
    public readonly int Hidden;
    readonly double[,] w1, mw1, vw1, gw1;
    readonly double[] b1, mb1, vb1, gb1;
    readonly double[,] w2, mw2, vw2, gw2;
    readonly double[] b2, mb2, vb2, gb2;
    double[] lastH;
    public int EstimatedMacs => (Input * Hidden) + (Hidden * 2);
    public int ParameterCount => (Input * Hidden) + Hidden + (Hidden * 2) + 2;

    public MlpModel(int input, int hidden, Random random)
    {
        Input = input; Hidden = hidden;
        w1 = new double[hidden, input]; mw1 = new double[hidden, input]; vw1 = new double[hidden, input]; gw1 = new double[hidden, input];
        b1 = new double[hidden]; mb1 = new double[hidden]; vb1 = new double[hidden]; gb1 = new double[hidden];
        w2 = new double[2, hidden]; mw2 = new double[2, hidden]; vw2 = new double[2, hidden]; gw2 = new double[2, hidden];
        b2 = new double[2]; mb2 = new double[2]; vb2 = new double[2]; gb2 = new double[2];
        double s1 = 1.0 / Math.Sqrt(input);
        for (int h = 0; h < hidden; h++) for (int i = 0; i < input; i++) w1[h, i] = (random.NextDouble() * 2 - 1) * s1;
        double s2 = 1.0 / Math.Sqrt(hidden);
        for (int o = 0; o < 2; o++) for (int h = 0; h < hidden; h++) w2[o, h] = (random.NextDouble() * 2 - 1) * s2;
    }
    public double[] Forward(double[] x)
    {
        lastH = new double[Hidden];
        for (int h = 0; h < Hidden; h++)
        {
            double z = b1[h];
            for (int i = 0; i < Input; i++) z += w1[h, i] * x[i];
            lastH[h] = Math.Tanh(z);
        }
        var y = new double[2];
        for (int o = 0; o < 2; o++)
        {
            double z = b2[o];
            for (int h = 0; h < Hidden; h++) z += w2[o, h] * lastH[h];
            y[o] = z;
        }
        return y;
    }
    public double[] Predict(double[] x) => Forward(x);
    public void ZeroGrad() { Array.Clear(gw1); Array.Clear(gb1); Array.Clear(gw2); Array.Clear(gb2); }
    public void Backward(double[] x, double[] gy)
    {
        var gh = new double[Hidden];
        for (int o = 0; o < 2; o++)
        {
            gb2[o] += gy[o];
            for (int h = 0; h < Hidden; h++) { gw2[o, h] += gy[o] * lastH[h]; gh[h] += gy[o] * w2[o, h]; }
        }
        for (int h = 0; h < Hidden; h++)
        {
            double gz = gh[h] * (1 - lastH[h] * lastH[h]);
            gb1[h] += gz;
            for (int i = 0; i < Input; i++) gw1[h, i] += gz * x[i];
        }
    }
    public void AdamStep(double lr, int t)
    {
        const double b1c = 0.9, b2c = 0.999, eps = 1e-8;
        double bc1 = 1 - Math.Pow(b1c, t), bc2 = 1 - Math.Pow(b2c, t);
        Step2D(w1, gw1, mw1, vw1, lr, b1c, b2c, eps, bc1, bc2);
        Step1D(b1, gb1, mb1, vb1, lr, b1c, b2c, eps, bc1, bc2);
        Step2D(w2, gw2, mw2, vw2, lr, b1c, b2c, eps, bc1, bc2);
        Step1D(b2, gb2, mb2, vb2, lr, b1c, b2c, eps, bc1, bc2);
    }
    static void Step2D(double[,] p, double[,] g, double[,] m, double[,] v, double lr, double b1, double b2, double eps, double bc1, double bc2)
    {
        for (int i = 0; i < p.GetLength(0); i++) for (int j = 0; j < p.GetLength(1); j++)
        {
            m[i, j] = b1 * m[i, j] + (1 - b1) * g[i, j];
            v[i, j] = b2 * v[i, j] + (1 - b2) * g[i, j] * g[i, j];
            p[i, j] -= lr * (m[i, j] / bc1) / (Math.Sqrt(v[i, j] / bc2) + eps);
        }
    }
    static void Step1D(double[] p, double[] g, double[] m, double[] v, double lr, double b1, double b2, double eps, double bc1, double bc2)
    {
        for (int i = 0; i < p.Length; i++)
        {
            m[i] = b1 * m[i] + (1 - b1) * g[i];
            v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
            p[i] -= lr * (m[i] / bc1) / (Math.Sqrt(v[i] / bc2) + eps);
        }
    }
    public object Export() => new { input = Input, hidden = Hidden, activation = "tanh", w1 = ToJagged(w1), b1, w2 = ToJagged(w2), b2 };
    static double[][] ToJagged(double[,] a)
    {
        var rows = new double[a.GetLength(0)][];
        for (int i = 0; i < rows.Length; i++) { rows[i] = new double[a.GetLength(1)]; for (int j = 0; j < rows[i].Length; j++) rows[i][j] = Math.Round(a[i, j], 8); }
        return rows;
    }
}
