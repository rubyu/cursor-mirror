using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using CursorMirror.MouseTrace;

namespace CursorMirror
{
    public sealed class CursorPoller : ICursorPoller
    {
        [DllImport("user32.dll", EntryPoint = "GetCursorPos", SetLastError = true)]
        private static extern bool GetCursorPosNative(out NativePoint point);

        public bool TryGetSample(out CursorPollSample sample)
        {
            sample = new CursorPollSample();

            NativePoint point;
            if (!GetCursorPosNative(out point))
            {
                return false;
            }

            DwmTimingInfo timing;
            bool hasTiming = DwmNative.TryGetCompositionTimingInfo(out timing);

            sample.Position = new Point(point.x, point.y);
            sample.TimestampTicks = Stopwatch.GetTimestamp();
            sample.StopwatchFrequency = Stopwatch.Frequency;
            sample.DwmTimingAvailable = hasTiming;
            if (hasTiming)
            {
                sample.DwmVBlankTicks = DwmNative.ToSignedTicks(timing.QpcVBlank);
                sample.DwmRefreshPeriodTicks = DwmNative.ToSignedTicks(timing.QpcRefreshPeriod);
            }

            return true;
        }
    }
}
