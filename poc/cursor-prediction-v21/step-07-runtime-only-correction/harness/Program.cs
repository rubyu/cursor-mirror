using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using CursorMirror;

record Config(
    string RepoRoot,
    string ManifestPath,
    string MetricPolicyPath,
    string ScoresPath,
    double WarmupMilliseconds,
    int[] Seeds,
    int TrainSampleCap,
    int MaxEpochs,
    double LearningRate,
    double FutureLagEpsilon,
    int GeneratedModelSeed,
    string GeneratedModelPath);

record SplitManifest(string SchemaVersion, string GeneratedAtUtc, PackageSpec[] Packages);
record PackageSpec(
    string PackageId,
    string Path,
    string Split,
    string QualityBucket,
    string DurationBucket,
    int ScenarioDurationMilliseconds,
    int ScenarioCount,
    long MotionRows,
    long AlignmentRows);

record TraceRow(
    long Sequence,
    string Event,
    double ElapsedUs,
    double X,
    double Y,
    long SampleTicks,
    long TargetTicks,
    long RefreshTicks,
    long Frequency,
    bool DwmAvailable);

record RefPoint(double ElapsedUs, double X, double Y);
record CallPoint(double ElapsedMs, double X, double Y, long SampleTicks, long TargetTicks, long RefreshTicks, long Frequency, bool DwmAvailable);
record Features(double Dx2, double Dy2, double V2, double Dx3, double Dy3, double V3, double Dx5, double Dy5, double V5, double Dx8, double Dy8, double V8, double Dx12, double Dy12, double V12, double RecentHigh, double LatestDelta, double DirX, double DirY, double PathNet, double PathLength, double PathEfficiency, double HorizonMs, double RuntimeTargetDisplacementEstimate, double RuntimeSpeedEstimate);
record DataRow(
    string PackageId,
    string Split,
    string QualityBucket,
    string DurationBucket,
    int ScenarioIndex,
    string ScenarioKey,
    long TraceSequence,
    double TraceElapsedMs,
    double ScenarioElapsedMs,
    double GeneratedX,
    double GeneratedY,
    string MovementPhase,
    int HoldIndex,
    double PhaseElapsedMs,
    double GeneratedVelocity,
    Features F,
    double FutureTargetDistance,
    double LabelDx,
    double LabelDy,
    bool EventWindowLabel,
    bool StaticLabel,
    double BaseDx,
    double BaseDy);

record CandidateSpec(
    string Id,
    string Family,
    string FeatureKind,
    int Hidden,
    string TrainingTarget,
    string RuntimeShape,
    string LossKind = "none",
    double LeadWeight = 0,
    double EventLeadMultiplier = 1,
    double LagWeight = 1,
    double EventWeight = 12,
    double StaticWeight = 2.5,
    double PeakLeadCap = 0.35,
    double PeakLeadHingeWeight = 0,
    double ReturnMotionWeight = 0,
    double LagGuardWeight = 0,
    double LagGuardPx = 0.75,
    double JitterWeight = 0,
    double StopCapPx = 0.5);

record EvalRow(
    string CandidateId,
    string PackageId,
    string Split,
    string QualityBucket,
    string DurationBucket,
    int ScenarioIndex,
    string ScenarioKey,
    double ElapsedMs,
    string MovementPhase,
    double VisualError,
    double VisualSqError,
    double FutureLead,
    double FutureLag,
    double CurrentDistance,
    double CurrentDx,
    double CurrentDy,
    double DirX,
    double DirY,
    double V2,
    double V5,
    double V8,
    double V12,
    double RecentHigh,
    double LatestDelta,
    double FutureTargetDistance,
    double RuntimeTargetDisplacementEstimate,
    bool NormalMove,
    bool HighSpeed,
    bool StaticHold);

record StopEventSummary(
    string ScenarioKey,
    string PackageId,
    string Split,
    string QualityBucket,
    string DurationBucket,
    int ScenarioIndex,
    double StopElapsedMs,
    double PreMaxSpeed,
    double PeakLeadPx,
    double ReturnMotionPx,
    bool OvershootThenReturn);

record CandidateRun(
    int Seed,
    string Id,
    double Objective,
    Dictionary<string, double> Metrics,
    Dictionary<string, bool> BeatsProductStrict,
    bool FutureLagWithinLegacyEpsilon,
    bool PassesLegacyStep05IntegrationGate,
    object DeploymentGate,
    object FutureLagDiagnostics,
    JsonElement TrainingTrace,
    JsonElement RuntimeCost);

