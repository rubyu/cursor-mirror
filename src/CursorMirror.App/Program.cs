using System;
using System.ComponentModel;
using System.Windows.Forms;

namespace CursorMirror
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            NativeDpi.EnablePerMonitorDpiAwareness();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                Application.Run(new CursorMirrorApplicationContext());
            }
            catch (Win32Exception ex)
            {
                MessageBox.Show(
                    LocalizedStrings.StartupFailureMessage(ex.Message),
                    LocalizedStrings.StartupFailureTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    LocalizedStrings.StartupFailureMessage(ex.Message),
                    LocalizedStrings.StartupFailureTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }
    }
}
