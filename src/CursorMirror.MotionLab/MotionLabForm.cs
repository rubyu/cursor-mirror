using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using CursorMirror.MouseTrace;
using CursorMirror.MotionLab;

namespace CursorMirror.MotionLabApp
{
    public sealed class MotionLabForm : Form
    {
        private readonly NumericUpDown _seedInput;
        private readonly CheckBox _fixedSeedCheckBox;
        private readonly ComboBox _profileInput;
        private readonly NumericUpDown _scenarioCountInput;
        private readonly NumericUpDown _controlPointInput;
        private readonly NumericUpDown _speedPointInput;
        private readonly NumericUpDown _durationInput;
        private readonly Label _totalDurationValueLabel;
        private readonly NumericUpDown _sampleRateInput;
        private readonly TableLayoutPanel _loadSettingsPanel;
        private readonly Label _loadPercentLabel;
        private readonly NumericUpDown _loadPercentInput;
        private readonly Label _loadWorkerLabel;
        private readonly NumericUpDown _loadWorkerInput;
        private readonly CheckBox _runLoadCheckBox;
        private readonly Button _generateButton;
        private readonly Button _saveButton;
        private readonly Button _startButton;
        private readonly Button _stopButton;
        private readonly Panel _previewPanel;
        private readonly Label _statusLabel;
        private readonly Timer _timer;
        private readonly RealCursorDriver _cursorDriver = new RealCursorDriver(RealCursorDriver.MotionLabInjectionExtraInfo);

        private MotionLabScenarioSet _scenarioSet;
        private MotionLabScenarioSetSampler _sampler;
        private MotionLabPlaybackRunner _playbackRunner;
        private MotionLabInputBlocker _inputBlocker;
        private MouseTraceRecorder _recorder;
        private string _recordingOutputPath;
        private Process _loadProcess;

        public MotionLabForm()
        {
            Text = "Cursor Mirror Motion Lab";
            Icon = AppIcon.Load();
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            KeyPreview = true;
            ClientSize = new Size(800, 500);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.ColumnCount = 2;
            layout.RowCount = 1;
            layout.Dock = DockStyle.Fill;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 280));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Controls.Add(layout);

