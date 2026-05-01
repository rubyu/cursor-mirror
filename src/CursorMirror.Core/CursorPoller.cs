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

        [DllImport("dwmapi.dll", EntryPoint = "DwmGetCompositionTimingInfo", PreserveSig = true)]
        private static extern int DwmGetCompositionTimingInfoNative(IntPtr hwnd, ref DwmTimingInfo timingInfo);

        public bool TryGetSample(out CursorPollSample sample)
        {
            sample = new CursorPollSample();

            NativePoint point;
            if (!GetCursorPosNative(out point))
            {
                return false;
            }

            DwmTimingInfo timing = new DwmTimingInfo();
            timing.Size = (uint)Marshal.SizeOf(typeof(DwmTimingInfo));
            bool hasTiming = DwmGetCompositionTimingInfoNative(IntPtr.Zero, ref timing) == 0;

            sample.Position = new Point(point.x, point.y);
            sample.TimestampTicks = Stopwatch.GetTimestamp();
            sample.StopwatchFrequency = Stopwatch.Frequency;
            sample.DwmTimingAvailable = hasTiming;
            if (hasTiming)
            {
                sample.DwmVBlankTicks = ToSignedTicks(timing.QpcVBlank);
                sample.DwmRefreshPeriodTicks = ToSignedTicks(timing.QpcRefreshPeriod);
            }

            return true;
        }

        private static long ToSignedTicks(ulong value)
        {
            if (value > long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)value;
        }
    }
}
