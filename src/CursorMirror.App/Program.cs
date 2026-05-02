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
                SettingsStore settingsStore = new SettingsStore();
                string restoreFailureMessage;
                CursorMirrorSettings settings = settingsStore.Load(out restoreFailureMessage);
                if (restoreFailureMessage != null)
                {
                    TryResetSettingsFile(settingsStore, settings);
                    MessageBox.Show(
                        LocalizedStrings.SettingsRestoreFailureMessage(settingsStore.Path, restoreFailureMessage),
                        LocalizedStrings.ProductName,
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning);
                }

                Application.Run(new CursorMirrorApplicationContext(settingsStore, settings));
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

        private static void TryResetSettingsFile(SettingsStore settingsStore, CursorMirrorSettings settings)
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
