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
record GateCandidate(string Id, string Family, double StopV2Threshold, double HighSpeedThreshold, double StopTargetDistanceThreshold, double CapPx, double Scale, int LatchFrames, double ReleaseV2Threshold, double ReleaseTargetDistanceThreshold, bool IncludeOneFrameSnap);
record GateState(bool WasNearStop, int RemainingFrames, int ActiveFrame);
record GateResult(PointF Predicted, bool Fired, int ActiveFrame);
record Features(double V2, double V3, double V5, double V8, double V12, double RecentSegmentMax, double DirX, double DirY, double PathNet, double PathLength, double PathEfficiency);
record EvalRow(string PackageId, double ElapsedMs, double VisualError, double CurrentDistance, double CurrentSigned, double CurrentOvershoot, double CurrentDx, double CurrentDy, double DirX, double DirY, double V2, double V5, double V12, double TargetDistance, bool FastThenNearZero, bool HardBrake, bool StopAfterHighSpeed, bool OneFrameStop, bool PostStopFirstFrames, bool NormalMove, bool HighSpeed, bool StaticHold, bool GateFired, string GateFamily, int GateActiveFrame);
record StopEventSummary(string PackageId, double StopElapsedMs, string Phase, double PreMaxSpeed, double V2AtStop, double V5AtStop, double V12AtStop, double TargetDistanceAtStop, double PeakLeadPx, double PeakDistancePx, int PeakFrame, int SettleFrames0p5, int SettleFrames1p0, double SettleMs0p5, double SettleMs1p0, double ReturnMotionPx, bool OvershootThenReturn, double GateFireRate);

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        var config = JsonSerializer.Deserialize<Config>(File.ReadAllText(args[0]), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        var recordings = config.Packages.Select(ReadRecording).ToArray();
        var candidates = BuildCandidates();
        var results = new Dictionary<string, object>();
        foreach (var candidate in candidates)
        {
            var rows = Evaluate(recordings, candidate, config.HorizonCapMs);
            results[candidate.Id] = new
            {
                candidate,
                rows = rows.Count,
                eventMetrics = EventSummaries(rows),
                rowMetrics = AllSummaries(rows),
                gateFire = GateFire(rows),
                tailExamples = rows.Where(r => r.FastThenNearZero && r.CurrentOvershoot > 0.5).OrderByDescending(r => r.CurrentOvershoot).Take(12).Select(TailExample).ToArray(),
                objective = Objective(rows)
            };
        }
        var ranking = results.Select(kvp => new { id = kvp.Key, score = ((dynamic)kvp.Value).objective }).OrderBy(x => x.score.primaryObjective).ThenBy(x => x.score.guardrailPenalty).ToArray();
        var output = new
        {
            schemaVersion = "cursor-prediction-v18-step-05-post-stop-latch-search/1",
            generatedAtUtc = DateTimeOffset.UtcNow,
            baseline = "lag0 offset -4ms",
            lagConst = DistilledMlpPredictionModel.LagCompensationPixels,
            candidateCount = candidates.Length,
            candidates = results,
            ranking,
            selected = ranking.First().id
        };
        Directory.CreateDirectory(Path.GetDirectoryName(config.OutputPath)!);
        File.WriteAllText(config.OutputPath, JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(config.OutputPath);
        return 0;
    }

    static GateCandidate[] BuildCandidates()
    {
        var list = new List<GateCandidate>
        {
            new("none", "none", 0, 0, 0, 0, 1, 0, 0, 0, false),
            new("step04_oneFrameStopSnap_v20_h400_td0p25", "oneFrameStopSnap", 0, 400, 0.25, 0, 0, 1, 100, 0.5, false)
        };

        foreach (int n in new[] { 2, 4, 6, 8, 10, 12 })
        foreach (double stopV2 in new[] { 20.0, 100.0 })
        foreach (double releaseV2 in new[] { 100.0, 200.0 })
        foreach (double high in new[] { 400.0, 600.0, 800.0 })
        foreach (double stopTd in new[] { 0.25, 0.75 })
        foreach (double releaseTd in new[] { 0.5, 1.0 })
            list.Add(new($"postStopLatchN{n}_v{Fmt(stopV2)}_h{Fmt(high)}_td{Fmt(stopTd)}_rv{Fmt(releaseV2)}_rt{Fmt(releaseTd)}", "postStopLatchN", stopV2, high, stopTd, 0, 0, n, releaseV2, releaseTd, false));

        foreach (int n in new[] { 6, 10, 12 })
        foreach (double scale in new[] { 0.0, 0.1, 0.25, 0.5 })
        foreach (double stopV2 in new[] { 20.0, 100.0 })
        foreach (double high in new[] { 400.0, 600.0 })
        foreach (double stopTd in new[] { 0.25, 0.75 })
            list.Add(new($"postStopDecayN{n}_s{Fmt(scale)}_v{Fmt(stopV2)}_h{Fmt(high)}_td{Fmt(stopTd)}", "postStopDecayN", stopV2, high, stopTd, 0, scale, n, 150, 1.0, false));

        foreach (int n in new[] { 6, 10, 12 })
        foreach (double cap in new[] { 0.0, 0.25, 0.5, 0.75, 1.0 })
        foreach (double stopV2 in new[] { 20.0, 100.0 })
        foreach (double high in new[] { 400.0, 600.0 })
        foreach (double stopTd in new[] { 0.25, 0.75 })
            list.Add(new($"postStopCurrentDistanceCapN{n}_cap{Fmt(cap)}_v{Fmt(stopV2)}_h{Fmt(high)}_td{Fmt(stopTd)}", "postStopCurrentDistanceCap", stopV2, high, stopTd, cap, 1, n, 150, 1.0, false));

        foreach (int n in new[] { 6, 8, 10, 12 })
        foreach (string family in new[] { "postStopLatchN", "postStopDecayN" })
        foreach (double stopTd in new[] { 0.25, 0.5 })
        {
            double scale = family == "postStopDecayN" ? 0.25 : 0.0;
            list.Add(new($"oneFramePlus_{family}_N{n}_td{Fmt(stopTd)}", $"oneFramePlus_{family}", 20, 400, stopTd, 0, scale, n, 150, 1.0, true));
        }

        foreach (int n in new[] { 6, 10, 12 })
        foreach (double cap in new[] { 0.0, 0.25, 0.5, 0.75 })
        foreach (double high in new[] { 400.0, 600.0 })
            list.Add(new($"postStopDirectionClampN{n}_cap{Fmt(cap)}_h{Fmt(high)}", "postStopDirectionClamp", 20, high, 0.75, cap, 1, n, 150, 1.0, false));
        return list.ToArray();
    }

    static List<EvalRow> Evaluate((PackageConfig Package, List<RefPoint> Refs, List<CallPoint> Calls)[] recordings, GateCandidate gate, int horizonCapMs)
    {
        var all = new List<EvalRow>(200000);
        foreach (var recording in recordings)
        {
            var predictor = new DwmAwareCursorPositionPredictor(100, 100, horizonCapMs);
            predictor.ApplyPredictionModel(CursorMirrorSettings.DwmPredictionModelDistilledMlp);
            predictor.ApplyHorizonCapMilliseconds(horizonCapMs);
            predictor.ApplyPredictionTargetOffsetMilliseconds(-4);
            var counters = new CursorPredictionCounters();
            var history = new List<CallPoint>(16);
            var gateState = new GateState(false, 0, 0);
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
                if (TryInterpolate(recording.Refs, EffectiveElapsedUs(call, -4.0), out var shiftedTarget) &&
                    TryInterpolate(recording.Refs, EffectiveElapsedUs(call, 0.0), out var offset0Target))
                {
                    var f = RuntimeFeatures(call, history);
                    var gateResult = ApplyGate(gate, call, predicted, shiftedTarget, offset0Target, f, ref gateState);
                    all.Add(BuildEval(call, gateResult.Predicted, shiftedTarget, offset0Target, f, gateResult.Fired, gate.Family, gateResult.ActiveFrame));
                }
                history.Add(call);
                if (history.Count > 12) history.RemoveAt(0);
            }
        }
        return all;
    }

    static GateResult ApplyGate(GateCandidate gate, CallPoint call, PointF predicted, (double X, double Y, double Vx, double Vy, double Speed) shiftedTarget, (double X, double Y, double Vx, double Vy, double Speed) offset0Target, Features f, ref GateState state)
    {
        double dx = predicted.X - call.X;
        double dy = predicted.Y - call.Y;
        double targetDistance = Dist(call.X, call.Y, shiftedTarget.X, shiftedTarget.Y);
        double recentHigh = Math.Max(Math.Max(f.V5, f.V8), Math.Max(f.V12, f.RecentSegmentMax));
        bool oneFrameSnap = f.V2 <= 0.0 && recentHigh >= 400.0 && targetDistance <= 0.25;
        bool nearStop = f.V2 <= gate.StopV2Threshold && targetDistance <= gate.StopTargetDistanceThreshold;
        bool stopOnset = nearStop && !state.WasNearStop && recentHigh >= gate.HighSpeedThreshold;
        bool resume = state.RemainingFrames > 0 && (f.V2 > gate.ReleaseV2Threshold || targetDistance > gate.ReleaseTargetDistanceThreshold);

        if (gate.Family == "none")
        {
            state = state with { WasNearStop = nearStop, RemainingFrames = 0, ActiveFrame = 0 };
            return new GateResult(predicted, false, 0);
        }

        if (resume)
        {
            state = state with { RemainingFrames = 0, ActiveFrame = 0 };
        }

        if (gate.IncludeOneFrameSnap && oneFrameSnap)
        {
            state = state with { WasNearStop = nearStop, RemainingFrames = Math.Max(state.RemainingFrames, gate.LatchFrames - 1), ActiveFrame = 1 };
            return new GateResult(Hold(call), true, 1);
        }

        if (gate.Family == "oneFrameStopSnap" && oneFrameSnap)
        {
            state = state with { WasNearStop = nearStop, RemainingFrames = 0, ActiveFrame = 1 };
            return new GateResult(Hold(call), true, 1);
        }

        if (stopOnset)
        {
            state = state with { RemainingFrames = gate.LatchFrames, ActiveFrame = 0 };
        }

        bool active = state.RemainingFrames > 0;
        if (!active)
        {
            state = state with { WasNearStop = nearStop, ActiveFrame = 0 };
            return new GateResult(predicted, false, 0);
        }

        int activeFrame = state.ActiveFrame + 1;
        PointF gated = gate.Family switch
        {
            "postStopLatchN" => Hold(call),
            "oneFramePlus_postStopLatchN" => Hold(call),
            "postStopDecayN" => ScaleFromCurrent(call, dx, dy, DecayScale(gate, activeFrame)),
            "oneFramePlus_postStopDecayN" => ScaleFromCurrent(call, dx, dy, DecayScale(gate, activeFrame)),
            "postStopCurrentDistanceCap" => Cap(call, dx, dy, gate.CapPx),
            "postStopDirectionClamp" => DirectionClamp(call, predicted, dx, dy, f.DirX, f.DirY, gate.CapPx),
            _ => predicted
        };
        state = state with { WasNearStop = nearStop, RemainingFrames = Math.Max(0, state.RemainingFrames - 1), ActiveFrame = activeFrame };
        return new GateResult(gated, true, activeFrame);
    }

    static PointF Hold(CallPoint call) => new((float)call.X, (float)call.Y);
    static PointF ScaleFromCurrent(CallPoint call, double dx, double dy, double scale) => new((float)(call.X + dx * scale), (float)(call.Y + dy * scale));
    static double DecayScale(GateCandidate gate, int activeFrame)
    {
        if (gate.LatchFrames <= 1) return gate.Scale;
        double t = Math.Clamp((activeFrame - 1) / (double)(gate.LatchFrames - 1), 0.0, 1.0);
        return gate.Scale + (1.0 - gate.Scale) * t;
    }
    static PointF Cap(CallPoint call, double dx, double dy, double cap)
    {
        double mag = Math.Sqrt(dx * dx + dy * dy);
        if (mag <= cap || mag <= 1e-6) return new PointF((float)(call.X + dx), (float)(call.Y + dy));
        double scale = cap / mag;
        return new PointF((float)(call.X + dx * scale), (float)(call.Y + dy * scale));
    }
    static PointF DirectionClamp(CallPoint call, PointF predicted, double dx, double dy, double dirX, double dirY, double cap)
    {
        double along = dx * dirX + dy * dirY;
        if (along <= cap) return predicted;
        double reduce = along - cap;
        return new PointF((float)(predicted.X - reduce * dirX), (float)(predicted.Y - reduce * dirY));
    }

    static EvalRow BuildEval(CallPoint call, PointF predicted, (double X, double Y, double Vx, double Vy, double Speed) shiftedTarget, (double X, double Y, double Vx, double Vy, double Speed) offset0Target, Features f, bool fired, string family, int activeFrame)
    {
        double currentDx = predicted.X - call.X;
        double currentDy = predicted.Y - call.Y;
        double currentDistance = Math.Sqrt(currentDx * currentDx + currentDy * currentDy);
        double currentSigned = currentDx * f.DirX + currentDy * f.DirY;
        double errX = predicted.X - shiftedTarget.X;
        double errY = predicted.Y - shiftedTarget.Y;
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
        return new EvalRow(call.PackageId, call.ElapsedUs / 1000.0, visualError, currentDistance, currentSigned, Math.Max(0, currentSigned), currentDx, currentDy, f.DirX, f.DirY, f.V2, f.V5, f.V12, Dist(call.X, call.Y, shiftedTarget.X, shiftedTarget.Y), fastThenNearZero, hardBrake, stopAfterHighSpeed, oneFrameStop, postStopFirstFrames, normalMove, highSpeed, staticHold, fired, family, activeFrame);
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

    static object EventSummaries(List<EvalRow> rows)
    {
        var events = BuildStopEvents(rows, 6, 10).ToList();
        return new
        {
            preFrames = 6,
            postFrames = 10,
            count = events.Count,
            peakLead = EventStat(events.Select(e => e.PeakLeadPx).ToArray()),
            peakDistance = EventStat(events.Select(e => e.PeakDistancePx).ToArray()),
            returnMotion = EventStat(events.Select(e => e.ReturnMotionPx).ToArray()),
            overshootThenReturnRateGt0p5 = EventRate(events, e => e.PeakLeadPx > 0.5 && e.OvershootThenReturn),
            overshootThenReturnRateGt1 = EventRate(events, e => e.PeakLeadPx > 1.0 && e.OvershootThenReturn),
            leadGt0p5 = EventRate(events, e => e.PeakLeadPx > 0.5),
            leadGt1 = EventRate(events, e => e.PeakLeadPx > 1.0),
            leadGt2 = EventRate(events, e => e.PeakLeadPx > 2.0),
            distanceGt2 = EventRate(events, e => e.PeakDistancePx > 2.0),
            settleFrames0p5 = EventStat(events.Where(e => e.SettleFrames0p5 >= 0).Select(e => (double)e.SettleFrames0p5).ToArray()),
            settleFrames1p0 = EventStat(events.Where(e => e.SettleFrames1p0 >= 0).Select(e => (double)e.SettleFrames1p0).ToArray()),
            gateFireRateInWindows = events.Count == 0 ? 0.0 : events.Average(e => e.GateFireRate),
            byPhase = events.GroupBy(e => e.Phase).ToDictionary(g => g.Key, g => g.Count()),
            byPackage = events.GroupBy(e => e.PackageId).ToDictionary(g => g.Key, g => g.Count()),
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
                double preMax = ordered.Skip(Math.Max(0, i - preFrames)).Take(preFrames).Max(x => Math.Max(x.V5, x.V12));
                if (!nearStop || prevNearStop || preMax < 500.0)
                {
                    continue;
                }

                var dirRow = ordered.Skip(Math.Max(0, i - preFrames)).Take(preFrames).OrderByDescending(x => x.V12).First();
                double dirX = dirRow.DirX;
                double dirY = dirRow.DirY;
                if (Math.Sqrt(dirX * dirX + dirY * dirY) <= 1e-6)
                {
                    dirX = r.DirX;
                    dirY = r.DirY;
                }

                var window = ordered.Skip(i).Take(postFrames + 1).ToList();
                var leads = window.Select(w => w.CurrentDx * dirX + w.CurrentDy * dirY).ToArray();
                double peakLead = Math.Max(0.0, leads.Max());
                int peakFrame = Array.IndexOf(leads, leads.Max());
                double peakDistance = window.Max(w => w.CurrentDistance);
                double minDistanceAfterPeak = window.Skip(peakFrame).Select(w => w.CurrentDistance).DefaultIfEmpty(peakDistance).Min();
                double returnMotion = Math.Max(0.0, peakDistance - minDistanceAfterPeak);
                int settle0p5 = FirstSettleFrame(window, peakFrame, 0.5);
                int settle1p0 = FirstSettleFrame(window, peakFrame, 1.0);
                bool returned = peakLead > 0.5 && window.Skip(peakFrame).Any(w => w.CurrentDistance < 1.0);
                string phase = r.OneFrameStop ? "oneFrameStop" : r.HardBrake ? "hardBrake" : r.PostStopFirstFrames ? "postStopFirstFrames" : r.StopAfterHighSpeed ? "stopAfterHighSpeed" : "fastThenNearZero";
                yield return new StopEventSummary(
                    r.PackageId,
                    r.ElapsedMs,
                    phase,
                    preMax,
                    r.V2,
                    r.V5,
                    r.V12,
                    r.TargetDistance,
                    peakLead,
                    peakDistance,
                    peakFrame,
                    settle0p5,
                    settle1p0,
                    settle0p5 < 0 ? -1.0 : settle0p5 * 1000.0 / 60.0,
                    settle1p0 < 0 ? -1.0 : settle1p0 * 1000.0 / 60.0,
                    returnMotion,
                    returned && returnMotion > 0.5,
                    window.Count == 0 ? 0.0 : window.Count(w => w.GateFired) / (double)window.Count);
                i += 2;
            }
        }
    }

    static int FirstSettleFrame(List<EvalRow> window, int start, double threshold)
    {
        for (int i = Math.Max(0, start); i < window.Count; i++)
        {
            if (window[i].CurrentDistance < threshold)
            {
                return i - start;
            }
        }
        return -1;
    }

    static object SliceSummary(List<EvalRow> rows) => new
    {
        count = rows.Count,
        visualError = Stat(rows.Select(r => r.VisualError).ToArray()),
        currentDistance = Stat(rows.Select(r => r.CurrentDistance).ToArray()),
        currentOvershoot = Overshoot(rows, r => r.CurrentOvershoot),
        currentSignedMean = rows.Count == 0 ? 0 : rows.Average(r => r.CurrentSigned),
        currentLeadRate = Rate(rows, r => r.CurrentSigned > 0),
        currentLagRate = Rate(rows, r => r.CurrentSigned < 0)
    };

    static object GateFire(List<EvalRow> rows) => new
    {
        overall = Rate(rows, r => r.GateFired),
        fastThenNearZero = Rate(rows.Where(r => r.FastThenNearZero).ToList(), r => r.GateFired),
        hardBrake = Rate(rows.Where(r => r.HardBrake).ToList(), r => r.GateFired),
        stopAfterHighSpeed = Rate(rows.Where(r => r.StopAfterHighSpeed).ToList(), r => r.GateFired),
        oneFrameStop = Rate(rows.Where(r => r.OneFrameStop).ToList(), r => r.GateFired),
        postStopFirstFrames = Rate(rows.Where(r => r.PostStopFirstFrames).ToList(), r => r.GateFired),
        normalMove = Rate(rows.Where(r => r.NormalMove).ToList(), r => r.GateFired),
        highSpeed = Rate(rows.Where(r => r.HighSpeed).ToList(), r => r.GateFired),
        staticHold = Rate(rows.Where(r => r.StaticHold).ToList(), r => r.GateFired),
        movementResumeFalseSnapRows = rows.Count(r => r.GateFired && (r.V2 > 200.0 || r.TargetDistance > 1.0)),
        activeFrameDistribution = rows.Where(r => r.GateFired).GroupBy(r => r.GateActiveFrame).OrderBy(g => g.Key).ToDictionary(g => g.Key.ToString(CultureInfo.InvariantCulture), g => g.Count())
    };

    static object Objective(List<EvalRow> rows)
    {
        dynamic evt = EventSummaries(rows);
        dynamic normal = SliceSummary(rows.Where(r => r.NormalMove).ToList());
        dynamic high = SliceSummary(rows.Where(r => r.HighSpeed).ToList());
        dynamic stat = SliceSummary(rows.Where(r => r.StaticHold).ToList());
        dynamic fire = GateFire(rows);
        double primary = evt.leadGt1 * 1000 + evt.leadGt2 * 5000 + evt.peakLead.max + evt.returnMotion.p99 + evt.overshootThenReturnRateGt1 * 1000;
        double guardrail = Math.Max(0, normal.visualError.p95 - 1.7202085135293341) * 10 + Math.Max(0, high.visualError.p95 - 1.928247576431886) * 10 + Math.Max(0, stat.currentDistance.p95) * 10 + Math.Max(0, fire.overall - 0.01) * 100;
        return new { primaryObjective = primary, guardrailPenalty = guardrail, totalObjective = primary + guardrail };
    }

    static object TailExample(EvalRow r) => new { r.PackageId, elapsedMs = Math.Round(r.ElapsedMs, 3), r.GateFamily, r.GateFired, r.GateActiveFrame, currentOvershoot = Math.Round(r.CurrentOvershoot, 4), currentDistance = Math.Round(r.CurrentDistance, 4), v2 = Math.Round(r.V2, 1), v5 = Math.Round(r.V5, 1), v12 = Math.Round(r.V12, 1), targetDistance = Math.Round(r.TargetDistance, 4), visualError = Math.Round(r.VisualError, 4) };
    static object Stat(double[] values) { Array.Sort(values); return new { mean = Mean(values), p95 = Percentile(values, 0.95), p99 = Percentile(values, 0.99), max = values.Length == 0 ? 0 : values[^1] }; }
    static object EventStat(double[] values) { Array.Sort(values); return new { mean = Mean(values), p50 = Percentile(values, 0.50), p95 = Percentile(values, 0.95), p99 = Percentile(values, 0.99), max = values.Length == 0 ? 0 : values[^1] }; }
    static double EventRate(List<StopEventSummary> events, Func<StopEventSummary, bool> pred) => events.Count == 0 ? 0 : events.Count(pred) / (double)events.Count;
    static object Overshoot(List<EvalRow> rows, Func<EvalRow, double> selector) { var values = rows.Select(selector).ToArray(); Array.Sort(values); return new { p95 = Percentile(values, 0.95), p99 = Percentile(values, 0.99), max = values.Length == 0 ? 0 : values[^1], gt0p5 = Rate(rows, r => selector(r) > 0.5), gt1 = Rate(rows, r => selector(r) > 1), gt2 = Rate(rows, r => selector(r) > 2), gt4 = Rate(rows, r => selector(r) > 4) }; }

    static Features RuntimeFeatures(CallPoint call, List<CallPoint> history)
    {
        var v2 = VelocityWindow(call, history, 2);
        var v3 = VelocityWindow(call, history, 3);
        var v5 = VelocityWindow(call, history, 5);
        var v8 = VelocityWindow(call, history, 8);
        var v12 = VelocityWindow(call, history, 12);
        var path = BuildPath(call, history, 12);
        double recentSegmentMax = RecentSegmentMax(call, history, 6);
        double dirX = v12.X, dirY = v12.Y, mag = Math.Sqrt(dirX * dirX + dirY * dirY);
        if (mag > 1e-6) { dirX /= mag; dirY /= mag; } else { dirX = 0; dirY = 0; }
        return new Features(v2.Speed, v3.Speed, v5.Speed, v8.Speed, v12.Speed, recentSegmentMax, dirX, dirY, path.Net, path.Path, path.Efficiency);
    }
    static double RecentSegmentMax(CallPoint call, List<CallPoint> history, int sampleCount) { var pts = new List<CallPoint>(); int take = Math.Min(sampleCount - 1, history.Count); for (int i = history.Count - take; i < history.Count; i++) pts.Add(history[i]); pts.Add(call); double max = 0; for (int i = 1; i < pts.Count; i++) { double dt = (pts[i].ElapsedUs - pts[i - 1].ElapsedUs) / 1000000.0; if (dt <= 0) continue; double vx = (pts[i].X - pts[i - 1].X) / dt, vy = (pts[i].Y - pts[i - 1].Y) / dt; max = Math.Max(max, Math.Sqrt(vx * vx + vy * vy)); } return max; }
    static (double X, double Y, double Speed) VelocityWindow(CallPoint call, List<CallPoint> history, int sampleCount) { if (history.Count == 0) return (0, 0, 0); int back = Math.Min(sampleCount - 1, history.Count); var oldest = history[history.Count - back]; double dt = (call.ElapsedUs - oldest.ElapsedUs) / 1000000.0; if (dt <= 0) return (0, 0, 0); double vx = (call.X - oldest.X) / dt, vy = (call.Y - oldest.Y) / dt; return (vx, vy, Math.Sqrt(vx * vx + vy * vy)); }
    static (double Net, double Path, double Efficiency) BuildPath(CallPoint call, List<CallPoint> history, int sampleCount) { var pts = new List<(double X, double Y)>(); int take = Math.Min(sampleCount - 1, history.Count); for (int i = history.Count - take; i < history.Count; i++) pts.Add((history[i].X, history[i].Y)); pts.Add((call.X, call.Y)); if (pts.Count < 2) return (0, 0, 0); double path = 0; for (int i = 1; i < pts.Count; i++) path += Dist(pts[i - 1].X, pts[i - 1].Y, pts[i].X, pts[i].Y); double net = Dist(pts[0].X, pts[0].Y, call.X, call.Y); return (net, path, path > 1e-6 ? net / path : 0); }

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
        refs.Sort((a, b) => a.ElapsedUs.CompareTo(b.ElapsedUs)); calls.Sort((a, b) => a.SampleTicks.CompareTo(b.SampleTicks)); return (package, refs, calls);
    }
    static double EffectiveElapsedUs(CallPoint call, double offsetMs) => call.ElapsedUs + ((call.TargetTicks + (offsetMs * call.Frequency / 1000.0) - call.SampleTicks) * 1000000.0 / call.Frequency);
    static bool TryInterpolate(List<RefPoint> refs, double elapsedUs, out (double X, double Y, double Vx, double Vy, double Speed) result) { result = default; if (refs.Count < 2 || elapsedUs < refs[0].ElapsedUs || elapsedUs > refs[^1].ElapsedUs) return false; int lo = 0, hi = refs.Count - 1; while (lo + 1 < hi) { int mid = (lo + hi) / 2; if (refs[mid].ElapsedUs <= elapsedUs) lo = mid; else hi = mid; } var a = refs[lo]; var b = refs[Math.Min(lo + 1, refs.Count - 1)]; double span = Math.Max(1, b.ElapsedUs - a.ElapsedUs); double t = Math.Clamp((elapsedUs - a.ElapsedUs) / span, 0, 1); double x = a.X + (b.X - a.X) * t, y = a.Y + (b.Y - a.Y) * t; double vx = (b.X - a.X) * 1000000.0 / span, vy = (b.Y - a.Y) * 1000000.0 / span; result = (x, y, vx, vy, Math.Sqrt(vx * vx + vy * vy)); return true; }
    static IEnumerable<string> ParseCsvLine(string line) { var fields = new List<string>(); bool quoted = false; int start = 0; for (int i = 0; i < line.Length; i++) { if (line[i] == '"') quoted = !quoted; else if (line[i] == ',' && !quoted) { fields.Add(Unquote(line[start..i])); start = i + 1; } } fields.Add(Unquote(line[start..])); return fields; }
    static string Unquote(string value) => value.Length >= 2 && value[0] == '"' && value[^1] == '"' ? value[1..^1].Replace("\"\"", "\"") : value;
    static string Get(List<string> fields, Dictionary<string, int> index, string name) => index.TryGetValue(name, out int i) && i < fields.Count ? fields[i] : "";
    static double GetDouble(List<string> fields, Dictionary<string, int> index, string name, double fallback = 0) => double.TryParse(Get(fields, index, name), NumberStyles.Float, CultureInfo.InvariantCulture, out double v) ? v : fallback;
    static long GetLong(List<string> fields, Dictionary<string, int> index, string name, long fallback) => long.TryParse(Get(fields, index, name), NumberStyles.Integer, CultureInfo.InvariantCulture, out long v) ? v : fallback;
    static bool IsExcluded(double elapsedMs, Window[] windows) => windows != null && windows.Any(w => elapsedMs >= w.StartMs && elapsedMs < w.EndMs);
    static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    static double Rate(List<EvalRow> rows, Func<EvalRow, bool> pred) => rows.Count == 0 ? 0 : rows.Count(pred) / (double)rows.Count;
    static double Mean(double[] values) => values.Length == 0 ? 0 : values.Average();
    static double Percentile(double[] values, double p) { Array.Sort(values); return values.Length == 0 ? 0 : values[Math.Clamp((int)Math.Ceiling(values.Length * p) - 1, 0, values.Length - 1)]; }
    static string Fmt(double v) => v.ToString("0.##", CultureInfo.InvariantCulture).Replace(".", "p");
}
