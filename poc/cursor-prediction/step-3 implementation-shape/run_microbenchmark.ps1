param(
    [int]$Iterations = 2000000,
    [int]$WarmupIterations = 100000,
    [double]$HorizonMs = 12.0,
    [double]$IdleGapMs = 100.0
)

$ErrorActionPreference = "Stop"

$source = @'
using System;
using System.Diagnostics;

public struct Last2Predictor
{
    private bool hasSample;
    private bool hasVelocity;
    private double lastX;
    private double lastY;
    private double lastT;
    private double vxPerMs;
    private double vyPerMs;
    private readonly double idleGapMs;

    public Last2Predictor(double idleGapMs)
    {
        this.hasSample = false;
        this.hasVelocity = false;
        this.lastX = 0.0;
        this.lastY = 0.0;
        this.lastT = 0.0;
        this.vxPerMs = 0.0;
        this.vyPerMs = 0.0;
        this.idleGapMs = idleGapMs;
    }

    public void Reset()
    {
        hasSample = false;
        hasVelocity = false;
        lastX = 0.0;
        lastY = 0.0;
        lastT = 0.0;
        vxPerMs = 0.0;
        vyPerMs = 0.0;
    }

    public void AddSample(double timestampMs, double x, double y)
    {
        if (hasSample)
        {
            double dt = timestampMs - lastT;
            if (dt > 0.0 && dt <= idleGapMs)
            {
                vxPerMs = (x - lastX) / dt;
                vyPerMs = (y - lastY) / dt;
                hasVelocity = true;
            }
            else
            {
                hasVelocity = false;
            }
        }
        else
        {
            hasSample = true;
        }

        lastX = x;
        lastY = y;
        lastT = timestampMs;
    }

    public void Predict(double horizonMs, out double x, out double y)
    {
        if (hasSample && hasVelocity && horizonMs > 0.0)
        {
            x = lastX + vxPerMs * horizonMs;
            y = lastY + vyPerMs * horizonMs;
            return;
        }

        x = lastX;
        y = lastY;
    }
}

public sealed class Last2BenchmarkResult
{
    public int Iterations;
    public int WarmupIterations;
    public double HorizonMs;
    public double IdleGapMs;
    public double ElapsedMilliseconds;
    public double UpdatesAndPredictionsPerSecond;
    public double NanosecondsPerUpdateAndPrediction;
    public double Checksum;
}

public static class Last2Microbenchmark
{
    public static Last2BenchmarkResult Run(int iterations, int warmupIterations, double horizonMs, double idleGapMs)
    {
        Last2Predictor predictor = new Last2Predictor(idleGapMs);
        double checksum = 0.0;

        for (int i = 0; i < warmupIterations; i++)
        {
            Step(ref predictor, i, horizonMs, ref checksum);
        }

        predictor.Reset();
        checksum = 0.0;
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        Stopwatch stopwatch = Stopwatch.StartNew();
        for (int i = 0; i < iterations; i++)
        {
            Step(ref predictor, i, horizonMs, ref checksum);
        }
        stopwatch.Stop();

        double elapsedMs = stopwatch.Elapsed.TotalMilliseconds;
        double perSecond = iterations / stopwatch.Elapsed.TotalSeconds;
        double nanos = stopwatch.Elapsed.TotalMilliseconds * 1000000.0 / iterations;

        return new Last2BenchmarkResult
        {
            Iterations = iterations,
            WarmupIterations = warmupIterations,
            HorizonMs = horizonMs,
            IdleGapMs = idleGapMs,
            ElapsedMilliseconds = elapsedMs,
            UpdatesAndPredictionsPerSecond = perSecond,
            NanosecondsPerUpdateAndPrediction = nanos,
            Checksum = checksum
        };
    }

    private static void Step(ref Last2Predictor predictor, int i, double horizonMs, ref double checksum)
    {
        double t = i * 8.0 + (i % 3);
        double x = 900.0 + Math.Sin(i * 0.017) * 260.0 + (i % 17) * 0.25;
        double y = 500.0 + Math.Cos(i * 0.011) * 180.0 - (i % 13) * 0.20;
        predictor.AddSample(t, x, y);

        double px;
        double py;
        predictor.Predict(horizonMs, out px, out py);
        checksum += px * 0.000001 + py * 0.0000001;
    }
}
'@

if (-not ("Last2Microbenchmark" -as [type])) {
    Add-Type -TypeDefinition $source
}

$result = [Last2Microbenchmark]::Run($Iterations, $WarmupIterations, $HorizonMs, $IdleGapMs)
$result | ConvertTo-Json -Depth 4
