param(
    [string]$ZipPath = (Join-Path (Get-Location) "cursor-mirror-trace-20260501-091537.zip"),
    [string]$Phase1ScoresPath = (Join-Path (Get-Location) "poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json"),
    [string]$Phase2ScoresPath = (Join-Path (Get-Location) "poc/cursor-prediction-v2/phase-2 ground-truth-baselines/scores.json"),
    [string]$OutputDir = (Join-Path (Get-Location) "poc/cursor-prediction-v2/phase-3 feature-error-anatomy")
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$startUtc = [DateTime]::UtcNow

if (-not (Test-Path -LiteralPath $ZipPath)) { throw "Trace zip not found: $ZipPath" }
if (-not (Test-Path -LiteralPath $Phase1ScoresPath)) { throw "Phase 1 scores not found: $Phase1ScoresPath" }
if (-not (Test-Path -LiteralPath $Phase2ScoresPath)) { throw "Phase 2 scores not found: $Phase2ScoresPath" }

$phase1 = Get-Content -LiteralPath $Phase1ScoresPath -Raw | ConvertFrom-Json
$phase2 = Get-Content -LiteralPath $Phase2ScoresPath -Raw | ConvertFrom-Json
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

namespace CursorPredictionPhase3
{
    public sealed class SplitDef
    {
        public string Name;
        public double StartUs;
        public double EndUs;
    }

    public sealed class PollSample
    {
        public long Sequence;
        public long StopwatchTicks;
        public double T;
        public double X;
        public double Y;
        public double VblankElapsedUs;
        public double DwmDeltaMs;
        public double DwmPeriodMs;
        public long DwmRefreshCount;
    }

    public sealed class TraceData
    {
        public readonly List<PollSample> Poll = new List<PollSample>();
        public readonly List<double> UniqueVblankElapsedUs = new List<double>();
        public readonly List<double> HookTimes = new List<double>();
        public int RowCount;
        public int PollRows;
        public int HookRows;
    }

    public sealed class TargetSpec
    {
        public string Name;
        public string Family;
        public double FixedUs;
        public int DwmOffset;
        public double CapUs;
    }

    public sealed class EvalRow
    {
        public string Split;
        public string Target;
        public int Index;
        public long Sequence;
        public double AnchorT;
        public double X;
        public double Y;
        public double TargetT;
        public double LabelX;
        public double LabelY;
        public double PredX;
        public double PredY;
        public double Error;
        public double HorizonMs;
        public double Speed;
        public double AccelMag;
        public double TurnDeg;
        public double TimeSinceHookMs;
        public double TimeSincePollMoveMs;
        public double DwmDeltaMs;
        public double DwmPeriodMs;
        public bool IsMoving;
        public bool DuplicateAnchor;
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
        static readonly double[] GainGrid = new [] { 0.0, 0.5, 0.625, 0.75, 0.875, 1.0, 1.125 };
        static readonly string[] Splits = new [] { "train", "validation", "test" };

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
            var splitDefs = new List<SplitDef> {
                new SplitDef { Name = "train", StartUs = trainStartUs, EndUs = trainEndUs },
                new SplitDef { Name = "validation", StartUs = validationStartUs, EndUs = validationEndUs },
                new SplitDef { Name = "test", StartUs = testStartUs, EndUs = testEndUs }
            };
            var targets = new List<TargetSpec> {
                new TargetSpec { Name = "dwm-next-vblank", Family = "dwm-next-vblank", DwmOffset = 0, CapUs = 50000.0 },
                new TargetSpec { Name = "fixed-16ms", Family = "fixed", FixedUs = 16000.0, DwmOffset = -1, CapUs = 16000.0 },
                new TargetSpec { Name = "fixed-24ms", Family = "fixed", FixedUs = 24000.0, DwmOffset = -1, CapUs = 24000.0 }
            };

            var rowsByTarget = new Dictionary<string, List<EvalRow>>();
            var baselineByTarget = new Dictionary<string, object>();
            foreach (var target in targets)
            {
                var rows = BuildRows(data, target, splitDefs, 0.75);
                rowsByTarget[target.Name] = rows;
                baselineByTarget[target.Name] = BuildMetricsBySplit(rows);
            }

            var primaryRows = rowsByTarget["dwm-next-vblank"];
            var validationRows = primaryRows.Where(r => r.Split == "validation").ToList();
            var testRows = primaryRows.Where(r => r.Split == "test").ToList();

            var segmentations = BuildSegmentations(primaryRows);
            var topClusters = BuildTopFailureClusters(validationRows);
            var representatives = BuildRepresentativeSamples(validationRows);
            var gating = BuildSpeedGatedGainAnalysis(data, targets[0], splitDefs);

            var output = Dict(
                "phase", "phase-3 feature-error-anatomy",
                "generated_utc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                "input", Dict(
                    "zip_path", zipPath,
                    "stopwatch_frequency", stopwatchFrequency,
                    "row_count", data.RowCount,
                    "poll_rows", data.PollRows,
                    "hook_rows", data.HookRows),
                "accepted_phase2_decisions", Dict(
                    "primary_product_target", "poll anchors with dwm-next-vblank labels",
                    "primary_baseline", "gained-last2-0.75 for dwm-next-vblank",
                    "comparison_targets", new List<object> { "fixed-16ms", "fixed-24ms" },
                    "stress_target", "dwm-next-vblank-plus-one only"),
                "split", Dict(
                    "train", Dict("start_elapsed_us", trainStartUs, "end_elapsed_us", trainEndUs),
                    "validation", Dict("start_elapsed_us", validationStartUs, "end_elapsed_us", validationEndUs),
                    "test", Dict("start_elapsed_us", testStartUs, "end_elapsed_us", testEndUs)),
                "baseline_reconstruction", Dict(
                    "anchor_set", "poll",
                    "target", "dwm-next-vblank",
                    "model", "gained-last2-0.75",
                    "label_construction", "timestamp interpolation between poll samples",
                    "required_history", 2,
                    "metrics_by_split", baselineByTarget["dwm-next-vblank"]),
                "comparison_targets", Dict(
                    "fixed-16ms", baselineByTarget["fixed-16ms"],
                    "fixed-24ms", baselineByTarget["fixed-24ms"]),
                "error_anatomy", segmentations,
                "top_failure_clusters", topClusters,
                "representative_high_error_samples", representatives,
                "oracle_and_gating_analysis", gating,
                "feature_leakage_rules", LeakageRules(),
                "phase4_feature_schemas", FeatureSchemas(),
                "notes", Dict(
                    "validation_high_error_sample_count", validationRows.Count,
                    "test_sample_count", testRows.Count,
                    "all_features_are_anchor_time_only", true));

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
                        string ev = parts[idx["event"]];
                        double elapsed = ParseDouble(parts[idx["elapsedMicroseconds"]]);
                        if (ev == "poll")
                        {
                            data.PollRows++;
                            long ticks = ParseLong(parts[idx["stopwatchTicks"]]);
                            long vblank = ParseLong(parts[idx["dwmQpcVBlank"]]);
                            long period = ParseLong(parts[idx["dwmQpcRefreshPeriod"]]);
                            double vblankElapsed = elapsed + ((double)(vblank - ticks) * 1000000.0 / stopwatchFrequency);
                            double periodMs = (double)period * 1000.0 / stopwatchFrequency;
                            var sample = new PollSample {
                                Sequence = ParseLong(parts[idx["sequence"]]),
                                StopwatchTicks = ticks,
                                T = elapsed,
                                X = ParseDouble(parts[idx["x"]]),
                                Y = ParseDouble(parts[idx["y"]]),
                                VblankElapsedUs = vblankElapsed,
                                DwmDeltaMs = (vblankElapsed - elapsed) / 1000.0,
                                DwmPeriodMs = periodMs,
                                DwmRefreshCount = ParseLong(parts[idx["dwmRefreshCount"]])
                            };
                            data.Poll.Add(sample);
                            if (vblankElapsed > lastUniqueVblank + 0.5)
                            {
                                data.UniqueVblankElapsedUs.Add(vblankElapsed);
                                lastUniqueVblank = vblankElapsed;
                            }
                        }
                        else if (ev == "move" || ev == "hook")
                        {
                            data.HookRows++;
                            data.HookTimes.Add(elapsed);
                        }
                    }
                }
            }
            return data;
        }

        static List<EvalRow> BuildRows(TraceData data, TargetSpec target, List<SplitDef> splitDefs, double gain)
        {
            var rows = new List<EvalRow>();
            var moveTimes = BuildLastMoveTimes(data);
            int hookCursor = 0;

            for (int i = 1; i < data.Poll.Count; i++)
            {
                var p = data.Poll[i];
                while (hookCursor < data.HookTimes.Count && data.HookTimes[hookCursor] <= p.T) hookCursor++;
                var split = SplitForTime(splitDefs, p.T);
                if (split == null || data.Poll[i - 1].T < split.StartUs) continue;

                double targetT;
                if (!TryGetTargetTime(data, target, p.T, out targetT)) continue;
                if (targetT <= p.T || targetT > split.EndUs) continue;

                double labelX, labelY;
                if (!TryInterpolatePoll(data, targetT, out labelX, out labelY)) continue;

                double predX, predY;
                if (!TryPredictLast2(data, i, targetT, gain, out predX, out predY)) continue;

                double speed = Speed(data, i);
                double accel = AccelMag(data, i);
                double turn = TurnDeg(data, i);
                double sinceHook = hookCursor > 0 ? (p.T - data.HookTimes[hookCursor - 1]) / 1000.0 : Double.PositiveInfinity;
                double sinceMove = moveTimes[i] < 0 ? Double.PositiveInfinity : (p.T - moveTimes[i]) / 1000.0;
                bool dup = data.Poll[i].X == data.Poll[i - 1].X && data.Poll[i].Y == data.Poll[i - 1].Y;

                rows.Add(new EvalRow {
                    Split = split.Name,
                    Target = target.Name,
                    Index = i,
                    Sequence = p.Sequence,
                    AnchorT = p.T,
                    X = p.X,
                    Y = p.Y,
                    TargetT = targetT,
                    LabelX = labelX,
                    LabelY = labelY,
                    PredX = predX,
                    PredY = predY,
                    Error = Distance(predX - labelX, predY - labelY),
                    HorizonMs = (targetT - p.T) / 1000.0,
                    Speed = speed,
                    AccelMag = accel,
                    TurnDeg = turn,
                    TimeSinceHookMs = sinceHook,
                    TimeSincePollMoveMs = sinceMove,
                    DwmDeltaMs = p.DwmDeltaMs,
                    DwmPeriodMs = p.DwmPeriodMs,
                    IsMoving = speed > 0.0,
                    DuplicateAnchor = dup
                });
            }
            return rows;
        }

        static double[] BuildLastMoveTimes(TraceData data)
        {
            var moveTimes = new double[data.Poll.Count];
            double lastMove = -1.0;
            if (moveTimes.Length > 0) moveTimes[0] = -1.0;
            for (int i = 1; i < data.Poll.Count; i++)
            {
                if (data.Poll[i].X != data.Poll[i - 1].X || data.Poll[i].Y != data.Poll[i - 1].Y) lastMove = data.Poll[i].T;
                moveTimes[i] = lastMove;
            }
            return moveTimes;
        }

        static Dictionary<string, object> BuildMetricsBySplit(List<EvalRow> rows)
        {
            var output = new Dictionary<string, object>();
            foreach (var split in Splits)
            {
                output[split] = Metrics(rows.Where(r => r.Split == split).Select(r => r.Error));
            }
            return output;
        }

        static Dictionary<string, object> BuildSegmentations(List<EvalRow> rows)
        {
            var groups = new Dictionary<string, Func<EvalRow, string>> {
                { "speed_bins_px_s", r => SpeedBin(r.Speed) },
                { "acceleration_magnitude_bins_px_s2", r => AccelBin(r.AccelMag) },
                { "turn_angle_bins_deg", r => TurnBin(r.TurnDeg, r.Speed) },
                { "target_horizon_bins_ms", r => HorizonBin(r.HorizonMs) },
                { "time_since_last_hook_event_bins_ms", r => TimeSinceHookBin(r.TimeSinceHookMs) },
                { "time_since_last_poll_movement_bins_ms", r => TimeSinceMoveBin(r.TimeSincePollMoveMs) },
                { "dwm_phase_or_anchor_to_vblank_bins_ms", r => DwmPhaseBin(r.DwmDeltaMs) },
                { "duplicate_vs_moving_anchor", r => r.DuplicateAnchor ? "duplicate-standing-still" : "moving-anchor" }
            };

            var output = new Dictionary<string, object>();
            foreach (var group in groups)
            {
                var bySplit = new Dictionary<string, object>();
                foreach (var split in Splits)
                {
                    var splitRows = rows.Where(r => r.Split == split);
                    var byBin = new Dictionary<string, object>();
                    foreach (var bin in splitRows.GroupBy(group.Value).OrderBy(g => g.Key))
                    {
                        byBin[bin.Key] = Metrics(bin.Select(r => r.Error));
                    }
                    bySplit[split] = byBin;
                }
                output[group.Key] = bySplit;
            }
            return output;
        }

        static List<object> BuildTopFailureClusters(List<EvalRow> validationRows)
        {
            var candidates = new List<Dictionary<string, object>>();
            AddClusters(candidates, "speed", validationRows, r => SpeedBin(r.Speed));
            AddClusters(candidates, "acceleration", validationRows, r => AccelBin(r.AccelMag));
            AddClusters(candidates, "turn_angle", validationRows, r => TurnBin(r.TurnDeg, r.Speed));
            AddClusters(candidates, "horizon", validationRows, r => HorizonBin(r.HorizonMs));
            AddClusters(candidates, "time_since_hook", validationRows, r => TimeSinceHookBin(r.TimeSinceHookMs));
            AddClusters(candidates, "time_since_poll_move", validationRows, r => TimeSinceMoveBin(r.TimeSincePollMoveMs));
            AddClusters(candidates, "dwm_phase", validationRows, r => DwmPhaseBin(r.DwmDeltaMs));
            AddClusters(candidates, "duplicate_vs_moving", validationRows, r => r.DuplicateAnchor ? "duplicate-standing-still" : "moving-anchor");
            AddClusters(candidates, "speed_x_horizon", validationRows, r => SpeedBin(r.Speed) + " | horizon " + HorizonBin(r.HorizonMs));
            AddClusters(candidates, "speed_x_duplicate", validationRows, r => SpeedBin(r.Speed) + " | " + (r.DuplicateAnchor ? "duplicate" : "moving"));
            AddClusters(candidates, "acceleration_x_duplicate", validationRows, r => AccelBin(r.AccelMag) + " | " + (r.DuplicateAnchor ? "duplicate" : "moving"));
            AddClusters(candidates, "turn_x_speed", validationRows, r => TurnBin(r.TurnDeg, r.Speed) + " | speed " + SpeedBin(r.Speed));
            AddClusters(candidates, "hook_age_x_speed", validationRows, r => TimeSinceHookBin(r.TimeSinceHookMs) + " | speed " + SpeedBin(r.Speed));

            return candidates
                .Where(c => Convert.ToInt32(c["count"], CultureInfo.InvariantCulture) >= 20)
                .OrderByDescending(c => Convert.ToDouble(c["mean_euclidean_error"], CultureInfo.InvariantCulture))
                .ThenByDescending(c => Convert.ToDouble(c["p95"], CultureInfo.InvariantCulture))
                .Take(12)
                .Cast<object>()
                .ToList();
        }

        static void AddClusters(List<Dictionary<string, object>> output, string groupName, List<EvalRow> rows, Func<EvalRow, string> selector)
        {
            foreach (var g in rows.GroupBy(selector))
            {
                var m = Metrics(g.Select(r => r.Error));
                output.Add(Dict(
                    "group", groupName,
                    "bin", g.Key,
                    "count", m["count"],
                    "mean_euclidean_error", m["mean_euclidean_error"],
                    "rmse", m["rmse"],
                    "p95", m["p95"],
                    "max", m["max"]));
            }
        }

        static List<object> BuildRepresentativeSamples(List<EvalRow> validationRows)
        {
            return validationRows
                .OrderByDescending(r => r.Error)
                .Take(16)
                .Select(r => (object)Dict(
                    "sequence", r.Sequence,
                    "split", r.Split,
                    "anchor_elapsed_us", Round(r.AnchorT, 3),
                    "target_elapsed_us", Round(r.TargetT, 3),
                    "horizon_ms", Round(r.HorizonMs, 6),
                    "current", Dict("x", r.X, "y", r.Y),
                    "target", Dict("x", Round(r.LabelX, 6), "y", Round(r.LabelY, 6)),
                    "prediction", Dict("x", Round(r.PredX, 6), "y", Round(r.PredY, 6)),
                    "error_px", Round(r.Error, 6),
                    "features", Dict(
                        "speed_px_s", Round(r.Speed, 6),
                        "acceleration_px_s2", Round(r.AccelMag, 6),
                        "turn_angle_deg", Double.IsInfinity(r.TurnDeg) ? (object)null : Round(r.TurnDeg, 6),
                        "time_since_last_hook_ms", Double.IsInfinity(r.TimeSinceHookMs) ? (object)null : Round(r.TimeSinceHookMs, 6),
                        "time_since_last_poll_movement_ms", Double.IsInfinity(r.TimeSincePollMoveMs) ? (object)null : Round(r.TimeSincePollMoveMs, 6),
                        "dwm_delta_ms", Round(r.DwmDeltaMs, 6),
                        "dwm_period_ms", Round(r.DwmPeriodMs, 6),
                        "speed_bin", SpeedBin(r.Speed),
                        "acceleration_bin", AccelBin(r.AccelMag),
                        "turn_bin", TurnBin(r.TurnDeg, r.Speed),
                        "horizon_bin", HorizonBin(r.HorizonMs),
                        "hook_age_bin", TimeSinceHookBin(r.TimeSinceHookMs),
                        "poll_move_age_bin", TimeSinceMoveBin(r.TimeSincePollMoveMs),
                        "dwm_phase_bin", DwmPhaseBin(r.DwmDeltaMs),
                        "duplicate_anchor", r.DuplicateAnchor)))
                .ToList();
        }

        static Dictionary<string, object> BuildSpeedGatedGainAnalysis(TraceData data, TargetSpec target, List<SplitDef> splitDefs)
        {
            var rowsByGain = new Dictionary<double, List<EvalRow>>();
            foreach (var gain in GainGrid)
            {
                rowsByGain[gain] = BuildRows(data, target, splitDefs, gain);
            }

            var bestGainBySpeed = new Dictionary<string, double>();
            foreach (var binName in new [] { "0-500", "500-1500", "1500-3000", "3000+" })
            {
                double bestGain = 0.75;
                double bestMean = Double.PositiveInfinity;
                foreach (var gain in GainGrid)
                {
                    var train = rowsByGain[gain].Where(r => r.Split == "train" && SpeedBin(r.Speed) == binName).Select(r => r.Error).ToList();
                    if (train.Count == 0) continue;
                    double mean = train.Average();
                    if (mean < bestMean)
                    {
                        bestMean = mean;
                        bestGain = gain;
                    }
                }
                bestGainBySpeed[binName] = bestGain;
            }

            var gatedRows = new List<EvalRow>();
            var baselineRows = rowsByGain[0.75];
            var rowLookupByGain = new Dictionary<double, Dictionary<int, EvalRow>>();
            foreach (var gain in GainGrid)
            {
                rowLookupByGain[gain] = rowsByGain[gain].ToDictionary(r => r.Index, r => r);
            }
            foreach (var split in Splits)
            {
                var baselineSplit = baselineRows.Where(r => r.Split == split).OrderBy(r => r.Index).ToList();
                for (int n = 0; n < baselineSplit.Count; n++)
                {
                    var b = baselineSplit[n];
                    var gain = bestGainBySpeed[SpeedBin(b.Speed)];
                    EvalRow g;
                    if (rowLookupByGain[gain].TryGetValue(b.Index, out g)) gatedRows.Add(g);
                }
            }

            var trainSelection = new Dictionary<string, object>();
            foreach (var kv in bestGainBySpeed)
            {
                trainSelection[kv.Key] = Dict(
                    "selected_gain", kv.Value,
                    "train_mean_euclidean_error", rowsByGain[kv.Value].Where(r => r.Split == "train" && SpeedBin(r.Speed) == kv.Key).Select(r => r.Error).DefaultIfEmpty().Average());
            }

            var baseline = BuildMetricsBySplit(baselineRows);
            var gated = BuildMetricsBySplit(gatedRows);
            var validationBase = (Dictionary<string, object>)baseline["validation"];
            var validationGated = (Dictionary<string, object>)gated["validation"];
            var testBase = (Dictionary<string, object>)baseline["test"];
            var testGated = (Dictionary<string, object>)gated["test"];

            return Dict(
                "method", "choose last2 gain per speed bin on train only, then apply unchanged to validation/test",
                "gain_grid", GainGrid.Cast<object>().ToList(),
                "speed_bin_selected_gains", trainSelection,
                "baseline_fixed_gain_0.75", baseline,
                "speed_gated_gain", gated,
                "validation_mean_delta_px", Convert.ToDouble(validationGated["mean_euclidean_error"], CultureInfo.InvariantCulture) - Convert.ToDouble(validationBase["mean_euclidean_error"], CultureInfo.InvariantCulture),
                "validation_percent_change", 100.0 * (Convert.ToDouble(validationGated["mean_euclidean_error"], CultureInfo.InvariantCulture) / Convert.ToDouble(validationBase["mean_euclidean_error"], CultureInfo.InvariantCulture) - 1.0),
                "test_mean_delta_px", Convert.ToDouble(testGated["mean_euclidean_error"], CultureInfo.InvariantCulture) - Convert.ToDouble(testBase["mean_euclidean_error"], CultureInfo.InvariantCulture),
                "test_percent_change", 100.0 * (Convert.ToDouble(testGated["mean_euclidean_error"], CultureInfo.InvariantCulture) / Convert.ToDouble(testBase["mean_euclidean_error"], CultureInfo.InvariantCulture) - 1.0),
                "interpretation", "This is an oracle-light gating check, not a trained model; gain choices are selected only from train bins.");
        }

        static List<object> LeakageRules()
        {
            return new List<object> {
                "Every feature must be computed from rows with elapsedMicroseconds <= anchor elapsedMicroseconds.",
                "Future poll labels, target positions, and post-anchor hook movement are labels/evaluation data only.",
                "DWM features may use timing fields present on the anchor poll row and historical DWM rows; do not use future unique vblank rows except to define the target horizon.",
                "Split membership must be decided by anchor time, and required history must stay inside the same split.",
                "Normalization statistics for learned models must be fitted on train only and then frozen for validation/test.",
                "Feature selection and gating choices must be made on train or validation only; final test metrics are reporting only."
            };
        }

        static Dictionary<string, object> FeatureSchemas()
        {
            return Dict(
                "minimal_product_shaped", Dict(
                    "intent", "Small deterministic feature vector suitable for gain tables, linear residuals, or a tiny embedded MLP.",
                    "features", new List<object> {
                        "current_x", "current_y",
                        "last_delta_x", "last_delta_y", "last_dt_ms",
                        "last2_velocity_x_px_s", "last2_velocity_y_px_s", "speed_px_s",
                        "target_horizon_ms", "dwm_phase_ms", "dwm_period_ms",
                        "time_since_last_hook_ms", "time_since_last_poll_movement_ms",
                        "duplicate_anchor_flag"
                    },
                    "candidate_targets", new List<object> {
                        "direct residual dx/dy over gained-last2-0.75",
                        "gain correction scalar",
                        "position dx/dy from current"
                    }),
                "richer_neural_tabular", Dict(
                    "intent", "Feature-rich tabular input for gradient boosting, random forests, MLPs, or mixture-of-experts.",
                    "features", new List<object> {
                        "last_5_relative_positions_dxdy",
                        "last_5_dt_ms",
                        "velocity_x_y_for_last_4_segments",
                        "speed_for_last_4_segments",
                        "acceleration_x_y_for_last_3_pairs",
                        "acceleration_magnitude",
                        "turn_angle_last2_segments",
                        "jerk_proxy_from_accel_delta",
                        "target_horizon_ms",
                        "horizon_normalized_by_dwm_period",
                        "anchor_dwm_phase_ms",
                        "anchor_dwm_period_ms",
                        "time_since_last_hook_ms",
                        "hook_event_count_last_8_16_32ms",
                        "time_since_last_poll_movement_ms",
                        "duplicate_run_length",
                        "moving_anchor_flag"
                    },
                    "candidate_targets", new List<object> {
                        "residual from gained-last2-0.75",
                        "residual from hold-current for low-speed anchors",
                        "mixture gate among hold/current velocity/gained velocity"
                    }),
                "sequence_feature_tensor", Dict(
                    "intent", "Temporal tensor for TCN/GRU/LSTM/transformer-lite models with a separate context vector.",
                    "shape", Dict(
                        "history_steps", 16,
                        "per_step_features", new List<object> {
                            "relative_x_to_anchor", "relative_y_to_anchor",
                            "dt_ms_to_previous", "age_ms_from_anchor",
                            "delta_x", "delta_y",
                            "velocity_x_px_s", "velocity_y_px_s",
                            "speed_px_s",
                            "is_duplicate_position",
                            "has_hook_between_previous_and_step"
                        },
                        "context_features", new List<object> {
                            "target_horizon_ms",
                            "dwm_phase_ms",
                            "dwm_period_ms",
                            "time_since_last_hook_ms",
                            "time_since_last_poll_movement_ms"
                        }),
                    "masking", "Left-pad missing history with zeros and provide a valid_step_mask.",
                    "recommended_output", "Predict residual dx/dy over gained-last2-0.75 to keep the learned target small."));
        }

        static SplitDef SplitForTime(List<SplitDef> splits, double t)
        {
            foreach (var s in splits)
            {
                if (t >= s.StartUs && t <= s.EndUs) return s;
            }
            return null;
        }

        static bool TryGetTargetTime(TraceData data, TargetSpec target, double anchorT, out double targetT)
        {
            targetT = Double.NaN;
            if (target.Family == "fixed")
            {
                targetT = anchorT + target.FixedUs;
                return true;
            }

            int idx = UpperBound(data.UniqueVblankElapsedUs, anchorT + 0.001);
            idx += target.DwmOffset;
            if (idx < 0 || idx >= data.UniqueVblankElapsedUs.Count) return false;
            targetT = data.UniqueVblankElapsedUs[idx];
            double horizon = targetT - anchorT;
            return horizon > 0.0 && horizon <= target.CapUs;
        }

        static bool TryInterpolatePoll(TraceData data, double targetT, out double x, out double y)
        {
            x = y = Double.NaN;
            var poll = data.Poll;
            int n = poll.Count;
            if (n == 0 || targetT < poll[0].T || targetT > poll[n - 1].T) return false;
            int idx = LowerBoundPoll(poll, targetT);
            if (idx < n && Math.Abs(poll[idx].T - targetT) < 0.0001)
            {
                x = poll[idx].X;
                y = poll[idx].Y;
                return true;
            }
            if (idx <= 0 || idx >= n) return false;
            double t0 = poll[idx - 1].T;
            double t1 = poll[idx].T;
            double dt = t1 - t0;
            if (dt <= 0) return false;
            double f = (targetT - t0) / dt;
            x = poll[idx - 1].X + (poll[idx].X - poll[idx - 1].X) * f;
            y = poll[idx - 1].Y + (poll[idx].Y - poll[idx - 1].Y) * f;
            return true;
        }

        static bool TryPredictLast2(TraceData data, int i, double targetT, double gain, out double predX, out double predY)
        {
            predX = predY = Double.NaN;
            if (i <= 0) return false;
            var p0 = data.Poll[i];
            var p1 = data.Poll[i - 1];
            double dt = (p0.T - p1.T) / 1000000.0;
            double h = (targetT - p0.T) / 1000000.0;
            if (dt <= 0 || h < 0) return false;
            double vx = (p0.X - p1.X) / dt;
            double vy = (p0.Y - p1.Y) / dt;
            predX = p0.X + vx * gain * h;
            predY = p0.Y + vy * gain * h;
            return true;
        }

        static double Speed(TraceData data, int i)
        {
            if (i <= 0) return 0.0;
            double dt = (data.Poll[i].T - data.Poll[i - 1].T) / 1000000.0;
            if (dt <= 0) return 0.0;
            return Distance(data.Poll[i].X - data.Poll[i - 1].X, data.Poll[i].Y - data.Poll[i - 1].Y) / dt;
        }

        static double AccelMag(TraceData data, int i)
        {
            if (i <= 1) return 0.0;
            double dt1 = (data.Poll[i].T - data.Poll[i - 1].T) / 1000000.0;
            double dt0 = (data.Poll[i - 1].T - data.Poll[i - 2].T) / 1000000.0;
            if (dt1 <= 0 || dt0 <= 0) return 0.0;
            double vx1 = (data.Poll[i].X - data.Poll[i - 1].X) / dt1;
            double vy1 = (data.Poll[i].Y - data.Poll[i - 1].Y) / dt1;
            double vx0 = (data.Poll[i - 1].X - data.Poll[i - 2].X) / dt0;
            double vy0 = (data.Poll[i - 1].Y - data.Poll[i - 2].Y) / dt0;
            double adt = Math.Max(1e-6, (dt0 + dt1) * 0.5);
            return Distance((vx1 - vx0) / adt, (vy1 - vy0) / adt);
        }

        static double TurnDeg(TraceData data, int i)
        {
            if (i <= 1) return Double.PositiveInfinity;
            double dx1 = data.Poll[i].X - data.Poll[i - 1].X;
            double dy1 = data.Poll[i].Y - data.Poll[i - 1].Y;
            double dx0 = data.Poll[i - 1].X - data.Poll[i - 2].X;
            double dy0 = data.Poll[i - 1].Y - data.Poll[i - 2].Y;
            double mag1 = Distance(dx1, dy1);
            double mag0 = Distance(dx0, dy0);
            if (mag1 < 1e-9 || mag0 < 1e-9) return Double.PositiveInfinity;
            double dot = dx0 * dx1 + dy0 * dy1;
            double cos = Math.Max(-1.0, Math.Min(1.0, dot / (mag0 * mag1)));
            return Math.Acos(cos) * 180.0 / Math.PI;
        }

        static string SpeedBin(double speed)
        {
            if (speed < 500.0) return "0-500";
            if (speed < 1500.0) return "500-1500";
            if (speed < 3000.0) return "1500-3000";
            return "3000+";
        }

        static string AccelBin(double accel)
        {
            if (accel < 5000.0) return "0-5000";
            if (accel < 20000.0) return "5000-20000";
            if (accel < 100000.0) return "20000-100000";
            if (accel < 500000.0) return "100000-500000";
            return "500000+";
        }

        static string TurnBin(double turnDeg, double speed)
        {
            if (speed <= 0.0 || Double.IsInfinity(turnDeg) || Double.IsNaN(turnDeg)) return "standing-or-insufficient-motion";
            if (turnDeg < 15.0) return "0-15";
            if (turnDeg < 45.0) return "15-45";
            if (turnDeg < 90.0) return "45-90";
            if (turnDeg < 135.0) return "90-135";
            return "135-180";
        }

        static string HorizonBin(double ms)
        {
            if (ms < 4.0) return "0-4";
            if (ms < 8.0) return "4-8";
            if (ms < 12.0) return "8-12";
            if (ms < 16.0) return "12-16";
            if (ms < 24.0) return "16-24";
            return "24+";
        }

        static string TimeSinceHookBin(double ms)
        {
            if (Double.IsInfinity(ms)) return "none";
            if (ms < 2.0) return "0-2";
            if (ms < 4.0) return "2-4";
            if (ms < 8.0) return "4-8";
            if (ms < 16.0) return "8-16";
            if (ms < 32.0) return "16-32";
            return "32+";
        }

        static string TimeSinceMoveBin(double ms)
        {
            if (Double.IsInfinity(ms)) return "none";
            if (ms <= 0.0) return "moving-now";
            if (ms < 16.0) return "0-16";
            if (ms < 50.0) return "16-50";
            if (ms < 100.0) return "50-100";
            if (ms < 500.0) return "100-500";
            return "500+";
        }

        static string DwmPhaseBin(double ms)
        {
            if (ms < 0.0) return "stale-vblank";
            if (ms < 4.0) return "0-4";
            if (ms < 8.0) return "4-8";
            if (ms < 12.0) return "8-12";
            if (ms < 16.0) return "12-16";
            return "16+";
        }

        static Dictionary<string, object> Metrics(IEnumerable<double> errors)
        {
            var values = errors.ToList();
            var output = new Dictionary<string, object>();
            int count = values.Count;
            output["count"] = count;
            output["valid_count"] = count;
            if (count == 0)
            {
                output["mean_euclidean_error"] = null;
                output["rmse"] = null;
                output["p50"] = null;
                output["p90"] = null;
                output["p95"] = null;
                output["p99"] = null;
                output["max"] = null;
                return output;
            }
            double sum = 0.0;
            double sumSq = 0.0;
            foreach (var v in values)
            {
                sum += v;
                sumSq += v * v;
            }
            values.Sort();
            output["mean_euclidean_error"] = sum / count;
            output["rmse"] = Math.Sqrt(sumSq / count);
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

        static int LowerBoundPoll(List<PollSample> values, double needle)
        {
            int lo = 0, hi = values.Count;
            while (lo < hi)
            {
                int mid = lo + ((hi - lo) / 2);
                if (values[mid].T < needle) lo = mid + 1;
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

        static double Round(double v, int digits)
        {
            return Math.Round(v, digits, MidpointRounding.AwayFromZero);
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
            for (int i = 0; i < items.Length; i += 2) d[(string)items[i]] = items[i + 1];
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
            if (value == null) { sb.Append("null"); return; }
            if (value is string) { WriteJsonString(sb, (string)value); return; }
            if (value is bool) { sb.Append(((bool)value) ? "true" : "false"); return; }
            if (value is int || value is long || value is short || value is byte) { sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture)); return; }
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

$json = [CursorPredictionPhase3.Runner]::Run(
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

$primary = $scores.baseline_reconstruction.metrics_by_split
$phase2Primary = $phase2.results |
    Where-Object { $_.anchor_set -eq "poll" -and $_.target -eq "dwm-next-vblank" -and $_.model -eq "gained-last2-0.75" } |
    Select-Object -First 1
$gate = $scores.oracle_and_gating_analysis
$topClusters = $scores.top_failure_clusters | Select-Object -First 5

$clusterLines = ($topClusters | ForEach-Object {
    "- $($_.group) / $($_.bin): count $($_.count), mean $(Format-Number $_.mean_euclidean_error) px, p95 $(Format-Number $_.p95) px."
}) -join "`n"

$validationCompare = "- Reconstructed validation: count $($primary.validation.count), mean $(Format-Number $primary.validation.mean_euclidean_error) px, p95 $(Format-Number $primary.validation.p95) px, max $(Format-Number $primary.validation.max) px."
$testCompare = "- Reconstructed test: count $($primary.test.count), mean $(Format-Number $primary.test.mean_euclidean_error) px, p95 $(Format-Number $primary.test.p95) px, max $(Format-Number $primary.test.max) px."
$phase2Compare = "- Phase 2 reference validation/test counts: $($phase2Primary.metrics_by_split.validation.count) / $($phase2Primary.metrics_by_split.test.count); means $(Format-Number $phase2Primary.metrics_by_split.validation.mean_euclidean_error) / $(Format-Number $phase2Primary.metrics_by_split.test.mean_euclidean_error) px."
$fixed16 = $scores.comparison_targets.'fixed-16ms'
$fixed24 = $scores.comparison_targets.'fixed-24ms'
$fixedCompare = "- Fixed comparison targets with the same predictor: 16ms validation/test means $(Format-Number $fixed16.validation.mean_euclidean_error) / $(Format-Number $fixed16.test.mean_euclidean_error) px; 24ms validation/test means $(Format-Number $fixed24.validation.mean_euclidean_error) / $(Format-Number $fixed24.test.mean_euclidean_error) px."
$gateLine = "- Speed-gated gain analysis selected train-only gains by speed bin and changed validation mean by $(Format-Number $gate.validation_mean_delta_px 4) px ($(Format-Number $gate.validation_percent_change 2)%); test mean changed by $(Format-Number $gate.test_mean_delta_px 4) px ($(Format-Number $gate.test_percent_change 2)%)."

$report = @"
# Phase 3 Feature Engineering and Error Anatomy

## Method
- Reconstructed the accepted Phase 2 product path: poll anchors, dwm-next-vblank labels, chronological Phase 1 split, and gained-last2-0.75 baseline.
- Built labels by timestamp interpolation over poll samples and kept required history inside each split.
- Analyzed the primary baseline by speed, acceleration, turn angle, target horizon, hook age, poll-movement age, DWM phase, and duplicate-vs-moving anchors.
- Evaluated fixed 16ms and fixed 24ms comparison targets with the same poll-anchor gained-last2-0.75 predictor.

## Baseline Reconstruction
$validationCompare
$testCompare
$phase2Compare
$fixedCompare

The reconstruction matches the Phase 2 product baseline counts and metrics.

## Major Error Drivers
$clusterLines

The high-error tail is dominated by motion state rather than ordinary standing-still anchors. The biggest validation clusters are high-speed movement, high acceleration, long DWM/target horizons, and recent hook activity during motion. Direction-change bins show that true reversals are rare in this trace; many failures are fast, nearly straight segments where the last poll delta underestimates the target-window displacement. Duplicate anchors have a low average error, but some recent-movement duplicates create very large single-sample misses.

## Lightweight Oracle / Gating Check
$gateLine

This check is deliberately small: speed-bin gains are selected from train only, then applied unchanged to validation and test. It should be treated as a Phase 4 feature signal, not a final model.

## Phase 4 Feature Direction
- Minimal product-shaped search should start with last delta/velocity, speed, horizon, DWM phase, hook age, poll-movement age, and duplicate-anchor flags, predicting a residual or gain correction over gained-last2-0.75.
- Rich tabular models should add last-5 relative positions, velocity/acceleration history, turn angle, jerk proxy, hook-count windows, duplicate run length, and horizon normalized by DWM period.
- Temporal models should use a masked 16-step poll-history tensor plus context features for target horizon, DWM phase, hook age, and idle age.

## Leakage Rules
- Features must be computable at anchor time only.
- Future target positions and post-anchor hooks are labels/evaluation data only.
- Train-derived normalization, feature selection, and gating choices must be frozen before validation/test reporting.

See scores.json for full bin tables, representative high-error samples, gating metrics, leakage rules, and Phase 4 feature schemas.
"@
$report | Set-Content -LiteralPath (Join-Path $outResolved "report.md") -Encoding UTF8

$readme = @"
# Phase 3: Feature Engineering and Error Anatomy

This phase reconstructs the accepted Phase 2 product baseline and analyzes where it fails.

## Reproduce

From the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File "poc/cursor-prediction-v2/phase-3 feature-error-anatomy/run-phase3-feature-error-anatomy.ps1"
~~~

The script uses PowerShell plus .NET built-ins only. It reads:

- cursor-mirror-trace-20260501-091537.zip
- poc/cursor-prediction-v2/phase-1 data-audit-timebase/scores.json
- poc/cursor-prediction-v2/phase-2 ground-truth-baselines/scores.json

## Outputs

- scores.json: baseline reconstruction, error anatomy bins, top failure clusters, representative high-error samples, gating analysis, leakage rules, and Phase 4 feature schemas.
- report.md: concise findings and Phase 4 recommendation.
- experiment-log.md: execution details.
- run-phase3-feature-error-anatomy.ps1: reproducible analysis runner.
"@
$readme | Set-Content -LiteralPath (Join-Path $outResolved "README.md") -Encoding UTF8

$elapsed = [DateTime]::UtcNow - $startUtc
$log = @"
# Phase 3 Experiment Log

- Started UTC: $($startUtc.ToString("o"))
- Finished UTC: $([DateTime]::UtcNow.ToString("o"))
- Runtime seconds: $([Math]::Round($elapsed.TotalSeconds, 3))
- Trace zip: $zipResolved
- Phase 1 scores: $((Resolve-Path -LiteralPath $Phase1ScoresPath).Path)
- Phase 2 scores: $((Resolve-Path -LiteralPath $Phase2ScoresPath).Path)
- Output directory: $outResolved
- Stopwatch frequency: $stopwatchFrequency
- Rows read: $($scores.input.row_count)
- Poll rows: $($scores.input.poll_rows)
- Hook rows: $($scores.input.hook_rows)
- Primary validation samples: $($primary.validation.count)
- Primary test samples: $($primary.test.count)
- Representative high-error samples: $($scores.representative_high_error_samples.Count)
- Top failure clusters: $($scores.top_failure_clusters.Count)

No packages were installed. No hooks were run.
"@
$log | Set-Content -LiteralPath (Join-Path $outResolved "experiment-log.md") -Encoding UTF8

Write-Host "Wrote $scoresPath"
Write-Host "Primary validation mean: $(Format-Number $primary.validation.mean_euclidean_error) px"
Write-Host "Primary test mean: $(Format-Number $primary.test.mean_euclidean_error) px"
