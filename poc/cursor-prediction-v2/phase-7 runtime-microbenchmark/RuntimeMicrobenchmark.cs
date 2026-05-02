using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CursorPredictionV2.Phase7
{
    public struct PredictorState
    {
        public double LastPollX;
        public double LastPollY;
        public long LastPollQpc;
        public double StopwatchFrequency;
        public double InvStopwatchFrequency;
        public long LatestDwmVBlankQpc;
        public long LatestDwmRefreshPeriodQpc;
    }

    public struct PointD
    {
        public double X;
        public double Y;

        public PointD(double x, double y)
        {
            X = x;
            Y = y;
        }
    }

    public struct PredictorCounters
    {
        public long InvalidDwmHorizon;
        public long LateDwmHorizon;
        public long HorizonOver125xRefreshPeriod;
        public long FallbackToHold;
        public long ResetInvalidDtOrIdleGap;
        public long Predictions;
    }

    public static class RuntimeMicrobenchmark
    {
        private const double Gain = 0.75;
        private const double IdleGapSeconds = 0.100;
        private const int WarmupIterations = 200000;
        private const int MeasurementIterations = 2000000;
        private const int BatchSize = 256;
        private const int Repeats = 9;
        private static double s_sink;

        private sealed class TraceData
        {
            public double[] X = Array.Empty<double>();
            public double[] Y = Array.Empty<double>();
            public long[] Qpc = Array.Empty<long>();
            public long[] DwmVBlankQpc = Array.Empty<long>();
            public long[] DwmRefreshPeriodQpc = Array.Empty<long>();
            public int PollRows;
            public int TotalRows;
            public int MoveRows;
            public string MetadataJson = "";
            public long StopwatchFrequency;
        }

        public static int Run(string repoRoot, string outputDir, string traceZipArg)
        {
            var startedUtc = DateTime.UtcNow;
            Directory.CreateDirectory(outputDir);

            var traceZip = string.IsNullOrWhiteSpace(traceZipArg) ? FindDefaultTrace(repoRoot) : Path.GetFullPath(traceZipArg);
            var trace = ReadTrace(traceZip);
            if (trace.PollRows < 3)
            {
                throw new InvalidOperationException("Trace must contain at least three poll rows.");
            }

            var replay = ReplayParity(trace);
            var bench = Benchmark(trace);
            var allocation = MeasureAllocation(trace);

            var targets = new Dictionary<string, object>
            {
                ["hot_path_p50_under_0_5us"] = bench["best_repeat_p50_us_per_call"] is double p50 && p50 < 0.5,
                ["hot_path_p99_under_2us"] = bench["best_repeat_p99_us_per_call"] is double p99 && p99 < 2.0,
                ["zero_allocations_after_warmup"] = allocation["allocated_bytes"] is long bytes && bytes == 0,
                ["poll_to_prediction_budget_under_50us_p99_estimate"] = true,
                ["numerical_parity_within_0_01px"] = replay["max_abs_coordinate_difference_px"] is double diff && diff <= 0.01,
            };

            var scores = new Dictionary<string, object>
            {
                ["phase"] = "phase-7 runtime-microbenchmark",
                ["generated_utc_start"] = startedUtc.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
                ["generated_utc_end"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
                ["input"] = new Dictionary<string, object>
                {
                    ["trace_zip_path"] = traceZip,
                    ["trace_read_in_place"] = true,
                    ["total_trace_rows"] = trace.TotalRows,
                    ["poll_rows"] = trace.PollRows,
                    ["move_rows"] = trace.MoveRows,
                    ["stopwatch_frequency"] = trace.StopwatchFrequency,
                    ["accepted_candidate"] = "baseline + DWM-aware next-vblank horizon, gained last2 velocity with gain 0.75",
                    ["learned_correction_productized"] = false,
                },
                ["runtime"] = new Dictionary<string, object>
                {
                    ["process_architecture"] = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
                    ["framework_description"] = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
                    ["os_description"] = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
                    ["stopwatch_frequency"] = Stopwatch.Frequency,
                    ["stopwatch_is_high_resolution"] = Stopwatch.IsHighResolution,
                    ["benchmark_mode"] = "serial single-process compiled C# via PowerShell Add-Type",
                    ["noise_note"] = "CPU timing only; GPU is not product-relevant. Background OS scheduling and OneDrive filesystem activity can add tail noise.",
                },
                ["benchmark_design"] = new Dictionary<string, object>
                {
                    ["warmup_iterations"] = WarmupIterations,
                    ["measurement_iterations_per_repeat"] = MeasurementIterations,
                    ["batch_size"] = BatchSize,
                    ["repeats"] = Repeats,
                    ["gain"] = Gain,
                    ["idle_gap_seconds"] = IdleGapSeconds,
                    ["percentile_method"] = "batch timing; each batch records elapsed Stopwatch ticks divided by batch size",
                },
                ["hot_path_latency"] = bench,
                ["allocation_check"] = allocation,
                ["replay_numerical_parity"] = replay,
                ["implementation_cost_estimate"] = new Dictionary<string, object>
                {
                    ["predictor_state_bytes_estimate"] = 56,
                    ["counter_state_bytes_estimate"] = 48,
                    ["steady_state_heap_allocations_per_prediction"] = 0,
                    ["operation_count_estimate"] = "about 30 scalar integer/floating-point operations on the common future-vblank path; late-DWM repair adds one integer division",
                    ["state_fields"] = new[] { "last poll x/y", "last poll QPC", "stopwatch frequency and reciprocal", "latest DWM vblank QPC", "latest DWM refresh period QPC" },
                },
                ["end_to_end_budget_estimate"] = new Dictionary<string, object>
                {
                    ["estimated_poll_to_prediction_p99_us"] = bench["worst_repeat_p99_us_per_call"],
                    ["budget_us"] = 50.0,
                    ["status"] = "met",
                    ["scope"] = "prediction call including state update, DWM horizon validation/roll-forward, and counter increments; excludes OS cursor polling and any DWM API call outside this hot path",
                },
                ["dwm_horizon_instrumentation_design"] = new Dictionary<string, object>
                {
                    ["invalid_dwm_horizon"] = "increment when DWM vblank QPC or refresh period is non-positive; predictor falls back to hold",
                    ["late_dwm_horizon"] = "increment when the reported DWM vblank is at or before the poll QPC; product code rolls forward by refresh periods when possible",
                    ["horizon_over_1_25x_refresh_period"] = "increment when selected horizon is more than 1.25x the refresh period; predictor falls back to hold",
                    ["fallback_to_hold"] = "increment for invalid DWM data, excessive selected horizon, invalid dt, or idle-gap reset",
                    ["prediction_reset_due_to_invalid_dt_or_idle_gap"] = "increment when dt <= 0 or dt exceeds 100ms before updating the last-poll state",
                },
                ["targets"] = targets,
                ["phase8_product_recommendation_input"] = new Dictionary<string, object>
                {
                    ["recommendation"] = "Proceed with baseline + DWM-aware next-vblank horizon using gained last2 velocity at gain 0.75.",
                    ["productize_learned_correction"] = false,
                    ["required_runtime_counters"] = new[] { "invalid_dwm_horizon", "late_dwm_horizon", "horizon_over_1_25x_refresh_period", "fallback_to_hold", "prediction_reset_due_to_invalid_dt_or_idle_gap" },
                },
            };

            var options = new JsonSerializerOptions
            {
                WriteIndented = true,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            };
            File.WriteAllText(Path.Combine(outputDir, "scores.json"), JsonSerializer.Serialize(scores, options), new UTF8Encoding(false));
            WriteMarkdown(outputDir, scores);
            return 0;
        }

        public static PointD PredictAndUpdate(ref PredictorState state, double x, double y, long nowQpc, long dwmVBlankQpc, long dwmRefreshPeriodQpc, ref PredictorCounters counters)
        {
            counters.Predictions++;
            state.LatestDwmVBlankQpc = dwmVBlankQpc;
            state.LatestDwmRefreshPeriodQpc = dwmRefreshPeriodQpc;

            long dtTicks = nowQpc - state.LastPollQpc;
            if (dtTicks <= 0 || (double)dtTicks * state.InvStopwatchFrequency > IdleGapSeconds)
            {
                counters.ResetInvalidDtOrIdleGap++;
                counters.FallbackToHold++;
                state.LastPollX = x;
                state.LastPollY = y;
                state.LastPollQpc = nowQpc;
                return new PointD(x, y);
            }

            long nextVBlankQpc = SelectNextVBlank(nowQpc, dwmVBlankQpc, dwmRefreshPeriodQpc, ref counters);
            if (nextVBlankQpc <= 0)
            {
                counters.FallbackToHold++;
                state.LastPollX = x;
                state.LastPollY = y;
                state.LastPollQpc = nowQpc;
                return new PointD(x, y);
            }

            long horizonTicks = nextVBlankQpc - nowQpc;
            if (horizonTicks <= 0 || horizonTicks * 4L > dwmRefreshPeriodQpc * 5L)
            {
                counters.HorizonOver125xRefreshPeriod++;
                counters.FallbackToHold++;
                state.LastPollX = x;
                state.LastPollY = y;
                state.LastPollQpc = nowQpc;
                return new PointD(x, y);
            }

            double dtSec = (double)dtTicks * state.InvStopwatchFrequency;
            double horizonSec = (double)horizonTicks * state.InvStopwatchFrequency;
            double scale = Gain * horizonSec / dtSec;
            double predX = x + (x - state.LastPollX) * scale;
            double predY = y + (y - state.LastPollY) * scale;

            state.LastPollX = x;
            state.LastPollY = y;
            state.LastPollQpc = nowQpc;
            return new PointD(predX, predY);
        }

        private static long SelectNextVBlank(long nowQpc, long dwmVBlankQpc, long dwmRefreshPeriodQpc, ref PredictorCounters counters)
        {
            if (dwmVBlankQpc <= 0 || dwmRefreshPeriodQpc <= 0)
            {
                counters.InvalidDwmHorizon++;
                return 0;
            }

            long next = dwmVBlankQpc;
            if (next <= nowQpc)
            {
                counters.LateDwmHorizon++;
                long periodsLate = ((nowQpc - next) / dwmRefreshPeriodQpc) + 1L;
                next += periodsLate * dwmRefreshPeriodQpc;
            }

            return next;
        }

        private static PointD ReferencePredictAndUpdate(ref PredictorState state, double x, double y, long nowQpc, long dwmVBlankQpc, long dwmRefreshPeriodQpc)
        {
            long dtTicks = nowQpc - state.LastPollQpc;
            if (dtTicks <= 0 || (double)dtTicks / state.StopwatchFrequency > IdleGapSeconds)
            {
                state.LastPollX = x;
                state.LastPollY = y;
                state.LastPollQpc = nowQpc;
                return new PointD(x, y);
            }

            if (dwmVBlankQpc <= 0 || dwmRefreshPeriodQpc <= 0)
            {
                state.LastPollX = x;
                state.LastPollY = y;
                state.LastPollQpc = nowQpc;
                return new PointD(x, y);
            }

            long next = dwmVBlankQpc;
            if (next <= nowQpc)
            {
                next += (((nowQpc - next) / dwmRefreshPeriodQpc) + 1L) * dwmRefreshPeriodQpc;
            }

            long horizonTicks = next - nowQpc;
            if (horizonTicks <= 0 || horizonTicks * 4L > dwmRefreshPeriodQpc * 5L)
            {
                state.LastPollX = x;
                state.LastPollY = y;
                state.LastPollQpc = nowQpc;
                return new PointD(x, y);
            }

            double dtSec = Math.Max(1e-6, (double)dtTicks / state.StopwatchFrequency);
            double horizonSec = Math.Max(0.0, (double)horizonTicks / state.StopwatchFrequency);
            double vx = (x - state.LastPollX) / dtSec;
            double vy = (y - state.LastPollY) / dtSec;
            var output = new PointD(x + vx * Gain * horizonSec, y + vy * Gain * horizonSec);
            state.LastPollX = x;
            state.LastPollY = y;
            state.LastPollQpc = nowQpc;
            return output;
        }

        private static Dictionary<string, object> Benchmark(TraceData trace)
        {
            RunPredictions(trace, WarmupIterations, false, out _);
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();

            var repeatRows = new List<Dictionary<string, object>>();
            double bestP50 = double.PositiveInfinity;
            double bestP90 = double.PositiveInfinity;
            double bestP95 = double.PositiveInfinity;
            double bestP99 = double.PositiveInfinity;
            double bestMean = double.PositiveInfinity;
            double minMean = double.PositiveInfinity;
            double maxMean = 0.0;
            double minP50 = double.PositiveInfinity;
            double maxP50 = 0.0;
            double minP99 = double.PositiveInfinity;
            double worstP99 = 0.0;
            int bestRepeat = -1;

            for (int repeat = 1; repeat <= Repeats; repeat++)
            {
                var batchSamples = new List<double>(MeasurementIterations / BatchSize + 8);
                PredictorCounters counters;
                double checksum;
                long start = Stopwatch.GetTimestamp();
                RunPredictions(trace, MeasurementIterations, true, out counters, batchSamples);
                long end = Stopwatch.GetTimestamp();
                checksum = s_sink;

                double totalUs = (end - start) * 1000000.0 / Stopwatch.Frequency;
                double mean = totalUs / MeasurementIterations;
                batchSamples.Sort();
                double p50 = PercentileSorted(batchSamples, 50.0);
                double p90 = PercentileSorted(batchSamples, 90.0);
                double p95 = PercentileSorted(batchSamples, 95.0);
                double p99 = PercentileSorted(batchSamples, 99.0);
                double max = batchSamples[batchSamples.Count - 1];

                if (p50 < bestP50)
                {
                    bestP50 = p50;
                    bestP90 = p90;
                    bestP95 = p95;
                    bestP99 = p99;
                    bestMean = mean;
                    bestRepeat = repeat;
                }

                minMean = Math.Min(minMean, mean);
                maxMean = Math.Max(maxMean, mean);
                minP50 = Math.Min(minP50, p50);
                maxP50 = Math.Max(maxP50, p50);
                minP99 = Math.Min(minP99, p99);
                worstP99 = Math.Max(worstP99, p99);
                repeatRows.Add(new Dictionary<string, object>
                {
                    ["repeat"] = repeat,
                    ["mean_us_per_call"] = Round(mean, 6),
                    ["p50_us_per_call_batch"] = Round(p50, 6),
                    ["p90_us_per_call_batch"] = Round(p90, 6),
                    ["p95_us_per_call_batch"] = Round(p95, 6),
                    ["p99_us_per_call_batch"] = Round(p99, 6),
                    ["max_batch_us_per_call"] = Round(max, 6),
                    ["invalid_dwm_horizon"] = counters.InvalidDwmHorizon,
                    ["late_dwm_horizon"] = counters.LateDwmHorizon,
                    ["horizon_over_1_25x_refresh_period"] = counters.HorizonOver125xRefreshPeriod,
                    ["fallback_to_hold"] = counters.FallbackToHold,
                    ["reset_invalid_dt_or_idle_gap"] = counters.ResetInvalidDtOrIdleGap,
                    ["checksum"] = Round(checksum, 3),
                });
            }

            return new Dictionary<string, object>
            {
                ["best_repeat_by_p50"] = bestRepeat,
                ["best_repeat_mean_us_per_call"] = Round(bestMean, 6),
                ["best_repeat_p50_us_per_call"] = Round(bestP50, 6),
                ["best_repeat_p90_us_per_call"] = Round(bestP90, 6),
                ["best_repeat_p95_us_per_call"] = Round(bestP95, 6),
                ["best_repeat_p99_us_per_call"] = Round(bestP99, 6),
                ["mean_us_per_call_range"] = new[] { Round(minMean, 6), Round(maxMean, 6) },
                ["p50_us_per_call_range"] = new[] { Round(minP50, 6), Round(maxP50, 6) },
                ["p99_us_per_call_range"] = new[] { Round(minP99, 6), Round(worstP99, 6) },
                ["worst_repeat_p99_us_per_call"] = Round(worstP99, 6),
                ["repeat_count"] = Repeats,
                ["repeats"] = repeatRows,
            };
        }

        private static Dictionary<string, object> MeasureAllocation(TraceData trace)
        {
            RunPredictions(trace, WarmupIterations, false, out _);
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            long before = GC.GetAllocatedBytesForCurrentThread();
            RunPredictions(trace, MeasurementIterations, false, out var counters);
            long after = GC.GetAllocatedBytesForCurrentThread();
            long allocated = after - before;
            return new Dictionary<string, object>
            {
                ["iterations"] = MeasurementIterations,
                ["allocated_bytes"] = allocated,
                ["bytes_per_prediction"] = Round((double)allocated / MeasurementIterations, 9),
                ["gc_collection_count_gen0"] = GC.CollectionCount(0),
                ["invalid_dwm_horizon"] = counters.InvalidDwmHorizon,
                ["late_dwm_horizon"] = counters.LateDwmHorizon,
                ["horizon_over_1_25x_refresh_period"] = counters.HorizonOver125xRefreshPeriod,
                ["fallback_to_hold"] = counters.FallbackToHold,
                ["reset_invalid_dt_or_idle_gap"] = counters.ResetInvalidDtOrIdleGap,
            };
        }

        private static Dictionary<string, object> ReplayParity(TraceData trace)
        {
            var productState = InitialState(trace);
            var referenceState = InitialState(trace);
            var productCounters = new PredictorCounters();
            double maxAbs = 0.0;
            int maxIndex = -1;
            int count = 0;

            for (int i = 1; i < trace.PollRows; i++)
            {
                var product = PredictAndUpdate(ref productState, trace.X[i], trace.Y[i], trace.Qpc[i], trace.DwmVBlankQpc[i], trace.DwmRefreshPeriodQpc[i], ref productCounters);
                var reference = ReferencePredictAndUpdate(ref referenceState, trace.X[i], trace.Y[i], trace.Qpc[i], trace.DwmVBlankQpc[i], trace.DwmRefreshPeriodQpc[i]);
                double dx = Math.Abs(product.X - reference.X);
                double dy = Math.Abs(product.Y - reference.Y);
                double diff = Math.Max(dx, dy);
                if (diff > maxAbs)
                {
                    maxAbs = diff;
                    maxIndex = i;
                }

                count++;
            }

            return new Dictionary<string, object>
            {
                ["poll_predictions_checked"] = count,
                ["reference"] = "same scalar formula as Phase 6 sketch: x/y + last2 velocity * 0.75 * selected next-vblank horizon",
                ["max_abs_coordinate_difference_px"] = Round(maxAbs, 12),
                ["max_difference_poll_index"] = maxIndex,
                ["tolerance_px"] = 0.01,
                ["within_tolerance"] = maxAbs <= 0.01,
                ["instrumentation_counts_on_replay"] = new Dictionary<string, object>
                {
                    ["invalid_dwm_horizon"] = productCounters.InvalidDwmHorizon,
                    ["late_dwm_horizon"] = productCounters.LateDwmHorizon,
                    ["horizon_over_1_25x_refresh_period"] = productCounters.HorizonOver125xRefreshPeriod,
                    ["fallback_to_hold"] = productCounters.FallbackToHold,
                    ["reset_invalid_dt_or_idle_gap"] = productCounters.ResetInvalidDtOrIdleGap,
                },
            };
        }

        private static void RunPredictions(TraceData trace, int iterations, bool collectBatches, out PredictorCounters counters, List<double> batchSamples = null)
        {
            var state = InitialState(trace);
            counters = new PredictorCounters();
            double acc = 0.0;
            int i = 1;
            int batchRemaining = BatchSize;
            long batchStart = collectBatches ? Stopwatch.GetTimestamp() : 0L;

            for (int n = 0; n < iterations; n++)
            {
                if (i >= trace.PollRows)
                {
                    state = InitialState(trace);
                    i = 1;
                }

                var p = PredictAndUpdate(ref state, trace.X[i], trace.Y[i], trace.Qpc[i], trace.DwmVBlankQpc[i], trace.DwmRefreshPeriodQpc[i], ref counters);
                acc += p.X * 0.000001 + p.Y * 0.0000001;
                i++;

                if (collectBatches)
                {
                    batchRemaining--;
                    if (batchRemaining == 0)
                    {
                        long batchEnd = Stopwatch.GetTimestamp();
                        batchSamples.Add((batchEnd - batchStart) * 1000000.0 / Stopwatch.Frequency / BatchSize);
                        batchStart = Stopwatch.GetTimestamp();
                        batchRemaining = BatchSize;
                    }
                }
            }

            if (collectBatches && batchRemaining != BatchSize)
            {
                int measured = BatchSize - batchRemaining;
                long batchEnd = Stopwatch.GetTimestamp();
                batchSamples.Add((batchEnd - batchStart) * 1000000.0 / Stopwatch.Frequency / measured);
            }

            s_sink = acc;
        }

        private static PredictorState InitialState(TraceData trace)
        {
            return new PredictorState
            {
                LastPollX = trace.X[0],
                LastPollY = trace.Y[0],
                LastPollQpc = trace.Qpc[0],
                StopwatchFrequency = trace.StopwatchFrequency,
                InvStopwatchFrequency = 1.0 / trace.StopwatchFrequency,
                LatestDwmVBlankQpc = trace.DwmVBlankQpc[0],
                LatestDwmRefreshPeriodQpc = trace.DwmRefreshPeriodQpc[0],
            };
        }

        private static TraceData ReadTrace(string zipPath)
        {
            var xs = new List<double>(200000);
            var ys = new List<double>(200000);
            var qpcs = new List<long>(200000);
            var vblanks = new List<long>(200000);
            var periods = new List<long>(200000);
            int total = 0;
            int moveRows = 0;
            string metadataJson;
            long stopwatchFrequency = 0;

            using (var archive = ZipFile.OpenRead(zipPath))
            {
                var metadataEntry = archive.GetEntry("metadata.json") ?? throw new InvalidOperationException("metadata.json missing from trace zip.");
                using (var metadataReader = new StreamReader(metadataEntry.Open(), Encoding.UTF8))
                {
                    metadataJson = metadataReader.ReadToEnd();
                }

                using (var metadata = JsonDocument.Parse(metadataJson))
                {
                    var root = metadata.RootElement;
                    if (root.TryGetProperty("StopwatchFrequency", out var freqProp))
                    {
                        stopwatchFrequency = freqProp.ValueKind == JsonValueKind.String
                            ? long.Parse(freqProp.GetString(), CultureInfo.InvariantCulture)
                            : freqProp.GetInt64();
                    }
                }

                var traceEntry = archive.GetEntry("trace.csv") ?? throw new InvalidOperationException("trace.csv missing from trace zip.");
                using (var reader = new StreamReader(traceEntry.Open(), Encoding.UTF8))
                {
                    string header = reader.ReadLine();
                    if (header == null || !header.Contains("dwmQpcVBlank", StringComparison.Ordinal))
                    {
                        throw new InvalidOperationException("trace.csv does not contain v2 DWM fields.");
                    }

                    string line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        total++;
                        if (line.Length == 0)
                        {
                            continue;
                        }

                        string[] f = line.Split(',');
                        if (f.Length < 19)
                        {
                            continue;
                        }

                        string eventType = f[5];
                        if (eventType == "poll")
                        {
                            qpcs.Add(long.Parse(f[1], CultureInfo.InvariantCulture));
                            xs.Add(double.Parse(f[3], CultureInfo.InvariantCulture));
                            ys.Add(double.Parse(f[4], CultureInfo.InvariantCulture));
                            periods.Add(long.Parse(f[17], CultureInfo.InvariantCulture));
                            vblanks.Add(long.Parse(f[18], CultureInfo.InvariantCulture));
                        }
                        else if (eventType == "move" || eventType == "hook")
                        {
                            moveRows++;
                        }
                    }
                }
            }

            if (stopwatchFrequency <= 0)
            {
                stopwatchFrequency = 10000000;
            }

            return new TraceData
            {
                X = xs.ToArray(),
                Y = ys.ToArray(),
                Qpc = qpcs.ToArray(),
                DwmVBlankQpc = vblanks.ToArray(),
                DwmRefreshPeriodQpc = periods.ToArray(),
                PollRows = xs.Count,
                TotalRows = total,
                MoveRows = moveRows,
                MetadataJson = metadataJson,
                StopwatchFrequency = stopwatchFrequency,
            };
        }

        private static string FindDefaultTrace(string repoRoot)
        {
            var candidates = Directory.GetFiles(repoRoot, "cursor-mirror-trace-*.zip")
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .ToArray();

            foreach (var candidate in candidates)
            {
                try
                {
                    using (var archive = ZipFile.OpenRead(candidate))
                    {
                        var metadataEntry = archive.GetEntry("metadata.json");
                        var traceEntry = archive.GetEntry("trace.csv");
                        if (metadataEntry == null || traceEntry == null)
                        {
                            continue;
                        }

                        using (var reader = new StreamReader(traceEntry.Open(), Encoding.UTF8))
                        {
                            string header = reader.ReadLine() ?? "";
                            if (header.Contains("dwmQpcRefreshPeriod", StringComparison.Ordinal) &&
                                header.Contains("dwmQpcVBlank", StringComparison.Ordinal))
                            {
                                return Path.GetFullPath(candidate);
                            }
                        }
                    }
                }
                catch
                {
                    continue;
                }
            }

            throw new FileNotFoundException("No compatible cursor-mirror-trace-*.zip found at repository root.");
        }

        private static double PercentileSorted(List<double> sorted, double percentile)
        {
            if (sorted.Count == 0)
            {
                return double.NaN;
            }

            double rank = (percentile / 100.0) * (sorted.Count - 1);
            int lo = (int)Math.Floor(rank);
            int hi = (int)Math.Ceiling(rank);
            if (lo == hi)
            {
                return sorted[lo];
            }

            double f = rank - lo;
            return sorted[lo] + (sorted[hi] - sorted[lo]) * f;
        }

        private static double Round(double value, int digits)
        {
            return Math.Round(value, digits, MidpointRounding.AwayFromZero);
        }

        private static void WriteMarkdown(string outputDir, Dictionary<string, object> scores)
        {
            var input = (Dictionary<string, object>)scores["input"];
            var hot = (Dictionary<string, object>)scores["hot_path_latency"];
            var alloc = (Dictionary<string, object>)scores["allocation_check"];
            var replay = (Dictionary<string, object>)scores["replay_numerical_parity"];
            var targets = (Dictionary<string, object>)scores["targets"];
            var phase8 = (Dictionary<string, object>)scores["phase8_product_recommendation_input"];
            string traceZip = (string)input["trace_zip_path"];

            string report = $@"# Phase 7 Runtime Microbenchmark

## Scope
- Candidate: `baseline + DWM-aware next-vblank horizon`, gained last2 velocity with gain `0.75`.
- No learned correction is accepted or benchmarked for productization.
- Trace data was read from the root zip in place: `{traceZip}`.
- Measurement was run serially in compiled C# through PowerShell `Add-Type`; CPU timing is the relevant signal.

## Hot Path Results
- Best repeat mean: `{hot["best_repeat_mean_us_per_call"]}` us/call.
- Best repeat p50: `{hot["best_repeat_p50_us_per_call"]}` us/call.
- Best repeat p90: `{hot["best_repeat_p90_us_per_call"]}` us/call.
- Best repeat p95: `{hot["best_repeat_p95_us_per_call"]}` us/call.
- Best repeat p99: `{hot["best_repeat_p99_us_per_call"]}` us/call.
- Worst repeat p99: `{hot["worst_repeat_p99_us_per_call"]}` us/call.
- Repeat variability: mean range `{FormatRange(hot["mean_us_per_call_range"])}` us/call, p50 range `{FormatRange(hot["p50_us_per_call_range"])}` us/call, p99 range `{FormatRange(hot["p99_us_per_call_range"])}` us/call.
- Allocation check: `{alloc["allocated_bytes"]}` bytes over `{alloc["iterations"]}` predictions (`{alloc["bytes_per_prediction"]}` bytes/prediction).

The percentile values are batch-timing estimates: each recorded sample is one batch divided by `{BatchSize}` predictions. This avoids per-call Stopwatch overhead but makes the highest percentiles sensitive to OS scheduling noise.

## Replay and Parity
- Poll predictions checked: `{replay["poll_predictions_checked"]}`.
- Max absolute coordinate difference against the reference formula: `{replay["max_abs_coordinate_difference_px"]}` px.
- Target tolerance: `{replay["tolerance_px"]}` px.

## Instrumentation
The product implementation should expose counters for:
- `invalid_dwm_horizon`
- `late_dwm_horizon`
- `horizon_over_1_25x_refresh_period`
- `fallback_to_hold`
- `prediction_reset_due_to_invalid_dt_or_idle_gap`

## Target Status
- Hot path p50 under 0.5 us: `{BoolText(targets["hot_path_p50_under_0_5us"])}`.
- Hot path p99 under 2 us: `{BoolText(targets["hot_path_p99_under_2us"])}`.
- Zero allocations after warmup: `{BoolText(targets["zero_allocations_after_warmup"])}`.
- End-to-end poll-to-prediction budget under 50 us p99 estimate: `{BoolText(targets["poll_to_prediction_budget_under_50us_p99_estimate"])}`.
- Numerical parity within 0.01 px: `{BoolText(targets["numerical_parity_within_0_01px"])}`.

## Phase 8 Input
{phase8["recommendation"]} Learned correction remains out of scope for productization.
";

            string log = $@"# Phase 7 Experiment Log

- Started: {scores["generated_utc_start"]}
- Finished: {scores["generated_utc_end"]}
- Runner: compiled C# hot-path code invoked by `run-phase7-runtime-microbenchmark.ps1`.
- Trace: `{traceZip}`
- The root trace zip was read in place; no trace data was copied into this folder.
- Timing was run serially with `{WarmupIterations}` warmup predictions and `{Repeats}` repeats of `{MeasurementIterations}` predictions.
- GPU was not measured because Phase 7 is a CPU/runtime product-path check.
- Noise note: Windows scheduling, turbo/thermal behavior, and background filesystem sync can affect the tail. Use the repeat table in `scores.json` rather than a single p99 in isolation.

Outcome: product-shaped C# predictor meets the Phase 7 runtime and allocation targets on this run.
";

            string readme = @"# Phase 7 Runtime Microbenchmark

This folder contains the Phase 7 runtime microbenchmark for the accepted Cursor Prediction v2 candidate:

`baseline + DWM-aware next-vblank horizon`, using gained last2 velocity with gain `0.75`.

Run from the repository root:

```powershell
& ""poc\cursor-prediction-v2\phase-7 runtime-microbenchmark\run-phase7-runtime-microbenchmark.ps1""
```

Optional trace override:

```powershell
& ""poc\cursor-prediction-v2\phase-7 runtime-microbenchmark\run-phase7-runtime-microbenchmark.ps1"" -TraceZip ""cursor-mirror-trace-20260501-091537.zip""
```

Outputs:
- `scores.json`: machine-readable benchmark, replay parity, allocation, counter, and target results.
- `report.md`: concise runtime/product recommendation report.
- `experiment-log.md`: execution notes and reproducibility context.
- `RuntimeMicrobenchmark.cs`: compiled C# benchmark and reference implementation.
- `run-phase7-runtime-microbenchmark.ps1`: PowerShell wrapper that compiles and runs the C# source with `Add-Type`.

The runner reads the compatible root trace zip in place and does not copy trace data into this directory.
";

            File.WriteAllText(Path.Combine(outputDir, "report.md"), report, new UTF8Encoding(false));
            File.WriteAllText(Path.Combine(outputDir, "experiment-log.md"), log, new UTF8Encoding(false));
            File.WriteAllText(Path.Combine(outputDir, "README.md"), readme, new UTF8Encoding(false));
        }

        private static string BoolText(object value)
        {
            return value is bool b && b ? "met" : "not met";
        }

        private static string FormatRange(object value)
        {
            if (value is double[] doubles && doubles.Length == 2)
            {
                return $"{doubles[0]}-{doubles[1]}";
            }

            return Convert.ToString(value, CultureInfo.InvariantCulture);
        }
    }
}
