using System;
using System.Drawing;
using System.Windows.Forms;

namespace CursorMirror
{
    public sealed class SettingsWindow : Form
    {
        private readonly SettingsController _controller;
        private readonly CheckBox _predictionCheckBox;
        private readonly CheckBox _runtimeSetWaitableTimerExCheckBox;
        private readonly CheckBox _runtimeMessageDeferralCheckBox;
        private readonly CheckBox _runtimeThreadLatencyProfileCheckBox;
        private readonly CheckBox _movementTranslucencyCheckBox;
        private readonly CheckBox _idleFadeCheckBox;
        private Label _predictionModelLabel;
        private Label _predictionGainLabel;
        private Label _predictionTargetOffsetLabel;
        private Label _runtimeFineWaitLabel;
        private Label _runtimeSpinThresholdLabel;
        private Label _runtimeMessageDeferralLabel;
        private Label _movingOpacityLabel;
        private Label _fadeDurationLabel;
        private Label _idleDelayLabel;
        private Label _idleFadeOpacityLabel;
        private Label _idleFadeDurationLabel;
        private Label _idleFadeDelayLabel;
        private readonly ComboBox _predictionModelInput;
        private readonly NumericUpDown _predictionGainInput;
        private readonly NumericUpDown _predictionTargetOffsetInput;
        private readonly NumericUpDown _runtimeFineWaitInput;
        private readonly NumericUpDown _runtimeSpinThresholdInput;
        private readonly NumericUpDown _runtimeMessageDeferralInput;
        private readonly NumericUpDown _movingOpacityInput;
        private readonly NumericUpDown _fadeDurationInput;
        private readonly NumericUpDown _idleDelayInput;
        private readonly NumericUpDown _idleFadeOpacityInput;
        private readonly NumericUpDown _idleFadeDurationInput;
        private readonly NumericUpDown _idleFadeDelayInput;
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
            ClientSize = new Size(860, 460);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(10);
            layout.ColumnCount = 2;
            layout.RowCount = 3;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(layout);

            TableLayoutPanel predictionLayout = AddGroup(layout, 0, 0, LocalizedStrings.PredictionCategoryLabel, 4);

            _predictionCheckBox = new CheckBox();
            _predictionCheckBox.Text = LocalizedStrings.PredictiveOverlayPositioningLabel;
            _predictionCheckBox.AutoSize = true;
            _predictionCheckBox.CheckedChanged += delegate
            {
                UpdatePredictionInputState();
                ApplyFromControls();
            };
            predictionLayout.Controls.Add(_predictionCheckBox, 0, 0);
            predictionLayout.SetColumnSpan(_predictionCheckBox, 2);

            _predictionModelInput = AddComboRow(predictionLayout, 1, LocalizedStrings.PredictionModelLabel, out _predictionModelLabel);
            _predictionModelInput.SelectedIndexChanged += delegate { PredictionModelSelectionChanged(); };

            _predictionGainInput = AddNumberRow(predictionLayout, 2, LocalizedStrings.PredictionGainLabel, CursorMirrorSettings.MinimumPredictionGainPercent, CursorMirrorSettings.MaximumPredictionGainPercent, out _predictionGainLabel);
            _predictionTargetOffsetInput = AddNumberRow(predictionLayout, 3, LocalizedStrings.PredictionTargetOffsetLabel, CursorMirrorSettings.MinimumDwmPredictionTargetOffsetDisplayMilliseconds, CursorMirrorSettings.MaximumDwmPredictionTargetOffsetDisplayMilliseconds, out _predictionTargetOffsetLabel);

            TableLayoutPanel runtimeLayout = AddGroup(layout, 1, 0, LocalizedStrings.RuntimeSchedulerHeaderLabel, 6);

            _runtimeSetWaitableTimerExCheckBox = new CheckBox();
            _runtimeSetWaitableTimerExCheckBox.Text = LocalizedStrings.RuntimeSetWaitableTimerExLabel;
            _runtimeSetWaitableTimerExCheckBox.AutoSize = true;
            _runtimeSetWaitableTimerExCheckBox.CheckedChanged += delegate { ApplyFromControls(); };
            runtimeLayout.Controls.Add(_runtimeSetWaitableTimerExCheckBox, 0, 0);
            runtimeLayout.SetColumnSpan(_runtimeSetWaitableTimerExCheckBox, 2);

