using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace CursorMirror
{
    public sealed class TrayController : IDisposable
    {
        private readonly NotifyIcon _notifyIcon;
        private readonly ContextMenuStrip _menu;
        private readonly ToolStripMenuItem _versionItem;
        private readonly ToolStripMenuItem _updateStatusItem;
        private readonly IVersionUpdateChecker _updateChecker;
        private readonly object _updateLock = new object();
        private bool _updateCheckStarted;
        private bool _disposed;

        public TrayController(Action settingsAction, Action exitAction)
            : this(settingsAction, exitAction, new GitHubVersionUpdateChecker())
        {
        }

        public TrayController(Action settingsAction, Action exitAction, IVersionUpdateChecker updateChecker)
        {
            if (settingsAction == null)
            {
                throw new ArgumentNullException("settingsAction");
            }

            if (exitAction == null)
            {
                throw new ArgumentNullException("exitAction");
            }

            if (updateChecker == null)
            {
                throw new ArgumentNullException("updateChecker");
            }

            _updateChecker = updateChecker;
            _menu = new ContextMenuStrip();
            _menu.Opening += delegate
            {
                RefreshVersionItems();
                StartUpdateCheckOnce();
            };

            _versionItem = new ToolStripMenuItem(LocalizedStrings.VersionMenuText(BuildVersion.InformationalVersion));
            _versionItem.Enabled = false;
            _menu.Items.Add(_versionItem);

            _updateStatusItem = new ToolStripMenuItem(LocalizedStrings.UpdateStatusUnknown);
            _updateStatusItem.Enabled = false;
            _menu.Items.Add(_updateStatusItem);
            _menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem settingsItem = new ToolStripMenuItem(LocalizedStrings.SettingsCommand);
            settingsItem.Click += delegate
            {
                settingsAction();
            };
            _menu.Items.Add(settingsItem);
            _menu.Items.Add(new ToolStripSeparator());

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
            _notifyIcon.MouseUp += delegate(object sender, MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left)
                {
                    settingsAction();
                }
            };
            _notifyIcon.Visible = true;
        }

        private void RefreshVersionItems()
        {
            _versionItem.Text = LocalizedStrings.VersionMenuText(BuildVersion.InformationalVersion);
            if (!_updateCheckStarted)
            {
                _updateStatusItem.Text = LocalizedStrings.UpdateStatusUnknown;
            }
        }

        private void StartUpdateCheckOnce()
        {
            lock (_updateLock)
            {
                if (_updateCheckStarted)
                {
                    return;
                }

                _updateCheckStarted = true;
            }

            _updateStatusItem.Text = LocalizedStrings.UpdateStatusChecking;
            ThreadPool.QueueUserWorkItem(delegate
            {
                VersionUpdateResult result;
                try
                {
                    result = _updateChecker.Check();
                }
                catch (Exception ex)
                {
                    result = VersionUpdateResult.Unknown(BuildVersion.PackageVersion, ex.Message);
                }

                ApplyUpdateResult(result);
            });
        }

        private void ApplyUpdateResult(VersionUpdateResult result)
        {
            if (_disposed)
            {
                return;
            }

            if (_menu.InvokeRequired)
            {
                try
                {
                    _menu.BeginInvoke((MethodInvoker)delegate
                    {
                        ApplyUpdateResult(result);
                    });
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }

                return;
            }

            if (!_disposed)
            {
                _updateStatusItem.Text = FormatUpdateStatus(result);
            }
        }

        private static string FormatUpdateStatus(VersionUpdateResult result)
        {
            if (result == null)
            {
                return LocalizedStrings.UpdateStatusUnknown;
            }

            switch (result.State)
            {
                case VersionUpdateState.UpToDate:
                    return LocalizedStrings.UpdateStatusUpToDate(result.LatestVersion);
                case VersionUpdateState.Behind:
                    return LocalizedStrings.UpdateStatusBehind(result.VersionsBehind, result.LatestVersion);
                case VersionUpdateState.DevelopmentBuild:
                    return LocalizedStrings.UpdateStatusDevelopmentBuild(result.LatestVersion);
                case VersionUpdateState.AheadOfLatest:
                    return LocalizedStrings.UpdateStatusAheadOfLatest(result.LatestVersion);
                default:
                    return LocalizedStrings.UpdateStatusUnknown;
            }
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
