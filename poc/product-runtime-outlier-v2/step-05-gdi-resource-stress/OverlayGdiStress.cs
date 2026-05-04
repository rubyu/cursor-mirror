using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using CursorMirror;

internal static class OverlayGdiStress
{
    private const int GdiObjects = 0;

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("user32.dll")]
    private static extern int GetGuiResources(IntPtr process, int flags);

    [STAThread]
    private static int Main(string[] args)
    {
        string outputPath = args.Length > 0 ? args[0] : "metrics.json";
        int iterations = args.Length > 1 ? int.Parse(args[1]) : 250;
        int movesPerImage = args.Length > 2 ? int.Parse(args[2]) : 24;
        int allowedFinalDelta = args.Length > 3 ? int.Parse(args[3]) : 8;

        Exception failure = null;
        int warmupPeak = GetGdiObjectCount();
        RunOverlayScenario(4, 4, ref warmupPeak, ref failure);
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        int before = GetGdiObjectCount();
        int peak = before;
        Stopwatch stopwatch = Stopwatch.StartNew();
        if (failure == null)
        {
            RunOverlayScenario(iterations, movesPerImage, ref peak, ref failure);
        }

        stopwatch.Stop();

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        int after = GetGdiObjectCount();
        int finalDelta = after - before;
        bool passed = failure == null && finalDelta <= allowedFinalDelta;
        WriteMetrics(outputPath, iterations, movesPerImage, before, peak, after, finalDelta, allowedFinalDelta, stopwatch.ElapsedMilliseconds, passed, failure);

        return passed ? 0 : 1;
    }

    private static void RunOverlayScenario(int iterations, int movesPerImage, ref int peak, ref Exception failure)
    {
        int observedPeak = peak;
        Exception observedFailure = null;
        Thread thread = new Thread((ThreadStart)delegate
        {
            try
            {
                Application.EnableVisualStyles();
                using (OverlayWindow window = new OverlayWindow())
                {
                    window.CreateControl();
                    for (int i = 0; i < iterations; i++)
                    {
                        using (Bitmap bitmap = CreateCursorBitmap(i))
                        {
                            window.ShowCursor(bitmap, new Point(20 + (i % 11), 30 + (i % 7)));
                        }

                        for (int move = 0; move < movesPerImage; move++)
                        {
                            window.Move(new Point(20 + ((i + move) % 400), 30 + ((i * 3 + move) % 240)));
                            if ((move % 8) == 0)
                            {
                                window.SetOpacity((byte)(160 + ((i + move) % 96)));
                            }
                        }

                        if ((i % 17) == 0)
                        {
                            window.HideOverlay();
                        }

                        int current = GetGdiObjectCount();
                        if (current > observedPeak)
                        {
                            observedPeak = current;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                observedFailure = ex;
            }
        });

        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();

        peak = observedPeak;
        if (observedFailure != null)
        {
            failure = observedFailure;
        }
    }

    private static Bitmap CreateCursorBitmap(int seed)
    {
        Bitmap bitmap = new Bitmap(48, 48, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        using (SolidBrush body = new SolidBrush(Color.FromArgb(230, (seed * 37) % 256, (seed * 67) % 256, (seed * 97) % 256)))
        using (Pen edge = new Pen(Color.FromArgb(255, 0, 0, 0), 2))
        {
            graphics.Clear(Color.Transparent);
            Point[] points = new[]
            {
                new Point(4, 3),
                new Point(35, 25),
                new Point(21, 28),
                new Point(28, 43),
                new Point(19, 46),
                new Point(12, 31),
                new Point(4, 40)
            };
            graphics.FillPolygon(body, points);
            graphics.DrawPolygon(edge, points);
        }

        return bitmap;
    }

    private static int GetGdiObjectCount()
    {
        return GetGuiResources(GetCurrentProcess(), GdiObjects);
    }

    private static void WriteMetrics(
        string path,
        int iterations,
        int movesPerImage,
        int before,
        int peak,
        int after,
        int finalDelta,
        int allowedFinalDelta,
        long elapsedMilliseconds,
        bool passed,
        Exception failure)
    {
        string directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        string error = failure == null ? string.Empty : JsonEscape(failure.GetType().FullName + ": " + failure.Message);
        File.WriteAllText(
            path,
            "{\n" +
            "  \"iterations\": " + iterations + ",\n" +
            "  \"movesPerImage\": " + movesPerImage + ",\n" +
            "  \"gdiBefore\": " + before + ",\n" +
            "  \"gdiPeak\": " + peak + ",\n" +
            "  \"gdiAfterDispose\": " + after + ",\n" +
            "  \"gdiFinalDelta\": " + finalDelta + ",\n" +
            "  \"allowedFinalDelta\": " + allowedFinalDelta + ",\n" +
            "  \"elapsedMilliseconds\": " + elapsedMilliseconds + ",\n" +
            "  \"passed\": " + (passed ? "true" : "false") + ",\n" +
            "  \"error\": \"" + error + "\"\n" +
            "}\n");
    }

    private static string JsonEscape(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
