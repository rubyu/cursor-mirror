using System;
using System.Runtime.InteropServices;

namespace CursorMirror.MouseTrace
{
    public sealed class TraceNativeMethods : ITraceNativeMethods
    {
        [DllImport("user32.dll", EntryPoint = "GetCursorPos", SetLastError = true)]
        private static extern bool GetCursorPosNative(out NativePoint point);

        [DllImport("dwmapi.dll", EntryPoint = "DwmGetCompositionTimingInfo", PreserveSig = true)]
        private static extern int DwmGetCompositionTimingInfoNative(IntPtr hwnd, ref DwmTimingInfo timingInfo);

        [DllImport("winmm.dll", EntryPoint = "timeBeginPeriod", PreserveSig = true)]
        private static extern uint TimeBeginPeriodNative(uint milliseconds);

        [DllImport("winmm.dll", EntryPoint = "timeEndPeriod", PreserveSig = true)]
        private static extern uint TimeEndPeriodNative(uint milliseconds);

        public bool GetCursorPos(out NativePoint point)
        {
            return GetCursorPosNative(out point);
        }

        public bool TryGetDwmTimingInfo(out DwmTimingInfo timingInfo)
        {
            timingInfo = new DwmTimingInfo();
            timingInfo.Size = (uint)Marshal.SizeOf(typeof(DwmTimingInfo));
            return DwmGetCompositionTimingInfoNative(IntPtr.Zero, ref timingInfo) == 0;
        }

        public bool TryBeginTimerResolution(int milliseconds)
        {
            if (milliseconds <= 0)
            {
                return false;
            }

            return TimeBeginPeriodNative((uint)milliseconds) == 0;
        }

        public void EndTimerResolution(int milliseconds)
        {
            if (milliseconds <= 0)
            {
                return;
            }

            TimeEndPeriodNative((uint)milliseconds);
        }
    }
}
