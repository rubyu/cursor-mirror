using System;
using System.Runtime.InteropServices;
using CursorMirror.MouseTrace;

namespace CursorMirror
{
    public static class DwmSynchronizedRuntimeScheduler
    {
        public const int TimerResolutionMilliseconds = 1;
        public const int WakeAdvanceMilliseconds = 4;
        public const int FallbackIntervalMilliseconds = 8;
        public const int MaximumDwmSleepMilliseconds = 2;
        public const int FineWaitAdvanceMicroseconds = 2000;
        public const int FineWaitYieldThresholdMicroseconds = 100;
        public const int DisplayDeadlineGuardMicroseconds = 500;

        [DllImport("dwmapi.dll", EntryPoint = "DwmGetCompositionTimingInfo", PreserveSig = true)]
        private static extern int DwmGetCompositionTimingInfoNative(IntPtr hwnd, ref DwmTimingInfo timingInfo);

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
                long fallbackWaitUntilTicks = CalculateCurrentWaitTargetTicks(nowTicks, maximumSleep, 0, stopwatchFrequency);
                return new DwmSynchronizedRuntimeScheduleDecision(false, false, maximumSleep, 0, fallbackWaitUntilTicks);
            }

            long targetVBlankTicks = SelectNextVBlank(nowTicks, lastDwmVBlankTicks, refreshPeriodTicks);
            if (targetVBlankTicks <= lastRequestedVBlankTicks)
            {
                if (nowTicks < lastRequestedVBlankTicks)
                {
                    int delayUntilRequestedVBlank = TicksToDelayMilliseconds(lastRequestedVBlankTicks - nowTicks, stopwatchFrequency, maximumSleep);
                    long waitUntilTicks = CalculateCurrentWaitTargetTicks(nowTicks, delayUntilRequestedVBlank, lastRequestedVBlankTicks, stopwatchFrequency);
                    return new DwmSynchronizedRuntimeScheduleDecision(true, false, delayUntilRequestedVBlank, lastRequestedVBlankTicks, waitUntilTicks);
                }

                long periodsAfterLastRequest = ((lastRequestedVBlankTicks - targetVBlankTicks) / refreshPeriodTicks) + 1L;
                targetVBlankTicks = AddPeriods(targetVBlankTicks, refreshPeriodTicks, periodsAfterLastRequest);
            }

            long wakeAdvanceTicks = MillisecondsToTicks(Math.Max(0, wakeAdvanceMilliseconds), stopwatchFrequency);
            long wakeTicks = targetVBlankTicks - wakeAdvanceTicks;
            if (nowTicks >= wakeTicks)
            {
                return new DwmSynchronizedRuntimeScheduleDecision(true, true, 0, targetVBlankTicks, nowTicks);
            }

