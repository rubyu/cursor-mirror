using System;
using System.ComponentModel;
using System.Drawing;
using System.Windows.Forms;

namespace CursorMirror.Demo
{
    public sealed class DemoForm : Form
    {
        private static readonly Size StartupClientSize = new Size(560, 664);
        private readonly DemoSettingsStore _settingsStore;
        private readonly Panel _startPanel;
        private readonly DemoSceneControl _scene;
        private readonly Label _languageLabel;
        private readonly Label _displayModeLabel;
        private readonly Label _speedLabel;
        private readonly Label _predictionModelLabel;
        private readonly Label _predictionGainLabel;
        private readonly Label _predictionTargetOffsetLabel;
        private readonly Label _movingOpacityLabel;
        private readonly Label _fadeDurationLabel;
        private readonly Label _idleDelayLabel;
        private readonly Label _idleFadeOpacityLabel;
        private readonly Label _idleFadeDurationLabel;
        private readonly Label _idleFadeDelayLabel;
        private readonly ComboBox _languageInput;
        private readonly ComboBox _displayModeInput;
        private readonly ComboBox _speedInput;
        private readonly ComboBox _predictionModelInput;
        private readonly CheckBox _mirrorCursorCheckBox;
        private readonly CheckBox _predictionCheckBox;
        private readonly CheckBox _movementTranslucencyCheckBox;
        private readonly CheckBox _idleFadeCheckBox;
        private readonly NumericUpDown _predictionGainInput;
        private readonly NumericUpDown _predictionTargetOffsetInput;
        private readonly NumericUpDown _movingOpacityInput;
        private readonly NumericUpDown _fadeDurationInput;
        private readonly NumericUpDown _idleDelayInput;
        private readonly NumericUpDown _idleFadeOpacityInput;
        private readonly NumericUpDown _idleFadeDurationInput;
        private readonly NumericUpDown _idleFadeDelayInput;
        private readonly Label _noteLabel;
        private readonly Button _exitButton;
        private readonly Button _startButton;
        private bool _loading;
        private bool _demoRunning;

        public DemoForm()
            : this(new DemoSettingsStore())
        {
        }

        public DemoForm(DemoSettingsStore settingsStore)
            : this(settingsStore, LoadAndApplyLanguage(settingsStore))
        {
        }

        public DemoForm(DemoSettingsStore settingsStore, DemoSettings initialSettings)
        {
            if (settingsStore == null)
            {
                throw new ArgumentNullException("settingsStore");
            }

            _settingsStore = settingsStore;

            Text = LocalizedStrings.DemoToolTitle;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            KeyPreview = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = StartupClientSize;

            _scene = new DemoSceneControl();
            _scene.Dock = DockStyle.Fill;
            _scene.Visible = false;
            Controls.Add(_scene);

            _startPanel = new Panel();
            _startPanel.Dock = DockStyle.Fill;
            _startPanel.BackColor = Color.White;
            Controls.Add(_startPanel);
            _startPanel.BringToFront();

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(14);
            layout.ColumnCount = 2;
            layout.RowCount = 18;
            layout.GrowStyle = TableLayoutPanelGrowStyle.FixedSize;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55));
            ConfigureRows(layout);
            _startPanel.Controls.Add(layout);

            _languageInput = CursorMirrorFormLayout.AddComboRow(layout, 0, string.Empty, out _languageLabel);
            _languageInput.SelectedIndexChanged += delegate { LanguageSelectionChanged(); };
            _displayModeInput = CursorMirrorFormLayout.AddComboRow(layout, 1, string.Empty, out _displayModeLabel);
            _displayModeInput.SelectedIndexChanged += delegate { SaveCurrentSettings(); };
            _speedInput = CursorMirrorFormLayout.AddComboRow(layout, 2, string.Empty, out _speedLabel);
            _speedInput.SelectedIndexChanged += delegate { SaveCurrentSettings(); };

