using System;
using System.ComponentModel;
using System.Windows.Forms;

namespace CursorMirror
{
    internal sealed class CursorMirrorApplicationContext : ApplicationContext
    {
        private readonly OverlayWindow _overlayWindow;
        private readonly CursorMirrorController _controller;
        private readonly LowLevelMouseHook _mouseHook;
        private readonly TrayController _trayController;
        private readonly SettingsController _settingsController;
        private readonly Timer _opacityTimer;
        private SettingsWindow _settingsWindow;
        private bool _shutdownStarted;

        public CursorMirrorApplicationContext()
        {
            SettingsStore settingsStore = new SettingsStore();
            CursorMirrorSettings settings = settingsStore.Load();
            _overlayWindow = new OverlayWindow();
            _controller = new CursorMirrorController(
                new CursorImageProvider(),
                _overlayWindow,
                new ControlDispatcher(_overlayWindow),
                settings,
                new SystemClock());
            _settingsController = new SettingsController(settingsStore, settings, _controller.UpdateSettings, ExitFromSettings);
            _mouseHook = new LowLevelMouseHook(_controller.HandleMouseEvent);
            _opacityTimer = new Timer();
            _opacityTimer.Interval = 16;
            _opacityTimer.Tick += delegate
            {
                if (!_shutdownStarted)
                {
                    _controller.Tick();
                }
            };

            try
            {
                _mouseHook.SetHook();
                _trayController = new TrayController(ShowSettings, ExitFromTray);
                _opacityTimer.Start();
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

            if (_opacityTimer != null)
            {
                _opacityTimer.Stop();
                _opacityTimer.Dispose();
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

            if (_controller != null)
            {
                _controller.Dispose();
            }
        }
    }
}
