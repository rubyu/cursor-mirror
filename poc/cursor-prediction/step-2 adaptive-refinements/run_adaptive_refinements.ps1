param(
    [string]$ZipPath,
    [string]$OutputPath,
    [double]$IdleGapMs = 100.0
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    $ZipPath = Join-Path $RepoRoot "cursor-mirror-trace-20260501-000443.zip"
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $ScriptDir "scores.json"
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$source = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;

public static class AdaptiveRefinementsExperiment
{
    sealed class TraceData
    {
        public int[] Sequence;
        public double[] T;
        public double[] X;
        public double[] Y;
        public string ZipPath;
    }

    sealed class Segments
    {
        public int[] Id;
        public int[] Start;
        public int Count;
    }

    sealed class Target
    {
        public bool[] Valid;
        public double[] X;
        public double[] Y;
        public double[] TargetTime;
    }

    sealed class Features
    {
        public bool[] Last2Valid;
        public double[] Last2Vx;
        public double[] Last2Vy;
        public bool[] AccValid;
        public double[] AccVx;
        public double[] AccVy;
        public double[] Ax;
        public double[] Ay;
        public Dictionary<double, bool[]> EmaValid = new Dictionary<double, bool[]>();
        public Dictionary<double, double[]> EmaVx = new Dictionary<double, double[]>();
        public Dictionary<double, double[]> EmaVy = new Dictionary<double, double[]>();
    }

    sealed class Model
    {
        public string Name;
        public string Family;
        public string Parameter;
        public string Cost;
        public string Kind;
        public double Gain;
        public double Alpha;
        public double BlendWeight;
        public double AccelTermCapPx;
    }

    sealed class ScoreRow
    {
        public string Model;
        public string Family;
        public string Parameter;
        public string Cost;
        public string HorizonMs;
        public string Split;
        public int N;
        public double Mean;
        public double Rmse;
        public double P50;
        public double P90;
        public double P95;
        public double P99;
        public double Max;
    }

    sealed class OnlineSelection
    {
        public double Beta;
        public int Horizon;
        public string Split;
        public int[] Counts;
    }

    sealed class Pred
    {
        public bool Valid;
        public double X;
        public double Y;
    }

    static readonly int[] Horizons = new int[] { 4, 8, 12, 16, 24, 32, 48 };
    static readonly double[] GainGrid = new double[] { 0.25, 0.5, 0.75, 0.875, 1.0, 1.125, 1.25, 1.5 };
    static readonly double[] EmaAlphas = new double[] { 0.35, 0.5, 0.75 };
    static readonly double[] BlendWeights = new double[] { 0.25, 0.5, 0.75 };
    static readonly double[] OnlineBetas = new double[] { 0.05, 0.1, 0.2 };

    public static void Run(string zipPath, string outputPath, double idleGapMs)
    {
        var totalWatch = Stopwatch.StartNew();
        string resolvedZip = Path.GetFullPath(zipPath);
        var data = ReadTrace(resolvedZip);
        var segments = GetSegments(data.T, idleGapMs);
        var targets = BuildTargets(data, segments.Id, idleGapMs);
        var features = BuildFeatures(data, segments.Start, idleGapMs);
        var models = BuildModels();
        int n = data.T.Length;
        int testStartIndex = (int)Math.Floor(n * 0.70);

        var rows = new List<ScoreRow>();
        var onlineSelections = new List<OnlineSelection>();
        long predictionCount = 0;
        long candidateCount = 0;
        long skippedNoTarget = 0;
        long skippedNoHistory = 0;
        var evalWatch = Stopwatch.StartNew();

        foreach (var model in models)
        {
            foreach (int h in Horizons)
            {
                var all = new List<double>();
                var train = new List<double>();
                var test = new List<double>();
                var target = targets[h];
                for (int i = 0; i < n; i++)
                {
                    candidateCount++;
                    if (!target.Valid[i])
                    {
                        skippedNoTarget++;
                        continue;
                    }

                    var pred = Predict(model, features, data, i, h);
                    if (!pred.Valid)
                    {
                        skippedNoHistory++;
                        continue;
                    }

                    double err = Distance(pred.X - target.X[i], pred.Y - target.Y[i]);
                    all.Add(err);
                    if (i >= testStartIndex) test.Add(err); else train.Add(err);
                    predictionCount++;
                }

                AddRows(rows, model.Name, model.Family, model.Parameter, model.Cost, h, all, train, test);
            }
        }

        var experts = BuildOnlineExperts();
        foreach (double beta in OnlineBetas)
        {
            foreach (int h in Horizons)
            {
                var result = EvaluateOnlineExperts(beta, h, experts, features, data, targets[h], testStartIndex);
                AddRows(rows, "online-expert-selection-beta-" + FormatDouble(beta), "online-expert-selection", "beta=" + FormatDouble(beta) + "; experts=" + JoinExpertNames(experts), "O(E): score matured predictions, choose min EWMA error; E=" + experts.Count.ToString(CultureInfo.InvariantCulture), h, result.AllErrors, result.TrainErrors, result.TestErrors);
                onlineSelections.Add(new OnlineSelection { Beta = beta, Horizon = h, Split = "all", Counts = result.CountsAll });
                onlineSelections.Add(new OnlineSelection { Beta = beta, Horizon = h, Split = "train_first_70pct", Counts = result.CountsTrain });
                onlineSelections.Add(new OnlineSelection { Beta = beta, Horizon = h, Split = "test_latter_30pct", Counts = result.CountsTest });
                predictionCount += result.AllErrors.Count;
                candidateCount += n;
                skippedNoTarget += result.SkippedNoTarget;
                skippedNoHistory += result.SkippedNoHistory;
            }
        }

        evalWatch.Stop();
        totalWatch.Stop();

        var json = BuildJson(data, segments, idleGapMs, rows, onlineSelections, experts, evalWatch.Elapsed.TotalSeconds, totalWatch.Elapsed.TotalSeconds, predictionCount, candidateCount, skippedNoTarget, skippedNoHistory, testStartIndex);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath)));
        File.WriteAllText(Path.GetFullPath(outputPath), json + Environment.NewLine);

        var best = BestRows(rows, "test_latter_30pct", 1)[0];
        Console.WriteLine("wrote " + Path.GetFullPath(outputPath));
        Console.WriteLine("samples=" + n.ToString(CultureInfo.InvariantCulture) + " segments=" + segments.Count.ToString(CultureInfo.InvariantCulture));
        Console.WriteLine("best_test=" + best.Model + " horizon=" + best.HorizonMs + "ms mean=" + FormatMetric(best.Mean) + "px p95=" + FormatMetric(best.P95) + "px p99=" + FormatMetric(best.P99) + "px n=" + best.N.ToString(CultureInfo.InvariantCulture));
        Console.WriteLine("predictions=" + predictionCount.ToString(CultureInfo.InvariantCulture) + " elapsed_sec=" + FormatMetric(evalWatch.Elapsed.TotalSeconds) + " predictions_per_sec=" + FormatMetric(predictionCount / Math.Max(evalWatch.Elapsed.TotalSeconds, 0.000001)));
    }

    sealed class OnlineResult
    {
        public List<double> AllErrors = new List<double>();
        public List<double> TrainErrors = new List<double>();
        public List<double> TestErrors = new List<double>();
        public int[] CountsAll;
        public int[] CountsTrain;
        public int[] CountsTest;
        public long SkippedNoTarget;
        public long SkippedNoHistory;
    }

    static OnlineResult EvaluateOnlineExperts(double beta, int h, List<Model> experts, Features features, TraceData data, Target target, int testStartIndex)
    {
        int n = data.T.Length;
        var result = new OnlineResult();
        result.CountsAll = new int[experts.Count];
        result.CountsTrain = new int[experts.Count];
        result.CountsTest = new int[experts.Count];
        var scores = new double[experts.Count];
        var initialized = new bool[experts.Count];
        int updateCursor = 0;

        for (int i = 0; i < n; i++)
        {
            while (updateCursor < i && target.TargetTime[updateCursor] <= data.T[i])
            {
                if (target.Valid[updateCursor])
                {
                    for (int e = 0; e < experts.Count; e++)
                    {
                        var predForScore = Predict(experts[e], features, data, updateCursor, h);
                        if (!predForScore.Valid) continue;
                        double err = Distance(predForScore.X - target.X[updateCursor], predForScore.Y - target.Y[updateCursor]);
                        if (!initialized[e])
                        {
                            scores[e] = err;
                            initialized[e] = true;
                        }
                        else
                        {
                            scores[e] = beta * err + (1.0 - beta) * scores[e];
                        }
                    }
                }
                updateCursor++;
            }

            if (!target.Valid[i])
            {
                result.SkippedNoTarget++;
                continue;
            }

            int selected = -1;
            double bestScore = double.PositiveInfinity;
            for (int e = 0; e < experts.Count; e++)
            {
                var predForValidity = Predict(experts[e], features, data, i, h);
                if (!predForValidity.Valid) continue;
                if (initialized[e] && scores[e] < bestScore)
                {
                    bestScore = scores[e];
                    selected = e;
                }
            }
            if (selected < 0)
            {
                selected = SelectColdStartExpert(experts, features, data, i, h);
            }
            if (selected < 0)
            {
                result.SkippedNoHistory++;
                continue;
            }

            var pred = Predict(experts[selected], features, data, i, h);
            if (!pred.Valid)
            {
                result.SkippedNoHistory++;
                continue;
            }
            double currentErr = Distance(pred.X - target.X[i], pred.Y - target.Y[i]);
            result.AllErrors.Add(currentErr);
            result.CountsAll[selected]++;
            if (i >= testStartIndex)
            {
                result.TestErrors.Add(currentErr);
                result.CountsTest[selected]++;
            }
            else
            {
                result.TrainErrors.Add(currentErr);
                result.CountsTrain[selected]++;
            }
        }
        return result;
    }

    static int SelectColdStartExpert(List<Model> experts, Features features, TraceData data, int i, int h)
    {
        for (int e = 0; e < experts.Count; e++)
        {
            if (experts[e].Name == "constant-velocity-last2-gain-1" && Predict(experts[e], features, data, i, h).Valid) return e;
        }
        for (int e = 0; e < experts.Count; e++)
        {
            if (experts[e].Name == "hold-current" && Predict(experts[e], features, data, i, h).Valid) return e;
        }
        for (int e = 0; e < experts.Count; e++)
        {
            if (Predict(experts[e], features, data, i, h).Valid) return e;
        }
        return -1;
    }

    static List<Model> BuildOnlineExperts()
    {
        return new List<Model> {
            new Model { Name = "constant-velocity-last2-gain-0.75", Family = "last2-gain", Parameter = "gain=0.75", Cost = "O(1)", Kind = "last2-gain", Gain = 0.75 },
            new Model { Name = "constant-velocity-last2-gain-0.875", Family = "last2-gain", Parameter = "gain=0.875", Cost = "O(1)", Kind = "last2-gain", Gain = 0.875 },
            new Model { Name = "constant-velocity-last2-gain-1", Family = "last2-gain", Parameter = "gain=1", Cost = "O(1)", Kind = "last2-gain", Gain = 1.0 },
            new Model { Name = "constant-velocity-last2-gain-1.125", Family = "last2-gain", Parameter = "gain=1.125", Cost = "O(1)", Kind = "last2-gain", Gain = 1.125 },
            new Model { Name = "ema-velocity-alpha-0.75", Family = "ema", Parameter = "alpha=0.75", Cost = "O(1)", Kind = "ema", Alpha = 0.75 },
            new Model { Name = "hold-current", Family = "hold", Parameter = "", Cost = "O(1)", Kind = "hold" }
        };
    }

    static List<Model> BuildModels()
    {
        var models = new List<Model>();
        models.Add(new Model { Name = "hold-current", Family = "hold", Parameter = "", Cost = "O(1): current position only", Kind = "hold" });
        models.Add(new Model { Name = "constant-velocity-last2", Family = "baseline-last2", Parameter = "gain=1; cap=none", Cost = "O(1): one interval velocity", Kind = "last2-gain", Gain = 1.0 });
        foreach (double gain in GainGrid)
        {
            models.Add(new Model { Name = "constant-velocity-last2-gain-" + FormatDouble(gain), Family = "last2-gain-grid", Parameter = "gain=" + FormatDouble(gain) + "; cap=none", Cost = "O(1): one interval velocity times scalar", Kind = "last2-gain", Gain = gain });
        }
        models.Add(new Model { Name = "constant-acceleration-last3", Family = "constant-acceleration-last3", Parameter = "unclamped", Cost = "O(1): two velocities plus acceleration", Kind = "acc" });
        foreach (double cap in new double[] { 2.0, 4.0, 8.0, 16.0 })
        {
            models.Add(new Model { Name = "constant-acceleration-last3-accelterm-cap-" + FormatDouble(cap) + "px", Family = "constant-acceleration-last3-clamped", Parameter = "acceleration_term_cap_px=" + FormatDouble(cap), Cost = "O(1): acceleration with vector cap on 0.5*a*h^2 term", Kind = "acc-cap", AccelTermCapPx = cap });
        }
        foreach (double alpha in EmaAlphas)
        {
            models.Add(new Model { Name = "ema-velocity-alpha-" + FormatDouble(alpha), Family = "ema", Parameter = "alpha=" + FormatDouble(alpha), Cost = "O(1): recursive velocity EMA", Kind = "ema", Alpha = alpha });
        }
        foreach (double alpha in EmaAlphas)
        {
            foreach (double w in BlendWeights)
            {
                models.Add(new Model { Name = "velocity-blend-last2-w-" + FormatDouble(w) + "-ema-alpha-" + FormatDouble(alpha), Family = "velocity-blend", Parameter = "last2_weight=" + FormatDouble(w) + "; ema_alpha=" + FormatDouble(alpha), Cost = "O(1): weighted average of last2 and EMA velocity", Kind = "blend", Alpha = alpha, BlendWeight = w });
            }
        }
        return models;
    }

    static Pred Predict(Model model, Features f, TraceData data, int i, int h)
    {
        if (model.Kind == "hold")
        {
            return new Pred { Valid = true, X = data.X[i], Y = data.Y[i] };
        }
        if (model.Kind == "last2-gain")
        {
            if (!f.Last2Valid[i]) return new Pred { Valid = false };
            return new Pred { Valid = true, X = data.X[i] + f.Last2Vx[i] * h * model.Gain, Y = data.Y[i] + f.Last2Vy[i] * h * model.Gain };
        }
        if (model.Kind == "ema")
        {
            if (!f.EmaValid[model.Alpha][i]) return new Pred { Valid = false };
            return new Pred { Valid = true, X = data.X[i] + f.EmaVx[model.Alpha][i] * h, Y = data.Y[i] + f.EmaVy[model.Alpha][i] * h };
        }
        if (model.Kind == "blend")
        {
            if (!f.Last2Valid[i] || !f.EmaValid[model.Alpha][i]) return new Pred { Valid = false };
            double vx = model.BlendWeight * f.Last2Vx[i] + (1.0 - model.BlendWeight) * f.EmaVx[model.Alpha][i];
            double vy = model.BlendWeight * f.Last2Vy[i] + (1.0 - model.BlendWeight) * f.EmaVy[model.Alpha][i];
            return new Pred { Valid = true, X = data.X[i] + vx * h, Y = data.Y[i] + vy * h };
        }
        if (model.Kind == "acc" || model.Kind == "acc-cap")
        {
            if (!f.AccValid[i]) return new Pred { Valid = false };
            double accelDx = 0.5 * f.Ax[i] * h * h;
            double accelDy = 0.5 * f.Ay[i] * h * h;
            if (model.Kind == "acc-cap")
            {
                double accelLen = Distance(accelDx, accelDy);
                if (accelLen > model.AccelTermCapPx && accelLen > 0.0)
                {
                    double s = model.AccelTermCapPx / accelLen;
                    accelDx *= s;
                    accelDy *= s;
                }
            }
            return new Pred { Valid = true, X = data.X[i] + f.AccVx[i] * h + accelDx, Y = data.Y[i] + f.AccVy[i] * h + accelDy };
        }
        return new Pred { Valid = false };
    }

    static Features BuildFeatures(TraceData data, int[] segmentStart, double idleGapMs)
    {
        int n = data.T.Length;
        var f = new Features();
        f.Last2Valid = new bool[n];
        f.Last2Vx = new double[n];
        f.Last2Vy = new double[n];
        f.AccValid = new bool[n];
        f.AccVx = new double[n];
        f.AccVy = new double[n];
        f.Ax = new double[n];
        f.Ay = new double[n];

        for (int i = 1; i < n; i++)
        {
            if (i - 1 < segmentStart[i]) continue;
            double dt = data.T[i] - data.T[i - 1];
            if (dt <= 0.0 || dt > idleGapMs) continue;
            f.Last2Vx[i] = (data.X[i] - data.X[i - 1]) / dt;
            f.Last2Vy[i] = (data.Y[i] - data.Y[i - 1]) / dt;
            f.Last2Valid[i] = true;
        }

        for (int i = 2; i < n; i++)
        {
            if (i - 2 < segmentStart[i]) continue;
            double dt1 = data.T[i - 1] - data.T[i - 2];
            double dt2 = data.T[i] - data.T[i - 1];
            if (dt1 <= 0.0 || dt2 <= 0.0 || dt1 > idleGapMs || dt2 > idleGapMs) continue;
            double v1x = (data.X[i - 1] - data.X[i - 2]) / dt1;
            double v1y = (data.Y[i - 1] - data.Y[i - 2]) / dt1;
            double v2x = (data.X[i] - data.X[i - 1]) / dt2;
            double v2y = (data.Y[i] - data.Y[i - 1]) / dt2;
            double centerDt = (dt1 + dt2) * 0.5;
            if (centerDt <= 0.0) continue;
            f.AccVx[i] = v2x;
            f.AccVy[i] = v2y;
            f.Ax[i] = (v2x - v1x) / centerDt;
            f.Ay[i] = (v2y - v1y) / centerDt;
            f.AccValid[i] = true;
        }

        foreach (double alpha in EmaAlphas)
        {
            var valid = new bool[n];
            var vx = new double[n];
            var vy = new double[n];
            bool has = false;
            double currentVx = 0.0;
            double currentVy = 0.0;
            for (int i = 1; i < n; i++)
            {
                double dt = data.T[i] - data.T[i - 1];
                if (dt <= 0.0 || dt > idleGapMs)
                {
                    has = false;
                    continue;
                }
                double instantVx = (data.X[i] - data.X[i - 1]) / dt;
                double instantVy = (data.Y[i] - data.Y[i - 1]) / dt;
                if (!has)
                {
                    currentVx = instantVx;
                    currentVy = instantVy;
                    has = true;
                }
                else
                {
                    currentVx = alpha * instantVx + (1.0 - alpha) * currentVx;
                    currentVy = alpha * instantVy + (1.0 - alpha) * currentVy;
                }
                vx[i] = currentVx;
                vy[i] = currentVy;
                valid[i] = true;
            }
            f.EmaValid[alpha] = valid;
            f.EmaVx[alpha] = vx;
            f.EmaVy[alpha] = vy;
        }
        return f;
    }

    static Dictionary<int, Target> BuildTargets(TraceData data, int[] segmentIds, double idleGapMs)
    {
        int n = data.T.Length;
        double lastTime = data.T[n - 1];
        var result = new Dictionary<int, Target>();
        foreach (int h in Horizons)
        {
            var target = new Target { Valid = new bool[n], X = new double[n], Y = new double[n], TargetTime = new double[n] };
            int j = 0;
            for (int i = 0; i < n; i++)
            {
                double targetTime = data.T[i] + h;
                target.TargetTime[i] = targetTime;
                if (targetTime > lastTime) continue;
                if (j < i) j = i;
                while (j + 1 < n && data.T[j + 1] <= targetTime) j++;
                if (j == n - 1)
                {
                    if (targetTime == data.T[n - 1] && segmentIds[j] == segmentIds[i])
                    {
                        target.Valid[i] = true;
                        target.X[i] = data.X[j];
                        target.Y[i] = data.Y[j];
                    }
                    continue;
                }
                if (segmentIds[j] != segmentIds[i] || segmentIds[j + 1] != segmentIds[i]) continue;
                double gap = data.T[j + 1] - data.T[j];
                if (gap <= 0.0 || gap > idleGapMs) continue;
                double ratio = (targetTime - data.T[j]) / gap;
                target.Valid[i] = true;
                target.X[i] = data.X[j] + (data.X[j + 1] - data.X[j]) * ratio;
                target.Y[i] = data.Y[j] + (data.Y[j + 1] - data.Y[j]) * ratio;
            }
            result[h] = target;
        }
        return result;
    }

    static Segments GetSegments(double[] times, double threshold)
    {
        int n = times.Length;
        var s = new Segments { Id = new int[n], Start = new int[n] };
        int current = 0;
        int start = 0;
        for (int i = 1; i < n; i++)
        {
            double gap = times[i] - times[i - 1];
            if (gap > threshold || gap <= 0.0)
            {
                current++;
                start = i;
            }
            s.Id[i] = current;
            s.Start[i] = start;
        }
        s.Count = current + 1;
        return s;
    }

    static TraceData ReadTrace(string zipPath)
    {
        var seq = new List<int>();
        var t = new List<double>();
        var x = new List<double>();
        var y = new List<double>();
        using (var zip = ZipFile.OpenRead(zipPath))
        {
            var entry = zip.GetEntry("trace.csv");
            if (entry == null) throw new Exception("trace.csv was not found in " + zipPath);
            using (var reader = new StreamReader(entry.Open()))
            {
                string header = reader.ReadLine();
                if (header != "sequence,stopwatchTicks,elapsedMicroseconds,x,y,event") throw new Exception("Unexpected trace.csv header: " + header);
                while (true)
                {
                    string line = reader.ReadLine();
                    if (line == null) break;
                    if (line.Trim().Length == 0) continue;
                    string[] p = line.Split(',');
                    if (p.Length != 6) throw new Exception("Unexpected CSV row: " + line);
                    seq.Add(int.Parse(p[0], CultureInfo.InvariantCulture));
                    t.Add(long.Parse(p[2], CultureInfo.InvariantCulture) / 1000.0);
                    x.Add(double.Parse(p[3], CultureInfo.InvariantCulture));
                    y.Add(double.Parse(p[4], CultureInfo.InvariantCulture));
                }
            }
        }
        return new TraceData { Sequence = seq.ToArray(), T = t.ToArray(), X = x.ToArray(), Y = y.ToArray(), ZipPath = zipPath };
    }

    static void AddRows(List<ScoreRow> rows, string model, string family, string parameter, string cost, int h, List<double> all, List<double> train, List<double> test)
    {
        rows.Add(MakeRow(model, family, parameter, cost, h, "all", all));
        rows.Add(MakeRow(model, family, parameter, cost, h, "train_first_70pct", train));
        rows.Add(MakeRow(model, family, parameter, cost, h, "test_latter_30pct", test));
    }

    static ScoreRow MakeRow(string model, string family, string parameter, string cost, int h, string split, List<double> errors)
    {
        errors.Sort();
        int n = errors.Count;
        double sum = 0.0;
        double sumSq = 0.0;
        for (int i = 0; i < n; i++)
        {
            sum += errors[i];
            sumSq += errors[i] * errors[i];
        }
        return new ScoreRow {
            Model = model,
            Family = family,
            Parameter = parameter,
            Cost = cost,
            HorizonMs = h.ToString(CultureInfo.InvariantCulture),
            Split = split,
            N = n,
            Mean = n == 0 ? double.NaN : sum / n,
            Rmse = n == 0 ? double.NaN : Math.Sqrt(sumSq / n),
            P50 = Percentile(errors, 0.50),
            P90 = Percentile(errors, 0.90),
            P95 = Percentile(errors, 0.95),
            P99 = Percentile(errors, 0.99),
            Max = n == 0 ? double.NaN : errors[n - 1]
        };
    }

    static double Percentile(List<double> sorted, double p)
    {
        int n = sorted.Count;
        if (n == 0) return double.NaN;
        if (n == 1) return sorted[0];
        double rank = (n - 1) * p;
        int lo = (int)Math.Floor(rank);
        int hi = (int)Math.Ceiling(rank);
        if (lo == hi) return sorted[lo];
        double weight = rank - lo;
        return sorted[lo] * (1.0 - weight) + sorted[hi] * weight;
    }

    static List<ScoreRow> BestRows(List<ScoreRow> rows, string split, int limit)
    {
        var filtered = new List<ScoreRow>();
        foreach (var row in rows)
        {
            if (row.Split == split && row.N > 0) filtered.Add(row);
        }
        filtered.Sort(delegate(ScoreRow a, ScoreRow b) {
            int c = a.Mean.CompareTo(b.Mean);
            if (c != 0) return c;
            c = a.P95.CompareTo(b.P95);
            if (c != 0) return c;
            return string.CompareOrdinal(a.Model, b.Model);
        });
        if (filtered.Count > limit) filtered.RemoveRange(limit, filtered.Count - limit);
        return filtered;
    }

    static List<ScoreRow> BestByHorizon(List<ScoreRow> rows, string split)
    {
        var result = new List<ScoreRow>();
        foreach (int h in Horizons)
        {
            ScoreRow best = null;
            foreach (var row in rows)
            {
                if (row.Split != split || row.HorizonMs != h.ToString(CultureInfo.InvariantCulture) || row.N == 0) continue;
                if (best == null || row.Mean < best.Mean || (row.Mean == best.Mean && row.P95 < best.P95)) best = row;
            }
            if (best != null) result.Add(best);
        }
        return result;
    }

    static string BuildJson(TraceData data, Segments segments, double idleGapMs, List<ScoreRow> rows, List<OnlineSelection> selections, List<Model> onlineExperts, double evalSec, double totalSec, long predictionCount, long candidateCount, long skippedNoTarget, long skippedNoHistory, int testStartIndex)
    {
        var sb = new StringBuilder();
        var w = new JsonWriter(sb);
        w.BeginObject();
        w.Name("experiment"); w.BeginObject();
        w.Prop("name", "step-2 adaptive-refinements");
        w.Prop("source_zip", data.ZipPath);
        w.Prop("trace_entry", "trace.csv");
        w.Prop("generated_by", "run_adaptive_refinements.ps1");
        w.Prop("idle_gap_threshold_ms", idleGapMs);
        w.Name("horizons_ms"); w.BeginArray(); foreach (int h in Horizons) w.Value(h); w.EndArray();
        w.Name("split_policy"); w.BeginObject();
        w.Prop("all", "all valid anchors");
        w.Prop("train_first_70pct", "first 70% of sample indices, metrics only");
        w.Prop("test_latter_30pct", "last 30% of sample indices; primary comparison");
        w.EndObject();
        w.Prop("future_leak_policy", "Targets are linearly interpolated, but online expert scores are updated only when each past prediction's target time has reached the current sample time.");
        w.EndObject();

        w.Name("data"); w.BeginObject();
        w.Prop("samples", data.T.Length);
        w.Prop("segments_after_100ms_gap_split", segments.Count);
        w.Prop("first_elapsed_ms", data.T[0]);
        w.Prop("last_elapsed_ms", data.T[data.T.Length - 1]);
        w.Prop("duration_sec", (data.T[data.T.Length - 1] - data.T[0]) / 1000.0);
        w.EndObject();

        w.Name("scores"); w.BeginArray();
        foreach (var row in rows) WriteScoreRow(w, row);
        w.EndArray();

        w.Name("best"); w.BeginObject();
        w.Name("test_overall_top20"); w.BeginArray(); foreach (var row in BestRows(rows, "test_latter_30pct", 20)) WriteScoreRow(w, row); w.EndArray();
        w.Name("test_best_by_horizon"); w.BeginArray(); foreach (var row in BestByHorizon(rows, "test_latter_30pct")) WriteScoreRow(w, row); w.EndArray();
        w.Name("all_best_by_horizon"); w.BeginArray(); foreach (var row in BestByHorizon(rows, "all")) WriteScoreRow(w, row); w.EndArray();
        w.EndObject();

        w.Name("baseline_comparison_test"); w.BeginArray();
        foreach (int h in Horizons)
        {
            var baseline = FindRow(rows, "constant-velocity-last2", h, "test_latter_30pct");
            var best = FindBestForHorizon(rows, h, "test_latter_30pct");
            if (baseline == null || best == null) continue;
            w.BeginObject();
            w.Prop("horizon_ms", h);
            w.Prop("baseline_model", baseline.Model);
            w.Prop("baseline_mean_px", baseline.Mean);
            w.Prop("baseline_p95_px", baseline.P95);
            w.Prop("baseline_p99_px", baseline.P99);
            w.Prop("best_model", best.Model);
            w.Prop("best_mean_px", best.Mean);
            w.Prop("best_p95_px", best.P95);
            w.Prop("best_p99_px", best.P99);
            w.Prop("mean_change_pct_vs_baseline", PercentChange(best.Mean, baseline.Mean));
            w.Prop("p95_change_pct_vs_baseline", PercentChange(best.P95, baseline.P95));
            w.Prop("p99_change_pct_vs_baseline", PercentChange(best.P99, baseline.P99));
            w.EndObject();
        }
        w.EndArray();

        w.Name("online_expert_selection"); w.BeginObject();
        w.Name("experts"); w.BeginArray(); foreach (var expert in onlineExperts) w.Value(expert.Name); w.EndArray();
        w.Prop("ewma_betas", "0.05, 0.1, 0.2");
        w.Prop("score_update_rule", "score = beta * newly_observed_error + (1 - beta) * previous_score; update happens only after the target timestamp is observable.");
        w.Name("selection_counts"); w.BeginArray();
        foreach (var s in selections)
        {
            w.BeginObject();
            w.Prop("beta", s.Beta);
            w.Prop("horizon_ms", s.Horizon);
            w.Prop("split", s.Split);
            w.Name("counts"); w.BeginObject();
            for (int i = 0; i < onlineExperts.Count; i++) w.Prop(onlineExperts[i].Name, s.Counts[i]);
            w.EndObject();
            w.EndObject();
        }
        w.EndArray();
        w.EndObject();

        w.Name("performance"); w.BeginObject();
        w.Prop("evaluation_elapsed_sec", evalSec);
        w.Prop("total_script_elapsed_sec", totalSec);
        w.Prop("prediction_count", predictionCount);
        w.Prop("candidate_count", candidateCount);
        w.Prop("predictions_per_sec", predictionCount / Math.Max(evalSec, 0.000001));
        w.Prop("skipped_no_target_or_crossed_gap", skippedNoTarget);
        w.Prop("skipped_no_history", skippedNoHistory);
        w.Prop("test_start_index", testStartIndex);
        w.Prop("test_start_sequence", data.Sequence[testStartIndex]);
        w.Prop("test_start_elapsed_ms", data.T[testStartIndex]);
        w.Prop("note", "Timing is one local run and includes .NET zip reading, model evaluation, and JSON writing. Use as rough relative guidance only.");
        w.EndObject();

        w.Name("notes"); w.BeginArray();
        w.Value("No external network or additional dependencies were used.");
        w.Value("trace.csv was streamed from the zip and was not extracted or copied into the poc directory.");
        w.Value("Main comparison is test_latter_30pct; all split is included for stability checks.");
        w.Value("Tail safety should consider p99 and max, not mean alone.");
        w.EndArray();
        w.EndObject();
        return sb.ToString();
    }

    static ScoreRow FindRow(List<ScoreRow> rows, string model, int h, string split)
    {
        string hs = h.ToString(CultureInfo.InvariantCulture);
        foreach (var row in rows) if (row.Model == model && row.HorizonMs == hs && row.Split == split) return row;
        return null;
    }

    static ScoreRow FindBestForHorizon(List<ScoreRow> rows, int h, string split)
    {
        string hs = h.ToString(CultureInfo.InvariantCulture);
        ScoreRow best = null;
        foreach (var row in rows)
        {
            if (row.HorizonMs != hs || row.Split != split || row.N == 0) continue;
            if (best == null || row.Mean < best.Mean || (row.Mean == best.Mean && row.P95 < best.P95)) best = row;
        }
        return best;
    }

    static void WriteScoreRow(JsonWriter w, ScoreRow row)
    {
        w.BeginObject();
        w.Prop("model", row.Model);
        w.Prop("family", row.Family);
        w.Prop("parameter", row.Parameter);
        w.Prop("model_cost_estimate", row.Cost);
        w.Prop("horizon_ms", int.Parse(row.HorizonMs, CultureInfo.InvariantCulture));
        w.Prop("split", row.Split);
        w.Prop("n", row.N);
        w.Prop("mean_px", row.Mean);
        w.Prop("rmse_px", row.Rmse);
        w.Prop("p50_px", row.P50);
        w.Prop("p90_px", row.P90);
        w.Prop("p95_px", row.P95);
        w.Prop("p99_px", row.P99);
        w.Prop("max_px", row.Max);
        w.EndObject();
    }

    sealed class JsonWriter
    {
        readonly StringBuilder _sb;
        readonly Stack<bool> _first = new Stack<bool>();
        bool _afterName;

        public JsonWriter(StringBuilder sb) { _sb = sb; }
        public void BeginObject() { PrefixValue(); _sb.Append("{"); _first.Push(true); _afterName = false; }
        public void EndObject() { _sb.Append("}"); _first.Pop(); _afterName = false; }
        public void BeginArray() { PrefixValue(); _sb.Append("["); _first.Push(true); _afterName = false; }
        public void EndArray() { _sb.Append("]"); _first.Pop(); _afterName = false; }
        public void Name(string name) { PrefixMember(); WriteString(name); _sb.Append(":"); _afterName = true; }
        public void Prop(string name, string value) { Name(name); Value(value); }
        public void Prop(string name, int value) { Name(name); Value(value); }
        public void Prop(string name, long value) { Name(name); Value(value); }
        public void Prop(string name, double value) { Name(name); Value(value); }
        public void Value(string value) { PrefixValue(); if (value == null) _sb.Append("null"); else WriteString(value); _afterName = false; }
        public void Value(int value) { PrefixValue(); _sb.Append(value.ToString(CultureInfo.InvariantCulture)); _afterName = false; }
        public void Value(long value) { PrefixValue(); _sb.Append(value.ToString(CultureInfo.InvariantCulture)); _afterName = false; }
        public void Value(double value) { PrefixValue(); if (double.IsNaN(value) || double.IsInfinity(value)) _sb.Append("null"); else _sb.Append(value.ToString("R", CultureInfo.InvariantCulture)); _afterName = false; }
        void PrefixMember() { if (_first.Count == 0) return; if (_first.Peek()) { _first.Pop(); _first.Push(false); } else _sb.Append(","); }
        void PrefixValue() { if (_afterName) return; if (_first.Count == 0) return; if (_first.Peek()) { _first.Pop(); _first.Push(false); } else _sb.Append(","); }
        void WriteString(string value)
        {
            _sb.Append("\"");
            foreach (char c in value)
            {
                switch (c)
                {
                    case '\\': _sb.Append("\\\\"); break;
                    case '"': _sb.Append("\\\""); break;
                    case '\n': _sb.Append("\\n"); break;
                    case '\r': _sb.Append("\\r"); break;
                    case '\t': _sb.Append("\\t"); break;
                    default:
                        if (c < 32) _sb.Append("\\u" + ((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else _sb.Append(c);
                        break;
                }
            }
            _sb.Append("\"");
        }
    }

    static string JoinExpertNames(List<Model> experts)
    {
        var names = new List<string>();
        foreach (var e in experts) names.Add(e.Name);
        return string.Join("|", names.ToArray());
    }

    static double Distance(double x, double y) { return Math.Sqrt(x * x + y * y); }
    static double PercentChange(double current, double baseline) { return baseline == 0.0 ? double.NaN : (current - baseline) / baseline * 100.0; }
    static string FormatDouble(double value) { return value.ToString("0.###", CultureInfo.InvariantCulture); }
    static string FormatMetric(double value) { return value.ToString("0.###", CultureInfo.InvariantCulture); }
}
"@

if (-not ("AdaptiveRefinementsExperiment" -as [type])) {
    Add-Type -TypeDefinition $source -Language CSharp
}

[AdaptiveRefinementsExperiment]::Run(
    (Resolve-Path -LiteralPath $ZipPath).Path,
    ([IO.Path]::GetFullPath($OutputPath)),
    $IdleGapMs
)
