using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

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
        private Thread _thread;
        private OverlayWindow _overlayWindow;
        private CursorMirrorController _controller;
        private Exception _startupException;
        private bool _started;
        private bool _disposed;
        private bool _timerResolutionActive;
        private volatile bool _stopping;

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
                Post(delegate
                {
                    CursorMirrorController controller = GetController();
                    if (controller != null)
                    {
                        controller.HandleMouseEvent(mouseEvent, data);
                    }
                });
            }

            return HookResult.Transfer;
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

            while (!_stopping)
            {
                if (!ProcessPendingMessages())
                {
                    return;
                }

                long lastDwmVBlankTicks;
                long refreshPeriodTicks;
                if (DwmSynchronizedRuntimeScheduler.TryGetDwmTiming(out lastDwmVBlankTicks, out refreshPeriodTicks))
                {
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

                    if (!decision.ShouldTick && decision.WaitUntilTicks > 0)
                    {
                        if (!WaitUntilWithMessagePump(waitTimer, decision.WaitUntilTicks, DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds))
                        {
                            return;
                        }
                    }

                    if (_stopping)
                    {
                        return;
                    }

                    lastRequestedVBlankTicks = decision.TargetVBlankTicks;
                    controller.Tick(decision.TargetVBlankTicks, refreshPeriodTicks);
                }
                else
                {
                    controller.Tick();
                    if (!WaitForMillisecondsWithMessagePump(waitTimer, DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds))
                    {
                        return;
                    }
                }
            }
        }

        private bool WaitUntilWithMessagePump(HighResolutionWaitTimer waitTimer, long targetTicks, int fallbackMilliseconds)
        {
            while (!_stopping)
            {
                if (!ProcessPendingMessages())
                {
                    return false;
                }

                long nowTicks = Stopwatch.GetTimestamp();
                if (targetTicks <= nowTicks)
                {
                    return true;
                }

                long fineWaitTicks = MicrosecondsToTicks(DwmSynchronizedRuntimeScheduler.FineWaitAdvanceMicroseconds);
                long coarseTargetTicks = targetTicks - fineWaitTicks;
                if (coarseTargetTicks <= nowTicks)
                {
                    FineWaitUntil(targetTicks);
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
                        return true;
                    }

                    if (result == WaitObject0 + 1)
                    {
                        if (!ProcessPendingMessages())
                        {
                            return false;
                        }

                        continue;
                    }

                    if (result == WaitFailed)
                    {
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
                return ProcessPendingMessages();
            }

            if (result == WaitFailed)
            {
                Thread.Sleep(milliseconds);
            }

            return true;
        }

        private bool ProcessPendingMessages()
        {
            NativeMessage message;
            while (PeekMessageNative(out message, IntPtr.Zero, 0, 0, PmRemove))
            {
                if (message.Message == WmQuit)
                {
                    _stopping = true;
                    return false;
                }

                TranslateMessageNative(ref message);
                DispatchMessageNative(ref message);

                if (_stopping)
                {
                    return false;
                }
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
                    Thread.Sleep(0);
                }
                else
                {
                    Thread.SpinWait(FineWaitSpinIterations);
                }
            }
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