            _mirrorCursorCheckBox = CursorMirrorFormLayout.AddCheckBoxRow(layout, 3, string.Empty);
            _mirrorCursorCheckBox.CheckedChanged += delegate
            {
                UpdateMirrorDependentControls();
                SaveCurrentSettings();
            };
            _predictionCheckBox = CursorMirrorFormLayout.AddCheckBoxRow(layout, 4, string.Empty);
            _predictionCheckBox.CheckedChanged += delegate
            {
                UpdateMirrorDependentControls();
                SaveCurrentSettings();
            };
            _predictionModelInput = CursorMirrorFormLayout.AddComboRow(layout, 5, string.Empty, out _predictionModelLabel);
            _predictionModelInput.SelectedIndexChanged += delegate { PredictionModelSelectionChanged(); };
            _predictionGainInput = CursorMirrorFormLayout.AddNumberRow(layout, 6, string.Empty, CursorMirrorSettingRanges.PredictionGain, out _predictionGainLabel);
            _predictionGainInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _predictionTargetOffsetInput = CursorMirrorFormLayout.AddNumberRow(layout, 7, string.Empty, CursorMirrorSettingRanges.DwmPredictionTargetOffsetDisplay, out _predictionTargetOffsetLabel);
            _predictionTargetOffsetInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _movementTranslucencyCheckBox = CursorMirrorFormLayout.AddCheckBoxRow(layout, 8, string.Empty);
            _movementTranslucencyCheckBox.CheckedChanged += delegate
            {
                UpdateMirrorDependentControls();
                SaveCurrentSettings();
            };
            _movingOpacityInput = CursorMirrorFormLayout.AddNumberRow(layout, 9, string.Empty, CursorMirrorSettingRanges.MovingOpacity, out _movingOpacityLabel);
            _movingOpacityInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _fadeDurationInput = CursorMirrorFormLayout.AddNumberRow(layout, 10, string.Empty, CursorMirrorSettingRanges.FadeDuration, out _fadeDurationLabel);
            _fadeDurationInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _idleDelayInput = CursorMirrorFormLayout.AddNumberRow(layout, 11, string.Empty, CursorMirrorSettingRanges.IdleDelay, out _idleDelayLabel);
            _idleDelayInput.ValueChanged += delegate { SaveCurrentSettings(); };

            _idleFadeCheckBox = CursorMirrorFormLayout.AddCheckBoxRow(layout, 12, string.Empty);
            _idleFadeCheckBox.CheckedChanged += delegate
            {
                UpdateMirrorDependentControls();
                SaveCurrentSettings();
            };
            _idleFadeOpacityInput = CursorMirrorFormLayout.AddNumberRow(layout, 13, string.Empty, CursorMirrorSettingRanges.IdleOpacity, out _idleFadeOpacityLabel);
            _idleFadeOpacityInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _idleFadeDurationInput = CursorMirrorFormLayout.AddNumberRow(layout, 14, string.Empty, CursorMirrorSettingRanges.IdleFadeDuration, out _idleFadeDurationLabel);
            _idleFadeDurationInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _idleFadeDelayInput = CursorMirrorFormLayout.AddNumberRow(layout, 15, string.Empty, CursorMirrorSettingRanges.IdleFadeDelay, out _idleFadeDelayLabel);
            _idleFadeDelayInput.ValueChanged += delegate { SaveCurrentSettings(); };

            _noteLabel = new Label();
            _noteLabel.AutoSize = false;
            _noteLabel.Dock = DockStyle.Fill;
            _noteLabel.Padding = new Padding(0, 8, 0, 0);
            _noteLabel.TextAlign = ContentAlignment.TopLeft;
            layout.Controls.Add(_noteLabel, 0, 16);
            layout.SetColumnSpan(_noteLabel, 2);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.WrapContents = false;
            layout.Controls.Add(buttons, 0, 17);
            layout.SetColumnSpan(buttons, 2);

            _exitButton = new Button();
            _exitButton.AutoSize = true;
            _exitButton.Click += delegate { Close(); };
            buttons.Controls.Add(_exitButton);

            _startButton = new Button();
            _startButton.AutoSize = true;
            _startButton.Click += delegate { StartDemo(); };
            buttons.Controls.Add(_startButton);

            AcceptButton = _startButton;
            CancelButton = _exitButton;
            ApplyLocalizedTexts();
            LoadSettings(initialSettings);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (_demoRunning)
            {
                StopDemo();
                return true;
            }

            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (_demoRunning)
            {
                StopDemo();
                e.Handled = true;
                return;
            }

