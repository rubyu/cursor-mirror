using System;
using System.Runtime.InteropServices;
using CursorMirror.MouseTrace;

namespace CursorMirror
{
    public static class DwmNative
    {
        [DllImport("dwmapi.dll", EntryPoint = "DwmGetCompositionTimingInfo", PreserveSig = true)]
        private static extern int DwmGetCompositionTimingInfoNative(IntPtr hwnd, ref DwmTimingInfo timingInfo);

        public static bool TryGetCompositionTimingInfo(out DwmTimingInfo timingInfo)
        {
            timingInfo = new DwmTimingInfo();
            timingInfo.Size = (uint)Marshal.SizeOf(typeof(DwmTimingInfo));
            return DwmGetCompositionTimingInfoNative(IntPtr.Zero, ref timingInfo) == 0;
        }

        public static long ToSignedTicks(ulong value)
        {
            if (value > long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)value;
        }
    }
}
