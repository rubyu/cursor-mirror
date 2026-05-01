using System;
using System.Windows.Forms;

namespace CursorMirror.TraceTool
{
    internal static class Program
    {
        [STAThread]
        private static int Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            NativeDpi.EnablePerMonitorDpiAwareness();
            Application.Run(new TraceToolForm());
            return 0;
        }
    }
}
