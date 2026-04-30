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
        private bool _shutdownStarted;

        public CursorMirrorApplicationContext()
        {
            _overlayWindow = new OverlayWindow();
            _controller = new CursorMirrorController(
                new CursorImageProvider(),
                _overlayWindow,
                new ControlDispatcher(_overlayWindow));
            _mouseHook = new LowLevelMouseHook(_controller.HandleMouseEvent);

            try
            {
                _mouseHook.SetHook();
                _trayController = new TrayController(ExitFromTray);
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

        private void Shutdown()
        {
            if (_shutdownStarted)
            {
                return;
            }

            _shutdownStarted = true;

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
