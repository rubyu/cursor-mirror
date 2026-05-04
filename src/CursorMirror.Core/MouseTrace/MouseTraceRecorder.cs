using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Threading;

namespace CursorMirror.MouseTrace
{
    public sealed class MouseTraceRecorder : IDisposable
    {
        public const int ProductPollIntervalMilliseconds = 8;
        public const int ReferencePollIntervalMilliseconds = 2;
        public const int TimerResolutionMilliseconds = 1;

        private readonly MouseTraceSession _session = new MouseTraceSession();
        private readonly ITraceNativeMethods _traceNativeMethods;
        private LowLevelMouseHook _mouseHook;
        private Thread _productPollThread;
        private Thread _referencePollThread;
        private Thread _runtimeSchedulerPollThread;
        private StaMessageLoopDispatcher _runtimeSchedulerCaptureDispatcher;
        private HighResolutionWaitTimer _runtimeSchedulerWaitTimer;
        private volatile bool _productPollActive;
        private volatile bool _referencePollActive;
        private volatile bool _runtimeSchedulerPollActive;
        private long _lastRuntimeSchedulerVBlankTicks;
        private long _runtimeSchedulerLoopIteration;
        private int _runtimeSchedulerPollPending;
        private bool _timerResolutionActive;
        private bool _disposed;

        public MouseTraceRecorder()
            : this(new TraceNativeMethods())
        {
        }

        public MouseTraceRecorder(ITraceNativeMethods traceNativeMethods)
        {
            if (traceNativeMethods == null)
            {
                throw new ArgumentNullException("traceNativeMethods");
            }

            _traceNativeMethods = traceNativeMethods;
        }

        public MouseTraceState State
        {
            get { return _session.State; }
        }

        public long ElapsedMicroseconds
        {
            get { return _session.ElapsedMicroseconds; }
        }

        public void Start()
        {
            ThrowIfDisposed();
            StopInfrastructure();

            bool timerResolutionSucceeded = BeginTimerResolution();
            _session.Start(
                Stopwatch.GetTimestamp(),
                ProductPollIntervalMilliseconds,
                ReferencePollIntervalMilliseconds,
                TimerResolutionMilliseconds,
                timerResolutionSucceeded,
                DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds,
                DwmSynchronizedRuntimeScheduler.MaximumDwmSleepMilliseconds);

            _mouseHook = new LowLevelMouseHook(HandleMouseEvent);
            try
            {
                _mouseHook.SetHook();
                StartProductPoller();
                StartReferencePoller();
                StartRuntimeSchedulerPoller();
            }
            catch
            {
                StopInfrastructure();
                _session.Stop(Stopwatch.GetTimestamp());
                EndTimerResolution();
                throw;
            }
        }

        public MouseTraceSnapshot Stop()
        {
            StopInfrastructure();
            _session.Stop(Stopwatch.GetTimestamp());
            EndTimerResolution();
            return _session.Snapshot();
        }

        public MouseTraceSnapshot Snapshot()
        {
            return _session.Snapshot();
        }

        public MouseTraceSampleCounts GetSampleCounts()
        {
            return _session.GetSampleCounts();
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                Stop();
                _disposed = true;
            }
        }

        private HookResult HandleMouseEvent(LowLevelMouseHook.MouseEvent mouseEvent, LowLevelMouseHook.MSLLHOOKSTRUCT data)
        {
            if (mouseEvent == LowLevelMouseHook.MouseEvent.WM_MOUSEMOVE)
            {
                Point? cursorPoint = TryGetCursorPoint();
                _session.AddHookMove(
                    Stopwatch.GetTimestamp(),
                    new Point(data.pt.x, data.pt.y),
                    data.mouseData,
                    data.flags,
                    data.time,
                    data.dwExtraInfo,
                    cursorPoint);
            }

            return HookResult.Transfer;
        }

        private void StartProductPoller()
        {
            StopProductPoller();
            _productPollActive = true;
            CapturePollSample(Stopwatch.GetTimestamp());
            _productPollThread = new Thread(ProductPollLoop);
            _productPollThread.Name = "CursorMirrorTraceProductPoller";
            _productPollThread.IsBackground = true;
            _productPollThread.Start();
        }

