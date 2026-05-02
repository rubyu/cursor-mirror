namespace CursorMirror.MouseTrace
{
    public sealed class MouseTraceSnapshot
    {
        public MouseTraceSnapshot(MouseTraceState state, long startTicks, long stopTicks, long durationMicroseconds, MouseTraceEvent[] samples)
            : this(state, startTicks, stopTicks, durationMicroseconds, samples, 0, 0, 0, false, 0, 0, 0, 0, null, null)
        {
        }

        public MouseTraceSnapshot(MouseTraceState state, long startTicks, long stopTicks, long durationMicroseconds, MouseTraceEvent[] samples, int pollIntervalMilliseconds)
            : this(state, startTicks, stopTicks, durationMicroseconds, samples, pollIntervalMilliseconds, 0, 0, false, 0, 0, 0, 0, null, null)
        {
        }

        public MouseTraceSnapshot(
            MouseTraceState state,
            long startTicks,
            long stopTicks,
            long durationMicroseconds,
            MouseTraceEvent[] samples,
            int pollIntervalMilliseconds,
            int referencePollIntervalMilliseconds,
            int timerResolutionMilliseconds,
            bool timerResolutionSucceeded)
            : this(
                state,
                startTicks,
                stopTicks,
                durationMicroseconds,
                samples,
                pollIntervalMilliseconds,
                referencePollIntervalMilliseconds,
                timerResolutionMilliseconds,
                timerResolutionSucceeded,
                0,
                0,
                0,
                0,
                null,
                null)
        {
        }

        public MouseTraceSnapshot(
            MouseTraceState state,
            long startTicks,
            long stopTicks,
            long durationMicroseconds,
            MouseTraceEvent[] samples,
            int pollIntervalMilliseconds,
            int referencePollIntervalMilliseconds,
            int timerResolutionMilliseconds,
            bool timerResolutionSucceeded,
            int runtimeSchedulerWakeAdvanceMilliseconds,
            int runtimeSchedulerFallbackIntervalMilliseconds,
            int runtimeSchedulerMaximumDwmSleepMilliseconds,
            int runtimeSchedulerCoalescedTickCount)
            : this(
                state,
                startTicks,
                stopTicks,
                durationMicroseconds,
                samples,
                pollIntervalMilliseconds,
                referencePollIntervalMilliseconds,
                timerResolutionMilliseconds,
                timerResolutionSucceeded,
                runtimeSchedulerWakeAdvanceMilliseconds,
                runtimeSchedulerFallbackIntervalMilliseconds,
                runtimeSchedulerMaximumDwmSleepMilliseconds,
                runtimeSchedulerCoalescedTickCount,
                null,
                null)
        {
        }

        public MouseTraceSnapshot(
            MouseTraceState state,
            long startTicks,
            long stopTicks,
            long durationMicroseconds,
            MouseTraceEvent[] samples,
            int pollIntervalMilliseconds,
            int referencePollIntervalMilliseconds,
            int timerResolutionMilliseconds,
            bool timerResolutionSucceeded,
            int runtimeSchedulerWakeAdvanceMilliseconds,
            int runtimeSchedulerFallbackIntervalMilliseconds,
            int runtimeSchedulerMaximumDwmSleepMilliseconds,
            int runtimeSchedulerCoalescedTickCount,
            string runtimeSchedulerThreadProfile,
            string runtimeSchedulerCaptureThreadProfile)
        {
            State = state;
            StartTicks = startTicks;
            StopTicks = stopTicks;
            DurationMicroseconds = durationMicroseconds;
            Samples = samples ?? new MouseTraceEvent[0];
            PollIntervalMilliseconds = pollIntervalMilliseconds;
            ReferencePollIntervalMilliseconds = referencePollIntervalMilliseconds;
            TimerResolutionMilliseconds = timerResolutionMilliseconds;
            TimerResolutionSucceeded = timerResolutionSucceeded;
            RuntimeSchedulerWakeAdvanceMilliseconds = runtimeSchedulerWakeAdvanceMilliseconds;
            RuntimeSchedulerFallbackIntervalMilliseconds = runtimeSchedulerFallbackIntervalMilliseconds;
            RuntimeSchedulerMaximumDwmSleepMilliseconds = runtimeSchedulerMaximumDwmSleepMilliseconds;
            RuntimeSchedulerCoalescedTickCount = runtimeSchedulerCoalescedTickCount;
            RuntimeSchedulerThreadProfile = string.IsNullOrWhiteSpace(runtimeSchedulerThreadProfile)
                ? ThreadLatencyProfile.UnavailableSummary
                : runtimeSchedulerThreadProfile;
            RuntimeSchedulerCaptureThreadProfile = string.IsNullOrWhiteSpace(runtimeSchedulerCaptureThreadProfile)
                ? ThreadLatencyProfile.UnavailableSummary
                : runtimeSchedulerCaptureThreadProfile;
        }

        public MouseTraceState State { get; private set; }

        public long StartTicks { get; private set; }

        public long StopTicks { get; private set; }

        public long DurationMicroseconds { get; private set; }

        public MouseTraceEvent[] Samples { get; private set; }

        public int PollIntervalMilliseconds { get; private set; }

        public int ReferencePollIntervalMilliseconds { get; private set; }

        public int TimerResolutionMilliseconds { get; private set; }

        public bool TimerResolutionSucceeded { get; private set; }

        public int RuntimeSchedulerWakeAdvanceMilliseconds { get; private set; }

        public int RuntimeSchedulerFallbackIntervalMilliseconds { get; private set; }

        public int RuntimeSchedulerMaximumDwmSleepMilliseconds { get; private set; }

        public int RuntimeSchedulerCoalescedTickCount { get; private set; }

        public string RuntimeSchedulerThreadProfile { get; private set; }

        public string RuntimeSchedulerCaptureThreadProfile { get; private set; }
    }
}
