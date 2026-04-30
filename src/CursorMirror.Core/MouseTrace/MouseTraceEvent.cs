namespace CursorMirror.MouseTrace
{
    public sealed class MouseTraceEvent
    {
        public MouseTraceEvent(long sequence, long stopwatchTicks, long elapsedMicroseconds, int x, int y, string eventType)
        {
            Sequence = sequence;
            StopwatchTicks = stopwatchTicks;
            ElapsedMicroseconds = elapsedMicroseconds;
            X = x;
            Y = y;
            EventType = eventType;
        }

        public long Sequence { get; private set; }

        public long StopwatchTicks { get; private set; }

        public long ElapsedMicroseconds { get; private set; }

        public int X { get; private set; }

        public int Y { get; private set; }

        public string EventType { get; private set; }
    }
}
