using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using CursorMirror.MouseTrace;

namespace CursorMirror
{
    public sealed class HighFrequencyCursorPoller : ICursorPoller, IDisposable
    {
        public const int DefaultIntervalMilliseconds = 1;
        public const int DefaultMaximumSampleAgeMilliseconds = 4;
        private const int TimerResolutionMilliseconds = 1;

        private readonly object _sync = new object();
        private readonly int _intervalMilliseconds;
        private readonly int _maximumSampleAgeMilliseconds;
        private Thread _thread;
        private bool _hasSample;
        private Point _latestPosition;
        private long _latestTimestampTicks;
        private volatile bool _running;
        private volatile bool _useThreadLatencyProfile;
        private bool _timerResolutionActive;
        private bool _disposed;
        private HighResolutionWaitTimer _waitTimer;
        private ThreadLatencyProfile _latencyProfile;

        [DllImport("user32.dll", EntryPoint = "GetCursorPos", SetLastError = true)]
        private static extern bool GetCursorPosNative(out NativePoint point);

        [DllImport("dwmapi.dll", EntryPoint = "DwmGetCompositionTimingInfo", PreserveSig = true)]
        private static extern int DwmGetCompositionTimingInfoNative(IntPtr hwnd, ref DwmTimingInfo timingInfo);

        [DllImport("winmm.dll", EntryPoint = "timeBeginPeriod", PreserveSig = true)]
        private static extern uint TimeBeginPeriodNative(uint milliseconds);

        [DllImport("winmm.dll", EntryPoint = "timeEndPeriod", PreserveSig = true)]
        private static extern uint TimeEndPeriodNative(uint milliseconds);

        public HighFrequencyCursorPoller()
            : this(DefaultIntervalMilliseconds, DefaultMaximumSampleAgeMilliseconds, false)
        {
        }

        public HighFrequencyCursorPoller(bool useThreadLatencyProfile)
            : this(DefaultIntervalMilliseconds, DefaultMaximumSampleAgeMilliseconds, useThreadLatencyProfile)
        {
        }

        public HighFrequencyCursorPoller(int intervalMilliseconds, int maximumSampleAgeMilliseconds)
            : this(intervalMilliseconds, maximumSampleAgeMilliseconds, false)
        {
        }

        public HighFrequencyCursorPoller(int intervalMilliseconds, int maximumSampleAgeMilliseconds, bool useThreadLatencyProfile)
        {
            _intervalMilliseconds = Math.Max(1, intervalMilliseconds);
            _maximumSampleAgeMilliseconds = Math.Max(1, maximumSampleAgeMilliseconds);
            _useThreadLatencyProfile = useThreadLatencyProfile;
        }

        public void Start()
        {
            ThrowIfDisposed();
            if (_running)
            {
                return;
            }

            _running = true;
            _timerResolutionActive = TimeBeginPeriodNative(TimerResolutionMilliseconds) == 0;
            _waitTimer = HighResolutionWaitTimer.CreateBestEffort();
            CaptureLatest(Stopwatch.GetTimestamp());
            _thread = new Thread(Run);
            _thread.Name = "Cursor Mirror high-frequency cursor poller";
            _thread.IsBackground = true;
            _thread.Priority = ThreadPriority.AboveNormal;
            _thread.Start();
        }

        public void ApplyThreadLatencyProfile(bool enabled)
        {
            ThrowIfDisposed();
            _useThreadLatencyProfile = enabled;
        }

        public bool TryGetSample(out CursorPollSample sample)
        {
            ThrowIfDisposed();
            sample = new CursorPollSample();

            if (!_running)
            {
                return false;
            }

            Point position;
            long timestampTicks;
            if (!TryGetLatestFreshSample(out position, out timestampTicks))
            {
                if (!TryCaptureDirect(out position, out timestampTicks))
                {
                    return false;
                }
            }

            PopulateSample(position, timestampTicks, out sample);
            return true;
        }

        public void Stop()
        {
            _running = false;
            Thread thread = _thread;
            if (thread != null && thread != Thread.CurrentThread)
            {
                thread.Join(250);
            }

            _thread = null;
            if (_waitTimer != null)
            {
                _waitTimer.Dispose();
                _waitTimer = null;
            }

            if (_timerResolutionActive)
            {
                TimeEndPeriodNative(TimerResolutionMilliseconds);
                _timerResolutionActive = false;
            }
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                Stop();
                _disposed = true;
            }
        }

