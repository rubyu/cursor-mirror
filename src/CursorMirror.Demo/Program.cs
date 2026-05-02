using System;
using System.Windows.Forms;

namespace CursorMirror.Demo
{
    internal static class Program
    {
        [STAThread]
        private static int Main()
        {
            DemoSettingsStore settingsStore = new DemoSettingsStore();
            string restoreFailureMessage;
            DemoSettings settings = settingsStore.Load(out restoreFailureMessage);
            DemoLanguage.Apply(settings.Language);

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            NativeDpi.EnablePerMonitorDpiAwareness();
            if (restoreFailureMessage != null)
            {
                TryResetSettingsFile(settingsStore, settings);
                MessageBox.Show(
                    LocalizedStrings.DemoSettingsRestoreFailureMessage(settingsStore.Path, restoreFailureMessage),
                    LocalizedStrings.DemoToolTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }

            Application.Run(new DemoForm(settingsStore, settings));
            return 0;
        }

        private static void TryResetSettingsFile(DemoSettingsStore settingsStore, DemoSettings settings)
        {
            try
            {
                settingsStore.Save(settings);
            }
            catch
            {
            }
        }
    }
}