            int delayMilliseconds = TicksToDelayMilliseconds(wakeTicks - nowTicks, stopwatchFrequency, maximumSleep);
            long currentWaitUntilTicks = CalculateCurrentWaitTargetTicks(nowTicks, delayMilliseconds, wakeTicks, stopwatchFrequency);
            return new DwmSynchronizedRuntimeScheduleDecision(true, false, delayMilliseconds, targetVBlankTicks, currentWaitUntilTicks);
        }

        public static DwmSynchronizedRuntimeScheduleDecision EvaluateOneShotDwmTiming(
            long nowTicks,
            long stopwatchFrequency,
            long lastDwmVBlankTicks,
            long refreshPeriodTicks,
            long lastRequestedVBlankTicks,
            int wakeAdvanceMilliseconds,
            int fallbackMilliseconds)
        {
            int fallbackDelay = NormalizeDelayMilliseconds(fallbackMilliseconds);
            if (nowTicks <= 0 || stopwatchFrequency <= 0 || lastDwmVBlankTicks <= 0 || refreshPeriodTicks <= 0)
            {
                long fallbackWaitUntilTicks = CalculateCurrentWaitTargetTicks(nowTicks, fallbackDelay, 0, stopwatchFrequency);
                return new DwmSynchronizedRuntimeScheduleDecision(false, false, fallbackDelay, 0, fallbackWaitUntilTicks);
            }

            long targetVBlankTicks = SelectNextVBlank(nowTicks, lastDwmVBlankTicks, refreshPeriodTicks);
            targetVBlankTicks = AdvancePastNearRequestedVBlank(targetVBlankTicks, lastRequestedVBlankTicks, refreshPeriodTicks);

            long wakeAdvanceTicks = MillisecondsToTicks(Math.Max(0, wakeAdvanceMilliseconds), stopwatchFrequency);
            long wakeTicks = targetVBlankTicks - wakeAdvanceTicks;
            if (nowTicks >= wakeTicks)
            {
                return new DwmSynchronizedRuntimeScheduleDecision(true, true, 0, targetVBlankTicks, nowTicks);
            }

            int delayMilliseconds = TicksToDelayMilliseconds(wakeTicks - nowTicks, stopwatchFrequency, fallbackDelay);
            return new DwmSynchronizedRuntimeScheduleDecision(true, false, delayMilliseconds, targetVBlankTicks, wakeTicks);
        }

        public static bool TryGetDwmTiming(out long lastDwmVBlankTicks, out long refreshPeriodTicks)
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

        private static long AdvancePastNearRequestedVBlank(long targetVBlankTicks, long lastRequestedVBlankTicks, long refreshPeriodTicks)
        {
            if (targetVBlankTicks <= 0 || lastRequestedVBlankTicks <= 0 || refreshPeriodTicks <= 0)
            {
                return targetVBlankTicks;
            }

            long minimumSeparationTicks = Math.Max(1, refreshPeriodTicks / 2);
            long minimumNextTargetTicks = AddTicks(lastRequestedVBlankTicks, minimumSeparationTicks);
            if (targetVBlankTicks >= minimumNextTargetTicks)
            {
                return targetVBlankTicks;
            }

            long requiredTicks = minimumNextTargetTicks - targetVBlankTicks;
            long periods = (requiredTicks + refreshPeriodTicks - 1) / refreshPeriodTicks;
            return AddPeriods(targetVBlankTicks, refreshPeriodTicks, periods);
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

        public static long CalculateCurrentWaitTargetTicks(long nowTicks, int delayMilliseconds, long preferredWaitUntilTicks, long stopwatchFrequency)
        {
            if (nowTicks <= 0 || stopwatchFrequency <= 0)
            {
                return 0;
            }

            int normalizedDelayMilliseconds = NormalizeDelayMilliseconds(delayMilliseconds);
            long delayTicks = MillisecondsToTicks(normalizedDelayMilliseconds, stopwatchFrequency);
            long cappedWaitUntilTicks = AddTicks(nowTicks, delayTicks);
            if (preferredWaitUntilTicks > 0)
            {
                if (preferredWaitUntilTicks <= nowTicks)
                {
                    return nowTicks;
                }

                if (preferredWaitUntilTicks < cappedWaitUntilTicks)
                {
                    return preferredWaitUntilTicks;
                }
            }

            return cappedWaitUntilTicks;
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

        private static long AddTicks(long startTicks, long ticks)
        {
            if (ticks <= 0)
            {
                return startTicks;
            }

            if (startTicks > long.MaxValue - ticks)
            {
                return long.MaxValue;
            }

            return startTicks + ticks;
        }

        private static long ToSignedTicks(ulong value)
        {
            if (value > long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)value;
        }
    }

    public struct DwmSynchronizedRuntimeScheduleDecision
    {
        public DwmSynchronizedRuntimeScheduleDecision(bool isDwmTimingUsable, bool shouldTick, int delayMilliseconds, long targetVBlankTicks)
            : this(isDwmTimingUsable, shouldTick, delayMilliseconds, targetVBlankTicks, 0)
        {
        }

        public DwmSynchronizedRuntimeScheduleDecision(bool isDwmTimingUsable, bool shouldTick, int delayMilliseconds, long targetVBlankTicks, long waitUntilTicks)
            : this()
        {
            IsDwmTimingUsable = isDwmTimingUsable;
            ShouldTick = shouldTick;
            DelayMilliseconds = delayMilliseconds;
            TargetVBlankTicks = targetVBlankTicks;
            WaitUntilTicks = waitUntilTicks;
        }

        public bool IsDwmTimingUsable { get; private set; }
        public bool ShouldTick { get; private set; }
        public int DelayMilliseconds { get; private set; }
        public long TargetVBlankTicks { get; private set; }
        public long WaitUntilTicks { get; private set; }
    }
}
