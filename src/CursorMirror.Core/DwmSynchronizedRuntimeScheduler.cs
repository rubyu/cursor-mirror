using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using CursorMirror.MouseTrace;

namespace CursorMirror
{
    public sealed class DwmSynchronizedRuntimeScheduler : IDisposable
    {
        public const int TimerResolutionMilliseconds = 1;
        public const int WakeAdvanceMilliseconds = 2;
        public const int FallbackIntervalMilliseconds = 8;
        public const int MaximumDwmSleepMilliseconds = 8;

        private readonly IUiDispatcher _dispatcher;
        private readonly Action _tick;
        private readonly Action _runTickOnUiThread;
        private Thread _thread;
        private volatile bool _running;
        private bool _disposed;
        private bool _timerResolutionActive;
        private long _lastRequestedVBlankTicks;
        private int _tickPending;

        [DllImport("dwmapi.dll", EntryPoint = "DwmGetCompositionTimingInfo", PreserveSig = true)]
        private static extern int DwmGetCompositionTimingInfoNative(IntPtr hwnd, ref DwmTimingInfo timingInfo);

        [DllImport("winmm.dll", EntryPoint = "timeBeginPeriod", PreserveSig = true)]
        private static extern uint TimeBeginPeriodNative(uint milliseconds);

        [DllImport("winmm.dll", EntryPoint = "timeEndPeriod", PreserveSig = true)]
        private static extern uint TimeEndPeriodNative(uint milliseconds);

        public DwmSynchronizedRuntimeScheduler(IUiDispatcher dispatcher, Action tick)
        {
            if (dispatcher == null)
            {
                throw new ArgumentNullException("dispatcher");
            }

            if (tick == null)
            {
                throw new ArgumentNullException("tick");
            }

            _dispatcher = dispatcher;
            _tick = tick;
            _runTickOnUiThread = RunTickOnUiThread;
        }

        public void Start()
        {
            ThrowIfDisposed();
            if (_running)
            {
                return;
            }

            _lastRequestedVBlankTicks = 0;
            _running = true;
            _timerResolutionActive = TimeBeginPeriodNative(TimerResolutionMilliseconds) == 0;
            _thread = new Thread(Run);
            _thread.IsBackground = true;
            _thread.Name = "Cursor Mirror DWM runtime scheduler";
            _thread.Start();
        }

