using System;
using System.ComponentModel;
using System.Drawing;
using System.Windows.Forms;

namespace CursorMirror.Demo
{
    public sealed class DemoForm : Form
    {
        private static readonly Size StartupClientSize = new Size(560, 572);
        private readonly DemoSettingsStore _settingsStore;
        private readonly Panel _startPanel;
        private readonly DemoSceneControl _scene;
        private readonly Label _languageLabel;
        private readonly Label _displayModeLabel;
        private readonly Label _speedLabel;
        private readonly Label _predictionGainLabel;
        private readonly Label _movingOpacityLabel;
        private readonly Label _fadeDurationLabel;
        private readonly Label _idleDelayLabel;
        private readonly Label _idleFadeOpacityLabel;
        private readonly Label _idleFadeDelayLabel;
        private readonly ComboBox _languageInput;
        private readonly ComboBox _displayModeInput;
        private readonly ComboBox _speedInput;
        private readonly CheckBox _mirrorCursorCheckBox;
        private readonly CheckBox _predictionCheckBox;
        private readonly CheckBox _movementTranslucencyCheckBox;
        private readonly CheckBox _idleFadeCheckBox;
        private readonly NumericUpDown _predictionGainInput;
        private readonly NumericUpDown _movingOpacityInput;
        private readonly NumericUpDown _fadeDurationInput;
        private readonly NumericUpDown _idleDelayInput;
        private readonly NumericUpDown _idleFadeOpacityInput;
        private readonly NumericUpDown _idleFadeDelaySecondsInput;
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
            layout.RowCount = 15;
            layout.GrowStyle = TableLayoutPanelGrowStyle.FixedSize;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55));
            ConfigureRows(layout);
            _startPanel.Controls.Add(layout);

            _languageInput = AddComboRow(layout, 0, string.Empty, out _languageLabel);
            _languageInput.SelectedIndexChanged += delegate { LanguageSelectionChanged(); };
            _displayModeInput = AddComboRow(layout, 1, string.Empty, out _displayModeLabel);
            _displayModeInput.SelectedIndexChanged += delegate { SaveCurrentSettings(); };
            _speedInput = AddComboRow(layout, 2, string.Empty, out _speedLabel);
            _speedInput.SelectedIndexChanged += delegate { SaveCurrentSettings(); };

            _mirrorCursorCheckBox = AddCheckBox(layout, 3, string.Empty);
            _mirrorCursorCheckBox.CheckedChanged += delegate
            {
                UpdateMirrorDependentControls();
                SaveCurrentSettings();
            };
            _predictionCheckBox = AddCheckBox(layout, 4, string.Empty);
            _predictionCheckBox.CheckedChanged += delegate
            {
                UpdateMirrorDependentControls();
                SaveCurrentSettings();
            };
            _predictionGainInput = AddNumberRow(layout, 5, string.Empty, CursorMirrorSettings.MinimumPredictionGainPercent, CursorMirrorSettings.MaximumPredictionGainPercent, out _predictionGainLabel);
            _predictionGainInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _movementTranslucencyCheckBox = AddCheckBox(layout, 6, string.Empty);
            _movementTranslucencyCheckBox.CheckedChanged += delegate
            {
                UpdateMirrorDependentControls();
                SaveCurrentSettings();
            };
            _movingOpacityInput = AddNumberRow(layout, 7, string.Empty, CursorMirrorSettings.MinimumMovingOpacityPercent, CursorMirrorSettings.MaximumMovingOpacityPercent, out _movingOpacityLabel);
            _movingOpacityInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _fadeDurationInput = AddNumberRow(layout, 8, string.Empty, CursorMirrorSettings.MinimumFadeDurationMilliseconds, CursorMirrorSettings.MaximumFadeDurationMilliseconds, out _fadeDurationLabel);
            _fadeDurationInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _idleDelayInput = AddNumberRow(layout, 9, string.Empty, CursorMirrorSettings.MinimumIdleDelayMilliseconds, CursorMirrorSettings.MaximumIdleDelayMilliseconds, out _idleDelayLabel);
            _idleDelayInput.ValueChanged += delegate { SaveCurrentSettings(); };

            _idleFadeCheckBox = AddCheckBox(layout, 10, string.Empty);
            _idleFadeCheckBox.CheckedChanged += delegate
            {
                UpdateMirrorDependentControls();
                SaveCurrentSettings();
            };
            _idleFadeOpacityInput = AddNumberRow(layout, 11, string.Empty, CursorMirrorSettings.MinimumIdleOpacityPercent, CursorMirrorSettings.MaximumIdleOpacityPercent, out _idleFadeOpacityLabel);
            _idleFadeOpacityInput.ValueChanged += delegate { SaveCurrentSettings(); };
            _idleFadeDelaySecondsInput = AddNumberRow(layout, 12, string.Empty, CursorMirrorSettings.MinimumIdleFadeDelayMilliseconds / 1000, CursorMirrorSettings.MaximumIdleFadeDelayMilliseconds / 1000, out _idleFadeDelayLabel);
            _idleFadeDelaySecondsInput.ValueChanged += delegate { SaveCurrentSettings(); };

            _noteLabel = new Label();
            _noteLabel.AutoSize = false;
            _noteLabel.Dock = DockStyle.Fill;
            _noteLabel.Padding = new Padding(0, 8, 0, 0);
            _noteLabel.TextAlign = ContentAlignment.TopLeft;
            layout.Controls.Add(_noteLabel, 0, 13);
            layout.SetColumnSpan(_noteLabel, 2);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.WrapContents = false;
            layout.Controls.Add(buttons, 0, 14);
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

        private static ComboBox AddComboRow(TableLayoutPanel layout, int row, string labelText, out Label label)
        {
            label = new Label();
            label.Text = labelText;
            label.AutoSize = true;
            label.Anchor = AnchorStyles.Left;
            layout.Controls.Add(label, 0, row);

            ComboBox input = new ComboBox();
            input.DropDownStyle = ComboBoxStyle.DropDownList;
            input.Anchor = AnchorStyles.Left | AnchorStyles.Right;
            layout.Controls.Add(input, 1, row);
            return input;
        }

        private static void ConfigureRows(TableLayoutPanel layout)
        {
            layout.RowStyles.Clear();
            for (int row = 0; row < 13; row++)
            {
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            }

            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        }

        private static CheckBox AddCheckBox(TableLayoutPanel layout, int row, string text)
        {
            CheckBox checkBox = new CheckBox();
            checkBox.Text = text;
            checkBox.AutoSize = true;
            checkBox.Anchor = AnchorStyles.Left;
            layout.Controls.Add(checkBox, 0, row);
            layout.SetColumnSpan(checkBox, 2);
            return checkBox;
        }

        private static NumericUpDown AddNumberRow(TableLayoutPanel layout, int row, string labelText, int minimum, int maximum, out Label label)
        {
            label = new Label();
            label.Text = labelText;
            label.AutoSize = true;
            label.Anchor = AnchorStyles.Left;
            layout.Controls.Add(label, 0, row);

            NumericUpDown input = new NumericUpDown();
            input.Minimum = minimum;
            input.Maximum = maximum;
            input.DecimalPlaces = 0;
            input.Anchor = AnchorStyles.Left | AnchorStyles.Right;
            layout.Controls.Add(input, 1, row);
            return input;
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
                _predictionGainInput.Value = cursorSettings.PredictionGainPercent;
                _movementTranslucencyCheckBox.Checked = cursorSettings.MovementTranslucencyEnabled;
                _movingOpacityInput.Value = cursorSettings.MovingOpacityPercent;
                _fadeDurationInput.Value = cursorSettings.FadeDurationMilliseconds;
                _idleDelayInput.Value = cursorSettings.IdleDelayMilliseconds;
                _idleFadeCheckBox.Checked = cursorSettings.IdleFadeEnabled;
                _idleFadeOpacityInput.Value = cursorSettings.IdleOpacityPercent;
                _idleFadeDelaySecondsInput.Value = cursorSettings.IdleFadeDelayMilliseconds / 1000;
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
            _predictionGainLabel.Enabled = state.PredictionGainEnabled;
            _predictionGainInput.Enabled = state.PredictionGainEnabled;

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
            _idleFadeDelayLabel.Enabled = state.IdleFadeInputsEnabled;
            _idleFadeDelaySecondsInput.Enabled = state.IdleFadeInputsEnabled;
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
                _predictionGainLabel.Text = LocalizedStrings.PredictionGainLabel;
                _movementTranslucencyCheckBox.Text = LocalizedStrings.MovementTranslucencyLabel;
                _movingOpacityLabel.Text = LocalizedStrings.MovingOpacityLabel;
                _fadeDurationLabel.Text = LocalizedStrings.FadeDurationLabel;
                _idleDelayLabel.Text = LocalizedStrings.IdleDelayLabel;
                _idleFadeCheckBox.Text = LocalizedStrings.IdleFadeLabel;
                _idleFadeOpacityLabel.Text = LocalizedStrings.IdleOpacityLabel;
                _idleFadeDelayLabel.Text = LocalizedStrings.IdleFadeDelayLabel;
                _noteLabel.Text = LocalizedStrings.DemoRealCursorNote;
                _exitButton.Text = LocalizedStrings.ExitCommand;
                _startButton.Text = LocalizedStrings.DemoStartCommand;

                ReplaceItems(
                    _languageInput,
                    _languageInput.SelectedIndex,
                    LocalizedStrings.DemoLanguageSystem,
                    LocalizedStrings.DemoLanguageEnglish,
                    LocalizedStrings.DemoLanguageJapanese);
                ReplaceItems(
                    _displayModeInput,
                    _displayModeInput.SelectedIndex,
                    LocalizedStrings.DemoWindowPresetVga,
                    LocalizedStrings.DemoWindowPreset720,
                    LocalizedStrings.DemoWindowPreset1080,
                    LocalizedStrings.DemoFullscreenOption);
                ReplaceItems(
                    _speedInput,
                    _speedInput.SelectedIndex,
                    LocalizedStrings.DemoSpeedNormal,
                    LocalizedStrings.DemoSpeedSlow,
                    LocalizedStrings.DemoSpeedFast);
            }
            finally
            {
                _loading = wasLoading;
            }

            _scene.Invalidate();
        }

        private static void ReplaceItems(ComboBox comboBox, int selectedIndex, params string[] items)
        {
            comboBox.BeginUpdate();
            try
            {
                comboBox.Items.Clear();
                for (int i = 0; i < items.Length; i++)
                {
                    comboBox.Items.Add(items[i]);
                }

                if (items.Length == 0)
                {
                    comboBox.SelectedIndex = -1;
                    return;
                }

                int safeIndex = selectedIndex < 0 ? 0 : Math.Min(selectedIndex, items.Length - 1);
                comboBox.SelectedIndex = safeIndex;
            }
            finally
            {
                comboBox.EndUpdate();
            }
        }

        private void SaveCurrentSettings()
        {
            if (_loading)
            {
                return;
            }

            _settingsStore.Save(BuildDemoSettingsFromControls());
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
            cursorSettings.PredictionGainPercent = (int)_predictionGainInput.Value;
            cursorSettings.MovementTranslucencyEnabled = _movementTranslucencyCheckBox.Checked;
            cursorSettings.MovingOpacityPercent = (int)_movingOpacityInput.Value;
            cursorSettings.FadeDurationMilliseconds = (int)_fadeDurationInput.Value;
            cursorSettings.IdleDelayMilliseconds = (int)_idleDelayInput.Value;
            cursorSettings.IdleFadeEnabled = _idleFadeCheckBox.Checked;
            cursorSettings.IdleOpacityPercent = (int)_idleFadeOpacityInput.Value;
            cursorSettings.IdleFadeDelayMilliseconds = (int)_idleFadeDelaySecondsInput.Value * 1000;
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