        private void StopProductPoller()
        {
            Thread thread = _productPollThread;
            if (thread == null)
            {
                return;
            }

            _productPollActive = false;
            if (thread.IsAlive)
            {
                thread.Join(250);
            }

            _productPollThread = null;
        }

        private void ProductPollLoop()
        {
            long intervalTicks = Math.Max(1, (long)Math.Round((ProductPollIntervalMilliseconds * Stopwatch.Frequency) / 1000.0));
            long nextTicks = Stopwatch.GetTimestamp() + intervalTicks;

            while (_productPollActive)
            {
                long now = Stopwatch.GetTimestamp();
                if (now >= nextTicks)
                {
                    CapturePollSample(now);
                    nextTicks += intervalTicks;
                    if (now - nextTicks > intervalTicks * 4)
                    {
                        nextTicks = now + intervalTicks;
                    }

                    continue;
                }

                SleepUntilNextTick(nextTicks - now);
            }
        }

        private void CapturePollSample(long stopwatchTicks)
        {
            Point? cursorPoint = TryGetCursorPoint();
            if (!cursorPoint.HasValue)
            {
                return;
            }

            DwmTimingInfo timing;
            bool hasTiming = _traceNativeMethods.TryGetDwmTimingInfo(out timing);
            _session.AddPoll(stopwatchTicks, cursorPoint.Value, hasTiming, timing);
        }

        private void StartReferencePoller()
        {
            StopReferencePoller();
            _referencePollActive = true;
            CaptureReferencePollSample(Stopwatch.GetTimestamp());
            _referencePollThread = new Thread(ReferencePollLoop);
            _referencePollThread.Name = "CursorMirrorTraceReferencePoller";
            _referencePollThread.IsBackground = true;
            _referencePollThread.Start();
        }

        private void StopReferencePoller()
        {
            Thread thread = _referencePollThread;
            if (thread == null)
            {
                return;
            }

            _referencePollActive = false;
            if (thread.IsAlive)
            {
                thread.Join(250);
            }

            _referencePollThread = null;
        }

        private void ReferencePollLoop()
        {
            long intervalTicks = Math.Max(1, (long)Math.Round((ReferencePollIntervalMilliseconds * Stopwatch.Frequency) / 1000.0));
            long nextTicks = Stopwatch.GetTimestamp() + intervalTicks;

            while (_referencePollActive)
            {
                long now = Stopwatch.GetTimestamp();
                if (now >= nextTicks)
                {
                    CaptureReferencePollSample(now);
                    nextTicks += intervalTicks;
                    if (now - nextTicks > intervalTicks * 4)
                    {
                        nextTicks = now + intervalTicks;
                    }

                    continue;
                }

                SleepUntilNextTick(nextTicks - now);
            }
        }

        private void CaptureReferencePollSample(long stopwatchTicks)
        {
            Point? cursorPoint = TryGetCursorPoint();
            if (!cursorPoint.HasValue)
            {
                return;
            }

            _session.AddReferencePoll(stopwatchTicks, cursorPoint.Value);
        }

        private void StartRuntimeSchedulerPoller()
        {
            StopRuntimeSchedulerPoller();
            _lastRuntimeSchedulerVBlankTicks = 0;
            _runtimeSchedulerLoopIteration = 0;
            Interlocked.Exchange(ref _runtimeSchedulerPollPending, 0);
            _runtimeSchedulerCaptureDispatcher = new StaMessageLoopDispatcher("CursorMirrorTraceRuntimeSchedulerCapture");
            _runtimeSchedulerCaptureDispatcher.Start();
            _session.SetRuntimeSchedulerCaptureThreadProfile(_runtimeSchedulerCaptureDispatcher.LatencyProfileSummary);
            _runtimeSchedulerWaitTimer = HighResolutionWaitTimer.CreateBestEffort();
            _runtimeSchedulerPollActive = true;
            _session.SetRuntimeSchedulerThreadProfile(ThreadLatencyProfile.UnavailableSummary);
            _runtimeSchedulerPollThread = new Thread(RuntimeSchedulerPollLoop);
            _runtimeSchedulerPollThread.Name = "CursorMirrorTraceRuntimeSchedulerPoller";
            _runtimeSchedulerPollThread.IsBackground = true;
            _runtimeSchedulerPollThread.Priority = ThreadPriority.AboveNormal;
            _runtimeSchedulerPollThread.Start();
        }

