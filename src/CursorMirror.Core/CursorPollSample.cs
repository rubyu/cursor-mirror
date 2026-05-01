using System.Drawing;

namespace CursorMirror
{
    public struct CursorPollSample
    {
        public Point Position;
        public long TimestampTicks;
        public long StopwatchFrequency;
        public bool DwmTimingAvailable;
        public long DwmVBlankTicks;
        public long DwmRefreshPeriodTicks;
    }
}
