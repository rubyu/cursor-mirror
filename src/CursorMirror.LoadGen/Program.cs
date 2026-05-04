using System;
using System.Diagnostics;
using System.Threading;

namespace CursorMirror.LoadGen
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            Options options = Options.Parse(args);
            Console.WriteLine("{\"event\":\"start\",\"workers\":" + options.Workers.ToString() + ",\"loadPercent\":" + options.LoadPercent.ToString() + ",\"durationSeconds\":" + options.DurationSeconds.ToString() + "}");

            Worker[] workers = new Worker[options.Workers];
            for (int i = 0; i < workers.Length; i++)
            {
                workers[i] = new Worker(options);
                workers[i].Start();
            }

            Thread.Sleep(Math.Max(1, options.DurationSeconds) * 1000);
            for (int i = 0; i < workers.Length; i++)
            {
                workers[i].Stop();
            }

            for (int i = 0; i < workers.Length; i++)
            {
                workers[i].Join();
            }

            Console.WriteLine("{\"event\":\"stop\"}");
            return 0;
        }

        private sealed class Worker
        {
            private readonly Options _options;
            private readonly Thread _thread;
            private volatile bool _stopRequested;

            public Worker(Options options)
            {
                _options = options;
                _thread = new Thread(Run);
                _thread.IsBackground = true;
                _thread.Name = "CursorMirror.LoadGen";
            }

            public void Start()
            {
                _thread.Start();
            }

            public void Stop()
            {
                _stopRequested = true;
            }

            public void Join()
            {
                _thread.Join();
            }

            private void Run()
            {
                Stopwatch stopwatch = new Stopwatch();
                double sink = 0;
                int periodMilliseconds = 100;
                int busyMilliseconds = Math.Max(1, Math.Min(periodMilliseconds, _options.LoadPercent));
                while (!_stopRequested)
                {
                    stopwatch.Restart();
                    while (!_stopRequested && stopwatch.ElapsedMilliseconds < busyMilliseconds)
                    {
                        for (int i = 1; i < 1024; i++)
                        {
                            sink += Math.Sqrt(i + sink);
                            if (sink > 1000000)
                            {
                                sink = sink / 3.0;
                            }
                        }
                    }

                    int sleepMilliseconds = periodMilliseconds - busyMilliseconds;
                    if (sleepMilliseconds > 0)
                    {
                        Thread.Sleep(sleepMilliseconds);
                    }
                    else
                    {
                        Thread.Yield();
                    }
                }

                GC.KeepAlive(sink);
            }
        }

        private sealed class Options
        {
            public int DurationSeconds = 30;
            public int Workers = Math.Max(1, Environment.ProcessorCount / 2);
            public int LoadPercent = 50;

            public static Options Parse(string[] args)
            {
                Options options = new Options();
                for (int i = 0; i < args.Length; i++)
                {
                    string argument = (args[i] ?? string.Empty).Trim().ToLowerInvariant();
                    if ((argument == "--duration-seconds" || argument == "--duration") && i + 1 < args.Length)
                    {
                        options.DurationSeconds = ParseInt(args[++i], options.DurationSeconds, 1, 3600);
                    }
                    else if (argument == "--workers" && i + 1 < args.Length)
                    {
                        options.Workers = ParseInt(args[++i], options.Workers, 1, 256);
                    }
                    else if (argument == "--load-percent" && i + 1 < args.Length)
                    {
                        options.LoadPercent = ParseInt(args[++i], options.LoadPercent, 1, 100);
                    }
                }

                return options;
            }

            private static int ParseInt(string value, int fallback, int minimum, int maximum)
            {
                int result;
                if (!int.TryParse(value, out result))
                {
                    return fallback;
                }

                return Math.Max(minimum, Math.Min(maximum, result));
            }
        }
    }
}
