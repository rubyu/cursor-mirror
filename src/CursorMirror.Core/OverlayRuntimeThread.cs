using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using CursorMirror.ProductRuntimeTelemetry;

namespace CursorMirror
{
    public sealed class OverlayRuntimeThread : IDisposable
    {
        private const uint PmRemove = 0x0001;
        private const uint WaitObject0 = 0x00000000;
        private const uint WaitFailed = 0xFFFFFFFF;
        private const uint WaitInfinite = 0xFFFFFFFF;
        private const uint QsAllInput = 0x04FF;
        private const uint MwmoInputAvailable = 0x0004;
        private const int WmQuit = 0x0012;
        private const int FineWaitSpinIterations = 64;

        private readonly CursorMirrorSettings _initialSettings;
        private readonly ManualResetEvent _ready = new ManualResetEvent(false);
        private readonly object _sync = new object();
        private readonly object _mouseMoveSync = new object();
        private Thread _thread;
        private OverlayWindow _overlayWindow;
        private CursorMirrorController _controller;
        private Exception _startupException;
        private bool _started;
        private bool _disposed;
        private bool _timerResolutionActive;
        private volatile bool _stopping;
        private int _lastProcessedMessageCount;
        private long _lastProcessedMessageDurationTicks;
        private long _lastMaxMessageDispatchTicks;
        private int _lastWaitMessageWakeCount;
        private ProductWaitReturnReason _lastWaitReturnReason = ProductWaitReturnReason.None;
        private int _lastFineSleepZeroCount;
        private int _lastFineSpinCount;
        private bool _mouseMovePostPending;
        private bool _hasPendingMouseMove;
        private LowLevelMouseHook.MSLLHOOKSTRUCT _latestMouseMoveData;
        private long _latestMouseMoveReceivedTicks;
        private long _mouseMoveEventsReceivedSinceLastTick;
        private long _mouseMoveEventsCoalescedSinceLastTick;
        private long _mouseMovePostsQueuedSinceLastTick;
        private long _mouseMoveCallbacksProcessedSinceLastTick;

        [DllImport("user32.dll", EntryPoint = "PeekMessageW", SetLastError = true)]
        private static extern bool PeekMessageNative(out NativeMessage message, IntPtr window, uint filterMin, uint filterMax, uint removeMessage);

        [DllImport("user32.dll", EntryPoint = "TranslateMessage", SetLastError = false)]
        private static extern bool TranslateMessageNative(ref NativeMessage message);

        [DllImport("user32.dll", EntryPoint = "DispatchMessageW", SetLastError = false)]
        private static extern IntPtr DispatchMessageNative(ref NativeMessage message);

        [DllImport("user32.dll", EntryPoint = "MsgWaitForMultipleObjectsEx", SetLastError = true)]
        private static extern uint MsgWaitForMultipleObjectsExNative(uint count, IntPtr[] handles, uint milliseconds, uint wakeMask, uint flags);

        [DllImport("winmm.dll", EntryPoint = "timeBeginPeriod", PreserveSig = true)]
        private static extern uint TimeBeginPeriodNative(uint milliseconds);

        [DllImport("winmm.dll", EntryPoint = "timeEndPeriod", PreserveSig = true)]
        private static extern uint TimeEndPeriodNative(uint milliseconds);

        public OverlayRuntimeThread(CursorMirrorSettings initialSettings)
        {
            if (initialSettings == null)
            {
                throw new ArgumentNullException("initialSettings");
            }

            _initialSettings = initialSettings.Normalize();
        }

        public void Start()
        {
            ThrowIfDisposed();
            if (_started)
            {
                return;
            }

            _stopping = false;
            _startupException = null;
            _ready.Reset();
            _thread = new Thread(RunOverlayThread);
            _thread.Name = "Cursor Mirror overlay runtime";
            _thread.IsBackground = true;
            _thread.Priority = ThreadPriority.AboveNormal;
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
            _ready.WaitOne();

            if (_startupException != null)
            {
                Stop();
                throw new InvalidOperationException("The overlay runtime thread could not be started.", _startupException);
            }

            _started = true;
        }

