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
        private readonly CursorPositionPredictor _positionPredictor;
        private readonly DwmAwareCursorPositionPredictor _pollPositionPredictor;
        private readonly ICursorPoller _cursorPoller;
        private readonly IClock _clock;
        private readonly CursorPredictionCounters _predictionCounters = new CursorPredictionCounters();
        private CursorMirrorSettings _settings;
        private bool _hasLastImage;
        private Point _lastHotSpot;
        private bool _hasLastPointer;
        private Point _lastPointer;
        private bool _hasLastDisplayPointer;
        private Point _lastDisplayPointer;
        private bool _disposed;

        public CursorMirrorController(ICursorImageProvider cursorImageProvider, IOverlayPresenter overlayPresenter, IUiDispatcher dispatcher)
            : this(cursorImageProvider, overlayPresenter, dispatcher, CursorMirrorSettings.Default(), new SystemClock())
        {
        }

        public CursorMirrorController(ICursorImageProvider cursorImageProvider, IOverlayPresenter overlayPresenter, IUiDispatcher dispatcher, CursorMirrorSettings settings, IClock clock)
            : this(cursorImageProvider, overlayPresenter, dispatcher, settings, clock, NullCursorPoller.Instance)
        {
        }

        public CursorMirrorController(ICursorImageProvider cursorImageProvider, IOverlayPresenter overlayPresenter, IUiDispatcher dispatcher, CursorMirrorSettings settings, IClock clock, ICursorPoller cursorPoller)
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

            if (cursorPoller == null)
            {
                throw new ArgumentNullException("cursorPoller");
            }

            _cursorImageProvider = cursorImageProvider;
            _overlayPresenter = overlayPresenter;
            _dispatcher = dispatcher;
            _settings = settings.Normalize();
            _opacityController = new MovementOpacityController(_settings);
            _positionPredictor = new CursorPositionPredictor(_settings.PredictionIdleResetMilliseconds);
            _pollPositionPredictor = new DwmAwareCursorPositionPredictor(_settings.PredictionIdleResetMilliseconds);
            _cursorPoller = cursorPoller;
            _clock = clock;
        }

        public HookResult HandleMouseEvent(LowLevelMouseHook.MouseEvent mouseEvent, LowLevelMouseHook.MSLLHOOKSTRUCT data)
        {
            if (mouseEvent == LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE)
            {
                Point pointer = new Point(data.pt.x, data.pt.y);
                QueueCursorImageUpdate(pointer);
            }

            return HookResult.Transfer;
        }

        public void UpdateAt(Point pointer)
        {
            ThrowIfDisposed();
            long now = _clock.Milliseconds;
            RecordMovementIfPointerChanged(pointer, now);
            ApplyOpacity(now);
            Point displayPointer = GetDisplayPointer(pointer, now);

            CursorCapture capture;
            if (_cursorImageProvider.TryCapture(out capture))
            {
                using (capture)
                {
                    Point location = OverlayPlacement.FromPointerAndHotSpot(displayPointer, capture.HotSpot);
                    _overlayPresenter.ShowCursor(capture.Bitmap, location);
                    _lastHotSpot = capture.HotSpot;
                    _hasLastImage = true;
                    StoreLastDisplayPointer(displayPointer);
                }
            }
            else if (_hasLastImage)
            {
                _overlayPresenter.Move(OverlayPlacement.FromPointerAndHotSpot(displayPointer, _lastHotSpot));
                StoreLastDisplayPointer(displayPointer);
            }
        }

        public void UpdateSettings(CursorMirrorSettings settings)
        {
            ThrowIfDisposed();
            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            CursorMirrorSettings normalized = settings.Normalize();
            bool predictionChanged =
                _settings.PredictionEnabled != normalized.PredictionEnabled ||
                _settings.PredictionHorizonMilliseconds != normalized.PredictionHorizonMilliseconds ||
                _settings.PredictionIdleResetMilliseconds != normalized.PredictionIdleResetMilliseconds;

            _settings = normalized;
            _opacityController.ApplySettings(_settings);
            if (predictionChanged)
            {
                _positionPredictor.ApplyIdleResetMilliseconds(_settings.PredictionIdleResetMilliseconds);
                _pollPositionPredictor.ApplyIdleResetMilliseconds(_settings.PredictionIdleResetMilliseconds);
            }

            ApplyOpacity(_clock.Milliseconds);
        }

        public void Tick()
        {
            ThrowIfDisposed();
            long now = _clock.Milliseconds;
            PollAndMove(now);
            ApplyOpacity(now);
        }

        public void Hide()
        {
            ThrowIfDisposed();
            _overlayPresenter.HideOverlay();
            _hasLastImage = false;
            _hasLastPointer = false;
            _hasLastDisplayPointer = false;
            _opacityController.Reset();
            _positionPredictor.Reset();
            _pollPositionPredictor.Reset();
            _overlayPresenter.SetOpacity(255);
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                _positionPredictor.Reset();
                _pollPositionPredictor.Reset();
                _overlayPresenter.Dispose();
                _disposed = true;
            }
        }

        public CursorPredictionCounters PredictionCounters
        {
            get { return _predictionCounters; }
        }

        private void QueueCursorImageUpdate(Point pointer)
        {
            if (_dispatcher.InvokeRequired)
            {
                _dispatcher.BeginInvoke(delegate
                {
                    SafeUpdateCursorImageAt(pointer);
                });
            }
            else
            {
                SafeUpdateCursorImageAt(pointer);
            }
        }

        private void SafeUpdateCursorImageAt(Point pointer)
        {
            if (_disposed)
            {
                return;
            }

            try
            {
                UpdateCursorImageAt(pointer);
            }
            catch
            {
            }
        }

        private void UpdateCursorImageAt(Point pointer)
        {
            long now = _clock.Milliseconds;
            RecordMovementIfPointerChanged(pointer, now);
            ApplyOpacity(now);

            Point displayPointer = _hasLastDisplayPointer ? _lastDisplayPointer : pointer;
            CursorCapture capture;
            if (_cursorImageProvider.TryCapture(out capture))
            {
                using (capture)
                {
                    Point location = OverlayPlacement.FromPointerAndHotSpot(displayPointer, capture.HotSpot);
                    _overlayPresenter.ShowCursor(capture.Bitmap, location);
                    _lastHotSpot = capture.HotSpot;
                    _hasLastImage = true;
                    StoreLastDisplayPointer(displayPointer);
                }
            }
            else if (_hasLastImage)
            {
                _overlayPresenter.Move(OverlayPlacement.FromPointerAndHotSpot(displayPointer, _lastHotSpot));
            }
        }

        private void PollAndMove(long now)
        {
            CursorPollSample sample;
            if (!_cursorPoller.TryGetSample(out sample))
            {
                return;
            }

            RecordMovementIfPointerChanged(sample.Position, now);

            Point displayPointer;
            if (_settings.PredictionEnabled)
            {
                displayPointer = _pollPositionPredictor.PredictRounded(sample, _predictionCounters);
            }
            else
            {
                _pollPositionPredictor.Reset();
                displayPointer = sample.Position;
            }

            StoreLastDisplayPointer(displayPointer);
            if (_hasLastImage)
            {
                _overlayPresenter.Move(OverlayPlacement.FromPointerAndHotSpot(displayPointer, _lastHotSpot));
            }
        }

        private void RecordMovementIfPointerChanged(Point pointer, long now)
        {
            if (!_hasLastPointer || _lastPointer != pointer)
            {
                _opacityController.RecordMovement(now);
                _lastPointer = pointer;
                _hasLastPointer = true;
            }
        }

        private void StoreLastDisplayPointer(Point displayPointer)
        {
            _lastDisplayPointer = displayPointer;
            _hasLastDisplayPointer = true;
        }

        private void ApplyOpacity(long now)
        {
            _overlayPresenter.SetOpacity(_opacityController.GetOpacityByte(now));
        }

        private Point GetDisplayPointer(Point pointer, long now)
        {
            if (!_settings.PredictionEnabled)
            {
                return pointer;
            }

            _positionPredictor.AddSample(now, pointer);
            return _positionPredictor.PredictRounded(_settings.PredictionHorizonMilliseconds);
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
