using System;
using System.Drawing;

namespace CursorMirror
{
    public sealed class CursorMirrorController : IDisposable
    {
        private readonly ICursorImageProvider _cursorImageProvider;
        private readonly IOverlayPresenter _overlayPresenter;
        private readonly IUiDispatcher _dispatcher;
        private readonly MovementOpacityController _opacityController;
        private readonly IClock _clock;
        private bool _hasLastImage;
        private Point _lastHotSpot;
        private bool _disposed;

        public CursorMirrorController(ICursorImageProvider cursorImageProvider, IOverlayPresenter overlayPresenter, IUiDispatcher dispatcher)
            : this(cursorImageProvider, overlayPresenter, dispatcher, CursorMirrorSettings.Default(), new SystemClock())
        {
        }

        public CursorMirrorController(ICursorImageProvider cursorImageProvider, IOverlayPresenter overlayPresenter, IUiDispatcher dispatcher, CursorMirrorSettings settings, IClock clock)
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

            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            if (clock == null)
            {
                throw new ArgumentNullException("clock");
            }

            _cursorImageProvider = cursorImageProvider;
            _overlayPresenter = overlayPresenter;
            _dispatcher = dispatcher;
            _opacityController = new MovementOpacityController(settings);
            _clock = clock;
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
            long now = _clock.Milliseconds;
            _opacityController.RecordMovement(now);
            ApplyOpacity(now);

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

        public void UpdateSettings(CursorMirrorSettings settings)
        {
            ThrowIfDisposed();
            _opacityController.ApplySettings(settings);
            ApplyOpacity(_clock.Milliseconds);
        }

        public void Tick()
        {
            ThrowIfDisposed();
            ApplyOpacity(_clock.Milliseconds);
        }

        public void Hide()
        {
            ThrowIfDisposed();
            _overlayPresenter.HideOverlay();
            _hasLastImage = false;
            _opacityController.Reset();
            _overlayPresenter.SetOpacity(255);
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

        private void ApplyOpacity(long now)
        {
            _overlayPresenter.SetOpacity(_opacityController.GetOpacityByte(now));
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
