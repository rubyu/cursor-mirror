namespace CursorMirror
{
    public sealed class RuntimeSchedulerOptions
    {
        public int WakeAdvanceMilliseconds { get; set; }

        public int FallbackIntervalMilliseconds { get; set; }

        public int FineWaitAdvanceMicroseconds { get; set; }

        public int FineWaitYieldThresholdMicroseconds { get; set; }

        public int DeadlineMessageDeferralMicroseconds { get; set; }

        public bool PreferSetWaitableTimerEx { get; set; }

        public bool UseThreadLatencyProfile { get; set; }

        public static RuntimeSchedulerOptions Default()
        {
            return new RuntimeSchedulerOptions
            {
                WakeAdvanceMilliseconds = DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                FallbackIntervalMilliseconds = DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds,
                FineWaitAdvanceMicroseconds = DwmSynchronizedRuntimeScheduler.FineWaitAdvanceMicroseconds,
                FineWaitYieldThresholdMicroseconds = DwmSynchronizedRuntimeScheduler.FineWaitYieldThresholdMicroseconds,
                DeadlineMessageDeferralMicroseconds = CursorMirrorSettings.DefaultRuntimeMessageDeferralEnabled
                    ? CursorMirrorSettings.DefaultRuntimeMessageDeferralMicroseconds
                    : 0,
                PreferSetWaitableTimerEx = true,
                UseThreadLatencyProfile = false
            };
        }

        public static RuntimeSchedulerOptions FromSettings(CursorMirrorSettings settings)
        {
            if (settings == null)
            {
                return Default();
            }

            CursorMirrorSettings normalized = settings.Normalize();
            RuntimeSchedulerOptions options = Default();
            options.FineWaitAdvanceMicroseconds = normalized.RuntimeFineWaitAdvanceMicroseconds;
            options.FineWaitYieldThresholdMicroseconds = normalized.RuntimeFineWaitYieldThresholdMicroseconds;
            options.DeadlineMessageDeferralMicroseconds = normalized.RuntimeMessageDeferralEnabled
                ? normalized.RuntimeMessageDeferralMicroseconds
                : 0;
            options.PreferSetWaitableTimerEx = normalized.RuntimeSetWaitableTimerExEnabled;
            options.UseThreadLatencyProfile = normalized.RuntimeThreadLatencyProfileEnabled;
            return options.Normalize();
        }

        public RuntimeSchedulerOptions Clone()
        {
            return new RuntimeSchedulerOptions
            {
                WakeAdvanceMilliseconds = WakeAdvanceMilliseconds,
                FallbackIntervalMilliseconds = FallbackIntervalMilliseconds,
                FineWaitAdvanceMicroseconds = FineWaitAdvanceMicroseconds,
                FineWaitYieldThresholdMicroseconds = FineWaitYieldThresholdMicroseconds,
                DeadlineMessageDeferralMicroseconds = DeadlineMessageDeferralMicroseconds,
                PreferSetWaitableTimerEx = PreferSetWaitableTimerEx,
                UseThreadLatencyProfile = UseThreadLatencyProfile
            };
        }

        public RuntimeSchedulerOptions Normalize()
        {
            RuntimeSchedulerOptions options = Clone();
            options.WakeAdvanceMilliseconds = Clamp(options.WakeAdvanceMilliseconds, 0, 16);
            options.FallbackIntervalMilliseconds = Clamp(options.FallbackIntervalMilliseconds, 1, 16);
            options.FineWaitAdvanceMicroseconds = Clamp(options.FineWaitAdvanceMicroseconds, 0, 5000);
            options.FineWaitYieldThresholdMicroseconds = Clamp(options.FineWaitYieldThresholdMicroseconds, 0, 5000);
            if (options.FineWaitYieldThresholdMicroseconds > options.FineWaitAdvanceMicroseconds)
            {
                options.FineWaitYieldThresholdMicroseconds = options.FineWaitAdvanceMicroseconds;
            }

            options.DeadlineMessageDeferralMicroseconds = Clamp(options.DeadlineMessageDeferralMicroseconds, 0, 5000);
            return options;
        }

        private static int Clamp(int value, int minimum, int maximum)
        {
            if (value < minimum)
            {
                return minimum;
            }

            if (value > maximum)
            {
                return maximum;
            }

            return value;
        }
    }
}
