namespace CursorMirror.MouseTrace
{
    public sealed class MouseTraceSampleCounts
    {
        public MouseTraceSampleCounts(int totalSamples, int hookMoveSamples, int cursorPollSamples, int dwmTimingSamples)
        {
            TotalSamples = totalSamples;
            HookMoveSamples = hookMoveSamples;
            CursorPollSamples = cursorPollSamples;
            DwmTimingSamples = dwmTimingSamples;
        }

        public int TotalSamples { get; private set; }

        public int HookMoveSamples { get; private set; }

        public int CursorPollSamples { get; private set; }

        public int DwmTimingSamples { get; private set; }
    }
}
