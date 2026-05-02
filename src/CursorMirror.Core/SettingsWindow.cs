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
        private Label _movingOpacityLabel;
        private Label _fadeDurationLabel;
        private Label _idleDelayLabel;
        private Label _idleFadeOpacityLabel;
        private Label _idleFadeDelaySecondsLabel;
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
            ClientSize = new Size(380, 340);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(12);
            layout.ColumnCount = 2;
            layout.RowCount = 9;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
            Controls.Add(layout);

            _predictionCheckBox = new CheckBox();
            _predictionCheckBox.Text = LocalizedStrings.PredictiveOverlayPositioningLabel;
            _predictionCheckBox.AutoSize = true;
            _predictionCheckBox.CheckedChanged += delegate { ApplyFromControls(); };
            layout.Controls.Add(_predictionCheckBox, 0, 0);
            layout.SetColumnSpan(_predictionCheckBox, 2);

            _movementTranslucencyCheckBox = new CheckBox();
            _movementTranslucencyCheckBox.Text = LocalizedStrings.MovementTranslucencyLabel;
            _movementTranslucencyCheckBox.AutoSize = true;
            _movementTranslucencyCheckBox.CheckedChanged += delegate
            {
                UpdateMovementTranslucencyInputState();
                ApplyFromControls();
            };
            layout.Controls.Add(_movementTranslucencyCheckBox, 0, 1);
            layout.SetColumnSpan(_movementTranslucencyCheckBox, 2);

            _movingOpacityInput = AddNumberRow(layout, 2, LocalizedStrings.MovingOpacityLabel, CursorMirrorSettings.MinimumMovingOpacityPercent, CursorMirrorSettings.MaximumMovingOpacityPercent, out _movingOpacityLabel);
            _fadeDurationInput = AddNumberRow(layout, 3, LocalizedStrings.FadeDurationLabel, CursorMirrorSettings.MinimumFadeDurationMilliseconds, CursorMirrorSettings.MaximumFadeDurationMilliseconds, out _fadeDurationLabel);
            _idleDelayInput = AddNumberRow(layout, 4, LocalizedStrings.IdleDelayLabel, CursorMirrorSettings.MinimumIdleDelayMilliseconds, CursorMirrorSettings.MaximumIdleDelayMilliseconds, out _idleDelayLabel);

            _idleFadeCheckBox = new CheckBox();
            _idleFadeCheckBox.Text = LocalizedStrings.IdleFadeLabel;
            _idleFadeCheckBox.AutoSize = true;
            _idleFadeCheckBox.CheckedChanged += delegate
            {
                UpdateIdleFadeInputState();
                ApplyFromControls();
            };
            layout.Controls.Add(_idleFadeCheckBox, 0, 5);
            layout.SetColumnSpan(_idleFadeCheckBox, 2);

            _idleFadeOpacityInput = AddNumberRow(layout, 6, LocalizedStrings.IdleOpacityLabel, CursorMirrorSettings.MinimumIdleOpacityPercent, CursorMirrorSettings.MaximumIdleOpacityPercent, out _idleFadeOpacityLabel);
            _idleFadeDelaySecondsInput = AddNumberRow(layout, 7, LocalizedStrings.IdleFadeDelayLabel, CursorMirrorSettings.MinimumIdleFadeDelayMilliseconds / 1000, CursorMirrorSettings.MaximumIdleFadeDelayMilliseconds / 1000, out _idleFadeDelaySecondsLabel);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.WrapContents = false;
            layout.Controls.Add(buttons, 0, 8);
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

        private void LoadSettings(CursorMirrorSettings settings)
        {
            _loading = true;
            try
            {
                CursorMirrorSettings normalized = settings.Normalize();
                _predictionCheckBox.Checked = normalized.PredictionEnabled;
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
            settings.MovementTranslucencyEnabled = _movementTranslucencyCheckBox.Checked;
            settings.MovingOpacityPercent = (int)_movingOpacityInput.Value;
            settings.FadeDurationMilliseconds = (int)_fadeDurationInput.Value;
            settings.IdleDelayMilliseconds = (int)_idleDelayInput.Value;
            settings.IdleFadeEnabled = _idleFadeCheckBox.Checked;
            settings.IdleOpacityPercent = (int)_idleFadeOpacityInput.Value;
            settings.IdleFadeDelayMilliseconds = (int)_idleFadeDelaySecondsInput.Value * 1000;
            _controller.UpdateSettings(settings);
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
