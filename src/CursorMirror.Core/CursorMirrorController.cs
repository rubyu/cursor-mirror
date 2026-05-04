using System;
using System.Diagnostics;
using System.Drawing;
using CursorMirror.ProductRuntimeTelemetry;

namespace CursorMirror
{
    public sealed class CursorMirrorController : IDisposable
    {
        private const int SameCursorHandleRefreshMilliseconds = 100;
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
        private IntPtr _lastCursorHandle;
        private long _lastCursorImageRefreshMilliseconds;
        private Point _lastHotSpot;
        private bool _hasLastPointer;
        private Point _lastPointer;
        private bool _hasLastPollSample;
        private long _lastPollSampleTimestampTicks;
        private bool _hasLastDisplayPointer;
        private Point _lastDisplayPointer;
        private bool _hasLastOverlayLocation;
        private Point _lastOverlayLocation;
        private bool _disposed;
        private long _lastTickPollDurationTicks;
        private long _lastTickSelectTargetDurationTicks;
        private long _lastTickPredictDurationTicks;
        private long _lastTickMoveOverlayDurationTicks;
        private bool _lastTickPollSampleAvailable;
        private bool _lastTickStalePollSample;
        private bool _lastTickPredictionEnabled;
        private bool _lastTickOverlayMoveSkipped;
        private Point _lastTickRawPointer;
        private Point _lastTickDisplayPointer;

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
            _positionPredictor = new CursorPositionPredictor(_settings.PredictionIdleResetMilliseconds, _settings.PredictionGainPercent);
            _pollPositionPredictor = new DwmAwareCursorPositionPredictor(_settings.PredictionIdleResetMilliseconds);
            _pollPositionPredictor.ApplySettings(_settings);
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
                    StoreLastOverlayLocation(location);
                    _lastCursorHandle = capture.CursorHandle;
                    _lastCursorImageRefreshMilliseconds = now;
                    _lastHotSpot = capture.HotSpot;
                    _hasLastImage = true;
                    StoreLastDisplayPointer(displayPointer);
                }
            }
            else if (_hasLastImage)
            {
                Point location = OverlayPlacement.FromPointerAndHotSpot(displayPointer, _lastHotSpot);
                _overlayPresenter.Move(location);
                StoreLastOverlayLocation(location);
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
                _settings.PredictionIdleResetMilliseconds != normalized.PredictionIdleResetMilliseconds ||
                _settings.PredictionGainPercent != normalized.PredictionGainPercent ||
                _settings.DwmPredictionHorizonCapMilliseconds != normalized.DwmPredictionHorizonCapMilliseconds ||
                _settings.DwmAdaptiveGainEnabled != normalized.DwmAdaptiveGainEnabled ||
                _settings.DwmAdaptiveGainPercent != normalized.DwmAdaptiveGainPercent ||
                _settings.DwmAdaptiveMinimumSpeedPixelsPerSecond != normalized.DwmAdaptiveMinimumSpeedPixelsPerSecond ||
                _settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared != normalized.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared ||
                _settings.DwmAdaptiveReversalCooldownSamples != normalized.DwmAdaptiveReversalCooldownSamples ||
                _settings.DwmAdaptiveStableDirectionSamples != normalized.DwmAdaptiveStableDirectionSamples ||
                _settings.DwmAdaptiveOscillationWindowSamples != normalized.DwmAdaptiveOscillationWindowSamples ||
                _settings.DwmAdaptiveOscillationMinimumReversals != normalized.DwmAdaptiveOscillationMinimumReversals ||
                _settings.DwmAdaptiveOscillationMaximumSpanPixels != normalized.DwmAdaptiveOscillationMaximumSpanPixels ||
                _settings.DwmAdaptiveOscillationMaximumEfficiencyPercent != normalized.DwmAdaptiveOscillationMaximumEfficiencyPercent ||
                _settings.DwmAdaptiveOscillationLatchMilliseconds != normalized.DwmAdaptiveOscillationLatchMilliseconds ||
                _settings.DwmPredictionModel != normalized.DwmPredictionModel ||
                _settings.DwmPredictionTargetOffsetMilliseconds != normalized.DwmPredictionTargetOffsetMilliseconds ||
                _settings.DistilledMlpPostStopBrakeEnabled != normalized.DistilledMlpPostStopBrakeEnabled;

            _settings = normalized;
            _opacityController.ApplySettings(_settings);
            if (predictionChanged)
            {
                _positionPredictor.ApplySettings(_settings.PredictionIdleResetMilliseconds, _settings.PredictionGainPercent);
                _pollPositionPredictor.ApplySettings(_settings);
            }

            ApplyOpacity(_clock.Milliseconds);
        }

        public void Tick()
        {
            Tick(0, 0);
        }

        public void Tick(long targetVBlankTicks, long refreshPeriodTicks)
        {
            ThrowIfDisposed();
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Current;
            bool telemetryEnabled = recorder.IsEnabled;
            long tickStartedTicks = 0;
            long opacityStartedTicks = 0;
            long opacityCompletedTicks = 0;
            int gen0Before = 0;
            int gen1Before = 0;
            int gen2Before = 0;

            if (telemetryEnabled)
            {
                ResetTickTelemetry();
                tickStartedTicks = Stopwatch.GetTimestamp();
                gen0Before = GC.CollectionCount(0);
                gen1Before = GC.CollectionCount(1);
                gen2Before = GC.CollectionCount(2);
            }

            long now = _clock.Milliseconds;
            PollAndMove(now, targetVBlankTicks, refreshPeriodTicks);
            if (telemetryEnabled)
            {
                opacityStartedTicks = Stopwatch.GetTimestamp();
            }

            ApplyOpacity(now);
            if (telemetryEnabled)
            {
                opacityCompletedTicks = Stopwatch.GetTimestamp();
                RecordControllerTickTelemetry(
                    recorder,
                    tickStartedTicks,
                    opacityStartedTicks,
                    opacityCompletedTicks,
                    targetVBlankTicks,
                    refreshPeriodTicks,
                    gen0Before,
                    gen1Before,
                    gen2Before);
            }
        }

        public void Hide()
        {
            ThrowIfDisposed();
            _overlayPresenter.HideOverlay();
            _hasLastImage = false;
            _lastCursorHandle = IntPtr.Zero;
            _lastCursorImageRefreshMilliseconds = 0;
            _hasLastPointer = false;
            _hasLastPollSample = false;
            _hasLastDisplayPointer = false;
            _hasLastOverlayLocation = false;
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
            ApplyOpacity(now);

            Point displayPointer = _hasLastDisplayPointer ? _lastDisplayPointer : pointer;
            if (ShouldSkipCursorImageCapture(now, displayPointer))
            {
                return;
            }

            CursorCapture capture;
            if (_cursorImageProvider.TryCapture(out capture))
            {
                using (capture)
                {
                    Point location = OverlayPlacement.FromPointerAndHotSpot(displayPointer, capture.HotSpot);
                    _overlayPresenter.ShowCursor(capture.Bitmap, location);
                    StoreLastOverlayLocation(location);
                    _lastCursorHandle = capture.CursorHandle;
                    _lastCursorImageRefreshMilliseconds = now;
                    _lastHotSpot = capture.HotSpot;
                    _hasLastImage = true;
                    StoreLastDisplayPointer(displayPointer);
                }
            }
            else if (_hasLastImage)
            {
                Point location = OverlayPlacement.FromPointerAndHotSpot(displayPointer, _lastHotSpot);
                _overlayPresenter.Move(location);
                StoreLastOverlayLocation(location);
            }
        }

        private void PollAndMove(long now, long targetVBlankTicks, long refreshPeriodTicks)
        {
            bool telemetryEnabled = ProductRuntimeOutlierRecorder.Current.IsEnabled;
            long phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
            CursorPollSample sample;
            if (!_cursorPoller.TryGetSample(out sample))
            {
                if (telemetryEnabled)
                {
                    _lastTickPollDurationTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                    _lastTickPollSampleAvailable = false;
                }

                return;
            }

            if (telemetryEnabled)
            {
                _lastTickPollDurationTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                _lastTickPollSampleAvailable = true;
                _lastTickRawPointer = sample.Position;
            }

            if (IsStalePollSample(sample))
            {
                if (telemetryEnabled)
                {
                    _lastTickStalePollSample = true;
                }

                _predictionCounters.StalePollSamples++;
                return;
            }

            _lastPollSampleTimestampTicks = sample.TimestampTicks;
            _hasLastPollSample = true;
            RecordMovementIfPointerChanged(sample.Position, now);

            phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
            long effectiveTargetVBlankTicks = SelectEffectiveTargetVBlank(sample, targetVBlankTicks, refreshPeriodTicks);
            long effectiveRefreshPeriodTicks = ResolveRefreshPeriodTicks(sample, refreshPeriodTicks);
            if (telemetryEnabled)
            {
                _lastTickSelectTargetDurationTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
            }

            Point displayPointer;
            if (_settings.PredictionEnabled)
            {
                phaseStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                displayPointer = _pollPositionPredictor.PredictRounded(sample, _predictionCounters, effectiveTargetVBlankTicks, effectiveRefreshPeriodTicks);
                if (telemetryEnabled)
                {
                    _lastTickPredictDurationTicks = Stopwatch.GetTimestamp() - phaseStartedTicks;
                    _lastTickPredictionEnabled = true;
                }
            }
            else
            {
                _pollPositionPredictor.Reset();
                displayPointer = sample.Position;
                if (telemetryEnabled)
                {
                    _lastTickPredictionEnabled = false;
                }
            }

            if (telemetryEnabled)
            {
                _lastTickDisplayPointer = displayPointer;
            }

            StoreLastDisplayPointer(displayPointer);
            if (_hasLastImage)
            {
                MoveOverlay(OverlayPlacement.FromPointerAndHotSpot(displayPointer, _lastHotSpot), effectiveTargetVBlankTicks);
            }
        }

        private long SelectEffectiveTargetVBlank(CursorPollSample sample, long targetVBlankTicks, long refreshPeriodTicks)
        {
            if (targetVBlankTicks <= 0)
            {
                return 0;
            }

            long effectiveRefreshPeriodTicks = ResolveRefreshPeriodTicks(sample, refreshPeriodTicks);
            if (effectiveRefreshPeriodTicks <= 0)
            {
                return targetVBlankTicks;
            }

            long nowTicks = Stopwatch.GetTimestamp();
            long guardTicks = MicrosecondsToTicks(DwmSynchronizedRuntimeScheduler.DisplayDeadlineGuardMicroseconds, Stopwatch.Frequency);
            long safeTargetTicks = nowTicks + guardTicks;
            if (targetVBlankTicks > safeTargetTicks)
            {
                return targetVBlankTicks;
            }

            _predictionCounters.ScheduledDwmTargetAdjustedToNextVBlank++;
            long adjustedTargetTicks = targetVBlankTicks;
            long requiredTicks = safeTargetTicks - adjustedTargetTicks;
            long periods = (requiredTicks / effectiveRefreshPeriodTicks) + 1L;
            if (periods > 0)
            {
                adjustedTargetTicks += periods * effectiveRefreshPeriodTicks;
            }

            return adjustedTargetTicks;
        }

        private void MoveOverlay(Point location, long targetVBlankTicks)
        {
            bool telemetryEnabled = ProductRuntimeOutlierRecorder.Current.IsEnabled;
            long startedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
            if (_hasLastOverlayLocation && _lastOverlayLocation == location)
            {
                if (telemetryEnabled)
                {
                    _lastTickMoveOverlayDurationTicks = Stopwatch.GetTimestamp() - startedTicks;
                    _lastTickOverlayMoveSkipped = true;
                }

                return;
            }

            _overlayPresenter.Move(location);
            StoreLastOverlayLocation(location);
            if (telemetryEnabled)
            {
                _lastTickMoveOverlayDurationTicks = Stopwatch.GetTimestamp() - startedTicks;
            }

            RecordOverlayUpdateTiming(targetVBlankTicks);
        }

        private void RecordOverlayUpdateTiming(long targetVBlankTicks)
        {
            if (targetVBlankTicks <= 0)
            {
                return;
            }

            long completedTicks = Stopwatch.GetTimestamp();
            if (completedTicks >= targetVBlankTicks)
            {
                _predictionCounters.OverlayUpdateCompletedAfterTargetVBlank++;
                return;
            }

            long guardTicks = MicrosecondsToTicks(DwmSynchronizedRuntimeScheduler.DisplayDeadlineGuardMicroseconds, Stopwatch.Frequency);
            if (targetVBlankTicks - completedTicks <= guardTicks)
            {
                _predictionCounters.OverlayUpdateCompletedNearTargetVBlank++;
            }
        }

        private static long ResolveRefreshPeriodTicks(CursorPollSample sample, long refreshPeriodTicks)
        {
            if (refreshPeriodTicks > 0)
            {
                return refreshPeriodTicks;
            }

            return sample.DwmRefreshPeriodTicks;
        }

        private static long MicrosecondsToTicks(int microseconds, long stopwatchFrequency)
        {
            if (microseconds <= 0 || stopwatchFrequency <= 0)
            {
                return 0;
            }

            double ticks = microseconds * (double)stopwatchFrequency / 1000000.0;
            if (ticks >= long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)Math.Round(ticks);
        }

        private void ResetTickTelemetry()
        {
            _lastTickPollDurationTicks = 0;
            _lastTickSelectTargetDurationTicks = 0;
            _lastTickPredictDurationTicks = 0;
            _lastTickMoveOverlayDurationTicks = 0;
            _lastTickPollSampleAvailable = false;
            _lastTickStalePollSample = false;
            _lastTickPredictionEnabled = false;
            _lastTickOverlayMoveSkipped = false;
            _lastTickRawPointer = Point.Empty;
            _lastTickDisplayPointer = Point.Empty;
        }

        private void RecordControllerTickTelemetry(
            ProductRuntimeOutlierRecorder recorder,
            long tickStartedTicks,
            long opacityStartedTicks,
            long opacityCompletedTicks,
            long targetVBlankTicks,
            long refreshPeriodTicks,
            int gen0Before,
            int gen1Before,
            int gen2Before)
        {
            long completedTicks = Stopwatch.GetTimestamp();
            ProductRuntimeOutlierEvent runtimeEvent = new ProductRuntimeOutlierEvent();
            runtimeEvent.EventKind = (int)ProductRuntimeOutlierEventKind.ControllerTick;
            runtimeEvent.StopwatchTicks = completedTicks;
            runtimeEvent.TargetVBlankTicks = targetVBlankTicks;
            runtimeEvent.RefreshPeriodTicks = refreshPeriodTicks;
            runtimeEvent.PollDurationTicks = _lastTickPollDurationTicks;
            runtimeEvent.SelectTargetDurationTicks = _lastTickSelectTargetDurationTicks;
            runtimeEvent.PredictDurationTicks = _lastTickPredictDurationTicks;
            runtimeEvent.MoveOverlayDurationTicks = _lastTickMoveOverlayDurationTicks;
            runtimeEvent.ApplyOpacityDurationTicks = opacityCompletedTicks - opacityStartedTicks;
            runtimeEvent.TickTotalDurationTicks = completedTicks - tickStartedTicks;
            runtimeEvent.PollSampleAvailable = _lastTickPollSampleAvailable ? 1 : 0;
            runtimeEvent.StalePollSample = _lastTickStalePollSample ? 1 : 0;
            runtimeEvent.PredictionEnabled = _lastTickPredictionEnabled ? 1 : 0;
            runtimeEvent.OverlayMoveSkipped = _lastTickOverlayMoveSkipped ? 1 : 0;
            runtimeEvent.RawX = _lastTickRawPointer.X;
            runtimeEvent.RawY = _lastTickRawPointer.Y;
            runtimeEvent.DisplayX = _lastTickDisplayPointer.X;
            runtimeEvent.DisplayY = _lastTickDisplayPointer.Y;
            runtimeEvent.Gen0Before = gen0Before;
            runtimeEvent.Gen0After = GC.CollectionCount(0);
            runtimeEvent.Gen1Before = gen1Before;
            runtimeEvent.Gen1After = GC.CollectionCount(1);
            runtimeEvent.Gen2Before = gen2Before;
            runtimeEvent.Gen2After = GC.CollectionCount(2);
            if (targetVBlankTicks > 0)
            {
                runtimeEvent.VBlankLeadMicroseconds = ProductRuntimeOutlierRecorder.TicksToMicroseconds(targetVBlankTicks - completedTicks);
            }

            recorder.Record(ref runtimeEvent);
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

        private bool IsStalePollSample(CursorPollSample sample)
        {
            return _hasLastPollSample && sample.TimestampTicks <= _lastPollSampleTimestampTicks;
        }

        private void StoreLastDisplayPointer(Point displayPointer)
        {
            _lastDisplayPointer = displayPointer;
            _hasLastDisplayPointer = true;
        }

        private void StoreLastOverlayLocation(Point location)
        {
            _lastOverlayLocation = location;
            _hasLastOverlayLocation = true;
        }

        private void ApplyOpacity(long now)
        {
            _overlayPresenter.SetOpacity(_opacityController.GetOpacityByte(now));
        }

        private bool ShouldSkipCursorImageCapture(long nowMilliseconds, Point displayPointer)
        {
            if (!_hasLastImage)
            {
                return false;
            }

            IntPtr cursorHandle;
            if (!_cursorImageProvider.TryGetCurrentCursorHandle(out cursorHandle))
            {
                return false;
            }

            if (cursorHandle != _lastCursorHandle)
            {
                return false;
            }

            if (nowMilliseconds - _lastCursorImageRefreshMilliseconds >= SameCursorHandleRefreshMilliseconds)
            {
                return false;
            }

            StoreLastDisplayPointer(displayPointer);
            return true;
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
