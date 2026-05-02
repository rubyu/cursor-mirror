using System;
using System.Windows.Forms;

namespace CursorMirror.Calibrator
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new CalibratorForm(CalibratorRunOptions.FromArguments(args)));
        }
    }
}
