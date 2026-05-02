using System.Drawing;

namespace CursorMirror
{
    public sealed class DemoPointerSample
    {
        public DemoPointerSample(
            Point position,
            bool shouldPoll,
            bool shouldHook,
            bool isMoving,
            string phase,
            long timestampTicks,
            long stopwatchFrequency,
            long dwmVBlankTicks,
            long dwmRefreshPeriodTicks)
        {
            Position = position;
            ShouldPoll = shouldPoll;
            ShouldHook = shouldHook;
            IsMoving = isMoving;
            Phase = phase;
            TimestampTicks = timestampTicks;
            StopwatchFrequency = stopwatchFrequency;
            DwmVBlankTicks = dwmVBlankTicks;
            DwmRefreshPeriodTicks = dwmRefreshPeriodTicks;
        }

        public Point Position { get; private set; }
        public bool ShouldPoll { get; private set; }
        public bool ShouldHook { get; private set; }
        public bool IsMoving { get; private set; }
        public string Phase { get; private set; }
        public long TimestampTicks { get; private set; }
        public long StopwatchFrequency { get; private set; }
        public long DwmVBlankTicks { get; private set; }
        public long DwmRefreshPeriodTicks { get; private set; }
    }
}
