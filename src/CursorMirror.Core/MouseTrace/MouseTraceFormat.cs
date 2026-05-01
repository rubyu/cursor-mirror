using System;
using System.Globalization;

namespace CursorMirror.MouseTrace
{
    public static class MouseTraceFormat
    {
        public static string FormatDuration(long elapsedMicroseconds)
        {
            if (elapsedMicroseconds < 0)
            {
                elapsedMicroseconds = 0;
            }

            TimeSpan duration = TimeSpan.FromTicks(elapsedMicroseconds * 10);
            return string.Format(
                CultureInfo.InvariantCulture,
                "{0:00}:{1:00}:{2:00}.{3:000}",
                (int)duration.TotalHours,
                duration.Minutes,
                duration.Seconds,
                duration.Milliseconds);
        }
    }
}
