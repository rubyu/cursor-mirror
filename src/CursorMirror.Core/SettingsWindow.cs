using System;
using System.Drawing;
using System.Windows.Forms;

namespace CursorMirror
{
    public sealed class SettingsWindow : Form
    {
        private readonly SettingsController _controller;
        private readonly CheckBox _movementTranslucencyCheckBox;
        private readonly NumericUpDown _movingOpacityInput;
        private readonly NumericUpDown _fadeDurationInput;
        private readonly NumericUpDown _idleDelayInput;
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
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(360, 210);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(12);
            layout.ColumnCount = 2;
            layout.RowCount = 6;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
            Controls.Add(layout);

            _movementTranslucencyCheckBox = new CheckBox();
            _movementTranslucencyCheckBox.Text = LocalizedStrings.MovementTranslucencyLabel;
            _movementTranslucencyCheckBox.AutoSize = true;
            _movementTranslucencyCheckBox.CheckedChanged += delegate { ApplyFromControls(); };
            layout.Controls.Add(_movementTranslucencyCheckBox, 0, 0);
            layout.SetColumnSpan(_movementTranslucencyCheckBox, 2);

            _movingOpacityInput = AddNumberRow(layout, 1, LocalizedStrings.MovingOpacityLabel, CursorMirrorSettings.MinimumMovingOpacityPercent, CursorMirrorSettings.MaximumMovingOpacityPercent);
            _fadeDurationInput = AddNumberRow(layout, 2, LocalizedStrings.FadeDurationLabel, CursorMirrorSettings.MinimumFadeDurationMilliseconds, CursorMirrorSettings.MaximumFadeDurationMilliseconds);
            _idleDelayInput = AddNumberRow(layout, 3, LocalizedStrings.IdleDelayLabel, CursorMirrorSettings.MinimumIdleDelayMilliseconds, CursorMirrorSettings.MaximumIdleDelayMilliseconds);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.WrapContents = false;
            layout.Controls.Add(buttons, 0, 5);
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

        private NumericUpDown AddNumberRow(TableLayoutPanel layout, int row, string labelText, int minimum, int maximum)
        {
            Label label = new Label();
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
                _movementTranslucencyCheckBox.Checked = normalized.MovementTranslucencyEnabled;
                _movingOpacityInput.Value = normalized.MovingOpacityPercent;
                _fadeDurationInput.Value = normalized.FadeDurationMilliseconds;
                _idleDelayInput.Value = normalized.IdleDelayMilliseconds;
            }
            finally
            {
                _loading = false;
            }
        }

        private void ApplyFromControls()
        {
            if (_loading)
            {
                return;
            }

            CursorMirrorSettings settings = new CursorMirrorSettings();
            settings.MovementTranslucencyEnabled = _movementTranslucencyCheckBox.Checked;
            settings.MovingOpacityPercent = (int)_movingOpacityInput.Value;
            settings.FadeDurationMilliseconds = (int)_fadeDurationInput.Value;
            settings.IdleDelayMilliseconds = (int)_idleDelayInput.Value;
            _controller.UpdateSettings(settings);
        }
    }
}