        public HookResult HandleMouseEvent(LowLevelMouseHook.MouseEvent mouseEvent, LowLevelMouseHook.MSLLHOOKSTRUCT data)
        {
            if (mouseEvent == LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE)
            {
                QueueLatestMouseMove(data);
            }

            return HookResult.Transfer;
        }

        private void QueueLatestMouseMove(LowLevelMouseHook.MSLLHOOKSTRUCT data)
        {
            long receivedTicks = Stopwatch.GetTimestamp();
            bool shouldPost = false;
            Interlocked.Increment(ref _mouseMoveEventsReceivedSinceLastTick);

            lock (_mouseMoveSync)
            {
                _latestMouseMoveData = data;
                _latestMouseMoveReceivedTicks = receivedTicks;
                _hasPendingMouseMove = true;
                if (_mouseMovePostPending)
                {
                    Interlocked.Increment(ref _mouseMoveEventsCoalescedSinceLastTick);
                    return;
                }

                _mouseMovePostPending = true;
                shouldPost = true;
            }

            if (shouldPost)
            {
                if (Post(ProcessCoalescedMouseMoves))
                {
                    Interlocked.Increment(ref _mouseMovePostsQueuedSinceLastTick);
                }
                else
                {
                    lock (_mouseMoveSync)
                    {
                        _hasPendingMouseMove = false;
                        _mouseMovePostPending = false;
                    }
                }
            }
        }

        private void ProcessCoalescedMouseMoves()
        {
            while (!_stopping)
            {
                LowLevelMouseHook.MSLLHOOKSTRUCT data;
                lock (_mouseMoveSync)
                {
                    if (!_hasPendingMouseMove)
                    {
                        _mouseMovePostPending = false;
                        return;
                    }

                    data = _latestMouseMoveData;
                    _hasPendingMouseMove = false;
                }

                CursorMirrorController controller = GetController();
                if (controller != null)
                {
                    controller.HandleMouseEvent(LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE, data);
                }

                Interlocked.Increment(ref _mouseMoveCallbacksProcessedSinceLastTick);

                lock (_mouseMoveSync)
                {
                    if (!_hasPendingMouseMove)
                    {
                        _mouseMovePostPending = false;
                        return;
                    }
                }
            }
        }

        public void UpdateSettings(CursorMirrorSettings settings)
        {
            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            CursorMirrorSettings normalized = settings.Normalize();
            Post(delegate
            {
                CursorMirrorController controller = GetController();
                if (controller != null)
                {
                    controller.UpdateSettings(normalized);
                }
            });
        }

        public CursorPredictionCounters SnapshotPredictionCounters()
        {
            CursorMirrorController controller = GetController();
            return controller == null ? new CursorPredictionCounters() : controller.PredictionCounters.Clone();
        }

        public ProductRuntimeOutlierSnapshot SnapshotProductRuntimeOutliers()
        {
            return ProductRuntimeOutlierRecorder.Current.Snapshot();
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                Stop();
                _ready.Dispose();
                _disposed = true;
            }
        }

