namespace CursorMirror.MouseTrace
{
    public sealed class MouseTraceEvent
    {
        public MouseTraceEvent(long sequence, long stopwatchTicks, long elapsedMicroseconds, int x, int y, string eventType)
            : this(sequence, stopwatchTicks, elapsedMicroseconds, x, y, eventType, null, null, null, null, null, null, null, null, false, new DwmTimingInfo())
        {
        }

        public MouseTraceEvent(
            long sequence,
            long stopwatchTicks,
            long elapsedMicroseconds,
            int x,
            int y,
            string eventType,
            int? hookX,
            int? hookY,
            int? cursorX,
            int? cursorY,
            uint? hookMouseData,
            uint? hookFlags,
            uint? hookTimeMilliseconds,
            long? hookExtraInfo,
            bool dwmTimingAvailable,
            DwmTimingInfo dwmTiming)
        {
            Sequence = sequence;
            StopwatchTicks = stopwatchTicks;
            ElapsedMicroseconds = elapsedMicroseconds;
            X = x;
            Y = y;
            EventType = eventType;
            HookX = hookX;
            HookY = hookY;
            CursorX = cursorX;
            CursorY = cursorY;
            HookMouseData = hookMouseData;
            HookFlags = hookFlags;
            HookTimeMilliseconds = hookTimeMilliseconds;
            HookExtraInfo = hookExtraInfo;
            DwmTimingAvailable = dwmTimingAvailable;
            DwmTiming = dwmTiming;
        }

        public long Sequence { get; private set; }

        public long StopwatchTicks { get; private set; }

        public long ElapsedMicroseconds { get; private set; }

        public int X { get; private set; }

        public int Y { get; private set; }

        public string EventType { get; private set; }

        public int? HookX { get; private set; }

        public int? HookY { get; private set; }

        public int? CursorX { get; private set; }

        public int? CursorY { get; private set; }

        public uint? HookMouseData { get; private set; }

        public uint? HookFlags { get; private set; }

        public uint? HookTimeMilliseconds { get; private set; }

        public long? HookExtraInfo { get; private set; }

        public bool DwmTimingAvailable { get; private set; }

        public DwmTimingInfo DwmTiming { get; private set; }
    }
}