        private void StopRuntimeSchedulerPoller()
        {
            Thread thread = _runtimeSchedulerPollThread;
            _runtimeSchedulerPollActive = false;
            if (thread != null && thread.IsAlive)
            {
                thread.Join(250);
            }

            Interlocked.Exchange(ref _runtimeSchedulerPollPending, 0);
            _runtimeSchedulerPollThread = null;
            if (_runtimeSchedulerCaptureDispatcher != null)
            {
                _runtimeSchedulerCaptureDispatcher.Dispose();
                _runtimeSchedulerCaptureDispatcher = null;
            }

            if (_runtimeSchedulerWaitTimer != null)
            {
                _runtimeSchedulerWaitTimer.Dispose();
                _runtimeSchedulerWaitTimer = null;
            }
        }

        private void RuntimeSchedulerPollLoop()
        {
            while (_runtimeSchedulerPollActive)
            {
                long loopStartedTicks = Stopwatch.GetTimestamp();
                long loopIteration = Interlocked.Increment(ref _runtimeSchedulerLoopIteration);
                long timingReadStartedTicks = loopStartedTicks;
                DwmTimingInfo timing;
                bool hasTiming = _traceNativeMethods.TryGetDwmTimingInfo(out timing);
                long timingReadCompletedTicks = Stopwatch.GetTimestamp();
                bool schedulerTimingUsable = false;
                long? targetVBlankTicks = null;
                long? plannedTickTicks = null;
                long? vBlankLeadMicroseconds = null;
                bool tickRequested = false;
                int sleepMilliseconds = DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds;
                long waitTargetTicks = 0;
                long decisionCompletedTicks;
                long sleepStartedTicks;
                long sleepCompletedTicks;
                string waitMethod;

                if (hasTiming)
                {
                    DwmSynchronizedRuntimeScheduleDecision decision =
                        DwmSynchronizedRuntimeScheduler.EvaluateOneShotDwmTiming(
                            timingReadCompletedTicks,
                            Stopwatch.Frequency,
                            ToSignedTicks(timing.QpcVBlank),
                            ToSignedTicks(timing.QpcRefreshPeriod),
                            _lastRuntimeSchedulerVBlankTicks,
                            DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                            DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds);
                    decisionCompletedTicks = Stopwatch.GetTimestamp();
                    schedulerTimingUsable = decision.IsDwmTimingUsable;
                    if (decision.IsDwmTimingUsable && decision.TargetVBlankTicks > 0)
                    {
                        targetVBlankTicks = decision.TargetVBlankTicks;
                        plannedTickTicks = decision.TargetVBlankTicks - MillisecondsToTicks(DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds);
                        sleepMilliseconds = Math.Max(1, decision.DelayMilliseconds);
                        waitTargetTicks = decision.WaitUntilTicks;
                        sleepStartedTicks = Stopwatch.GetTimestamp();
                        waitMethod = decision.ShouldTick
                            ? "none"
                            : SleepRuntimeSchedulerLoop(DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds, waitTargetTicks);
                        sleepCompletedTicks = Stopwatch.GetTimestamp();
                        vBlankLeadMicroseconds = MouseTraceSession.TicksToMicroseconds(decision.TargetVBlankTicks - sleepCompletedTicks);
                        if (_runtimeSchedulerPollActive)
                        {
                            _lastRuntimeSchedulerVBlankTicks = decision.TargetVBlankTicks;
                            QueueRuntimeSchedulerPollSample(true, timing, decision.TargetVBlankTicks);
                            tickRequested = true;
                        }
                    }
                    else
                    {
                        sleepStartedTicks = Stopwatch.GetTimestamp();
                        waitTargetTicks = DwmSynchronizedRuntimeScheduler.CalculateCurrentWaitTargetTicks(
                            sleepStartedTicks,
                            sleepMilliseconds,
                            0,
                            Stopwatch.Frequency);
                        waitMethod = SleepRuntimeSchedulerLoop(sleepMilliseconds, waitTargetTicks);
                        sleepCompletedTicks = Stopwatch.GetTimestamp();
                    }
                }
                else
                {
                    decisionCompletedTicks = Stopwatch.GetTimestamp();
                    QueueRuntimeSchedulerPollSample(false, timing, null);
                    tickRequested = true;
                    sleepStartedTicks = Stopwatch.GetTimestamp();
                    waitTargetTicks = DwmSynchronizedRuntimeScheduler.CalculateCurrentWaitTargetTicks(
                        sleepStartedTicks,
                        sleepMilliseconds,
                        0,
                        Stopwatch.Frequency);
                    waitMethod = SleepRuntimeSchedulerLoop(sleepMilliseconds, waitTargetTicks);
                    sleepCompletedTicks = Stopwatch.GetTimestamp();
                }

                _session.AddRuntimeSchedulerLoop(
                    loopStartedTicks,
                    hasTiming,
                    timing,
                    schedulerTimingUsable,
                    targetVBlankTicks,
                    plannedTickTicks,
                    vBlankLeadMicroseconds,
                    loopIteration,
                    loopStartedTicks,
                    timingReadStartedTicks,
                    timingReadCompletedTicks,
                    decisionCompletedTicks,
                    tickRequested,
                    sleepMilliseconds,
                    waitMethod,
                    waitTargetTicks,
                    sleepStartedTicks,
                    sleepCompletedTicks);
            }
        }