        private void RunOverlayThread()
        {
            OverlayWindow overlayWindow = null;
            CursorMirrorController controller = null;
            HighFrequencyCursorPoller cursorPoller = null;
            HighResolutionWaitTimer waitTimer = null;

            try
            {
                overlayWindow = new OverlayWindow();
                overlayWindow.CreateControl();
                IntPtr handle = overlayWindow.Handle;
                if (handle == IntPtr.Zero)
                {
                    throw new InvalidOperationException("The overlay window handle could not be created.");
                }

                ControlDispatcher dispatcher = new ControlDispatcher(overlayWindow);
                cursorPoller = new HighFrequencyCursorPoller();
                cursorPoller.Start();
                controller = new CursorMirrorController(
                    new CursorImageProvider(),
                    overlayWindow,
                    dispatcher,
                    _initialSettings,
                    new SystemClock(),
                    cursorPoller);
                waitTimer = HighResolutionWaitTimer.CreateBestEffort();

                lock (_sync)
                {
                    _overlayWindow = overlayWindow;
                    _controller = controller;
                }

                _timerResolutionActive = TimeBeginPeriodNative(DwmSynchronizedRuntimeScheduler.TimerResolutionMilliseconds) == 0;
                _ready.Set();
                RunSelfScheduledMessageLoop(controller, waitTimer);
            }
            catch (Exception ex)
            {
                _startupException = ex;
                _ready.Set();
            }
            finally
            {
                _stopping = true;

                if (waitTimer != null)
                {
                    waitTimer.Dispose();
                }

                if (_timerResolutionActive)
                {
                    TimeEndPeriodNative(DwmSynchronizedRuntimeScheduler.TimerResolutionMilliseconds);
                    _timerResolutionActive = false;
                }

                if (cursorPoller != null)
                {
                    cursorPoller.Dispose();
                }

                if (controller != null)
                {
                    controller.Dispose();
                }
                else if (overlayWindow != null)
                {
                    overlayWindow.Dispose();
                }

                lock (_sync)
                {
                    _controller = null;
                    _overlayWindow = null;
                }

                _ready.Set();
            }
        }

        private CursorMirrorController GetController()
        {
            lock (_sync)
            {
                return _controller;
            }
        }