        public void Stop()
        {
            if (!_running && _thread == null)
            {
                return;
            }

            _running = false;
            Thread thread = _thread;
            if (thread != null && thread != Thread.CurrentThread)
            {
                thread.Join(250);
            }

            _thread = null;
            Interlocked.Exchange(ref _tickPending, 0);
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

        public static DwmSynchronizedRuntimeScheduleDecision EvaluateDwmTiming(
            long nowTicks,
            long stopwatchFrequency,
            long lastDwmVBlankTicks,
            long refreshPeriodTicks,
            long lastRequestedVBlankTicks,
            int wakeAdvanceMilliseconds,
            int maximumSleepMilliseconds)
        {
            int maximumSleep = NormalizeDelayMilliseconds(maximumSleepMilliseconds);
            if (nowTicks <= 0 || stopwatchFrequency <= 0 || lastDwmVBlankTicks <= 0 || refreshPeriodTicks <= 0)
            {
                return new DwmSynchronizedRuntimeScheduleDecision(false, false, maximumSleep, 0);
            }

            long targetVBlankTicks = SelectNextVBlank(nowTicks, lastDwmVBlankTicks, refreshPeriodTicks);
            if (targetVBlankTicks <= lastRequestedVBlankTicks)
            {
                long periodsAfterLastRequest = ((lastRequestedVBlankTicks - targetVBlankTicks) / refreshPeriodTicks) + 1L;
                targetVBlankTicks = AddPeriods(targetVBlankTicks, refreshPeriodTicks, periodsAfterLastRequest);
            }

            long wakeAdvanceTicks = MillisecondsToTicks(Math.Max(0, wakeAdvanceMilliseconds), stopwatchFrequency);
            long wakeTicks = targetVBlankTicks - wakeAdvanceTicks;
            if (nowTicks >= wakeTicks)
            {
                return new DwmSynchronizedRuntimeScheduleDecision(true, true, 0, targetVBlankTicks);
            }

            int delayMilliseconds = TicksToDelayMilliseconds(wakeTicks - nowTicks, stopwatchFrequency, maximumSleep);
            return new DwmSynchronizedRuntimeScheduleDecision(true, false, delayMilliseconds, targetVBlankTicks);
        }

        private void Run()
        {
            while (_running)
            {
                long lastDwmVBlankTicks;
                long refreshPeriodTicks;
                if (TryGetDwmTiming(out lastDwmVBlankTicks, out refreshPeriodTicks))
                {
                    long nowTicks = Stopwatch.GetTimestamp();
                    DwmSynchronizedRuntimeScheduleDecision decision = EvaluateDwmTiming(
                        nowTicks,
                        Stopwatch.Frequency,
                        lastDwmVBlankTicks,
                        refreshPeriodTicks,
                        _lastRequestedVBlankTicks,
                        WakeAdvanceMilliseconds,
                        MaximumDwmSleepMilliseconds);

                    if (decision.ShouldTick)
                    {
                        _lastRequestedVBlankTicks = decision.TargetVBlankTicks;
                        RequestTick();
                        SleepWhileRunning(1);
                    }
                    else
                    {
                        SleepWhileRunning(decision.DelayMilliseconds);
                    }
                }
                else
                {
                    RequestTick();
                    SleepWhileRunning(FallbackIntervalMilliseconds);
                }
            }
        }

        private void RequestTick()
        {
            if (!_running || _disposed)
            {
                return;
            }

            if (Interlocked.Exchange(ref _tickPending, 1) != 0)
            {
                return;
            }

            try
            {
                _dispatcher.BeginInvoke(_runTickOnUiThread);
            }
            catch (ObjectDisposedException)
            {
                Interlocked.Exchange(ref _tickPending, 0);
            }
            catch (InvalidOperationException)
            {
                Interlocked.Exchange(ref _tickPending, 0);
            }
        }

        private void RunTickOnUiThread()
        {
            Interlocked.Exchange(ref _tickPending, 0);
            if (!_running || _disposed)
            {
                return;
            }

            _tick();
        }

        private static bool TryGetDwmTiming(out long lastDwmVBlankTicks, out long refreshPeriodTicks)
        {
            DwmTimingInfo timingInfo = new DwmTimingInfo();
            timingInfo.Size = (uint)Marshal.SizeOf(typeof(DwmTimingInfo));
            if (DwmGetCompositionTimingInfoNative(IntPtr.Zero, ref timingInfo) != 0)
            {
                lastDwmVBlankTicks = 0;
                refreshPeriodTicks = 0;
                return false;
            }

            lastDwmVBlankTicks = ToSignedTicks(timingInfo.QpcVBlank);
            refreshPeriodTicks = ToSignedTicks(timingInfo.QpcRefreshPeriod);
            return lastDwmVBlankTicks > 0 && refreshPeriodTicks > 0;
        }

        private static long SelectNextVBlank(long nowTicks, long lastDwmVBlankTicks, long refreshPeriodTicks)
        {
            long target = lastDwmVBlankTicks;
            if (target <= nowTicks)
            {
                long periodsLate = ((nowTicks - target) / refreshPeriodTicks) + 1L;
                target = AddPeriods(target, refreshPeriodTicks, periodsLate);
            }

            return target;
        }

        private static long AddPeriods(long startTicks, long refreshPeriodTicks, long periodCount)
        {
            if (periodCount <= 0)
            {
                return startTicks;
            }

            if (periodCount > long.MaxValue / refreshPeriodTicks)
            {
                return long.MaxValue;
            }

            long offset = refreshPeriodTicks * periodCount;
            if (startTicks > long.MaxValue - offset)
            {
                return long.MaxValue;
            }

            return startTicks + offset;
        }

        private static long MillisecondsToTicks(int milliseconds, long stopwatchFrequency)
        {
            if (milliseconds <= 0 || stopwatchFrequency <= 0)
            {
                return 0;
            }

            double ticks = milliseconds * (double)stopwatchFrequency / 1000.0;
            if (ticks >= long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)Math.Round(ticks);
        }

        private static int TicksToDelayMilliseconds(long ticks, long stopwatchFrequency, int maximumSleepMilliseconds)
        {
            if (ticks <= 0 || stopwatchFrequency <= 0)
            {
                return 1;
            }

            double milliseconds = ticks * 1000.0 / stopwatchFrequency;
            int delay = (int)Math.Floor(milliseconds);
            if (delay < 1)
            {
                delay = 1;
            }

            if (delay > maximumSleepMilliseconds)
            {
                delay = maximumSleepMilliseconds;
            }

            return delay;
        }

        private static int NormalizeDelayMilliseconds(int milliseconds)
        {
            return Math.Max(1, milliseconds);
        }

        private static long ToSignedTicks(ulong value)
        {
            if (value > long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)value;
        }

        private void SleepWhileRunning(int milliseconds)
        {
            if (!_running)
            {
                return;
            }

            Thread.Sleep(NormalizeDelayMilliseconds(milliseconds));
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(GetType().Name);
            }
        }
    }

    public struct DwmSynchronizedRuntimeScheduleDecision
    {
        public DwmSynchronizedRuntimeScheduleDecision(bool isDwmTimingUsable, bool shouldTick, int delayMilliseconds, long targetVBlankTicks)
            : this()
        {
            IsDwmTimingUsable = isDwmTimingUsable;
            ShouldTick = shouldTick;
            DelayMilliseconds = delayMilliseconds;
            TargetVBlankTicks = targetVBlankTicks;
        }

        public bool IsDwmTimingUsable { get; private set; }
        public bool ShouldTick { get; private set; }
        public int DelayMilliseconds { get; private set; }
        public long TargetVBlankTicks { get; private set; }
    }
}