        private void QueueRuntimeSchedulerPollSample(bool dwmTimingAvailable, DwmTimingInfo timing, long? targetVBlankTicks)
        {
            if (!_runtimeSchedulerPollActive)
            {
                return;
            }

            if (Interlocked.Exchange(ref _runtimeSchedulerPollPending, 1) != 0)
            {
                _session.AddRuntimeSchedulerCoalescedTick();
                return;
            }

            long queuedTickTicks = Stopwatch.GetTimestamp();
            long? plannedTickTicks = null;
            if (targetVBlankTicks.HasValue)
            {
                plannedTickTicks = targetVBlankTicks.Value - MillisecondsToTicks(DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds);
            }

            try
            {
                StaMessageLoopDispatcher dispatcher = _runtimeSchedulerCaptureDispatcher;
                if (dispatcher == null)
                {
                    Interlocked.Exchange(ref _runtimeSchedulerPollPending, 0);
                    return;
                }

                dispatcher.BeginInvoke(new Action(delegate
                {
                    long dispatchStartedTicks = Stopwatch.GetTimestamp();
                    Interlocked.Exchange(ref _runtimeSchedulerPollPending, 0);
                    CaptureRuntimeSchedulerPollSample(dwmTimingAvailable, timing, targetVBlankTicks, plannedTickTicks, queuedTickTicks, dispatchStartedTicks);
                }));
            }
            catch (ObjectDisposedException)
            {
                Interlocked.Exchange(ref _runtimeSchedulerPollPending, 0);
            }
            catch (InvalidOperationException)
            {
                Interlocked.Exchange(ref _runtimeSchedulerPollPending, 0);
            }
        }

        private void CaptureRuntimeSchedulerPollSample(
            bool dwmTimingAvailable,
            DwmTimingInfo timing,
            long? targetVBlankTicks,
            long? plannedTickTicks,
            long queuedTickTicks,
            long dispatchStartedTicks)
        {
            if (!_runtimeSchedulerPollActive)
            {
                return;
            }

            NativePoint point;
            long cursorReadStartedTicks = Stopwatch.GetTimestamp();
            if (!_traceNativeMethods.GetCursorPos(out point))
            {
                return;
            }

            long cursorReadCompletedTicks = Stopwatch.GetTimestamp();
            long actualTickTicks = dispatchStartedTicks;
            long? vBlankLeadMicroseconds = null;
            if (targetVBlankTicks.HasValue)
            {
                vBlankLeadMicroseconds = MouseTraceSession.TicksToMicroseconds(targetVBlankTicks.Value - actualTickTicks);
            }

            long sampleRecordedTicks = Stopwatch.GetTimestamp();
            _session.AddRuntimeSchedulerPoll(
                cursorReadCompletedTicks,
                new Point(point.x, point.y),
                dwmTimingAvailable,
                timing,
                targetVBlankTicks.HasValue,
                targetVBlankTicks,
                plannedTickTicks,
                actualTickTicks,
                vBlankLeadMicroseconds,
                queuedTickTicks,
                dispatchStartedTicks,
                cursorReadStartedTicks,
                cursorReadCompletedTicks,
                sampleRecordedTicks);
        }