        private bool Post(Action action)
        {
            if (action == null)
            {
                throw new ArgumentNullException("action");
            }

            if (_stopping || _disposed)
            {
                return false;
            }

            OverlayWindow overlayWindow;
            lock (_sync)
            {
                overlayWindow = _overlayWindow;
            }

            if (overlayWindow == null || overlayWindow.IsDisposed || !overlayWindow.IsHandleCreated)
            {
                return false;
            }

            try
            {
                overlayWindow.BeginInvoke(action);
                return true;
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
            catch (InvalidOperationException)
            {
                return false;
            }
        }

        private void Stop()
        {
            _stopping = true;

            OverlayWindow overlayWindow;
            lock (_sync)
            {
                overlayWindow = _overlayWindow;
            }

            if (overlayWindow != null && !overlayWindow.IsDisposed && overlayWindow.IsHandleCreated)
            {
                try
                {
                    overlayWindow.BeginInvoke((Action)delegate
                    {
                        _stopping = true;
                    });
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }
            }

            Thread thread = _thread;
            if (thread != null && thread != Thread.CurrentThread)
            {
                thread.Join(1000);
            }

            _thread = null;
            _started = false;
        }

        private void RunSelfScheduledMessageLoop(CursorMirrorController controller, HighResolutionWaitTimer waitTimer)
        {
            long lastRequestedVBlankTicks = 0;
            long loopIteration = 0;

            while (!_stopping)
            {
                loopIteration++;
                if (!ProcessPendingMessages())
                {
                    return;
                }

                ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Current;
                bool telemetryEnabled = recorder.IsEnabled;
                int messageCountBeforeTick = _lastProcessedMessageCount;
                long messageDurationBeforeTick = _lastProcessedMessageDurationTicks;
                long maxMessageDispatchBeforeTick = _lastMaxMessageDispatchTicks;
                long loopStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                long timingReadStartedTicks = telemetryEnabled ? Stopwatch.GetTimestamp() : 0;
                long timingReadCompletedTicks = 0;
                long decisionStartedTicks = 0;
                long decisionCompletedTicks = 0;
                long waitStartedTicks = 0;
                long waitCompletedTicks = 0;
                long tickStartedTicks = 0;
                long tickCompletedTicks = 0;
                long plannedWakeTicks = 0;
                long targetVBlankTicks = 0;
                long runtimeRefreshPeriodTicks = 0;
                ResetWaitTelemetry();

                long lastDwmVBlankTicks;
                long refreshPeriodTicks;
                if (DwmSynchronizedRuntimeScheduler.TryGetDwmTiming(out lastDwmVBlankTicks, out refreshPeriodTicks))
                {
                    if (telemetryEnabled)
                    {
                        timingReadCompletedTicks = Stopwatch.GetTimestamp();
                        decisionStartedTicks = timingReadCompletedTicks;
                    }

                    long nowTicks = Stopwatch.GetTimestamp();
                    DwmSynchronizedRuntimeScheduleDecision decision =
                        DwmSynchronizedRuntimeScheduler.EvaluateOneShotDwmTiming(
                            nowTicks,
                            Stopwatch.Frequency,
                            lastDwmVBlankTicks,
                            refreshPeriodTicks,
                            lastRequestedVBlankTicks,
                            DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                            DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds);

                    if (telemetryEnabled)
                    {
                        decisionCompletedTicks = Stopwatch.GetTimestamp();
                        targetVBlankTicks = decision.TargetVBlankTicks;
                        runtimeRefreshPeriodTicks = refreshPeriodTicks;
                        if (decision.TargetVBlankTicks > 0)
                        {
                            plannedWakeTicks = decision.TargetVBlankTicks - MillisecondsToTicks(DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds);
                        }
                    }

                    if (!decision.ShouldTick && decision.WaitUntilTicks > 0)
                    {
                        if (telemetryEnabled)
                        {
                            waitStartedTicks = Stopwatch.GetTimestamp();
                        }

                        if (!WaitUntilWithMessagePump(waitTimer, decision.WaitUntilTicks, DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds))
                        {
                            return;
                        }

                        if (telemetryEnabled)
                        {
                            waitCompletedTicks = Stopwatch.GetTimestamp();
                        }
                    }
                    else
                    {
                        _lastWaitReturnReason = ProductWaitReturnReason.AlreadyDue;
                    }

                    if (_stopping)
                    {
                        return;
                    }

                    lastRequestedVBlankTicks = decision.TargetVBlankTicks;
                    if (telemetryEnabled)
                    {
                        tickStartedTicks = Stopwatch.GetTimestamp();
                    }

                    controller.Tick(decision.TargetVBlankTicks, refreshPeriodTicks);
                    if (telemetryEnabled)
                    {
                        tickCompletedTicks = Stopwatch.GetTimestamp();
                        RecordSchedulerTelemetry(
                            recorder,
                            loopIteration,
                            loopStartedTicks,
                            timingReadStartedTicks,
                            timingReadCompletedTicks,
                            decisionStartedTicks,
                            decisionCompletedTicks,
                            waitStartedTicks,
                            waitCompletedTicks,
                            tickStartedTicks,
                            tickCompletedTicks,
                            targetVBlankTicks,
                            plannedWakeTicks,
                            runtimeRefreshPeriodTicks,
                            messageCountBeforeTick,
                            messageDurationBeforeTick,
                            maxMessageDispatchBeforeTick);
                    }
                }
                else
                {
                    if (telemetryEnabled)
                    {
                        timingReadCompletedTicks = Stopwatch.GetTimestamp();
                        tickStartedTicks = timingReadCompletedTicks;
                    }

                    controller.Tick();
                    if (telemetryEnabled)
                    {
                        tickCompletedTicks = Stopwatch.GetTimestamp();
                        waitStartedTicks = tickCompletedTicks;
                    }

                    if (!WaitForMillisecondsWithMessagePump(waitTimer, DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds))
                    {
                        return;
                    }

                    if (telemetryEnabled)
                    {
                        waitCompletedTicks = Stopwatch.GetTimestamp();
                        RecordSchedulerTelemetry(
                            recorder,
                            loopIteration,
                            loopStartedTicks,
                            timingReadStartedTicks,
                            timingReadCompletedTicks,
                            0,
                            0,
                            waitStartedTicks,
                            waitCompletedTicks,
                            tickStartedTicks,
                            tickCompletedTicks,
                            0,
                            0,
                            0,
                            messageCountBeforeTick,
                            messageDurationBeforeTick,
                            maxMessageDispatchBeforeTick);
                    }
                }
            }
        }

        private bool WaitUntilWithMessagePump(HighResolutionWaitTimer waitTimer, long targetTicks, int fallbackMilliseconds)
        {
            _lastWaitReturnReason = ProductWaitReturnReason.None;
            while (!_stopping)
            {
                if (!ProcessPendingMessages())
                {
                    return false;
                }

                long nowTicks = Stopwatch.GetTimestamp();
                if (targetTicks <= nowTicks)
                {
                    _lastWaitReturnReason = ProductWaitReturnReason.AlreadyDue;
                    return true;
                }

                long fineWaitTicks = MicrosecondsToTicks(DwmSynchronizedRuntimeScheduler.FineWaitAdvanceMicroseconds);
                long coarseTargetTicks = targetTicks - fineWaitTicks;
                if (coarseTargetTicks <= nowTicks)
                {
                    FineWaitUntil(targetTicks);
                    if (_lastWaitReturnReason == ProductWaitReturnReason.None)
                    {
                        _lastWaitReturnReason = ProductWaitReturnReason.Timer;
                    }

                    return !_stopping;
                }

                long coarseTicks = coarseTargetTicks - nowTicks;
                if (!WaitForTicksOrMessage(waitTimer, coarseTicks, fallbackMilliseconds))
                {
                    return false;
                }
            }

            return false;
        }

        private bool WaitForMillisecondsWithMessagePump(HighResolutionWaitTimer waitTimer, int milliseconds)
        {
            return WaitForTicksOrMessage(waitTimer, MillisecondsToTicks(Math.Max(1, milliseconds)), Math.Max(1, milliseconds));
        }

        private bool WaitForTicksOrMessage(HighResolutionWaitTimer waitTimer, long ticks, int fallbackMilliseconds)
        {
            if (ticks <= 0)
            {
                _lastWaitReturnReason = ProductWaitReturnReason.AlreadyDue;
                return ProcessPendingMessages();
            }

            if (waitTimer != null && waitTimer.SetTicks(ticks, Stopwatch.Frequency))
            {
                IntPtr[] handles = new[] { waitTimer.Handle };
                while (!_stopping)
                {
                    uint result = MsgWaitForMultipleObjectsExNative(1, handles, WaitInfinite, QsAllInput, MwmoInputAvailable);
                    if (result == WaitObject0)
                    {
                        _lastWaitReturnReason = ProductWaitReturnReason.Timer;
                        return true;
                    }

                    if (result == WaitObject0 + 1)
                    {
                        _lastWaitMessageWakeCount++;
                        _lastWaitReturnReason = ProductWaitReturnReason.Message;
                        if (!ProcessPendingMessages())
                        {
                            return false;
                        }

                        continue;
                    }

                    if (result == WaitFailed)
                    {
                        _lastWaitReturnReason = ProductWaitReturnReason.Failed;
                        return WaitForTicksWithMessageTimeout(ticks, fallbackMilliseconds);
                    }
                }

                return false;
            }

            return WaitForTicksWithMessageTimeout(ticks, fallbackMilliseconds);
        }

        private bool WaitForTicksWithMessageTimeout(long ticks, int fallbackMilliseconds)
        {
            int milliseconds = TicksToTimeoutMilliseconds(ticks, fallbackMilliseconds);
            uint result = MsgWaitForMultipleObjectsExNative(0, null, (uint)milliseconds, QsAllInput, MwmoInputAvailable);
            if (result == WaitObject0)
            {
                _lastWaitMessageWakeCount++;
                _lastWaitReturnReason = ProductWaitReturnReason.Message;
                return ProcessPendingMessages();
            }

            if (result == WaitFailed)
            {
                _lastWaitReturnReason = ProductWaitReturnReason.FallbackSleep;
                Thread.Sleep(milliseconds);
            }
            else
            {
                _lastWaitReturnReason = ProductWaitReturnReason.Timeout;
            }

            return true;
        }

        private bool ProcessPendingMessages()
        {
            int count = 0;
            long durationTicks = 0;
            long maxDispatchTicks = 0;
            long startedTicks = ProductRuntimeOutlierRecorder.Current.IsEnabled ? Stopwatch.GetTimestamp() : 0;
            NativeMessage message;
            while (PeekMessageNative(out message, IntPtr.Zero, 0, 0, PmRemove))
            {
                if (message.Message == WmQuit)
                {
                    _stopping = true;
                    return false;
                }

                long dispatchStartedTicks = ProductRuntimeOutlierRecorder.Current.IsEnabled ? Stopwatch.GetTimestamp() : 0;
                TranslateMessageNative(ref message);
                DispatchMessageNative(ref message);
                if (ProductRuntimeOutlierRecorder.Current.IsEnabled)
                {
                    long dispatchTicks = Stopwatch.GetTimestamp() - dispatchStartedTicks;
                    if (dispatchTicks > maxDispatchTicks)
                    {
                        maxDispatchTicks = dispatchTicks;
                    }
                }

                count++;

                if (_stopping)
                {
                    return false;
                }
            }

            if (ProductRuntimeOutlierRecorder.Current.IsEnabled)
            {
                durationTicks = Stopwatch.GetTimestamp() - startedTicks;
                _lastProcessedMessageCount = count;
                _lastProcessedMessageDurationTicks = durationTicks;
                _lastMaxMessageDispatchTicks = maxDispatchTicks;
            }

            return true;
        }

        private void FineWaitUntil(long targetTicks)
        {
            long yieldThresholdTicks = MicrosecondsToTicks(DwmSynchronizedRuntimeScheduler.FineWaitYieldThresholdMicroseconds);
            while (!_stopping)
            {
                long remainingTicks = targetTicks - Stopwatch.GetTimestamp();
                if (remainingTicks <= 0)
                {
                    return;
                }

                if (remainingTicks > yieldThresholdTicks)
                {
                    _lastFineSleepZeroCount++;
                    Thread.Sleep(0);
                }
                else
                {
                    _lastFineSpinCount++;
                    Thread.SpinWait(FineWaitSpinIterations);
                }
            }
        }

        private void ResetWaitTelemetry()
        {
            _lastWaitMessageWakeCount = 0;
            _lastWaitReturnReason = ProductWaitReturnReason.None;
            _lastFineSleepZeroCount = 0;
            _lastFineSpinCount = 0;
        }

        private void RecordSchedulerTelemetry(
            ProductRuntimeOutlierRecorder recorder,
            long loopIteration,
            long loopStartedTicks,
            long timingReadStartedTicks,
            long timingReadCompletedTicks,
            long decisionStartedTicks,
            long decisionCompletedTicks,
            long waitStartedTicks,
            long waitCompletedTicks,
            long tickStartedTicks,
            long tickCompletedTicks,
            long targetVBlankTicks,
            long plannedWakeTicks,
            long refreshPeriodTicks,
            int processedMessageCount,
            long processedMessageDurationTicks,
            long maxMessageDispatchTicks)
        {
            long mouseMoveEventsReceived = Interlocked.Exchange(ref _mouseMoveEventsReceivedSinceLastTick, 0);
            long mouseMoveEventsCoalesced = Interlocked.Exchange(ref _mouseMoveEventsCoalescedSinceLastTick, 0);
            long mouseMovePostsQueued = Interlocked.Exchange(ref _mouseMovePostsQueuedSinceLastTick, 0);
            long mouseMoveCallbacksProcessed = Interlocked.Exchange(ref _mouseMoveCallbacksProcessedSinceLastTick, 0);
            long latestMouseMoveReceivedTicks = Volatile.Read(ref _latestMouseMoveReceivedTicks);
            ProductRuntimeOutlierEvent runtimeEvent = new ProductRuntimeOutlierEvent();
            runtimeEvent.EventKind = (int)ProductRuntimeOutlierEventKind.SchedulerTick;
            runtimeEvent.StopwatchTicks = tickCompletedTicks > 0 ? tickCompletedTicks : Stopwatch.GetTimestamp();
            runtimeEvent.LoopIteration = loopIteration;
            runtimeEvent.TargetVBlankTicks = targetVBlankTicks;
            runtimeEvent.PlannedWakeTicks = plannedWakeTicks;
            runtimeEvent.RefreshPeriodTicks = refreshPeriodTicks;
            runtimeEvent.DwmReadDurationTicks = timingReadCompletedTicks > timingReadStartedTicks ? timingReadCompletedTicks - timingReadStartedTicks : 0;
            runtimeEvent.DecisionDurationTicks = decisionCompletedTicks > decisionStartedTicks ? decisionCompletedTicks - decisionStartedTicks : 0;
            runtimeEvent.WaitDurationTicks = waitCompletedTicks > waitStartedTicks ? waitCompletedTicks - waitStartedTicks : 0;
            runtimeEvent.TickDurationTicks = tickCompletedTicks > tickStartedTicks ? tickCompletedTicks - tickStartedTicks : 0;
            runtimeEvent.ProcessedMessageCountBeforeTick = processedMessageCount;
            runtimeEvent.ProcessedMessageDurationTicksBeforeTick = processedMessageDurationTicks;
            runtimeEvent.MaxMessageDispatchTicksBeforeTick = maxMessageDispatchTicks;
            runtimeEvent.MessageWakeCount = _lastWaitMessageWakeCount;
            runtimeEvent.WaitReturnReason = (int)_lastWaitReturnReason;
            runtimeEvent.FineSleepZeroCount = _lastFineSleepZeroCount;
            runtimeEvent.FineSpinCount = _lastFineSpinCount;
            runtimeEvent.TotalTicks = runtimeEvent.StopwatchTicks - loopStartedTicks;
            runtimeEvent.MouseMoveEventsReceived = mouseMoveEventsReceived;
            runtimeEvent.MouseMoveEventsCoalesced = mouseMoveEventsCoalesced;
            runtimeEvent.MouseMovePostsQueued = mouseMovePostsQueued;
            runtimeEvent.MouseMoveCallbacksProcessed = mouseMoveCallbacksProcessed;

            if (plannedWakeTicks > 0 && tickStartedTicks > 0)
            {
                runtimeEvent.WakeLateMicroseconds = ProductRuntimeOutlierRecorder.TicksToMicroseconds(tickStartedTicks - plannedWakeTicks);
            }

            if (targetVBlankTicks > 0 && tickStartedTicks > 0)
            {
                runtimeEvent.VBlankLeadMicroseconds = ProductRuntimeOutlierRecorder.TicksToMicroseconds(targetVBlankTicks - tickStartedTicks);
            }

            if (latestMouseMoveReceivedTicks > 0 && tickStartedTicks > 0)
            {
                runtimeEvent.LatestMouseMoveAgeMicroseconds = ProductRuntimeOutlierRecorder.TicksToMicroseconds(tickStartedTicks - latestMouseMoveReceivedTicks);
            }

            recorder.Record(ref runtimeEvent);
        }

        private static long MillisecondsToTicks(int milliseconds)
        {
            if (milliseconds <= 0)
            {
                return 0;
            }

            double ticks = milliseconds * (double)Stopwatch.Frequency / 1000.0;
            if (ticks >= long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)Math.Round(ticks);
        }

        private static long MicrosecondsToTicks(int microseconds)
        {
            if (microseconds <= 0)
            {
                return 0;
            }

            double ticks = microseconds * (double)Stopwatch.Frequency / 1000000.0;
            if (ticks >= long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)Math.Round(ticks);
        }

        private static int TicksToTimeoutMilliseconds(long ticks, int fallbackMilliseconds)
        {
            if (ticks <= 0)
            {
                return 0;
            }

            int milliseconds = (int)Math.Ceiling(ticks * 1000.0 / Stopwatch.Frequency);
            if (milliseconds < 1)
            {
                milliseconds = 1;
            }

            return Math.Min(milliseconds, Math.Max(1, fallbackMilliseconds));
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(GetType().Name);
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeMessage
        {
            public IntPtr WindowHandle;
            public int Message;
            public IntPtr WParam;
            public IntPtr LParam;
            public uint Time;
            public NativePoint Point;
        }
    }
}
