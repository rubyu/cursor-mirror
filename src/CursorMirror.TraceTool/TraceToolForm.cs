using System;
using System.Drawing;
using System.Windows.Forms;
using CursorMirror.MouseTrace;

namespace CursorMirror.TraceTool
{
    public sealed class TraceToolForm : Form
    {
        private const int LabelColumnWidth = 300;
        private const int RowHeight = 24;
        private const int ButtonRowHeight = 38;

        private readonly ITraceNativeMethods _traceNativeMethods;
        private readonly MouseTracePackageWriter _writer = new MouseTracePackageWriter();
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
        private readonly Timer _uiTimer;
        private MouseTraceRecorder _recorder;
        private bool _savedSinceStop = true;

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
            Icon = AppIcon.Load();
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(680, 350);
            MinimumSize = new Size(680, 390);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(12);
            layout.ColumnCount = 2;
            layout.RowCount = 11;
            layout.GrowStyle = TableLayoutPanelGrowStyle.FixedSize;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, LabelColumnWidth));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            ConfigureRows(layout);
            Controls.Add(layout);

            _statusValue = CursorMirrorFormLayout.AddValueRow(layout, 0, LocalizedStrings.TraceStatusLabel);
            _sampleCountValue = CursorMirrorFormLayout.AddValueRow(layout, 1, LocalizedStrings.TraceTotalSampleCountLabel);
            _hookMoveCountValue = CursorMirrorFormLayout.AddValueRow(layout, 2, LocalizedStrings.TraceHookMoveSampleCountLabel);
            _cursorPollCountValue = CursorMirrorFormLayout.AddValueRow(layout, 3, LocalizedStrings.TraceCursorPollSampleCountLabel);
            _referencePollCountValue = CursorMirrorFormLayout.AddValueRow(layout, 4, LocalizedStrings.TraceReferencePollSampleCountLabel);
            _runtimeSchedulerPollCountValue = CursorMirrorFormLayout.AddValueRow(layout, 5, LocalizedStrings.TraceRuntimeSchedulerPollSampleCountLabel);
            _runtimeSchedulerLoopCountValue = CursorMirrorFormLayout.AddValueRow(layout, 6, LocalizedStrings.TraceRuntimeSchedulerLoopSampleCountLabel);
            _dwmTimingCountValue = CursorMirrorFormLayout.AddValueRow(layout, 7, LocalizedStrings.TraceDwmTimingSampleCountLabel);
            _durationValue = CursorMirrorFormLayout.AddValueRow(layout, 8, LocalizedStrings.TraceDurationLabel);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.LeftToRight;
            buttons.WrapContents = false;
            layout.Controls.Add(buttons, 0, 9);
            layout.SetColumnSpan(buttons, 2);

            Panel spacer = new Panel();
            spacer.Dock = DockStyle.Fill;
            layout.Controls.Add(spacer, 0, 10);
            layout.SetColumnSpan(spacer, 2);

            _startButton = AddButton(buttons, LocalizedStrings.TraceStartRecordingCommand, StartRecording);
            _stopButton = AddButton(buttons, LocalizedStrings.TraceStopRecordingCommand, StopRecording);
            _saveButton = AddButton(buttons, LocalizedStrings.TraceSaveCommand, SaveRecording);
            _exitButton = AddButton(buttons, LocalizedStrings.ExitCommand, ExitApplication);

            _uiTimer = new Timer();
            _uiTimer.Interval = 100;
            _uiTimer.Tick += delegate { RefreshUi(); };

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

            StopRecorder();
            _uiTimer.Stop();
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                StopRecorder();
                if (_uiTimer != null)
                {
                    _uiTimer.Dispose();
                }
            }

            base.Dispose(disposing);
        }

        private static void ConfigureRows(TableLayoutPanel layout)
        {
            layout.RowStyles.Clear();
            for (int row = 0; row < 9; row++)
            {
                layout.RowStyles.Add(new RowStyle(SizeType.Absolute, RowHeight));
            }

            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, ButtonRowHeight));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        }

        private static Button AddButton(FlowLayoutPanel panel, string text, EventHandler handler)
        {
            Button button = new Button();
            button.Text = text;
            button.AutoSize = true;
            button.Margin = new Padding(0, 4, 8, 4);
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

            StopRecorder();
            _recorder = new MouseTraceRecorder(_traceNativeMethods);
            _savedSinceStop = false;
            try
            {
                _recorder.Start();
                _uiTimer.Start();
                RefreshUi();
            }
            catch
            {
                StopRecorder();
                throw;
            }
        }

        private void StopRecording(object sender, EventArgs e)
        {
            if (_recorder != null)
            {
                _recorder.Stop();
            }

            _uiTimer.Stop();
            RefreshUi();
        }

        private void SaveRecording(object sender, EventArgs e)
        {
            MouseTraceRecorder recorder = _recorder;
            if (recorder == null)
            {
                return;
            }

            MouseTraceSnapshot snapshot = recorder.Snapshot();
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
                recorder.MarkSaved();
                _savedSinceStop = true;
                RefreshUi();
            }
        }

        private void ExitApplication(object sender, EventArgs e)
        {
            Close();
        }

        private bool HasUnsavedSamples()
        {
            MouseTraceRecorder recorder = _recorder;
            if (recorder == null || _savedSinceStop)
            {
                return false;
            }

            MouseTraceState state = recorder.State;
            return state == MouseTraceState.StoppedWithSamples || state == MouseTraceState.Recording;
        }

        private void RefreshUi()
        {
            MouseTraceRecorder recorder = _recorder;
            MouseTraceState state = recorder == null ? MouseTraceState.Idle : recorder.State;
            MouseTraceUiState uiState = MouseTraceUiState.FromState(state);
            _startButton.Enabled = uiState.StartEnabled;
            _stopButton.Enabled = uiState.StopEnabled;
            _saveButton.Enabled = uiState.SaveEnabled;
            _exitButton.Enabled = uiState.ExitEnabled;

            _statusValue.Text = LocalizedStrings.TraceStateLabel(state.ToString());
            MouseTraceSampleCounts counts = recorder == null ? new MouseTraceSampleCounts(0, 0, 0, 0, 0, 0, 0) : recorder.GetSampleCounts();
            _sampleCountValue.Text = counts.TotalSamples.ToString();
            _hookMoveCountValue.Text = counts.HookMoveSamples.ToString();
            _cursorPollCountValue.Text = counts.CursorPollSamples.ToString();
            _referencePollCountValue.Text = counts.ReferencePollSamples.ToString();
            _runtimeSchedulerPollCountValue.Text = counts.RuntimeSchedulerPollSamples.ToString();
            _runtimeSchedulerLoopCountValue.Text = counts.RuntimeSchedulerLoopSamples.ToString();
            _dwmTimingCountValue.Text = LocalizedStrings.TraceDwmTimingSampleCount(
                counts.DwmTimingSamples,
                counts.CursorPollSamples
                    + counts.RuntimeSchedulerPollSamples
                    + counts.RuntimeSchedulerLoopSamples);
            _durationValue.Text = MouseTraceFormat.FormatDuration(recorder == null ? 0 : recorder.ElapsedMicroseconds);
        }

        private void StopRecorder()
        {
            if (_recorder == null)
            {
                return;
            }

            _uiTimer.Stop();
            _recorder.Dispose();
            _recorder = null;
        }
    }
}