            _runtimeFineWaitInput = AddNumberRow(runtimeLayout, 1, LocalizedStrings.RuntimeFineWaitLabel, CursorMirrorSettings.MinimumRuntimeFineWaitAdvanceMicroseconds, CursorMirrorSettings.MaximumRuntimeFineWaitAdvanceMicroseconds, out _runtimeFineWaitLabel);
            _runtimeFineWaitInput.ValueChanged += delegate { UpdateRuntimeSchedulerInputState(); };
            _runtimeSpinThresholdInput = AddNumberRow(runtimeLayout, 2, LocalizedStrings.RuntimeSpinThresholdLabel, CursorMirrorSettings.MinimumRuntimeFineWaitYieldThresholdMicroseconds, CursorMirrorSettings.MaximumRuntimeFineWaitYieldThresholdMicroseconds, out _runtimeSpinThresholdLabel);

            _runtimeMessageDeferralCheckBox = new CheckBox();
            _runtimeMessageDeferralCheckBox.Text = LocalizedStrings.RuntimeMessageDeferralLabel;
            _runtimeMessageDeferralCheckBox.AutoSize = true;
            _runtimeMessageDeferralCheckBox.CheckedChanged += delegate
            {
                UpdateRuntimeSchedulerInputState();
                ApplyFromControls();
            };
            runtimeLayout.Controls.Add(_runtimeMessageDeferralCheckBox, 0, 3);
            runtimeLayout.SetColumnSpan(_runtimeMessageDeferralCheckBox, 2);

            _runtimeMessageDeferralInput = AddNumberRow(runtimeLayout, 4, LocalizedStrings.RuntimeMessageDeferralWindowLabel, CursorMirrorSettings.MinimumRuntimeMessageDeferralMicroseconds, CursorMirrorSettings.MaximumRuntimeMessageDeferralMicroseconds, out _runtimeMessageDeferralLabel);

            _runtimeThreadLatencyProfileCheckBox = new CheckBox();
            _runtimeThreadLatencyProfileCheckBox.Text = LocalizedStrings.RuntimeThreadLatencyProfileLabel;
            _runtimeThreadLatencyProfileCheckBox.AutoSize = true;
            _runtimeThreadLatencyProfileCheckBox.CheckedChanged += delegate { ApplyFromControls(); };
            runtimeLayout.Controls.Add(_runtimeThreadLatencyProfileCheckBox, 0, 5);
            runtimeLayout.SetColumnSpan(_runtimeThreadLatencyProfileCheckBox, 2);

            TableLayoutPanel movementLayout = AddGroup(layout, 0, 1, LocalizedStrings.MovementCategoryLabel, 4);

            _movementTranslucencyCheckBox = new CheckBox();
            _movementTranslucencyCheckBox.Text = LocalizedStrings.MovementTranslucencyLabel;
            _movementTranslucencyCheckBox.AutoSize = true;
            _movementTranslucencyCheckBox.CheckedChanged += delegate
            {
                UpdateMovementTranslucencyInputState();
                ApplyFromControls();
            };
            movementLayout.Controls.Add(_movementTranslucencyCheckBox, 0, 0);
            movementLayout.SetColumnSpan(_movementTranslucencyCheckBox, 2);

            _movingOpacityInput = AddNumberRow(movementLayout, 1, LocalizedStrings.MovingOpacityLabel, CursorMirrorSettings.MinimumMovingOpacityPercent, CursorMirrorSettings.MaximumMovingOpacityPercent, out _movingOpacityLabel);
            _fadeDurationInput = AddNumberRow(movementLayout, 2, LocalizedStrings.FadeDurationLabel, CursorMirrorSettings.MinimumFadeDurationMilliseconds, CursorMirrorSettings.MaximumFadeDurationMilliseconds, out _fadeDurationLabel);
            _idleDelayInput = AddNumberRow(movementLayout, 3, LocalizedStrings.IdleDelayLabel, CursorMirrorSettings.MinimumIdleDelayMilliseconds, CursorMirrorSettings.MaximumIdleDelayMilliseconds, out _idleDelayLabel);

