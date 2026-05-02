using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace CursorMirror.Calibrator
{
    public sealed class CalibratorForm : Form
    {
        private const int TimerIntervalMilliseconds = 8;
        private const int DefaultDurationSeconds = 10;
        private const int CaptureWarmupMilliseconds = 300;

        private readonly Panel _startPanel;
        private readonly Button _startButton;
        private readonly Button _saveButton;
        private readonly Button _exitButton;
        private readonly NumericUpDown _durationInput;
        private readonly Label _resultLabel;
        private readonly Timer _timer;
        private readonly Stopwatch _stopwatch = new Stopwatch();
        private readonly List<CalibrationFrameAnalysis> _frames = new List<CalibrationFrameAnalysis>();
        private readonly CalibratorRunOptions _options;

        private CalibratorCursorDriver _cursorDriver;
        private LowLevelMouseHook _mouseHook;
        private OverlayWindow _overlayWindow;
        private CursorMirrorController _mirrorController;
        private WgcDisplayCapture _capture;
        private Rectangle _primaryBounds;
        private Rectangle _pathBounds;
        private CalibrationMotionPatternSuite _motionSuite;
        private long _calibrationStartTicks;
        private bool _running;
        private bool _savedSinceStop;

        public CalibratorForm()
            : this(new CalibratorRunOptions())
        {
        }

        public CalibratorForm(CalibratorRunOptions options)
        {
            _options = options ?? new CalibratorRunOptions();

            Text = "Cursor Mirror Calibrator";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            KeyPreview = true;
            ClientSize = new Size(470, 190);
            BackColor = Color.White;

            _startPanel = new Panel();
            _startPanel.Dock = DockStyle.Fill;
            _startPanel.Padding = new Padding(14);
            Controls.Add(_startPanel);

            Label title = new Label();
            title.Text = "Cursor Mirror Calibrator";
            title.Font = new Font(Font.FontFamily, 12.0f, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(14, 14);
            _startPanel.Controls.Add(title);

            Label note = new Label();
            note.Text = "Captures the primary display with Windows Graphics Capture.\r\nNo raw frames are saved by default. Press any key to stop calibration.";
            note.AutoSize = true;
            note.Location = new Point(14, 46);
            _startPanel.Controls.Add(note);

            Label durationLabel = new Label();
            durationLabel.Text = "Duration (s)";
            durationLabel.AutoSize = true;
            durationLabel.Location = new Point(14, 96);
            _startPanel.Controls.Add(durationLabel);

            _durationInput = new NumericUpDown();
            _durationInput.Minimum = 3;
            _durationInput.Maximum = 60;
            int durationSeconds = _options.DurationSeconds <= 0 ? DefaultDurationSeconds : _options.DurationSeconds;
            _durationInput.Value = Math.Max((int)_durationInput.Minimum, Math.Min((int)_durationInput.Maximum, durationSeconds));
            _durationInput.Location = new Point(120, 92);
            _startPanel.Controls.Add(_durationInput);

            _exitButton = new Button();
            _exitButton.Text = "Exit";
            _exitButton.AutoSize = true;
            _exitButton.Location = new Point(382, 126);
            _exitButton.Click += delegate { Close(); };
            _startPanel.Controls.Add(_exitButton);

            _saveButton = new Button();
            _saveButton.Text = "Save";
            _saveButton.AutoSize = true;
            _saveButton.Location = new Point(301, 126);
            _saveButton.Click += SaveCalibration;
            _startPanel.Controls.Add(_saveButton);

            _startButton = new Button();
            _startButton.Text = "Start";
            _startButton.AutoSize = true;
            _startButton.Location = new Point(220, 126);
            _startButton.Click += delegate { StartCalibration(); };
            _startPanel.Controls.Add(_startButton);

            _resultLabel = new Label();
            _resultLabel.AutoSize = true;
            _resultLabel.Location = new Point(14, 130);
            _startPanel.Controls.Add(_resultLabel);

            _timer = new Timer();
            _timer.Interval = TimerIntervalMilliseconds;
            _timer.Tick += delegate { TickCalibration(); };
            RefreshUi();
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (_options.AutoRun)
            {
                BeginInvoke(new MethodInvoker(StartCalibration));
            }
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (_running)
            {
                StopCalibration(true);
                return true;
            }

            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && HasUnsavedFrames())
            {
                DialogResult result = MessageBox.Show(
                    this,
                    "A calibration run has not been saved. Exit without saving?",
                    Text,
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (result != DialogResult.Yes)
                {
                    e.Cancel = true;
                    return;
                }
            }

            StopCalibration(false);
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                StopCalibration(false);
                _timer.Dispose();
            }

            base.Dispose(disposing);
        }

        private void StartCalibration()
        {
            try
            {
                if (HasUnsavedFrames())
                {
                    DialogResult result = MessageBox.Show(
                        this,
                        "Discard the unsaved calibration run and start a new one?",
                        Text,
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning);
                    if (result != DialogResult.Yes)
                    {
                        return;
                    }
                }

                if (!WgcDisplayCapture.IsSupported)
                {
                    MessageBox.Show(this, "Windows Graphics Capture is not supported on this system.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                _frames.Clear();
                _savedSinceStop = false;
                _resultLabel.Text = string.Empty;
                RefreshUi();
                _primaryBounds = Screen.PrimaryScreen.Bounds;
                _pathBounds = BuildPathBounds(_primaryBounds);
                _motionSuite = CalibrationMotionPatternSuite.CreateDefault(_pathBounds);
                _cursorDriver = new CalibratorCursorDriver();

                CursorMirrorSettings settings = BuildCursorSettings();
                _overlayWindow = new OverlayWindow();
                _mirrorController = new CursorMirrorController(
                    new CursorImageProvider(),
                    _overlayWindow,
                    new ControlDispatcher(_overlayWindow),
                    settings,
                    new SystemClock(),
                    new CursorPoller());

                _mouseHook = new LowLevelMouseHook(HandleMouseEvent);
                _mouseHook.SetHook();

                EnterFullScreen();
                Refresh();
                _calibrationStartTicks = Stopwatch.GetTimestamp();
                _stopwatch.Restart();
                _running = true;
                MoveCursorForElapsed(0);

                _capture = new WgcDisplayCapture(_primaryBounds);
                _capture.FrameCaptured += CaptureFrameCaptured;
                _capture.Start();

                _timer.Start();
                Focus();
            }
            catch (Exception ex)
            {
                StopCalibration(false);
                MessageBox.Show(this, ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private HookResult HandleMouseEvent(LowLevelMouseHook.MouseEvent mouseEvent, LowLevelMouseHook.MSLLHOOKSTRUCT data)
        {
            bool isInjected = data.dwExtraInfo == CalibratorCursorDriver.InjectionExtraInfo;
            if (isInjected)
            {
                if (_mirrorController != null)
                {
                    _mirrorController.HandleMouseEvent(mouseEvent, data);
                }

                return HookResult.Transfer;
            }

            return HookResult.Cancel;
        }

        private void TickCalibration()
        {
            if (!_running)
            {
                return;
            }

            long elapsed = _stopwatch.ElapsedMilliseconds;
            if (elapsed >= ((int)_durationInput.Value * 1000))
            {
                StopCalibration(true);
                return;
            }

            MoveCursorForElapsed(elapsed);
            if (_mirrorController != null)
            {
                _mirrorController.Tick();
            }
        }

        private void MoveCursorForElapsed(long elapsedMilliseconds)
        {
            if (_cursorDriver != null && _motionSuite != null)
            {
                CalibrationMotionSample sample = _motionSuite.GetSample(elapsedMilliseconds);
                _cursorDriver.MoveTo(new Point(sample.ExpectedX, sample.ExpectedY));
            }
        }

        private void CaptureFrameCaptured(object sender, CalibrationFrameAnalysis e)
        {
            if (_stopwatch.IsRunning && _stopwatch.ElapsedMilliseconds < CaptureWarmupMilliseconds)
            {
                return;
            }

            CalibrationFrameAnalysis frame = e;
            if (_motionSuite != null)
            {
                double elapsedMilliseconds = _stopwatch.ElapsedMilliseconds;
                if (_calibrationStartTicks > 0 && e.TimestampTicks >= _calibrationStartTicks)
                {
                    elapsedMilliseconds = ((e.TimestampTicks - _calibrationStartTicks) * 1000.0) / Stopwatch.Frequency;
                }

                frame = e.WithMotion(_motionSuite.GetSample(elapsedMilliseconds));
            }

            lock (_frames)
            {
                _frames.Add(frame);
            }
        }

        private void StopCalibration(bool saveResults)
        {
            if (!_running && _capture == null && _mouseHook == null)
            {
                return;
            }

            _timer.Stop();
            _running = false;
            _stopwatch.Reset();

            if (_capture != null)
            {
                _capture.FrameCaptured -= CaptureFrameCaptured;
                _capture.Dispose();
                _capture = null;
            }

            if (_mouseHook != null)
            {
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

            if (_mirrorController != null)
            {
                _mirrorController.Dispose();
                _mirrorController = null;
            }
            else if (_overlayWindow != null)
            {
                _overlayWindow.Dispose();
            }

            _overlayWindow = null;
            _cursorDriver = null;
            _motionSuite = null;
            _calibrationStartTicks = 0;
            LeaveFullScreen();

            if (saveResults)
            {
                CompleteCalibration();
                if (_options.ExitAfterRun)
                {
                    if (string.IsNullOrWhiteSpace(_options.OutputPath))
                    {
                        _savedSinceStop = true;
                    }

                    BeginInvoke(new MethodInvoker(Close));
                }
            }
            else
            {
                RefreshUi();
            }
        }

        private void CompleteCalibration()
        {
            int frameCount = FrameCount();
            if (frameCount == 0)
            {
                _savedSinceStop = true;
                _resultLabel.Text = "Captured 0 frames. Nothing to save.";
                RefreshUi();
                return;
            }

            if (!string.IsNullOrWhiteSpace(_options.OutputPath))
            {
                SaveResults(_options.OutputPath);
                return;
            }

            _resultLabel.Text = "Captured " + frameCount.ToString() + " frames. Choose Save to write a calibration package.";
            RefreshUi();
        }

        private void SaveCalibration(object sender, EventArgs e)
        {
            if (!CanSave())
            {
                return;
            }

            using (SaveFileDialog dialog = new SaveFileDialog())
            {
                dialog.Title = "Save calibration package";
                dialog.Filter = "Zip packages (*.zip)|*.zip|All files (*.*)|*.*";
                dialog.DefaultExt = "zip";
                dialog.AddExtension = true;
                dialog.FileName = CalibrationPackageWriter.DefaultFileName();
                if (dialog.ShowDialog(this) != DialogResult.OK)
                {
                    return;
                }

                SaveResults(dialog.FileName);
            }
        }

        private void SaveResults(string path)
        {
            List<CalibrationFrameAnalysis> snapshot;
            lock (_frames)
            {
                snapshot = new List<CalibrationFrameAnalysis>(_frames);
            }

            CalibrationSummary summary = CalibrationRunAnalyzer.Summarize(snapshot, "Windows Graphics Capture");
            new CalibrationPackageWriter().Write(path, snapshot, summary);
            _savedSinceStop = true;
            _resultLabel.Text = "Saved " + summary.FrameCount.ToString() + " frames: " + path;
            RefreshUi();
        }

        private void EnterFullScreen()
        {
            _startPanel.Visible = false;
            FormBorderStyle = FormBorderStyle.None;
            TopMost = true;
            Bounds = _primaryBounds;
            BackColor = Color.White;
            Cursor = Cursors.Arrow;
        }

        private void LeaveFullScreen()
        {
            TopMost = false;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            ClientSize = new Size(470, 190);
            CenterToScreen();
            _startPanel.Visible = true;
            _startPanel.BringToFront();
            RefreshUi();
        }

        private static Rectangle BuildPathBounds(Rectangle displayBounds)
        {
            int margin = Math.Max(120, displayBounds.Width / 8);
            int height = Math.Max(120, displayBounds.Height / 3);
            int top = displayBounds.Top + ((displayBounds.Height - height) / 2);
            return new Rectangle(displayBounds.Left + margin, top, Math.Max(1, displayBounds.Width - (margin * 2)), height);
        }

        private CursorMirrorSettings BuildCursorSettings()
        {
            CursorMirrorSettings settings = CursorMirrorSettings.Default();
            if (_options.PredictionEnabled.HasValue)
            {
                settings.PredictionEnabled = _options.PredictionEnabled.Value;
            }

            if (_options.PredictionGainPercent.HasValue)
            {
                settings.PredictionGainPercent = _options.PredictionGainPercent.Value;
            }

            if (_options.PredictionHorizonMilliseconds.HasValue)
            {
                settings.PredictionHorizonMilliseconds = _options.PredictionHorizonMilliseconds.Value;
            }

            if (_options.PredictionIdleResetMilliseconds.HasValue)
            {
                settings.PredictionIdleResetMilliseconds = _options.PredictionIdleResetMilliseconds.Value;
            }

            if (_options.DwmPredictionHorizonCapMilliseconds.HasValue)
            {
                settings.DwmPredictionHorizonCapMilliseconds = _options.DwmPredictionHorizonCapMilliseconds.Value;
            }

            if (_options.DwmAdaptiveGainEnabled.HasValue)
            {
                settings.DwmAdaptiveGainEnabled = _options.DwmAdaptiveGainEnabled.Value;
            }

            if (_options.DwmAdaptiveGainPercent.HasValue)
            {
                settings.DwmAdaptiveGainPercent = _options.DwmAdaptiveGainPercent.Value;
            }

            if (_options.DwmAdaptiveMinimumSpeedPixelsPerSecond.HasValue)
            {
                settings.DwmAdaptiveMinimumSpeedPixelsPerSecond = _options.DwmAdaptiveMinimumSpeedPixelsPerSecond.Value;
            }

            if (_options.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared.HasValue)
            {
                settings.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = _options.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared.Value;
            }

            if (_options.DwmAdaptiveReversalCooldownSamples.HasValue)
            {
                settings.DwmAdaptiveReversalCooldownSamples = _options.DwmAdaptiveReversalCooldownSamples.Value;
            }

            if (_options.DwmAdaptiveStableDirectionSamples.HasValue)
            {
                settings.DwmAdaptiveStableDirectionSamples = _options.DwmAdaptiveStableDirectionSamples.Value;
            }

            if (_options.DwmAdaptiveOscillationWindowSamples.HasValue)
            {
                settings.DwmAdaptiveOscillationWindowSamples = _options.DwmAdaptiveOscillationWindowSamples.Value;
            }

            if (_options.DwmAdaptiveOscillationMinimumReversals.HasValue)
            {
                settings.DwmAdaptiveOscillationMinimumReversals = _options.DwmAdaptiveOscillationMinimumReversals.Value;
            }

            if (_options.DwmAdaptiveOscillationMaximumSpanPixels.HasValue)
            {
                settings.DwmAdaptiveOscillationMaximumSpanPixels = _options.DwmAdaptiveOscillationMaximumSpanPixels.Value;
            }

            if (_options.DwmAdaptiveOscillationMaximumEfficiencyPercent.HasValue)
            {
                settings.DwmAdaptiveOscillationMaximumEfficiencyPercent = _options.DwmAdaptiveOscillationMaximumEfficiencyPercent.Value;
            }

            if (_options.DwmAdaptiveOscillationLatchMilliseconds.HasValue)
            {
                settings.DwmAdaptiveOscillationLatchMilliseconds = _options.DwmAdaptiveOscillationLatchMilliseconds.Value;
            }

            if (_options.DwmPredictionModel.HasValue)
            {
                settings.DwmPredictionModel = _options.DwmPredictionModel.Value;
            }

            return settings.Normalize();
        }

        private bool HasUnsavedFrames()
        {
            return !_running && !_savedSinceStop && FrameCount() > 0;
        }

        private bool CanSave()
        {
            return !_running && !_savedSinceStop && FrameCount() > 0;
        }

        private int FrameCount()
        {
            lock (_frames)
            {
                return _frames.Count;
            }
        }

        private void RefreshUi()
        {
            _startButton.Enabled = !_running;
            _saveButton.Enabled = CanSave();
            _exitButton.Enabled = !_running;
        }
    }
}
