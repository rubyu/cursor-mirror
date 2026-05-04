using System;
using System.Drawing;
using System.Windows.Forms;

namespace CursorMirror
{
    public sealed class SettingsWindow : Form
    {
        private readonly SettingsController _controller;
        private readonly CheckBox _predictionCheckBox;
        private readonly CheckBox _movementTranslucencyCheckBox;
        private readonly CheckBox _idleFadeCheckBox;
        private Label _predictionModelLabel;
        private Label _predictionGainLabel;
        private Label _movingOpacityLabel;
        private Label _fadeDurationLabel;
        private Label _idleDelayLabel;
        private Label _idleFadeOpacityLabel;
        private Label _idleFadeDelaySecondsLabel;
        private readonly ComboBox _predictionModelInput;
        private readonly NumericUpDown _predictionGainInput;
        private readonly NumericUpDown _movingOpacityInput;
        private readonly NumericUpDown _fadeDurationInput;
        private readonly NumericUpDown _idleDelayInput;
        private readonly NumericUpDown _idleFadeOpacityInput;
        private readonly NumericUpDown _idleFadeDelaySecondsInput;
        private bool _loading;

        public SettingsWindow(SettingsController controller)
        {
            if (controller == null)
            {
                throw new ArgumentNullException("controller");
            }

            _controller = controller;

            Text = LocalizedStrings.SettingsTitle;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            Icon = AppIcon.Load();
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(420, 404);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(12);
            layout.ColumnCount = 2;
            layout.RowCount = 11;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
            Controls.Add(layout);

            _predictionCheckBox = new CheckBox();
            _predictionCheckBox.Text = LocalizedStrings.PredictiveOverlayPositioningLabel;
            _predictionCheckBox.AutoSize = true;
            _predictionCheckBox.CheckedChanged += delegate
            {
                UpdatePredictionInputState();
                ApplyFromControls();
            };
            layout.Controls.Add(_predictionCheckBox, 0, 0);
            layout.SetColumnSpan(_predictionCheckBox, 2);

            _predictionModelInput = AddComboRow(layout, 1, LocalizedStrings.PredictionModelLabel, out _predictionModelLabel);
            _predictionModelInput.SelectedIndexChanged += delegate { ApplyFromControls(); };

            _predictionGainInput = AddNumberRow(layout, 2, LocalizedStrings.PredictionGainLabel, CursorMirrorSettings.MinimumPredictionGainPercent, CursorMirrorSettings.MaximumPredictionGainPercent, out _predictionGainLabel);

            _movementTranslucencyCheckBox = new CheckBox();
            _movementTranslucencyCheckBox.Text = LocalizedStrings.MovementTranslucencyLabel;
            _movementTranslucencyCheckBox.AutoSize = true;
            _movementTranslucencyCheckBox.CheckedChanged += delegate
            {
                UpdateMovementTranslucencyInputState();
                ApplyFromControls();
            };
            layout.Controls.Add(_movementTranslucencyCheckBox, 0, 3);
            layout.SetColumnSpan(_movementTranslucencyCheckBox, 2);

            _movingOpacityInput = AddNumberRow(layout, 4, LocalizedStrings.MovingOpacityLabel, CursorMirrorSettings.MinimumMovingOpacityPercent, CursorMirrorSettings.MaximumMovingOpacityPercent, out _movingOpacityLabel);
            _fadeDurationInput = AddNumberRow(layout, 5, LocalizedStrings.FadeDurationLabel, CursorMirrorSettings.MinimumFadeDurationMilliseconds, CursorMirrorSettings.MaximumFadeDurationMilliseconds, out _fadeDurationLabel);
            _idleDelayInput = AddNumberRow(layout, 6, LocalizedStrings.IdleDelayLabel, CursorMirrorSettings.MinimumIdleDelayMilliseconds, CursorMirrorSettings.MaximumIdleDelayMilliseconds, out _idleDelayLabel);

            _idleFadeCheckBox = new CheckBox();
            _idleFadeCheckBox.Text = LocalizedStrings.IdleFadeLabel;
            _idleFadeCheckBox.AutoSize = true;
            _idleFadeCheckBox.CheckedChanged += delegate
            {
                UpdateIdleFadeInputState();
                ApplyFromControls();
            };
            layout.Controls.Add(_idleFadeCheckBox, 0, 7);
            layout.SetColumnSpan(_idleFadeCheckBox, 2);

            _idleFadeOpacityInput = AddNumberRow(layout, 8, LocalizedStrings.IdleOpacityLabel, CursorMirrorSettings.MinimumIdleOpacityPercent, CursorMirrorSettings.MaximumIdleOpacityPercent, out _idleFadeOpacityLabel);
            _idleFadeDelaySecondsInput = AddNumberRow(layout, 9, LocalizedStrings.IdleFadeDelayLabel, CursorMirrorSettings.MinimumIdleFadeDelayMilliseconds / 1000, CursorMirrorSettings.MaximumIdleFadeDelayMilliseconds / 1000, out _idleFadeDelaySecondsLabel);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.WrapContents = false;
            layout.Controls.Add(buttons, 0, 10);
            layout.SetColumnSpan(buttons, 2);

            Button exitButton = new Button();
            exitButton.Text = LocalizedStrings.ExitCursorMirrorCommand;
            exitButton.AutoSize = true;
            exitButton.Click += delegate { _controller.Exit(); };
            buttons.Controls.Add(exitButton);

            Button closeButton = new Button();
            closeButton.Text = LocalizedStrings.CloseCommand;
            closeButton.AutoSize = true;
            closeButton.Click += delegate { Hide(); };
            buttons.Controls.Add(closeButton);

            Button resetButton = new Button();
            resetButton.Text = LocalizedStrings.ResetCommand;
            resetButton.AutoSize = true;
            resetButton.Click += delegate
            {
                _controller.ResetToDefaults();
                LoadSettings(_controller.CurrentSettings);
            };
            buttons.Controls.Add(resetButton);

            LoadSettings(_controller.CurrentSettings);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                return;
            }