            TableLayoutPanel controls = new TableLayoutPanel();
            controls.ColumnCount = 2;
            controls.RowCount = 13;
            controls.Dock = DockStyle.Fill;
            controls.Padding = new Padding(12);
            controls.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 132));
            controls.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.Controls.Add(controls, 0, 0);

            _profileInput = AddCombo(controls, 0, "Profile", new[] { "Real trace weighted", "Balanced" }, 0);
            _scenarioCountInput = AddNumber(controls, 1, "Scenarios", 1, 64, 8);
            _scenarioCountInput.ValueChanged += delegate { RefreshUi(); };
            _fixedSeedCheckBox = new CheckBox();
            _fixedSeedCheckBox.Text = "Use fixed seed";
            _fixedSeedCheckBox.AutoSize = true;
            _fixedSeedCheckBox.CheckedChanged += delegate { RefreshUi(); };
            controls.Controls.Add(_fixedSeedCheckBox, 0, 2);
            controls.SetColumnSpan(_fixedSeedCheckBox, 2);
            _seedInput = AddNumber(controls, 3, "Seed", 0, int.MaxValue, Environment.TickCount & 0x7fffffff);
            _controlPointInput = AddNumber(controls, 4, "Bezier points", 2, 16, 8);
            _speedPointInput = AddNumber(controls, 5, "Speed points", 0, 32, 8);
            _durationInput = AddNumber(controls, 6, "Scenario duration (ms)", 500, 120000, 12000);
            _durationInput.ValueChanged += delegate { RefreshUi(); };
            _totalDurationValueLabel = AddValueRow(controls, 7, "Total duration", string.Empty);
            _sampleRateInput = AddNumber(controls, 8, "Playback Hz", 30, 2000, 240);
            _runLoadCheckBox = new CheckBox();
            _runLoadCheckBox.Text = "Run load generator during playback";
            _runLoadCheckBox.AutoSize = true;
            _runLoadCheckBox.CheckedChanged += delegate { RefreshUi(); };
            controls.Controls.Add(_runLoadCheckBox, 0, 9);
            controls.SetColumnSpan(_runLoadCheckBox, 2);

            _loadSettingsPanel = new TableLayoutPanel();
            _loadSettingsPanel.ColumnCount = 2;
            _loadSettingsPanel.RowCount = 2;
            _loadSettingsPanel.AutoSize = true;
            _loadSettingsPanel.Dock = DockStyle.Top;
            _loadSettingsPanel.Padding = new Padding(18, 0, 0, 0);
            _loadSettingsPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 102));
            _loadSettingsPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            controls.Controls.Add(_loadSettingsPanel, 0, 10);
            controls.SetColumnSpan(_loadSettingsPanel, 2);
            _loadPercentInput = AddNumber(_loadSettingsPanel, 0, "CPU load (%)", 1, 100, 50, out _loadPercentLabel);
            _loadWorkerInput = AddNumber(_loadSettingsPanel, 1, "Workers", 1, 64, Math.Max(1, Environment.ProcessorCount / 2), out _loadWorkerLabel);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.FlowDirection = FlowDirection.LeftToRight;
            buttons.AutoSize = true;
            controls.Controls.Add(buttons, 0, 11);
            controls.SetColumnSpan(buttons, 2);

            _generateButton = new Button();
            _generateButton.Text = "Generate";
            _generateButton.AutoSize = true;
            _generateButton.Click += delegate { GenerateScript(); };
            buttons.Controls.Add(_generateButton);

            _saveButton = new Button();
            _saveButton.Text = "Save Script";
            _saveButton.AutoSize = true;
            _saveButton.Click += delegate { SaveScript(); };
            buttons.Controls.Add(_saveButton);

            _startButton = new Button();
            _startButton.Text = "Play and Record";
            _startButton.AutoSize = true;
            _startButton.Click += delegate { StartMotion(); };
            buttons.Controls.Add(_startButton);

            _stopButton = new Button();
            _stopButton.Text = "Stop";
            _stopButton.AutoSize = true;
            _stopButton.Click += delegate { StopMotion(); };
            buttons.Controls.Add(_stopButton);

            Button exitButton = new Button();
            exitButton.Text = "Exit";
            exitButton.AutoSize = true;
            exitButton.Click += delegate { Close(); };
            buttons.Controls.Add(exitButton);

            _statusLabel = new Label();
            _statusLabel.AutoSize = false;
            _statusLabel.Height = 64;
            _statusLabel.Dock = DockStyle.Fill;
            controls.Controls.Add(_statusLabel, 0, 12);
            controls.SetColumnSpan(_statusLabel, 2);

            _previewPanel = new Panel();
            _previewPanel.Dock = DockStyle.Fill;
            _previewPanel.BackColor = Color.White;
            _previewPanel.Paint += PreviewPanelPaint;
            layout.Controls.Add(_previewPanel, 1, 0);

            _timer = new Timer();
            _timer.Interval = 1;
            _timer.Tick += TimerTick;

            GenerateScript();
            RefreshUi();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            StopMotion();
            if (_playbackRunner != null)
            {
                _playbackRunner.Dispose();
                _playbackRunner = null;
            }

            if (_recorder != null)
            {
                _recorder.Dispose();
                _recorder = null;
            }

            base.OnFormClosing(e);
        }

        private static NumericUpDown AddNumber(TableLayoutPanel layout, int row, string label, int minimum, int maximum, int value)
        {
            Label labelControl;
            return AddNumber(layout, row, label, minimum, maximum, value, out labelControl);
        }

        private static NumericUpDown AddNumber(TableLayoutPanel layout, int row, string label, int minimum, int maximum, int value, out Label labelControl)
        {
            labelControl = new Label();
            labelControl.Text = label;
            labelControl.AutoSize = true;
            labelControl.Anchor = AnchorStyles.Left;
            layout.Controls.Add(labelControl, 0, row);

            NumericUpDown input = new NumericUpDown();
            input.Minimum = minimum;
            input.Maximum = maximum;
            input.Value = Math.Max(minimum, Math.Min(maximum, value));
            input.Dock = DockStyle.Fill;
            layout.Controls.Add(input, 1, row);
            return input;
        }

        private static ComboBox AddCombo(TableLayoutPanel layout, int row, string label, string[] values, int selectedIndex)
        {
            Label labelControl = new Label();
            labelControl.Text = label;
            labelControl.AutoSize = true;
            labelControl.Anchor = AnchorStyles.Left;
            layout.Controls.Add(labelControl, 0, row);

            ComboBox input = new ComboBox();
            input.DropDownStyle = ComboBoxStyle.DropDownList;
            input.Dock = DockStyle.Fill;
            input.Items.AddRange(values);
            if (values.Length > 0)
            {
                input.SelectedIndex = Math.Max(0, Math.Min(values.Length - 1, selectedIndex));
            }

            layout.Controls.Add(input, 1, row);
            return input;
        }

        private void GenerateScript()
        {
            GenerateScript(true);
        }

        private void GenerateScript(bool refreshRandomSeed)
        {
            Point cursor;
            if (!_cursorDriver.TryGetCursorPosition(out cursor))
            {
                cursor = new Point(
                    Screen.PrimaryScreen.Bounds.Left + (Screen.PrimaryScreen.Bounds.Width / 2),
                    Screen.PrimaryScreen.Bounds.Top + (Screen.PrimaryScreen.Bounds.Height / 2));
            }

            Rectangle bounds = Screen.PrimaryScreen.WorkingArea;
            bounds.Inflate(-80, -80);
            if (bounds.Width <= 0 || bounds.Height <= 0)
            {
                bounds = Screen.PrimaryScreen.Bounds;
            }

            int seed = ResolveSeed(refreshRandomSeed);
            _scenarioSet = MotionLabGenerator.GenerateScenarioSet(
                seed,
                bounds,
                cursor,
                (int)_scenarioCountInput.Value,
                (int)_controlPointInput.Value,
                (int)_speedPointInput.Value,
                (double)_durationInput.Value,
                (int)_sampleRateInput.Value,
                SelectedGenerationProfile());
            _sampler = new MotionLabScenarioSetSampler(_scenarioSet);
            _previewPanel.Invalidate();
            RefreshUi();
        }

        private void SaveScript()
        {
            if (_scenarioSet == null)
            {
                GenerateScript();
            }

            using (SaveFileDialog dialog = new SaveFileDialog())
            {
                dialog.Title = "Save motion script package";
                dialog.Filter = "Cursor Mirror motion package (*.zip)|*.zip|All files (*.*)|*.*";
                dialog.DefaultExt = "zip";
                dialog.AddExtension = true;
                dialog.FileName = MotionLabPackageWriter.DefaultFileName();
                if (dialog.ShowDialog(this) != DialogResult.OK)
                {
                    return;
                }

                new MotionLabPackageWriter().Write(dialog.FileName, _scenarioSet);
                _statusLabel.Text = "Saved script package: " + dialog.FileName;
            }
        }

        private void StartMotion()
        {
            if (IsRunning())
            {
                return;
            }

            GenerateScript(true);

            string outputPath = PromptRecordingPath();
            if (string.IsNullOrEmpty(outputPath))
            {
                return;
            }

            _recordingOutputPath = outputPath;
            try
            {
                _recorder = new MouseTraceRecorder();
                _recorder.Start();
                _inputBlocker = new MotionLabInputBlocker(_cursorDriver.InjectionExtraInfo);
                _inputBlocker.Start();
                StartLoadGenerator();
                _playbackRunner = new MotionLabPlaybackRunner(_cursorDriver);
                _playbackRunner.Completed += PlaybackCompleted;
                _playbackRunner.Start(_scenarioSet);
                _timer.Start();
                RefreshUi();
            }
            catch (Exception ex)
            {
                StopMotion();
                MessageBox.Show(this, ex.Message, "Cursor Mirror Motion Lab", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StopMotion()
        {
            bool wasRunning = IsRunning();
            _timer.Stop();
            Exception playbackException = null;
            if (_playbackRunner != null)
            {
                _playbackRunner.Completed -= PlaybackCompleted;
                playbackException = _playbackRunner.Exception;
                _playbackRunner.Stop();
                if (playbackException == null)
                {
                    playbackException = _playbackRunner.Exception;
                }

                _playbackRunner.Dispose();
                _playbackRunner = null;
            }

            StopLoadGenerator();

            MouseTraceSnapshot snapshot = null;
            if (_recorder != null)
            {
                try
                {
                    snapshot = _recorder.Stop();
                }
                finally
                {
                    _recorder.Dispose();
                    _recorder = null;
                }
            }

            StopInputBlocker();
            RefreshUi();
            if (playbackException != null)
            {
                MessageBox.Show(this, playbackException.Message, "Cursor Mirror Motion Lab", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }

            if (wasRunning && snapshot != null)
            {
                SaveRecordedPackage(snapshot);
            }

            _recordingOutputPath = null;
        }

        private void TimerTick(object sender, EventArgs e)
        {
            if (_scenarioSet == null || _sampler == null || _playbackRunner == null)
            {
                return;
            }

            MotionLabScenarioSetSample sample = _playbackRunner.LastSample ?? _sampler.GetSample(0);
            MouseTraceSampleCounts counts = _recorder == null ? new MouseTraceSampleCounts(0, 0, 0, 0, 0, 0, 0) : _recorder.GetSampleCounts();
            _statusLabel.Text = "Recording " + sample.ElapsedMilliseconds.ToString("0") + " ms, scenario " + (sample.ScenarioIndex + 1).ToString() + "/" + _sampler.ScenarioCount.ToString() + ", progress " + sample.Progress.ToString("0.000") + ", velocity " + sample.VelocityPixelsPerSecond.ToString("0") + " px/s, samples " + counts.TotalSamples.ToString() + ". Mouse input is blocked; press Esc to stop.";
        }

        private string PromptRecordingPath()
        {
            using (SaveFileDialog dialog = new SaveFileDialog())
            {
                dialog.Title = "Save Play and Record package";
                dialog.Filter = "Cursor Mirror motion trace package (*.zip)|*.zip|All files (*.*)|*.*";
                dialog.DefaultExt = "zip";
                dialog.AddExtension = true;
                dialog.FileName = MotionLabPackageWriter.DefaultRecordedFileName();
                return dialog.ShowDialog(this) == DialogResult.OK ? dialog.FileName : null;
            }
        }

        private void SaveRecordedPackage(MouseTraceSnapshot snapshot)
        {
            if (snapshot.Samples.Length == 0)
            {
                _statusLabel.Text = "Recording ended without trace samples.";
                return;
            }

            try
            {
                new MotionLabPackageWriter().Write(_recordingOutputPath, _scenarioSet, snapshot);
                _statusLabel.Text = "Saved Play and Record package: " + _recordingOutputPath;
            }
            catch (Exception ex)
            {
                _statusLabel.Text = "Could not save Play and Record package.";
                MessageBox.Show(this, ex.Message, "Cursor Mirror Motion Lab", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StartLoadGenerator()
        {
            if (!_runLoadCheckBox.Checked || _loadProcess != null)
            {
                return;
            }

            string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "CursorMirror.LoadGen.exe");
            if (!File.Exists(path))
            {
                _statusLabel.Text = "Load generator was not found.";
                return;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo(path);
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.Arguments =
                "--duration-seconds " + Math.Max(1, (int)Math.Ceiling(GetTotalDurationMilliseconds() / 1000.0)).ToString() +
                " --workers " + ((int)_loadWorkerInput.Value).ToString() +
                " --load-percent " + ((int)_loadPercentInput.Value).ToString();
            _loadProcess = Process.Start(startInfo);
        }

        private void StopLoadGenerator()
        {
            if (_loadProcess == null)
            {
                return;
            }

            try
            {
                if (!_loadProcess.HasExited)
                {
                    _loadProcess.Kill();
                }
            }
            catch
            {
            }
            finally
            {
                _loadProcess.Dispose();
                _loadProcess = null;
            }
        }

        private void StopInputBlocker()
        {
            if (_inputBlocker == null)
            {
                return;
            }

            _inputBlocker.Dispose();
            _inputBlocker = null;
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape && IsRunning())
            {
                e.Handled = true;
                StopMotion();
                return;
            }

            base.OnKeyDown(e);
        }

        private void PreviewPanelPaint(object sender, PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            e.Graphics.Clear(Color.White);
            if (_scenarioSet == null || _sampler == null)
            {
                return;
            }

            Rectangle preview = _previewPanel.ClientRectangle;
            preview.Inflate(-20, -20);
            if (preview.Width <= 0 || preview.Height <= 0)
            {
                return;
            }

            PointF? previous = null;
            using (Pen pathPen = new Pen(Color.FromArgb(0, 120, 215), 2))
            using (Brush pointBrush = new SolidBrush(Color.FromArgb(30, 30, 30)))
            {
                MotionLabScript[] scenarios = _scenarioSet.Scenarios ?? new MotionLabScript[0];
                for (int scenarioIndex = 0; scenarioIndex < scenarios.Length; scenarioIndex++)
                {
                    MotionLabScript scenario = scenarios[scenarioIndex];
                    if (scenario == null)
                    {
                        continue;
                    }

                    Rectangle bounds = MotionLabGenerator.ToRectangle(scenario.Bounds);
                    MotionLabSampler scenarioSampler = _sampler.GetScenarioSampler(scenarioIndex);
                    previous = null;
                    for (int i = 0; i <= 120; i++)
                    {
                        MotionLabPoint point = scenarioSampler.EvaluateBezier(i / 120.0);
                        PointF mapped = MapPoint(point, bounds, preview);
                        if (previous.HasValue)
                        {
                            e.Graphics.DrawLine(pathPen, previous.Value, mapped);
                        }

                        previous = mapped;
                    }

                    MotionLabPoint[] points = scenario.ControlPoints ?? new MotionLabPoint[0];
                    for (int i = 0; i < points.Length; i++)
                    {
                        PointF mapped = MapPoint(points[i], bounds, preview);
                        e.Graphics.FillEllipse(pointBrush, mapped.X - 3, mapped.Y - 3, 6, 6);
                    }
                }
            }
        }

        private static PointF MapPoint(MotionLabPoint point, Rectangle source, Rectangle destination)
        {
            double x = source.Width <= 0 ? 0 : (point.X - source.Left) / source.Width;
            double y = source.Height <= 0 ? 0 : (point.Y - source.Top) / source.Height;
            return new PointF(
                (float)(destination.Left + (x * destination.Width)),
                (float)(destination.Top + (y * destination.Height)));
        }

        private void RefreshUi()
        {
            bool running = IsRunning();
            bool loadSettingsEnabled = !running && _runLoadCheckBox.Checked;
            if (_totalDurationValueLabel != null)
            {
                _totalDurationValueLabel.Text = GetConfiguredTotalDurationMilliseconds().ToString("0") + " ms";
            }

            _generateButton.Enabled = !running;
            _saveButton.Enabled = !running && _scenarioSet != null;
            _startButton.Enabled = !running && _scenarioSet != null;
            _stopButton.Enabled = running;
            _profileInput.Enabled = !running;
            _scenarioCountInput.Enabled = !running;
            _fixedSeedCheckBox.Enabled = !running;
            _seedInput.Enabled = !running && _fixedSeedCheckBox.Checked;
            _controlPointInput.Enabled = !running;
            _speedPointInput.Enabled = !running;
            _durationInput.Enabled = !running;
            _sampleRateInput.Enabled = !running;
            _runLoadCheckBox.Enabled = !running;
            _loadSettingsPanel.Enabled = loadSettingsEnabled;
            _loadPercentInput.Enabled = loadSettingsEnabled;
            _loadWorkerInput.Enabled = loadSettingsEnabled;
            _loadPercentLabel.Enabled = loadSettingsEnabled;
            _loadWorkerLabel.Enabled = loadSettingsEnabled;
            if (!running && _scenarioSet != null)
            {
                _statusLabel.Text = "Generated " + _scenarioSet.GenerationProfile + " seed " + _scenarioSet.Seed.ToString() + ", " + _scenarioSet.Scenarios.Length.ToString() + " scenarios, " + _scenarioSet.ScenarioDurationMilliseconds.ToString("0") + " ms each, " + _scenarioSet.DurationMilliseconds.ToString("0") + " ms total.";
            }
        }

        private bool IsRunning()
        {
            return _timer.Enabled || _recorder != null || (_playbackRunner != null && _playbackRunner.IsRunning);
        }

        private void PlaybackCompleted(object sender, EventArgs e)
        {
            if (IsDisposed)
            {
                return;
            }

            try
            {
                BeginInvoke(new MethodInvoker(StopMotion));
            }
            catch (InvalidOperationException)
            {
            }
        }

        private string SelectedGenerationProfile()
        {
            if (_profileInput != null && _profileInput.SelectedIndex == 0)
            {
                return MotionLabGenerationProfile.RealTraceWeighted;
            }

            return MotionLabGenerationProfile.Balanced;
        }

        private int ResolveSeed(bool refreshRandomSeed)
        {
            if (_fixedSeedCheckBox.Checked || !refreshRandomSeed)
            {
                return (int)_seedInput.Value;
            }

            int seed = MotionLabRandom.CreateSeed();
            _seedInput.Value = Math.Max(_seedInput.Minimum, Math.Min(_seedInput.Maximum, seed));
            return seed;
        }

        private double GetConfiguredTotalDurationMilliseconds()
        {
            if (_scenarioCountInput == null || _durationInput == null)
            {
                return 0;
            }

            return (double)_scenarioCountInput.Value * (double)_durationInput.Value;
        }

        private double GetTotalDurationMilliseconds()
        {
            return _scenarioSet == null ? GetConfiguredTotalDurationMilliseconds() : _scenarioSet.DurationMilliseconds;
        }

        private static Label AddValueRow(TableLayoutPanel layout, int row, string label, string value)
        {
            Label labelControl = new Label();
            labelControl.Text = label;
            labelControl.AutoSize = true;
            labelControl.Anchor = AnchorStyles.Left;
            layout.Controls.Add(labelControl, 0, row);

            Label valueControl = new Label();
            valueControl.Text = value;
            valueControl.AutoSize = true;
            valueControl.Anchor = AnchorStyles.Left;
            layout.Controls.Add(valueControl, 1, row);
            return valueControl;
        }
    }
}
