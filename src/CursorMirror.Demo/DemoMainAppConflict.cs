using System;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;

namespace CursorMirror.Demo
{
    internal static class DemoMainAppConflict
    {
        private const string MainProcessName = "CursorMirror";

        public static bool IsDetected()
        {
            return CursorMirrorRuntimeSignals.IsMainShutdownEventAvailable() || IsMainProcessRunning();
        }

        public static bool RequestShutdownAndWait()
        {
            if (!CursorMirrorRuntimeSignals.TryRequestMainShutdown())
            {
                return false;
            }

            DateTime deadline = DateTime.UtcNow.AddMilliseconds(3000);
            while (DateTime.UtcNow < deadline)
            {
                if (!IsDetected())
                {
                    return true;
                }

                Application.DoEvents();
                Thread.Sleep(50);
            }

            return !IsDetected();
        }

        private static bool IsMainProcessRunning()
        {
            int currentProcessId = Process.GetCurrentProcess().Id;
            Process[] processes = Process.GetProcessesByName(MainProcessName);
            try
            {
                for (int i = 0; i < processes.Length; i++)
                {
                    if (processes[i].Id != currentProcessId)
                    {
                        return true;
                    }
                }

                return false;
            }
            finally
            {
                for (int i = 0; i < processes.Length; i++)
                {
                    processes[i].Dispose();
                }
            }
        }
    }
}
