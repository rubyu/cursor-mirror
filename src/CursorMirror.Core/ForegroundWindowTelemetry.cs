using System;
using System.Runtime.InteropServices;

namespace CursorMirror
{
    internal static class ForegroundWindowTelemetry
    {
        [DllImport("user32.dll", EntryPoint = "GetForegroundWindow", SetLastError = false)]
        private static extern IntPtr GetForegroundWindowNative();

        [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId", SetLastError = false)]
        private static extern uint GetWindowThreadProcessIdNative(IntPtr windowHandle, out uint processId);

        [DllImport("kernel32.dll", EntryPoint = "GetCurrentProcessId", SetLastError = false)]
        private static extern uint GetCurrentProcessIdNative();

        public static void Capture(out int currentProcessForeground, out int foregroundWindowProcessId)
        {
            currentProcessForeground = 0;
            foregroundWindowProcessId = 0;

            IntPtr foregroundWindow = GetForegroundWindowNative();
            if (foregroundWindow == IntPtr.Zero)
            {
                return;
            }

            uint foregroundProcessId;
            GetWindowThreadProcessIdNative(foregroundWindow, out foregroundProcessId);
            if (foregroundProcessId == 0 || foregroundProcessId > int.MaxValue)
            {
                return;
            }

            foregroundWindowProcessId = (int)foregroundProcessId;
            uint currentProcessId = GetCurrentProcessIdNative();
            if (currentProcessId == foregroundProcessId)
            {
                currentProcessForeground = 1;
            }
        }
    }
}