            TableLayoutPanel idleFadeLayout = AddGroup(layout, 1, 1, LocalizedStrings.IdleFadeCategoryLabel, 4);

            _idleFadeCheckBox = new CheckBox();
            _idleFadeCheckBox.Text = LocalizedStrings.IdleFadeLabel;
            _idleFadeCheckBox.AutoSize = true;
            _idleFadeCheckBox.CheckedChanged += delegate
            {
                UpdateIdleFadeInputState();
                ApplyFromControls();
            };
            idleFadeLayout.Controls.Add(_idleFadeCheckBox, 0, 0);
            idleFadeLayout.SetColumnSpan(_idleFadeCheckBox, 2);

            _idleFadeOpacityInput = AddNumberRow(idleFadeLayout, 1, LocalizedStrings.IdleOpacityLabel, CursorMirrorSettings.MinimumIdleOpacityPercent, CursorMirrorSettings.MaximumIdleOpacityPercent, out _idleFadeOpacityLabel);
            _idleFadeDurationInput = AddNumberRow(idleFadeLayout, 2, LocalizedStrings.IdleFadeDurationLabel, CursorMirrorSettings.MinimumIdleFadeDurationMilliseconds, CursorMirrorSettings.MaximumIdleFadeDurationMilliseconds, out _idleFadeDurationLabel);
            _idleFadeDelayInput = AddNumberRow(idleFadeLayout, 3, LocalizedStrings.IdleFadeDelayLabel, CursorMirrorSettings.MinimumIdleFadeDelayMilliseconds, CursorMirrorSettings.MaximumIdleFadeDelayMilliseconds, out _idleFadeDelayLabel);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Top;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.WrapContents = false;
            layout.Controls.Add(buttons, 0, 2);
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

        private TableLayoutPanel AddGroup(TableLayoutPanel outerLayout, int column, int row, string title, int rowCount)
        {
            GroupBox group = new GroupBox();
            group.Text = title;
            group.Dock = DockStyle.Fill;
            group.AutoSize = true;
            group.Margin = new Padding(4);
            group.Padding = new Padding(10, 8, 10, 10);
            outerLayout.Controls.Add(group, column, row);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Top;
            layout.AutoSize = true;
            layout.ColumnCount = 2;
            layout.RowCount = rowCount;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55));
            for (int i = 0; i < rowCount; i++)
            {
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            }

