namespace CursorMirror.MouseTrace
{
    public sealed class MouseTraceSampleCounts
    {
        public MouseTraceSampleCounts(
            int totalSamples,
            int hookMoveSamples,
            int cursorPollSamples,
            int referencePollSamples,
            int runtimeSchedulerPollSamples,
            int dwmTimingSamples)
        {
            TotalSamples = totalSamples;
            HookMoveSamples = hookMoveSamples;
            CursorPollSamples = cursorPollSamples;
            ReferencePollSamples = referencePollSamples;
            RuntimeSchedulerPollSamples = runtimeSchedulerPollSamples;
            DwmTimingSamples = dwmTimingSamples;
        }

        public int TotalSamples { get; private set; }

        public int HookMoveSamples { get; private set; }

        public int CursorPollSamples { get; private set; }

        public int ReferencePollSamples { get; private set; }

        public int RuntimeSchedulerPollSamples { get; private set; }

        public int DwmTimingSamples { get; private set; }
    }
}
