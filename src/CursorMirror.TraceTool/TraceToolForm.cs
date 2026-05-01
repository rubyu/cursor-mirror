using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using CursorMirror.MouseTrace;

namespace CursorMirror.TraceTool
{
    public sealed class TraceToolForm : Form
    {
        private const int CursorPollIntervalMilliseconds = 8;

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
        private readonly Label _dwmTimingCountValue;
        private readonly Label _durationValue;
        private readonly Label _statusValue;
        private readonly Timer _uiTimer;
        private readonly Timer _pollTimer;
        private LowLevelMouseHook _mouseHook;
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
            ClientSize = new Size(460, 260);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(12);
            layout.ColumnCount = 2;
            layout.RowCount = 7;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Controls.Add(layout);

            _statusValue = AddValueRow(layout, 0, LocalizedStrings.TraceStatusLabel);
            _sampleCountValue = AddValueRow(layout, 1, LocalizedStrings.TraceTotalSampleCountLabel);
            _hookMoveCountValue = AddValueRow(layout, 2, LocalizedStrings.TraceHookMoveSampleCountLabel);
            _cursorPollCountValue = AddValueRow(layout, 3, LocalizedStrings.TraceCursorPollSampleCountLabel);
            _dwmTimingCountValue = AddValueRow(layout, 4, LocalizedStrings.TraceDwmTimingSampleCountLabel);
            _durationValue = AddValueRow(layout, 5, LocalizedStrings.TraceDurationLabel);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.LeftToRight;
            buttons.WrapContents = false;
            layout.Controls.Add(buttons, 0, 6);
            layout.SetColumnSpan(buttons, 2);

            _startButton = AddButton(buttons, LocalizedStrings.TraceStartRecordingCommand, StartRecording);
            _stopButton = AddButton(buttons, LocalizedStrings.TraceStopRecordingCommand, StopRecording);
            _saveButton = AddButton(buttons, LocalizedStrings.TraceSaveCommand, SaveRecording);
            _exitButton = AddButton(buttons, LocalizedStrings.ExitCommand, ExitApplication);

            _uiTimer = new Timer();
            _uiTimer.Interval = 100;
            _uiTimer.Tick += delegate { RefreshUi(); };

            _pollTimer = new Timer();
            _pollTimer.Interval = CursorPollIntervalMilliseconds;
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
            _uiTimer.Stop();
            _pollTimer.Stop();
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                StopHook();
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
            _session.Start(Stopwatch.GetTimestamp(), CursorPollIntervalMilliseconds);
            _savedSinceStop = false;
            _mouseHook = new LowLevelMouseHook(HandleMouseEvent);
            _mouseHook.SetHook();
            _pollTimer.Start();
            _uiTimer.Start();
            CapturePollSample();
            RefreshUi();
        }

        private void StopRecording(object sender, EventArgs e)
        {
            StopRecordingInternal();
            RefreshUi();
        }

        private void StopRecordingInternal()
        {
            StopHook();
            _session.Stop(Stopwatch.GetTimestamp());
            _pollTimer.Stop();
            _uiTimer.Stop();
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

        private Point? TryGetCursorPoint()
        {
            NativePoint point;
            if (!_traceNativeMethods.GetCursorPos(out point))
            {
                return null;
            }

            return new Point(point.x, point.y);
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
            _dwmTimingCountValue.Text = LocalizedStrings.TraceDwmTimingSampleCount(counts.DwmTimingSamples, counts.CursorPollSamples);
            _durationValue.Text = MouseTraceFormat.FormatDuration(_session.ElapsedMicroseconds);
        }
    }
}
