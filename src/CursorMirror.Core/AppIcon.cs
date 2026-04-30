using System;
using System.Drawing;
using System.Windows.Forms;

namespace CursorMirror
{
    public static class AppIcon
    {
        public static Icon Load()
        {
            try
            {
                string executablePath = Application.ExecutablePath;
                if (!string.IsNullOrEmpty(executablePath))
                {
                    Icon icon = Icon.ExtractAssociatedIcon(executablePath);
                    if (icon != null)
                    {
                        return icon;
                    }
                }
            }
            catch
            {
            }

            return SystemIcons.Application;
        }
    }
}
