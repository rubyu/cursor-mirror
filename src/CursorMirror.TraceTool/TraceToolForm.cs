using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using CursorMirror.MouseTrace;

namespace CursorMirror.TraceTool
{
    public sealed class TraceToolForm : Form
    {
        private const int ProductPollIntervalMilliseconds = 8;
        private const int ReferencePollIntervalMilliseconds = 2;
        private const int TimerResolutionMilliseconds = 1;

        private readonly MouseTraceSession _session = new MouseTraceSession();
        private readonly MouseTracePackageWriter _writer = new MouseTracePackageWriter();
        private readonly ITraceNativeMethods _traceNativeMethods;
        private readonly Button _startButton;
        private readonly Button _stopButton;
        private readonly Button _saveButton;
        private readonly Button _exitButton;
        private readonly Label _sampleCountValue;
        private readonly Label _hookMoveCountValue;
        private readonly Label _cursorPollCountValue;
        private readonly Label _referencePollCountValue;
        private readonly Label _runtimeSchedulerPollCountValue;
        private readonly Label _runtimeSchedulerLoopCountValue;
        private readonly Label _dwmTimingCountValue;
        private readonly Label _durationValue;
        private readonly Label _statusValue;
        private readonly System.Windows.Forms.Timer _uiTimer;
        private readonly System.Windows.Forms.Timer _pollTimer;
        private LowLevelMouseHook _mouseHook;
        private Thread _referencePollThread;
        private Thread _runtimeSchedulerPollThread;
        private StaMessageLoopDispatcher _runtimeSchedulerCaptureDispatcher;
        private HighResolutionWaitTimer _runtimeSchedulerWaitTimer;
        private volatile bool _referencePollActive;
        private volatile bool _runtimeSchedulerPollActive;
        private long _lastRuntimeSchedulerVBlankTicks;
        private long _runtimeSchedulerLoopIteration;
        private int _runtimeSchedulerPollPending;
        private bool _timerResolutionActive;
        private bool _savedSinceStop;

        public TraceToolForm()
            : this(new TraceNativeMethods())
        {
        }

