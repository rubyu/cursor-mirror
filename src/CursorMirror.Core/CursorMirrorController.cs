using System;
using System.Drawing;

namespace CursorMirror
{
    public sealed class CursorMirrorController : IDisposable
    {
        private readonly ICursorImageProvider _cursorImageProvider;
        private readonly IOverlayPresenter _overlayPresenter;
        private readonly IUiDispatcher _dispatcher;
        private bool _hasLastImage;
        private Point _lastHotSpot;
        private bool _disposed;

        public CursorMirrorController(ICursorImageProvider cursorImageProvider, IOverlayPresenter overlayPresenter, IUiDispatcher dispatcher)
        {
            if (cursorImageProvider == null)
            {
                throw new ArgumentNullException("cursorImageProvider");
            }

            if (overlayPresenter == null)
            {
                throw new ArgumentNullException("overlayPresenter");
            }

            if (dispatcher == null)
            {
                throw new ArgumentNullException("dispatcher");
            }

            _cursorImageProvider = cursorImageProvider;
            _overlayPresenter = overlayPresenter;
            _dispatcher = dispatcher;
        }

        public HookResult HandleMouseEvent(LowLevelMouseHook.MouseEvent mouseEvent, LowLevelMouseHook.MSLLHOOKSTRUCT data)
        {
            if (mouseEvent == LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE)
            {
                Point pointer = new Point(data.pt.x, data.pt.y);
                QueueUpdate(pointer);
            }

            return HookResult.Transfer;
        }

        public void UpdateAt(Point pointer)
        {
            ThrowIfDisposed();

            CursorCapture capture;
            if (_cursorImageProvider.TryCapture(out capture))
            {
                using (capture)
                {
                    Point location = OverlayPlacement.FromPointerAndHotSpot(pointer, capture.HotSpot);
                    _overlayPresenter.ShowCursor(capture.Bitmap, location);
                    _lastHotSpot = capture.HotSpot;
                    _hasLastImage = true;
                }
            }
            else if (_hasLastImage)
            {
                _overlayPresenter.Move(OverlayPlacement.FromPointerAndHotSpot(pointer, _lastHotSpot));
            }
        }

        public void Hide()
        {
            ThrowIfDisposed();
            _overlayPresenter.HideOverlay();
            _hasLastImage = false;
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                _overlayPresenter.Dispose();
                _disposed = true;
            }
        }

        private void QueueUpdate(Point pointer)
        {
            if (_dispatcher.InvokeRequired)
            {
                _dispatcher.BeginInvoke(delegate
                {
                    SafeUpdateAt(pointer);
                });
            }
            else
            {
                SafeUpdateAt(pointer);
            }
        }

        private void SafeUpdateAt(Point pointer)
        {
            if (_disposed)
            {
                return;
            }

            try
            {
                UpdateAt(pointer);
            }
            catch
            {
            }
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(GetType().Name);
            }
        }
    }
}