            group.Controls.Add(layout);
            return layout;
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
                _predictionTargetOffsetInput.Value =
                    CursorMirrorSettings.DwmPredictionTargetOffsetToDisplayMilliseconds(normalized.DwmPredictionTargetOffsetMilliseconds);
                _runtimeSetWaitableTimerExCheckBox.Checked = normalized.RuntimeSetWaitableTimerExEnabled;
                _runtimeFineWaitInput.Value = normalized.RuntimeFineWaitAdvanceMicroseconds;
                _runtimeSpinThresholdInput.Value = normalized.RuntimeFineWaitYieldThresholdMicroseconds;
                _runtimeMessageDeferralCheckBox.Checked = normalized.RuntimeMessageDeferralEnabled;
                _runtimeMessageDeferralInput.Value = normalized.RuntimeMessageDeferralMicroseconds;
                _runtimeThreadLatencyProfileCheckBox.Checked = normalized.RuntimeThreadLatencyProfileEnabled;
                _movementTranslucencyCheckBox.Checked = normalized.MovementTranslucencyEnabled;
                _movingOpacityInput.Value = normalized.MovingOpacityPercent;
                _fadeDurationInput.Value = normalized.FadeDurationMilliseconds;
                _idleDelayInput.Value = normalized.IdleDelayMilliseconds;
                _idleFadeCheckBox.Checked = normalized.IdleFadeEnabled;
                _idleFadeOpacityInput.Value = normalized.IdleOpacityPercent;
                _idleFadeDurationInput.Value = normalized.IdleFadeDurationMilliseconds;
                _idleFadeDelayInput.Value = normalized.IdleFadeDelayMilliseconds;
            }
            finally
            {
                _loading = false;
            }

            UpdatePredictionInputState();
            UpdateRuntimeSchedulerInputState();
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
            settings.DwmPredictionTargetOffsetMilliseconds =
                CursorMirrorSettings.DwmPredictionTargetOffsetFromDisplayMilliseconds((int)_predictionTargetOffsetInput.Value);
            settings.RuntimeSetWaitableTimerExEnabled = _runtimeSetWaitableTimerExCheckBox.Checked;
            settings.RuntimeFineWaitAdvanceMicroseconds = (int)_runtimeFineWaitInput.Value;
            settings.RuntimeFineWaitYieldThresholdMicroseconds = (int)_runtimeSpinThresholdInput.Value;
            settings.RuntimeMessageDeferralEnabled = _runtimeMessageDeferralCheckBox.Checked;
            settings.RuntimeMessageDeferralMicroseconds = (int)_runtimeMessageDeferralInput.Value;
            settings.RuntimeThreadLatencyProfileEnabled = _runtimeThreadLatencyProfileCheckBox.Checked;
            settings.MovementTranslucencyEnabled = _movementTranslucencyCheckBox.Checked;
            settings.MovingOpacityPercent = (int)_movingOpacityInput.Value;
            settings.FadeDurationMilliseconds = (int)_fadeDurationInput.Value;
            settings.IdleDelayMilliseconds = (int)_idleDelayInput.Value;
            settings.IdleFadeEnabled = _idleFadeCheckBox.Checked;
            settings.IdleOpacityPercent = (int)_idleFadeOpacityInput.Value;
            settings.IdleFadeDurationMilliseconds = (int)_idleFadeDurationInput.Value;
            settings.IdleFadeDelayMilliseconds = (int)_idleFadeDelayInput.Value;
            _controller.UpdateSettings(settings);
        }

        private void PredictionModelSelectionChanged()
        {
            UpdatePredictionInputState();
            ApplyFromControls();
        }

        private void UpdatePredictionInputState()
        {
            bool enabled = _predictionCheckBox.Checked;
            _predictionModelLabel.Enabled = enabled;
            _predictionModelInput.Enabled = enabled;
            _predictionGainLabel.Enabled = enabled;
            _predictionGainInput.Enabled = enabled;
            _predictionTargetOffsetLabel.Enabled = enabled;
            _predictionTargetOffsetInput.Enabled = enabled;
        }

        private static void ReplacePredictionModelItems(ComboBox comboBox, int selectedModel)
        {
            comboBox.BeginUpdate();
            try
            {
                comboBox.Items.Clear();
                comboBox.Items.Add(LocalizedStrings.PredictionModelOptionText(CursorMirrorSettings.DwmPredictionModelConstantVelocity));
                comboBox.SelectedIndex = PredictionModelIndex(selectedModel);
            }
            finally
            {
                comboBox.EndUpdate();
            }
        }

        private static int PredictionModelFromSelection(ComboBox comboBox)
        {
            return CursorMirrorSettings.DwmPredictionModelConstantVelocity;
        }

        private static int PredictionModelIndex(int model)
        {
            return 0;
        }

        private void UpdateIdleFadeInputState()
        {
            bool enabled = _idleFadeCheckBox.Checked;
            _idleFadeOpacityLabel.Enabled = enabled;
            _idleFadeOpacityInput.Enabled = enabled;
            _idleFadeDurationLabel.Enabled = enabled;
            _idleFadeDurationInput.Enabled = enabled;
            _idleFadeDelayLabel.Enabled = enabled;
            _idleFadeDelayInput.Enabled = enabled;
        }

        private void UpdateRuntimeSchedulerInputState()
        {
            decimal fineWaitMaximum = Math.Max(
                CursorMirrorSettings.MinimumRuntimeFineWaitYieldThresholdMicroseconds,
                _runtimeFineWaitInput.Value);
            if (_runtimeSpinThresholdInput.Maximum != fineWaitMaximum)
            {
                _runtimeSpinThresholdInput.Maximum = fineWaitMaximum;
            }

            if (_runtimeSpinThresholdInput.Value > _runtimeSpinThresholdInput.Maximum)
            {
                _runtimeSpinThresholdInput.Value = _runtimeSpinThresholdInput.Maximum;
            }

            bool messageDeferralEnabled = _runtimeMessageDeferralCheckBox.Checked;
            _runtimeMessageDeferralLabel.Enabled = messageDeferralEnabled;
            _runtimeMessageDeferralInput.Enabled = messageDeferralEnabled;
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