        public TraceToolForm(ITraceNativeMethods traceNativeMethods)
        {
            if (traceNativeMethods == null)
            {
                throw new ArgumentNullException("traceNativeMethods");
            }

            _traceNativeMethods = traceNativeMethods;

            Text = LocalizedStrings.TraceToolTitle;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 350);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(12);
            layout.ColumnCount = 2;
            layout.RowCount = 10;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 210));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Controls.Add(layout);

            _statusValue = AddValueRow(layout, 0, LocalizedStrings.TraceStatusLabel);
            _sampleCountValue = AddValueRow(layout, 1, LocalizedStrings.TraceTotalSampleCountLabel);
            _hookMoveCountValue = AddValueRow(layout, 2, LocalizedStrings.TraceHookMoveSampleCountLabel);
            _cursorPollCountValue = AddValueRow(layout, 3, LocalizedStrings.TraceCursorPollSampleCountLabel);
            _referencePollCountValue = AddValueRow(layout, 4, LocalizedStrings.TraceReferencePollSampleCountLabel);
            _runtimeSchedulerPollCountValue = AddValueRow(layout, 5, LocalizedStrings.TraceRuntimeSchedulerPollSampleCountLabel);
            _runtimeSchedulerLoopCountValue = AddValueRow(layout, 6, LocalizedStrings.TraceRuntimeSchedulerLoopSampleCountLabel);
            _dwmTimingCountValue = AddValueRow(layout, 7, LocalizedStrings.TraceDwmTimingSampleCountLabel);
            _durationValue = AddValueRow(layout, 8, LocalizedStrings.TraceDurationLabel);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.LeftToRight;
            buttons.WrapContents = false;
            layout.Controls.Add(buttons, 0, 9);
            layout.SetColumnSpan(buttons, 2);

            _startButton = AddButton(buttons, LocalizedStrings.TraceStartRecordingCommand, StartRecording);
            _stopButton = AddButton(buttons, LocalizedStrings.TraceStopRecordingCommand, StopRecording);
            _saveButton = AddButton(buttons, LocalizedStrings.TraceSaveCommand, SaveRecording);
            _exitButton = AddButton(buttons, LocalizedStrings.ExitCommand, ExitApplication);

            _uiTimer = new System.Windows.Forms.Timer();
            _uiTimer.Interval = 100;
            _uiTimer.Tick += delegate { RefreshUi(); };

            _pollTimer = new System.Windows.Forms.Timer();
            _pollTimer.Interval = ProductPollIntervalMilliseconds;
            _pollTimer.Tick += delegate { CapturePollSample(); };

            RefreshUi();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && HasUnsavedSamples())
            {
                DialogResult result = MessageBox.Show(
                    this,
                    LocalizedStrings.TraceUnsavedExitMessage,
                    LocalizedStrings.TraceToolTitle,
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (result != DialogResult.Yes)
                {
                    e.Cancel = true;
                    return;
                }
            }

            StopHook();
            StopReferencePoller();
            StopRuntimeSchedulerPoller();
            EndTimerResolution();
            _uiTimer.Stop();
            _pollTimer.Stop();
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                StopHook();
                StopReferencePoller();
                StopRuntimeSchedulerPoller();
                EndTimerResolution();
                if (_uiTimer != null)
                {
                    _uiTimer.Dispose();
                }

                if (_pollTimer != null)
                {
                    _pollTimer.Dispose();
                }
            }

            base.Dispose(disposing);
        }

        private static Label AddValueRow(TableLayoutPanel layout, int row, string labelText)
        {
            Label label = new Label();
            label.Text = labelText;
            label.AutoSize = true;
            label.Anchor = AnchorStyles.Left;
            layout.Controls.Add(label, 0, row);

            Label value = new Label();
            value.AutoSize = true;
            value.Anchor = AnchorStyles.Left;
            layout.Controls.Add(value, 1, row);
            return value;
        }

        private static Button AddButton(FlowLayoutPanel panel, string text, EventHandler handler)
        {
            Button button = new Button();
            button.Text = text;
            button.AutoSize = true;
            button.Click += handler;
            panel.Controls.Add(button);
            return button;
        }

        private void StartRecording(object sender, EventArgs e)
        {
            if (HasUnsavedSamples())
            {
                DialogResult result = MessageBox.Show(
                    this,
                    LocalizedStrings.TraceDiscardUnsavedMessage,
                    LocalizedStrings.TraceToolTitle,
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (result != DialogResult.Yes)
                {
                    return;
                }
            }

            StopHook();
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
            _savedSinceStop = false;
            _mouseHook = new LowLevelMouseHook(HandleMouseEvent);
            try
            {
                _mouseHook.SetHook();
                StartReferencePoller();
                StartRuntimeSchedulerPoller();
                _pollTimer.Start();
                _uiTimer.Start();
                CapturePollSample();
                RefreshUi();
            }
            catch
            {
                StopReferencePoller();
                StopRuntimeSchedulerPoller();
                _pollTimer.Stop();
                _uiTimer.Stop();
                StopHook();
                _session.Stop(Stopwatch.GetTimestamp());
                EndTimerResolution();
                throw;
            }
        }

        private void StopRecording(object sender, EventArgs e)
        {
            StopRecordingInternal();
            RefreshUi();
        }

        private void StopRecordingInternal()
        {
            StopHook();
            StopReferencePoller();
            StopRuntimeSchedulerPoller();
            _pollTimer.Stop();
            _uiTimer.Stop();
            _session.Stop(Stopwatch.GetTimestamp());
            EndTimerResolution();
        }

        private void SaveRecording(object sender, EventArgs e)
        {
            MouseTraceSnapshot snapshot = _session.Snapshot();
            if (snapshot.Samples.Length == 0)
            {
                return;
            }

            using (SaveFileDialog dialog = new SaveFileDialog())
            {
                dialog.Title = LocalizedStrings.TraceSaveDialogTitle;
                dialog.Filter = LocalizedStrings.TraceSaveDialogFilter;
                dialog.DefaultExt = "zip";
                dialog.AddExtension = true;
                dialog.FileName = "cursor-mirror-trace-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".zip";
                if (dialog.ShowDialog(this) != DialogResult.OK)
                {
                    return;
                }

                _writer.Write(dialog.FileName, snapshot);
                _session.MarkSaved();
                _savedSinceStop = true;
                RefreshUi();
            }
        }

        private void ExitApplication(object sender, EventArgs e)
        {
            Close();
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

        private void CapturePollSample()
        {
            Point? cursorPoint = TryGetCursorPoint();
            if (!cursorPoint.HasValue)
            {
                return;
            }

            DwmTimingInfo timing;
            bool hasTiming = _traceNativeMethods.TryGetDwmTimingInfo(out timing);
            _session.AddPoll(Stopwatch.GetTimestamp(), cursorPoint.Value, hasTiming, timing);
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

                long remainingTicks = nextTicks - now;
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
            _runtimeSchedulerWaitTimer = HighResolutionWaitTimer.CreateBestEffort();
            _runtimeSchedulerPollActive = true;
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
                int sleepMilliseconds;
                long preferredWaitUntilTicks = 0;
                long decisionCompletedTicks;

                if (hasTiming)
                {
                    DwmSynchronizedRuntimeScheduleDecision decision =
                        DwmSynchronizedRuntimeScheduler.EvaluateDwmTiming(
                            timingReadCompletedTicks,
                            Stopwatch.Frequency,
                            ToSignedTicks(timing.QpcVBlank),
                            ToSignedTicks(timing.QpcRefreshPeriod),
                            _lastRuntimeSchedulerVBlankTicks,
                            DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds,
                            DwmSynchronizedRuntimeScheduler.MaximumDwmSleepMilliseconds);
                    decisionCompletedTicks = Stopwatch.GetTimestamp();
                    schedulerTimingUsable = decision.IsDwmTimingUsable;
                    if (decision.TargetVBlankTicks > 0)
                    {
                        targetVBlankTicks = decision.TargetVBlankTicks;
                        plannedTickTicks = decision.TargetVBlankTicks - MillisecondsToTicks(DwmSynchronizedRuntimeScheduler.WakeAdvanceMilliseconds);
                        vBlankLeadMicroseconds = MouseTraceSession.TicksToMicroseconds(decision.TargetVBlankTicks - decisionCompletedTicks);
                    }

                    if (decision.ShouldTick)
                    {
                        _lastRuntimeSchedulerVBlankTicks = decision.TargetVBlankTicks;
                        QueueRuntimeSchedulerPollSample(true, timing, decision.TargetVBlankTicks);
                        tickRequested = true;
                        sleepMilliseconds = 1;
                    }
                    else
                    {
                        sleepMilliseconds = decision.DelayMilliseconds;
                        preferredWaitUntilTicks = decision.WaitUntilTicks;
                    }
                }
                else
                {
                    decisionCompletedTicks = Stopwatch.GetTimestamp();
                    QueueRuntimeSchedulerPollSample(false, timing, null);
                    tickRequested = true;
                    sleepMilliseconds = DwmSynchronizedRuntimeScheduler.FallbackIntervalMilliseconds;
                }

                long sleepStartedTicks = Stopwatch.GetTimestamp();
                long waitTargetTicks = DwmSynchronizedRuntimeScheduler.CalculateCurrentWaitTargetTicks(
                    sleepStartedTicks,
                    sleepMilliseconds,
                    preferredWaitUntilTicks,
                    Stopwatch.Frequency);
                string waitMethod = SleepRuntimeSchedulerLoop(sleepMilliseconds, waitTargetTicks);
                long sleepCompletedTicks = Stopwatch.GetTimestamp();
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
            if (!_runtimeSchedulerPollActive || IsDisposed)
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

        private Point? TryGetCursorPoint()
        {
            NativePoint point;
            if (!_traceNativeMethods.GetCursorPos(out point))
            {
                return null;
            }

            return new Point(point.x, point.y);
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

        private bool HasUnsavedSamples()
        {
            MouseTraceState state = _session.State;
            return !_savedSinceStop && (state == MouseTraceState.StoppedWithSamples || state == MouseTraceState.Recording);
        }

        private void RefreshUi()
        {
            MouseTraceState state = _session.State;
            MouseTraceUiState uiState = MouseTraceUiState.FromState(state);
            _startButton.Enabled = uiState.StartEnabled;
            _stopButton.Enabled = uiState.StopEnabled;
            _saveButton.Enabled = uiState.SaveEnabled;
            _exitButton.Enabled = uiState.ExitEnabled;

            _statusValue.Text = LocalizedStrings.TraceStateLabel(state.ToString());
            MouseTraceSampleCounts counts = _session.GetSampleCounts();
            _sampleCountValue.Text = counts.TotalSamples.ToString();
            _hookMoveCountValue.Text = counts.HookMoveSamples.ToString();
            _cursorPollCountValue.Text = counts.CursorPollSamples.ToString();
            _referencePollCountValue.Text = counts.ReferencePollSamples.ToString();
            _runtimeSchedulerPollCountValue.Text = counts.RuntimeSchedulerPollSamples.ToString();
            _runtimeSchedulerLoopCountValue.Text = counts.RuntimeSchedulerLoopSamples.ToString();
            _dwmTimingCountValue.Text = LocalizedStrings.TraceDwmTimingSampleCount(
                counts.DwmTimingSamples,
                counts.CursorPollSamples + counts.RuntimeSchedulerPollSamples + counts.RuntimeSchedulerLoopSamples);
            _durationValue.Text = MouseTraceFormat.FormatDuration(_session.ElapsedMicroseconds);
        }
    }
}