        private void Run()
        {
            try
            {
                ApplyThreadLatencyProfileOnCurrentThread();
                long intervalTicks = Math.Max(1, MillisecondsToTicks(_intervalMilliseconds));
                long nextTicks = Stopwatch.GetTimestamp() + intervalTicks;

                while (_running)
                {
                    ApplyThreadLatencyProfileOnCurrentThread();
                    long now = Stopwatch.GetTimestamp();
                    if (now >= nextTicks)
                    {
                        CaptureLatest(now);
                        nextTicks += intervalTicks;
                        if (now - nextTicks > intervalTicks * 4)
                        {
                            nextTicks = now + intervalTicks;
                        }

                        continue;
                    }

                    long remainingTicks = nextTicks - now;
                    WaitForRemainingTicks(remainingTicks);
                }
            }
            finally
            {
                DisposeLatencyProfile();
            }
        }

        private void ApplyThreadLatencyProfileOnCurrentThread()
        {
            if (_useThreadLatencyProfile)
            {
                if (_latencyProfile == null)
                {
                    _latencyProfile = ThreadLatencyProfile.Enter("cursorPoller");
                }

                return;
            }

            DisposeLatencyProfile();
        }

        private void DisposeLatencyProfile()
        {
            if (_latencyProfile != null)
            {
                _latencyProfile.Dispose();
                _latencyProfile = null;
            }
        }

        private void WaitForRemainingTicks(long remainingTicks)
        {
            if (remainingTicks <= 0)
            {
                return;
            }

            HighResolutionWaitTimer waitTimer = _waitTimer;
            if (waitTimer != null && waitTimer.WaitTicks(remainingTicks, Stopwatch.Frequency))
            {
                return;
            }

            int sleepMilliseconds = CalculateFallbackSleepMilliseconds(
                remainingTicks,
                Stopwatch.Frequency,
                _intervalMilliseconds);
            if (sleepMilliseconds > 0)
            {
                Thread.Sleep(sleepMilliseconds);
            }
        }

        private static int CalculateFallbackSleepMilliseconds(long remainingTicks, long stopwatchFrequency, int maximumMilliseconds)
        {
            if (remainingTicks <= 0 || stopwatchFrequency <= 0)
            {
                return 0;
            }

            double milliseconds = remainingTicks * 1000.0 / stopwatchFrequency;
            int roundedMilliseconds = (int)Math.Ceiling(milliseconds);
            if (roundedMilliseconds < 1)
            {
                roundedMilliseconds = 1;
            }

            return Math.Min(roundedMilliseconds, Math.Max(1, maximumMilliseconds));
        }

        private bool TryGetLatestFreshSample(out Point position, out long timestampTicks)
        {
            lock (_sync)
            {
                position = _latestPosition;
                timestampTicks = _latestTimestampTicks;
                if (!_hasSample)
                {
                    return false;
                }
            }

            long ageTicks = Stopwatch.GetTimestamp() - timestampTicks;
            long maximumAgeTicks = MillisecondsToTicks(_maximumSampleAgeMilliseconds);
            return ageTicks >= 0 && ageTicks <= maximumAgeTicks;
        }

        private void CaptureLatest(long stopwatchTicks)
        {
            Point position;
            long timestampTicks;
            if (!TryCaptureDirect(out position, out timestampTicks))
            {
                return;
            }

            lock (_sync)
            {
                _latestPosition = position;
                _latestTimestampTicks = timestampTicks;
                _hasSample = true;
            }
        }

        private static bool TryCaptureDirect(out Point position, out long timestampTicks)
        {
            NativePoint point;
            if (!GetCursorPosNative(out point))
            {
                position = Point.Empty;
                timestampTicks = 0;
                return false;
            }

            position = new Point(point.x, point.y);
            timestampTicks = Stopwatch.GetTimestamp();
            return true;
        }

        private static void PopulateSample(Point position, long timestampTicks, out CursorPollSample sample)
        {
            DwmTimingInfo timing = new DwmTimingInfo();
            timing.Size = (uint)Marshal.SizeOf(typeof(DwmTimingInfo));
            bool hasTiming = DwmGetCompositionTimingInfoNative(IntPtr.Zero, ref timing) == 0;

            sample = new CursorPollSample();
            sample.Position = position;
            sample.TimestampTicks = timestampTicks;
            sample.StopwatchFrequency = Stopwatch.Frequency;
            sample.DwmTimingAvailable = hasTiming;
            if (hasTiming)
            {
                sample.DwmVBlankTicks = ToSignedTicks(timing.QpcVBlank);
                sample.DwmRefreshPeriodTicks = ToSignedTicks(timing.QpcRefreshPeriod);
            }
        }

        private static long MillisecondsToTicks(int milliseconds)
        {
            double ticks = milliseconds * (double)Stopwatch.Frequency / 1000.0;
            if (ticks >= long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)Math.Round(ticks);
        }

        private static long ToSignedTicks(ulong value)
        {
            if (value > long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)value;
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(GetType().Name);
            }
        }
    }
}