            base.OnKeyDown(e);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            StopDemo();
            base.OnFormClosing(e);
        }

        private static DemoSettings LoadAndApplyLanguage(DemoSettingsStore settingsStore)
        {
            if (settingsStore == null)
            {
                throw new ArgumentNullException("settingsStore");
            }

            DemoSettings settings = settingsStore.Load();
            DemoLanguage.Apply(settings.Language);
            return settings;
        }

        private static void ConfigureRows(TableLayoutPanel layout)
        {
            layout.RowStyles.Clear();
            for (int row = 0; row < 16; row++)
            {
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            }

            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        }

        private void LoadSettings(DemoSettings settings)
        {
            _loading = true;
            try
            {
                DemoSettings normalized = (settings ?? DemoSettings.Default()).Normalize();
                CursorMirrorSettings cursorSettings = normalized.CursorSettings.Normalize();
                _languageInput.SelectedIndex = LanguageIndex(normalized.Language);
                _displayModeInput.SelectedIndex = normalized.DisplayModeIndex;
                _speedInput.SelectedIndex = normalized.SpeedIndex;
                _mirrorCursorCheckBox.Checked = normalized.MirrorCursorEnabled;
                _predictionCheckBox.Checked = cursorSettings.PredictionEnabled;
                ReplacePredictionModelItems(_predictionModelInput, cursorSettings.DwmPredictionModel);
                _predictionGainInput.Value = cursorSettings.PredictionGainPercent;
                _predictionTargetOffsetInput.Value =
                    CursorMirrorSettings.DwmPredictionTargetOffsetToDisplayMilliseconds(cursorSettings.DwmPredictionTargetOffsetMilliseconds);
                _movementTranslucencyCheckBox.Checked = cursorSettings.MovementTranslucencyEnabled;
                _movingOpacityInput.Value = cursorSettings.MovingOpacityPercent;
                _fadeDurationInput.Value = cursorSettings.FadeDurationMilliseconds;
                _idleDelayInput.Value = cursorSettings.IdleDelayMilliseconds;
                _idleFadeCheckBox.Checked = cursorSettings.IdleFadeEnabled;
                _idleFadeOpacityInput.Value = cursorSettings.IdleOpacityPercent;
                _idleFadeDurationInput.Value = cursorSettings.IdleFadeDurationMilliseconds;
                _idleFadeDelayInput.Value = cursorSettings.IdleFadeDelayMilliseconds;
            }
            finally
            {
                _loading = false;
            }

            UpdateMirrorDependentControls();
        }

        private void StartDemo()
        {
            try
            {
                SaveCurrentSettings();
                bool mirrorCursorEnabled = _mirrorCursorCheckBox.Checked;
                if (mirrorCursorEnabled && !ResolveMainAppConflict())
                {
                    return;
                }

                CursorMirrorSettings settings = BuildCursorSettingsFromControls();

                ApplyDisplayMode();
                _startPanel.Visible = false;
                _scene.Visible = true;
                _scene.BringToFront();
                _demoRunning = true;
                _scene.StartDemo(SelectedSpeed(), settings, mirrorCursorEnabled);
            }
            catch (Win32Exception ex)
            {
                StopDemo();
                MessageBox.Show(this, ex.Message, LocalizedStrings.DemoToolTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private bool ResolveMainAppConflict()
        {
            if (!DemoMainAppConflict.IsDetected())
            {
                return true;
            }

            DialogResult result = MessageBox.Show(
                this,
                LocalizedStrings.DemoMainAppRunningMessage,
                LocalizedStrings.DemoToolTitle,
                MessageBoxButtons.YesNoCancel,
                MessageBoxIcon.Warning);

            if (result == DialogResult.Cancel)
            {
                return false;
            }

            if (result == DialogResult.No)
            {
                return true;
            }

            if (DemoMainAppConflict.RequestShutdownAndWait())
            {
                return true;
            }

            MessageBox.Show(
                this,
                LocalizedStrings.DemoMainAppShutdownFailedMessage,
                LocalizedStrings.DemoToolTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return false;
        }

        private void StopDemo()
        {
            if (!_demoRunning)
            {
                return;
            }

            _scene.StopDemo();
            _demoRunning = false;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = StartupClientSize;
            CenterToScreen();
            _scene.Visible = false;
            _startPanel.Visible = true;
            _startPanel.BringToFront();
        }

        private void UpdateMirrorDependentControls()
        {
            DemoOverlayControlState state = DemoOverlayControlState.From(
                _mirrorCursorCheckBox.Checked,
                _predictionCheckBox.Checked,
                _movementTranslucencyCheckBox.Checked,
                _idleFadeCheckBox.Checked);

            _predictionCheckBox.Enabled = state.OverlaySettingsEnabled;
            _predictionModelLabel.Enabled = state.PredictionModelEnabled;
            _predictionModelInput.Enabled = state.PredictionModelEnabled;
            _predictionGainLabel.Enabled = state.PredictionGainEnabled;
            _predictionGainInput.Enabled = state.PredictionGainEnabled;
            _predictionTargetOffsetLabel.Enabled = state.PredictionGainEnabled;
            _predictionTargetOffsetInput.Enabled = state.PredictionGainEnabled;

            _movementTranslucencyCheckBox.Enabled = state.OverlaySettingsEnabled;
            _movingOpacityLabel.Enabled = state.MovementTranslucencyInputsEnabled;
            _movingOpacityInput.Enabled = state.MovementTranslucencyInputsEnabled;
            _fadeDurationLabel.Enabled = state.MovementTranslucencyInputsEnabled;
            _fadeDurationInput.Enabled = state.MovementTranslucencyInputsEnabled;
            _idleDelayLabel.Enabled = state.MovementTranslucencyInputsEnabled;
            _idleDelayInput.Enabled = state.MovementTranslucencyInputsEnabled;

            _idleFadeCheckBox.Enabled = state.OverlaySettingsEnabled;
            _idleFadeOpacityLabel.Enabled = state.IdleFadeInputsEnabled;
            _idleFadeOpacityInput.Enabled = state.IdleFadeInputsEnabled;
            _idleFadeDurationLabel.Enabled = state.IdleFadeInputsEnabled;
            _idleFadeDurationInput.Enabled = state.IdleFadeInputsEnabled;
            _idleFadeDelayLabel.Enabled = state.IdleFadeInputsEnabled;
            _idleFadeDelayInput.Enabled = state.IdleFadeInputsEnabled;
        }

        private void LanguageSelectionChanged()
        {
            if (_loading)
            {
                return;
            }

            DemoLanguage.Apply(SelectedLanguage());
            ApplyLocalizedTexts();
            SaveCurrentSettings();
        }

        private void ApplyLocalizedTexts()
        {
            bool wasLoading = _loading;
            _loading = true;
            try
            {
                Text = LocalizedStrings.DemoToolTitle;
                _languageLabel.Text = LocalizedStrings.DemoLanguageLabel;
                _displayModeLabel.Text = LocalizedStrings.DemoDisplayModeLabel;
                _speedLabel.Text = LocalizedStrings.DemoSpeedLabel;
                _mirrorCursorCheckBox.Text = LocalizedStrings.DemoMirrorCursorLabel;
                _predictionCheckBox.Text = LocalizedStrings.PredictiveOverlayPositioningLabel;
                _predictionModelLabel.Text = LocalizedStrings.PredictionModelLabel;
                _predictionGainLabel.Text = LocalizedStrings.PredictionGainLabel;
                _predictionTargetOffsetLabel.Text = LocalizedStrings.PredictionTargetOffsetLabel;
                _movementTranslucencyCheckBox.Text = LocalizedStrings.MovementTranslucencyLabel;
                _movingOpacityLabel.Text = LocalizedStrings.MovingOpacityLabel;
                _fadeDurationLabel.Text = LocalizedStrings.FadeDurationLabel;
                _idleDelayLabel.Text = LocalizedStrings.IdleDelayLabel;
                _idleFadeCheckBox.Text = LocalizedStrings.IdleFadeLabel;
                _idleFadeOpacityLabel.Text = LocalizedStrings.IdleOpacityLabel;
                _idleFadeDurationLabel.Text = LocalizedStrings.IdleFadeDurationLabel;
                _idleFadeDelayLabel.Text = LocalizedStrings.IdleFadeDelayLabel;
                _noteLabel.Text = LocalizedStrings.DemoRealCursorNote;
                _exitButton.Text = LocalizedStrings.ExitCommand;
                _startButton.Text = LocalizedStrings.DemoStartCommand;

                CursorMirrorFormLayout.ReplaceItems(
                    _languageInput,
                    _languageInput.SelectedIndex,
                    LocalizedStrings.DemoLanguageSystem,
                    LocalizedStrings.DemoLanguageEnglish,
                    LocalizedStrings.DemoLanguageJapanese);
                CursorMirrorFormLayout.ReplaceItems(
                    _displayModeInput,
                    _displayModeInput.SelectedIndex,
                    LocalizedStrings.DemoWindowPresetVga,
                    LocalizedStrings.DemoWindowPreset720,
                    LocalizedStrings.DemoWindowPreset1080,
                    LocalizedStrings.DemoFullscreenOption);
                CursorMirrorFormLayout.ReplaceItems(
                    _speedInput,
                    _speedInput.SelectedIndex,
                    LocalizedStrings.DemoSpeedNormal,
                    LocalizedStrings.DemoSpeedSlow,
                    LocalizedStrings.DemoSpeedFast);
                ReplacePredictionModelItems(_predictionModelInput, PredictionModelFromSelection(_predictionModelInput));
            }
            finally
            {
                _loading = wasLoading;
            }

            _scene.Invalidate();
        }

        private void SaveCurrentSettings()
        {
            if (_loading)
            {
                return;
            }

            _settingsStore.Save(BuildDemoSettingsFromControls());
        }

        private void PredictionModelSelectionChanged()
        {
            UpdateMirrorDependentControls();
            SaveCurrentSettings();
        }

        private DemoSettings BuildDemoSettingsFromControls()
        {
            CursorMirrorSettings cursorSettings = BuildCursorSettingsFromControls();

            DemoSettings settings = DemoSettings.Default();
            settings.Language = SelectedLanguage();
            settings.DisplayModeIndex = SafeSelectedIndex(_displayModeInput);
            settings.SpeedIndex = SafeSelectedIndex(_speedInput);
            settings.MirrorCursorEnabled = _mirrorCursorCheckBox.Checked;
            settings.CursorSettings = cursorSettings;
            return settings.Normalize();
        }

        private CursorMirrorSettings BuildCursorSettingsFromControls()
        {
            CursorMirrorSettings cursorSettings = CursorMirrorSettings.Default();
            cursorSettings.PredictionEnabled = _predictionCheckBox.Checked;
            cursorSettings.DwmPredictionModel = PredictionModelFromSelection(_predictionModelInput);
            cursorSettings.PredictionGainPercent = (int)_predictionGainInput.Value;
            cursorSettings.DwmPredictionTargetOffsetMilliseconds =
                CursorMirrorSettings.DwmPredictionTargetOffsetFromDisplayMilliseconds((int)_predictionTargetOffsetInput.Value);
            cursorSettings.MovementTranslucencyEnabled = _movementTranslucencyCheckBox.Checked;
            cursorSettings.MovingOpacityPercent = (int)_movingOpacityInput.Value;
            cursorSettings.FadeDurationMilliseconds = (int)_fadeDurationInput.Value;
            cursorSettings.IdleDelayMilliseconds = (int)_idleDelayInput.Value;
            cursorSettings.IdleFadeEnabled = _idleFadeCheckBox.Checked;
            cursorSettings.IdleOpacityPercent = (int)_idleFadeOpacityInput.Value;
            cursorSettings.IdleFadeDurationMilliseconds = (int)_idleFadeDurationInput.Value;
            cursorSettings.IdleFadeDelayMilliseconds = (int)_idleFadeDelayInput.Value;
            return cursorSettings.Normalize();
        }

        private string SelectedLanguage()
        {
            switch (_languageInput.SelectedIndex)
            {
                case 1:
                    return DemoLanguage.English;
                case 2:
                    return DemoLanguage.Japanese;
                default:
                    return DemoLanguage.Auto;
            }
        }

        private static int LanguageIndex(string language)
        {
            switch (DemoLanguage.Normalize(language))
            {
                case DemoLanguage.English:
                    return 1;
                case DemoLanguage.Japanese:
                    return 2;
                default:
                    return 0;
            }
        }

        private static int SafeSelectedIndex(ComboBox comboBox)
        {
            return comboBox.SelectedIndex < 0 ? 0 : comboBox.SelectedIndex;
        }

        private static void ReplacePredictionModelItems(ComboBox comboBox, int selectedModel)
        {
            PredictionModelOptions.ReplaceItems(comboBox, selectedModel);
        }

        private static int PredictionModelFromSelection(ComboBox comboBox)
        {
            return PredictionModelOptions.FromSelection(comboBox);
        }

        private static int PredictionModelIndex(int model)
        {
            return PredictionModelOptions.IndexOf(model);
        }

        private void ApplyDisplayMode()
        {
            if (_displayModeInput.SelectedIndex == 3)
            {
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.None;
                MaximizeBox = false;
                MinimizeBox = false;
                WindowState = FormWindowState.Maximized;
                return;
            }

            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            switch (_displayModeInput.SelectedIndex)
            {
                case 0:
                    ClientSize = new Size(640, 480);
                    break;
                case 2:
                    ClientSize = new Size(1920, 1080);
                    break;
                default:
                    ClientSize = new Size(1280, 720);
                    break;
            }

            CenterToScreen();
        }

        private DemoPointerSpeed SelectedSpeed()
        {
            if (_speedInput.SelectedIndex == 1)
            {
                return DemoPointerSpeed.Slow;
            }

            if (_speedInput.SelectedIndex == 2)
            {
                return DemoPointerSpeed.Fast;
            }

            return DemoPointerSpeed.Normal;
        }
    }
}
