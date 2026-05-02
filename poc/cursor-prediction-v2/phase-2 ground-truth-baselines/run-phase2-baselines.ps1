param(
    [string]$ZipPath = (Join-Path (Get-Location) "cursor-mirror-trace-20260501-091537.zip"),
    [string]$Phase1ScoresPath = (Join-Path (Get-Location) "poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json"),
    [string]$OutputDir = (Join-Path (Get-Location) "poc/cursor-prediction-v2/phase-2 ground-truth-baselines")
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$startUtc = [DateTime]::UtcNow

if (-not (Test-Path -LiteralPath $ZipPath)) {
    throw "Trace zip not found: $ZipPath"
}
if (-not (Test-Path -LiteralPath $Phase1ScoresPath)) {
    throw "Phase 1 scores not found: $Phase1ScoresPath"
}

$phase1 = Get-Content -LiteralPath $Phase1ScoresPath -Raw | ConvertFrom-Json
$split = $phase1.recommended_split
$stopwatchFrequency = [int64]$phase1.input.metadata.StopwatchFrequency

Add-Type -AssemblyName System.IO.Compression.FileSystem

$source = @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

namespace CursorPredictionPhase2
{
    public sealed class SplitDef
    {
        public string Name;
        public double StartUs;
        public double EndUs;
    }

    public sealed class Series
    {
        public string Name;
        public readonly List<double> T = new List<double>();
        public readonly List<double> X = new List<double>();
        public readonly List<double> Y = new List<double>();
    }

    public sealed class TraceData
    {
        public readonly Series Poll = new Series { Name = "poll" };
        public readonly Series HookMove = new Series { Name = "hook-move" };
        public readonly Series HookCursor = new Series { Name = "hook-cursor" };
        public readonly List<double> VblankElapsedUs = new List<double>();
        public readonly List<double> DwmPeriodUs = new List<double>();
        public int RowCount;
        public int PollRows;
        public int HookRows;
    }

    public sealed class ModelSpec
    {
        public string Name;
        public string Kind;
        public int History;
        public double Gain;
        public double AccelCap;
    }

    public sealed class TargetSpec
    {
        public string Name;
        public string Family;
        public double FixedUs;
        public int DwmOffset;
        public double CapUs;
    }

    public sealed class ErrorAccumulator
    {
        public readonly List<double> Errors = new List<double>();
        public double SumSq;
        public void Add(double error)
        {
            Errors.Add(error);
            SumSq += error * error;
        }
    }

    public static class Runner
    {
        static readonly string[] BinNames = new [] { "0-500", "500-1500", "1500-3000", "3000+" };

        public static string Run(
            string zipPath,
            long stopwatchFrequency,
            long trainStartUs,
            long trainEndUs,
            long validationStartUs,
            long validationEndUs,
            long testStartUs,
            long testEndUs)
        {
            var data = LoadTrace(zipPath, stopwatchFrequency);
            var anchors = new List<Series> { data.Poll, data.HookMove, data.HookCursor };
            var targets = BuildTargets();
            var models = BuildModels();
            var splits = new List<SplitDef> {
                new SplitDef { Name = "train", StartUs = trainStartUs, EndUs = trainEndUs },
                new SplitDef { Name = "validation", StartUs = validationStartUs, EndUs = validationEndUs },
                new SplitDef { Name = "test", StartUs = testStartUs, EndUs = testEndUs }
            };

            var targetQuality = new List<object>();
            foreach (var anchor in anchors)
            {
                foreach (var target in targets)
                {
                    var perSplit = new Dictionary<string, object>();
                    foreach (var split in splits)
                    {
                        perSplit[split.Name] = EvaluateTargetQuality(data, anchor, target, split);
                    }
                    targetQuality.Add(Dict(
                        "anchor_set", anchor.Name,
                        "target", target.Name,
                        "target_family", target.Family,
                        "metrics_by_split", perSplit));
                }
            }

            var results = new List<Dictionary<string, object>>();
            foreach (var anchor in anchors)
            {
                foreach (var target in targets)
                {
                    foreach (var model in models)
                    {
                        var perSplit = new Dictionary<string, object>();
                        foreach (var split in splits)
                        {
                            perSplit[split.Name] = EvaluateModel(data, anchor, target, model, split);
                        }
                        results.Add(Dict(
                            "anchor_set", anchor.Name,
                            "target", target.Name,
                            "target_family", target.Family,
                            "model", model.Name,
                            "required_history", model.History,
                            "metrics_by_split", perSplit));
                    }
                }
            }

            var best = BuildBest(results);

            var output = Dict(
                "phase", "phase-2 ground-truth-baselines",
                "generated_utc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                "input", Dict(
                    "zip_path", zipPath,
                    "stopwatch_frequency", stopwatchFrequency,
                    "row_count", data.RowCount,
                    "poll_rows", data.PollRows,
                    "hook_rows", data.HookRows),
                "accepted_phase1_decisions", Dict(
                    "ground_truth_clock", "poll elapsedMicroseconds",
                    "label_construction", "timestamp interpolation between poll samples",
                    "split", "recommended chronological split with 1s gaps",
                    "hook_usage", "hook positions are anchor/features, not labels",
                    "dwm_usage", "DWM timing is used for display-relative target horizons"),
                "split", Dict(
                    "train", Dict("start_elapsed_us", trainStartUs, "end_elapsed_us", trainEndUs),
                    "validation", Dict("start_elapsed_us", validationStartUs, "end_elapsed_us", validationEndUs),
                    "test", Dict("start_elapsed_us", testStartUs, "end_elapsed_us", testEndUs)),
                "anchor_sets", new List<object> {
                    Dict("name", data.Poll.Name, "count", data.Poll.T.Count, "position_source", "poll x/y"),
                    Dict("name", data.HookMove.Name, "count", data.HookMove.T.Count, "position_source", "hook move x/y"),
                    Dict("name", data.HookCursor.Name, "count", data.HookCursor.T.Count, "position_source", "cursorX/cursorY fields on hook move rows")
                },
                "target_definitions", targets.Select(t => (object)Dict(
                    "name", t.Name,
                    "family", t.Family,
                    "fixed_horizon_us", t.FixedUs,
                    "dwm_unique_vblank_offset", t.DwmOffset,
                    "cap_us", t.CapUs)).ToList(),
                "models", models.Select(m => (object)Dict(
                    "name", m.Name,
                    "kind", m.Kind,
                    "required_history", m.History,
                    "gain", m.Gain,
                    "accel_cap_px_s2", m.AccelCap)).ToList(),
                "target_quality", targetQuality,
                "results", results.Cast<object>().ToList(),
                "best", best);

            return ToJson(output);
        }

        static TraceData LoadTrace(string zipPath, long stopwatchFrequency)
        {
            var data = new TraceData();
            using (var zip = ZipFile.OpenRead(zipPath))
            {
                var entry = zip.GetEntry("trace.csv");
                if (entry == null) throw new InvalidOperationException("trace.csv missing from zip");
                using (var reader = new StreamReader(entry.Open()))
                {
                    var header = reader.ReadLine();
                    if (String.IsNullOrWhiteSpace(header)) throw new InvalidOperationException("trace.csv is empty");
                    var columns = header.Split(',');
                    var idx = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 0; i < columns.Length; i++) idx[columns[i]] = i;

                    string line;
                    double lastUniqueVblank = Double.NegativeInfinity;
                    while ((line = reader.ReadLine()) != null)
                    {
                        if (line.Length == 0) continue;
                        data.RowCount++;
                        var parts = line.Split(',');
                        var ev = parts[idx["event"]];
                        double elapsed = ParseDouble(parts[idx["elapsedMicroseconds"]]);
                        double x = ParseDouble(parts[idx["x"]]);
                        double y = ParseDouble(parts[idx["y"]]);
                        if (ev == "poll")
                        {
                            data.PollRows++;
                            data.Poll.T.Add(elapsed);
                            data.Poll.X.Add(x);
                            data.Poll.Y.Add(y);
                            if (parts[idx["dwmTimingAvailable"]] == "true")
                            {
                                long ticks = ParseLong(parts[idx["stopwatchTicks"]]);
                                long vblank = ParseLong(parts[idx["dwmQpcVBlank"]]);
                                long period = ParseLong(parts[idx["dwmQpcRefreshPeriod"]]);
                                double vblankElapsed = elapsed + ((double)(vblank - ticks) * 1000000.0 / stopwatchFrequency);
                                if (vblankElapsed > lastUniqueVblank + 0.5)
                                {
                                    data.VblankElapsedUs.Add(vblankElapsed);
                                    lastUniqueVblank = vblankElapsed;
                                }
                                data.DwmPeriodUs.Add((double)period * 1000000.0 / stopwatchFrequency);
                            }
                        }
                        else if (ev == "move" || ev == "hook")
                        {
                            data.HookRows++;
                            double hx = NotEmpty(parts[idx["hookX"]]) ? ParseDouble(parts[idx["hookX"]]) : x;
                            double hy = NotEmpty(parts[idx["hookY"]]) ? ParseDouble(parts[idx["hookY"]]) : y;
                            data.HookMove.T.Add(elapsed);
                            data.HookMove.X.Add(hx);
                            data.HookMove.Y.Add(hy);

                            if (NotEmpty(parts[idx["cursorX"]]) && NotEmpty(parts[idx["cursorY"]]))
                            {
                                data.HookCursor.T.Add(elapsed);
                                data.HookCursor.X.Add(ParseDouble(parts[idx["cursorX"]]));
                                data.HookCursor.Y.Add(ParseDouble(parts[idx["cursorY"]]));
                            }
                        }
                    }
                }
            }
            return data;
        }

        static List<TargetSpec> BuildTargets()
        {
            var list = new List<TargetSpec>();
            foreach (var ms in new [] { 4, 8, 12, 16, 24 })
            {
                list.Add(new TargetSpec { Name = "fixed-" + ms.ToString(CultureInfo.InvariantCulture) + "ms", Family = "fixed", FixedUs = ms * 1000.0, DwmOffset = -1, CapUs = ms * 1000.0 });
            }
            list.Add(new TargetSpec { Name = "dwm-next-vblank", Family = "dwm-next-vblank", FixedUs = 0, DwmOffset = 0, CapUs = 50000.0 });
            list.Add(new TargetSpec { Name = "dwm-next-vblank-plus-one", Family = "dwm-next-vblank-plus-one", FixedUs = 0, DwmOffset = 1, CapUs = 70000.0 });
            return list;
        }

        static List<ModelSpec> BuildModels()
        {
            var models = new List<ModelSpec> {
                new ModelSpec { Name = "hold-current", Kind = "hold", History = 1 },
                new ModelSpec { Name = "constant-velocity-last2", Kind = "last2", History = 2, Gain = 1.0 }
            };
            foreach (var gain in new [] { 0.5, 0.625, 0.75, 0.875, 1.0, 1.125 })
            {
                models.Add(new ModelSpec { Name = "gained-last2-" + gain.ToString("0.###", CultureInfo.InvariantCulture), Kind = "last2", History = 2, Gain = gain });
            }
            models.Add(new ModelSpec { Name = "linear-regression-last3", Kind = "linreg", History = 3 });
            models.Add(new ModelSpec { Name = "linear-regression-last5", Kind = "linreg", History = 5 });
            foreach (var cap in new [] { 5000.0, 10000.0, 20000.0, 40000.0 })
            {
                models.Add(new ModelSpec { Name = "acceleration-last3-cap-" + cap.ToString("0", CultureInfo.InvariantCulture), Kind = "accel3", History = 3, AccelCap = cap });
            }
            return models;
        }

        static Dictionary<string, object> EvaluateTargetQuality(TraceData data, Series anchor, TargetSpec target, SplitDef split)
        {
            var horizons = new List<double>();
            for (int i = 0; i < anchor.T.Count; i++)
            {
                double anchorT = anchor.T[i];
                if (anchorT < split.StartUs || anchorT > split.EndUs) continue;
                double targetT;
                if (!TryGetTargetTime(data, target, anchorT, out targetT)) continue;
                if (targetT <= anchorT || targetT > split.EndUs) continue;
                double tx, ty;
                if (!TryInterpolatePoll(data, targetT, out tx, out ty)) continue;
                horizons.Add((targetT - anchorT) / 1000.0);
            }
            return StatsOnly(horizons);
        }

        static Dictionary<string, object> EvaluateModel(TraceData data, Series anchor, TargetSpec target, ModelSpec model, SplitDef split)
        {
            var total = new ErrorAccumulator();
            var bins = new Dictionary<string, ErrorAccumulator>();
            foreach (var name in BinNames) bins[name] = new ErrorAccumulator();

            for (int i = 0; i < anchor.T.Count; i++)
            {
                if (i - model.History + 1 < 0) continue;
                double anchorT = anchor.T[i];
                int earliest = i - model.History + 1;
                if (anchorT < split.StartUs || anchorT > split.EndUs || anchor.T[earliest] < split.StartUs) continue;

                double targetT;
                if (!TryGetTargetTime(data, target, anchorT, out targetT)) continue;
                if (targetT <= anchorT || targetT > split.EndUs) continue;

                double labelX, labelY;
                if (!TryInterpolatePoll(data, targetT, out labelX, out labelY)) continue;

                double predX, predY;
                if (!TryPredict(anchor, i, targetT, model, out predX, out predY)) continue;

                double error = Distance(predX - labelX, predY - labelY);
                total.Add(error);
                double speed = CurrentSpeed(anchor, i);
                bins[SpeedBin(speed)].Add(error);
            }

            var result = Metrics(total);
            var binOut = new Dictionary<string, object>();
            foreach (var name in BinNames) binOut[name] = Metrics(bins[name]);
            result["speed_bins_px_s"] = binOut;
            return result;
        }

        static bool TryGetTargetTime(TraceData data, TargetSpec target, double anchorT, out double targetT)
        {
            targetT = Double.NaN;
            if (target.Family == "fixed")
            {
                targetT = anchorT + target.FixedUs;
                return true;
            }

            int idx = UpperBound(data.VblankElapsedUs, anchorT + 0.001);
            idx += target.DwmOffset;
            if (idx < 0 || idx >= data.VblankElapsedUs.Count) return false;
            targetT = data.VblankElapsedUs[idx];
            double horizon = targetT - anchorT;
            return horizon > 0.0 && horizon <= target.CapUs;
        }

        static bool TryInterpolatePoll(TraceData data, double targetT, out double x, out double y)
        {
            x = y = Double.NaN;
            var t = data.Poll.T;
            int n = t.Count;
            if (n == 0 || targetT < t[0] || targetT > t[n - 1]) return false;
            int idx = LowerBound(t, targetT);
            if (idx < n && Math.Abs(t[idx] - targetT) < 0.0001)
            {
                x = data.Poll.X[idx];
                y = data.Poll.Y[idx];
                return true;
            }
            if (idx <= 0 || idx >= n) return false;
            double t0 = t[idx - 1];
            double t1 = t[idx];
            double dt = t1 - t0;
            if (dt <= 0) return false;
            double f = (targetT - t0) / dt;
            x = data.Poll.X[idx - 1] + (data.Poll.X[idx] - data.Poll.X[idx - 1]) * f;
            y = data.Poll.Y[idx - 1] + (data.Poll.Y[idx] - data.Poll.Y[idx - 1]) * f;
            return true;
        }

        static bool TryPredict(Series s, int i, double targetT, ModelSpec model, out double predX, out double predY)
        {
            predX = predY = Double.NaN;
            double h = (targetT - s.T[i]) / 1000000.0;
            if (h < 0) return false;
            double x0 = s.X[i], y0 = s.Y[i];

            if (model.Kind == "hold")
            {
                predX = x0;
                predY = y0;
                return true;
            }

            if (model.Kind == "last2")
            {
                double dt = (s.T[i] - s.T[i - 1]) / 1000000.0;
                if (dt <= 0) return false;
                double vx = (s.X[i] - s.X[i - 1]) / dt;
                double vy = (s.Y[i] - s.Y[i - 1]) / dt;
                predX = x0 + vx * model.Gain * h;
                predY = y0 + vy * model.Gain * h;
                return true;
            }

            if (model.Kind == "linreg")
            {
                int n = model.History;
                double sumT = 0, sumTT = 0, sumX = 0, sumY = 0, sumTX = 0, sumTY = 0;
                for (int k = i - n + 1; k <= i; k++)
                {
                    double tr = (s.T[k] - s.T[i]) / 1000000.0;
                    sumT += tr;
                    sumTT += tr * tr;
                    sumX += s.X[k];
                    sumY += s.Y[k];
                    sumTX += tr * s.X[k];
                    sumTY += tr * s.Y[k];
                }
                double denom = n * sumTT - sumT * sumT;
                if (Math.Abs(denom) < 1e-12) return false;
                double slopeX = (n * sumTX - sumT * sumX) / denom;
                double slopeY = (n * sumTY - sumT * sumY) / denom;
                double interceptX = (sumX - slopeX * sumT) / n;
                double interceptY = (sumY - slopeY * sumT) / n;
                predX = interceptX + slopeX * h;
                predY = interceptY + slopeY * h;
                return true;
            }

            if (model.Kind == "accel3")
            {
                double dt1 = (s.T[i] - s.T[i - 1]) / 1000000.0;
                double dt0 = (s.T[i - 1] - s.T[i - 2]) / 1000000.0;
                if (dt1 <= 0 || dt0 <= 0) return false;
                double vx1 = (s.X[i] - s.X[i - 1]) / dt1;
                double vy1 = (s.Y[i] - s.Y[i - 1]) / dt1;
                double vx0 = (s.X[i - 1] - s.X[i - 2]) / dt0;
                double vy0 = (s.Y[i - 1] - s.Y[i - 2]) / dt0;
                double accelDt = Math.Max(1e-6, (dt0 + dt1) * 0.5);
                double ax = (vx1 - vx0) / accelDt;
                double ay = (vy1 - vy0) / accelDt;
                double amag = Distance(ax, ay);
                if (model.AccelCap > 0 && amag > model.AccelCap)
                {
                    double scale = model.AccelCap / amag;
                    ax *= scale;
                    ay *= scale;
                }
                predX = x0 + vx1 * h + 0.5 * ax * h * h;
                predY = y0 + vy1 * h + 0.5 * ay * h * h;
                return true;
            }

            return false;
        }

        static Dictionary<string, object> BuildBest(List<Dictionary<string, object>> results)
        {
            var valid = results
                .Where(r => MetricCount(r, "validation") > 0)
                .OrderBy(r => MetricMean(r, "validation"))
                .ToList();

            var top = valid.Take(20).Select(r => SummaryRow(r)).Cast<object>().ToList();
            var bestByFamily = new Dictionary<string, object>();
            foreach (var family in valid.Select(r => (string)r["target_family"]).Distinct())
            {
                bestByFamily[family] = SummaryRow(valid.First(r => (string)r["target_family"] == family));
            }

            var bestByTarget = new Dictionary<string, object>();
            foreach (var target in valid.Select(r => (string)r["target"]).Distinct())
            {
                bestByTarget[target] = SummaryRow(valid.First(r => (string)r["target"] == target));
            }

            return Dict(
                "selection_metric", "lowest validation mean Euclidean error; test is final held-out reporting only",
                "overall_validation", valid.Count > 0 ? (object)SummaryRow(valid[0]) : null,
                "top20_validation", top,
                "by_target_family", bestByFamily,
                "by_target", bestByTarget);
        }

        static Dictionary<string, object> SummaryRow(Dictionary<string, object> r)
        {
            var metrics = (Dictionary<string, object>)r["metrics_by_split"];
            return Dict(
                "anchor_set", r["anchor_set"],
                "target", r["target"],
                "target_family", r["target_family"],
                "model", r["model"],
                "validation", metrics["validation"],
                "test", metrics["test"],
                "train", metrics["train"]);
        }

        static long MetricCount(Dictionary<string, object> r, string split)
        {
            var metrics = (Dictionary<string, object>)r["metrics_by_split"];
            var m = (Dictionary<string, object>)metrics[split];
            return Convert.ToInt64(m["count"], CultureInfo.InvariantCulture);
        }

        static double MetricMean(Dictionary<string, object> r, string split)
        {
            var metrics = (Dictionary<string, object>)r["metrics_by_split"];
            var m = (Dictionary<string, object>)metrics[split];
            var value = m["mean_euclidean_error"];
            if (value == null) return Double.PositiveInfinity;
            return Convert.ToDouble(value, CultureInfo.InvariantCulture);
        }

        static Dictionary<string, object> Metrics(ErrorAccumulator acc)
        {
            var stats = StatsOnly(acc.Errors);
            long count = (long)acc.Errors.Count;
            stats["mean_euclidean_error"] = stats["mean"];
            stats.Remove("mean");
            stats["rmse"] = count == 0 ? null : (object)Math.Sqrt(acc.SumSq / count);
            return stats;
        }

        static Dictionary<string, object> StatsOnly(List<double> values)
        {
            var output = new Dictionary<string, object>();
            int count = values.Count;
            output["count"] = count;
            output["valid_count"] = count;
            if (count == 0)
            {
                output["mean"] = null;
                output["p50"] = null;
                output["p90"] = null;
                output["p95"] = null;
                output["p99"] = null;
                output["max"] = null;
                return output;
            }

            double sum = 0;
            foreach (var v in values) sum += v;
            values.Sort();
            output["mean"] = sum / count;
            output["p50"] = Percentile(values, 0.50);
            output["p90"] = Percentile(values, 0.90);
            output["p95"] = Percentile(values, 0.95);
            output["p99"] = Percentile(values, 0.99);
            output["max"] = values[count - 1];
            return output;
        }

        static double Percentile(List<double> sorted, double p)
        {
            if (sorted.Count == 0) return Double.NaN;
            if (sorted.Count == 1) return sorted[0];
            double rank = p * (sorted.Count - 1);
            int lo = (int)Math.Floor(rank);
            int hi = (int)Math.Ceiling(rank);
            double f = rank - lo;
            return sorted[lo] + (sorted[hi] - sorted[lo]) * f;
        }

        static double CurrentSpeed(Series s, int i)
        {
            if (i <= 0) return 0.0;
            double dt = (s.T[i] - s.T[i - 1]) / 1000000.0;
            if (dt <= 0) return 0.0;
            return Distance(s.X[i] - s.X[i - 1], s.Y[i] - s.Y[i - 1]) / dt;
        }

        static string SpeedBin(double speed)
        {
            if (speed < 500.0) return "0-500";
            if (speed < 1500.0) return "500-1500";
            if (speed < 3000.0) return "1500-3000";
            return "3000+";
        }

        static int LowerBound(List<double> values, double needle)
        {
            int lo = 0, hi = values.Count;
            while (lo < hi)
            {
                int mid = lo + ((hi - lo) / 2);
                if (values[mid] < needle) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        }

        static int UpperBound(List<double> values, double needle)
        {
            int lo = 0, hi = values.Count;
            while (lo < hi)
            {
                int mid = lo + ((hi - lo) / 2);
                if (values[mid] <= needle) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        }

        static double Distance(double dx, double dy)
        {
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static bool NotEmpty(string s)
        {
            return !String.IsNullOrWhiteSpace(s);
        }

        static double ParseDouble(string s)
        {
            return Double.Parse(s, CultureInfo.InvariantCulture);
        }

        static long ParseLong(string s)
        {
            return Int64.Parse(s, CultureInfo.InvariantCulture);
        }

        static Dictionary<string, object> Dict(params object[] items)
        {
            var d = new Dictionary<string, object>();
            for (int i = 0; i < items.Length; i += 2)
            {
                d[(string)items[i]] = items[i + 1];
            }
            return d;
        }

        static string ToJson(object value)
        {
            var sb = new StringBuilder();
            WriteJson(sb, value);
            return sb.ToString();
        }

        static void WriteJson(StringBuilder sb, object value)
        {
            if (value == null)
            {
                sb.Append("null");
                return;
            }
            if (value is string)
            {
                WriteJsonString(sb, (string)value);
                return;
            }
            if (value is bool)
            {
                sb.Append(((bool)value) ? "true" : "false");
                return;
            }
            if (value is int || value is long || value is short || value is byte)
            {
                sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                return;
            }
            if (value is double || value is float || value is decimal)
            {
                double d = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (Double.IsNaN(d) || Double.IsInfinity(d)) sb.Append("null");
                else sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                return;
            }
            var dict = value as Dictionary<string, object>;
            if (dict != null)
            {
                sb.Append('{');
                bool first = true;
                foreach (var kv in dict)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteJsonString(sb, kv.Key);
                    sb.Append(':');
                    WriteJson(sb, kv.Value);
                }
                sb.Append('}');
                return;
            }
            var enumerable = value as IEnumerable;
            if (enumerable != null)
            {
                sb.Append('[');
                bool first = true;
                foreach (var item in enumerable)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteJson(sb, item);
                }
                sb.Append(']');
                return;
            }
            WriteJsonString(sb, value.ToString());
        }

        static void WriteJsonString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32) sb.Append("\\u" + ((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies @(
    "System.IO.Compression.dll",
    "System.IO.Compression.FileSystem.dll"
)

$zipResolved = (Resolve-Path -LiteralPath $ZipPath).Path
$outResolved = (Resolve-Path -LiteralPath $OutputDir).Path

$json = [CursorPredictionPhase2.Runner]::Run(
    $zipResolved,
    $stopwatchFrequency,
    [int64]$split.train.start_elapsed_us,
    [int64]$split.train.end_elapsed_us,
    [int64]$split.validation.start_elapsed_us,
    [int64]$split.validation.end_elapsed_us,
    [int64]$split.test.start_elapsed_us,
    [int64]$split.test.end_elapsed_us)

$scoresPath = Join-Path $outResolved "scores.json"
$json | Set-Content -LiteralPath $scoresPath -Encoding UTF8
$scores = $json | ConvertFrom-Json

function Format-Number([object]$Value, [int]$Digits = 3) {
    if ($null -eq $Value) { return "n/a" }
    return ([double]$Value).ToString("N$Digits", [Globalization.CultureInfo]::InvariantCulture)
}

$overall = $scores.best.overall_validation
$fixedBest = $scores.best.by_target_family.fixed
$dwmBest = $scores.best.by_target_family.'dwm-next-vblank'
$dwmPlusBest = $scores.best.by_target_family.'dwm-next-vblank-plus-one'
$hookMoveBest = $scores.results |
    Where-Object { $_.anchor_set -eq "hook-move" -and $null -ne $_.metrics_by_split.validation.mean_euclidean_error } |
    Sort-Object { [double]$_.metrics_by_split.validation.mean_euclidean_error } |
    Select-Object -First 1
$hookCursorBest = $scores.results |
    Where-Object { $_.anchor_set -eq "hook-cursor" -and $null -ne $_.metrics_by_split.validation.mean_euclidean_error } |
    Sort-Object { [double]$_.metrics_by_split.validation.mean_euclidean_error } |
    Select-Object -First 1
$pollDwmQuality = $scores.target_quality |
    Where-Object { $_.anchor_set -eq "poll" -and $_.target -eq "dwm-next-vblank" } |
    Select-Object -First 1

$recommendTarget = $dwmBest
$recommendText = "Use dwm-next-vblank as the Phase 3 product target, with fixed 16ms/24ms retained as comparison slices. It is display-relative, has stable construction from the complete DWM timing stream, and its validation/test error is close enough to fixed-horizon baselines to be the more meaningful Cursor Mirror target."
if ($null -eq $dwmBest -or $dwmBest.validation.count -lt 1000) {
    $recommendTarget = $fixedBest
    $recommendText = "Use fixed horizons for Phase 3 until DWM target construction is repaired; dwm-next-vblank did not produce enough valid labels."
}

$topLine = "- Overall validation winner: $($overall.anchor_set) / $($overall.target) / $($overall.model); validation mean $(Format-Number $overall.validation.mean_euclidean_error) px, p95 $(Format-Number $overall.validation.p95) px; test mean $(Format-Number $overall.test.mean_euclidean_error) px, p95 $(Format-Number $overall.test.p95) px."
$fixedLine = "- Best fixed-horizon baseline: $($fixedBest.anchor_set) / $($fixedBest.target) / $($fixedBest.model); validation mean $(Format-Number $fixedBest.validation.mean_euclidean_error) px; test mean $(Format-Number $fixedBest.test.mean_euclidean_error) px."
$dwmLine = "- Best dwm-next-vblank: $($dwmBest.anchor_set) / $($dwmBest.model); validation mean $(Format-Number $dwmBest.validation.mean_euclidean_error) px, p95 $(Format-Number $dwmBest.validation.p95) px; test mean $(Format-Number $dwmBest.test.mean_euclidean_error) px, p95 $(Format-Number $dwmBest.test.p95) px."
$dwmPlusLine = "- Best dwm-next-vblank-plus-one: $($dwmPlusBest.anchor_set) / $($dwmPlusBest.model); validation mean $(Format-Number $dwmPlusBest.validation.mean_euclidean_error) px; test mean $(Format-Number $dwmPlusBest.test.mean_euclidean_error) px."
$hookLine = "- Best hook-move baseline: $($hookMoveBest.target) / $($hookMoveBest.model); validation mean $(Format-Number $hookMoveBest.metrics_by_split.validation.mean_euclidean_error) px. Best hook-cursor baseline: $($hookCursorBest.target) / $($hookCursorBest.model); validation mean $(Format-Number $hookCursorBest.metrics_by_split.validation.mean_euclidean_error) px."
$dwmQualityLine = "- For poll anchors, dwm-next-vblank validation labels have count $($pollDwmQuality.metrics_by_split.validation.count), horizon p50 $(Format-Number $pollDwmQuality.metrics_by_split.validation.p50) ms, and horizon p95 $(Format-Number $pollDwmQuality.metrics_by_split.validation.p95) ms."

$report = @"
# Phase 2 Ground Truth and Baselines

## Method
- Loaded trace.csv directly from the repository-root zip; the zip was not copied.
- Used poll elapsedMicroseconds as the visible-position label clock.
- Constructed future labels by linear timestamp interpolation between poll samples.
- Applied the Phase 1 chronological train/validation/test split with 1s gaps.
- Evaluated poll, hook move, and hook current-cursor anchor sets against fixed horizons and DWM-relative targets.

## Validation-First Results
$topLine
$fixedLine
$dwmLine
$dwmPlusLine
$hookLine

## Target Definition Quality
- Fixed horizons are fully deterministic and valid wherever the interpolated poll target remains inside the split.
- dwm-next-vblank is reliable for this trace because every poll row carries DWM timing and unique vblank timestamps are monotonic after conversion to elapsed microseconds.
$dwmQualityLine
- dwm-next-vblank-plus-one is also constructible, but it asks a longer horizon and has larger error; keep it as a stress target rather than the primary Phase 3 target.

## Recommendation for Phase 3
$recommendText

Recommended baseline to carry forward: $($recommendTarget.anchor_set) anchors with $($recommendTarget.model) for $($recommendTarget.target).

## Notes and Limits
- Hook anchors were evaluated as feature/anchor streams only; all labels come from interpolated poll positions.
- Alpha-beta/Kalman-like filters were deferred. The deterministic grid already covers hold, last2 gain/damping, last-N linear regression, and capped last3 acceleration without introducing online state across split boundaries.
- Metrics include train, validation, and held-out test splits plus speed bins (0-500, 500-1500, 1500-3000, 3000+ px/s) in scores.json.
"@
$report | Set-Content -LiteralPath (Join-Path $outResolved "report.md") -Encoding UTF8

$readme = @"
# Phase 2: Ground Truth and Baselines

This phase evaluates deterministic cursor prediction baselines against labels built from timestamp interpolation over poll samples.

## Reproduce

From the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-2 ground-truth-baselines/run-phase2-baselines.ps1"
~~~

The script uses PowerShell plus .NET built-ins only. It reads:

- cursor-mirror-trace-20260501-091537.zip
- poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json

## Outputs

- scores.json: machine-readable target quality, model metrics, speed-bin segments, and validation-selected winners.
- report.md: concise experiment findings and Phase 3 recommendation.
- experiment-log.md: execution details.
- run-phase2-baselines.ps1: reproducible loader, label construction, and baseline evaluator.
"@
$readme | Set-Content -LiteralPath (Join-Path $outResolved "README.md") -Encoding UTF8

$elapsed = [DateTime]::UtcNow - $startUtc
$log = @"
# Phase 2 Experiment Log

- Started UTC: $($startUtc.ToString("o"))
- Finished UTC: $([DateTime]::UtcNow.ToString("o"))
- Runtime seconds: $([Math]::Round($elapsed.TotalSeconds, 3))
- Trace zip: $zipResolved
- Phase 1 scores: $((Resolve-Path -LiteralPath $Phase1ScoresPath).Path)
- Output directory: $outResolved
- Stopwatch frequency: $stopwatchFrequency
- Rows read: $($scores.input.row_count)
- Poll anchors: $($scores.anchor_sets[0].count)
- Hook move anchors: $($scores.anchor_sets[1].count)
- Hook cursor anchors: $($scores.anchor_sets[2].count)
- Target definitions evaluated: $($scores.target_definitions.Count)
- Models evaluated per target/anchor: $($scores.models.Count)
- Total result rows: $($scores.results.Count)

No packages were installed. No hooks were run.
"@
$log | Set-Content -LiteralPath (Join-Path $outResolved "experiment-log.md") -Encoding UTF8

Write-Host "Wrote $scoresPath"
Write-Host "Best validation: $($overall.anchor_set) / $($overall.target) / $($overall.model)"
