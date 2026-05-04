using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using CursorMirror;
using CursorMirror.ProductRuntimeTelemetry;

namespace SyntheticOverlayHarness
{
    internal static class Program
    {
        private const int DefaultFrameCount = 360;
        private const int RecorderCapacity = 65536;

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                HarnessOptions options = HarnessOptions.Parse(args);
                Directory.CreateDirectory(options.OutputDirectory);

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                List<ScenarioResult> results = new List<ScenarioResult>();
                results.Add(RunScenario(
                    options,
                    "moving-every-frame",
                    BuildMovingSamples(options.FrameCount)));
                results.Add(RunScenario(
                    options,
                    "hold-heavy-repeated-positions",
                    BuildHoldHeavySamples(options.FrameCount)));

                string metricsPath = Path.Combine(options.OutputDirectory, "metrics.json");
                string reportPath = Path.Combine(options.OutputDirectory, "report.md");
                File.WriteAllText(metricsPath, BuildMetricsJson(results), Encoding.UTF8);
                File.WriteAllText(reportPath, BuildReport(results), Encoding.UTF8);

                Console.WriteLine("Synthetic overlay harness complete.");
                Console.WriteLine("Output: " + options.OutputDirectory);
                Console.WriteLine("Report: " + reportPath);
                foreach (ScenarioResult result in results)
                {
                    Console.WriteLine(result.Name + ": " + result.PackagePath);
                }

                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex);
                return 1;
            }
            finally
            {
                ProductRuntimeOutlierRecorder.Current = ProductRuntimeOutlierRecorder.Disabled;
            }
        }

        private static ScenarioResult RunScenario(HarnessOptions options, string name, Point[] samples)
        {
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Create(RecorderCapacity);
            ProductRuntimeOutlierRecorder.Current = recorder;

            long refreshPeriodTicks = Math.Max(1, Stopwatch.Frequency / 60);
            SyntheticCursorPoller poller = new SyntheticCursorPoller(samples, 1, refreshPeriodTicks);
            SyntheticCursorImageProvider imageProvider = new SyntheticCursorImageProvider();
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            settings.PredictionEnabled = false;
            settings.MovementTranslucencyEnabled = false;
            settings.IdleFadeEnabled = false;
            settings.MovingOpacityPercent = 100;
            settings.IdleOpacityPercent = 0;

            using (OverlayWindow overlay = new OverlayWindow())
            using (CursorMirrorController controller = new CursorMirrorController(
                imageProvider,
                overlay,
                new ImmediateDispatcher(),
                settings,
                new SystemClock(),
                poller))
            {
                controller.UpdateAt(samples[0]);
                Application.DoEvents();
                Thread.Sleep(options.WarmupMilliseconds);

                long nextTick = Stopwatch.GetTimestamp();
                for (int i = 1; i < samples.Length; i++)
                {
                    long now = Stopwatch.GetTimestamp();
                    if (now < nextTick)
                    {
                        SleepUntil(nextTick);
                    }

                    long targetVBlankTicks = Stopwatch.GetTimestamp() + refreshPeriodTicks;
                    controller.Tick(targetVBlankTicks, refreshPeriodTicks);
                    if ((i & 15) == 0)
                    {
                        Application.DoEvents();
                    }

                    nextTick += refreshPeriodTicks;
                }

                Application.DoEvents();
                Thread.Sleep(options.CooldownMilliseconds);
                controller.Hide();
                Application.DoEvents();
            }

            ProductRuntimeOutlierSnapshot snapshot = recorder.Snapshot();
            string packagePath = Path.Combine(options.OutputDirectory, "product-runtime-outlier-" + name + ".zip");
            new ProductRuntimeOutlierPackageWriter().Write(packagePath, snapshot);

            return new ScenarioResult(name, packagePath, AnalyzeSnapshot(name, snapshot, samples.Length));
        }

        private static void SleepUntil(long targetTicks)
        {
            while (true)
            {
                long remainingTicks = targetTicks - Stopwatch.GetTimestamp();
                if (remainingTicks <= 0)
                {
                    return;
                }

                double remainingMilliseconds = remainingTicks * 1000.0 / Stopwatch.Frequency;
                if (remainingMilliseconds > 2.0)
                {
                    Thread.Sleep(Math.Max(1, (int)Math.Floor(remainingMilliseconds) - 1));
                }
                else
                {
                    Thread.SpinWait(64);
                }
            }
        }

        private static Point[] BuildMovingSamples(int frameCount)
        {
            Point[] points = new Point[frameCount];
            const int baseX = 120;
            const int baseY = 120;
            for (int i = 0; i < points.Length; i++)
            {
                points[i] = new Point(baseX + i * 3, baseY + (int)Math.Round(Math.Sin(i / 12.0) * 32.0));
            }

            return points;
        }

        private static Point[] BuildHoldHeavySamples(int frameCount)
        {
            Point[] points = new Point[frameCount];
            const int baseX = 120;
            const int baseY = 260;
            for (int i = 0; i < points.Length; i++)
            {
                int block = i / 12;
                points[i] = new Point(baseX + block * 14, baseY + ((block % 2 == 0) ? 0 : 18));
            }

            return points;
        }

        private static ScenarioMetrics AnalyzeSnapshot(string name, ProductRuntimeOutlierSnapshot snapshot, int syntheticFrameCount)
        {
            ScenarioMetrics metrics = new ScenarioMetrics();
            metrics.Name = name;
            metrics.SyntheticFrameCount = syntheticFrameCount;
            metrics.EventCount = snapshot.Events.Length;
            metrics.DroppedCount = snapshot.DroppedCount;

            List<double> controllerTickUs = new List<double>();
            List<double> controllerMoveOverlayUs = new List<double>();
            List<double> updateLayerUs = new List<double>();
            List<double> updateLayeredWindowUs = new List<double>();
            List<double> overlayMoveUs = new List<double>();
            List<double> getDcUs = new List<double>();
            List<double> getHbitmapUs = new List<double>();

            for (int i = 0; i < snapshot.Events.Length; i++)
            {
                ProductRuntimeOutlierEvent item = snapshot.Events[i];
                if (item.EventKind == (int)ProductRuntimeOutlierEventKind.ControllerTick)
                {
                    metrics.ControllerEvents++;
                    metrics.OverlayMoveSkipped += item.OverlayMoveSkipped;
                    AddTicks(controllerTickUs, item.TickTotalDurationTicks, snapshot.StopwatchFrequency);
                    AddTicks(controllerMoveOverlayUs, item.MoveOverlayDurationTicks, snapshot.StopwatchFrequency);
                }
                else if (item.EventKind == (int)ProductRuntimeOutlierEventKind.OverlayOperation)
                {
                    metrics.OverlayEvents++;
                    if (item.OverlayOperation == (int)ProductOverlayOperation.Move)
                    {
                        AddTicks(overlayMoveUs, item.TotalTicks, snapshot.StopwatchFrequency);
                    }
                    else if (item.OverlayOperation == (int)ProductOverlayOperation.UpdateLayer)
                    {
                        metrics.UpdateLayerEvents++;
                        if (item.Succeeded == 0)
                        {
                            metrics.UpdateLayerFailures++;
                        }

                        AddTicks(updateLayerUs, item.TotalTicks, snapshot.StopwatchFrequency);
                        AddTicks(updateLayeredWindowUs, item.UpdateLayeredWindowTicks, snapshot.StopwatchFrequency);
                        AddTicks(getDcUs, item.GetDcTicks, snapshot.StopwatchFrequency);
                        AddTicks(getHbitmapUs, item.GetHbitmapTicks, snapshot.StopwatchFrequency);
                    }
                }
            }

            metrics.ControllerTickUs = Stats.From(controllerTickUs);
            metrics.ControllerMoveOverlayUs = Stats.From(controllerMoveOverlayUs);
            metrics.OverlayMoveUs = Stats.From(overlayMoveUs);
            metrics.UpdateLayerUs = Stats.From(updateLayerUs);
            metrics.UpdateLayeredWindowUs = Stats.From(updateLayeredWindowUs);
            metrics.GetDcUs = Stats.From(getDcUs);
            metrics.GetHbitmapUs = Stats.From(getHbitmapUs);
            return metrics;
        }

        private static void AddTicks(List<double> values, long ticks, long frequency)
        {
            if (ticks <= 0 || frequency <= 0)
            {
                return;
            }

            values.Add(ticks * 1000000.0 / frequency);
        }

        private static string BuildReport(IEnumerable<ScenarioResult> results)
        {
            StringBuilder builder = new StringBuilder();
            builder.AppendLine("# Synthetic Overlay Harness Report");
            builder.AppendLine();
            builder.AppendLine("POC-only harness using real `OverlayWindow` / `UpdateLayeredWindow` with synthetic cursor images and synthetic poll samples. It does not call `GetCursorPos` and does not use WGC.");
            builder.AppendLine();
            builder.AppendLine("| Scenario | frames | events | controller | overlay | `UpdateLayer` | skipped moves | failures |");
            builder.AppendLine("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
            foreach (ScenarioResult result in results)
            {
                ScenarioMetrics m = result.Metrics;
                builder.AppendLine(string.Format(
                    CultureInfo.InvariantCulture,
                    "| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} |",
                    result.Name,
                    m.SyntheticFrameCount,
                    m.EventCount,
                    m.ControllerEvents,
                    m.OverlayEvents,
                    m.UpdateLayerEvents,
                    m.OverlayMoveSkipped,
                    m.UpdateLayerFailures));
            }

            foreach (ScenarioResult result in results)
            {
                ScenarioMetrics m = result.Metrics;
                builder.AppendLine();
                builder.AppendLine("## " + result.Name);
                builder.AppendLine();
                builder.AppendLine("- package: `" + Path.GetFileName(result.PackagePath) + "`");
                builder.AppendLine("- dropped events: `" + m.DroppedCount.ToString(CultureInfo.InvariantCulture) + "`");
                builder.AppendLine("- `UpdateLayeredWindow` failures: `" + m.UpdateLayerFailures.ToString(CultureInfo.InvariantCulture) + "`");
                builder.AppendLine();
                builder.AppendLine("| Metric | count | p50 us | p95 us | p99 us | max us |");
                builder.AppendLine("| --- | ---: | ---: | ---: | ---: | ---: |");
                AddMetricRow(builder, "controller tick total", m.ControllerTickUs);
                AddMetricRow(builder, "controller move overlay", m.ControllerMoveOverlayUs);
                AddMetricRow(builder, "overlay move", m.OverlayMoveUs);
                AddMetricRow(builder, "`UpdateLayer`", m.UpdateLayerUs);
                AddMetricRow(builder, "`GetDC`", m.GetDcUs);
                AddMetricRow(builder, "`GetHbitmap`", m.GetHbitmapUs);
                AddMetricRow(builder, "`UpdateLayeredWindow`", m.UpdateLayeredWindowUs);
            }

            return builder.ToString();
        }

        private static void AddMetricRow(StringBuilder builder, string name, Stats stats)
        {
            builder.AppendLine(string.Format(
                CultureInfo.InvariantCulture,
                "| {0} | {1} | {2} | {3} | {4} | {5} |",
                name,
                stats.Count,
                FormatStat(stats.P50),
                FormatStat(stats.P95),
                FormatStat(stats.P99),
                FormatStat(stats.Max)));
        }

        private static string BuildMetricsJson(IEnumerable<ScenarioResult> results)
        {
            StringBuilder builder = new StringBuilder();
            builder.AppendLine("{");
            builder.AppendLine("  \"generatedUtc\": \"" + Escape(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)) + "\",");
            builder.AppendLine("  \"scenarios\": [");
            int index = 0;
            foreach (ScenarioResult result in results)
            {
                if (index > 0)
                {
                    builder.AppendLine(",");
                }

                ScenarioMetrics m = result.Metrics;
                builder.AppendLine("    {");
                builder.AppendLine("      \"name\": \"" + Escape(result.Name) + "\",");
                builder.AppendLine("      \"package\": \"" + Escape(Path.GetFileName(result.PackagePath)) + "\",");
                builder.AppendLine("      \"syntheticFrameCount\": " + m.SyntheticFrameCount.ToString(CultureInfo.InvariantCulture) + ",");
                builder.AppendLine("      \"eventCount\": " + m.EventCount.ToString(CultureInfo.InvariantCulture) + ",");
                builder.AppendLine("      \"droppedCount\": " + m.DroppedCount.ToString(CultureInfo.InvariantCulture) + ",");
                builder.AppendLine("      \"controllerEvents\": " + m.ControllerEvents.ToString(CultureInfo.InvariantCulture) + ",");
                builder.AppendLine("      \"overlayEvents\": " + m.OverlayEvents.ToString(CultureInfo.InvariantCulture) + ",");
                builder.AppendLine("      \"updateLayerEvents\": " + m.UpdateLayerEvents.ToString(CultureInfo.InvariantCulture) + ",");
                builder.AppendLine("      \"overlayMoveSkipped\": " + m.OverlayMoveSkipped.ToString(CultureInfo.InvariantCulture) + ",");
                builder.AppendLine("      \"updateLayerFailures\": " + m.UpdateLayerFailures.ToString(CultureInfo.InvariantCulture) + ",");
                AppendStats(builder, "controllerTickUs", m.ControllerTickUs, true);
                AppendStats(builder, "controllerMoveOverlayUs", m.ControllerMoveOverlayUs, true);
                AppendStats(builder, "overlayMoveUs", m.OverlayMoveUs, true);
                AppendStats(builder, "updateLayerUs", m.UpdateLayerUs, true);
                AppendStats(builder, "getDcUs", m.GetDcUs, true);
                AppendStats(builder, "getHbitmapUs", m.GetHbitmapUs, true);
                AppendStats(builder, "updateLayeredWindowUs", m.UpdateLayeredWindowUs, false);
                builder.AppendLine();
                builder.Append("    }");
                index++;
            }

            builder.AppendLine();
            builder.AppendLine("  ]");
            builder.AppendLine("}");
            return builder.ToString();
        }

        private static void AppendStats(StringBuilder builder, string name, Stats stats, bool trailingComma)
        {
            builder.Append("      \"" + Escape(name) + "\": { ");
            builder.Append("\"count\": " + stats.Count.ToString(CultureInfo.InvariantCulture));
            builder.Append(", \"p50\": " + FormatJsonNumber(stats.P50));
            builder.Append(", \"p95\": " + FormatJsonNumber(stats.P95));
            builder.Append(", \"p99\": " + FormatJsonNumber(stats.P99));
            builder.Append(", \"max\": " + FormatJsonNumber(stats.Max));
            builder.Append(" }");
            if (trailingComma)
            {
                builder.Append(",");
            }

            builder.AppendLine();
        }

        private static string FormatStat(double? value)
        {
            return value.HasValue ? value.Value.ToString("0.0", CultureInfo.InvariantCulture) : "";
        }

        private static string FormatJsonNumber(double? value)
        {
            return value.HasValue ? value.Value.ToString("0.###", CultureInfo.InvariantCulture) : "null";
        }

        private static string Escape(string value)
        {
            return (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }

    internal sealed class HarnessOptions
    {
        public string OutputDirectory;
        public int FrameCount;
        public int WarmupMilliseconds;
        public int CooldownMilliseconds;

        public static HarnessOptions Parse(string[] args)
        {
            HarnessOptions options = new HarnessOptions();
            options.OutputDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "out");
            options.FrameCount = 360;
            options.WarmupMilliseconds = 100;
            options.CooldownMilliseconds = 50;

            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                if (arg == "--output" && i + 1 < args.Length)
                {
                    options.OutputDirectory = Path.GetFullPath(args[++i]);
                }
                else if (arg == "--frames" && i + 1 < args.Length)
                {
                    options.FrameCount = Math.Max(120, int.Parse(args[++i], CultureInfo.InvariantCulture));
                }
                else if (arg == "--warmup-ms" && i + 1 < args.Length)
                {
                    options.WarmupMilliseconds = Math.Max(0, int.Parse(args[++i], CultureInfo.InvariantCulture));
                }
                else if (arg == "--cooldown-ms" && i + 1 < args.Length)
                {
                    options.CooldownMilliseconds = Math.Max(0, int.Parse(args[++i], CultureInfo.InvariantCulture));
                }
                else
                {
                    throw new ArgumentException("Unknown or incomplete argument: " + arg);
                }
            }

            return options;
        }
    }

    internal sealed class SyntheticCursorImageProvider : ICursorImageProvider, IDisposable
    {
        private readonly Bitmap _bitmap;
        private readonly IntPtr _cursorHandle = new IntPtr(0x5150);
        private bool _disposed;

        public SyntheticCursorImageProvider()
        {
            _bitmap = CreateCursorBitmap();
        }

        public bool TryGetCurrentCursorHandle(out IntPtr cursorHandle)
        {
            cursorHandle = _cursorHandle;
            return true;
        }

        public bool TryCapture(out CursorCapture capture)
        {
            capture = new CursorCapture(_cursorHandle, new Bitmap(_bitmap), new Point(2, 2));
            return true;
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                _bitmap.Dispose();
                _disposed = true;
            }
        }

        private static Bitmap CreateCursorBitmap()
        {
            Bitmap bitmap = new Bitmap(32, 32, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (GraphicsPath body = new GraphicsPath())
            using (SolidBrush white = new SolidBrush(Color.White))
            using (SolidBrush shadow = new SolidBrush(Color.FromArgb(96, 0, 0, 0)))
            using (Pen black = new Pen(Color.Black, 2.0f))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                body.AddPolygon(new[]
                {
                    new Point(2, 2),
                    new Point(2, 27),
                    new Point(9, 20),
                    new Point(14, 31),
                    new Point(19, 29),
                    new Point(14, 18),
                    new Point(24, 18)
                });
                using (Matrix matrix = new Matrix())
                {
                    matrix.Translate(2, 2);
                    body.Transform(matrix);
                    graphics.FillPath(shadow, body);
                    matrix.Translate(-2, -2);
                    body.Transform(matrix);
                }

                graphics.FillPath(white, body);
                graphics.DrawPath(black, body);
            }

            return bitmap;
        }
    }

    internal sealed class SyntheticCursorPoller : ICursorPoller
    {
        private readonly Point[] _samples;
        private readonly long _refreshPeriodTicks;
        private int _index;

        public SyntheticCursorPoller(Point[] samples, int startIndex, long refreshPeriodTicks)
        {
            _samples = samples;
            _index = startIndex;
            _refreshPeriodTicks = refreshPeriodTicks;
        }

        public bool TryGetSample(out CursorPollSample sample)
        {
            if (_index >= _samples.Length)
            {
                sample = new CursorPollSample();
                return false;
            }

            long now = Stopwatch.GetTimestamp();
            sample = new CursorPollSample();
            sample.Position = _samples[_index++];
            sample.TimestampTicks = now;
            sample.StopwatchFrequency = Stopwatch.Frequency;
            sample.DwmTimingAvailable = false;
            sample.DwmVBlankTicks = 0;
            sample.DwmRefreshPeriodTicks = _refreshPeriodTicks;
            return true;
        }
    }

    internal sealed class ScenarioResult
    {
        public readonly string Name;
        public readonly string PackagePath;
        public readonly ScenarioMetrics Metrics;

        public ScenarioResult(string name, string packagePath, ScenarioMetrics metrics)
        {
            Name = name;
            PackagePath = packagePath;
            Metrics = metrics;
        }
    }

    internal sealed class ScenarioMetrics
    {
        public string Name;
        public int SyntheticFrameCount;
        public int EventCount;
        public long DroppedCount;
        public int ControllerEvents;
        public int OverlayEvents;
        public int UpdateLayerEvents;
        public int UpdateLayerFailures;
        public int OverlayMoveSkipped;
        public Stats ControllerTickUs;
        public Stats ControllerMoveOverlayUs;
        public Stats OverlayMoveUs;
        public Stats UpdateLayerUs;
        public Stats GetDcUs;
        public Stats GetHbitmapUs;
        public Stats UpdateLayeredWindowUs;
    }

    internal struct Stats
    {
        public int Count;
        public double? P50;
        public double? P95;
        public double? P99;
        public double? Max;

        public static Stats From(List<double> values)
        {
            Stats stats = new Stats();
            stats.Count = values.Count;
            if (values.Count == 0)
            {
                return stats;
            }

            values.Sort();
            stats.P50 = Percentile(values, 0.50);
            stats.P95 = Percentile(values, 0.95);
            stats.P99 = Percentile(values, 0.99);
            stats.Max = values[values.Count - 1];
            return stats;
        }

        private static double Percentile(List<double> values, double percentile)
        {
            int index = (int)Math.Floor((values.Count - 1) * percentile);
            return values[index];
        }
    }
}
