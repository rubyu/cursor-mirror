using System;
using System.ComponentModel;
using System.Threading;
using System.Windows.Forms;

namespace CursorMirror
{
    internal sealed class CursorMirrorApplicationContext : ApplicationContext
    {
        private readonly OverlayRuntimeThread _overlayRuntime;
        private readonly LowLevelMouseHook _mouseHook;
        private readonly TrayController _trayController;
        private readonly SettingsController _settingsController;
        private readonly EventWaitHandle _shutdownEvent;
        private readonly System.Windows.Forms.Timer _shutdownSignalTimer;
        private SettingsWindow _settingsWindow;
        private bool _shutdownStarted;

        public CursorMirrorApplicationContext()
            : this(new SettingsStore())
        {
        }

        private CursorMirrorApplicationContext(SettingsStore settingsStore)
            : this(settingsStore, settingsStore.Load())
        {
        }

        public CursorMirrorApplicationContext(SettingsStore settingsStore, CursorMirrorSettings settings)
        {
            if (settingsStore == null)
            {
                throw new ArgumentNullException("settingsStore");
            }

            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            settings = settings.Normalize();

            try
            {
                _shutdownEvent = CursorMirrorRuntimeSignals.CreateMainShutdownEvent();
                _overlayRuntime = new OverlayRuntimeThread(settings);
                _overlayRuntime.Start();
                _settingsController = new SettingsController(settingsStore, settings, _overlayRuntime.UpdateSettings, ExitFromSettings);
                _mouseHook = new LowLevelMouseHook(_overlayRuntime.HandleMouseEvent);
                _mouseHook.SetHook();
                _trayController = new TrayController(ShowSettings, ExitFromTray);
                _shutdownSignalTimer = new System.Windows.Forms.Timer();
                _shutdownSignalTimer.Interval = 250;
                _shutdownSignalTimer.Tick += delegate { CheckExternalShutdownSignal(); };
                _shutdownSignalTimer.Start();
            }
            catch (Win32Exception)
            {
                Shutdown();
                throw;
            }
            catch
            {
                Shutdown();
                throw;
            }
        }

        private void CheckExternalShutdownSignal()
        {
            if (_shutdownStarted)
            {
                return;
            }

            if (_shutdownEvent.WaitOne(0))
            {
                ExitFromExternalShutdown();
                return;
            }

        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                Shutdown();
            }

            base.Dispose(disposing);
        }

        private void ExitFromTray()
        {
            Shutdown();
            ExitThread();
        }

        private void ExitFromSettings()
        {
            Shutdown();
            ExitThread();
        }

        private void ExitFromExternalShutdown()
        {
            Shutdown();
            ExitThread();
        }

        private void ShowSettings()
        {
            if (_shutdownStarted)
            {
                return;
            }

            if (_settingsWindow == null || _settingsWindow.IsDisposed)
            {
                _settingsWindow = new SettingsWindow(_settingsController);
            }

            _settingsWindow.ShowSettings();
        }

        private void Shutdown()
        {
            if (_shutdownStarted)
            {
                return;
            }

            _shutdownStarted = true;

            if (_shutdownSignalTimer != null)
            {
                _shutdownSignalTimer.Stop();
                _shutdownSignalTimer.Dispose();
            }

            if (_settingsWindow != null)
            {
                _settingsWindow.Dispose();
                _settingsWindow = null;
            }

            if (_mouseHook != null && _mouseHook.IsActivated)
            {
                try
                {
                    _mouseHook.Unhook();
                }
                catch
                {
                }
            }

            if (_trayController != null)
            {
                _trayController.Dispose();
            }

            if (_overlayRuntime != null)
            {
                _overlayRuntime.Dispose();
            }

            if (_shutdownEvent != null)
            {
                _shutdownEvent.Dispose();
            }
        }
    }
}