static class Program
{
    const long DefaultFrequency = 10_000_000L;
    const double ProductOffsetMs = -4.0;
    static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, WriteIndented = true };
    static readonly string[] DimensionIds =
    {
        "normal.visual.p95",
        "normal.visual.p99",
        "futureLead.p99",
        "futureLag.p95",
        "peakLead.max",
        "peakLead.p99",
        "returnMotion.max",
        "returnMotion.p99",
        "otr.gt1px.rate",
        "stationaryJitter.p95"
    };
    static readonly Dictionary<string, double> DimensionWeights = new()
    {
        ["normal.visual.p95"] = 90,
        ["normal.visual.p99"] = 45,
        ["futureLead.p99"] = 700,
        ["futureLag.p95"] = 150,
        ["peakLead.max"] = 1000,
        ["peakLead.p99"] = 450,
        ["returnMotion.max"] = 500,
        ["returnMotion.p99"] = 250,
        ["otr.gt1px.rate"] = 12000,
        ["stationaryJitter.p95"] = 50
    };
    static readonly Dictionary<string, double> AggregateWeights = new()
    {
        ["rowWeighted"] = 0.1,
        ["scenarioBalanced"] = 0.3,
        ["fileBalanced"] = 0.2,
        ["durationBucketBalanced"] = 0.2,
        ["qualityBucketBalanced"] = 0.2
    };

    static int Main(string[] args)
    {
        var sw = Stopwatch.StartNew();
        var config = args.Length == 1
            ? JsonSerializer.Deserialize<Config>(File.ReadAllText(args[0]), JsonOptions)!
            : DefaultConfig();
        var manifest = JsonSerializer.Deserialize<SplitManifest>(File.ReadAllText(Abs(config.RepoRoot, config.ManifestPath)), JsonOptions)!;

        var rows = BuildRows(config, manifest).ToList();
        MarkEventWindows(rows);

        var product = EvaluateCandidate(
            rows,
            new CandidateSpec("product_distilled_lag0_offset_minus4_brake", "Product", "baseline", 0, "none", "current product DistilledMLP lag0 offset -4ms with post-stop brake"),
            r => new[] { r.BaseDx, r.BaseDy },
            Array.Empty<object>(),
            new { estimatedMacs = DistilledMlpPredictionModel.EstimatedMacs, parameters = 0, source = "linked current product predictor" });
        var productDoc = JsonSerializer.SerializeToElement(product, JsonOptions);
        var productMetrics = GateMetrics(productDoc);
        var productDeploymentMetrics = DeploymentMetrics(productDoc);

        var trainAll = rows.Where(r => r.Split == "train").ToArray();
        var candidateRuns = new List<CandidateRun>();
        var trainSummaries = new List<object>();
        var eventSafeSpec = GenerateModelSpecs().Single();
        foreach (int seed in config.Seeds)
        {
            var trainRows = SampleTrainRows(trainAll, config.TrainSampleCap, seed);
            trainSummaries.Add(new
            {
                seed,
                trainRowsBeforeCap = trainAll.Length,
                trainSampleCap = config.TrainSampleCap,
                trainRowsUsed = trainRows.Length,
                stratification = TrainStrataSummary(trainRows)
            });
            var model = TrainMlp(eventSafeSpec, trainRows, config, seed);
            if (seed == config.GeneratedModelSeed && !string.IsNullOrWhiteSpace(config.GeneratedModelPath))
            {
                WriteRuntimeEventSafeGeneratedModel(
                    Abs(config.RepoRoot, config.GeneratedModelPath),
                    model,
                    seed);
            }

            AddRun(candidateRuns, seed, productMetrics, productDeploymentMetrics, config.FutureLagEpsilon, EvaluateCandidate(
                rows,
                eventSafeSpec,
                r => model.Model.Predict(model.Normalizer.Transform(FeatureVector(r, eventSafeSpec.FeatureKind))),
                model.TrainingTrace,
                model.RuntimeCost));

            foreach (var guarded in GuardedSpecs())
            {
                AddRun(candidateRuns, seed, productMetrics, productDeploymentMetrics, config.FutureLagEpsilon, EvaluateGuardedModel(
                    rows,
                    guarded.Spec,
                    model,
                    stopBlend: guarded.StopBlend,
                    normalGain: guarded.NormalGain,
                    productBlend: guarded.ProductBlend));
            }

            Console.WriteLine($"seed={seed} trainUsed={trainRows.Length} elapsedMs={sw.Elapsed.TotalMilliseconds:0}");
        }

        var ranking = candidateRuns
            .GroupBy(r => r.Id)
            .Select(g => new
            {
                id = g.Key,
                seedCount = g.Count(),
                objectiveMean = g.Average(r => r.Objective),
                objectiveWorst = g.Max(r => r.Objective),
                legacyPassCount = g.Count(r => r.PassesLegacyStep05IntegrationGate)
            })
            .OrderBy(x => x.objectiveMean)
            .ToArray();

        var output = new
        {
            schemaVersion = "cursor-prediction-v21-step-07-runtime-only-correction/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            environment = new
            {
                runtime = ".NET " + Environment.Version,
                execution = "CPU-only serialized multi-seed training/evaluation",
                elapsedMilliseconds = sw.Elapsed.TotalMilliseconds
            },
            inputs = new
            {
                manifest = config.ManifestPath,
                metricPolicy = config.MetricPolicyPath,
                warmupMilliseconds = config.WarmupMilliseconds,
                fixed12000msScenarioWindowAssumption = false,
                packageSourceOfTruth = "split-manifest.json packages array",
                zipEntriesRead = new[] { "trace.csv", "motion-trace-alignment.csv" },
                referenceTargetSource = "trace.csv referencePoll/cursorPoll/rawInput rows",
                rowSource = "motion-trace-alignment.csv rows joined to trace.csv by traceSequence",
                runtimeOnlyCorrection = new
                {
                    featureVector = "replaced future/reference target distance / 8 with runtimeTargetDisplacementEstimate / 8; replaced future/reference target speed / 3000 with runtime v2 speed / 3000",
                    runtimeTargetDisplacementEstimate = "max(0, horizonMs / 1000) * v2 speed from current/past samples",
                    runtimeGuard = "does not read EventWindowLabel, StaticLabel, MovementPhase, generated velocity/phase, or future target distance"
                }
            },
            training = new
            {
                seeds = config.Seeds,
                trainRowsBeforeCap = trainAll.Length,
                trainSampleCap = config.TrainSampleCap,
                capBehavior = trainAll.Length <= config.TrainSampleCap ? "full train split used for every seed" : "deterministic stratified cap used",
                maxEpochs = config.MaxEpochs,
                learningRate = config.LearningRate,
                futureLagRegressionEpsilonPx = config.FutureLagEpsilon,
                specs = GenerateModelSpecs().ToArray(),
                perSeed = trainSummaries
            },
            datasetSummary = DatasetSummary(rows, manifest),
            productBaseline = new
            {
                metrics = productMetrics,
                deploymentMetrics = productDeploymentMetrics,
                objective = productDoc.GetProperty("objective").GetProperty("total").GetDouble(),
                futureLagDiagnostics = FutureLagDiagnostics(productDoc)
            },
            perSeed = candidateRuns,
            seedSummary = BuildSeedSummary(candidateRuns),
            ranking,
            conclusionHints = new
            {
                best = ranking.FirstOrDefault(),
                productMetrics,
                deploymentGate = "Held-out test normal visual p95/p99 must not regress; held-out test normal-moving futureLag p95 must be within 0.05 px or 5% relative of product and p99 within 0.10 px or 5% relative; robustness peakLead/OTR/returnMotion, futureLead p99, and held-out stationary jitter must not regress."
            }
        };

        Directory.CreateDirectory(Path.GetDirectoryName(Abs(config.RepoRoot, config.ScoresPath))!);
        File.WriteAllText(Abs(config.RepoRoot, config.ScoresPath), JsonSerializer.Serialize(output, JsonOptions));
        Console.WriteLine($"rows={rows.Count} seeds={config.Seeds.Length} runs={candidateRuns.Count} elapsedMs={sw.Elapsed.TotalMilliseconds:0}");
        return 0;
    }

    static Config DefaultConfig() => new(
        RepoRoot: FindRepoRoot(),
        ManifestPath: "poc/cursor-prediction-v21/step-02-balanced-evaluation/split-manifest.json",
        MetricPolicyPath: "poc/cursor-prediction-v21/step-02-balanced-evaluation/metric-policy.json",
        ScoresPath: "poc/cursor-prediction-v21/step-07-runtime-only-correction/scores.json",
        WarmupMilliseconds: 1500,
        Seeds: new[] { 2105, 2205, 2305 },
        TrainSampleCap: 120000,
        MaxEpochs: 60,
        LearningRate: 0.003,
        FutureLagEpsilon: 0.005,
        GeneratedModelSeed: 2205,
        GeneratedModelPath: "poc/cursor-prediction-v21/step-07-runtime-only-correction/runtime-event-safe-model.g.cs");

    static IEnumerable<DataRow> BuildRows(Config config, SplitManifest manifest)
    {
        foreach (var package in manifest.Packages)
        {
            string zipPath = Abs(config.RepoRoot, package.Path);
            using var archive = ZipFile.OpenRead(zipPath);
            var trace = ReadTrace(archive, package);
            var refs = trace.Values
                .Where(r => r.Event is "referencePoll" or "cursorPoll" or "rawInput")
                .OrderBy(r => r.ElapsedUs)
                .Select(r => new RefPoint(r.ElapsedUs, r.X, r.Y))
                .ToList();
            var predictor = ProductPredictor();
            var counters = new CursorPredictionCounters();
            var histories = new Dictionary<string, List<CallPoint>>();

            var alignmentEntry = archive.GetEntry("motion-trace-alignment.csv") ?? throw new FileNotFoundException("motion-trace-alignment.csv", zipPath);
            using var reader = new StreamReader(alignmentEntry.Open());
            var header = (reader.ReadLine() ?? throw new InvalidDataException("missing alignment header")).Split(',');
            var index = HeaderIndex(header);
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                var fields = line.Split(',');
                if (Get(fields, index, "traceEvent") != "runtimeSchedulerPoll") continue;
                double scenarioElapsedMs = GetDouble(fields, index, "scenarioElapsedMilliseconds");
                if (scenarioElapsedMs < config.WarmupMilliseconds) continue;
                long traceSequence = GetLong(fields, index, "traceSequence", -1);
                if (!trace.TryGetValue(traceSequence, out var t)) continue;
                if (t.TargetTicks <= 0 || t.SampleTicks <= 0 || t.RefreshTicks <= 0) continue;
                double targetElapsedUs = EffectiveElapsedUs(t.ElapsedUs / 1000.0, t.SampleTicks, t.TargetTicks, t.Frequency, ProductOffsetMs);
                if (!TryInterpolate(refs, targetElapsedUs, out var target)) continue;

                var call = new CallPoint(t.ElapsedUs / 1000.0, t.X, t.Y, t.SampleTicks, t.TargetTicks, t.RefreshTicks, t.Frequency, t.DwmAvailable);
                var predicted = predictor.Predict(Poll(call), counters, call.TargetTicks, call.RefreshTicks);
                int scenarioIndex = (int)GetDouble(fields, index, "scenarioIndex");
                string scenarioKey = package.PackageId + "#" + scenarioIndex.ToString(CultureInfo.InvariantCulture);
                if (!histories.TryGetValue(scenarioKey, out var history))
                {
                    history = new List<CallPoint>();
                    histories[scenarioKey] = history;
                }
                var f = RuntimeFeatures(call, history);
                double futureTargetDistance = Dist(t.X, t.Y, target.X, target.Y);
                yield return new DataRow(
                    package.PackageId,
                    package.Split,
                    package.QualityBucket,
                    package.DurationBucket,
                    scenarioIndex,
                    scenarioKey,
                    traceSequence,
                    t.ElapsedUs / 1000.0,
                    scenarioElapsedMs,
                    GetDouble(fields, index, "generatedX"),
                    GetDouble(fields, index, "generatedY"),
                    Get(fields, index, "movementPhase"),
                    (int)GetDouble(fields, index, "holdIndex"),
                    GetDouble(fields, index, "phaseElapsedMilliseconds"),
                    GetDouble(fields, index, "velocityPixelsPerSecond"),
                    f,
                    futureTargetDistance,
                    target.X - t.X,
                    target.Y - t.Y,
                    false,
                    false,
                    predicted.X - t.X,
                    predicted.Y - t.Y);
                history.Add(call);
                if (history.Count > 12) history.RemoveAt(0);
            }
        }
    }

    static Dictionary<long, TraceRow> ReadTrace(ZipArchive archive, PackageSpec package)
    {
        var entry = archive.GetEntry("trace.csv") ?? throw new FileNotFoundException("trace.csv", package.Path);
        using var reader = new StreamReader(entry.Open());
        var header = (reader.ReadLine() ?? throw new InvalidDataException("missing trace header")).Split(',');
        var index = HeaderIndex(header);
        var rows = new Dictionary<long, TraceRow>(capacity: Math.Max(1024, (int)Math.Min(int.MaxValue, package.AlignmentRows / 2)));
        string line;
        while ((line = reader.ReadLine()) != null)
        {
            var fields = line.Split(',');
            long sequence = GetLong(fields, index, "sequence", -1);
            if (sequence < 0) continue;
            string evt = Get(fields, index, "event");
            double x = GetDouble(fields, index, "cursorX", double.NaN);
            double y = GetDouble(fields, index, "cursorY", double.NaN);
            if (double.IsNaN(x) || double.IsNaN(y))
            {
                x = GetDouble(fields, index, "x", double.NaN);
                y = GetDouble(fields, index, "y", double.NaN);
            }
            if (double.IsNaN(x) || double.IsNaN(y)) continue;
            long sampleTicks = GetLong(fields, index, "runtimeSchedulerSampleRecordedTicks", 0);
            if (sampleTicks <= 0) sampleTicks = GetLong(fields, index, "stopwatchTicks", 0);
            long targetTicks = GetLong(fields, index, "predictionTargetTicks", 0);
            if (targetTicks <= 0) targetTicks = GetLong(fields, index, "presentReferenceTicks", 0);
            long refreshTicks = GetLong(fields, index, "dwmQpcRefreshPeriod", 0);
            long frequency = GetLong(fields, index, "stopwatchFrequency", DefaultFrequency);
            bool dwm = Get(fields, index, "dwmTimingAvailable").Equals("true", StringComparison.OrdinalIgnoreCase);
            rows[sequence] = new TraceRow(sequence, evt, GetDouble(fields, index, "elapsedMicroseconds"), x, y, sampleTicks, targetTicks, refreshTicks, frequency, dwm);
        }
        return rows;
    }

    static void MarkEventWindows(List<DataRow> rows)
    {
        var position = new Dictionary<DataRow, int>();
        for (int i = 0; i < rows.Count; i++) position[rows[i]] = i;
        foreach (var group in rows.GroupBy(r => r.ScenarioKey))
        {
            var ordered = group.OrderBy(r => r.ScenarioElapsedMs).ToArray();
            var marks = new bool[ordered.Length];
            for (int i = 6; i < ordered.Length - 1; i++)
            {
                bool nearStop = ordered[i].F.V2 <= 100 && ordered[i].FutureTargetDistance <= 0.75;
                bool prevNear = ordered[i - 1].F.V2 <= 100 && ordered[i - 1].FutureTargetDistance <= 0.75;
                double preMax = ordered.Skip(Math.Max(0, i - 6)).Take(6).Max(r => Math.Max(r.F.V5, r.F.V12));
                if (nearStop && !prevNear && preMax >= 500)
                {
                    for (int j = i; j < Math.Min(ordered.Length, i + 11); j++) marks[j] = true;
                }
            }
            for (int i = 0; i < ordered.Length; i++)
            {
                bool stat = IsHold(ordered[i]) || (ordered[i].F.V12 <= 100 && ordered[i].FutureTargetDistance <= 0.75);
                if (!marks[i] && !stat) continue;
                int idx = position[ordered[i]];
                rows[idx] = ordered[i] with { EventWindowLabel = marks[i], StaticLabel = stat };
            }
        }
    }

    static DataRow[] SampleTrainRows(DataRow[] trainRows, int cap, int seed)
    {
        if (trainRows.Length <= cap) return trainRows;

        var normal = trainRows.Where(IsNormalMoving).ToArray();
        var events = trainRows.Where(r => r.EventWindowLabel || IsLabelStopSafetyRow(r)).ToArray();
        var statics = trainRows.Where(r => r.StaticLabel && !(r.EventWindowLabel || IsLabelStopSafetyRow(r))).ToArray();
        var other = trainRows.Except(normal).Except(events).Except(statics).ToArray();
        int normalTarget = Math.Min(normal.Length, (int)Math.Round(cap * 0.45));
        int eventTarget = Math.Min(events.Length, Math.Max(1, (int)Math.Round(cap * 0.25)));
        int staticTarget = Math.Min(statics.Length, (int)Math.Round(cap * 0.20));
        int used = normalTarget + eventTarget + staticTarget;
        int otherTarget = Math.Max(0, cap - used);
        var selected = new List<DataRow>(cap);
        selected.AddRange(SampleStratum(normal, normalTarget, seed, 1));
        selected.AddRange(SampleStratum(events, eventTarget, seed, 2));
        selected.AddRange(SampleStratum(statics, staticTarget, seed, 3));
        selected.AddRange(SampleStratum(other, otherTarget, seed, 4));
        if (selected.Count < cap)
        {
            var seen = selected.ToHashSet();
            selected.AddRange(SampleStratum(trainRows.Where(r => !seen.Contains(r)).ToArray(), cap - selected.Count, seed, 5));
        }
        return selected.ToArray();
    }

    static DataRow[] SampleStratum(DataRow[] rows, int take, int seed, int salt)
    {
        if (take <= 0 || rows.Length == 0) return Array.Empty<DataRow>();
        return rows
            .Select((row, i) => (row, key: StableRandom(seed + salt * 1009, row.PackageId, row.ScenarioIndex, i)))
            .OrderBy(x => x.key)
            .Take(Math.Min(take, rows.Length))
            .Select(x => x.row)
            .ToArray();
    }

    static object TrainStrataSummary(DataRow[] rows) => new
    {
        normalMoving = rows.Count(IsNormalMoving),
        eventOrStopSafety = rows.Count(r => r.EventWindowLabel || IsLabelStopSafetyRow(r)),
        staticRows = rows.Count(r => r.StaticLabel),
        other = rows.Count(r => !IsNormalMoving(r) && !(r.EventWindowLabel || IsLabelStopSafetyRow(r)) && !r.StaticLabel)
    };

    static IEnumerable<CandidateSpec> GenerateModelSpecs()
    {
        yield return new CandidateSpec(
            "mlp_h32_event_safe_runtime_features_fulltrain",
            "MLP",
            "temporal",
            32,
            "event-safe target; post-stop and stationary labels pull to zero displacement; runtime-only feature vector; full train split multi-seed validation",
            "one hidden tanh MLP, hidden=32, runtime-only temporal features, CPU multi-seed focused validation",
            "eventSafe");
    }

    static TrainedMlp TrainMlp(CandidateSpec spec, DataRow[] trainRows, Config config, int seed)
    {
        var xRaw = trainRows.Select(r => FeatureVector(r, spec.FeatureKind)).ToArray();
        var norm = Normalizer.Fit(xRaw);
        var x = xRaw.Select(norm.Transform).ToArray();
        var model = new MlpModel(x[0].Length, spec.Hidden, new Random(seed + spec.Id.Length));
        var trace = new List<object>();
        int n = x.Length;
        for (int epoch = 1; epoch <= config.MaxEpochs; epoch++)
        {
            model.ZeroGrad();
            double loss = 0;
            for (int i = 0; i < n; i++)
            {
                var row = trainRows[i];
                bool stopSafety = IsLabelStopSafetyRow(row);
                bool safe = UsesSafetyTarget(spec.LossKind) && (row.EventWindowLabel || row.StaticLabel || stopSafety);
                double tx = safe ? 0 : row.LabelDx;
                double ty = safe ? 0 : row.LabelDy;
                double w = 1.0 + (row.EventWindowLabel ? spec.EventWeight : 0.0) + (row.StaticLabel ? spec.StaticWeight : 0.0);
                var pred = model.Forward(x[i]);
                double ex = pred[0] - tx;
                double ey = pred[1] - ty;
                double gx = 2 * w * ex / n;
                double gy = 2 * w * ey / n;
                double rowLoss = w * (ex * ex + ey * ey);
                if (spec.LossKind == "asymmetricLead")
                {
                    double projection = ((pred[0] - row.LabelDx) * row.F.DirX) + ((pred[1] - row.LabelDy) * row.F.DirY);
                    double signedWeight = projection > 0 ? spec.LeadWeight * (row.EventWindowLabel ? spec.EventLeadMultiplier : 1.0) : spec.LagWeight;
                    rowLoss += signedWeight * projection * projection;
                    gx += 2 * signedWeight * projection * row.F.DirX / n;
                    gy += 2 * signedWeight * projection * row.F.DirY / n;
                }
                if (spec.LossKind is "eventPeakLeadHinge" or "eventReturnMotionProxy" or "asymLagGuardJitter" or "stopSafetyTarget")
                {
                    double signedFuture = ((pred[0] - row.LabelDx) * row.F.DirX) + ((pred[1] - row.LabelDy) * row.F.DirY);
                    if ((row.EventWindowLabel || stopSafety) && spec.PeakLeadHingeWeight > 0)
                    {
                        double leadExcess = Math.Max(0, signedFuture - spec.PeakLeadCap);
                        double penalty = spec.PeakLeadHingeWeight * leadExcess * leadExcess;
                        rowLoss += penalty;
                        gx += 2 * spec.PeakLeadHingeWeight * leadExcess * row.F.DirX / n;
                        gy += 2 * spec.PeakLeadHingeWeight * leadExcess * row.F.DirY / n;
                    }
                    if (IsNormalMoving(row) && spec.LagGuardWeight > 0)
                    {
                        double lagExcess = Math.Max(0, -signedFuture - spec.LagGuardPx);
                        rowLoss += spec.LagGuardWeight * lagExcess * lagExcess;
                        gx -= 2 * spec.LagGuardWeight * lagExcess * row.F.DirX / n;
                        gy -= 2 * spec.LagGuardWeight * lagExcess * row.F.DirY / n;
                    }
                    double mag = Math.Sqrt(pred[0] * pred[0] + pred[1] * pred[1]);
                    if ((row.EventWindowLabel || stopSafety) && spec.ReturnMotionWeight > 0)
                    {
                        double excess = Math.Max(0, mag - spec.StopCapPx);
                        rowLoss += spec.ReturnMotionWeight * excess * excess;
                        if (mag > 1e-9)
                        {
                            gx += 2 * spec.ReturnMotionWeight * excess * pred[0] / mag / n;
                            gy += 2 * spec.ReturnMotionWeight * excess * pred[1] / mag / n;
                        }
                    }
                    if (row.StaticLabel && spec.JitterWeight > 0)
                    {
                        rowLoss += spec.JitterWeight * mag * mag;
                        gx += 2 * spec.JitterWeight * pred[0] / n;
                        gy += 2 * spec.JitterWeight * pred[1] / n;
                    }
                }
                loss += rowLoss;
                model.Backward(x[i], new[] { gx, gy });
            }
            model.AdamStep(config.LearningRate, epoch);
            if (epoch == 1 || epoch % 20 == 0 || epoch == config.MaxEpochs)
            {
                trace.Add(new { epoch, loss = loss / n });
            }
        }
        return new TrainedMlp(model, norm, trace.ToArray(), new { estimatedMacs = model.EstimatedMacs, parameters = model.ParameterCount, inputFeatures = model.Input, hidden = model.Hidden, allocationFreeAtRuntime = false });
    }

    static object EvaluateCandidate(List<DataRow> rows, CandidateSpec spec, Func<DataRow, double[]> predict, object[] trace, object runtimeCost)
    {
        var eval = rows.Select(r =>
        {
            var p = predict(r);
            return BuildEval(spec.Id, r, p[0], p[1]);
        }).ToList();
        var events = BuildStopEvents(eval).ToArray();
        return new
        {
            candidate = spec,
            rows = eval.Count,
            trainingTrace = trace,
            runtimeCost,
            objective = Objective(eval, events),
            aggregates = BuildMetricTable(eval, events),
            bySplit = eval.GroupBy(r => r.Split).ToDictionary(g => g.Key, g =>
            {
                var list = g.ToList();
                var keys = list.Select(r => r.ScenarioKey).ToHashSet();
                return BuildMetricTable(list, events.Where(e => keys.Contains(e.ScenarioKey)).ToArray());
            }),
            byQualityBucket = eval.GroupBy(r => r.QualityBucket).ToDictionary(g => g.Key, g => RowSummary(g.ToList())),
            byDurationBucket = eval.GroupBy(r => r.DurationBucket).ToDictionary(g => g.Key, g => RowSummary(g.ToList())),
            sliceAnalysis = SliceAnalysis(eval, events),
            stopEvents = EventMetrics(events),
            worstStopEvents = events.OrderByDescending(e => e.PeakLeadPx).Take(10).ToArray()
        };
    }

    static object EvaluateRuleHybrid(List<DataRow> rows, string id, string shape, double capPx = 0.0, double highMin = 600, double v2Max = 50, double latestMax = 0.75, bool useV5ForStart = false, double releaseV2 = 100, double releaseLatest = 1.25)
    {
        var spec = new CandidateSpec(id, "RuleHybrid", "runtime-state", 0, "none", shape);
        var preds = new Dictionary<DataRow, double[]>();
        foreach (var group in rows.GroupBy(r => r.ScenarioKey))
        {
            int latch = 0;
            foreach (var row in group.OrderBy(r => r.ScenarioElapsedMs))
            {
                double startVelocity = useV5ForStart ? row.F.V5 : row.F.V2;
                bool start = row.F.RecentHigh >= highMin && startVelocity <= v2Max && row.F.LatestDelta <= latestMax;
                bool release = row.F.V2 > releaseV2 || row.F.LatestDelta > releaseLatest;
                if (start) latch = 10;
                if (release) latch = 0;
                double dx = row.BaseDx, dy = row.BaseDy;
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
        return EvaluateCandidate(rows, spec, r => preds[r], Array.Empty<object>(), new { estimatedMacs = DistilledMlpPredictionModel.EstimatedMacs, parameters = 0, highMin, v2Max, latestMax, releaseV2, releaseLatest, capPx, useV5ForStart });
    }

    static (CandidateSpec Spec, double StopBlend, double NormalGain, double ProductBlend)[] GuardedSpecs() => new[]
    {
        (
            new CandidateSpec(
                "mlp_h32_event_safe_runtime_latch_cap0p35",
                "MLP+SequenceGuard",
                "temporal+runtime-state",
                32,
                "event-safe MLP with runtime-only post-model stop/static sequence latch cap",
                "event-safe MLP output capped to 0.35 px while runtime recentHigh/low-v/runtime-displacement latch is active",
                "postModelGuard",
                StopCapPx: 0.35),
            StopBlend: 0.0,
            NormalGain: 1.0,
            ProductBlend: 0.0
        ),
        (
            new CandidateSpec(
                "mlp_h32_event_safe_runtime_latch_cap0p35_gain1p08",
                "MLP+SequenceGuard+LagCalibration",
                "temporal+runtime-state",
                32,
                "event-safe MLP with runtime-only sequence latch/cap and runtime normal-moving gain calibration",
                "cap0.35 stop latch; outside latch, runtime normal-moving output gain 1.08 to counter underprediction lag",
                "postModelGuard",
                StopCapPx: 0.35),
            StopBlend: 0.0,
            NormalGain: 1.08,
            ProductBlend: 0.0
        ),
        (
            new CandidateSpec(
                "mlp_h32_event_safe_runtime_latch_cap0p25_gain1p08",
                "MLP+SequenceGuard+LagCalibration",
                "temporal+runtime-state",
                32,
                "event-safe MLP with runtime-only tighter stop cap and runtime normal-moving gain calibration",
                "cap0.25 stop latch; outside latch, runtime normal-moving output gain 1.08",
                "postModelGuard",
                StopCapPx: 0.25),
            StopBlend: 0.0,
            NormalGain: 1.08,
            ProductBlend: 0.0
        ),
        (
            new CandidateSpec(
                "mlp_h32_event_safe_runtime_latch_cap0p35_productblend0p25",
                "MLP+SequenceGuard+LagCalibration",
                "temporal+runtime-state",
                32,
                "event-safe MLP with runtime-only sequence latch/cap and runtime normal-moving product-blend lag calibration",
                "cap0.35 stop latch; outside latch, runtime normal-moving output blends 25% toward product baseline",
                "postModelGuard",
                StopCapPx: 0.35),
            StopBlend: 0.0,
            NormalGain: 1.0,
            ProductBlend: 0.25
        )
    };

    static object EvaluateGuardedModel(List<DataRow> rows, CandidateSpec spec, TrainedMlp model, double stopBlend = 0.0, double normalGain = 1.0, double productBlend = 0.0)
    {
        var preds = new Dictionary<DataRow, double[]>();
        foreach (var group in rows.GroupBy(r => r.ScenarioKey))
        {
            int latch = 0;
            foreach (var row in group.OrderBy(r => r.ScenarioElapsedMs))
            {
                var raw = model.Model.Predict(model.Normalizer.Transform(FeatureVector(row, "temporal")));
                bool start = IsRuntimeStopLatchStart(row);
                bool release = row.F.V2 > 220 || row.F.LatestDelta > 3.0 || row.F.RuntimeTargetDisplacementEstimate > 1.5;
                if (start) latch = 10;
                if (release) latch = 0;

                double dx = raw[0], dy = raw[1];
                if (IsRuntimeStaticHold(row))
                {
                    dx = 0;
                    dy = 0;
                }
                else if (latch > 0)
                {
                    dx *= stopBlend;
                    dy *= stopBlend;
                    CapMagnitude(ref dx, ref dy, spec.StopCapPx);
                    double lead = dx * row.F.DirX + dy * row.F.DirY;
                    if (lead > spec.StopCapPx)
                    {
                        dx -= (lead - spec.StopCapPx) * row.F.DirX;
                        dy -= (lead - spec.StopCapPx) * row.F.DirY;
                    }
                    latch--;
                }
                else if (IsRuntimeNormalMoving(row))
                {
                    dx *= normalGain;
                    dy *= normalGain;
                    if (productBlend > 0)
                    {
                        dx = dx * (1 - productBlend) + row.BaseDx * productBlend;
                        dy = dy * (1 - productBlend) + row.BaseDy * productBlend;
                    }
                }
                preds[row] = new[] { dx, dy };
            }
        }

        return EvaluateCandidate(
            rows,
            spec,
            r => preds[r],
            model.TrainingTrace,
            new
            {
                estimatedMacs = model.Model.EstimatedMacs + 20,
                parameters = model.Model.ParameterCount,
                inputFeatures = model.Model.Input,
                hidden = model.Model.Hidden,
                guard = "runtime-only per-scenario stop latch, static zero target, cap, and lead-side clamp",
                stopBlend,
                normalGain,
                productBlend,
                spec.StopCapPx
            });
    }

    static void AddRun(List<CandidateRun> runs, int seed, Dictionary<string, double> productMetrics, Dictionary<string, double> productDeploymentMetrics, double futureLagEpsilon, object eval)
    {
        var doc = JsonSerializer.SerializeToElement(eval, JsonOptions);
        string id = doc.GetProperty("candidate").GetProperty("Id").GetString()!;
        var metrics = GateMetrics(doc);
        var strict = metrics.ToDictionary(kvp => kvp.Key, kvp => kvp.Value <= productMetrics[kvp.Key]);
        bool normalOk = metrics["test.normal.visual.p95"] <= productMetrics["test.normal.visual.p95"] &&
            metrics["test.normal.visual.p99"] <= productMetrics["test.normal.visual.p99"];
        bool robustnessOk = metrics["robustness.peakLead.max"] < productMetrics["robustness.peakLead.max"] &&
            metrics["robustness.otr.gt1px.rate"] < productMetrics["robustness.otr.gt1px.rate"] &&
            metrics["robustness.returnMotion.max"] < productMetrics["robustness.returnMotion.max"];
        bool leadOk = metrics["overall.futureLead.p99"] < productMetrics["overall.futureLead.p99"];
        bool lagOk = metrics["overall.futureLag.p95"] <= productMetrics["overall.futureLag.p95"] + futureLagEpsilon;
        var deploymentGate = DeploymentGate(doc, productMetrics, productDeploymentMetrics);
        runs.Add(new CandidateRun(
            seed,
            id,
            doc.GetProperty("objective").GetProperty("total").GetDouble(),
            metrics,
            strict,
            lagOk,
            normalOk && robustnessOk && leadOk && lagOk,
            deploymentGate,
            FutureLagDiagnostics(doc),
            doc.GetProperty("trainingTrace").Clone(),
            doc.GetProperty("runtimeCost").Clone()));
    }

    static object BuildProductComparison(Dictionary<string, object> candidates, string productId)
    {
        var product = JsonSerializer.SerializeToElement(candidates[productId], JsonOptions);
        var baseline = GateMetrics(product);
        return candidates
            .Where(kvp => kvp.Key != productId)
            .Select(kvp =>
            {
                var doc = JsonSerializer.SerializeToElement(kvp.Value, JsonOptions);
                var metrics = GateMetrics(doc);
                return new
                {
                    id = kvp.Key,
                    metrics,
                    beatsProduct = metrics.ToDictionary(
                        kvp2 => kvp2.Key,
                        kvp2 => kvp2.Value <= baseline[kvp2.Key]),
                    beatsAllGates = metrics.All(kvp2 => kvp2.Value <= baseline[kvp2.Key])
                };
            })
            .OrderBy(x => x.id)
            .ToArray();
    }

    static Dictionary<string, double> GateMetrics(JsonElement doc) => new()
    {
        ["test.normal.visual.p95"] = Metric(doc, "test", "rowWeighted", "normal.visual.p95"),
        ["test.normal.visual.p99"] = Metric(doc, "test", "rowWeighted", "normal.visual.p99"),
        ["robustness.peakLead.max"] = Metric(doc, "robustness", "rowWeighted", "peakLead.max"),
        ["robustness.otr.gt1px.rate"] = Metric(doc, "robustness", "rowWeighted", "otr.gt1px.rate"),
        ["robustness.returnMotion.max"] = Metric(doc, "robustness", "rowWeighted", "returnMotion.max"),
        ["overall.futureLead.p99"] = Metric(doc, null, "rowWeighted", "futureLead.p99"),
        ["overall.futureLag.p95"] = Metric(doc, null, "rowWeighted", "futureLag.p95")
    };

    static Dictionary<string, double> DeploymentMetrics(JsonElement doc)
    {
        var deployment = doc.GetProperty("sliceAnalysis").GetProperty("deployment");
        var futureLag = deployment.GetProperty("testNormalMovingFutureLag");
        var stationary = deployment.GetProperty("heldoutStationaryJitter");
        return new Dictionary<string, double>
        {
            ["test.normal.visual.p95"] = Metric(doc, "test", "rowWeighted", "normal.visual.p95"),
            ["test.normal.visual.p99"] = Metric(doc, "test", "rowWeighted", "normal.visual.p99"),
            ["test.normalMoving.futureLag.p95"] = futureLag.GetProperty("p95").GetDouble(),
            ["test.normalMoving.futureLag.p99"] = futureLag.GetProperty("p99").GetDouble(),
            ["robustness.peakLead.max"] = Metric(doc, "robustness", "rowWeighted", "peakLead.max"),
            ["robustness.otr.gt1px.rate"] = Metric(doc, "robustness", "rowWeighted", "otr.gt1px.rate"),
            ["robustness.returnMotion.max"] = Metric(doc, "robustness", "rowWeighted", "returnMotion.max"),
            ["overall.futureLead.p99"] = Metric(doc, null, "rowWeighted", "futureLead.p99"),
            ["heldout.stationaryJitter.p95"] = stationary.GetProperty("p95").GetDouble()
        };
    }

    static object DeploymentGate(JsonElement doc, Dictionary<string, double> productLegacyMetrics, Dictionary<string, double> productDeploymentMetrics)
    {
        var product = productLegacyMetrics;
        var productDeployment = productDeploymentMetrics;
        var metrics = DeploymentMetrics(doc);
        double productLagP95 = productDeployment["test.normalMoving.futureLag.p95"];
        double productLagP99 = productDeployment["test.normalMoving.futureLag.p99"];
        double productJitterP95 = productDeployment["heldout.stationaryJitter.p95"];
        double lagP95 = metrics["test.normalMoving.futureLag.p95"];
        double lagP99 = metrics["test.normalMoving.futureLag.p99"];
        bool normalVisualOk = metrics["test.normal.visual.p95"] <= product["test.normal.visual.p95"] &&
            metrics["test.normal.visual.p99"] <= product["test.normal.visual.p99"];
        bool lagP95Ok = lagP95 <= productLagP95 + Math.Max(0.05, productLagP95 * 0.05);
        bool lagP99Ok = lagP99 <= productLagP99 + Math.Max(0.10, productLagP99 * 0.05);
        bool robustnessOk = metrics["robustness.peakLead.max"] <= product["robustness.peakLead.max"] &&
            metrics["robustness.otr.gt1px.rate"] <= product["robustness.otr.gt1px.rate"] &&
            metrics["robustness.returnMotion.max"] <= product["robustness.returnMotion.max"];
        bool futureLeadOk = metrics["overall.futureLead.p99"] <= product["overall.futureLead.p99"];
        bool stationaryOk = metrics["heldout.stationaryJitter.p95"] <= productJitterP95 + 0.05;
        return new
        {
            metrics,
            productReferences = new
            {
                testNormalVisualP95 = product["test.normal.visual.p95"],
                testNormalVisualP99 = product["test.normal.visual.p99"],
                testNormalMovingFutureLagP95 = productLagP95,
                testNormalMovingFutureLagP99 = productLagP99,
                robustnessPeakLeadMax = product["robustness.peakLead.max"],
                robustnessOtrGt1pxRate = product["robustness.otr.gt1px.rate"],
                robustnessReturnMotionMax = product["robustness.returnMotion.max"],
                overallFutureLeadP99 = product["overall.futureLead.p99"],
                heldoutStationaryJitterP95 = productJitterP95
            },
            deltas = metrics.ToDictionary(kvp => kvp.Key, kvp => kvp.Value - productDeployment[kvp.Key]),
            checks = new
            {
                normalVisualOk,
                testNormalMovingFutureLagP95Ok = lagP95Ok,
                testNormalMovingFutureLagP99Ok = lagP99Ok,
                robustnessOk,
                futureLeadOk,
                heldoutStationaryJitterOk = stationaryOk
            },
            passes = normalVisualOk && lagP95Ok && lagP99Ok && robustnessOk && futureLeadOk && stationaryOk
        };
    }

    static double Metric(JsonElement doc, string split, string aggregate, string dimension)
    {
        var table = split == null
            ? doc.GetProperty("aggregates")
            : doc.GetProperty("bySplit").GetProperty(split);
        return table.GetProperty(aggregate).GetProperty("dimensions").GetProperty(dimension).GetProperty("value").GetDouble();
    }

    static object FutureLagDiagnostics(JsonElement doc)
    {
        double Dim(string aggregate) => doc.GetProperty("aggregates").GetProperty(aggregate).GetProperty("dimensions").GetProperty("futureLag.p95").GetProperty("value").GetDouble();
        int Count(string aggregate) => doc.GetProperty("aggregates").GetProperty(aggregate).GetProperty("dimensions").GetProperty("futureLag.p95").GetProperty("sourceCount").GetInt32();
        var bySplit = new Dictionary<string, object>();
        foreach (var split in doc.GetProperty("bySplit").EnumerateObject())
        {
            var cell = split.Value.GetProperty("rowWeighted").GetProperty("dimensions").GetProperty("futureLag.p95");
            bySplit[split.Name] = new { p95 = cell.GetProperty("value").GetDouble(), sourceCount = cell.GetProperty("sourceCount").GetInt32() };
        }
        return new
        {
            rowWeightedP95 = Dim("rowWeighted"),
            scenarioBalancedP95 = Dim("scenarioBalanced"),
            fileBalancedP95 = Dim("fileBalanced"),
            durationBucketBalancedP95 = Dim("durationBucketBalanced"),
            qualityBucketBalancedP95 = Dim("qualityBucketBalanced"),
            eligibleRowCount = Count("rowWeighted"),
            bySplit,
            normalQualityAllRows = doc.GetProperty("byQualityBucket").TryGetProperty("normal", out var normal) ? normal.GetProperty("futureLag").Clone() : default,
            pollDelayedAllRows = doc.GetProperty("byQualityBucket").TryGetProperty("poll-delayed", out var delayed) ? delayed.GetProperty("futureLag").Clone() : default,
            sliceAnalysis = doc.GetProperty("sliceAnalysis").Clone()
        };
    }

    static object BuildSeedSummary(List<CandidateRun> runs) => runs
        .GroupBy(r => r.Id)
        .OrderBy(g => g.Average(r => r.Objective))
        .ToDictionary(
            g => g.Key,
            g => new
            {
                seedCount = g.Count(),
                legacyPassCount = g.Count(r => r.PassesLegacyStep05IntegrationGate),
                futureLagWithinLegacyEpsilonCount = g.Count(r => r.FutureLagWithinLegacyEpsilon),
                objective = new { mean = g.Average(r => r.Objective), worst = g.Max(r => r.Objective), best = g.Min(r => r.Objective) },
                metrics = g.First().Metrics.Keys.ToDictionary(
                    key => key,
                    key => new
                    {
                        mean = g.Average(r => r.Metrics[key]),
                        worst = g.Max(r => r.Metrics[key]),
                        best = g.Min(r => r.Metrics[key])
                    })
            });

    static bool UsesSafetyTarget(string lossKind) => lossKind is "eventSafe" or "eventPeakLeadHinge" or "eventReturnMotionProxy" or "stopSafetyTarget";
    static bool IsLabelStopSafetyRow(DataRow r) =>
        r.F.RecentHigh >= 400 &&
        r.F.V2 <= 140 &&
        r.F.LatestDelta <= 2.5 &&
        r.FutureTargetDistance <= 1.25;
    static bool IsNormalMoving(DataRow r) =>
        !r.EventWindowLabel &&
        !r.StaticLabel &&
        r.F.V12 >= 250 &&
        r.F.V12 < 1800 &&
        r.FutureTargetDistance > 0.5;
    static bool IsRuntimeStopLatchStart(DataRow r)
    {
        double startVelocity = r.F.V2;
        return r.F.RecentHigh >= 400 &&
            startVelocity <= 140 &&
            r.F.LatestDelta <= 2.5 &&
            r.F.RuntimeTargetDisplacementEstimate <= 1.25;
    }
    static bool IsRuntimeStaticHold(DataRow r) =>
        r.F.V12 <= 100 &&
        r.F.LatestDelta <= 1.25 &&
        r.F.RuntimeTargetDisplacementEstimate <= 0.75;
    static bool IsRuntimeNormalMoving(DataRow r) =>
        r.F.V12 >= 250 &&
        r.F.V12 < 1800 &&
        r.F.RuntimeTargetDisplacementEstimate > 0.5 &&
        r.F.PathEfficiency >= 0.35;
    static void CapMagnitude(ref double dx, ref double dy, double capPx)
    {
        double mag = Math.Sqrt(dx * dx + dy * dy);
        if (capPx >= 0 && mag > capPx && mag > 1e-9)
        {
            dx *= capPx / mag;
            dy *= capPx / mag;
        }
    }

    static EvalRow BuildEval(string id, DataRow r, double dx, double dy)
    {
        double ex = dx - r.LabelDx;
        double ey = dy - r.LabelDy;
        double visual = Math.Sqrt(ex * ex + ey * ey);
        double signedFuture = ex * r.F.DirX + ey * r.F.DirY;
        double dist = Math.Sqrt(dx * dx + dy * dy);
        bool acute = (r.F.V12 >= 500 && r.FutureTargetDistance <= 0.75) ||
            (r.F.V12 >= 800 && r.F.V2 <= r.F.V12 * 0.35) ||
            (r.F.V12 >= 1500 && r.FutureTargetDistance <= 0.75) ||
            (r.F.V5 >= 500 && r.F.V2 <= 100) ||
            (r.F.V12 >= 500 && r.F.V5 <= 250 && r.F.V2 <= 100);
        bool high = r.F.V12 >= 1800;
        bool stat = IsHold(r) || (r.F.V12 <= 100 && r.FutureTargetDistance <= 0.75);
        bool normal = !acute && r.F.V12 >= 250 && r.F.V12 < 1800;
        return new EvalRow(id, r.PackageId, r.Split, r.QualityBucket, r.DurationBucket, r.ScenarioIndex, r.ScenarioKey, r.ScenarioElapsedMs, r.MovementPhase, visual, visual * visual, Math.Max(0, signedFuture), Math.Max(0, -signedFuture), dist, dx, dy, r.F.DirX, r.F.DirY, r.F.V2, r.F.V5, r.F.V8, r.F.V12, r.F.RecentHigh, r.F.LatestDelta, r.FutureTargetDistance, r.F.RuntimeTargetDisplacementEstimate, normal, high, stat);
    }

    static IEnumerable<StopEventSummary> BuildStopEvents(List<EvalRow> rows)
    {
        foreach (var group in rows.GroupBy(r => r.ScenarioKey))
        {
            var ordered = group.OrderBy(r => r.ElapsedMs).ToArray();
            for (int i = 6; i < ordered.Length - 1; i++)
            {
                var r = ordered[i];
                bool nearStop = r.V2 <= 100 && r.FutureTargetDistance <= 0.75;
                bool prevNear = ordered[i - 1].V2 <= 100 && ordered[i - 1].FutureTargetDistance <= 0.75;
                double preMax = ordered.Skip(Math.Max(0, i - 6)).Take(6).Max(x => Math.Max(x.V5, x.V12));
                if (!nearStop || prevNear || preMax < 500) continue;
                var dirRow = ordered.Skip(Math.Max(0, i - 6)).Take(6).OrderByDescending(x => x.V12).First();
                var window = ordered.Skip(i).Take(11).ToArray();
                var leads = window.Select(w => w.CurrentDx * dirRow.DirX + w.CurrentDy * dirRow.DirY).ToArray();
                double peakLead = Math.Max(0, leads.DefaultIfEmpty(0).Max());
                int peakFrame = leads.Length == 0 ? 0 : Array.IndexOf(leads, leads.Max());
                double peakDistance = window.Select(w => w.CurrentDistance).DefaultIfEmpty(0).Max();
                double afterMin = window.Skip(peakFrame).Select(w => w.CurrentDistance).DefaultIfEmpty(peakDistance).Min();
                double ret = Math.Max(0, peakDistance - afterMin);
                bool returned = peakLead > 0.5 && window.Skip(peakFrame).Any(w => w.CurrentDistance < 1.0) && ret > 0.5;
                yield return new StopEventSummary(r.ScenarioKey, r.PackageId, r.Split, r.QualityBucket, r.DurationBucket, r.ScenarioIndex, r.ElapsedMs, preMax, peakLead, ret, returned);
                i += 2;
            }
        }
    }

    static object Objective(List<EvalRow> rows, StopEventSummary[] events)
    {
        var table = BuildMetricTable(rows, events);
        var json = JsonSerializer.SerializeToElement(table, JsonOptions);
        double total = 0;
        var components = new Dictionary<string, double>();
        foreach (var agg in AggregateWeights)
        {
            if (!json.TryGetProperty(agg.Key, out var mode)) continue;
            foreach (var dim in DimensionIds)
            {
                if (!mode.GetProperty("dimensions").TryGetProperty(dim, out var cell)) continue;
                double value = cell.GetProperty("value").GetDouble();
                double part = agg.Value * DimensionWeights[dim] * value;
                total += part;
                components[agg.Key + ":" + dim] = part;
            }
        }
        return new { total, components };
    }

    static Dictionary<string, object> BuildMetricTable(List<EvalRow> rows, StopEventSummary[] events)
    {
        return new Dictionary<string, object>
        {
            ["rowWeighted"] = AggregateMode(rows, events, "rowWeighted", _ => "all", _ => "all", null),
            ["scenarioBalanced"] = AggregateMode(rows, events, "scenarioBalanced", r => r.ScenarioKey, e => e.ScenarioKey, null),
            ["fileBalanced"] = AggregateMode(rows, events, "fileBalanced", r => r.PackageId, e => e.PackageId, null),
            ["durationBucketBalanced"] = AggregateMode(rows, events, "durationBucketBalanced", r => r.DurationBucket, e => e.DurationBucket, new[] { "4s", "6s", "8s", "10s", "12s" }),
            ["qualityBucketBalanced"] = AggregateMode(rows, events, "qualityBucketBalanced", r => r.QualityBucket, e => e.QualityBucket, new[] { "normal", "poll-delayed" })
        };
    }

    static object SliceAnalysis(List<EvalRow> rows, StopEventSummary[] events)
    {
        var heldoutRows = rows.Where(r => r.Split is "test" or "robustness").ToList();
        var testNormalMoving = rows.Where(r => r.Split == "test" && r.NormalMove).ToList();
        var robustnessNormalMoving = rows.Where(r => r.Split == "robustness" && r.NormalMove).ToList();
        var robustnessEvents = events.Where(e => e.Split == "robustness").ToArray();
        var legacyFutureLag = Dimension("futureLag.p95", rows, events);

        return new
        {
            deployment = new
            {
                testNormalVisual = Stat(rows.Where(r => r.Split == "test" && r.QualityBucket == "normal").Select(r => r.VisualError).ToArray()),
                testNormalMovingFutureLag = Stat(testNormalMoving.Select(r => r.FutureLag).ToArray()),
                robustnessNormalMovingFutureLag = Stat(robustnessNormalMoving.Select(r => r.FutureLag).ToArray()),
                heldoutNormalMovingFutureLag = Stat(heldoutRows.Where(r => r.NormalMove).Select(r => r.FutureLag).ToArray()),
                heldoutStationaryJitter = Stat(heldoutRows.Where(r => r.StaticHold).Select(r => r.CurrentDistance).ToArray()),
                robustnessStopEvents = new
                {
                    count = robustnessEvents.Length,
                    peakLead = Stat(robustnessEvents.Select(e => e.PeakLeadPx).ToArray()),
                    returnMotion = Stat(robustnessEvents.Select(e => e.ReturnMotionPx).ToArray()),
                    otrGt1pxRate = Rate(robustnessEvents, e => e.PeakLeadPx > 1 && e.OvershootThenReturn).Value
                }
            },
            diagnostic = new
            {
                legacyFutureLagEligibleRows = new { p95 = legacyFutureLag.Value, sourceCount = legacyFutureLag.Count },
                allRowFutureLag = Stat(rows.Select(r => r.FutureLag).ToArray()),
                allRowFutureLagBySplit = rows
                    .GroupBy(r => r.Split)
                    .OrderBy(g => g.Key)
                    .ToDictionary(g => g.Key, g => Stat(g.Select(r => r.FutureLag).ToArray())),
                allRowFutureLagByQualityBucket = rows
                    .GroupBy(r => r.QualityBucket)
                    .OrderBy(g => g.Key)
                    .ToDictionary(g => g.Key, g => Stat(g.Select(r => r.FutureLag).ToArray())),
                normalMovingFutureLagBySplit = rows
                    .Where(r => r.NormalMove)
                    .GroupBy(r => r.Split)
                    .OrderBy(g => g.Key)
                    .ToDictionary(g => g.Key, g => Stat(g.Select(r => r.FutureLag).ToArray()))
            }
        };
    }

    static object AggregateMode(List<EvalRow> rows, StopEventSummary[] events, string mode, Func<EvalRow, string> rowKey, Func<StopEventSummary, string> eventKey, string[] expected)
    {
        if (mode == "rowWeighted")
        {
            return new { rows = rows.Count, events = events.Length, groups = 1, omittedBuckets = Array.Empty<string>(), dimensions = DimensionMap(rows, events) };
        }

        var keys = rows.Select(rowKey).Concat(events.Select(eventKey)).Distinct().OrderBy(x => x).ToArray();
        var rowGroups = rows.GroupBy(rowKey).ToDictionary(g => g.Key, g => g.ToList());
        var eventGroups = events.GroupBy(eventKey).ToDictionary(g => g.Key, g => g.ToArray());
        var result = new Dictionary<string, object>();
        foreach (string dim in DimensionIds)
        {
            var values = new List<double>();
            foreach (string key in keys)
            {
                rowGroups.TryGetValue(key, out var rs);
                eventGroups.TryGetValue(key, out var es);
                var cell = Dimension(dim, rs ?? new List<EvalRow>(), es ?? Array.Empty<StopEventSummary>());
                if (cell.Count > 0) values.Add(cell.Value);
            }
            result[dim] = new { value = values.Count == 0 ? 0 : values.Average(), sourceCount = values.Count };
        }
        var omitted = expected == null ? Array.Empty<string>() : expected.Except(keys).ToArray();
        return new { rows = rows.Count, events = events.Length, groups = keys.Length, omittedBuckets = omitted, dimensions = result };
    }

    static Dictionary<string, object> DimensionMap(List<EvalRow> rows, StopEventSummary[] events)
    {
        var map = new Dictionary<string, object>();
        foreach (string dim in DimensionIds)
        {
            var cell = Dimension(dim, rows, events);
            map[dim] = new { value = cell.Value, sourceCount = cell.Count };
        }
        return map;
    }

    static (double Value, int Count) Dimension(string id, List<EvalRow> rows, StopEventSummary[] events)
    {
        return id switch
        {
            "normal.visual.p95" => StatValue(rows.Where(r => r.Split == "test" && r.QualityBucket == "normal").Select(r => r.VisualError), .95),
            "normal.visual.p99" => StatValue(rows.Where(r => r.Split == "test" && r.QualityBucket == "normal").Select(r => r.VisualError), .99),
            "futureLead.p99" => StatValue(rows.Select(r => r.FutureLead), .99),
            "futureLag.p95" => StatValue(rows.Where(r => r.NormalMove || r.Split is "train" or "validation").Select(r => r.FutureLag), .95),
            "peakLead.max" => MaxValue(events.Select(e => e.PeakLeadPx)),
            "peakLead.p99" => StatValue(events.Select(e => e.PeakLeadPx), .99),
            "returnMotion.max" => MaxValue(events.Select(e => e.ReturnMotionPx)),
            "returnMotion.p99" => StatValue(events.Select(e => e.ReturnMotionPx), .99),
            "otr.gt1px.rate" => Rate(events, e => e.PeakLeadPx > 1 && e.OvershootThenReturn),
            "stationaryJitter.p95" => StatValue(rows.Where(r => r.StaticHold).Select(r => r.CurrentDistance), .95),
            _ => (0, 0)
        };
    }

    static object RowSummary(List<EvalRow> rows) => new
    {
        rows = rows.Count,
        scenarios = rows.Select(r => r.ScenarioKey).Distinct().Count(),
        visual = Stat(rows.Select(r => r.VisualError).ToArray()),
        futureLead = Stat(rows.Select(r => r.FutureLead).ToArray()),
        futureLag = Stat(rows.Select(r => r.FutureLag).ToArray()),
        stationaryJitter = Stat(rows.Where(r => r.StaticHold).Select(r => r.CurrentDistance).ToArray())
    };

    static object EventMetrics(StopEventSummary[] events) => new
    {
        count = events.Length,
        peakLead = Stat(events.Select(e => e.PeakLeadPx).ToArray()),
        returnMotion = Stat(events.Select(e => e.ReturnMotionPx).ToArray()),
        otrGt1pxRate = Rate(events, e => e.PeakLeadPx > 1 && e.OvershootThenReturn).Value,
        bySplit = events.GroupBy(e => e.Split).ToDictionary(g => g.Key, g => g.Count()),
        byDurationBucket = events.GroupBy(e => e.DurationBucket).ToDictionary(g => g.Key, g => g.Count()),
        byQualityBucket = events.GroupBy(e => e.QualityBucket).ToDictionary(g => g.Key, g => g.Count())
    };

    static double[] FeatureVector(DataRow r, string kind)
    {
        var f = r.F;
        return new[]
        {
            f.HorizonMs / 16.67,
            f.Dx2 / 8, f.Dy2 / 8, f.V2 / 2000,
            f.Dx3 / 8, f.Dy3 / 8, f.V3 / 2000,
            f.Dx5 / 8, f.Dy5 / 8, f.V5 / 2000,
            f.Dx8 / 8, f.Dy8 / 8, f.V8 / 2000,
            f.Dx12 / 8, f.Dy12 / 8, f.V12 / 2000,
            f.RecentHigh / 3000, f.LatestDelta / 8, f.PathNet / 80, f.PathLength / 100, f.PathEfficiency,
            f.RuntimeTargetDisplacementEstimate / 8, f.RuntimeSpeedEstimate / 3000,
            f.DirX, f.DirY
        };
    }

    static Features RuntimeFeatures(CallPoint call, List<CallPoint> history)
    {
        var v2 = VelocityWindow(call, history, 2);
        var v3 = VelocityWindow(call, history, 3);
        var v5 = VelocityWindow(call, history, 5);
        var v8 = VelocityWindow(call, history, 8);
        var v12 = VelocityWindow(call, history, 12);
        var path = BuildPath(call, history, 12);
        double latestDelta = history.Count == 0 ? 0 : Dist(history[^1].X, history[^1].Y, call.X, call.Y);
        double recentHigh = Math.Max(Math.Max(v5.Speed, v8.Speed), Math.Max(v12.Speed, RecentSegmentMax(call, history, 6)));
        double dirX = v12.Dx, dirY = v12.Dy, mag = Math.Sqrt(dirX * dirX + dirY * dirY);
        if (mag > 1e-6) { dirX /= mag; dirY /= mag; }
        else { dirX = 1; dirY = 0; }
        double horizonMs = (call.TargetTicks - call.SampleTicks) * 1000.0 / call.Frequency + ProductOffsetMs;
        double horizonSec = Math.Max(0, horizonMs / 1000.0);
        double runtimeTargetDisplacement = v2.Speed * horizonSec;
        return new Features(v2.Dx, v2.Dy, v2.Speed, v3.Dx, v3.Dy, v3.Speed, v5.Dx, v5.Dy, v5.Speed, v8.Dx, v8.Dy, v8.Speed, v12.Dx, v12.Dy, v12.Speed, recentHigh, latestDelta, dirX, dirY, path.Net, path.Path, path.Efficiency, horizonMs, runtimeTargetDisplacement, v2.Speed);
    }

    static (double Dx, double Dy, double Speed) VelocityWindow(CallPoint call, List<CallPoint> history, int sampleCount)
    {
        if (history.Count == 0) return (0, 0, 0);
        int back = Math.Min(sampleCount - 1, history.Count);
        var oldest = history[history.Count - back];
        double dt = (call.ElapsedMs - oldest.ElapsedMs) / 1000.0;
        if (dt <= 0) return (0, 0, 0);
        double vx = (call.X - oldest.X) / dt, vy = (call.Y - oldest.Y) / dt;
        double horizonSec = Math.Max(0, (call.TargetTicks - call.SampleTicks) / (double)call.Frequency + ProductOffsetMs / 1000.0);
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
            if (dt > 0) max = Math.Max(max, Dist(pts[i - 1].X, pts[i - 1].Y, pts[i].X, pts[i].Y) / dt);
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

    static object DatasetSummary(List<DataRow> rows, SplitManifest manifest) => new
    {
        rows = rows.Count,
        packages = rows.Select(r => r.PackageId).Distinct().Count(),
        scenarios = rows.Select(r => r.ScenarioKey).Distinct().Count(),
        manifestPackages = manifest.Packages.Select(p => new { p.PackageId, p.Split, p.QualityBucket, p.DurationBucket, p.ScenarioDurationMilliseconds, p.ScenarioCount, p.AlignmentRows }).ToArray(),
        bySplit = rows.GroupBy(r => r.Split).ToDictionary(g => g.Key, g => new { rows = g.Count(), packages = g.Select(r => r.PackageId).Distinct().Count(), scenarios = g.Select(r => r.ScenarioKey).Distinct().Count() }),
        byDurationBucket = rows.GroupBy(r => r.DurationBucket).ToDictionary(g => g.Key, g => g.Count()),
        byQualityBucket = rows.GroupBy(r => r.QualityBucket).ToDictionary(g => g.Key, g => g.Count()),
        eventWindowRows = rows.Count(r => r.EventWindowLabel),
        stationaryRows = rows.Count(r => r.StaticLabel)
    };

    static Dictionary<string, int> HeaderIndex(string[] header) => header.Select((name, i) => (name, i)).ToDictionary(x => x.name, x => x.i);
    static string Get(string[] fields, Dictionary<string, int> index, string name) => index.TryGetValue(name, out int i) && i < fields.Length ? fields[i] : "";
    static double GetDouble(string[] fields, Dictionary<string, int> index, string name, double fallback = 0) => double.TryParse(Get(fields, index, name), NumberStyles.Float, CultureInfo.InvariantCulture, out double v) ? v : fallback;
    static long GetLong(string[] fields, Dictionary<string, int> index, string name, long fallback) => long.TryParse(Get(fields, index, name), NumberStyles.Integer, CultureInfo.InvariantCulture, out long v) ? v : fallback;
    static double EffectiveElapsedUs(double elapsedMs, long sampleTicks, long targetTicks, long frequency, double offsetMs) => (elapsedMs * 1000.0) + ((targetTicks + (offsetMs * frequency / 1000.0) - sampleTicks) * 1000000.0 / frequency);
    static string Abs(string root, string path) => Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(root, path.Replace('/', Path.DirectorySeparatorChar)));
    static string FindRepoRoot()
    {
        string dir = AppContext.BaseDirectory;
        while (!string.IsNullOrEmpty(dir) && !Directory.Exists(Path.Combine(dir, ".git"))) dir = Directory.GetParent(dir)?.FullName;
        return string.IsNullOrEmpty(dir) ? Directory.GetCurrentDirectory() : dir;
    }
    static bool IsHold(DataRow r) => r.MovementPhase.Equals("hold", StringComparison.OrdinalIgnoreCase) || r.GeneratedVelocity < 1;
    static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    static (double Value, int Count) StatValue(IEnumerable<double> source, double p) { var values = source.ToArray(); Array.Sort(values); return values.Length == 0 ? (0, 0) : (values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)], values.Length); }
    static (double Value, int Count) MaxValue(IEnumerable<double> source) { var values = source.ToArray(); return values.Length == 0 ? (0, 0) : (values.Max(), values.Length); }
    static (double Value, int Count) Rate(IEnumerable<StopEventSummary> events, Func<StopEventSummary, bool> pred) { var arr = events.ToArray(); return arr.Length == 0 ? (0, 0) : (arr.Count(pred) / (double)arr.Length, arr.Length); }
    static object Stat(double[] values) { Array.Sort(values); return new { count = values.Length, mean = values.Length == 0 ? 0 : values.Average(), p50 = Percentile(values, .5), p95 = Percentile(values, .95), p99 = Percentile(values, .99), max = values.Length == 0 ? 0 : values[^1] }; }
    static double Percentile(double[] values, double p) => values.Length == 0 ? 0 : values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)];
    static double StableRandom(int seed, string packageId, int scenario, int index)
    {
        unchecked
        {
            int h = seed;
            foreach (char c in packageId) h = h * 31 + c;
            h = h * 31 + scenario;
            h = h * 31 + index;
            uint x = (uint)h;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            return x / (double)uint.MaxValue;
        }
    }

    static void WriteRuntimeEventSafeGeneratedModel(string path, TrainedMlp trained, int seed)
    {
        var exported = trained.Model.Export();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var builder = new StringBuilder();
        builder.AppendLine("// Generated from poc/cursor-prediction-v21/step-07-runtime-only-correction.");
        builder.AppendLine("// Candidate: mlp_h32_event_safe_runtime_latch_cap0p35");
        builder.AppendLine("// Seed: " + seed.ToString(CultureInfo.InvariantCulture));
        builder.AppendLine("using System;");
        builder.AppendLine();
        builder.AppendLine("namespace CursorMirror");
        builder.AppendLine("{");
        builder.AppendLine("    internal sealed class RuntimeEventSafeMlpPredictionModel");
        builder.AppendLine("    {");
        builder.AppendLine("        public const string ModelId = \"mlp_h32_event_safe_runtime_latch_cap0p35_seed" + seed.ToString(CultureInfo.InvariantCulture) + "\";");
        builder.AppendLine("        public const int FeatureCount = " + exported.Input.ToString(CultureInfo.InvariantCulture) + ";");
        builder.AppendLine("        public const int Hidden = " + exported.Hidden.ToString(CultureInfo.InvariantCulture) + ";");
        builder.AppendLine("        public const int EstimatedMacs = " + (exported.Input * exported.Hidden + exported.Hidden * 2).ToString(CultureInfo.InvariantCulture) + ";");
        builder.AppendLine("        public const int ParameterCount = " + (exported.Input * exported.Hidden + exported.Hidden + exported.Hidden * 2 + 2).ToString(CultureInfo.InvariantCulture) + ";");
        AppendArray(builder, "FeatureMean", trained.Normalizer.Mean, 8);
        AppendArray(builder, "FeatureStd", trained.Normalizer.Std, 8);
        AppendArray(builder, "W0", exported.W1, 8);
        AppendArray(builder, "B0", exported.B1, 8);
        AppendArray(builder, "W1", exported.W2, 8);
        AppendArray(builder, "B1", exported.B2, 8);
        builder.AppendLine();
        builder.AppendLine("        private readonly float[] _features = new float[FeatureCount];");
        builder.AppendLine("        private readonly float[] _hidden = new float[Hidden];");
        builder.AppendLine();
        builder.AppendLine("        public bool TryEvaluate(float[] features, out float dx, out float dy)");
        builder.AppendLine("        {");
        builder.AppendLine("            dx = 0.0f;");
        builder.AppendLine("            dy = 0.0f;");
        builder.AppendLine("            if (features == null || features.Length != FeatureCount)");
        builder.AppendLine("            {");
        builder.AppendLine("                return false;");
        builder.AppendLine("            }");
        builder.AppendLine();
        builder.AppendLine("            for (int i = 0; i < FeatureCount; i++)");
        builder.AppendLine("            {");
        builder.AppendLine("                _features[i] = (features[i] - FeatureMean[i]) / SafeStd(FeatureStd[i]);");
        builder.AppendLine("            }");
        builder.AppendLine();
        builder.AppendLine("            for (int h = 0; h < Hidden; h++)");
        builder.AppendLine("            {");
        builder.AppendLine("                float z = B0[h];");
        builder.AppendLine("                int offset = h * FeatureCount;");
        builder.AppendLine("                for (int i = 0; i < FeatureCount; i++)");
        builder.AppendLine("                {");
        builder.AppendLine("                    z += W0[offset + i] * _features[i];");
        builder.AppendLine("                }");
        builder.AppendLine("                _hidden[h] = (float)Math.Tanh(z);");
        builder.AppendLine("            }");
        builder.AppendLine();
        builder.AppendLine("            dx = B1[0];");
        builder.AppendLine("            dy = B1[1];");
        builder.AppendLine("            for (int h = 0; h < Hidden; h++)");
        builder.AppendLine("            {");
        builder.AppendLine("                dx += W1[h] * _hidden[h];");
        builder.AppendLine("                dy += W1[Hidden + h] * _hidden[h];");
        builder.AppendLine("            }");
        builder.AppendLine();
        builder.AppendLine("            return IsFinite(dx) && IsFinite(dy);");
        builder.AppendLine("        }");
        builder.AppendLine();
        builder.AppendLine("        private static float SafeStd(float value)");
        builder.AppendLine("        {");
        builder.AppendLine("            return Math.Abs(value) < 0.000001f ? 1.0f : value;");
        builder.AppendLine("        }");
        builder.AppendLine();
        builder.AppendLine("        private static bool IsFinite(float value)");
        builder.AppendLine("        {");
        builder.AppendLine("            return !float.IsNaN(value) && !float.IsInfinity(value);");
        builder.AppendLine("        }");
        builder.AppendLine("    }");
        builder.AppendLine("}");
        File.WriteAllText(path, builder.ToString());
    }

    static void AppendArray(StringBuilder builder, string name, double[] values, int indent)
    {
        string prefix = new string(' ', indent);
        builder.Append(prefix).Append("private static readonly float[] ").Append(name).Append(" = new float[] {");
        for (int i = 0; i < values.Length; i++)
        {
            if (i > 0)
            {
                builder.Append(",");
            }

            if (i % 8 == 0)
            {
                builder.AppendLine();
                builder.Append(prefix).Append("    ");
            }
            else
            {
                builder.Append(" ");
            }

            builder.Append(FloatLiteral(values[i]));
        }

        builder.AppendLine();
        builder.Append(prefix).AppendLine("};");
    }

    static string FloatLiteral(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return "0.0f";
        }

        return ((float)value).ToString("R", CultureInfo.InvariantCulture) + "f";
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
sealed record ExportedMlp(int Input, int Hidden, double[] W1, double[] B1, double[] W2, double[] B2);

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
    public ExportedMlp Export()
    {
        return new ExportedMlp(Input, Hidden, Flatten(w1), b1.ToArray(), Flatten(w2), b2.ToArray());
    }

    private static double[] Flatten(double[,] values)
    {
        int rows = values.GetLength(0);
        int columns = values.GetLength(1);
        var flattened = new double[rows * columns];
        int index = 0;
        for (int r = 0; r < rows; r++)
        {
            for (int c = 0; c < columns; c++)
            {
                flattened[index++] = values[r, c];
            }
        }

        return flattened;
    }

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
}