        private string SleepRuntimeSchedulerLoop(int milliseconds, long waitTargetTicks)
        {
            if (!_runtimeSchedulerPollActive)
            {
                return "none";
            }

            int normalizedMilliseconds = Math.Max(1, milliseconds);
            if (waitTargetTicks > 0)
            {
                return WaitRuntimeSchedulerLoopUntil(waitTargetTicks, normalizedMilliseconds);
            }

            HighResolutionWaitTimer waitTimer = _runtimeSchedulerWaitTimer;
            if (waitTimer != null && waitTimer.Wait(normalizedMilliseconds))
            {
                return waitTimer.WaitMethod;
            }

            Thread.Sleep(normalizedMilliseconds);
            return "threadSleep";
        }

        private string WaitRuntimeSchedulerLoopUntil(long targetTicks, int fallbackMilliseconds)
        {
            long nowTicks = Stopwatch.GetTimestamp();
            if (targetTicks <= nowTicks)
            {
                return "none";
            }

            long fineWaitTicks = MicrosecondsToTicks(DwmSynchronizedRuntimeScheduler.FineWaitAdvanceMicroseconds);
            long coarseTargetTicks = targetTicks - fineWaitTicks;
            string waitMethod = "fineWait";
            if (coarseTargetTicks > nowTicks)
            {
                long coarseTicks = coarseTargetTicks - nowTicks;
                HighResolutionWaitTimer waitTimer = _runtimeSchedulerWaitTimer;
                if (waitTimer != null && waitTimer.WaitTicks(coarseTicks, Stopwatch.Frequency))
                {
                    waitMethod = waitTimer.WaitMethod + "+fineWait";
                }
                else
                {
                    SleepRuntimeSchedulerLoopForTicks(coarseTicks, fallbackMilliseconds);
                    waitMethod = "threadSleep+fineWait";
                }
            }

            FineWaitRuntimeSchedulerLoopUntil(targetTicks);
            return waitMethod;
        }

        private Point? TryGetCursorPoint()
        {
            NativePoint point;
            if (!_traceNativeMethods.GetCursorPos(out point))
            {
                return null;
            }

            return new Point(point.x, point.y);
        }

        private void StopInfrastructure()
        {
            StopHook();
            StopProductPoller();
            StopReferencePoller();
            StopRuntimeSchedulerPoller();
        }

        private void StopHook()
        {
            if (_mouseHook == null)
            {
                return;
            }

            try
            {
                if (_mouseHook.IsActivated)
                {
                    _mouseHook.Unhook();
                }
            }
            catch (Win32Exception)
            {
            }
            finally
            {
                _mouseHook.Dispose();
                _mouseHook = null;
            }
        }

        private bool BeginTimerResolution()
        {
            EndTimerResolution();
            _timerResolutionActive = _traceNativeMethods.TryBeginTimerResolution(TimerResolutionMilliseconds);
            return _timerResolutionActive;
        }

        private void EndTimerResolution()
        {
            if (!_timerResolutionActive)
            {
                return;
            }

            _traceNativeMethods.EndTimerResolution(TimerResolutionMilliseconds);
            _timerResolutionActive = false;
        }

        private static void SleepUntilNextTick(long remainingTicks)
        {
            int sleepMilliseconds = (int)((remainingTicks * 1000) / Stopwatch.Frequency);
            if (sleepMilliseconds > 1)
            {
                Thread.Sleep(Math.Min(sleepMilliseconds, 2));
            }
            else
            {
                Thread.Sleep(0);
            }
        }

        private static void SleepRuntimeSchedulerLoopForTicks(long ticks, int fallbackMilliseconds)
        {
            if (ticks <= 0)
            {
                return;
            }

            int milliseconds = (int)Math.Floor(ticks * 1000.0 / Stopwatch.Frequency);
            if (milliseconds <= 0)
            {
                Thread.Sleep(0);
                return;
            }

            Thread.Sleep(Math.Min(milliseconds, Math.Max(1, fallbackMilliseconds)));
        }

        private static void FineWaitRuntimeSchedulerLoopUntil(long targetTicks)
        {
            long yieldThresholdTicks = MicrosecondsToTicks(DwmSynchronizedRuntimeScheduler.FineWaitYieldThresholdMicroseconds);
            while (true)
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
                    Thread.SpinWait(64);
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

        private static long ToSignedTicks(ulong value)
        {
            if (value > long.MaxValue)
            {
                return long.MaxValue;
            }

            return (long)value;
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
