using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class SettingsWindowTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MSU-13", MovementTranslucencyDependentControlsDisabled);
            suite.Add("COT-MSU-14", SettingsWindowUsesApplicationIcon);
            suite.Add("COT-MSU-15", PredictionGainDependentControlDisabled);
            suite.Add("COT-MSU-16", PredictionModelSelection);
            suite.Add("COT-MSU-17", PredictionTargetOffsetControl);
            suite.Add("COT-MSU-19", RuntimeSchedulerControls);
            suite.Add("COT-MSU-20", SettingsWindowGroupedLayout);
        }

        // Movement translucency dependent controls [COT-MSU-13]
        private static void MovementTranslucencyDependentControlsDisabled()
        {
            RunOnStaThread(delegate
            {
                string directory = NewTestDirectory();
                try
                {
                    SettingsController controller = new SettingsController(
                        new SettingsStore(Path.Combine(directory, "settings.json")),
                        CursorMirrorSettings.Default(),
                        delegate { },
                        delegate { });

                    using (SettingsWindow window = new SettingsWindow(controller))
                    {
                        CheckBox movementCheckBox = GetField<CheckBox>(window, "_movementTranslucencyCheckBox");
                        Label movingOpacityLabel = GetField<Label>(window, "_movingOpacityLabel");
                        NumericUpDown movingOpacityInput = GetField<NumericUpDown>(window, "_movingOpacityInput");
                        Label fadeDurationLabel = GetField<Label>(window, "_fadeDurationLabel");
                        NumericUpDown fadeDurationInput = GetField<NumericUpDown>(window, "_fadeDurationInput");
                        Label idleDelayLabel = GetField<Label>(window, "_idleDelayLabel");
                        NumericUpDown idleDelayInput = GetField<NumericUpDown>(window, "_idleDelayInput");
                        CheckBox idleFadeCheckBox = GetField<CheckBox>(window, "_idleFadeCheckBox");
                        Label idleFadeDurationLabel = GetField<Label>(window, "_idleFadeDurationLabel");
                        NumericUpDown idleFadeDurationInput = GetField<NumericUpDown>(window, "_idleFadeDurationInput");
                        Label idleFadeDelayLabel = GetField<Label>(window, "_idleFadeDelayLabel");
                        NumericUpDown idleFadeDelayInput = GetField<NumericUpDown>(window, "_idleFadeDelayInput");

                        TestAssert.True(movingOpacityInput.Enabled, "moving opacity initially enabled");
                        TestAssert.True(fadeDurationInput.Enabled, "fade duration initially enabled");
                        TestAssert.True(idleDelayInput.Enabled, "idle delay initially enabled");
                        TestAssert.True(idleFadeDurationInput.Enabled, "idle fade duration initially enabled");
                        TestAssert.True(idleFadeDelayInput.Enabled, "idle fade delay initially enabled");

                        movementCheckBox.Checked = false;

                        TestAssert.False(movingOpacityLabel.Enabled, "moving opacity label disabled");
                        TestAssert.False(movingOpacityInput.Enabled, "moving opacity input disabled");
                        TestAssert.False(fadeDurationLabel.Enabled, "fade duration label disabled");
                        TestAssert.False(fadeDurationInput.Enabled, "fade duration input disabled");
                        TestAssert.False(idleDelayLabel.Enabled, "idle delay label disabled");
                        TestAssert.False(idleDelayInput.Enabled, "idle delay input disabled");
                        TestAssert.False(controller.CurrentSettings.MovementTranslucencyEnabled, "movement setting updated");

                        movementCheckBox.Checked = true;

                        TestAssert.True(movingOpacityLabel.Enabled, "moving opacity label re-enabled");
                        TestAssert.True(movingOpacityInput.Enabled, "moving opacity input re-enabled");
                        TestAssert.True(fadeDurationLabel.Enabled, "fade duration label re-enabled");
                        TestAssert.True(fadeDurationInput.Enabled, "fade duration input re-enabled");
                        TestAssert.True(idleDelayLabel.Enabled, "idle delay label re-enabled");
                        TestAssert.True(idleDelayInput.Enabled, "idle delay input re-enabled");

                        idleFadeCheckBox.Checked = false;

                        TestAssert.False(idleFadeDurationLabel.Enabled, "idle fade duration label disabled");
                        TestAssert.False(idleFadeDurationInput.Enabled, "idle fade duration input disabled");
                        TestAssert.False(idleFadeDelayLabel.Enabled, "idle fade delay label disabled");
                        TestAssert.False(idleFadeDelayInput.Enabled, "idle fade delay input disabled");
                    }
                }
                finally
                {
                    DeleteDirectory(directory);
                }
            });
        }

        // Settings window uses application icon [COT-MSU-14]
        private static void SettingsWindowUsesApplicationIcon()
        {
            RunOnStaThread(delegate
            {
                string directory = NewTestDirectory();
                try
                {
                    SettingsController controller = new SettingsController(
                        new SettingsStore(Path.Combine(directory, "settings.json")),
                        CursorMirrorSettings.Default(),
                        delegate { },
                        delegate { });

                    using (SettingsWindow window = new SettingsWindow(controller))
                    {
                        TestAssert.True(window.Icon != null, "settings window icon must be set");
                        TestAssert.True(window.ShowIcon, "settings window should show its icon");
                    }
                }
                finally
                {
                    DeleteDirectory(directory);
                }
            });
        }

        // Prediction gain dependent control [COT-MSU-15]
        private static void PredictionGainDependentControlDisabled()
        {
            RunOnStaThread(delegate
            {
                string directory = NewTestDirectory();
                try
                {
                    SettingsController controller = new SettingsController(
                        new SettingsStore(Path.Combine(directory, "settings.json")),
                        CursorMirrorSettings.Default(),
                        delegate { },
                        delegate { });

                    using (SettingsWindow window = new SettingsWindow(controller))
                    {
                        CheckBox predictionCheckBox = GetField<CheckBox>(window, "_predictionCheckBox");
                        Label predictionModelLabel = GetField<Label>(window, "_predictionModelLabel");
                        ComboBox predictionModelInput = GetField<ComboBox>(window, "_predictionModelInput");
                        Label predictionGainLabel = GetField<Label>(window, "_predictionGainLabel");
                        NumericUpDown predictionGainInput = GetField<NumericUpDown>(window, "_predictionGainInput");
                        Label predictionTargetOffsetLabel = GetField<Label>(window, "_predictionTargetOffsetLabel");
                        NumericUpDown predictionTargetOffsetInput = GetField<NumericUpDown>(window, "_predictionTargetOffsetInput");

                        TestAssert.True(predictionModelLabel.Enabled, "prediction model label initially enabled");
                        TestAssert.True(predictionModelInput.Enabled, "prediction model input initially enabled");
                        TestAssert.True(predictionGainLabel.Enabled, "prediction gain label initially enabled");
                        TestAssert.True(predictionGainInput.Enabled, "prediction gain input initially enabled");
                        TestAssert.True(predictionTargetOffsetLabel.Enabled, "prediction target offset label initially enabled");
                        TestAssert.True(predictionTargetOffsetInput.Enabled, "prediction target offset input initially enabled");

                        predictionCheckBox.Checked = false;

                        TestAssert.False(predictionModelLabel.Enabled, "prediction model label disabled");
                        TestAssert.False(predictionModelInput.Enabled, "prediction model input disabled");
                        TestAssert.False(predictionGainLabel.Enabled, "prediction gain label disabled");
                        TestAssert.False(predictionGainInput.Enabled, "prediction gain input disabled");
                        TestAssert.False(predictionTargetOffsetLabel.Enabled, "prediction target offset label disabled");
                        TestAssert.False(predictionTargetOffsetInput.Enabled, "prediction target offset input disabled");
                        TestAssert.False(controller.CurrentSettings.PredictionEnabled, "prediction setting updated");

                        predictionCheckBox.Checked = true;

                        TestAssert.True(predictionModelLabel.Enabled, "prediction model label re-enabled");
                        TestAssert.True(predictionModelInput.Enabled, "prediction model input re-enabled");
                        TestAssert.True(predictionGainLabel.Enabled, "prediction gain label re-enabled");
                        TestAssert.True(predictionGainInput.Enabled, "prediction gain input re-enabled");
                        TestAssert.True(predictionTargetOffsetLabel.Enabled, "prediction target offset label re-enabled");
                        TestAssert.True(predictionTargetOffsetInput.Enabled, "prediction target offset input re-enabled");
                    }
                }
                finally
                {
                    DeleteDirectory(directory);
                }
            });
        }

        // Prediction model selection [COT-MSU-16]
        private static void PredictionModelSelection()
        {
            RunOnStaThread(delegate
            {
                string directory = NewTestDirectory();
                try
                {
                    SettingsController controller = new SettingsController(
                        new SettingsStore(Path.Combine(directory, "settings.json")),
                        CursorMirrorSettings.Default(),
                        delegate { },
                        delegate { });

                    using (SettingsWindow window = new SettingsWindow(controller))
                    {
                        ComboBox predictionModelInput = GetField<ComboBox>(window, "_predictionModelInput");
                        NumericUpDown predictionTargetOffsetInput = GetField<NumericUpDown>(window, "_predictionTargetOffsetInput");

                        TestAssert.Equal(4, predictionModelInput.Items.Count, "prediction model option count");
                        TestAssert.Equal("ConstantVelocity (default)", predictionModelInput.Items[0].ToString(), "constant velocity default option");
                        TestAssert.Equal("ConstantVelocityHighSpeedSwitch", predictionModelInput.Items[1].ToString(), "constant velocity high-speed switch option");
                        TestAssert.Equal("LeastSquares", predictionModelInput.Items[2].ToString(), "least-squares option");
                        TestAssert.Equal("SmoothPredictor", predictionModelInput.Items[3].ToString(), "smooth predictor option");
                        TestAssert.Equal(0, predictionModelInput.SelectedIndex, "constant velocity selected by default");

                        predictionModelInput.SelectedIndex = 1;

                        TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocityHighSpeedSwitch, controller.CurrentSettings.DwmPredictionModel, "constant velocity high-speed switch selection applied");

                        predictionModelInput.SelectedIndex = 2;

                        TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelLeastSquares, controller.CurrentSettings.DwmPredictionModel, "least-squares selection applied");

                        predictionModelInput.SelectedIndex = 3;

                        TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelSmoothPredictor, controller.CurrentSettings.DwmPredictionModel, "smooth predictor selection applied");
                        TestAssert.Equal(CursorMirrorSettings.DefaultDwmPredictionTargetOffsetMilliseconds, controller.CurrentSettings.DwmPredictionTargetOffsetMilliseconds, "smooth predictor selection preserves target offset");
                        TestAssert.Equal(CursorMirrorSettings.DefaultDwmPredictionTargetOffsetDisplayMilliseconds, (int)predictionTargetOffsetInput.Value, "smooth predictor target offset input preserved");

                        predictionModelInput.SelectedIndex = 0;

                        TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelConstantVelocity, controller.CurrentSettings.DwmPredictionModel, "constant velocity selection applied");
                    }
                }
                finally
                {
                    DeleteDirectory(directory);
                }
            });
        }

        // Prediction target offset control [COT-MSU-17]
        private static void PredictionTargetOffsetControl()
        {
            RunOnStaThread(delegate
            {
                string directory = NewTestDirectory();
                try
                {
                    SettingsController controller = new SettingsController(
                        new SettingsStore(Path.Combine(directory, "settings.json")),
                        CursorMirrorSettings.Default(),
                        delegate { },
                        delegate { });

                    using (SettingsWindow window = new SettingsWindow(controller))
                    {
                        NumericUpDown predictionTargetOffsetInput = GetField<NumericUpDown>(window, "_predictionTargetOffsetInput");

                        TestAssert.Equal(CursorMirrorSettings.MinimumDwmPredictionTargetOffsetDisplayMilliseconds, (int)predictionTargetOffsetInput.Minimum, "target offset display minimum");
                        TestAssert.Equal(CursorMirrorSettings.MaximumDwmPredictionTargetOffsetDisplayMilliseconds, (int)predictionTargetOffsetInput.Maximum, "target offset display maximum");
                        TestAssert.Equal(CursorMirrorSettings.DefaultDwmPredictionTargetOffsetDisplayMilliseconds, (int)predictionTargetOffsetInput.Value, "target offset default displayed");

                        predictionTargetOffsetInput.Value = -4;

                        TestAssert.Equal(4, controller.CurrentSettings.DwmPredictionTargetOffsetMilliseconds, "target offset selection applied");
                    }
                }
                finally
                {
                    DeleteDirectory(directory);
                }
            });
        }

        // Runtime scheduler controls [COT-MSU-19]
        private static void RuntimeSchedulerControls()
        {
            RunOnStaThread(delegate
            {
                string directory = NewTestDirectory();
                try
                {
                    SettingsController controller = new SettingsController(
                        new SettingsStore(Path.Combine(directory, "settings.json")),
                        CursorMirrorSettings.Default(),
                        delegate { },
                        delegate { });

                    using (SettingsWindow window = new SettingsWindow(controller))
                    {
                        CheckBox setExCheckBox = GetField<CheckBox>(window, "_runtimeSetWaitableTimerExCheckBox");
                        NumericUpDown fineWaitInput = GetField<NumericUpDown>(window, "_runtimeFineWaitInput");
                        NumericUpDown spinThresholdInput = GetField<NumericUpDown>(window, "_runtimeSpinThresholdInput");
                        CheckBox messageDeferralCheckBox = GetField<CheckBox>(window, "_runtimeMessageDeferralCheckBox");
                        Label messageDeferralLabel = GetField<Label>(window, "_runtimeMessageDeferralLabel");
                        NumericUpDown messageDeferralInput = GetField<NumericUpDown>(window, "_runtimeMessageDeferralInput");
                        CheckBox threadLatencyProfileCheckBox = GetField<CheckBox>(window, "_runtimeThreadLatencyProfileCheckBox");

                        TestAssert.True(setExCheckBox.Checked, "set waitable timer ex default checked");
                        TestAssert.Equal(2000, (int)fineWaitInput.Value, "fine wait default displayed");
                        TestAssert.Equal(100, (int)spinThresholdInput.Value, "spin threshold default displayed");
                        TestAssert.True(messageDeferralCheckBox.Checked, "message deferral default checked");
                        TestAssert.True(messageDeferralLabel.Enabled, "message deferral label initially enabled");
                        TestAssert.True(messageDeferralInput.Enabled, "message deferral input initially enabled");
                        TestAssert.True(threadLatencyProfileCheckBox.Checked, "thread latency default checked");

                        setExCheckBox.Checked = false;
                        fineWaitInput.Value = 800;
                        spinThresholdInput.Value = 300;
                        messageDeferralCheckBox.Checked = true;
                        messageDeferralInput.Value = 700;
                        threadLatencyProfileCheckBox.Checked = false;

                        TestAssert.False(controller.CurrentSettings.RuntimeSetWaitableTimerExEnabled, "set waitable timer ex setting applied");
                        TestAssert.Equal(800, controller.CurrentSettings.RuntimeFineWaitAdvanceMicroseconds, "fine wait setting applied");
                        TestAssert.Equal(300, controller.CurrentSettings.RuntimeFineWaitYieldThresholdMicroseconds, "spin threshold setting applied");
                        TestAssert.True(controller.CurrentSettings.RuntimeMessageDeferralEnabled, "message deferral setting applied");
                        TestAssert.Equal(700, controller.CurrentSettings.RuntimeMessageDeferralMicroseconds, "message deferral window setting applied");
                        TestAssert.False(controller.CurrentSettings.RuntimeThreadLatencyProfileEnabled, "thread latency setting applied");
                        TestAssert.True(messageDeferralLabel.Enabled, "message deferral label enabled");
                        TestAssert.True(messageDeferralInput.Enabled, "message deferral input enabled");

                        fineWaitInput.Value = 200;

                        TestAssert.Equal(200, (int)spinThresholdInput.Value, "spin threshold capped by fine wait");
                        TestAssert.Equal(200, controller.CurrentSettings.RuntimeFineWaitYieldThresholdMicroseconds, "capped spin threshold setting applied");
                    }
                }
                finally
                {
                    DeleteDirectory(directory);
                }
            });
        }

        // Settings window grouped layout [COT-MSU-20]
        private static void SettingsWindowGroupedLayout()
        {
            RunOnStaThread(delegate
            {
                string directory = NewTestDirectory();
                try
                {
                    SettingsController controller = new SettingsController(
                        new SettingsStore(Path.Combine(directory, "settings.json")),
                        CursorMirrorSettings.Default(),
                        delegate { },
                        delegate { });

                    using (SettingsWindow window = new SettingsWindow(controller))
                    {
                        TestAssert.True(window.ClientSize.Width >= 860, "settings window width should fit two-column grouped controls");
                        TestAssert.True(ContainsGroupBox(window, LocalizedStrings.PredictionCategoryLabel), "prediction group visible");
                        TestAssert.True(ContainsGroupBox(window, LocalizedStrings.RuntimeSchedulerHeaderLabel), "runtime scheduler group visible");
                        TestAssert.True(ContainsGroupBox(window, LocalizedStrings.MovementCategoryLabel), "movement group visible");
                        TestAssert.True(ContainsGroupBox(window, LocalizedStrings.IdleFadeCategoryLabel), "idle fade group visible");

                        TestGroupPosition(window, LocalizedStrings.PredictionCategoryLabel, 0, 0, "prediction group position");
                        TestGroupPosition(window, LocalizedStrings.RuntimeSchedulerHeaderLabel, 1, 0, "runtime scheduler group position");
                        TestGroupPosition(window, LocalizedStrings.MovementCategoryLabel, 0, 1, "movement group position");
                        TestGroupPosition(window, LocalizedStrings.IdleFadeCategoryLabel, 1, 1, "idle fade group position");
                    }
                }
                finally
                {
                    DeleteDirectory(directory);
                }
            });
        }

        private static bool ContainsGroupBox(Control parent, string text)
        {
            return FindGroupBox(parent, text) != null;
        }

        private static void TestGroupPosition(Control parent, string text, int expectedColumn, int expectedRow, string message)
        {
            GroupBox groupBox = FindGroupBox(parent, text);
            if (groupBox == null)
            {
                throw new InvalidOperationException("Group box not found: " + text);
            }

            TableLayoutPanel layout = groupBox.Parent as TableLayoutPanel;
            if (layout == null)
            {
                throw new InvalidOperationException("Group box parent is not a table layout: " + text);
            }

            TableLayoutPanelCellPosition position = layout.GetPositionFromControl(groupBox);
            TestAssert.Equal(expectedColumn, position.Column, message + " column");
            TestAssert.Equal(expectedRow, position.Row, message + " row");
        }

        private static GroupBox FindGroupBox(Control parent, string text)
        {
            foreach (Control child in parent.Controls)
            {
                GroupBox groupBox = child as GroupBox;
                if (groupBox != null && groupBox.Text == text)
                {
                    return groupBox;
                }

                GroupBox nested = FindGroupBox(child, text);
                if (nested != null)
                {
                    return nested;
                }
            }

            return null;
        }

        private static T GetField<T>(object instance, string fieldName)
            where T : class
        {
            FieldInfo field = instance.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
            if (field == null)
            {
                throw new MissingFieldException(instance.GetType().FullName, fieldName);
            }

            T value = field.GetValue(instance) as T;
            if (value == null)
            {
                throw new InvalidOperationException("Field did not contain the expected type: " + fieldName);
            }

            return value;
        }

        private static void RunOnStaThread(Action action)
        {
            Exception failure = null;
            Thread thread = new Thread(new ThreadStart(delegate
            {
                try
                {
                    action();
                }
                catch (Exception ex)
                {
                    failure = ex;
                }
            }));

            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            thread.Join();

            if (failure != null)
            {
                throw new Exception("STA settings-window test failed.", failure);
            }
        }

        private static string NewTestDirectory()
        {
            string directory = Path.Combine(Environment.CurrentDirectory, "artifacts", "test-settings-window", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            return directory;
        }

        private static void DeleteDirectory(string directory)
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, true);
            }
        }
    }
}
