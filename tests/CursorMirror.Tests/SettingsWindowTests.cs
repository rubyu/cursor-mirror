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

                        TestAssert.True(movingOpacityInput.Enabled, "moving opacity initially enabled");
                        TestAssert.True(fadeDurationInput.Enabled, "fade duration initially enabled");
                        TestAssert.True(idleDelayInput.Enabled, "idle delay initially enabled");

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

                        TestAssert.True(predictionModelLabel.Enabled, "prediction model label initially enabled");
                        TestAssert.True(predictionModelInput.Enabled, "prediction model input initially enabled");
                        TestAssert.True(predictionGainLabel.Enabled, "prediction gain label initially enabled");
                        TestAssert.True(predictionGainInput.Enabled, "prediction gain input initially enabled");

                        predictionCheckBox.Checked = false;

                        TestAssert.False(predictionModelLabel.Enabled, "prediction model label disabled");
                        TestAssert.False(predictionModelInput.Enabled, "prediction model input disabled");
                        TestAssert.False(predictionGainLabel.Enabled, "prediction gain label disabled");
                        TestAssert.False(predictionGainInput.Enabled, "prediction gain input disabled");
                        TestAssert.False(controller.CurrentSettings.PredictionEnabled, "prediction setting updated");

                        predictionCheckBox.Checked = true;

                        TestAssert.True(predictionModelLabel.Enabled, "prediction model label re-enabled");
                        TestAssert.True(predictionModelInput.Enabled, "prediction model input re-enabled");
                        TestAssert.True(predictionGainLabel.Enabled, "prediction gain label re-enabled");
                        TestAssert.True(predictionGainInput.Enabled, "prediction gain input re-enabled");
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

                        TestAssert.Equal(4, predictionModelInput.Items.Count, "prediction model option count");
                        TestAssert.Equal("ConstantVelocity (default)", predictionModelInput.Items[0].ToString(), "constant velocity default option");
                        TestAssert.Equal("LeastSquares", predictionModelInput.Items[1].ToString(), "least-squares option");
                        TestAssert.Equal("ExperimentalMLP", predictionModelInput.Items[2].ToString(), "experimental MLP option");
                        TestAssert.Equal("DistilledMLP", predictionModelInput.Items[3].ToString(), "distilled MLP option");
                        TestAssert.Equal(0, predictionModelInput.SelectedIndex, "constant velocity selected by default");

                        predictionModelInput.SelectedIndex = 1;

                        TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelLeastSquares, controller.CurrentSettings.DwmPredictionModel, "least-squares selection applied");

                        predictionModelInput.SelectedIndex = 2;

                        TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelExperimentalMlp, controller.CurrentSettings.DwmPredictionModel, "experimental MLP selection applied");

                        predictionModelInput.SelectedIndex = 3;

                        TestAssert.Equal(CursorMirrorSettings.DwmPredictionModelDistilledMlp, controller.CurrentSettings.DwmPredictionModel, "distilled MLP selection applied");

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