            base.OnFormClosing(e);
        }

        public void ShowSettings()
        {
            LoadSettings(_controller.CurrentSettings);
            if (Visible)
            {
                Activate();
            }
            else
            {
                Show();
            }
        }

        private NumericUpDown AddNumberRow(TableLayoutPanel layout, int row, string labelText, int minimum, int maximum, out Label label)
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
            input.ValueChanged += delegate { ApplyFromControls(); };
            layout.Controls.Add(input, 1, row);
            return input;
        }

        private ComboBox AddComboRow(TableLayoutPanel layout, int row, string labelText, out Label label)
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

        private void LoadSettings(CursorMirrorSettings settings)
        {
            _loading = true;
            try
            {
                CursorMirrorSettings normalized = settings.Normalize();
                _predictionCheckBox.Checked = normalized.PredictionEnabled;
                ReplacePredictionModelItems(_predictionModelInput, normalized.DwmPredictionModel);
                _predictionGainInput.Value = normalized.PredictionGainPercent;
                _movementTranslucencyCheckBox.Checked = normalized.MovementTranslucencyEnabled;
                _movingOpacityInput.Value = normalized.MovingOpacityPercent;
                _fadeDurationInput.Value = normalized.FadeDurationMilliseconds;
                _idleDelayInput.Value = normalized.IdleDelayMilliseconds;
                _idleFadeCheckBox.Checked = normalized.IdleFadeEnabled;
                _idleFadeOpacityInput.Value = normalized.IdleOpacityPercent;
                _idleFadeDelaySecondsInput.Value = normalized.IdleFadeDelayMilliseconds / 1000;
            }
            finally
            {
                _loading = false;
            }

            UpdatePredictionInputState();
            UpdateMovementTranslucencyInputState();
            UpdateIdleFadeInputState();
        }

        private void ApplyFromControls()
        {
            if (_loading)
            {
                return;
            }

            CursorMirrorSettings settings = _controller.CurrentSettings.Clone();
            settings.PredictionEnabled = _predictionCheckBox.Checked;
            settings.DwmPredictionModel = PredictionModelFromSelection(_predictionModelInput);
            settings.PredictionGainPercent = (int)_predictionGainInput.Value;
            settings.MovementTranslucencyEnabled = _movementTranslucencyCheckBox.Checked;
            settings.MovingOpacityPercent = (int)_movingOpacityInput.Value;
            settings.FadeDurationMilliseconds = (int)_fadeDurationInput.Value;
            settings.IdleDelayMilliseconds = (int)_idleDelayInput.Value;
            settings.IdleFadeEnabled = _idleFadeCheckBox.Checked;
            settings.IdleOpacityPercent = (int)_idleFadeOpacityInput.Value;
            settings.IdleFadeDelayMilliseconds = (int)_idleFadeDelaySecondsInput.Value * 1000;
            _controller.UpdateSettings(settings);
        }

        private void UpdatePredictionInputState()
        {
            bool enabled = _predictionCheckBox.Checked;
            _predictionModelLabel.Enabled = enabled;
            _predictionModelInput.Enabled = enabled;
            _predictionGainLabel.Enabled = enabled;
            _predictionGainInput.Enabled = enabled;
        }

        private static void ReplacePredictionModelItems(ComboBox comboBox, int selectedModel)
        {
            comboBox.BeginUpdate();
            try
            {
                comboBox.Items.Clear();
                comboBox.Items.Add(LocalizedStrings.PredictionModelOptionText(CursorMirrorSettings.DwmPredictionModelConstantVelocity));
                comboBox.Items.Add(LocalizedStrings.PredictionModelOptionText(CursorMirrorSettings.DwmPredictionModelLeastSquares));
                comboBox.Items.Add(LocalizedStrings.PredictionModelOptionText(CursorMirrorSettings.DwmPredictionModelExperimentalMlp));
                comboBox.Items.Add(LocalizedStrings.PredictionModelOptionText(CursorMirrorSettings.DwmPredictionModelDistilledMlp));
                comboBox.SelectedIndex = PredictionModelIndex(selectedModel);
            }
            finally
            {
                comboBox.EndUpdate();
            }
        }

        private static int PredictionModelFromSelection(ComboBox comboBox)
        {
            if (comboBox.SelectedIndex == 1)
            {
                return CursorMirrorSettings.DwmPredictionModelLeastSquares;
            }

            if (comboBox.SelectedIndex == 2)
            {
                return CursorMirrorSettings.DwmPredictionModelExperimentalMlp;
            }

            if (comboBox.SelectedIndex == 3)
            {
                return CursorMirrorSettings.DwmPredictionModelDistilledMlp;
            }

            return CursorMirrorSettings.DwmPredictionModelConstantVelocity;
        }

        private static int PredictionModelIndex(int model)
        {
            if (model == CursorMirrorSettings.DwmPredictionModelLeastSquares)
            {
                return 1;
            }

            if (model == CursorMirrorSettings.DwmPredictionModelExperimentalMlp)
            {
                return 2;
            }

            if (model == CursorMirrorSettings.DwmPredictionModelDistilledMlp)
            {
                return 3;
            }

            return 0;
        }

        private void UpdateIdleFadeInputState()
        {
            bool enabled = _idleFadeCheckBox.Checked;
            _idleFadeOpacityLabel.Enabled = enabled;
            _idleFadeOpacityInput.Enabled = enabled;
            _idleFadeDelaySecondsLabel.Enabled = enabled;
            _idleFadeDelaySecondsInput.Enabled = enabled;
        }

        private void UpdateMovementTranslucencyInputState()
        {
            bool enabled = _movementTranslucencyCheckBox.Checked;
            _movingOpacityLabel.Enabled = enabled;
            _movingOpacityInput.Enabled = enabled;
            _fadeDurationLabel.Enabled = enabled;
            _fadeDurationInput.Enabled = enabled;
            _idleDelayLabel.Enabled = enabled;
            _idleDelayInput.Enabled = enabled;
        }
    }
}
