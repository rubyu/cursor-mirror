using System;
using System.Drawing;
using System.Windows.Forms;

namespace CursorMirror
{
    public sealed class TrayController : IDisposable
    {
        private readonly NotifyIcon _notifyIcon;
        private readonly ContextMenuStrip _menu;
        private bool _disposed;

        public TrayController(Action exitAction)
        {
            if (exitAction == null)
            {
                throw new ArgumentNullException("exitAction");
            }

            _menu = new ContextMenuStrip();
            ToolStripMenuItem exitItem = new ToolStripMenuItem(LocalizedStrings.ExitCommand);
            exitItem.Click += delegate
            {
                exitAction();
            };
            _menu.Items.Add(exitItem);

            _notifyIcon = new NotifyIcon();
            _notifyIcon.Text = LocalizedStrings.ProductName;
            _notifyIcon.Icon = AppIcon.Load();
            _notifyIcon.ContextMenuStrip = _menu;
            _notifyIcon.Visible = true;
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                _notifyIcon.Visible = false;
                _notifyIcon.Dispose();
                _menu.Dispose();
                _disposed = true;
            }
        }
    }
}
