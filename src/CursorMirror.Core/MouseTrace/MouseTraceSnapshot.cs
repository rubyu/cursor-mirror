namespace CursorMirror.MouseTrace
{
    public sealed class MouseTraceSnapshot
    {
        public MouseTraceSnapshot(MouseTraceState state, long startTicks, long stopTicks, long durationMicroseconds, MouseTraceEvent[] samples)
        {
            State = state;
            StartTicks = startTicks;
            StopTicks = stopTicks;
            DurationMicroseconds = durationMicroseconds;
            Samples = samples ?? new MouseTraceEvent[0];
        }

        public MouseTraceState State { get; private set; }

        public long StartTicks { get; private set; }

        public long StopTicks { get; private set; }

        public long DurationMicroseconds { get; private set; }

        public MouseTraceEvent[] Samples { get; private set; }
    }
}
